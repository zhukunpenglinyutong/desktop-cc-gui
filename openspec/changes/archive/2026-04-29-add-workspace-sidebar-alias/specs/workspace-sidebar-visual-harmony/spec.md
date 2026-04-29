## ADDED Requirements

### Requirement: Sidebar Workspace Label MUST Support Optional Alias

系统 MUST 允许 workspace 拥有一个仅用于左侧 sidebar 展示的可选别名。该别名 MUST NOT 改变 workspace identity、路径、session 归属、runtime 连接、排序、分组或非 sidebar surface 的项目名称。

#### Scenario: sidebar shows alias when configured

- **WHEN** workspace settings contain a non-empty `projectAlias`
- **THEN** the left sidebar workspace row MUST display that alias as the workspace label
- **AND** the row SHOULD show a compact visual cue indicating the label is an alias
- **AND** the cue SHOULD expose the original workspace name through accessible text or tooltip
- **AND** the underlying workspace name and path MUST remain unchanged

#### Scenario: sidebar falls back to workspace name when alias is empty

- **WHEN** workspace settings do not contain `projectAlias` or it is empty after trimming
- **THEN** the left sidebar workspace row MUST display the existing workspace name
- **AND** the row MUST NOT show the alias visual cue

#### Scenario: setting alias does not affect non-sidebar surfaces

- **WHEN** a workspace alias is configured
- **THEN** workspace home, settings project management, session attribution, sorting, grouping, and runtime behavior MUST continue to use the existing workspace identity fields
