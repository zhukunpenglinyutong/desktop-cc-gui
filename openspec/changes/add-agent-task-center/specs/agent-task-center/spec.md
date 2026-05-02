## ADDED Requirements

### Requirement: Task Center SHALL Expose An Independent Task-Run Surface

系统 MUST 提供独立于 Kanban 的 `Task Center` surface，用于展示 task runs 的当前状态与详情。

#### Scenario: task center lists active and recoverable runs

- **WHEN** workspace 中存在 running、waiting_input、blocked、failed 或 completed task runs
- **THEN** Task Center SHALL 在独立 surface 中列出这些 runs
- **AND** 用户 SHALL 无需逐个打开会话线程才能判断当前执行态

#### Scenario: task center keeps planning and execution surfaces separate

- **WHEN** 用户查看 Kanban task 与 Task Center run
- **THEN** Kanban SHALL 继续承担 planning 语义
- **AND** Task Center SHALL 承担 execution / observation / recovery 语义

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

### Requirement: Task Center SHALL Provide Bounded Recovery And Navigation Actions

Task Center MUST 在 run 级别提供有边界的恢复与跳转动作。

#### Scenario: blocked or failed run exposes recovery actions

- **WHEN** 某次 run 进入 `blocked` 或 `failed`
- **THEN** Task Center SHALL 至少暴露 `open conversation` 与一种恢复动作（如 `retry` 或 `resume`）
- **AND** 不适用的动作 SHALL 隐藏或禁用

#### Scenario: linked conversation remains reachable

- **WHEN** 某次 run 已绑定 conversation thread
- **THEN** 用户 SHALL 能从 Task Center 直接跳转到对应会话
- **AND** 该跳转 SHALL NOT 改写 run 自身状态

#### Scenario: active-run conflict does not create silent duplicate

- **WHEN** 同一 task definition 已存在 active run
- **AND** 用户尝试从 Task Center 发起会产生新 run 的动作
- **THEN** Task Center SHALL 禁用该动作或显式引导用户进入现有 active run
- **AND** UI SHALL NOT 静默制造第二条 active run
