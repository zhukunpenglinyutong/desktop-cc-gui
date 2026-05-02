## MODIFIED Requirements

### Requirement: Session Management SHALL Be A Dedicated Settings Surface

系统 MUST 提供 `项目管理 -> 会话管理` 设置页 tab，用于治理 workspace 级真实会话历史，并能引导用户访问全局历史 / 归档中心。

#### Scenario: session management lives under project management tabs
- **WHEN** 用户浏览设置页左侧导航
- **THEN** 系统 MUST 显示 `项目管理` 父级入口
- **AND** 系统 MUST NOT 显示独立的 `会话管理` 一级入口

#### Scenario: dedicated session management links to global history center
- **WHEN** 用户进入 `项目管理 -> 会话管理`
- **THEN** 系统 MUST 提供进入全局历史 / 归档中心的明确入口
- **AND** 用户 MUST 能理解该入口用于查看不依赖当前 workspace strict 命中的历史
