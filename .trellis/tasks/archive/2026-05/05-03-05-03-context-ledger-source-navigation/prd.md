# Execute Context Ledger Source Navigation

## Goal

把 `Context Ledger` 从“只能解释来源”推进到“可以直接回到来源继续治理”，补齐最小来源闭环。

## Requirements

- `manual_memory` 支持从 ledger 直接打开 `memory` 面板并选中对应记录。
- `note_card` 支持从 ledger 直接打开 `notes` 面板并选中对应便签。
- `file_reference` 支持从 ledger 直接复用现有文件打开链路。
- 原有 `source detail` inspection dialog 保持可用。

## Acceptance Criteria

- [x] ledger block 为 `manual_memory` 时，可从来源动作回到 Project Memory。
- [x] ledger block 为 `note_card` 时，可从来源动作回到 Workspace Notes。
- [x] ledger block 为 `file_reference` 时，可从来源动作打开对应文件。
- [x] focused tests 与静态门禁通过。

## Technical Notes

- 来源导航 intent 由 `ContextLedgerPanel` 发出，`Composer` 负责路由。
- AppShell 负责 `memory` / `notes` 的 panel-open 与 focus state。
- 继续复用现有文件打开链路，不新增 backend contract。
