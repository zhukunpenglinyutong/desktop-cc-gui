## Why

Task Center Phase 1 已经建立了 run store、run surface 与 Kanban 最新 run 摘要投影，但真实 Kanban 执行路径仍主要只更新 Kanban execution metadata。用户因此能看到 Task Center 外壳，却不能稳定把 manual / scheduled / chained run 与真实 thread lifecycle 对齐。

本变更把 Task Center 接到现有 Kanban runtime launch path 上，先完成 frontend-first 的真实生命周期闭环，避免过早引入新的 Rust run store 或 IPC contract。

## 目标与边界

- 目标：在现有 Kanban execution path 中创建、更新并持久化 TaskRun。
- 目标：把 launch 成功、launch 失败、链式阻断、非重入阻断投影为 run-level 状态与诊断。
- 目标：保持 Kanban 仍负责 planning / task definition，Task Center 负责 execution / observation。
- 边界：只接入现有前端可观察状态，不新增 Tauri command，不新增 backend persistence。

## 非目标

- 不重写 runtime orchestrator。
- 不引入 remote worker、agent graph 或新的 task protocol。
- 不把完整 run history 写回 Kanban task JSON。
- 不在本阶段实现完整 cancel / resume runtime control，只保留 recovery action 的 bounded state。

## What Changes

- 在 Kanban manual / scheduled / chained execution 启动前创建 TaskRun，并应用 single-active-run guard。
- 在 thread 创建、首条消息发送、成功进入 processing、启动失败等边界更新 TaskRun。
- 将 TaskRun 最新摘要回投影到 Kanban task metadata，保持 Kanban 卡片轻量可读。
- 为 chain blocked、non-reentrant blocked、workspace/thread/message failure 写入可诊断 run state。
- 增加 focused tests 覆盖 launch lifecycle projection 与 storage/projection 边界。

## 技术方案对比

| 方案 | 描述 | 取舍 |
|---|---|---|
| A. frontend-first 接入现有 Kanban launch path | 复用 `TaskRun` store/coordinator，在 `launchKanbanTaskExecution` 里记录生命周期 | 改动小、回滚便宜，符合 Phase 2 当前目标；缺点是仍依赖前端可观察状态 |
| B. 新增 Rust TaskRun store + IPC | 后端维护 run truth，前端订阅状态 | 更长期正确，但会把当前阶段扩大成跨层协议与迁移，风险过大 |
| C. 只在 Task Center 轮询 thread 状态反推 run | 不改 launch path，仅靠 thread/items 推断 | 无法可靠表达 blocked / launch failure / trigger lineage，不采用 |

采用方案 A。

## Capabilities

### New Capabilities

### Modified Capabilities

- `agent-task-center`: Task Center run surface SHALL reflect real Kanban execution lifecycle, not only manually seeded records.
- `runtime-orchestrator`: runtime/thread execution signals SHALL be projectable into TaskRun updates through existing control paths.
- `kanban-task-chaining`: chained continuation SHALL create linked TaskRun records and surface blocked continuation as run diagnostics.
- `kanban-task-scheduling`: scheduled execution SHALL create TaskRun records and preserve non-reentrant active-run behavior.

## Impact

- 前端代码：`src/app-shell-parts/useAppShellSections.ts`、`src/features/tasks/**`、`src/features/kanban/**`。
- 持久化：继续使用 `clientStorage("app")` 的 `taskCenter.taskRuns`；Kanban 只保存 bounded `latestRunSummary`。
- 测试：新增/更新 TaskRun coordinator/projection/storage tests，以及 Kanban launch lifecycle focused tests。
- API：不新增 Tauri command，不修改 Rust runtime contract。

## 验收标准

- manual / scheduled / chained Kanban execution 会生成对应 trigger 的 TaskRun。
- 同一 task 已存在 active run 时，新的启动入口不会静默创建重复 run。
- 启动失败或阻断会在 TaskRun 中记录 `blocked` 或 `failed` 及可读 reason。
- 成功发送首条消息后，TaskRun 进入 `running` 并绑定 thread id。
- Kanban task 的 `latestRunSummary` 与最新 TaskRun 保持一致。
- `openspec validate connect-task-center-runtime-lifecycle --strict --no-interactive` 通过，相关 frontend tests / typecheck 通过。
