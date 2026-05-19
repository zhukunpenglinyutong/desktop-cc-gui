## Implementation Evidence

Current branch: `feature/v0.5.0-md`

### Implemented

- Spec-owned matrix fixture: `openspec/changes/add-engine-capability-matrix-spec/specs/engine-capability-matrix/fixtures/matrix.json`
- TypeScript matrix and helpers: `src/features/engine/engineCapabilityMatrix.ts`
- Rust matrix and tests: `src-tauri/src/engine/capability_matrix.rs`
- Cross-source checker: `scripts/check-engine-capability-matrix.mjs`
- UI pilot: `StatusPanel.tsx` gates Codex plan-as-task rendering through `collaboration.mode` capability lookup while preserving legacy `isCodexEngine` fallback.
- CI wiring: `npm run check:engine-capability-matrix`

### Inventory Summary

- Existing TS/Rust feature fields mapped: streaming, reasoning, tool use, MCP, session continuation, image input.
- UI hard-coded branch pilot selected: StatusPanel Codex plan/todo behavior.
- Follow-up branches remain grandfathered until their owning feature changes touch them.

### Validation

- `npm run check:engine-capability-matrix`: pass
- `npm exec vitest run src/features/engine/engineCapabilityMatrix.test.ts src/features/status-panel/components/StatusPanel.test.tsx`: pass
- `npm run check:heavy-test-noise`: pass
- `npm run check:large-files:gate`: pass
- `openspec validate add-engine-capability-matrix-spec --strict --no-interactive`: pass

### Deferred

- Dedicated degraded notice copy is not introduced because the selected pilot preserves the existing hidden/alternate-tab behavior without adding a new visible degradation message.
- Dynamic capability discovery and capability-aware routing remain follow-up changes.

### Completion Review

- Residual risk: only one UI pilot is capability-aware; remaining engine hard-coded branches are grandfathered until touched.
- Follow-up backlog: capability router, cost-aware routing, dynamic discovery, and broader UI degradation copy.
