# Compatibility Gates

每个实现阶段必须引用本清单。若某项不适用，交付说明必须写明原因。

## Protocol Compatibility

- 不修改 Tauri command 名称、参数、返回 payload。
- 不修改 app-server event 名称、字段语义、provider runtime 输出协议。
- 不新增 frontend 直接 `invoke()` 调用。

## Conversation Semantics

- 保持 delta 原始顺序与 per-thread ordering。
- 保持 thread processing / terminal settlement / unread / activity 语义。
- 保持 message、reasoning、tool、generated-image、review row ordering。
- 保持 final Markdown output 与 history replay 结果一致。

## Rollback Compatibility

- `ccgui.perf.realtimeBatching=off` 必须恢复 baseline immediate path。
- `ccgui.perf.incrementalDerivation=off` 必须恢复 canonical derivation path。
- `ccgui.perf.reducerNoopGuard=off` 不得破坏最终语义。
- mitigation/profile rollback 不得关闭 diagnostics。

## UI / Composer Compatibility

- draft text、selection、IME composition、attachments、send payload 不得进入 deferred source-of-truth。
- 只允许 defer advisory live props：status、usage、rate limit、stream activity、live items。
- streaming completion 后 deferred advisory props 必须收敛到 canonical latest state。

## Diagnostics Compatibility

- diagnostics 必须 bounded。
- baseline presentation throttle 不得误记为 active mitigation。
- upstream pending、backend forwarding stall、reducer amplification、render amplification、visible output stall、composer responsiveness degradation 必须保持可区分。

## Test Gate

- 每个优化路径至少覆盖 enabled path、rollback/disabled path、ordering、interrupted thread 或 settlement/final convergence 中适用项。
- 修改大文件或高风险渲染链路时必须执行对应 focused tests；接近 large-file gate 时运行 `npm run check:large-files`。
