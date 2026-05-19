## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。当前客户端已经有 `src/features/engine/engineCapabilityMatrix.ts`，并暴露 `getEngineCapabilityState` / `isEngineCapabilityAvailable` / `resolveEngineCapabilityRuntimeStatus`。本 change 只补**React hook 包装与只读扫描报告**，不重复创建第二套 capability query truth。

## Why

能力矩阵已经存在，但 UI/feature 仍容易直接按 engine name 分支。下一步需要的是一个轻量、安全的消费入口，让新代码优先问 capability，而不是问 engine 名字。

中文一句话：**先让 capability matrix 有一个可靠的 TS 使用入口，再用扫描报告看债务；不要一上来做跨 Rust router 和全仓迁移。**

## What Changes

- Add OpenSpec capability `capability-aware-policy-router` covering:
  - 复用现有 `getEngineCapabilityState` / `resolveEngineCapabilityRuntimeStatus`。
  - `useCapability(capability, engineOverride?)` React hook。
  - 只读扫描脚本，报告当前 engine-name branches。
  - 显式 Non-Goal：不引入 Rust router、不新增 ESLint rule、不强制迁移 5 个 pilot、不修改 matrix 数据。

## Scope

### In Scope

- React hook wrapper around existing matrix helpers.
- React hook wrapper.
- Deterministic JSON scan report for `engine ===` / `engine !==` style branches.
- Tests for all current capability keys and engines.

### Out of Scope

- Rust router.
- Route registry / dispatch table.
- ESLint rule.
- Automatic codemod.
- Pilot migrations.
- New capability dimensions.

## Engineering Constraints

- Query helper MUST be pure and side-effect free.
- Unknown capability keys MUST fail at TypeScript compile time.
- Scanner MUST be read-only, deterministic, and cross-platform.
- Scanner output MUST avoid dumping large source snippets.
- Stage validation intentionally skips the full noise sentry for future incremental edits; run it only during final harness-wide integration closure.
- Large file governance gate is mandatory: changes MUST remain compatible with `.github/workflows/large-file-governance.yml`, including `node --test scripts/check-large-files.test.mjs`, `npm run check:large-files:near-threshold`, and `npm run check:large-files:gate`.
- Windows/macOS/Linux compatibility is mandatory: scanner and tests MUST use Node `path` utilities or normalized POSIX output, avoid shell-only assumptions, and produce deterministic output on ubuntu-latest, macos-latest, and windows-latest.

## Impact

- OpenSpec:
  - `openspec/changes/add-capability-aware-policy-router/**`
- Frontend:
  - Expected hook near existing engine matrix/controller utilities, without duplicating matrix helpers.
- Tooling:
  - Expected `scripts/scan-engine-name-branches.mjs`
  - Optional `npm run check:capability-aware-policy-router`

## Validation

```bash
npm run typecheck
vitest run src/features/engine/engineCapabilityMatrix.test.ts
npm run check:engine-capability-matrix
node --test scripts/check-large-files.test.mjs
npm run check:large-files:near-threshold
npm run check:large-files:gate
openspec validate add-capability-aware-policy-router --strict --no-interactive
```
