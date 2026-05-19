## MODIFIED Requirements

### Requirement: Session Budget MUST Support Three Threshold Tiers Without Forcing Runtime Interruption

The system MUST support per-session budget configuration with three threshold tiers: `info`, `warn`, `block`. Crossing a tier MUST produce a UI signal at the corresponding severity AND MUST emit a `cost-budget` `GovernanceEvidence` value through the governance evidence bridge. The `block` tier is a cost-budget payload severity only. Crossing the `block` tier MUST NOT forcibly interrupt the runtime from inside this capability; runtime interruption MUST be the responsibility of a separate policy/runtime action contract.

The bridge emission MUST reuse the existing budget threshold semantics from `resolveBudgetThresholdSignal`, including the `shouldInterruptRuntime: false` invariant, instead of introducing a parallel threshold resolver.

#### Scenario: crossing info / warn / block tiers emits matching UI severity

- **WHEN** session cost crosses the `info`, `warn`, or `block` threshold
- **THEN** StatusPanel MUST display the matching severity indicator using i18n-keyed text

#### Scenario: tier crossing emits bridge evidence

- **WHEN** session cost crosses the `info`, `warn`, or `block` threshold
- **THEN** the system MUST emit a `cost-budget` `GovernanceEvidence` value
- **AND** the evidence MUST include `tier`, `currency`, `pricingSource`, and `degraded` fields
- **AND** the evidence `status` MUST map `info` to `pass` or `warn`, `warn` to `warn`, and `block` to at most `warn` unless a separate non-cost runtime failure is present

#### Scenario: bridge emission reuses existing threshold signal

- **WHEN** the cost module emits `cost-budget` evidence
- **THEN** tier, severity, amount, threshold, and runtime-interruption semantics MUST be derived from `resolveBudgetThresholdSignal`
- **AND** the emitted evidence MUST preserve `shouldInterruptRuntime: false` as an invariant

#### Scenario: block tier does not forcibly interrupt a running turn

- **WHEN** session cost crosses the `block` threshold mid-turn
- **THEN** this capability MUST NOT call any runtime termination, cancel, or interrupt API
- **AND** the budget signal MUST remain a visual indicator and a bridge evidence emission until a separate policy or user action acts on it

## ADDED Requirements

### Requirement: Cost Module MUST NOT Call Runtime Interrupt APIs Directly

The cost projection and budget module MUST NOT call any runtime termination, cancellation, or interrupt API. Any runtime-impacting action triggered by budget state MUST flow through an explicit policy/runtime action contract owned by `checkpoint-policy-chain` or a future runtime-action capability.

#### Scenario: cost module has no runtime termination path

- **WHEN** static analysis or code review inspects the cost module
- **THEN** there MUST be no call to runtime termination, cancellation, or interrupt APIs from inside the cost module
- **AND** any proposed addition MUST be rejected by code review or by the cost-budget capability check

#### Scenario: runtime action requires explicit handoff

- **WHEN** a runtime-impacting action is desired in response to a `block`-tier crossing
- **THEN** the action MUST be defined and triggered by a policy/runtime action contract
- **AND** the cost module MUST limit its responsibility to emitting evidence and updating UI signals

### Requirement: Bridge Evidence Emission MUST Reflect Degraded Pricing

When the cost projection is degraded (e.g., missing pricing, stale pricing source) the emitted `cost-budget` evidence MUST set `degraded: true` and include a documented `degradationReason`. The emission MUST NOT silently coerce degraded state to a healthy status.

#### Scenario: missing pricing yields degraded evidence

- **WHEN** the pricing registry has no entry for the active engine/model
- **THEN** the emitted evidence MUST set `degraded: true` and `degradationReason: 'pricing-unavailable'`
- **AND** the evidence MUST NOT report a numeric cost amount that implies a known price

#### Scenario: stale pricing fixture marks evidence stale

- **WHEN** `pricingSource.source` is `fixture` and `pricingSource.lastUpdatedAt` is older than the configured staleness threshold
- **THEN** the emitted evidence MUST set `staleAt` to the evaluated staleness boundary
- **AND** the consumer MUST be able to detect staleness without recomputing the projection

### Requirement: Cost-Budget Bridge-Fed Policy MUST Respect Optional Contribution Ceiling

The cost-budget optional policy in the checkpoint policy chain MUST consume `cost-budget` evidence through the bridge snapshot. Its `verdictContribution` MUST be one of `needs_review`, `running`, `ready`, or `no_contribution`. It MUST NOT contribute `blocked`.

#### Scenario: block-tier evidence yields needs_review at most

- **WHEN** the policy evaluates evidence with `tier: 'block'`
- **THEN** the policy `verdictContribution` MUST be at most `needs_review`
- **AND** the policy MUST NOT return `blocked`
- **AND** the policy MUST NOT call runtime termination, cancellation, or interrupt APIs

#### Scenario: degraded evidence is reflected in audit metadata

- **WHEN** the policy consumes degraded evidence
- **THEN** the policy decision MUST include the `degradationReason` in its audit metadata
- **AND** the policy MUST NOT silently treat degraded evidence as healthy
