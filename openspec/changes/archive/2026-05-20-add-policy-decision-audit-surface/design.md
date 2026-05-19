## Design / 设计

### Current Client Facts

- `src/features/status-panel/types.ts` already exposes `policyAudit` on `StatusPanelData`.
- `src/features/status-panel/utils/checkpoint.ts` already computes `policyAudit` from `evaluatePolicyChain(...)`.
- `src/features/status-panel/components/CheckpointPanel.tsx` is the existing verdict surface and is used in StatusPanel dock/popover contexts.

The right design is therefore not a new audit subsystem. It is a small read-only projection of data already present in the client.

## Decisions

### Decision 1: Inline, Not A New Tab

Render the audit surface as a collapsible section inside `CheckpointPanel`.

Why:
- The user asks "why is this checkpoint blocked?" while looking at the checkpoint.
- A separate tab hides the causal chain.
- Current StatusPanel already carries the data needed for this view.

### Decision 2: Current Verdict Only

Only render the current `policyAudit` array from `StatusPanelData`.

Rejected:
- localStorage history.
- export.
- cross-session audit.

Why:
- The current client has no durable audit-store contract.
- Adding persistence would create privacy and migration questions unrelated to harness governance P0.

### Decision 3: Policy Decision Formatter Is Defensive

`formatPolicyDecision(entry)` must be pure and tolerate:
- missing `reasonKey`.
- missing `sourceId`.
- `no_contribution`.
- unknown `policyId`.

The current `PolicyDecision` contract does not contain an evidence payload. The formatter MUST NOT invent one. It may render `sourceId` as the closest available trace pointer.

### Decision 4: No Repair Action

Do not add repair buttons in this change.

Why:
- Current `PolicyDecision` shape does not expose a stable repair API.
- Adding repair would be a behavior change across policy chain boundaries.
- The first useful step is making verdict causality visible.

### Decision 5: i18n Is Minimal

Use existing policy reason keys where available. Add only generic audit shell keys:
- `statusPanel.audit.title`
- `statusPanel.audit.expandLabel`
- `statusPanel.audit.empty`
- `statusPanel.audit.sourceUnavailable`

## Implementation Shape

- `PolicyDecisionAuditPanel.tsx`
  - receives `policyAudit` as props.
  - renders collapsed by default.
  - has no storage and no side effects.
- `PolicyEntryRow.tsx`
  - renders policy id, contribution, reason text, and source id when available.
- `policyDecisionFormatter.ts`
  - pure formatter for policy decisions without assuming evidence payloads.

## Boundary

This change is complete when a user can expand the current checkpoint and understand which policies contributed to the verdict. Anything beyond that is future work.

## Mandatory Governance Gates

Implementation MUST preserve the large-file workflow gate during staged work and defer the full noise sentry to final harness-wide integration closure:

- Full noise sentry
  - Deferred to final harness-wide integration closure.
- `.github/workflows/large-file-governance.yml`
  - `node --test scripts/check-large-files.test.mjs`
  - `npm run check:large-files:near-threshold`
  - `npm run check:large-files:gate`

The implementation MUST be portable across ubuntu-latest, macos-latest, and windows-latest. Tests and snapshots MUST avoid OS-specific separators, case sensitivity assumptions, and newline-fragile assertions.
