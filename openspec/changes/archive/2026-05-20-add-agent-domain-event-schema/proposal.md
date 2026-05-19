## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。`feature/v0.5` 上曾出现的 domain-events 类型、factory、derivation fixtures、checker、task 勾选与 `implementation-evidence.md` 不再作为本变更依据；后续必须在当前分支重新实现。

当前分支状态：domain event schema 未落地。近两天当前分支新增/调整的 session display projection、user-input question card 与 tool-call fallback 是后续 event derivation 需要重新评估的事实输入，但第一版仍坚持 type/factory/derivation-only，不接 runtime、不建 bus。

## Why

mossx 当前的事件流是分散的：

- realtime engine event → reducer slice
- thread state changes → reducer slice
- runtime lifecycle → runtime hook
- usage update → context-ledger
- status panel → derived state

`src/features/session-activity/` 已经在做 audit trail 雏形，但**只能消费 reducer 的 derived state，无法消费"原始领域事件"**（v1.4 §0.4 R4 明确指出）。

治理战略 v1.4 §4.2 第 5 件 Quick Win 明确要求：**先定 `AgentDomainEvent` schema，不急于建 bus**。

中文一句话：**先把事件的"名字"和"形状"立法；EventBus 是它的消费方式，不是先决条件**。

本变更只做一件事：**为 10 个核心领域事件定义 schema**，并用 pure factory 与 reducer derivation fixtures 证明这些事件形状可由现有状态变化推导。它不接入 reducer runtime、不 emit、不新增消费者；session-activity 迁移必须留给后续独立 change。

## Priority Calibration / 优先级校准

| Priority | Included Area | Why Included | If Not Fixed | If Fixed |
|---|---|---|---|---|
| P0 | Domain event schema 定义 | 治理战略基础语言 | session-activity 永远只看 derived state | audit trail 可消费原始事件 |
| P0 | Event taxonomy（命名 + 维度） | 命名一致性 | 事件名漂移 / 重复 | 命名规则成法律 |
| P0 | Schema derivation contract | schema 必须能由 reducer mutation 派生 | schema 是空 spec | 每个 schema 由 reducer state diff 可推导（pure function） |
| P0 | Backward compatibility | 现有 reducer / derived state 不能 regress | reducer 行为漂移 | 本 change 不接 runtime，零行为变化 |
| P1 | Schema 起步集合上限 | 防止 schema 一炸 | spec 走向万能 | 起步 ≤ 10 事件类型 |
| P1 | EventBus / Buffer / Subscription 不建（显式声明） | 防止过度工程 | 引入 bus + store + log 三层 | spec 仅声明 schema，runtime 形态留独立 follow-up change |
| P1 | session-activity 消费 | 暂不接 | 仅 schema 立法，不强制消费者 | 消费者迁移属独立 follow-up |

提案边界：**仅定义 schema、pure factory 与测试层 derivation contract，不引入 producer runtime 接入点 / EventBus / event store / append-only log / 跨进程 event publish**。

## What Changes

- Add OpenSpec capability `agent-domain-event-schema` covering:
  - Event taxonomy（命名规则、维度划分）
  - 10 个核心事件类型的 schema
  - Schema derivation contract（reducer mutation MUST 可由 pure function 映射到 domain event 形状）
  - Immutability 契约（Readonly type + factory 不可被外部修改）
  - 与现有 derived state / session-activity 的兼容关系（本 change 不接 runtime；二者并存零冲突）
  - 显式 Non-Goal：不引入 EventBus / 不引入 ring buffer / 不引入 subscription surface
- 新增 TS 端 schema + pure event factory（**无运行时 buffer / 无 subscription**）：
  - `src/features/threads/domain-events/eventTypes.ts`（type union, Readonly）
  - `src/features/threads/domain-events/eventFactories.ts`（每事件一个 pure `createXxxEvent` factory）
  - reducer 单测中**新增推导断言**：mutation → expected domain event 形状（不修改 reducer 行为）
- 不修改 reducer runtime 行为；不接入 emit；不接入 session-activity 消费者。
- 不动 Rust：Rust 端事件由 `engine-runtime-contract` 已经规范；本 change 是 **frontend 领域事件 schema**，与 wire-level realtime event 不同概念。

## Scope

### In Scope

- Define `agent-domain-event-schema` spec，≤ 25 SHALL 条款，覆盖：
  - 命名规则（domain.action 形如 `session.started`, `turn.completed`）
  - 事件起步集合：
    - `session.started` / `session.ended`
    - `turn.started` / `turn.completed` / `turn.failed`
    - `message.delta.appended` / `message.completed`
    - `tool.started` / `tool.completed`
    - `usage.updated`
  - 每个事件必备字段（`occurredAt`, `workspaceId`, `sessionId`, `engine`）
  - Schema MUST 可由 reducer mutation 通过 pure function 映射
  - Schema 类型 MUST 不可变（Readonly）；factory MUST 无副作用
  - 现有 derived state 路径 MUST 保留；本 change 不接 runtime
- 实现 TS schema type + pure event factory（无 runtime 容器）。
- 在现有 reducer 单测中新增 derivation 断言（不修改 reducer 行为）。
- Fixture + 单测覆盖 immutability、字段完备性。

### Out of Scope

- **EventBus / EventStore / append-only log / ring buffer / subscription surface（全部显式声明 Out of Scope）**。
- 跨进程 publish。
- 持久化 audit trail。
- 接管 reducer（reducer 是真相源；本 change 不接 runtime，连镜像都不做）。
- Cost / capability / policy 等其他维度事件（属各自 spec）。
- Rust 侧事件（属 `engine-runtime-contract`）。
- session-activity 任何消费（包括 PoC；属未来独立 change）。

## Engineering Constraints

继承三道哨兵：

### Cross-Platform Compatibility

- 事件 schema MUST 不引入平台条件字段。
- ISO 8601 timestamp。

### Heavy Test Noise Sentry

- event factory 与 derivation fixtures MUST 静默；错误路径不得输出 raw payload 到 stdout。

### Large File Governance Sentry

- 事件类型 MUST 按 domain 分文件（不允许单一巨型 eventTypes.ts）。

### Reducer 行为零变化

- reducer runtime MUST 不接入 domain-event factory。
- 现有 reducer 单测 0 regression。

## Impact

- OpenSpec:
  - `openspec/changes/add-agent-domain-event-schema/{proposal,design,tasks}.md`
  - `openspec/changes/add-agent-domain-event-schema/specs/agent-domain-event-schema/spec.md`
- Frontend（仅新增；不改 reducer / hook 行为）:
  - 新增 `src/features/threads/domain-events/`
    - `eventTypes.ts`（type union, Readonly）
    - `events/session.ts` / `events/turn.ts` / `events/message.ts` / `events/tool.ts` / `events/usage.ts`
    - `eventFactories.ts`（pure factory）
    - `eventFactories.test.ts`
  - `src/features/threads/hooks/useThreadsReducer*.test.ts`（**仅测试**：新增 derivation 断言，不改 reducer 实现）
  - **不动** `src/features/session-activity/`
- CI:
  - 新增 `npm run check:agent-domain-event-schema`

## Risks

- ~~**Reducer 行为漂移**~~：本 change 不接 runtime，零行为变化。
- **Schema 一炸**：每加一个 feature 就想加事件 → spec 严格 ≤ 10 类型起步；新增走独立 change。
- **EventBus 诱惑**：完成 schema 后会立即想做 bus → 明确写入 Non-Goal + Risks。
- **消费者污染事件**：consumer 修改事件对象 → spec 强制 immutable，TS 用 `Readonly<>` 类型。
- **依赖前置**：本 change 不强依赖 runtime contract / capability matrix，但 session/turn/message/tool 事件语义建议在 runtime contract 落地后。
- ~~**PoC 消费者作用边界**~~：本 change 不引入消费者；session-activity 不动。

## Migration Strategy

1. 完成 proposal + design 评审。
2. 起草 spec + tasks。
3. Phase 1：实现 schema types（Readonly）。
4. Phase 2：实现 pure event factory + 单测。
5. Phase 3：在 reducer 单测中新增 derivation 断言（不改 reducer 行为）。
6. Phase 4：spec strict validate + 同步。
7. 后续 follow-up change 决定是否引入 ring buffer / subscription / EventBus / event store。

## Validation

```bash
npm run typecheck
npm run test
npm run check:agent-domain-event-schema   # 新增
openspec validate add-agent-domain-event-schema --strict --no-interactive
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

- domain event schema test MUST 在三平台等价执行。
- reducer 现有断言 MUST 0 regression。
- factory / derivation fixture 测试 MUST 覆盖 immutability、必备字段与 mutation → expected event shape 的纯推导。
- 必须等价满足 `.github/workflows/heavy-test-noise-sentry.yml` 与 `.github/workflows/large-file-governance.yml`，不能只跑部分 npm gate。
- Domain event schema 不得出现平台条件字段；path、process、newline、shell 语义必须留在后续 adapter/evidence 层，不能进入事件 core schema。
