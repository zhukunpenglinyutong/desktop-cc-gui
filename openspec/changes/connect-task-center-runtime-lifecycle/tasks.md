## 1. Lifecycle Adapter

- [x] 1.1 Add a focused TaskRun lifecycle adapter that can begin, patch, fail/block, and project latest run summaries back to Kanban tasks.
- [x] 1.2 Add tests for adapter behavior: launch accepted, active-run conflict, blocked reason, failure reason, and latest summary projection.

## 2. Kanban Execution Integration

- [x] 2.1 Wire the adapter into `launchKanbanTaskExecution` for manual, scheduled, and chained sources without changing Tauri/Rust contracts.
- [x] 2.2 Ensure chain/manual blocking and non-reentrant blocking do not create silent duplicate active runs.
- [x] 2.3 Ensure thread binding and first-message success update TaskRun to running with linked thread id.
- [x] 2.4 Ensure launch exceptions update TaskRun to failed and keep existing Kanban execution cleanup behavior.

## 3. Verification

- [x] 3.1 Run `openspec validate connect-task-center-runtime-lifecycle --strict --no-interactive`.
- [x] 3.2 Run focused Vitest suites for TaskRun lifecycle/projection and any touched Kanban/AppShell behavior.
- [x] 3.3 Run `npm run lint` and `npm run typecheck`.
