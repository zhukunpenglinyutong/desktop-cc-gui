# Design: Harden Claude Sidebar List Timeout Fallback

## Context

### 既有时序

```text
T0  应用启动，activeWorkspace 就绪
    └─ ensureWorkspaceThreadListLoaded(activeWs, { preserveState: true })
       └─ phase: "active-workspace", kind: "first-page"
          └─ listThreadsForWorkspace(ws, { startupHydrationMode: "first-page" })
             ├─ shouldDeferFullSessionCatalog = true              ← (useThreadActions.ts:1485)
             ├─ Claude/OpenCode/Codex catalog 全部 skip            ← (1828-1846)
             └─ 用 lastGoodThreadSummaries 兜底 (sidebar snapshot)  ← (2036-2042)
                ▶ 用户看到完整列表 ✅

Tn≈数秒后  idle prewarm 触发 next workspace 的 full-catalog
    └─ prewarmFullCatalogForWorkspace(activeWs)                    ← (useWorkspaceThreadListHydration.ts:267-275)
       └─ phase: "idle-prewarm", kind: "full-catalog"
          ├─ orchestrator timeoutMs: 20_000                        ← (.ts:68)
          └─ listThreadsForWorkspace(ws, { startupHydrationMode: "full-catalog" })
             ├─ withTimeout(listClaudeSessionsService, 30_000)     ← (1840-1843)
             ├─ withTimeout(getOpenCodeSessionListService, 30_000) ← (1828-1832)
             └─ loadActiveProjectCatalogSessions                   ← (1834-1836)

T+30s  Claude promise 仍未 resolve
    └─ withTimeout 内部 setTimeout 触发 → resolve(null)             ← (helpers.ts:944-948)
       └─ claudeResult.status === "fulfilled", claudeResult.value === null
          ├─ rememberPartialSource("claude-session-timeout")
          └─ claudeSessions = []                                   ← (1861-1863) ⚠️ 关键缺陷点
       ▼
       mergedById 中 Claude 条目数 = 0（被 codex catalog 重组后维持 0）
       visibleSummaries = [codex 仅剩 1 条]                          ← length = 1
       ▼
       fallback 决策：
         - emptyListFallbackSource：length === 0 失败              ← (2086-2089)
         - degradedPartialSource = "claude-session-timeout"
         - shouldApplyClaudeSidebarContinuity → true               ← (helpers.ts:899-915)
         - mergeDegradedClaudeContinuitySummaries(
             visibleSummaries=[codex1],
             lastGoodThreadSummaries,   ← 关键看这里取到了什么
             ...
           )
       ▼
       getLastGoodThreadSummaries(ws.id)：
         - latestThreadsByWorkspaceRef.current[ws.id]              ← 第一站
           ▶ 每次 render 同步成 threadsByWorkspace（行 331-335）
           ▶ 第一次进入时 = first-page 完整列表 ✅ → 此次 merge 成功
       ▼
       dispatch({ type: "setThreads", threads: visibleSummaries }) ← (2144-2148)
       latestThreadsByWorkspaceRef.current = { ..., [ws.id]: visibleSummaries }
       ▼
       此时 visibleSummaries **已经包含 last-good Claude 条目**？

       理论上是的——但只要 `mergeCodexCatalogSessionSummaries`（行 1985-1993）
       在 catalog 路径已经把 mergedById 重置，且 catalog 不携带 Claude 条目，
       后续 Claude 子源 timeout 又只能给空数组，那么 mergedById 里就**没有任何 Claude**。
       partial-source merge 阶段虽然能补，但补完仍可能被后续 archive/shared/gemini 路径
       的 `Array.from(mergedById.values())` 重组覆盖，且如果 `getLastGoodThreadSummaries`
       已被自污染（详见下文），补的就是空。
```

### 自污染回路

`useThreadActions.ts:331-335`：

```ts
const previousThreadsByWorkspaceRef = useRef(threadsByWorkspace);
const latestThreadsByWorkspaceRef = useRef(threadsByWorkspace);
if (latestThreadsByWorkspaceRef.current !== threadsByWorkspace) {
  previousThreadsByWorkspaceRef.current = latestThreadsByWorkspaceRef.current;
}
latestThreadsByWorkspaceRef.current = threadsByWorkspace;
```

每次 React render 都把 `latestThreadsByWorkspaceRef.current` 同步成 store 当前值。一旦 partial-source merge 在第一次触发后把残缺态（哪怕带 degraded 标记）dispatch 进 store，next render 时 ref 也跟着同步成残缺态，**`hasHealthyThreadSummaries(latestThreadsByWorkspaceRef.current[ws])` 仅看 length，不看 degraded 标记**——所以第二次 timeout 触发的 partial-source 兜底，拿到的 lastGood 已经是上次的残缺结果。

### 雷达 vs 侧边栏的差异

雷达走 `useSessionRadarFeed`（独立调 listClaudeSessionsService、独立缓存），不经过 thread store。所以即使侧边栏挂了，雷达照常显示——这正好对应用户的观察。

## Decision

采用两个最小修复点，**不动 store/ref 整体架构**。

### 方案 A：Claude 子源 timeout 时合并 last-good Claude（推荐）

在 `useThreadActions.ts:1847-1899` 的 Claude 子结果处理分支中，**当 `claudeResult.value === null` 或 `claudeResult.status === "rejected"`** 时：

- 不要让 `claudeSessions = []` 直接参与 mergedById 投递；
- 改为从 `lastGoodThreadSummaries` 取出**带 `engineSource === "claude"` 且非 archived/shared** 的条目，作为 fallback 投递进 mergedById；
- 仍然 `rememberPartialSource("claude-session-timeout" | "claude-session-error")` 保留可观测性；
- 仍然进入 partial-source 后续 merge（行 2122-2141），形成"双保险"——即使后续重组改变 mergedById，partial-source 路径还会补一次。

```ts
// 伪代码（仅示意，最终以实现为准）
let claudeSessions: ClaudeNativeSession[] = [];
if (claudeResult.status === "fulfilled") {
  if (claudeResult.value === null) {
    rememberPartialSource("claude-session-timeout");
    // 不让 mergedById 看到空数组——把 last-good 的 Claude 条目以 ThreadSummary 形式
    // 直接 set 进 mergedById（注意 mergeThreadSummaryPreservingStableIdentity）
    seedMergedByIdWithLastGoodClaude(mergedById, lastGoodThreadSummaries, hiddenSharedBindingIds);
  } else {
    claudeSessions = claudeResult.value;
  }
  claudeSessions.forEach(/* 原逻辑 */);
} else {
  rememberPartialSource("claude-session-error");
  seedMergedByIdWithLastGoodClaude(mergedById, lastGoodThreadSummaries, hiddenSharedBindingIds);
}
```

### 方案 B：收紧 `getLastGoodThreadSummaries` 的 healthy 判定

在 `useThreadActions.ts:348-365` 与 `useThreadActions.helpers.ts:hasHealthyThreadSummaries`：

- "healthy" 不仅看 `length > 0`，还要看**没有任何条目带 `partialSource` / `recoveryState === "degraded"` 标记**；
- 一旦 current 是 degraded → 跳到 previous（render 前快照）→ 再跳到 sidebar snapshot；
- 这样即使 partial 残缺态被 dispatch 进 store，下次取 lastGood 时也会跳过它。

### 方案 A vs B

| 维度 | A：Claude 子源直接合 last-good | B：lastGood 取值口收紧 |
|---|---|---|
| 直接性 | 在源头止血，timeout 不再产生空数组 | 在下游兜底，等空数组产生后用更干净的 lastGood 补 |
| 自污染防御 | 弱（仍依赖 lastGood 干净） | 强（明确剔除 degraded） |
| 改动半径 | 1 个分支 + 1 个 helper | 1 个函数 + helper 扩展 |
| 与既有 partial-source 路径关系 | 共存，形成双保险 | 共存，让 partial-source 路径更可靠 |
| 风险 | 可能让 timeout 后的列表"看起来正常"而掩盖真问题 → 必须保留 partial-source 诊断 | 边界 case：first-page 拿不到任何 healthy lastGood → 仍能 fallback 到 snapshot |

**结论**：A + B 都做。两者互补，不互斥。A 是源头止血，B 是回路加固。任一缺位都会让另一个失效。

### 不采用的方案

- **方案 C：把前端 `withTimeout` 改大到 60s 以上**——治标不治本，且会让用户在出错时 hang 更久；何况后端 Rust `LOCAL_SESSION_SCAN_TIMEOUT` 就是 60s，前端调到 60s 仍可能等到 reject。
- **方案 D：把 `claudeResult.value === null` 时跳过整个 dispatch**——会破坏其他正常子源（Codex/OpenCode）的更新可见性。
- **方案 E：引擎级独立 lastGood snapshot**——架构级，留给后续 change `evolve-thread-list-per-engine-snapshot`。

## Implementation Sketch

### Step 1：新增 helper `isHealthyNonDegradedSummaries`

在 `useThreadActions.helpers.ts`：

```ts
export function isHealthyNonDegradedSummaries(
  summaries: ThreadSummary[] | undefined | null,
): boolean {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return false;
  }
  // 任何条目带 degraded 标记，整个数组视为 unhealthy
  return summaries.every((s) => !isDegradedSummary(s));
}
```

`isDegradedSummary` 判定基于既有 `markThreadSummariesDegraded` 写入的 `partialSource` / `recoveryState` 字段。

### Step 2：`getLastGoodThreadSummaries` 改用新 helper

```ts
const getLastGoodThreadSummaries = useCallback((workspaceId: string) => {
  const cur = latestThreadsByWorkspaceRef.current[workspaceId];
  if (isHealthyNonDegradedSummaries(cur)) return cur;
  const prev = previousThreadsByWorkspaceRef.current[workspaceId];
  if (isHealthyNonDegradedSummaries(prev)) return prev;
  const stateThreads = threadsByWorkspace[workspaceId];
  if (isHealthyNonDegradedSummaries(stateThreads)) return stateThreads;
  const snapshot = loadSidebarSnapshot()?.threadsByWorkspace[workspaceId];
  if (isHealthyNonDegradedSummaries(snapshot)) return snapshot;
  return [];
}, [threadsByWorkspace]);
```

### Step 3：Claude 子源 timeout 分支植入 seed

在 `useThreadActions.ts:1847-1860`：当 `claudeResult.value === null` 或 `claudeResult.status === "rejected"`：

```ts
const claudeFallbackEntries = lastGoodThreadSummaries.filter(
  (s) => s.engineSource === "claude"
      && s.threadKind !== "shared"
      && (s.archivedAt ?? 0) === 0
      && !hiddenSharedBindingIds.has(s.id),
);
claudeFallbackEntries.forEach((entry) => {
  const prev = mergedById.get(entry.id);
  if (!prev || entry.updatedAt >= prev.updatedAt) {
    mergedById.set(entry.id, mergeThreadSummaryPreservingStableIdentity(prev, entry));
  }
});
```

注意：seed 必须发生在 `mergeCodexCatalogSessionSummaries`（行 1985-1993）**之前**，让 catalog 重组也能保留这些 Claude 条目。这是 Decision 中"在源头止血"的关键。

### Step 4：测试

- `useThreadActions.timeout.test.ts`（新建）：
  - case 1：Claude null + Codex 1 条 → 最终 visibleSummaries 包含 last-good 所有 Claude 条目 + Codex 1 条；
  - case 2：连续两次 Claude null → 第二次的 lastGood 仍是首次 first-page 的完整列表；
  - case 3：Claude reject + Codex null → 进入 emptyListFallback 路径（既有），不退化；
  - case 4：Claude 返回正常 + Codex null → Codex partial-source 兜底（既有），不退化；
- 既有 `useThreadActions.test.ts` 全部不退化。

## Risks

- **过度兜底掩盖真故障**：超时 + seed 会让用户感觉一切正常，但 Rust 端可能确实有性能问题。
  - **缓解**：保留 `rememberPartialSource("claude-session-timeout")` 诊断；在 dev 模式或 debug 面板显示 partial badge；未来通过 telemetry 追踪超时频率。
- **last-good 条目 staleness**：seed 进去的 Claude 条目是上一轮的快照，updatedAt 可能过期，与真实文件不一致。
  - **缓解**：seed 时保留原 updatedAt，不伪造时间；下一次成功 listClaudeSessionsService 会刷新；degraded 标记可让 UI 显式提示"列表可能不完整"。
- **测试脆弱性**：依赖 `useEffect` 时序与 React render cycle。
  - **缓解**：测试用 `act()` 包裹，并用 `vi.useFakeTimers()` 控制 withTimeout 触发点。

## Migration & Rollout

- 单 PR，无 feature flag。改动仅前端 hook，无后端契约变化。
- 可在 `useThreadActions.timeout.test.ts` 全绿 + `openspec validate --strict` 通过后直接合并 develop。
- 回滚极易：revert PR 即可；既有 partial-source 诊断路径不变，回滚不会引入新行为。
