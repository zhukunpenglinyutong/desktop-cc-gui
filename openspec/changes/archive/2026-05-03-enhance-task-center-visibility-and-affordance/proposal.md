## Why

Task Center Phase 1 已经把 `TaskRun` truth、lifecycle projection 与 recovery action wiring 站住了，但用户侧感知仍然偏弱：很多关键状态变化主要存在于 detail panel 或 action eligibility 上，用户在 sidebar、Kanban board 与 Workspace Home 的主视角中不容易一眼看出“哪个任务在跑、卡在哪、能做什么”。如果继续只补底层语义而不强化 surface affordance，Task Center 的产品价值会被隐藏在实现正确性里。

现在推进这一步，是为了把已经存在的 execution truth 变成更强的用户可见信号，而不是再提前下沉新的 backend run domain。当前最缺的是 visibility 与 intervention affordance，而不是新的 run store。

## 目标与边界

### 目标

- 目标：增强 `Task Center` 在 `Workspace Home`、Kanban 卡片摘要与相关导航入口上的可见性，让用户无需进入 detail panel 才能感知 run 状态。
- 目标：让 active / blocked / waiting_input / failed / completed run 在列表与卡片层拥有更明确的视觉层级、恢复提示与下一步动作暗示。
- 目标：保持 `TaskRun` 继续作为 execution truth source；本 change 主要改善 surface affordance，不重做 run model。
- 目标：让用户更容易从会话列表、Workspace Home 与 Kanban 理解“最近一次 run 发生了什么”，并更快跳转到正确处理入口。

### 边界

- Phase 2 当前只做 frontend visibility / affordance enhancement，不新增 Rust store 或新的 Tauri command。
- 不把 `Task Center` 升级成新的 runtime orchestration backend。
- 不在本阶段引入批量操作、run analytics、全局多任务编排台或跨线程统一 cancel 协议。
- 不重写 Kanban 信息架构；Kanban 仍然是 planning surface，只增强 run summary 的可见性。

## 非目标

- 不在本阶段重新设计 `TaskRun` 数据模型。
- 不新增 provider-specific telemetry protocol。
- 不把 sidebar 会话列表直接变成完整 Task Center。
- 不承诺解决所有 Task Center 长期 UX 问题；优先解决“变化不够明显、用户不易感知”的主问题。

## What Changes

- 强化 `Task Center` run list 与 detail affordance：
  - 更明确地区分 active / blocked / waiting_input / failed / completed
  - 在 list 层提供更高密度但可读的 execution signal
  - 对可恢复 run 提供更明显的 next-step hint
- 增强 `Workspace Home` 内嵌 Task Center 的首屏可见性，让关键 run 不必先点选 detail 才有价值。
- 强化 Kanban 卡片上的 `latestRunSummary` 呈现，使其能表达最近 run 的状态、阻塞/失败短摘要与可进入 Task Center 的路径。
- 统一 `Task Center`、Workspace Home 与 Kanban run summary 的文案口径与状态映射，避免同一 run 在不同 surface 上看起来像不同语义。
- 补 focused tests，覆盖 visibility state、status emphasis、summary projection 与 navigation affordance。

## 技术方案对比

| 方案 | 描述 | 取舍 |
|---|---|---|
| A. visibility / affordance enhancement | 保持现有 `TaskRun` truth 与 action wiring，只增强 Workspace Home、Task Center list/detail、Kanban summary 的可见性与引导 | 改动面小，直接回应“看起来没变化”的用户反馈，能最大化释放 Phase 1 价值；缺点是仍未引入全局独立 Task Center 页面 |
| B. 直接进入 backend-oriented Phase 2 | 新增更独立的 run domain、更多 runtime contract 或更深 recovery semantics | 架构更完整，但不能直接解决当前“用户感知弱”的问题，会让复杂度先于价值显现 |
| C. 只做视觉皮肤优化 | 调整样式但不改信息结构与状态投影 | 看起来更亮眼，但无法解决用户不知道该看哪里、下一步能做什么的问题 |

采用方案 A。

## Capabilities

### New Capabilities

### Modified Capabilities

- `agent-task-center`: Task Center SHALL provide stronger visibility, status emphasis, and recovery affordance across list/detail surfaces.
- `agent-task-run-history`: latest run summary projection SHALL remain concise but more explainable across Workspace Home and Kanban summary surfaces.

## Impact

- 前端代码：
  - `src/features/tasks/**`
  - `src/features/workspaces/components/WorkspaceHome.tsx`
  - `src/features/kanban/**`
  - 可能涉及相关样式与 i18n 文案
- 持久化：继续复用现有 `TaskRun` store 与 `latestRunSummary` projection，不新增 backend contract。
- API：无新增 Tauri command；继续复用既有 thread / Kanban / Workspace navigation path。
- 测试：新增/更新 Task Center view、Workspace Home、Kanban summary、navigation affordance focused tests。
- 兼容性：必须兼容既有 `TaskRun` store 与旧 `latestRunSummary` 字段缺省/脏值场景；本 change 不得要求数据迁移才能显示基础摘要。
- CI 门禁：实现阶段必须把 focused Vitest、`npm run lint`、`npm run typecheck` 写入 tasks 并执行；spec validation 也必须通过。

## 验收标准

- 用户 MUST 能在不打开 Task Center detail 的前提下，从 `Workspace Home` 或 Kanban 摘要一眼识别最近 run 的关键状态。
- blocked / failed / waiting_input run MUST 提供更明显的 intervention hint，而不是只在 disabled/available button 上隐式表达。
- Kanban 卡片中的 `latestRunSummary` MUST 保持 planning/execution 边界不混淆，但能解释最近 run 的主要结果。
- `Task Center`、Workspace Home 与 Kanban 摘要对同一 run 的状态文案与严重度表达 MUST 保持一致。
- 旧 `TaskRun` / `latestRunSummary` 数据在缺少新 surface 字段时 MUST 回退到安全默认摘要，而不是渲染失败或让 UI 空白。
- 变更相关 OpenSpec validate、focused frontend tests、`npm run lint`、`npm run typecheck` MUST 在 CI/本地门禁中通过。
- 相关 focused frontend tests、`npm run lint`、`npm run typecheck` 通过。
