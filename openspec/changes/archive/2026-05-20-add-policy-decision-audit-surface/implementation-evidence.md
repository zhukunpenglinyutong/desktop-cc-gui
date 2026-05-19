## Implementation Evidence

Current branch: `feature/v0.5.0-md`

### Implemented

- Policy decision formatter: `src/features/status-panel/utils/audit/policyDecisionFormatter.ts`
- Formatter tests: `src/features/status-panel/utils/audit/policyDecisionFormatter.test.ts`
- Default-collapsed audit panel: `src/features/status-panel/components/audit/PolicyDecisionAuditPanel.tsx`
- Audit row renderer: `src/features/status-panel/components/audit/PolicyEntryRow.tsx`
- Component tests: `src/features/status-panel/components/audit/PolicyDecisionAuditPanel.test.tsx`
- StatusPanel/CheckpointPanel integration via existing `StatusPanelData.policyAudit`.

### Current Code Facts

- Empty audit arrays render no audit surface.
- Populated audit arrays render policy id, verdict contribution, reason, and source id when available.
- Missing `reasonKey` and `sourceId` degrade to explicit i18n fallbacks.
- The audit UI is collapsed by default and side-effect free.
- The existing checkpoint verdict and next-action rendering remain owned by the policy chain.

### Validation

- `openspec validate add-policy-decision-audit-surface --strict --no-interactive`: pass on 2026-05-20.
- Prior recorded validation in `tasks.md` includes typecheck, targeted StatusPanel/checkpoint tests, `npm run check:checkpoint-policy-chain`, heavy-test-noise script tests, large-file gates, portability review, and strict OpenSpec validation.

### Runtime Boundary

- This change exposes already-computed policy decisions.
- It does not add persistence, telemetry, export, or a new policy source.

### Completion Review

- Residual risk: the surface can only explain decisions currently present in `policyAudit`; external governance signals still require an evidence bridge.
- Follow-up backlog: OpenSpec validation signal bridge, large-file signal bridge, persistent audit trail, and cross-workspace governance view.
- Archive posture: ready after final harness-wide validation confirms no concurrent implementation drift.
