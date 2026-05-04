## ADDED Requirements

### Requirement: Shared State Domains MUST Be Explicit
第一阶段涉及的 Rust shared state MUST 明确定义状态域与归属边界。

#### Scenario: shared state domain map is declared
- **WHEN** 某个批次触及 `AppState`、shared core helper 或 runtime/session/workspace/settings 共享状态
- **THEN** 批次 MUST 声明受影响状态域
- **AND** 每个状态域 MUST 说明谁拥有写权限、谁可读以及为何需要共享

### Requirement: Lock Topology MUST Be Deterministic
Rust shared-state 抽取 MUST 明确锁顺序与嵌套获取规则，避免隐式竞争与死锁风险。

#### Scenario: nested lock order remains explicit
- **WHEN** 某个 helper 需要在同一路径访问多个共享状态锁
- **THEN** 实现 MUST 遵循已声明的锁顺序
- **AND** 新增抽取 MUST NOT 引入未定义的锁嵌套顺序

#### Scenario: lock topology changes require focused evidence
- **WHEN** 某个批次改变共享状态访问顺序、拆分锁或新增共享 helper
- **THEN** 批次 MUST 记录锁拓扑影响面
- **AND** 批次 MUST 提供对应 focused backend evidence

### Requirement: High-Risk Operations MUST NOT Hold Shared Locks Indefinitely
持有共享状态锁期间 MUST 避免高风险长操作。

#### Scenario: blocking io is not performed under shared state lock
- **WHEN** 实现执行文件 IO、process spawn、CLI probe、network wait 或长时间 blocking work
- **THEN** 这些操作 MUST NOT 在高层共享状态锁持有期间执行
- **AND** 抽取后必须保持或改进这一约束

#### Scenario: long-lived await is not hidden by helper extraction
- **WHEN** 某个 async helper 被抽取到新模块
- **THEN** 抽取 MUST NOT 把长时间 await 隐藏在共享锁作用域内
- **AND** helper 边界 MUST 保持持锁范围可审计
