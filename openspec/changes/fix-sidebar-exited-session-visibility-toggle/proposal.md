## Why

当前 sidebar 的“显示/隐藏已退出会话”入口直接渲染在 `ThreadList` 顶部，表现为一条独立的 pill bar。这个入口有两个问题：

- 视觉上打断了 workspace / worktree / thread 的层级节奏，尤其在窄侧栏里显得突兀。
- 行为上只存在于 `ThreadList` 组件本地 `useState`，没有稳定的项目级持久化，也没有明确的 workspace/worktree 隔离语义；列表重建或刷新后容易漂移。

本次实现已经把入口挪到项目 / worktree leading icon 上，并把偏好改成按项目路径持久化。现在需要把这个行为正式回写到 OpenSpec，避免后续再把它退回成列表内临时按钮或不稳定的全局状态。

## 目标与边界

- 目标：将 exited session visibility toggle 定义为 workspace/worktree 行级 icon affordance，而不是 thread list 内联 pill。
- 目标：要求 hide/show preference 以项目路径隔离持久化，避免 sibling project、parent main workspace 与 child worktree 串状态。
- 目标：要求隐藏 exited rows 时保留仍有 running/reviewing descendant 的父级路径，避免树结构断裂。
- 目标：要求当所有 exited rows 都被隐藏时，侧栏仍提供明确的恢复 affordance，而不是留下不可解释的空白区域。
- 边界：本 change 只覆盖 sidebar 的 exited session visibility affordance 与状态边界，不重做 pinned section、archive policy 或 session catalog projection。
- 边界：本 change 不引入新的 backend command，也不改变 thread/runtime 数据 contract。

## 非目标

- 不重做整套 sidebar 视觉设计。
- 不把 exited visibility 提升为全局“对所有项目统一生效”的设置项。
- 不扩展到 `Workspace Home`、topbar tabs 或 session management center。

## What Changes

- 修改 `workspace-sidebar-visual-harmony`，新增“项目级 exited session visibility toggle” requirement。
- 明确 workspace / worktree 行 MUST 在 leading icon 附近提供 show/hide exited session 的 icon-level affordance，并通过 i18n label 暴露可访问名称。
- 明确 exited visibility preference MUST 按规范化后的 workspace path 持久化，而不是依赖易变化的 runtime workspace id 或组件本地 state。
- 明确 parent main workspace 与 child worktree 的 exited visibility preference MUST 相互隔离。
- 明确 hide exited rows 时必须保留仍承载 running/reviewing descendant 的 exited ancestor，防止层级断裂。

## Capabilities

### Modified Capabilities
- `workspace-sidebar-visual-harmony`

### New Capabilities
- None.

## Impact

- Affected frontend:
  - `src/features/app/components/Sidebar.tsx`
  - `src/features/app/components/WorkspaceCard.tsx`
  - `src/features/app/components/WorktreeCard.tsx`
  - `src/features/app/components/WorktreeSection.tsx`
  - `src/features/app/components/ThreadList.tsx`
  - `src/features/app/hooks/useExitedSessionVisibility.ts`
  - `src/features/app/utils/exitedSessionRows.ts`
  - `src/features/app/utils/exitedSessionVisibility.ts`
  - `src/styles/sidebar.css`
- Affected tests:
  - `src/features/app/components/Sidebar.test.tsx`
  - `src/features/app/components/ThreadList.test.tsx`
  - `src/features/app/components/WorktreeSection.test.tsx`
  - `src/features/app/utils/exitedSessionRows.test.ts`
  - `src/features/app/utils/exitedSessionVisibility.test.ts`
- Affected specs:
  - modified `workspace-sidebar-visual-harmony`
- Dependencies / APIs:
  - 不引入新的外部依赖
  - 不改变 Tauri / Rust command contract
