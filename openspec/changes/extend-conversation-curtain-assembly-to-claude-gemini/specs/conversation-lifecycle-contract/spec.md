## ADDED Requirements

### Requirement: Claude And Gemini History Reconcile MUST Be Validation-Oriented

在 `Claude Code` 与 `Gemini` 会话中，turn completion 后的 history reconcile 或 session reopen MUST 以 validation / backfill 为主，而不是 primary duplicate repair。只要客户端已经具备足够的 local realtime observations 去完成 canonical convergence，系统就 MUST 在 history refresh 之前保持稳定的可见 row 结果。

#### Scenario: claude equivalent history replay does not change visible row cardinality

- **WHEN** `Claude Code` turn 已在本地完成 assistant、reasoning、tool、approval 或 plan rows 的 canonical convergence
- **AND** 后续 history reconcile 只带来等价内容
- **THEN** reconciliation MUST NOT 改变用户可见 row 数量
- **AND** reconciliation only MAY canonicalize ids、metadata、timestamps 或 structured facts

#### Scenario: gemini equivalent history replay does not change visible row cardinality

- **WHEN** `Gemini` turn 已在本地完成 assistant、reasoning 或 tool rows 的 canonical convergence
- **AND** 后续 history hydrate 只带来等价内容
- **THEN** reconciliation MUST NOT 改变用户可见 row 数量
- **AND** reconciliation only MAY canonicalize ids、metadata、timestamps 或 structured facts

#### Scenario: reconcile may backfill missing structured facts without reintroducing duplicates

- **WHEN** 本地 realtime settlement 缺少部分 canonical metadata 或 structured activity facts
- **AND** post-turn history reconcile 能补齐这些缺失信息
- **THEN** 系统 MAY 用 reconcile 结果回填缺失事实
- **AND** MUST NOT 因回填动作重新引入重复 user、assistant、reasoning、tool、approval 或 plan rows

#### Scenario: codex lifecycle baseline remains unchanged

- **WHEN** 当前引擎为 `Codex`
- **THEN** Claude / Gemini convergence rollout MUST NOT weaken existing Codex idempotency、queued handoff、image generation、or staged markdown lifecycle behavior
- **AND** Codex-specific tests MUST remain part of the regression gate
