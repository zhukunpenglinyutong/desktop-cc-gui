## MODIFIED Requirements

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
