## ADDED Requirements

### Requirement: Lifecycle Semantics MUST Survive Architecture Extraction
threads / messages / composer 主链路在第一阶段抽取期间 MUST 保持统一会话生命周期语义不变。

#### Scenario: lifecycle-compatible extraction preserves same outcomes
- **WHEN** reducer、event handlers、thread actions、message rendering 或 composer orchestration 被拆分到新模块
- **THEN** 相同事件序列在抽取前后 MUST 收敛到相同 lifecycle outcome
- **AND** user-visible processing、completed、error、recovery 与 blocked 语义 MUST 保持等价

#### Scenario: fallback or rollback path preserves lifecycle continuity
- **WHEN** 新的 facade、adapter 或 extracted helper 被局部关闭或回滚
- **THEN** conversation lifecycle contract MUST 继续成立
- **AND** 回滚 MUST NOT 留下 pseudo-processing、identity 漂移或重复 settlement residue
