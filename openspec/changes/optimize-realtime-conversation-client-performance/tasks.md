## 1. Baseline Tests And Diagnostics

- [x] 1.1 P0 输入：现有 `useThreadItemEvents` Gemini batching bypass；输出：把当前 bypass 测试改成“Gemini assistant deltas 在 batching enabled 时进入 flush window”；验证：focused `useThreadItemEvents.test.ts` 先红后绿。
- [x] 1.2 P0 输入：现有 `prepareThreadItems` call-count helpers；输出：新增 reasoning/tool delta 高频 reducer 测试，证明 safe same-item delta 不应每 chunk 完整派生；验证：focused `useThreadsReducer.reasoning.test.ts` 和相关 reducer test。
- [x] 1.3 P1 输入：现有 stream diagnostics；输出：补充 reducer/render/composer 证据字段或等价 bounded summary 的测试覆盖；验证：focused `streamLatencyDiagnostics.test.ts` 或新增相邻测试。
- [x] 1.4 P0 输入：proposal 兼容性与门禁规则；输出：为每个实现阶段建立检查清单，覆盖协议兼容、语义兼容、回滚兼容、UI 兼容、diagnostics bounded；验证：后续任务 PR/commit 说明逐项引用。

## 2. Event Batching And Coalescing

- [x] 2.1 P0 依赖 1.1；输入：`useThreadItemEvents.ts`；输出：移除 Gemini assistant delta immediate dispatch，复用 lossless realtime batching 队列；验证：Gemini batching、interrupted thread、flush-on-unmount 测试通过。
- [x] 2.2 P1 输入：normalized realtime event batching；输出：把 Codex-only assistant snapshot batching 提炼为语义安全 eligibility，并保留 completion/tool/user/generated-image/review 全序；验证：`useThreadItemEvents.test.ts`、`useThreadsReducer.normalized-realtime.test.ts`。
- [x] 2.3 P1 输入：batching rollback flag；输出：确认 `ccgui.perf.realtimeBatching=off` 时三引擎回 baseline immediate path；验证：新增或更新 flag 测试。

## 3. Reducer Incremental Derivation

- [x] 3.1 P0 依赖 1.2；输入：`appendReasoningSummary` / `appendReasoningContent`；输出：same-item safe reasoning delta fast path，结构边界仍回 `prepareThreadItems(...)`；验证：call-count、ordering、Gemini late reasoning tests。
- [x] 3.2 P1 输入：`appendToolOutput`; 输出：running same-item tool output delta fast path，truncation/insert/completion 边界回 canonical path；验证：tool output reducer tests。
- [x] 3.3 P1 输入：assistant delta fast path；输出：已评估当前 Claude-only live assistant fast path，结论是本轮不扩展到 Codex legacy/canonical id 场景，避免 assistant id canonicalization 与 final metadata guard 语义风险；验证：保留现有 assistant delta tests 与 final metadata guard tests，Gemini 收益落在 batching/coalescing 层。

## 4. Render Profile And Composer Isolation

- [x] 4.1 P1 输入：`presentationProfile.ts`、`MessagesRows.tsx`；输出：明确 Codex/Claude/Gemini baseline profile 与 mitigation profile 的诊断边界；验证：presentation profile 和 stream mitigation tests。
- [x] 4.2 P1 输入：`Messages.tsx` / `MessagesRows.tsx` / `Markdown.tsx`；输出：三引擎 visible text growth diagnostics 按 thread+item 隔离，completion 本地收敛 final Markdown；验证：Messages/MessagesRows/Markdown focused tests。
- [x] 4.3 P1 输入：`useLayoutNodes.tsx`、`Composer.tsx`、`ChatInputBoxAdapter.tsx`；输出：确认 streaming live props 只 defer advisory data，不 defer draft/selection/IME/attachments/send payload；验证：ChatInputBoxAdapter/Composer tests 和人工测试矩阵。

## 5. Validation And Review

- [x] 5.1 P0 运行 OpenSpec strict validation；输入：change artifacts；输出：`openspec validate optimize-realtime-conversation-client-performance --strict --no-interactive` 通过。
- [x] 5.2 P0 运行 focused frontend tests；输入：本 change 触及的 hooks/render/composer tests；输出：相关 Vitest suites 通过。
- [x] 5.3 P1 运行全局质量门禁；输入：实现后的代码；输出：`npm run typecheck`、`npm run lint`、必要时 `npm run check:large-files` 通过。
- [x] 5.4 P1 输出人工测试矩阵；输入：Codex / Claude Code / Gemini realtime streaming 会话；输出：覆盖长 Markdown、reasoning、tool output、输入框打字/IME、stop/terminal、rollback flags 的手测步骤。
- [x] 5.5 P0 执行兼容性门禁 review；输入：最终 diff；输出：确认无 Tauri/provider payload 变更、无 conversation semantic drift、无无界 diagnostics、无 composer source-of-truth defer、无 Gemini 专属长期分支；验证：review 结论写入最终交付说明。
