## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。`feature/v0.5` 上曾出现的 policy chain core、checker、CI wiring、task 勾选与 `implementation-evidence.md` 不再作为本变更依据；后续必须在当前分支重新实现。

当前分支状态：Checkpoint 仍以现有 `status-panel` 判决逻辑为事实基础，policy chain 尚未落地。近两天当前分支的 sidebar timeout fallback 与 session display projection 可作为未来 checkpoint evidence 的候选事实，但本 change 第一版仍只插件化既有 validation evidence，不直接消费 sidebar/runtime 外部信号。

## Why

`src/features/status-panel/utils/checkpoint.ts` 是当前 SLA 判决引擎：

- 输入：thread / runtime / activity / token / risk evidence
- 输出：四态 verdict（`running` / `blocked` / `needs_review` / `ready`）+ next action

它已经是事实的 **policy engine**，但**只有一条隐式规则路径**：

- 所有 evidence 在一个大函数里组合。
- 现有 validation evidence（lint / typecheck / tests）已经进入 checkpoint，但仍被写在同一判决路径里；新增 validation policy 必须在 checkpoint 中"手术"。
- 外部治理信号（large-file / OpenSpec validate / build cache）还没有 checkpoint evidence bridge；不能在第一版 policy chain 中直接消费。
- 单元测试覆盖完整，但**没有"插件式 policy"的契约**。

治理战略 v1.4 §4.2 第 4 件 Quick Win 明确要求：把 Checkpoint 升级为 **Policy Chain 宿主**。第一版只插件化现有 lint / typecheck / tests validation evidence；大文件检查与 spec-consistency 必须先补 evidence bridge，作为后续独立 policy 接入。

中文一句话：**Checkpoint 已经在做 policy 判决，但还不是 policy chain；它今天是黑箱，明天必须解释自己**。

本变更只做一件事：**把 Checkpoint 改造为 Policy Chain 宿主**——保留四态判决行为，但抽取 policy 接口，让每个 policy 显式声明 evidence → verdict contribution，并提供 audit trail。

## Priority Calibration / 优先级校准

| Priority | Included Area | Why Included | If Not Fixed | If Fixed |
|---|---|---|---|---|
| P0 | Policy 接口契约 | 治理化的基础 | 治理 check 继续在 checkpoint 手术 | 新 check 作为独立 policy 接入 |
| P0 | Verdict contribution 模型 | 多 policy 如何组合 | 多 check 互相覆盖、不可解释 | verdict 由 policy chain 组合，可追溯 |
| P0 | Audit trail（policy decision log） | 用户看不到判决理由 | 黑箱判决 | 每次判决可解释 source / reason / repair |
| P0 | 现有四态行为保留 | 不能 regress 已有 SLA UX | UI 行为漂移 | 现有 verdict 路径完全等价 |
| P1 | 第一批 policy 接入：把现有 `CheckpointValidationEvidence`（lint/typecheck/tests）插件化 | chain 机制必须有真实 policy 验证 | chain 机制空转 | 三类 validation policy 显式接入；外部 signal bridge 留 follow-up |
| P1 | Policy 注册表 | 后续 policy 接入入口 | 每次接入需要改架构 | spec 化注册流程 |
| P1 | Policy 失败的 i18n & UI 解释 | 用户体验 | 用户看到神秘报错 | repair action 可点击 |

提案边界：**不引入 EventBus / 不引入跨 workspace policy 同步 / 不接管 runtime 行为**；本 change 只把 checkpoint 内部解构为 policy chain。

## What Changes

- Add OpenSpec capability `checkpoint-policy-chain` covering:
  - Policy 接口契约（input / output / contribution model）
  - Verdict chain 组合规则
  - Audit trail 形状（policy decision log）
  - 现有四态语义保留
  - 第一批 policy 接入要求（基于现有 `CheckpointValidationEvidence`）
  - Policy 注册表 + spec 化注册流程
- Refactor `src/features/status-panel/utils/checkpoint.ts`：
  - 抽取 `Policy` 接口
  - 抽取现有 verdict 决策路径为 `corePolicy`（保持行为等价）
  - 新增 `policyRegistry.ts`
  - 新增第一批 policy：`lintValidationPolicy.ts`、`typecheckValidationPolicy.ts`、`testsValidationPolicy.ts`（消费现有 `CheckpointValidationEvidence`，不引入新 signal 源）
- `checkpoint.test.ts` 必须保留全部现有断言（零 regression），并新增 policy chain 测试。
- StatusPanel `CheckpointPanel.tsx` 增加 policy decision log 展示（可折叠）。

## Scope

### In Scope

- Define `checkpoint-policy-chain` spec，≤ 30 SHALL 条款。
- Policy 接口：
  ```
  Policy {
    id: string;
    appliesTo: (evidence) => boolean;
    evaluate: (evidence) => PolicyDecision;
  }
  PolicyDecision {
    verdictContribution: 'running' | 'blocked' | 'needs_review' | 'ready' | 'no_contribution';
    reason: string;       // i18n key
    repairAction?: RepairAction;
    severity: 'info' | 'warn' | 'block';
    source: string;       // policy id
  }
  ```
- Chain 组合规则（最强 verdict 胜出 / contribution 累积 / no_contribution 不阻塞）。
- Audit trail：每次 checkpoint 计算 MUST 产出一条 `CheckpointAuditEntry`，列出每个 policy 的 contribution。
- 第一批 policy（基于现有 evidence，不引入新 signal 源）：
  - `lintValidationPolicy`：消费现有 `validations[].kind === 'lint'`
  - `typecheckValidationPolicy`：消费现有 `validations[].kind === 'typecheck'`
  - `testsValidationPolicy`：消费现有 `validations[].kind === 'tests'`
  - 外部 signal bridge（check-large-files / openspec validate / build cache）**留独立 follow-up change**
- StatusPanel 增加 policy log 可视化（与现有 checkpoint UI 集成，不破坏现有 tab 行为）。

### Out of Scope

- EventBus / 跨 thread policy 联动（属 `add-agent-domain-event-schema`）。
- Cost-driven policy（属 `evolve-context-ledger-to-cost-budget`）。
- Capability-driven policy routing（属 capability matrix 后续 follow-up）。
- 团队级 policy 同步。
- 自动 repair（policy 触发自动修复）。
- 接管 runtime 中断行为；policy 仅影响 verdict + UI，不强制中断。

## Engineering Constraints

继承三道哨兵 + checkpoint 自身约束：

### Cross-Platform Compatibility

- Policy 实现 MUST 不引入平台分支；如必须，使用 `cfg` 风格隔离并 spec 标注。
- audit trail 时间戳 MUST ISO 8601。

### Heavy Test Noise Sentry

- `checkpoint.test.ts` 现有测试 0 regression；新增 policy 测试 MUST 静默。

### Large File Governance Sentry

- `checkpoint.ts` 文件 MUST 不增长（拆分后总规模目标 ≤ 当前）。
- 每个 policy 独立文件。

### Checkpoint UI 双宿主一致性

- policy log 展示 MUST 在 dock 与 popover 行为一致。
- 现有四态 verdict UX MUST 完全保留（用户感知零变化）。

## Impact

- OpenSpec:
  - `openspec/changes/evolve-checkpoint-to-policy-chain/{proposal,design,tasks}.md`
  - `openspec/changes/evolve-checkpoint-to-policy-chain/specs/checkpoint-policy-chain/spec.md`
- Frontend:
  - `src/features/status-panel/utils/checkpoint.ts`（抽取 corePolicy + 注册表）
  - `src/features/status-panel/utils/policies/` 新目录
    - `policyTypes.ts`
    - `policyRegistry.ts`
    - `corePolicy.ts`
    - `lintValidationPolicy.ts`
    - `typecheckValidationPolicy.ts`
    - `testsValidationPolicy.ts`
  - `src/features/status-panel/utils/checkpoint.test.ts` 扩充
  - 新增 `policyRegistry.test.ts`
  - `src/features/status-panel/components/CheckpointPanel.tsx` 增加 policy log 折叠区
  - i18n key 新增
- 不动 Rust。
- CI:
  - 新增 `npm run check:checkpoint-policy-chain`

## Risks

- **回归风险（最高）**：checkpoint 是 UI 核心 SLA；任何行为变化都会被用户感知 → spec 明确要求"现有四态语义零变化"，并通过现有 test 全部保留断言。
- **Policy 接入边界**：第一批 policy 接入若过于侵入式（如阻塞 verdict）会改变用户感知 → spec 规定第一批 policy 默认 contribution 上限为 `needs_review`，不进 `blocked`，避免引入新 UX 阻塞。
- **Audit trail 噪音**：每次 checkpoint 都生成 audit entry 可能膨胀 → spec 强制 entry 体积上限，必要时做 LRU 截断。
- **依赖前置**：本 change 不强制依赖 capability matrix，但 reasoning policy 接入会受益于 matrix 落地后。
- **Spec 万能化**：避免把 cost / event / capability 写进 policy chain spec；本 spec 仅描述 policy 接口与 chain 行为。

## Migration Strategy

1. 完成 proposal + design 评审。
2. 起草 spec + tasks。
3. Phase 1：抽取 corePolicy，行为等价（test 全绿）。
4. Phase 2：引入 policy 接口与注册表（test 全绿）。
5. Phase 3：第一批 policy 接入（test 扩充）。
6. Phase 4：UI policy log 展示。
7. Phase 5：strict validate + 同步 spec。

## Validation

```bash
npm run typecheck
npm run test
npm run check:checkpoint-policy-chain   # 新增
openspec validate evolve-checkpoint-to-policy-chain --strict --no-interactive
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

- checkpoint policy chain test MUST 在三平台等价执行。
- StatusPanel dock + popover 双宿主测试 MUST 通过。
- 现有 `checkpoint.test.ts` 断言数 MUST 不减少。
- 必须等价满足 `.github/workflows/heavy-test-noise-sentry.yml` 与 `.github/workflows/large-file-governance.yml`，不能只跑部分 npm gate。
- policy / audit trail 实现不得依赖 POSIX-only path、shell quoting、newline 或平台专属进程语义；需要平台差异时必须封装到 evidence provider / adapter，而不是写进 policy core。
