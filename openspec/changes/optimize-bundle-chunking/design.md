## Branch Calibration / 分支校准（2026-05-19）

本设计面向当前 `feature/v0.5.0-md` 分支重新实施。bundle artifacts、main/vendor size、domain contributors 与 lazy boundary 候选必须按当前分支重新测量；`feature/v0.5` 不作为事实源。

当前定位：**design-ready / implementation-unstarted**。后续实施必须先跑当前 cold-start / build output inventory，再确定 chunk plan。

## Context

`add-runtime-perf-baseline` 已经把 cold-start bundle 指标落盘：`S-CS-COLD.bundleSizeMain = 1858800 bytes`，`bundleSizeVendor = 163595 bytes`，`firstPaintMs/firstInteractiveMs = unsupported`。

本 change 与 harness 治理层的关系是 **delivery governance**：治理层不是只管 policy，也要保证治理 UI 不把 Tauri desktop 首屏拖垮。bundle chunking 的目标是让低频治理/管理功能从首屏 critical path 中解耦，同时不伪造 webview timing。

## Goals

- 把 bundle composition 变成可解释、可回归的性能契约。
- 只拆低频 feature / 重依赖，不破坏 Tauri 首屏 critical path。
- 保持 unsupported timing 的诚实记录，不用假指标制造进展。
- 让后续 governance panels / admin views 增长时有 chunking gate。

## Non-Goals

- 不引入 Playwright / Lighthouse 作为强依赖。
- 不改变运行时 feature 语义。
- 不处理 long-list virtualization、realtime batching、hub split。
- 不承诺 firstPaint / firstInteractive 数值，除非后续有真实 Tauri/webview instrumentation。

## Decisions

### Decision 1: 以 domain chunk 为边界，不按依赖名机械拆分

优先拆分低频 domain：SpecHub、settings/admin surface、docs/preview、heavy visualization，而不是把每个 npm dependency 都拆成 chunk。

**Why**：治理层会持续增加面板与分析 UI；domain chunk 比 vendor-name chunk 更可解释。

### Decision 2: 首屏 critical path 白名单

首屏必需模块（app shell、workspace/session restore、composer basic path、active thread rendering）不得因 lazy boundary 被延迟加载。

**Why**：bundle 变小但首屏变慢是伪优化。

### Decision 3: baseline 只记录真实可观测项

`firstPaintMs` / `firstInteractiveMs` 当前 unsupported 必须继续显式记录；本 change 只评价 bundle size 与 artifact composition。

**Why**：治理文档要求事实校准，不能用假的 timing 填空。

### Decision 4: chunking 结果必须可解释

每个新增 manual chunk / lazy import 必须有来源说明：为什么低频、为什么不在 critical path、如何回滚。

**Why**：防止后续 chunk 配置变成不可维护的魔法表。

## Implementation Plan

1. 运行 cold-start baseline，记录当前 bundle artifacts。
2. 分析 Vite output，列出 main bundle top contributors。
3. 选择 1-3 个低频 domain 做 lazy boundary 或 manual chunk。
4. 跑 typecheck/test/build 与 cold-start baseline。
5. 更新 perf baseline，并记录 main/vendor bundle 变化与不能下降的原因。

## Validation Matrix

| Area | Evidence |
|---|---|
| Type safety | `npm run typecheck` |
| Regression | `npm run test` |
| Bundle baseline | `npm run perf:cold-start:baseline` |
| Perf aggregate | `npm run perf:baseline:aggregate` |
| Large file governance | `npm run check:large-files:gate` |
| OpenSpec | `openspec validate optimize-bundle-chunking --strict --no-interactive` |

## Rollback Strategy

Revert lazy boundaries / manual chunk config independently. If startup semantics regress, rollback chunking first and keep only analysis artifacts.
