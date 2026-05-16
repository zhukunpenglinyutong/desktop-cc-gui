# Phase 2 — Global Chrome Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 2 (Global Chrome)
> Date: 2026-05-16

## Discovery summary

| File | Lines | Bytes | Imported via | tsx consumers | Scope verdict |
|---|---:|---:|---|---|---|
| `sidebar-shell.css` | 62 | 2.3K | `bootstrap.ts:4` | `Sidebar.tsx` (via `.sidebar` class chain) | **chrome** (defines sidebar shell layout vars + base box) |
| `sidebar.css` | 2448 | 52.6K | `bootstrap.ts:5` | many feature files (workspace/thread/worktree) | **business-heavy — skip in Phase 2** |
| `sidebar.chrome.css` | 532 | 10.4K | `@import` from `sidebar.css:1` | `Sidebar.tsx`, `DesktopLayout`, `TabletLayout` | **mixed — must skip** (also tied to two existing CSS-content tests) |
| `tabbar.css` | 62 | 1.2K | `bootstrap.ts:34` | `TabBar.tsx` only | **pure chrome** — clean rewrite candidate |
| `panel-lock.css` | 589 | 12.2K | `bootstrap.ts:48` | `LockScreenOverlay.tsx` only | **chrome-ish (large but isolated)** — rewrite candidate |
| `panel-tabs.css` | 104 | 2.2K | `bootstrap.ts:25` | `PanelTabs.tsx` only (test asserts `panel-tab.is-live` class) | **pure chrome** — rewrite candidate (keep class names) |
| `search-palette.css` | 346 | 8.0K | `bootstrap.ts:47` | `SearchPalette.tsx` only | **pure chrome** — rewrite candidate |
| `compact-tablet.css` | 149 | 2.5K | `bootstrap.ts:40` | `TabletNav.tsx`, `TabletLayout.tsx` | **pure chrome** — rewrite candidate |
| `compact-base.css` | 61 | 983B | `bootstrap.ts:38` | `PhoneLayout.tsx`, `TabletLayout.tsx` (`.compact-shell` / `.compact-panel`) | **pure chrome** — rewrite candidate |
| `compact-phone.css` | 88 | 1.3K | `bootstrap.ts:39` | `PhoneLayout.tsx` | **pure chrome** — rewrite candidate |
| `debug.css` | 116 | 1.8K | `bootstrap.ts:29` | `DebugPanel.tsx` only | **pure chrome** — rewrite candidate |

## Key risks

1. **`sidebar.css` and `sidebar.chrome.css`** carry 80%+ business logic (workspace/thread/worktree, market rail, context menus, etc.) and are also pinned by two existing assertion tests:
   - `src/styles/layout-swapped-platform-guard.test.ts` — asserts literal CSS text in `sidebar.css`, `sidebar.chrome.css`, `base.css`, `main.css`, `messages.css`, `diff-viewer.css`.
   - `src/styles/sidebar-titlebar-drag-region.test.ts` — asserts literal CSS rules in `sidebar.chrome.css`.

   Touching them would either (a) break the tests, or (b) require rewriting the test guards, both of which exceed Phase 2 scope (Threads / Workspace lives in Phase 3 + 5). **Decision: skip `sidebar.css` and `sidebar.chrome.css` in this phase.** Also skip `sidebar-shell.css` so the sidebar chain remains untouched (cluster cohesion).

2. **`panel-tabs.css`** is tiny but the PanelTabs test asserts on `.panel-tab.is-live` and `.panel-tab-icon.is-live` selectors. **Rewrite plan must keep class names** (use them as semantic markers; styles come from Tailwind utility on the same element).

3. **`panel-lock.css`** is 589 lines but used by exactly one component (`LockScreenOverlay.tsx`). Rewriting requires touching the entire JSX. **Decision: inline Tailwind on the component**, delete the CSS file.

4. **`tabbar.css`, `compact-*.css`, `debug.css`** are all small, single-component, and pure chrome. Safe rewrite.

## Per-file processing

### Drop list (delete + replace with Tailwind utility classes inline on tsx)

| File | Strategy | New token surface |
|---|---|---|
| `tabbar.css` | Inline Tailwind on `TabBar.tsx`; keep `.tabbar` / `.tabbar-item` class names as no-op semantic markers (no css rules) | `bg-card`, `border-t border-border`, `text-muted-foreground`, `data-[active]:bg-secondary` |
| `panel-tabs.css` | Inline Tailwind on `PanelTabs.tsx`; keep `panel-tab`, `panel-tab-icon`, `is-live`, `is-active` classes (test contract) | `text-muted-foreground`, `data-[active]:text-foreground`, custom keyframe via Tailwind v4 `@theme inline` (move keyframe to a tiny token-friendly form on `tsx` — use `animate-pulse`) |
| `panel-lock.css` | Inline Tailwind on `LockScreenOverlay.tsx`; preserve class names where they aid screenshot debug | `bg-card`, `border border-border`, `text-card-foreground`, `bg-popover`, `text-popover-foreground`, `bg-primary text-primary-foreground` |
| `search-palette.css` | Inline Tailwind on `SearchPalette.tsx`; keep `search-palette-*` class names as no-op markers | `bg-popover`, `text-popover-foreground`, `border-border`, `bg-muted`, `text-muted-foreground` |
| `compact-base.css` | Inline Tailwind on `PhoneLayout.tsx` + `TabletLayout.tsx`; keep `.compact-shell`, `.compact-panel`, `.compact-empty`, `.compact-git*` class names as markers | `flex flex-col h-full min-h-0` |
| `compact-phone.css` | Inline Tailwind on `PhoneLayout.tsx`; same approach | (same) |
| `compact-tablet.css` | Inline Tailwind on `TabletLayout.tsx` + `TabletNav.tsx`; keep `tablet-*` class names | `bg-card`, `border-r border-border`, `text-muted-foreground` |
| `debug.css` | Inline Tailwind on `DebugPanel.tsx`; keep `debug-*` class names | `bg-card`, `border-t border-border`, `text-muted-foreground`, `font-mono` |

### Skip list (Phase 3 / 4 / 5 will revisit)

| File | Reason |
|---|---|
| `sidebar.css` | 80% workspace/thread/worktree business; Phase 3 (Threads) + later phases will dismantle it organically |
| `sidebar.chrome.css` | Mixed; CSS-content tests pin literal text |
| `sidebar-shell.css` | Cohesion with sidebar.css — leave whole cluster intact |

These remain imported from `bootstrap.ts` until later phases. No regression.

## Implementation order

1. `tabbar.css` (smallest, pure)
2. `panel-tabs.css` (small, test-pinned class names)
3. `compact-base.css`
4. `compact-phone.css`
5. `compact-tablet.css`
6. `debug.css`
7. `search-palette.css`
8. `panel-lock.css` (largest)

After each file: remove the corresponding `import` line from `src/bootstrap.ts`.

## coss primitives evaluated and decision

| Need | coss primitive | Decision |
|---|---|---|
| TabBar (phone bottom nav, 5 items) | `Toolbar` | **Not used** — Toolbar adds API ceremony that does not buy anything for a stateless 5-button nav; inline Tailwind suffices |
| PanelTabs (8-item icon-only tab strip on top panel) | `Toolbar` + `TooltipIconButton` | **Not used** — already uses `TooltipIconButton`; switching to `Toolbar` would force tab semantics into role=toolbar which conflicts with role=tablist; inline Tailwind |
| LockScreenOverlay (full-screen lock dialog with 4 tabs) | `Dialog` + `Tabs` | **Not used in Phase 2** — replacing the overlay structure requires `Dialog` + `DialogPortal`, which changes focus / portal semantics; in Phase 2 we only restyle. Phase 4 (Dialogs) will revisit |
| SearchPalette | `Command` (`CommandDialog`/`CommandList`/`CommandItem`) | **Not used in Phase 2** — `Command` enforces virtualisation + items pattern; SearchPalette already has custom keyboard nav (`onMoveSelection`) and a non-trivial scope/content filter UI. Phase 4 follow-up flagged |
| DebugPanel | `ScrollArea` | **Not used** — debug list already has native `overflow-y: auto`; ScrollArea adds custom scrollbar styling that would clash with the existing test view. Inline Tailwind |
| TabletNav (left vertical nav, 4 items) | `Toolbar` | **Not used** — same reasoning as TabBar |

**Net:** Phase 2 = pure styling pass (Tailwind utility + coss design tokens). No coss primitive swaps in this phase. Phase 4 is the natural home for `Dialog`/`Command` swaps; flag in follow-ups.

## Verification checklist

```bash
npm run lint
npm run typecheck
npm run test
npm run check:large-files:gate
```

Plus existing CSS-content tests (must remain green because we are not touching the targets they assert against):

- `src/styles/layout-swapped-platform-guard.test.ts`
- `src/styles/sidebar-titlebar-drag-region.test.ts`

## Follow-ups created by Phase 2

- Phase 3+ should still process `sidebar.css` / `sidebar.chrome.css` / `sidebar-shell.css` (deferred chrome) along with the threads/workspace dismantling.
- Phase 4 should evaluate `Command` for SearchPalette and `Dialog` for LockScreenOverlay structural overhaul.
- After Phase 2, the bootstrap.ts CSS import list shrinks from 54 → 46 entries.
