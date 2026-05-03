## MODIFIED Requirements

### Requirement: Runtime Execution Telemetry SHALL Be Projectable Into Task Runs

Runtime Orchestrator MUST 能把 thread/runtime 侧执行信号继续投影为 task-run settled telemetry，而不引入新的 backend truth source。

#### Scenario: processing completion settles active task run

- **WHEN** 某条已绑定 thread 的 active TaskRun 经过 `threadStatusById` 观察到 processing 结束
- **AND** 该 run 之前处于 `planning`、`running` 或 `waiting_input`
- **THEN** 系统 SHALL 将该 run 收敛到合适的 settled state
- **AND** latest output summary、diagnostics 与 artifacts SHALL 从现有 thread timeline observable data 中提取

#### Scenario: task run telemetry remains frontend-first projection

- **WHEN** Task Center 更新 run 的 completion、diagnostics 或 artifact summary
- **THEN** 系统 SHALL 继续基于 frontend 可观察状态 patch 既有 TaskRun store
- **AND** 该更新 SHALL NOT require a new Tauri command or Rust runtime store
