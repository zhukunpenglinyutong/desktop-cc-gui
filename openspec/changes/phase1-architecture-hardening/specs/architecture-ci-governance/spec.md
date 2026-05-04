## ADDED Requirements

### Requirement: Architecture Hardening Batches MUST Declare Validation Gates Up Front
第一阶段架构收敛批次 MUST 在实现前声明适用的质量门禁与 focused validation，而不是在实现后补跑模糊回归。

#### Scenario: validation matrix is declared before implementation
- **WHEN** 某个架构收敛批次被开始执行
- **THEN** 该批次 MUST 先声明适用的 OpenSpec、frontend、backend、runtime contract、persistent state、large-file 与 platform evidence gates
- **AND** 该批次 MUST NOT 在未定义验证矩阵的情况下直接进入实现

### Requirement: Architecture Hardening MUST Pass Contract-Sensitive Gates
架构收敛类变更 MUST 通过与其影响面匹配的 contract-sensitive gates。

#### Scenario: bridge and runtime changes run contract gates
- **WHEN** 批次触及 frontend/backend bridge、runtime mode split、command payload 或 lifecycle mapping
- **THEN** 批次 MUST 通过 `npm run check:runtime-contracts`
- **AND** 批次 MUST 通过 `npm run doctor:strict` 或等价 runtime diagnostics gate

#### Scenario: persistent state changes run restart-sensitive gates
- **WHEN** 批次触及 persisted UI state、schema evolution、migration 或 corruption recovery
- **THEN** 批次 MUST 提供 restart consistency、migration 与 corruption fallback focused tests 或等价验证
- **AND** 验证 MUST 说明失败后的恢复语义

#### Scenario: shared-state changes run backend-focused gates
- **WHEN** 批次触及 Rust shared state、AppState、shared core helper、锁顺序或 runtime/session/workspace 共享访问路径
- **THEN** 批次 MUST 运行对应 focused backend suites
- **AND** 记录 MUST 说明状态域影响面与锁顺序影响面

### Requirement: Documentation-Only Batches MUST Declare Explicit Runtime Gate Skips
仅文档批次若跳过运行时门禁，MUST 显式说明。

#### Scenario: docs-only batch skips runtime gates with note
- **WHEN** 某个批次只修改 OpenSpec、Trellis、Markdown 或其他非代码文档
- **THEN** 该批次 MUST 显式记录 runtime-related gates 被跳过
- **AND** 变更记录 MUST 显式注明跳过原因
