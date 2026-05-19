## ADDED Requirements

### Requirement: Governance Telemetry MUST Be Deferred For The Current Harness Governance Pass

This capability MUST NOT be implemented as part of the current P0 harness governance pass.

#### Scenario: current implementation pass skips telemetry

- **WHEN** the current harness governance implementation is planned
- **THEN** telemetry implementation MUST be excluded from P0 scope

### Requirement: Future Governance Telemetry MUST Be Local, Explicit, And Minimal

If this capability is revived later, it MUST begin with a closed, local-only, fire-and-forget counter contract.

#### Scenario: no network upload is allowed

- **WHEN** telemetry is implemented in the future
- **THEN** it MUST NOT upload data through `fetch`, `XMLHttpRequest`, WebSocket, Tauri commands, or third-party SDKs

#### Scenario: first implementation is not persistent

- **WHEN** the first telemetry recorder is implemented
- **THEN** it MUST NOT write to IndexedDB, localStorage, filesystem, or remote storage

### Requirement: Telemetry MUST Not Collect Sensitive Content

Telemetry tags MUST be allowlisted and MUST reject prompt text, filesystem paths, tokens, workspace identifiers, and session identifiers.

#### Scenario: path-like tag is rejected

- **WHEN** a tag value contains a path separator or absolute-path pattern
- **THEN** the recorder MUST reject the event before recording

#### Scenario: unknown tag is rejected

- **WHEN** a tag key is not in the allowlist
- **THEN** the recorder MUST reject the event before recording

### Requirement: Telemetry MUST Not Add Dashboard Or Export In This Stage

This deferred capability MUST NOT introduce dashboard UI, anonymized export, histograms, timers, or default-on user observation in the current stage.

#### Scenario: no dashboard is introduced

- **WHEN** this deferred change is present
- **THEN** it MUST NOT add a settings dashboard or StatusPanel telemetry surface
