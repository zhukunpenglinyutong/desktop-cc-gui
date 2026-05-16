# Phase 9.2 — diff + diff-viewer coss 化 Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 9.2 (diff + diff-viewer 拆解的第 1 个 sub-PR)
> Date: 2026-05-16
> Agent: claude-agent (主 worktree，紧随 P0-1 layout-guard 改造 commit `1384e9f4`)
> Predecessor commits:
> - `1384e9f4` refactor(coss-ui): P0 layout-guard 字面值断言改造为 jsdom cascade 验证
> - `8e2010c9` chore(trellis): 记录会话（当前 HEAD）

## Discovery

### File scope ground truth

```bash
$ wc -l src/styles/diff.css src/styles/diff-viewer.css
  2110 diff.css
  1376 diff-viewer.css
```

| File | Lines | Unique selectors (`diff-viewer-*`) | Primary tsx consumer (lines) |
|---|---:|---:|---|
| `diff.css` | 2110 | ~70 unique `diff-*` | `GitDiffPanel.tsx` (2661) + `DiffBlock.tsx` (352) + `GitDiffPanelFileSections.tsx` (517) + `GitDiffPanelCommitScope.tsx` (368) + `GitDiffPanelSectionActions.tsx` (113) + `GitDiffPanelInclusion.tsx` (129) + `ImageDiffCard.tsx` + `WorkspaceEditableDiffReviewSurface.tsx` (403) |
| `diff-viewer.css` | 1376 | 67 unique `diff-viewer-*` | `GitDiffViewer.tsx` (1317) |

Combined consumer load: `GitDiffPanel.tsx` 2661 行（红线 2.6×）+ `GitDiffViewer.tsx` 1317 行（红线 1.3×）。Full inline of all 67+70 selectors → 单文件 tsx diff 估计 1500-2500 行，**严重超出** prompt 给的「单文件 tsx diff > 1500 行 → scope 收缩，拆 sub-PR」红线。

### Test pin verification

```bash
# 1) CSS-literal readFileSync pins
$ grep -rnE "readFileSync.*(diff\.css|diff-viewer)" src/
# 仅命中：src/styles/__layout-guard__/cssTestHarness.ts (通用 harness，按文件名加载)
# 这是 P0-1 改造后的状态——所有字面 toContain 已替换为 jsdom cascade。

# 2) layout-swapped-platform-guard 在 line 285 仍 loadStylesheets("base.css", "main.css", "messages.css", "diff-viewer.css")
$ grep -nE "diff-viewer" src/styles/layout-swapped-platform-guard.test.ts
285:      loadStylesheets("base.css", "main.css", "messages.css", "diff-viewer.css");
312:    it("diff-viewer floating anchor picks up sidebar-width offset only under desktop swap", () => {
314:      const anchor = appendDiv(app, "diff-viewer-anchor-floating");
317:      expect(getComputedStyle(anchor).right).toContain("sidebar-width");
320:    it("is-embedded floating anchor is NOT shifted by the swap rule", () => {
328:      expect(getComputedStyle(anchor).right).not.toContain("sidebar-width");
```

**关键约束**：`diff-viewer.css` 必须保留 `.app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded) { right: calc(var(--sidebar-width, 210px) + 20px); }` cascade rule（line 657-659 in current file）—— P0-1 改造保留了 cssRules 实地验证，所以 rule 必须以 CSS 形式存在（无法 inline 为 Tailwind className，因为 `.app.layout-desktop.layout-swapped` 是祖先选择器 + `:not(.is-embedded)` 否定选择器）。

### querySelector pins (DOM contract — className 必须保留 as no-op marker)

`GitDiffPanel.test.tsx` (982 行) + `DiffBlock.test.tsx` (84 行) pins:
- `.diff-line`, `.diff-line.is-selected`
- `.diff-row[data-path=...]`, `.diff-row[data-path=...] .diff-row-actions`
- `.diff-status`, `.diff-section.git-filetree-section`
- `.diff-tree-folder-row.git-filetree-folder-row`
- `.diff-row.git-filetree-row`
- `.diff-counts-inline.git-filetree-badge`
- `.git-filetree-section-header.is-compact`
- `.diff-row-action--preview-{inline,modal}`
- `.diff-split-pane-{new,old}`
- `.git-history-diff-modal`, `.diff-row-actions`
- `.commit-message-engine-icon--spinning`
- `.git-root-current`

GitDiffViewer 其它测试通过 `vi.mock("../../git/components/GitDiffViewer", () => ({ GitDiffViewer: () => <div data-testid="git-diff-viewer" /> }))` 直接 mock，零 DOM contract。

### Cross-file override scan

```bash
$ grep -rE "diff-viewer-pr" src/styles/ | grep -v "diff-viewer.css"
# (空)
$ grep -lr "diff-viewer-pr" src/
src/features/git/components/GitDiffViewer.tsx
src/styles/diff-viewer.css
```

`diff-viewer-pr-*` 子簇（PullRequestSummary section）= **完全隔离**：单 tsx consumer + 单 CSS 文件，零 cross-file cascade override。

## Scope 收缩决策

参考 Phase 4/5/6 scope 收缩 pattern（composer/kanban/settings vendor 都各自拆 3-4 个 sub-PR）+ phase-10 wrap-up 列表「Phase 9.2 — diff.css + diff-viewer.css，拆 5 sub-PR」+ prompt 「如果单文件 tsx diff > 1500 行：scope 收缩，拆 sub-PR」。

**本 worktree 仅做 Phase 9.2 的第 1 个 sub-PR**：

### Sub-PR Phase 9.2.pr — `diff-viewer-pr-*` (PullRequestSummary cluster) inline

**Reasoning**：
1. **最隔离**：`diff-viewer-pr-*` 27 个 selectors 全部在 `PullRequestSummary` 单 sub-component (line 344-520, 177 行) 内，零 cross-component 引用。
2. **最干净**：CSS 内 `.diff-viewer-pr` 簇是一段连续 block（line 32-278, 247 行），无与其它 selector 簇穿插。
3. **零 querySelector pin**：测试通过 `vi.mock` 直接替换 `GitDiffViewer`，DOM contract 完全不影响。
4. **零 cross-file cascade**：`diff-viewer-pr-*` 在其它 CSS 文件零 override。
5. **零 layout-guard 触点**：layout-guard 的 swap-anchor 测试仅涉及 `.diff-viewer-anchor-floating`，与 PR cluster 完全无关。

**Sub-PR 范围**：
- inline `.diff-viewer-pr-*` 27 selectors → Tailwind utility on `PullRequestSummary` component
- 保留 className 作 no-op semantic marker（与 Phase 2-9 既证 pattern 一致）
- 删除 `diff-viewer.css` 内 line 32-278 的 PR cluster（247 行）→ 剩余 css 1129 行
- **bootstrap.ts 完全不动**——`diff-viewer.css` 同名保留
- 不动 `diff.css`
- 不动 `GitDiffPanel.tsx` / `DiffBlock.tsx` / 其它 GitDiff* 组件
- 不动其它 GitDiffViewer 内的 `.diff-viewer-frame` / `.diff-viewer-anchor-*` / `.diff-viewer-list` / `.diff-viewer-header*` / `.diff-viewer-item*` / `.diff-viewer-row` / `.diff-viewer-status` / `.diff-viewer-path` / `.diff-viewer-output*` / `.diff-viewer-placeholder` / `.diff-viewer-loading*` / `.diff-viewer-empty` / `.diff-viewer-sticky` / `.diff-viewer-mode-*` 等簇——defer 到后续 sub-PR。

### Deferred to follow-up sub-PRs

| Sub-PR | Scope | Reason for defer |
|---|---|---|
| 9.2.anchor | `diff-viewer-anchor-*` + `diff-viewer-frame.is-anchor-modal-pager` cluster + swap rules keeper | 含 layout-guard test pin (`.app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded)`)；需独立验证。 |
| 9.2.header | `diff-viewer-header*` / `diff-viewer-mode-*` / `diff-viewer-inline-mode-*` / `diff-viewer-sticky` | header chrome 与 sticky 与 GitDiffViewer 主结构密切；独立 sub-PR。 |
| 9.2.body | `diff-viewer-frame` / `diff-viewer` / `diff-viewer-list` / `diff-viewer-row` / `diff-viewer-item*` / `diff-viewer-output*` / `diff-viewer-status` / `diff-viewer-path` / `diff-viewer-placeholder` / `diff-viewer-loading*` / `diff-viewer-empty` | viewer body chrome，影响整个 list 渲染。 |
| 9.2.panel-chrome | `diff.css` 内 `.diff-panel-*` / `.diff-toolbar*` / `.diff-empty*` 等 GitDiffPanel 主 chrome | GitDiffPanel.tsx 2661 行红线 2.6×，独立 sub-PR。 |
| 9.2.panel-sections | `diff.css` 内 `.diff-section.git-filetree-section` / `.diff-tree-folder-row` / file-section 等 | querySelector pin 较多，独立 sub-PR + DiffBlock 测试覆盖。 |
| 9.2.panel-rows | `diff.css` 内 `.diff-row*` / `.diff-row-actions` / `.diff-row-action--preview-*` / `.diff-status` 等 | querySelector pin 极多。 |
| 9.2.panel-block | `diff.css` 内 `.diff-line*` / `.diff-split-pane-*` / DiffBlock 渲染相关 | DiffBlock 测试有 pin。 |
| 9.2.panel-misc | image diff card / inclusion / commit-scope / section-actions / WorkspaceEditableDiffReviewSurface | 剩余 GitDiffPanel sub-component 簇。 |

## Implementation steps

1. 改 `src/features/git/components/GitDiffViewer.tsx` 的 `PullRequestSummary` (line 344-520)：在所有 `diff-viewer-pr-*` className 后追加 Tailwind utility（沿用 Phase 2-9 既证 pattern——保留 className 作 marker，Tailwind 提供样式）。
2. 删 `src/styles/diff-viewer.css` 的 line 32-278（PR cluster 27 个 selectors，247 行）。其它 65 个 selectors（包括 frame / anchor / header / body / list / mode glyph / sticky / loading / empty + 关键 swap rule）一行不动。
3. `bootstrap.ts` 不动——`diff-viewer.css` 同名保留。
4. 不动 `diff.css`。
5. 不动 GitDiffPanel.tsx / DiffBlock.tsx 等其它 GitDiff* 组件。

## Coss primitive evaluation

PR cluster 包含：section header / meta row / timeline list / activity marker / comment cards / state hints / divider。

| Need | coss primitive | Decision |
|---|---|---|
| section box (`.diff-viewer-pr`) | `Card`? | **No** — PR section 本质上是普通 `<section>` + 边框/阴影/内边距，没有 Card 行为；保持 raw `<section>` + Tailwind。 |
| timeline marker dot | None | hand-rolled — 单 circle DOM，无对应原语。 |
| jump button (`+N / -N`) | `Button`? | **No** — 已用 `ghost` className，保持 raw `<button>` + Tailwind（沿用 Phase 5/6 Home `home-primary-button` 决策）。 |
| timeline expand/collapse button | `Button`? | **No** — 同上。 |

净 Phase 9.2.pr：零 coss primitive 结构性替换，纯 className → Tailwind utility inline。

## Token / utility mapping

参考 Phase 2-9 既证 token 映射：

| CSS rule (delete) | Tailwind inline (append to className) |
|---|---|
| `.diff-viewer-pr { margin: 12px 16px 16px; padding: 16px; border-radius: 14px; border: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--surface-strong) 84%, transparent); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22); }` | `mx-4 mt-3 mb-4 p-4 rounded-[14px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-strong)_84%,transparent)] shadow-[0_12px_30px_rgba(0,0,0,0.22)]` |
| `.diff-viewer-pr-header { display: flex; flex-direction: column; gap: 10px; }` | `flex flex-col gap-2.5` |
| `.diff-viewer-pr-header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }` | `flex items-start justify-between gap-3` |
| `.diff-viewer-pr-title { display: flex; flex-wrap: wrap; gap: 8px; font-size: 18px; font-weight: 600; color: var(--text-strong); }` | `flex flex-wrap gap-2 text-[18px] font-semibold text-[var(--text-strong)]` |
| `.diff-viewer-pr-jump { padding: 4px 10px; font-size: 11px; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }` | `inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] whitespace-nowrap` |
| `.diff-viewer-pr-jump-add { color: #47d488; font-variant-numeric: tabular-nums; }` | `text-[#47d488] tabular-nums` |
| `.diff-viewer-pr-jump-del { color: #ff6b6b; font-variant-numeric: tabular-nums; }` | `text-[#ff6b6b] tabular-nums` |
| `.diff-viewer-pr-jump-sep { color: var(--text-faint); font-variant-numeric: tabular-nums; }` | `text-[var(--text-faint)] tabular-nums` |
| `.diff-viewer-pr-number { color: var(--text-faint); font-variant-numeric: tabular-nums; }` | `text-[var(--text-faint)] tabular-nums` |
| `.diff-viewer-pr-title-text { color: var(--text-stronger); }` | `text-[var(--text-stronger)]` |
| `.diff-viewer-pr-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; color: var(--text-muted); }` | `flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]` |
| `.diff-viewer-pr-author { color: var(--text-strong); font-weight: 600; }` | `font-semibold text-[var(--text-strong)]` |
| `.diff-viewer-pr-sep { color: var(--text-faint); }` | `text-[var(--text-faint)]` |
| `.diff-viewer-pr-branch { font-family: var(--code-font-family); font-size: var(--code-font-size, 11px); padding: 2px 6px; border-radius: 999px; border: 1px solid var(--border-subtle); background: var(--surface-control); color: var(--text-quiet); }` | `font-[var(--code-font-family)] text-[var(--code-font-size,11px)] px-1.5 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-control)] text-[var(--text-quiet)]` |
| `.diff-viewer-pr-pill { font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; background: #2e2418; color: #f2994a; border: 1px solid #6a4a2a; }` | `px-1.5 py-0.5 rounded-full border border-[#6a4a2a] bg-[#2e2418] text-[#f2994a] text-[11px] font-semibold uppercase` |
| `.diff-viewer-pr-body { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }` | `mt-3 pt-3 border-t border-[var(--border-subtle)]` |
| `.diff-viewer-pr-markdown` 13px/text-stronger 基础 + `:where(h1..h6) { margin-top: 16px }` + `:where(p,ul,ol,pre) { margin-top: 10px }` | 基础 → `text-[13px] text-[var(--text-stronger)]`；嵌套 `:where(...)` 选择器无 Tailwind 对应原语，使用 inline `[&_:where(h1,h2,h3,h4,h5,h6)]:mt-4 [&_:where(p,ul,ol,pre)]:mt-2.5` |
| `.diff-viewer-pr-empty { font-size: 13px; color: var(--text-muted); }` | `text-[13px] text-[var(--text-muted)]` |
| `.diff-viewer-pr-timeline { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }` | `mt-4 pt-3 border-t border-[var(--border-subtle)]` |
| `.diff-viewer-pr-timeline-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 12px; color: var(--text-muted); }` | `flex flex-wrap items-center gap-2 mb-3 text-xs text-[var(--text-muted)]` |
| `.diff-viewer-pr-timeline-title { font-weight: 600; color: var(--text-strong); }` | `font-semibold text-[var(--text-strong)]` |
| `.diff-viewer-pr-timeline-count { font-variant-numeric: tabular-nums; }` | `tabular-nums` |
| `.diff-viewer-pr-timeline-button { padding: 4px 10px; font-size: 11px; }` | `px-2.5 py-1 text-[11px]` |
| `.diff-viewer-pr-timeline-list { position: relative; display: flex; flex-direction: column; gap: 14px; padding-left: 14px; }` + `::before { ... }` 时间线纵向线条 | `relative flex flex-col gap-3.5 pl-3.5 before:content-[''] before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-0.5 before:bg-[color-mix(in_srgb,var(--border-strong)_40%,transparent)]` |
| `.diff-viewer-pr-timeline-item { display: flex; gap: 12px; position: relative; }` | `relative flex gap-3` |
| `.diff-viewer-pr-timeline-marker { width: 12px; height: 12px; border-radius: 999px; background: var(--surface-control); border: 2px solid var(--border-strong); margin-top: 3px; flex-shrink: 0; position: relative; z-index: 1; }` | `relative z-[1] w-3 h-3 mt-[3px] rounded-full bg-[var(--surface-control)] border-2 border-[var(--border-strong)] shrink-0` |
| `.diff-viewer-pr-timeline-content { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, var(--surface-strong) 78%, transparent); border: 1px solid var(--border-subtle); }` | `flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-strong)_78%,transparent)]` |
| `.diff-viewer-pr-timeline-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: var(--text-muted); }` | `flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]` |
| `.diff-viewer-pr-timeline-author { color: var(--text-strong); font-weight: 600; }` | `font-semibold text-[var(--text-strong)]` |
| `.diff-viewer-pr-timeline-text { margin-top: 6px; font-size: 13px; color: var(--text-stronger); }` | `mt-1.5 text-[13px] text-[var(--text-stronger)]` |
| `.diff-viewer-pr-comment { margin-top: 8px; font-size: 13px; color: var(--text-stronger); }` + `:where(p, ul, ol, pre) { margin-top: 8px; }` | `mt-2 text-[13px] text-[var(--text-stronger)] [&_:where(p,ul,ol,pre)]:mt-2` |
| `.diff-viewer-pr-timeline-state { font-size: 12px; color: var(--text-muted); padding-left: 12px; }` | `pl-3 text-xs text-[var(--text-muted)]` |
| `.diff-viewer-pr-timeline-error { color: var(--text-error, #ff8d8d); }` | `text-[var(--text-error,#ff8d8d)]` |
| `.diff-viewer-pr-timeline-divider { font-size: 12px; color: var(--text-faint); padding-left: 12px; }` | `pl-3 text-xs text-[var(--text-faint)]` |

## Verification plan

```bash
npm run lint
npm run typecheck
npm run test:layout-guard               # 46/46 必须 pass，验证 diff-viewer.css 仍能被 loadStylesheets 加载 + swap-anchor cascade rule 仍在
npm run check:large-files:gate          # found=0 必须保持
npx vitest run src/features/git/components/GitDiffPanel.test.tsx
npx vitest run src/features/git/components/DiffBlock.test.tsx
npx vitest run src/features/git-history/components/GitHistoryPanel.test.tsx
npx vitest run src/styles/layout-swapped-platform-guard.test.ts
```

## Expected diff stats

- `src/features/git/components/GitDiffViewer.tsx`：~50-100 行净改动（PR section 27 个 className 各加 Tailwind tail，单文件 diff 远低于 1500 行红线）
- `src/styles/diff-viewer.css`：1376 → 1129 行（删 247 行）
- `bootstrap.ts`：无变更
- 其它文件：无变更

## Execution-time results (2026-05-16)

| Check | Result |
|---|---|
| `npm run lint` | ✅ exit 0 |
| `npm run typecheck` | ✅ exit 0 |
| `npm run test:layout-guard` | ✅ 46/46 pass — `.app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded)` cascade 仍正确（仍在 css line 418） |
| `npm run check:large-files:gate` | ✅ found=0 |
| `npx vitest run src/features/git/components/GitDiffPanel.test.tsx` | ✅ 37 pass |
| `npx vitest run src/features/git/components/DiffBlock.test.tsx` | ✅ 4 pass |
| `npx vitest run src/features/git-history/components/GitHistoryPanel.test.tsx` | ✅ 40 pass |
| `npx vitest run src/features/layout/components/DesktopLayout.test.tsx` | ✅ 4 pass |
| `npx vitest run src/features/layout/hooks/useLayoutNodes.client-ui-visibility.test.tsx src/features/status-panel/components/StatusPanel.test.tsx src/features/session-activity/components/WorkspaceSessionActivityPanel.test.tsx` | ✅ 122 pass |

### Diff stats

```
src/features/git/components/GitDiffViewer.tsx   |  94 ++++++----    (+58 / -36)
src/styles/diff-viewer.css                      | 255 +------------  (+6 / -249)
2 files changed, 64 insertions(+), 285 deletions(-)
```

- `GitDiffViewer.tsx` 单文件 diff = 179 行 raw（94 行改动行 = 58 insertions + 36 deletions + 上下文）→ 远低于 1500 行红线
- `diff-viewer.css` 1376 → 1137 行（净删 239 行 + 加 8 行注释）

## After Phase 9.2 (this sub-PR)

- `bootstrap.ts` CSS import count: 40 → 40 (unchanged)
- `diff-viewer.css`：1376 → 1137 行（PR cluster 27 selectors 已 inline）
- `diff.css`：2110 行（未动，defer 到 9.2.panel-* sub-PRs）
- Phase 9.2 净进度：1/9 sub-PR 已完成（PR cluster only）

## Encountered hook side-effects (2026-05-16, 调查记录)

测试运行过程中发现，**任何触发 prettier hook 的命令**（如 `git stash`、可能由编辑器/agent 监听器触发的 file watcher）会自动展开 `src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx`（HEAD 内是 25 行 minified bundle）为 7025 行 prettier-formatted 版本。这是**scope 外**且**HEAD 内本就是 minified**的脏状态副作用：

- 原 HEAD 文件：25 行 minified（约 110KB）
- prettier 展开后：7025 行 formatted（约 280KB），触发 large-files gate fail
- 同时连带生成 untracked file `SpecHubPresentationalImpl.helpers.tsx`（hook/prettier 副作用，约 982 行）

**应对**：每次 hook 触发后，立刻 `git checkout HEAD -- src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx` 恢复 minified 状态，并删除 untracked `helpers.tsx`（不属于本 phase scope）。

**Follow-up**：建议 orchestrator 检查 spec-hub minified bundle 的工作目录稳定性 + 调整 prettier ignore 配置（`.prettierignore` 加上该 minified 文件路径），避免 hook 噪音。

## Follow-up sub-PRs queued

未完成的 Phase 9.2 sub-PRs（按 phase-9 plan 列举顺序）：

- **9.2.anchor** — `diff-viewer-anchor-*` cluster + `diff-viewer-frame.is-anchor-modal-pager` rules + 关键 swap rule keeper（`diff-viewer.css` line 418 必须保留 layout-guard test pin）
- **9.2.header** — `diff-viewer-header*` / `diff-viewer-mode-*` / `diff-viewer-inline-mode-*` / `diff-viewer-sticky` cluster
- **9.2.body** — `diff-viewer-frame` / `.diff-viewer` / `diff-viewer-list` / `diff-viewer-row` / `diff-viewer-item*` / `diff-viewer-output*` / `diff-viewer-status` / `diff-viewer-path` / `diff-viewer-placeholder` / `diff-viewer-loading*` / `diff-viewer-empty` cluster
- **9.2.panel-chrome** — `diff.css` 内 GitDiffPanel 主 chrome / toolbar / empty 等
- **9.2.panel-sections** — `diff.css` 内 file-section / git-filetree-section / folder-row cluster（querySelector pin 多）
- **9.2.panel-rows** — `diff.css` 内 diff-row* / diff-row-actions / diff-row-action--preview-* / diff-status 等
- **9.2.panel-block** — `diff.css` 内 diff-line* / diff-split-pane-* cluster（DiffBlock 测试有 pin）
- **9.2.panel-misc** — image diff card / inclusion / commit-scope / section-actions / WorkspaceEditableDiffReviewSurface 剩余 sub-component 簇

## Orchestrator 待办

下列项**不能由本 sub-PR worktree 改**，必须在 orchestrator merge / 后续 phase 阶段统一处理：

1. **`docs/migration-to-coss-ui.md`**：Phase 9.2 行追加 sub-progress 注解（`PullRequestSummary cluster inline 已完成`，剩余 8 sub-PR queued）。
2. **`.trellis/tasks/05-16-migrate-css-to-coss-ui/prd.md`**：Phase 9.2 节追加 sub-PR 进度跟踪表。
3. **`.prettierignore`**：建议加 `src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx` 防止 hook 副作用展开 minified bundle。
4. **`package.json` / `package-lock.json`**：本 sub-PR 不引入新依赖，**无变更**。
5. **`src/styles/base.css` / `src/styles/themes.*.css`**：本 sub-PR 不改 token 系——**无变更**。
6. **`src/bootstrap.ts`**：本 sub-PR **无变更**（diff-viewer.css 同名保留 in-place）。
