## ADDED Requirements

### Requirement: Engine Capability Matrix MUST Be A Single Source Of Truth

The system MUST maintain one capability matrix, owned by this spec, that declares each supported engine's stance on each capability dimension. Both the TypeScript matrix at `src/features/engine/engineCapabilityMatrix.ts` and the Rust matrix at `src-tauri/src/engine/capability_matrix.rs` MUST be derived from, and consistent with, this spec-owned matrix.

#### Scenario: TS matrix and Rust matrix agree with the spec matrix

- **WHEN** CI runs `npm run check:engine-capability-matrix`
- **THEN** every `(engine, capability)` cell in TS, Rust, and the spec fixture MUST agree on the same capability state value
- **AND** any divergence MUST cause a CI failure

#### Scenario: capability matrix update MUST go through an OpenSpec change

- **WHEN** a capability dimension is added, removed, or any cell value changes
- **THEN** the modification MUST be performed via an OpenSpec change with an associated spec delta
- **AND** ad-hoc edits to TS or Rust matrix constants without a corresponding spec change MUST be rejected by CI

### Requirement: Capability State MUST Use Four-Value Enum

Each cell of the capability matrix MUST take exactly one of four state values: `supported`, `compat-input`, `unsupported`, `unknown`. Boolean state MUST NOT be used to express capability stance.

#### Scenario: capability state values are exclusively the documented four

- **WHEN** a capability cell is queried at runtime or in tests
- **THEN** the returned state MUST be one of `supported` / `compat-input` / `unsupported` / `unknown`
- **AND** any other value MUST be rejected by typecheck or schema validation

#### Scenario: unknown state is treated as unsupported by consumers

- **WHEN** a consumer queries a capability whose state is `unknown`
- **THEN** the consumer MUST treat it as functionally `unsupported` for UX degradation purposes
- **AND** the matrix MUST flag `unknown` cells as "pending inventory" for follow-up resolution

### Requirement: Capability Naming MUST Use Dot-Separated Dimension Keys

Capability keys MUST follow the form `<domain>.<sub>` or `<domain>.<sub>.<sub>` using lowercase kebab-case within each segment. Domain prefixes MUST be drawn from a limited, spec-owned set (initial: `streaming` / `tool` / `hook` / `memory` / `subagent` / `cost` / `session` / `image` / `compaction`).

#### Scenario: every capability key matches the documented naming form

- **WHEN** a capability key is registered in the matrix
- **THEN** it MUST match `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$`
- **AND** its top-level domain MUST be one of the spec-owned domain prefixes

#### Scenario: adding a new domain prefix requires a spec change

- **WHEN** a new capability proposes a domain prefix outside the documented set
- **THEN** the change MUST add the prefix to the spec-owned domain list before adding the capability

### Requirement: UI MUST Provide Explainable Degradation For Unsupported Capabilities

When a capability state for the active engine is `unsupported` or `unknown`, UI surfaces that depend on that capability MUST provide an explainable degraded state (hidden, disabled with tooltip, or replaced with a notice) rather than silently failing or silently invoking the missing capability.

#### Scenario: unsupported capability UI surface degrades with i18n reason

- **WHEN** the active engine declares a capability `unsupported` or `unknown`
- **THEN** the corresponding UI control MUST be hidden, disabled, or replaced with a degraded notice
- **AND** the degraded notice MUST use an i18n key, not hard-coded text

#### Scenario: capability lookup misuse is detectable by typecheck

- **WHEN** a UI surface invokes an engine capability without first consulting the matrix
- **THEN** the matrix MUST expose lookup helpers with types that encourage the consultation pattern
- **AND** the spec MUST require new feature work to use the lookup helpers (existing hard-coded engine branches are grandfathered)

### Requirement: Capability Inventory Phase MUST Resolve Every Cell Before Spec Ships

Before this capability spec is synced to `openspec/specs/`, every `(engine, capability)` cell MUST be resolved against three sources of truth: the TypeScript `EngineFeatures` at `src/types.ts`, the Rust `EngineFeatures::{claude,codex,gemini,opencode}()` at `src-tauri/src/engine/mod.rs`, and at least one adapter or loader test asserting the behavior.

#### Scenario: inventory phase verifies image.input against TS imageInput and Rust image_input

- **WHEN** the inventory phase records the `image.input` row
- **THEN** the value MUST agree with both TS `EngineFeatures.imageInput` and Rust `EngineFeatures::<engine>().image_input`
- **AND** any disagreement MUST be resolved before the spec is finalized

#### Scenario: inventory phase verifies tool.mcp against Rust mcp field

- **WHEN** the inventory phase records the `tool.mcp` row
- **THEN** the value MUST agree with Rust `EngineFeatures::<engine>().mcp`
- **AND** the OpenCode `tool.mcp` cell MUST reflect that Rust currently reports `mcp=false`

### Requirement: Engine Capability Matrix MUST Be Validated By CI On Three Platforms

The system MUST provide a `npm run check:engine-capability-matrix` command that compares spec fixture, TS matrix, and Rust matrix. This check MUST pass on `ubuntu-latest`, `macos-latest`, and `windows-latest` runners.

#### Scenario: CI parity check passes on three platforms

- **WHEN** CI executes the engine-capability-matrix check
- **THEN** the check MUST pass on Linux, macOS, and Windows runners

#### Scenario: spec-only matrix change without TS/Rust update fails CI

- **WHEN** an OpenSpec change modifies the matrix without updating TS or Rust
- **THEN** the CI check MUST report the disagreement and fail
