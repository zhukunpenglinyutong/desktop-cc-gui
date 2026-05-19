## Implementation Evidence

Current branch: `feature/v0.5.0-md`

### Inventory

Measured on 2026-05-19:

| File | Lines | Role |
|---|---:|---|
| `src/app-shell.tsx` | 2276 | app orchestration hub |
| `src/utils/threadItems.ts` | 2416 | conversation item normalization hub |
| `src/features/messages/components/Messages.tsx` | 2223 | message host hub |
| `src/features/messages/components/MessagesRows.tsx` | 1914 | row rendering hub |
| `src/features/messages/components/MessagesTimeline.tsx` | 645 | timeline orchestration |
| `src/features/status-panel/components/StatusPanel.tsx` | 663 | status panel host |

### Target Decision

Primary hub target: `src/features/messages/components/MessagesRows.tsx`.

Reason: this file is a high-risk row rendering hub, but its streaming markdown complexity logic is pure and can be extracted without changing the public `MessageRow` / `ReasoningRow` contracts.

### Implemented Split

- Extracted streaming markdown complexity and throttle decisions to `src/features/messages/components/messagesStreamingComplexity.ts`.
- Added focused tests in `messagesStreamingComplexity.test.ts`.
- Preserved existing `MessagesRows.tsx` public exports and caller API.
- Current size after split: `MessagesRows.tsx` 1752 lines; extracted helper 174 lines.

### Follow-Up Target Order

1. Continue `MessagesRows.tsx`: extract media/deferred-image state helpers.
2. `src/features/messages/components/Messages.tsx`: extract hook orchestration once row boundary is smaller.
3. `src/utils/threadItems.ts`: extract item kind builders into per-domain modules.
4. `src/app-shell.tsx`: split only after feature hooks have stable sub-boundaries.

### Validation

- `npm exec vitest run src/features/messages/components/messagesStreamingComplexity.test.ts src/features/messages/components/MessagesRows.stream-mitigation.test.tsx`: pass
- `npm run typecheck`: pass

### Completion Review

- Before/after: selected hub reduced from 1914 to 1752 lines; extracted helper is 174 lines.
- Residual risk: `MessagesRows.tsx` is still large and should continue being split by responsibility.
- Next hub candidates are listed above in priority order.
