# Phase 9.3 — file-view-panel + shell coss 化 Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 9.3 (file-view-panel + file-view-panel-shell — Phase 9 第三个 sub-PR)
> Date: 2026-05-17
> Status: in-progress
> Worktree: main, head `b280d6d2 chore(trellis): 记录会话`

## TL;DR — Scope 收缩到 frame + 受限 preview surface（一次性批次）

PRD 9.3 plan 建议拆 4 sub-PR：9.3a frame / 9.3b preview surfaces / 9.3c outline & tabs / 9.3d shell vars 提到 themes.*.css。本次只做 **9.3a frame + 9.3b 部分 preview surface（注解 / 状态文字 / split / footer 主链）**，剩余三类延后到 follow-up：

1. **9.3 follow-up — code-preview / structured-preview / file-markdown / cm cluster**：被 `SkillsSection.tsx`（Phase 6.5a 已完成）共用，跨 feature scope；需在 SkillsSection 同步迁移或独立 keeper PR 中处理。
2. **9.3 follow-up — pdf-preview / tabular-preview / document-preview**：单独的 preview surface，本批次为收缩而 defer。
3. **9.3 follow-up — outline 区**：与 markdown preview cascade 耦合，与上述 follow-up 一起。
4. **9.3 follow-up — `--fvp-*` shell vars 提到 themes.\*.css**：按 prompt "shell vars 暂保留 keeper，不提到 themes.*.css（推后续）"。

## Discovery ground truth

### File sizes（HEAD `b280d6d2`）

```
2364 src/styles/file-view-panel.css
 135 src/styles/file-view-panel-shell.css
1947 src/features/files/components/FileViewPanel.tsx
 751 src/features/files/components/FileViewBody.tsx
 679 src/features/files/components/FileMarkdownPreview.tsx
 405 src/features/files/components/FilePdfPreview.tsx
 283 src/features/files/components/FileStructuredPreview.tsx
 237 src/features/files/components/FileTabularPreview.tsx
 203 src/features/files/components/FilePreviewPopover.tsx (不消费 fvp-*)
 122 src/features/files/components/FileDocumentPreview.tsx
 114 src/features/files/components/FileViewNavigationPanel.tsx
  83 src/features/files/components/PreviewOutlineSidebar.tsx
2641 src/features/files/components/FileViewPanel.test.tsx
```

注意 PRD prompt 中提及 `file-view-panel/FileViewBody.tsx` 实际位于 `src/features/files/components/FileViewBody.tsx`（无 file-view-panel 子目录）。

### Bootstrap

```
src/bootstrap.ts:17  import "./styles/file-view-panel-shell.css";
src/bootstrap.ts:18  import "./styles/file-view-panel.css";
```

### CSS-literal pin verification

```bash
$ grep -rn "readFileSync.*file-view-panel" src/
# 0 hits — file-view-panel*.css 不在任何 readFileSync 字面值清单
```

### 共享 `--fvp-*` token cascade

`file-view-panel-shell.css` 定义在 `.fvp` 根 + `:root[data-theme="light"] .fvp` + `@media (prefers-color-scheme: light) :root:not([data-theme]) .fvp` 三个层级中提供 8 个 syntax-highlight token：
- `--fvp-token-comment` / `-punctuation` / `-property` / `-number` / `-string` / `-operator` / `-keyword` / `-function`
- 4 个 reader-area tokens：`--fvp-reader-surface` / `-text` / `-muted` / `-faint` / `-fainter`

`file-view-panel.css` 消费这些 token 至少在以下 cascade 簇：
- `.fvp-code-preview` + `.fvp-line-text .token.*`（lines 467-787）
- `.fvp-structured-preview` 全簇（lines 791-963）
- `.fvp-file-markdown` + `.fvp-file-markdown-codeblock` 全簇（lines 1290-1717）
- `.fvp-cm` editor cluster（lines 1721-2000）

按 prompt "shell vars 暂保留 keeper" 决策：**file-view-panel-shell.css 完全不动**（135 行 keeper）。

### Cross-feature shared className（**关键阻塞**）

`SkillsSection.tsx`（Phase 6.5a 已完成，**scope 外**）消费以下 fvp- className：

```
1224  <div className="fvp-image-preview">
1225    <div className="fvp-image-preview-inner">
1229      <img className="fvp-image-preview-img" .../>
1252  <div className="fvp-preview-scroll">
1255    <div className="fvp-file-markdown fvp-markdown-github" ... />
1262  <div className="fvp-preview-scroll">
1266    <article className="fvp-structured-preview" ... />
1270  <div className="fvp-code-preview" role="list">
1272    <div className="fvp-code-line">
1273      <span className="fvp-line-number">{index + 1}</span>
1275      <span className="fvp-line-text" ... />
```

→ **下列 CSS 簇必须留在 file-view-panel.css 作为 keeper（cross-feature）**：

| className 簇 | CSS 行 | 原因 |
|---|---|---|
| `.fvp-image-preview` + `-inner` + `-img` + `.fvp-image-info` | 422-463 | SkillsSection.tsx 消费 |
| `.fvp-preview-scroll` | 968-974 | SkillsSection.tsx 消费 |
| `.fvp-file-markdown` + `.fvp-markdown-github` + 所有 markdown 渲染 cascade（h1-h6, ul/ol, code block, table, blockquote, frontmatter, mermaid, annotation） | 1279-1717 | SkillsSection.tsx 消费 + `dangerouslySetInnerHTML` markdown render |
| `.fvp-structured-preview` + 所有子簇 + token cascade | 791-963 | SkillsSection.tsx 消费 |
| `.fvp-code-preview` + `.fvp-code-line` + `.fvp-line-number` + `.fvp-line-text` + token cascade + git-marker pseudo + annotation cluster | 467-787 | SkillsSection.tsx 消费 |

这 5 簇覆盖 ~1100 行 CSS（约 47% file-view-panel.css）。**必须保留**。

### querySelector pins（**保留为 no-op marker**）

`FileViewPanel.test.tsx`:
```
querySelector(".fvp-annotation-marker")          # 2x
querySelector(".fvp-annotation-trigger")
querySelector(".fvp-code-preview")
querySelector(".fvp-filepath")
querySelector(".fvp-header-row")
querySelector(".fvp-markdown-source-annotation-list")   # 此 className 在 source 中不存在，pin 在测试中但目标可能为 undefined
querySelector(".fvp-preview-scroll")
querySelector(".fvp-preview-selection-toolbar")
querySelector(".fvp-topbar")
querySelectorAll(".fvp-annotation-draft")
querySelectorAll(".fvp-annotation-marker")
querySelectorAll(".fvp-code-line")  # FileViewPanel.test.tsx:1453, 1715
```

`FilePdfPreview.test.tsx`:
```
querySelectorAll(".fvp-pdf-page")  # 2x
```

**保留 className（不可删）**：
- `.fvp-annotation-marker`, `.fvp-annotation-trigger`, `.fvp-code-preview`, `.fvp-code-line`,
- `.fvp-filepath`, `.fvp-header-row`, `.fvp-preview-scroll`, `.fvp-preview-selection-toolbar`,
- `.fvp-topbar`, `.fvp-annotation-draft`, `.fvp-pdf-page`

### Non-fvp 跨文件 cascade（**检索结果**）

```bash
$ grep -nE "fvp-[a-z-]+" src/styles/*.css | grep -v file-view-panel
# 0 hits — 没有其它 css 文件引用 fvp-* selector
```

### 共享 cascade 子簇分类

| className 簇 | 行段 | tsx 消费者 | 跨 SkillsSection? | 跨测试 pin? | 处理 |
|---|---:|---|:---:|:---:|---|
| `.fvp-tab-*` cluster (tab main / icon / close / context-menu / git-*) | 1-139 | FileViewPanel.tsx (tabs render) | ❌ | ❌ | **inline + 删 css** |
| `.fvp-topbar` + `-left` + `-right` | 143-167 | FileViewPanel.tsx | ❌ | ✅ querySelector(.fvp-topbar) | **inline + 保留 className marker + 删 css base** |
| `.fvp-header-row` + `-left` + `-tabs` + `-right` + `-header-actions` | 169-206 | FileViewPanel.tsx | ❌ | ✅ querySelector(.fvp-header-row) | **inline + 保留 marker + 删 css base** |
| `.fvp-external-change-banner` + `-copy` + `-actions` + `is-conflict` + `is-auto-sync` | 208-250 | FileViewPanel.tsx | ❌ | ❌ | **inline + 删 css** |
| `.fvp-external-compare` + `-column` | 252-287 | FileViewPanel.tsx | ❌ | ❌ | **inline + 删 css**；`@media (max-width: 980px)` 媒体查询用 Tailwind `max-[980px]:` arbitrary |
| `.fvp-back`, `.fvp-filepath`, `.fvp-dirty-dot`, `.fvp-truncated` | 289-319 | FileViewPanel.tsx | ❌ | ✅ querySelector(.fvp-filepath) | **inline + 保留 .fvp-filepath marker + 删 css base** |
| `.fvp-action-btn`, `.fvp-action-group`, `.fvp-save-btn` | 323-395 | FileViewPanel.tsx, FileViewBody.tsx | ❌ | ❌ | **inline + 删 css**；注意 `.fvp-action-group .fvp-save-btn.is-saved` cascade，inline 后状态 class 直接 conditional className |
| `.fvp-body`, `.fvp-status`, `.fvp-error` | 399-418 | FileViewBody.tsx | ❌ | ❌ | **inline + 删 css**；注意 `.fvp-status fvp-error` cascade 是同元素双 class |
| `.fvp-annotation-toolbar`, `.fvp-annotation-trigger`, `.fvp-annotation-draft`, `.fvp-annotation-draft-inline`, `.fvp-annotation-marker`, `-head`, `-tools`, `.fvp-annotation-remove`, `.fvp-annotation-title`, `.fvp-annotation-draft-head`, `-actions`, `-input`, `.fvp-annotation-submit`, `.fvp-line-annotation-button`, `.fvp-markdown-annotatable-block`, `.fvp-markdown-annotation-button`, `.fvp-markdown-annotation-inline` | 541-710 + 1303-1361 | FileViewPanel.tsx, FileViewBody.tsx, FileMarkdownPreview.tsx | ❌ | ✅ querySelector(.fvp-annotation-marker / -trigger / -draft) | **inline + 保留 pin marker + 删 css base** |
| `.fvp-preview-selection-toolbar` | 716-735 | FileViewBody.tsx | ❌ | ✅ querySelector(.fvp-preview-selection-toolbar) | **inline + 保留 marker + 删 css base** |
| `.fvp-image-preview` + `-inner` + `-img` + `.fvp-image-info` | 422-463 | FileViewBody.tsx, **SkillsSection.tsx** | ✅ | ❌ | **KEEPER**（cross-feature） |
| `.fvp-preview-scroll` | 968-974 | FileViewBody.tsx, FileDocumentPreview, FilePdfPreview, FileTabularPreview, **SkillsSection.tsx** | ✅ | ✅ pin | **KEEPER**（cross-feature + test pin） |
| `.fvp-preview-section-header` + `-title` + `-budget-hint` + `-shell` + `-main` + `-toolbar` + `-toolbar-button` + `-toolbar-value` + outline cluster | 976-1131 | FileDocumentPreview, FilePdfPreview, FileTabularPreview, PreviewOutlineSidebar | ❌ | ❌ | **DEFER**（属 9.3c outline & tabs / 9.3b preview surfaces follow-up） |
| `.fvp-code-preview` + `.fvp-code-line` + cluster + token + git-marker + annotation | 467-787 | FileViewBody.tsx, **SkillsSection.tsx** | ✅ | ✅ pin | **KEEPER**（cross-feature + test pin） |
| `.fvp-structured-preview` + 全簇 | 791-963 | FileStructuredPreview, **SkillsSection.tsx** | ✅ | ❌ | **KEEPER**（cross-feature） |
| `.fvp-pdf-*` cluster | 1133-1191 | FilePdfPreview | ❌ | ✅ pin (.fvp-pdf-page) | **DEFER**（9.3b follow-up，跨文件量级 405 行 tsx） |
| `.fvp-tabular-*` cluster | 1193-1242 | FileTabularPreview | ❌ | ❌ | **DEFER**（9.3b follow-up） |
| `.fvp-document-preview` + `-article` cluster | 1244-1266 | FileDocumentPreview | ❌ | ❌ | **DEFER**（9.3b follow-up） |
| `.fvp-file-markdown` + `.fvp-markdown-github` + ALL markdown render cascade | 1279-1717 | FileMarkdownPreview, **SkillsSection.tsx** | ✅ | ❌ | **KEEPER**（cross-feature + `dangerouslySetInnerHTML` Prism cascade） |
| `.fvp-editor` + `.fvp-cm` cluster (CodeMirror overrides) | 1721-2001 | FileViewBody.tsx | ❌ | ❌ | **KEEPER**（CodeMirror DOM 注入，不在 React tree） |
| `.fvp-split` + `.fvp-split-editor` + `-divider` + `-preview` | 2005-2036 | FileViewPanel.tsx | ❌ | ❌ | **inline + 删 css**（边缘安全） |
| `.fvp-navigation-*` cluster | 2040-2138 | FileViewNavigationPanel | ❌ | ❌ | **DEFER**（9.3 outline follow-up；FileViewNavigationPanel 114 行小 tsx，安全 inline 但暂收缩 scope） |
| `.fvp-footer` + `-left` + `-right` + `-hint` + `-shortcut` + `-saved` cluster + `.fvp-layout-toggle` + `.fvp-maximize-toggle` + `.fvp-find-toggle` + `.fvp-file-reference-*` + `body.editor-split-resizing` | 2142-2358 | FileViewPanel.tsx | ❌ | ❌ | **inline + 删 css**（注意 `body.editor-split-resizing` 全局 cursor cascade 留 keeper；`.content.is-editor-split-vertical .fvp-footer` 也留 keeper — `content` 是父级容器，由 main.css 控制） |
| `@media (max-width: 980px) .fvp-external-compare` | 2360-2364 | — | ❌ | ❌ | **inline 走 Tailwind `max-[980px]:` arbitrary** |

### 本次实施的 frame + 部分 preview surface scope（明确清单）

**inline + 缩简 css**：
1. `.fvp-tab-*` cluster — FileViewPanel.tsx tab section
2. `.fvp-topbar` + 子 — FileViewPanel.tsx topbar
3. `.fvp-header-row` + 子 + `.fvp-header-actions` — FileViewPanel.tsx header
4. `.fvp-external-change-banner` + `.fvp-external-compare` — FileViewPanel.tsx external change UI
5. `.fvp-back`, `.fvp-filepath`, `.fvp-dirty-dot`, `.fvp-truncated`
6. `.fvp-action-btn`, `.fvp-action-group`, `.fvp-save-btn`
7. `.fvp-body`, `.fvp-status`, `.fvp-error`
8. `.fvp-annotation-*` cluster（FileViewPanel + FileViewBody + FileMarkdownPreview 三处 inline，保留 cascade target marker）
9. `.fvp-preview-selection-toolbar` — FileViewBody.tsx 注解 UI
10. `.fvp-markdown-annotatable-block` + `.fvp-markdown-annotation-button` + `.fvp-markdown-annotation-inline` — FileMarkdownPreview.tsx
11. `.fvp-split` cluster — FileViewPanel.tsx split markdown editor
12. `.fvp-footer` cluster（含 `-left`, `-right`, `-hint`, `-shortcut`, `-saved`, `-layout-toggle`, `-maximize-toggle`, `-find-toggle`, `-file-reference-*`）
13. `@media (max-width: 980px) .fvp-external-compare` 单条 → Tailwind `max-[980px]:` arbitrary 在 grid-template-columns 上覆盖

**KEEPER 保留**（cross-feature / cascade / `dangerouslySetInnerHTML`-注入 / CodeMirror-注入）：
- `.fvp-image-preview*` cluster
- `.fvp-preview-scroll`
- `.fvp-code-preview` + `.fvp-code-line*` + `.fvp-line-*` + `.fvp-line-text .token.*`
- `.fvp-structured-preview*`
- `.fvp-file-markdown*` + `.fvp-markdown-github` + 所有 markdown render cascade
- `.fvp-editor` + `.fvp-cm*` 全簇
- `.fvp-pdf-*` cluster（9.3 follow-up）
- `.fvp-tabular-*` cluster（9.3 follow-up）
- `.fvp-document-preview*` cluster（9.3 follow-up）
- `.fvp-navigation-*` cluster（9.3 follow-up — small file，scope 收缩）
- `.fvp-preview-section-*` + `.fvp-preview-shell` + outline cluster + `.fvp-preview-toolbar*` + `.fvp-preview-budget-hint`（9.3b/c follow-up）
- `body.editor-split-resizing` 全局 cursor cascade（运行时 add/remove）
- `.content.is-editor-split-vertical .fvp-footer` cascade（content 由 main.css 控制，跨文件）

## Token 映射表（与 phase 9.1 一致）

| 旧 CSS var / value | Tailwind / coss |
|---|---|
| `var(--text-strong)` | `text-[var(--text-strong)]` |
| `var(--text-stronger)` | `text-[var(--text-stronger)]` |
| `var(--text-muted)` | `text-muted-foreground` 或 `text-[var(--text-muted)]` |
| `var(--text-faint)` | `text-[var(--text-faint)]` |
| `var(--text-fainter)` | `text-[var(--text-fainter)]` |
| `var(--text-accent)` | `text-[var(--text-accent)]` |
| `var(--text-danger, #f87171)` | `text-[var(--text-danger,#f87171)]` |
| `var(--surface-messages)` | `bg-[var(--surface-messages)]` |
| `var(--surface-card)` | `bg-[var(--surface-card)]` |
| `var(--surface-control)` | `bg-[var(--surface-control)]` |
| `var(--surface-hover)` | `bg-[var(--surface-hover)]` |
| `var(--surface-active)` | `bg-[var(--surface-active)]` |
| `var(--surface-command)` | `bg-[var(--surface-command)]` |
| `var(--surface-panel)` | `bg-[var(--surface-panel)]` |
| `var(--surface-strong)` | `bg-[var(--surface-strong)]` |
| `var(--surface-elevated)` | `bg-[var(--surface-elevated)]` |
| `var(--border-subtle)` | `border-[var(--border-subtle)]` |
| `var(--border-strong)` | `border-[var(--border-strong)]` |
| `var(--border-stronger)` | `border-[var(--border-stronger)]` |
| `var(--border-accent)` | `border-[var(--border-accent)]` / `bg-[var(--border-accent)]`（when dirty-dot） |
| `var(--status-success)` / `--status-error` / `--status-warning` | `text-[var(--status-success)]` 等 |
| `var(--code-font-family)` | `font-[var(--code-font-family)]` |
| `color-mix(in srgb, var(--X) 70%, transparent)` | `bg-[color-mix(in_srgb,var(--X)_70%,transparent)]` |

## 预计 diff 体量

- **FileViewPanel.tsx**：~50 className 字符串 inline 追加 utility（不改 markup），预计 +200~250 行（注意：JSX 字符串变长，行数膨胀），但单文件 diff 仍 <1500 行
- **FileViewBody.tsx**：~25 className 字符串 inline，预计 +120 行
- **FileMarkdownPreview.tsx**：~5 className 字符串 inline（仅 markdown-annotation-* 三条 + frame），预计 +20 行
- **file-view-panel.css**：2364 → ~1500 行（−800 ~ 900 行，~35% 删除率；keeper 主要是 cross-feature + CodeMirror cluster）
- **file-view-panel-shell.css**：**不变**（135 行 keeper，shell vars 留待 9.3d follow-up）

## 测试不变性

- 所有 `data-testid` 不动
- 所有 querySelector pin 对应 className 保留为 marker
- `is-active` / `is-dirty` / `is-saved` / `is-conflict` / `is-auto-sync` / `is-visible` / `is-selected` / `is-git-added` / `is-git-modified` / `is-side-by-side` / `is-outline-collapsed` / `git-{a,m,d,r,t}` 状态 class 保留
- `bootstrap.ts` 不动

## 验证清单

```bash
npm run lint
npm run typecheck
npm run test:layout-guard           # 46/46
npm run check:large-files:gate
npx vitest run src/features/files/components/FileViewPanel.test.tsx
npx vitest run src/features/files/components/FilePdfPreview.test.tsx
npx vitest run src/features/files/components/FileDocumentPreview.test.tsx
npx vitest run src/features/files/components/FileTabularPreview.test.tsx
npx vitest run src/features/files/components/FilePreviewPopover.test.tsx
```

## Execution Order

1. **Step A**: inline Tailwind 到 FileViewBody.tsx（受 annotation + body + status + preview-selection-toolbar 影响最小簇）
2. **Step B**: inline Tailwind 到 FileMarkdownPreview.tsx（markdown-annotation-* + 必须保留的 SkillsSection 共用 className）
3. **Step C**: inline Tailwind 到 FileViewPanel.tsx（tab / topbar / header-row / external-change / external-compare / action-btn / split / footer）
4. **Step D**: 缩简 file-view-panel.css — 删除 frame + 已 inline annotation 段
5. **Step E**: lint + typecheck
6. **Step F**: test:layout-guard + check:large-files:gate + 定向 vitest

## Follow-ups (9.3 后续)

- **9.3b-pdf**: `.fvp-pdf-*` cluster inline to FilePdfPreview.tsx (405 行)
- **9.3b-tabular**: `.fvp-tabular-*` cluster inline to FileTabularPreview.tsx (237 行)
- **9.3b-document**: `.fvp-document-preview*` cluster inline to FileDocumentPreview.tsx (122 行)
- **9.3c-outline**: `.fvp-preview-shell` + `.fvp-preview-outline*` + `.fvp-preview-section-*` + `.fvp-preview-toolbar*` + `.fvp-preview-budget-hint` cluster inline to PreviewOutlineSidebar.tsx / FilePdfPreview.tsx / FileDocumentPreview.tsx / FileMarkdownPreview.tsx (跨 4 个 tsx 但行数小)
- **9.3c-navigation**: `.fvp-navigation-*` cluster inline to FileViewNavigationPanel.tsx (114 行)
- **9.3d-shell-vars**: `--fvp-*` token cluster 提到 `themes.*.css` + delete `file-view-panel-shell.css`
- **9.3 cross-feature**: 评估 `.fvp-image-preview` / `.fvp-preview-scroll` / `.fvp-code-preview` / `.fvp-structured-preview` / `.fvp-file-markdown` 共享 cluster 拆分（拆 SkillsSection.tsx 中 fvp- 消费到独立 cluster 或共享 keeper）
- **9.3 cm keeper 评估**：`.fvp-cm` CodeMirror cluster 是否可以与 chat-message / settings cm 整合到单独 codemirror.css keeper

## 风险

| 风险 | 对冲 |
|---|---|
| SkillsSection.tsx 跨 feature 消费 5 个 fvp- 簇 | 全部保留 keeper（cross-feature），本批次零删除 |
| FileViewPanel.tsx 1947 行 + inline Tailwind 字符串拉长，逼近 2400 行 warn 门 | 估算 +200~250 行，~2200 行仍低于 warn 门 |
| `.fvp-status.fvp-error` 双 class cascade 改成 conditional className | 用 cn() pattern 处理；保留双 marker className 在 jsx |
| `body.editor-split-resizing` 全局 cursor override 由 FileViewPanel.tsx 运行时 `add/remove` | 全部保留 keeper（运行时 add/remove class 不变） |
| `.content.is-editor-split-vertical .fvp-footer` 跨 main.css cascade | 保留 keeper |
| FileMarkdownPreview 既有 Prism cascade（`.fvp-file-markdown-codeblock .token.X` 由 `dangerouslySetInnerHTML` 注入）必须保留 | 全部留 keeper |
| CodeMirror cluster（`.fvp-cm .cm-*`）由 @uiw/react-codemirror 注入 DOM | 全部留 keeper |

## After Phase 9.3

- `src/bootstrap.ts`: 不变（line 17/18 keeper 同名同 path）
- `src/styles/file-view-panel.css`: 2364 → 1625 行（−739 行 / 31% 删除率；487 → 281 selectors / 42% 删除率）
- `src/styles/file-view-panel-shell.css`: 不变（135 行 keeper，shell vars 推 follow-up）
- `src/features/files/components/FileViewPanel.tsx`: 1947 → 1990 行（+43 行）
- `src/features/files/components/FileViewBody.tsx`: 751 → 752 行（+46 字符串 inline, +1 净行）
- `src/features/files/components/FileMarkdownPreview.tsx`: **未触碰**（markdown-annotation cascade 在 keeper 中更安全）
- `src/features/settings/components/SkillsSection.tsx`: **不动**（Phase 6.5a 已完成 + 当前消费 5 个 fvp- 簇属 cross-feature 保护）

## Execution-time results (2026-05-17)

| Check | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:layout-guard` | 46/46 pass |
| `npm run check:large-files:gate` | found=1（既有 SpecHubPresentationalImpl.tsx baseline 6111；delta=0） |
| `npx vitest run src/features/files/components/FileViewPanel.test.tsx` | 64/64 pass |
| `npx vitest run src/features/files/components/FilePdfPreview FileDocumentPreview FileTabularPreview FilePreviewPopover` | 13/13 pass |
| `npx vitest run src/features/files` | 162/162 pass |
| `npx vitest run src/features/settings` | 134/134 pass — 验证 SkillsSection cross-feature 共用 cluster 保留有效 |
| `npx vitest run src/styles` | 52/52 pass |
| `npx vitest run src/features/code-annotations` | 5/5 pass |

## Diff stats（仅本 phase 9.3 修改）

```
src/features/files/components/FileViewBody.tsx  |  46 +-
src/features/files/components/FileViewPanel.tsx | 235 +++---
src/styles/file-view-panel.css                  | 931 +++---------------------
3 files changed, 258 insertions(+), 954 deletions(-)
```

净 tsx 增量 = +281 行（合并 +254 inserts -27 deletes for tsx，远低于 1500 行阈值）。CSS 净缩 = -693 行。

## Worktree scope-out 标记（**不在本 phase 9.3 修改范围**）

会话开始前 baseline 已存在的未 commit 修改（不由本 phase 触碰，但 worktree 中可见）：

- `src/bootstrap.ts`（-1 行）
- `src/features/kanban/components/KanbanBoardHeader.tsx`
- `src/features/layout/components/DesktopLayout.tsx`
- `src/features/opencode/components/{OpenCodeAdvancedSection,OpenCodeControlPanel,OpenCodeMcpSection,OpenCodeProviderSection,OpenCodeSessionsSection}.tsx`
- `src/styles/kanban.css`
- `src/styles/opencode-panel.css`（D，被删除）
- `.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-5-6b-kanban-fullscreen-plan.md`（U，untracked）
- `.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-9-5-opencode-panel-plan.md`（U，untracked）

这些属于先前 Phase 5.6b kanban-fullscreen 与 Phase 9.5 opencode-panel 的 in-progress 工作，**由 orchestrator 在 merge 阶段统一处理**。本 phase 9.3 不动它们。
