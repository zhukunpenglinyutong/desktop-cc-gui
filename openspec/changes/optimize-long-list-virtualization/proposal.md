## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。`feature/v0.5` 的任何治理实现尝试不作为本 change 的输入或完成证据。

当前分支状态：long-list virtualization 未实施。近两天当前分支的 tool-call fallback、Markdown preview 与 session projection 可能改变 message row 复杂度；后续实施必须重新 inventory 当前 `Messages` / timeline / row 渲染路径与 S-LL baseline。

## Why

`add-runtime-perf-baseline` 已经产出 v0.4.18 的长会话渲染基线。当前 `S-LL-*`
行显示长列表场景存在可量化的 commit 成本：

- `S-LL-200`：`commitDurationP95 = 59.26ms`
- `S-LL-500`：`commitDurationP95 = 39.73ms`
- `S-LL-1000`：`commitDurationP95 = 20.76ms`
- `S-LL-1000`：`scrollFrameDropPct = 0%`，但备注为 `jsdom proxy; browser scroll gate is follow-up`

这些数据说明下一步不该继续盲目 memo 化，而应把长会话渲染优化收口成一个可验证的
virtualization change：在真实浏览器 scroll gate 里证明长列表渲染不会随消息数量线性扩大。

治理关联：长列表不是单一 message UI 问题。session-activity、audit trail、context ledger、policy decision log 和 message rows 都会在长会话中变成长列表投影；如果没有 viewport projection 边界，治理层的数据越完整，UI 越线性退化。这个 change 是治理视图可用性的前置基座。

## Scope

### In Scope

- 为 messages/thread 长列表引入或完善 virtualization 策略。
- 复用仓库已存在的 `@tanstack/react-virtual` 能力，避免自研虚拟滚动。
- 使用 `docs/perf/history/v0.4.18-baseline.md` 的 `S-LL-*` 行作为优化前对照。
- 为 200 / 500 / 1000 条消息场景补浏览器级 scroll verification。

### Out of Scope

- 不改 realtime event batching。
- 不拆分 Composer 或 app-server event hub。
- 不调整 bundle chunking。
- 不改变 audit/context/policy 数据模型；只解决长列表 render projection。

## Acceptance Criteria

- `S-LL-1000` 的 browser scroll gate 必须从 jsdom proxy 升级为真实浏览器验证。
- `S-LL-1000` 的 commit / scroll 指标不得高于 v0.4.18 baseline。
- 长列表首屏与滚动位置恢复必须保持现有用户语义。
- 必须运行 `npm run perf:long-list:baseline` 并更新 `docs/perf/baseline.{md,json}`。
- 若新增 scroll/render tests，必须等价满足 `.github/workflows/heavy-test-noise-sentry.yml` 的 parser tests 与 `npm run check:heavy-test-noise`。
- 若新增 fixture/spec/source 文件，必须等价满足 `.github/workflows/large-file-governance.yml` 的 parser、near-threshold 与 hard gate。
- virtualization 实现不得使用平台专属 scroll/timer 假设；Win/macOS/Linux 下 row identity、scroll restoration 与 active streaming row 行为必须等价。
