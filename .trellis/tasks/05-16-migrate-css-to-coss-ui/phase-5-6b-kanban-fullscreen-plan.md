# Phase 5.6b — Kanban fullscreen + board header dropdown (sub-PR)

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 5.6b (kanban.css 切片 2 of 3,接 5.6a)
> Date: 2026-05-17
> Strategy: in-place trim of `src/styles/kanban.css` (DO NOT delete file)

## Background

延续 5.6a(2071→1896,mode-toggle + projects 已 inline)。本 PR 是 **5.6b**,
只动 *fullscreen layout* + *board header dropdown cluster*(project-menu /
project-button / project-caret / project-dropdown / back-menu*)。其余推迟到 5.6c。

## Discovery

```
$ wc -l src/styles/kanban.css        # 1896 (baseline after 5.6a)
$ npm run test:layout-guard           # 46/46 baseline OK
$ npm run check:large-files:gate      # found=1 (SpecHubPresentationalImpl baseline,delta=0)
```

**测试 pin 验证**:
- `grep -rn 'kanban-fullscreen\|kanban-active\|kanban-project-menu\|kanban-project-button\|kanban-project-caret\|kanban-project-dropdown\|kanban-back-menu' src --include='*.test.*'` → 0 命中
- `KanbanBoardHeader.test.tsx` 只断言 role/text(menu / menuitem),未触及任何 className 字面值

### 段落地图(kanban.css 当前 1896 行)

| 段 | 行范围 | 顶层 selector | 本 PR 是否处置 |
|---|---:|---|---|
| Fullscreen Layout | 7-40 | `.app.kanban-active` / `.kanban-fullscreen` (含 `> .terminal-panel` / `> .kanban-board` / `> .kanban-projects` / `> .kanban-panels` 子规则) | **YES** |
| Panel Card / Panel List / Breadcrumb / Danger / Board / Board Header | 45-232 | `.kanban-panel-card*` / `.kanban-panel-list-title-row` / `.kanban-panel-create-row` / `.kanban-breadcrumb-*` / `.kanban-btn-danger` / `.kanban-board` / `.kanban-board-header` | NO(5.6c — 留给 wider board chrome / panel-card / breadcrumb 等) |
| Kanban Project Selector(header dropdown) | 234-344 | `.kanban-project-menu` / `.kanban-project-button` / `.kanban-project-button:hover` / `.kanban-back-menu` / `.kanban-back-menu-trigger` / `.kanban-back-menu-trigger:hover` / `.kanban-back-menu-trigger[aria-expanded="true"]` / `.kanban-back-menu-list` / `.kanban-back-menu-item` / `.kanban-back-menu-item:hover` / `.kanban-project-caret` / `.kanban-project-dropdown` | **YES** |
| Board Header Right/Center/Search/Columns/Column ... | 347+ | `.kanban-board-header-right*` / `.kanban-board-header-center` / `.kanban-search-*` / `.kanban-columns` / `.kanban-column*` ... | NO(5.6c) |

### tsx consumers in scope

| File | 5.6b 相关 className | 说明 |
|---|---|---|
| `src/features/kanban/components/KanbanBoardHeader.tsx` (307 行) | `kanban-back-menu` / `-trigger` / `-list` / `-item`、`kanban-project-menu` / `-button` / `-caret` / `-dropdown` | 处置 dropdown cluster |
| `src/features/layout/components/DesktopLayout.tsx` (line 212) | `kanban-fullscreen` (`<section className="main kanban-fullscreen">`) | 处置 fullscreen 段(只在该 className 标记位置 inline 等价 Tailwind) |
| `src/app-shell-parts/useAppShellSections.ts` (line 2532) | `kanban-active` (动态拼接在 app shell className 字符串) | `.app.kanban-active { grid-template-columns: 1fr; }` 是 layout grid 覆写 — 见下文 |

> 不动:`KanbanBoardHeader` 内 wider header(`kanban-board-header*` outer wrapper /
> `kanban-board-title` / `kanban-search-*` / `kanban-icon-btn` / `kanban-breadcrumb-*`)
> — 保留 className,CSS 仍在 kanban.css,留 5.6c。

### `.app.kanban-active` 复合选择器分析

`.app.kanban-active { grid-template-columns: 1fr; }` 覆写整个 `.app` grid。
- `.app` 是 layout shell 容器,本身使用 `grid-template-columns` 显示多栏
- `kanban-active` 被动态拼接到 `.app` 的 className(`useAppShellSections.ts:2532`)
- **不能** inline 到 `<section className="main kanban-fullscreen">` 上(那是子节点)
- **必须** inline 到 `.app` 容器本身;但 `.app` 自身有 grid template 在 base/layout css

**决策**:`.app.kanban-active` 既不属于 fullscreen 子节点也不属于 dropdown,但**与
fullscreen 同语义触发**(`showKanban ? "kanban-active"`)。**保留** 此规则在 kanban.css
里(只 4 行 + 1 selector),不动它,留待 5.6c 整体清理 app shell layout 与
home-active / kanban-active 等条件 grid 覆写时一并 inline。

理由:Inline 它需要同时 touch `.app` 的 base grid 定义(在 layout.css / base.css),
属于跨 spec hub layout 重构,**超出本 PR scope**。

### Fullscreen Layout — token bridge 处理

`.kanban-fullscreen` rule 包含 11 个 `--bg-*` / `--border-*` / `--text-*` CSS var
bridge,把 legacy kanban token 桥接到 surface palette。这些 var 在
`.kanban-fullscreen` scope 内被**子组件全局消费**(kanban-board / column / card /
modal / search / etc.)— **不可丢弃**。

**决策**:在 tsx 里通过 `style={{}}` inline CSS custom properties,scope 限定 fullscreen
section。或者保留 `.kanban-fullscreen { --bg-primary: ...; }` 这 11 行 var bridge,
只移除 layout 部分(display/flex/width/height/overflow)。

**推荐 second 方案**(保留 var bridge,移除 layout):理由
1. var bridge 是 cascade scope 上下文,**子组件依赖** — inline 到 style={{}} 会失去
   selector 上下文优势,且 style attr 比 CSS class 优先级更高(不利后续调试)
2. layout 部分(`display:flex; flex-direction:column; width:100%; height:100%;
   overflow:hidden`)可以 inline 到 `<section>` 的 Tailwind class
3. `> .terminal-panel`、`> .kanban-board`、`> .kanban-projects`、`> .kanban-panels`
   子选择器规则**也用 cascade 作用** — 移除会破坏子组件 flex 行为
4. 子选择器规则**保留**(等子组件本身迁移时一并 inline)

**净处置**:
- ✅ 移除 `.kanban-fullscreen { display/flex/width/height/overflow }` 5 个 layout 声明
- ✅ 在 `<section className="main kanban-fullscreen flex flex-col w-full h-full overflow-hidden">` 内联 Tailwind 等价
- ⚠️ 保留 `.kanban-fullscreen` rule 里的 11 个 CSS var bridge(留给 5.6c 处置)
- ⚠️ 保留 `> .terminal-panel` / `> .kanban-board` / `> .kanban-projects` / `> .kanban-panels` 子规则(留给 5.6c)

### tsx 行为风险

- `KanbanBoardHeader.test.tsx` 只测 menu role / menuitem text,不命中 className
- 无 querySelector pin
- popover-surface(base.css 定义 z-index/bg)继续生效 — `kanban-back-menu-list` 与
  `kanban-project-dropdown` 都同时有 `popover-surface` className,bg/shadow/border
  由 popover-surface 提供
- `.project-search` / `.project-list` / `.project-item` / `.project-empty` 是**marker only**
  (无 CSS),不影响渲染。保留不动。

## 处置步骤

### Step 1 — `KanbanBoardHeader.tsx` inline dropdown cluster

`kanban-project-menu`、`kanban-project-button`、`kanban-project-caret`、
`kanban-project-dropdown`、`kanban-back-menu*` 的 CSS 全部内联到 className,
保留语义 className 作为 no-op marker(同 5.6a / 5.6a/composer 模式)。

| 原 selector | 内联 Tailwind |
|---|---|
| `.kanban-project-menu` `relative inline-flex items-center min-w-0` | `relative inline-flex items-center min-w-0` |
| `.kanban-project-button` `inline-flex items-center gap-1 bg-transparent border-none cursor-pointer py-0.5 px-1 rounded-md min-w-0` | `inline-flex items-center gap-1 bg-transparent border-none cursor-pointer py-0.5 px-1 rounded-md min-w-0` |
| `.kanban-project-button:hover` `bg: var(--surface-control-hover)` | `hover:bg-[var(--surface-control-hover)]` |
| `.kanban-back-menu` `relative` | `relative` |
| `.kanban-back-menu-trigger` `inline-flex items-center gap-1.5 bg-transparent border border-transparent text-[var(--text-secondary,#666)] text-[13px] font-medium cursor-pointer px-2.5 h-7 rounded-md transition-[background,color,border-color] duration-150` | 内联 |
| `.kanban-back-menu-trigger:hover` `bg-[var(--bg-tertiary,#f0f0f0)] text-[var(--text-primary,#111)]` | `hover:bg-[var(--bg-tertiary,#f0f0f0)] hover:text-[var(--text-primary,#111)]` |
| `.kanban-back-menu-trigger[aria-expanded="true"]` `border-[var(--border-color,#e5e5e5)] bg-[var(--bg-secondary,#f8f8f8)] text-[var(--text-primary,#111)]` | 用 `aria-expanded:border-... aria-expanded:bg-... aria-expanded:text-...` (Tailwind v3 aria 变体)或拼条件 string `${backMenuOpen ? "border-[...] bg-[...] text-[...]" : ""}` — 后者更稳健 |
| `.kanban-back-menu-list` `absolute top-[calc(100%+6px)] left-0 min-w-[156px] z-[11] rounded-[10px] p-1.5 flex flex-col gap-1` | 内联 |
| `.kanban-back-menu-item` `inline-flex items-center gap-1.5 w-full border-none rounded-lg bg-transparent text-[var(--text-secondary,#666)] text-[13px] text-left py-1.5 px-2 cursor-pointer` | 内联 |
| `.kanban-back-menu-item:hover` `bg-[var(--surface-control-hover)] text-[var(--text-primary,#111)]` | `hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary,#111)]` |
| `.kanban-project-caret` `text-[var(--text-faint)] text-xs shrink-0 leading-none` | 内联 |
| `.kanban-project-dropdown` `absolute top-[calc(100%+6px)] left-0 min-w-[220px] max-w-[320px] max-h-[360px] z-10 rounded-[10px] p-1.5 flex flex-col gap-1 overflow-hidden` | 内联 |

注:`popover-surface`(base.css)的 bg / shadow / border 通过同时挂 `popover-surface`
className 继续生效,不在本 PR 触及。

### Step 2 — `DesktopLayout.tsx` (`kanban-fullscreen` layout 5 声明 inline)

`<section className="main kanban-fullscreen">` → `<section className="main kanban-fullscreen flex flex-col w-full h-full overflow-hidden">`

`kanban-fullscreen` 作为 no-op marker 保留(用于 CSS var bridge cascade,直至 5.6c
清理 children)。

### Step 3 — `kanban.css` in-place trim

**修改**:
1. 行 12-28 `.kanban-fullscreen { ... }` 块:
   - 保留 11 个 `--bg-* / --border-* / --text-*` var bridge(line 13-22)
   - **移除** layout 5 声明 `display: flex` / `flex-direction: column` / `width: 100%` / `height: 100%` / `overflow: hidden` (line 23-27)
2. **移除** 行 234-344 整个 "Kanban Project Selector" 段
   - `.kanban-project-menu`、`.kanban-project-button`、`.kanban-project-button:hover`、`.kanban-back-menu`、`.kanban-back-menu-trigger`、`.kanban-back-menu-trigger:hover`、`.kanban-back-menu-trigger[aria-expanded="true"]`、`.kanban-back-menu-list`、`.kanban-back-menu-item`、`.kanban-back-menu-item:hover`、`.kanban-project-caret`、`.kanban-project-dropdown`
3. **保留**:
   - 行 7-11 `.app.kanban-active`(留 5.6c)
   - 行 13-22 `.kanban-fullscreen` var bridge + 末尾 `}` 闭合
   - 行 30-40 `.kanban-fullscreen > .terminal-panel` / `> .kanban-board` / `> .kanban-projects` / `> .kanban-panels` (留 5.6c)
   - 行 42-43 comment(已 phase-5.6a 留)
   - 行 45+ panel-card / breadcrumb / board / board header / search / column / ... 全部(5.6c)

**预期**:1896 → ~1780 行(−110 ~ −115 行,移除 dropdown segment ~110 行 + fullscreen
layout 5 声明)。

## 验证步骤

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:layout-guard`(46/46)
4. `npm run check:large-files:gate`(found=1 / delta=0)
5. 定向 vitest:
   ```
   npx vitest run src/features/kanban/components/KanbanBoardHeader.test.tsx
   ```
   预期 2/2 pass(back menu open/close + outside pointer)

## Scope 收缩兜底

如果 tsx diff > 1500 行 → 拆分:
- 先做 fullscreen layout(`DesktopLayout.tsx` + 5 个 CSS 声明,diff < 20 行)
- 再做 dropdown cluster(`KanbanBoardHeader.tsx` + 110 行 CSS)

实际估算:DesktopLayout 1 行 className 改 + KanbanBoardHeader inline 12 个 className
位置(每位 ~80 字符),diff < 250 行。在 1500 上限内。

## Follow-up

- **5.6c**:剩余 1780 行 — 包含:
  - `.app.kanban-active`(app shell grid 覆写,需配合 layout 重构)
  - `.kanban-fullscreen` var bridge + 子选择器规则(待子组件迁移)
  - panel-card / panel-list-title-row / panel-create-row / breadcrumb / danger-btn
  - kanban-board / kanban-board-header outer chrome / kanban-board-title
  - kanban-board-header-center / -right / search-box / -icon / -input
  - kanban-icon-btn
  - kanban-columns / kanban-column / column-header / column-* / kanban-task* / kanban-card*
  - kanban-modal* / kanban-rich-input* / kanban-empty / kanban-btn* / kanban-input
  - git panel / terminal 残留(若有)

## 文件改动清单

- 改:`src/features/kanban/components/KanbanBoardHeader.tsx`(inline dropdown cluster)
- 改:`src/features/layout/components/DesktopLayout.tsx`(inline fullscreen layout 5 声明)
- 改:`src/styles/kanban.css`(删除 dropdown 段 ~110 行 + fullscreen layout 5 行)
- 新:`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-5-6b-kanban-fullscreen-plan.md`(本文)

不动:`bootstrap.ts` / 其它 css / 其它 feature / base / themes / docs / PRD /
Kanban Board / Column / Card / Modal / Rich-Input(留 5.6c)。
