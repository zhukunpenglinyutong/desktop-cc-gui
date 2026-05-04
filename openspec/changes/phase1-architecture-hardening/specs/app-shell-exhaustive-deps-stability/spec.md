## ADDED Requirements

### Requirement: Dependency Remediation MUST Not Become Structural Drift
app-shell、threads 与 composer 的 dependency remediation 在第一阶段 MUST 与结构抽取协同推进，不能为消 warning 再次堆积隐性耦合。

#### Scenario: dependency remediation keeps boundary ownership explicit
- **WHEN** `app-shell-parts`、threads 或 composer 热点为满足 exhaustive-deps 而调整 callback、effect 或 helper 依赖
- **THEN** 调整 MUST 保持状态 ownership 与职责边界清晰
- **AND** remediation MUST NOT 通过把更多无关状态塞入同一 hook 来“消掉 warning”

#### Scenario: extraction batch does not hide dependency regressions
- **WHEN** 某个架构收敛批次同时触及 app-shell dependency remediation 与结构抽取
- **THEN** 批次 MUST 保留 focused exhaustive-deps evidence
- **AND** 行为验证 MUST 证明 remediation 与 extraction 共同作用后仍保持稳定
