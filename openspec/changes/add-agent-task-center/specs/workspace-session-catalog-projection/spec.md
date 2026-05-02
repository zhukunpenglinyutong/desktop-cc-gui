## ADDED Requirements

### Requirement: Workspace Projection SHALL Keep Task-Run Aggregates Separate From Session Membership

系统 MUST 在 workspace 级 surface 中把 task-run 聚合与 session membership 分开表达，避免 run 数量污染 session catalog 口径。

#### Scenario: run aggregates do not change shared session membership

- **WHEN** workspace surface 同时展示会话目录与 task-run 摘要
- **THEN** task-run aggregates SHALL 作为独立 projection 呈现
- **AND** 共享 session membership 规则 SHALL 保持不变

#### Scenario: degraded run source stays explainable

- **WHEN** 某个 engine 的 run history 或 telemetry source 暂不可用
- **THEN** workspace-level task-run aggregate SHALL 暴露 degraded marker
- **AND** UI SHALL 能解释当前 run 结果并非完整全量
