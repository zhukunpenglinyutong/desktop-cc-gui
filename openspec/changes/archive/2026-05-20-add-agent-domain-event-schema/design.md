## Branch Calibration / 分支校准（2026-05-19）

本设计面向当前 `feature/v0.5.0-md` 分支重新实施。`feature/v0.5` 中曾出现的 `src/features/threads/domain-events/**`、checker 与 validation evidence 均视为废弃实现，不作为当前完成状态。

当前定位：**design-ready / implementation-unstarted**。后续实施必须重新基于当前分支的 reducer、session display projection、tool-call fallback 与 user-input question card 行为校准 derivation fixtures。

## Context

本变更是治理战略 v1.4 §4.2 第 5 件 Quick Win 的落地，也是治理战略路线图中**最被刻意压制**的一项——目的是避免重复 LangChain / LiteLLM 时代"先做 EventBus，再后悔"的模式。

核心判断：

- mossx 现在的状态变更分散在 reducer slice 与各 feature hook，**没有"原始领域事件"的概念**。
- 没有 schema 时建 EventBus 等于"先建仓库再决定要装什么"。
- 先立 schema 是最便宜的"形状立法"——后续 bus / store / log 都可在 schema 之上选择。

## Current State

### 事件源现状

| 来源 | 现状 | 备注 |
|---|---|---|
| Realtime engine event | 已规范（`engine-runtime-contract`） | wire-level，非领域事件 |
| Thread reducer slice | mutation 直接改 state | 没有 emit |
| Runtime lifecycle | runtime hook 暴露 state | 没有事件 |
| Usage update | context-ledger 消费 derived state | 没有事件 |
| Policy decision | checkpoint 内部计算 | 没有事件（policy chain 完成后才有 audit log） |
| Diff review | review surface state | 没有事件 |

### session-activity 现状（src/features/session-activity/）

- `adapters/` + `hooks/` + `utils/`：从 thread/items 派生 timeline。
- 缺：原始事件输入路径；timeline 粒度受 derived state 限制。

### 治理目标

让 session-activity（与未来的 audit trail / cost ledger / policy chain）**有可能**从原始事件消费，而不是被 derived state 限制。

## Design Goals

- **schema 优先，bus 严格延后**。
- **derivation 可证明**：领域事件形状必须能从 reducer state diff 纯函数推导；第一版不做 emit。
- **事件是 Readonly**：消费者不可修改。
- **起步集合 ≤ 10 类**：避免一炸。
- **derived state 路径保留**：兼容现有 session-activity。
- **Spec 薄**：≤ 25 SHALL。

## Non-Goals

- **不引入 EventBus**（关键 Non-Goal）。
- 不引入持久化 / event store / append-only log。
- 不引入跨进程 publish。
- 不引入 Rust 侧领域事件（属 runtime contract）。
- 不引入 EventStore-as-truth-source 模式；reducer 仍是真相。
- 不引入 cost / capability / policy 等其他维度事件——它们各自由对应 spec 拥有。
- 不迁移 session-activity（包括 PoC）。

## Decisions

### Decision 1: 事件起步集合 ≤ 10 类

| Event | 触发时机 | 必备字段 |
|---|---|---|
| `session.started` | 新 thread 启动 | sessionId, workspaceId, engine, occurredAt |
| `session.ended` | thread 关闭 / archive | sessionId, reason, occurredAt |
| `turn.started` | 用户发送 / agent 开始 | sessionId, turnId, prompt(摘要), occurredAt |
| `turn.completed` | turn 正常结束 | sessionId, turnId, durationMs, occurredAt |
| `turn.failed` | turn 失败 / 中断 | sessionId, turnId, reason, occurredAt |
| `message.delta.appended` | assistant delta 入栈 | sessionId, turnId, messageId, deltaLength, occurredAt |
| `message.completed` | assistant 完整消息形成 | sessionId, turnId, messageId, occurredAt |
| `tool.started` | tool 调用开始 | sessionId, turnId, toolCallId, toolName, occurredAt |
| `tool.completed` | tool 调用完成 | sessionId, turnId, toolCallId, status, durationMs, occurredAt |
| `usage.updated` | token usage 变化 | sessionId, turnId, usageSnapshot, occurredAt |

**Why 起步 10**：

- 覆盖 session-activity timeline 现有主要节点。
- 不引入 policy / cost / file / capability 等下游维度事件。
- 起步阶段单元清晰；后续 change 扩张。

> `policy.evaluated` 与 `file.changed` 不在起步集合中，会在对应 spec（policy chain / diff review）完成后单独 follow-up。

### Decision 2: 命名规则 `domain.action`

- 形式：`<domain>.<action>` 或 `<domain>.<sub>.<action>`（如 `message.delta.appended`）。
- domain 集合限定：`session` / `turn` / `message` / `tool` / `usage`。
- 新 domain MUST 走独立 spec change。

**Why**：

- 限定 domain 集合 → 避免命名爆炸。
- dot-separated → 支持后续按 domain 路由。

### Decision 3: 必备字段最小集

```typescript
interface DomainEventBase {
  readonly type: string;             // 形如 'turn.started'
  readonly occurredAt: string;       // ISO 8601
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly engine: EngineType;
}
```

具体事件类型 extends base，添加事件专属字段（Readonly）。

**Why**：

- 这 5 字段是任何下游消费都必须的（audit / cost / policy）。
- engine 必备 → 跨引擎聚合时不丢源信息。

### Decision 4: 第一版只做 schema + pure event factory + reducer test fixtures（**不引入运行时 buffer / subscription**）

事实校准（finding Medium #8）：初稿设计的 "ring buffer + `useSyncExternalStore` subscription" 本质上就是一个小型 EventBus / EventStore，只是换了名字——这违反本 change 的核心 Non-Goal "不引入 EventBus"。

**第一版严格范围**：

```typescript
// 1) Schema 类型层（不可变）
type DomainEvent =
  | Readonly<SessionStartedEvent>
  | Readonly<TurnCompletedEvent>
  | ...;

// 2) Pure event factory（无副作用）
function createSessionStartedEvent(input: ...): SessionStartedEvent { ... }
function createTurnCompletedEvent(input: ...): TurnCompletedEvent { ... }

// 3) Reducer test fixtures
//    用于 reducer 单测中断言"某 mutation 后应该产出什么形状的 domain event"。
//    断言通过纯函数比较完成，不接 runtime。
```

**第一版严格不做**：

- ❌ 内部 ring buffer
- ❌ `useSyncExternalStore` subscription
- ❌ runtime emit 接入 reducer mutation
- ❌ session-activity 实时消费

**Why**：

- 任何"runtime 流转"形态都会从语义上变成 EventBus 雏形；本 change 应只立"schema 法律"。
- 第一版完成后，下游 follow-up change 可以基于 schema 决定：
  - 是否引入 read-only buffer
  - 是否引入 subscription surface
  - 是否引入 persist / replay
  - 是否引入跨 worker publish
- 各自需要独立设计与验收，绑在一份 spec 里风险过大。

### Decision 5: ~~内部缓冲~~（已删除）

第一版不引入任何 runtime 容器；schema 的"事实存在地"仅在 reducer test fixtures 与 type-level 测试中体现。

**未来 follow-up change**（不在本 spec）：

- `add-agent-domain-event-buffer`：决定是否引入 read-only ring buffer。
- `add-agent-domain-event-subscription`：决定是否引入 React subscription surface。
- 这些 change MUST 各自独立验收。

### Decision 6: Readonly 类型强制

```typescript
type DomainEvent =
  | Readonly<SessionStartedEvent>
  | Readonly<TurnCompletedEvent>
  | ...;
```

TS 编译期保证不可变。运行时通过 `Object.freeze` 选项（仅 dev 模式启用）兜底。

**Why**：

- 防止 consumer 把事件当 mutable bag。
- Readonly 类型在 TS 是免费保护。

### Decision 7: Reducer runtime **零接入**（pure derivation fixtures only）

事实校准（finding High #3）：本 change 严格不接入 reducer runtime。Decision 4 已经写明"不引入 buffer / subscription"，但此前 Decision 7 仍残留运行时发布设计，与 spec / tasks 冲突。

**本 change 的 reducer 触点仅在测试层**：

- 在 reducer **单测文件**（`useThreadsReducer*.test.ts`）中新增 pure derivation 断言：给定 `(prevState, nextState)` 状态对，使用 pure function 派生出对应的 `DomainEvent` 形状。
- reducer 实现文件（`useThreadsReducer*.ts`）**不**被本 change 修改、**不**调用任何 factory、**不**导入 domain-events 模块。
- 现有 reducer test 0 regression；新增 derivation 断言独立、可单独 disable。

**Why**：

- "末尾 emit" 是 runtime 接入的最弱形态，但它把 schema 与 reducer 状态变更耦合；任何 emit 路径都要面对原子性、异常、order 等运行时问题。
- 本 change 想要的只是"schema 立法"+"映射可证明"，pure derivation fixtures 是最便宜、最可逆的证明方式。

### Decision 8: session-activity 在本 change **完全不动**

事实校准（finding High #3）：此前 Decision 8 残留消费者迁移设计，这等于在本 change 内引入消费者，违反"无 runtime 接入"原则。

**本 change 对 session-activity 的承诺**：

- **不**新增 `domainEventSource.ts`。
- **不**修改 `src/features/session-activity/` 的任何文件。
- **不**引入 feature flag。
- 现有 derived state 路径完全保留、零变化。

任何 session-activity → domain event 迁移属 **后续独立 change** 的范畴：

- 该 follow-up change MUST 先选择 runtime 容器形态（buffer / subscription / store）。
- 该 follow-up change MUST 单独立 spec、单独验收。

**Why**：

- 本 change 的护城河是"严格只立法、不接 runtime"；任何消费者接入都会污染验收边界。
- 把消费者作为独立 change，确保每一步都可解释、可回滚。

### Decision 9: Spec 严守 Non-Goal

spec 必须显式声明：

- 不引入 EventBus。
- 不引入 event store。
- 不引入持久化。

**Why**：v1.4 §六 "绝不先建 EventBus" 是核心避坑提醒。

## Implementation Plan

### Phase 1: Schema 类型层

- 新建 `src/features/threads/domain-events/`：
  - `eventTypes.ts`（type union）
  - `events/session.ts`
  - `events/turn.ts`
  - `events/message.ts`
  - `events/tool.ts`
  - `events/usage.ts`
- 单测：类型正确性。

### Phase 2: Pure Event Factory

- `eventFactories.ts`：每个 event 类型一个 pure factory `createXxxEvent(input) → Readonly<XxxEvent>`。
- 单测：immutability（factory 输出 Readonly）、字段完备性、必备字段非空。
- **不**引入 ring buffer，**不**引入 subscription。

### Phase 3: Reducer Test Fixtures

- 在 useThreadsReducer 现有单测中**添加断言**："执行 mutation X 后，可由当前 state diff 推导出应产出 domain event Y"。
- 推导通过 pure function 完成；**不**修改 reducer 实际行为。
- 现有 reducer 单测 0 regression；新断言独立。

### Phase 4: Spec & CI

- 起草 `specs/agent-domain-event-schema/spec.md`（≤ 25 SHALL）。
- 新增 `scripts/check-agent-domain-event-schema.mjs`。
- 接入 CI。

### Phase 5: Validation & Sync

- strict validate。
- 同步 spec。

## Rollback Strategy

- Phase 1-2：纯新增 type + factory，revert 零影响。
- Phase 3：reducer test fixtures 仅是测试断言，不接 runtime；revert 等于删除测试断言。
- Spec rollback 不影响运行时。
- 因为本 change 没有 runtime 触点，rollback 风险极低。

## Validation Matrix

| Area | Required Evidence |
|---|---|
| Spec | `openspec validate --strict --no-interactive` |
| Schema types | TS typecheck + type-level test |
| Factory immutability | `eventFactories.test.ts`（Readonly 类型 + 运行时 frozen 抽样） |
| Reducer 行为不变 | 现有 reducer 单测 0 regression |
| Schema derivation | reducer test fixtures：mutation → expected domain event 推导通过 |
| Heavy test noise | `check:heavy-test-noise` |
| Large file | `check:large-files:gate` |
| Cross-platform | CI 三端 |

## Open Questions

- 是否要为 dev mode 提供 event inspector（debug 工具）——本 change 不引入；属 follow-up。
- ~~emit 失败时如何处理~~ —— 本 change 无 runtime emit，问题不存在。
- session-activity 完整迁移到 domain event 的时间窗口——本 change 不承诺，留独立 follow-up change。
- 是否要为 audit trail（持久化）预留接口——本 change 不预留 runtime buffer / persist hook；仅保留类型、factory 与 derivation fixture，避免诱导过早工程。
- 是否要把 `policy.evaluated` / `file.changed` 纳入起步——design 决策为不纳入，避免与 policy chain / diff review change 范围重叠。
