## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。原始方案中的 dashboard、IndexedDB、默认开启、histogram、匿名导出过早产品化。收敛后，本 change 降级为 **Deferred / P2**：只保留本地、可选、无持久化的治理计数契约，等待 evidence bridge 与 audit surface 落地后再决定是否实施。

## Why

治理系统需要自我观测，但当前客户端更缺的是“证据可见”和“判决可解释”。在没有稳定 evidence bridge 前引入 telemetry store，会制造第二套治理数据源。

中文一句话：**现在先别做遥测产品；最多预留一个不持久化、不上报、可完全关闭的计数接口。**

## What Changes

- Add OpenSpec capability `governance-telemetry-loop` as deferred design:
  - 定义未来治理计数事件的边界。
  - 禁止 cloud upload、第三方 SDK、prompt/path/token 收集。
  - 禁止默认持久化。
  - 显式 Non-Goal：不做 dashboard、不做 IndexedDB store、不做 histogram、不做匿名导出、不默认开启。

## Scope

### In Scope

- Future local-only counter contract.
- Privacy allowlist rules.
- Fire-and-forget recorder boundary.

### Out of Scope For Current Stage

- Implementation.
- Dashboard.
- IndexedDB/localStorage persistence.
- Export.
- Histogram/timer.
- Default-on telemetry.
- Any network upload or third-party SDK.

## Status

Deferred. This change should not be implemented before:

- `add-policy-decision-audit-surface`
- `integrate-openspec-trellis-bridge-into-status-panel`

## Validation

Stage validation intentionally skips the full noise sentry; run it only during final harness-wide integration closure.

```bash
openspec validate add-governance-telemetry-loop --strict --no-interactive
```
