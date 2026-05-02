# Execute Task Center Phase 1

## Goal

在 `Context Ledger` 稳定后，执行 `add-agent-task-center` 的 Phase 1：先基于 `clientStorage("app") + frontend projection` 建立独立 `TaskRun` 真值和 surface，而不是立刻下沉新的 Rust/backend run store。

## Linked OpenSpec Change

- `openspec/changes/add-agent-task-center`

## Linked Plan

- `docs/plans/2026-05-03-context-ledger-then-task-center-implementation.md`

## Dependency

- 必须在 `05-03-context-ledger-phase1` 完成核心 projection 与验证后再开始。

## Requirements

- 引入独立 `TaskRun` record schema，覆盖 `runId`、trigger、lineage、status、linked thread identity，以及 `planSnapshot`、`currentStep`、`latestOutputSummary`、`blockedReason`、`failureReason`、`artifacts`。
- task runs 必须独立持久化在 `clientStorage("app")`，不得直接塞回 Kanban task definition store。
- Phase 1 只做 frontend-first run truth source，不新增 Rust/backend run persistence contract。
- 复用现有 thread/runtime control paths 与 workspace session summary APIs，归一 manual/scheduled/chained/retry/resume lifecycle。
- 保持每个 task definition 同时最多一个 active run 的 eligibility guard。
- Task Center surface 必须独立于 Kanban board，支持 engine/status/workspace filters，以及 bounded recovery actions。

## Acceptance Criteria

- [ ] `TaskRun` store 独立存在，刷新应用后 run history 与 latest-run projection 可恢复。
- [ ] Kanban task definition store 仅接收 latest-run summary projection，不承担完整 run history 真值。
- [ ] 手动、scheduled、chained、retry、resume 执行都能投影到统一 lifecycle states。
- [ ] `open conversation`、`retry`、`resume`、`cancel`、`fork new run` 遵守 active-run eligibility guard。
- [ ] Phase 1 没有引入新的 backend protocol 或 Rust truth source。
- [ ] `openspec validate add-agent-task-center --strict --no-interactive` 通过。

## Technical Notes

- 推荐优先复用：
  - `src/app-shell-parts/utils.ts` 的 `extractPlanFromTimelineItems(...)`
  - `src/app-shell-parts/utils.ts` 的 `resolveLockLivePreview(...)`
- 主要实现触点：
  - `src/app-shell-parts/useAppShellSections.ts`
  - `src/features/kanban/hooks/useKanbanStore.ts`
  - `src/features/kanban/utils/kanbanStorage.ts`
  - `src/services/clientStorage.ts`
  - `src/services/tauri/sessionManagement.ts`
  - `src/features/workspaces/hooks/useWorkspaceSessionProjectionSummary.ts`
- Phase 1 明确不做：
  - 新的 Rust run store
  - 新的 backend session/run protocol
  - 改写既有 Kanban task definition schema 作为 run history 真值

## Verification

```bash
openspec validate add-agent-task-center --strict --no-interactive
npm run lint
npm run typecheck
npm run test -- app-shell-parts kanban
```
