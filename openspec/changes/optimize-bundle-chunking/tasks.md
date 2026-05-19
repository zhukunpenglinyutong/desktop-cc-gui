## 0. Branch Calibration

Current branch source of truth: `feature/v0.5.0-md`.

This change is implementation-unstarted on the current branch. Prior branch measurements or implementation attempts are discarded. Reimplementation must rerun current build/cold-start inventory before choosing lazy or manual chunk boundaries.

## 1. Bundle Inventory

- [x] 1.1 [P0][depends:none][I: `docs/perf/cold-start-baseline.json`][O: current S-CS-COLD snapshot][V: baseline values recorded] Capture current cold-start bundle baseline.
- [x] 1.2 [P0][depends:1.1][I: Vite build output][O: top contributor list][V: main/vendor contributors identified] Analyze bundle composition.
- [x] 1.3 [P0][depends:1.2][I: contributor list][O: critical path allowlist][V: startup-critical modules listed] Identify modules that must not be lazy-loaded.

## 2. Chunking Design

- [x] 2.1 [P0][depends:1.2,1.3][I: top contributors + critical path][O: candidate chunk plan][V: each candidate has low-frequency rationale] Select lazy/manual chunk candidates.
- [x] 2.2 [P0][depends:2.1][I: candidate plan][O: rollback notes][V: every chunk boundary has rollback path] Document chunk rationale and rollback.

## 3. Implementation

- [x] 3.1 [P0][depends:2][I: chunk plan][O: Vite/lazy import changes][V: startup path unchanged] Implement selected chunk boundaries.
- [x] 3.2 [P0][depends:3.1][I: implementation][O: targeted smoke evidence][V: startup and affected lazy surfaces load] Validate affected surfaces manually or with existing tests.

## 4. Validation

- [x] 4.1 [P0][depends:3][I: touched files][O: type/test evidence][V: `npm run typecheck` + `npm run test`] Run frontend baseline.
- [x] 4.2 [P0][depends:3][I: bundle output][O: cold-start baseline][V: `npm run perf:cold-start:baseline`] Run cold-start baseline.
- [x] 4.3 [P0][depends:4.2][I: perf outputs][O: aggregate baseline][V: `npm run perf:baseline:aggregate`] Aggregate perf baseline.
- [x] 4.4 [P1][depends:3][I: source sizes][O: large-file evidence][V: `npm run check:large-files:gate`] Run large-file gate.
- [x] 4.5 [P0][depends:4.1-4.4][I: OpenSpec artifacts][O: strict validation][V: `openspec validate optimize-bundle-chunking --strict --no-interactive`] Validate OpenSpec.

## 5. Completion Review

- [x] 5.1 [P0][depends:4][I: before/after bundle metrics][O: outcome summary][V: main/vendor size delta explained] Record measured outcome.
- [x] 5.2 [P1][depends:5.1][I: residual contributors][O: follow-up backlog][V: non-addressed heavy contributors listed] List follow-ups.
