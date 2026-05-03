## MODIFIED Requirements

### Requirement: Task Runs SHALL Preserve Diagnosable Observability Fields

每次 run MUST 保留足以支撑 Task Center 诊断的核心可观测字段，而不是只记录最终状态。Phase 2 visibility enhancement 中，run summary projection MUST 允许 Workspace Home 与 Kanban 使用简洁但可解释的摘要表达最近一次 execution。

#### Scenario: latest run summary stays concise but explainable across surfaces

- **WHEN** Workspace Home 或 Kanban 卡片展示最近一次 run 摘要
- **THEN** 该摘要 SHALL 能表达最近 run 的关键状态、更新时间与主要阻塞/失败短摘要
- **AND** 该摘要 SHALL NOT 强迫这些 surface 承担完整 Task Center detail 语义

#### Scenario: summary projection passes visibility CI gates

- **WHEN** latest run summary projection、Workspace Home 和 Kanban summary 被修改
- **THEN** shared mapper、Task Center、Workspace Home、Kanban summary 的 focused tests SHALL 覆盖统一状态映射
- **AND** OpenSpec validate、lint、typecheck SHALL 作为该 change 的必过门禁
