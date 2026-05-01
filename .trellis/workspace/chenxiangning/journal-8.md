# Journal - chenxiangning (Part 8)

> Continuation from `journal-7.md` (archived at ~2000 lines)
> Started: 2026-04-30

---



## Session 238: 统一提交作用域与历史提交区归一化

**Date**: 2026-04-30
**Task**: 统一提交作用域与历史提交区归一化
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

任务目标:
- 修复 AI commit message 生成未遵守当前 commit scope 的问题。
- 以右侧 Git 面板为 canonical surface，归一化 Git History/HUB 左侧 worktree 提交区。
- 固化 Win/mac 路径归一化与显式空 scope contract，避免生成链路回退到全量 diff。

主要改动:
- frontend 抽取并复用 `src/features/git/utils/commitScope.ts`，统一 selective commit 的 path normalize、scoped commit plan 与 restore 语义。
- `GitDiffPanel` 与 `GitHistoryWorktreePanel` 统一接入 `useGitCommitSelection`、`CommitButton`、`InclusionToggle`，左侧文件树/复选框/生成按钮/commit hint 对齐右侧 canonical contract。
- `src/services/tauri.ts`、`src-tauri/src/codex/mod.rs`、`src-tauri/src/git/commands.rs`、`src-tauri/src/git/mod.rs` 打通 `selectedPaths/selected_paths`，让 commit message generation 支持 scope-aware diff。
- 修复 review 发现的显式空 scope 漏洞：用户先选中 unstaged 文件再清空时，生成链路不再错误回退到全部 unstaged diff。
- 更新 `.trellis/spec/guides/cross-layer-thinking-guide.md`，明确 `undefined` 与 `[]` 的 optional payload 语义差异。

涉及模块:
- frontend: `src/features/git/**`, `src/features/git-history/**`, `src/features/app/hooks/useGitCommitController*`, `src/services/tauri.ts`, `src/styles/git-history.part1.css`
- backend: `src-tauri/src/codex/mod.rs`, `src-tauri/src/git/commands.rs`, `src-tauri/src/git/mod.rs`
- spec: `openspec/changes/align-git-commit-scope-surfaces/**`, `.trellis/spec/guides/cross-layer-thinking-guide.md`

验证结果:
- `npx vitest run src/features/git/components/GitDiffPanel.test.tsx src/features/git-history/components/GitHistoryWorktreePanel.test.tsx src/features/app/hooks/useGitCommitController.test.tsx` 通过。
- `npm run typecheck` 通过。
- `npm run lint` 无 error，存在仓库既有的 3 条 `react-hooks/exhaustive-deps` warning，文件为 `src/features/threads/hooks/useThreadTurnEvents.ts`，与本次改动无关。
- `cargo test --manifest-path src-tauri/Cargo.toml collect_commit_scope_diff -- --nocapture` 通过。
- `npm run check:runtime-contracts` 通过。
- `npm run check:large-files:near-threshold && npm run check:large-files:gate` 通过（near-threshold 仅输出仓库 watch warning，无 gate fail）。
- `openspec validate align-git-commit-scope-surfaces --type change --json --no-interactive` 通过。

后续事项:
- 当前 worktree 仍有 `spec-hub` 相关未提交改动，属于其他任务，未纳入本次提交。
- 如需进一步收尾，可在独立任务中决定是否归档 `align-git-commit-scope-surfaces` change。


### Git Commits

| Hash | Message |
|------|---------|
| `c2bbf539` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 239: 修复 Git 提交区大面板卡死并归档规范

**Date**: 2026-04-30
**Task**: 修复 Git 提交区大面板卡死并归档规范
**Branch**: `feature/fix-0.4.12`

### Summary

修复提交区归一化后的右侧 Git / Git His 大面板卡死，并完成 OpenSpec/Trellis 规范回写与归档。

### Main Changes

### Task Goal

- 修复切到右侧 Git 面板并打开 Git His 大面板后卡死的问题。
- 把本次性能回归修复回写到 OpenSpec change、主 specs 与 `.trellis/spec`。
- 仅提交 Git 归一化相关改动，不夹带并行进行中的 spec-hub 工作区改动。

### Main Changes

- 在 `src/features/git/components/GitDiffPanelCommitScope.tsx` 中预构建 commit path topology，并将 selected / included / excluded / partial 状态收敛为单轮派生。
- 在 `src/features/git/components/GitDiffPanel.tsx` 与 `src/features/git-history/components/GitHistoryWorktreePanel.tsx` 中为 tree node 预聚合 `descendantPaths`，移除 render-time descendants 递归扫描，folder/root toggle 改为交互时惰性筛选可切换路径。
- 将 `align-git-commit-scope-surfaces` 的 proposal/design/tasks 补充为包含大面板响应性约束，并同步到主 specs：`git-history-panel`、`git-selective-commit`、`git-commit-message-generation`。
- 将该 OpenSpec change 归档到 `openspec/changes/archive/2026-04-30-align-git-commit-scope-surfaces/`。
- 在 `.trellis/spec/frontend/quality-guidelines.md` 增补 large tree / commit scope 性能约束，固化“预聚合 topology + 单轮派生”的实现规则。

### Modules

- `src/features/git/components/*`
- `src/features/git-history/components/GitHistoryWorktreePanel.tsx`
- `openspec/specs/git-history-panel/spec.md`
- `openspec/specs/git-selective-commit/spec.md`
- `openspec/specs/git-commit-message-generation/spec.md`
- `.trellis/spec/frontend/quality-guidelines.md`

### Verification

- [OK] `openspec validate "align-git-commit-scope-surfaces" --strict`
- [OK] `npm exec vitest run src/features/git-history/components/GitHistoryWorktreePanel.test.tsx src/features/git/components/GitDiffPanel.test.tsx`
- [OK] `npm run typecheck`
- [OK] `npm exec eslint src/features/git/components/GitDiffPanelCommitScope.tsx src/features/git-history/components/GitHistoryWorktreePanel.tsx src/features/git/components/GitDiffPanel.tsx`
- [OK] `npm run check:large-files:near-threshold`
- [OK] `npm run check:large-files:gate`
- [OK] `npm run check:heavy-test-noise`
- [OK] 人工验证：右侧 Git 面板 + Git His 大面板打开不再卡死。

### Follow-up

- 当前工作区仍有一批 spec-hub 相关未提交改动，未纳入本次 Git 提交与 Trellis 记录范围。


### Git Commits

| Hash | Message |
|------|---------|
| `df4709b8c110279d3c543feeea1d6156f430a3e9` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 240: Git 面板显式预览操作

**Date**: 2026-04-30
**Task**: Git 面板显式预览操作
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

任务目标：
- 为右侧主 Git 面板 changed file list 显式暴露“中间区域预览 / 弹窗预览”两个入口，提升 discoverability。
- 保持现有 row 单击 / 双击语义不变，并兼容 flat / tree 两种列表模式。

主要改动：
- 在 `GitDiffPanelFileSections.tsx` 的 file row action 区新增 inline preview 与 modal preview 两个 icon button，并放在 stage/unstage/discard 之前。
- 在 `GitDiffPanel.tsx` 抽出 `handleOpenInlinePreview`，复用原单击选中文件并切换中间 diff 的语义，并贯穿 flat/tree 两个 section。
- 对 row 层的 keydown / double-click 增加 button target 防护，避免按钮触发行级别的重复预览行为。
- 补充 `zh/en` i18n 文案、`diff.css` 展开宽度与 hover 样式。
- 新增 `GitDiffPanel.test.tsx` 回归测试，覆盖按钮顺序、tree inline preview、modal preview 不冒泡。
- 完成 OpenSpec 主 spec 同步、strict validate 和 archive：`expose-git-file-preview-actions`。

涉及模块：
- `src/features/git/components/GitDiffPanel.tsx`
- `src/features/git/components/GitDiffPanelFileSections.tsx`
- `src/features/git/components/GitDiffPanel.test.tsx`
- `src/i18n/locales/en.part1.ts`
- `src/i18n/locales/zh.part1.ts`
- `src/styles/diff.css`
- `openspec/specs/git-file-preview-affordance/spec.md`
- `openspec/changes/archive/2026-04-30-expose-git-file-preview-actions/`

验证结果：
- [pass] `npm exec vitest run src/features/git/components/GitDiffPanel.test.tsx`
- [pass] `npm run typecheck`
- [pass] `npm run check:large-files`
- [pass] `openspec validate "expose-git-file-preview-actions" --strict`
- [warn] `npm run lint` 存在仓库内既有无关错误：`src/features/note-cards/components/WorkspaceNoteCardPanel.tsx:55`
- [pass] 本次改动相关文件的定向 eslint 检查通过。

后续事项：
- 若后续要把 Git History / worktree surface 也做相同预览 affordance，需要单独定义行为归一化边界，避免图标一致但预览语义不一致。


### Git Commits

| Hash | Message |
|------|---------|
| `da9ea37463ebb530839fdcccf675208f1c306ad6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 241: Spec Hub 独立阅读窗体与需求池优化

**Date**: 2026-04-30
**Task**: Spec Hub 独立阅读窗体与需求池优化
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

任务目标:
- 完成 Spec Hub 本轮视图层优化，补齐需求池、默认折叠执行台语义、独立阅读窗体与阅读导航布局。
- 收口 detached Spec Hub 的跨平台兼容性，重点复核 macOS 拖拽与 Windows 窗口行为。

主要改动:
- 新增 detached Spec Hub window 路由、session snapshot、reader-only surface 与恢复链路。
- 在 Spec Hub reader 中加入默认折叠的阅读导航、左侧变更区折叠与拖宽、任务分组未完成提醒点。
- 统一主入口直接打开 detached Spec Hub，并补齐需求池/backlog 的筛选、右键迁移与文案。
- review 阶段额外修复 macOS menubar 拖拽对 Text node target 的兼容问题，并把 detached Spec Hub 默认高度下调到与 detached file explorer 更接近。

涉及模块:
- openspec/changes/spec-hub-viewer-and-detached-window
- openspec/changes/archive/2026-04-30-spec-hub-change-backlog-and-console-defaults
- src/features/spec/**
- src/features/files/components/FileExplorerWorkspace.tsx
- src/router.tsx
- src/services/tauri.ts
- src/styles/spec-hub.css
- src/styles/spec-hub.reader-layout.css
- src/i18n/locales/en.part2.ts
- src/i18n/locales/zh.part2.ts

验证结果:
- pnpm vitest run src/features/spec/components/DetachedSpecHubWindow.test.tsx src/features/spec/detachedSpecHub.test.ts src/features/spec/components/spec-hub/reader/SpecHubSurfaceFrame.test.tsx src/features/spec/components/SpecHub.test.tsx src/router.test.tsx 通过
- openspec validate "spec-hub-viewer-and-detached-window" --type change --strict --no-interactive 通过
- npm run typecheck 通过
- npm run lint 存在仓库既有 warning：src/features/threads/hooks/useThreadTurnEvents.ts 中 3 条 react-hooks/exhaustive-deps warning，本次未触碰该文件

后续事项:
- 视需要继续做 detached Spec Hub 的人工实机验证，重点看 macOS overlay title bar 和 Windows 原生标题栏下的最终交互手感。
- 当前工作树仍有与 note-card / composer / backend 相关的未提交改动，不属于本次 Spec Hub commit。


### Git Commits

| Hash | Message |
|------|---------|
| `a6dd7b21` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 242: 归档 Spec Hub 独立阅读窗体 OpenSpec 变更

**Date**: 2026-04-30
**Task**: 归档 Spec Hub 独立阅读窗体 OpenSpec 变更
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

任务目标:
- 收口 Spec Hub 独立阅读窗体与阅读导航改造对应的 OpenSpec 文档。
- 将 change 内的 delta specs 同步到主 specs，并完成 change 归档。

主要改动:
- 将 detached Spec Hub window 能力同步到主 specs，新增 `openspec/specs/detached-spec-hub-window/spec.md`。
- 将 reader outline、linked spec reading flow、collapsible side panes 等 requirement 合并进 `openspec/specs/spec-hub-workbench-ui/spec.md`。
- 使用 `openspec archive spec-hub-viewer-and-detached-window --yes --skip-specs` 归档 change 到 `openspec/changes/archive/2026-04-30-spec-hub-viewer-and-detached-window/`。

涉及模块:
- openspec/specs/spec-hub-workbench-ui/spec.md
- openspec/specs/detached-spec-hub-window/spec.md
- openspec/changes/archive/2026-04-30-spec-hub-viewer-and-detached-window/**

验证结果:
- openspec validate "spec-hub-viewer-and-detached-window" --type change --strict --no-interactive 通过
- openspec archive spec-hub-viewer-and-detached-window --yes --skip-specs 成功
- 本次为 OpenSpec 文档收口，未新增业务代码测试执行

后续事项:
- 当前工作树仍存在与 note-card / composer / backend 等无关本次归档的改动，保持未提交状态。
- 若后续需要对 Spec Hub 主 specs 再做 wording 微调，应直接修改主 `openspec/specs/**`，不再回写已归档 change。


### Git Commits

| Hash | Message |
|------|---------|
| `c2ca9e04` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 243: 工作区便签池与上下文引用交付

**Date**: 2026-04-30
**Task**: 工作区便签池与上下文引用交付
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

任务目标
- 在客户端内新增轻量便签能力，支持按项目存储、快速录入、查询、归档、图片插入、Markdown 编辑，以及在对话框中通过 @# 引用。

主要改动
- 新增右侧便签池 / 便签归档入口与面板，支持快速创建、编辑、归档、物理删除、图片插入和本地存储说明。
- 新增 Tauri note_cards 存储与查询链路，按 `.ccgui/note_card/<project>/active|archive` 落盘，并补齐图片附件物化、正文搜索、路径归一化与损坏文件容错。
- 打通 composer `@#` 自动完成、发送时上下文注入，以及幕布上的独立便签上下文卡片展示；卡片默认半折叠，图片缩略图点击可查看大图。
- 修复幕布去重和图片重复回显边界，避免同轮 legacy user suffix 与 assistant summary 双份展示，也避免 `asset://localhost` / `file://localhost` / Windows 路径形态导致的重复图片。
- 同步 OpenSpec 规格、归档 change、更新 CHANGELOG，并把相关测试从超大文件中拆出以满足大文件门禁。

涉及模块
- frontend: `src/features/note-cards/**`、`src/features/composer/**`、`src/features/messages/**`、`src/components/common/**`
- backend: `src-tauri/src/note_cards.rs`、`src-tauri/src/command_registry.rs`、`src-tauri/src/app_paths.rs`、相关 Tauri bridge 与类型定义
- specs/tasks: `openspec/specs/**`、`openspec/changes/archive/**`、`.trellis/tasks/**`

验证结果
- `cargo test --manifest-path src-tauri/Cargo.toml note_cards` 通过
- `npx vitest run src/features/messages/components/Messages.note-card-context.test.tsx src/features/messages/components/Messages.test.tsx src/features/messages/components/LocalImage.test.tsx` 通过
- 便签相关扩展 Vitest 回归集通过
- `npx eslint src/features/messages/components/MessagesRows.tsx src/features/messages/components/Messages.note-card-context.test.tsx` 通过
- `npm run typecheck` 通过
- `npm run check:large-files` 通过
- `npm run check:large-files:near-threshold` 通过（仅保留仓库现有 watch 项）
- `npm run check:heavy-test-noise` 全量通过，396 个测试文件完成
- `openspec validate composer-note-card-reference` 通过

后续事项
- 如需继续优化，可进一步把 `MessagesRows.tsx` 中的便签上下文卡片渲染抽出为独立组件，继续降低消息渲染文件体积。


### Git Commits

| Hash | Message |
|------|---------|
| `c277c8a3` | (see git log) |
| `b1434bce` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 244: 完善工作区便签引用与跨平台附件兼容

**Date**: 2026-04-30
**Task**: 完善工作区便签引用与跨平台附件兼容
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

## 任务目标
收尾工作区便签功能，补齐 @# 引用预览、幕布上下文卡片、右侧面板折叠交互，以及本地图片附件在跨平台场景下的保存与回显稳定性。

## 主要改动
- 右侧便签面板默认折叠快速记录/编辑区，仅在新建或选中便签时展开；补充 `@#` 可引用便签提示文案，并调整操作区布局以压缩垂直占用。
- Composer `@#` 自动补全补齐便签内容预览和缩略图展示；消息幕布中的便签上下文改为独立卡片，默认半折叠，图片使用缩略图并支持查看大图。
- 后端 `note_cards` 补齐 summary `body_markdown` 字段，并修复本地附件 URI 归一化逻辑，兼容 `file://`、`asset://localhost`、percent-encoded UTF-8 路径、Windows drive letter 与 UNC 路径。
- 前端同步统一图片路径 normalize 和 workspace 切换状态清理，避免旧 workspace 便签残留和缩略图重复去重失效。

## 涉及模块
- `src/features/note-cards/**`
- `src/features/composer/**`
- `src/features/messages/**`
- `src/services/tauri/noteCards.ts`
- `src-tauri/src/note_cards.rs`
- `src/i18n/locales/**`
- `src/styles/**`

## 验证结果
- `npm run typecheck`
- `npx vitest run src/features/messages/components/Messages.note-card-context.test.tsx src/features/note-cards/components/WorkspaceNoteCardPanel.test.tsx src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.test.tsx src/features/composer/hooks/useComposerAutocompleteState.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml note_cards`
- `npm run check:runtime-contracts`
- `npm run check:large-files:near-threshold`

## 后续事项
- 若后续继续扩展便签卡片展示，优先沿用当前独立卡片和缩略图折叠模式，避免重新混入普通消息气泡。
- `check:large-files:near-threshold` 仍报告仓库既有 watchlist 文件，但本次提交未触发 fail gate。


### Git Commits

| Hash | Message |
|------|---------|
| `8257af6a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 245: 修复便签引用幕布实时与历史重复展示

**Date**: 2026-05-01
**Task**: 修复便签引用幕布实时与历史重复展示
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

任务目标:
- 修复便签引用在幕布中的首轮实时发送、历史回显与跨来源 history fallback 对齐问题，避免重复卡片、重复图片和历史序列误判。

主要改动:
- 在 threads assembly 层统一 note-card 上下文与附件图片的 comparable normalization。
- 调整消息幕布的 note-card summary 抑制逻辑，使 optimistic user bubble、queued handoff bubble 与真实 user message 的等价判定一致。
- 修复 summary card 被抑制时仍需保留 note-card image path 集用于过滤用户气泡重复图片。
- 修复 Codex history loader 在 runtime thread 与 local fallback history 图片 URI 形态不同的情况下的等价判断。
- 补充实时态、历史态、边界条件回归测试。

涉及模块:
- src/features/messages/components
- src/features/threads/assembly
- src/features/threads/hooks
- src/features/threads/loaders

验证结果:
- pnpm vitest run src/features/messages/components/Messages.note-card-context.test.tsx src/features/threads/assembly/conversationNormalization.test.ts src/features/threads/hooks/useThreadMessaging.context-injection.test.tsx src/features/threads/hooks/useThreadsReducer.normalized-realtime.test.ts src/features/threads/hooks/useThreadMessaging.test.tsx src/features/threads/utils/queuedHandoffBubble.test.ts src/features/threads/contracts/conversationAssembler.test.ts
- pnpm vitest run src/features/threads/assembly/conversationNormalization.test.ts src/features/threads/loaders/historyLoaders.test.ts src/features/messages/components/Messages.note-card-context.test.tsx src/features/threads/hooks/useThreadsReducer.normalized-realtime.test.ts
- npm run typecheck
- npm run check:large-files
- eslint src/features/threads/assembly/conversationNormalization.ts src/features/threads/assembly/conversationNormalization.test.ts src/features/threads/loaders/historyLoaders.test.ts

后续事项:
- 继续关注 Claude / Gemini 与 Codex 在 note-card 注入前置链路上的差异，必要时补跨引擎 parity 用例。


### Git Commits

| Hash | Message |
|------|---------|
| `178accb3f751f061ca50d6adca7f0765646c4b0b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 246: 修复便签池空态布局

**Date**: 2026-05-01
**Task**: 修复便签池空态布局
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

## 任务目标
- 修复便签池在无活跃便签时的空态展示异常，避免空提示缩在左上角形成残缺卡片视觉。

## 主要改动
- 在 `WorkspaceNoteCardPanel` 中为列表空态派生 `isListEmpty`，空列表时给列表容器追加 `is-empty` 状态类。
- 在 `src/styles/note-cards.css` 中为 `.workspace-note-cards-list.is-empty` 增加居中布局、宽度约束和最小高度，使空态卡片在列表区域中稳定居中展示。
- 补充 `WorkspaceNoteCardPanel.test.tsx`，覆盖空列表时容器状态 class 的切换行为，防止后续样式回退。

## 涉及模块
- `src/features/note-cards/components/WorkspaceNoteCardPanel.tsx`
- `src/features/note-cards/components/WorkspaceNoteCardPanel.test.tsx`
- `src/styles/note-cards.css`

## 验证结果
- `npm exec vitest run src/features/note-cards/components/WorkspaceNoteCardPanel.test.tsx` 通过
- `npm run typecheck -- --pretty false` 通过
- `npm exec eslint src/features/note-cards/components/WorkspaceNoteCardPanel.tsx src/features/note-cards/components/WorkspaceNoteCardPanel.test.tsx` 通过
- 说明：`eslint` 不处理纯 CSS 文件，未对 `src/styles/note-cards.css` 单独执行 ESLint。

## 后续事项
- 建议本地再肉眼确认一次空态视觉密度；如果仍显得偏厚，可继续微调空态卡片高度和背景对比度。


### Git Commits

| Hash | Message |
|------|---------|
| `c60e6d1b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 247: 补充修复 PR#480 composer 线程作用域回归

**Date**: 2026-05-01
**Task**: 补充修复 PR#480 composer 线程作用域回归
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

## 任务目标
补充修复合入 PR #480 后遗留的 composer 线程作用域回归、初始化崩溃与状态环路问题，并清理相关 hook 告警。

## 主要改动
- 恢复无活动线程时的 composer 默认值持久化，并允许将全局默认值从旧值正确清空为 null。
- 为 Codex 线程作用域模型与 effort 增加更稳定的有效值派生逻辑，避免线程侧 null effort 与 useModels 默认值补全互相打架导致无限更新。
- 修复 AppShell 提前读取 activeThreadId 触发的 TDZ 初始化崩溃。
- 为 useModels 增加 workspace 级 stale response guard，防止快速切换 workspace 时旧请求结果回写当前状态。
- 抽取 context compaction in-flight helper，清理 react-hooks/exhaustive-deps 告警。

## 涉及模块
- src/app-shell.tsx
- src/app-shell-parts/modelSelection.ts
- src/app-shell-parts/useSelectedComposerSession.ts
- src/features/app/hooks/usePersistComposerSettings.ts
- src/features/models/hooks/useModels.ts
- src/features/threads/hooks/useThreadTurnEvents.ts

## 验证结果
- npm exec vitest run src/app-shell-parts/modelSelection.test.ts src/app-shell-parts/useSelectedComposerSession.test.tsx src/features/models/hooks/useModels.test.tsx src/features/app/hooks/usePersistComposerSettings.test.tsx
- node --test scripts/check-large-files.test.mjs scripts/check-heavy-test-noise.test.mjs
- npm run lint
- npm run typecheck

## 后续事项
- 建议继续在本地手工回归 Codex 线程 A/B 切换、pending 线程转正式线程、以及全局默认值清空后的重启恢复路径。


### Git Commits

| Hash | Message |
|------|---------|
| `33082cea` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 248: 补充 PR#480 启动恢复与线程作用域持久化修复

**Date**: 2026-05-01
**Task**: 补充 PR#480 启动恢复与线程作用域持久化修复
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

任务目标:
- 为 PR#480 相关 composer 线程作用域修复补充更接近真实启动链路的 AppShell 级回归保护。
- 修正启动首帧线程作用域尚未同步时，可能误触发全局 composer 默认值持久化的问题。

主要改动:
- 在 src/app-shell.tsx 中新增 composer selection scope 同步门闩，仅在作用域键与当前 activeWorkspaceId/activeThreadId 对齐后才允许 usePersistComposerSettings 持久化全局 composer 设置。
- 调整 codex 线程场景下 model 与 reasoning effort 的选择写回逻辑，避免线程内切换继续回写全局 useModels 选择态。
- 在 src/app-shell-parts/modelSelection.ts 中补充 getReasoningOptionsForModel，统一从 supportedReasoningEfforts / defaultReasoningEffort 派生 reasoning 选项。
- 在 src/app-shell-parts/modelSelection.test.ts 中补充 reasoning options 推导边界测试。
- 新增 src/app-shell.startup.test.tsx，最小挂载真实 AppShell，覆盖“已有活动 codex 线程恢复线程级 composer 选择”和“无线程回退全局默认值”两条启动路径，并验证不出现 Maximum update depth exceeded。

涉及模块:
- src/app-shell.tsx
- src/app-shell.startup.test.tsx
- src/app-shell-parts/modelSelection.ts
- src/app-shell-parts/modelSelection.test.ts

验证结果:
- npm exec vitest run src/app-shell.startup.test.tsx
- npm exec vitest run src/app-shell.startup.test.tsx src/app-shell-parts/modelSelection.test.ts src/app-shell-parts/useSelectedComposerSession.test.tsx src/features/models/hooks/useModels.test.tsx src/features/app/hooks/usePersistComposerSettings.test.tsx
- npm run lint
- npm run typecheck
以上命令均已通过。

后续事项:
- 建议继续结合人工启动验证，重点确认已有 codex 线程打开时 model/effort 恢复正确，且退回无线程场景后全局默认值不会被意外清空。


### Git Commits

| Hash | Message |
|------|---------|
| `2fc04893` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 249: 补充记录 composer 线程选择链路结构性重构提交

**Date**: 2026-05-01
**Task**: 补充记录 composer 线程选择链路结构性重构提交
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

任务目标：
- 提交当前工作区全部 composer 线程作用域修复与回归测试改动，不在本轮继续追加新修复。

主要改动：
- 重构 AppShell、useThreads、useThreadMessaging、useThreadMessagingSessionTooling 之间的 composer selection 数据流，改为发送时解析当前 selection，降低启动恢复阶段的状态回写环风险。
- 收敛 useModels 的职责，移除线程作用域切换相关状态所有权，补充 globalSelectionReady 以保护冷启动全局 composer 默认值持久化。
- 强化 modelSelection 与 usePersistComposerSettings 的边界处理，过滤线程态无效 modelId 和 unsupported reasoning effort，避免冷启动误清空全局默认值。
- 补充 AppShell 启动回归测试、selection 纯函数测试和持久化测试，覆盖已有线程、无活动线程、pending 转 canonical 线程等路径。

涉及模块：
- src/app-shell.tsx
- src/app-shell-parts/modelSelection.ts
- src/app-shell.startup.test.tsx
- src/features/models/hooks/useModels.ts
- src/features/app/hooks/usePersistComposerSettings.ts
- src/features/threads/hooks/useThreads.ts
- src/features/threads/hooks/useThreadMessaging.ts
- src/features/threads/hooks/useThreadMessagingSessionTooling.ts
- 相关测试文件

验证结果：
- npm exec vitest run src/app-shell.startup.test.tsx src/features/models/hooks/useModels.test.tsx src/app-shell-parts/modelSelection.test.ts src/features/app/hooks/usePersistComposerSettings.test.tsx src/app-shell-parts/useSelectedComposerSession.test.tsx 通过。
- npm run lint 通过。
- npm run typecheck 通过。
- npm run check:large-files 通过。
- npm run check:heavy-test-noise 通过。
- 本地 tauri dev 启动链检查通过，未复现同类启动即崩。

后续事项：
- 继续跟进尚未完全排除的 composer 启动边界风险，按后续 review 结果补修剩余问题。
- 单独处理 doctor:strict 暴露的 branding 遗留问题，避免与本次 composer 修复耦合。


### Git Commits

| Hash | Message |
|------|---------|
| `28eaec3f062c7e4358e5372960f542fd5ffa3715` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 250: 补充修复 PR#480 启动恢复时序与线程选择自愈问题

**Date**: 2026-05-01
**Task**: 补充修复 PR#480 启动恢复时序与线程选择自愈问题
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

本次任务目标：
- 继续收口 PR#480 线程级 composer model/effort 改造后的启动不稳定问题。
- 重点处理冷启动、线程级选择恢复、pending 线程转 canonical 线程时的错误自愈与默认值误写回。

主要改动：
- 调整 `src/features/models/hooks/useModels.ts`，将模型列表从异步 state 二段派生改为同步 `useMemo` 派生，消除 `modelsReady` 已完成但 `models` 仍落后一帧的窗口。
- 调整 `src/app-shell.tsx`：
  - 新增全局 composer 默认值的有效值派生，持久化时统一使用校验后的 model/effort；
  - 线程级 Codex 选择仅在 `modelsReady` 后执行自愈；
  - 线程内切换 model/effort 时同步写入修正后的有效选择，阻断脏值继续进入发送链。
- 调整 `src/app-shell-parts/modelSelection.ts`，无效 reasoning effort 统一回退到当前模型默认/首个有效 effort，而不是直接置空。
- 扩充启动回归测试与持久化测试，覆盖线程恢复、冷启动全局默认值恢复、pending->canonical 稳定性以及无效线程选择自愈。

涉及模块：
- `src/app-shell.tsx`
- `src/features/models/hooks/useModels.ts`
- `src/app-shell-parts/modelSelection.ts`
- `src/app-shell.startup.test.tsx`
- `src/app-shell-parts/modelSelection.test.ts`
- `src/features/app/hooks/usePersistComposerSettings.test.tsx`

验证结果：
- `npm exec vitest run src/app-shell.startup.test.tsx src/app-shell-parts/modelSelection.test.ts src/features/app/hooks/usePersistComposerSettings.test.tsx src/features/models/hooks/useModels.test.tsx src/app-shell-parts/useSelectedComposerSession.test.tsx` 通过（36/36）。
- `npm run lint` 通过。
- `npm run typecheck` 通过。
- `npm run check:large-files` 通过。
- `npm run check:runtime-contracts` 通过。
- `npm run check:heavy-test-noise` 完整通过，402 个测试文件完成，summary 仅保留 1 条 environment warning、0 act warnings。

后续事项：
- 当前本地手测反馈已无启动崩溃，可在此基线后继续单独处理 `doctor:strict` / branding 遗留。
- 若后续继续降噪，应以“纯降复杂度”为目标拆分 AppShell，避免再次混入行为修复。


### Git Commits

| Hash | Message |
|------|---------|
| `76632c22` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 251: OpenSpec 回写 Codex composer 启动稳定性提案

**Date**: 2026-05-01
**Task**: OpenSpec 回写 Codex composer 启动稳定性提案
**Branch**: `feature/fix-0.4.12`

### Summary

(Add summary)

### Main Changes

任务目标：
- 为 PR#480 后续修复补齐 OpenSpec 提案记录，沉淀 Codex composer 线程作用域启动恢复稳定性 contract。

主要改动：
- 新增 openspec change：fix-codex-composer-startup-selection-stability。
- 补充 proposal，记录问题背景、目标、边界、非目标与影响范围。
- 补充 design，明确 modelsReady、线程 selection 自愈时机、pending -> canonical 稳定性与全局默认值持久化约束。
- 补充 capability spec 与 tasks，将 branding 遗留保留为独立后续事项。

涉及模块：
- openspec/changes/fix-codex-composer-startup-selection-stability/proposal.md
- openspec/changes/fix-codex-composer-startup-selection-stability/design.md
- openspec/changes/fix-codex-composer-startup-selection-stability/specs/codex-composer-startup-selection-stability/spec.md
- openspec/changes/fix-codex-composer-startup-selection-stability/tasks.md

验证结果：
- openspec validate fix-codex-composer-startup-selection-stability --strict 通过。

后续事项：
- 单独提交并修复 doctor:strict 暴露的 branding 遗留。
- branding 提交完成后，再执行整仓 doctor 与相关回归测试。


### Git Commits

| Hash | Message |
|------|---------|
| `141fd1b4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
