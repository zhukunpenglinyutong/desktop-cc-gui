# Proposal: Harden Claude Sidebar List Timeout Fallback

## Summary

工作区左侧栏在应用启动后约 30 秒会出现 Claude 历史会话从列表中"消失"的现象：首屏 30 秒内可见完整列表，随后突然只剩下少量（典型为 1 条 Codex 会话），点击刷新按钮无法恢复，关闭重开能稳定复现。同一时刻，工作区"会话雷达"仍能看到这些 Claude 会话，证明 native session truth 没有丢，丢的是**侧边栏列表合并链路**。

根因是侧边栏列表 hydration 在 `first-page` → `full-catalog` 切换时，`listClaudeSessionsService` 在前端 `withTimeout(30s)` 内未返回，被等同为"空数组"参与最终合并；同时 `lastGoodThreadSummaries` 优先从 `latestThreadsByWorkspaceRef.current` 读取，而该 ref 每次 render 都会被同步成已残缺的 store 状态，导致**自污染**——下一次刷新拿到的"上次良好状态"已经被自己污染过，partial-source 兜底路径形同虚设。

本变更只做最小止血：

1. 让 Claude 子结果在 timeout / null 时**保持 last-good Claude 条目**，不让"空数组"参与合并覆盖；
2. 让 `getLastGoodThreadSummaries` 在 "current 已带 degraded 标记" 时 fallback 到 previous / snapshot 链，杜绝自污染。

不做架构级重构（引擎级独立快照、超时三层对齐），那些留给后续 change。

## Problem

- `useThreadActions.ts:1840-1842` 用 `withTimeout(listClaudeSessionsService(...), 30_000)` 包装 Claude 列表请求，超时时 `withTimeout` 返回 `null`。
- 行 1861-1863：`const claudeSessions = Array.isArray(claudeResult.value) ? claudeResult.value : []` 将 `null` 等同为 `[]`，**Claude 那支彻底不向 mergedById 投递任何条目**。
- 行 2086-2089：空列表 fallback 仅在 `visibleSummaries.length === 0` 时启动。用户场景下 Codex 还剩 1 条，`length = 1`，fallback **不触发**。
- 行 2122-2129：partial-source 兜底路径理论上能合并回 `lastGoodThreadSummaries`，但 `lastGoodThreadSummaries` 的取值口（`useThreadActions.ts:348-365`）优先从 `latestThreadsByWorkspaceRef.current[workspaceId]` 读，而 ref 在每次 render 中（行 331-335）都被同步到当前 `threadsByWorkspace`，**残缺态一旦 dispatch 进 store，下一轮 lastGood 就已被污染**。
- 现有 spec `claude-session-sidebar-state-parity` 已经写了 "unrelated Claude sessions MUST NOT disappear" 的精神契约，但场景只覆盖到 "large base64 transcript"，没有覆盖 timeout / partial degradation 这条入口。

## Goals

- Claude 列表请求超时或返回 null 时，sidebar 列表 MUST 不丢失上一轮可见的 Claude 会话条目。
- `getLastGoodThreadSummaries` MUST 把"健康"定义为"非 degraded"，避免自污染。
- 当 Codex / OpenCode / Catalog 任意子源仍返回数据时，Claude 子源 timeout 不得静默把列表覆盖为 "看起来已成功的残缺态"。
- 维持现有 `first-page` → `full-catalog` 启动时序、orchestrator 调度、archive/hidden 过滤、catalog 分页游标等行为契约不变。
- 为 `claude-session-sidebar-state-parity` capability 增加针对 timeout / partial-source 的明确 scenarios。

## Non-Goals

- 不重写引擎级独立快照（每引擎独立 lastGood）。该重构留给后续 change `evolve-thread-list-per-engine-snapshot`（待立）。
- 不调整三层超时对齐（orchestrator 20s vs withTimeout 30s vs Rust 60s）。
- 不动 Rust 端 `list_claude_sessions_from_base_dir` 扫描性能。
- 不改 Codex catalog 分页、folder tree、archive 语义。
- 不改 Gemini / OpenCode 的 timeout 处理（同病但不在本次范围；同样错配，单独 change）。
- 不调整 `withTimeout` 工具函数语义（保持 `Promise<T | null>` 契约）。
- 不引入新依赖。

## Scope

### In Scope

- `src/features/threads/hooks/useThreadActions.ts`：
  - `getLastGoodThreadSummaries` 取值口收紧 "healthy" 判定，剔除 degraded 状态。
  - Claude 子结果 timeout 分支（行 1847-1860 附近）合并 last-good Claude 条目。
- `src/features/threads/hooks/useThreadActions.helpers.ts`：
  - 若 `hasHealthyThreadSummaries` 需要扩展为 "non-degraded"，在此扩展；或新增 helper。
- 单元/集成测试：
  - 新增/修改 `useThreadActions.test.*` 覆盖：(a) Claude timeout + Codex 仍有数据时 Claude 条目保留；(b) lastGood 自污染防御；(c) 连续两次 timeout 不会逐步丢失更多会话。
- Spec delta：
  - `openspec/specs/claude-session-sidebar-state-parity/spec.md` 通过本 change `specs/.../spec.md` 添加 ADDED Requirements。

### Out of Scope

- Codex / OpenCode / Gemini 超时分支（同病不同源，单独立项）。
- session-radar 链路调整。
- `WorkspaceSessionRadarPanel` 渲染逻辑。
- 后端 Rust 扫描器性能。
- Settings / 用户偏好相关变更。

## Impact

- Frontend behavior：
  - `src/features/threads/hooks/useThreadActions.ts`
  - `src/features/threads/hooks/useThreadActions.helpers.ts`
- Tests：
  - `src/features/threads/hooks/useThreadActions.test.ts`（或新建针对 timeout 场景的子文件）
- Specs：
  - `openspec/specs/claude-session-sidebar-state-parity/spec.md`（通过本 change ADD requirements，归档时 sync 进主 spec）

## Acceptance Criteria

1. 启动应用 → 等待 60 秒 → Claude 历史会话不消失（即使前端 timeout 触发）。
2. 模拟 `listClaudeSessionsService` 抛 `null`（withTimeout 超时）+ Codex 仍返回 1 条 → 侧边栏最终列表 MUST 包含上一轮的所有 Claude 条目 + Codex 1 条。
3. 连续触发两次 `listThreadsForWorkspace` (full-catalog) 都让 Claude null → 第二次的 lastGood MUST 仍是首次 first-page 的完整列表，而不是被第一次残缺态污染。
4. partial-source diagnostic 仍然写入（保持可观测性），不静默吞错。
5. `openspec validate --all --strict --no-interactive` 通过；新增 spec delta 中所有 Scenario 至少有 1 个 WHEN + 1 个 THEN。
6. `npm run typecheck` 与触达模块的 Vitest 全部绿。
7. 现有 `claude-session-sidebar-state-parity` 既有 Scenarios 全部不退化。
