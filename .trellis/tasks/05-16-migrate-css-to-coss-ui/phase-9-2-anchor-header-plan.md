# Phase 9.2 — anchor + header sub-PR Plan & Block Analysis

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 9.2 (anchor + header sub-PR after `9.2.pr` PullRequestSummary cluster)
> Date: 2026-05-16
> Agent: claude-agent (主 worktree，紧随 `0954fb3c chore(trellis): 记录会话` HEAD)
> Predecessor:
> - `b2736ba9` refactor(coss-ui): P0-2 SpecHub de-minify + Phase 9.2 PR cluster + 3.5 sticky 阻塞分析
> - `0954fb3c` chore(trellis): 记录会话 (current HEAD)

## TL;DR — Scope 极度收缩，本次"实施 0 行 inline" 推回 follow-up

经 discovery，**anchor 与 header 两 cluster 都被 cascade context / cross-component / cross-CSS-file 三重锁定**，在不破坏既定 scope（"只动 GitDiffViewer.tsx anchor/header 段 + diff-viewer.css 剩余部分"）的前提下，**没有任何 selector 可以安全地从 css 删除并 inline 到 tsx**。强行 inline 会触发以下任一回归：

1. **layout-swapped-platform-guard.test.ts** 中 4 个 jsdom cascade 断言 fail（test 312/320 验证 `getComputedStyle(diff-viewer-anchor-floating).right` 含 / 不含 `sidebar-width`）。
2. **ImageDiffCard.tsx** 共用 `.diff-viewer-header / -status / -path` 但**不在 scope** —— 删除 css base rule 会让 ImageDiffCard 头部样式塌掉。
3. **git-history.part1.css** 有 30+ 行 `.git-history-diff-modal-actions > .diff-viewer-header-controls.is-external .diff-viewer-header-mode*` 后代选择器（**不在 scope**）—— 删除 css 中的 `.diff-viewer-header-*` base 会让该后代选择器目标不匹配（其实匹配仍生效，但 base 属性消失，视觉退化）。
4. **`.diff-viewer-frame.is-anchor-modal-pager .diff-viewer-anchor-*`** 5 条祖先-state-based rules 无法用 Tailwind utility 表达（除非引入 `data-attribute + group-data` 全面重构 anchor 状态，远超本 sub-PR scope）。

按 karpathy-skills 「Touch only what you must / Don't refactor things that aren't broken」 + 「Every changed line should trace directly to the user's request」，**本次实施零代码修改**，仅写 plan doc 记录阻塞，并将 anchor / header 两条 follow-up 转换为「不可 inline，需 cross-component 协同 + DOM 状态架构改造」类型 task，推回 orchestrator。

## Discovery ground truth

### File sizes（HEAD `0954fb3c`）

```
1137 src/styles/diff-viewer.css
1335 src/features/git/components/GitDiffViewer.tsx
```

注：上轮 9.2.pr 完成后 GitDiffViewer.tsx 从 1317 → 1335 行（+18 行：PullRequestSummary inline 后净增）。

### Anchor cluster — 14 selectors in `diff-viewer.css` (lines 331-451)

| # | Line | Selector | Inline-safe? | Reason |
|---|---:|---|:---:|---|
| 1 | 331 | `.diff-viewer-anchor-floating` (base `position: fixed; right: calc(--right-panel-width + 20)`) | ❌ | jsdom test pin — `getComputedStyle(...).right` 必须解析为 calc string |
| 2 | 351 | `.diff-viewer-anchor-inner` (flex + gap) | ⚠️ | base 可 inline，但同时是 cascade target (line 371 / 382) |
| 3 | 357 | `.diff-viewer-anchor-dock` (flex + backdrop) | ❌ | cascade target (line 378) |
| 4 | 371 | `.diff-viewer-anchor-dock .diff-viewer-anchor-inner` (descendant) | ❌ | 祖先-后代 selector，Tailwind 无 utility 表达 |
| 5 | 378 | `.diff-viewer-frame.is-anchor-modal-pager .diff-viewer-anchor-dock` | ❌ | 祖先-state selector |
| 6 | 382 | `.diff-viewer-frame.is-anchor-modal-pager .diff-viewer-anchor-dock .diff-viewer-anchor-inner` | ❌ | 双层祖先-state-descendant |
| 7 | 390 | `.diff-viewer-frame.is-anchor-modal-pager .diff-viewer-anchor-btn` | ❌ | 祖先-state selector |
| 8 | 399 | `.diff-viewer-frame.is-anchor-modal-pager .diff-viewer-anchor-btn:hover:not(:disabled)` | ❌ | 祖先-state-pseudo selector |
| 9 | 404 | `.diff-viewer-frame.is-anchor-modal-pager .diff-viewer-anchor-btn:first-child svg, ...:last-child svg` | ❌ | 祖先-state + 结构 pseudo |
| 10 | 409 | `.diff-viewer-frame.is-anchor-modal-pager .diff-viewer-anchor-meta` | ❌ | 祖先-state selector |
| 11 | 414 | `.app.right-panel-collapsed .diff-viewer-anchor-floating:not(.is-embedded)` | ❌ | layout-guard 类 viewport rule |
| 12 | 418 | `.app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded)` | ❌ | **jsdom test 312 pin** |
| 13 | 422 | `.app.layout-desktop.layout-swapped.right-panel-collapsed .diff-viewer-anchor-floating:not(.is-embedded)` | ❌ | layout-guard 类 viewport rule |
| 14 | 426 | `.diff-viewer-anchor-btn` (base button) + 439 `:disabled` | ⚠️ | base 可 inline，但也是 cascade target (line 390/399) |

可 inline 行数估算：仅 `diff-viewer-anchor-inner` (4 行) + `diff-viewer-anchor-btn` base/disabled (15 行) + `diff-viewer-anchor-meta` (7 行) ≈ 26 行 of 120-line cluster ≈ **22%**。但 inline 这部分会让 cascade target rule 失去 base（cascade 不变但 base 属性消失），属于「Touch only what you must」的反例。

### Header cluster — 30+ selectors in `diff-viewer.css` (lines 73-273)

| # | Selector | Cross-component / cross-css 共用 | Inline-safe? |
|---|---|---|:---:|
| `.diff-viewer-header` (line 73) | ✅ ImageDiffCard.tsx:89, GitDiffViewer.tsx:159/1157 | ❌ — 删除 css 影响 ImageDiffCard |
| `.diff-viewer-path` (line 86) | ✅ ImageDiffCard.tsx:93, GitDiffViewer.tsx:163/1166 | ❌ |
| `.diff-viewer-header-controls` (line 95) | ✅ git-history.part1.css:1046+1051+1055+1064+1068+1072 后代 selector | ❌ |
| `.diff-viewer-header-controls.is-external` (line 104) | ✅ git-history.part1.css:1051+ 后代 selector | ❌ |
| `.diff-viewer-header-mode` (line 109) | ✅ git-history.part1.css:1055+1064 后代 | ❌ |
| `.diff-viewer-header-mode-button*` (lines 119-138) | ✅ git-history.part1.css:1073+1091 后代 | ❌ |
| `.diff-viewer-header-mode-icon-button*` (lines 190-207) | ✅ git-history.part1.css:1072+1090 后代 | ❌ |
| `.diff-viewer-header-controls:not(.is-external) .diff-viewer-header-mode*` (lines 220-255) | jsdom-style cascade 复合 | ❌ — `:not()` + 后代不可 inline |
| `.diff-viewer-header-close-button*` (lines 257-273) | ✅ git-history.part1.css:1097+1112+1138 后代 | ❌ |
| `.diff-viewer-mode-glyph*` (lines 209, 275-313) | base + pseudo | ⚠️ — pseudo ::before/::after 不可 inline |
| `.diff-viewer-mode-label` (line 216) | ✅ git-history.part1.css:1068 后代 | ❌ |
| `.diff-viewer-inline-mode-icon*` (lines 140-188) | base + pseudo ::before/::after + inset variants | ❌ — pseudo 不可 inline |
| `.diff-viewer-sticky` / `.diff-viewer-header-sticky` (lines 316-329) | cascade base for sticky behavior | ⚠️ |

**所有 header cluster 的 base rule 都被 cross-CSS-file 后代 selector 引用（git-history.part1.css 的 modal 头部沿用同名 class 作为后代 selector token）**。删除 base rule 会让 modal 头部 vendor cluster 失去基础 visual base，但 git-history 后代 rule 自身只 override 部分属性（gap / margin / 字号），不重新声明完整 base。

**结论**：header cluster 完全不能 inline-删除，必须保留全部 base rules。

## Cross-component / cross-css consumer 全表

```bash
$ grep -rEn "diff-viewer-(header|path|status)" src/ | grep -v ".test.ts"
src/features/git/components/ImageDiffCard.tsx:89:90:93   # ❌ scope 外 tsx 消费 diff-viewer-header/-status/-path
src/features/git/components/GitDiffViewer.tsx:159,160,163,1068,...,1234  # ✅ scope 内
src/styles/git-history.part1.css:1046,1051,1055,1064,1068,1072,1073,1090,1091,1097,1112,1138,1176,1177  # ❌ scope 外 css 14 处后代 selector 引用 diff-viewer-header-*
src/styles/diff-viewer.css:73,86,...  # ✅ scope 内
```

```bash
$ grep -rEn "diff-viewer-anchor" src/ | grep -v ".test.ts"
src/features/git/components/GitDiffViewer.tsx:932,935,942,949,1062,1249,1329  # ✅ scope 内
src/styles/diff-viewer.css:331,351,357,371,378,382,390,399,404,405,409,414,418,422,426,439,444  # ✅ scope 内
```

Anchor cluster 没有 cross-component / cross-css 消费者（除 `is-anchor-modal-pager` state class 由 GitDiffViewer 自己挂上）。但其 jsdom test pin + cascade-state architecture 仍封住所有 selector。

## 选项分析

### 选项 A: 完全跳过 anchor + header（推荐）

- 修改 0 文件
- 写本 plan doc 记录阻塞
- 验证：跑 lint / typecheck / test:layout-guard / check:large-files:gate，确认 baseline 仍 pass
- follow-up: 把 anchor / header 两个 sub-PR 重新定性为「非 CSS-to-Tailwind 类型，需 cross-component / cross-css 协同改造」，留给后续 phase

### 选项 B: 仅 inline anchor base 3 个 selector（`-inner` / `-btn` base+disabled / `-meta`），保留 css rule 不删

- 修改 GitDiffViewer.tsx +6 inline className 处
- diff-viewer.css 不变（因为不能删除 base 否则 cascade target 失去 base）
- 净收益 = **css 一行不减** + tsx 多 6 处 inline = 负收益
- ❌ 违反「Every changed line should trace directly to the user's request」

### 选项 C: 大幅突破 scope（不可取）

- 同时改 ImageDiffCard.tsx + git-history.part1.css，把所有 diff-viewer-header-* cross-component 消费点同步迁移
- 估计 tsx diff +400-600 行，css diff -250 行
- ❌ 严重突破 prompt 明示 scope（"src/features/git/components/GitDiffViewer.tsx anchor + header 段"）
- ❌ 引入 ImageDiffCard / git-history modal 回归风险

## 决策：选项 A

- 不动 `src/styles/diff-viewer.css`
- 不动 `src/features/git/components/GitDiffViewer.tsx`
- 仅新增本 plan doc

## Verification 计划（baseline 仍 pass）

```bash
npm run lint
npm run typecheck
npm run test:layout-guard       # 46/46 必须 pass，重点 4 个 anchor swap test (line 312-329)
npm run check:large-files:gate
```

定向 GitDiffViewer 相关测试（如有）：

```bash
npm run test -- src/features/git/__tests__/GitDiffViewer 2>/dev/null || echo "no direct GitDiffViewer test"
```

## Follow-up（push 回 orchestrator）

| Sub-PR | 重新定性 | Owner |
|---|---|---|
| **9.2.anchor** (原计划) | ❌ 不可作为「CSS-to-Tailwind inline」类型。Anchor cluster 的 4 个 viewport/swap rule + 5 个 `.is-anchor-modal-pager` 祖先-state rule 都需要保留为 CSS。若必须 inline，需把 anchor 状态架构从「ancestor className cascade」改造为「children data-attribute + Tailwind data variant」，远超本 phase scope。建议**关闭此 sub-PR**，保留 css 为最终形态。 | orchestrator |
| **9.2.header** (原计划) | ❌ 不可作为「CSS-to-Tailwind inline」类型。Header cluster 全部 base rule 被 ImageDiffCard.tsx + git-history.part1.css 共用（cross-component + cross-css），删除 css 会引发跨文件回归。若必须 inline，需把 ImageDiffCard 头部独立成自有 className + 把 git-history modal 头部 vendor 自有 class，工作量等同重写。建议**关闭此 sub-PR**，保留 css。 | orchestrator |
| **9.2.body** (原计划其它后续 cluster) | 待评估，本 phase 不涉及 | orchestrator |

## 与 phase-9-2-diff-plan.md 的关系

原 plan（commit `b2736ba9`）只完成了 9.2.pr (PullRequestSummary cluster) sub-PR，并 defer 9.2.anchor / 9.2.header / 9.2.body 三个后续。本次 discovery **进一步确认** 9.2.anchor / 9.2.header 在 scope boundary 内无可执行内容，建议从 follow-up 队列中**剔除或转换性质**。
