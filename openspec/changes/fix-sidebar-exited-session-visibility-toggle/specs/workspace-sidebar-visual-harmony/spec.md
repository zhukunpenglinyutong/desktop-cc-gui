# workspace-sidebar-visual-harmony Specification Delta

## ADDED Requirements

### Requirement: exited session visibility toggle MUST be project-scoped and icon-level

系统 MUST 将 exited session visibility 视为 workspace/worktree row 级别的显示偏好，并在 leading icon 附近提供稳定的 icon-level affordance，而不是在 thread list 内渲染独立的常驻条带。

#### Scenario: workspace row exposes icon-level exited visibility toggle

- **GIVEN** 某 workspace 当前列表中存在至少一条 exited session
- **WHEN** 侧栏渲染该 workspace 行
- **THEN** 该 workspace 行 MUST 在 leading icon 附近提供 show/hide exited sessions 的 icon affordance
- **AND** 该 affordance MUST 与 folder / branch icon 保持并排或等效的非遮挡布局
- **AND** MUST NOT 视觉覆盖 leading icon 本体或挤压首个文本字符
- **AND** 该 affordance MUST 通过 i18n label 暴露可访问名称
- **AND** keyboard 激活该 affordance 时 MUST NOT 触发父级 row 的 collapse / expand 热键
- **AND** thread list 内 MUST NOT 再渲染同语义的常驻 pill bar

#### Scenario: worktree row uses an isolated exited visibility toggle

- **GIVEN** 某 worktree 当前列表中存在 exited session
- **WHEN** 用户切换该 worktree 的 exited visibility
- **THEN** 该偏好 MUST 只影响该 worktree 自身的 thread list
- **AND** MUST NOT 隐式影响 parent main workspace 或 sibling worktrees

#### Scenario: project-scoped preference persists by normalized workspace path

- **WHEN** 系统持久化某 workspace/worktree 的 exited visibility preference
- **THEN** identity MUST 基于规范化后的 workspace path
- **AND** MUST NOT 依赖可能变化的 runtime workspace id
- **AND** Windows 风格路径 MUST 使用大小写无关的 normalize 规则

#### Scenario: hidden exited sessions preserve running branch ancestry

- **GIVEN** 某 exited parent row 下仍存在 running 或 reviewing descendant
- **WHEN** 用户开启 hide exited sessions
- **THEN** 该 parent row MUST 保留可见，作为 descendant 的层级路径锚点
- **AND** 系统 MUST 只隐藏不再承载活跃 descendant 的 exited rows

#### Scenario: all exited rows hidden still leaves explicit recovery affordance

- **GIVEN** 某 workspace/worktree 当前列表中的 rows 全部为 exited sessions
- **WHEN** 用户开启 hide exited sessions
- **THEN** 该 row-level icon affordance MUST 继续可见并可恢复 show 状态
- **AND** thread list MUST 提供弱化的 hidden summary 或等效提示
- **AND** MUST NOT 留下无法解释的纯空白区域
