## ADDED Requirements

### Requirement: Codex Stalled Or Abandoned Turn MUST Not Revive From Stale Progress Evidence

Codex conversation liveness MUST treat stalled or abandoned turn settlement as terminal for that turn's UI processing state unless a verified successor turn identity is active.

#### Scenario: stale progress after settlement cannot restore generating state
- **WHEN** a Codex turn has been settled as stalled, dead-recoverable, abandoned, interrupted, failed, or equivalent terminal liveness state
- **AND** stale progress evidence later arrives for the same settled turn identity
- **THEN** the system MUST NOT restore normal generating or processing state for that old turn
- **AND** diagnostics MUST identify the evidence as stale late progress

#### Scenario: verified successor identity can continue
- **WHEN** a Codex turn has been settled as stalled
- **AND** the user starts or recovers into a verified successor turn identity
- **THEN** realtime evidence for the successor identity MUST be allowed to update the conversation
- **AND** the old stalled identity MUST remain quarantined from mutating active state
