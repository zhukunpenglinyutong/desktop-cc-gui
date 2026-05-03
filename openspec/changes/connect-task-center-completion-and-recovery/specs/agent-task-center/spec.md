## MODIFIED Requirements

### Requirement: Task Center SHALL Provide Bounded Recovery And Navigation Actions

Task Center MUST 在 run 级别提供有边界的恢复与跳转动作，并且这些动作必须接到现有 control path，而不是只停留在 UI 展示层。

#### Scenario: workspace task center routes open conversation through existing thread selection

- **WHEN** 某次 run 已绑定 conversation thread
- **THEN** 用户 SHALL 能从 Workspace Home 内的 Task Center 直接打开对应 conversation
- **AND** 该跳转 SHALL NOT 改写 run 自身状态

#### Scenario: retry and fork create successor execution through existing kanban launch path

- **WHEN** 用户对 settled run 发起 `retry` 或 `fork new run`
- **THEN** 系统 SHALL 复用既有 Kanban execution launch path 创建新的 execution attempt
- **AND** successor run SHALL 保留 parent lineage 或 fork trigger

#### Scenario: unsupported cancel path is explicitly bounded

- **WHEN** 当前 runtime control path 无法安全取消某条未激活 thread 的 run
- **THEN** Task Center SHALL 禁用该 `cancel` 动作或显式降级
- **AND** UI SHALL NOT 伪装为已成功取消
