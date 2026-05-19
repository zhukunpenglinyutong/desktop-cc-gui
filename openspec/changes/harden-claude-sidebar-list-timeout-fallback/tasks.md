# Tasks

任务粒度遵循 OpenSpec config 约束：每项可在 2 小时内完成，含明确输入/输出/验证方式。任务编号即依赖顺序，未标 `parallel` 的下游任务依赖上游。

## Current Status

2026-05-19 复核结论：第一阶段 timeout / reject fallback 代码已落地，目标 change 仍保持 active，不归档。已验证：

- `openspec validate harden-claude-sidebar-list-timeout-fallback --strict --no-interactive` 通过。
- `npx vitest run src/features/threads/hooks/useThreadActions.timeout-fallback.test.tsx` 通过，8/8。
- 运行时代码已包含 Claude timeout / reject last-good seed、degraded last-good 拒绝、自污染防御与 partial-source debug。

仍需继续处理用户反馈的两个复现场景：

- Claude Code session 仍可能从客户端 sidebar 消失，说明问题可能还存在于 successful-empty、catalog projection、archive/shared filtering 或 request race 路径。
- 在子文件夹 workspace 创建的 Claude Code session 偶尔归到父文件夹，说明需要收紧 Claude session attribution / ownership 边界。

## 1. Specification

- [x] 1.1 编写 `specs/claude-session-sidebar-state-parity/spec.md` delta，ADDED 4 个 Requirement，每个含 2-3 个 Scenario，覆盖：(a) Claude listing timeout 保留 last-good 条目；(b) 自污染防御；(c) partial-source 诊断不被消音；(d) 多次连续 timeout 不递减。
    - **验收**：`openspec validate harden-claude-sidebar-list-timeout-fallback --strict --no-interactive` 通过。

## 2. Test-First (TDD Red)

- [x] 2.1 新建 `src/features/threads/hooks/useThreadActions.timeout-fallback.test.tsx`，准备 timeout fallback 测试 harness、cached Claude summaries、fake timers。
    - **验收**：测试文件可独立运行；fixtures 内聚在该测试文件中。
- [x] 2.2 写 case 1（Claude timeout + Codex 1 条）用例，期望 visibleSummaries 包含 last-good 全部 Claude 条目。
    - **验收**：`npx vitest run src/features/threads/hooks/useThreadActions.timeout-fallback.test.tsx` 绿。
- [x] 2.3 写 case 2（连续两次 Claude null）用例，期望第二次 lastGood 仍保留首次完整 Claude 列表。
    - **验收**：测试验证第二次 Claude 条目数不少于第一次，且包含原始 cached Claude ids。
- [x] 2.4 写 case 3（Claude reject + Codex null）保留既有 emptyListFallback 行为的回归用例。
    - **验收**：focused timeout 文件新增 `claude rejects and codex catalog is empty` regression，验证 `claude-session-error` debug 可见，last-good Claude 仍保留并标记 degraded。
- [x] 2.5 写 archived last-good Claude 不被 resurrect 的回归用例。
    - **验收**：focused test case 4 已覆盖 archived entry 不进入 seed。

## 3. Implementation (Green)

- [x] 3.1 在 `useThreadActions.helpers.ts` 扩展 `hasHealthyThreadSummaries(summaries)` 为 non-degraded 判定。
    - **依赖**：1.1, 2.2-2.3。
    - **验收**：实现拒绝 `isDegraded` / `partialSource` / `degradedReason` 条目，focused consecutive-timeout test 覆盖自污染路径。
- [x] 3.2 改 `getLastGoodThreadSummaries`（`useThreadActions.ts:348-365`）为多级 fallback：current(non-degraded) → previous(non-degraded) → state(non-degraded) → snapshot(non-degraded) → []。
    - **依赖**：3.1。
    - **验收**：case 2（自污染防御）转绿。
- [x] 3.3 在 Claude 子结果处理分支（`useThreadActions.ts:1847-1899`）植入 last-good Claude seed：value === null 或 status === rejected 时，把可保留的 Claude last-good 条目投递进 mergedById，发生时机在 `mergeCodexCatalogSessionSummaries` 之前。
    - **依赖**：3.1, 3.2。
    - **验收**：case 1（Claude timeout + Codex 1 条）转绿。
- [x] 3.4 保留 `rememberPartialSource("claude-session-timeout" | "claude-session-error")` 与 `onDebug` 上报，确保 partial badge 仍可显示。
    - **依赖**：3.3。
    - **验收**：focused case 3 验证 Claude timeout debug event 可见；既有 partial-source 行为不变。

## 4. Validation

- [x] 4.1 运行 `openspec validate harden-claude-sidebar-list-timeout-fallback --strict --no-interactive`。
    - **验收**：0 error，0 warning。
- [x] 4.2 运行 `npx vitest run src/features/threads/hooks/useThreadActions.timeout-fallback.test.tsx`。
    - **验收**：2026-05-19 运行通过，8/8 绿。
- [x] 4.3 运行 `npx vitest run src/features/threads/hooks/useThreadActions.test.ts`（既有用例不退化）。
    - **验收**：2026-05-19 运行通过，46/46 绿，无新增 skip。
- [ ] 4.4 运行 `npm run typecheck`。
    - **当前状态**：2026-05-19 运行失败，但错误来自当前工作区另一个未完成 change 的 `src/features/engine/capabilities/*`：`Unused '@ts-expect-error'` 与 `CapabilityLookupState` setState 类型不匹配；本 change 目标文件未暴露新增 typecheck error。
- [x] 4.5 运行 `npx vitest run src/features/session-activity src/features/app`（受影响周边模块的回归）。
    - **验收**：2026-05-19 运行通过，58 个 test files / 483 tests 全绿。

## 5. Manual QA

- [ ] 5.1 启动 mossx dev build，工作区下应有 ≥2 条 Claude 会话 + ≥1 条 Codex 会话；打开应用后等待 90 秒；列表 MUST 保持完整。
    - **验收**：肉眼观测列表数与启动时一致。
- [ ] 5.2 临时把 `withTimeout` 第二参数改为 `1`（强制超时），重启验证 fallback 路径；恢复后再次验证。
    - **验收**：强制超时下列表仍保持完整 + Debug 面板看到 `thread/list claude timeout` 事件。
- [ ] 5.3 在 Debug 面板检查 `partialSource` badge / `recoveryState === "degraded"` 标记是否正确呈现（不被新逻辑消音）。
    - **验收**：partial-source 仍可见。

## 6. Review Hardening

- [x] 6.1 自审：seed 顺序是否真的在 `mergeCodexCatalogSessionSummaries` 之前；catalog 重组路径是否会洗掉 seed 的条目（若会，需要在 catalog merge 后再补一次）。
    - **验收**：case 1 使用 Codex catalog session，验证 Claude seed 与 Codex entry 共存。
- [x] 6.2 自审：`hasHealthyThreadSummaries` 当前按整个列表拒绝 degraded 标记，可能让非 Claude 引擎 degraded 也影响 lastGood；后续若引擎级 snapshot 落地，需要改为 engine-aware healthy 判定。
    - **验收**：focused timeout 文件新增 mixed-engine degraded fixture；当前策略明确为“任何 degraded 当前列表都不作为 last-good”，会回退到 previous clean snapshot，避免 Claude last-good 被 cross-engine partial state 污染。后续 engine-aware snapshot 落地时再缩小判定粒度。
- [x] 6.3 Update `openspec/project.md` 若有相关 capability 索引或 active changes 计数（按 OpenSpec 1.3.x 约定）。
    - **验收**：`openspec list` 显示本 change 为 active；`project.md` 是低漂移治理快照，本 change 不更新 active count。

## 7. Archive Prep（不在本次执行）

- [ ] 7.1 实现合并到 develop 后，运行 `openspec archive harden-claude-sidebar-list-timeout-fallback --strict`。
    - **执行时机**：合并 PR 之后，由维护者执行。

## 8. Continued Investigation: Claude Sessions Still Disappear

- [x] 8.1 复现并采集 debug payload：记录 `thread/list claude timeout`、`thread/list claude error`、`thread/list fallback`、`thread/list error fallback`、`partialSource`、最终 `visibleSummaries.length` 与 engine 分布。
    - **验收**：新增 `thread/list claude successful empty degraded` debug event，payload 包含 `partialSource`、`lastGoodCount`、`currentEngineCounts`、`catalogEngineCounts`；timeout / reject / fallback 既有 debug 路径保持可见。
- [x] 8.2 写 successful-empty 回归测试：`listClaudeSessionsService` 成功返回 `[]`，但 last-good 中存在 Claude 条目且 catalog / debug 显示 listing attribution 不确定时，不得静默擦掉 last-good。
    - **验收**：`useThreadActions.timeout-fallback.test.tsx` 新增 successful-empty + `claude-history-unavailable` partial case，验证 last-good Claude 保留并标记 degraded。
- [x] 8.3 检查 `applySessionArchiveState`、`hiddenSharedBindingIds`、shared session merge、Gemini async merge 是否会在 timeout fallback 后二次移除 Claude 条目。
    - **验收**：发现并修复 error/empty fallback 直接使用 last-good 导致 archived Claude 复活的路径；新增 `filterRetainableContinuitySummaries`，fallback 前统一剔除 archived/shared/pending/hidden entries；既有 archived last-good regression 通过。
- [x] 8.4 检查 request sequence race：较旧 full-catalog 请求是否可能晚到并覆盖较新的 healthy store。
    - **验收**：现有 `threadListRequestSeqRef` 在主 dispatch 与 Gemini async dispatch 前均检查 latest；既有 `ignores stale thread list responses that finish after a newer refresh` 覆盖 stale response，不需要本轮改动。

## 9. Continued Investigation: Subfolder Claude Session Attribution Drift

- [x] 9.1 编写 Rust 复现测试：父 workspace `/repo` 与子 workspace `/repo/sub` 同时存在，Claude transcript `cwd=/repo/sub` 时，session MUST 归属子 workspace，不得被父 workspace claim。
    - **验收**：新增/更新 `claude_child_workspace_session_is_not_claimed_by_parent_projection` 与 `claude_independent_nested_workspace_session_is_not_claimed_by_parent_projection`，覆盖 parent direct project dir scan、child transcript cwd、worktree child、independent nested child 四条入口。
- [x] 9.2 收紧 `list_claude_sessions_for_attribution_scopes_with_config` / catalog projection 的 ownership：exact child path / longest workspace match 必须优先于 parent scope 与 git_root family inference。
    - **验收**：workspace-scope Claude catalog entry 生成后会通过 `apply_strict_attribution_owner` 按全量 workspace exact/longest owner 重归属；project projection 可以保留 child-owned 聚合 entry，但不会生成 parent-owned duplicate；独立 nested child 不在 parent scope 时会从 parent projection 过滤掉。
- [x] 9.3 审计 `build_claude_attribution_scopes` 与 `infer_related_attribution_for_workspace`，避免 parent scope fallback 在多 child workspace 存在时把子 session 标成父级 related。
    - **验收**：`resolve_catalog_entry_attribution` 已执行 longest unique workspace match；现有 `inferred_related_attribution_keeps_ambiguous_git_root_unassigned`、`catalog_workspace_scope_keeps_worktree_selection_isolated` 与新增 child-owner 测试共同覆盖歧义边界。
- [x] 9.4 前端补 projection regression：同一 Claude session 在 parent / child projection 间移动时，sidebar 不得把 child-owned session 渲染到 parent folder root。
    - **验收**：`useThreadActions.timeout-fallback.test.tsx` 新增 owner-aware catalog merge regression；`normalizeProjectCatalogSession` 保留 `workspaceId/matchedWorkspaceId`，thread-list hydration 只合并当前 workspace owner 的 catalog entry。
