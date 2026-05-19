## ADDED Requirements

### Requirement: Checkpoint Audit Surface MUST Explain The Current Verdict Inline

The audit surface MUST render inside the existing `CheckpointPanel` and MUST explain the current verdict from the existing `StatusPanelData.policyAudit` projection.

#### Scenario: audit section is inline and collapsed by default

- **WHEN** `CheckpointPanel` renders with `policyAudit` entries
- **THEN** the verdict badge and next action remain visible
- **AND** the audit section is available inside `CheckpointPanel`
- **AND** the audit section is collapsed by default

#### Scenario: no separate audit tab is created

- **WHEN** StatusPanel tabs are enumerated
- **THEN** no dedicated audit tab MUST be added by this capability

### Requirement: Audit Surface MUST Render Policy Contributions Defensively

Each rendered policy row MUST show the policy id, verdict contribution, reason text when available, and source id when available. The renderer MUST NOT assume an evidence payload exists on `PolicyDecision`.

#### Scenario: every current policy decision is rendered

- **WHEN** the audit section is expanded
- **THEN** each current `policyAudit` entry MUST be represented by one row
- **AND** each row MUST include policy id and contribution
- **AND** each row SHOULD include reason and source id when available

#### Scenario: incomplete policy decision does not crash the panel

- **WHEN** a policy decision has `reasonKey: null`, `sourceId: null`, or `verdictContribution: "no_contribution"`
- **THEN** the audit panel MUST render a safe fallback label
- **AND** no exception MUST be thrown

### Requirement: Audit Surface MUST Not Persist, Export, Or Repair

This capability MUST be read-only for the current verdict. It MUST NOT introduce localStorage history, JSON export, telemetry, or repair actions.

#### Scenario: no audit persistence is introduced

- **WHEN** this capability is implemented
- **THEN** it MUST NOT write audit entries to localStorage, IndexedDB, or filesystem storage

#### Scenario: no repair action is introduced

- **WHEN** audit rows are rendered
- **THEN** they MUST NOT trigger policy repair actions from this capability

### Requirement: Audit Surface MUST Preserve Existing Checkpoint Behavior

Adding the audit surface MUST NOT change existing checkpoint verdict calculation, next-action text, or StatusPanel dock/popover behavior.

#### Scenario: existing checkpoint tests still pass

- **WHEN** existing StatusPanel and checkpoint tests run
- **THEN** existing verdict and next-action assertions MUST remain valid

#### Scenario: dock and popover render equivalent audit content

- **WHEN** dock and popover hosts receive the same `policyAudit`
- **THEN** the rendered audit rows MUST be equivalent

### Requirement: Audit Surface MUST Preserve Governance Workflow Gates And Three-Platform Compatibility

The implementation MUST remain compatible with large-file governance and the final harness-wide noise sentry, and MUST be portable across Linux, macOS, and Windows.

#### Scenario: full noise sentry is deferred to integration closure

- **WHEN** this capability is implemented
- **THEN** full noise sentry execution MAY be deferred to final harness-wide integration closure

#### Scenario: large file governance gate remains compatible

- **WHEN** this capability is implemented
- **THEN** `node --test scripts/check-large-files.test.mjs` MUST pass
- **AND** `npm run check:large-files:near-threshold` MUST pass without hard failures
- **AND** `npm run check:large-files:gate` MUST pass

#### Scenario: rendering tests are three-platform safe

- **WHEN** tests and snapshots are added
- **THEN** they MUST avoid OS-specific path separators, case-sensitive filename assumptions, and CRLF/LF fragile assertions
