# agent-task-center Specification

## Purpose
TBD - created by syncing Task Center phase-one changes. Update Purpose after archive.

## Requirements

### Requirement: Task Center SHALL Expose An Independent Task-Run Surface

系统 MUST 提供独立于 Kanban 的 `Task Center` surface，用于展示 task runs 的当前状态与详情，并且这些 runs MUST 能从真实 Kanban execution lifecycle 中生成与更新。

#### Scenario: task center lists active and recoverable runs

- **WHEN** workspace 中存在 running、waiting_input、blocked、failed 或 completed task runs
- **THEN** Task Center SHALL 在独立 surface 中列出这些 runs
- **AND** 用户 SHALL 无需逐个打开会话线程才能判断当前执行态

#### Scenario: task center keeps planning and execution surfaces separate

- **WHEN** 用户查看 Kanban task 与 Task Center run
- **THEN** Kanban SHALL 继续承担 planning 语义
- **AND** Task Center SHALL 承担 execution / observation / recovery 语义

#### Scenario: kanban launch creates task center run

- **WHEN** 用户或系统通过 Kanban manual、scheduled 或 chained trigger 启动任务执行
- **THEN** 系统 SHALL 创建对应 trigger 的 TaskRun
- **AND** TaskRun SHALL 绑定 task definition、workspace、engine 与可用 thread id

### Requirement: Task Center SHALL Surface Run Diagnostics Without Opening The Conversation

系统 MUST 在 Task Center 中直接呈现 run-level 诊断摘要，而不是把关键执行信息继续藏在线程内部。

#### Scenario: active run exposes execution progress summary

- **WHEN** 某次 run 处于 `queued`、`planning`、`running`、`waiting_input` 或 `blocked`
- **THEN** Task Center SHALL 直接展示 `plan snapshot`、`current step`、`latest output summary` 中的可用字段
- **AND** 用户 SHALL 无需先打开 conversation 才能理解该 run 当前推进到哪一步

#### Scenario: terminal run exposes diagnostic and artifact summary

- **WHEN** 某次 run 进入 `failed`、`blocked`、`completed` 或 `canceled`
- **THEN** Task Center SHALL 直接展示 `blocked / failure reason` 与 artifacts summary 的可用字段
- **AND** 缺失字段 SHALL 以显式 unavailable / empty 状态呈现，而不是伪装成成功无产物

#### Scenario: launch failure is visible as run diagnostic

- **WHEN** Kanban execution 在 workspace connection、thread creation 或 first message send 边界失败
- **THEN** TaskRun SHALL 进入 `failed` 并记录可读 failure reason
- **AND** Kanban latest run summary SHALL 投影同一 failure reason

### Requirement: Task Center SHALL Provide Bounded Recovery And Navigation Actions

Task Center MUST 在 run 级别提供有边界的恢复与跳转动作，并且这些动作必须接到现有 control path，而不是只停留在 UI 展示层。

#### Scenario: blocked or failed run exposes recovery actions

- **WHEN** 某次 run 进入 `blocked` 或 `failed`
- **THEN** Task Center SHALL 至少暴露 `open conversation` 与一种恢复动作（如 `retry` 或 `resume`）
- **AND** 不适用的动作 SHALL 隐藏或禁用

#### Scenario: linked conversation remains reachable

- **WHEN** 某次 run 已绑定 conversation thread
- **THEN** 用户 SHALL 能从 Task Center 直接跳转到对应会话
- **AND** 该跳转 SHALL NOT 改写 run 自身状态

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

#### Scenario: active-run conflict does not create silent duplicate

- **WHEN** 同一 task definition 已存在 active run
- **AND** 用户尝试从 Task Center 或 Kanban 发起会产生新 run 的动作
- **THEN** Task Center SHALL 禁用该动作或显式引导用户进入现有 active run
- **AND** UI SHALL NOT 静默制造第二条 active run
