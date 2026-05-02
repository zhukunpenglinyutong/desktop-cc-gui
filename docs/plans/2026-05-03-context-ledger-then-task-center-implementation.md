# Context Ledger Then Task Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 先以最小跨层风险交付 `Context Ledger`，再在现有 Kanban / thread / runtime 基础上交付 `Task Center`，避免两条 change 同时进入重型 cross-layer 重构。

**Architecture:** Phase A 先做 `Context Ledger`，因为当前代码里 `Composer`、manual memory、context dual-view、Codex compaction lifecycle 已经具备足够的前端真值，可以用纯前端 projection + 新 surface 跑通价值闭环。Phase B 再做 `Task Center`，但第一版不要急着下沉 Rust 新 store，而是先用 `clientStorage("app") + frontend projection` 从 `useAppShellSections.ts`、Kanban execution state、thread timeline、workspace session summary 汇总出独立 run truth，再视真实缺口决定是否追加 backend contract。

**Tech Stack:** React 19, TypeScript strict, existing `clientStorage` persistence, Composer / thread reducer state, Kanban local store, Workspace Session projection services, Vitest, Tauri 2 desktop bridge

**Execution Tasks:**
- Trellis task: [05-03-context-ledger-phase1 PRD](../../.trellis/tasks/05-03-context-ledger-phase1/prd.md)
- Trellis task: [05-03-task-center-phase1 PRD](../../.trellis/tasks/05-03-task-center-phase1/prd.md)

---

### Task 1: Freeze Sequence And Phase-One Defaults

**Files:**
- Reference: [add-context-ledger proposal](../../openspec/changes/add-context-ledger/proposal.md)
- Reference: [add-context-ledger design](../../openspec/changes/add-context-ledger/design.md)
- Reference: [add-agent-task-center proposal](../../openspec/changes/add-agent-task-center/proposal.md)
- Reference: [add-agent-task-center design](../../openspec/changes/add-agent-task-center/design.md)

**Step 1: Freeze implementation order**

Honor this order:
- `Context Ledger` first
- `Task Center` second

Reason:
- `Context Ledger` already has frontend truth sources in [Composer.tsx](/Users/chenxiangning/code/AI/github/mossx/src/features/composer/components/Composer.tsx), [memoryContextInjection.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/project-memory/utils/memoryContextInjection.ts), and [useThreadsReducer.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/threads/hooks/useThreadsReducer.ts)
- `Task Center` currently has no run store, no independent surface, and execution semantics are still embedded in [useAppShellSections.ts](/Users/chenxiangning/code/AI/github/mossx/src/app-shell-parts/useAppShellSections.ts)

**Step 2: Freeze phase-one defaults**

Defaults to honor:
- `Context Ledger` phase one is frontend-first and does not require a new backend prompt-attribution protocol
- provider-only attribution gaps must render as explicit degraded/shared markers
- `Task Center` phase one uses an independent run store under `clientStorage("app")`, not a new Rust truth source
- `Task Center` must reuse existing thread/runtime control paths and existing workspace session summary APIs

**Step 3: Freeze verification gates**

Run after each phase:
```bash
openspec validate add-context-ledger --strict --no-interactive
openspec validate add-agent-task-center --strict --no-interactive
npm run lint
npm run typecheck
```

Run additionally when touched:
```bash
npm run test -- Composer.context-dual-view useThreadsReducer.compaction memoryContextInjection
npm run check:large-files
```

**Step 4: Commit planning checkpoint**

Suggested commit message:
```bash
git commit -m "docs(plans): 新增账本与任务中心实施计划"
```

### Task 2: Build Context Ledger Projection Core

**Files:**
- Create: `src/features/context-ledger/types.ts`
- Create: `src/features/context-ledger/utils/contextLedgerProjection.ts`
- Create: `src/features/context-ledger/utils/contextLedgerProjection.test.ts`
- Modify: [src/features/composer/components/Composer.tsx](/Users/chenxiangning/code/AI/github/mossx/src/features/composer/components/Composer.tsx)
- Reference: [src/features/project-memory/utils/memoryContextInjection.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/project-memory/utils/memoryContextInjection.ts)
- Reference: [src/app-shell-parts/utils.ts](/Users/chenxiangning/code/AI/github/mossx/src/app-shell-parts/utils.ts)

**Step 1: Write failing projection tests**

Cover:
- manual memories become deterministic `manual_memory` blocks
- repeated file references dedupe into one resource block
- compaction completed but usage not refreshed yields pending-refresh state
- provider-only gaps become degraded/shared summary blocks
- empty manual selection does not fabricate `manual_memory`

Run:
```bash
npm run test -- contextLedgerProjection
```

Expected:
- FAIL because new projection module does not exist yet

**Step 2: Create normalized ledger types**

Define:
- `ContextLedgerBlock`
- `ContextLedgerGroup`
- `ContextLedgerProjection`
- `ContextLedgerAttributionQuality`

Keep phase-one fields aligned with OpenSpec:
- `sourceKind`
- `participationState`
- `freshness`
- `label`
- `tokenEstimate`
- `sourceRef`
- `attributionQuality`

**Step 3: Implement pure projection builder**

Projection inputs should come from existing frontend truth:
- `selectedManualMemories` from [Composer.tsx](/Users/chenxiangning/code/AI/github/mossx/src/features/composer/components/Composer.tsx)
- selected note cards and file references from composer state
- `dualContextUsage` and compaction lifecycle from existing Codex dual-view inputs
- active workspace/helper context only when already visible in send-preparation state

Do not:
- query a new backend endpoint
- re-enable hidden automatic project-memory retrieval
- parse raw shell output

**Step 4: Reuse existing normalization helpers**

Where possible, reuse logic from:
- [memoryContextInjection.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/project-memory/utils/memoryContextInjection.ts) for deterministic text/estimate preparation
- [Composer.tsx](/Users/chenxiangning/code/AI/github/mossx/src/features/composer/components/Composer.tsx) for selected manual memory and note-card state

**Step 5: Run projection tests**

Run:
```bash
npm run test -- contextLedgerProjection
```

Expected:
- PASS for deterministic projection cases

**Step 6: Commit**

```bash
git add src/features/context-ledger src/features/composer/components/Composer.tsx
git commit -m "feat(context-ledger): 新增账本投影模型"
```

### Task 3: Add Context Ledger Surface Beside Composer

**Files:**
- Create: `src/features/context-ledger/components/ContextLedgerPanel.tsx`
- Create: `src/features/context-ledger/components/ContextLedgerPanel.test.tsx`
- Create: `src/features/context-ledger/components/ContextLedgerEntryButton.tsx`
- Modify: [src/features/composer/components/Composer.tsx](/Users/chenxiangning/code/AI/github/mossx/src/features/composer/components/Composer.tsx)
- Modify: `src/features/composer/components/ChatInputBox/ContextBar.tsx`
- Modify: `src/features/composer/components/ChatInputBox/ChatInputBox.tsx`
- Modify: `src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.tsx`
- Modify: `src/features/composer/components/ChatInputBox/types.ts`
- Create: `src/styles/context-ledger.css`
- Modify: [src/bootstrap.ts](/Users/chenxiangning/code/AI/github/mossx/src/bootstrap.ts)
- Modify: `src/i18n/locales/zh.part2.ts`
- Modify: `src/i18n/locales/en.part2.ts`

**Step 1: Write failing surface tests**

Cover:
- entrypoint shows total usage summary and block count
- grouped sections render `manual_memory`, `attached_resource`, `recent_turns`, degraded/shared section
- pending-refresh compaction copy is truthful
- unopened ledger does not change send behavior

Run:
```bash
npm run test -- ContextLedgerPanel ContextBar Composer.context-dual-view
```

Expected:
- FAIL because the ledger surface is not wired yet

**Step 2: Create entrypoint and panel**

Behavior:
- render a compact entrypoint near existing context summary UI
- toggle a dedicated ledger panel
- keep the panel outside the main text input flow
- default to collapsed

**Step 3: Render grouped blocks**

Required groups:
- `recent_turns`
- `manual_memory`
- `attached_resource`
- `compaction_summary`
- degraded/shared fallback group when needed

Each visible row should expose:
- label
- participation state
- size estimate or explicit unknown marker
- freshness / degraded marker when applicable

**Step 4: Add i18n and isolated styles**

Use a dedicated stylesheet:
- `src/styles/context-ledger.css`

Reason:
- avoid growing [src/styles/composer.css](/Users/chenxiangning/code/AI/github/mossx/src/styles/composer.css) and its part files unnecessarily

**Step 5: Run component tests**

Run:
```bash
npm run test -- ContextLedgerPanel ContextBar Composer.context-dual-view
npm run check:large-files
```

Expected:
- PASS
- no large-file regression triggered by the new stylesheet

**Step 6: Commit**

```bash
git add src/features/context-ledger src/features/composer src/styles/context-ledger.css src/bootstrap.ts src/i18n/locales/zh.part2.ts src/i18n/locales/en.part2.ts
git commit -m "feat(context-ledger): 新增账本界面入口"
```

### Task 4: Lock Context Ledger Truthfulness To Existing Thread And Memory State

**Files:**
- Modify: [src/features/threads/hooks/useThreadsReducer.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/threads/hooks/useThreadsReducer.ts)
- Modify: [src/features/threads/hooks/useThreadsReducer.compaction.test.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/threads/hooks/useThreadsReducer.compaction.test.ts)
- Modify: [src/features/composer/components/Composer.context-dual-view.test.tsx](/Users/chenxiangning/code/AI/github/mossx/src/features/composer/components/Composer.context-dual-view.test.tsx)
- Modify: [src/features/threads/hooks/useThreadMessaging.context-injection.test.tsx](/Users/chenxiangning/code/AI/github/mossx/src/features/threads/hooks/useThreadMessaging.context-injection.test.tsx)
- Modify: [src/features/project-memory/hooks/useProjectMemory.test.tsx](/Users/chenxiangning/code/AI/github/mossx/src/features/project-memory/hooks/useProjectMemory.test.tsx)

**Step 1: Add regression tests**

Cover:
- compaction completion stays pending until usage snapshot refresh arrives
- historical compaction messages do not pin current ledger state
- removing manual memory clears its ledger block only
- one-shot memory selection settlement clears matching ledger blocks
- no hidden auto retrieval is reintroduced

**Step 2: Implement minimum state fixes**

If tests reveal drift:
- patch reducer lifecycle transitions in `useThreadsReducer.ts`
- patch composer/manual-memory synchronization in `Composer.tsx`
- do not change backend protocol in this step

**Step 3: Run truthfulness regression suite**

Run:
```bash
npm run test -- Composer.context-dual-view useThreadsReducer.compaction useThreadMessaging.context-injection useProjectMemory
```

Expected:
- PASS with no behavior regression in existing dual-view or manual memory flows

**Step 4: Commit**

```bash
git add src/features/threads src/features/composer src/features/project-memory
git commit -m "fix(context-ledger): 对齐压缩与记忆账本真值"
```

### Task 5: Introduce Independent Task Run Contract In Local Store

**Files:**
- Create: `src/features/tasks/types.ts`
- Create: `src/features/tasks/utils/taskRunStorage.ts`
- Create: `src/features/tasks/utils/taskRunStorage.test.ts`
- Create: `src/features/tasks/utils/taskRunProjection.ts`
- Create: `src/features/tasks/utils/taskRunProjection.test.ts`
- Modify: [src/features/kanban/types.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/kanban/types.ts)
- Modify: [src/features/kanban/utils/kanbanStorage.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/kanban/utils/kanbanStorage.ts)
- Reference: [src/services/clientStorage.ts](/Users/chenxiangning/code/AI/github/mossx/src/services/clientStorage.ts)

**Step 1: Write failing storage tests**

Cover:
- run records persist independently from Kanban task definitions
- latest run summary projects back into task metadata without replacing existing execution state
- parent/upstream lineage survives reload
- active-run lookup is deterministic

Run:
```bash
npm run test -- taskRunStorage taskRunProjection
```

Expected:
- FAIL because task run store does not exist yet

**Step 2: Define run contract**

Minimum fields:
- `runId`
- `taskId`
- `workspaceId`
- `engine`
- `status`
- `trigger`
- `linkedThreadId`
- `parentRunId`
- `upstreamRunId`
- `planSnapshot`
- `currentStep`
- `latestOutputSummary`
- `blockedReason`
- `failureReason`
- `artifacts`
- timestamps

**Step 3: Implement local run store**

Store shape:
- keep task runs in `clientStorage("app")`
- use a dedicated key, for example `taskRuns`
- keep Kanban task definition store unchanged except for latest-run summary projection

Reason:
- phase one already has single-client scope
- current Kanban truth is frontend-local
- this avoids a premature Rust storage branch before UI semantics settle

**Step 4: Extend Kanban task summary**

Add a bounded latest-run summary field to [src/features/kanban/types.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/kanban/types.ts) instead of overloading `execution` further.

**Step 5: Run targeted tests**

Run:
```bash
npm run test -- taskRunStorage taskRunProjection kanbanStorage
```

Expected:
- PASS

**Step 6: Commit**

```bash
git add src/features/tasks src/features/kanban/types.ts src/features/kanban/utils/kanbanStorage.ts
git commit -m "feat(task-center): 新增任务运行记录存储"
```

### Task 6: Wire TaskRun Lifecycle Into Existing Kanban Execution Paths

**Files:**
- Modify: [src/app-shell-parts/useAppShellSections.ts](/Users/chenxiangning/code/AI/github/mossx/src/app-shell-parts/useAppShellSections.ts)
- Create: `src/features/tasks/utils/taskRunCoordinator.ts`
- Create: `src/features/tasks/utils/taskRunCoordinator.test.ts`
- Reference: [src/app-shell-parts/utils.ts](/Users/chenxiangning/code/AI/github/mossx/src/app-shell-parts/utils.ts)
- Reference: [src/features/kanban/utils/resultSnapshot.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/kanban/utils/resultSnapshot.ts)
- Reference: [src/features/kanban/utils/blockedReason.ts](/Users/chenxiangning/code/AI/github/mossx/src/features/kanban/utils/blockedReason.ts)

**Step 1: Write failing coordinator tests**

Cover:
- manual trigger creates a new run only when no active run exists
- scheduled trigger reuses single-active-run guard
- chained downstream run records `upstreamRunId`
- retry only works for settled runs and creates `parentRunId`
- blocked launches become diagnosable runs, not silent no-ops

Run:
```bash
npm run test -- taskRunCoordinator
```

Expected:
- FAIL because no coordinator exists yet

**Step 2: Create task-run coordinator helper**

Responsibilities:
- create run records before launch
- settle or block runs after launch attempt
- keep `latestRunSummary` projection in sync
- centralize one-active-run guard for manual/scheduled/retry/fork flows

**Step 3: Reuse existing diagnostic helpers**

Use existing pure functions instead of inventing new protocols:
- `extractPlanFromTimelineItems(...)` for `planSnapshot`
- `resolveLockLivePreview(...)` for `latestOutputSummary`
- thread processing state for `running / waiting_input / completed`

**Step 4: Integrate with current Kanban launch and scheduler paths**

Touch the existing branches in [useAppShellSections.ts](/Users/chenxiangning/code/AI/github/mossx/src/app-shell-parts/useAppShellSections.ts):
- `launchKanbanTaskExecution`
- scheduler tick for recurring tasks
- chained continuation block
- task open / thread reuse reconciliation where needed

Do not:
- add a new backend command
- change existing thread/runtime control path in this step

**Step 5: Run focused integration tests**

Run:
```bash
npm run test -- useAppShellSections taskRunCoordinator scheduling chaining
```

Expected:
- PASS
- no regression in existing Kanban scheduling/chaining semantics

**Step 6: Commit**

```bash
git add src/app-shell-parts/useAppShellSections.ts src/features/tasks src/features/kanban
git commit -m "feat(task-center): 接入任务运行生命周期"
```

### Task 7: Build Task Center Surface Without Introducing A New Backend Truth Source

**Files:**
- Create: `src/features/tasks/components/TaskCenterView.tsx`
- Create: `src/features/tasks/components/TaskCenterView.test.tsx`
- Create: `src/features/tasks/components/TaskRunList.tsx`
- Create: `src/features/tasks/components/TaskRunDetail.tsx`
- Create: `src/features/tasks/hooks/useTaskCenter.ts`
- Create: `src/styles/task-center.css`
- Modify: [src/features/workspaces/components/WorkspaceHome.tsx](/Users/chenxiangning/code/AI/github/mossx/src/features/workspaces/components/WorkspaceHome.tsx)
- Modify: [src/app-shell.tsx](/Users/chenxiangning/code/AI/github/mossx/src/app-shell.tsx)
- Modify: [src/app-shell-parts/renderAppShell.tsx](/Users/chenxiangning/code/AI/github/mossx/src/app-shell-parts/renderAppShell.tsx)
- Modify: `src/i18n/locales/zh.part2.ts`
- Modify: `src/i18n/locales/en.part2.ts`
- Modify: [src/bootstrap.ts](/Users/chenxiangning/code/AI/github/mossx/src/bootstrap.ts)

**Step 1: Write failing Task Center view tests**

Cover:
- run list filters by workspace / engine / status
- detail panel shows plan snapshot, current step, latest output, artifacts summary
- recovery actions disable when an active-run conflict exists
- linked conversation jump only navigates and does not mutate run state

Run:
```bash
npm run test -- TaskCenterView WorkspaceHome
```

Expected:
- FAIL because no Task Center surface exists yet

**Step 2: Add a workspace-scoped Task Center entrypoint**

Recommendation:
- use `WorkspaceHome` and Kanban card summary as entrypoints
- render Task Center as a dedicated workspace-scoped surface in app shell
- do not introduce a new Rust or global app mode unless existing shell state proves insufficient

**Step 3: Build list and detail UI**

Must render:
- independent run list
- workspace / engine / status filters
- detail panel
- open conversation
- retry / resume / cancel / fork actions

**Step 4: Enforce active-run action guards in the UI**

UI must:
- disable or hide actions that would create a duplicate active run
- prefer “open existing run” over silently creating a second active run

**Step 5: Run surface tests**

Run:
```bash
npm run test -- TaskCenterView WorkspaceHome taskRunProjection
npm run check:large-files
```

Expected:
- PASS

**Step 6: Commit**

```bash
git add src/features/tasks src/features/workspaces/components/WorkspaceHome.tsx src/app-shell.tsx src/app-shell-parts/renderAppShell.tsx src/styles/task-center.css src/bootstrap.ts src/i18n/locales/zh.part2.ts src/i18n/locales/en.part2.ts
git commit -m "feat(task-center): 新增任务中心界面"
```

### Task 8: Final Verification And Backend Escalation Gate

**Files:**
- Reference only in this task unless gaps are discovered

**Step 1: Run OpenSpec and type gates**

Run:
```bash
openspec validate add-context-ledger --strict --no-interactive
openspec validate add-agent-task-center --strict --no-interactive
npm run lint
npm run typecheck
```

**Step 2: Run focused regression suites**

Run:
```bash
npm run test -- ContextLedgerPanel Composer.context-dual-view useThreadsReducer.compaction useThreadMessaging.context-injection taskRunStorage taskRunCoordinator TaskCenterView
```

**Step 3: Decide whether backend work is actually needed**

Only open a backend follow-up if one of these is true:
- frontend cannot derive stable `planSnapshot` or `latestOutputSummary`
- run history volume makes `clientStorage("app")` unacceptable in practice
- workspace-scoped aggregation must be shared across windows/processes

If none of the above happens:
- keep phase one frontend-first
- avoid speculative Rust commands like `list_task_runs`

**Step 4: Ship with bounded scope**

For this branch, prefer these commit boundaries:
- `feat(context-ledger): 新增账本投影模型`
- `feat(context-ledger): 新增账本界面入口`
- `fix(context-ledger): 对齐压缩与记忆账本真值`
- `feat(task-center): 新增任务运行记录存储`
- `feat(task-center): 接入任务运行生命周期`
- `feat(task-center): 新增任务中心界面`

---

Plan complete and saved to `docs/plans/2026-05-03-context-ledger-then-task-center-implementation.md`.

Two execution options:

**1. Subagent-Driven (this session)** - 我按这个计划分阶段执行，每阶段做完就回顾一次，适合现在直接开工。

**2. Parallel Session (separate)** - 新开实现会话，按计划批量推进，适合你想把实现和审查拆开。
