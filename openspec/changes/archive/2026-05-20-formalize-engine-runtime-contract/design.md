## Branch Calibration / 分支校准（2026-05-19）

本设计面向当前 `feature/v0.5.0-md` 分支重新实施。任何来自 `feature/v0.5` 的已实现 core、validation evidence、task completion 或 `implementation-evidence.md` 均视为废弃分支历史，不作为当前设计的完成状态。

因此，本 design 的定位是 **design-ready / implementation-unstarted**：先保留治理法律文本与实施边界，再由后续全链路实施重新落地 tests、checker、CI wiring 与 evidence。

## Context

本变更是 `stabilize-core-runtime-and-realtime-contracts` 的**正式化后续**，不是平行项目。

核心判断：

- stabilize-core 已经完成了 realtime canonical matrix、replay harness、runtime lifecycle scenario coverage，留下了完整的事实契约证据。
- 本 change 不做新的运行时改造，**只把已有事实契约提升为可被 spec validate 检验的法律文本**。
- 治理战略 `docs/architecture/harness-governance-strategy.md` (v1.4) §4.2 第 1 件 Quick Win 明确要求此立法作为治理层的第一锤。

## Current State

### Adapter 现状

`src/features/threads/adapters/` 实测文件：

| 文件 | 现状 | 备注 |
|---|---|---|
| `claudeRealtimeAdapter.ts` | 引擎专属 adapter，调用 sharedRealtimeAdapter | 薄壳 |
| `codexRealtimeAdapter.ts` | 同上 | 薄壳 |
| `geminiRealtimeAdapter.ts` | 同上 | 薄壳 |
| `opencodeRealtimeAdapter.ts` | 同上 | 薄壳 |
| `sharedRealtimeAdapter.ts` | 集中 mapper 与 canonical event 路径 | 复杂度集中点 |
| `realtimeAdapterRegistry.ts` | 注册 / lookup 入口 | 当前未做 SHALL 约束 |
| `toolSnapshotHydration.ts` | tool snapshot 注入 | parity test 缺口候选 |

### Loader 现状

`src/features/threads/loaders/`：

| 文件 | 现状 | 备注 |
|---|---|---|
| `claudeHistoryLoader.ts` | Claude history snapshot | 完整 |
| `codexHistoryLoader.ts` + `codexSessionHistory.ts` | Codex 包装 + 内部 history | 内部解析独立 |
| `geminiHistoryLoader.ts` + `geminiHistoryParser.ts` | Gemini loader + parser | parser 解耦 |
| `opencodeHistoryLoader.ts` | OpenCode loader | 完整 |
| `sharedHistoryLoader.ts` | 跨引擎 dedupe / merge / fallback | 隐式约定集中点 |
| `historyLoaderUtils.ts` | 共享 helper | 工具层 |

### Contract 现状

`src/features/threads/contracts/`：

- `conversationCurtainContracts.ts` 定义 `RealtimeAdapter` / `HistoryLoader` / `NormalizedThreadEvent` 等类型。
- `realtimeEventContract.ts` + `realtimeEventContract.test.ts` 是事实契约证据。
- `realtimeReplayHarness.ts` + `realtimeReplayHarness.test.ts` 是 replay 证据。
- `realtimeBoundaryGuard.test.ts` 是 boundary 证据。
- `realtimeHistoryParity.test.ts` 已存在但需要核对 4 引擎覆盖率。
- `conversationAssembler.ts` / `conversationFactContract.ts` 是 reducer 边界事实。

### Rust 现状

`src-tauri/src/engine/events.rs` 与 `backend/events.rs` 已经在 stabilize-core 中作为 canonical mapping 一侧加固，本 change 仅引用，不修改。

## Design Goals

- **立法语言而非运行时变更**：所有产出都是 spec 与 test，不动行为。
- **薄 spec 优先**：SHALL/MUST 条款总数 ≤ 30 条。
- **可观察输出 over 内部实现**：仅约束 adapter/loader 的输入输出形状，不约束内部实现。
- **parity 矩阵显式化**：4 引擎在最小 capability 集合上必须等价。
- **legacy alias 留作 compatibility input**：不进 canonical 列表，不强制移除。
- **跨前后端引用而非重写**：Rust mapping 证据由 stabilize-core 已交付测试承担，本 spec 不强制 Rust 一侧 SHALL。

## Non-Goals

- 不引入 capability matrix（属 `add-engine-capability-matrix-spec`）。
- 不引入 cost / token ledger 扩展（属 `evolve-context-ledger-to-cost-budget`）。
- 不引入 policy chain / verdict 扩展（属 `evolve-checkpoint-to-policy-chain`）。
- 不引入 domain event schema（属 `add-agent-domain-event-schema`）。
- 不动 `app-shell.tsx`。
- 不强制 Rust 端做 SHALL 条款；Rust mapping 视为现有 evidence。
- 不移除任何 legacy alias。

## Decisions

### Decision 0: 立法继承 P0/P1 双轨

本 change 与 stabilize-core 一致，P0 = 契约本体，P1 = 立法保护栏。  
**Why**：避免立法过程顺手扩散到 capability / cost / policy 等其他维度。

### Decision 1: Canonical schema 由现有 NormalizedThreadEvent 提升，不重写

`NormalizedThreadEvent` 已经是 frontend 真相源；spec 把它的字段语义写成 SHALL，不引入新类型。

**Why**：

- 重写 schema 会强制 reducer / UI / test 三处 migration，blast radius 太大。
- 现有 schema 已经服务 4 个引擎，事实有效。

### Decision 2: Adapter registry 保持静态穷举式，不引入运行时 override

事实校准：当前 `realtimeAdapterRegistry.ts` 是 `Record<ConversationEngine, RealtimeAdapter>` 静态映射；`getRealtimeAdapterByEngine` 在 TypeScript 类型层即穷举，不会 lookup 失败、不存在 override / register 动作。

本 spec 把"事实"立成法律，**不引入新机制**：

- Static exhaustive registry MUST cover every `EngineType` / `ConversationEngine` variant.
- 新增 `EngineType` 时，registry MUST 在同一 PR 内补齐 adapter，否则 typecheck 应失败（编译期 enforcement）。
- 不引入运行时 `registerAdapter()` / `overrideAdapter()`；动态注册属未来 change（如 plugin / 用户脚本场景）。
- Lookup 不会失败的设计 MUST 由 TS exhaustive type 保证；spec 仅描述这一不变量，不强制 runtime 抛错路径。

**Why**：

- v1.4 §0 校准明确"不要新建抽象，只把事实立法"。
- 当前 4 引擎场景下静态穷举已足够；引入 runtime override 等于把"立法 change"扩成"运行时架构 change"。
- 与 `engine-control-plane-isolation` spec 一致：control plane 的安全性来自"穷举 + 编译期"，不是"运行时校验"。

### Decision 3: Legacy alias 留在 compatibility policy，不进 canonical 列表

stabilize-core 已经标注 legacy alias 为 compatibility input；本 spec **仅记录已接受的 alias 清单 + 兼容窗口策略**，不强制移除、也不允许把 alias 作为新 canonical 名。

**Why**：

- 移除时间窗口属业务决策，应留给单独的 alias-removal change。
- 当前 alias 移除会破坏老 session 与 daemon fallback。

### Decision 4: History snapshot 与 realtime event 共享语义、分契约

History snapshot 与 realtime event 描述同一会话事实，但 **lifecycle 不同**：

- realtime 是 push 流，事件粒度细。
- history 是 pull 快照，粒度粗、可有 dedupe。

spec 中：

- realtime event MUST 严格符合 canonical event matrix。
- history snapshot MUST 在 user/assistant 主消息层与 realtime 等价（即"replay history 后再 push realtime"得到的最终 reducer 状态 MUST 等于"全程 realtime"得到的状态），但允许 reasoning/tool delta 等细粒度事件在 history 中被压缩。

**Why**：这是 sharedHistoryLoader 的事实行为，把它说清楚。

### Decision 5: Cross-engine parity matrix 作为 CI 法律入口（限定在 NormalizedThreadEvent 域内）

事实校准（finding Medium #4）：`NormalizedThreadEvent` 实测形态以 `(itemKind, operation)` 表达语义，并通过 `NORMALIZED_EVENT_DICTIONARY` 归一化引擎私有名；turn lifecycle / usage / processing heartbeat 等不属于 `NormalizedThreadEvent`。

spec 定义的 parity matrix MUST 限定在以下 `NormalizedThreadEvent` 域内的 `(itemKind, operation)` 对：

- `(message, appendAgentMessageDelta)` — assistant message delta
- `(message, completeAgentMessage)` — assistant message completion
- `(reasoning, appendReasoningSummaryDelta|appendReasoningSummaryBoundary|appendReasoningContentDelta)` — reasoning delta（按引擎标 "supported / compat-input / not supported"）
- `(tool, appendToolOutputDelta)` — tool output delta
- `(message|reasoning|tool|diff|review|explore|generatedImage, itemStarted|itemUpdated|itemCompleted)` — item lifecycle 通用形态

**不**纳入本 parity matrix 的信号（属各自独立 runtime 通道）：

- turn started / completed / error
- token usage update
- processing heartbeat
- runtime lifecycle / rate-limit

每个 `(itemKind, operation)` 对对 4 个引擎给出"supported / compat-input / not supported"三态标记。  
test 实现位置：`realtimeHistoryParity.test.ts` 与 `realtimeAdapters.test.ts`。

**Why**：

- parity 矩阵是引擎接入的最小 SLA，没有它就没有跨引擎"等价"语义。
- 限定在 `NormalizedThreadEvent` 域内避免把 turn/usage/heartbeat 的运行时通道误装进 conversation item 契约，违反 v1.4 §0.6"万能 spec"反模式。

### Decision 6: SHALL 条款 ≤ 30 条（防止万能 spec）

任何后续 PR 想把 capability / cost / policy 写进本 spec，必须先创建 follow-up change，不直接扩张本 spec。

**Why**：避免与 `engine-control-plane-isolation` 一样变成"万能 spec"陷阱（v1.4 §0.6 风险）。

### Decision 7: Rust 端不做 SHALL 强制，仅引用 stabilize-core evidence

`src-tauri/src/engine/events.rs` 与 `backend/events.rs` 的 canonical mapping 已经在 stabilize-core 完成验证；本 spec 在 Implementation Plan 里**引用**该证据，但不为 Rust 端添加新 SHALL。

**Why**：Rust 端契约由 stabilize-core 主干承担，本 change 聚焦 frontend 法律语言。

## Implementation Plan

### Phase 1: Contract Inventory（仅文档）

- 列出 `conversationCurtainContracts.ts` 现有 type 与字段。
- 列出 `realtimeAdapterRegistry.ts` 现有 register/lookup 行为。
- 列出 `sharedHistoryLoader.ts` 现有 dedupe / fallback 行为。

产出：design.md 与 spec.md 的依据矩阵。

### Phase 2: Spec Drafting

- 起草 `specs/engine-runtime-contract/spec.md`，SHALL ≤ 30 条。
- Requirement 分组：
  - Realtime event canonical contract
  - History snapshot contract
  - Adapter registration policy
  - Loader fallback policy
  - Cross-engine parity matrix
  - Legacy alias compatibility policy

### Phase 3: Parity Test Gap-Fill

- 核对 `realtimeAdapters.test.ts` 是否覆盖 4 引擎对称场景。
- 核对 `historyLoaders.test.ts` + `sharedHistoryLoader.test.ts` 是否覆盖 4 引擎 history snapshot 对称场景。
- 缺口处补 parity test；保持 heavy-test-noise sentry 通过。

### Phase 4: OpenSpec Validation & Sync

- 运行 `openspec validate formalize-engine-runtime-contract --strict --no-interactive`。
- 待 change 完成 + 测试通过后，同步 `specs/engine-runtime-contract/spec.md` 进 `openspec/specs/`。

### Phase 5: Hand-off

- 把 capability slug `engine-runtime-contract` 写入 `openspec/project.md` 的 Active capabilities 索引（如需要）。
- 为 `add-engine-capability-matrix-spec` 等下游 change 提供"前置完成"信号。

## Rollback Strategy

- 本 change 不改 runtime 行为；rollback 等于 revert spec 与新增 test。
- 若 parity test 暴露真实运行时 bug：把修复拆为独立 P0 hotfix change，不绑定回本 spec。
- 若 spec 写得过严卡住合理 adapter：revert 对应 Requirement 节，不 revert 整个 spec。

## Validation Matrix

| Area | Required Evidence |
|---|---|
| Spec syntactic correctness | `openspec validate --strict --no-interactive` |
| Frontend type integrity | `npm run typecheck` |
| Adapter/Loader behavior | `npm run test` |
| Realtime replay | `npm run perf:realtime:boundary-guard` |
| Bridge stability (referenced) | `npm run check:runtime-contracts`（若 fixture 引用 Rust 事件） |
| Heavy test noise | `npm run check:heavy-test-noise`（若新增 test） |
| Large file governance | `npm run check:large-files:gate`（若 fixture/spec 文件增长） |
| Cross-platform | CI matrix 三端均通过新增 parity test |

## Open Questions

- legacy alias 兼容窗口的具体时长（建议在 spec 中以"至少跨越下一次 minor release"表达，不写绝对日期）。
- parity matrix 中 reasoning delta 在 Gemini/OpenCode 上的"支持/兼容输入/不支持"如何精确表达——交给 spec drafting 阶段（Phase 2）确认。
- Rust events 是否要为本 spec 加 generated TS types（参考 stabilize-core open question）——延后到独立 change。

这些 question 不阻塞本 change 推进；按 v1.4 §六 "绝不另起战场"原则，先写法律、再演化运行时。
