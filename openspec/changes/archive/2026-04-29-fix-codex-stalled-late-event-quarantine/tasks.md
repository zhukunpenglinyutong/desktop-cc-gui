## 1. OpenSpec Contracts

- [x] 1.1 [P0][input: user screenshots and liveness analysis][output: proposal/design/spec/tasks][verify: openspec validate] Capture stalled late-event quarantine and 1200-second execution-active timeout in OpenSpec artifacts.

## 2. Frontend Liveness Implementation

- [x] 2.1 [P0][depends: 1.1][input: useThreadEventHandlers liveness state][output: 1200s execution-active timeout][verify: useThreadEventHandlers test] Raise Codex execution-active no-progress timeout from 900 seconds to 1200 seconds.
- [x] 2.2 [P0][depends: 1.1][input: Codex stalled settlement][output: per-turn quarantine ledger][verify: late-event regression test] Quarantine stalled Codex `threadId + turnId` identities after frontend or backend stalled settlement.
- [x] 2.3 [P0][depends: 2.2][input: raw and normalized realtime events][output: diagnostic-only stale event handling][verify: late-event regression test] Prevent quarantined late events from marking processing or mutating conversation state while allowing successor turn events.

## 3. Copy And Diagnostics

- [x] 3.1 [P1][depends: 2.2][input: no-progress stalled i18n][output: precise user-facing copy][verify: typecheck] Refine Codex no-progress stalled copy so it does not imply user-input resume failure.

## 4. Verification

- [x] 4.1 [P0][depends: 2.1, 2.2, 2.3, 3.1][input: targeted tests][output: passing Vitest and OpenSpec validation][verify: commands] Run `openspec validate fix-codex-stalled-late-event-quarantine --strict` and `pnpm vitest run src/features/threads/hooks/useThreadEventHandlers.test.ts`.
- [x] 4.2 [P1][depends: 4.1][input: TypeScript project][output: type safety confirmation][verify: command] Run `npm run typecheck`.
