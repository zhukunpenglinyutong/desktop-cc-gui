## MODIFIED Requirements

### Requirement: First-Batch Optional Policies MUST Be Plug-Ins Over Existing Validation Evidence

Optional policies MUST consume the existing `CheckpointValidationEvidence` shape (`kind: 'lint' | 'typecheck' | 'tests' | 'build' | 'custom'` and `status: 'pass' | 'fail' | 'running' | 'not_run' | 'not_observed'`) OR a frozen `GovernanceEvidence` snapshot supplied through the checkpoint policy evidence input. Optional policies MUST NOT call check scripts directly, MUST NOT shell out, MUST NOT perform filesystem reads, MUST NOT read OpenSpec or governance files during `evaluate`, and MUST NOT import React hooks or Tauri workspace readers.

#### Scenario: first-batch policies cover lint, typecheck, and tests

- **WHEN** evidence contains validation entries
- **THEN** policies `lintValidationPolicy`, `typecheckValidationPolicy`, and `testsValidationPolicy` MUST evaluate against `validations[].kind === 'lint' / 'typecheck' / 'tests'` respectively

#### Scenario: bridge-fed policies consume only the frozen snapshot

- **WHEN** a bridge-fed optional policy evaluates evidence
- **THEN** it MUST read only fields exposed by the `GovernanceEvidence` snapshot
- **AND** it MUST NOT call check scripts, perform filesystem I/O, or open network sockets
- **AND** it MUST NOT call `useGovernanceEvidence`, `getWorkspaceFiles`, or `readWorkspaceFile`

#### Scenario: checkpoint evidence carries the bridge snapshot

- **WHEN** checkpoint data is projected for policy evaluation
- **THEN** the frozen bridge snapshot MUST be present on `CheckpointPolicyEvidence` or an explicitly named nested field
- **AND** the field MUST be optional or backward compatible so existing validation-only policies still compile

#### Scenario: external signal sources are introduced only through the bridge

- **WHEN** a proposed policy depends on a signal not present in `CheckpointValidationEvidence`
- **THEN** that signal MUST be available through the governance evidence bridge as a `GovernanceEvidence` variant
- **AND** the policy MUST consume it through the bridge snapshot, not by reading raw files

## ADDED Requirements

### Requirement: Bridge-Fed Optional Policies MUST Respect The Optional Policy Contribution Ceiling

Bridge-fed optional policies MUST NOT contribute `blocked`. Their maximum contribution severity MUST be `needs_review`. Only `corePolicy` MAY contribute `blocked`.

#### Scenario: bridge-fed cost budget policy contributes at most needs_review

- **WHEN** a cost-budget bridge-fed policy evaluates a `block`-tier evidence
- **THEN** the policy `verdictContribution` MUST be at most `needs_review`
- **AND** it MUST NOT return `blocked`
- **AND** any runtime-impacting action MUST be expressed as a separate policy/runtime action handoff, not as the policy verdict contribution

#### Scenario: bridge-fed harness gate policy contributes at most needs_review

- **WHEN** a harness-gate bridge-fed policy evaluates evidence whose consolidated status is `fail`
- **THEN** the policy `verdictContribution` MUST be at most `needs_review`
- **AND** the policy MUST NOT return `blocked`

### Requirement: Bridge-Fed Decisions MUST Be Traceable In The Audit Trail

Every bridge-fed policy decision MUST include the originating evidence `source`, an `evidenceSnapshotId` identifying the snapshot used, a `reasonKey` for i18n rendering, and, when applicable, the `degradationReason` or `staleAt` flag from the evidence.

#### Scenario: audit entry includes evidence source and snapshot id

- **WHEN** a bridge-fed policy emits a non-`no_contribution` decision
- **THEN** the audit entry MUST include `sourceId` matching the evidence `source`
- **AND** the audit entry MUST include an `evidenceSnapshotId` that identifies the snapshot used

#### Scenario: existing policy decision fields remain backward compatible

- **WHEN** bridge-fed audit metadata is added to `PolicyDecision`
- **THEN** existing policies that only provide `policyId`, `verdictContribution`, `reasonKey`, and `sourceId` MUST remain valid
- **AND** the audit renderer MUST handle missing bridge metadata without throwing

#### Scenario: degraded evidence is reflected in the audit entry

- **WHEN** a bridge-fed policy consumes evidence with `degraded: true`
- **THEN** the audit entry MUST surface the `degradationReason`
- **AND** the audit entry SHOULD NOT silently promote degraded evidence to `pass` status

### Requirement: Bridge-Fed Policies MUST Remain Deterministic Within A Snapshot

When a bridge-fed policy is evaluated twice within the same snapshot identity, the resulting decisions MUST be identical, including reason text, contribution severity, and audit metadata. The snapshot identity is provided by the governance evidence bridge.

#### Scenario: identical snapshot produces identical decision

- **WHEN** the same bridge-fed policy is evaluated twice against the same snapshot identity
- **THEN** the two decisions MUST be deeply equal
- **AND** the audit metadata MUST be identical
