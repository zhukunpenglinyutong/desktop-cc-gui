# Execute Context Ledger Phase 3

## Goal

把 `Context Ledger` 从“当前态账本”推进到“变化账本”，优先补齐：

- send 前后 diff
- compaction explainability

## Requirements

- 发送后需要看到最近一次发送基线与当前账本的变化摘要。
- compaction 后需要看到相对压缩前快照的变化解释。
- 不新增 backend contract，不改变现有发送协议。
- 继续遵守 composer shared usage source 与 i18n 规范。

## Acceptance Criteria

- [ ] send 后若账本有变化，面板能展示 added / removed / retained / changed 摘要。
- [ ] usage-only 当前态下，只要 recent comparison 仍存在，面板仍可见。
- [ ] compaction 完成后可看到相对 pre-compaction baseline 的变化说明。
- [ ] focused tests 与门禁命令通过。

## Technical Notes

- comparison 应作为独立 model，不污染当前 `ContextLedgerProjection` groups 语义。
- Composer 负责记录 `last send baseline` 与 `pre-compaction baseline`。
