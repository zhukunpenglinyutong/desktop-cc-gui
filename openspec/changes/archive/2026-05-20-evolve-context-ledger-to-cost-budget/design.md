## Branch Calibration / 分支校准（2026-05-19）

本设计面向当前 `feature/v0.5.0-md` 分支重新实施。`feature/v0.5` 中曾出现的 pricing registry、cost projection、budget threshold、checker 与 evidence 均视为废弃实现，不作为当前完成状态。

当前定位：**design-ready / implementation-unstarted**。后续实施必须重新从当前分支的 `src/features/context-ledger/`、`src/types.ts` usage shape、StatusPanel 宿主现状与 i18n 文件开始校准。

## Context

本变更是治理战略 v1.4 §4.2 第 3 件 Quick Win 的落地。

核心判断：

- `context-ledger` 已经在算 token / 算 block / 算 group / 算 projection，**它是 cost 治理的物理基础**。
- 缺的不是"账本"，而是把账本"翻译成钱"（pricing）与"翻译成预算"（budget）。
- 用户痛点显式：v1.4 §四 "杀手锏 - Context Bridge" 之前还有更基础的需求——**用户首先想看到"我花了多少钱"**。

## Current State

### context-ledger 现状（src/features/context-ledger/）

- `types.ts`：已经定义 block / group / projection 等结构。
- `utils/`：projection 计算、governance helper。
- `components/`：负责现有上下文可视化。
- **缺**：pricing source、budget store、cost projection、cross-engine aggregate、StatusPanel 展示位。

### 引擎 usage 数据现状

- `ThreadTokenUsage` 已在 `src/types.ts` 定义，包含 total / last token breakdown、context window、freshness/source 等字段。
- usage 数据经现有 runtime / hook / reducer path 进入前端状态；它**不是** `NormalizedThreadEvent` 的 canonical operation，也不由 `engine-runtime-contract` 重新立法。
- Rust 侧 `events.rs` 等路径会输出 token usage 相关字段，但本 change 的权威输入是前端已有 `ThreadTokenUsage` 快照。
- **缺**：把 `ThreadTokenUsage` 映射到 cost（即 token × pricing → cost）的统一路径。

### StatusPanel 现状

- 当前显示 checkpoint / context / activity 等 capability tab。
- "Cost & Budget" 不存在；用户能看到 token 数，但看不到 $。
- dock 与 popover 双宿主，需要保持一致行为。

## Design Goals

- **不重写 context-ledger**：在已有 block/group/projection 上叠加 pricing/budget/cost。
- **Pricing source 显式可追溯**：每个 cost record MUST 记录 pricing source 元数据。
- **Unknown pricing 显式 degraded**：禁止默认 0、禁止 silent fallback。
- **Cross-engine 可加总，但不混淆 pricing source**：UI 必须能"展开看每个引擎"。
- **Budget 三档阈值**：`info`（提示）/ `warn`（警示）/ `block`（仅 UI 警告，不强行打断）。
- **Spec 薄**：≤ 30 SHALL 条款。

## Non-Goals

- 不接入云端账单服务。
- 不做 cost prediction（基于历史预估未来）。
- 不做 team-level budget。
- 不做 cost-based routing（成本敏感型自动选引擎）；属未来 Workflow Engine。
- 不做 policy chain 接入（属 `evolve-checkpoint-to-policy-chain`）。
- 不改 runtime / reducer 行为。

## Decisions

### Decision 1: 新增独立 capability `context-ledger-cost-budget`，**不做 rename**

事实校准（finding Medium #5）：主 `openspec/specs/` 下没有 canonical `context-ledger` spec，只有 5 个子 capability：

- `context-ledger-attribution`
- `context-ledger-governance-batch`
- `context-ledger-source-navigation`
- `context-ledger-surface`
- `context-ledger-transition-diff`

任何 rename 都会制造 namespace 迁移成本与 archive drift。

**决策**：本 change 新增独立 capability `context-ledger-cost-budget`，与现有 5 个子 capability 并列。spec 文件路径：`openspec/specs/context-ledger-cost-budget/spec.md`。

**Why**：

- 新增 capability 是 OpenSpec 工作流的常规动作，无 archive drift。
- "cost / budget" 在语义上确实是 context-ledger 大家族的新维度，命名与现有 `context-ledger-*` 前缀保持一致。
- 不破坏 5 个现有子 capability 的独立演进路径。

### Decision 2: Pricing source 数据结构

```
PricingSource {
  engine: EngineType;
  model: string;           // 如 "claude-3.5-sonnet"
  input: { perMillionTokens: number; currency: 'USD' };
  output: { perMillionTokens: number; currency: 'USD' };
  cacheRead?: { perMillionTokens: number };
  cacheWrite?: { perMillionTokens: number };
  source: 'fixture' | 'config' | 'remote';
  lastUpdatedAt: string;   // ISO timestamp
  stalenessThresholdDays?: number;
}
```

- `fixture`：仓库内 fixture（默认 fallback）。
- `config`：用户在 settings 中覆盖。
- `remote`：未来接入。

**Why**：

- 字段最小化但可追溯。
- `source` + `lastUpdatedAt` 是 degraded 判定的依据。

### Decision 3: Cost projection 起步基于 session/turn usage snapshot，**block-level cost 标 future**

事实校准（finding Medium #6）：`ContextLedgerProjection` 当前字段只有 `totalUsageTokens` / `contextWindowTokens` / `groups[].blocks[].estimate`；block 的 `estimate.value` 是大致估算（`tokens` / `chars` / `unknown` 三态），**不等于按 block 精确归因的计费 base**。

如果第一版就做 block × pricing → cost，会基于不可靠的 estimate 算出"看起来精确"的金额，违反 v1.4 §四"避免 silent 错算"。

**起步范围（第一版）**：

- Cost projection 输入：`ThreadTokenUsage`（已存在于 `src/types.ts`，是 thread/session 级 token 真值）。
- 计算粒度：per-turn、per-session、per-engine、aggregated workspace。
- **不**做 per-block cost。

**Future scope（标记 follow-up）**：

- block-level cost 归因依赖 `estimate.value` 精度提升；属 `context-ledger-attribution` capability 的演进。
- 若未来 attribution 提供精确 block token，再开 follow-up change 引入 block × pricing。

**Why**：

- 当前 `totalUsageTokens` 已经是 engine 真值，足以服务"我花了多少钱"。
- block-level cost 的精度责任不属本 change。

### Decision 4: Unknown pricing → UI degraded，禁止 silent 0

当 pricing source 为 `null` / `unknown` / 过期：

- CostRecord MUST 标记 `degraded: true` 并附带 `reason`。
- UI MUST 不显示具体金额，显示降级文案（如 "pricing unavailable"）。
- 不允许把未知 cost 累加到 cross-engine aggregate（聚合 view 标注 partial）。

**Why**：silent 错算比无显示更糟；治理价值核心就是"用户能信任这个数字"。

### Decision 5: Budget 三档阈值

```
SessionBudget {
  limit: { amount: number; currency: 'USD' };
  thresholds: {
    info: number;    // 0.5 → 50%
    warn: number;    // 0.8 → 80%
    block: number;   // 1.0 → 100%
  };
}
```

- `info`：UI 静默提示。
- `warn`：UI 显式警示（status bar 高亮）。
- `block`：UI 红色警示 + 显示"已超预算"。**不强制中断 turn**——本 change 不接管行为，只表达事实。

**Why**：

- 用户期望的是"可见性"而非"强制中断"。
- 强制中断属 policy chain 范畴（下游 change）。

### Decision 6: Cross-engine aggregate 显式不混淆 source

聚合 view 必须能"展开看每个引擎"：

- aggregate level：跨引擎总和（明确标注若任一引擎 degraded，aggregate `partial: true`）。
- engine level：按引擎分项。
- session level：跨 turn 聚合。
- turn level：单 turn 明细。

**Why**：

- 不同引擎 pricing source 不同；混合显示一个数字会误导。
- 同时支持"我想看大局"与"我想审计某引擎"。

### Decision 7: StatusPanel 显示位 = 独立 Section

不复用 checkpoint tab；新增 "Cost" section：

- dock 宿主下：StatusPanel 底部 cost summary + 可展开明细。
- popover 宿主下：summary line 显示。
- 双宿主行为一致（参考项目 CLAUDE.md StatusPanel 约定）。

**Why**：

- checkpoint 是 SLA 判决；cost 是经济视图；语义不同，不混淆。

### Decision 8: i18n key 完整覆盖中英文

新增 i18n key 必须 `zh` + `en` 完整。  
key 命名遵循 `statusPanel.cost.*` 与 `statusPanel.budget.*`。

**Why**：项目铁律，文案不走 i18n 就是技术债。

### Decision 9: Spec 薄 + 解耦下游 change

本 spec 不引用 policy chain、不引用 capability matrix（除 `cost.report` capability）、不引用 domain event。

**Why**：避免与 `evolve-checkpoint-to-policy-chain`、`add-agent-domain-event-schema` 范围重叠。

## Implementation Plan

### Phase 1: Pricing source

- 新建 `src/features/context-ledger/pricing/`。
- `pricingTypes.ts` 定义 PricingSource。
- `pricingRegistry.ts` 注册 4 引擎默认 pricing（基于公开 model pricing）。
- `pricingLookup.ts` 根据 engine + model 查询。
- 单测：lookup / 过期判定 / fallback。

### Phase 2: Cost projection

- 新建 `src/features/context-ledger/cost/`。
- `projectCost.ts` 纯函数。
- `costAggregate.ts` 跨引擎聚合。
- 单测：projection / aggregate / degraded 标记。

### Phase 3: Budget store

- 新建 `src/features/context-ledger/budget/`。
- `budgetStore.ts`（Zustand 或现有 store 模式对齐）。
- `budgetThresholds.ts` 三档判定。
- 单测：阈值触发 / 边界。

### Phase 4: StatusPanel 集成

- 新增 Cost section（dock + popover）。
- i18n key 补全。
- dock/popover 双宿主测试。

### Phase 5: Spec & CI

- 起草 `specs/context-ledger-cost-budget/spec.md`。
- 新增 `scripts/check-context-ledger-cost-budget.mjs` parity test。
- 接入 `package.json` script。
- 三平台 CI。

### Phase 6: Validation & Sync

- strict validate。
- 同步 spec 到 `openspec/specs/context-ledger-cost-budget/`。

## Rollback Strategy

- pricing / budget / cost 子模块全部独立模块；revert 不影响 context-ledger 原有 block/group/projection。
- StatusPanel Cost section 可独立 toggle disable。
- 本 change 是新增 `context-ledger-cost-budget` capability，不 rename、不 alias；rollback 等于移除该新增 capability，不影响既有 `context-ledger-*` specs。

## Validation Matrix

| Area | Required Evidence |
|---|---|
| Spec | `openspec validate --strict --no-interactive` |
| Pricing lookup | `pricingLookup.test.ts` |
| Cost projection | `projectCost.test.ts` + `costAggregate.test.ts` |
| Budget threshold | `budgetThresholds.test.ts` |
| StatusPanel section | dock + popover render test |
| Cross-engine consistency | `check:context-ledger-cost-budget` |
| Heavy test noise | `check:heavy-test-noise` |
| Large file | `check:large-files:gate` |
| Cross-platform | CI 三端 |

## Open Questions

- pricing 来源最终是否要远程化（如订阅 OpenAI 公开 pricing 表）——本 change 不做，留 follow-up。
- budget 是否需要 per-workspace 隔离 vs 跨 workspace 累计——design 阶段倾向 per-workspace；最终 spec 阶段确认。
- 是否要支持 multi-currency（非 USD）——本 change 仅 USD；多币种留 follow-up。
- cost-based engine routing 是否纳入 Workflow Engine——属未来 Workflow Engine spec，不在本 change。
