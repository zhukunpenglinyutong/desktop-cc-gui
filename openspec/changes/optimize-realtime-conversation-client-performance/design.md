## Context

当前实时对话客户端热路径跨越五层。本轮主优化对象是 Codex / Claude Code 的长 Markdown、reasoning 与 tool output 实时幕布输出；Gemini 纳入统一 contract，是为了防止 provider 分支绕过共享性能防线，并作为兼容性与回归门禁的一部分。

1. Tauri/app-server event 进入 `src/services/events.ts` 与 `useAppServerEvents`。
2. `useThreadItemEvents` 将 assistant/reasoning/tool delta 转成 reducer action，并已有 12ms micro-batching。
3. `useThreadsReducer` 与 `threadReducerNormalizedRealtime` 更新 `itemsByThread`，部分路径已启用 no-op guard 与 incremental derivation。
4. `Messages -> MessagesTimeline -> MessagesRows -> Markdown` 做 live tail、presentation profile、visible text diagnostics 与 Markdown throttle。
5. `useLayoutNodes -> Composer -> ChatInputBoxAdapter` 使用 deferred live inputs 与 memo comparator，保护输入框。

源码事实：

- Gemini assistant delta 当前在 `enqueueRealtimeDeltaOperation` 中明确绕过 batching；测试也锁定了该行为。
- Claude live assistant delta 已有 fast path，但限定 `threadId.startsWith("claude:")`，Gemini/Codex equivalent live assistant delta 仍更容易回到完整 `prepareThreadItems(...)`。
- reasoning summary/content 与 tool output delta 对每个有效 chunk 都执行 `prepareThreadItems(...)`，这是完整 normalize/coalesce/filter/anchor/summarize/truncate 管线。
- normalized realtime batching 目前只覆盖 Codex assistant `itemStarted/itemUpdated`，安全规则绑定 engine 而不是操作语义。
- render/composer 侧已有防线，但 diagnostics 与 profile 需要更明确地区分 baseline cadence、active mitigation、visible growth 与 input responsiveness。

## Goals / Non-Goals

**Goals:**

- 统一以 Codex / Claude Code 为主、Gemini 为兼容验证对象的 realtime client performance contract。
- 降低高频 delta 对 dispatch、reducer、render、Markdown、composer 的放大效应。
- 保持会话语义不变，并让每层优化都有 rollback 与 diagnostics。
- 先用测试锁住“顺序不变、最终输出不变、可见输出不退化、输入不被拖慢”，再实现优化。

**Non-Goals:**

- 不改变 Tauri command payload 或 provider runtime protocol。
- 不做 Gemini 专属长期分支，也不把 Gemini 兼容修复扩大成本轮唯一目标。
- 不改写 conversation curtain assembly 的最终数据模型。
- 不引入 Redux/Zustand 或新的全局状态框架。

## Decisions

### Decision 1: 以语义安全条件扩展 batching，而不是按 provider 特判

方案 A：只删除 Gemini batching bypass。

方案 B：把 batching eligibility 改为基于 operation/item 语义，例如 assistant text delta、same-item snapshot、可保序的 flush window。

选择 B，但第一步落点包括删除 Gemini assistant delta bypass。这样既解决已知 Gemini 缺口，也避免未来 Claude/Gemini normalized event 继续因为 engine gate 被排除。

### Decision 2: reducer fast path 分层推进

方案 A：让所有 delta 都跳过 `prepareThreadItems(...)`。

方案 B：仅在“同一 live item、无结构变化、无 canonicalization/truncation/anchor 影响”的条件下增量更新；completion、插入、id 迁移、tool truncation 边界仍回 canonical path。

选择 B。`prepareThreadItems(...)` 承载 dedupe、generated image anchor、ask-user normalization、explore summary、tool truncation，不能粗暴绕过。

### Decision 3: baseline profile 与 mitigation profile 分离

方案 A：把更高 throttle 都当 mitigation。

方案 B：Codex/Claude/Gemini 各自有 baseline presentation profile；只有 visible stall、render lag、provider/platform evidence 触发 override 时才记录 mitigation。

选择 B。这样性能优化不会污染故障诊断，也不会把正常 throttle 误报成异常恢复。

### Decision 4: composer 只隔离 advisory live props

方案 A：把整个 Composer 或 input value 放入 deferred path。

方案 B：只 defer stream-facing advisory props，例如 items、status、context usage、rate limits；draft text、selection、IME、attachments、send payload 保持 local/canonical。

选择 B。输入框卡顿是要解决的问题，不应通过延迟用户输入本身来伪装顺滑。

## Implementation Sketch

```text
event ingress
  -> classify operation safety
  -> enqueue batch if safe
  -> flush preserving per-thread order
  -> reducer fast path if same live item and no structural boundary
  -> canonical prepareThreadItems on boundary
  -> presentation profile determines baseline throttle
  -> mitigation only when diagnostics evidence activates
  -> composer consumes deferred advisory props only
```

## Compatibility And Gates

Compatibility rules:

- Keep runtime/provider contracts stable. No Tauri command, event, or payload semantic change belongs in this change.
- Preserve final conversation semantics. Optimizations may change cadence, not ordering, lifecycle, row semantics, final Markdown, or replay output.
- Keep rollback layered. `realtimeBatching`, `incrementalDerivation`, reducer no-op, and mitigation/profile overrides must be independently reversible.
- Keep composer source-of-truth local/canonical. Only advisory live props may be deferred.
- Keep diagnostics bounded and comparable across baseline and optimized paths.

Implementation gates:

- Add or update focused tests before changing each hot path.
- Implement one layer at a time: event batching, reducer fast path, render/profile, composer isolation, diagnostics.
- For every optimized path, include tests for enabled path, disabled flag path, ordering, interruption, flush/settlement, and final convergence where applicable.
- Do not merge a performance change that lacks observable evidence of reduced dispatch, derivation, render/Markdown work, or composer update pressure.
- Run OpenSpec validation and frontend quality gates before considering the change complete.

## Risks / Trade-offs

- [Risk] batching/coalescing 错误合并非等价事件 -> Mitigation: 只 coalesce snapshot-equivalent assistant updates；completion/tool/user/generated-image/review events 保留完整顺序。
- [Risk] reducer fast path 绕过 canonical normalization 导致历史最终态漂移 -> Mitigation: fast path 只用于已有 live item 文本更新；completion 与结构边界强制回 canonical path，并用 `prepareThreadItems` call-count 测试验证。
- [Risk] 更强 throttle 让用户误以为没有输出 -> Mitigation: visible text growth diagnostics、working indicator、waiting/ingress/stop affordance 必须保留。
- [Risk] diagnostics 自身增加开销 -> Mitigation: bounded samples、按 thread/turn 聚合、默认只记录摘要。
- [Risk] composer 优化误伤 send payload -> Mitigation: 测试覆盖 typing/IME/attachment/send-critical props 不进入 deferred source-of-truth。

## Migration Plan

1. 补测试和 diagnostics 基线：Codex / Claude Code reasoning/tool reducer cost、Gemini batching 兼容、render visible text、composer advisory prop isolation。
2. 扩展 event batching：移除 Gemini assistant delta bypass；把 normalized assistant snapshot batching 从 Codex-only 改成语义安全判断。
3. 扩展 reducer fast path：reasoning 与 tool output 的 same-item delta 先走增量路径，边界回 canonical。
4. 调整 presentation/diagnostics：明确 baseline profile 与 mitigation activation 记录。
5. 跑 focused tests、`npm run typecheck`、`npm run lint`、必要时 `npm run check:large-files`。

Rollback:

- 保留并复用 `ccgui.perf.realtimeBatching`、`ccgui.perf.incrementalDerivation`、`ccgui.perf.reducerNoopGuard` 等开关。
- 新增 profile 或 diagnostics 行为若出问题，应能单独禁用对应 layer，不影响事件最终处理。

## Open Questions

- 是否需要为 diagnostics 新增显式 composer responsiveness metric，还是先通过 render/reducer pressure 与人工测试矩阵覆盖。
- tool output truncation 边界是否需要引入轻量阈值检测，还是第一阶段只对不会触发 truncation 的近期 running tool item 使用 fast path。
- Codex assistant delta legacy/canonical id 场景是否能安全扩展当前 Claude-only fast path，还是先保留现状，避免 assistant id canonicalization 与 final metadata guard 被性能优化误伤。

## Interim Implementation Notes

- `appendAgentDelta` fast path 暂不扩大到 Codex legacy/canonical id 场景。该路径涉及 `findEquivalentCodexAssistantMessageIndex`、legacy text-delta reconciliation、final metadata guard 与 thread rename，风险高于本轮收益。
- Gemini assistant 的首轮收益只落在 event batching 与 normalized assistant snapshot coalescing，避免在同一阶段叠加 assistant id canonicalization 改动。
- Codex / Claude Code 是本轮人工验证与后续优化优先级更高的主链路；Gemini 只要求兼容、可观测、可回滚。
- reasoning/tool fast path 只覆盖已存在 same-item live update；新插入、completion、placeholder、结构边界仍回 canonical `prepareThreadItems(...)`。
