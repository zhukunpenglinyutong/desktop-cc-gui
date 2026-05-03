## MODIFIED Requirements

### Requirement: Runtime Execution Telemetry SHALL Be Projectable Into Task Runs

Runtime Orchestrator MUST 能把 thread/runtime 侧执行信号投影为 task-run telemetry，而不成为第二套 task truth source。Kanban execution launch path MUST use existing runtime control paths while recording TaskRun lifecycle boundaries.

#### Scenario: task center consumes runtime execution phases as run projection

- **WHEN** runtime / thread 发出 planning、running、waiting-input、failure 或 completion 相关信号
- **THEN** 系统 SHALL 能将这些信号归一化投影到 task run lifecycle
- **AND** runtime orchestrator 本身 SHALL NOT 被重写为 task-run store

#### Scenario: task-center action routes through existing runtime control path

- **WHEN** 用户在 Task Center 发起 retry、resume 或 cancel
- **THEN** 系统 SHALL 继续复用既有 thread/runtime control path
- **AND** run state SHALL 通过回流的 runtime/thread signal 更新，而不是前端本地伪完成

#### Scenario: kanban launch lifecycle is recorded without new runtime contract

- **WHEN** Kanban execution 通过现有 workspace connect、thread create 与 message send path 启动
- **THEN** 系统 SHALL 记录对应 TaskRun lifecycle boundary
- **AND** 该记录 SHALL NOT require a new Tauri command or Rust runtime store
