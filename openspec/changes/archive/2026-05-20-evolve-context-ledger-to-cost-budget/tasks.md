## 0. Branch Calibration

Current branch source of truth: `feature/v0.5.0-md`.

Closure recalibration on 2026-05-20 confirmed current-branch implementation evidence is present for pricing fixtures, cost projection, budget thresholds, StatusPanel integration, checker wiring, and OpenSpec validation. Prior `feature/v0.5` evidence remains non-authoritative; the authoritative evidence for this branch is the current `implementation-evidence.md`, current code facts, and the validation commands recorded below.

## 1. Pricing Source

- [x] 1.1 [P0][depends:none][I: 4 引擎公开 pricing 文档 + 已有 model 列表][O: pricing fixture（per-engine 拆分）][V: 每引擎独立 fixture 文件，不创建近阈值大文件] 落地初始 pricing fixture。
- [x] 1.2 [P0][depends:1.1][I: pricing fixture][O: `src/features/context-ledger/pricing/pricingTypes.ts`][V: PricingSource 字段 / `fixture` / `config` / `remote` 三态] 定义 PricingSource 类型。
- [x] 1.3 [P0][depends:1.2][I: pricingTypes][O: `pricingRegistry.ts`][V: lookup 函数 + 缺失返回 `null`] 实现 pricing registry。
- [x] 1.4 [P0][depends:1.3][I: registry][O: `pricingRegistry.test.ts`][V: lookup / staleness / fallback 全覆盖] 单测 pricing registry。

## 2. Cost Projection

- [x] 2.1 [P0][depends:1.3][I: `ThreadTokenUsage` (`src/types.ts`)][O: `cost/projectCost.ts` 纯函数][V: 输入 usage + pricing → CostRecord] 实现 per-turn / per-session cost projection。
- [x] 2.2 [P0][depends:2.1][I: cost projection][O: `cost/costAggregate.ts`][V: per-engine 与 workspace aggregate；degraded 时 `partial: true`] 实现 cross-engine aggregate。
- [x] 2.3 [P0][depends:2.1,2.2][I: projection / aggregate][O: 单测覆盖][V: degraded / partial / known pricing 三类全覆盖] 单测 projection 与 aggregate。
- [x] 2.4 [P1][depends:2.1][I: design.md Decision 3][O: spec follow-up 备忘][V: block-level cost 明确标 future] 文档化 block-level cost 不在本 change。

## 3. Session Budget

- [x] 3.1 [P0][depends:2.1][I: cost projection][O: `budget/budgetStore.ts`][V: per-session budget config + 三档阈值] 实现 budget store。
- [x] 3.2 [P0][depends:3.1][I: budgetStore][O: `budget/budgetThresholds.ts`][V: info / warn / block 触发逻辑] 实现 threshold 判定。
- [x] 3.3 [P0][depends:3.1,3.2][I: budget][O: 单测][V: 阈值边界 / 跨阈值跳变 / 缺省 budget 行为完整] 单测 budget。
- [x] 3.4 [P0][depends:3.2][I: spec][O: block tier 不接管 runtime 行为][V: 测试断言 block tier 时 runtime 不被本 capability 中断] 验证非中断行为。

## 4. StatusPanel Integration

- [x] 4.1 [P0][depends:2.2,3.2][I: cost + budget 数据][O: StatusPanel Cost section（dock）][V: dock 渲染测试通过] 接入 dock 宿主。
- [x] 4.2 [P0][depends:4.1][I: StatusPanel popover 宿主][O: popover 渲染等价][V: popover 渲染测试通过；与 dock 数据语义等价] 接入 popover 宿主。
- [x] 4.3 [P0][depends:4.1][I: 新增 user-facing 文案][O: i18n key `statusPanel.cost.*` / `statusPanel.budget.*`][V: zh 与 en 同步落地] 补齐 i18n。
- [x] 4.4 [P0][depends:4.3][I: i18n key 列表][O: i18n parity check 通过][V: 现有 i18n parity script 或新增脚本] i18n parity。

## 5. Spec & CI

- [x] 5.1 [P0][depends:1-4][I: 已实现模块][O: `specs/context-ledger-cost-budget/spec.md`][V: SHALL 条款 ≤ 30] 起草 spec.md。
- [x] 5.2 [P0][depends:5.1][I: pricing / cost / budget 行为][O: `scripts/check-context-ledger-cost-budget.mjs`][V: 包含 pricing schema / projection invariant / threshold 三类断言] 新增 parity check 脚本。
- [x] 5.3 [P0][depends:5.2][I: package.json][O: `npm run check:context-ledger-cost-budget`][V: 本地与 CI 入口一致] 接入 npm script。
- [x] 5.4 [P0][depends:5.3][I: CI workflow][O: 三平台接入][V: ubuntu/macos/windows 等价执行] CI 三端接入。

## 6. Governance Gates

- [x] 6.1 [P0][depends:1-5][I: 全部触及代码][O: 前端基线][V: `npm run typecheck` + `npm run test`] 前端基线。
- [x] 6.2 [P0][depends:5][I: parity check][O: cost-budget 证据][V: `npm run check:context-ledger-cost-budget`] cost-budget 检查。
- [x] 6.3 [P1][depends:1-5][I: 测试输出][O: heavy-noise 证据][V: `npm run check:heavy-test-noise`] heavy-test-noise sentry。
- [x] 6.4 [P1][depends:1-5][I: pricing fixture / 源文件][O: large-file 证据][V: `npm run check:large-files:gate`] large-file sentry。
- [x] 6.5 [P0][depends:6.1-6.4][I: 全部 artifact][O: strict 验证][V: `openspec validate evolve-context-ledger-to-cost-budget --strict --no-interactive`] OpenSpec strict validate。

## 7. Completion Review

- [x] 7.1 [P0][depends:6.5][I: validation 输出][O: residual risk 列表][V: 跳过的检查附原因] 记录证据与残余风险。
- [x] 7.2 [P1][depends:7.1][I: 触及边界][O: follow-up backlog][V: block-level cost / cost prediction / multi-currency / cost-based routing 显式列入] 列出后续 change 接力清单。
- [x] 7.3 [P0][depends:7.1][I: 提案对照][O: 与现有 `context-ledger-*` 子 capability 边界对齐][V: 没有破坏现有 5 个子 capability] 校准与现有 capability 的边界。
