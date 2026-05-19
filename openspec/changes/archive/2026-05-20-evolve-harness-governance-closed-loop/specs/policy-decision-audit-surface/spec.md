## MODIFIED Requirements

### Requirement: Audit Surface MUST Render Policy Contributions Defensively

Each rendered policy row MUST show the policy id, verdict contribution, reason text when available, source id when available, and — for bridge-fed decisions — the `evidenceSnapshotId`, `degradationReason`, and `staleAt` when present. The renderer MUST NOT assume an evidence payload exists on `PolicyDecision`.

#### Scenario: every current policy decision is rendered

- **WHEN** the audit section is expanded
- **THEN** each current `policyAudit` entry MUST be represented by one row
- **AND** each row MUST include policy id and contribution
- **AND** each row SHOULD include reason and source id when available

#### Scenario: bridge-fed decision row includes evidence metadata

- **WHEN** a row corresponds to a bridge-fed policy decision
- **THEN** the row MUST display the evidence `source`, the `evidenceSnapshotId`, and the `degradationReason` or `staleAt` flag when present
- **AND** the row MUST surface degraded or stale state with an i18n-keyed indicator

#### Scenario: incomplete policy decision does not crash the panel

- **WHEN** a policy decision has `reasonKey: null`, `sourceId: null`, or `verdictContribution: "no_contribution"`
- **THEN** the audit panel MUST render a safe fallback label
- **AND** no exception MUST be thrown

## ADDED Requirements

### Requirement: Audit Surface MUST Render The Consolidated Harness Gate Decision

When a consolidated harness gate decision is present (from the `harness-governance-gate-consolidation` capability), the audit surface MUST render its per-gate contributions inline within the existing `CheckpointPanel`. The render MUST list each contributing gate id, status, and `degradationReason` when present.

#### Scenario: consolidated gate decision shows per-gate breakdown

- **WHEN** the audit section renders a decision that consumed the consolidated harness gate
- **THEN** the panel MUST list each contributing gate id and status
- **AND** advisory gates MUST be visually distinguishable from blocking gates

#### Scenario: no separate audit tab is added for consolidated gates

- **WHEN** the audit surface is rendered
- **THEN** the consolidated gate breakdown MUST appear inside `CheckpointPanel`
- **AND** no dedicated audit tab MUST be added by this capability

### Requirement: Governance Evidence List And Policy Audit MUST Share Snapshot Traceability

The existing `GovernanceEvidenceSection` remains the read-only evidence list, and `PolicyDecisionAuditPanel` remains the policy decision audit trail. Bridge-fed policy decisions MUST link back to the same bridge snapshot and source ids rendered by the evidence list. The implementation MUST NOT introduce a third StatusPanel governance dashboard or duplicate evidence panel.

#### Scenario: audit decision links to evidence snapshot

- **WHEN** a bridge-fed policy decision is rendered
- **THEN** the audit row MUST expose the `evidenceSnapshotId` and evidence source id
- **AND** the source id MUST match an evidence entry in the snapshot used for evaluation

#### Scenario: existing governance evidence section is preserved

- **WHEN** StatusPanel dock checkpoint renders governance evidence
- **THEN** `GovernanceEvidenceSection` or its migrated equivalent MUST continue to render the evidence list
- **AND** the consolidated policy audit MUST NOT replace the evidence list with a dashboard-only view

### Requirement: Audit Surface MUST NOT Persist, Export, Or Mutate Bridge Evidence

The audit surface remains read-only with respect to both policy decisions and bridge evidence. It MUST NOT export evidence JSON, MUST NOT write audit entries to localStorage / IndexedDB / filesystem, and MUST NOT mutate the bridge snapshot when rendering.

#### Scenario: audit surface does not export bridge evidence

- **WHEN** a row is interacted with
- **THEN** the audit surface MUST NOT provide an export, copy-to-clipboard, or upload action for bridge evidence in this change
- **AND** any future export action MUST be introduced via a separate OpenSpec change

#### Scenario: audit rendering does not mutate the snapshot

- **WHEN** the audit surface reads the bridge snapshot
- **THEN** the snapshot reference and field values MUST remain unchanged after rendering
- **AND** the rendering MUST NOT trigger source adapters to re-run
