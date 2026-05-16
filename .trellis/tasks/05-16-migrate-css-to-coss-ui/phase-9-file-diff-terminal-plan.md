# Phase 9 — File / Diff / Terminal Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 9 (File / Diff / Terminal)
> Date: 2026-05-16
> Agent: claude-agent (worktree `agent-a822bb46a849a97a8`, parallel with Phase 7 git-history & Phase 8 spec-hub)

## Worktree start state verification

- `git rev-parse HEAD` (after `git reset --hard d09979b5`) → `d09979b5 chore(trellis): 记录会话`
- Baseline (no changes):
  - `npm run typecheck` ✅ exit 0（PRD 老 baseline 写 2-3 error，但在 commit d09979b5 / Phase 6 完成后实际 clean）
  - `npm run lint` ✅ exit 0
- 工作树为干净状态，未引入任何 phase 1-6 之外的修改。

## Discovery summary

PRD-declared scope = `file-tree.css`, `diff.css`, `terminal.css`, `detached-file-explorer.css`, `opencode-panel.css`, plus 推论上隐含的 `diff-viewer.css`, `file-view-panel.css`, `file-view-panel-shell.css`（bootstrap.ts 中与 diff/file-tree 同簇）。

| File | Lines | Selectors | Primary tsx consumer (lines / className count) | CSS-literal pin? | Verdict |
|---|---:|---:|---|---|---|
| `terminal.css` | 193 | ~25 | `TerminalDock.tsx` (82 / 17), `TerminalPanel.tsx` (22 / 4) | 否 | **DEFER → Phase 9.4** — xterm 描述子 `.xterm`, `.xterm-screen`, `.xterm-viewport`, `.composition-view` overrides 是对 xterm.js 注入 DOM 的级联（不在 React tree 上），需 keeper 文件；且 `.terminal-panel { grid-row: 5; grid-column: 1 / -1; }` 与 `main.css:4` `.main { grid-template-rows: auto 1fr auto auto auto auto }` 形成跨文件契约。combined 风险超过本 phase 收益。 |
| `detached-file-explorer.css` | 236 | ~22 | `DetachedFileExplorerWindow.tsx` (244 / 11), `FileExplorerWorkspace.tsx` (286 / 5) | 否 | **CONVERT** — 中等体量、隔离 consumer（detached window 独立 webview，与主 webview 解耦）、无字面值 pin、无 xterm 类外部 DOM。`.detached-file-explorer-window .file-tree-action { display: none; }` 这条 descendant override 是对 `FileTreePanel` 内部元素的 detached-only 覆写，需 keeper 文件。 |
| `file-view-panel-shell.css` | 135 | ~16 | `FileViewBody.tsx` / `FileViewPanel.tsx` (1947) — 主要用作 `.fvp` 与 `--fvp-*` token 定义入口 | 否 | **DEFER → Phase 9.3** — 定义 `--fvp-token-comment/punctuation/property/number/string/operator/keyword/function` 等 8+ CSS vars，被 `file-view-panel.css` 487 selectors 大量消费。删除 shell 会立即破坏 panel。必须随 `file-view-panel.css` 一起迁移。 |
| `file-tree.css` | 1247 | 211 | `FileTreePanel.tsx` (2280 / 45) + `FileTreeRootActions.tsx` (155) | 否（仅 DOM querySelector pins） | **DEFER → Phase 9.1** — 主 consumer 单文件 2280 行（远超 1000 行红线），FileTreePanel.run.test.tsx 1373 行有大量 `.file-tree-row.is-root` / `.file-tree-root-chevron` / `.file-tree-root-row` / `.file-tree-top-zone` / `.file-tree-list` / `.file-tree-chevron` / `.file-tree-action` querySelector 断言（需保留 className）。规模 = composer cluster 量级。需切 sub-PR（9.1a 主面板 / 9.1b root actions / 9.1c lazy/search subsections）。 |
| `file-view-panel.css` | 2364 | 487 | `FileViewPanel.tsx` (1947 / ?) + `FileViewBody.tsx` (751) + `FileViewPanel.test.tsx` (2641) | 否 | **DEFER → Phase 9.3** — 双重红线（CSS 2364 行 + tsx 1947+751 行 + test 2641 行），487 selectors 涵盖 tabs / preview / outline / markdown / pdf / image / structured / tabular / git status 等多 surface。需切 sub-PR。 |
| `diff.css` | 2110 | 298 | `GitDiffPanel.tsx` (2661 / ?) + `DiffBlock.tsx` (352) + `GitDiffPanelFileSections.tsx` (517) + `GitDiffPanelCommitScope.tsx` (368) + `GitDiffPanelSectionActions.tsx` (113) + `GitDiffPanelInclusion.tsx` (129) + `WorkspaceEditableDiffReviewSurface.tsx` (403) + `GitDiffPanel.test.tsx` (982) + `DiffBlock.test.tsx` (84) | 否（仅 DOM querySelector pins，如 `.diff-line`, `.diff-row[data-path=...]`, `.diff-status`, `.diff-section.git-filetree-section`, `.diff-tree-folder-row.git-filetree-folder-row`, `.diff-row.git-filetree-row`, `.diff-counts-inline.git-filetree-badge`, `.diff-row-action--preview-{inline,modal}`, `.diff-split-pane-{new,old}`, `.git-history-diff-modal`, `.diff-row-actions`） | **DEFER → Phase 9.2** — 主 consumer `GitDiffPanel.tsx` 2661 行（超红线 2.6×），CSS 2110 行 / 298 selectors。规模最大。需切 sub-PR。 |
| `diff-viewer.css` | 1376 | ~180 | `GitDiffViewer.tsx` (1317) | **YES** — `layout-swapped-platform-guard.test.ts:32-36` 用 `readFileSync` 读取整文件 + 39+139 行字面断言 `.app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded) {` | **DEFER → Phase 9.2** — CSS 字面值 pin（同 Phase 3 messages files / Phase 6 settings.part2 模式）+ 主 consumer `GitDiffViewer.tsx` 1317 行超红线。需在测试改造 + sub-PR 拆解之后再处理。 |
| `opencode-panel.css` | 915 | 125 | `OpenCodeControlPanel.tsx` (1011 / 16) + 4 sub section files (subsections sum 278 / ?) + `OpenCodeControlPanel.test.tsx` (236) | 否（querySelector `.opencode-panel-toggle` only） | **DEFER → Phase 9.5** — 主 consumer `OpenCodeControlPanel.tsx` 刚好 1011 行（红线边缘）。建议合并到独立 sub-PR 处理，因 OpenCode runtime 触及 `codex-unified-exec-override-contract.md` 相关 vendor settings 链路，回归风险高。 |

### Test-pin verification

```bash
# 1) CSS-literal readFileSync pins for Phase 9 files
grep -rnE "readFileSync.*(file-tree|diff\.css|diff-viewer|terminal\.css|detached-file-explorer|opencode-panel|file-view-panel)" src/
# 仅命中：src/styles/layout-swapped-platform-guard.test.ts:32 (diff-viewer.css)

# 2) layout-swapped-platform-guard 实际断言 in Phase 9 css range
grep -nE "diff-viewer|file-tree|terminal|opencode|detached-file|file-view-panel|diff\.css" src/styles/layout-swapped-platform-guard.test.ts
# Line 31-36: readFileSync diff-viewer.css → diffViewerCss 变量
# Line 138-140: expect(diffViewerCss).toContain(".app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded) {")
# 无其他 Phase 9 文件字面 pin
```

### `terminal-shell-configuration.md` contract verification

Spec 触点（`src-tauri/src/settings/...`, `useAppSettings`, `SettingsView.tsx`）与 Phase 9 范围**完全不相交**：
- Terminal CSS 仅样式 chrome（`.terminal-panel`, `.terminal-shell`, `.terminal-surface`, `.terminal-overlay`, `.terminal-tab`, `.terminal-tab-add`, `.terminal-header`, `.terminal-tabs`, `.terminal-body`），与 `terminalShellPath` 字段无关。
- `useTerminalSession.ts` 的 xterm 接入 + shell spawn 在 `src/features/terminal/hooks/`，本 phase 不动。
- 决定 defer `terminal.css` 也是因为 xterm overrides 风险，与 contract 无关。

## Key risks identified

### 1. `diff-viewer.css` 是 layout-guard CSS-literal pin

`layout-swapped-platform-guard.test.ts:32-36` 用 `readFileSync` 读 `diff-viewer.css`，并在 line 139 断言 `.app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded) {` 字面存在。任何删除或重构必须先改造测试或保留该字面文本。**本 phase 完全不动 `diff-viewer.css`**。

### 2. 7/8 文件 tsx consumer 都超过 1000 行红线

| File | 主 consumer | 行 | 状态 |
|---|---|---:|---|
| file-tree.css | FileTreePanel.tsx | 2280 | 超红线 2.3× |
| file-view-panel.css | FileViewPanel.tsx | 1947 | 超红线 1.9× |
| diff.css | GitDiffPanel.tsx | 2661 | 超红线 2.6× |
| diff-viewer.css | GitDiffViewer.tsx | 1317 | 超红线 1.3× |
| opencode-panel.css | OpenCodeControlPanel.tsx | 1011 | 边缘红线 |
| terminal.css | TerminalDock.tsx + TerminalPanel.tsx | 82 + 22 | 安全 |
| detached-file-explorer.css | DetachedFileExplorerWindow.tsx | 244 | 安全 |
| file-view-panel-shell.css | FileViewBody.tsx / FileViewPanel.tsx | 751 / 1947 | 超红线 |

按 prompt 约束 "单文件 tsx diff > 1000 行收缩"，仅 `terminal.css` 与 `detached-file-explorer.css` 在 safe zone。

### 3. xterm DOM overrides 不可直接 inline

`terminal.css` 内 `.terminal-surface .xterm`, `.terminal-surface .xterm-screen`, `.terminal-surface .xterm-viewport`, `.terminal-surface .composition-view` 共 4-5 条 cascade override（包含 `!important`）是对 `@xterm/xterm` 注入 DOM 的级联（不在 React tree 上），无法 inline 为 Tailwind className——必须保留为 CSS 文件。同 Phase 5 `release-notes-markdown.css` 与 `note-cards-rich-input.css` 模式。

加上 `.terminal-panel { grid-row: 5; grid-column: 1 / -1; }` 与 `main.css:4` `.main { grid-template-rows: auto 1fr auto auto auto auto }` 之间的跨文件契约（terminal 占据 main grid row 5），inline 替换需要同时验证 main grid + collapse / expand state + resizable height 等多触点。

**净结果**：terminal.css 需要 keeper + 跨文件契约验证 = 单独的 Phase 9.4 sub-PR。本 phase 不处理。

### 4. `file-view-panel-shell.css` 与 `file-view-panel.css` 强耦合

`file-view-panel-shell.css` 定义 `--fvp-token-comment` / `--fvp-token-keyword` / `--fvp-reader-surface` 等 8+ CSS vars，被 `file-view-panel.css` (487 selectors) 大量消费。删除 shell 立即破坏 panel；删除 panel 而保留 shell 等于 dead CSS。两者必须一起迁移（Phase 9.3）。

### 5. `detached-file-explorer.css` 有 `.detached-file-explorer-window .file-tree-action { display: none; }` 这条 cross-component descendant override

这条规则在 detached webview 中隐藏 `FileTreePanel` 内部的 row "+" action（不允许 detached explorer 触发 composer mention insertion）。`.file-tree-action` 的所有权属于 `FileTreePanel.tsx`（Phase 9.1 deferred），所以 detached 这条 override 需要一个**根 className 条件**或**keeper CSS**来实现 detached-only visibility。

**方案**：保留为 keeper `detached-file-explorer-keepers.css`，仅保留这 1 条 + 任何其它跨组件 cascade。同 Phase 5 `release-notes-markdown.css` / `note-cards-rich-input.css` pattern。

### 6. Token 连续性（同 Phase 2-6）

`detached-file-explorer.css` 使用项目老 token：`--surface-messages`, `--surface-topbar`, `--titlebar-height`, `--titlebar-inset-left`, `--border-subtle`, `--text-faint`, `--text-muted`, `--text-stronger`, `--text-strong`, `--surface-hover`, `--surface-card`, `--border-strong`, `--border-stronger`, `--detached-menubar-bg/border`（color-mix 自定义 var）。Phase 1 已保留这些；Phase 9 沿用既证的「coss semantic token 优先 + 项目 var fallback」strategy。

## coss primitives evaluated and decision

| Need | coss primitive | Decision |
|---|---|---|
| `DetachedFileExplorerWindow.tsx` 的 titlebar / menubar （单行 chrome） | None（无对应原语） | 直接 Tailwind，不引入 primitive。 |
| `detached-file-explorer-sidebar-expand` 按钮（icon-only floating） | `Button` (`@/components/ui/button`)? | **Not used in Phase 9** — 单按钮 + icon-only，已用 codicon class，沿用 Phase 5 `Home.tsx` `home-primary-button` 决策（保持 raw `<button>` + Tailwind）。**Follow-up**：queued for trivial Button swap pass。 |
| `detached-file-explorer-resizer` 拖动条 | `Splitter` | 同 Phase 6 SkillsSection 决策——coss 暂无 `Splitter` 原语；保留 hand-rolled pointer drag。**Follow-up**：已在 Phase 6.5 / 6.6 follow-up 中记录的 Splitter 引入计划同时涵盖。 |

**Net Phase 9**: Pure styling pass on 1 file (`detached-file-explorer.css`)。零 coss primitive 结构性替换。零 markup 变更——仅在 className 后追加 Tailwind utility（沿用 Phase 2-6 既证 pattern）。

## Per-file processing

### Drop list

| File | Strategy | Token / utility surface |
|---|---|---|
| `detached-file-explorer.css` | 内联 Tailwind 到 `DetachedFileExplorerWindow.tsx`（244 行）+ `FileExplorerWorkspace.tsx`（minor — `.detached-file-explorer-workspace`, `.detached-file-explorer-sidebar`, `.detached-file-explorer-resizer`, `.detached-file-explorer-viewer`, `.detached-file-explorer-sidebar-expand*`, `.detached-file-explorer-empty*`）。保留全部 `detached-file-explorer-*` className 作为 no-op semantic marker（与 Phase 2-6 一致）。`@media (max-width: 860px)` 响应规则 → Tailwind `max-[860px]:` arbitrary breakpoint。`.macos-desktop .detached-file-explorer-menubar` 跨平台条件 → `[.macos-desktop_&]:pl-[calc(68px+var(--titlebar-inset-left,0px))]` Tailwind arbitrary parent selector。`.detached-file-explorer-window .file-tree-action { display: none; }` cross-component override → **保留在原文件 `detached-file-explorer.css` 作为 1-rule keeper**（236 行 → 21 行；剩下的 1 条规则即 keeper）。这样 `bootstrap.ts` 不需要修改 import 路径——满足 prompt 约束「不要动 `src/bootstrap.ts`」。`--detached-menubar-bg` / `--detached-menubar-border` 两个 color-mix() 计算的 CSS var（原 `.app.detached-file-explorer-window {}` block 中定义）移到 `DetachedFileExplorerWindow.tsx` 的 `style={{ ... }}` 上设置。`--titlebar-height` / `--titlebar-inset-left` 等已有的 root token 来自 `globals.css` / `base.css`，不需要改动。 | `flex flex-col w-screen h-screen min-w-0 min-h-0 bg-[var(--surface-messages)]` + custom vars `--detached-menubar-bg`/`--detached-menubar-border` 在 `style={}` inline 设置。menubar `flex items-center min-h-[24px] px-2.5 border-b bg-[var(--detached-menubar-bg)] border-[var(--detached-menubar-border)] shrink-0`。workspace grid `grid grid-cols-[minmax(220px,var(--detached-file-explorer-sidebar-width,320px))_10px_minmax(0,1fr)] min-w-0 min-h-0 flex-1 overflow-hidden relative bg-[var(--surface-messages)]`。collapsed state `is-sidebar-collapsed` → `[&.is-sidebar-collapsed]:grid-cols-[0_0_minmax(0,1fr)]`. resizer `relative min-h-0 cursor-col-resize z-[2] bg-transparent` + `::before` pseudo `before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:w-[3px] before:h-16 before:rounded-full before:bg-[color-mix(in_srgb,var(--border-strong)_52%,transparent)] before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-[0.72] before:transition-[opacity,background-color,width] before:duration-150` + `:hover:before:w-1 hover:before:opacity-[0.96] hover:before:bg-[color-mix(in_srgb,var(--border-stronger)_72%,transparent)]`. expand button `absolute top-2 left-2 z-[4] inline-flex items-center justify-center w-6 h-6 border border-transparent rounded-md bg-transparent text-[var(--text-faint)] transition-colors duration-[120ms]` + hover `hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] hover:bg-[color-mix(in_srgb,var(--surface-hover)_68%,var(--surface-card))]`. empty / unavailable `flex flex-col justify-center items-center gap-2.5 h-full p-8 text-center`。`detached-file-explorer-titlebar*` 在 CSS 中定义但 tsx 中无 consumer（dead），inline 时不需要处理 className，对应 CSS rule 随文件缩减自动消失。 |

### Skip list (deferred — split into Phase 9.1 / 9.2 / 9.3 / 9.4 / 9.5)

| File | 推迟到 | Reason |
|---|---|---|
| `file-tree.css` (1247 行) | Phase 9.1 | FileTreePanel.tsx 2280 行红线 2.3×，sub-PR 9.1a 主面板 / 9.1b root actions / 9.1c lazy/search subsections。 |
| `diff.css` (2110 行) | Phase 9.2 | GitDiffPanel.tsx 2661 行红线 2.6×，sub-PR 9.2a panel chrome / 9.2b file sections / 9.2c row actions / 9.2d filetree section + image diff card。 |
| `diff-viewer.css` (1376 行) | Phase 9.2 | 字面值 pin + GitDiffViewer.tsx 1317 行红线，先改造 layout-swapped-platform-guard line 139 pin 为行为断言，再处理。 |
| `file-view-panel-shell.css` (135 行) | Phase 9.3 | 与 `file-view-panel.css` 强耦合（共享 `--fvp-*` token），必须一起迁移。 |
| `file-view-panel.css` (2364 行) | Phase 9.3 | FileViewPanel.tsx 1947 行红线 1.9× + 487 selectors，sub-PR 9.3a frame / 9.3b preview surfaces (markdown / pdf / image / structured / tabular) / 9.3c outline & tabs / 9.3d shell vars。 |
| `terminal.css` (193 行) | Phase 9.4 | xterm DOM overrides keeper + main grid 跨文件契约。独立 sub-PR 处理，验证 terminal open/close / resize / xterm theme switch。 |
| `opencode-panel.css` (915 行) | Phase 9.5 | OpenCodeControlPanel.tsx 1011 行边缘红线 + `codex-unified-exec-override-contract.md` 相关 vendor settings 链路回归风险。 |

## Orchestrator 待办清单（合并阶段统一做，不在本 worktree 改）

下列项**不能由本 phase 9 worktree 改**，必须在 orchestrator merge 阶段一次性处理：

1. **`src/bootstrap.ts`**：**无需变更**。本 phase 把 `detached-file-explorer.css` 内联后将原文件 in-place 缩成 21 行 keeper（保留同名文件 + 同一个 import path），这样 bootstrap 的 line 19 `import "./styles/detached-file-explorer.css"` 仍然合法。Phase 7 与 Phase 8 worktree 各自的 bootstrap.ts 增删 orchestrator 仍需合并（与本 phase 无冲突）。
   - **如果 orchestrator 偏好统一命名**：可在 merge 阶段把文件改名为 `detached-file-explorer-keepers.css` + 同步改 bootstrap.ts；这是 nice-to-have，不影响功能。
2. **`docs/migration-to-coss-ui.md`**：
   - Phase 总览表 Phase 9 行：状态 `☐` → `✅ done (2026-05-16, 待 commit)`，描述追加 "scope 大幅收缩 → 仅 `detached-file-explorer.css`（236 行 → 21 行 in-place keeper）已处理；7 个文件全部 defer（file-tree → Phase 9.1, diff + diff-viewer → Phase 9.2, file-view-panel + shell → Phase 9.3, terminal → Phase 9.4, opencode-panel → Phase 9.5）"。
   - Follow-up「组件与契约」节追加 7 条 Phase 9.x follow-up 项（Phase 9.1 file-tree / 9.2 diff + diff-viewer / 9.3 file-view-panel + shell / 9.4 terminal / 9.5 opencode-panel / Button swap for sidebar-expand / Splitter primitive）——参见下文 "Follow-ups created by Phase 9"。
   - 共享文件——只有 orchestrator 改。
3. **`.trellis/tasks/05-16-migrate-css-to-coss-ui/prd.md`**：
   - Phase 9 节追加 "完成状态（2026-05-16）" 子节，复制本 plan doc 的 "实际产出" 与 "scope 调整" 段。建议 commit message: `refactor(coss-ui): Phase 9 detached file explorer 切到 Tailwind/coss token (scope 大幅收缩)`。
   - 共享文件——只有 orchestrator 改。
4. **`package.json` / `package-lock.json`**：本 phase 不引入新依赖，**无变更**——orchestrator 无需处理。
5. **`src/styles/base.css` / `src/styles/themes.*.css`**：本 phase 不改 token 系——**无变更**。
6. **Phase 7 / Phase 8 worktree 冲突可能区域**：
   - bootstrap.ts 行号合并（Phase 7 git-history 与 Phase 8 spec-hub 也在改 import）——orchestrator 按 phase 顺序逐项 merge，最后只保留各 phase 的净增删。
   - docs/migration-to-coss-ui.md Phase 总览表 + follow-up 节同样需要 orchestrator 合并各 phase 的并发编辑。

## Implementation order

1. 将 `src/styles/detached-file-explorer.css` 内容**就地缩成 1-rule keeper**（保留 `.detached-file-explorer-window .file-tree-action { display: none; }` + header 注释，删除 235 行其它规则）。bootstrap.ts 同名 import 自动继续工作——**避免触碰 bootstrap.ts**。
2. 修改 `src/features/files/components/DetachedFileExplorerWindow.tsx`：将 `detached-file-explorer-*` className 后追加 Tailwind utility；保留 className 作为 no-op marker。同时在根 div 的 `style={{...}}` 上补充 `--detached-menubar-bg` / `--detached-menubar-border` 两个 CSS var（原本由 CSS 文件提供）。
3. 修改 `src/features/files/components/FileExplorerWorkspace.tsx`：对 `detached-file-explorer-workspace*`, `detached-file-explorer-sidebar*`, `detached-file-explorer-resizer`, `detached-file-explorer-viewer`, `detached-file-explorer-sidebar-expand*`, `detached-file-explorer-empty*` 处理同上。

After every step:
- `npm run lint` + `npm run typecheck` (incremental check)

End-of-phase:
- `npm run test` (full)
- `npm run test:layout-guard`
- `npm run check:large-files:gate`
- 定向 vitest: `FileExplorerWorkspace.test.tsx`（如果存在）, 任何 detached file explorer test

## Verification checklist

```bash
npm run lint
npm run typecheck
npm run test
npm run test:layout-guard
npm run check:large-files:gate
```

Targeted runs:
- `npx vitest run src/features/files/components/FileExplorerWorkspace.test.tsx`
- `npx vitest run src/features/files/components/FileTreePanel.detached.test.tsx`
- `npx vitest run src/features/files/components/DetachedFileExplorerWindow.test.tsx`
- `npx vitest run src/styles/layout-swapped-platform-guard.test.ts`（验证 diff-viewer.css 文字 pin 全保留）

### Execution-time results (2026-05-16)

| Check | Result |
|---|---|
| `npm run lint` | ✅ exit 0 |
| `npm run typecheck` | ✅ exit 0（与 Phase 9 baseline 一致，无新错） |
| `npx vitest run` 3 targeted (FileExplorerWorkspace + FileTreePanel.detached + DetachedFileExplorerWindow) | ✅ PASS (8) FAIL (0) |
| `npm run test:layout-guard` | ✅ 10/10 pass — diff-viewer.css 字面 pin (`.app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded) {`) 保留 |
| `npm run check:large-files:gate` | ✅ found=0 |
| `npm test` (batched, 477 文件 / 120 batch) | ✅ 全 477 文件 pass，零 FAIL |

### Diff stats

```
src/features/files/components/DetachedFileExplorerWindow.tsx  |  33 ++-
src/features/files/components/FileExplorerWorkspace.tsx       |  18 +-
src/styles/detached-file-explorer.css                         | 253 ++-------------------
3 files changed, 53 insertions(+), 251 deletions(-)
```

单文件 tsx diff 全在 33 / 18 行（远低于 1000 行红线）。

## Follow-ups created by Phase 9

- **Phase 9.1 — file-tree coss 化**：`file-tree.css` (1247 行 / 211 selectors)。主 consumer `FileTreePanel.tsx` (2280) 超红线 2.3×。需切 sub-PR：
  - 9.1a — 主面板 chrome (`file-tree-panel`, `file-tree-top-zone`, `file-tree-tool-row`, `file-tree-tabs-wrap`, `file-tree-root-row`)
  - 9.1b — Root actions (`file-tree-root-action*`, `file-tree-root-action-danger`, `file-tree-root-wrap`, `file-tree-root-actions` hover gating)
  - 9.1c — Lazy / search subsections (`file-tree-lazy-state`, `file-tree-lazy-retry`, `file-tree-search`, `file-tree-search-inline`, `file-tree-loading-row`, `file-tree-empty`, `file-tree-children`, `file-tree-row`, `file-tree-chevron`, `file-tree-spacer`, `file-tree-icon`, `file-tree-name`, `file-tree-action`, `file-tree-toggle`, `file-tree-count`, `file-tree-meta`)
  - 注意 `FileTreePanel.run.test.tsx` 1373 行有大量 `.file-tree-row.is-root` / `.file-tree-root-chevron` / `.file-tree-root-row` / `.file-tree-top-zone` / `.file-tree-list` / `.file-tree-chevron` / `.file-tree-action` querySelector 断言——className 全部保留为 no-op marker。
- **Phase 9.2 — diff + diff-viewer coss 化**：`diff.css` (2110 行) + `diff-viewer.css` (1376 行)。GitDiffPanel.tsx (2661) + GitDiffViewer.tsx (1317) 双超红线。
  - 先改造 `layout-swapped-platform-guard.test.ts:139` 的 CSS-literal pin `.app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded) {` 为行为断言（jsdom render `GitDiffViewer` 后 querySelector + getComputedStyle 或 className contract），随后即可处理 `diff-viewer.css`。
  - 推荐拆 sub-PR：9.2a diff panel chrome / 9.2b diff file sections / 9.2c diff row actions / 9.2d diff filetree section + image diff card / 9.2e diff-viewer floating anchor + viewer body。
  - querySelector pins 极多（DiffBlock.test.tsx + GitDiffPanel.test.tsx）：`.diff-line`, `.diff-line.is-selected`, `.diff-row[data-path=...]`, `.diff-status`, `.diff-section.git-filetree-section`, `.diff-tree-folder-row.git-filetree-folder-row`, `.diff-row.git-filetree-row`, `.diff-counts-inline.git-filetree-badge`, `.diff-row-action--preview-{inline,modal}`, `.diff-split-pane-{new,old}`, `.git-history-diff-modal`, `.diff-row-actions`。全部保留为 no-op marker。
- **Phase 9.3 — file-view-panel + shell coss 化**：`file-view-panel-shell.css` (135 行) + `file-view-panel.css` (2364 行)。两者通过 `.fvp` + `--fvp-*` token 强耦合。FileViewPanel.tsx (1947) 红线 1.9×，487 selectors。推荐拆 sub-PR：9.3a frame (`fvp`, `fvp-tabs`, `fvp-tab*`) / 9.3b preview surfaces (markdown / pdf / image / structured / tabular) / 9.3c outline & tabs / 9.3d shell vars 整体移到 `themes.*.css` 或 keeper。
- **Phase 9.4 — terminal coss 化**：`terminal.css` (193 行)。xterm DOM overrides `.xterm`, `.xterm-screen`, `.xterm-viewport`, `.composition-view` 需保留为 keeper（同 Phase 5 `release-notes-markdown.css` 模式）。`.terminal-panel` 的 `grid-row: 5; grid-column: 1 / -1;` 与 `main.css:4` `.main { grid-template-rows: auto 1fr auto auto auto auto }` 跨文件契约需在 inline 后验证 terminal open/close/resize state。
- **Phase 9.5 — opencode-panel coss 化**：`opencode-panel.css` (915 行)。OpenCodeControlPanel.tsx (1011) 边缘红线。需注意 `codex-unified-exec-override-contract.md` 触点（虽 OpenCode 走自己的 runtime，但 vendor cluster 共享同一份 settings 编辑流程）。125 selectors 覆盖 grid + 5+ section card + connection indicator + advanced/mcp/provider/sessions 子 section。
- **Phase 9 follow-up — coss `Button` primitive 替换 `detached-file-explorer-sidebar-expand`**：单按钮 icon-only floating，trivial swap，本 phase 保留 raw `<button>` + Tailwind。
- **Phase 9 follow-up — coss / 第三方 `Splitter` 引入**：detached file explorer sidebar resizer 与 SkillsSection splitter / git-history compare splitter / 等多处 hand-rolled splitter 统一替换。

## After Phase 9

bootstrap.ts CSS import count: 40 → expected **40**（unchanged — `detached-file-explorer.css` 同名保留，内容从 236 行缩成 21 行 keeper）。

Files deleted (0 total)。
Files added (0 total)。
Files in-place shrunk (1 total): `detached-file-explorer.css` (236 → 21 行)。

Phase 9 净进度：1/8 文件已处理（12.5%），7 个文件全部 defer 到 Phase 9.1 / 9.2 / 9.3 / 9.4 / 9.5（与 Phase 4 5 6 同形 scope 收缩 pattern）。
