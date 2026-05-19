## 0. Branch Calibration

Current branch source of truth: `feature/v0.5.0-md`.

This change is implementation-unstarted on the current branch. Prior branch measurements or implementation attempts are discarded. Reimplementation must re-measure current hub sizes, imports, call sites, and relevant perf baselines before selecting a target.

## 1. Target Selection

- [x] 1.1 [P0][depends:none][I: proposal hub list][O: current size table][V: target files measured] Measure listed hub sizes.
- [x] 1.2 [P0][depends:1.1][I: perf baseline + size table][O: selected primary hub][V: exactly one target chosen] Select one primary hub target.
- [x] 1.3 [P0][depends:1.2][I: selected hub][O: public contract inventory][V: callers/imports listed] Inventory public API and callers.

## 2. Split Design

- [x] 2.1 [P0][depends:1.3][I: selected hub][O: responsibility map][V: pure/orchestration/render/test boundaries named] Create split map.
- [x] 2.2 [P0][depends:2.1][I: split map][O: extracted module plan][V: no extracted file near large-file threshold] Plan extracted modules.
- [x] 2.3 [P0][depends:2.1][I: public contract inventory][O: compatibility plan][V: caller-facing API stable or migration explicit] Define compatibility plan.

## 3. Implementation

- [x] 3.1 [P0][depends:2][I: split plan][O: extracted pure helpers][V: helper tests or existing coverage] Extract pure logic.
- [x] 3.2 [P0][depends:3.1][I: split plan][O: extracted orchestration/render adapters][V: public API preserved] Extract orchestration/render boundaries.
- [x] 3.3 [P0][depends:3.2][I: selected hub tests][O: targeted regression tests][V: selected path covered] Add/update targeted tests.

## 4. Validation

- [x] 4.1 [P0][depends:3][I: touched files][O: type/lint evidence][V: `npm run typecheck` + `npm run lint`] Run type and lint gates.
- [x] 4.2 [P0][depends:3][I: selected hub tests][O: targeted test evidence][V: affected tests pass] Run targeted tests.
- [x] 4.3 [P0][depends:3][I: file sizes][O: large-file evidence][V: `npm run check:large-files:gate`] Run large-file gate.
- [x] 4.4 [P1][depends:3][I: selected perf path][O: perf baseline evidence][V: relevant `npm run perf:*:baseline`] Run relevant perf baseline.
- [x] 4.5 [P0][depends:4.1-4.4][I: OpenSpec artifacts][O: strict validation][V: `openspec validate refactor-mega-hub-split --strict --no-interactive`] Validate OpenSpec.

## 5. Completion Review

- [x] 5.1 [P0][depends:4][I: before/after size + tests][O: split outcome summary][V: selected hub improvement explained] Record split result.
- [x] 5.2 [P1][depends:5.1][I: remaining hubs][O: follow-up backlog][V: remaining hub order listed] List next hub candidates.
