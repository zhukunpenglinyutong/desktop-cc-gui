## Design / 设计

### Current Client Facts

- `src/features/engine/engineCapabilityMatrix.ts` is the current TS source for engine capability projection.
- `src/features/engine/engineCapabilityMatrix.test.ts` and `scripts/check-engine-capability-matrix.mjs` already guard matrix shape.
- The repository does not need another routing abstraction before consumers prove the simple query model is insufficient.

## Decisions

### Decision 1: Reuse Existing Matrix Helpers, Do Not Duplicate Query Truth

The existing helper set already provides the pure query layer:

```ts
getEngineCapabilityState(engine, capability)
isEngineCapabilityAvailable(engine, capability)
resolveEngineCapabilityRuntimeStatus(status, capability)
```

Why:
- Duplicating `getCapabilityState` would create two capability query truths.
- Current need is a React-friendly wrapper and migration visibility.
- Route registries still remain out of scope.

### Decision 2: Hook Is A Thin Wrapper

`useCapability(capability, engineOverride?)` should resolve the active engine/runtime status and call existing matrix helpers.

Why:
- Keeps React concerns out of the capability matrix.
- Avoids another source of capability semantics.

### Decision 3: Scanner Produces Evidence, Not Enforcement

Add a read-only scanner for existing engine-name branches.

Rejected for this phase:
- ESLint warning.
- codemod.
- mandatory migration list.

Why:
- Current code still has legitimate engine-name logic.
- The first governance value is visibility of migration debt, not enforcement.

### Decision 4: No Rust Router In This Change

Rust already has capability matrix parity. A Rust route abstraction is not justified until a concrete Rust consumer needs it.

## Implementation Shape

- `src/features/engine/capabilities/useCapability.ts`
  - thin React wrapper around existing matrix helpers.
- `scripts/scan-engine-name-branches.mjs`
  - scans TS/TSX source.
  - emits deterministic JSON report.
  - supports a minimal allowlist marker.

## Boundary

This change is successful when new UI code has a small, typed hook over the existing matrix helpers and the team has a deterministic report of engine-name branch debt.

## Mandatory Governance Gates

Implementation MUST preserve the large-file workflow gate during staged work and defer the full noise sentry to final harness-wide integration closure:

- Full noise sentry
  - Deferred to final harness-wide integration closure.
- `.github/workflows/large-file-governance.yml`
  - `node --test scripts/check-large-files.test.mjs`
  - `npm run check:large-files:near-threshold`
  - `npm run check:large-files:gate`

Scanner implementation MUST be deterministic on ubuntu-latest, macos-latest, and windows-latest. It MUST normalize path separators, avoid shell-only commands, avoid case-sensitive filename assumptions, and avoid newline-fragile output.
