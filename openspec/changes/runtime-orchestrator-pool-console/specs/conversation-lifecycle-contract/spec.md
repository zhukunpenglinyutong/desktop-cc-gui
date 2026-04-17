## MODIFIED Requirements

### Requirement: Workspace reconnect and restore semantics MUST preserve runtime acquisition boundaries
The system MUST distinguish between restoring workspace/thread UI state and acquiring a managed backend runtime.

#### Scenario: startup restore keeps thread metadata without forcing runtime spawn
- **WHEN** the client restores active or sidebar-visible workspaces on startup
- **THEN** it MUST restore workspace and thread metadata without automatically spawning a managed runtime for every restored workspace

#### Scenario: runtime-required action triggers managed runtime acquisition
- **WHEN** the user performs a runtime-required action such as send, resume, or new thread on a workspace that does not currently have a managed runtime
- **THEN** the system MUST acquire or reuse a managed runtime for that workspace before execution continues

#### Scenario: reconnect remains idempotent for same workspace-engine pair
- **WHEN** the client issues repeated reconnect or ensure-runtime actions for the same workspace and engine
- **THEN** the system MUST preserve a single effective managed runtime identity for that workspace-engine pair
