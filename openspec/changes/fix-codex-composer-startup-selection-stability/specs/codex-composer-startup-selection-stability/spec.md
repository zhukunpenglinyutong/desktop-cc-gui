## ADDED Requirements

### Requirement: Codex Thread-Scoped Composer Selection MUST Wait For A Ready Workspace Catalog

当 Codex composer 使用线程作用域时，系统 MUST 仅在当前 workspace 的模型 catalog 已经可判定后，才校验或修复线程级 model / reasoning effort。

#### Scenario: startup thread selection is not repaired against a stale built-in catalog
- **WHEN** 应用冷启动进入一条已有 Codex 线程
- **AND** 线程级 composer selection 已经持久化了合法的 model / effort
- **AND** workspace 模型 catalog 仍在恢复过程中
- **THEN** 系统 MUST NOT 基于落后一帧的 built-in catalog 把该线程选择修回默认模型
- **AND** 线程级选择 MUST 等到 workspace catalog ready 后再做有效性判定

### Requirement: Invalid Codex Thread Selection MUST Converge To A Valid Effective Selection

当线程级 Codex composer selection 已失效、模型已不存在或 reasoning effort 不再被当前模型支持时，系统 MUST 将其收敛到有效的 model / effort，而不是把坏值继续透传到 UI 或发送链。

#### Scenario: invalid stored thread model is repaired to a valid effective model
- **WHEN** 某条 Codex 线程恢复出的 `modelId` 已不存在于当前 workspace 可选模型列表
- **THEN** 系统 MUST 回退到当前有效的全局 Codex model 或默认 Codex model
- **AND** 后续线程级持久化 MUST 写回该有效 model

#### Scenario: invalid stored effort falls back to a valid effort for the effective model
- **WHEN** 某条 Codex 线程恢复出的 `effort` 不在当前有效 model 支持的 reasoning options 中
- **THEN** 系统 MUST 回退到该 model 的默认或首个有效 effort
- **AND** 发送链 MUST 使用收敛后的有效 effort，而不是原始坏值

### Requirement: Pending-To-Canonical Codex Thread Migration MUST Preserve Thread Selection Stability

当 Codex 线程 id 从 `codex-pending-*` finalize 为 `codex:*` 时，系统 MUST 保持该线程的 composer selection 稳定，不得在迁移期被全局默认值或启动 fallback 重新覆盖。

#### Scenario: pending thread finalize keeps the same effective selection
- **WHEN** 当前活动线程从 `codex-pending-*` finalize 到 canonical `codex:*`
- **AND** 该线程已有线程级 composer selection
- **THEN** finalize 后的线程 MUST 继续解析到同一组有效 model / effort
- **AND** 系统 MUST NOT 因 scope 变化重新回退到全局默认 model / effort

### Requirement: Global Composer Defaults MUST Persist Only Effective Values

当无活动线程时，系统 MUST 仅将校验后的有效 Codex model / effort 持久化为全局 composer 默认值，不得在冷启动首帧把坏值、空值或暂时未恢复的 state 写回 settings。

#### Scenario: cold start without an active thread does not clear global defaults
- **WHEN** 应用冷启动且当前没有活动线程
- **AND** app settings 中上次保存的 global composer model / effort 已失效或为空
- **AND** workspace 模型 catalog 仍处于恢复阶段
- **THEN** 系统 MUST 等到全局选择 ready 后才持久化
- **AND** 持久化结果 MUST 是当前有效的 Codex model / effort，而不是 `null` 或坏值

### Requirement: AppShell Startup Regression Coverage MUST Exercise Real Selection Recovery Paths

系统 MUST 提供 AppShell 级启动回归测试，覆盖线程选择恢复、无活动线程默认值恢复、无效线程选择自愈以及 `pending -> canonical` 迁移，而不只依赖局部纯函数测试。

#### Scenario: startup regression tests cover thread restore and finalize migration
- **WHEN** 开发者为 Codex composer 线程作用域调整启动恢复逻辑
- **THEN** 回归测试 MUST 至少覆盖已有线程选择恢复、无活动线程默认值恢复、无效线程选择自愈和 `pending -> canonical` finalize 四类路径
- **AND** 这些测试 MUST 在 AppShell 级挂载链路中验证，不得仅停留在 isolated helper 测试
