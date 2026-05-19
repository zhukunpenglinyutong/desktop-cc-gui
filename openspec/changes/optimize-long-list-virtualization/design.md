## Branch Calibration / 分支校准（2026-05-19）

本设计面向当前 `feature/v0.5.0-md` 分支重新实施。row identity、scroll restoration、active streaming row 与 tool-call fallback 行为必须按当前分支重新校准；`feature/v0.5` 不作为事实源。

当前定位：**design-ready / implementation-unstarted**。后续实施必须先做 rendering inventory，再决定 virtualization boundary。

## Context

`add-runtime-perf-baseline` recorded long-list render baselines for `S-LL-200`, `S-LL-500`, and `S-LL-1000`. The current browser scroll gate is still a jsdom proxy. This change turns long-list rendering into a measurable UI performance contract.

For harness governance, this is a support layer: governance views such as audit trail, session activity, context ledger, and message rows all become useless if long sessions degrade linearly with item count.

## Goals

- Introduce or harden virtualization for long message/thread lists.
- Reuse `@tanstack/react-virtual`; no custom virtual scroller.
- Preserve first visible rows, scroll restoration, live streaming semantics, and accessibility.
- Replace jsdom-only scroll confidence with a browser-level verification gate where feasible.

## Non-Goals

- No realtime event batching.
- No Composer or app-server hub split.
- No bundle chunking.
- No rewrite of message state model.

## Decisions

### Decision 1: Virtualization belongs at the row adapter boundary

Virtualization MUST be applied where rows are rendered, not in reducer state or message normalization.

**Why**: reducers own truth; virtualization is a viewport projection.

### Decision 2: Streaming row stability is a first-class invariant

The active streaming assistant row MUST stay visually stable while deltas arrive. Virtualization must not unmount/remount it in a way that loses live text, selection, or scroll intent.

### Decision 3: Browser scroll gate is required for S-LL-1000

`S-LL-1000` must gain a browser-level scroll verification path or explicitly document why the current environment cannot provide it.

### Decision 4: Accessibility must not regress

Virtualization must keep keyboard navigation and semantic row labeling coherent. Hidden rows are allowed only as viewport implementation detail, not as broken navigation state.

## Implementation Plan

1. Inventory current message row rendering and scroll restoration behavior.
2. Define a virtualization boundary around messages/thread rows.
3. Implement virtualization with `@tanstack/react-virtual`.
4. Add browser-level scroll verification for 1000-row scenario.
5. Rerun long-list baseline and update perf outputs.

## Validation Matrix

| Area | Evidence |
|---|---|
| Type safety | `npm run typecheck` |
| Regression | `npm run test` |
| Long-list perf | `npm run perf:long-list:baseline` |
| Perf aggregate | `npm run perf:baseline:aggregate` |
| Large file governance | `npm run check:large-files:gate` |
| OpenSpec | `openspec validate optimize-long-list-virtualization --strict --no-interactive` |

## Rollback Strategy

Keep the previous non-virtualized renderer behind a small adapter boundary during implementation. Rollback by restoring the previous row renderer and removing the virtualization wrapper.
