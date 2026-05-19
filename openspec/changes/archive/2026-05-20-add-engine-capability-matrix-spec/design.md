## Branch Calibration / 分支校准（2026-05-19）

本设计面向当前 `feature/v0.5.0-md` 分支重新实施。`feature/v0.5` 中曾出现的 TS matrix、Rust matrix、spec fixture、checker 与 validation evidence 视为废弃实现，不得作为当前分支完成状态。

当前定位：**design-ready / implementation-unstarted**。后续实施需要重新 inventory 当前分支的 `EngineFeatures`、Rust engine metadata、UI hard-coded engine branches 与 adapter/loader tests，再生成 matrix。

## Context

本变更是治理战略 v1.4 §4.2 "第 2 件 Quick Win"。

核心判断：

- TS 端与 Rust 端各自已经维护 `EngineFeatures`，但二者**不是同一份合约的两个投影**，而是各自演化的常量。
- UI 渲染中存在大量 `if (engine === 'codex')` 风格分支，这是引擎接入越加越脆的根因之一。
- 治理战略要求 capability 成为"跨前后端一致、可测试、可被 UI/Policy 消费"的法律——本 change 立这条法律。

## Current State

### TS 端

- `src/types.ts` 中 `EngineType` 联合类型为 4 引擎（claude / codex / gemini / opencode）。
- `src/features/engine/` 提供 engine 选择 hook，但 capability lookup 行为分散。
- 多个 feature（status-panel / composer / git）以硬编码 `engine === 'X'` 分支处理能力差异。

### Rust 端

- `src-tauri/src/engine/` 内 4 引擎实现文件：`claude.rs`（含 `claude/` 子目录）、`codex_adapter.rs`、`gemini.rs`、`opencode.rs`（注意：**不是** `claude_adapter.rs`）。
- Rust `EngineFeatures` 定义在 `src-tauri/src/engine/mod.rs`（约 `pub struct EngineFeatures` 起），通过 `EngineFeatures::claude()` / `::codex()` / `::gemini()` / `::opencode()` 构造每引擎能力快照。
- 当前 Rust `EngineFeatures` 字段（实测）：`reasoning_effort`、`collaboration_mode`、`image_input`、`session_resume`、`tools_control`、`streaming`、`mcp`。
- TS `EngineFeatures`（实测）：`streaming`、`reasoning`、`toolUse`、`imageInput`、`sessionContinuation`。与 Rust 字段不完全同构，需要 matrix mapping，而不是直接字段改名。

### 治理 spec 现状

- `engine-control-plane-isolation` spec 已经存在，但它只约束**控制面隔离**，不约束能力矩阵本身。
- `engine-runtime-contract`（本提案前置 change）只约束**事件/历史契约**，不约束 capability。
- 当前没有 spec 回答："新引擎接入需要声明哪些能力？"

## Design Goals

- **单一 capability matrix 来源**：spec 是真相源，TS / Rust 是投影。
- **kebab-case 与 dot-separated dimension** 命名（如 `tool.bash`, `memory.persistent`, `streaming.text`）。
- **四态枚举**：`supported` / `compat-input` / `unsupported` / `unknown`（不允许布尔，因为现实存在 "支持但兼容输入" 的中间态）。
- **UI degradation rule 显式化**：`unsupported` capability 触发可解释降级 UI。
- **CI consistency gate**：spec ↔ TS ↔ Rust 三处任意漂移触发 CI 红灯。
- **Spec 薄**：≤ 25 SHALL 条款；capability 维度 ≤ 12 个起步。

## Non-Goals

- 不引入 capability router / dispatcher。
- 不把 capability 转成 EventBus 或 policy chain 输入（属下游 change）。
- 不为 cost / pricing 维度立法（属 `evolve-context-ledger-to-cost-budget`）。
- 不引入"动态 capability discovery"（运行时探测 capability）；本 spec 仅约束静态声明。
- 不立刻重写所有 UI 引擎分支；spec 只声明降级 rule，重写作为 follow-up。

## Decisions

### Decision 1: Capability 维度起步 ≤ 12（具体取值待 Phase 1 inventory 实测）

> ⚠️ **本表为待核验 inventory 草案，不是 spec 事实**。所有 cell 的最终取值 MUST 由 Phase 1 inventory 阶段：① 读 TS `EngineFeatures`（`src/types.ts:1600+`） ② 读 Rust `EngineFeatures::{claude,codex,gemini,opencode}()`（`src-tauri/src/engine/mod.rs`） ③ 读现有 4 引擎 adapter / loader 实测行为 ——三路对齐后才能写入 spec。

| Capability | 维度 | 取值来源（必须实测） | 备注 |
|---|---|---|---|
| `streaming.text` | realtime text delta | adapter `realtimeEventContract` 测试 | — |
| `streaming.reasoning` | reasoning delta | adapter 实测 | 4 引擎差异需逐一核验 |
| `streaming.tool-output` | tool output delta | adapter 实测 | — |
| `tool.bash` | shell tool | engine adapter 实测 | — |
| `tool.mcp` | MCP tool | Rust `EngineFeatures.mcp` × adapter 实测 | 已知 OpenCode `mcp=false` |
| `hook.pre-tool-use` | pre-tool hook | engine 行为实测 | — |
| `memory.persistent` | session-level memory | engine 行为实测 | — |
| `subagent` | subagent dispatch | engine 行为实测 | — |
| `cost.report` | usage / cost 可见性 | `ThreadTokenUsage` + cost-budget inventory | 不由 runtime event schema 决定 |
| `session.continuation` | resume previous session | history loader 实测 | — |
| `image.input` | 多模态图像输入 | TS `imageInput` + Rust `image_input` | 已知 Codex `image_input=true` |
| `compaction.manual` | 手动 compaction | engine 行为实测 | — |

**事实校准（来自 finding High #3）**：

- 初稿曾把 `image.input` 标 Codex `unsupported` —— 错误，Codex `image_input=true`。
- 初稿曾把 `tool.mcp` 标 OpenCode `supported` —— 错误，OpenCode `mcp=false`。
- 所有"建议"标注 MUST 在 Phase 1 inventory 后才进 spec；Decision 4 的"unknown 视同 unsupported"行为可在 inventory 暂未完成的 capability 上兜底。

**Why 12**：覆盖 UI 与 policy 当前真实需要分支的场景；再多就属过度立法。**Why "待核验"**：避免重复 v1.4 §0.4 R3 警告的"capability 写成常量"陷阱。

### Decision 2: Capability state 四态枚举

| State | 含义 | UI 行为 |
|---|---|---|
| `supported` | 引擎原生支持 | 正常渲染 |
| `compat-input` | 引擎接受但语义弱 | 渲染但可标注降级提示 |
| `unsupported` | 引擎完全不支持 | UI MUST 提供可解释降级（隐藏 / disabled + tooltip） |
| `unknown` | 当前未确认 | UI MUST 视同 `unsupported` 处理，并由 spec 标注待补 |

**Why 四态而非 boolean**：现实中"支持但弱"是真实存在的（如 Codex 接受 MCP 工具调用但语义不等价于 Claude）。

### Decision 3: TS ↔ Rust 双侧投影不破坏现有 EngineFeatures

- `engineCapabilityMatrix.ts` 是 TS 端 capability matrix 投影。
- `engine/capability_matrix.rs` 是 Rust 端 capability matrix 投影。
- 二者 MUST 可由脚本 1:1 投影到 spec fixture（`openspec/changes/.../specs/engine-capability-matrix/fixtures/matrix.json` 或 spec 内 table）。
- CI gate 脚本 `scripts/check-engine-capability-matrix.mjs` 负责对比。
- 第一版 MUST 保留现有 `EngineFeatures` 字段形状，通过 mapping helper 显式关联到 capability key；不在本 change 内重命名或删除旧字段。

**Why**：避免两侧漂移。如果只在一侧维护，另一侧很快变 dead reference。

### Decision 4: UI degradation rule 显式化但不强制重写时机

spec MUST 要求：

- 当 capability 为 `unsupported` / `unknown` 时，UI MUST 提供：
  - 隐藏 / disabled 状态
  - 用户可见的降级原因（i18n key）
- 现有硬编码 `if (engine === 'X')` 分支允许保留，**但新写功能 MUST 使用 capability lookup**。

**Why**：避免本 change 变成大规模 UI 重写；分支重构作为 follow-up trellis 任务。

### Decision 5: Capability 命名采用 dot-separated dimension

形如 `streaming.text`, `tool.mcp`, `hook.pre-tool-use`。

**Why**：

- 支持后续按"维度前缀"路由（如 `tool.*`）。
- 与 `engine-control-plane-isolation` 现有命名风格兼容。
- 避免 capability 名一炸（`mcpToolSupported` / `bashToolSupported` 这种）。

### Decision 6: 矩阵更新走 spec change，不允许 hot patch

任何 capability 维度新增 / 引擎状态变更 MUST：

- 创建 OpenSpec change（不可直接改 TS/Rust 常量）。
- 通过 strict validate。
- 通过 CI consistency gate。

**Why**：matrix 是治理法律，hot patch 等于绕过立法。

### Decision 7: 与 engine-runtime-contract 的边界

- `engine-runtime-contract` 约束**事件/历史 schema 的形状**。
- `engine-capability-matrix` 约束**引擎对能力的声明**。
- 两份 spec 共享 `EngineType`，但不重复约束 event schema。

**Why**：避免万能 spec；每份 spec 单一职责。

## Implementation Plan

### Phase 1: Capability Inventory

- 列 TS `EngineFeatures` 现有字段。
- 列 Rust `EngineFeatures` 现有字段。
- 列 UI 中 `if (engine === ...)` 硬编码分支（grep 报告）。
- 输出"capability 起步集合"草案。

### Phase 2: Spec Drafting

- 起草 `specs/engine-capability-matrix/spec.md`（≤ 25 SHALL）。
- Requirement 分组：
  - Capability dimensions（命名规则、四态枚举）
  - Per-engine declarations（4 引擎填表）
  - TS/Rust mapping rule
  - UI degradation rule
  - CI consistency gate

### Phase 3: TS Matrix Projection

- 新建 `src/features/engine/engineCapabilityMatrix.ts`。
- 新增 TS mapping helper，把现有 `EngineFeatures` 字段映射到 capability key；不改旧字段形状。
- 新增 `engineCapabilityMatrix.test.ts` 强制 TS 矩阵 ↔ spec fixture 一致。

### Phase 4: Rust Matrix Projection

- 新建 `src-tauri/src/engine/capability_matrix.rs`。
- 新增 Rust mapping helper，把现有 `EngineFeatures` 字段映射到 capability key；不改旧字段形状。
- 新增 Rust 单测强制 Rust 矩阵 ↔ spec fixture 一致。

### Phase 5: CI Consistency Gate

- 新增 `scripts/check-engine-capability-matrix.mjs`：对比 spec fixture / TS matrix / Rust matrix。
- 接入 `package.json` 的 `check:engine-capability-matrix` script。
- 接入 CI workflow（三平台）。

### Phase 6: Validation & Hand-off

- 运行 strict validate。
- 把矩阵同步到 `openspec/specs/engine-capability-matrix/spec.md`。
- 为 `evolve-checkpoint-to-policy-chain` 等下游 change 提供"前置完成"信号。

## Rollback Strategy

- 矩阵 spec 移除：revert OpenSpec change + 保留 TS/Rust 常量作为旧实现。
- TS/Rust alias 仍然存在，旧调用者不破。
- UI degradation rule 仅 spec 要求，没有强制 enforcement timer；revert 后 UI 继续以硬编码分支运作。
- CI gate 可单独 disable 而不影响主干。

## Validation Matrix

| Area | Required Evidence |
|---|---|
| Spec syntactic | `openspec validate --strict --no-interactive` |
| TS matrix | `npm run typecheck` + `engineCapabilityMatrix.test.ts` |
| Rust matrix | `cargo test engine::capability_matrix` |
| Cross-language consistency | `npm run check:engine-capability-matrix` |
| Heavy test noise | `npm run check:heavy-test-noise`（若新增 test） |
| Large file | `npm run check:large-files:gate`（若 fixture 增长） |
| Cross-platform | 三平台 CI 矩阵 |

## Open Questions

- Capability 起步集合的最终精确名单——交给 Phase 1 inventory 后定稿。
- 是否要为 capability 引入"version"字段（如 `streaming.text@v1`）以支持后续演化——本 change 不引入，留 follow-up。
- 是否要把 capability state 由 spec → generated TS/Rust types——本 change 不做 codegen，留 follow-up。
- 引擎"运行时能力探测"（dynamic capability discovery）何时纳入——不在本 change 范围。
