# Tasks

任务粒度遵循 OpenSpec config 约束：每项可在 2 小时内完成，含明确输入/输出/验证方式。任务编号即依赖顺序，未标 `parallel` 的下游任务依赖上游。

## 1. Specification

- [ ] 1.1 编写 `specs/claude-session-sidebar-state-parity/spec.md` delta，ADDED 4 个 Requirement，每个含 2-3 个 Scenario，覆盖：(a) Claude listing timeout 保留 last-good 条目；(b) 自污染防御；(c) partial-source 诊断不被消音；(d) 多次连续 timeout 不递减。
    - **验收**：`openspec validate harden-claude-sidebar-list-timeout-fallback --strict --no-interactive` 通过。

## 2. Test-First (TDD Red)

- [ ] 2.1 新建 `src/features/threads/hooks/useThreadActions.timeout.test.ts`，准备 fixtures：`makeClaudeFixture(n)`, `makeCodexFixture(n)`, `withFakeTimers`。
    - **验收**：fixtures 文件可被其他测试 import；无业务断言，仅准备数据。
- [ ] 2.2 写 case 1（Claude timeout + Codex 1 条）失败用例，期望 visibleSummaries 包含 last-good 全部 Claude 条目。
    - **验收**：`npx vitest run src/features/threads/hooks/useThreadActions.timeout.test.ts` 红，错误信息明确指向缺失 Claude 条目。
- [ ] 2.3 写 case 2（连续两次 Claude null）失败用例，期望第二次 lastGood = 首次 first-page 完整列表。
    - **验收**：红，错误信息指向第二次 lastGood 已被污染。
- [ ] 2.4 写 case 3（Claude reject + Codex null）保留既有 emptyListFallback 行为的回归用例。
    - **验收**：红或绿（视既有实现），无论结果都不应被本次改动破坏。
- [ ] 2.5 写 case 4（Claude 正常 + Codex null）回归用例。
    - **验收**：同上，保护既有路径不退化。

## 3. Implementation (Green)

- [ ] 3.1 在 `useThreadActions.helpers.ts` 新增 `isHealthyNonDegradedSummaries(summaries)` 与 `isDegradedSummary(summary)`。
    - **依赖**：1.1, 2.2-2.3。
    - **验收**：单测覆盖 4 个分支（null / empty / healthy / degraded）。
- [ ] 3.2 改 `getLastGoodThreadSummaries`（`useThreadActions.ts:348-365`）为多级 fallback：current(non-degraded) → previous(non-degraded) → state(non-degraded) → snapshot(non-degraded) → []。
    - **依赖**：3.1。
    - **验收**：case 2（自污染防御）转绿。
- [ ] 3.3 在 Claude 子结果处理分支（`useThreadActions.ts:1847-1899`）植入 last-good Claude seed：value === null 或 status === rejected 时，把 `lastGoodThreadSummaries.filter(engineSource === 'claude' && !shared && !archived)` 投递进 mergedById，发生时机在 `mergeCodexCatalogSessionSummaries` 之前。
    - **依赖**：3.1, 3.2。
    - **验收**：case 1（Claude timeout + Codex 1 条）转绿。
- [ ] 3.4 保留 `rememberPartialSource("claude-session-timeout" | "claude-session-error")` 与 `onDebug` 上报，确保 partial badge 仍可显示。
    - **依赖**：3.3。
    - **验收**：case 5（新增，验证 partial-source 诊断仍触发）绿；既有 partial-source 行为不变。

## 4. Validation

- [ ] 4.1 运行 `openspec validate harden-claude-sidebar-list-timeout-fallback --strict --no-interactive`。
    - **验收**：0 error，0 warning。
- [ ] 4.2 运行 `npx vitest run src/features/threads/hooks/useThreadActions.timeout.test.ts`。
    - **验收**：5/5 绿。
- [ ] 4.3 运行 `npx vitest run src/features/threads/hooks/useThreadActions.test.ts`（既有用例不退化）。
    - **验收**：全绿，无新增 skip。
- [ ] 4.4 运行 `npm run typecheck`。
    - **验收**：0 error。
- [ ] 4.5 运行 `npx vitest run src/features/session-activity src/features/app`（受影响周边模块的回归）。
    - **验收**：全绿。

## 5. Manual QA

- [ ] 5.1 启动 mossx dev build，工作区下应有 ≥2 条 Claude 会话 + ≥1 条 Codex 会话；打开应用后等待 90 秒；列表 MUST 保持完整。
    - **验收**：肉眼观测列表数与启动时一致。
- [ ] 5.2 临时把 `withTimeout` 第二参数改为 `1`（强制超时），重启验证 fallback 路径；恢复后再次验证。
    - **验收**：强制超时下列表仍保持完整 + Debug 面板看到 `thread/list claude timeout` 事件。
- [ ] 5.3 在 Debug 面板检查 `partialSource` badge / `recoveryState === "degraded"` 标记是否正确呈现（不被新逻辑消音）。
    - **验收**：partial-source 仍可见。

## 6. Review Hardening

- [ ] 6.1 自审：seed 顺序是否真的在 `mergeCodexCatalogSessionSummaries` 之前；catalog 重组路径是否会洗掉 seed 的条目（若会，需要在 catalog merge 后再补一次）。
    - **验收**：单测 case 1 在打开 catalog 路径开关时仍绿。
- [ ] 6.2 自审：`isHealthyNonDegradedSummaries` 不要把 Codex/Gemini 的 degraded 标记当成 Claude 的问题（避免 cross-engine 污染）。
    - **验收**：补一个 mixed-engine fixture 验证。
- [ ] 6.3 Update `openspec/project.md` 若有相关 capability 索引或 active changes 计数（按 OpenSpec 1.3.x 约定）。
    - **验收**：`openspec list` 显示本 change 为 active。

## 7. Archive Prep（不在本次执行）

- [ ] 7.1 实现合并到 develop 后，运行 `openspec archive harden-claude-sidebar-list-timeout-fallback --strict`。
    - **执行时机**：合并 PR 之后，由维护者执行。
