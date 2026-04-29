## Context

Codex realtime currently has two separate liveness mechanisms:

- frontend no-progress settlement in `useThreadEventHandlers.ts`
- backend `turn/stalled` events for resume-pending gaps

Both paths can settle a turn and clear processing state. The gap is after settlement: late app-server events from the same old turn can still reach the frontend and run the normal realtime item handlers. Those handlers may call `markProcessing(threadId, true)`, making the UI look active again even though the turn has already been classified as stalled.

The execution-active timeout is also currently 15 minutes. That protects active tools from the base 180-second no-progress settlement, but user reports show quiet tool phases can legitimately exceed that window. We need a larger bounded window without making stalled turns infinitely alive.

## Goals / Non-Goals

**Goals:**

- Add a Codex-only quarantine boundary after stalled settlement.
- Key the boundary by turn identity so successor turns are not suppressed.
- Increase the execution-active no-progress window to 1200 seconds.
- Keep progress-event reset behavior before settlement.
- Leave enough diagnostics for late stale events.

**Non-Goals:**

- No backend protocol change.
- No automatic prompt replay.
- No runtime process kill on frontend no-progress settlement.
- No changes to runtime pool TTL or budget reconciliation.

## Decisions

### Decision 1: Quarantine in the frontend turn lifecycle layer

The stale resurrection happens in frontend event consumption, so the smallest durable fix is to quarantine in `useThreadEventHandlers.ts`, before raw or normalized events mutate reducer state.

Alternatives:

- Backend-only filtering: rejected because frontend no-progress settlement is local and backend may not know it has happened.
- Runtime restart: rejected because it is destructive and still does not address late event ordering already in the frontend queue.

### Decision 2: Key quarantine by `threadId + turnId`

The quarantine ledger will store stalled Codex turn identities. A late event is blocked only when it belongs to the same thread and same stalled turn. Events without a turn id are not broadly blocked because doing so could hide valid thread-level updates.

If the current active turn id differs from the stale event turn id, the existing late-event guard also keeps it diagnostic-only. The new ledger covers the post-stall case where the active turn id has already been cleared.

### Decision 3: Keep quarantine ephemeral

The ledger is in-memory and hook-local. It should clear naturally on unmount and does not need persistence because it protects a realtime event ordering window, not durable history.

### Decision 4: Extend execution-active no-progress timeout to 1200 seconds

The base no-progress timeout remains 180 seconds for turns without active execution. When an execution item is active, the timeout becomes 20 minutes. Progress evidence still resets the clock, so active tools with visible events are not penalized.

## Risks / Trade-offs

- Stale events with missing turn id can still mutate state if they arrive after settlement. Mitigation: current Codex realtime events used for turn progress normally include turn id; missing-turn-id cases are kept visible rather than over-blocking valid thread updates.
- A still-running tool may be marked stalled after 1200 seconds of total silence. Mitigation: this is intentional bounded recovery behavior, and runtime active-work protection remains separate from UI processing state.
- Quarantine could hide a valid retry using the same turn id. Mitigation: Codex successor turns should produce a new turn id; same-turn-id late evidence after stalled settlement represents the old liveness chain.

## Migration Plan

1. Add OpenSpec deltas.
2. Update the frontend timeout constant.
3. Add stalled-turn quarantine helpers in `useThreadEventHandlers.ts`.
4. Gate raw and normalized Codex realtime handlers against the quarantine ledger.
5. Update tests and i18n copy.

Rollback is a normal git revert; no persisted data or runtime schema changes are introduced.

## Open Questions

- None for this fix. Longer-term recovery actions such as automatic fresh continuation remain separate work.
