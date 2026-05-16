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
| 6 | Settings | settings.* / settings.vendor.* / settings.skills | ☐ |
| 7 | Git History | git-history.* + branch-compare / pr-dialog / shell / support | ☐ |
| 8 | Spec Hub | spec-hub.* | ☐ |
| 9 | File / Diff / Terminal | file-tree / diff / terminal / detached-file-explorer / opencode-panel | ☐ |
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

### 工程
- [ ] 删除 `@radix-ui/*` 等 legacy 依赖（迁移完成后跑 `npx depcheck`）。
- [ ] 升级 `cn()` 实现：若 coss 期望 `@coss/ui/lib/utils` 的 cn()，统一替换。
- [ ] 大文件 baseline 重新校准（CSS 删完后基线大幅变化）。
- [ ] 写 `.trellis/spec/frontend/coss-component-guidelines.md` 沉淀 coss 使用规范（替代 / 补充 现 component-guidelines.md）。
- [ ] 把 coss skill 加入 onboarding 文档，新开发者知道在哪查 primitive。

### 文档
- [ ] 每 phase 完成后在 changelog 简要记录"用 coss 替换了哪些组件 / 删除了哪些 .css"。
- [ ] 项目 README 顶部加 design system 引用：coss.ui v4 + Tailwind v4 + Base UI。

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
