## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。原始方案是成本管理产品功能，不是 harness 治理层底座。收敛后，本 change 标记为 **Deferred / Product P2**，不进入当前 harness governance 实施批次。

## Why

`evolve-context-ledger-to-cost-budget` 已提供当前 session 的 cost/budget 投影。跨 workspace 成本总账需要长期存储、Settings UI、导出、retention 和隐私说明，这些都超出当前 harness 治理层的“证据桥接/判决解释”目标。

中文一句话：**总账页面有价值，但它是产品能力，不是当前 harness 治理底座。**

## What Changes

- Keep capability `cross-workspace-cost-admin-view` as deferred product proposal.
- Do not implement as part of current harness governance pass.
- Preserve future constraints:
  - must consume cost-budget projection.
  - no cloud billing.
  - no prompt/path export.
  - explicit retention policy.

## Scope

### Out Of Current Harness Scope

- Cross-workspace aggregation.
- IndexedDB/localStorage cost store.
- Settings admin page.
- CSV/JSON export.
- Retention configuration.

## Status

Deferred until after harness governance evidence bridge is implemented and cost-budget data capture has a stable source.

## Validation

Stage validation intentionally skips the full noise sentry; run it only during final harness-wide integration closure.

```bash
openspec validate add-cross-workspace-cost-admin-view --strict --no-interactive
```
