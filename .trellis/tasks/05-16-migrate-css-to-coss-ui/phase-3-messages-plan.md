# Phase 3 — Threads + Messages Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 3 (Threads + Messages)
> Date: 2026-05-16

## Discovery summary

PRD-declared scope = `messages.css` (entry) + `messages.history-sticky.css` + `messages.part1-shell.css` + `messages.part1.css` + `messages.streaming.css` + `messages.part2.css` + `messages.status-shell.css` + `prompts.css` (Threads side).

| File | Lines | Imported via | tsx consumers | Verdict |
|---|---:|---|---|---|
| `messages.css` | 5 | `bootstrap.ts:9` | (entry only, `@import`s the rest) | **Skip — pinned by layout-swapped test (line 28 reads via `readCssWithImports`)** |
| `messages.history-sticky.css` | 394 | `@import` from `messages.css:1` | `MessagesTimeline.tsx` (8 className strings, lines 480-515) + 30 test pins in `Messages.live-behavior.test.tsx` + 7 CSS-literal pins in `layout-swapped-platform-guard.test.ts:143-186` | **Skip — sticky header carry-forward + CSS literal pin** |
| `messages.part1-shell.css` | 222 | `@import` from `messages.css:2` | `Messages.tsx` / `MessagesTimeline.tsx` use `.messages-shell`, `.messages-full`, `.messages-collapsed-indicator`, `.messages-turn-boundary*`, `.messages-final-boundary`, etc. + `claude-render-safe` selectors pinned by layout-swapped test:188 | **Skip — `.messages-shell.claude-render-safe` pinned by CSS-content test** |
| `messages.part1.css` | 2301 | `@import` from `messages.css:3` | 100+ tsx consumers across messages feature + `claude-render-safe` selectors pinned + many cross-cutting selectors | **Skip — too large + CSS literal pin** |
| `messages.streaming.css` | 15 | `@import` from `messages.css:4` | `.markdown-live-streaming` and `.markdown-live-plain-text` className strings (used as markers, not styled-by-test); `.thinking` is **dead** (no tsx consumer) | **Convert — pure styling, no CSS literal pin** |
| `messages.part2.css` | 875 | `@import` from `messages.css:5` | Heavy: thinking-block / reasoning / tool-result / kanban etc. Many test pins on `.thinking-block`, `.thinking-title`, `.thinking-content` as DOM selectors (NOT CSS literals) | **Skip — too large, defer to Phase 3.5 or later** |
| `messages.status-shell.css` | 533 | `@import` from `messages.part1-shell.css:1` | `.messages-status-shell*` / status panel | **Skip — defer (chain cohesion + size)** |
| `prompts.css` | 295 | `bootstrap.ts:26` | `PromptPanel.tsx` (46 className strings) + `PromptEnhancerDialog.tsx` (some `.prompt-section` reuse) + no test pins on `.prompt-*` selectors | **Convert — pure styling, no test pin, 2 consumers** |

## Key risks identified

### 1. CSS-content test pins prevent removal of most files

`src/styles/layout-swapped-platform-guard.test.ts` reads `messages.css` via `readCssWithImports`, then runs `.toContain` on **literal CSS text** from:

- `messages.history-sticky.css` — peek width (`16px`), peek `border-radius: 0`, `clip-path: none`, peek bubble `width: 5px; height: 26px` (lines 174-185)
- `messages.history-sticky.css` — collapsed bubble `width: var(--messages-history-sticky-peek-width);`, `transform: none;` (lines 174-175)
- `messages.history-sticky.css` — collapsed inner `padding-right: 0`, content `justify-content: flex-end`, wide canvas `margin-right: -25px` (lines 170-173)
- `messages.part1.css` — `.messages-live-controls` swapped selector (line 136)
- `messages.part1.css` — `.messages-shell.claude-render-safe .message` Windows + macOS scoped rules (lines 188-201)

Removing any of these CSS files **immediately breaks** the layout-swapped guard test.

**Decision**: Do NOT touch `messages.css`, `messages.history-sticky.css`, `messages.part1-shell.css`, `messages.part1.css`, `messages.part2.css`, `messages.status-shell.css` in this phase. They survive intact until Phase 3.5 (sticky header coss migration) and Phase 3.6 (message body coss migration), which will both require:

1. A **separate proposal step** to either delete the layout-swapped CSS-literal assertions or convert them to behavior assertions.
2. Threaded rewrites with deliberate test updates per group.

### 2. Sticky header contract (carry-forward from `04-22-align-live-sticky`)

The 4 carry-forward acceptances live in `Messages.live-behavior.test.tsx`:

| Carry-forward | Test coverage today | What this phase does |
|---|---|---|
| realtime not rendering `.messages-live-sticky-user-message` | 7 `toBeNull()` assertions (lines 875/1178/1221/1332/1481/1536/1574) | **No change** — class never gets rendered anywhere; phase keeps test green by not changing the className strings |
| realtime + history share one sticky out | `MessagesTimeline.tsx` `activeStickyHeaderCandidate` is the single source (line 478) | **No change** — phase keeps this block + className strings untouched |
| realtime scroll-back handoff = history-style | `Messages.live-behavior.test.tsx` lines 1078/1135/1144/1187/1230 verify sticky header text follows scroll | **No change** — driven by hooks `useStickyMessageSelector` + `MessagesTimeline` props, neither touched |
| trimmed live latest question drives sticky | `Messages.live-behavior.test.tsx` lines 1339/1357/1406/1435/1489/1582/1637 verify trimmed text appears | **No change** — string is computed in `messagesUserPresentation.ts`, not in CSS |

**Decision**: All 4 contracts remain verified by their existing tests. This phase does NOT modify `MessagesTimeline.tsx`'s sticky header markup, hooks, or messagesUserPresentation. The contract is preserved by **non-intervention**, not by new test coverage.

### 3. Streaming.css dead `.thinking` rule

`messages.streaming.css:1-6` defines `.thinking` (padding/font/color). Grep confirms NO `className="thinking"` usage in any tsx (only `.thinking-block` / `.thinking-content` / `.thinking-title` which live in `messages.part2.css` and remain untouched). So `.thinking` is **dead CSS**. Phase 3 deletes it as part of streaming.css removal.

### 4. Prompts.css `.prompt-section` shared with PromptEnhancerDialog

`prompts.css` defines `.prompt-section` (lines 10-14). It's reused by:

- `PromptPanel.tsx` (primary consumer, 46 className refs)
- `PromptEnhancerDialog.tsx` lines 95, 106 (just `.prompt-section` + `.prompt-section-header`)

Both consumers must get matching Tailwind treatment when CSS rules are removed. PromptEnhancerDialog uses additional classes (`prompt-enhancer-overlay`, `prompt-enhancer-dialog`, `prompt-text`, `prompt-loading`, `prompt-enhancer-btn`, etc.) that are NOT defined in `prompts.css` (must live in another CSS file or be undefined). Phase 3 confirms via grep that `prompts.css` only defines `.prompt-*` minus the `prompt-enhancer-*` set. So PromptEnhancerDialog's enhancer-specific classes are out of scope; only its 2 shared `.prompt-section` uses need parity.

## Final Phase 3 scope (scope shrink rationale)

**Convert + delete** (pure styling pass with Tailwind + coss tokens):

1. `prompts.css` → delete file, inline Tailwind on `PromptPanel.tsx` + 2 sites in `PromptEnhancerDialog.tsx`, keep className strings as no-op markers.
2. `messages.streaming.css` → delete file, inline Tailwind on `MessagesRows.tsx` for `.markdown-live-streaming` + `.markdown-live-plain-text`, keep className strings (test pins them via `querySelector`), drop dead `.thinking` rule.

**Defer to dedicated future phase** (require test refactor first):

- `messages.css` (entry)
- `messages.history-sticky.css`
- `messages.part1-shell.css`
- `messages.part1.css`
- `messages.part2.css`
- `messages.status-shell.css`

All 6 deferred files remain imported via the existing `messages.css` chain — no `bootstrap.ts` changes for them.

### Why this scope is correct

- Phase 2 set the precedent: "pure styling pass, no coss primitive structural swap, keep semantic class names as no-op markers."
- Phase 3 PRD's literal scope is impossible to land without rewriting `layout-swapped-platform-guard.test.ts`. That test is its own protection asset; refactoring it is its own task.
- The sticky header `04-22` carry-forward is a **behavior contract**, not a CSS contract. By keeping `MessagesTimeline.tsx` markup + className strings unchanged, the 4 carry-forwards remain green.
- The "messages bodies" (part1 / part2 / status-shell) need a separate proposal because they intersect with the test-pinned `.messages-shell.claude-render-safe` selectors *and* the layout-swapped `.messages-live-controls` selector. That work is too big and too contract-sensitive to fold into a single Phase 3 PR.

## coss primitives evaluated and decision

| Need | coss primitive | Decision |
|---|---|---|
| PromptPanel (list of cards + editor form) | `Card`, `Field`, `Input`, `Textarea`, `Button`, `Select` | **Not used** — `PromptPanel` already uses project-local controls. coss `Card` would require structural JSX changes that go beyond a styling pass; `Field` would require restructuring labels and would change form a11y surface. Phase 3 = pure styling. coss primitive swap deferred to Phase 4 (Composer & Interaction Dialogs) where `PromptEnhancerDialog` becomes a `Dialog` consumer naturally |
| `markdown-live-streaming` marker on live row | (none — pure styling marker) | **Not used** — these classes are detection markers, not visual widgets |
| `messages-history-sticky-header*` cluster | `Tooltip` for collapse/expand peek, `Button` for toggle | **Not in Phase 3** — touching this contradicts the sticky carry-forward "non-intervention" plan + needs the layout-swapped CSS literal test refactored first |
| Reasoning block (`thinking-block`, `thinking-header`, `thinking-content`) | `Disclosure` / `Accordion` | **Not in Phase 3** — lives in `messages.part2.css` which is deferred |

**Net Phase 3**: Pure styling pass on 2 files. Zero coss primitive structural swaps. Zero markup changes inside `MessagesTimeline.tsx` / `Messages.tsx` / `MessagesRows.tsx` beyond appending Tailwind utility classes onto already-existing className strings.

## Per-file processing

### Drop list

| File | Strategy | New token surface |
|---|---|---|
| `prompts.css` | Inline Tailwind on `PromptPanel.tsx` (46 className strings) + `PromptEnhancerDialog.tsx` (2 shared sites); keep all `.prompt-*` semantic markers as no-op classes; remove `bootstrap.ts:26` import | `flex flex-col gap-*`, `text-xs/sm`, `text-muted-foreground`, `border-border`, `bg-card`, `rounded-xl`, animations preserved via Tailwind `animate-*` or kept-inline by leaving keyframes references intact (project token `--surface-control` etc. still exist) |
| `messages.streaming.css` | Inline Tailwind on `MessagesRows.tsx` (3 sites at lines 1116/1162/1659); keep `.markdown-live-streaming` + `.markdown-live-plain-text` as markers (tests query them); drop dead `.thinking` rule; bootstrap.ts: the file isn't imported standalone, it's pulled via `messages.css`. So removing this file requires updating `messages.css:4`. **Edit `messages.css` to drop the streaming `@import`** | `break-words`, `whitespace-pre-wrap` |

### Skip list (deferred phases)

| File | Reason |
|---|---|
| `messages.css` | Entry file, mostly `@import`s — kept; only line 4 (streaming import) gets removed |
| `messages.history-sticky.css` | Pinned by 7 literal-text assertions in `layout-swapped-platform-guard.test.ts:143-186` + 30 tests in `Messages.live-behavior.test.tsx` reference its DOM classes |
| `messages.part1-shell.css` | Pinned by `claude-render-safe` literal in `layout-swapped-platform-guard.test.ts:188-201` |
| `messages.part1.css` | Pinned by `claude-render-safe` + `.messages-live-controls` literals; 2301 lines + 100+ consumers |
| `messages.part2.css` | 875 lines, thinking block / reasoning / tools — needs dedicated proposal |
| `messages.status-shell.css` | 533 lines, chained via `messages.part1-shell.css:1` import — cohesion |

## Implementation order

1. `prompts.css` (larger, single primary consumer)
2. `messages.streaming.css` (tiny but cross-file: edits `messages.css` chain)

After each:

- Remove old `<file>` from its import site (`bootstrap.ts:26` for prompts; `messages.css:4` for streaming).
- Run `npm run lint` and `npm run typecheck`.

## Verification checklist

```bash
npm run lint
npm run typecheck
npm run test
npm run test:layout-guard
npm run check:large-files:gate
```

Plus the carry-forward verification matrix (see Final Report).

## Follow-ups created by Phase 3

- **Phase 3.5 — sticky header coss migration**: requires `layout-swapped-platform-guard.test.ts` to be refactored away from literal CSS text assertions for `messages-history-sticky-*`. Suggested approach: convert those 7 assertions into either (a) behavior tests (jsdom-render `MessagesTimeline` then assert computed style / class flags) or (b) `data-*` attribute presence tests. Once that lands, `messages.history-sticky.css` can be Tailwind-inlined on `MessagesTimeline.tsx:478-530`.
- **Phase 3.6 — message bodies coss migration**: requires `layout-swapped-platform-guard.test.ts` lines 188-201 (`claude-render-safe`) + lines 135-137 (`messages-live-controls`) to be refactored. Then `messages.part1.css` + `messages.part1-shell.css` + `messages.status-shell.css` + `messages.part2.css` can be progressively dismantled — likely 2-3 sub-PRs given the size.
- **Phase 4 — PromptEnhancerDialog as `Dialog`**: `PromptEnhancerDialog` currently uses raw `<div className="prompt-enhancer-overlay">`. coss `Dialog` is the natural fit but classnames `prompt-enhancer-*` are NOT in `prompts.css` (must be in another CSS file, likely `composer.css`). Will be picked up naturally in Phase 4.
- After Phase 3, bootstrap.ts CSS import list shrinks from 46 → 45 entries (`prompts.css` removed). `messages.css` chain shrinks from 5 imports to 4 (`messages.streaming.css` removed).
