# Phase 8.6.1 — Spec-hub header coss 化 (Partial migration only)

> Status: drafted 2026-05-16 by Implement agent on main worktree, head `0954fb3c`.
>
> **Outcome: scope drastically shrunk — only the 6 provider/support badge variant rules migrated to inline Tailwind utilities (zero impl line growth). The remaining 9 selectors stay in `spec-hub-header.css` as a slimmed-down keeper file.** Full deletion of `spec-hub-header.css` is **not feasible this PR** under the strict baseline=6111 constraint (see "Why partial" below).

## Discovery

### CSS file scope (initial)

| 文件 | 行 | Selectors | 字面 pin? |
|---|---|---|---|
| `spec-hub-header.css` | 142 | 14 | NO literal CSS pin (verified via grep of `layout-swapped-platform-guard.test.ts`) |
| `spec-hub.reader-layout.css` | 343 | 40 | NO literal CSS pin |

### Consumer surface (header.css)

- **Markup**: `src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx` lines 2384-2480 (`spec-hub-header` block) + lines 403-414 (badge variant ternaries `mo` / `ho`).
- **No tests** reference `.spec-hub-header*`, `.spec-hub-title-wrap*`, `.spec-hub-badge*` (verified via grep across `src/features/spec/components/SpecHub*.test.tsx` and `src/features/spec/components/spec-hub/**/*.test.tsx`).
- **`SpecHubReaderDom.ts` querySelector** hooks do not reference any header.css selectors.
- **`.spec-hub`** root selector is used by `SpecHubSurfaceFrame.tsx` cascade rules in `reader-layout.css` (`.spec-hub-surface > .spec-hub`, `.spec-hub-surface .spec-hub-grid`, etc.) — the marker stays intact.

### Why partial (the baseline constraint)

The task's hard gate requires `SpecHubPresentationalImpl.tsx` to **retain baseline=6111** (zero line delta). Empirical experimentation showed:

- **Full inline migration** of header.css (all 14 selectors → Tailwind utilities at the JSX `_jsx`/`_jsxs` runtime-call sites) grows the impl by **+21 lines** after prettier reformat (long arbitrary-value strings like `bg-[linear-gradient(180deg,color-mix(in_srgb,...))]` and `shadow-[inset_0_1px_0_color-mix(...)]` force prettier to wrap multi-line; new `className: hdr.cls` props on previously-styleless `<h2>` / `<p>` add new lines).
- **Const-indirection via helpers** (`HUB_ROOT_CLS`, `HUB_HEADER_CLS`, etc., imported from `SpecHubPresentationalImpl.helpers.tsx`) still needs **+9 import lines** + **+1 line for the `<p>` className**, net **+10 lines**.

The baseline file (`docs/architecture/large-file-baseline.json`) is **outside the modifiable file scope** for this PR, so the gate cannot be re-baselined here. The only way to hit `delta=0` is to limit migration to selectors that fit inside the existing line structure.

### What fits — provider/support badge variant ternaries

The existing `mo` (line 403-408) and `ho` (line 409-414) variables already define 6-line ternary chains that return a single marker class name per branch (`spec-hub-badge-provider-openspec`, `spec-hub-badge-support-full`, etc.). Appending Tailwind arbitrary-value utilities to each returned string **does not grow the file** — only the string contents change, the line structure is preserved.

This migrates **6 of 14 selectors** (provider/support × 3 variants each), removing **36 lines** of CSS.

## Execution (this PR)

1. **`SpecHubPresentationalImpl.tsx`** — `mo` and `ho` ternary branch strings extended with Tailwind utilities:
   - `spec-hub-badge-provider-openspec` → `spec-hub-badge-provider-openspec border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]`
   - `spec-hub-badge-provider-speckit` → `spec-hub-badge-provider-speckit border-[#fde68a] bg-[#fffbeb] text-[#b45309]`
   - `spec-hub-badge-provider-unknown` → `spec-hub-badge-provider-unknown border-[#d1d5db] bg-[#f3f4f6] text-[#6b7280]`
   - `spec-hub-badge-support-full` → `spec-hub-badge-support-full border-[#a7f3d0] bg-[#ecfdf5] text-[#047857]`
   - `spec-hub-badge-support-minimal` → `spec-hub-badge-support-minimal border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]`
   - `spec-hub-badge-support-none` → `spec-hub-badge-support-none border-[#d1d5db] bg-[#f3f4f6] text-[#6b7280]`

2. **`spec-hub-header.css`** — slim by removing the 6 migrated variant rules (lines 90-124 in the original). File shrinks 142 → 106 lines.

3. **`bootstrap.ts`** — unchanged. File still imported.

4. **`spec-hub.reader-layout.css`** — untouched (deferred to Phase 8.6.1b).

## What is NOT done (deferred)

### Phase 8.6.1b — Spec-hub-header.css full removal (when baseline regen is allowed)

Remaining 9 selectors (~106 lines of CSS) require either:
- Baseline regen permission (allow `docs/architecture/large-file-baseline.json` to bump to ~6121), OR
- Const-indirection migration through `SpecHubPresentationalImpl.helpers.tsx` (adds ~10 impl lines for new imports, requires bumping baseline by 10).

Selectors still in `spec-hub-header.css`:
- `.spec-hub` (root section)
- `.spec-hub-header` (header bar w/ linear-gradient bg)
- `.spec-hub-title-wrap` + descendant `h2` / `p` rules
- `.spec-hub-header-side`, `.spec-hub-header-badges`
- `.spec-hub-badge` (base shape) + `.spec-hub-badge-dot`
- `.spec-hub-badge-gate.is-pass` / `.is-warn` / `.is-fail` (3 rules)

### Phase 8.6.1c — Spec-hub.reader-layout.css

343 lines covering `.detached-spec-hub-window-shell` / `.detached-spec-hub-menubar*` / `.spec-hub-surface` cascade / `.spec-hub-pane-toggle-button` / `.spec-hub-changes-expand-button` / `.spec-hub-changes-resizer` / `.spec-hub-reader-outline*`. The cascade-descendant rules (`.spec-hub-surface .spec-hub-grid`, `.spec-hub-surface.is-changes-collapsed .spec-hub-grid`, etc.) descend into `SpecHubPresentationalImpl.tsx` bundled `_jsx` markup — inlining requires either rewriting the runtime-call tree or accepting `.macos-desktop` cascade keeper (`spec-hub-detached-shell-keepers.css` ~10-15 lines). Out of scope this PR.

## Files changed (this PR)

1. **Modified** `src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx` — `mo` and `ho` ternary returns extended with Tailwind utility strings. Net 0 lines.
2. **Modified** `src/styles/spec-hub-header.css` — removed 6 provider/support variant rules (142 → 106 lines, −36).
3. **New** `.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-8-6-1-spechub-header-plan.md` — this plan doc.

## Verification

| Command | Result |
|---|---|
| `npm run lint` | (run below) |
| `npm run typecheck` | (run below) |
| `npm run test:layout-guard` | (run below) |
| `npm run check:large-files:gate` | **pass** — `status=retained, baseline=6111, delta=0` |
| `npx vitest run src/features/spec/` | (run below) |

## Follow-up

- **Phase 8.6.1b** — Finish migrating remaining 9 selectors in `spec-hub-header.css` (requires baseline regen).
- **Phase 8.6.1c** — `spec-hub.reader-layout.css` (343 lines, includes macOS keeper).
- **Phase 8.6.2** — `spec-hub.chrome.css` + `spec-hub.controls.css` (872 lines combined).
- **Phase 8.6.3** — `spec-hub.css` (1854 lines + 5 media queries + 1 keyframes).
