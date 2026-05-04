## MODIFIED Requirements

### Requirement: Stream Mitigation MUST Reduce UI Amplification Without Breaking Conversation Semantics

更激进的 mitigation 可以调整 render/scroll/Markdown 的刷新策略，但 MUST 保持会话语义不变。系统 MUST distinguish baseline engine presentation profiles from provider-scoped mitigation profiles: baseline profiles define normal `Codex`、`Claude Code`、`Gemini` streaming cadence, while mitigation profiles are only evidence-triggered recovery overrides.

#### Scenario: mitigation adjusts pacing without losing ordering or terminal outcome

- **WHEN** mitigation profile 已启用
- **THEN** 系统 MAY 提高 Markdown throttle、收紧 render light path 或调整 realtime flush/scroll 节奏
- **AND** batched ordering、terminal lifecycle 与 conversation visible outcome MUST 与基线路径保持语义一致

#### Scenario: waiting and ingress visibility survive mitigation

- **WHEN** mitigation profile 已启用且会话仍处于 processing
- **THEN** 系统 MUST 保留 waiting/ingress/stop 等基础状态可见性
- **AND** 用户 MUST NOT 因 mitigation 失去对“仍在处理中”的判断能力

#### Scenario: claude long markdown uses baseline profile controlled staged reveal

- **WHEN** `Claude Code` 正在 streaming 长 Markdown、plan text 或 approval-adjacent assistant output
- **THEN** normal render cadence MUST be controlled by an engine-aware baseline presentation profile
- **AND** completion 后 MUST 在本地 realtime render 路径收敛为最终 Markdown structure
- **AND** 系统 MUST NOT 依赖 history replay 才恢复标题、列表、代码块或强调结构

#### Scenario: gemini reasoning stream keeps processing visibility

- **WHEN** `Gemini` 正在 streaming reasoning 或长 assistant output
- **THEN** reasoning / assistant render pacing MAY be throttled by baseline presentation profile
- **AND** waiting、ingress、stop affordance 与 terminal outcome MUST remain visible and ordered
- **AND** throttle MUST NOT collapse non-equivalent reasoning steps into one semantic row

#### Scenario: mitigation remains evidence-triggered

- **WHEN** Claude or Gemini baseline profile is active without latency or render-stall evidence
- **THEN** the system MUST NOT report that turn as an active mitigation case
- **AND** mitigation diagnostics MUST only be emitted when an evidence-triggered recovery profile overrides baseline cadence

### Requirement: Active Mitigation MUST Be Observable And Rollback-Safe

系统 MUST 让 triage 与回退可以明确知道某次 turn 是否命中了 mitigation profile。

#### Scenario: diagnostics record active mitigation profile and activation reason

- **WHEN** 某个 turn 启用了 provider-scoped mitigation 或 an explicit evidence-triggered override to baseline presentation cadence
- **THEN** diagnostics MUST 记录命中的 profile、触发证据摘要与关键 correlation dimensions
- **AND** triage 时 MUST 能区分“问题仍存在于基线路径”还是“问题出现在 mitigation/profile 路径”

#### Scenario: rollback restores baseline path without breaking session continuity

- **WHEN** 某个 mitigation profile 被关闭、回退或临时禁用
- **THEN** 系统 MUST 能回到现有基线路径
- **AND** 该回退 MUST NOT 破坏当前会话连续性或引入新的 lifecycle drift

#### Scenario: claude gemini profile fallback does not affect codex baseline

- **WHEN** Claude / Gemini streaming profile is disabled or rolled back
- **THEN** Codex existing baseline presentation profile、staged markdown and idempotent convergence behavior MUST remain unchanged
- **AND** rollback MUST be scoped to the affected engine/profile
