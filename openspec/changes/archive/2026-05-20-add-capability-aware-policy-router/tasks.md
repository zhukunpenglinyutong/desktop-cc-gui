## 1. Capability Hook

- [x] 1.1 [P0] Implement thin `useCapability(capability, engineOverride?)` wrapper around existing matrix helpers.
- [x] 1.2 [P0] Test active-engine, runtime-status, and override behavior.
- [x] 1.3 [P0] Ensure unknown capability names fail at typecheck time through existing `EngineCapabilityKey`.

## 2. Read-Only Scanner

- [x] 2.1 [P1] Implement deterministic scanner for engine-name branches.
- [x] 2.2 [P1] Add scanner tests for path normalization, allowlist marker, and stable output.
- [x] 2.3 [P1] Add optional check script entry if implementation warrants it.

## 3. Validation

- [x] 3.1 [P0] Run `npm run typecheck`.
- [x] 3.2 [P0] Run engine capability matrix tests/check.
- [x] 3.3 [P0] Run `node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs`.
- [x] 3.4 [P0] Run `npm run check:heavy-test-noise`.
- [x] 3.5 [P0] Run `node --test scripts/check-large-files.test.mjs`.
- [x] 3.6 [P0] Run `npm run check:large-files:near-threshold`.
- [x] 3.7 [P0] Run `npm run check:large-files:gate`.
- [x] 3.8 [P0] Confirm scanner/tests normalize paths and avoid shell-only, case-sensitive, or newline-fragile assumptions.
- [x] 3.9 [P0] Run `openspec validate add-capability-aware-policy-router --strict --no-interactive`.

### Blocked Validation Notes

- 3.7 was unblocked by extracting thread-list helpers from `src/features/threads/hooks/useThreadActions.ts` into `useThreadActions.threadList.ts`; `npm run check:large-files:gate` now passes.
