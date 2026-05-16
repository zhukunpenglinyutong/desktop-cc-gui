# Phase 7 — Git History plan & execution log

> Generated 2026-05-16. Status: **IMPLEMENTED — pending orchestrator merge**.

## 1. Discovery

### CSS asset

| 文件 | 行 | 顶层 selector | 备注 |
|---|---|---|---|
| `git-history.css` | 5 | 0 | aggregator entry，5 个 `@import` 链路；不 import `part1.overview.css` 与 `part2.pr-dialog.css`（这两个通过 part1.css / part2.css 链入） |
| `git-history.part1-shell.css` | 126 | 12 | dock overlay / resizer / body + workbench + toolbar 顶层 + empty toolbar |
| `git-history.part1.css` | 1430 | 212 | 主体 3 列（branches/commits/details）+ chip/search/branch row/commit row/details + dialog/diff-modal + 2 个 `@keyframes`（`git-history-modal-fade-in`/`git-history-modal-pop-in`）。`@import "./git-history.part1.overview.css"` 链入 overview |
| `git-history.part1.overview.css` | 1117 | 157 | toolbar 子元素 + project picker + worktree panel（85 个 `git-history-worktree-*` selector） |
| `git-history.part2.css` | 1646 | 232 | dialogs（reset / worktree-danger / push / toolbar-confirm 等）+ remaining。`@import "./git-history.part2.pr-dialog.css"` 链入 PR dialog |
| `git-history.part2-support.css` | 320 | 49 | branch-compare detail-message / files-list / context-menu / empty / error / notice |
| `git-history.part2.pr-dialog.css` | 810 | 98 | PR create dialog（backdrop/dialog/header/picker/tabs/body 等） |
| `git-history.branch-compare.css` | 226 | 25 | branch-compare modal / layout / lists / list-card 等 |
| **Σ** | **5680** | **785** | |

### Consumer tsx 规模（git-history 出现频率）

| 文件 | 行 | git-history 出现 |
|---|---|---|
| `GitHistoryPanelImpl.tsx` | 2408 | 1 (`.closest(".git-history-commit-context-menu")`) |
| `GitHistoryPanelView.tsx` | 2206 | **365** |
| `useGitHistoryPanelInteractions.tsx` | 2144 | 0 (受 runtime contract pin) |
| `GitHistoryPanelDialogs.tsx` | 1464 | **263** |
| `GitHistoryWorktreePanel.tsx` | 1391 | **80** |
| `GitHistoryPanelPickers.tsx` | 491 | 33 |
| `GitHistoryPanelImplHelpers.tsx` | 262 | 1 |
| `gitHistoryPanelSharedUtils.tsx` | 317 | 出现于 className 字符串字面值 |
| `DesktopLayout.tsx` | — | **3** (dock-overlay / dock-resizer / dock-body) |
| **总 className refs in JSX** | | **700+** |

### 字面值 pin / contract 检查（baseline）

- 无 `readFileSync('git-history*.css')` / `readCss*('git-history*')` / `toContain` 字面值断言 — **检索证据**：`grep -rn "readFileSync.*git-history\|readCss.*git-history\|fs\.read.*git-history" src scripts` 返回空集
- `src/styles/*.test.ts` 5 个 CSS-content 测试均 0 个 git-history 引用 — **检索证据**：`grep -n "git-history" src/styles/*.test.ts` 返回 0 matches
- `layout-swapped-platform-guard.test.ts` 无 git-history pin — 同上
- 测试中所有 `.git-history-*` 引用均为 querySelector / closest 的 **DOM presence pin**（不是 CSS literal）
  - `GitHistoryPanel.test.tsx`：44 个 querySelector（chip/branch-row/branch-name/current-branch/commit-row/commit-context-menu/commit-context-item/push-dialog/push-preview-file-tree/file-item/push-target-menu/push-preview-commit）
  - `GitHistoryWorktreePanel.test.tsx`：9 个 querySelector（worktree-section/section-header/folder-row/file-row/file-stats/generate/engine-icon/summary-bar）
  - `GitDiffPanel.test.tsx`：3 个 querySelector（diff-modal）
- **结论**：DOM presence pin = className 必须保留为 no-op semantic marker；CSS 文件本身可以删，**只要 className 不丢**就安全。

### 专用 contract / guard baseline

| Command | Baseline | 说明 |
|---|---|---|
| `npm run check:git-history:runtime-contract` | ✅ OK | 仅校验 `useGitHistoryPanelInteractions` / `renderGitHistoryPanelView` / `renderGitHistoryPanelDialogs` 三个函数的 `const { ... } = scope` destructure key 与 caller 提供的对象 key 一致 + non-local identifier safety。与 CSS 无关 |
| `npm run check:git-history:static-imports` | ✅ Passed (8 files) | `check-refactor-imports.mjs src/features/git-history/components/git-history-panel/components`，仅检查 TS import 解析。与 CSS 无关 |

## 2. Scope decision（plan-time 收缩）

按 Phase 6 settings 同套路，**最小可独立处理 unit** 推进；超大耦合块 defer 到 sub-PR。

### 本 phase 处理

1. **`git-history.css`**（5 行 entry）→ 删除 1 行 `@import "./git-history.part1-shell.css";`（保留 part1/branch-compare/part2-support/part2 四条 import 链路）
2. **`git-history.part1-shell.css`**（126 行 / 12 selector）→ 完整删除
3. **`DesktopLayout.tsx`**（3 个 className）→ 内联 Tailwind 替换 dock-overlay/dock-resizer/dock-body
4. **`GitHistoryPanelView.tsx`** 顶层 chrome 区段（约 7-12 处）：
   - `.git-history-workbench`（2 处：empty state 与 main 状态）
   - `.git-history-toolbar` + `.git-history-toolbar-left` + `.git-history-empty-toolbar` + `.git-history-empty-inline-text`
   - `.git-history-toolbar` h2 cascade（仅 `<h2>{t("git.historyTitle")}</h2>` 1 处）
5. **`src/bootstrap.ts`** 不动（仍 import `git-history.css` 一行）

className 保留为 no-op semantic marker（与 Phase 2-6 一致）；DOM presence pin（如 querySelector `.git-history-toolbar-action-group .git-history-chip`）自动保留。

### Defer 到 sub-PR

| Sub-PR | 内容 | 规模 | 推迟原因 |
|---|---|---|---|
| Phase 7.5 | `git-history.part1.css` + `git-history.part1.overview.css`（非 worktree 部分）+ 链路上其它共享样式 | ~2000+ 行 CSS / ~400+ className refs | 主体 3 列 + 主 dialog/diff-modal + 2 个共享 keyframes；规模与 Phase 4 composer 同级，单 phase 不可行 |
| Phase 7.6 | `git-history.part1.overview.css` 中的 worktree 部分 + `GitHistoryWorktreePanel.tsx` | 85 worktree CSS rules / 1391 行 tsx / 80 className refs | Worktree 是独立子模块，可单独 PR；含 9 个 querySelector pin + commit-message-generate cross-feature class |
| Phase 7.7 | `git-history.branch-compare.css` + `git-history.part2.pr-dialog.css` + `git-history.part2-support.css` + `git-history.part2.css` 的 dialog 部分 | 3002 行 CSS / 263+ className refs in Dialogs.tsx | 全部 modal/dialog 集中处理；branch-compare 有 archived task 历史 |

### 不引入 coss primitive structural swap

同 Phase 2-6 决策——「**纯 styling pass**」。Dialog（reset/worktree-danger/push/PR create/branch-compare）的结构性替换（→ coss Dialog / AlertDialog）转入后续 follow-up（需 `npx shadcn add @coss/dialog` + 行为契约 re-validation pass）。

## 3. Execution plan

### Step A — DesktopLayout.tsx

替换 3 个 className：

| 旧 className | Tailwind 内联（保留 className 作 no-op marker） |
|---|---|
| `git-history-dock-overlay` | `fixed left-0 right-0 bottom-0 z-[48] flex flex-col h-[var(--git-history-panel-height,50vh)] min-h-[240px] max-h-[calc(100vh-var(--main-topbar-height,44px))] border-t border-[color:var(--border-default)] bg-[color-mix(in_srgb,var(--surface-messages,#0d0f14)_94%,transparent)] transition-[height] duration-[120ms] ease-in-out` |
| `git-history-dock-resizer` | `relative h-2 cursor-row-resize flex-none touch-none bg-transparent` + `::after` pseudo 走 CSS 兜底（删后没了 → 改方案见下） |
| `git-history-dock-body` | `flex-1 min-h-0 overflow-hidden` |

`::after` pseudo 处理：Tailwind v4 支持 `after:` arbitrary variants。改为 `after:content-[''] after:absolute after:left-1/2 after:w-[68px] after:top-1/2 after:h-[2px] after:rounded-full after:-translate-x-1/2 after:-translate-y-1/2 after:bg-[color-mix(in_srgb,var(--border-default)_90%,transparent)] hover:after:bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_70%,transparent)]`。

`body[data-git-history-resizing="true"] .git-history-dock-resizer::after` 这条 cascade 是 `body[data-attr]` 父选择器，Tailwind 内联无法精确表达——**className 保留 `git-history-dock-resizer` 即可，cascade 通过 base.css 兜底**——但 base.css 没有这条规则。

**决策修正**：因为 `body[data-git-history-resizing="true"]` 这条 cascade 是必需的（hover 视觉反馈），**保留这条规则为 keeper**：把这条规则单独抽到 `git-history-dock-resizer-active.css`（与 Phase 1 proxy-status-badge.css / Phase 3 prompts-animations.css / Phase 4 toast-animations.css 同 pattern），bootstrap 追加 import。

### Step B — GitHistoryPanelView.tsx 顶层 chrome

替换 7-12 处 className。关键 cascade：

| 旧 className | Tailwind 内联（保留 className 作 no-op marker） |
|---|---|
| `git-history-workbench` (2 处) | `relative flex flex-col w-full h-full min-w-0 min-h-0 text-[color:var(--text-primary)] bg-[color-mix(in_srgb,var(--surface-messages,#0d0f14)_92%,var(--surface-card-muted,#111725))] focus-visible:outline-2 focus-visible:outline-[color-mix(in_srgb,var(--accent-primary,#2563eb)_52%,transparent)] focus-visible:[outline-offset:-2px]` + 9 个 CSS custom property 保留 |
| `git-history-toolbar` (2 处) | `flex items-center justify-between gap-[10px] py-2 px-[10px] border-b border-[color:var(--border-default)] bg-[color-mix(in_srgb,var(--surface-card-muted,#111725)_95%,transparent)]` |
| `git-history-toolbar-left` (2 处) | `inline-flex items-center min-w-0 flex-wrap gap-[10px]` |
| `git-history-toolbar` h2 cascade | `<h2 className="m-0 text-sm font-semibold text-[color:var(--text-stronger)]">...</h2>` 内联，不使用 className `.git-history-toolbar h2` 兜底 |
| `git-history-empty-toolbar` | `border-b border-[color:var(--border-default)]`（同 toolbar border-bottom，无冲突） |
| `git-history-empty-inline-text` | `text-xs text-[color:var(--text-secondary)]` |

CSS custom property（`--git-history-pane-bg`、`--git-filetree-section-*`、`--git-filetree-row-*`、`--git-filetree-icon-size`、`--git-filetree-tree-line-color`、`--git-filetree-badge-*`）— 这些是被后续子元素 cascade 消费的 var，**必须保留**。Tailwind 内联 arbitrary value 无法直接表达，**改用 inline style 或保留小 CSS-in-JS 段**。

**决策修正 2**：因为 `git-history-workbench` 的 9 个 `--git-filetree-*` CSS variable 是子元素 cascade 必需（part1.css / part1.overview.css 都消费它们），且 Tailwind v4 内联 arbitrary class 不优雅，**保留 `.git-history-workbench` 这一个规则**——拆到 `git-history-workbench-tokens.css`（与 dock-resizer-active 一起作 keeper，跟 Phase 1/3/4 keeper pattern 一致）。

### Step C — 落地 keeper 文件

新增 `src/styles/git-history-shell-keepers.css`（合并 dock-resizer body attr cascade + workbench CSS variable 定义），约 25 行。
- bootstrap.ts 追加 import：`import "./styles/git-history-shell-keepers.css"`（line 35 之后插入新 line）
- 与 Phase 1/3/4 同一 keeper pattern。

### Step D — 修改 git-history.css

删除 line 1 `@import "./git-history.part1-shell.css";`。剩 4 行（part1/branch-compare/part2-support/part2）。

### Step E — 删除 git-history.part1-shell.css

完整删除 126 行。

## 4. 预期产出

- 删 1 个 CSS 文件：`git-history.part1-shell.css`（126 行）
- 新增 1 个 keeper CSS：`git-history-shell-keepers.css`（~25 行）
- 修改 entry：`git-history.css`（5 → 4 行）
- 修改 bootstrap.ts（40 → 41 imports：+1 keeper）
- 修改 2 个 tsx：`DesktopLayout.tsx`（3 className）、`GitHistoryPanelView.tsx`（7-12 处 className）

净 CSS line 削减：126 - 25 = **101 行**

## 5. 验证清单

按 Phase 2-6 套路：

- [ ] `npm run lint`
- [ ] `npm run typecheck`（baseline = 2 个 perfBaseline error）
- [ ] `npm run test`（baseline = 3 个 ComposerInput.collaboration.test pre-existing failure）
- [ ] `npm run test:layout-guard`
- [ ] `npm run check:large-files:gate`
- [ ] `npm run check:git-history:runtime-contract`（baseline ✅）
- [ ] `npm run check:git-history:static-imports`（baseline ✅）
- [ ] 单独跑 `GitHistoryPanel.test.tsx` / `GitHistoryWorktreePanel.test.tsx` / `GitDiffPanel.test.tsx` / `DesktopLayout.test.tsx`

## 6. Follow-up（写入 docs/migration-to-coss-ui.md）

- **Phase 7.5** — `git-history.part1.css` + `git-history.part1.overview.css` (non-worktree)：主体 3 列 + chip/search/branch-row/commit-row/details + diff-modal + 2 keyframes。约 2000+ 行 CSS。
- **Phase 7.6** — `git-history.part1.overview.css` (worktree subset) + `GitHistoryWorktreePanel.tsx`：worktree panel 模块。
- **Phase 7.7** — `git-history.branch-compare.css` + `git-history.part2.pr-dialog.css` + `git-history.part2-support.css` + `git-history.part2.css`：全部 dialog/modal 集中处理。
- **Dialog primitive swap**（Phase 后续）— reset / worktree-danger / push / PR create / branch-compare 全部 5 个 dialog 替换为 coss Dialog / AlertDialog；需 `npx shadcn add @coss/dialog`。

---

## 7. Execution log（2026-05-16 — agent worktree `agent-afca4b93bfb374c70`）

按 plan 执行 Step A-E。worktree 隔离环境，未触碰共享 `src/bootstrap.ts`（PRD 约束）。

### 实际产出文件清单（仅 phase-7 owned）

| 操作 | 文件 | 行数 |
|---|---|---|
| Delete | `src/styles/git-history.part1-shell.css` | -126 |
| Add | `src/styles/git-history-shell-keepers.css` | +49 |
| Modify | `src/styles/git-history.css` | -1（删除 `@import "./git-history.part1-shell.css"`） |
| Modify | `src/features/layout/components/DesktopLayout.tsx` | ±3 className（dock-overlay / dock-resizer / dock-body） |
| Modify | `src/features/git-history/components/git-history-panel/components/GitHistoryPanelView.tsx` | ±9 className（workbench ×2 / toolbar ×2 / toolbar-left ×2 / toolbar h2 ×1 / empty-toolbar ×1 / empty-inline-text ×2） |

Diff stat: `4 files changed, 12 insertions(+), 139 deletions(-)`。净 CSS 削减 = 126 - 49 = **77 行**（plan 预估 101 行；实际 keeper 比预估 25 行多 24 行，因 9 个 CSS custom properties + 注释更完整）。

className 全部保留为 no-op semantic marker，满足 querySelector / closest 的 DOM presence pin 约束。

### 字面值 pin / contract 验证

- `grep -rn "readFileSync.*git-history\|readCss.*git-history\|fs\.read.*git-history" src scripts` → **0 matches**（无 CSS-content pin，可安全 inline / 删除 CSS）
- `grep -n "git-history" src/styles/*.test.ts` → **0 matches**（layout-swapped-platform-guard.test.ts 等 5 个 CSS-content 测试均不读 git-history）
- 所有 test 中的 `.git-history-*` 引用均为 querySelector / closest 形式（DOM presence pin），className 已全部保留

### coss primitive 决策

**未引入 coss primitive structural swap**（同 Phase 2-6 决策）—— 本 phase 为「纯 styling pass」。Dialog / Tooltip 等 structural swap 转入 Phase 7.7 + Dialog primitive follow-up。

### Typecheck baseline

Worktree 中 `npm run typecheck` 返回 **0 错误**（先前 Phase 0/1 baseline 提到的 `perfBaseline/index.ts` 2 个 `web-vitals` 错误已在当前 worktree 消失——`web-vitals 4.2.4` 已通过 npm install 注册，且 `npm run typecheck` 通过）。

### 各验证输出

| Command | Result |
|---|---|
| `npm run check:git-history:runtime-contract` | ✅ `check-git-history-runtime-contract: OK` |
| `npm run check:git-history:static-imports` | ✅ `Refactor import scan passed. Checked 8 files` |
| `npm run lint` | ✅ pass (no output) |
| `npm run typecheck` | ✅ 0 错误 |
| `npm test` (full suite) | ✅ 120 batches PASS / 0 FAIL（含 `ComposerInput.collaboration.test.tsx` 5/5 pass，先前 baseline 3-failure 已消失） |
| `npm run test:layout-guard` | ✅ 10/10 pass |
| `npm run check:large-files:gate` | ✅ `found=0` |
| Phase 7 affected tests（5 个 test files）| ✅ 98/98 pass — `GitHistoryPanel.test.tsx` + `GitHistoryWorktreePanel.test.tsx` + `GitHistoryPanelPickers.test.tsx` + `GitDiffPanel.test.tsx` + `DesktopLayout.test.tsx` |

### Scope 调整

Plan 中预估 `GitHistoryPanelView.tsx` 7-12 处 className，实际改 9 处（落在区间内）。无 scope 调整。

---

## 8. Orchestrator 行动清单（合并阶段必做）

合并 phase-7 worktree 时，orchestrator **必须** 完成下列共享文件改动（worktree agent 受 PRD 约束未触碰这些文件）：

### A. `src/bootstrap.ts` — 追加 keeper import

在 `import "./styles/git-history.css";` (line 35) 之后插入一行：

```diff
 import "./styles/git-history.css";
+import "./styles/git-history-shell-keepers.css";
 import "./styles/spec-hub-header.css";
```

**理由**：新增的 `git-history-shell-keepers.css` 必须被 import 才生效。Phase 7 worktree 不允许动 bootstrap.ts（共享文件冲突避险），由 orchestrator 在合并时统一追加。

**注意**：Phase 8 (spec-hub) / Phase 9 (file/diff/terminal) 的 worktree 也可能要求追加 keeper import；合并冲突需手工 resolve（每个 worktree 的 keeper line 放在对应的 entry import 之后即可，互不影响）。

### B. PRD Phase 7 status 更新

在 `.trellis/tasks/05-16-migrate-css-to-coss-ui/prd.md` 的 Phase 7 节下，追加完成状态块（参照 Phase 2-6 格式）：

```markdown
#### Phase 7 完成状态（2026-05-16）

**Scope 收缩**（在 plan-time）— 见 `phase-7-git-history-plan.md`。PRD 列出的 git-history CSS 链路（共 ~5680 行 / 785 顶层 selector），本 phase 仅处理 1 个文件（`git-history.part1-shell.css`，126 行）+ aggregator。其余 5 个文件全部 defer 到 Phase 7.5 / 7.6 / 7.7。Phase 7 重点：dock chrome（DesktopLayout）+ workbench 顶层（GitHistoryPanelView）。

实际产出（implement agent in worktree `agent-afca4b93bfb374c70`）：
- 新增：`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-7-git-history-plan.md`（discovery + per-file plan + execution log + orchestrator checklist）
- 删除 1 个 .css 文件：`git-history.part1-shell.css`（126 行）
- 新增 1 个 keeper：`src/styles/git-history-shell-keepers.css`（49 行）—— 包含 `body[data-git-history-resizing="true"] .git-history-dock-resizer::after` 和 `.git-history-workbench` 9 个 `--git-filetree-*` CSS custom properties（同 Phase 1 `proxy-status-badge.css` / Phase 3 `prompts-animations.css` / Phase 4 `toast-animations.css` keeper pattern）
- 修改：`src/styles/git-history.css`（5 → 4 行，删 1 个 `@import`）
- 修改：`src/bootstrap.ts`（**orchestrator 在合并时追加 keeper import**）
- 修改：`src/features/layout/components/DesktopLayout.tsx`（3 处 className 内联 Tailwind：dock-overlay / dock-resizer / dock-body，含 `after:` pseudo arbitrary variants）
- 修改：`src/features/git-history/components/git-history-panel/components/GitHistoryPanelView.tsx`（9 处 className 内联 Tailwind：workbench ×2 / toolbar ×2 / toolbar-left ×2 / toolbar h2 / empty-toolbar / empty-inline-text ×2）

未引入 coss primitive structural swap（同 Phase 2-6 决策）—— 本 phase 决策为「纯 styling pass」。Dialog（reset/worktree-danger/push/PR-create/branch-compare 共 5 个）的结构性替换转入 Phase 7.7 + Dialog primitive follow-up（需 `npx shadcn add @coss/dialog`）。

验证（worktree 内）：
- `npm run check:git-history:runtime-contract` ✅ OK
- `npm run check:git-history:static-imports` ✅ Passed (8 files)
- `npm run lint` ✅ pass
- `npm run typecheck` ✅ 0 errors（先前 baseline 2 个 perfBaseline 错误在本 worktree 已消失，可能因 `web-vitals` 已 npm install 注册）
- `npm test` ✅ 120 batches PASS / 0 FAIL（含 5 个 phase-7 affected tests 共 98/98 pass：GitHistoryPanel / GitHistoryWorktreePanel / GitHistoryPanelPickers / GitDiffPanel / DesktopLayout）
- `npm run test:layout-guard` ✅ 10/10 pass
- `npm run check:large-files:gate` ✅ found=0

后续 phase 影响：
- bootstrap.ts CSS import 数从 40 → 41（+1 keeper；orchestrator 追加）
- git-history.css 内部 import 数从 5 → 4
- 3 条新 follow-up 入 `docs/migration-to-coss-ui.md`：Phase 7.5 main panel（~2000+ 行 CSS）/ Phase 7.6 worktree panel / Phase 7.7 dialogs（branch-compare + PR + reset + worktree-danger + push 集中处理）
```

### C. `docs/migration-to-coss-ui.md` follow-up 追加

在 follow-up 节追加 3 条：

```markdown
- **Phase 7.5** — `git-history.part1.css`（1430 行）+ `git-history.part1.overview.css` 中非 worktree 部分（~600 行）：主体 3 列（branches/commits/details）+ chip/search/branch-row/commit-row/details + dialog/diff-modal + 2 个共享 keyframes。约 2000+ 行 CSS 待 inline。
- **Phase 7.6** — `git-history.part1.overview.css` 中 worktree 部分（~500 行 / 85 个 `git-history-worktree-*` selector）+ `GitHistoryWorktreePanel.tsx`（1391 行 / 80 className refs）：worktree panel 单独 sub-PR。
- **Phase 7.7** — `git-history.branch-compare.css`（226 行）+ `git-history.part2.pr-dialog.css`（810 行）+ `git-history.part2-support.css`（320 行）+ `git-history.part2.css`（1646 行）：全部 modal / dialog 集中处理，约 3002 行 CSS / 263+ className refs in `GitHistoryPanelDialogs.tsx`。可配合 Dialog primitive swap（5 个 dialog → coss Dialog / AlertDialog）。
```

### D. PRD Phase 7 段落 status 行更新（如有）

如 PRD 顶部有 phase 完成进度行（如 `Phase 6 ✅ / Phase 7 🚧`），更新 `Phase 7 ✅`。

---

## 9. Risk / 注意事项

- **keeper 文件 9 个 `--git-filetree-*` CSS custom properties** 被 `git-history.part1.css` 与 `git-history.part1.overview.css` 后续大量 descendant cascade 消费。如果 Phase 7.5/7.6 在删 `part1.css` / `part1.overview.css` 时直接 inline 这些消费方，记得同时把 keeper 中对应的 custom property 也一起清理掉（不然冗余）。
- **`body[data-git-history-resizing="true"]` 父属性选择器** 是 dock-resizer hover 的视觉反馈，由 `useGitHistoryPanelInteractions` 在 pointerdown / pointermove / pointerup 间切换 `body.dataset.gitHistoryResizing`。如果未来重构 `useGitHistoryPanelInteractions`，需保留该 attr 的设置/清除逻辑，否则 keeper 中 `body[data-git-history-resizing="true"] .git-history-dock-resizer::after` 失效。
- **PRD 约束遵守**：worktree 未触碰 `bootstrap.ts` / `prd.md` / `docs/migration-to-coss-ui.md` / `package.json` / `package-lock.json` / `src/styles/base.css` / `src/styles/themes.*.css`。所有共享文件改动列在第 8 节 orchestrator checklist。
- **package-lock.json baseline**：检查发现 worktree 启动时 `package-lock.json` 内 `web-vitals` 的 `resolved` URL 被改（npmmirror → npmjs 切换），已 `git checkout HEAD --` 还原，未引入此 phase。

