# Capability Branch Triage

## Baseline

- Scanner: `node scripts/scan-engine-name-branches.mjs --format json`
- Before first migration batch: `317` findings across `1461` scanned files.
- After first migration batch: `311` findings across `1462` scanned files.

## First Matrix-Eligible Batch

| File | Classification | Action |
|---|---|---|
| `src/features/shared-session/utils/sharedSessionEngines.ts` | `matrix-eligible` | Replaced direct Codex shared-session branch with `isEngineCapabilityAvailable(engine, "collaboration.mode")`; kept Claude as explicit base compatibility. |
| `src/features/tasks/utils/taskRunStorage.ts` | `matrix-eligible` | Replaced direct Codex task-center support branch with `isEngineCapabilityAvailable(engine, "collaboration.mode")`; kept Claude/Gemini as explicit base task-center engines. |

## Runtime-Isolated / Deferred

Large remaining clusters are intentionally not migrated in this batch:

- `src/features/threads/hooks/**`
- `src/features/threads/adapters/**`
- `src/services/tauri.ts`
- `src/app-shell.tsx`
- `src/features/composer/**`

These branches often select runtime transport, session lifecycle, parser behavior, or UI surface compatibility. They require narrower follow-up changes with module-level tests and should not be rewritten as part of the bridge foundation pass.

## Legacy-Allowlist Rationale

No permanent allowlist is introduced in this batch. The remaining `311` scanner findings are tracked as migration backlog, not accepted steady-state. Future batches should either migrate a branch to matrix-backed capability checks or add an inline `capability-router-allow-engine-branch` marker with owner and removal rationale.
