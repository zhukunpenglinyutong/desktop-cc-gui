# Phase 9.1 — file-tree.css coss 化 Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 9.1 (file-tree — Phase 9 第一个 sub-PR)
> Date: 2026-05-17
> Status: in-progress
> Worktree: main, head `531f53c6`

## Discovery

### File scope

| Item | Value |
|---|---|
| 文件 | `src/styles/file-tree.css` |
| 行 | 1247 |
| Selectors | 211 |
| Primary tsx consumer | `src/features/files/components/FileTreePanel.tsx` (2280 行) |
| 兄弟 tsx consumer | `src/features/files/components/FileTreeRootActions.tsx` (155 行) |
| Other consumers | `FilePreviewPopover.tsx` (203, 消费 `.file-preview-*`)、`WorkspaceSearchPanel.tsx` (消费 `.workspace-search-*` + `.file-tree-chevron`)、`FileExplorerWorkspace.tsx`（descendant selector `[&_.file-tree-panel]:h-full`） |
| Tests | `FileTreePanel.run.test.tsx` (1373 行)、`FileTreePanel.detached.test.tsx` (192 行)、`FilePreviewPopover.test.tsx`、`FileExplorerWorkspace.test.tsx` |
| 字面值 pin | NO（验证：`rg 'file-tree' src/styles/__layout-guard__/` → 0 hits） |
| Bootstrap | `src/bootstrap.ts:15` `import "./styles/file-tree.css";` |

### Cross-component override（保护）

- `src/styles/detached-file-explorer.css:21` `.detached-file-explorer-window .file-tree-action { display: none; }` — **不动**该 keeper（跨文件 cross-component cascade，由 prompt 明确保护）
- `src/styles/git-history.part1.css:670` `.git-history-file-tree-head` — 这是 `git-history-*` 命名空间的独立 className，**与 file-tree.css 无关**
- `src/features/composer/components/ChatInputBox/styles/input-area.css` `.chat-input-box.file-tree-drop-target-active` — `file-tree-drop-target-active` 是由 `FileTreePanel.tsx` 的 drag handler 在运行时 toggle 到 `.chat-input-box` 上的状态 class，**与 file-tree.css 无关**（CSS 文件不定义此 class）
- `WorkspaceSearchPanel.tsx:150` 使用 `.file-tree-chevron` 共享 cascade — 保留 `.file-tree-chevron` 作为 no-op marker（与 file-tree-row 中的 chevron 共用样式）

### querySelector pins in `FileTreePanel.run.test.tsx`

```
122: container.querySelectorAll(".file-tree-row.is-root")
149: container.querySelector(".file-tree-root-chevron")
180: rootButton.closest(".file-tree-root-row")
182: rootRow.querySelectorAll(".file-tree-row.is-root")
438: container.querySelector(".file-tree-top-zone")
439: container.querySelector(".file-tree-list")
623: srcRow.querySelector(".file-tree-chevron")
1123: container.querySelector(".file-tree-action")
```

**保留为 no-op semantic marker className（不可删）**：
- `.file-tree-row` (+ states `.is-root`, `.is-folder`, `.is-file`, `.is-selected`, `.is-primary`, `.is-gitignored`)
- `.file-tree-root-chevron`, `.file-tree-root-row`
- `.file-tree-top-zone`, `.file-tree-list`
- `.file-tree-chevron`（含 `.is-open` 状态; cross-component cascade in WorkspaceSearchPanel）
- `.file-tree-action`（含 `.is-visible` 状态; detached cross-component override 依赖此 selector）
- `.file-tree-panel`（FileExplorerWorkspace `[&_.file-tree-panel]:h-full` cascade）
- `.file-preview-line-text`（FilePreviewPopover.test.tsx pin）

### CSS-literal pin verification

```bash
$ rg 'file-tree' src/styles/__layout-guard__/
# 0 hits — file-tree.css 不在任何 layout-guard 读字面值清单
```

## CSS 内部分簇

| 行段 | Selectors | 内容 | 处理 |
|---|---|---|---|
| 1-128 | 18 | panel chrome + top-zone + tool-row + tabs-wrap + root-row + root-wrap + root-actions hover gating + root-action button + count + meta + toggle | **inline Tailwind** to FileTreePanel + FileTreeRootActions |
| 129-260 | 22 | search inline (search-icon / input / option / details-input / run button) | **inline Tailwind**（仅本 PR 处理 file-tree-search-* 系列，本仓 tsx 中 file-tree-search-* 仅出现在 FileTreePanel `.file-tree-search` 中暂未渲染，按 PRD 全部转为 marker） |
| 261-300 | 5 | list container + empty + search-summary/limit | **inline Tailwind** |
| 301-373 | 12 | search result groups (file-tree-search-result-*) | **inline Tailwind**（在 FileTreePanel.tsx 中未渲染，仅命名空间；保留 marker） |
| 382-573 | 24 | `.workspace-search-*` cluster（**跨组件**，由 WorkspaceSearchPanel.tsx 消费） | **inline Tailwind** to WorkspaceSearchPanel.tsx |
| 575-606 | 4 | file-tree-loading-row + loading-spinner + keyframe + reduced-motion | **inline Tailwind**（spinner 用 Tailwind `animate-spin` 自带 keyframe） |
| 608-770 | 30 | row + row-wrap + row states + chevron + chevron states + spacer + icon + name + action + drag cursors | **inline Tailwind**（保留全部 marker） |
| 771-792 | 3 | lazy-state + lazy-retry | **inline Tailwind** |
| 794-1078 | 50+ | `.file-preview-*` cluster（FilePreviewPopover.tsx 消费）+ prism token cascade | **inline Tailwind** + **保留 prism token keeper**（cascade 由 dangerouslySetInnerHTML/Prism 注入 DOM，无法 inline） |
| 1080-1140 | 12 | git status colors on `.file-tree-name.git-{a,m,d,r,t}` + light-theme overrides | **保留 keeper**（cascade-based + theme override; class 是动态拼接的，cascade 比 Tailwind 字符串更可读） |
| 1142-1146 | 1 | `.file-tree-toggle.is-active` | **inline Tailwind**（在 root actions 中） |
| 1148-1247 | 16 | new-file-prompt modal（位置 + backdrop + card + animation + title + path + input + actions） | **inline Tailwind**（保留 marker; keyframe 用自定义 CSS 或 Tailwind `animate-in`） |

## 策略：split & shrink（一次性，主面板 chrome + root actions + lazy/search subsection 合并）

按 PRD 9.1 plan 建议本应拆 3 sub-PR（9.1a / 9.1b / 9.1c）。本次评估：

- **9.1a 主面板 chrome**：file-tree-panel + top-zone + root-row + list + row + chevron + icon + name + action + loading + empty + lazy
- **9.1b root actions**：file-tree-root-action* + root-actions hover gating + danger
- **9.1c lazy & search**：file-tree-search-* (in FileTreePanel) + file-tree-lazy-state + file-tree-lazy-retry + workspace-search-* (cross-component to WorkspaceSearchPanel) + file-preview-* (cross-component to FilePreviewPopover) + new-file-prompt-*

**预计 tsx diff**：
- FileTreePanel.tsx：~70 行 className 字符串变动（无结构性 markup 改动；仅在 className 字符串后追加 Tailwind utility）
- FileTreeRootActions.tsx：~7 行 className 字符串变动
- WorkspaceSearchPanel.tsx：~20 行 className 字符串变动
- FilePreviewPopover.tsx：~25 行 className 字符串变动

总计预估 ~120 行 tsx diff，远低于 1500 行 prompt 阈值 → **一次性合并 9.1a + 9.1b + 9.1c**。

**预计 CSS 处理**：
- 整文件 `file-tree.css` 1247 → ~210 行 keeper（保留 prism token cascade + git status color cascade + theme overrides + 关键 cascade-based rule）
- 保留 keeper 中的所有 cascade-based + theme-aware rules（无法 inline）

## Token 映射表

| 旧 CSS var | Tailwind / coss |
|---|---|
| `var(--text-emphasis)` | `text-[var(--text-emphasis)]` (项目无 coss 对应) |
| `var(--text-strong)` | `text-[var(--text-strong)]` |
| `var(--text-muted)` | `text-muted-foreground` (coss) |
| `var(--text-faint)` | `text-[var(--text-faint)]` |
| `var(--text-fainter)` | `text-[var(--text-fainter)]` |
| `var(--text-accent, var(--accent-500))` | `text-[var(--text-accent,var(--accent-500))]` |
| `var(--text-danger, #f87171)` | `text-[var(--text-danger,#f87171)]` |
| `var(--text-warning, #fbbf24)` | `text-[var(--text-warning,#fbbf24)]` |
| `var(--surface-hover)` | `bg-[var(--surface-hover)]` |
| `var(--surface-active)` | `bg-[var(--surface-active)]` |
| `var(--surface-secondary)` | `bg-[var(--surface-secondary)]` |
| `var(--surface-card)` / `--surface-card-strong` / `--surface-card-muted` | `bg-[var(--surface-card)]` etc. |
| `var(--surface-popover)` | `bg-[var(--surface-popover)]` |
| `var(--surface-command)` | `bg-[var(--surface-command)]` |
| `var(--surface-right-panel, transparent)` | `bg-[color-mix(in_srgb,var(--surface-right-panel,transparent)_84%,transparent)]` |
| `var(--border-subtle)` | `border-[var(--border-subtle)]` |
| `var(--border-stronger)` | `border-[var(--border-stronger)]` |
| `var(--border-accent)` | `border-[var(--border-accent)]` |
| `var(--accent-500)` | `bg-[var(--accent-500)]` / `border-[var(--accent-500)]` |
| `var(--status-error)` / `--status-success` / `--status-warning` | `text-[var(--status-error)]` etc. |
| `color-mix(in srgb, var(--accent-500) 16%, transparent)` | `bg-[color-mix(in_srgb,var(--accent-500)_16%,transparent)]` |
| `backdrop-filter: blur(6px)` | `backdrop-blur-md` 或 `[backdrop-filter:blur(6px)]` |
| `var(--code-font-family)` / size / weight / line-height | `font-[var(--code-font-family)]` 等 |

## Keeper 保留范围

最终 `file-tree.css` keeper（estimated ~210 行）保留：

1. **`.file-tree-row[draggable]` cursor cascade**（17-25 行）— browser cursor states 在 Tailwind arbitrary 中可读性差，cascade 更清晰
2. **`.app.windows-desktop .file-tree-row[draggable]` cursor**（4 行）— `.app.windows-desktop` 是项目根 cascade，不能 inline
3. **`:root.file-tree-dragging` cascade**（5 行）— root cascade，不能 inline；运行时由 FileTreePanel 设置
4. **`.app.reduced-transparency .file-tree-top-zone` / `.file-tree-panel` / `.new-file-prompt-backdrop`**（3 块 + 9 行）— `.app.reduced-transparency` root cascade
5. **`.file-tree-panel:hover/focus-within .file-tree-root-actions`**（4 行）— parent state-driven children animation; Tailwind group-hover/focus-within 可表达但需要在 panel 加 `group` 类（+ 状态多 + transform 动画），保留 cascade 更稳
6. **`.file-tree-row-wrap:hover/focus-within .file-tree-action`**（4 行）— 同上 cascade
7. **`.file-preview-line-text .token.X` cluster**（~50 行）— prism token 由 dangerouslySetInnerHTML 注入，cascade-only
8. **`.file-tree-name.git-{a,m,d,r,t}` + `:root[data-theme="light"]` override**（~50 行）— 动态拼接 className + theme override cascade
9. **`@keyframes file-tree-root-action-spin` / `file-tree-loading-spin` / `new-file-prompt-enter`**（~15 行）— 自定义 keyframe，Tailwind `animate-spin` 可替代 loading-spin；rotate spin 和 enter 仍需保留
10. **`@media (prefers-reduced-motion: reduce)` overrides**（2 块 + 6 行）— media query cascade

预计净缩量：1247 → ~210 = **−1037 行（83% 删除率）**。

## 测试不变性

- 所有 `data-testid` 不动
- 所有 `.file-tree-*` className 保留（除被 inline 的 layout-only/spacing 规则外，无 className 字符串删除）
- `is-folder` / `is-file` / `is-selected` / `is-primary` / `is-gitignored` / `is-root` / `is-folder` / `is-visible` / `is-active` / `is-open` / `is-spinning` 状态 class 保留
- 上述 8 个 querySelector pin 全部 100% 保留

## 风险

| 风险 | 对冲 |
|---|---|
| FileTreePanel.tsx 2280 行 + Tailwind utility 字符串变长可能撑大文件 | 估算 ~70 行 diff，远低于 1000/1500 阈值；逐 className 追加不引入新 JSX |
| WorkspaceSearchPanel.tsx 使用 `.file-tree-chevron` cross-component | 保留 `.file-tree-chevron` keeper cascade（cascade-based hover/open states），WorkspaceSearchPanel 不动 className 字符串 |
| detached-file-explorer.css 依赖 `.file-tree-action` selector | **不动 detached-file-explorer.css**（prompt 明确禁止）；`.file-tree-action` className 保留 |
| `:root.file-tree-dragging *` 全局 cursor override 由 FileTreePanel 运行时设置 | keep 在 keeper（运行时 add/remove class） |
| Prism token 与 dangerouslySetInnerHTML（FilePreviewPopover 渲染 line text）依赖 `.file-preview-line-text .token.X` cascade | 全部保留为 keeper |
| 大量 color-mix() 在 Tailwind arbitrary value 中可读性差 | 长 utility 字符串接受；不引入新 css 变量 |
| `WorkspaceSearchPanel.tsx` 不在「可改」白名单 — 它消费 `.workspace-search-*` 跨组件 | **修正策略**：本 phase 仅删 `file-tree.css` 内的 `.workspace-search-*` 规则迁移到 WorkspaceSearchPanel 即可。但 prompt 严格 file scope 不含 WorkspaceSearchPanel.tsx → **保留 .workspace-search-* 全部规则在 file-tree.css keeper**，本 phase 不动 WorkspaceSearchPanel.tsx。同样 **FilePreviewPopover.tsx 不在白名单** → 保留 `.file-preview-*` 全部规则在 keeper。 |

### 严格 file scope 修正后的范围（scope 收缩）

按 prompt 严格 file scope（"src/features/files/components/FileTreePanel.tsx 与相关 row/header 子组件"）：

- **可改 tsx**：`FileTreePanel.tsx` + `FileTreeRootActions.tsx`
- **不可改 tsx**：`WorkspaceSearchPanel.tsx`（`src/features/search/`）、`FilePreviewPopover.tsx`（`src/features/files/components/` 但其消费的 className cluster 是独立的 file-preview 主题，与 file-tree-row 内容无关）

**修正后处理**：

1. **inline Tailwind 到 FileTreePanel.tsx + FileTreeRootActions.tsx** 的 selectors：
   - `.file-tree-panel`、`.file-tree-top-zone`、`.file-tree-tool-row`、`.file-tree-tabs-wrap`
   - `.file-tree-root-row`、`.file-tree-root-wrap`
   - `.file-tree-list`、`.file-tree-list.has-root-guide`
   - `.file-tree-empty`、`.file-tree-loading-row`、`.file-tree-loading-spinner`
   - `.file-tree-row`（含 `.is-folder`、`.is-file`、`.is-selected`、`.is-primary`、`.is-gitignored`、`.is-root`）+ `.file-tree-row-wrap` + `.file-tree-row.is-file`（缩进规则）
   - `.file-tree-chevron`（含 `.is-open`、`.file-tree-root-chevron`）
   - `.file-tree-spacer`、`.file-tree-icon`、`.file-tree-icon-root-special`、`.file-tree-name`
   - `.file-tree-action`（含 `.is-visible`）
   - `.file-tree-lazy-state`、`.file-tree-lazy-retry`
   - `.file-tree-count`、`.file-tree-meta`、`.file-tree-toggle`、`.file-tree-toggle.is-active`
   - `.file-tree-root-action`（含 `.is-spinning`、`.is-active`）+ `.file-tree-root-action-danger`
   - `.file-tree-root-actions`
   - `.new-file-prompt`、`.new-file-prompt-backdrop`、`.new-file-prompt-card`、`.new-file-prompt-title`、`.new-file-prompt-path`、`.new-file-prompt-input`、`.new-file-prompt-actions`
2. **保留在 keeper 的 cascade-based / theme-aware / cross-component / prism-token / 第三方-injected rules**：
   - `.app.reduced-transparency .file-tree-top-zone`、`.app.reduced-transparency .file-tree-panel`、`.app.reduced-transparency .new-file-prompt-backdrop`（root cascade）
   - `.app.windows-desktop .file-tree-row[draggable]` cursor（root cascade）
   - `:root.file-tree-dragging` + `:root.file-tree-dragging *` cursor（运行时 root cascade）
   - `.file-tree-panel:hover/focus-within .file-tree-root-actions` parent-state cascade
   - `.file-tree-row-wrap:hover/focus-within .file-tree-action` parent-state cascade
   - `.file-tree-row[draggable]` cursor states
   - `:root[data-theme="light"] .file-tree-name.git-X` theme override + base `.file-tree-name.git-X` (dark default)
   - `.file-tree-row.is-gitignored .file-tree-name { font-style: italic; }` selector cascade（继承到 child .file-tree-name）
   - **整个 `.workspace-search-*` cluster** (cross-component, WorkspaceSearchPanel 不在 scope)
   - **整个 `.file-tree-search*` cluster**（FileTreePanel 内部当前未渲染，但 className 命名空间保留以防未来引入；本次保留在 keeper）
   - **整个 `.file-tree-search-result-*` cluster**（同上，未渲染但保留命名空间）
   - **整个 `.file-preview-*` cluster** (cross-component, FilePreviewPopover 不在 scope)
   - `@keyframes file-tree-root-action-spin` / `file-tree-loading-spin` / `new-file-prompt-enter`
   - `@media (prefers-reduced-motion: reduce)` 2 块

### 真实预计净缩量

由于 workspace-search + file-preview + file-tree-search* + git status color theme + prism token 整段全保留：

- inline 可拆出去的：`.file-tree-panel`、`.file-tree-top-zone`、`.file-tree-tool-row`、`.file-tree-tabs-wrap`、`.file-tree-root-row`、`.file-tree-root-wrap`、`.file-tree-root-actions`（带 visibility cascade 部分仍 keeper）、`.file-tree-root-action`、`.file-tree-root-action.is-active`、`.file-tree-root-action-danger`、`.file-tree-count`、`.file-tree-meta`、`.file-tree-toggle`、`.file-tree-list`、`.file-tree-list.has-root-guide`、`.file-tree-empty`、`.file-tree-loading-row`、`.file-tree-loading-spinner`、`.file-tree-row` base（含 hover）、`.file-tree-row-wrap`、`.file-tree-row.is-file`、`.file-tree-row.is-selected`、`.file-tree-row.is-folder`、`.file-tree-row.is-root` (含 `.is-root .file-tree-name`)、`.file-tree-icon-root-special`、`.file-tree-chevron`、`.file-tree-chevron.is-open`、`.file-tree-root-chevron`、`.file-tree-spacer`、`.file-tree-icon`、`.file-tree-icon svg`、`.file-tree-name`、`.file-tree-action` base、`.file-tree-action.is-visible`、`.file-tree-action:hover/focus-visible` opacity 部分、`.file-tree-lazy-state`、`.file-tree-lazy-retry`、`.file-tree-toggle.is-active`、`.file-tree-row.is-gitignored` opacity（italic 留 keeper）、`.new-file-prompt-*` 8 个
- ≈ 60 selectors, ~300 行 inline-able

**预计 file-tree.css 净缩量：1247 → ~750-800 行（−400-500 行，~35% 删除率）**

不如初版评估 −1037 那么激进，因为 workspace-search/file-preview/file-tree-search* 全套必须留 keeper（跨组件 + 未渲染 namespace）。

## 验证

```bash
npm run lint
npm run typecheck
npm run test:layout-guard
npm run check:large-files:gate
npx vitest run src/features/files/components/FileTreePanel.run.test.tsx
npx vitest run src/features/files/components/FileTreePanel.detached.test.tsx
npx vitest run src/features/files/components/FileExplorerWorkspace.test.tsx
```

## After Phase 9.1

- `src/bootstrap.ts`: 行 15 `import "./styles/file-tree.css";` 保留（同名 keeper）
- `src/styles/file-tree.css`: 1247 → ~750-800 行（keeper：cascade + theme + cross-component cluster + prism + keyframe）
- `src/features/files/components/FileTreePanel.tsx`: +Tailwind utility 在 className 字符串
- `src/features/files/components/FileTreeRootActions.tsx`: +Tailwind utility 在 className 字符串
- `src/styles/detached-file-explorer.css`: **不变**（明确保护）

## Follow-up（合并阶段）

- **9.1b**：把 `.workspace-search-*` cluster 单独抽到 `src/styles/workspace-search.css` 或 inline 到 `WorkspaceSearchPanel.tsx` 之后从 `file-tree.css` 切除
- **9.1c**：把 `.file-preview-*` cluster 单独抽到 `src/styles/file-preview.css` 或 inline 到 `FilePreviewPopover.tsx` 之后从 `file-tree.css` 切除
- **9.1d**：移除 `file-tree-search-*` / `file-tree-search-result-*` 未渲染 namespace（确认无其它组件即将使用后清理）
- **9.2 onward**：见 PRD Phase 9.x

## 执行清单

- [ ] Step 1: inline Tailwind to FileTreeRootActions.tsx（先小，再验证）
- [ ] Step 2: inline Tailwind to FileTreePanel.tsx（按 className 字符串顺序遍历）
- [ ] Step 3: 缩 file-tree.css 到 keeper-only
- [ ] Step 4: lint + typecheck
- [ ] Step 5: test:layout-guard (46/46) + check:large-files:gate
- [ ] Step 6: targeted vitest（FileTreePanel.run、FileTreePanel.detached、FileExplorerWorkspace）
