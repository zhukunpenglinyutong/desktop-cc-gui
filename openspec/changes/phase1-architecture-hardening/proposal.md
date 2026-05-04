## Why

当前仓库已经完成一轮 large-file 拆分与规范治理，但核心复杂度并没有真正消失，而是转移到了跨层 bridge、threads 主链路、状态 ownership 与超大测试面。继续以 patch 方式局部修补，会让 `frontend -> tauri -> rust` contract、会话生命周期和平台兼容性持续漂移，后续 feature 的维护成本会越来越高。

现在需要一个“第一阶段架构收敛”变更：用系统性抽取、职责重分层、契约固化和验证门禁升级，替代点状修补。这个阶段不追求新增产品能力，核心目标是为后续演进建立稳定骨架，并把 Win/Mac 兼容写法与 CI 门禁纳入显式契约。

## 目标与边界

### 目标

- 建立第一阶段架构收敛契约，明确核心热点只能通过 behavior-preserving extraction 与 boundary hardening 演进，禁止继续叠加 patch-style 修复。
- 收敛 `src/services/tauri.ts`、threads / messages / composer 主链路、client persistent state、Rust command/state hub 的职责边界。
- 将 Win/Mac 兼容写法、platform fallback 边界、shell / process / path / quoting 规则纳入统一治理。
- 升级 CI / local quality gates，使架构抽取类变更默认受 contract、large-file、focused regression 与 cross-platform 审查约束。

### 边界

- 本阶段以“结构治理”和“契约治理”为主，不直接扩大产品功能范围。
- 不允许以“顺手优化”为名夹带新的用户可见行为变更；若确需改行为，必须拆出独立 OpenSpec change。
- 不引入新的 frontend state framework，不重写引擎协议，不改变 Tauri command 名称与 payload contract。

## 非目标

- 不做一次性大重写，不做推倒重来式重构。
- 不把现有 feature 统一迁移到新 UI 库、新状态库或新 runtime 模型。
- 不通过删除兼容分支来“简化” Win/Mac 路径。
- 不放松现有 `doctor`、runtime contract、large-file 与 strict validation 门禁。

## What Changes

- 建立 phase-1 architecture hardening contract，要求核心热点只允许做分层抽取、边界收敛、契约补强与 focused regression，不允许继续补丁式堆叠。
- 扩展 core complexity governance：对 frontend service bridge、threads runtime lifecycle、client persistent state ownership、Rust command/state hub 提出显式的 behavior-preserving extraction 约束。
- 将 client persistent state 提升为 P0 治理对象：要求 store schema、migration、corruption recovery、restart-visible consistency 在抽取期间保持显式契约，而不是依赖当前隐式实现。
- 将 Rust shared state / lock topology 提升为 P0 治理对象：要求 `AppState`、shared cores 与跨域 helper 明确状态域边界、锁顺序、持锁范围与禁止项，避免“移动代码但不降低耦合”。
- 将 workspace / session / thread identity invariants 提升为 P0 治理对象：要求 workspace ownership、strict vs related scope、session mutation routing、thread identity continuity 在抽取前后保持可验证一致。
- 新增 cross-platform architecture compatibility capability，统一约束 Win/Mac 在 shell、CLI wrapper、path resolution、process spawn、quoted arguments、filesystem behavior、fallback gating 上的写法与验证方式。
- 将 desktop Tauri runtime 与 web-service runtime parity 提升为 P0 治理对象：要求 bridge 抽取不能只保桌面端 happy path，而破坏 web-service mode、daemon fallback 或 runtime mode 分流语义。
- 新增 architecture CI governance capability，要求架构抽取类 change 在 CI 与本地验证中通过 strict OpenSpec validation、typecheck、lint、test、runtime contracts、doctor、large-file checks 与对应平台 focused smoke evidence。
- 要求所有第一阶段抽取遵循 staged rollout：先 contract / adapter / facade，再迁移 internals，最后清理旧实现，不允许一步到位的无边界替换。
- 要求高风险主链路的测试从超大集成测试向 focused contract tests、lifecycle tests、platform compatibility tests 下沉，并保持最终 regression gate 完整。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险/成本 | 结论 |
|---|---|---|---|---|
| A | 继续按问题单点 patch，哪里痛修哪里 | 交付快，局部改动小 | 复杂度持续累积，contract 漂移，平台兼容靠经验维持 | 不采用 |
| B | 一次性大重写核心层 | 理论上最干净 | 风险极高，回归面过大，难以在当前产品节奏落地 | 不采用 |
| C | 以 OpenSpec 驱动的 staged architecture hardening：先立契约，再按层抽取，保持行为兼容与门禁升级 | 风险可控，可持续推进，适合多轮迭代 | 需要更强的设计纪律与验证成本 | **采用** |

采用方案 C。原因是当前项目已具备 OpenSpec/Trellis/quality gates 基础，最缺的不是工具，而是把“禁止补丁式增长”升级成可执行契约。

## 兼容性规则

- **行为兼容**：所有第一阶段抽取 MUST 保持现有用户可见行为、i18n key、持久化语义、线程生命周期语义、Tauri command contract 不变。
- **持久化兼容**：所有 client persistent state 抽取 MUST 保持 restart-visible state 一致；新增 schema、migration、corruption fallback 或 field normalization 时，必须有显式 versioning/migration/recovery 语义。
- **平台兼容**：Win 与 Mac 路径 MUST 共享同一 capability contract；允许平台适配分支，但不得让某个平台通过 undocumented special-case 维持运行。
- **Shell/Process 兼容**：涉及命令执行、CLI probing、process spawn、wrapper fallback 的实现 MUST 明确区分 direct executable、shell wrapper、quoted args、visible/hidden console、path resolution 语义。
- **Filesystem 兼容**：path join、separator、case sensitivity、home directory resolution、temporary file/write-rename 语义 MUST 使用跨平台安全写法，禁止隐式依赖单平台行为。
- **身份兼容**：workspace / session / thread 的 identity、ownership、scope 与 mutation routing MUST 在抽取前后保持一致，不得出现“能打开但归属错乱”或“能删除但路由错误”的隐性回归。
- **运行模式兼容**：desktop Tauri runtime 与 web-service runtime 的 mode split、fallback gating、daemon capability 探测语义 MUST 保持等价，不得仅以桌面端 smoke 代替 runtime-mode 兼容验证。
- **并发兼容**：Rust shared state 抽取 MUST 固化锁拓扑与状态域边界；不得在新增 helper/submodule 后引入未定义的锁顺序、长持锁 IO 或 async hold 风险。
- **回滚兼容**：每个抽取阶段 MUST 支持 bounded rollback 或 facade-level 降级，不允许在未验证完整前移除旧适配层。

## CI / Quality Gate Rules

- **OpenSpec Gate**：架构收敛类变更 MUST 通过 `openspec validate --all --strict --no-interactive`，且本 change 自身的 proposal/design/specs/tasks 必须完整闭环。
- **Frontend Gate**：触及 frontend 主链路时 MUST 通过 `npm run lint`、`npm run typecheck`、`npm run test`。
- **Runtime Contract Gate**：触及 frontend/backend bridge、command payload、runtime lifecycle 时 MUST 通过 `npm run check:runtime-contracts` 与 `npm run doctor:strict`。
- **Persistent State Gate**：触及 `clientStorage`、workspace-scoped persisted UI state、thread persistence 或 schema evolution 时 MUST 提供 migration / corruption recovery / restart consistency focused tests 或等价验证。
- **Large File Gate**：触及热点大文件、样式分片或测试热点时 MUST 通过 `npm run check:large-files`，并在接近阈值时补 `near-threshold` 证据。
- **Backend Gate**：触及 Rust command/state/process/storage 时 MUST 通过 `cargo test --manifest-path src-tauri/Cargo.toml` 或对应 focused backend suites。
- **Shared-State Gate**：触及 `AppState`、shared cores、workspace/session runtime helpers 时 MUST 记录状态域影响面、锁顺序影响面与 focused backend evidence。
- **Runtime-Mode Gate**：触及 `src/services/tauri.ts`、web-service fallback、daemon RPC/runtime split 时 MUST 验证 desktop runtime 与 web-service runtime 两条路径的行为等价。
- **Platform Evidence Gate**：触及 shell/process/path/fallback/terminal/runtime 兼容路径时 MUST 提供 Win 与 Mac 双平台 smoke evidence；若本地环境无法覆盖其中一端，必须记录缺口、风险与待补验证路径。

## Capabilities

### New Capabilities

- `architecture-cross-platform-compatibility`: 定义第一阶段架构抽取中 Win/Mac 的 shell、path、process、filesystem、fallback 与 compatibility evidence 契约。
- `architecture-ci-governance`: 定义架构收敛类变更的 OpenSpec、frontend、backend、runtime contract、large-file 与 platform evidence 门禁。
- `persistent-state-governance`: 定义 client persistent state 的 schema、migration、corruption recovery、restart-visible consistency 与 extraction safety 契约。
- `shared-state-lock-governance`: 定义 Rust `AppState`、shared core 与跨域 helper 的状态域分治、锁顺序、持锁边界与并发回归门禁。
- `runtime-mode-parity-governance`: 定义 desktop Tauri runtime 与 web-service runtime 在 bridge 抽取、fallback gating、daemon capability 探测上的等价契约。

### Modified Capabilities

- `core-complexity-governance`: 从“允许核心模块抽取”升级为“禁止补丁式增长，要求 staged extraction、facade-first migration、focused regression、rollback-ready 收敛策略”。
- `conversation-lifecycle-contract`: 要求 threads/messages/composer 主链路的结构抽取不得改变 unified lifecycle semantics，且 realtime / completion / recovery / blocked 流程在新旧路径上保持等价。
- `app-shell-exhaustive-deps-stability`: 要求 app-shell / threads / composer 热点的依赖治理与职责抽取协同推进，避免为消除 warning 再次引入结构性漂移。
- `terminal-shell-configuration`: 将 shell path override、platform fallback、terminal open semantics 与第一阶段 cross-platform contract 对齐，禁止新增 undocumented platform-only launch path。
- `large-file-modularization-governance`: 从“行数治理”扩展到“复杂度治理”，要求新模块不能成为新的隐性 hub，必须按职责分片并受 near-threshold watchlist 约束。
- `workspace-session-management`: 要求 workspace / session ownership、strict vs related scope、session mutation routing 在架构抽取前后保持可解释且可验证的一致性。
- `client-web-service-settings`: 要求 runtime mode split、daemon fallback 与 web-service control plane 在 bridge 抽取期间保持兼容，不得只保桌面端路径。

## Impact

- Frontend bridge and runtime hotspots:
  - `src/services/tauri.ts`
  - `src/services/clientStorage.ts`
  - `src/features/threads/**`
  - `src/features/messages/**`
  - `src/features/composer/**`
  - `src/app-shell.tsx`
  - `src/app-shell-parts/**`
- Backend hubs:
  - `src-tauri/src/command_registry.rs`
  - `src-tauri/src/state.rs`
  - `src-tauri/src/runtime/**`
  - `src-tauri/src/backend/**`
  - `src-tauri/src/workspaces/**`
- Existing governance and validation:
  - `openspec/specs/core-complexity-governance/spec.md`
  - `openspec/specs/workspace-session-management/spec.md`
  - `openspec/specs/client-web-service-settings/spec.md`
  - `openspec/specs/terminal-shell-configuration/spec.md`
  - `openspec/specs/large-file-modularization-governance/spec.md`
  - `scripts/check-large-files.mjs`
  - `scripts/doctor.mjs`
  - runtime contract checks under `scripts/check-*.mjs`
- Dependencies:
  - 本提案阶段不要求新增第三方依赖；若后续设计阶段确需引入，必须单独说明必要性、维护活跃度与平台影响。

## 验收标准

- 第一阶段相关实现方案 MUST 明确采用 staged extraction，而不是以 patch 方式在既有 hotspot 上继续叠加分支与条件判断。
- 所有抽取方案 MUST 在 proposal/design/specs/tasks 中显式写明行为兼容边界、平台兼容边界、回滚边界与验证命令。
- Win 与 Mac 兼容路径 MUST 被写成 capability-level contract，而不是散落在实现备注中。
- client persistent state 的 schema、migration、corruption recovery 与 restart consistency MUST 在第一阶段被显式契约化，不能继续依赖“读失败回空对象”的隐式容错。
- Rust shared state 的锁拓扑、状态域分治与持锁边界 MUST 在第一阶段被显式契约化，不能只做文件搬家式抽取。
- workspace / session / thread identity invariants MUST 作为第一阶段的硬约束，不能在抽取后靠手工 smoke 猜测是否仍然正确。
- desktop Tauri runtime 与 web-service runtime parity MUST 进入第一阶段主约束，不能只验证桌面端 happy path 就视为 bridge 收敛完成。
- 任何触及 shell/process/path/fallback 的 change，CI 或验证记录 MUST 体现平台兼容检查，不得仅凭单平台通过即视为完成。
- 任何触及 frontend/backend bridge、threads lifecycle、persistent state、Rust command hub 的 change，MUST 先补 focused contract tests 或等价验证，再进入实现。
- 完成本 change 前，相关后续 design/specs/tasks 必须能约束实现者“做专业抽取，不做补丁修修补补”。
