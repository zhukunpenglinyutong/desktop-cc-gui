## ADDED Requirements

### Requirement: Core Extraction MUST Prefer Facade-First Migration Over Patch Growth
核心复杂度治理 MUST 优先通过 facade-first extraction 收敛，而不是继续在高风险 hub 上叠加 patch-style 分支。

#### Scenario: hotspot extraction starts from compatibility facade
- **WHEN** 第一阶段批次触及 `src/services/tauri.ts`、threads 主链路、persistent state hub 或 Rust shared-state hub
- **THEN** 该批次 MUST 先建立兼容 facade、adapter 或等价边界
- **AND** 批次 MUST NOT 以新增条件分支替代真正的边界收敛

#### Scenario: callers remain stable during migration
- **WHEN** facade-first extraction 正在进行
- **THEN** 调用方 SHOULD 保持既有 import、command surface 或 entrypoint 稳定
- **AND** 内部迁移完成前不得强迫无关调用方同时搬迁

### Requirement: Architecture Hardening Batches MUST Be Cohesive And Rollback-Ready
第一阶段批次 MUST 保持范围内聚，并具备 bounded rollback 能力。

#### Scenario: extraction batch has one coherent boundary
- **WHEN** 某个架构收敛批次被定义
- **THEN** 该批次 MUST 声明单一 coherent boundary，例如 bridge、persistent state、shared-state、lifecycle 或 runtime-mode
- **AND** 批次 MUST NOT 仅因多个热点都“大”而混做无关抽取

#### Scenario: rollback uses bounded compatibility path
- **WHEN** 某个收敛批次需要回滚
- **THEN** 系统 MUST 能通过 facade、adapter 或 bounded compatibility path 回到旧行为
- **AND** 回滚策略 MUST 不依赖一次性撤销整个架构变更历史
