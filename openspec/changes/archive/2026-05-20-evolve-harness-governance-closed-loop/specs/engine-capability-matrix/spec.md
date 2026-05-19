## MODIFIED Requirements

### Requirement: UI MUST Provide Explainable Degradation For Unsupported Capabilities

When a capability state for the active engine is `unsupported` or `unknown`, UI surfaces that depend on that capability MUST provide an explainable degraded state (hidden, disabled with tooltip, or replaced with a notice) rather than silently failing or silently invoking the missing capability. In addition, runtime detection of a capability mismatch MUST be representable as a `GovernanceEvidence` value of source `engine-capability-matrix` through the governance evidence bridge.

Evidence emission MUST reuse existing matrix helpers (`getEngineCapabilityState`, `isEngineCapabilityAvailable`, `resolveEngineCapabilityRuntimeStatus`, and `useCapability` where appropriate) rather than duplicating capability semantics.

#### Scenario: unsupported capability UI surface degrades with i18n reason

- **WHEN** the active engine declares a capability `unsupported` or `unknown`
- **THEN** the corresponding UI control MUST be hidden, disabled, or replaced with a degraded notice
- **AND** the degraded notice MUST use an i18n key, not hard-coded text

#### Scenario: runtime mismatch produces bridge evidence

- **WHEN** runtime code consults the matrix and detects that the active engine does not support the queried capability
- **THEN** the system MUST be able to emit a `GovernanceEvidence` value of source `engine-capability-matrix`
- **AND** the evidence MUST identify the engine, the capability key, and the detected mismatch state

#### Scenario: evidence emission reuses runtime capability status

- **WHEN** runtime status is available for an engine capability
- **THEN** evidence payload fields for `specState`, `runtimeState`, and `available` MUST be derived from `resolveEngineCapabilityRuntimeStatus`
- **AND** no separate capability state projection table MUST be introduced

#### Scenario: capability lookup misuse is detectable by typecheck

- **WHEN** a UI surface invokes an engine capability without first consulting the matrix
- **THEN** the matrix MUST expose lookup helpers with types that encourage the consultation pattern
- **AND** the spec MUST require new feature work to use the lookup helpers (existing hard-coded engine branches are grandfathered)

## ADDED Requirements

### Requirement: Unknown And Pending-Inventory Cells MUST Be Representable As Governance Evidence

The system MUST allow the matrix to surface `unknown` cells, pending inventory items, and TS/Rust divergence as `GovernanceEvidence` of source `engine-capability-matrix`. The evidence MUST distinguish the three classes through explicit `payload` fields rather than overloading a single status.

#### Scenario: unknown cell produces dedicated evidence payload

- **WHEN** a matrix cell is `unknown`
- **THEN** the system MUST be able to emit evidence with `payload.kind = 'unknown-cell'`
- **AND** the payload MUST identify the engine and the capability key

#### Scenario: TS/Rust divergence produces divergence evidence

- **WHEN** the capability matrix check detects disagreement between the spec fixture, the TS matrix, and the Rust matrix
- **THEN** the system MUST be able to emit evidence with `payload.kind = 'matrix-divergence'`
- **AND** the payload MUST identify the divergent cell and the disagreeing source

### Requirement: Capability Evidence Emission MUST NOT Replace The Existing Matrix Check

The bridge evidence path MUST be additive to the existing `npm run check:engine-capability-matrix` validation. The CLI check remains authoritative for CI gating; bridge evidence is a complementary signal for UI/audit consumers. The bridge evidence emission MUST NOT silently mask a CI failure.

#### Scenario: CLI check remains authoritative

- **WHEN** `npm run check:engine-capability-matrix` reports a failure
- **THEN** the bridge evidence emission MUST NOT downgrade or suppress that failure
- **AND** CI MUST still treat the CLI exit code as authoritative

#### Scenario: bridge evidence is advisory in UI

- **WHEN** the UI consumes matrix evidence from the bridge
- **THEN** the UI MAY surface the evidence as an explanatory signal
- **AND** the UI MUST NOT replace the CLI check with a runtime-only signal
