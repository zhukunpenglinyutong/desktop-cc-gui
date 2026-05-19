## Branch Calibration / 分支校准（2026-05-19）

本设计面向当前 `feature/v0.5.0-md` 分支重新实施。`feature/v0.5` 中曾出现的 policy registry、validation policies、audit buffer、checker 与 evidence 均视为废弃实现，不作为当前完成状态。

当前定位：**design-ready / implementation-unstarted**。后续实施必须重新 inventory 当前分支的 `checkpoint.ts`、`CheckpointPanel` 双宿主、validation evidence shape 与 i18n 文件。

## Context

本变更是治理战略 v1.4 §4.2 第 4 件 Quick Win 的落地。

核心判断：

- Checkpoint 是 mossx 的事实 policy engine——四态判决在用户每次 turn 后被消费。
- 当前 `checkpoint.ts` 集中所有判决逻辑；治理战略已要求把它变成"可插拔 policy chain 宿主"。
- 现有 lint / typecheck / tests validation evidence 已经进入 checkpoint 视野，但仍是内聚在同一判决路径中的黑箱逻辑。
- large-file / OpenSpec validate / build cache 等外部治理 signal 还没有 checkpoint evidence bridge；治理信号与用户可见 SLA 之间仍断链，不能在第一版 policy chain 中直接消费。

## Current State

### checkpoint.ts 现状

- 文件位置：`src/features/status-panel/utils/checkpoint.ts`
- 体量现状：约 978 行（`wc -l src/features/status-panel/utils/checkpoint.ts`），核心入口为 `buildCheckpointViewModel`，判决集中在 `resolveVerdict` 等 helper。
- 测试位置：`checkpoint.test.ts`（同目录）
- 输出：`CheckpointViewModel`（含 verdict / risk / nextAction / evidence summary）

### 四态语义

- `running`：turn 进行中。
- `blocked`：runtime 异常 / 致命错误。
- `needs_review`：有 risk evidence 需用户确认。
- `ready`：turn 完成且无未决问题。

### 现有 evidence 输入

- thread / turn / runtime state
- token usage / rate limit
- activity timeline
- diff review state
- shared session signal

### 治理信号现状

- `npm run check:large-files:*` 产出 governance signal，但**不进 checkpoint**。
- `npm run typecheck` 产出 type signal，但**不进 checkpoint**。
- `openspec validate` 产出 spec consistency signal，但**不进 checkpoint**。

### Status Panel UI 现状

- dock + popover 双宿主。
- checkpoint tab 内 capability slug 为 `checkpoint`，用户侧文案 `Result`。
- `CheckpointPanel.tsx` 已成熟，行为细腻。

## Design Goals

- **现有四态 UX 零变化**：用户感知 0 regression。
- **Policy 化 = 解构而非重写**：把现有逻辑抽取为 `corePolicy`，行为等价。
- **Policy 接口最小化**：每个 policy 仅声明 `appliesTo` + `evaluate`。
- **Chain 组合规则可解释**：每次 verdict 都能列出贡献来源。
- **Audit trail 节制**：默认仅最近 N 条；不构建 full event log（属 domain event change）。
- **第一批 policy 默认软接入**：lint / typecheck / tests validation evidence 触发时 contribution 上限 `needs_review`，不直接 `blocked`，避免 UX 阻塞；large-file / spec-consistency 需要先建立 evidence bridge。
- **Spec 薄**：≤ 30 SHALL。

## Non-Goals

- 不引入跨 thread / 跨 workspace policy 联动。
- 不引入 EventBus / domain event publish（属 `add-agent-domain-event-schema`）。
- 不引入 cost-based policy（属 cost ledger change）。
- 不接管 runtime 中断；policy 仅影响 UI verdict。
- 不引入 policy versioning（latest 即真相，留 follow-up）。
- 不引入 admin UI policy 编辑器；本 change 不做 UI 编辑。

## Decisions

### Decision 1: Policy 接口最小化

```typescript
interface Policy {
  id: string;                                       // e.g. 'core' / 'large-file' / 'typecheck'
  appliesTo: (evidence: CheckpointEvidence) => boolean;
  evaluate: (evidence: CheckpointEvidence) => PolicyDecision;
}

interface PolicyDecision {
  verdictContribution:
    | 'running'
    | 'blocked'
    | 'needs_review'
    | 'ready'
    | 'no_contribution';
  reason: string;            // i18n key
  repairAction?: RepairAction;
  severity: 'info' | 'warn' | 'block';
  source: string;            // policy id
  detail?: Record<string, unknown>;  // 结构化诊断
}
```

**Why**：

- `appliesTo` 让 policy 自己决定是否参与当前 evidence。
- `verdictContribution` 用枚举而非 boolean，保留语义。
- `no_contribution` 显式表达"我看了但没意见"——便于 audit trail 解释空白。

### Decision 2: Chain 组合规则

- 每个 policy 输出一个 `PolicyDecision`。
- 最终 verdict = `mostSevere(contributions)`，其中：
  - severity 顺序：`blocked` > `needs_review` > `running` > `ready` > `no_contribution`
- 若多个 policy contribution 同级别：按 policy 注册顺序优先，但 reason 全部展示在 audit trail。
- `corePolicy` 永远参与；其他 policy 通过 `appliesTo` 自决。

**Why**：

- "最强 verdict 胜出"是最直观且与现有 checkpoint 行为兼容的组合规则。
- 多 reason 累积 → audit trail 可读。

### Decision 3: corePolicy 提取，行为等价

`corePolicy.ts` 完整封装现有 `checkpoint.ts` 的判决逻辑：

- 输入：现有 evidence 字段不变。
- 输出：对应 `PolicyDecision`。
- 单测：复用所有现有 `checkpoint.test.ts` 断言。

**Why**：保证 0 regression。

### Decision 4: 第一批 policy = 已有 `CheckpointValidationEvidence` 体系的插件化（不引入新 evidence 源）

事实校准（finding Medium #7）：当前 `CheckpointEvidence` 字段（`src/features/status-panel/types.ts`）包含 `commands` / `fileChanges` / `todos` / `subagents` / `validations` 等结构化输入；其中 `CheckpointValidationEvidence` 已经定义了 `kind: lint | typecheck | tests | build | custom` 与 `status: pass | fail | running | not_run | not_observed`。

**没有**任何"check-large-files 输出缓存"或"openspec validate 缓存"作为现成 evidence 来源——如果第一版 policy 直接消费这些外部 signal，等于把"policy 化"扩展成"新建多个 evidence bridge"，违反 v1.4 §六"绝不另起战场"。

**第一版 policy 集合（修订）**：

| Policy | 触发条件 | 数据源 | contribution 上限 | severity |
|---|---|---|---|---|
| `corePolicy` | 永远 | 现有完整 evidence | `blocked` / `running` / `ready` / `needs_review` | 全 |
| `lintValidationPolicy` | `validations[].kind === 'lint'` 存在 | 现有 `CheckpointValidationEvidence` | `needs_review` | `warn` |
| `typecheckValidationPolicy` | `validations[].kind === 'typecheck'` 存在 | 现有 `CheckpointValidationEvidence` | `needs_review` | `warn` |
| `testsValidationPolicy` | `validations[].kind === 'tests'` 存在 | 现有 `CheckpointValidationEvidence` | `needs_review` | `warn` |

**未来 follow-up（不在本 change）**：

- `largeFilePolicy`：依赖 `check-large-files` 输出 → 需要先开"large-file-signal-bridge" change，把外部 governance signal 引入 checkpoint evidence。
- `specConsistencyPolicy`：依赖 OpenSpec validate cache → 需要先开"openspec-signal-bridge" change。
- 这些"外部 signal bridge"属独立基建，本 change 不承担。

**Why**：

- 第一版 policy 只把现有 evidence 插件化，证明 chain 机制可用；不引入新 evidence 源。
- 外部治理 signal 接入是独立工程，应独立 spec、独立验收。

### Decision 5: Audit Trail 形状

```typescript
interface CheckpointAuditEntry {
  occurredAt: string;          // ISO 8601
  finalVerdict: CheckpointVerdict;
  decisions: PolicyDecision[];
  evidenceSnapshot: { /* 摘要，禁止全量 */ };
}
```

- 保留最近 N 条（建议 50）。
- 不持久化到磁盘（属 audit trail follow-up）。
- 通过 StatusPanel 折叠区可视化。

**Why**：

- 节制内存。
- 不引入 disk I/O，避免与 audit trail follow-up 冲突。

### Decision 6: Policy 注册表 spec 化

```typescript
registerPolicy(policy: Policy): void
unregisterPolicy(id: string): void
listPolicies(): Policy[]
```

- 默认注册：`corePolicy`（必选）+ `lintValidationPolicy` / `typecheckValidationPolicy` / `testsValidationPolicy`（第一批可选 policy，全部基于现有 `CheckpointValidationEvidence`）。
- **不**包含 `largeFilePolicy` / `specConsistencyPolicy` —— 它们依赖外部 signal bridge，属独立 follow-up change。
- 用户/开发者可在测试中替换或 mock。
- spec 要求注册行为可观察（便于测试）。

**Why**：

- 后续接入新 policy（如 cost-aware policy）有标准入口。
- 不引入运行时 plugin 系统（YAGNI）。

### Decision 7: i18n key 规范

- 所有 policy reason 与 repairAction 文案 MUST 走 i18n。
- key 命名：`statusPanel.policy.{policyId}.{reasonKey}`。
- zh + en 同步落地。

### Decision 8: StatusPanel UI 折叠区

- CheckpointPanel.tsx 当前 verdict 显示位 + 新增 "Policy log"（默认折叠）。
- 展开后逐条显示 `PolicyDecision`。
- dock 与 popover 双宿主行为一致。

**Why**：

- 默认折叠 → 不破坏既有 UX。
- 展开 → 治理可解释性。

### Decision 9: Spec 薄 + 不写运行时插件机制

本 spec 不引入：

- 动态 policy 加载
- Policy 版本化
- 用户可写 policy（DSL / 配置）

这些都是后续治理演进，本 change 仅约束接口。

**Why**：avoid 万能 spec。

## Implementation Plan

### Phase 1: Core Policy 抽取（行为等价）

- 新建 `src/features/status-panel/utils/policies/policyTypes.ts`。
- 新建 `src/features/status-panel/utils/policies/corePolicy.ts`，封装现有逻辑。
- `checkpoint.ts` 改造为 policy chain 宿主，但 chain 中仅有 `corePolicy`。
- `checkpoint.test.ts` 全绿。

### Phase 2: Policy Registry & Chain

- 新建 `policyRegistry.ts`。
- 实现 chain 组合规则（Decision 2）。
- 新增 `policyRegistry.test.ts`。
- audit trail 实现（环形缓冲 50 条）。

### Phase 3: 第一批 Policy 接入（基于现有 evidence）

- `lintValidationPolicy.ts`：消费 `validations[].kind === 'lint'`。
- `typecheckValidationPolicy.ts`：消费 `validations[].kind === 'typecheck'`。
- `testsValidationPolicy.ts`：消费 `validations[].kind === 'tests'`。
- 每个 policy 独立单测，对应现有 evidence 形状。
- **不**引入 large-file / openspec validate 等外部 signal bridge（属独立 follow-up change）。

### Phase 4: UI 集成

- `CheckpointPanel.tsx` 增加 policy log 折叠区。
- i18n key 完整（zh + en）。
- dock + popover 双宿主测试。

### Phase 5: Spec & CI

- 起草 `specs/checkpoint-policy-chain/spec.md`。
- 新增 `scripts/check-checkpoint-policy-chain.mjs` parity test。
- 接入 CI。

### Phase 6: Validation & Sync

- strict validate。
- 同步 spec。

## Rollback Strategy

- Phase 1 抽取等价改造：rollback = revert Phase 1，恢复原 checkpoint.ts。
- Phase 2-3 policy 接入：每个 policy 可单独 disable（注销注册）。
- UI 折叠区可 feature flag 关闭。
- spec rollback 不影响 runtime 行为。

## Validation Matrix

| Area | Required Evidence |
|---|---|
| Spec | `openspec validate --strict --no-interactive` |
| Core policy parity | 全部 `checkpoint.test.ts` 现有断言通过 |
| Chain composition | `policyRegistry.test.ts` |
| 第一批 policy | per-policy 单测 |
| UI policy log | CheckpointPanel render test（dock + popover） |
| Audit trail 体积 | unit test 验证缓冲上限 |
| Heavy test noise | `check:heavy-test-noise` |
| Large file | `check:large-files:gate` |
| Cross-platform | CI 三端 |

## Open Questions

- typecheck signal 的具体来源（IDE LSP 还是 build cache）——design 后续阶段确定，spec 不约束实现细节。
- 是否引入 policy "explanation level"（简洁 vs 详细）——本 change 不引入，统一返回结构化 detail，UI 决定如何展示。
- 是否要 persist audit trail 到磁盘——本 change 不做；属 audit trail follow-up（与 `add-agent-domain-event-schema` 协同）。
- 第一批 policy 是否需要"silent mode"（仅 audit 不影响 verdict）——本 change 不引入，留 follow-up。
