## Implementation Evidence

Current branch: `feature/v0.5.0-md`

### Implemented

- Capability lookup hook: `src/features/engine/capabilities/useCapability.ts`
- Hook tests: `src/features/engine/capabilities/useCapability.test.tsx`
- Deterministic engine-name branch scanner: `scripts/scan-engine-name-branches.mjs`
- Scanner tests: `scripts/scan-engine-name-branches.test.mjs`
- npm entry: `npm run check:capability-aware-policy-router`

### Current Code Facts

- `useCapability(capability, engineOverride?)` reads the active engine by default and supports an explicit engine override.
- Runtime status is resolved through existing `engineCapabilityMatrix` helpers.
- Missing runtime status falls back to spec-only capability state instead of failing closed.
- Unknown capability keys remain rejected by the TypeScript `EngineCapabilityKey` union.
- The scanner reports hard-coded engine-name branches with stable normalized paths and an allowlist marker instead of rewriting call sites automatically.

### Validation

- `openspec validate add-capability-aware-policy-router --strict --no-interactive`: pass on 2026-05-20.
- Prior recorded validation in `tasks.md` includes typecheck, matrix checks, heavy-test-noise, large-file gates, scanner portability checks, and strict OpenSpec validation.

### Runtime Boundary

- This change introduces a lookup hook and read-only scanner only.
- It does not rewrite all engine-name branches, introduce dynamic capability discovery, or add cost-aware routing.

### Completion Review

- Residual risk: capability-aware routing is still partial; hard-coded engine branches remain grandfathered until their owning features are touched.
- Follow-up backlog: broader branch migration, dynamic discovery, cost-aware policy, and user-visible degradation copy.
- Archive posture: ready after final harness-wide validation confirms no concurrent implementation drift.
