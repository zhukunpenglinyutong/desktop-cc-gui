# Runtime Orchestrator Pool Console Release Checklist

## Scope

- Phase 1: unified managed runtime shutdown, replacement cleanup, orphan sweep, runtime ledger
- Phase 2: launch restore decoupled from runtime acquisition, lease-safe eviction, Codex budgeted Hot/Warm/Cold pool
- Phase 3: visible Settings `Runtime Pool Console`, runtime snapshot/mutate commands, diagnostics counters, reconnect recovery surface

## Validation Matrix

- Startup restore:
  - visible workspaces restore thread metadata without bulk `connect_workspace`
  - active Codex workspace acquires runtime lazily on demand
- Runtime budget:
  - `codexMaxHotRuntimes` and `codexMaxWarmRuntimes` cap idle runtime count
  - `codexWarmTtlSeconds` expires idle runtimes back to cold
  - invalid / empty / out-of-range budget drafts normalize before persistence
- Cleanup:
  - app exit drains managed `Codex` + `Claude Code` runtimes when `runtimeForceCleanupOnExit=true`
  - next launch orphan sweep clears stale ledger entries when `runtimeOrphanSweepOnLaunch=true`
  - lease-active runtime is never evicted by reconcile
- Console operations:
  - refresh snapshot
  - pin / unpin runtime
  - release runtime to cold
  - close runtime
  - persist pool settings through app settings
  - visible at `Settings > Runtime`, not hidden in another section
  - render engine observability / diagnostics counters / lifecycle policy toggles
- Reconnect recovery:
  - broken pipe / workspace-not-connected errors surface a reconnect card in messages
  - reconnect action calls `ensureRuntimeReady` and exposes readable success/failure state

## Known Baseline Gaps Outside This Change

- `npm run typecheck` still fails on pre-existing issues in:
  - `src/features/composer/components/ChatInputBox/selectors/ModeSelect.tsx`
  - `src/features/messages/components/Messages.tsx`

## Rollout Notes

- Default behavior is now conservative: launch restores threads, not background Codex runtimes.
- Users can raise budgets in Settings if they prefer more warm capacity on faster machines, but current budget knobs are `Codex-only`.
- `Claude Code` is already included in runtime rows, diagnostics and unified close path, even though it does not yet expose standalone budget settings.
- Diagnostics in the console are the first stop for investigating orphan cleanup, force-kill counts, lease-blocked eviction and coordinator aborts.
- Messages-side reconnect guidance is the first stop for runtime pipe breakage or workspace disconnects that surface during active conversation.
