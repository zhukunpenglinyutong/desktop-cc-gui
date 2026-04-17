## Why

当前客户端的 runtime 生命周期管理把“workspace 可见/已恢复”和“后台进程必须存在”混在了一起，导致 `Codex` 进程数随 workspace 数量线性增长；在 Windows 包装链路下，这会进一步放大为 `cmd/node/sandbox` 成串堆积。重复 connect、启动恢复和退出清理路径又不一致，最终表现为老机器卡顿、关客户端后残留 orphan process，以及用户完全无法理解当前池子状态。

这个问题已经不是单点 bug，而是 runtime architecture 缺位。现在需要把“按 workspace 隐式常驻”升级为“按预算、按活跃度、按生命周期显式调度”的 Runtime Orchestrator，并补上一个用户可见的池管理控制台。

## 目标与边界

### 目标

- 建立统一的 runtime lifecycle 模型，区分 `workspace intent / logical session / OS process` 三层。
- 将 `Codex` 从“workspace 数量驱动的常驻进程”改造成“预算驱动的 Hot/Warm/Cold 池化运行时”。
- 统一 `connect / restore / focus / exit / restart / orphan sweep` 的幂等与回收语义。
- 在设置中提供 `Runtime Pool Console`，展示活跃 runtime、进程数、池状态、预算上限，并允许手动关闭、Pin、释放和调参。
- 保持现有 thread / session 数据模型兼容，避免把这次改造扩散成会话系统重写。
- 提供三阶段演进路径：先止血，再去 workspace 常驻化，最后收口到正式 Orchestrator + Console。

### 边界

- 首期重点治理 `Codex` persistent runtime；`Claude/Gemini/OpenCode` 在 Phase 1 只纳入统一清理与观测口径，不强制一口气改成同一执行模型。
- 不重做现有对话 UI、thread list、status panel 的主要交互语义。
- 不在本变更内引入新的外部 daemon、数据库或系统服务。
- 不允许同一 `(engine, workspace)` 被手动增加为多份并行 runtime；“增加”只表示提高预算或 Pin，而不是复制实例。
- 所有 runtime 命令边界仍需遵守现有 Tauri / Rust / service wrapper 分层，不允许前端绕过 `src/services/tauri.ts` 直接碰 bridge。

## 非目标

- 不把设置页做成通用任务管理器替代品。
- 不在首期实现跨设备或跨窗口共享 runtime 池。
- 不重构所有 engine 的内部发送协议与 thread payload。
- 不承诺所有 workspace 永远零冷启动延迟。

## What Changes

- 新增统一 `Runtime Orchestrator` 能力：
  - 引入 runtime registry、lease source、budget、state machine、shutdown coordinator、orphan sweep。
  - 定义 `Absent / Starting / Ready / Busy / CoolingDown / Stopping / Failed / ZombieSuspected` 生命周期状态。
  - 引入 `Hot / Warm / Cold / Pinned` runtime pool 分层，并允许配置 `max_hot / max_warm / warm_ttl`。
  - 约束同一 `(engine, workspace)` 同时最多一个有效 runtime，替换必须走“new ready -> swap -> old stop”流程。
- 调整启动与恢复策略：
  - 启动恢复不再把“visible workspace”直接等价为“必须 connect runtime”。
  - `restore UI != restore runtime`；非活跃 workspace 默认只恢复 metadata/thread list，不强拉后台进程。
  - 运行时 acquire 改为由 active workspace、active turn、resume、send 等显式动作触发。
- 新增 `Runtime Pool Console`：
  - 在设置中展示 engine 维度与 runtime 实例维度的池快照。
  - 显示 workspace、engine、state、pid、wrapper kind、lease source、startedAt、lastUsedAt、是否 pinned。
  - 支持手动关闭 idle runtime、释放到 Cold、Pin/Unpin、调整 budget 上限和 warm TTL。
  - 支持查看强制 kill 次数、orphan sweep 次数和最近清理结果。
- 加固退出与异常恢复：
  - app exit 统一走 shutdown coordinator，覆盖 Codex/Claude/terminal 等现有分散路径。
  - Windows 下所有受管 runtime 统一采用 tree-safe kill 语义。
  - 应用下次启动时可执行 orphan sweep，清理上一轮遗留的受管 runtime。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险/代价 | 结论 |
|---|---|---|---|---|
| A | 继续维持 per-workspace persistent session，只补 `kill` 和少量幂等检查 | 改动最小，短期可止血 | 进程数仍随 workspace 增长，长期架构问题继续存在，用户仍无可见控制面板 | 不采用 |
| B | 引入 Runtime Orchestrator，但只做后台调度，不提供用户可见控制台 | 架构方向正确，系统层更稳 | 可观测性与人工止血能力仍不足，QA/用户难解释当前池状态 | 不采用 |
| C | 引入 Runtime Orchestrator + Pool Console，按三阶段渐进落地 | 同时解决架构、可观测性、人工干预和用户解释性问题 | 实现复杂度更高，需要跨前后端与设置面板改动 | **采用** |

取舍：选择方案 C，但通过三阶段拆解风险。Phase 1 先止血并建立 registry/cleanup；Phase 2 再去掉“visible workspace 即常驻 runtime”；Phase 3 最后收口为正式池化调度与控制台。

## Capabilities

### New Capabilities

- `runtime-orchestrator`: 统一管理 workspace runtime 的状态、预算、lease、清理与恢复语义。
- `runtime-pool-console`: 在设置中展示和控制 runtime pool 的快照、预算与人工干预操作。

### Modified Capabilities

- `claude-runtime-termination-hardening`: 将当前仅面向 Claude 的树状终止与退出治理，扩展为统一的 runtime shutdown 口径。
- `conversation-lifecycle-contract`: 调整 workspace restore / reconnect / runtime acquire 的行为边界，明确“恢复 UI 不等于恢复 runtime”。

## Impact

- Affected backend:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/shared/workspaces_core.rs`
  - `src-tauri/src/workspaces/commands.rs`
  - `src-tauri/src/backend/app_server.rs`
  - `src-tauri/src/backend/app_server_cli.rs`
  - `src-tauri/src/state.rs`
  - 新增 runtime orchestrator / shutdown / diagnostics 模块
- Affected frontend:
  - `src/features/workspaces/hooks/useWorkspaceRestore.ts`
  - `src/features/workspaces/hooks/useWorkspaces.ts`
  - `src/features/threads/hooks/useThreadActions.ts`
  - `src/features/settings/**` 或现有 settings/runtime 面板
  - `src/services/tauri.ts`
- Affected runtime contracts:
  - workspace connect / ensure runtime / runtime pool snapshot / runtime pool mutate actions
- Affected tests:
  - runtime lifecycle contract tests
  - startup/exit cleanup tests
  - settings panel interaction tests
  - Windows wrapper / process tree termination tests

## 验收标准

- 启动后后台 `Codex` 受管 runtime 数不得再与 workspace 数量线性绑定，默认配置下仅由池预算决定。
- 同一 `(engine, workspace)` 重复 connect / ensure 不会创建第二个活跃 runtime，也不会覆盖旧 handle 而不回收旧进程。
- 应用退出后，受管 `Codex` runtime 必须被统一清理；下次启动若发现 orphan runtime，必须能检测并处理。
- `Runtime Pool Console` 必须展示当前 runtime 数、按 engine 聚合数、每个 runtime 的 workspace/state/lease source/pid，以及当前 budget。
- 用户必须可以在 `Runtime Pool Console` 手动关闭 idle runtime、Pin/Unpin runtime、调整预算上限和 warm TTL。
- 将 active workspace 切换、sidebar 恢复、focus refresh 等 UI 恢复动作与 runtime 常驻解耦；默认恢复策略不得因 visible workspace 数增加而线性拉起 runtime。
