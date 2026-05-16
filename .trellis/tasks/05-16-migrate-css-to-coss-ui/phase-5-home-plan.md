# Phase 5 — Home & Workspace Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 5 (Home & Workspace)
> Date: 2026-05-16

## Discovery summary

PRD-declared scope = `home.css`, `home-chat.css`, `workspace-home.css`, `note-cards.css`, `kanban.css`, `release-notes.css`. (`update-toasts.css` was opportunistically migrated in Phase 4 — already done.)

| File | Lines | tsx consumers | Test pins | Verdict |
|---|---:|---|---|---|
| `home.css` | 85 | `Home.tsx` (50 lines, ~5 className refs) | `Home.test.tsx`: `.home-primary-button` querySelector only | **Convert** — small, isolated, no CSS-literal pin |
| `release-notes.css` | 233 | `ReleaseNotesModal.tsx` (189 lines, 24 className refs) | None (`CollapsibleUserTextBlock.test.tsx` only references string literal "release-notes.md", not CSS class) | **Convert** — medium, single consumer, no CSS-literal pin |
| `note-cards.css` | 523 | `WorkspaceNoteCardPanel.tsx` (864 lines, 48 className refs) | `WorkspaceNoteCardPanel.test.tsx:278`: `.workspace-note-cards-list` classList only | **Convert** — medium-large, single consumer, no CSS-literal pin |
| `workspace-home.css` | 604 | `WorkspaceHome.tsx` (163 lines, 22 refs) + `WorkspaceHomeSpecModule.tsx` (160 lines, 26 refs) | `WorkspaceHome.test.tsx`: `.workspace-home-path-line` / `.workspace-home-path-name` / `.workspace-home-branch-line` querySelector only | **Convert** — medium, 2 consumers, no CSS-literal pin |
| `home-chat.css` | 946 | `HomeChat.tsx` (276 lines, 33 refs) + `ChatInputBoxFooter.tsx` (1021 lines — **composer cluster**) | **`HomeChat.styles.test.ts`: 6 CSS-literal `.toContain` assertions** on `home-chat.css` content (grayscale rule, codex context accents, workspace popup `data-slot`, picker search/add, selection states, trigger line-height) | **DEFER to Phase 5.5** — CSS-literal pin (same blocker as Phase 3 messages files) + ChatInputBoxFooter belongs to deferred composer cluster |
| `kanban.css` | 2071 | 14 tsx files in `src/features/kanban/components/` (KanbanCard, KanbanColumn, KanbanBoard, ProjectCard, PanelCard, TaskCreateModal, etc.) totalling 5355 tsx lines / 240+ `kanban-` className refs | No CSS-literal pin (querySelector only) | **DEFER to Phase 5.6** — scope size dwarfs composer (deferred to Phase 4.5); single-phase migration would produce a >2000-line diff across 14 tsx files |

### Test-pin verification

```bash
grep -rn "readFileSync.*home\.css\|readFileSync.*home-chat\.css\|readFileSync.*workspace-home\.css\|readFileSync.*note-cards\.css\|readFileSync.*kanban\.css\|readFileSync.*release-notes\.css" src/
# Only hit: src/features/home/components/HomeChat.styles.test.ts (6 reads of home-chat.css)
```

`src/styles/layout-swapped-platform-guard.test.ts` reads only `base.css`, `main.css`, `sidebar.css`, `messages.css`, `diff-viewer.css` — no Phase 5 file in the literal-pin guard.

## Key risks identified

### 1. `home-chat.css` is CSS-literal-pinned and tied to composer cluster

`HomeChat.styles.test.ts` reads `home-chat.css` and asserts on:
- `.home-chat-engine-icon` rule must not contain `grayscale(`
- `--codex-context-accent` / `--codex-context-accent-track` declarations present (cross-referenced from `context-bar.css`)
- `.home-chat-workspace-picker-popover[data-slot="popover-content"]` selector + `width: min(304px, calc(100vw - 24px)) !important;` + `overflow: hidden;`
- `.home-chat-workspace-picker-search` + `grid-template-columns: 16px 1fr;` + `.home-chat-workspace-picker-add`
- `.home-chat-workspace-picker-item[data-selected="true"]` + literal `background: #f7f5f2;` + `background: #f5f5f4;`
- `.home-chat-workspace-select-trigger` rule must contain `line-height: 1.2;` + `padding-block: 2px;`

Removing the file would break 6 tests. Removing the rules but keeping the file similarly. Same pin pattern that deferred 6 messages files in Phase 3.

Plus: `ChatInputBoxFooter.tsx` (a `composer/components/ChatInputBox/*` file with 1021 lines) consumes `home-chat-*` classes — coupling with the deferred composer cluster (Phase 4.5).

### 2. `kanban.css` is too large for a single phase

Comparable size analysis vs prior defer decisions:
- Composer.part1+part2 = 3996 CSS lines + ~5500 tsx lines → deferred to Phase 4.5
- Kanban = 2071 CSS lines + **5355 tsx lines / 14 consumers / 240+ className refs**

Total tsx surface (5355) matches deferred composer. A "pure styling pass" would still produce ~600-line diffs across each of 14 tsx files — review-impractical and high regression risk for a feature with extensive drag-and-drop / multi-mode (board/projects/panels) interactions.

### 3. Token continuity (same as Phase 2/3/4)

All 4 convert candidates use project legacy tokens (`--surface-card*`, `--text-stronger/strong/muted/faint`, `--border-subtle/muted/accent`, `--surface-messages`, `--surface-context-core`, `--accent-primary`, `--text-accent`, `--surface-card-muted`, `--note-card-accent`, etc.). All still alive (Phase 1 kept them).

Decision: same translation strategy as Phase 2/3/4 — use coss semantic tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-popover`) where mapping is clean; fall back to `bg-[var(--surface-foo)]` arbitrary values when project token has no clean coss equivalent (e.g. `--surface-messages`, `--surface-context-core`, `--note-card-accent`).

### 4. `home.css` has one keyframe (`home-fade-in`)

Like Phase 1/3/4 patterns (`proxy-status-badge.css`, `prompts-animations.css`, `toast-animations.css`), keyframes cannot be inlined into Tailwind utility classes. **Decision**: the `home-fade-in` keyframe is trivial (10px translateY + opacity over 400ms) and is only triggered once when the home view mounts — replace with Tailwind built-in `motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500` utilities (`tailwindcss-animate` style — used by coss patterns). If not available, fall back to keeping a tiny `home-animations.css` (rejected — try the Tailwind path first since `tw-animate-css` would already be in coss setup).

Verified `tw-animate-css` import in `globals.css:1` → `@import "tw-animate-css";` — Tailwind animate utilities available.

## coss primitives evaluated and decision

| Need | coss primitive | Decision |
|---|---|---|
| `Home.tsx` — single-button welcome view | None (existing primitive `Button` exists at `src/components/ui/button.tsx`) | **Not used in Phase 5** — `Home.tsx` button is a single decorative primary-action button styled by `home-primary-button` only on this page. Pure styling pass keeps button as `<button>` with Tailwind utility — swapping to coss `Button` changes the rendered tag/variants and would require re-validating focus/hover states. Same "pure styling pass" pattern from Phase 2/3/4. **Follow-up**: replace with `<Button variant="outline" size="lg">` in a future polish pass. |
| `ReleaseNotesModal.tsx` — `role="dialog" aria-modal="true"` modal with backdrop, header, scroll body, footer pagination | `Dialog` (`DialogPopup` + `DialogTitle` + `DialogClose` + `DialogBackdrop`) | **Not used in Phase 5** — same rationale as Phase 4 (`LoadingProgressDialog`, `AskUserQuestionDialog`): `dialog.tsx` is NOT installed under `src/components/ui/`. Installing requires `npx shadcn@latest add @coss/dialog` (new dep + lock change) + structural JSX refactor + focus-trap behavior validation. Existing tests assert `role="dialog"` + visible content + ScrollArea integration — pure styling preserves all behavior. **Follow-up**: queued in `docs/migration-to-coss-ui.md` Dialog primitive swap. |
| `WorkspaceNoteCardPanel.tsx` — large editor + cards grid with collection switch (tabs-like), rich text input, preview, list of cards with selection | `Card`, `Tabs` (for `.workspace-note-cards-collection-switch`), `Button` | **Not used in Phase 5** — `.workspace-note-cards-collection-switch` is a 2-button pill toggle with `role="tablist"` already wired manually; coss `Tabs` would force `Tabs.Trigger` + `Tabs.Panel` content pattern that doesn't match the current "switch + filter list" architecture (list is rendered once and filtered by archived flag, not via `Tabs.Panel`). `Card` would change the semantic root element on the panel container. Pure styling pass. **Follow-up**: queued for Tabs + Card swap in a polish pass. |
| `WorkspaceHome.tsx` / `WorkspaceHomeSpecModule.tsx` — hero header + spec-provider cards + guide card grid | `Card` | **Not used in Phase 5** — spec-provider / guide cards are click-targets with custom hover/focus + iconographic header; coss `Card` would change DOM root + force `CardHeader/CardContent/CardFooter` slots that don't match current minimal markup. Pure styling pass. **Follow-up**: queued for Card composition swap. |

**Net Phase 5**: Pure styling pass on 4 files (`home.css`, `release-notes.css`, `note-cards.css`, `workspace-home.css`). Zero coss primitive structural swaps. Zero markup changes inside consumers beyond appending Tailwind utility classes to existing className strings (semantic class names preserved as no-op markers — required by querySelector tests + screenshot debug + cascade with sibling `.markdown` chains).

## Per-file processing

### Drop list

| File | Strategy | Token surface |
|---|---|---|
| `home.css` | Inline Tailwind on `Home.tsx`. Keep `.home` / `.home-content` / `.home-hero` / `.home-title` / `.home-subtitle` / `.home-hero-actions` / `.home-primary-button` as no-op markers (test pin requires `.home-primary-button` selector). Replace `@keyframes home-fade-in` with Tailwind `animate-in fade-in slide-in-from-bottom-2 duration-500` on `home-content`. Delete file + remove `bootstrap.ts:6` import. | `flex flex-col items-center justify-center h-full w-full overflow-y-auto p-10`, `max-w-[640px] gap-8`, `text-5xl font-medium tracking-tight text-foreground`, `text-lg text-muted-foreground`, `h-12 px-7 rounded-xl bg-card text-foreground border border-border` + hover variants → `hover:bg-[var(--surface-card-strong)] hover:border-[var(--border-muted)] hover:shadow-md`, `active:bg-[var(--surface-hover)]` |
| `release-notes.css` | Inline Tailwind on `ReleaseNotesModal.tsx`. Keep `.release-notes-modal*` / `.release-notes-language-*` / `.release-notes-markdown` as no-op markers (markdown descendants `:where(p, ul, ol, li)` need preserved class for cascade; markdown also imported from `markdown.css` outside this file). Preserve `.release-notes-markdown :where(a, a:visited, a:hover, a:active) { color: inherit; text-decoration: none; }` — that rule shapes link styling for the embedded markdown body; since this is a `:where` cascade on dynamic markdown output (HTML strings not under JSX control), inline Tailwind utility on the markdown root is not equivalent. **Strategy**: move the `:where(a...)` and other generic markdown `release-notes-markdown` cascade rules to a tiny `release-notes-markdown.css` keeper (same pattern as `proxy-status-badge.css`), then inline everything else as Tailwind utilities on `ReleaseNotesModal.tsx`. Delete `release-notes.css` from bootstrap, add `release-notes-markdown.css`. | `fixed inset-0 z-[60] grid place-items-center`, `absolute inset-0 bg-black/58 backdrop-blur-[2px] cursor-default`, `relative z-[1] w-[min(480px,calc(100vw-24px))] h-[min(640px,calc(100vh-28px))] rounded-2xl border border-border bg-[var(--surface-context-core)] shadow-[0_30px_64px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden`, `min-h-[66px] py-2.5 px-3.5 flex items-center justify-between border-b border-border gap-3`, `text-[28px] leading-[1.1] tracking-tight`, `text-xs font-semibold rounded-full border border-[color-mix(in_srgb,var(--border-accent)_58%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_82%,var(--surface-active))] text-[color-mix(in_srgb,var(--text-accent)_80%,var(--text-strong)_20%)]`, `text-[13px] text-muted-foreground` |
| `note-cards.css` | Inline Tailwind on `WorkspaceNoteCardPanel.tsx`. Keep `.workspace-note-cards-*` class names as no-op markers. Test pins `.workspace-note-cards-list` classList containing `is-empty` — preserve. `.workspace-note-cards-rich-input .rich-text-input*` rules style a child component (`RichTextInput`) without controlling `RichTextInput`'s own classes — these are descendant overrides. **Strategy**: move the `:nested .rich-text-input*` descendant overrides into a tiny `note-cards-rich-input.css` keeper (same pattern as `release-notes-markdown.css`), inline simple selectors. Delete `note-cards.css` from bootstrap, add `note-cards-rich-input.css`. | `flex flex-col gap-3 h-full p-3 overflow-hidden bg-[radial-gradient(...)]_,linear-gradient(...)]`, `border border-[var(--note-card-border)] bg-[var(--note-card-surface)] rounded-[14px]`, `rounded-full bg-[var(--note-card-surface-muted)]`, etc. |
| `workspace-home.css` | Inline Tailwind on `WorkspaceHome.tsx` + `WorkspaceHomeSpecModule.tsx`. Keep `.workspace-home-*` class names as no-op markers. Test pins `.workspace-home-path-line` / `.workspace-home-path-name` / `.workspace-home-branch-line` querySelector — preserved. Some media queries (`@media (max-width: 900px)` + `@media (max-width: 700px)` etc.) for responsive text scaling → translate to Tailwind responsive prefix (`sm:`, `md:`) or `clamp()` inline via arbitrary value (`text-[clamp(54px,7.2vw,88px)]`). Some highly nested rules (`.workspace-home-run-hero__topline > .workspace-home-run-hero__eyebrow`) — translate via `[&_.child]:utility` Tailwind v4 syntax or direct `.tsx` child className. Delete file + remove `bootstrap.ts:40` import. | `flex items-center justify-center w-full h-full overflow-y-auto py-6 px-4 pb-10 bg-[var(--surface-messages)] text-[var(--text-strong)]`, BEM-style selectors (`workspace-home-run-hero__title`) preserved as marker + Tailwind on tsx |

### Skip list (deferred to Phase 5.5 / 5.6)

| File | Reason |
|---|---|
| `home-chat.css` (946 lines) | 6 CSS-literal `.toContain` test assertions in `HomeChat.styles.test.ts` + cross-consumer `ChatInputBoxFooter.tsx` in deferred composer cluster (Phase 4.5). |
| `kanban.css` (2071 lines) | 14 tsx consumers totalling 5355 lines + 240+ `kanban-` className refs. Single-phase migration impractical; needs to be split into sub-PRs (e.g. Phase 5.6a `KanbanCard/Column/Board`, Phase 5.6b `Projects + Panels`, Phase 5.6c `TaskCreateModal + fullscreen layout`). |

## Implementation order

1. `home.css` (smallest, 1 consumer)
2. `release-notes.css` (medium, 1 consumer)
3. `workspace-home.css` (medium, 2 consumers)
4. `note-cards.css` (largest convert, 1 consumer with rich descendant cascade)

After each:
- Remove old file from `bootstrap.ts`.
- Add any keeper CSS (`release-notes-markdown.css`, `note-cards-rich-input.css`) to `bootstrap.ts`.
- Run `npm run lint` + `npm run typecheck` after every file batch (incremental).

Single full test run at end via `npm run test`.

## Verification checklist

```bash
npm run lint
npm run typecheck
npm run test
npm run test:layout-guard
npm run check:large-files:gate
```

Plus targeted runs:
- `npx vitest run src/features/home/components/Home.test.tsx`
- `npx vitest run src/features/home/components/HomeChat.styles.test.ts` (must still pass — home-chat.css untouched)
- `npx vitest run src/features/home/components/HomeChat.test.tsx`
- `npx vitest run src/features/workspaces/components/WorkspaceHome.test.tsx`
- `npx vitest run src/features/note-cards/components/WorkspaceNoteCardPanel.test.tsx`

(No dedicated `ReleaseNotesModal.test.tsx` exists — verified.)

## Follow-ups created by Phase 5

- **Phase 5.5 — home-chat coss migration**: dedicated phase for `home-chat.css`. Steps:
  - Convert tsx markup using Tailwind utility classes (preserve marker classes).
  - Migrate the 6 test-pinned CSS rules to keep-file or test refactor (e.g. shift tests to `getComputedStyle` against jsdom or to className contracts; or hold the file as a small keeper containing only the 6 pinned rules + Tailwind on tsx for the rest).
  - Coordinate with composer Phase 4.5 because `ChatInputBoxFooter.tsx` shares the cascade.
- **Phase 5.6 — kanban coss migration**: split into 3 sub-PRs. Recommended split:
  - 5.6a: Mode toggle + fullscreen layout + projects grid + project card (`KanbanModeToggle`, `ProjectList`, `ProjectCard`, layout-level `app.kanban-active` selectors)
  - 5.6b: Board + columns + cards + drag-drop (`KanbanBoard`, `KanbanBoardHeader`, `KanbanColumn`, `KanbanCard`, drag/drop hover states)
  - 5.6c: Panels list + task create modal + remaining detail blocks (`PanelList`, `PanelCard`, `TaskCreateModal`)
- **Coss `Dialog` install + structural swap** (carried forward from Phase 4): add `ReleaseNotesModal` to the swap target list when `Dialog` is installed.
- **Coss `Tabs` swap**: `.workspace-note-cards-collection-switch` is hand-built role="tablist"; coss `Tabs` would provide proper keyboard nav.
- **Coss `Card` composition swap**: `WorkspaceHomeSpecModule.tsx` spec-provider/guide cards + `WorkspaceNoteCardPanel.tsx` cards + `ReleaseNotesModal.tsx` content card are all candidates.
- **Coss `Button` swap on `Home.tsx`**: trivial follow-up — replace `<button className="home-primary-button">` with `<Button variant="outline" size="lg">`.

## After Phase 5

bootstrap.ts CSS import count: 42 → expected **40** (−4 deleted: `home.css`, `release-notes.css`, `note-cards.css`, `workspace-home.css`; +2 added if needed: `release-notes-markdown.css`, `note-cards-rich-input.css` for descendant cascade and markdown overrides).

Files deleted (4 total): `home.css`, `release-notes.css`, `note-cards.css`, `workspace-home.css`.
Files added (0-2 total — TBD at execution time): `release-notes-markdown.css` (if `:where(a)` markdown cascade must stay in a keeper), `note-cards-rich-input.css` (if `rich-text-input*` descendant overrides must stay in a keeper). If both turn out to be one-or-two-rule keepers, evaluate whether to inline them via Tailwind `[&_.rich-text-input]:utility` arbitrary-variant syntax instead.

`update-toasts.css` already removed in Phase 4 (opportunistic cluster fit). Not re-counted here.
