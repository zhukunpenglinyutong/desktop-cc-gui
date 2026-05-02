## ADDED Requirements

### Requirement: Scheduled Trigger SHALL Create A Task Run Record

系统 MUST 在 scheduled trigger 真正进入执行前，为该次执行创建独立 task run record。

#### Scenario: due scheduled task creates scheduled run before execution

- **WHEN** 某个已到期的 scheduled task 即将启动执行
- **THEN** 系统 SHALL 先创建 trigger=`scheduled` 的 run record
- **AND** Kanban task 的最近执行摘要 SHALL 回填该 run 的基础信息

#### Scenario: skipped scheduled trigger does not create fake successful run

- **WHEN** 周期触发因已有执行中 run 而被跳过
- **THEN** 系统 SHALL NOT 伪造新的 successful run
- **AND** 阻断原因 SHALL 继续保留在可诊断执行态中
