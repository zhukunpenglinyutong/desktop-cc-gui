## MODIFIED Requirements

### Requirement: This Phase MUST Not Introduce Route Registry, Rust Router, Or Enforcement

This capability phase MUST NOT add a TS route registry, a Rust router, an ESLint enforcement rule, or an automatic codemod. A staged migration of selected engine-name branches to matrix-backed capability lookups MAY occur, but MUST be limited to the matrix-eligible tier defined by the migration triage and MUST NOT require global rewrites.

#### Scenario: no route registry is introduced

- **WHEN** implementation is complete
- **THEN** there MUST NOT be a new generic capability route registry introduced by this change

#### Scenario: no lint enforcement is introduced

- **WHEN** `npm run lint` runs
- **THEN** existing engine-name branches MUST NOT fail lint because of this change

#### Scenario: staged migration is bounded to matrix-eligible branches

- **WHEN** a branch is migrated to use `getEngineCapabilityState`, `isEngineCapabilityAvailable`, or `useCapability`
- **THEN** the branch MUST be classified `matrix-eligible` by the migration triage
- **AND** the migrated branch MUST preserve its prior user-visible behavior

## ADDED Requirements

### Requirement: Engine-Name Branch Migration Triage MUST Classify Branches Into Three Tiers

The system MUST produce a triage classifying existing engine-name branches into:

- `matrix-eligible` — branches whose semantics map to an existing capability key and that MUST be migrated in this change.
- `runtime-isolated` — branches that gate runtime/process selection and remain unchanged until a runtime-contract follow-up.
- `legacy-allowlist` — branches with documented engine, branch site, reason, and removal owner.

#### Scenario: triage assigns exactly one tier per branch

- **WHEN** the triage runs against the scanner output
- **THEN** each scanned engine-name branch MUST receive exactly one of the three tier classifications
- **AND** branches without a clear tier MUST default to `legacy-allowlist` with an explicit rationale

#### Scenario: legacy-allowlist branches are documented

- **WHEN** a branch is placed in `legacy-allowlist`
- **THEN** the allowlist entry MUST include engine, branch site (file:line), reason, and a removal owner or follow-up reference

### Requirement: Matrix-Backed Capability Mismatches MUST Be Representable As Governance Evidence

When a runtime path detects that an active engine does not support a queried capability, the system MUST be able to produce a `GovernanceEvidence` value of source `engine-capability-matrix` describing the mismatch. The emission MUST occur through the governance evidence bridge, not through UI side effects.

#### Scenario: unsupported capability at runtime emits bridge evidence

- **WHEN** runtime code consults the matrix and finds the active engine declares the queried capability `unsupported` or `unknown`
- **THEN** the system MUST be able to emit `GovernanceEvidence` of source `engine-capability-matrix` describing the mismatch
- **AND** the emission MUST NOT raise an exception in the migrated branch

#### Scenario: explainable degradation is preserved

- **WHEN** a migrated UI branch consults the matrix and finds the capability unavailable
- **THEN** the UI MUST present an i18n-keyed degraded state (hidden, disabled with tooltip, or replaced notice)
- **AND** the UI MUST NOT silently invoke the missing capability

### Requirement: Capability Router Migration Progress MUST Be Re-Runnable And Traceable

The system MUST allow re-running the existing scanner (`scripts/scan-engine-name-branches.mjs` or equivalent) after migration and MUST produce a regression-friendly report. The report MUST allow comparing before/after counts of `engine === "..."` branches and MUST document any growth with rationale.

#### Scenario: re-running the scanner reports migration delta

- **WHEN** the scanner is re-run after migration of the first batch
- **THEN** the report MUST show the delta in `engine === "..."` branch count
- **AND** any growth in branch count MUST include a documented rationale (e.g., new runtime-isolated site)

#### Scenario: scanner output remains read-only and deterministic

- **WHEN** the scanner re-runs
- **THEN** no source file MUST be modified by the scanner
- **AND** the JSON output MUST be byte-stable except for documented timestamp fields

#### Scenario: scanner output is platform-neutral

- **WHEN** the scanner runs on Windows, macOS, and Linux
- **THEN** branch sites in the report MUST use repository-relative POSIX-style paths
- **AND** branch classification MUST NOT depend on native path separators or filesystem case sensitivity
