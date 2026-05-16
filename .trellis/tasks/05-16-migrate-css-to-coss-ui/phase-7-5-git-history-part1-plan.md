# Phase 7.5 — git-history.part1.css coss 化 plan & execution log

> Generated 2026-05-17. Status: **implemented (scope-shrunk)**.
> 延续 Phase 7（已删 `git-history.part1-shell.css` + 加 `git-history-shell-keepers.css`）。

## 1. Discovery

### CSS asset (in-scope)

| 文件 | 行 | 顶层 selector | 备注 |
|---|---|---|---|
| `git-history.part1.css` | 1430 | 113 unique class names | 主体 3 列（branches/commits/details）+ chip/search/branch row/commit row/details + diff-modal + branch-worktree-diff-modal + 2 个 `@keyframes`（`git-history-modal-fade-in` / `git-history-modal-pop-in`）。顶部 `@import "./git-history.part1.overview.css"` 链入 overview |
| `git-history.part1.overview.css` | 1117 | 156 selectors | 非 worktree 部分（行 1-528 ~ project picker / 行 529-1117 ~ worktree）。本 phase **仅** 处理非 worktree |
| `git-history.css` | 4 | 0 | aggregator entry，4 个 `@import` 链路（part1/branch-compare/part2-support/part2） |

### Consumer tsx 规模（git-history- className 出现频率）

| 文件 | 行 | git-history 出现 | part1.css 类的交集 |
|---|---|---|---|
| `GitHistoryPanelView.tsx` | 2206 | 365 | 92 unique classes（@ts-nocheck） |
| `GitHistoryPanelDialogs.tsx` | 1464 | 263 | 21 unique classes（@ts-nocheck）— 多是 diff-modal / tree-* / file-* / warning |
| `GitHistoryPanelImpl.tsx` | 2408 | 1 (`closest(".git-history-commit-context-menu")`) | 0 |
| `GitHistoryPanelPickers.tsx` | 491 | 33 | 1 (`git-history-action` 仅作 modifier base 名) |
| `GitHistoryPanelImplHelpers.tsx` | 262 | 0 | 0 |
| `GitHistoryWorktreePanel.tsx` | 1391 | 80 | **out of scope（Phase 7.6）** |

### 测试字面值 pin / contract baseline（grep 验证）

- `grep -rn "readFileSync.*git-history\|readCss.*git-history\|fs\.read.*git-history" src scripts` → **0 matches**（无 CSS-content 字面值断言，可安全 inline / 删 CSS）
- `grep -n "git-history" src/styles/*.test.ts` → **0 matches**（layout-swapped-platform-guard.test.tsx 等 5 个 CSS-content 测试均不读 git-history）
- `GitHistoryPanel.test.tsx`：querySelector / closest 形式 DOM presence pin（15 个 classes：`git-history-branch-name` / `branch-row` / `chip` / `commit-context-item*` / `commit-context-menu` / `commit-context-submenu` / `commit-row` / `current-branch` / `file-item` / `push-dialog` / `push-preview-commit` / `push-preview-file-tree` / `push-target-menu` / `toolbar-action-group`）
- `GitHistoryWorktreePanel.test.tsx`：9 个 querySelector（仅 worktree-* — out of scope）
- **结论**：所有 className 必须保留为 no-op semantic marker。CSS 文件本身可以删，**只要 className 不丢**就安全。

### 专用 contract / guard baseline

| Command | Baseline | 说明 |
|---|---|---|
| `npm run check:git-history:runtime-contract` | ✅ OK | 校验 `useGitHistoryPanelInteractions` / `renderGitHistoryPanelView` / `renderGitHistoryPanelDialogs` 三个函数的 `const { ... } = scope` destructure key。与 CSS 无关 |
| `npm run check:git-history:static-imports` | ✅ Passed (8 files) | TS import 解析；与 CSS 无关 |
| `npm run test:layout-guard` | ✅ 46/46 pass | jsdom cascade |
| `npm run lint` / `npm run typecheck` | ✅ 0 errors | baseline |
| `npm run check:large-files:gate` | found=1（SpecHubPresentationalImpl.tsx 已 baseline retain）| baseline |

## 2. Scope decision（plan-time 收缩）

按 Phase 4.5b / 6.5b / 7 套路，**最小可独立处理 unit** 推进；超大耦合块 defer 到 sub-PR。

### 本 phase 7.5 处理（spike scope）

锁定 3 个无副作用 + 1 个低风险集群，**保留** part1.css 本体（继续 Phase 7.5b/c 处理剩余）：

**Step A — 死 CSS 清扫（零 tsx 改动）**

`grep -roE "git-history-[a-zA-Z0-9_-]+" src --include="*.tsx" --include="*.ts" --include="*.css" --exclude="git-history.part1.css"` 验证后，下列 14 个 class 在 part1.css 以外**完全无引用**（含动态字符串拼接）：

| Class | 行号 | 行数 |
|---|---|---|
| `.git-history-branch-leaf` | 381-383 | 3 |
| `.git-history-branch-scope` | 377-379 | 3 |
| `.git-history-commit-action-icon` | 212-217 + 223-225 | 9 |
| `.git-history-commit-action-label` | 205-210 | 6 |
| `.git-history-commit-action-text` | 219-221 | 3 |
| `.git-history-detail-actions` | 45-50（合并在 `.git-history-branch-actions` 同 rule）| 0 净删 |
| `.git-history-diff-code` | 839-848 | 10 |
| `.git-history-file-tree-head` | 670-681 | 12 |
| `.git-history-file-tree-head-title` | 683-687 | 5 |
| `.git-history-metadata` | 647-653 | 7 |
| `.git-history-metadata-row` | 655-662 | 8 |
| `.git-history-branch-diff-accent` | （CSS variable，仅 part1.css 内部消费）| 保留 |

死代码合计：约 **66 行直接删除**，0 个 tsx 改动，0 个 DOM presence pin 影响。

**Step B — diff-modal cluster inline（高 leverage / 中风险）**

`.git-history-diff-modal-*` cluster（11 个类 + 2 个 `@keyframes`），part1.css 行 913-1180，约 **265 行**。

- 使用方：`GitHistoryPanelView.tsx`（59 处 ref）+ `GitHistoryPanelDialogs.tsx`（12 处 ref）= 71 处 className
- 3 个独立 modal 实例（history file diff / worktree diff / push preview diff）共享相同结构：overlay → modal → header (title/path/stats) → actions → close → body (code 或 viewer)
- 2 个 `@keyframes` (`git-history-modal-fade-in` 130ms ease / `git-history-modal-pop-in` 160ms ease) — 关键依赖，不能直接删

**决策**：因为 `@keyframes` 是全局 CSS-only 行为，inline 到 Tailwind 需要 `@theme` 或者 `animate-*` arbitrary 表达，且 3 个实例字面值高度一致，**diff-modal cluster 保留为 keeper**（与 Phase 4 toast-animations keeper / Phase 7 git-history-shell-keepers 同 pattern）。
- 已有 `git-history-shell-keepers.css` 复用（追加 2 个 `@keyframes` + diff-modal 相关 rule）

**修正**：经过分析，diff-modal cluster 整体保持现状（不 inline 到 tsx），但**将 keyframes 从 part1.css 提取到 keepers 文件**，为将来 inline 留好基础。如果当前阶段把整组 inline 进 tsx，会引入 71 处近重复的长 Tailwind 字符串，违反「surgical changes」原则。**因此 Step B 暂不执行，仅做 Step A 死代码清扫**。

**Step C — overview.css 非 worktree 部分清扫（如有死代码）**

`grep -roE "git-history-project-[a-zA-Z0-9_-]+" src --include="*.tsx" --include="*.ts"`：

| Class | 在 src/ 引用 | 备注 |
|---|---|---|
| 全部 `.git-history-project-*`（line 1-528）| 在 `GitHistoryProjectPicker` 内使用 | 保留 — 跨 feature 复用 |

→ overview.css 非 worktree 部分**全部 alive**，无死代码可删。本 phase 不动 overview.css。

### Defer 到后续 sub-PR

| Sub-PR | 内容 | 规模 | 推迟原因 |
|---|---|---|---|
| Phase 7.5b | `git-history.part1.css` 主体（branches/commits/details 3 列 + tree-* + branch-context-menu + 其余 active 样式） | ~1300 行 CSS / ~80 className refs in View | 单文件 tsx diff 风险高（@ts-nocheck spike file），需要分阶段；建议下次推 worktree |
| Phase 7.5c | `diff-modal` + `branch-worktree-diff-modal` cluster inline（71 处 className）+ `@keyframes` keeper 升级 | ~265 行 CSS / 71 处 tsx 改动 | 独立做更安全，避免与 7.5b 混合 |
| Phase 7.6 | `git-history.part1.overview.css` worktree 部分 + `GitHistoryWorktreePanel.tsx` | ~500 行 CSS / 80 className refs | worktree 是独立子模块（含 commit-message-generate cross-feature class） |
| Phase 7.7 | `git-history.branch-compare.css` + `git-history.part2.pr-dialog.css` + `git-history.part2-support.css` + `git-history.part2.css` | ~3002 行 CSS / 263+ className refs in Dialogs | 全部 modal / dialog 集中处理 |

### 不引入 coss primitive structural swap

同 Phase 2-7 决策——「**纯 styling pass**」。Dialog 结构性替换（→ coss Dialog / AlertDialog）转入 Phase 7.7 + Dialog primitive follow-up（需 `npx shadcn add @coss/dialog`）。

## 3. Execution plan

### Step A — Dead CSS sweep（独立、零 tsx）

逐一删除 part1.css 中下列 dead 选择器（grep 已验证 src/ 无 string-literal 或动态拼接引用）：

```diff
-.git-history-branch-leaf { color: var(--text-primary); }
-.git-history-branch-scope { color: var(--text-muted); }
-.git-history-commit-action-icon { ... 6 lines ... }
-.git-history-commit-action-label { ... 6 lines ... }
-.git-history-commit-action-text { white-space: nowrap; }
-.git-history-action:hover:not(.is-disabled) .git-history-commit-action-icon { ... }
-.git-history-diff-code { ... 10 lines ... }
-.git-history-file-tree-head { ... 12 lines ... }
-.git-history-file-tree-head-title { ... 5 lines ... }
-.git-history-metadata { ... 7 lines ... }
-.git-history-metadata-row { ... 8 lines ... }
```

**注意**：`.git-history-detail-actions` 与 `.git-history-branch-actions` 共享同一 selector list；仅删 `.git-history-detail-actions` 时需保留 `.git-history-branch-actions`。

预计净 CSS 削减：**~66 行**

### Step B — git-history.part1.css 改动到此为止

保持当前 part1.css 结构（除上述删除），等 7.5b/c。

## 4. 预期产出

- 修改 1 个 CSS 文件：`git-history.part1.css`（1430 → 约 1364 行，-66）
- 修改 0 个 tsx（dead code 不被引用）
- 修改 0 个 import 链路（part1.css 保留，只内部缩减）
- 修改 0 个 keeper 文件

净 CSS 削减：**约 66 行**

### 实际产出（2026-05-17 执行）

| 操作 | 文件 | Δ行 |
|---|---|---|
| Modify | `src/styles/git-history.part1.css` | 1430 → 1348（**-82 行**，+1 -83） |
| Add | `.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-7-5-git-history-part1-plan.md` | + this doc |

实际比预估多 16 行，因为 `.git-history-branch-actions` 与 `.git-history-detail-actions` 合并选择器时，`.git-history-branch-actions` 自身有第二条 rule 覆盖（gap/padding/border 等），删除 `.git-history-detail-actions` 后顺便合并两条相同选择器，减少 1 条重复 selector + 空行。

实际删除 7 段 dead-class rules（11 个被声明的 class）：
- `.git-history-branch-actions, .git-history-detail-actions` → 仅保留 `.git-history-branch-actions`（合并 2 条同名 rule）
- `.git-history-commit-action-label` / `.git-history-commit-action-icon` / `.git-history-commit-action-text` / `.git-history-action:hover:not(.is-disabled) .git-history-commit-action-icon` (descendant cascade)
- `.git-history-branch-scope` / `.git-history-branch-leaf`
- `.git-history-metadata` / `.git-history-metadata-row`
- `.git-history-file-tree-head` / `.git-history-file-tree-head-title`（保留 `-summary`）
- `.git-history-diff-code`

className 全部保留为 no-op semantic marker（src/ 没有任何引用，所以也不需要 marker）—— **本 phase 实质上是清除「永远不会被引用的字面值」**。

### 验证输出

| Command | Result |
|---|---|
| `npm run lint` | ✅ pass (no output) |
| `npm run typecheck` | ✅ 0 errors |
| `npm run check:git-history:runtime-contract` | ✅ OK |
| `npm run check:git-history:static-imports` | ✅ Passed (8 files) |
| `npm run test:layout-guard` | ✅ 46/46 pass |
| `npm run check:large-files:gate` | ✅ baseline retain (SpecHub only) |
| `vitest src/styles` (5 files) | ✅ 52/52 pass |
| `vitest src/app-shell.startup + GitDiffPanel + clientDocumentationUtils + GitHistoryPanel + GitHistoryWorktreePanel + DesktopLayout + useLayoutNodes.client-ui-visibility + GitHistoryPanelPickers` | ✅ 117/117 pass |

## 5. 验证清单

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test:layout-guard`（46/46 pass）
- [x] `npm run check:large-files:gate`（baseline retain）
- [x] `npm run check:git-history:runtime-contract` ✅
- [x] `npm run check:git-history:static-imports` ✅
- [x] `vitest run src/features/git-history/components/GitHistoryPanel.test.tsx`
- [x] `vitest run src/features/git-history/components/GitHistoryWorktreePanel.test.tsx`
- [x] `vitest run src/features/git-history/components/git-history-panel/components/GitHistoryPanelPickers.test.tsx`

## 6. Follow-up

**当前 phase 收缩为 spike 清扫；剩余三块明确分给后续 sub-PR**：

- **Phase 7.5b**（推荐下次 worktree 并行）—— `git-history.part1.css` 主体（3 列结构 / branch-row / commit-row / details / tree-* / branch-context-menu / push-preview-file-tree）：约 1300 行 CSS / 80 处 View.tsx className inline
- **Phase 7.5c** —— `diff-modal` + `branch-worktree-diff-modal` cluster：265 行 CSS / 71 处 View+Dialogs className inline，配合 `@keyframes` 升级到 keepers
- **Phase 7.6** —— `git-history.part1.overview.css` worktree 部分 + `GitHistoryWorktreePanel.tsx`（独立子模块）
- **Phase 7.7** —— branch-compare + PR dialog + part2 dialog 集中处理（合并 Dialog primitive swap）

## 7. Risk / 注意事项

- **`.git-history-detail-actions`**：与 `.git-history-branch-actions` 共享 selector，删除时保留 `.git-history-branch-actions`（DOM presence pin / 实际使用）
- **`@keyframes git-history-modal-fade-in` / `git-history-modal-pop-in`**：仅在 part1.css 内部使用（被 `.git-history-diff-modal-overlay` / `.git-history-diff-modal` animation 属性消费）。本 phase 不动；如果 Phase 7.5c 把 diff-modal cluster inline 删除，必须把 `@keyframes` 搬到 keepers 文件，不然 animation 失效
- **`.git-history-branch-diff-accent`**：CSS variable（不是 class），定义在 `.git-history-branch-worktree-diff-modal { --git-history-branch-diff-accent: ... }`。grep 漏报为 dead class — 保留
- **scope 严守**：本 phase **不动** `GitHistoryWorktreePanel.tsx` / `GitHistoryPanelImpl.tsx` / `GitDiffPanel*` / `GitHistoryPanelView.tsx` 任何 className / `bootstrap.ts` / `git-history.css` / `git-history.part2*.css` / `git-history-shell-keepers.css`
- **package-lock.json baseline**：保持不变；只动 `src/styles/git-history.part1.css`
