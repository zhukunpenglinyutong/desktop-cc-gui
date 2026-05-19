## ADDED Requirements

### Requirement: Capability Hook MUST Reuse Existing Matrix Helpers

The system MUST expose a React hook for capability lookup. The hook MUST reuse existing matrix helpers such as `getEngineCapabilityState`, `isEngineCapabilityAvailable`, or `resolveEngineCapabilityRuntimeStatus` instead of duplicating capability query semantics.

#### Scenario: hook returns supported state through existing matrix semantics

- **WHEN** the hook is called for an engine and capability that the matrix marks supported
- **THEN** it MUST return `supported: true`
- **AND** it MUST identify the engine and capability that were queried

#### Scenario: hook returns unsupported state through existing matrix semantics

- **WHEN** the hook is called for an engine and capability that the matrix marks unsupported
- **THEN** it MUST return `supported: false`

#### Scenario: unknown capability key is rejected by TypeScript

- **WHEN** code attempts to query a capability not present in `EngineCapabilityKey`
- **THEN** TypeScript MUST reject the call

### Requirement: Capability Hook MUST Resolve Active Or Override Engine

The React hook MUST resolve the active engine/runtime status unless an override is supplied, then delegate to existing matrix helpers.

#### Scenario: hook uses active engine by default

- **WHEN** `useCapability(capability)` is called without an override
- **THEN** the hook MUST query the active engine

#### Scenario: hook respects engine override

- **WHEN** `useCapability(capability, engineOverride)` is called
- **THEN** the hook MUST query `engineOverride`

### Requirement: Engine-Name Branch Scanner MUST Be Read-Only And Deterministic

The scanner MUST report existing engine-name branches without modifying source files or enforcing lint failures.

#### Scenario: scanner does not modify files

- **WHEN** the scanner runs
- **THEN** no source file content MUST be changed

#### Scenario: scanner output is stable

- **WHEN** the scanner runs twice on unchanged input
- **THEN** the JSON output MUST be byte-stable except for explicitly documented timestamp fields

### Requirement: This Phase MUST Not Introduce Route Registry, Rust Router, Or Enforcement

This capability phase MUST NOT add a TS route registry, Rust router, ESLint enforcement rule, or automatic codemod.

#### Scenario: no route registry is introduced

- **WHEN** implementation is complete
- **THEN** there MUST NOT be a new generic capability route registry introduced by this change

#### Scenario: no lint enforcement is introduced

- **WHEN** `npm run lint` runs
- **THEN** existing engine-name branches MUST NOT fail lint because of this change

### Requirement: Capability Hook And Scanner MUST Preserve Governance Workflow Gates And Three-Platform Compatibility

The implementation MUST remain compatible with large-file governance and the final harness-wide noise sentry, and scanner behavior MUST be deterministic across Linux, macOS, and Windows.

#### Scenario: full noise sentry is deferred to integration closure

- **WHEN** this capability is implemented
- **THEN** full noise sentry execution MAY be deferred to final harness-wide integration closure

#### Scenario: large file governance gate remains compatible

- **WHEN** this capability is implemented
- **THEN** `node --test scripts/check-large-files.test.mjs` MUST pass
- **AND** `npm run check:large-files:near-threshold` MUST pass without hard failures
- **AND** `npm run check:large-files:gate` MUST pass

#### Scenario: scanner output is three-platform safe

- **WHEN** scanner tests run on ubuntu-latest, macos-latest, and windows-latest
- **THEN** output MUST normalize path separators
- **AND** it MUST avoid shell-only behavior, case-sensitive filename assumptions, and CRLF/LF fragile assertions
