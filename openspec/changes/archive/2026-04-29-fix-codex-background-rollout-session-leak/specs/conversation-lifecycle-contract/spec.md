## ADDED Requirements

### Requirement: Passive History Selection MUST NOT Force Codex Runtime Acquisition

Selecting or restoring a completed Codex history conversation for display MUST prefer durable local history facts and MUST NOT acquire a managed Codex runtime solely to render already-readable history.

#### Scenario: local history satisfies passive selection

- **WHEN** the user selects an unloaded Codex history conversation
- **AND** local session history can reconstruct visible conversation items for that `threadId`
- **THEN** the UI MUST render that history without calling Codex `thread/resume`
- **AND** backend runtime acquisition MUST remain reserved for runtime-required actions such as send, explicit retry, fork, or verified stale recovery

#### Scenario: passive selection may fall back when local history is insufficient

- **WHEN** local session history is unavailable, unreadable, or reconstructs no visible items
- **THEN** the system MAY use the existing runtime-backed resume path if the caller intentionally requested runtime verification
- **AND** any resulting recovery MUST follow the existing liveness and stale-thread contracts
