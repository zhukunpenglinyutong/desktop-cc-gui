## MODIFIED Requirements

### Requirement: Task Center SHALL Expose An Independent Task-Run Surface

系统 MUST 提供独立于 Kanban 的 `Task Center` surface，用于展示 task runs 的当前状态与详情，并且这些 runs MUST 能从真实 Kanban execution lifecycle 中生成与更新。该 surface 在 Phase 2 visibility enhancement 中 MUST 让需要关注或干预的 run 更容易被用户扫描与识别。

#### Scenario: active and attention-needing runs are visually emphasized

- **WHEN** run 处于 `planning`、`running`、`waiting_input`、`blocked` 或 `failed`
- **THEN** Task Center SHALL 在 list 或 summary 层给予更明显的状态强调
- **AND** 用户 SHALL 无需先打开 detail 才能识别哪些 run 正在推进、等待处理或需要恢复

### Requirement: Task Center SHALL Provide Bounded Recovery And Navigation Actions

Task Center MUST 在 run 级别提供有边界的恢复与跳转动作，并且这些动作必须接到现有 control path，而不是只停留在 UI 展示层。相关 surface 还 MUST 为用户提供面向下一步动作的可见提示，而不是只显示被动状态。

#### Scenario: recoverable run exposes next-step hint before detail inspection

- **WHEN** 某次 run 进入 `blocked`、`failed` 或 `waiting_input`
- **THEN** Task Center SHALL 在用户打开 detail 之前就能提示该 run 适合进入 conversation、恢复或等待
- **AND** 该提示 SHALL NOT 伪造新的 recovery capability

#### Scenario: surface enhancement remains backward compatible with existing local run data

- **WHEN** 本地已有 `TaskRun` store 或旧 `latestRunSummary` 缺少新增 surface 需要的字段
- **THEN** Task Center SHALL 回退到已有可观测字段或通用 unavailable copy
- **AND** UI SHALL NOT 因缺字段而崩溃、空白或要求用户先清空本地数据
