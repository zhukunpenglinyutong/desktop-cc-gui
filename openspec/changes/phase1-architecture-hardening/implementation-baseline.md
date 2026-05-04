## Implementation Baseline

### Batch Sequencing

1. `Frontend Bridge Hardening`
   - 已完成首批 `runtime-mode / web-service fallback adapter`
   - 下一批继续拆 `workspace / runtime / diagnostics` 内部分组
2. `Persistent State Governance`
   - 当前优先级最高，因为其约束会影响 threads/composer/session-radar/task-center 持久化边界
3. `Threads / Messages / Composer Lifecycle Hardening`
   - 在 persistent schema 边界显式后推进 selectors / reducer slices 抽取
4. `Rust Shared State And Lock Governance`
   - 先补 domain map，再做 shared helper / lock topology 收敛

### Hotspot Inventory

#### `src/services/tauri.ts`

- 角色：frontend -> runtime bridge facade
- 已识别边界：
  - runtime-mode fallback
  - settings bridge
  - session/workspace management bridge
  - engine runtime bridge
  - diagnostics/doctor bridge
- 首批顺序：
  1. runtime-mode fallback
  2. settings/runtime/diagnostics grouping
  3. workspace/session grouping

#### `src/services/clientStorage.ts`

- 角色：persistent UI preference + identity continuity facade
- 当前风险：
  - store schema 未显式 versioned
  - preload 时 read failure 直接回空对象
  - corruption recovery 无分级策略
  - feature 写入面广，ownership matrix 依赖约定
- store ownership 盘点：
  - `layout`
    - owner: layout / spec-hub layout / git-history panel layout
    - shape: panel width、collapsed groups、surface widths/heights
  - `composer`
    - owner: composer session selection、textarea/input history、prompt history
    - shape: editor height、promptHistory、selectedComposerByThread
  - `threads`
    - owner: thread alias/custom names/activity/pins/sidebar snapshot/exited-session visibility
    - shape: identity continuity + sidebar cache
  - `app`
    - owner: open app selection、language、spec hub session state、kanban/task runs、agent selection、runtime notices
    - shape: workspace-scoped UI preferences + app-level feature caches
  - `leida`
    - owner: session radar persistence only
    - shape: radar recent/read-state/collapsed groups/dismissed completed map

#### `threads/messages/composer`

- 高风险入口：
  - `src/features/threads/hooks/useThreads.ts`
  - `src/features/threads/utils/threadStorage.ts`
  - `src/app-shell-parts/useSelectedAgentSession.ts`
  - `src/app-shell-parts/useSelectedComposerSession.ts`
- 首批抽取建议：
  1. pure persistence helpers / sanitizers
  2. selection/session continuity helpers
  3. reducer / lifecycle slices
- 当前首批落地：
  - `selectedAgentSession.ts`：selected agent normalize / storage-key / migration helper
  - `selectedComposerSession.ts`：composer selection storage-key / draft apply / migration helper
  - `threadPendingResolution.ts`：pending thread -> finalized session reconciliation helper
- 对应 focused evidence：
  - `selectedAgentSession.test.ts`
  - `selectedAgentSession.flow.test.ts`
  - `selectedComposerSession.test.ts`
  - `selectedComposerSession.flow.test.ts`
  - `useThreads.pendingResolution.test.ts`

#### `src-tauri/src/state.rs`

- 当前状态域：
  - workspace catalog
  - runtime sessions
  - terminal sessions
  - runtime log sessions
  - remote backend
  - app settings
  - runtime reload / activation locks
  - dictation state
  - codex login cancel map
  - detached external change runtime
  - runtime manager
  - engine manager
- 风险：
  - domain map 未显式文档化
  - cross-domain lock sequencing 需单独治理

### Current Test Baseline

- bridge/runtime:
  - `src/services/tauri.test.ts`
- persistent/migration:
  - `src/services/migrateLocalStorage.test.ts`
  - `src/services/rendererDiagnostics.test.ts`
  - `src/bootstrapApp.test.tsx`
- threads persistence consumers:
  - `src/features/threads/utils/sidebarSnapshot.test.ts`
  - `src/features/app/utils/exitedSessionVisibility.test.ts`
  - `src/features/workspaces/hooks/useWorkspaces.test.tsx`
- session radar persistence:
  - `src/features/session-activity/utils/sessionRadarHistoryManagement.test.ts`
  - `src/features/session-activity/hooks/useSessionRadarFeed.*.test.tsx`

### Known Gate Status

- 已通过：
  - focused `tauri.test.ts`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run check:runtime-contracts`
  - `npm run check:large-files`
  - `npm run doctor:strict`
  - `openspec validate --all --strict --no-interactive`
- 当前存量阻塞：无
