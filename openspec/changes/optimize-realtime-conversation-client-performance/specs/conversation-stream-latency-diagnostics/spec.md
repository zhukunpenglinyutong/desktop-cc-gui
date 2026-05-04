## ADDED Requirements

### Requirement: Stream Diagnostics MUST Include Reducer Render And Composer Client Evidence
Stream latency diagnostics MUST capture frontend client evidence beyond first-token and visible text timing so triage can identify reducer, render, and composer hot paths.

#### Scenario: reducer amplification is observable after chunk ingress
- **WHEN** chunks arrive at normal cadence but reducer processing causes repeated expensive derivation or dispatch amplification
- **THEN** diagnostics MUST record bounded evidence such as batching queue size, flush count, reducer action counts, `prepareThreadItems(...)` call count or equivalent derivation cost, and affected thread id
- **AND** the classification MUST remain separate from upstream pending and backend forwarding stall

#### Scenario: composer responsiveness degradation is observable during streaming
- **WHEN** the user types while a conversation is streaming
- **THEN** diagnostics SHOULD capture bounded evidence of composer-facing update pressure or input responsiveness degradation when available
- **AND** this evidence MUST be correlated with stream engine, thread, turn, render profile, and active mitigation state

### Requirement: Diagnostics MUST Compare Baseline And Optimized Paths
Realtime diagnostics MUST support comparing baseline and optimized behavior without requiring a code rebuild.

#### Scenario: rollback flag keeps comparable diagnostics
- **WHEN** an optimization flag disables batching, incremental derivation, render pacing, or mitigation activation
- **THEN** diagnostics MUST continue emitting comparable evidence dimensions
- **AND** triage MUST be able to determine whether the regression exists in the optimized path, the baseline path, or both
