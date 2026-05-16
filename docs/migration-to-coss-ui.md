# Migration to coss.ui — Roadmap

> 关联 Trellis task：`.trellis/tasks/05-16-migrate-css-to-coss-ui/prd.md`
> Status：Phase 0 in progress（2026-05-16 启动）

本文档是 coss.ui 全量迁移的路线图与 follow-up 清单。Trellis task 内的 PRD 是 single source of truth；本文件偏向"工程师可读"的速查与遗留事项追踪。

---

## 背景

- 项目 fork 自 https://github.com/Dimillian/CodexMonitor，在原仓库基础上 commit 1000+ 次，未做彻底 CSS 架构治理，导致 `src/styles/` 下 **93 个 .css 文件**（含按 part 切分的大文件）。
- 视觉一致性差，旧 CSS 与 Tailwind 已经混跑（`src/components/ui/` 下 24 个 shadcn/Radix 组件已经在用 Tailwind utility class）。
- 决策（2026-05-16）：**clean-slate** 用 coss.ui 重塑 CSS 架构 + 替换基础组件，不保留旧 CSS。

## 决策快照

| 决策 | 选择 |
|---|---|
| 旧 CSS 处置 | 彻底删除（clean-slate） |
| 重构边界 | 样式 + 基础组件；不动 feature 布局 / 信息架构 |
| 视觉目标 | coss 默认 design language，无 brand override |
| 节奏 | 阶段性 PR（每 phase 一个 PR） |
| Branch | 直接在 `chore/bump-version-0.5` 上做 |
| coss skill | 已安装到 `.agents/skills/coss/`（53 primitive 全覆盖） |

## Phase 总览

| Phase | 范围 | 关键产物 | 状态 |
|---|---|---|---|
| 0 | Preflight & Foundation | 本 README、`src/components/ui/README.md`、4 个 superseded task archive | ✅ done (2026-05-16, commit `48baf63d`) |
| 1 | coss Token 收尾 + globals.css 清理 | `--font-heading` 补齐、`globals.css` 167→60 行、抽 `proxy-status-badge.css`、`__coss-smoke__` 自测 | ✅ done (2026-05-16, 待 commit) |
| 2 | Global Chrome | tabbar / panel-lock / panel-tabs / search-palette / compact-* / debug（sidebar 推迟到后续 phase 与业务一起处理） | ✅ done (2026-05-16, 待 commit) |
| 3 | Threads + Messages（含 sticky header carry-forward） | scope-shrunk → 仅 `prompts.css` + `messages.streaming.css` 删除；sticky header 与 message bodies 推迟到 3.5 / 3.6 | ✅ done (2026-05-16, 待 commit) |
| 4 | Composer & Interaction Dialogs | scope-shrunk → 6 dialog/toast 文件已删（ask-user-question / approval-toasts / loading-progress / request-user-input / error-toasts / update-toasts），composer.* 推迟到 Phase 4.5；bonus 修复 input.tsx baseline | ✅ done (2026-05-16, 待 commit) |
| 5 | Home & Workspace | scope-shrunk → 4 文件已删（home / release-notes / note-cards / workspace-home）；2 keeper 抽出（release-notes-markdown / note-cards-rich-input）；taskCenterClasses helper 抽出；home-chat 推迟到 5.5（6 个 CSS-literal pin），kanban 推迟到 5.6（2071 行 + 14 consumer，需切 3 个 sub-PR） | ✅ done (2026-05-16, 待 commit) |
| 6 | Settings | scope-shrunk → 仅 `settings.skills.css`（478 行）已删（单 consumer `SkillsSection.tsx` 1289/40）；7 个文件全部 defer（part1 frame 推迟到 6.7、vendor cluster 4 文件推迟到 6.5、part2 + basic-redesign + part3 推迟到 6.6） | ✅ done (2026-05-16, 待 commit) |
| 7 | Git History | scope-shrunk → 仅 `git-history.part1-shell.css`（126 行）已删；keeper `git-history-shell-keepers.css`（49 行）保留 9 个 `--git-filetree-*` 与 `body[data-git-history-resizing]` cascade；DesktopLayout/GitHistoryPanelView Tailwind inline；git-history runtime contract + static imports 验证通过；剩余 part1/part1.overview/part2/branch-compare/pr-dialog 推 7.5/7.6/7.7 | ✅ done (2026-05-16, 待 commit) |
| 8 | Spec Hub | **discovery + defer only**：`SpecHubPresentationalImpl.tsx` 是 113KB / `@ts-nocheck` / 单行 minified bundle，所有 225+ `spec-hub-*` className 在其中，无法 inline；Phase 8 仅产 plan doc；推 Phase 8.5（de-minify）+ Phase 8.6（inline Tailwind） | ✅ done (2026-05-16, 待 commit) |
| 9 | File / Diff / Terminal | scope-shrunk → 仅 `detached-file-explorer.css` 处理（236 行 → 21 行 in-place keeper，bootstrap 不动）；diff/diff-viewer/file-tree/file-view-panel/terminal/opencode 推 9.1-9.5（4 个 tsx consumer > 1000 行，diff-viewer 字面值 pin，terminal cascade 与 main grid contract） | ✅ done (2026-05-16, 待 commit) |
| 10 | Cleanup & Final Verify | 删剩余旧 CSS、跑所有 gate、人工 verify、follow-up 入库 | ☐ |

> 每个 phase = 1 个 PR；DoD 详见 PRD。

## Archived Superseded Tasks

| Task | 处置 | 原因 |
|---|---|---|
| `04-22-align-live-sticky-with-history-header` | archive + needs carry-forward to Phase 3 | 含 render contract 行为需求（sticky header 视觉 + 接棒规则），不只是 CSS |
| `04-23-split-composer-rewind-modal-styles` | archive | 纯 CSS 切分，旧 CSS 即将整体删除 |
| `04-23-split-git-history-branch-compare-styles` | archive | 同上 |
| `04-23-split-settings-css-panel-sections` | archive | 同上 |

archive 位置：`.trellis/tasks/archive/2026-05/`。

## Follow-up（迁移完成后再做）

> 本次 phase 内**不做**这些；落进队列，避免 scope creep。

### 视觉与设计
- [ ] 引入 brand color override layer（如果产品需要品牌色，先 design exploration）。
- [ ] feature 页面级布局重做 / 信息架构调整（threads 列表、git history、spec hub 等）。
- [ ] 动效与微交互重设计（按 coss motion 约定）。
- [ ] 暗色模式 token 精细化（超出 coss 默认 token 的部分）。

### 组件与契约
- [ ] 评估 `src/features/<feature>/components/` 下与 `src/components/ui/` 重复的组件，做去重 / 提升。
- [ ] 评估是否引入 coss `Form` + Zod 重写 settings / composer 表单（本次只换基础原语，不重写表单整体）。
- [ ] 评估是否引入 coss `Command` 重写 search-palette（本次 Phase 2 只换皮）。
- [ ] **Phase 4**：评估是否引入 coss `Dialog` 替换 LockScreenOverlay 自实现的 overlay 结构（Phase 2 只完成纯样式换皮，结构沿用旧 div 树）。
- [ ] **Phase 3+**：sidebar.css / sidebar.chrome.css / sidebar-shell.css 内的 chrome 部分（topbar placeholder、search toggle、primary nav 等）随 Threads/Workspace 业务拆解一起迁移。两个 CSS 字面值测试（`layout-swapped-platform-guard.test.ts` 与 `sidebar-titlebar-drag-region.test.ts`）届时需要按拆解结果改造或归档。
- [ ] **Phase 3.5 — sticky header coss 化**：先把 `layout-swapped-platform-guard.test.ts` 中针对 `messages-history-sticky-*` 的 7 条字面 CSS 文本断言（peek-width / peek border-radius / collapsed bubble width / wide-canvas margin-right 等，lines 143-186）改为行为断言（jsdom render `MessagesTimeline` 后断言 className 或 data-* 状态），随后即可把 `messages.history-sticky.css` 整体替换为 `MessagesTimeline.tsx` 内联 Tailwind。
- [ ] **Phase 3.6 — message bodies coss 化**：先把 `layout-swapped-platform-guard.test.ts` 中针对 `.messages-shell.claude-render-safe` 与 `.messages-live-controls` 的字面文本断言（lines 135-201）改造，再分批拆解 `messages.part1.css` (2301 行) / `messages.part1-shell.css` / `messages.status-shell.css` / `messages.part2.css`。预计 2-3 个 sub-PR。
- [ ] **Phase 4 — PromptEnhancerDialog as `Dialog`**：当前 `PromptEnhancerDialog` 用裸 `<div className="prompt-enhancer-overlay">`，对应样式仍住在 `composer/components/ChatInputBox/styles/enhance-prompt.css`。Phase 4 用 coss `Dialog` 把 overlay + portal + focus trap 换成原语，同时把 `enhance-prompt.css` 内 `.prompt-section` / `.prompt-section-header` 的样式与 `PromptPanel` 对齐（Phase 3 用 `justify-between` Tailwind 兜底了 PromptEnhancerDialog 的视觉，未来若设计选择 left-align 可直接去掉）。
- [ ] **Phase 4.5 — composer coss 化**：dedicated phase 处理 `composer.part1.css`（1749 行）、`composer.part2.css`（2247 行）、`composer.memory-picker.css`（247 行，被 `composer.part2.css:1` 链式 import）、`composer.rewind-modal.css`（1233 行）、`composer.css`（entry）。计划拆 4 个 sub-PR：4.5a part1（input area + footer + actions）/ 4.5b part2（context ledger + meta + collapsed pill set）/ 4.5c memory-picker（chained sub）/ 4.5d rewind-modal（large standalone modal）。
- [ ] **Phase 4 follow-up — Dialog primitive 结构性替换**：`npx shadcn@latest add @coss/dialog` 安装后，把 `LoadingProgressDialog`、`AskUserQuestionDialog` 从裸 `<div role="dialog">` 重写为 `<Dialog open><DialogPopup>...</DialogPopup></Dialog>`。需重新验证 focus trap、ESC 行为、portal mount 与现有 `getByRole("dialog", { name })` 测试断言的兼容性。AskUserQuestionDialog 还有 composer-overlay mode（`pointer-events: none` + `align-items: flex-end`）+ 多 step navigation + collapse-to-hint 等富行为，需要 Dialog 之外的自定义壳层（或保持当前结构 + 仅作 styling 提升）。
- [ ] **Phase 4 follow-up — Toast primitive 结构性替换**：`npx shadcn@latest add @coss/toast` 安装后在 app shell 设置 `ToastProvider` + `AnchoredToastProvider`，把 `ErrorToasts`、`UpdateToast`、`ApprovalToasts` 从声明式 `<XToasts toasts={...} />` 重写为命令式 `toastManager.add({...})` 调用点。涉及状态管理重构（从组件本地 props → 全局 toast manager），属于行为契约变更，需要 Phase 4 现有测试套全部迁移到 toastManager 集成测试。
- [ ] **Phase 4 follow-up — RadioGroup / CheckboxGroup / Field 引入**：`AskUserQuestionDialog` 与 `RequestUserInputMessage` 当前手动实现 radio/checkbox semantics（自画 `.ask-user-question-option-radio::after` 圆点、自管 `is-selected` className、自管键盘 navigation 与 a11y label）。coss `RadioGroup` / `CheckboxGroup` / `Field` 提供开箱 a11y + 键盘导航 + state 管理。改造时需保留现有 `is-selected` classList 断言（10+ 个测试已 pin）— 可在 onChange 上挂 className 同步桥接，或同步更新测试。
- [ ] **Phase 5.5 — home-chat coss 化**：dedicated phase 处理 `home-chat.css`（946 行）。先把 `HomeChat.styles.test.ts` 中 6 条 `.toContain` CSS-literal 断言（grayscale rule / codex context accents / workspace popup `data-slot="popover-content"` / picker search-add `grid-template-columns` / selection states 字面 `background: #f7f5f2;` 等 / trigger `line-height: 1.2;`）改造为行为断言（jsdom render 后断言 computed style 或 className contract），随后即可把 `home-chat.css` 整体内联到 `HomeChat.tsx`（276 行）+ `ChatInputBoxFooter.tsx`（1021 行，属 composer cluster）。建议与 Phase 4.5 composer 同步推进——`ChatInputBoxFooter.tsx` 的 `home-chat-*` cascade 与 composer footer 共享设计语言。
- [ ] **Phase 5.6 — kanban coss 化**：dedicated phase 处理 `kanban.css`（2071 行）。无 CSS-literal pin（querySelector only），但 14 个 tsx consumer（5355 行）+ 240+ className 引用，规模超过 composer cluster，单 PR 不可行。推荐切 3 个 sub-PR：
  - 5.6a — Mode toggle + fullscreen layout + projects grid + project card（`KanbanModeToggle`, `ProjectList`, `ProjectCard`, `app.kanban-active` layout selectors）
  - 5.6b — Board + columns + cards + drag-drop（`KanbanBoard`, `KanbanBoardHeader`, `KanbanColumn`, `KanbanCard`，重点验证 drag/drop hover/active 视觉状态）
  - 5.6c — Panels list + task create modal + remaining detail blocks（`PanelList`, `PanelCard`, `TaskCreateModal`）
- [ ] **Phase 5 follow-up — Dialog primitive 替换 ReleaseNotesModal**：当前 `ReleaseNotesModal.tsx` 用 `<div role="dialog" aria-modal="true">` + 自实现 backdrop button + 自管 ESC keydown 监听。Dialog 装好后改用 `<Dialog open><DialogPopup>...</DialogPopup></Dialog>`，并验证 ArrowLeft/ArrowRight pagination keybind 与 ESC close 的兼容。
- [ ] **Phase 5 follow-up — Tabs primitive 替换 note-cards collection switch**：`.workspace-note-cards-collection-switch` 当前是 2-button pill toggle + 手写 `role="tablist"`。换成 coss `Tabs` 时 list filter 不能用 `<TabsContent>` 包裹（因为列表过滤逻辑根据 `collection` 状态对同一列表过滤，不是切换 Tab 内容），需要保留 `<TabsList><TabsTrigger>` + 在外部用 `onValueChange` 驱动 state。
- [ ] **Phase 5 follow-up — Card primitive 替换 spec-provider/guide cards + note-cards items + release-notes modal**：多处自定义卡片（`workspace-home-spec-provider-card`、`workspace-home-guide-card`、`workspace-note-cards-card`、`workspace-note-cards-preview-card`、`release-notes-modal-card`）都符合 coss `Card` 的语义；统一替换可消除大量 inline Tailwind 重复。
- [ ] **Phase 5 follow-up — Button primitive 替换 Home.tsx primary**：trivial swap，把 `<button className="home-primary-button">` 换为 `<Button variant="outline" size="lg">`。
- [ ] **Phase 5 follow-up — WorkspaceHomeSpecModule 死代码清理**：`src/features/workspaces/components/WorkspaceHomeSpecModule.tsx`（160 行）使用 `workspace-home-panel` / `workspace-home-spec-module` / `workspace-home-section-header` / `workspace-home-spec-provider-*` / `workspace-home-guide-*` 等 class names，但这些 class 在任何 `.css` 中都无定义（dead CSS），且组件本身在仓库中**无任何 consumer**（`rg WorkspaceHomeSpecModule` 仅命中文件本身）。属于 dead code。建议在 Phase 10 cleanup 时整体删除或在 Phase 5.5/5.6 顺便处理。
- [ ] **Phase 6.5 — settings vendor cluster coss 化**：dedicated phase 处理 4 个 vendor settings CSS 文件（共 1662 行 CSS / 11 个 tsx consumer 共 2832 行）：
  - `settings.vendor-codex-runtime.css`（83 行 / 13 selector）
  - `settings.vendor-dialog.css`（386 行 / 52 selector，**Dialog primitive 候选**)
  - `settings.part1.vendor-panels.css`（863 行 / 124 selector）
  - `settings.part2.vendor-models.css`（330 行 / 48 selector）
  - **关键 contract 约束**：必须严格遵守 `.trellis/spec/guides/codex-unified-exec-override-contract.md` 的 vendor settings UI 约束（4 个 action buttons / no tri-state selector / payload type signatures / no-session reload 文案中性）。推荐拆 3 个 sub-PR：6.5a vendor-dialog（cluster 入口；vendor-codex-runtime 合并）/ 6.5b vendor-panels（VendorSettingsPanel 747 + ProviderList / CodexProviderList / CurrentClaudeConfigCard / CurrentCodexGlobalConfigCard）/ 6.5c vendor-models（GeminiVendorPanel + CustomModelDialog + ProviderDialog model grid + DeleteConfirmDialog）。
- [ ] **Phase 6.6 — settings part2 + basic-redesign + part3 coss 化**：dedicated phase 处理 3 个文件（共 3442 行 CSS）：
  - `settings.part2.css`（2154 行 / 315 selector）— **字面值 pin × 5** in `src/styles/settings-email-card-surface.test.ts`（`.settings-email-card` `background/border`、`::before` `box-shadow: none`、`.settings-card-switch-header` `grid-template-columns`、`.settings-basic-sounds-card-content` `display: flex`、negative `not.toMatch`）。必须先把 email-card cascade 内联到 `EmailSenderSettings.tsx` 然后改造 pin test 为行为断言或 className 断言。
  - `settings.part2.basic-redesign.css`（1044 行 / 156 selector）— cross-section cascade 通过 `--settings-basic-*` CSS vars 影响 13+ section consumer（BasicAppearance / BasicBehavior / Codex / Composer / Dictation / Email / Mcp / OpenApps / Other / Projects / Runtime / Session / Shortcuts / WebService）。建议先把 `--settings-basic-*` 自定义变量提升到 `themes.light.css` / `themes.dark.css` 与 coss token 并存，再分批迁 section。
  - `settings.part3.css`（244 行 / 44 selector）— theme cascade `:root[data-theme="light"]` + media query。建议作为 keeper 文件保留（同 Phase 5 `release-notes-markdown.css` 模式），但需配合 6.6 整体迁移。
- [ ] **Phase 6.7 — settings frame coss 化**：dedicated phase 处理 `settings.part1.css`（2158 行 / 311 selector），覆盖 `SettingsView.tsx`（2231 行）的 shell / sidebar / nav / header / body 骨架。
  - **关键 contract 约束**：必须严格遵守 `.trellis/spec/guides/terminal-shell-configuration.md` 的 `terminalShellPath` placeholder text 不能被 CSS truncate（placeholder examples 是 guidance only, not persisted），保持 trimming + fallback 行为不变。
  - 建议先把 SettingsView 拆分（settings/components/settings-view/sections/ 下 23 个 section 已经拆好，frame 部分还在 2231 行的 SettingsView.tsx 顶层），把 `.settings-header` / `.settings-sidebar` / `.settings-nav` / `.settings-content` 等 frame chrome 抽到独立 component，避免单 PR 内大 diff。
- [ ] **Phase 6 follow-up — Splitter / Tree primitive 引入**：`SkillsSection.tsx` 的 `.settings-skills-splitter`（自管 pointer drag + collapse threshold + width state）与 `.settings-skills-tree-node`（自管 expand/collapse + active highlight + keyboard a11y）目前是 hand-rolled。coss 暂无现成 Splitter / Tree primitive，需评估是否引入第三方（`react-resizable-panels` for splitter、`@radix-ui/react-accordion` for tree）或保留 hand-rolled。本次 Phase 6 完成纯 styling pass，保留行为。

### 工程
- [ ] 删除 `@radix-ui/*` 等 legacy 依赖（迁移完成后跑 `npx depcheck`）。
- [ ] 升级 `cn()` 实现：若 coss 期望 `@coss/ui/lib/utils` 的 cn()，统一替换。
- [ ] 大文件 baseline 重新校准（CSS 删完后基线大幅变化）。
- [ ] 写 `.trellis/spec/frontend/coss-component-guidelines.md` 沉淀 coss 使用规范（替代 / 补充 现 component-guidelines.md）。
- [ ] 把 coss skill 加入 onboarding 文档，新开发者知道在哪查 primitive。

### 文档
- [ ] 每 phase 完成后在 changelog 简要记录"用 coss 替换了哪些组件 / 删除了哪些 .css"。
- [ ] 项目 README 顶部加 design system 引用：coss.ui v4 + Tailwind v4 + Base UI。

### Phase 7 / 8 / 9 carry-over follow-up（2026-05-16 并行 worktree 批次）
- [ ] **Phase 7.5** — `git-history.part1.css`（1430 行）+ `git-history.part1.overview.css` 非 worktree 部分（~600 行）：主体 3 列 + chip/search/branch-row/commit-row/details + diff-modal + 2 个共享 keyframes
- [ ] **Phase 7.6** — `git-history.part1.overview.css` worktree 部分（~500 行）+ `GitHistoryWorktreePanel.tsx`（1391 行 / 80 className）
- [ ] **Phase 7.7** — `git-history.branch-compare.css`（226）+ `git-history.part2.pr-dialog.css`（810）+ `git-history.part2-support.css`（320）+ `git-history.part2.css`（1646）：3002 行 CSS / 263+ className 集中 Dialog 处理（可与 Dialog primitive swap 合并）
- [ ] **Phase 8.5** — De-minify `SpecHubPresentationalImpl.tsx`（113KB / `@ts-nocheck` / 单行 minified bundle）。两条路：git-history rollback（推荐）或 prettier 手工 decompose
- [ ] **Phase 8.6** — Phase 8.5 完成后，inline Tailwind 5 个 spec-hub CSS（3211 行 / ~560 selector），bootstrap CSS imports −2，目标剩 1 keeper（spec-hub-detached-shell-keepers.css，`.macos-desktop` cascade）
- [ ] **Phase 8.6.x** — `@keyframes spec-hub-spin` → `animate-spin`；5 个 @media → Tailwind `max-[Xpx]:` arbitrary
- [ ] **Phase 8 coss primitive swap** — `Tabs` / `Dialog` / `Card` / `Badge` 审计
- [ ] **Phase 9.1** — `file-tree.css`（1247 行 / 211 selector）+ FileTreePanel.tsx（2280 行）；建议拆 3 个 sub-PR
- [ ] **Phase 9.2** — `diff.css`（2110）+ `diff-viewer.css`（1376，含 layout-swapped 字面值 pin）+ GitDiffPanel.tsx（2661）+ GitDiffViewer.tsx（1317）；建议拆 5 个 sub-PR；需先重构字面值 pin 测试
- [ ] **Phase 9.3** — `file-view-panel.css`（2364）+ `file-view-panel-shell.css`（135，共享 `--fvp-*` token）+ FileViewPanel.tsx（1947 + 751）；建议拆 4 个 sub-PR
- [ ] **Phase 9.4** — `terminal.css`（193 行）：xterm DOM cascade keeper + `terminal-panel { grid-row: 5; grid-column: 1/-1 }` 跨文件契约
- [ ] **Phase 9.5** — `opencode-panel.css`（915 行 / 125 selector）+ OpenCodeControlPanel.tsx（1011 行）；遵守 codex-unified-exec-override-contract
- [ ] **Phase 9 follow-up** — `Button` primitive swap（detached-file-explorer-sidebar-expand 单 icon-only floating button，trivial）
- [ ] **Splitter primitive 整合** — detached file explorer / git-history compare / settings skills 三处共用 hand-rolled pointer drag，需要单一 primitive 统一

---

## 不变性 / 红线

迁移过程中**不可破坏**：

- `.trellis/spec/frontend/messages-streaming-render-contract.md`（stable snapshot + live row override）
- `.trellis/spec/frontend/computer-use-bridge.md`（computer use 状态面板与 bridge）
- `.trellis/spec/frontend/claude-context-usage-display.md`（Claude context usage view model）
- `.trellis/spec/guides/codex-unified-exec-override-contract.md`（settings/runtime/global-config 边界）
- `.trellis/spec/guides/terminal-shell-configuration.md`（terminal shell path override）
- `src/services/tauri.ts` 的 command payload contract

## 引用

- coss skill：`.agents/skills/coss/SKILL.md`
- coss component registry：`.agents/skills/coss/references/component-registry.md`
- coss migration rules：`.agents/skills/coss/references/rules/migration.md`
- coss particles（用法 demo）：`.agents/skills/coss-particles/SKILL.md`
- Trellis PRD：`.trellis/tasks/05-16-migrate-css-to-coss-ui/prd.md`
- 前端规范入口：`.trellis/spec/frontend/index.md`
