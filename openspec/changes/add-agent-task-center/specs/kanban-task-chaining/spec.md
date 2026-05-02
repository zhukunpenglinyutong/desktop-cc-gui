## ADDED Requirements

### Requirement: Chained Continuation SHALL Materialize Downstream Runs Explicitly

系统 MUST 为链式任务的每次 downstream continuation 生成显式 run record，而不是只在上游任务上覆盖状态。

#### Scenario: upstream success creates downstream chained run

- **WHEN** 上游 task 成功并触发下游 task 自动续跑
- **THEN** 系统 SHALL 为下游创建新的 trigger=`chained` run
- **AND** 新 run SHALL 带上 upstream lineage metadata

#### Scenario: blocked downstream continuation remains diagnosable

- **WHEN** 下游 task 因缺少 snapshot、状态不满足或其他 guard 被阻断
- **THEN** 系统 SHALL 保留可诊断的 blocked continuation 结果
- **AND** SHALL NOT 把该阻断静默吞并到上游 run 状态里
