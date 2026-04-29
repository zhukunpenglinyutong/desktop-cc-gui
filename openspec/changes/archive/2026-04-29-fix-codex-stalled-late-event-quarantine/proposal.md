## Why

Codex realtime sessions can enter a contradictory state: the UI has already marked a foreground turn as stalled, but late events from that old turn can still arrive and flip the thread back to "generating". In real use this looks like a session that cannot recover, while creating a new Codex session still works normally.

The current execution-active no-progress window is also too tight for quiet tool phases. A tool can be legitimately running without frequent stdout or item updates, so the extended window should move from 900 seconds to 1200 seconds while still keeping a bounded recovery path.

## Goals And Boundaries

- Keep Codex realtime turns bounded: a turn that exceeds its no-progress window must settle into a recoverable stalled state.
- Treat tool progress precisely: `item/started`, `item/updated`, `item/completed`, tool output delta, assistant delta, or equivalent normalized realtime events reset the no-progress clock before the turn is stalled.
- Increase the execution-active no-progress window from 15 minutes to 20 minutes.
- Once a Codex turn is stalled or abandoned, late events for that same old `threadId + turnId` must be quarantined as diagnostics and must not revive processing state.
- Keep normal new Codex session creation and fresh continuation paths unchanged.

## Non-Goals

- Do not change Codex CLI protocol or app-server request/response schemas.
- Do not change runtime pool warm TTL, hot/warm budget policy, or pin/release behavior.
- Do not delete or rewrite Codex local session files.
- Do not implement automatic replay of stalled prompts in this change.

## What Changes

- Add a frontend stalled-turn quarantine ledger for Codex realtime events.
- Mark a Codex turn as quarantined when frontend no-progress settlement or backend `turn/stalled` settlement occurs.
- Ignore state mutation from late raw/normalized events that match a quarantined old turn identity.
- Keep debug diagnostics for quarantined late events so operators can see that the runtime emitted stale progress after settlement.
- Update the execution-active no-progress timeout from `900s` to `1200s`.
- Refine stalled copy so no-progress settlement is not mislabeled as a user-input resume failure.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `codex-stalled-recovery-contract`: codifies stalled-turn quarantine and the 1200-second execution-active no-progress window.
- `codex-conversation-liveness`: clarifies that stalled or abandoned turns must not be revived by stale late events.

## Options And Trade-Offs

| Option | Result | Trade-off |
|---|---|---|
| Only raise timeout to 1200s | Fewer false stalls during quiet tools | Does not fix the old-turn resurrection bug |
| Quarantine all late events after stalled | Prevents UI from re-entering fake processing | Must key by turn identity to avoid dropping valid successor turns |
| Backend-only runtime kill/restart on stalled | Strong terminal boundary | Too destructive; can interrupt still-running Codex process and does not address frontend stale event ordering |

Chosen approach: combine a modest timeout increase with frontend turn-identity quarantine. This preserves long-running work better while making stalled settlement terminal for the old turn's UI state.

## Acceptance Criteria

- A Codex execution-active turn does not settle at 900 seconds and only settles after 1200 seconds without progress evidence.
- A progress event before the timeout resets the no-progress clock.
- After a Codex turn is marked stalled, late events with the same `threadId + turnId` are diagnostic-only and cannot call `markProcessing(true)`.
- Late events for a different active successor turn still render normally.
- User-facing no-progress copy explains missing Codex progress, not user-input resume failure.

## Impact

- Frontend realtime lifecycle: `src/features/threads/hooks/useThreadEventHandlers.ts`
- Frontend tests: `src/features/threads/hooks/useThreadEventHandlers.test.ts`
- User-visible copy: `src/i18n/locales/en.part1.ts`, `src/i18n/locales/zh.part1.ts`
- OpenSpec behavior contracts: `openspec/changes/fix-codex-stalled-late-event-quarantine/specs/**`
