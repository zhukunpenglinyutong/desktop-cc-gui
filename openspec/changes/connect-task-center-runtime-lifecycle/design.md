## Context

`add-agent-task-center` 已完成 Phase 1：新增 `TaskRun` schema、clientStorage run store、Task Center surface、Kanban latest-run summary projection 与基础 recovery action guard。当前缺口是 execution truth 仍停留在 Kanban launch orchestration 中，TaskRun 还没有稳定接入 `launchKanbanTaskExecution`。

关键约束：

- `useAppShellSections.ts` 是现有 Kanban manual / scheduled / chained 执行入口，文件大且高风险，必须最小改动。
- 当前阶段不新增 backend truth source；run truth 使用 Phase 1 的 `clientStorage("app")` store。
- Kanban storage 只能保存 bounded latest summary，不保存完整 run history。

## Goals / Non-Goals

**Goals:**

- 让 Kanban execution launch 创建并更新 TaskRun。
- 让 blocking / failure / success boundaries 都能投影为 run lifecycle。
- 保持 single-active-run guard 在 Kanban lock 与 TaskRun active-run 两层一致。
- 增加可测试的 pure helper，减少直接测试大 hook 的脆弱性。

**Non-Goals:**

- 不重构 `useAppShellSections.ts` 的整体结构。
- 不实现 backend event subscription。
- 不新增 engine-specific telemetry protocol。
- 不把 Task Center recovery actions 全部连到 runtime control path。

## Decisions

### 1. 在 launch path 边界写 TaskRun，而不是另建 runtime store

选项 A：在 `launchKanbanTaskExecution` 中调用 TaskRun coordinator。  
选项 B：新增 Rust runtime store 作为 run truth。  
选项 C：Task Center 轮询 thread/items 反推。

采用 A。它最贴近当前真实 trigger source，能拿到 task、source、threadId、failure reason 与 force-new-thread 语义，且不扩大跨层 contract。

### 2. 引入 app-shell 适配 helper，避免把 store 细节散进 hook 主体

TaskRun store 的读写、patch、Kanban latest summary projection 应集中在 feature-local utility。`useAppShellSections.ts` 只表达 lifecycle boundary：

- begin run
- bind thread
- mark running
- mark blocked / failed
- project latest summary

### 3. active-run guard 复用 Phase 1 coordinator

Kanban 已有 `kanbanExecutionLocksRef` 防止同窗口重复触发，但它只覆盖当前 session 内的 launch lock。TaskRun active-run guard 覆盖 persistent run state，防止 retry/resume/scheduled/chained 入口制造第二条 active run。

### 4. 状态映射保持保守

- launch accepted：`queued`
- workspace/thread ready + message preparing：`planning`
- first message sent：`running`
- chain head manual blocked / non-reentrant blocked：`blocked`
- workspace/thread/message exception：`failed`
- completion 仍由现有 telemetry projection / 后续 runtime signal 补齐，不在 launch path 伪造 completed。

## Risks / Trade-offs

- [Risk] `useAppShellSections.ts` 文件过大，直接测试成本高。→ Mitigation：把 TaskRun lifecycle mutation 抽成 pure utility 并单测；hook 内只接少量调用点。
- [Risk] frontend-first run store 可能与真实 runtime completion 有短暂滞后。→ Mitigation：本阶段只保证 launch lifecycle 和 observable projection，不宣称 backend truth。
- [Risk] blocked 是否算 active run 会影响后续 retry。→ Mitigation：沿用 Phase 1 active status 定义；retry/resume 必须先处理或关闭 active blocked run，避免双活。
- [Risk] storage 写入失败可能影响 Kanban 启动。→ Mitigation：TaskRun projection failure 不应中断原有 Kanban execution；但错误需可诊断。

## Migration Plan

1. 新增 utility 层，复用现有 TaskRun store/coordinator/projection。
2. 将 Kanban launch boundaries 接入 utility。
3. 补 focused tests。
4. 运行 OpenSpec validate、lint、typecheck 与相关 tests。

Rollback：移除 `useAppShellSections.ts` 中 TaskRun adapter 调用即可恢复 Phase 1 之前行为；独立 run store 可保留，不影响 Kanban task definition。

## Open Questions

- 完整 cancel / resume 是否应进入下一阶段并接 runtime control path？
- completion telemetry 是否只依赖 thread status polling，还是需要后续 backend event 更精确地回流？
