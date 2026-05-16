# Phase 9.4 — terminal.css coss 化

> Status: drafted 2026-05-17 by Implement agent on main worktree, head `83c280bd`.
>
> Outcome target: delete `src/styles/terminal.css` (193 lines, ~25 selectors); inline all panel chrome to `TerminalDock.tsx` + `TerminalPanel.tsx` as Tailwind utilities + retained semantic markers; preserve all 4 xterm DOM overrides + the `.terminal-panel { grid-row:5; grid-column:1/-1 }` main-grid contract + the `--terminal-{background,foreground,cursor,selection,font-family}` runtime-read custom-prop bundle in a new `src/styles/terminal-xterm-keepers.css`.

## Discovery

### CSS scope

| File | Lines | Selectors | Bootstrap import |
|---|---:|---:|---|
| `src/styles/terminal.css` | 193 | 22 (incl. 4 nested `.terminal-surface .xterm…` overrides) | `src/bootstrap.ts:23` |

### tsx consumer surface

| File | Lines | className count using `.terminal-*` |
|---|---:|---:|
| `src/features/terminal/components/TerminalDock.tsx` | 82 | 9 (`terminal-panel`, `terminal-panel-resizer`, `terminal-header`, `terminal-tabs`, `terminal-tab` (+`active`), `terminal-tab-label`, `terminal-tab-close`, `terminal-tab-add`, `terminal-body`) |
| `src/features/terminal/components/TerminalPanel.tsx` | 22 | 4 (`terminal-shell`, `terminal-surface`, `terminal-overlay`, `terminal-status`) |

No external consumer uses any of these classnames as a real CSS selector — verified via:

```bash
grep -rln 'terminal-panel\|terminal-shell\|terminal-surface\|terminal-header\|terminal-tab\|terminal-overlay\|terminal-status\|terminal-body\|terminal-dock' src/
```

Hits:
- `src/features/terminal/components/TerminalDock.tsx` / `TerminalPanel.tsx` — owned by this PR.
- `src/features/layout/hooks/useResizablePanels.ts:27,122-123,296,357,365,534` — `"terminal-panel"` is a **string-literal ref-type discriminator** (`type: "sidebar" | "right-panel" | "plan-panel" | "terminal-panel" | "debug-panel"`) and **also writes `--terminal-panel-height` to the `.app` element via `app.style.setProperty`** (line 123). NOT a CSS class selector → no change needed.
- `src/features/layout/components/DesktopLayout.test.tsx:38` — `<div>terminal-dock</div>` placeholder text content. Not a class.
- `src/features/layout/hooks/useLayoutNodes.client-ui-visibility.test.tsx:216,220` — `data-testid="terminal-dock"` / `data-testid="terminal-panel"`. Not a CSS class.
- `src/app-shell-parts/renderAppShell.tsx`, `BasicBehaviorSection.tsx`, `clientDocumentationData.ts`, `kanban.css` — string occurrence of "terminal" (e.g., setting labels, doc strings); none reference any `.terminal-*` CSS class.

### Runtime CSS-var consumer (critical)

`src/features/terminal/hooks/useTerminalSession.ts:60-89` `getTerminalAppearance()` reads via `getComputedStyle(container).getPropertyValue(...)`:
- `--terminal-background`
- `--terminal-foreground`
- `--terminal-cursor`
- `--terminal-selection`
- `--terminal-font-family`

with fallbacks to `--surface-debug` / `--surface-panel` / `--text-stronger` / `--code-font-family`. `container` is the `.terminal-surface` div (passed via `TerminalPanel.containerRef`). Custom properties inherit through cascade → setting them on `.terminal-panel` (the ancestor of `.terminal-surface`) keeps the existing chain intact.

These 5 vars are currently defined on `.terminal-panel` in `terminal.css` lines 11-18 as:

```css
--terminal-background: var(--theme-terminal-background, #11151b);
--terminal-foreground: var(--theme-terminal-foreground, #d9dee7);
--terminal-cursor:     var(--theme-terminal-cursor, #d9dee7);
--terminal-selection:  var(--theme-terminal-selection, rgba(60,140,220,0.4));
--terminal-font-family:var(--theme-terminal-font-family, var(--code-font-family));
```

**Strategy decision**: define these in the keeper file on `.terminal-panel`, NOT as Tailwind arbitrary-value `[--terminal-background:…]` classes — three reasons:
1. The values contain nested `var()` with comma-separated fallbacks. Tailwind arbitrary-value strings cannot use commas without underscore-encoding, which makes the resulting class hard to read and prettier-formatter-hostile (would force multi-line wrap on every `--terminal-*` class).
2. The keeper file already needs to exist for the 4 xterm DOM overrides + main-grid contract; adding 5 vars to its `.terminal-panel { … }` block costs zero extra files.
3. Mirrors Phase 7 `git-history-shell-keepers.css` precedent (which puts `--git-history-pane-bg` + 18 other `--git-filetree-*` vars on `.git-history-workbench` via the keeper, not Tailwind).

### Cross-file main-grid contract verification

```bash
grep -n 'grid-template-rows\|grid-row\|terminal' src/styles/main.css
```

- `src/styles/main.css:4` — `.main { grid-template-rows: auto 1fr auto auto auto auto; }` → 6 rows.
- `terminal.css:6-7` — `.terminal-panel { grid-column: 1 / -1; grid-row: 5; }` → terminal occupies row 5 (5th of 6).
- main.css contains zero textual reference to `terminal-*` → contract is one-way (terminal participates in main grid, main grid does not know terminal exists).

**Verification plan**: keep `grid-row:5` + `grid-column:1/-1` in the keeper file on `.terminal-panel` so the contract is preserved verbatim. (Could also use Tailwind `[grid-row:5] [grid-column:1/-1]` arbitrary-values on the className, but keeping in keeper makes the contract auditable in one place alongside the comment explaining the row=5 wiring.)

### xterm DOM overrides

`terminal.css:151-171` contains 4 nested rules under `.terminal-surface`:

```css
.terminal-surface .xterm,
.terminal-surface .xterm-screen,
.terminal-surface .xterm-viewport { background: var(--terminal-background) !important; }
.terminal-surface .xterm           { height:100%; width:100%; box-sizing:border-box; padding:8px 12px 8px; }
.terminal-surface .xterm-viewport  { height:100% !important; }
.terminal-surface .composition-view{ background:var(--terminal-background); color:var(--terminal-foreground); }
```

`.xterm`, `.xterm-screen`, `.xterm-viewport`, `.composition-view` are DOM nodes created by `@xterm/xterm` (`Terminal.open(container)` in `useTerminalSession.ts:178+`). These are **not in any React tree** — cannot be reached by Tailwind className inlining. Must be preserved as cascading CSS rules. → keeper file.

### `terminal-shell-configuration.md` sanity check

```bash
grep -n 'terminal' .trellis/spec/guides/terminal-shell-configuration.md
```

4 hits, all in lines 3/7/8/13. The spec covers `AppSettings.terminalShellPath` / `terminal_shell_path` / `terminal_open` — settings field + backend spawn contract, **zero CSS or className references**. Phase 9.4 scope does not touch settings, shell-spawn, or any spec-bound surface. Contract intact.

### Test pin verification

```bash
grep -n 'terminal' src/styles/layout-swapped-platform-guard.test.ts
# Exit 1 — zero matches. No literal-CSS pin for terminal.css.
```

```bash
find src/features/terminal -name '*.test.*'
# src/features/terminal/hooks/useTerminalTabs.test.tsx
```

`useTerminalTabs.test.tsx` tests the tabs hook (no DOM / className assertions). No test references any `.terminal-*` className via `querySelector`.

## Keeper file selection

New file: `src/styles/terminal-xterm-keepers.css` — contains:

1. `.terminal-panel` block with:
   - `grid-column: 1 / -1; grid-row: 5;` (main-grid contract).
   - 5 `--terminal-*` custom-property assignments (runtime-read by `useTerminalSession.ts`).
2. 4 nested `.terminal-surface .xterm…` / `.composition-view` overrides (xterm DOM cascade).

All other panel-chrome rules (borders, gaps, paddings, hover effects, font sizes, the resizer hairline pseudo-element, the active-tab underline color, etc.) → inlined to tsx as Tailwind utilities. Total expected keeper size ≈ 35-45 lines.

`bootstrap.ts` change: swap `import "./styles/terminal.css"` → `import "./styles/terminal-xterm-keepers.css"` (same slot, line 23).

## Inline migration map

### `TerminalDock.tsx`

Existing markup tree (line 30):
```
<section className="terminal-panel">
  <div className="terminal-panel-resizer" .../>     // conditional
  <div className="terminal-header">
    <div className="terminal-tabs">
      <button className="terminal-tab[ active]">    // per tab
        <span className="terminal-tab-label">…</span>
        <span className="terminal-tab-close">×</span>
      </button>
      <button className="terminal-tab-add">+</button>
    </div>
  </div>
  <div className="terminal-body">{terminalNode}</div>
</section>
```

| className | CSS source lines | Tailwind utilities to append |
|---|---|---|
| `terminal-panel` | 1-19 | `flex flex-col w-full border-t border-[color:var(--border-subtle)] bg-[var(--surface-debug)] h-[var(--terminal-panel-height,220px)] [-webkit-app-region:no-drag]` — kept as semantic marker. Grid placement + custom-prop bundle live in keeper. |
| `terminal-panel-resizer` | 21-41 | `relative h-1.5 cursor-row-resize shrink-0 after:content-[''] after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-[color:var(--border-strong)] after:opacity-40 hover:after:opacity-90` |
| `terminal-header` | 43-49 | `flex items-center gap-3 px-3 py-1.5 text-[12px]` |
| `terminal-tabs` | 51-59 | `flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto py-0.5` |
| `terminal-tab` (base) | 61-77 | `inline-flex items-center gap-2 border-0 border-b-2 border-transparent bg-transparent text-[color:var(--text-muted)] px-3 pt-1 pb-1.5 rounded-none text-[11px] tracking-[0.04em] uppercase cursor-pointer whitespace-nowrap shadow-none hover:transform-none hover:shadow-none` |
| `terminal-tab.active` | 79-83 | conditional via existing ternary: `text-[color:var(--text-stronger)] border-b-[#2563eb] bg-transparent` |
| `terminal-tab-label` | 85-89 | `max-w-[140px] overflow-hidden text-ellipsis` |
| `terminal-tab-close` | 91-94 | `text-[12px] text-[color:var(--text-faint)]` |
| `terminal-tab-add` | 96-106, 114-116 | `border-0 border-b-2 border-transparent bg-transparent text-[color:var(--text-muted)] px-3 pt-1 pb-1.5 rounded-none text-[12px] cursor-pointer shadow-none hover:transform-none hover:shadow-none hover:border-b-[#2563eb]` |
| `terminal-body` | 118-129 | `flex-1 min-h-0 flex overflow-hidden p-0 [&>.terminal-shell]:flex-1 [&>.terminal-shell]:min-h-0` |

Notes:
- `.terminal-body > .terminal-shell { flex:1; min-height:0 }` is a descendant override; rather than carrying it into the keeper, encode as Tailwind arbitrary-child selector `[&>.terminal-shell]:flex-1 [&>.terminal-shell]:min-h-0` on `.terminal-body` itself (precedent: many existing inlined `[&>…]` patterns).

### `TerminalPanel.tsx`

| className | CSS source lines | Tailwind utilities to append |
|---|---|---|
| `terminal-shell` | 131-138 | `relative flex flex-1 min-h-0 h-full p-0` |
| `terminal-surface` | 140-149 | `flex-1 min-h-0 h-full rounded-none overflow-hidden bg-[var(--terminal-background)] border-t border-[color:rgba(255,255,255,0.08)] box-border` |
| `terminal-overlay` | 173-185 | `absolute inset-0 flex items-center justify-center rounded-[10px] text-[color:var(--text-muted)] pointer-events-none text-center text-[12px] p-4` |
| `terminal-status` | 187-193 | `max-w-[280px] bg-[var(--surface-card)] border border-[color:var(--border-subtle)] rounded-[10px] px-3 py-2` |

(The keeper `.terminal-surface .xterm…` rules consume `.terminal-surface` as the marker — class must stay.)

## Files changed (this PR)

1. **New** `src/styles/terminal-xterm-keepers.css` — keeper with grid contract + 5 custom-props + 4 xterm DOM overrides + header docblock (~50 lines).
2. **Deleted** `src/styles/terminal.css`.
3. **Modified** `src/bootstrap.ts` — line 23 import swapped (1 line delta net 0).
4. **Modified** `src/features/terminal/components/TerminalDock.tsx` — extend className strings; markup tree unchanged.
5. **Modified** `src/features/terminal/components/TerminalPanel.tsx` — extend className strings; markup tree unchanged.
6. **New** `.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-9-4-terminal-plan.md` — this plan.

## Verification

| Command | Expected |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run test:layout-guard` | 46/46 (zero terminal references in guard) |
| `npm run check:large-files:gate` | retained, baseline=6111, delta=0 |
| `npx vitest run src/features/terminal/` | useTerminalTabs.test.tsx pass (no className assertions) |

## Out of scope / follow-up

- Future visual regression of terminal panel under macOS / Win / Linux themes — covered by Phase 10 manual smoke list (PRD line 55).
- `terminal-panel-resizer` could be folded into `Splitter` coss primitive once available (queued behind Phase 6/9 Splitter follow-up).
- `terminal-tab` could become a coss `Tabs` primitive once introduced (out of scope this PR).
