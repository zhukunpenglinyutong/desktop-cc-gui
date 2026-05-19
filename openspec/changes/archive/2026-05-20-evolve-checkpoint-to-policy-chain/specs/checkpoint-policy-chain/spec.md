## ADDED Requirements

### Requirement: Checkpoint Verdict MUST Be Produced By A Policy Chain

The system MUST compute every checkpoint verdict by running a chain of policies in `src/features/status-panel/utils/policies/` rather than by a monolithic function. The chain MUST always include `corePolicy`. The final verdict MUST be deterministic given the same evidence input.

#### Scenario: corePolicy is always part of the chain

- **WHEN** the system computes a checkpoint verdict
- **THEN** the chain MUST include `corePolicy` regardless of which optional policies are registered

#### Scenario: verdict computation is deterministic

- **WHEN** the same evidence is evaluated twice in the same process
- **THEN** the resulting verdict MUST be identical
- **AND** the policy decision list (audit trail) MUST also be identical

### Requirement: Policy Interface MUST Be Minimal And Pure

Every policy MUST conform to a `Policy` interface that exposes `id: string`, `appliesTo(evidence) → boolean`, and `evaluate(evidence) → PolicyDecision`. The `evaluate` function MUST be a pure function with no I/O, no logging, and no mutation of evidence input.

#### Scenario: policy interface is enforced at type level

- **WHEN** a new policy is added to the registry
- **THEN** TypeScript MUST enforce conformance to the `Policy` interface
- **AND** non-conforming code MUST fail typecheck

#### Scenario: policy evaluate function does not mutate evidence

- **WHEN** a policy `evaluate` function is invoked with an evidence object
- **THEN** the evidence object MUST be the same reference and the same field values before and after the call
- **AND** the policy MUST NOT perform network or filesystem I/O during `evaluate`

### Requirement: Verdict Chain Composition MUST Use "Most Severe Wins" With Audit Trail

When multiple policies contribute, the final verdict MUST equal the most severe `verdictContribution` from the collected decisions, where severity follows the order `blocked` > `needs_review` > `running` > `ready` > `no_contribution`. All non-`no_contribution` reasons MUST be retained in the audit trail.

#### Scenario: most severe contribution wins

- **WHEN** policies contribute `ready` and `needs_review`
- **THEN** the final verdict MUST be `needs_review`

#### Scenario: ties retain all reasons in audit trail

- **WHEN** multiple policies contribute the same severity
- **THEN** the final verdict MUST be that shared severity
- **AND** the audit trail MUST list every contributing reason in registration order

#### Scenario: no_contribution does not affect the final verdict

- **WHEN** a policy returns `no_contribution`
- **THEN** the final verdict MUST be computed as if that policy were absent
- **AND** the audit trail MAY still list the policy decision for traceability

### Requirement: Existing Checkpoint UX MUST Have Zero Regression

The four-state verdict (`running` / `blocked` / `needs_review` / `ready`) and existing `nextAction` semantics MUST remain behaviorally identical to the pre-change checkpoint implementation. All existing assertions in `src/features/status-panel/utils/checkpoint.test.ts` MUST continue to pass without modification.

#### Scenario: every existing checkpoint test continues to pass

- **WHEN** the test suite executes `checkpoint.test.ts`
- **THEN** every existing assertion MUST pass without modification

#### Scenario: dock and popover hosts retain identical verdict UX

- **WHEN** the StatusPanel renders the same verdict in dock vs popover
- **THEN** the verdict label, severity coloring, and i18n text MUST remain identical to the pre-change baseline

### Requirement: First-Batch Optional Policies MUST Be Plug-Ins Over Existing Validation Evidence

The first batch of optional policies MUST consume only the existing `CheckpointValidationEvidence` shape (`kind: 'lint' | 'typecheck' | 'tests' | 'build' | 'custom'` and `status: 'pass' | 'fail' | 'running' | 'not_run' | 'not_observed'`). External signals such as `check-large-files` output or OpenSpec validate caches MUST NOT be introduced in this change.

#### Scenario: first-batch policies cover lint, typecheck, and tests

- **WHEN** evidence contains validation entries
- **THEN** policies `lintValidationPolicy`, `typecheckValidationPolicy`, and `testsValidationPolicy` MUST evaluate against `validations[].kind === 'lint' / 'typecheck' / 'tests'` respectively

#### Scenario: external signal sources are deferred to follow-up changes

- **WHEN** a proposed policy depends on a signal that is not present in the existing evidence shape
- **THEN** that policy MUST NOT be added in this change
- **AND** the dependency MUST be introduced via a separate OpenSpec change for an evidence bridge

### Requirement: Optional Policy Contribution Ceiling MUST Be `needs_review`

Optional policies in the first batch MUST NOT contribute `blocked`. Their maximum contribution severity MUST be `needs_review`. Only `corePolicy` MAY contribute `blocked` (for runtime / fatal failures).

#### Scenario: optional policy never raises verdict to blocked

- **WHEN** an optional policy evaluates evidence
- **THEN** its `verdictContribution` MUST be one of `needs_review`, `running`, `ready`, or `no_contribution`
- **AND** it MUST NOT return `blocked`

### Requirement: Audit Trail MUST Be Bounded And Structured

The system MUST retain the most recent checkpoint audit entries in memory only, bounded by a maximum buffer size (initial: 50 entries). Audit entries MUST NOT be persisted to disk by this capability.

#### Scenario: audit buffer enforces maximum size

- **WHEN** the audit buffer reaches its configured maximum
- **THEN** the oldest entry MUST be evicted in FIFO order

#### Scenario: audit entries are not written to disk

- **WHEN** an audit entry is produced
- **THEN** this capability MUST NOT write the entry to any filesystem path

### Requirement: Policy i18n Keys MUST Be Provided In zh And en

Every policy reason and repair action MUST be sourced from i18n keys under `statusPanel.policy.{policyId}.*`. Both `zh` and `en` locale files MUST contain matching keys at the time the spec is synced.

#### Scenario: zh and en parity for policy keys

- **WHEN** CI runs i18n parity check
- **THEN** every new `statusPanel.policy.*` key MUST exist in both `zh` and `en`

### Requirement: Policy Chain Capability MUST Be Validated By CI On Three Platforms

The system MUST provide `npm run check:checkpoint-policy-chain` that exercises chain composition, audit trail bounding, and first-batch policy behavior. The check MUST pass on `ubuntu-latest`, `macos-latest`, and `windows-latest`.

#### Scenario: policy chain CI parity passes on three platforms

- **WHEN** CI executes the checkpoint-policy-chain check
- **THEN** the check MUST pass on Linux, macOS, and Windows runners

#### Scenario: OpenSpec strict validation gates this capability

- **WHEN** CI or release validation runs OpenSpec validation
- **THEN** `openspec validate evolve-checkpoint-to-policy-chain --strict --no-interactive` MUST pass
