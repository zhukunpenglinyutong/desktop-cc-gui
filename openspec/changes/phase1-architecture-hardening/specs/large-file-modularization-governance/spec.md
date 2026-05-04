## ADDED Requirements

### Requirement: Large-File Governance MUST Favor Boundary-Driven Splits
第一阶段 large-file 治理 MUST 优先执行 boundary-driven split，而不是只按行数机械切分。

#### Scenario: split plan declares architectural boundary
- **WHEN** 某个 near-threshold 或 oversized P0/P1 文件被纳入第一阶段收敛批次
- **THEN** split plan MUST 先声明其所属架构边界，例如 bridge、lifecycle、persistent state、shared-state 或 runtime-mode
- **AND** split MUST NOT 仅为了降行数而切出无独立职责的新模块

#### Scenario: extracted modules do not become replacement hubs
- **WHEN** large-file 模块被拆成多个子模块
- **THEN** 新模块 MUST 以职责分片而不是复制原 hub 结构
- **AND** 若某个新模块接近阈值，批次 MUST 记录继续拆分的 follow-up rationale
