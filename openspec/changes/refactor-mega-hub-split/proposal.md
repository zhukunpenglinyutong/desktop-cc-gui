## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。`feature/v0.5` 的任何治理实现尝试不作为本 change 的输入或完成证据。

当前分支状态：本 change 仍处于 design-ready / implementation-unstarted。近两天当前分支已有 session display projection、tool-call fallback、sidebar timeout fallback 等局部抽取/加固事实；后续选择 primary hub 时必须重新测量当前文件大小、调用关系和 perf baseline，不得沿用旧分支判断。

## Why

`add-runtime-perf-baseline` 的目的不是直接优化，而是指出后续拆分顺序。当前长列表 baseline
已经给出 commit-duration 热点入口：

- `S-LL-200`：`commitDurationP95 = 59.26ms`
- `S-LL-500`：`commitDurationP95 = 39.73ms`
- `S-LL-1000`：`commitDurationP95 = 20.76ms`

同时提案中列出的高风险 hub 已接近或超过治理上限：

- `src/features/threads/hooks/useThreadMessaging.ts`
- `src/features/app/hooks/useAppServerEvents.ts`
- `src/features/composer/components/Composer.tsx`
- `src/features/messages/components/MessagesRows.tsx`

下一步应以 measured render / event propagation 热点为拆分边界，而不是按文件行数机械切割。

治理关联：这些 hub 是 runtime、composer、message render、server event 的事实汇合点，也是未来 policy/cost/domain-event 注入最容易被迫"手术"的位置。若不先把责任边界拆清楚，治理层每个后续 change 都会在巨型文件里做语义合并，回归不可控。这个 change 是 harness governance 的 structural blocker。

## Scope

### In Scope

- 根据 baseline 与 profiler 采样确定一个优先拆分目标。
- 将巨型 hub 的纯计算、side effect orchestration、render adapter 分层拆出。
- 保持 public hook/component contract 不破坏调用方。
- 为拆分后的关键路径补 targeted tests。

### Out of Scope

- 不在同一 change 内同时拆所有 hub。
- 不顺手实现 virtualization 或 batching，除非它是拆分目标的必要前置。
- 不重写业务状态模型。
- 不新建平行 `src/governance/` 业务层；拆分结果必须服务现有 feature 的治理接缝。

## Acceptance Criteria

- 拆分目标必须引用 `S-LL-*` 或 composer/realtime baseline 中的具体指标作为动机。
- 被拆文件必须显著下降到治理阈值内，且新增文件不触发 large-file gate。
- `npm run typecheck`、`npm run lint`、相关 targeted tests 必须通过。
- 需要重新运行对应 baseline，确认 commit-duration 热点没有恶化。
- 必须等价满足 `.github/workflows/large-file-governance.yml`：`node --test scripts/check-large-files.test.mjs`、`npm run check:large-files:near-threshold`、`npm run check:large-files:gate` 均通过。
- 若新增或扩展 targeted tests，必须等价满足 `.github/workflows/heavy-test-noise-sentry.yml` 的 parser tests 与 `npm run check:heavy-test-noise`。
- 拆分代码不得引入 POSIX-only path、shell quoting、newline 或平台专属 process 语义；mossx 是 Win/macOS/Linux 通用客户端，平台差异必须留在现有 adapter/IPC 层。
