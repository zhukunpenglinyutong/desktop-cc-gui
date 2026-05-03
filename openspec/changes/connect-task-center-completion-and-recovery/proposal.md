## Why

Task Center 现在已经能展示 run 列表，也能记录 launch lifecycle，但 run 的收尾和恢复动作还没有真正闭环。用户能看到 `running / failed / blocked`，却不能稳定相信这些状态已经跟随 thread telemetry 收敛，也不能从 Task Center 直接走回已有的 retry / resume / cancel control path。

现在继续补这一步，是因为 Phase 1 与 launch-lifecycle phase 都已经把 run store、summary projection 和 surface 搭起来了；剩余缺口已经收敛为前端 projection 与 action routing，而不是新的 backend truth 设计。

## 目标与边界

- 目标：把 `threadStatusById` 与 `threadItemsByThread` 的可观察信号投影到 `TaskRun` settled state。
- 目标：让 Task Center 的 `open conversation / retry / resume / cancel / fork new run` 接到现有 workspace、thread、Kanban control path。
- 目标：保持 `TaskRun` 仍是 frontend-first projection，不新增 Rust run store。
- 边界：只复用现有 `resume_thread`、thread activation、Kanban launch、active-thread interrupt 等路径。

## 非目标

- 不新增 Tauri command。
- 不把 Task Center 升级成新的 runtime orchestrator。
- 不发明跨引擎统一“远程取消任意 thread”的新协议。
- 不在本阶段做批量操作、run analytics 或多任务编排面板。

## What Changes

- 新增 `TaskRun` completion telemetry projection，把 `isProcessing` 结束、诊断输出、artifacts 和 summary 收敛为 `completed / failed / waiting_input / canceled` 等状态。
- 在 app-shell 内增加 workspace-scoped recovery action handler，复用已有 thread open、resume、Kanban relaunch 和 active-thread interrupt 路径。
- 让 Workspace Home 中的 Task Center surface 拿到真实 action handler，而不是只展示静态按钮。
- 补 focused tests，覆盖 settled projection、action eligibility、Workspace Home wiring 与 recovery behavior。

## 技术方案对比

| 方案 | 描述 | 取舍 |
|---|---|---|
| A. frontend telemetry + action adapter | 基于 `threadStatusById`、`threadItemsByThread` 和现有 thread/Kanban action 做投影与恢复 | 改动面最小，可复用现有 contract，符合当前阶段目标；缺点是 cancellation 仍受现有 thread control 能力约束 |
| B. 新增 runtime event / command contract | 为 Task Center 设计专门的 run completion / recovery IPC | 语义更完整，但会把当前阶段扩大为跨层协议改造，不采用 |
| C. 只在 UI 层补按钮可见性 | 保持现有 store，不做 telemetry 收敛 | 交互看似完整，但 run truth 仍漂浮，不能接受 |

采用方案 A。

## Capabilities

### New Capabilities

### Modified Capabilities

- `agent-task-center`: Task Center SHALL expose live recovery actions through existing control paths and reflect settled run telemetry.
- `runtime-orchestrator`: runtime/thread observable signals SHALL settle TaskRun state without introducing a second backend truth source.

## Impact

- 前端代码：`src/features/tasks/**`、`src/features/workspaces/components/WorkspaceHome.tsx`、`src/app-shell-parts/useAppShellSections.ts`。
- 持久化：继续使用 `clientStorage("app").taskCenter.taskRuns`，只补 projection 与 patch 更新。
- API：复用现有 `resume_thread`、thread activation、message send 与 interrupt 能力，不新增 command。
- 测试：新增/更新 task-run telemetry、Task Center view、Workspace Home、app-shell integration focused tests。

## 验收标准

- active run 在 thread processing 结束后，Task Center 能稳定收敛到 settled state，并保留 latest output / artifacts summary。
- blocked 或 failed run 在 Task Center 中能触发至少一种真实恢复路径，而不是只显示无效按钮。
- 同一 task definition 存在 active run 时，retry / fork new run 不会静默制造第二条 active run。
- Workspace Home 中的 Task Center 入口继续只展示当前 workspace 的 runs，并能打开 conversation / 发起恢复动作。
- `openspec validate connect-task-center-completion-and-recovery --strict --no-interactive` 通过，相关 frontend tests / lint / typecheck 通过。
