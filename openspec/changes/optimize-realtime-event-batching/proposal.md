## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。`feature/v0.5` 上曾出现的 batching contract、checker、task 勾选与 `implementation-evidence.md` 不再作为本变更依据；后续必须在当前分支重新实现。

当前分支状态：realtime batching 未落地。近两天当前分支的 sidebar timeout fallback 与 runtime/list fallback 修复提高了恢复链路稳定性，但不改变本 change 的边界：第一版只约束 realtime delivery cadence，不引入 domain event runtime，也不重定义 `NormalizedThreadEvent`。

## Why

`add-runtime-perf-baseline` 已经把 realtime 扩展场景固化为可对比数据：

- `S-RS-FT`：`firstTokenLatency = 5000ms`
- `S-RS-FT`：`interTokenJitterP95 = 920ms`
- `S-RS-PE`：`dedupHitRatio = 0.25`
- `S-RS-PE`：`assemblerLatency = 3.93ms`

当前瓶颈不是单个 reducer 的绝对耗时，而是 realtime event 到 UI 的传播频率与抖动缺少 batching
边界。下一步应围绕 event batching / coalescing 建立明确 contract，避免修复首包与 dedup 后又被
高频 delta 推送拖回卡顿。

治理关联：`engine-runtime-contract` 正式化后，audit/cost/policy/session-activity 都会围绕 realtime/runtime 事实做派生。若高频 delta 没有明确 batching/coalescing 边界，每新增一个治理消费者都会放大 event fan-out 抖动。这个 change 是治理消费者安全接入前的 propagation cadence contract。

## Scope

### In Scope

- 为 realtime delta / tool output / status update 定义 batching 或 coalescing 策略。
- 保护 first-token 语义：batching 不得延迟首个用户可见 assistant delta。
- 复用 `realtimeReplayHarness` 和 `S-RS-*` extended fixture 作为回归入口。
- 为 dedup path 保持现有 `dedupHitRatio` 语义，避免重复响应重新污染 UI。

### Out of Scope

- 不做长列表 virtualization。
- 不拆分 mega hub。
- 不改冷启动 bundle splitting。
- 不引入 `AgentDomainEvent` runtime；本 change 只约束现有 realtime 传播节奏。

## Acceptance Criteria

- `S-RS-FT` 的 first-token path 不得比 `5000ms` fixture baseline 更差。
- `S-RS-FT` 的 `interTokenJitterP95` 必须有明确改善目标或保持不退化。
- `S-RS-PE` 的 `dedupHitRatio = 0.25` 语义必须保持稳定。
- 必须运行 `npm run perf:realtime:extended-baseline` 与 `npm run perf:realtime:boundary-guard`。
- 新增 realtime/batcher tests 必须等价满足 `.github/workflows/heavy-test-noise-sentry.yml`：`node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs` 与 `npm run check:heavy-test-noise` 均通过。
- 若新增 fixture/spec/source 文件，必须等价满足 `.github/workflows/large-file-governance.yml` 的 parser、near-threshold 与 hard gate。
- batching/coalescing 实现不得依赖平台 timer、newline、shell 或 process 差异；三平台 runner 上的 ordering 与 flush 语义必须等价。
