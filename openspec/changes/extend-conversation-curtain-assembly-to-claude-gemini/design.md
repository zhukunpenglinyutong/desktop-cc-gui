## Context

`Codex` 已完成两段关键铺垫：

- `unify-conversation-curtain-normalization`: 建立 shared normalization core，收口 realtime / history duplicate convergence。
- `complete-conversation-curtain-assembler`: 将 `ConversationAssembler` 推进到 Codex realtime/history 的 shared semantic assembly boundary。

当前代码已经存在 `claudeRealtimeAdapter.ts`、`geminiRealtimeAdapter.ts`、`claudeHistoryLoader.ts`、`geminiHistoryLoader.ts` 与 `conversationAssembler.ts`，说明“通用幕布”不是从零开始。真正缺口在于：Claude / Gemini 的 adapter、loader、render pacing 还没有被同一份 contract 强制约束，容易继续出现“实时看起来可用，history replay / long streaming / reasoning merge 又漂移”的问题。

## Goals

- 把 `ConversationAssembler` 从 Codex-first 主链扩展到 Claude / Gemini 的 conversation-visible 主路径。
- 让 Claude / Gemini loader / adapter 不再拥有第二套 comparator；它们只负责 provider carrier 到 normalized observation 的薄适配。
- 用 engine-aware baseline presentation profile 管理 Markdown / reasoning / waiting cadence，避免继续在 `MessagesRows` 里扩散 provider 条件分支。
- 保持 provider-scoped stream mitigation 作为 evidence-triggered recovery lane；它可以覆盖 baseline profile 的 pacing，但不得承载正常默认体验。
- 保持 Codex baseline 不动，新增跨引擎 parity tests 来证明没有回退。

## Non-Goals

- 不改 Rust / Tauri runtime payload contract。
- 不重做 Claude approval bridge 或 Gemini telemetry 粒度。
- 不迁移所有 legacy reducer actions。
- 不做视觉 redesign。
- 不引入新的持久化 schema。

## Current State

### Assets already available

| 资产 | 当前价值 | 缺口 |
|---|---|---|
| `conversationNormalization.ts` | 已承载 user / assistant / reasoning equivalence | 规则文字与测试仍偏 Codex 场景 |
| `conversationAssembler.ts` | 已能 hydrate history / assemble normalized observations | 主路径接线仍偏 Codex |
| `claudeRealtimeAdapter.ts` | 已有 Claude realtime 适配入口 | 需要确认 assistant / reasoning / tool / approval / plan observations 能进入 assembler |
| `geminiRealtimeAdapter.ts` | 已有 Gemini realtime 适配入口 | reasoning / tool snapshot 与 assembler equivalence 需收敛 |
| `claudeHistoryLoader.ts` | 已有 Claude history 恢复 | JSONL / resume marker / approval card replay 需过 shared assembly |
| `geminiHistoryLoader.ts` / parser | 已有 Gemini history parser | adjacent reasoning merge 不能继续成为第二套 comparator |
| `MessagesRows.tsx` stream profile | 已存在 streaming throttle / mitigation hooks | 需要抽成 engine-aware presentation profile，而不是继续加 hard-coded branch |

## Decisions

### Decision 1: 新 change 扩展主 specs，不续写归档 change

旧两个 change 已归档，不能再作为 active work item 修改。主 specs 是新工作的事实源，因此本 change 通过 `MODIFIED Requirements` 升级 `conversation-curtain-normalization-core` 和 `conversation-curtain-assembly-core`。

### Decision 2: Claude / Gemini 接入 shared assembler，但分批迁移

不做“一刀切全 reducer 替换”。优先迁移最容易验证的主路径：

1. history hydrate path 先过 `ConversationAssembler.hydrateHistory()`。
2. normalized realtime adapter 输出增加 reducer-facing assembly helper。
3. legacy action 可短期共存，但必须证明 visible semantics 与 assembler contract 等价。

### Decision 3: Loader 不再拥有独立 comparator policy

Claude / Gemini loader 可以做 provider carrier parsing，但不能维护独立的 assistant/reasoning duplicate policy。若需要 merge adjacent fragments，应调用 shared normalization helper，或保留 fragments 给 assembler 决策。

### Decision 4: Streaming polish 进入 baseline presentation profile，而不是 normalization 或 mitigation

Normalization / assembler 解决“是什么同一条语义 observation”。Baseline presentation profile 解决“正常情况下如何稳定显示”。Provider-scoped mitigation 只解决“有 latency / render evidence 时如何临时降级恢复”。三者不能混在一起：

- normalization 不应因为 throttle 需要而丢 semantic rows。
- presentation profile 不应因为 UI pacing 而改变 row cardinality。
- mitigation profile 不应成为 Claude / Gemini 的默认 streaming 配置来源。

### Decision 5: Codex 是 baseline，不是本轮重构对象

Codex tests 必须继续跑。任何为了 Claude/Gemini 泛化而改变 Codex staged markdown、queued handoff、image generation、assistant idempotency 的行为都视为回归。

## Implementation Shape

### Phase 1: Contract and test harness

- 扩展 `conversationNormalization` tests，加入 Claude long markdown、Claude approval/ExitPlanMode replay、Gemini reasoning/tool replay 样本。
- 扩展 `conversationAssembler` tests，断言 Claude/Gemini equivalent history replay 不改变 visible row cardinality。
- 补 `realtimeHistoryParity` fixture，覆盖 Claude / Gemini realtime -> history hydrate 等价序列。

### Phase 2: Claude Code history path

- 让 `claudeHistoryLoader.ts` 的输出进入 assembler hydrate path。
- 将 resume marker / synthetic approval carrier 只作为 metadata 或 structured fact，不作为重复正文 row。
- 补历史重开、approval card replay、plan card replay 的 tests。

### Phase 3: Claude Code realtime path

- Audit `claudeRealtimeAdapter.ts` 输出，补齐 assistant、reasoning、tool snapshot、approval、ExitPlanMode normalized observations。
- 将 normalized realtime observations 接入 shared assembly helper。
- 补长 Markdown completion 与 realtime/history parity tests。

### Phase 4: Gemini history path

- 将 adjacent reasoning merge 接入 shared reasoning equivalence。
- 让 Gemini history hydrate 进入 assembler hydrate path。
- 补 reasoning / tool snapshot / assistant replay history tests。

### Phase 5: Gemini realtime path

- Audit `geminiRealtimeAdapter.ts` 输出。
- 将 Gemini normalized realtime observations 接入 shared assembly helper。
- 补 realtime -> history parity tests。

### Phase 6: Streaming presentation profile

- 定义 engine-aware profile 输入：engine、provider/model fingerprint、platform、turn latency evidence、message kind、isLive。
- 记录 Codex 现有 profile defaults 作为 baseline，不改变 Codex 默认行为。
- 将 Claude / Gemini 的 Markdown throttle、reasoning throttle、waiting/ingress visibility 通过 baseline profile 决定。
- 保留 provider-scoped mitigation diagnostics，确保 evidence-triggered override 命中可观测、可回退。

### Phase 7: Cleanup and gates

- 删除或收窄 loader/reducer 中不再需要的 duplicate helper。
- 确认 `MessagesRows` 不新增三引擎分叉组件。
- 更新 `.trellis/spec/frontend` 中 conversation curtain / streaming profile 规则。

## Verification

- `openspec validate extend-conversation-curtain-assembly-to-claude-gemini --strict`
- `npm run typecheck`
- Focused Vitest:
  - `src/features/threads/adapters/realtimeAdapters.test.ts`
  - `src/features/threads/contracts/conversationAssembler.test.ts`
  - `src/features/threads/contracts/realtimeHistoryParity.test.ts`
  - `src/features/threads/loaders/claudeHistoryLoader.test.ts`
  - `src/features/threads/loaders/historyLoaders.test.ts`
  - `src/features/threads/assembly/conversationNormalization.test.ts`
  - relevant `MessagesRows` / Markdown streaming tests
- Regression:
  - Codex normalization / assembler tests remain green.
  - Claude approval / ExitPlanMode cards remain visible and non-duplicated.
  - Gemini reasoning/tool history replay remains cardinality-stable.

## Rollback

- Claude / Gemini assembler path MUST be independently gateable during migration.
- Gate MUST be implementation-local and explicit: default state、storage/setting ownership、diagnostic label、and removal condition must be documented before code rollout.
- If Claude path regresses, roll back Claude to legacy reducer/loader path while retaining Codex and Gemini behavior.
- If Gemini path regresses, roll back Gemini profile / assembler connection without affecting Codex / Claude.
- If streaming profile causes UI regressions, disable only the affected engine/profile and keep semantic assembler path intact.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Claude approval / plan carrier 被误当普通 assistant 文本 | 重复卡片或正文噪音 | Treat carriers as structured facts; add replay fixtures |
| Gemini telemetry 粒度不足 | metadata 不完整 | Allow metadata degradation but require row convergence |
| Presentation throttle 改变语义 | reasoning/tool row 被误合并 | Keep profile outside normalization; assert cardinality |
| Codex baseline 被泛化误伤 | 已稳定路径回退 | Keep Codex tests in every gate |
