## MODIFIED Requirements

### Requirement: Agent Domain Event Runtime MUST Be Deferred Until A Concrete Consumer Exists

The system MAY introduce an in-memory agent domain event runtime only after all four unlock conditions are satisfied in the change set that ships the runtime: (1) a named first consumer is documented, (2) reducer next-state equivalence with the pure reducer path is proven against golden fixtures, (3) the public surface is subscribe-only, and (4) the runtime is in-memory only with negative tests asserting no persistence and no transport. Until all four conditions are satisfied, reducer emit integration and runtime EventBus implementation MUST remain excluded.

If runtime work is unlocked, it MUST reuse the existing `domainEventFactories`, `DOMAIN_EVENT_TYPES`, and derivation fixtures as the schema and equivalence baseline. A separate event taxonomy or duplicate factory layer MUST NOT be introduced.

Existing thread diagnostics, settlement audit callbacks, or event-handler refactors MUST NOT be treated as the named first consumer unless this runtime capability explicitly documents that consumer and proves reducer next-state equivalence. Diagnostic emitters may inform requirements, but they do not by themselves unlock reducer emit integration.

#### Scenario: runtime remains excluded without all four unlock conditions

- **WHEN** any of the four unlock conditions is not satisfied at implementation time
- **THEN** reducer emit integration MUST NOT be added
- **AND** no runtime EventBus MUST be introduced

#### Scenario: first consumer is named and documented

- **WHEN** the runtime is introduced
- **THEN** the change set MUST name a single, documented first consumer with a justified use case
- **AND** the first consumer MUST be an in-memory subscriber, not a UI render dependency
- **AND** existing thread diagnostics or handler-level emit callbacks MUST NOT count as the consumer without a runtime-specific contract

#### Scenario: runtime reuses existing domain event schema

- **WHEN** reducer emit integration is introduced
- **THEN** emitted events MUST be created through the existing domain event factories or a directly compatible migrated wrapper
- **AND** every emitted runtime event type MUST remain within `DOMAIN_EVENT_TYPES`

### Requirement: Reducer Behavior MUST Remain Unchanged If Runtime Emit Is Later Added

If the runtime is introduced, reducer integration MUST prove next-state equivalence with the current pure reducer path against golden action sequences. The equivalence proof MUST be a test that fails when emit hooks perturb reducer next-state.

#### Scenario: reducer next state is preserved under emit hook

- **WHEN** the same action sequence is reduced with and without the emit hook
- **THEN** the reducer next state MUST be byte-equal in both executions
- **AND** the equivalence test MUST be part of the validation suite for the runtime

#### Scenario: equivalence proof regression fails CI

- **WHEN** a change perturbs reducer next-state under emit hook
- **THEN** the equivalence test MUST fail
- **AND** the runtime MUST NOT ship until the regression is resolved

## ADDED Requirements

### Requirement: First Consumer MUST NOT Cause UI Side Effects Directly

The first concrete consumer of the runtime MUST be limited to in-memory consumption such as feeding the governance evidence bridge or aggregating reducer-derived signals. The first consumer MUST NOT render UI directly, MUST NOT call Tauri commands, and MUST NOT mutate persisted state.

#### Scenario: first consumer feeds the bridge or another in-memory sink

- **WHEN** the first consumer is introduced
- **THEN** its observable side effects MUST be limited to producing `GovernanceEvidence` or updating an in-memory aggregator
- **AND** it MUST NOT trigger React re-renders outside the governance audit surface

#### Scenario: first consumer cannot publish events back to the runtime

- **WHEN** application code references the runtime module
- **THEN** no public `publish` or `emit` API MUST be reachable
- **AND** the first consumer MUST only subscribe through the runtime's subscribe-only API

### Requirement: Runtime MUST Have Negative Tests Asserting No Persistence Or Transport

The runtime change set MUST include negative tests that prove no domain event is written to localStorage, IndexedDB, the filesystem, or any backend store, and no domain event is published over Tauri IPC, WebSocket, worker channels, or cloud transports.

#### Scenario: persistence negative tests assert no writes

- **WHEN** the negative test suite runs
- **THEN** the suite MUST assert that localStorage, IndexedDB, and filesystem write APIs are not invoked by the runtime
- **AND** any violation MUST cause a test failure

#### Scenario: transport negative tests assert no publishes

- **WHEN** the negative test suite runs
- **THEN** the suite MUST assert that Tauri IPC, WebSocket, worker `postMessage`, and remote fetch APIs are not invoked by the runtime
- **AND** any violation MUST cause a test failure
