## 1. Evidence Contract

- [x] 1.1 [P0] Define `GovernanceEvidence` DTO with source, status, title, summary, and optional timestamp.
- [x] 1.2 [P0] Add tests for status normalization and unknown/degraded evidence.

## 2. Read-Only Readers

- [x] 2.1 [P0] Implement OpenSpec task progress reader with malformed markdown fallback.
- [x] 2.2 [P0] Implement package script evidence reader for known harness governance checks.
- [x] 2.3 [P0] Implement workflow presence reader for large-file and heavy-test governance workflows.
- [x] 2.4 [P1] Implement Trellis session/task reader only after current workspace fixtures prove a stable schema.
- [x] 2.5 [P0] Ensure readers do not write files.

## 3. Optional StatusPanel Surface

- [x] 3.1 [P1] Add a small read-only evidence section only if existing StatusPanel composition supports it without a new tab.
- [x] 3.2 [P1] Add empty/degraded state rendering.

## 4. Validation

- [x] 4.1 [P0] Run `npm run typecheck`.
- [x] 4.2 [P0] Run targeted reader tests.
- [x] 4.3 [P0] Run `node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs`.
- [x] 4.4 [P0] Run `npm run check:heavy-test-noise`.
- [x] 4.5 [P0] Run `node --test scripts/check-large-files.test.mjs`.
- [x] 4.6 [P0] Run `npm run check:large-files:near-threshold`.
- [x] 4.7 [P0] Run `npm run check:large-files:gate`.
- [x] 4.8 [P0] Confirm readers normalize paths, tolerate CRLF/LF markdown, and avoid shell-only or case-sensitive assumptions.
- [x] 4.9 [P0] Run `openspec validate integrate-openspec-trellis-bridge-into-status-panel --strict --no-interactive`.

Blocked validation note:

- `npm run check:large-files:gate` was unblocked by extracting thread-list helpers from `src/features/threads/hooks/useThreadActions.ts` into `useThreadActions.threadList.ts`. The third slice added only modular governance evidence files and a small StatusPanel CSS section; `src/styles/status-panel.css` remains below the fail threshold but is reported by near-threshold governance as a watch item.
