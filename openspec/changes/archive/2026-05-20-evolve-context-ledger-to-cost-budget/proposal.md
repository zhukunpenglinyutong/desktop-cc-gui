## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。`feature/v0.5` 上曾出现的 pricing/cost/budget core、checker、CI wiring、task 勾选与 `implementation-evidence.md` 不再作为本变更依据；后续必须在当前分支重新实现。

当前分支状态：context-ledger 现有能力仍是事实基础，但 cost/budget/pricing 扩展未落地。近两天当前分支的 session display projection 与 sidebar fallback 只影响可见 session 事实，不改变本 change 的 cost projection 输入边界：第一版仍以 `ThreadTokenUsage` 为权威输入，不从 UI 投影反推成本。

## Why

`src/features/context-ledger/` 已经存在 block / group / projection / governance utils，但**只解决了"上下文账本"，没有解决"成本/预算视图"**。

治理战略 v1.4 §4.2 "第 3 件 Quick Win" 明确要求：

- 跨引擎统一的 cost / context / token 视图。
- 用户能直接看到"本会话花了 $X / 预算还剩 Y"。
- Pricing source 显式化；未知 pricing MUST 显示为 degraded，而不是 silent 错算。
- Budget threshold + SLO 接入 StatusPanel。

中文一句话：**账本已经在算 token，但还没把 token 翻译成钱、也没翻译成预算**。

本变更只做一件事：**在 context-ledger 家族新增独立 capability `context-ledger-cost-budget`**，在 `src/features/context-ledger/` 已有 block/group/projection 数据结构之上叠加 pricing source、session budget、cost projection，并提供一个跨引擎的统一视图，供 StatusPanel 与未来 admin view 消费。**不做 spec rename**（参见 design.md Decision 1）。

## Priority Calibration / 优先级校准

| Priority | Included Area | Why Included | If Not Fixed | If Fixed |
|---|---|---|---|---|
| P0 | Pricing source contract | 没有 pricing source 就无法报价 | 用户看不到成本 | session/turn cost 可解释 |
| P0 | Session budget & threshold | 治理价值核心 | 烧光预算无预警 | 预算到达阈值时 UI 可见警示 |
| P0 | Cross-engine cost aggregate | 跨引擎统一视图 | 多引擎切换时账本割裂 | 同一 workspace 内 4 引擎 cost 可加总 |
| P0 | Unknown pricing degraded display | 没有 pricing 时不能瞎算 | silent 错算（更糟） | UI 明确显示 degraded |
| P1 | StatusPanel surface 集成 | 治理对用户可见的入口 | 治理隐形 | 用户看到 "$X / 预算 Y" |
| P1 | Token SLO（per turn / per session） | 用户能设阈值 | 无预警机制 | 接近 SLO 时显式提醒 |
| P1 | Cost export / audit hook | 后续 admin view 接入点 | 数据不能导出 | 可导出 cost record |

提案边界：**不引入新的 pricing 数据库 / 不引入云端账单 / 不接管引擎自带的 cost report**；本 change 只负责"把账本翻译成钱与预算"。

## What Changes

- Add new OpenSpec capability `context-ledger-cost-budget`（与现有 `context-ledger-attribution` 等 5 个子 capability 并列，不做 rename，不破坏 archive 链路）。TS feature 路径保持 `src/features/context-ledger/` 不变，仅扩展模块。
- Add new capability spec covering:
  - Pricing source contract（per-engine pricing source 来自何处、如何 invalidate）
  - Session budget contract（budget 单位、阈值层级、衰减规则）
  - Cross-engine cost aggregate（聚合规则、currency normalization）
  - Unknown pricing degraded UI rule
  - Token SLO 接入
  - Audit export hook
- 在 `src/features/context-ledger/` 下扩展模块：
  - `pricing/` 子目录：pricing source registry + per-engine pricing modules
  - `budget/` 子目录：budget store + threshold reducer
  - `cost/` 子目录：cost projection（**起步基于 thread/session usage snapshot；block-level cost 标 future**）
- StatusPanel 增加"Cost & Budget"展示位（dock 与 popover 双宿主一致）。
- 不删除 context-ledger 现有 block / group / projection；只扩展。

## Scope

### In Scope

- Define `context-ledger-cost-budget` spec，≤ 30 SHALL 条款，覆盖：
  - Pricing source MUST 在每个 cost projection 中可追溯。
  - Pricing currency MUST 统一为 USD（或显式标注其他）。
  - Unknown pricing MUST 触发 UI degraded state。
  - Session budget MUST 支持三档阈值（`info` / `warn` / `block`）。
  - Cross-engine aggregate MUST 不混淆不同 pricing source。
  - Cost record MUST 可序列化、可导出。
  - Token SLO（per turn / per session）MUST 接入 budget 同一路径。
- 实现 `pricing/` / `budget/` / `cost/` 子模块；保留 context-ledger 现有 API。
- StatusPanel 集成"Cost & Budget"显示位（i18n key 新增）。
- Fixture + 单测 + parity test 覆盖。
- 依赖前置：`add-engine-capability-matrix-spec` 完成（cost.report capability 在矩阵中已声明）；现有 `ThreadTokenUsage` / usage data path 可用。`formalize-engine-runtime-contract` 只约束 `NormalizedThreadEvent` 域，不把 usage update 重新表达为 runtime event contract。

### Out of Scope

- 云端账单 / SaaS 计费集成。
- 新的 pricing 数据源接入（如订阅 OpenAI API 实时 pricing）；本 change 用本地 pricing fixture，留接入点。
- 团队级 budget（跨用户）：留给 admin view follow-up。
- Cost prediction（未发生 turn 的预估）：留 follow-up。
- 拆 app-shell、改 reducer 行为（runtime 视角不变）。
- Policy chain 自动 block 行为：属 `evolve-checkpoint-to-policy-chain`。

## Engineering Constraints

继承三道哨兵 + StatusPanel feature 现有约束：

### Cross-Platform Compatibility

- Cost number 渲染 MUST 不假设特定 locale 货币格式；通过 i18n 提供。
- 任何持久化（如 budget 配置）MUST 使用 platform-safe path API。

### Heavy Test Noise Sentry

- 新增 pricing / budget / cost 测试 MUST 静默。
- 不允许在错误路径下输出 raw payload 到 stdout。

### Large File Governance Sentry

- pricing fixture 必须按 engine 分文件，**禁止单一巨型 pricing.json**。
- `src/features/context-ledger/` 内子目录拆分 MUST 不创建新近阈值文件。

### Status Panel 双宿主一致性

- "Cost & Budget" 显示位 MUST 在 dock 与 popover 两种宿主下行为一致（参考项目 CLAUDE.md 关于 StatusPanel 的约定）。

## Impact

- OpenSpec:
  - `openspec/changes/evolve-context-ledger-to-cost-budget/{proposal,design,tasks}.md`
  - `openspec/changes/evolve-context-ledger-to-cost-budget/specs/context-ledger-cost-budget/spec.md`
  - （事实：主仓 `openspec/specs/` 已有 5 个 `context-ledger-*` 子 capability；本 change **新增** `context-ledger-cost-budget` 与之并列，**不 rename、不 alias**）
- Frontend:
  - `src/features/context-ledger/` 新增 `pricing/`、`budget/`、`cost/` 子模块
  - `src/features/context-ledger/types.ts` 扩展（保留旧 type alias）
  - `src/features/status-panel/components/CheckpointPanel.tsx` 与 dock/popover 宿主扩展显示位（或独立 Cost section）
  - 新增 i18n key（zh + en）
- 不动 Rust：当前所有 pricing 与 budget 推断在 TS 完成；Rust 仅按已有 usage 事件输入。
- CI:
  - 新增 `npm run check:context-ledger-cost-budget`（parity test）
  - 接入三平台 CI

## Risks

- **Pricing 数据漂移**：本地 pricing fixture 可能滞后；用 `pricing.source.lastUpdatedAt` 字段显式标注，超过阈值 UI 显示 degraded。
- **Budget UI 干扰用户**：budget 警示位置不当会变 distracting；设计阶段确认 dock vs popover 的分配。
- **Cross-engine aggregate 误算**：不同 pricing source 不可简单加；spec 强制 "aggregate MUST 不混淆 pricing source"。
- **未知 pricing 静默**：必须显式 degraded；spec 强制规则 + UI 单测覆盖。
- **依赖前置 change**：若 capability matrix / runtime contract 未合并，cost 字段可能漂移。
- ~~**Spec 重命名**~~：已校准（finding Medium #5）。**不做 rename**；新增独立 capability `context-ledger-cost-budget`，避免与现有 5 个 `context-ledger-*` 子 capability 的 archive 链路冲突。

## Migration Strategy

1. 等待 `add-engine-capability-matrix-spec` 合并（cost.report capability 已声明）。
2. 完成本 proposal + design 评审。
3. 起草 spec.md + tasks.md。
4. 实现 pricing/ 子模块（pure data + lookup），不动 UI。
5. 实现 budget/ 子模块 + reducer hook。
6. 实现 cost/ projection（`ThreadTokenUsage` × pricing → per-turn / per-session / per-engine cost record；block-level cost 明确留 future）。
7. StatusPanel 接入显示位 + i18n。
8. 通过 strict validate，同步 spec 到主仓。

## Validation

```bash
npm run typecheck
npm run test
npm run check:context-ledger-cost-budget   # 新增
openspec validate evolve-context-ledger-to-cost-budget --strict --no-interactive
```

When-touched:

```bash
node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs
npm run check:heavy-test-noise
node --test scripts/check-large-files.test.mjs
npm run check:large-files:near-threshold
npm run check:large-files:gate
```

Required CI parity:

- Cost projection test MUST 在 ubuntu/macos/windows 三端等价执行。
- pricing fixture MUST 通过 schema 校验。
- StatusPanel 显示位 MUST 通过双宿主测试。
- 必须等价满足 `.github/workflows/heavy-test-noise-sentry.yml` 与 `.github/workflows/large-file-governance.yml`，不能只跑部分 npm gate。
- pricing / cost / budget 代码不得写入 POSIX-only path、shell quoting、newline 或平台专属可执行解析；所有本地存储路径必须通过跨平台 path abstraction。
