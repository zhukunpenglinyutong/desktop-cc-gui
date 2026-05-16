# Phase 4 — Composer & Interaction Dialogs Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 4 (Composer & Interaction Dialogs)
> Date: 2026-05-16

## Discovery summary

PRD-declared scope = `composer.part1/2` + `ask-user-question-dialog.css` + `approval-toasts.css` + `request-user-input.css` + `loading-progress-modal.css` (+ conditional `error-toasts.css` / `update-toasts.css` per implement prompt).

| File | Lines | Class count | tsx consumers | Test pins (CSS-literal) | Verdict |
|---|---:|---:|---|---|---|
| `composer.part1.css` | 1749 | 110 | `Composer.tsx` (2307 lines, 41 className refs) + `ComposerInput.tsx` (1634 lines, 123 className refs) + 7 other tsx | None (`composer-*` selectors used only via DOM querySelector — not in `layout-swapped-platform-guard.test.ts`) | **Defer to Phase 4.5** — too large + tight coupling with rewind/memory/context-ledger features |
| `composer.part2.css` | 2247 | 196 | Same primary set as part1 + `ContextLedgerPanel.tsx`, `EngineSelector.tsx`, etc. | None | **Defer to Phase 4.5** |
| `composer.memory-picker.css` | 247 | ~30 | `ChatInputBoxFooter.tsx` + `ComposerInput.tsx` | `ComposerInput.manual-memory.test.tsx:` `.composer-memory-picker-title` querySelector | **Defer with composer (chained import from `composer.part2.css:1`)** |
| `composer.rewind-modal.css` | 1233 | 68 | `ClaudeRewindConfirmDialog.tsx` (880 lines) | None directly, but Composer.rewind-confirm.test.tsx covers behavior | **Defer to Phase 4.5** (was its own archived task before this migration) |
| `ask-user-question-dialog.css` | 458 | ~40 | `AskUserQuestionDialog.tsx` (506 lines) — single consumer | `AskUserQuestionDialog.test.tsx:` `.ask-user-question-overlay` / `.ask-user-question-card` / `.is-composer-overlay` querySelector only (no CSS-literal) | **Convert — pure styling pass, no CSS-literal pin** |
| `approval-toasts.css` | 314 | ~40 | `ApprovalToasts.tsx` (392 lines) — single consumer | `ApprovalToasts.test.tsx:` `.approval-toast-icon-wrap` / `.approval-toast-summary-band` / `.approval-toast-badge` querySelector only | **Convert** |
| `request-user-input.css` | 230 | ~30 | `RequestUserInputMessage.tsx` (384 lines) + `RequestUserInputSubmittedBlock.tsx` (185 lines, 20 className refs) | `RequestUserInputMessage.test.tsx:` `.request-user-input-card` querySelector only | **Convert** |
| `loading-progress-modal.css` | 117 | ~10 | `LoadingProgressDialog.tsx` (67 lines) — single consumer | `LoadingProgressDialog.test.tsx:` role + aria-name based only, NO `.loading-progress-modal*` querySelector | **Convert** |
| `error-toasts.css` | 141 | ~13 | `ErrorToasts.tsx` (185 lines) — single consumer | `ErrorToasts.test.tsx:` `.error-toast` not querySelected. `useLayoutNodes.client-ui-visibility.test.tsx:` references `<ErrorToasts>` but doesn't pin `.error-toast*` selectors | **Convert** |
| `update-toasts.css` | 126 | ~12 | `UpdateToast.tsx` (120 lines) — single consumer | `UpdateToast.test.tsx:` `.update-toast-progress-fill` querySelector only | **Convert** (bootstrap.ts line 14 puts it with interaction toasts cluster — natural fit for Phase 4 instead of Phase 5) |

## Key risks identified

### 1. CSS-content test pins prevent removal of composer CSS

`src/styles/layout-swapped-platform-guard.test.ts` does NOT read composer/dialog files — only `base.css`, `main.css`, `sidebar.css`, `messages.css`, `diff-viewer.css`. Verified via:

```
$ grep -nE "(composer|ask-user|approval-toast|loading-progress|request-user|error-toast|update-toast)" src/styles/layout-swapped-platform-guard.test.ts
(no matches)
```

**Therefore no CSS-literal pin blocks Phase 4 — both convert files AND deferred composer can theoretically migrate in this phase**.

The composer defer rationale is **scope size**, not test-pinning:
- composer.part1 + part2 + memory-picker + rewind-modal = 5476 lines, 404 class selectors, 5500+ lines of tsx consumers
- Phase 3 deferred when ratio was ~6 files / 3000 lines / 100+ consumers
- Phase 4 composer alone is bigger than all of Phase 2 + Phase 3 combined
- A "pure styling pass" on composer would produce ~1500-line diff across 8+ tsx files, which dwarfs reviewability. Splitting into a dedicated Phase 4.5 (composer-only) makes the migration tractable and reviewable.

### 2. Behavior-critical contracts

Per implement prompt:
- **AskUserQuestion**: harness tool feedback channel; question/answer roundtrip + ESC + timeout countdown + collapse/expand behaviors must not regress. → tests cover all paths; pure styling pass = no behavior change.
- **Approval toasts**: user approval flow; Enter-to-accept keybind + batch approve + remember-rule + dismiss must not regress. → tests cover all paths; pure styling pass = no behavior change.
- **Request user input** (in-thread inline card): used by both live thread + history rendering; `data-request-user-input-id` / `data-workspace-id` / `data-thread-id` markers must remain. → no className changes, only Tailwind utilities appended; data attributes preserved.
- **Loading progress dialog**: ESC + focus management. → no behavior change.
- **Error / update toasts**: passive feedback; no behavior contract beyond DOM presence. Tests use role-based selectors.

### 3. Token continuity

These files use project legacy tokens (`--surface-card-strong`, `--border-stronger`, `--text-strong`, `--surface-card-muted`, `--surface-context-core`, `--accent-primary`, `--warning-text`, `--error-text`, `--primary`, `--primary-foreground`, `--main-panel-padding`). All still exist (Phase 1 audit kept old tokens alive). **Tailwind utility translation can preserve token references via arbitrary value `bg-[var(--surface-card-strong)]`** OR shift to coss tokens (`bg-card`, `border-border`, `text-foreground`, `bg-muted`, `text-warning`, `text-destructive`).

**Decision per file**: Use coss tokens (`bg-card`, `text-foreground`, etc.) where mapping is clean; fall back to `bg-[var(--surface-card-strong)]` arbitrary values when project token has no clean coss equivalent or when visual parity with adjacent (deferred) features matters. Same pattern used in Phase 2/3.

### 4. input.tsx pre-existing baseline error

`src/components/ui/input.tsx:48` has a typecheck error on the dead `nativeInput` code path. Phase 0 predicted this would self-heal in Phase 4.

**Decision**: Remove the unused `nativeInput` prop entirely — no caller uses it (verified via `rg -n 'nativeInput' src/`). This is the simplest, no-regression fix that matches "extreme simplicity, no speculative features".

## coss primitives evaluated and decision

| Need | coss primitive | Decision |
|---|---|---|
| `LoadingProgressDialog` (`role="dialog" aria-modal="true"` modal w/ backdrop + spinner + close button) | `Dialog` (with `DialogPopup` + `DialogTitle` + `DialogClose`) | **Not used in Phase 4** — `dialog.tsx` is NOT installed under `src/components/ui/`. Installing introduces (a) `npx shadcn@latest add @coss/dialog` (changes lock file / new dep), (b) structural JSX refactor from `<div role="dialog">` to `<Dialog open><DialogPopup>...</DialogPopup></Dialog>`, (c) focus-trap + ESC behavior re-validation against existing test. The test pins `role="dialog"` with aria-label — coss `Dialog` would render the same role but managed by Base UI portal. Pattern matches Phase 3 decision (defer coss primitive structural swap to follow-up). **Follow-up**: add `Dialog` install + structural swap in a dedicated future phase. |
| `AskUserQuestionDialog` (custom modal with composer-overlay mode, collapse/expand, multi-step navigation, custom radio/checkbox, countdown timer) | `Dialog` + `RadioGroup` / `CheckboxGroup` + `Field` + `Form` | **Not used in Phase 4** — beyond `Dialog` not installed, the AskUserQuestion has rich behavior (composer-overlay mode without backdrop, collapse-to-hint mode, multi-question stepper with custom-input fallback to "Other") that doesn't map cleanly to a single coss primitive. coss `Dialog` Portal would also need composer-overlay mode customization (`pointer-events: none` + `align-items: flex-end`). Same defer rationale as Phase 3 sticky header. |
| `ApprovalToasts` (custom in-place toast region with action buttons, summary band, expandable details list, batch approval) | `Toast` + `Card` + `Button` | **Not used in Phase 4** — coss `Toast` uses `toastManager.add(...)` imperative API; ApprovalToasts is a declarative `<ApprovalToasts approvals={[...]}/>` component embedded in app shell, not transient. Converting requires (a) lift state to global `toastManager`, (b) restructure render to use `toastManager` lifecycle, (c) `ToastProvider` + `AnchoredToastProvider` setup. Pure styling pass keeps existing structure. |
| `RequestUserInputMessage` (in-thread inline card, not modal) | `Card` + `RadioGroup` | **Not used** — already structured as inline card (`<div className="message">` + `<div className="bubble">`), and coss `Card` would change its semantic role and data-* anchor attrs. Pure styling pass. |
| `ErrorToasts` / `UpdateToast` | `Toast` | **Not used** — same imperative-vs-declarative mismatch as ApprovalToasts. |

**Net Phase 4**: Pure styling pass on 6 files (ask-user-question-dialog, approval-toasts, request-user-input, loading-progress-modal, error-toasts, update-toasts). Zero coss primitive structural swaps. Zero markup changes inside consumers beyond appending Tailwind utility classes to existing className strings. Plus 1 tiny typecheck fix on `input.tsx` (remove dead `nativeInput` branch).

## Per-file processing

### Drop list

| File | Strategy | Token surface |
|---|---|---|
| `loading-progress-modal.css` | Inline Tailwind on `LoadingProgressDialog.tsx`; keep `.loading-progress-modal*` class names as no-op markers. Delete file + remove `bootstrap.ts:40` import. | `fixed inset-0 z-[44]`, `bg-black/52 backdrop-blur-sm`, `bg-card border-border rounded-lg shadow-xl`, `animate-spin` for spinner (keyframe `loading-progress-modal-spin` ⇒ replace with Tailwind's built-in `animate-spin`) |
| `ask-user-question-dialog.css` | Inline Tailwind on `AskUserQuestionDialog.tsx`; keep all `.ask-user-question-*` class names as no-op markers (tests pin them). Keep `is-collapsed` / `is-composer-overlay` / `is-time-warning` / `is-selected` class strings (tests check `.classList.contains(...)`); use Tailwind variant `[&.is-selected]:bg-...` pattern or fold via React state-driven conditional classes. Delete file + remove `bootstrap.ts` import (need to ADD import first since not currently imported — wait, check). |
| `approval-toasts.css` | Inline Tailwind on `ApprovalToasts.tsx`; keep class names; `approval-toast::before` accent strip → use Tailwind `before:content-[''] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[linear-gradient(...)]`. Delete file + remove `bootstrap.ts:10` import. |
| `request-user-input.css` | Inline Tailwind on `RequestUserInputMessage.tsx` + `RequestUserInputSubmittedBlock.tsx`; keep class names. Delete file + remove `bootstrap.ts:13` import. |
| `error-toasts.css` | Inline Tailwind on `ErrorToasts.tsx`; keep class names; variant suffixes (`error-toast-info`, `error-toast-success`) handled via conditional classes inline. Delete file + remove `bootstrap.ts:11` import. |
| `update-toasts.css` | Inline Tailwind on `UpdateToast.tsx`; keep class names. Delete file + remove `bootstrap.ts:14` import. |

**Important — ask-user-question-dialog.css import status**: Confirmed via `rg 'ask-user-question-dialog' .` across the whole repo — the CSS file is **NOT imported from anywhere**. It is **dead CSS** in the styles tree. The dialog component currently renders **unstyled** (only inherited cascade from app-global classes like `.bubble` if any apply). This is itself a small bug fixed by Phase 4 — Tailwind utility translation will actually **add** the intended styling versus the current state, restoring the original visual intent that the now-dead .css file expressed.

Action: simply delete the file; no `bootstrap.ts` edit needed for this file.

### Skip list (deferred to Phase 4.5)

| File | Reason |
|---|---|
| `composer.part1.css` | 1749 lines, 110 selectors, 41+123+ className refs across 9 tsx consumers, ~10K-line consumer set — too large for one phase |
| `composer.part2.css` | 2247 lines, 196 selectors — chained import `composer.part2.css` → `composer.memory-picker.css` |
| `composer.memory-picker.css` | Chained via `composer.part2.css:1` import — must defer with composer |
| `composer.rewind-modal.css` | 1233 lines, 68 selectors, 880-line consumer (`ClaudeRewindConfirmDialog.tsx`) — was its own archived task (`04-23-split-composer-rewind-modal-styles`) |
| `composer.css` | Entry file imports the 3 composer subs — kept intact; will be removed when all 3 subs land in Phase 4.5 |

### Bonus fix

- `src/components/ui/input.tsx` — drop dead `nativeInput` branch + unused prop. Removes the pre-existing typecheck error baseline from Phase 0.

## Implementation order

1. `loading-progress-modal.css` (smallest, single consumer, single test)
2. `update-toasts.css` (small, single consumer)
3. `error-toasts.css` (small, single consumer)
4. `request-user-input.css` (medium, 2 consumers)
5. `approval-toasts.css` (medium-large, 1 consumer)
6. `ask-user-question-dialog.css` (largest of converts, 1 consumer)
7. `input.tsx` typecheck fix (independent)

After each:
- Remove old file from `bootstrap.ts`.
- Run `npm run lint` + `npm run typecheck` after every file batch.

Single test run at end via `npm run test`.

## Verification checklist

```bash
npm run lint
npm run typecheck
npm run test
npm run test:layout-guard
npm run check:large-files:gate
```

Plus targeted runs:
- `npx vitest run src/features/app/components/ApprovalToasts.test.tsx`
- `npx vitest run src/features/app/components/AskUserQuestionDialog.test.tsx`
- `npx vitest run src/features/app/components/RequestUserInputMessage.test.tsx`
- `npx vitest run src/features/notifications/components/ErrorToasts.test.tsx`
- `npx vitest run src/features/update/components/UpdateToast.test.tsx`
- `npx vitest run src/components/ui/LoadingProgressDialog.test.tsx`

## Follow-ups created by Phase 4

- **Phase 4.5 — composer coss migration**: dedicated phase for `composer.part1.css` + `composer.part2.css` + `composer.memory-picker.css` + `composer.rewind-modal.css` + `composer.css`. Plan to split into 3-4 sub-PRs:
  - Phase 4.5a — composer.part1 (input area + footer + actions)
  - Phase 4.5b — composer.part2 (context ledger + meta + collapsed pill set)
  - Phase 4.5c — composer.memory-picker (chained sub)
  - Phase 4.5d — composer.rewind-modal (large standalone modal)
- **Coss `Dialog` install + structural swap**: install `npx shadcn@latest add @coss/dialog` and convert `LoadingProgressDialog`, `AskUserQuestionDialog` to `Dialog`/`DialogPopup` composition. Behavior-critical (focus trap, ESC, portal); needs its own validation pass.
- **Coss `Toast` install + structural swap**: install `npx shadcn@latest add @coss/toast`, set up `ToastProvider` + `AnchoredToastProvider` in app shell, refactor `ErrorToasts` / `UpdateToast` / `ApprovalToasts` to use `toastManager.add(...)`. State management restructure (imperative API).
- **Coss `RadioGroup` / `CheckboxGroup` / `Field`**: AskUserQuestion + RequestUserInput option lists are hand-built radio/checkbox semantics; coss primitives provide a11y + keyboard navigation + state mgmt out of box.

## After Phase 4

bootstrap.ts CSS import count: 46 → **42** (5 files removed from bootstrap: loading-progress-modal, update-toasts, error-toasts, request-user-input, approval-toasts; ask-user-question-dialog was NOT in bootstrap so file deleted without bootstrap edit; +1 added: toast-animations.css for the 4 `@keyframes` that couldn't be inlined into Tailwind utilities).

Files deleted (6 total): `approval-toasts.css`, `ask-user-question-dialog.css`, `error-toasts.css`, `loading-progress-modal.css`, `request-user-input.css`, `update-toasts.css`.
File added (1): `toast-animations.css` (preserves `@keyframes update-toast-in`, `error-toast-in`, `approval-toast-in`, `ask-dialog-slide-in`, `ask-timer-pulse`).

Verified at execution: `rg 'ask-user-question-dialog' .` returns no `import` matches outside the now-deleted file itself; ask-user-question-dialog.css is dead CSS and the dialog component was rendering unstyled before Phase 4 — Tailwind utility translation **restores** the intended visual styling.

## Phase 4 actual results (2026-05-16 execution)

### Verification command outputs

| Command | Result | Notes |
|---|---|---|
| `npm run lint` | ✅ pass | no warnings or errors |
| `npm run typecheck` | ✅ 2 baseline errors only | reduced from 3 → 2; `input.tsx:48` baseline error fixed by removing dead `nativeInput` branch; remaining 2 are `web-vitals` module-missing in `perfBaseline/index.ts` (unrelated, Phase 0 follow-up) |
| `npm run test` | ✅ pass except 3 pre-existing baseline failures | only 3 `ComposerInput.collaboration.test.tsx` failures (confirmed pre-existing via `git stash` ⇒ same failure mode without Phase 4 changes; identical to Phase 2 / Phase 3 baseline observation) |
| `npm run test:layout-guard` | ✅ 10/10 pass | no `composer/dialog/toast` strings pinned |
| `npm run check:large-files:gate` | ✅ found=0 | no regressions |
| `npx vitest run src/components/ui/LoadingProgressDialog.test.tsx` | ✅ 2/2 pass | role-based + ESC behavior preserved |
| `npx vitest run src/features/notifications/components/ErrorToasts.test.tsx` | ✅ 5/5 pass | variant rendering + action flow preserved |
| `npx vitest run src/features/update/components/UpdateToast.test.tsx` | ✅ 4/4 pass | `.update-toast-progress-fill` querySelector still resolves |
| `npx vitest run src/features/app/components/RequestUserInputMessage.test.tsx` | ✅ 10/10 pass | `.request-user-input-card` + `.is-selected` classList assertions hold |
| `npx vitest run src/features/app/components/ApprovalToasts.test.tsx` | ✅ 6/6 pass | `.approval-toast-icon-wrap` / `.approval-toast-summary-band` / `.approval-toast-badge` querySelectors hold |
| `npx vitest run src/features/app/components/AskUserQuestionDialog.test.tsx` | ✅ 13/13 pass | `.ask-user-question-overlay` / `.ask-user-question-card` / `.is-composer-overlay` / `.is-selected` classList assertions hold |

### Final diff stats

15 files changed, +324 / −1632 lines (net −1308 lines from `src/`):
- 9 .tsx modified (LoadingProgressDialog, input, ApprovalToasts, AskUserQuestionDialog, RequestUserInputMessage, RequestUserInputSubmittedBlock, ErrorToasts, UpdateToast) + bootstrap.ts
- 6 .css deleted (1486 lines total CSS removed)
- 1 .css added (toast-animations.css, 68 lines, keyframes only)

### Scope adjustments from plan

None — the convert list executed as planned. The "Phase 4.5 composer follow-up" was scoped out at plan-time (not at execution-time). Final convert list (6 files) matches plan exactly.

### Discovery confirmation reminders (no surprises)

- `ask-user-question-dialog.css` confirmed dead at execution time: zero `import` references in repo (only file's own self-reference). Deletion = no bootstrap edit required.
- `update-toasts.css` exists in bootstrap.ts at line 14 (Phase 4 cluster, not Phase 5). Verified before removal.
- 4 keyframes (`update-toast-in`, `error-toast-in`, `approval-toast-in`, `ask-dialog-slide-in`, `ask-timer-pulse`) preserved in `toast-animations.css` since Tailwind v4 arbitrary value syntax for `animation: keyframe-name 200ms ease-out` requires the keyframe to exist in a stylesheet — it cannot be defined inline. This is the same pattern adopted in Phase 1 (`proxy-status-badge.css`) and Phase 3 (`prompts-animations.css`).
- Test pins are all classList/querySelector based (not `.toContain` literal CSS source) — confirmed via `rg` against test files. No `readCssWithImports`-style pin blocks Phase 4 removal.

### input.tsx bonus fix detail

Before: `nativeInput?: boolean` prop declared but only used to gate a dead `<input>` branch (only `<InputPrimitive>` ever reached in practice). The dead branch had a type incompatibility because Base UI `InputState`-returning style prop is not assignable to plain `<input>` style.

After: Dropped the `nativeInput` prop and the dead `{nativeInput ? <input> : <InputPrimitive>}` ternary. Single render path = `<InputPrimitive>` only. Verified `rg 'nativeInput' src/` returns no callers — safe to remove.

Result: `input.tsx:48` baseline typecheck error gone. Typecheck baseline goes from 3 → 2 errors; the remaining 2 (`web-vitals` module missing in `perfBaseline/index.ts`) are unrelated and remain in Phase 0 follow-up queue.
