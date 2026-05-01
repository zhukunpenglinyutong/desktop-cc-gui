# conversation-curtain-normalization-core Specification Delta

## MODIFIED Requirements

### Requirement: User Bubble Equivalence MUST Canonicalize Source-Specific Wrappers

conversation curtain 对 user bubble 的等价判断 MUST 去除 source-specific wrapper 差异，例如 injected context、selected-agent prompt block、shared-session sync wrapper 或等价 display-only 包装；其中 `project-memory` injected wrapper MUST 支持带 attributes 的 XML 前缀格式，而不只识别裸标签。

#### Scenario: authoritative user message replaces optimistic bubble despite wrapper drift

- **WHEN** 本地 optimistic user bubble 与 authoritative user payload 的原始文本形态不完全一致
- **AND** 差异仅来自 injected wrapper、selected-agent block 或等价 source-specific 包装
- **THEN** 系统 MUST 将 authoritative user payload 视为该 optimistic bubble 的 canonical replacement
- **AND** 系统 MUST NOT 保留两条并列 user bubble

#### Scenario: attributed project-memory wrapper still converges to one user bubble

- **WHEN** authoritative user payload 以前置 `<project-memory source=\"manual-selection\" ...>` wrapper 返回
- **AND** 本地 optimistic user bubble 只显示真实用户输入文本
- **THEN** 系统 MUST 继续将两者判定为同一条 user observation
- **AND** realtime/history reconcile MUST NOT 形成额外 user row

#### Scenario: unmatched real user message does not collapse unrelated optimistic bubble

- **WHEN** incoming real user message 与现有 optimistic user bubble 在 normalization 后仍不等价
- **THEN** 系统 MUST 保留两条独立 user message
- **AND** MUST NOT 因过宽判定误删除另一条真实用户输入

## ADDED Requirements

### Requirement: User Attachment Filtering MUST Preserve Ordinary Images

conversation curtain 在为 note-card context 做图片去重时 MUST 仅 suppress 已被证明属于 injected note-card attachment 的图片；普通用户截图或其他非 note-card 附件 MUST 在 realtime 与 history hydrate 路径中继续可见。

#### Scenario: note-card filtering removes only matching injected attachments

- **WHEN** 用户消息包含可解析的 `<note-card-context>` injected attachment 列表
- **THEN** 系统 MAY 从普通用户图片网格中移除这些 matching attachment identities 以避免双显
- **AND** 不匹配该 injected attachment 列表的普通图片 MUST 继续显示

#### Scenario: history hydrate preserves ordinary user screenshots

- **WHEN** 用户重新打开历史会话
- **AND** 某条用户消息携带普通截图图片
- **AND** 该消息不存在可匹配的 note-card injected attachment identity
- **THEN** 历史幕布 MUST 继续渲染这些用户截图缩略图
- **AND** 系统 MUST NOT 仅因当前 render path 支持 note-card 去重就隐藏它们
