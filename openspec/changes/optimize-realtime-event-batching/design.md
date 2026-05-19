## Branch Calibration / 分支校准（2026-05-19）

本设计面向当前 `feature/v0.5.0-md` 分支重新实施。`feature/v0.5` 中曾出现的 `realtimeBatchingContract`、checker 与 validation evidence 均视为废弃实现，不作为当前完成状态。

当前定位：**design-ready / implementation-unstarted**。后续实施必须重新 inventory 当前分支的 realtime adapter/hook/reducer path 与 perf baseline，再选择安全 coalescing boundary。

## Context

`add-runtime-perf-baseline` established realtime extended fixtures: `S-RS-FT.firstTokenLatency = 5000ms`, `interTokenJitterP95 = 920ms`, `S-RS-PE.dedupHitRatio = 0.25`, and `assemblerLatency = 3.93ms`.

For harness governance, realtime batching is directly connected to `engine-runtime-contract`: the UI must normalize engine streams without letting high-frequency deltas overload render paths. This change is a performance contract over propagation cadence, not a new event schema.

## Goals

- Define batching/coalescing boundaries for realtime text delta, tool output, and status updates.
- Protect first-token semantics.
- Preserve dedup and replay harness behavior.
- Keep canonical `NormalizedThreadEvent` semantics unchanged.

## Non-Goals

- No long-list virtualization.
- No mega hub split.
- No bundle chunking.
- No new EventBus or domain event runtime.
- No change to engine adapter canonical event names.

## Decisions

### Decision 1: First visible assistant delta bypasses batching

The first user-visible assistant delta in a turn MUST flush immediately.

**Why**: perceived latency is more important than batching efficiency at turn start.

### Decision 2: Subsequent deltas may coalesce by frame/time budget

After first-token flush, text/tool deltas MAY be coalesced using a bounded cadence. The batcher must preserve order and final content.

### Decision 3: Terminal and error events flush pending batches

Completion, interruption, error, and dedup settlement MUST flush pending deltas before final state is committed.

### Decision 4: Batching is below UI rendering, above canonical semantics

The batcher may change delivery cadence, but MUST NOT change `NormalizedThreadEvent` shape, reducer semantics, or history/realtime parity.

## Implementation Plan

1. Inventory realtime event propagation path and identify safe coalescing point.
2. Define first-token bypass and terminal flush rules.
3. Implement bounded coalescing for eligible deltas.
4. Extend replay/perf fixtures to assert ordering, dedup, and no first-token regression.
5. Run realtime perf and boundary guard.

## Validation Matrix

| Area | Evidence |
|---|---|
| Type safety | `npm run typecheck` |
| Regression | `npm run test` |
| Realtime perf | `npm run perf:realtime:extended-baseline` |
| Boundary guard | `npm run perf:realtime:boundary-guard` |
| Heavy test noise | `npm run check:heavy-test-noise` |
| OpenSpec | `openspec validate optimize-realtime-event-batching --strict --no-interactive` |

## Rollback Strategy

Keep batching behind a small scheduler/coalescer boundary. Rollback by disabling the coalescer and restoring immediate event propagation.
