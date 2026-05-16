# Phase 5.6a — Kanban mode-toggle + projects (sub-PR)

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 5.6a (kanban.css 切片 1 of 3)
> Date: 2026-05-17
> Strategy: in-place trim of `src/styles/kanban.css` (DO NOT delete file)

## Background

Phase 5 决议把 `src/styles/kanban.css`(2071 行 / 280 selector / 14 tsx consumer /
240+ className refs) 推迟到 5.6 并拆分 3 个 sub-PR。本 PR 是 **5.6a**,只动 *mode-toggle*
与 *projects (workspace list + panel list)* 两个段。其余推迟到 5.6b/c。

## Discovery

```
$ wc -l src/styles/kanban.css        # 2071
$ grep -cE '^\.' src/styles/kanban.css # 280 selector
$ npm run test:layout-guard           # 46/46 baseline
$ npm run check:large-files:gate      # found=1 (SpecHubPresentationalImpl 既有 baseline,delta=0)
```

**测试 pin 验证**:无 CSS 字面值断言指向 `kanban.css`(无 `readFileSync.*kanban`)。
`src/styles/layout-swapped-platform-guard.test.tsx` 不读 kanban.css。

### 段落地图(kanban.css 行号)

| 段 | 行范围 | 顶层 selector | 5.6a 是否处置 |
|---|---:|---|---|
| Mode Toggle | 6-53 | `.kanban-mode-toggle` / `.kanban-mode-btn` / `.kanban-mode-label` / `.kanban-mode-btn.is-active` | **YES** |
| Fullscreen Layout | 55-88 | `.app.kanban-active` / `.kanban-fullscreen` (含 child `.kanban-board` / `.kanban-projects` / `.kanban-panels`) | **NO**(交叉引用 board/panels,保留给 5.6b) |
| Projects Page | 90-218 | `.kanban-projects` / `.kanban-projects-topbar` / `.kanban-projects-content` / `.kanban-projects-header` / `.kanban-projects-title` / `.kanban-projects-subtitle` / `.kanban-projects-grid` / `.kanban-project-card*` (10 子 selector) | **YES** |
| Panel Card / Board / ... | 219-410 | `.kanban-panel-card*` / `.kanban-board*` / ... | NO(5.6b/c) |
| Kanban Project Selector(header dropdown) | 409-519 | `.kanban-project-menu` / `.kanban-project-button` / `.kanban-project-caret` / `.kanban-project-dropdown` + `.kanban-back-menu*` | NO(belong to `KanbanBoardHeader.tsx`,5.6b) |
| 其余 | 521-2071 | board header / search / icon-btn / card / column / task / modal / rich input / git panel / terminal | NO |

### tsx consumers in scope

| File | Lines | 5.6a 相关 className |
|---|---:|---|
| `src/features/kanban/components/KanbanModeToggle.tsx` | 42 | `kanban-mode-toggle` / `kanban-mode-btn` (+ `is-active`) / `kanban-mode-label` |
| `src/features/kanban/components/ProjectList.tsx` | 81 | `kanban-projects` / `kanban-projects-topbar` / `kanban-projects-content` / `kanban-projects-header` / `kanban-projects-title` / `kanban-projects-subtitle` / `kanban-projects-grid` |
| `src/features/kanban/components/ProjectCard.tsx` | 57 | `kanban-project-card` / `-header` / `-icon` / `-name` / `-footer` / `-path` / `-count` |
| `src/features/kanban/components/PanelList.tsx` | 193 | 同 ProjectList(`kanban-projects*` / `kanban-projects-title` / `kanban-projects-subtitle` / `kanban-projects-grid`)(注意:`kanban-panel-list-title-row` / `kanban-modal*` / `kanban-btn` 等不属本 PR,**只动 `kanban-projects*` 段**) |

`KanbanBoardHeader.tsx`(使用 `kanban-project-menu/button/caret/dropdown`)**不在
本 PR 范围**——交给 5.6b。

### 测试 / 行为风险

- 无 querySelector 测试 pin 命中 5.6a 涉及的 className(`grep -rn 'kanban-mode\|kanban-projects\|kanban-project-card' src/**/*.test.*` 0 命中)
- 4 个目标组件**无对应单元测试**,行为护栏来自 KanbanView.tsx 路由 + 业务集成(drag/drop / store mutation 在其它组件)
- mode-toggle 是顶部条目纯展示按钮,无嵌套布局风险
- projects 页是 grid + cards,无层叠 / fixed / popover anchor 复杂度

### 决策:in-place 缩容,不删 kanban.css

`kanban.css` 仍有 1800+ 行(280 selector 中 5.6a 只处理约 22 个),不能在
`bootstrap.ts` 卸载;**采用 in-place 删除已迁移的段**(行 6-53、90-218),其它
行保留原样。同 Phase 9 detached-file-explorer.css 处置方式。

## 处置步骤

### Step 1 — `KanbanModeToggle.tsx` 内联

把 mode-toggle CSS 翻译为 Tailwind + coss token,保留 className 为 no-op marker。

| 原 CSS rule | 内联 Tailwind |
|---|---|
| `.kanban-mode-toggle` flexbox(`inline-flex items-center gap-[2px]`)+ `bg-[var(--bg-tertiary,...)]` + `rounded-[8px] p-[3px]` | `inline-flex items-center gap-0.5 bg-[var(--bg-tertiary,#f0f0f0)] rounded-lg p-[3px]` |
| `.kanban-mode-btn` 28px 高 + 12px padding + transparent border + radius 6 + text-tertiary + 13px/500 + nowrap + transition | `inline-flex items-center gap-[5px] h-7 px-3 border border-transparent bg-transparent rounded-md cursor-pointer text-[var(--text-tertiary,#999)] text-[13px] font-medium leading-none whitespace-nowrap transition-[background,color,border-color] duration-150` |
| `.kanban-mode-label` `flex-shrink:0` | `shrink-0` |
| `.kanban-mode-btn svg` `block; flex-shrink:0` | (无需 — `<MessageSquare/>` 默认 display:block 通过 lucide;safety:加 `[&_svg]:block [&_svg]:shrink-0`) |
| `.kanban-mode-btn:hover` text-secondary + transform/shadow none | `hover:text-[var(--text-secondary,#666)]` |
| `.kanban-mode-btn.is-active` bg-primary + text-primary + border-color + tiny box-shadow | conditional `bg-[var(--bg-primary,#fff)] text-[var(--text-primary,#333)] border-[var(--border-color,#e0e0e0)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]`(继续走 is-active className,但直接在条件 string 内拼) |

`is-active` 仍以 className 字段切换(保留 `is-active` 字面值用于 marker + 可能的
外部 CSS 命中检查),Tailwind 部分用条件拼接 string。同 Home.tsx 模式。

### Step 2 — `ProjectList.tsx` 内联

| 原 selector | 内联 Tailwind |
|---|---|
| `.kanban-projects` `flex flex-col h-full overflow-hidden` | 直接 `flex flex-col h-full overflow-hidden` |
| `.kanban-projects-topbar` `flex items-center; padding 12 24 12 80; border-bottom; -webkit-app-region:drag; relative; z-index:3` | `flex items-center py-3 pr-6 pl-20 border-b border-[var(--border-color,#e5e5e5)] relative z-[3] [-webkit-app-region:drag]` |
| `.kanban-projects-topbar > *` `-webkit-app-region:no-drag` | 用 `[&>*]:[-webkit-app-region:no-drag]` 子选择器内联 |
| `.kanban-projects-content` `flex-1 overflow-y-auto p-32-40` | `flex-1 overflow-y-auto py-8 px-10` |
| `.kanban-projects-header` `flex items-start justify-between mb-24` | `flex items-start justify-between mb-6` |
| `.kanban-projects-title` `text-24/700; mb-4; text-primary` | `text-2xl font-bold m-0 mb-1 text-[var(--text-primary,#111)]` |
| `.kanban-projects-subtitle` `text-14; text-secondary; m-0` | `text-sm text-[var(--text-secondary,#666)] m-0` |
| `.kanban-projects-grid` `grid; auto-fill minmax(280,1fr); gap-16` | `grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4` |

### Step 3 — `ProjectCard.tsx` 内联

| 原 selector | 内联 Tailwind |
|---|---|
| `.kanban-project-card` `bg-primary; border; rounded-10; p-16; cursor pointer; transition; overflow hidden; min-width 0` | `bg-[var(--bg-primary,#fff)] border border-[var(--border-color,#e5e5e5)] rounded-[10px] p-4 cursor-pointer transition-[border-color,box-shadow] duration-150 overflow-hidden min-w-0` |
| `:hover` border-hover + shadow | `hover:border-[var(--border-hover,#ccc)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]` |
| `.kanban-project-card-header` `flex; items-center; justify-between; mb-12` | `flex items-center justify-between mb-3` |
| `.kanban-project-card-name` `text-15/600; text-primary; ellipsis; flex-1; min-w-0` | `text-[15px] font-semibold text-[var(--text-primary,#111)] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0` |
| `.kanban-project-card-menu` `relative; flex-shrink:0`(注:**JSX 未使用,纯 CSS 残留** — 见 footnote;放安全保留) | n/a(JSX 无此 className;CSS rule 仍移除) |
| `.kanban-project-card-footer` `flex col gap-8; text-12; text-tertiary; min-w-0` | `flex flex-col gap-2 text-xs text-[var(--text-tertiary,#999)] min-w-0` |
| `.kanban-project-card-path` `ellipsis; min-w-0` | `overflow-hidden text-ellipsis whitespace-nowrap min-w-0` |
| `.kanban-project-card-date` `flex items-center gap-4` | (JSX 无此 className,纯 CSS 残留)CSS rule 仍移除 |
| `.kanban-project-card-count` `inline-flex items-center self-start; padding 2 8; text-11/500; text-secondary; bg-secondary; rounded-4; nowrap; flex-shrink:0` | `inline-flex items-center self-start py-0.5 px-2 text-[11px] font-medium text-[var(--text-secondary,#666)] bg-[var(--bg-secondary,#f5f5f5)] rounded whitespace-nowrap shrink-0` |

`.kanban-project-card-icon` CSS rule does not exist(grep 0 命中 in `kanban.css`)
— icon 已直接通过 lucide size prop 控制。className 在 tsx 已是 no-op marker,
保留不变。

### Step 4 — `PanelList.tsx` 内联

PanelList 与 ProjectList 共享 `kanban-projects` 容器骨架。**只动相关 className**
(`kanban-projects` / `-topbar` / `-content` / `-header` / `-title` / `-subtitle` /
`-grid`),其它 className(`kanban-panel-list-title-row` / `kanban-icon-btn` /
`kanban-empty` / `kanban-btn` / `kanban-btn-primary` / `kanban-input` /
`kanban-modal*` / `kanban-panel-create-row`)**保持原样**——它们的 CSS 仍在
`kanban.css` 中,等 5.6b/c 处理。

### Step 5 — `kanban.css` in-place 删除

删除行 6-53(mode toggle,含 comment header)+ 行 90-218(projects page,含
comment header)。**保留**:
- 文件不删,`bootstrap.ts:34` import 不动
- Line 55-88(fullscreen layout)保留 — 5.6b 处置
- Line 219+ 保留 — 5.6b/c 处置

预期 kanban.css 行数:2071 → ~1900(−170 行)。

## 验证步骤

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:layout-guard`(必须 46/46)
4. `npm run check:large-files:gate`(必须 found=1 / delta=0 不退化)
5. 定向 vitest(kanban 相关):
   ```
   npx vitest run src/features/kanban/
   ```
   预期 KanbanBoardHeader / KanbanCard / KanbanColumn(3 个 recurring/bulk)/
   TaskCreateModal / useKanbanStore + utils 全 pass(本 PR 未触及)。

## Scope 收缩兜底

如果 tsx diff > 1500 行 → 进一步拆:
- 先做 mode-toggle(KanbanModeToggle.tsx,~40 行 tsx + ~50 行 CSS)
- 再做 projects(ProjectList + ProjectCard + PanelList 的 `kanban-projects*` className,~330 行 tsx + ~130 行 CSS)
- 仍超就只交 mode-toggle 段,projects 进 5.6a-2

实际估算:4 个文件 tsx 加起来 < 400 行,inline 后增量 className 字符串约 + 600 字
< 200 增量行 diff。在 1500 上限内。

## Follow-up

- **5.6b**:fullscreen layout(`kanban-fullscreen` / `app.kanban-active`)+ board
  header dropdown(`kanban-project-menu/button/caret/dropdown` + `kanban-back-menu*`)
  + KanbanBoardHeader.tsx
- **5.6c**:panel card / board / column / task / modal / rich-input / git-panel
  / terminal (剩余 1700+ 行 CSS / 多个 tsx)

## 文件改动清单

- 改:`src/features/kanban/components/KanbanModeToggle.tsx`
- 改:`src/features/kanban/components/ProjectList.tsx`
- 改:`src/features/kanban/components/ProjectCard.tsx`
- 改:`src/features/kanban/components/PanelList.tsx`(只动 `kanban-projects*` className)
- 改:`src/styles/kanban.css`(删除行 6-53 + 90-218)
- 新:`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-5-6a-kanban-mode-toggle-plan.md`(本文)

不动:`bootstrap.ts` / 其它 src/features/* / 其它 .css / `themes.*.css` / `composer.part2.css` / base / docs / PRD。
