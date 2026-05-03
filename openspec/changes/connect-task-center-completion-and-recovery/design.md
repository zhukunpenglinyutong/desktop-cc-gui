## Context

`add-agent-task-center` 已经提供了 Task Center surface 与 run store，`connect-task-center-runtime-lifecycle` 已把 launch path 接入 TaskRun。当前剩余缺口有两类：

- run 进入 `running` 后，何时以及依据什么信号收敛到 `completed / failed / waiting_input / canceled`；
- Task Center 上展示出来的 recovery action，如何走回现有 thread / Kanban control path，而不是停留在 UI 壳层。

关键约束：

- 继续保持 frontend-first；不新增 Rust run store 或 IPC command。
- `WorkspaceHome` 已经承载 Task Center surface，因此 action handler 更适合由 app-shell 注入，而不是让 component 自己调用 service。
- 现有通用 runtime control 并不提供“对任意未激活 thread 统一 cancel”能力，因此本阶段 cancel 必须保守复用当前 active-thread interrupt 语义。

## Goals / Non-Goals

**Goals:**

- 引入一个纯 utility 层，把 thread observable state 投影成 `TaskRunPatch`。
- 在 app-shell 内周期性/响应式同步 active runs 的 telemetry，并回投影 Kanban `latestRunSummary`。
- 把 Workspace Home 中的 Task Center actions 接到已有 open/resume/retry/fork/cancel 路径。
- 为 action eligibility 与 settled telemetry 补 focused tests。

**Non-Goals:**

- 不重写 `WorkspaceHome` 页面结构。
- 不在本阶段新增全局 Task Center 页面。
- 不为所有引擎设计新的 interrupt/cancel API。
- 不把 `TaskCenterView` 变成直接操作 storage 的智能组件。

## Decisions

### 1. 用 `taskRunTelemetry` 生成 patch，再由 app-shell 落盘

选项 A：`taskRunTelemetry` 直接读写 store。  
选项 B：`taskRunTelemetry` 只负责从 `run + threadStatus + items` 生成 patch，app-shell 决定何时保存。  

采用 B。这样 utility 保持纯函数，可单测；app-shell 保留与 Kanban summary projection 的控制权。

### 2. recovery actions 由 app-shell 注入 `WorkspaceHome -> TaskCenterView`

选项 A：`TaskCenterView` 内直接调用 `services/tauri.ts`。  
选项 B：通过 props 注入 handler，复用 `handleOpenTaskConversation`、`launchKanbanTaskExecution`、`setActiveThreadId`、`interruptTurn`。  

采用 B。它符合 frontend hook/service 分层规则，也避免 component 越过 app-shell orchestration。

### 3. cancel 采用“仅当前活动 thread 可中断”的保守语义

现有能力里，`resume_thread` 可用于恢复指定 thread，但通用 cancel 只有当前 active thread 的 `interruptTurn()` orchestration。  
因此本阶段：

- 若 run 对应 thread 已被激活到当前 workspace/current thread，则允许 `cancel`；
- 否则动作禁用，不伪造跨线程 cancel 成功。

### 4. retry / fork new run 继续复用 Kanban launch path

- `retry`：只针对 settled parent run，复用 `beginTaskRunWithTrigger(... trigger: "retry")` + `launchKanbanTaskExecution(... forceNewThread: true)`。
- `fork new run`：复用同一 relaunch helper，但 trigger 标记为 `forked`。
- `resume`：优先打开并恢复已绑定 thread；若 thread 丢失或未绑定，则回退为打开 conversation，不伪造 successor run。

## Data Flow

```text
threadStatusById + threadItemsByThread
  -> deriveTaskRunTelemetryPatch(active run)
  -> patchKanbanTaskRunLifecycle(runId, patch)
  -> save TaskRun store
  -> project latestRunSummary back to Kanban task

WorkspaceHome
  -> TaskCenterView(props handlers)
  -> app-shell recovery handler
  -> existing thread/Kanban control path
  -> telemetry flows back into TaskRun
```

## Risks / Trade-offs

- [Risk] telemetry 依赖 `isProcessing` 下降沿，个别 provider 可能存在短暂延迟。  
  → Mitigation：保持 projection 保守，不在无 thread/items 证据时伪造 completed。

- [Risk] cancel 语义不够“全局”。  
  → Mitigation：明确只支持当前 active thread interrupt；不适用时禁用按钮。

- [Risk] retry/fork 需要新的 trigger lineage。  
  → Mitigation：新增 feature-local recovery helper，在建 run 时显式写 `parentRunId`。

## Migration Plan

1. 补 proposal/specs/tasks。
2. 新增 telemetry patch helper 与 recovery helper。
3. 在 `useAppShellSections.ts` 接入 run telemetry sync 和 Workspace Home action handlers。
4. 更新 `WorkspaceHome` / `TaskCenterView` props 与 tests。
5. 运行 OpenSpec validate、Vitest、lint、typecheck。

Rollback：移除 app-shell 的 telemetry sync 与 recovery handlers，Task Center 退回当前只读 surface，不影响已存在的 run store。
