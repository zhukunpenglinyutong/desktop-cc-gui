## Branch Calibration / 分支校准（2026-05-19）

本设计面向当前 `feature/v0.5.0-md` 分支重新实施。所有 hub 大小、调用关系与 perf 风险必须按当前分支重新测量；`feature/v0.5` 上的治理代码不作为事实源。

当前定位：**design-ready / implementation-unstarted**。后续实施一次只能选择一个 primary hub，并重新生成 split map。

## Context

The harness governance strategy identifies oversized orchestration hubs as the main implementation blocker for global governance seams. This proposal targets the measured hot hubs listed in the proposal: `useThreadMessaging.ts`, `useAppServerEvents.ts`, `Composer.tsx`, and `MessagesRows.tsx`.

This change is architecture governance, not feature delivery. It creates cleaner seams for later runtime contract, policy, cost, and domain-event work without rewriting the business model.

## Goals

- Pick one measured hub target per implementation cycle.
- Split pure calculation, side-effect orchestration, and render adapter responsibilities.
- Preserve public hook/component contracts.
- Reduce large-file risk without creating new large files.
- Re-run the relevant perf baseline to prove no degradation.

## Non-Goals

- Do not split all hubs in one change.
- Do not implement virtualization or realtime batching unless selected as a strict prerequisite for the chosen split.
- Do not rewrite thread/composer/message state models.
- Do not introduce a parallel `src/governance/` business layer.

## Decisions

### Decision 1: One hub per implementation slice

The implementation MUST choose exactly one primary hub target for the first slice.

**Why**: splitting multiple hubs at once makes regression attribution impossible.

### Decision 2: Split by responsibility, not line count

Extraction must follow responsibility boundaries: pure helpers, side-effect orchestration, render adapter/presenter, and contract tests.

**Why**: line-count-only splits create more files without clearer seams.

### Decision 3: Public contract remains stable

Existing imports and component/hook APIs should remain stable unless a separate migration plan is included.

**Why**: this is a governance seam refactor, not a caller migration.

### Decision 4: Large-file gate is part of the definition of done

The selected hub must move toward policy thresholds and no extracted file may become the next oversized hub.

## Implementation Plan

1. Measure current file sizes and baseline evidence.
2. Select one primary hub target with concrete perf / large-file motivation.
3. Write a split map: responsibilities, extracted modules, unchanged public API.
4. Execute extraction in small slices with targeted tests.
5. Run typecheck/lint/tests, large-file gate, and relevant perf baseline.

## Validation Matrix

| Area | Evidence |
|---|---|
| Type safety | `npm run typecheck` |
| Lint | `npm run lint` |
| Regression | targeted tests for selected hub |
| Large file governance | `npm run check:large-files:gate` |
| Perf baseline | relevant `npm run perf:*:baseline` command |
| OpenSpec | `openspec validate refactor-mega-hub-split --strict --no-interactive` |

## Rollback Strategy

Keep extraction commits/slices isolated. Rollback by restoring the selected hub's previous implementation and removing extracted modules for that hub only.
