## MODIFIED Requirements

### Requirement: Runtime pool console MUST surface process diagnostics for managed runtimes

The runtime pool console MUST expose enough continuity diagnostics to explain whether a Codex runtime is truly executing resumed work, merely retained, stalled while waiting for fusion continuation to settle, or recently stalled after a `resume-pending` timeout has already been settled.

#### Scenario: runtime row distinguishes stalled fusion continuation from retained idle

- **WHEN** a runtime has no current turn or stream lease
- **AND** the same `workspace + engine` still has a queue-fusion continuation in pending or stalled foreground continuity
- **THEN** the runtime pool console MUST expose that row as stalled foreground continuation rather than plain idle or generic retained busy
- **AND** the row MUST show the stalled continuation reason separately from pinned / warm retention metadata

#### Scenario: runtime row clears stalled fusion continuity after terminal settlement

- **WHEN** the corresponding fusion continuation later receives completed, error, runtime-ended, or equivalent terminal settlement
- **THEN** the runtime pool console MUST clear the stalled fusion continuity marker
- **AND** the row MUST converge to the ordinary settled runtime state without stale busy residue

#### Scenario: runtime row releases current active-work protection after resume-pending timeout

- **WHEN** a Codex runtime row was protected only by a `resume-pending` foreground continuity chain
- **AND** that chain has already been settled into stalled / degraded due to timeout
- **THEN** the runtime pool console MUST stop representing the row as current active-work protected or current `resume-pending`
- **AND** the row MUST fall back to ordinary settled / retained classification according to remaining leases and retention rules

#### Scenario: recent stalled timeout remains visible after current protection is released

- **WHEN** a Codex runtime row is no longer current active-work protected because `resume-pending` timeout settlement has completed
- **THEN** the console MUST still expose recent stalled timeout evidence for that chain
- **AND** that evidence MUST remain semantically distinct from current busy / active-work protection
