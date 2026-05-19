## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。`feature/v0.5` 上曾出现的 runtime contract 实现、task 勾选、checker 脚本与 `implementation-evidence.md` 不再作为本变更依据；后续实施必须在当前分支重新完成，不得恢复或引用废弃分支产物作为完成证据。

当前分支状态：proposal / design / tasks / spec delta 已存在，implementation 未开始。近两天当前分支新增的 sidebar timeout fallback、session display projection、tool-call fallback、user-input question card 只作为 runtime 事实背景，不扩大本 change 范围。

## Why

`stabilize-core-runtime-and-realtime-contracts` 已经把 realtime event 与 runtime lifecycle 主干打成钢筋，但落地形态仍然是**事实契约**：

- `src/features/threads/contracts/conversationCurtainContracts.ts` 已经定义 `RealtimeAdapter` / `HistoryLoader` / `NormalizedThreadEvent`，但只在 frontend 内部存在。
- `src/features/threads/adapters/{claude,codex,gemini,opencode}RealtimeAdapter.ts` + `sharedRealtimeAdapter.ts` + `realtimeAdapterRegistry.ts` 已经成形为四引擎 adapter + 注册表，但**没有规范文档约束**新增引擎必须实现什么。
- `src/features/threads/loaders/*HistoryLoader.ts` 同样是四引擎 + shared，**fallback / parity 行为没有 SHALL 级保证**。
- `src-tauri/src/engine/events.rs`、`backend/events.rs` 已经为 canonical event 输出统一形状，但 Rust 与 TS 两侧的契约语义没有通过 spec 锁定。

中文一句话：**主干钢筋已经焊好，但还没刻成法律。任何第 5 个引擎接入都会暴露契约漂移。**

本变更只做一件事：**把已有的 runtime contract 提升为 OpenSpec capability**，让"新增引擎必须做什么"成为可验证的 SHALL 条款，不重写代码、不引入新基础设施。

## Priority Calibration / 优先级校准

本提案与 `stabilize-core-runtime-and-realtime-contracts` 一致采用 P0/P1 双轨：

- **P0** = 契约立法主体：event schema、history snapshot schema、adapter/loader registration policy、parity test 矩阵。
- **P1** = 立法保护栏：legacy alias 兼容窗口、跨平台与 large-file/heavy-test-noise CI gate 继承。

| Priority | Included Area | Why Included | If Not Fixed | If Fixed |
|---|---|---|---|---|
| P0 | Engine runtime event contract | 所有 streaming/usage/error 都依赖此契约 | 新引擎接入需要在 UI/reducer 层手工分支 | 新引擎仅需补 adapter + fixture 即可接入 |
| P0 | Engine history snapshot contract | history loader 是 session continuity 的真相源 | 不同引擎 history 行为不可对齐，merge 时出现 silent gap | history snapshot 形状成为 cross-engine assertion |
| P0 | Adapter/Loader exhaustive coverage policy | 当前是静态 Record 穷举，但新增 EngineType 时缺立法保护 | 新增 engine 时 adapter / loader 漏接的盲区 | spec 锁定"新增 EngineType MUST 同步补 adapter/loader"，编译期 enforce |
| P0 | Cross-engine parity test matrix | 没有 parity 矩阵，CI 不知道"必须等同"的最小集 | 新加引擎可能丢失 reasoning/tool 输出 | parity 矩阵成为 CI 法律入口 |
| P1 | Legacy alias compatibility policy | 移除时间窗口未定义 | alias 永远拖尾 / 突然移除破坏老 session | 明确兼容窗口与移除条件 |
| P1 | Heavy-test-noise / Large-file CI | 本变更只加 spec/test，不改 runtime；但 fixture 与 spec 文件本身受治理 | 立法过程顺手制造新债 | 哨兵继承自 stabilize-core 主干 |
| P1 | Cross-platform 行为不变 | spec 必须对 ubuntu/macos/windows 三端语义保持中立 | spec 内嵌平台假设 | spec 仅约束逻辑形状，平台分支留在实现 |

提案边界：**P1 不等于"顺手把 P1 全做完"**；只把会保护 P0 的 P1 guardrail 写入。

## What Changes

- Add new OpenSpec capability `engine-runtime-contract` covering:
  - Canonical realtime event contract（继承 stabilize-core 已交付 matrix，正式化为 SHALL）
  - Canonical history snapshot contract（loader 输出形状、字段语义、空值处理）
  - Adapter/Loader exhaustive coverage policy（静态穷举要求；新增 EngineType MUST 同 PR 补齐 adapter；不引入 runtime register / override）
  - Cross-engine parity test matrix（4 引擎最小覆盖、CI 入口）
  - Legacy alias compatibility policy（已接受 alias、文档化兼容窗口）
- Promote existing inline contracts to spec without renaming:
  - `RealtimeAdapter` interface in `conversationCurtainContracts.ts`
  - `HistoryLoader` interface in `conversationCurtainContracts.ts`
  - `NormalizedThreadEvent` shape
- Add focused contract tests where missing parity coverage exists.
- 不重写 adapter / loader / mapper；不删除 legacy alias；不引入 runtime 行为变更。

## Scope

### In Scope

- Define `engine-runtime-contract` capability with SHALL requirements ≤ 30 条，覆盖：
  - realtime event canonical names / payload fields
  - history snapshot canonical fields
  - adapter exhaustive coverage rule（static Record, no runtime override）
  - loader fallback / parity assertions（基于现有 sharedHistoryLoader 行为）
  - legacy alias acceptance + compatibility-window policy
- Promote existing tests (`realtimeEventContract.test.ts` / `realtimeAdapters.test.ts` / `historyLoaders.test.ts` / `realtimeBoundaryGuard.test.ts` / `realtimeReplayHarness.test.ts`) as **contract test evidence**.
- Add missing parity tests where any of the 4 engines lacks symmetric coverage.
- Reference stabilize-core 主干交付物，避免重做。

### Out of Scope

- 重写 adapter / loader / mapper（仍由原 feature 自治）。
- 删除任何 legacy alias（兼容窗口策略允许保留）。
- 改 reducer 行为或 UI 渲染。
- 引入 EventBus / domain event publish 通道（由 `add-agent-domain-event-schema` 处理）。
- 引入 capability matrix（由 `add-engine-capability-matrix-spec` 处理）。
- 引入 cost / policy chain（由对应 change 处理）。
- 拆 `app-shell.tsx`（由 `.trellis/tasks/04-22-split-app-shell-orchestration` trellis 任务处理）。

## Engineering Constraints

继承 `stabilize-core-runtime-and-realtime-contracts` 的三道哨兵；本变更增加 spec/test 内容，必须保持哨兵绿灯：

### Cross-Platform Compatibility

- 所有 fixture 路径使用 platform-safe 表达，禁止硬编码 `/` 或 `\\`。
- spec 内的样例 payload 不含平台 newline / shell quoting 假设。
- 新增 parity test 在 `ubuntu-latest` / `macos-latest` / `windows-latest` CI 上等价执行。
- mossx 是 Win/macOS/Linux 通用桌面客户端；本 change 禁止引入 POSIX-only shell command、平台限定 executable name、平台专属 path separator 或 OS-specific newline 语义。必须出现的平台差异只能封装在 adapter/IPC 层。

### Heavy Test Noise Sentry

新增的 parity / contract test 必须保持低噪声，沿用：

```bash
node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs
npm run check:heavy-test-noise
```

该约束必须等价满足 `.github/workflows/heavy-test-noise-sentry.yml`：parser tests 与 `npm run check:heavy-test-noise` 都必须通过，且三平台 runner 不得出现平台特有噪声。

### Large File Governance Sentry

spec 文件、fixture 文件不得产生新的近阈值文件：

```bash
node --test scripts/check-large-files.test.mjs
npm run check:large-files:near-threshold
npm run check:large-files:gate
```

该约束必须等价满足 `.github/workflows/large-file-governance.yml`：parser test、near-threshold watch 与 hard-debt gate 都必须通过。

## Impact

- OpenSpec:
  - `openspec/changes/formalize-engine-runtime-contract/{proposal,design,tasks}.md`
  - `openspec/changes/formalize-engine-runtime-contract/specs/engine-runtime-contract/spec.md`（本 change 完成后同步进 `openspec/specs/engine-runtime-contract/spec.md`）
- Frontend（仅新增 / 补全 test，不改逻辑）:
  - `src/features/threads/contracts/realtimeEventContract.test.ts`
  - `src/features/threads/adapters/realtimeAdapters.test.ts`
  - `src/features/threads/loaders/historyLoaders.test.ts`
  - `src/features/threads/loaders/sharedHistoryLoader.test.ts`
  - `src/features/threads/contracts/realtimeHistoryParity.test.ts`
- Backend（仅 fixture / 验证 import；不改逻辑）:
  - `src-tauri/src/engine/events.rs` mapping evidence reference only
- CI / Governance:
  - heavy-test-noise sentry remains mandatory when tests added
  - large-file governance sentry remains mandatory when spec/fixture grows
  - architecture CI gate（已有）继续运行

## Risks

- **过度立法风险**：SHALL 写得过细会反向卡住合理 adapter 实现 → 通过 D6 决策强制 SHALL ≤ 30 条。
- **legacy alias 被误锁**：spec 把 alias 写进强制接受 → 仅以 compatibility input 描述，禁止做新 canonical 名。
- **Rust/TS 双侧不对称**：spec 主要约束 TS contract，Rust mapping 引用 stabilize-core 已完成证据 → 风险已限缩。
- **依赖下游 change**：capability matrix / cost ledger / policy chain 各自的 spec 在本 change 提交后才动手 → 本 change 必须保持"窄"，不预先承担它们的语义。
- **history snapshot 隐式行为**：sharedHistoryLoader 当前有 fallback / dedupe / ordering 隐式约定 → design.md 中显式列出，spec 仅锁定可观察输出形状，不锁定内部实现。

## Migration Strategy

1. 完成本 proposal + design 评审。
2. 起草 `tasks.md` + `specs/engine-runtime-contract/spec.md`（下一轮）。
3. 用现有测试映射为 contract evidence，缺口处补 parity test。
4. 运行 strict validation；不动 runtime 行为。
5. 合并后，作为 `add-engine-capability-matrix-spec` 等下游 change 的基础。

## Validation

Always-required:

```bash
npm run typecheck
npm run test
npm run perf:realtime:boundary-guard
openspec validate formalize-engine-runtime-contract --strict --no-interactive
```

When-touched governance checks:

```bash
npm run check:runtime-contracts
node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs
npm run check:heavy-test-noise
node --test scripts/check-large-files.test.mjs
npm run check:large-files:near-threshold
npm run check:large-files:gate
```

Rules:

- 本 change 不改 runtime 行为，因此 `cargo test runtime` 仅在 fixture 引用 Rust events 时运行。
- Heavy-test-noise / large-file 哨兵在新增 test/spec 文件时强制。
- 任何跳过的检查 MUST 记录原因与残余风险。

Required CI parity:

- 新增 parity test MUST 在 ubuntu/macos/windows 三端等价执行。
- spec 文件 MUST 通过 `openspec validate --strict`。
