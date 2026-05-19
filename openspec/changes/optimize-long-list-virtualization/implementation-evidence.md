## Implementation Evidence

Current branch: `feature/v0.5.0-md`

### Rendering Inventory

Current long-list rendering path:

1. `Messages.tsx` prepares visible/effective conversation items and grouped tool entries.
2. `MessagesTimeline.tsx` maps `groupedEntries` through `renderEntry`.
3. `MessagesRows.tsx` renders the concrete row components.
4. `bottomRef`, sticky header state, active user-input anchor, live assistant/reasoning items, and grouped tool blocks are all interleaved in `MessagesTimeline.tsx`.

### Virtualization Decision

Runtime virtualization is implemented behind a viewport projection boundary:

- active user-input insertion after a specific grouped entry
- sticky history header
- live assistant and live reasoning replacement
- tool group blocks with auto-scroll callbacks
- `bottomRef` scroll restoration

The virtualizer is disabled while `isThinking` is true. This protects the active streaming row from unmount/remount churn while deltas arrive.

### Implemented Boundary

- Pure projection: `src/features/messages/components/messagesTimelineProjection.ts`
- Virtualizer guard/estimates: `src/features/messages/components/messagesTimelineVirtualization.ts`
- Runtime host: `MessagesTimeline.tsx` uses `@tanstack/react-virtual` for long stable timelines.
- `bottomRef` remains outside the virtual canvas so existing auto-scroll calls keep a stable DOM target.

### Validation

- `npm exec vitest run src/features/messages/components/messagesTimelineProjection.test.ts src/features/messages/components/messagesTimelineVirtualization.test.ts src/features/messages/components/Messages.live-behavior.test.tsx src/features/messages/components/Messages.rich-content.test.tsx`: pass
- `npm run typecheck`: pass

### Deferred

- Browser-level S-LL-1000 scroll evidence remains pending; current `docs/perf/long-list-baseline.json` marks scrollFrameDrop as a jsdom proxy with follow-up rationale.

### Completion Review

- S-LL-1000 commit metrics are recorded in `docs/perf/long-list-baseline.json`.
- Residual risk: browser-level scroll behavior is not directly measured in this environment.
- Follow-up backlog: browser scroll gate using the in-app browser or Playwright-equivalent harness, plus row-height tuning after real scroll traces.
