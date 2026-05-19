## 1. Policy Decision Formatter

- [x] 1.1 [P0] Implement a pure formatter for current `policyAudit` entries.
- [x] 1.2 [P0] Add formatter tests for missing reason, missing sourceId, no_contribution, and unknown policy id.

## 2. Inline Audit UI

- [x] 2.1 [P0] Add a small `PolicyDecisionAuditPanel` under `CheckpointPanel`.
- [x] 2.2 [P0] Render policy id, contribution, reason, and sourceId when available.
- [x] 2.3 [P0] Keep the audit section collapsed by default and side-effect free.
- [x] 2.4 [P0] Add component tests for populated, empty, and incomplete policy decisions.

## 3. CheckpointPanel Integration

- [x] 3.1 [P0] Wire the panel to existing `StatusPanelData.policyAudit`.
- [x] 3.2 [P0] Preserve existing verdict and next-action rendering.
- [x] 3.3 [P0] Add dock/popover parity coverage through existing StatusPanel tests.

## 4. i18n

- [x] 4.1 [P0] Add minimal `statusPanel.audit.*` keys in zh/en.
- [x] 4.2 [P0] Verify no raw user-visible English strings are introduced.

## 5. Validation

- [x] 5.1 [P0] Run `npm run typecheck`.
- [x] 5.2 [P0] Run targeted StatusPanel/checkpoint tests.
- [x] 5.3 [P0] Run `npm run check:checkpoint-policy-chain`.
- [x] 5.4 [P0] Run `node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs`.
- [x] 5.5 [P0] Defer full noise sentry to final harness-wide integration closure.
- [x] 5.6 [P0] Run `node --test scripts/check-large-files.test.mjs`.
- [x] 5.7 [P0] Run `npm run check:large-files:near-threshold`.
- [x] 5.8 [P0] Run `npm run check:large-files:gate`.
- [x] 5.9 [P0] Confirm implementation has no OS-specific path separators, case-sensitive filename assumptions, or newline-fragile snapshots.
- [x] 5.10 [P0] Run `openspec validate add-policy-decision-audit-surface --strict --no-interactive`.

### Deferred / Blocked Validation Notes

- 5.5 is intentionally deferred for stage efficiency. The full noise sentry remains a final harness-wide integration closure gate.
- 5.8 was unblocked by extracting thread-list helpers from `src/features/threads/hooks/useThreadActions.ts` into `useThreadActions.threadList.ts`; `npm run check:large-files:gate` now passes.
