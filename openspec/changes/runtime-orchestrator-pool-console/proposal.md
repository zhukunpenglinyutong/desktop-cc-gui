## Why

当前客户端的 runtime 生命周期管理把“workspace 可见/已恢复”和“后台进程必须存在”混在了一起，导致 `Codex` 与 `Claude Code` 进程数随 workspace 数量线性增长；在 Windows 包装链路下，这会进一步放大为 `cmd/node/sandbox` 成串堆积。重复 connect、启动恢复和退出清理路径又不一致，最终表现为老机器卡顿、客户端启动阶段出现大量 `node` 进程、关客户端后残留 orphan process，以及用户完全无法理解当前池子状态。

这个问题已经不是单点 bug，而是 runtime architecture 缺位。现在需要把“按 workspace 隐式常驻”升级为“按预算、按活跃度、按生命周期显式调度”的 Runtime Orchestrator，并补上一个用户可见的池管理控制台。

### 2026-04-18 设计修订（Re-architecture Trigger）

在 `86ec28024648682570a03cc069f95ab77be9b1a5` 之后的 runtime-orchestrator 实现中，出现了新的生产级风险：  
`reconcile_pool` 的时间驱动回收与真实对话执行态（turn/streaming）没有建立硬约束，导致“字段断开/流式中断”现象。

根因不是单点参数，而是架构权限边界错误：

- 回收器拥有直接终止 runtime 的能力，但没有消费 turn lifecycle 真值。
- runtime 活跃信号依赖 `last_used_at` 的粗粒度时间戳，而不是 in-flight lease。
- `Busy` 状态没有由消息/流式事件生命周期持续维护，导致长响应在回收窗口内可被误判为可驱逐。

因此本提案从“止血优化”升级为“生命周期重设计”，目标是把 runtime 回收从“定时器主导”改为“lease/状态机主导”。

### 2026-04-18 实现回写（Post-`86ec280` Alignment）

`86ec28024648682570a03cc069f95ab77be9b1a5` 之后，这个 change 已经不再停留在“待实现提案”阶段，而是经历了连续的实现与收口：

- `cb2db549 feat: add runtime orchestrator pool console`
  - 首次落地 runtime orchestrator、snapshot/mutate contract、settings 侧控制台与 release checklist。
- `d1e17770 fix: expose runtime pool console in visible settings`
  - 将控制台从隐蔽入口挪到可见 settings section，避免功能落地但用户不可达。
- `520e7064 feat: add dedicated runtime pool settings panel`
  - 独立出 `RuntimePoolSection`，补充 summary、diagnostics、policy toggles 与专用 i18n。
- `8d617b60 fix: 重构运行时编排并修复进程回收竞态`
  - 引入 acquire gate、lease-safe eviction、engine observability，修复 `reconcile_pool` 与 runtime 注册时序的竞态。
- `d7b0c022 feat(ui): 优化 runtime 恢复提示与预算设置边界处理`
  - 为消息区补上 `RuntimeReconnectCard`，并收紧 runtime budget 输入归一化与 `zombie-suspected` 等 UI 状态映射。

因此本次回写的目标，不是继续扩张理想蓝图，而是把 proposal 调整为“当前代码已经落地什么、哪些边界仍然保留、接下来验收应该看哪里”。

## 目标与边界

### 目标

- 建立统一的 runtime lifecycle 模型，区分 `workspace intent / logical session / OS process` 三层。
- 将 `Codex` 从“workspace 数量驱动的常驻进程”改造成“预算驱动的 Hot/Warm/Cold 池化运行时”，并将 `Claude Code` 纳入统一 registry / lease / shutdown / observability 口径。
- 建立 turn/streaming 感知的 lease 语义，确保 in-flight 对话绝不被回收器误杀。
- 统一 `connect / restore / focus / exit / restart / orphan sweep` 的幂等与回收语义。
- 把“客户端启动阶段出现大量 `node` 进程”的风暴现象纳入统一诊断与治理范围。
- 在设置中提供可见的 `Runtime Pool Console`，展示活跃 runtime、进程数、池状态、预算上限，并允许手动关闭、Pin、释放和调参。
- 保持现有 thread / session 数据模型兼容，避免把这次改造扩散成会话系统重写。
- 提供三阶段演进路径：先生命周期真值收口，再池化/恢复解耦，最后收口到 Orchestrator + Console。

### 边界

- 首期预算控制、Warm TTL 与 settings 调参入口以 `Codex` 为主；`Claude Code` 当前纳入统一状态观测、lease 防误杀、关闭/清理口径，但暂未暴露独立 budget 配置。
- `Gemini/OpenCode` 在首期只纳入统一清理与观测口径，不强制一口气改成同一执行模型。
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
  - 在 `src-tauri/src/runtime/mod.rs` 落地 runtime registry、startup acquire gate、state machine、runtime ledger、orphan sweep 与 engine observability。
  - 定义 `Starting / Acquired / Streaming / GracefulIdle / Evictable / Stopping / Failed / ZombieSuspected` 生命周期状态，并将 snapshot row 回传到前端。
  - 约束同一 `(engine, workspace)` 同时最多一个有效 runtime，替换必须走“new ready -> swap -> old stop”流程。
- 引入 lease-first 生命周期治理（本次修订重点）：
  - 引入 `turnLease`：从 `turn start` 到 `turn completed/failed/interrupted` 全程持有。
  - 引入 `streamLease`：收到 stream delta 时续租，避免长输出窗口被误判 idle。
  - `reconcile_pool` 改为“候选标记器”，不再直接执行 kill；真正终止由协调后的 close path 执行，并在终止前做二次 lease 校验。
  - 回收前置条件改为：`no active lease` + `state in Evictable` + `budget/ttl 命中`。
- 调整启动与恢复策略：
  - `restore UI != restore runtime`；`useWorkspaceRestore` 可在 `runtimeRestoreThreadsOnlyOnLaunch=true` 时只恢复 metadata/thread list，不批量触发 runtime。
  - `Codex` 的 acquire 改为由显式 runtime-required 动作触发，避免 thread list / hidden restore 路径误拉起 session。
  - `Claude Code` session 同步进入 runtime snapshot、diagnostics 与统一 close path，避免 exit / cleanup 语义继续分叉。
- 新增 `Runtime Pool Console`：
  - 在可见的 `Settings > Runtime` 中新增独立 `RuntimePoolSection`，不再挂靠在其他设置块内部。
  - 展示 summary cards、engine observability、runtime rows、diagnostics counters 与 lifecycle policy toggles。
  - 显示 workspace、engine、state、pid、wrapper kind、resolved bin、lease source、startedAt、lastUsedAt、是否 pinned、eviction reason。
  - 支持手动关闭 runtime、释放到 Cold、Pin/Unpin，以及调整 `Codex` 的 `max_hot / max_warm / warm_ttl`。
- 加固退出与异常恢复：
  - app exit 统一走 managed runtime shutdown，覆盖 `Codex` 与 `Claude Code` 现有分散路径。
  - Windows 下所有受管 runtime 统一采用 tree-safe kill 语义。
  - 应用下次启动时可执行 orphan sweep，清理上一轮遗留的受管 runtime。
- 新增 runtime 断链恢复提示：
  - 消息区可识别 `broken pipe` / `workspace not connected` 等典型 runtime 断链错误。
  - 用户可通过 `RuntimeReconnectCard` 触发 `ensureRuntimeReady` 进行可见恢复，而不是面对静默失败。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险/代价 | 结论 |
|---|---|---|---|---|
| A | 继续维持 per-workspace persistent session，只补 `kill` 和少量幂等检查 | 改动最小，短期可止血 | 进程数仍随 workspace 增长，长期架构问题继续存在，用户仍无可见控制面板 | 不采用 |
| B | 引入 Runtime Orchestrator，但只做后台调度，不提供用户可见控制台 | 架构方向正确，系统层更稳 | 可观测性与人工止血能力仍不足，QA/用户难解释当前池状态 | 不采用 |
| C | 引入 Runtime Orchestrator + Pool Console，按三阶段渐进落地 | 同时解决架构、可观测性、人工干预和用户解释性问题 | 实现复杂度更高，需要跨前后端与设置面板改动 | **采用** |

取舍：选择方案 C，但通过三阶段拆解风险。Phase 1 先止血并建立 registry/cleanup；Phase 2 再去掉“visible workspace 即常驻 runtime”；Phase 3 最后收口为正式池化调度与控制台。当前落地结果是：`Codex` 已进入 budgeted pool，`Claude Code` 已接入统一生命周期与观测，但保留后续独立 budget 化空间。

## Capabilities

### New Capabilities

- `runtime-orchestrator`: 统一管理 workspace runtime 的状态、预算、lease、清理与恢复语义。
- `runtime-pool-console`: 在设置中展示和控制 runtime pool 的快照、预算与人工干预操作。

### Modified Capabilities

- `claude-runtime-termination-hardening`: 将当前仅面向 Claude 的树状终止与退出治理，扩展为统一的 runtime shutdown 口径。
- `conversation-lifecycle-contract`: 调整 workspace restore / reconnect / runtime acquire 的行为边界，明确“恢复 UI 不等于恢复 runtime”。

## Impact

- Affected backend:
  - `src-tauri/src/runtime/mod.rs`
  - `src-tauri/src/codex/mod.rs`
  - `src-tauri/src/codex/session_runtime.rs`
  - `src-tauri/src/engine/claude.rs`
  - `src-tauri/src/shared/workspaces_core.rs`
  - `src-tauri/src/settings/mod.rs`
  - `src-tauri/src/state.rs`
- Affected frontend:
  - `src/features/workspaces/hooks/useWorkspaceRestore.ts`
  - `src/features/workspaces/hooks/useWorkspaces.ts`
  - `src/features/settings/components/SettingsView.tsx`
  - `src/features/settings/components/settings-view/sections/RuntimePoolSection.tsx`
  - `src/features/messages/components/RuntimeReconnectCard.tsx`
  - `src/features/messages/components/runtimeReconnect.ts`
  - `src/services/tauri.ts`
  - `src/types.ts`
- Affected runtime contracts:
  - workspace connect / ensure runtime / runtime pool snapshot / runtime pool mutate actions
- Affected tests:
  - runtime lifecycle contract tests
  - startup/exit cleanup tests
  - settings panel interaction tests
  - runtime reconnect card tests
  - Windows wrapper / process tree termination tests

## 验收标准

- 启动后后台 `Codex` 受管 runtime 数不得再与 workspace 数量线性绑定，默认配置下仅由 `Codex` pool budget 决定；`Claude Code` 不得因 hidden restore 产生无法解释的额外常驻进程。
- 客户端启动完成后，不得因 restore / hidden acquire / residual orphan 导致异常 `node` 进程风暴；启动时受管 runtime 数必须可诊断、可解释。
- 同一 `(engine, workspace)` 重复 connect / ensure 不会创建第二个活跃 runtime，也不会覆盖旧 handle 而不回收旧进程。
- 应用退出后，受管 `Codex` 与 `Claude Code` runtime 必须被统一清理；下次启动若发现 orphan runtime，必须能检测并处理。
- 对任意单次长输出（持续时间超过 `warm_ttl_seconds`）场景，流式字段必须连续，期间不得被 runtime evict/kill 打断。
- `reconcile_pool` 在 in-flight turn 场景不得触发进程终止动作（必须由 lease gate 拦截）。
- `Runtime Pool Console` 必须在可见的 settings runtime section 中展示当前 runtime 数、按 engine 聚合数、每个 runtime 的 workspace/state/lease source/pid，以及 diagnostics counters 和 lifecycle policy toggles。
- 用户必须可以在 `Runtime Pool Console` 手动关闭 idle runtime、Pin/Unpin runtime、调整 `Codex` 预算上限和 warm TTL。
- 将 active workspace 切换、sidebar 恢复、focus refresh 等 UI 恢复动作与 runtime 常驻解耦；默认恢复策略不得因 visible workspace 数增加而线性拉起 `Codex` runtime。
- 当 runtime 断链表现为 `broken pipe` 或 `workspace not connected` 时，消息区必须给出可读恢复提示，并允许用户触发 runtime reconnect。
