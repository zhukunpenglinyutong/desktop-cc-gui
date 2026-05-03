- [x] 1. 补齐 completion telemetry projection artifact
- [x] 1.1 新增 pure helper，把 `threadStatusById` / `threadItemsByThread` observable signals 归一化为 TaskRun patch，而不是直接在组件里判断 settled state。
- [x] 1.2 覆盖 active run completion、diagnostics/artifacts summary、waiting-input or canceled fallback 等 focused tests。

- [x] 2. 把 recovery actions 接到现有 control path
- [x] 2.1 新增 feature-local recovery utility，统一处理 `retry`、`resume`、`fork new run` 的 eligibility 与 lineage。
- [x] 2.2 在 `useAppShellSections.ts` 中注入 Workspace-scoped action handlers，复用已有 open conversation、thread resume、Kanban relaunch、active-thread interrupt 路径。
- [x] 2.3 对不支持的 `cancel` 场景显式禁用或保守降级，不伪造成功态。

- [x] 3. 接通 Workspace Home surface 并完成验证
- [x] 3.1 让 `WorkspaceHome -> TaskCenterView` 拿到真实 handler props，并继续只展示当前 workspace 的 runs。
- [x] 3.2 更新 component/integration tests，覆盖 action wiring、active-run conflict、workspace filtering。
- [x] 3.3 运行 `openspec validate connect-task-center-completion-and-recovery --strict --no-interactive`、focused Vitest、`npm run lint`、`npm run typecheck`。
