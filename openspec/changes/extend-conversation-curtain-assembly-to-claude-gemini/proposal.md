## Why

`Codex` 幕布已经通过 normalization core 与 `ConversationAssembler` 收口了 realtime / history 的重复与回放漂移，但 `Claude Code` 与 `Gemini` 仍主要停留在 engine-specific adapter / loader / render pacing 的局部治理。现在继续推进的价值不是再修单个重复 bubble，而是把“引擎事件 -> normalized observation -> assembler -> presentation profile -> streaming render”固化成跨引擎主链路。

## What Changes

- 将 conversation curtain normalization / assembly 从 `Codex-first` 扩展为 `Codex / Claude Code / Gemini` 共享 contract。
- 让 `Claude Code` realtime adapter 与 history loader 输出可被 `ConversationAssembler` 消费的 normalized observations，覆盖 assistant text、reasoning、tool snapshots、approval / plan 卡片与 history replay。
- 让 `Gemini` realtime adapter 与 history loader 复用同一 assembly boundary，优先收敛 assistant text、reasoning merge、tool snapshots 与 history hydrate cardinality。
- 引入 engine-aware baseline presentation profile，统一管理 Markdown throttle、staged reveal、reasoning render pacing、waiting / ingress 可见性，而不是在 `Messages` 里继续追加 Codex-only 或 provider-only 分支。
- 保留 provider-scoped stream mitigation 作为 evidence-triggered recovery lane；baseline presentation profile 与 mitigation profile MUST 是两层配置，不能把正常 Claude/Gemini 默认流式体验伪装成异常缓解路径。
- 保留 `Codex` 现有稳定语义作为 baseline；本 change 不重新设计 Codex payload，不改 Rust / Tauri command contract，不引入新的持久化 schema。
- 允许 Claude / Gemini 接入期间保留 bounded feature flag / fallback，但目标路径必须是 shared normalization + shared assembler，而不是新增两套引擎专属幕布。

## 目标与边界

### 目标

- 目标 1：让 `Claude Code` 与 `Gemini` 在 realtime 与 history hydrate 之间使用同一套 semantic convergence 规则，减少重复 assistant、reasoning 抖动、tool/history replay 不一致。
- 目标 2：让流式输出体验从“局部 throttle 补丁”升级为 engine-aware presentation profile，覆盖长 Markdown、reasoning、tool output 与等待态。
- 目标 3：把 `Codex` 已验证的 normalization / assembler 经验沉淀为 engine-neutral contract，后续 `OpenCode` 或新引擎接入也按同一边界扩展。

### 边界

- 本 change 只处理 frontend conversation curtain 的 normalization、assembly、history/realtime convergence 与 streaming presentation。
- 本 change 不改变 Claude / Gemini runtime provider 协议，不改 Tauri command 字段，不新增后端存储迁移。
- 本 change 不重做消息幕布视觉设计；只允许为 streaming profile 增加必要 class / render cadence 调整。
- 本 change 不把 `claude-code-mode-progressive-rollout` 中的 approval / access mode 语义迁入当前提案；只消费其已经形成的 conversation-visible items。

## 非目标

- 不一次性迁移所有 legacy reducer action。
- 不重构 Claude 原生命令审批、Gemini runtime telemetry 或 Task Center run lifecycle。
- 不改变 `Codex` 已有 idempotency、queued handoff、image generation、staged markdown 的用户可见语义。
- 不通过“关闭 history reconcile”或“关闭 streaming markdown”规避问题。
- 不引入新的三引擎专属 `Messages` 分叉组件。

## 技术方案对比

| 方案 | 描述 | 优点 | 风险 / 成本 | 结论 |
|---|---|---|---|---|
| A | 分别为 Claude / Gemini 追加 adapter、loader、Messages 局部 dedupe 补丁 | 短期改动小 | 继续制造规则漂移；history/realtime 一致性无法系统验证；后续每个引擎都要重复修 | 不采用 |
| B | 一次性把所有引擎所有 realtime action 全量切到 assembler | 架构最干净 | blast radius 过大，Claude approval / Gemini telemetry 边界容易被误伤 | 不采用 |
| C | 以 shared normalization + assembler 为目标，分阶段接入 Claude/Gemini 主路径，并保留 bounded fallback | 能复用 Codex 已验证经验；风险可控；验证矩阵清晰 | 需要补齐跨引擎 parity tests 和 profile 边界 | **采用** |

## Capabilities

### New Capabilities

- 无。当前工作应扩展既有 conversation curtain capabilities，避免为了一次迁移制造新命名空间。

### Modified Capabilities

- `conversation-curtain-normalization-core`: 从 Codex-first normalization 扩展为 `Codex / Claude Code / Gemini` 共享 semantic equivalence contract。
- `conversation-curtain-assembly-core`: 扩展 `ConversationAssembler` 的主链职责，要求 Claude / Gemini realtime 与 history hydrate 也进入 shared assembly boundary。
- `conversation-lifecycle-contract`: 明确 Claude / Gemini post-turn history reconcile 与 history reopen 只能做 validation / backfill，不得成为 primary duplicate repair。
- `conversation-provider-stream-mitigation`: 明确 provider-scoped mitigation 只负责 evidence-triggered recovery，同时允许其消费 baseline presentation profile；Claude / Gemini 的正常 Markdown、reasoning、waiting/ingress cadence MUST 先归属 baseline presentation profile。

## Impact

- Frontend adapters / loaders:
  - `src/features/threads/adapters/claudeRealtimeAdapter.ts`
  - `src/features/threads/adapters/geminiRealtimeAdapter.ts`
  - `src/features/threads/loaders/claudeHistoryLoader.ts`
  - `src/features/threads/loaders/geminiHistoryLoader.ts`
  - `src/features/threads/loaders/geminiHistoryParser.ts`
- Assembly / normalization:
  - `src/features/threads/assembly/conversationAssembler.ts`
  - `src/features/threads/assembly/conversationNormalization.ts`
  - `src/features/threads/hooks/useThreadsReducer.ts`
- Presentation / render pacing:
  - `src/features/messages/presentation/*`
  - `src/features/messages/components/MessagesRows.tsx`
  - `src/features/messages/components/messagesReasoning.ts`
  - `src/features/threads/utils/streamLatencyDiagnostics.ts`
- Tests:
  - realtime adapter parity tests
  - history loader parity tests
  - assembler cardinality tests
  - Messages streaming throttle / staged render tests
  - Claude approval / ExitPlanMode history replay smoke
  - Gemini reasoning / tool snapshot history replay smoke

## 验收标准

1. `Claude Code` realtime 与 history hydrate 对等价 assistant / reasoning / tool / approval / plan observations MUST 收敛为稳定 visible rows，不得因 history replay 新增主体重复行。
2. `Gemini` realtime 与 history hydrate 对等价 assistant / reasoning / tool observations MUST 使用 shared normalization / assembler 收敛，visible row cardinality 在等价 replay 下保持稳定。
3. `ConversationAssembler` MUST 不再只声明服务 Codex；Claude / Gemini 主路径接入后，不得在 reducer / loader 中维护第二套 user / assistant / reasoning comparator；tool convergence MUST 使用共享 structured identity / status reconciliation，而不是 loader-local duplicate policy。
4. Claude / Gemini streaming Markdown 与 reasoning render cadence MUST 通过 engine-aware profile 或 provider-scoped mitigation 管理，且不破坏 ordering、terminal lifecycle、waiting/ingress visibility。
5. Codex existing convergence tests MUST 继续通过，证明扩展没有回退 Codex baseline。
