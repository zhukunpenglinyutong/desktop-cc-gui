## MODIFIED Requirements

### Requirement: Future Governance Telemetry MUST Be Local, Explicit, And Minimal

If this capability is revived later, it MUST begin with a closed, local-only, fire-and-forget counter contract AND it MUST consume the governance evidence bridge snapshot as its input rather than instrumenting product hot paths directly.

#### Scenario: no network upload is allowed

- **WHEN** telemetry is implemented in the future
- **THEN** it MUST NOT upload data through `fetch`, `XMLHttpRequest`, WebSocket, Tauri commands, or third-party SDKs

#### Scenario: first implementation is not persistent

- **WHEN** the first telemetry recorder is implemented
- **THEN** it MUST NOT write to IndexedDB, localStorage, filesystem, or remote storage

#### Scenario: telemetry consumes bridge snapshots, not product hot paths

- **WHEN** telemetry is implemented in the future
- **THEN** the recorder MUST derive counters and tags from the governance evidence bridge snapshot
- **AND** the recorder MUST NOT instrument reducers, render paths, runtime hooks, or feature event handlers directly

### Requirement: Telemetry MUST Not Add Dashboard Or Export In This Stage

This deferred capability MUST NOT introduce dashboard UI, anonymized export, histograms, timers, or default-on user observation in the current stage. Future revival MUST keep dashboard, export, and histogram surfaces explicitly out of the first telemetry change set.

#### Scenario: no dashboard is introduced

- **WHEN** this deferred change is present
- **THEN** it MUST NOT add a settings dashboard or StatusPanel telemetry surface

#### Scenario: future revival does not add export or histograms in the first change

- **WHEN** a future change revives telemetry
- **THEN** the first revival change MUST NOT add dashboard UI, anonymized export, histograms, or timers
- **AND** any such surface MUST be introduced via a separate follow-up change after the counter contract stabilizes
