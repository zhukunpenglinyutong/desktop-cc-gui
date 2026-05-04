## Why

Codex / Claude Code 是本轮实时对话性能优化的主目标，因为两者覆盖最重的本地工具输出、reasoning 与长 Markdown 幕布渲染路径。Gemini 纳入同一兼容矩阵，但定位是“不能绕过共享性能防线、不能被主路径优化反向破坏”，不是本轮专场。三引擎共享同一条客户端热路径：event listener -> batching -> reducer -> message render -> Markdown/scroll -> composer。当前仓库已经有实时 CPU、渲染稳定性、provider mitigation 与 latency diagnostics 的基础规范，但代码事实显示三引擎仍存在性能契约不一致：Gemini assistant delta 绕过 realtime batching，reasoning/tool delta 仍高频触发完整 `prepareThreadItems(...)`，render diagnostics 与 presentation profile 对三引擎的覆盖不完全。

本提案不是 Gemini 专场清理，而是以 Codex / Claude Code 为主链路，补齐三引擎实时输出的统一性能契约。Gemini 是兼容性切口，因为它目前更容易绕过既有 batching 防线；Claude/Codex 是性能收益主线，必须纳入 reducer fast path、render cadence、diagnostics 与 composer responsiveness 的统一验收。

## 目标与边界

- 建立以 Codex / Claude Code 为主优化对象、Gemini 为兼容验证对象的 realtime client performance contract。
- 把高频 assistant/reasoning/tool deltas 纳入可观测、可回滚的 batching/coalescing 与 reducer incremental derivation 路径。
- 保持最终会话语义不变：delta 顺序、terminal lifecycle、幕布最终 Markdown、tool/reasoning 行顺序不得因优化改变。
- 优先优化客户端热路径，不把 upstream provider 首包慢、后端 forwarding stall 与 frontend render amplification 混为一谈。

## 非目标

- 不重构 provider 协议或 Tauri command payload。
- 不把 Gemini 特判做成长期专属路径。
- 不改变 conversation curtain assembly 的产品语义、历史回放格式或最终消息结构。
- 不引入新的全局 state framework。

## 兼容性规则

- **协议兼容**：不得修改 Tauri command 名称、event 名称、runtime payload 字段语义或 provider 输出协议；如实现中发现必须改 contract，必须先拆出独立 OpenSpec change。
- **语义兼容**：优化前后必须保持 delta 接收顺序、thread lifecycle、terminal settlement、tool/reasoning/message row ordering、final Markdown output 与历史回放结果一致。
- **回滚兼容**：每一层优化必须可独立关闭，至少覆盖 batching、incremental derivation、reducer no-op、render mitigation/profile override；关闭后必须回到 baseline-compatible path。
- **测试兼容**：任何从“立即 dispatch”改为“batch/transition/defer”的路径，都必须补 flush-on-unmount、interrupted thread、rollback flag、ordering 与 final convergence 测试。
- **UI 兼容**：composer 的 draft text、selection、IME composition、attachments、send payload 不得进入 deferred source-of-truth；只允许 defer status、usage、rate limit、stream activity 等 advisory props。
- **诊断兼容**：新增 diagnostics 必须 bounded，不得因长会话无限增长；不得把 baseline presentation throttle 误记为 active mitigation。
- **文件治理兼容**：触及大文件或高风险渲染链路时必须遵守 large-file gate；不得借性能优化夹带无关 UI、文案、样式或 provider 行为变更。

## 门禁规则

- **入口门禁**：实现前必须先让相关 focused tests 表达目标行为，包括 Gemini batching、reasoning/tool reducer fast path、visible text diagnostics、composer isolation。
- **分层门禁**：每个阶段只能修改对应层；event batching、reducer fast path、render profile、composer isolation、diagnostics 不得在同一小步中无边界混改。
- **性能门禁**：新增优化必须证明减少 dispatch、`prepareThreadItems(...)` 调用、Markdown/render amplification 或 composer update pressure 中至少一项；否则不得以“可能更快”为理由合入。
- **回归门禁**：Codex / Claude Code / Gemini 至少各覆盖一条 realtime streaming 验证路径；Gemini 修复不能破坏 Claude/Codex baseline，Claude/Codex 优化不能反向扩大 Gemini 特判。
- **质量门禁**：实现完成后必须通过 OpenSpec strict validation、focused Vitest、`npm run typecheck`、`npm run lint`；若修改大文件或样式，必须补跑 `npm run check:large-files`。
- **人工门禁**：归档前必须提供并执行手测矩阵，覆盖长 Markdown、reasoning、tool output、输入框打字/IME、stop/terminal、rollback flags。

## What Changes

- 扩展 realtime event batching 契约，使 Gemini assistant delta 与可安全合并的 normalized realtime assistant events 不再无条件绕过 batching。
- 为 assistant/reasoning/tool 高频 delta 增加 reducer fast path 要求，避免每个 chunk 都执行完整 `prepareThreadItems(...)`。
- 补齐三引擎 baseline presentation profile 与 evidence-triggered mitigation 的边界，确保 throttle 是基线节奏，不被误记为 mitigation。
- 扩展 stream latency diagnostics，记录 batching flush、reducer derivation cost、visible text growth 与 composer responsiveness 的关联证据。
- 明确 composer 在 streaming 压力下只能 defer advisory live props，不能 defer draft text、selection、IME composition 或 send-critical payload。
- 增加可回滚控制：batching、incremental derivation、render profile/mitigation、diagnostics 需要独立开关或安全降级。

## 技术方案选项

### 选项 A：Gemini 专项修复

- 修改 `useThreadItemEvents`，移除 Gemini agent delta 的 batching bypass。
- 补一组 Gemini 测试，快速降低已知卡顿概率。
- 取舍：交付快，但不能处理 Claude/Codex 的 reasoning/tool 高频派生，也会继续让性能契约按 provider 漂移。

### 选项 B：三引擎统一性能契约

- 在既有 `conversation-realtime-cpu-stability`、`conversation-provider-stream-mitigation`、`conversation-render-surface-stability`、`conversation-stream-latency-diagnostics` 上做增量。
- 先补 instrumentation 与测试，再逐步收敛 batching、reducer fast path、render cadence 与 composer isolation。
- 取舍：范围更大，但能避免“修完 Gemini，Claude/Codex 下次以另一个形态复发”。

选择 B。原因是当前源码已经证明问题跨越 event/reducer/render/composer 多层，单点 Gemini 修复会掩盖系统性不一致。

## Capabilities

### New Capabilities

- `conversation-realtime-client-performance`: 定义三引擎实时对话客户端性能预算、可观测性、回滚与验收矩阵。

### Modified Capabilities

- `conversation-realtime-cpu-stability`: 扩展 batching 与 incremental derivation 到 Gemini assistant delta、reasoning delta 与 tool output delta 的安全路径。
- `conversation-provider-stream-mitigation`: 明确 baseline presentation profile 与 evidence-triggered mitigation 的区分，覆盖 Claude/Gemini/Codex 的正常节奏。
- `conversation-render-surface-stability`: 扩展 live render surface 在三引擎 streaming 下的 progressive visibility 与 final Markdown convergence。
- `conversation-stream-latency-diagnostics`: 增加 reducer/render/composer 侧性能证据，避免误判 provider 慢或 backend stall。

## Impact

- Frontend event path: `src/services/events.ts`, `src/features/app/hooks/useAppServerEvents.ts`, `src/features/threads/hooks/useThreadItemEvents.ts`
- Reducer path: `src/features/threads/hooks/useThreadsReducer.ts`, `src/features/threads/hooks/threadReducerNormalizedRealtime.ts`, `src/utils/threadItems.ts`
- Render path: `src/features/messages/components/Messages.tsx`, `MessagesTimeline.tsx`, `MessagesRows.tsx`, `Markdown.tsx`, `messagesRenderUtils.ts`
- Composer path: `src/features/layout/hooks/useLayoutNodes.tsx`, `src/features/composer/components/Composer.tsx`, `ChatInputBoxAdapter.tsx`
- Diagnostics/profile: `src/features/threads/utils/realtimePerfFlags.ts`, `streamLatencyDiagnostics.ts`, `src/features/messages/presentation/presentationProfile.ts`
- Tests: focused Vitest suites under `src/features/threads/hooks`, `src/features/messages/components`, `src/features/composer/components`, and `src/features/threads/utils`

## 验收标准

- Codex / Claude Code 的 reasoning/tool 长流式输出优先降低 per-chunk reducer 派生与 render amplification。
- Gemini assistant delta 在 realtime batching 开启时不再立即放大 dispatch/render，但仍保持顺序、flush-on-unmount 与 interrupted thread guard。
- Claude/Codex/Gemini 的 safe reasoning/tool 高频 delta 在安全条件下不会每个 chunk 都触发完整 `prepareThreadItems(...)`。
- streaming 期间可见 assistant text 单调增长或产生明确 visible-stall diagnostics；completion 后回到最终 Markdown 语义。
- composer 输入在 streaming 期间保持本地输入、selection、IME、attachments 与 send payload 即时，不被幕布 live objects 反向拖慢。
- diagnostics 能区分 upstream pending、backend forwarder stall、frontend render amplification、visible output stall、composer responsiveness degradation。
- 所有优化路径具备 rollback flag 或等价降级路径，关闭后语义回到现有 baseline。
