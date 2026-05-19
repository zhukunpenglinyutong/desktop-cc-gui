## Implementation Evidence

Current branch: `feature/v0.5.0-md`

### Implemented

- Contract-level batcher: `src/features/threads/contracts/realtimeEventBatcher.ts`
- Tests for first-token bypass, coalescing order/content, terminal flush, and identity scoping.
- Runtime integration in `src/features/threads/hooks/useThreadItemEvents.ts`.
- First-token assistant deltas bypass the timer and flush immediately; follow-up deltas are coalesced by item/operation key.
- Existing snapshot batching remains in place for assistant item snapshots to avoid semantic drift.
- Checker: `scripts/check-realtime-event-batching.mjs`

### Validation

- `npm run check:realtime-event-batching`: pass
- `npm exec vitest run src/features/threads/contracts/realtimeEventBatcher.test.ts src/features/threads/contracts/realtimeEventContract.test.ts src/features/threads/contracts/realtimeReplayHarness.test.ts`: pass
- `npm run typecheck`: pass

### Completion Review

- Extended realtime perf baseline was recorded in `docs/perf/realtime-extended-baseline.json`.
- Residual risk: jitter metrics are fixture/proxy based; production stream cadence still needs browser/runtime observation.
- Follow-up backlog: adaptive flush windows, per-engine cadence tuning, and visible render-lag correlation.
