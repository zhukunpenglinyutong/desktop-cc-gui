## ADDED Requirements

### Requirement: Agent Domain Event Runtime MUST Be Deferred Until A Concrete Consumer Exists

This capability MUST NOT introduce a runtime EventBus in the current P0 harness governance pass.

#### Scenario: current pass excludes EventBus

- **WHEN** current harness governance implementation scope is selected
- **THEN** reducer emit integration and runtime EventBus implementation MUST be excluded

### Requirement: Future Runtime MUST Be In-Memory Only

If revived, the runtime MUST use only an in-memory subscription model and MUST NOT persist or cross process boundaries.

#### Scenario: no persistence is introduced

- **WHEN** future runtime is implemented
- **THEN** it MUST NOT write domain events to localStorage, IndexedDB, filesystem, or backend storage

#### Scenario: no IPC publish is introduced

- **WHEN** future runtime is implemented
- **THEN** it MUST NOT publish domain events over Tauri IPC, WebSocket, worker channel, or cloud transport

### Requirement: Future Consumers MUST Not Publish Events

If a bus is implemented later, application consumers MUST be able to subscribe but MUST NOT be able to publish.

#### Scenario: publish is not public

- **WHEN** application code imports the runtime event module
- **THEN** no public publish function MUST be available

### Requirement: Reducer Behavior MUST Remain Unchanged If Runtime Emit Is Later Added

Future reducer integration MUST prove next-state equivalence with the current pure reducer path.

#### Scenario: reducer next state is preserved

- **WHEN** future emit-after-mutation integration is tested
- **THEN** the reducer next state MUST equal the pure reducer next state for the same action
