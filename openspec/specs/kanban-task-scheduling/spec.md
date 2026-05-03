# kanban-task-scheduling Specification

## Purpose
TBD - created by archiving change add-kanban-scheduled-and-chained-tasks. Update Purpose after archive.
## Requirements
### Requirement: Kanban Task SHALL Support Additive Scheduling Metadata

系统 MUST 允许 `todo` 状态 Kanban 任务保存可选调度元数据，并支持 `manual / once / recurring` 三种模式；缺失调度字段的存量任务 MUST 继续按普通任务处理。

#### Scenario: save one-time schedule for todo task
- **WHEN** 用户为 `todo` 任务保存“指定时间执行一次”
- **THEN** 系统 MUST 持久化 `once` 模式所需时间与 `nextRunAt`
- **AND** 任务当前状态 MUST 保持为 `todo`

#### Scenario: save recurring schedule with execution mode
- **WHEN** 用户为 `todo` 任务保存周期计划并选择执行方式（`same_thread` 或 `new_thread`）
- **THEN** 系统 MUST 持久化 `interval/unit/timezone/recurringExecutionMode`
- **AND** 若选择 `new_thread`，系统 MUST 持久化结果传递策略（`pass` 或 `none`）

#### Scenario: load legacy task without schedule metadata
- **WHEN** 系统读取不包含调度字段的旧任务
- **THEN** 系统 MUST 将其视为 `manual` 普通任务
- **AND** 用户 MUST 能继续执行既有创建、拖拽启动与会话查看操作

### Requirement: Scheduled Trigger SHALL Reuse Existing Background Execution Path

系统 MUST 在应用运行期间扫描到期任务，并复用既有 Kanban 执行路径后台启动任务，不得抢占当前用户 active thread。Scheduled execution MUST create a TaskRun with trigger `scheduled` and preserve the same non-reentrant active-run guard as manual execution.

#### Scenario: due one-time task starts in background
- **WHEN** 某 `todo` 任务 `nextRunAt` 到期且未在执行中
- **THEN** 系统 MUST 通过既有 thread 创建与首条消息链路启动任务
- **AND** 系统 MUST NOT 强制切换 active thread
- **AND** 系统 SHALL 创建 trigger 为 `scheduled` 的 TaskRun

#### Scenario: recurring same-thread task computes next cycle after completion
- **WHEN** recurring `same_thread` 任务本轮执行完成
- **THEN** 系统 MUST 在完成后计算并持久化下一次周期时间
- **AND** 系统 MUST NOT 在本轮触发后立即再次触发

#### Scenario: recurring new-thread task materializes next scheduled todo instance
- **WHEN** recurring `new_thread` 任务本轮执行完成且未达到轮次上限
- **THEN** 系统 MUST 将本轮实例移入审查/完成链路
- **AND** 系统 MUST 新建下一轮 `todo` 调度实例等待下次触发

#### Scenario: due task already running is not re-triggered
- **WHEN** 计划任务到期时任务已在 `inprogress`、已有 Kanban execution lock、已有 active TaskRun 或对应 thread 仍在 processing
- **THEN** 系统 MUST 跳过本次触发
- **AND** 系统 MUST 保持非重入（同窗口不得重复提交执行）

### Requirement: Scheduling SHALL Support Pause/Resume With Frozen Countdown

调度任务 MUST 支持暂停与恢复，并在暂停期间冻结倒计时。

#### Scenario: pausing schedule freezes remaining countdown
- **WHEN** 用户在待办中暂停周期调度任务
- **THEN** 系统 MUST 记录当前剩余时长
- **AND** 卡片倒计时 MUST 锁定为该剩余时长，不再递减

#### Scenario: resuming schedule restores nextRunAt from frozen remaining time
- **WHEN** 用户恢复已暂停的周期调度任务
- **THEN** 系统 MUST 以“当前时间 + 冻结剩余时长”重建 `nextRunAt`
- **AND** 倒计时 MUST 恢复递减

### Requirement: Scheduling SHALL Enforce Compatibility Guards And Missed-Run Policy

系统 MUST 对非法改配、离线错过窗口与无效规则提供确定性行为，且不得污染旧任务数据。

#### Scenario: editing non-todo task schedule is blocked
- **WHEN** 用户尝试为 `inprogress/testing/done` 任务新增或修改调度
- **THEN** 系统 MUST 阻止保存
- **AND** 系统 MUST 提示仅 `todo` 任务可配置调度

#### Scenario: missed one-time run is not replayed after app restart
- **WHEN** 单次任务计划时间发生在应用未运行期间
- **THEN** 应用恢复后系统 MUST NOT 自动补跑
- **AND** 任务 MUST 保持未开始，等待人工处理

#### Scenario: missed recurring windows collapse to next future occurrence
- **WHEN** 周期任务在离线期间错过一个或多个窗口
- **THEN** 应用恢复后系统 MUST 仅计算下一次未来触发时间
- **AND** 系统 MUST NOT 逐个回放错过窗口

#### Scenario: invalid scheduling rule is rejected before persistence
- **WHEN** 用户输入无法计算下一次触发时间的计划配置
- **THEN** 系统 MUST 拒绝保存该配置
- **AND** 系统 MUST 保持原有有效配置不变

### Requirement: Scheduled Task Card SHALL Expose Operable and Distinct Status Metadata

调度任务卡片 MUST 在不同列展示可操作且可区分的状态元信息，支持审查与回溯。

#### Scenario: scheduler badge follows column semantics
- **WHEN** 调度任务分别位于 `todo`、`inprogress`、`testing/done`
- **THEN** 系统 MUST 分别展示“调度器 / 执行中 / 已调度”语义标签

#### Scenario: execution timestamps are recorded on processing boundaries
- **WHEN** 任务进入 processing
- **THEN** 系统 MUST 写入开始时间
- **AND** **WHEN** 任务离开 processing
- **THEN** 系统 MUST 写入结束时间，并在 `testing/done` 卡片可见
