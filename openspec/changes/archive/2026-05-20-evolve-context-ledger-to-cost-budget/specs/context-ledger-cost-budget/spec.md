## ADDED Requirements

### Requirement: Cost Projection MUST Be Computed From Thread / Session Usage Snapshots

The system MUST compute per-turn, per-session, per-engine, and aggregated workspace cost from `ThreadTokenUsage` data already present in `src/types.ts`. Block-level cost attribution MUST NOT be computed in this capability; block estimate values are not authoritative token counts.

#### Scenario: cost projection uses ThreadTokenUsage as the authoritative input

- **WHEN** the system computes a cost projection for an active session
- **THEN** the projection MUST be derived from `ThreadTokenUsage` (turn / session level)
- **AND** the projection MUST NOT consume `ContextLedgerBlock.estimate.value` as a cost base

#### Scenario: block-level cost is explicitly out of scope

- **WHEN** a consumer requests block-level cost from this capability
- **THEN** the capability MUST report "block-level cost not supported in this version"
- **AND** the future block-level attribution MUST require its own follow-up change

### Requirement: Pricing Source MUST Be Traceable On Every Cost Record

Every cost record produced by this capability MUST embed a reference to the pricing source used (engine, model, source kind, last-updated timestamp). The pricing source registry MUST live at `src/features/context-ledger/pricing/` and MUST distinguish at least three source kinds: `fixture`, `config`, `remote`.

#### Scenario: every cost record carries pricing source metadata

- **WHEN** a cost record is produced
- **THEN** the record MUST include `pricingSource.engine`, `pricingSource.model`, `pricingSource.source`, and `pricingSource.lastUpdatedAt`

#### Scenario: pricing source kind drives staleness detection

- **WHEN** `pricingSource.source` is `fixture` and `pricingSource.lastUpdatedAt` is older than the configured staleness threshold
- **THEN** the cost record MUST be marked `degraded: true`
- **AND** the degradation reason MUST be exposable via an i18n key

### Requirement: Unknown Pricing MUST Produce Degraded Cost State, Not Silent Zero

When no pricing source is available for a given engine/model, the system MUST NOT default the cost to zero or to any silent estimate. The cost record MUST be flagged degraded with an explicit reason and the UI MUST surface a degraded indicator.

#### Scenario: missing pricing yields explicit degraded record

- **WHEN** the pricing registry has no entry for an engine/model used in the session
- **THEN** the cost record for that turn MUST set `degraded: true` and `degradationReason: 'pricing-unavailable'`
- **AND** the record MUST NOT contain a numeric cost amount that implies a known price

#### Scenario: cross-engine aggregate flags partial when any engine is degraded

- **WHEN** an aggregate cost is computed across multiple engines and at least one engine is `degraded`
- **THEN** the aggregate MUST set `partial: true`
- **AND** the aggregate MUST expose the per-engine breakdown so the user can identify which engine is degraded

### Requirement: Session Budget MUST Support Three Threshold Tiers Without Forcing Runtime Interruption

The system MUST support per-session budget configuration with three threshold tiers: `info`, `warn`, `block`. Crossing a tier MUST produce a UI signal at the corresponding severity. Crossing the `block` tier MUST NOT forcibly interrupt the runtime in this capability; runtime interruption is the responsibility of a separate policy-chain or runtime change.

#### Scenario: crossing info / warn / block tiers emits matching UI severity

- **WHEN** session cost crosses the `info`, `warn`, or `block` threshold
- **THEN** StatusPanel MUST display the matching severity indicator using i18n-keyed text

#### Scenario: block tier does not forcibly interrupt a running turn

- **WHEN** session cost crosses the `block` threshold mid-turn
- **THEN** this capability MUST NOT terminate the turn
- **AND** the budget signal MUST remain a visual indicator until a separate policy or user action acts on it

### Requirement: Cross-Engine Cost Aggregate MUST NOT Conflate Differing Pricing Sources

The aggregate view MUST allow the user to expand per-engine breakdown and MUST clearly distinguish cost contributions across engines whose pricing sources differ. The aggregate MUST NOT silently sum cost values that originate from different pricing source kinds without exposing the divergence.

#### Scenario: aggregate exposes per-engine breakdown alongside total

- **WHEN** the UI renders an aggregate cost
- **THEN** the per-engine cost breakdown MUST be reachable from the aggregate view
- **AND** any engine whose pricing source kind differs from the dominant source MUST be flagged

### Requirement: StatusPanel Cost Section MUST Behave Consistently In Dock And Popover Hosts

The Cost & Budget section in StatusPanel MUST render with the same data, severity, and i18n behavior in both the dock host and the popover host. Differences between hosts MUST be limited to layout density, not data semantics.

#### Scenario: dock and popover hosts render equivalent cost summary

- **WHEN** the same workspace cost data is rendered in dock and popover
- **THEN** the displayed summary value, currency, and degraded marker MUST be identical
- **AND** any host-specific layout MUST NOT hide degraded state

### Requirement: Cost & Budget i18n Keys MUST Be Provided In Both zh And en

Every user-visible string introduced by this capability MUST be sourced from i18n keys under `statusPanel.cost.*` and `statusPanel.budget.*`. Both `zh` and `en` locale files MUST contain matching keys at the time the spec is synced.

#### Scenario: zh and en keys exist for every new visible string

- **WHEN** CI runs the i18n parity check
- **THEN** every new `statusPanel.cost.*` or `statusPanel.budget.*` key MUST be present in both `zh` and `en`

### Requirement: Cost-Context-Budget Capability MUST Be Validated By CI

The system MUST provide `npm run check:context-ledger-cost-budget` that asserts pricing schema validity, cost projection invariants, budget threshold behavior, and i18n parity. This check MUST pass on three CI platforms.

#### Scenario: CI parity passes on three platforms

- **WHEN** CI executes the cost-context-budget check
- **THEN** the check MUST pass on `ubuntu-latest`, `macos-latest`, and `windows-latest`

#### Scenario: OpenSpec strict validation gates this capability

- **WHEN** CI or release validation runs OpenSpec validation
- **THEN** `openspec validate evolve-context-ledger-to-cost-budget --strict --no-interactive` MUST pass
