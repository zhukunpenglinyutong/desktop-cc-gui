# Verification

## Commands Run

- `openspec validate evolve-harness-governance-closed-loop --strict --no-interactive`
  - Result: pass.
- `openspec validate --all --strict --no-interactive`
  - Result: pass, `281 passed, 0 failed`.
- `npm run typecheck`
  - Result: pass.
- `npm exec vitest run src/features/governance/evidence/*.test.ts src/features/status-panel/utils/policies/*.test.ts src/features/status-panel/utils/audit/policyDecisionFormatter.test.ts src/features/status-panel/components/audit/PolicyDecisionAuditPanel.test.tsx src/features/status-panel/utils/checkpoint.test.ts src/features/threads/domain-events/*.test.ts src/features/shared-session/utils/sharedSessionEngines.test.ts src/features/tasks/utils/taskRunStorage.test.ts`
  - Result: pass, `14` test files / `72` tests.
- `npm run check:governance-evidence-bridge`
  - Result: pass.
- `npm run check:checkpoint-policy-chain`
  - Result: pass.
- `npm run check:engine-capability-matrix`
  - Result: pass.
- `npm run check:context-ledger-cost-budget`
  - Result: pass.
- `npm run check:agent-domain-event-schema`
  - Result: pass.
- `npm run check:capability-aware-policy-router`
  - Result: pass; scanner reported `311` findings after first migration batch.
- `npm run perf:realtime:boundary-guard`
  - Result: pass.
- `node --test scripts/check-heavy-test-noise.test.mjs scripts/check-large-files.test.mjs`
  - Result: pass, `15` tests.

## Residual Risks

- The first capability-routing migration batch reduced scanner findings from `317` to `311`; the remaining findings are explicitly tracked as backlog in `capability-branch-triage.md`.
- Cross-platform execution was encoded into Node-based scripts, path normalization tests, and CI wiring. Local execution only directly observed this macOS environment; Windows/Linux execution remains CI evidence.
- The domain event runtime is intentionally minimal and not wired into reducers or thread hooks in this pass. This preserves hot-path safety while establishing the subscribe-only runtime contract.

## Follow-Ups

- Continue capability branch migration in smaller module-owned batches, starting with non-runtime utility modules before `threads/hooks` or `services/tauri.ts`.
- If telemetry is revived, consume governance bridge snapshots only; do not instrument product hot paths directly.
- Add a second domain event runtime consumer only through a new OpenSpec change.

## Boundaries Confirmed

- No edits were made under `src/features/files/**`.
- Archived harness governance changes were not edited.
- Thread hot-path reducer/hook integration was not changed for domain event runtime.
