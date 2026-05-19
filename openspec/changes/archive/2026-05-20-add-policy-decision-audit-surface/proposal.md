## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。现有客户端已经在 `StatusPanelData.policyAudit` 中投影 policy chain 判决细节，因此本 change 只做**当前 verdict 的只读可解释展示**，不扩张成 audit 产品线。

## Why

`evolve-checkpoint-to-policy-chain` 已经让 checkpoint verdict 由 policy chain 计算，并在 `src/features/status-panel/utils/checkpoint.ts` 中把判决明细写入 `policyAudit`。但当前 `CheckpointPanel` 仍主要展示最终状态，用户看到 `blocked` / `needs_review` 时不知道是哪条 policy 触发、证据是什么。

中文一句话：**判决证据已经在客户端里了，本 change 只把它在现有 CheckpointPanel 里讲清楚，不新增历史库、不导出、不做修复按钮。**

## What Changes

- Add OpenSpec capability `policy-decision-audit-surface` covering:
  - 在现有 `CheckpointPanel` 内增加默认折叠的 "Why this verdict?" 只读区域。
  - 读取当前 `StatusPanelData.policyAudit`，展示 policy id、contribution、reason 与 sourceId。
  - dock 与 popover 双宿主渲染一致。
  - 文案走现有 `statusPanel.policy.*` 与新增少量 `statusPanel.audit.*` keys。
  - 显式 Non-Goal：不做 localStorage 历史、不做 JSON export、不做 repair action、不新增 policy 类型。

## Scope

### In Scope

- 当前 verdict 的只读 audit list。
- Policy decision formatter，处理空 reason、空 sourceId、`no_contribution` 与未知 policy id。
- `CheckpointPanel` 内联折叠区，默认折叠。
- dock / popover 行为一致性测试。
- zh/en 文案完整性。

### Out of Scope

- 不持久化最近 N 次 verdict。
- 不导出 audit JSON。
- 不做 repair action 入口。
- 不引入 telemetry。
- 不创建独立 StatusPanel tab 或 admin window。
- 不修改 policy chain 判决算法。

## Engineering Constraints

- Formatter MUST 对空 reason、空 sourceId、`no_contribution` 与未知 policy id 安全降级。
- UI MUST 只消费已有 `policyAudit` 数据，不在组件内重新运行 policy chain。
- 测试 MUST 静默，不能打印 evidence payload。
- 新增组件必须小文件拆分，遵守 large-file gate。
- Stage validation intentionally skips the full noise sentry; run it only during final harness-wide integration closure.
- Large file governance gate is mandatory: changes MUST remain compatible with `.github/workflows/large-file-governance.yml`, including `node --test scripts/check-large-files.test.mjs`, `npm run check:large-files:near-threshold`, and `npm run check:large-files:gate`.
- Windows/macOS/Linux compatibility is mandatory: implementation MUST avoid platform-specific path separators, shell-only assumptions, case-sensitive filename assumptions, and CRLF/LF fragile snapshots.

## Impact

- OpenSpec:
  - `openspec/changes/add-policy-decision-audit-surface/**`
- Frontend:
  - 预计新增 `src/features/status-panel/components/audit/`
  - 预计新增 `src/features/status-panel/utils/audit/policyDecisionFormatter.ts`
  - 修改 `src/features/status-panel/components/CheckpointPanel.tsx`
  - 新增少量 i18n keys

## Validation

```bash
npm run typecheck
vitest run src/features/status-panel/components/StatusPanel.test.tsx src/features/status-panel/utils/checkpoint.test.ts
npm run check:checkpoint-policy-chain
node --test scripts/check-large-files.test.mjs
npm run check:large-files:near-threshold
npm run check:large-files:gate
openspec validate add-policy-decision-audit-surface --strict --no-interactive
```
