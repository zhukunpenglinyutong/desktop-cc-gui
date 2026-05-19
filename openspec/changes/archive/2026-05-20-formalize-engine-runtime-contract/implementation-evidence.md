# Implementation Evidence

## Scope

This implementation formalizes the current `feature/v0.5.0-md` runtime contract without changing adapter, loader, reducer, or UI runtime behavior.

## Contract Inventory

### Canonical Types

`src/features/threads/contracts/conversationCurtainContracts.ts` is the frontend runtime contract source:

| Type | Contract |
|---|---|
| `ConversationEngine` | `codex` / `claude` / `gemini` / `opencode` |
| `NormalizedThreadEvent` | Canonical realtime item event shape keyed by `(itemKind, operation)` |
| `NormalizedHistorySnapshot` | Loader output shape for history hydration |
| `RealtimeAdapter` | Static adapter interface: `mapEvent(input): NormalizedThreadEvent | null` |
| `HistoryLoader` | Static loader interface: `load(threadId): Promise<NormalizedHistorySnapshot>` |

### Static Registry

`src/features/threads/adapters/realtimeAdapterRegistry.ts` uses `Record<ConversationEngine, RealtimeAdapter>`, so a new `ConversationEngine` variant requires a matching adapter at typecheck time.

### Adapter Behavior

| Engine | Adapter | Notes |
|---|---|---|
| `codex` | `codexRealtimeAdapter` | Shared mapper, agent message snapshots stay snapshot-shaped |
| `claude` | `claudeRealtimeAdapter` | Shared mapper, accepts text delta aliases |
| `gemini` | `geminiRealtimeAdapter` | Shared mapper, accepts text delta aliases |
| `opencode` | `opencodeRealtimeAdapter` | Shared mapper, accepts text delta aliases |

Unknown engine-private realtime methods return `null` and do not mutate normalized thread state.

### History Loader Behavior

| Engine | Loader | Notes |
|---|---|---|
| `codex` | `createCodexHistoryLoader` | Remote resume with optional local fallback |
| `claude` | `createClaudeHistoryLoader` | Native session load and control-plane filtering fallback |
| `gemini` | `createGeminiHistoryLoader` | Parser-backed normalized history |
| `opencode` | `createOpenCodeHistoryLoader` | Remote session history normalized to common items |
| shared session | `createSharedHistoryLoader` | Restores persisted shared session items and legacy engine fallback |

## Spec To Test Mapping

| Requirement | Evidence |
|---|---|
| Canonical realtime event contract | `realtimeEventContract.test.ts`, `realtimeAdapters.test.ts` |
| Non-`NormalizedThreadEvent` signals out of scope | `realtimeEventContract.test.ts` |
| History snapshot semantic parity | `realtimeHistoryParity.test.ts`, `historyLoaders.test.ts`, `sharedHistoryLoader.test.ts` |
| Static adapter registry | `realtimeAdapterRegistry.ts`, `npm run typecheck` |
| Legacy alias compatibility | `realtimeEventContract.ts`, `realtimeEventContract.test.ts` |
| Replay boundary stability | `realtimeReplayHarness.test.ts`, `realtimeBoundaryGuard.test.ts` |

## Documented Gaps

- Turn lifecycle, processing heartbeat, usage update, runtime lifecycle, and rate-limit signals remain outside `NormalizedThreadEvent`.
- No runtime `registerAdapter()` or `overrideAdapter()` API is introduced.
- Capability matrix, cost budget, policy chain, and domain event schema are handled by separate OpenSpec changes.

## Validation Evidence

Validation commands are recorded in `tasks.md` after execution.

### Completion Review

- Scope stayed limited to realtime/history runtime contracts. Capability matrix, cost budget, policy chain, batching, and domain event schema are separate changes.
- Residual risk: remote CI runner results cannot be observed from this local session; CI wiring and local equivalent gates were validated.
- Follow-up: formalize non-`NormalizedThreadEvent` runtime signals such as turn lifecycle, usage updates, rate limits, and runtime lifecycle events.
