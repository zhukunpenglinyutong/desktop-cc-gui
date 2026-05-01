# project-memory-ui Specification Delta

## MODIFIED Requirements

### Requirement: 历史会话记忆摘要兼容展示

系统 MUST 将旧格式记忆注入前缀统一渲染为“记忆上下文摘要”卡片，保证历史与实时样式一致；当同一轮已经存在 assistant 侧 memory summary item 时，系统 MUST 避免在 user bubble 中重复渲染第二张等价摘要卡片。

#### Scenario: 兼容旧用户注入前缀

- **WHEN** 用户消息以旧前缀开头（如 `[对话记录] ... 用户输入/助手输出摘要/助手输出 ...`）
- **THEN** 系统 SHALL 将该前缀内容解析为摘要卡片
- **AND** 消息正文 SHALL 仅展示真实用户输入文本

#### Scenario: 兼容 XML 注入前缀

- **WHEN** 用户消息包含前置 `<project-memory ...>...</project-memory>` 注入块
- **THEN** 系统 SHALL 将注入块内容映射为摘要卡片
- **AND** 注入块后续正文 SHALL 按普通用户消息渲染

#### Scenario: 同一轮 realtime summary 不重复渲染

- **WHEN** Codex 发送链已经为本轮插入一条 assistant `记忆上下文摘要` 卡片
- **AND** 稍后 authoritative user message 仍携带等价的 injected memory wrapper
- **THEN** 幕布 SHALL 只渲染一张等价 `记忆上下文摘要` 卡片
- **AND** user bubble SHALL 仅显示真实用户输入文本

#### Scenario: 仅助手摘要消息隐藏复制按钮

- **WHEN** 助手消息仅包含摘要卡片且无正文
- **THEN** 系统 SHALL 隐藏正文复制按钮
- **AND** 用户消息即使带摘要卡片也 SHALL 保持原有复制行为
