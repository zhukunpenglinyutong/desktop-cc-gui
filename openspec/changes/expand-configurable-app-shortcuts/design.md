## Context

项目已经有一批快捷键入口：composer model/access/reasoning/collaboration、new agent、archive、interrupt、global search、panel toggle、file save/find、UI scale 等。最近这批改动开始把快捷键收口到 Settings，但后续还要继续补 session 切换、左右对话侧栏、terminal、runtime console、files 等位置。

这类需求的风险不在单个 `keydown` 判断，而在系统边界：native menu accelerator、DOM listener、editor scoped keymap、Settings persistence、i18n display 和 platform mapping 必须共用一个 contract。否则同一个按键在 macOS / Windows / Linux、input/editing target、CodeMirror editor、Tauri menu 中会出现不一致。

## Goals / Non-Goals

**Goals:**

- 建立 app-level shortcut action catalog，确保新增快捷键都有 action id、setting key、default shortcut、category、scope、i18n label。
- 复用 `parseShortcut` / `matchesShortcutForPlatform` / `formatShortcutForPlatform`，避免 feature 内手写 modifier 判断。
- 支持打开 session 的 previous / next 快速切换。
- 支持 left conversation sidebar 与 right conversation/sidebar panel toggle。
- 统一 terminal toggle，并新增 runtime console toggle。
- 为 files surface 提供可配置快捷入口，且不抢 editor scoped save/find。
- 保留 legacy settings；已有用户自定义快捷键继续生效。

**Non-Goals:**

- 不引入 command palette 或全局 action registry UI。
- 不做多步 key sequence。
- 不把每个 toolbar/button 都变成快捷动作。
- 不改变 panel/session/files 的业务状态模型。
- 不新增 backend command，除非 native menu accelerator 必须补 menu item id。

## Decisions

### Decision 1: Define shortcuts as action metadata, not scattered JSX rows

新增快捷动作应先进入一个可复用 action metadata map，字段至少包含：

- `settingKey`
- `draftKey`
- `category`
- `labelKey`
- `defaultShortcut`
- `scope`
- `triggerSurface`

Settings -> Shortcuts 从这个 metadata 渲染分组，hook/menu accelerator 也从同一批 settings key 消费配置。

替代方案是在 `ShortcutsSection` 里手写每一行，同时各 hook 自行维护默认值。这个方案会让 UI 展示和实际触发分裂，新增动作越多 drift 越明显。

### Decision 2: Split trigger scope explicitly

快捷动作按 scope 分层：

- `global`: app-shell 层，跳过 editable target，适合 session navigation、sidebar toggle、global search。
- `surface`: 特定区域生效，例如 files surface focus/toggle。
- `editor`: CodeMirror / textarea 内部 action，例如 save/find，不允许被 global listener 抢。
- `native-menu`: 可由 Tauri menu accelerator 更新的 action，例如 new window/open settings。

同一个 setting 可以被 menu accelerator 和 DOM hook 共同消费，但不能重复触发同一 action。实现时必须清楚 action source。

### Decision 3: Session navigation uses open-session order, not workspace order

`previous open session` / `next open session` 应基于当前可见/可达的 open session tab order，而不是 workspace list order 或历史更新时间。这样用户在 topbar session tabs 看到的顺序与快捷键切换顺序一致。

当没有 active session、只有一个 open session、或目标 session 不可达时，快捷键 no-op；不弹错误、不改变 workspace。

### Decision 4: Sidebar toggles target layout state, not feature business state

左侧对话侧栏和右侧对话/面板侧栏的快捷键只改变 layout visibility/collapse state，不创建 session、不切换 engine、不影响 files/git/memory panel 的内部数据。

如果当前 viewport 是 phone/compact layout，toggle 应遵循现有 responsive layout 规则：可 no-op 或走已有 drawer close/open 行为，但不得产生 layout corruption。

### Decision 5: Runtime console and terminal are separate actions

Terminal toggle 与 runtime console toggle 必须是两个 setting key。Terminal 面向 workspace shell / terminal panel；runtime console 面向 runtime/log/control surface。用户按 runtime console 快捷键时，系统不得启动/停止 runtime，只能切换已有 runtime console UI。

### Decision 6: Files shortcut must respect editor scoped shortcuts

Files surface shortcut 可以打开/聚焦/toggle file panel，但在 CodeMirror editor 内，`saveFileShortcut`、`findInFileShortcut` 等 editor scoped shortcut 优先。全局 files shortcut 不得拦截 active editor 的 save/find。

### Decision 7: Defaults are conservative and conflict-audited

实现前必须形成 default shortcut table，检查：

- 已有 app shortcut
- editor scoped shortcut
- OS / browser / Tauri high-risk reserved combinations
- menu accelerator collisions

如果无法找到低冲突默认值，允许该 action 默认 `null`，但 Settings 中仍展示可配置项和推荐说明。

## Proposed Initial Action Set

| Action | Setting key | Scope | Suggested default | Notes |
|---|---|---|---|---|
| Previous open session | `cycleOpenSessionPrevShortcut` | global | `cmd+shift+[` | 最终实现需冲突审计 |
| Next open session | `cycleOpenSessionNextShortcut` | global | `cmd+shift+]` | 与 visible session tab order 对齐 |
| Toggle left conversation sidebar | `toggleLeftConversationSidebarShortcut` | global | `cmd+alt+[` | compact layout 可 no-op |
| Toggle right conversation sidebar | `toggleRightConversationSidebarShortcut` | global | `cmd+alt+]` | 只改 layout visibility |
| Toggle terminal | `toggleTerminalShortcut` | native/menu or global | existing default | 保留现有配置 |
| Toggle runtime console | `toggleRuntimeConsoleShortcut` | global | `cmd+shift+backquote` | 不改变 runtime lifecycle |
| Toggle/focus files surface | `toggleFilesSurfaceShortcut` | global/surface | `cmd+shift+e` | 不抢 editor save/find |

默认值可以在实现阶段因平台冲突审计调整，但 action id 和 setting key 应保持稳定。

## Implementation Notes

### Shortcut Inventory

本次实现把完整 action catalog 收口到 `src/features/settings/components/settings-view/settingsViewShortcuts.ts` 的 `shortcutActions`，Settings draft 由 `buildShortcutDrafts()` 从同一份 metadata 生成。当前 inventory 覆盖：

| Category | Actions | Trigger surface |
|---|---|---|
| app | `openSettingsShortcut`, `newWindowShortcut`, `openChatShortcut`, `openKanbanShortcut` | native menu / DOM |
| file | `newAgentShortcut`, `newWorktreeAgentShortcut`, `newCloneAgentShortcut`, `archiveThreadShortcut` | native menu / DOM |
| navigation | `cycleOpenSessionPrevShortcut`, `cycleOpenSessionNextShortcut`, `cycleAgentNextShortcut`, `cycleAgentPrevShortcut`, `cycleWorkspaceNextShortcut`, `cycleWorkspacePrevShortcut` | DOM / native menu |
| panels | `toggleLeftConversationSidebarShortcut`, `toggleRightConversationSidebarShortcut`, `toggleProjectsSidebarShortcut`, `toggleGitSidebarShortcut`, `toggleGlobalSearchShortcut`, `toggleDebugPanelShortcut`, `toggleTerminalShortcut`, `toggleRuntimeConsoleShortcut`, `toggleFilesSurfaceShortcut` | DOM / native menu |
| composer | `composerModelShortcut`, `composerAccessShortcut`, `composerReasoningShortcut`, `composerCollaborationShortcut`, `interruptShortcut` | editor / DOM |
| editor | `saveFileShortcut`, `findInFileShortcut` | editor |
| git | `toggleGitDiffListViewShortcut` | DOM surface |
| uiScale | `increaseUiScaleShortcut`, `decreaseUiScaleShortcut`, `resetUiScaleShortcut` | DOM |

### Default Collision Audit

| Action | Default | Collision decision |
|---|---|---|
| Previous / next open session | `cmd+shift+[` / `cmd+shift+]` | Distinct from workspace navigation (`cmd+shift+up/down`) and agent navigation (`cmd+ctrl+up/down`); global listener skips editable targets. |
| Left / right conversation sidebar | `cmd+alt+[` / `cmd+alt+]` | Distinct from session navigation by `alt`; compact layout is guarded as no-op. |
| Runtime console | `cmd+shift+\`` | Separate from terminal (`cmd+shift+t`); handler only toggles console UI and does not touch runtime lifecycle. |
| Files surface | `cmd+shift+e` | Does not collide with editor save/find (`cmd+s` / `cmd+f`); global listener skips editable targets. |
| File save / find | `cmd+s` / `cmd+f` | Routed through `FileViewPanel` / CodeMirror scope, not app-shell global file-surface handling. |
| Git diff list view | `alt+shift+v` | Surface-scoped to focused Git diff panel; explicit guard blocks `cmd+f` / `ctrl+f` collisions. |
| Open chat / kanban | `cmd+j` / `cmd+k` | Global mode switches keep existing defaults and skip editable targets. |

No new third-party shortcut dependency was introduced; all new DOM listeners use `matchesShortcutForPlatform()`.

## Risks / Trade-offs

- [Risk] 默认快捷键与系统/编辑器冲突。
  → Mitigation: 默认值表必须在实现 PR 中附带 conflict audit；高风险动作可默认 `null`。

- [Risk] Global listener 抢走 textarea / CodeMirror 内部快捷键。
  → Mitigation: global scope 必须复用 editable target guard；editor scope 由 CodeMirror keymap 或局部 handler 处理。

- [Risk] Native menu accelerator 与 DOM listener 双触发。
  → Mitigation: action metadata 标明 `triggerSurface`，同一 action 不在两个地方同时执行；需要双 surface 的 action 必须有 source guard。

- [Risk] Settings 分组继续膨胀。
  → Mitigation: 使用 category metadata 渲染，避免在 `ShortcutsSection` 堆大量重复 JSX。

- [Risk] session order 定义不清导致快捷切换跳错 workspace。
  → Mitigation: 明确使用 topbar/open session order；测试覆盖跨 workspace tabs。

## Migration Plan

1. 建立或扩展 shortcut action metadata，先覆盖现有 Settings rows，再加入新增 actions。
2. 扩展 `AppSettings` / defaults / draft mapping / Settings UI。
3. 接入 session previous/next handler，使用现有 topbar session tab projection/order。
4. 接入 left/right sidebar toggle handler，复用现有 layout state actions。
5. 接入 runtime console toggle 和 files surface action，确保 terminal toggle 不变。
6. 补齐 i18n key 和 tests。
7. 运行 typecheck、focused Vitest、必要的 large-file gate。

Rollback 策略：保留 settings schema 字段无害存在，移除 hook wiring 即可禁用对应快捷动作；用户自定义值保留但不触发，后续可重新启用。

## Open Questions

- files surface 的第一阶段动作是 “toggle files panel” 还是 “focus current file tree”？建议实现时以当前 UI 中最稳定、最可测的 files entry point 为准。
- left/right conversation sidebar 在 phone layout 下应该 no-op 还是映射到 drawer open/close？建议第一阶段遵循已有 responsive 行为，不新增特殊 phone path。
