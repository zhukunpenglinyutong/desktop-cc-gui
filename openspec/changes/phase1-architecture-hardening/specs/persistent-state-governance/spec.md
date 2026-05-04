## ADDED Requirements

### Requirement: Persistent State MUST Have Explicit Ownership And Schema Boundaries
第一阶段涉及的 client persistent state MUST 为每个 store 定义明确的 ownership、schema 与 evolution boundary。

#### Scenario: store ownership matrix is explicit
- **WHEN** 系统治理 `layout`、`composer`、`threads`、`app` 或 `leida` persistent store
- **THEN** 每个 store MUST 明确哪些字段属于该 store 的 source-of-truth
- **AND** feature MUST NOT 将不属于该 store 的状态偷偷写入同一持久化空间

#### Scenario: schema evolution remains explicit
- **WHEN** persistent store 新增字段、重命名字段、规范化字段或调整数据结构
- **THEN** 变更 MUST 定义显式 schema evolution 语义
- **AND** 系统 MUST NOT 仅依赖“读取失败回空对象”作为默认演进策略

### Requirement: Persistent State MUST Support Migration And Corruption Recovery
持久化状态演进 MUST 定义 migration 与 corruption recovery contract。

#### Scenario: migration keeps restart-visible consistency
- **WHEN** 已有用户升级到包含 persistent state schema 变更的新版本
- **THEN** 系统 MUST 在重启后保留可恢复的既有状态语义
- **AND** migration MUST NOT 静默丢失仍可解释的有效字段

#### Scenario: corrupted store remains recoverable
- **WHEN** 系统读取到损坏、部分损坏或不符合当前 schema 的 persistent store 数据
- **THEN** 系统 MUST 进入可恢复 fallback
- **AND** fallback MUST 明确是清理单字段、回退单 store 还是重建默认值
- **AND** 恢复行为 MUST 保持可解释而非隐式吞错

### Requirement: Persistent Writes MUST Preserve Eventual Disk Consistency
持久化写入抽取后 MUST 保持 debounce、patch/full-write 与失败重试语义可验证。

#### Scenario: write failure does not silently discard state
- **WHEN** persistent store 写入失败
- **THEN** 系统 MUST 保留待写状态或等价重试语义
- **AND** 后续成功写入后重启 MUST 看到一致的最终状态

#### Scenario: full replace and patch remain distinguishable
- **WHEN** 某次持久化写入属于 full replace 或 patch update
- **THEN** 系统 MUST 保持两者语义可区分
- **AND** 抽取后不得把 full replace silently 降级为 patch 或反之
