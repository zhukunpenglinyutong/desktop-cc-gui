## Implementation Evidence

Current branch: `feature/v0.5.0-md`

### Implemented

- Policy interfaces: `src/features/status-panel/utils/policies/policyTypes.ts`
- Behavior-equivalent core policy: `corePolicy.ts`
- Registry, chain composition, bounded in-memory audit buffer: `policyRegistry.ts`
- First-batch validation policies: `validationPolicies.ts`
- Checkpoint verdict path now uses `evaluatePolicyChain`.
- Checkpoint UI now exposes a default-collapsed policy audit section in `CheckpointPanel.tsx`.
- i18n keys: `statusPanel.policy.*`
- Checker: `scripts/check-checkpoint-policy-chain.mjs`

### Validation

- `npm run check:checkpoint-policy-chain`: pass
- `npm exec vitest run src/features/status-panel/utils/checkpoint.test.ts src/features/status-panel/utils/policies/policyRegistry.test.ts src/features/status-panel/utils/policies/validationPolicies.test.ts`: pass
- `npm run typecheck`: pass

### Deferred

- External signal policies remain deferred.
- Persistent audit trail remains deferred; the audit buffer is bounded and in-memory only.

### Completion Review

- Existing checkpoint UX keeps the same four verdict states and next-action semantics; policy audit is default-collapsed.
- Follow-up backlog: large-file signal bridge, OpenSpec validate signal bridge, cost-aware policy, persistent audit trail.
- Residual risk: first-batch optional policies consume only existing validation evidence and cannot observe external gates until an evidence bridge exists.
