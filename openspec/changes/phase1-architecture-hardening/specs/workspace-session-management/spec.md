## ADDED Requirements

### Requirement: Workspace And Session Ownership MUST Remain Stable During Architecture Extraction
第一阶段涉及 workspace/session 读取、投影、mutation 或 routing 的抽取 MUST 保持 ownership 与 scope 语义稳定。

#### Scenario: extracted session helper keeps owner routing intact
- **WHEN** workspace/session catalog、projection、mutation helper 或 bridge mapping 被拆分到新模块
- **THEN** 系统 MUST 继续按 entry 的真实 `workspaceId` 执行 mutation routing
- **AND** 抽取 MUST NOT 让 main workspace、worktree 与 related session 的归属语义漂移

#### Scenario: strict and related scopes remain distinguishable after extraction
- **WHEN** strict project sessions、related sessions 或 global history 相关逻辑被收敛到 facade 或 adapter
- **THEN** strict、related 与 global scope 的边界 MUST 继续可解释
- **AND** 系统 MUST NOT 因结构抽取而把 inferred related entries 混入 strict project results
