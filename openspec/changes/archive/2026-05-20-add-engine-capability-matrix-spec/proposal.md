## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。`feature/v0.5` 上曾出现的 capability matrix core、TS/Rust matrix、checker、CI wiring、task 勾选与 `implementation-evidence.md` 不再作为本变更依据；后续必须在当前分支重新设计核对并重新实现。

当前分支状态：OpenSpec artifacts 已可作为设计草案使用，但 implementation 未开始。当前分支已有的 sidebar timeout fallback、session display projection、tool-call fallback 与 user-input question card 不能被倒推出新的 capability cell；新增 capability 仍必须按 TS / Rust / UI / adapter evidence 四源核验。

## Why

mossx 当前支持 4 个引擎（Claude / Codex / Gemini / OpenCode），但**引擎能力差异是隐式的**：

- 前端 `EngineFeatures` 与 Rust `EngineFeatures` 双侧均有 feature flag，但**没有统一的契约对齐**。
- UI 渲染常以 `if (engine === 'claude')` 等硬编码方式分支，没有 capability-aware 抽象。
- 治理策略（streaming visibility / cost report / hooks / MCP / subagent）无法以 capability 维度路由。
- 任何第 5 个引擎接入都必须修改 UI 多处分支，违反 v1.4 §五"决策 1：显式化已有抽象"。

中文一句话：**引擎能力差异是事实，但它今天散落在前后端常量里，不是法律**。

本变更只做一件事：**为引擎能力差异立一份 spec**，让前后端必须共同 honor 同一个 capability 矩阵，UI / policy / cost 可以以 capability 为单位做"能力感知渲染"与"能力感知路由"。

## Priority Calibration / 优先级校准

| Priority | Included Area | Why Included | If Not Fixed | If Fixed |
|---|---|---|---|---|
| P0 | Capability matrix 定义 | 治理战略 §四 4.3 明确要求 | UI/policy 继续散落分支 | 新引擎接入只需补 matrix 行 + adapter |
| P0 | TS ↔ Rust 双侧能力对齐 | 二者已各自存在 feature flags | 双侧漂移 → silent capability mismatch | 单一 matrix 来源，自动对齐 |
| P0 | Capability-aware UI degradation rule | UI 渲染必须能"按 capability 优雅降级" | 不支持的能力被静默隐藏 / 错误调用 | 能力缺失场景在 UI 有可解释提示 |
| P1 | Capability fixture & CI gate | 新增引擎/新增 capability 必经回归 | 矩阵漂移无 CI 警告 | CI 强制 matrix consistency |
| P1 | Compatibility 文档 | 老引擎 / 老用户 / 老 session 的能力快照 | 历史能力变更引发回归 | 文档化 capability 升级语义 |

提案边界：**P1 仅为护栏**，不引入 capability 路由器 / 策略链等运行时新组件（属下游 change）。

## What Changes

- Add OpenSpec capability `engine-capability-matrix` covering:
  - Capability dimension definitions（流式、推理、工具、MCP、subagent、cost、hooks、image input、session continuation）
  - Per-engine capability declaration table（4 引擎 × N capability）
  - TS ↔ Rust capability mapping rule（双侧必须可投影到同一矩阵）
  - Capability-aware UI degradation requirements（能力缺失场景 UI 必须可解释）
  - CI consistency gate（matrix fixture / TS / Rust 三处一致）
- Add a spec-owned matrix projection and mapping layer over existing `EngineFeatures`（TS）与 `EngineFeatures`（Rust）；第一版不重命名、不删除现有字段，避免破坏调用方。
- 不引入新的运行时分发器；不写 capability router；不把 capability 转成 EventBus 消费源。

## Scope

### In Scope

- Define `engine-capability-matrix` spec with ≤ 25 SHALL conditions, 覆盖：
  - Capability key naming（kebab-case, dot-separated dimension）
  - Capability state enum：`supported` / `compat-input` / `unsupported` / `unknown`
  - 4 引擎对当前 capability 集合的声明
  - TS / Rust 双侧实现 MUST 对齐到同一 matrix
  - 当 capability=`unsupported` 时 UI MUST 提供可解释降级
  - 矩阵更新 MUST 经 spec change
- Add matrix data + mapping helpers over existing `EngineFeatures`（TS）与 Rust `EngineFeatures` 字段；第一版保留旧字段形状，通过显式 mapping 关联到 capability key。
- Add `engineCapabilityMatrix.test.ts` 强制 TS 矩阵与 spec fixture 一致。
- Add 跨语言 consistency CI gate（脚本对比 spec fixture / TS matrix / Rust matrix）。
- 依赖前置：`formalize-engine-runtime-contract` 可作为 `streaming.*` / history 相关 cell 的事实来源；若它未合并，相关 cell MUST 标为 `unknown` 并带 pending inventory 标记，而不是猜测。

### Out of Scope

- Capability router / dispatcher（运行时分发是下游 change）。
- Policy chain 接入 capability（属 `evolve-checkpoint-to-policy-chain`）。
- Cost matrix（属 `evolve-context-ledger-to-cost-budget`）。
- Generated types from spec → TS/Rust（延后）。
- 拆 app-shell 中的 engine 分支（属 trellis 任务）。
- 任何运行时行为变更。

## Engineering Constraints

继承 stabilize-core 三道哨兵：

### Cross-Platform Compatibility

- Capability spec 不允许引入平台条件 capability（如 "Windows 上 codex 不支持 streaming"）；平台差异 MUST 在 implementation 中处理，spec 仅声明跨平台等价能力。
- mossx 是 Win/macOS/Linux 通用桌面客户端；capability matrix 不得把 OS 差异编码成 capability truth。涉及 path、process、executable resolution、newline 或 shell quoting 的差异必须留在 adapter/IPC 层，并由三平台 CI 验证。

### Heavy Test Noise Sentry

- 新增 capability matrix test MUST 静默：

```bash
node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs
npm run check:heavy-test-noise
```

- 必须等价满足 `.github/workflows/heavy-test-noise-sentry.yml` 的 parser tests 与 gate，不能只跑 npm script。

### Large File Governance Sentry

- Capability fixture 数据 MUST 模块化；禁止把 4 引擎全部 capability 放进单个超大 fixture 文件：

```bash
node --test scripts/check-large-files.test.mjs
npm run check:large-files:near-threshold
npm run check:large-files:gate
```

- 必须等价满足 `.github/workflows/large-file-governance.yml` 的 parser test、near-threshold watch 与 hard-debt gate。

## Impact

- OpenSpec:
  - `openspec/changes/add-engine-capability-matrix-spec/{proposal,design,tasks}.md`
  - `openspec/changes/add-engine-capability-matrix-spec/specs/engine-capability-matrix/spec.md`
- Frontend:
  - `src/types.ts`（读取现有 EngineFeatures 字段，不破坏字段形状）
  - `src/features/engine/` 内 capability lookup hook
  - 新增 `src/features/engine/engineCapabilityMatrix.ts`（矩阵数据 + 类型）
  - 新增 `src/features/engine/engineCapabilityMatrix.test.ts`
- Backend:
  - `src-tauri/src/engine/` 内读取现有 `EngineFeatures` 字段，不破坏字段形状
  - 新增 `src-tauri/src/engine/capability_matrix.rs` 数据 + 单测
- CI:
  - 新增 cross-language consistency check 脚本（参考 `scripts/check-*`）
  - 接入 `npm run check:engine-capability-matrix`

## Risks

- **Spec 写得过宽**：capability 列得太多，4 引擎填表困难 → 起步只列 ≤ 12 capability，后续 change 扩张。
- **TS/Rust 双侧实现漂移**：CI gate 必须强制；脚本对比 spec / TS / Rust 三处。
- **UI 改造过激**：本 change 仅声明 degradation rule，不强制立刻重写所有 engine 分支；分支重构作为 follow-up trellis 任务。
- **legacy capability flag 迁移风险**：第一版不重命名、不删除现有 `EngineFeatures` 字段；若后续要改字段名，必须走独立 change + alias 阶段。
- **runtime contract 未完成风险**：若 `formalize-engine-runtime-contract` 未合并，`streaming.*` / history 相关 cell 只能标 `unknown`，不得写成事实。

## Migration Strategy

1. 完成本 proposal + design 评审。
2. 起草 spec.md + tasks.md。
3. 先以 spec fixture 与 test 落地（不动 runtime）。
4. 新增 TS/Rust matrix projection；读取现有 `EngineFeatures`，不改旧字段形状。
5. 对 runtime contract 尚未完成的 capability cell 标 `unknown` + pending inventory。
6. 最后接入 CI consistency gate。

## Validation

```bash
npm run typecheck
npm run test
npm run check:engine-capability-matrix   # 新增
cargo test --manifest-path src-tauri/Cargo.toml engine::capability_matrix
openspec validate add-engine-capability-matrix-spec --strict --no-interactive
```

When-touched:

```bash
npm run check:heavy-test-noise
npm run check:large-files:gate
```

Required CI parity:

- `check:engine-capability-matrix` MUST 在 ubuntu/macos/windows 三端等价执行。
- TS matrix 与 Rust matrix 必须可由脚本 1:1 投影到 spec fixture。
