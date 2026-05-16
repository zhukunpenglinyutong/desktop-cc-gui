# Phase 8 — Spec Hub: Discovery & Plan

> Status: drafted 2026-05-16 by Implement agent (Claude Code) in parallel worktree `agent-ab03082c92dc4d9b1` (head `bd18dfb1`, branched off pre-Phase-6 baseline of `chore/bump-version-0.5`).
>
> **Outcome: Phase 8 is a discovery + defer PR. No CSS file deletion, no JSX change.** Rationale below. All real conversion work moved to Phase 8.5 after the minified-bundle blocker is resolved.

## Worktree context

- Working branch: `worktree-agent-ab03082c92dc4d9b1` (head `bd18dfb1`)
- This worktree was branched off `chore/bump-version-0.5` **before** the Phase 2/3/4/5/6 commits landed there. Diff vs `chore/bump-version-0.5` shows my `bootstrap.ts` and `src/styles/` still hold the **pre-Phase-2 baseline**: 53 CSS imports, including the files that Phase 2/3/4/5/6 deleted (`home.css`, `prompts.css`, `update-toasts.css`, etc.).
- For spec-hub specifically: `git diff chore/bump-version-0.5 -- src/styles/spec-hub*.css src/styles/spec-hub-header.css` is **empty** → my Phase 8 work operates on the same spec-hub CSS state that the merged `chore/bump-version-0.5` has. Orchestrator merge will be clean on these files.
- Typecheck baseline at worktree HEAD: **0 errors** (npm run typecheck passes). Lint / test:layout-guard / check:large-files:gate all green.
- This is a parallel worktree running alongside Phase 7 (git-history) and Phase 9 (file/diff/terminal). Shared files (`bootstrap.ts`, `prd.md`, `docs/migration-to-coss-ui.md`, `package.json`/`package-lock.json`, `base.css`, `themes.*.css`) are off-limits — orchestrator handles them in the final merge.

## Discovery summary

### Files in PRD-listed scope

| 文件 | 行 | Selectors | 字面值 pin? | Consumer 体量 | 处置 |
|---|---|---|---|---|---|
| `spec-hub.css` (aggregator + bulk styles + 5 media queries + 1 keyframes) | 1854 | 266 | NO literal CSS pin in any `*.test.*` | Vast majority styles markup rendered by **minified `SpecHubPresentationalImpl.tsx`** | **DEFER → Phase 8.5** (blocker: minified Impl, see below) |
| `spec-hub.controls.css` (chain-imported by `spec-hub.css:1`) | 504 | ~140 | NO literal CSS pin | Entire cluster (header icon-action, doctor, changes, artifacts, control panels, tabs, change filters, action lists, timeline, apply / verify / passthrough / validation panels) rendered by **minified Impl** | **DEFER → Phase 8.5** |
| `spec-hub.chrome.css` (chain-imported by `spec-hub.css:2`, **NOT in PRD list but transitively in scope**) | 368 | ~100 | NO literal CSS pin | Mixed: reader-outline cluster rendered by clean `SpecHubSurfaceFrame.tsx`, BUT spec-file-chip / artifact-meta / change-context-menu / change-chip rendered by minified Impl | **DEFER → Phase 8.5** (mixed; cannot partially delete without leaving cascade-dependent rules orphaned) |
| `spec-hub-header.css` | 142 | ~14 | NO literal CSS pin | `.spec-hub` shell + `.spec-hub-header` + `.spec-hub-title-wrap` + badge variants (provider-openspec / speckit / unknown, support-full / minimal / none, gate.is-pass / warn / fail) — ALL rendered by **minified Impl** | **DEFER → Phase 8.5** |
| `spec-hub.reader-layout.css` | 343 | ~40 | NO literal CSS pin | Mixed: detached-menubar / detached-window-shell / spec-hub-surface / pane-toggle-button / changes-resizer / reader-outline-host / changes-expand-button rendered by **clean `SpecHubSurfaceFrame.tsx` + `DetachedSpecHubWindow.tsx`**, BUT descendant cascades like `.spec-hub-surface .spec-hub-grid`, `.spec-hub-surface .spec-hub-changes`, `.spec-hub-surface .spec-hub-artifacts`, `.spec-hub-surface .spec-hub-artifact-*`, `.detached-spec-hub-window .spec-hub-*` cascade onto markup from **minified Impl** | **DEFER → Phase 8.5** (cannot delete without leaving cascade pin orphaned) |

**Total spec-hub CSS surface**: 5 files / 3211 lines / ~560 selectors.

### Bootstrap status (read-only this phase)

`src/bootstrap.ts:50-52` in this worktree (which == `chore/bump-version-0.5` head for spec-hub lines):

```ts
import "./styles/spec-hub-header.css";
import "./styles/spec-hub.css";              // chain-imports controls.css + chrome.css
import "./styles/spec-hub.reader-layout.css";
```

3 direct + 2 chain = 5 spec-hub CSS imports.

### Consumer file inventory

| File | Lines | Role | Markup rendering | Inline-Tailwind feasibility |
|---|---|---|---|---|
| `src/features/spec/components/SpecHub.tsx` | 6 | 入口 facade | None | N/A |
| `src/features/spec/components/SpecHub.presentational.tsx` | 21 | Wraps Impl with Frame | None | N/A |
| `src/features/spec/components/spec-hub/orchestration/SpecHubOrchestrator.tsx` | 7 | Hooks → presentational props | None | N/A |
| `src/features/spec/components/spec-hub/hooks/useSpecHubOrchestration.ts` | 5 | Presentational props builder | None | N/A |
| `src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx` | **25 lines / 113 KB** (minified bundled artifact, `@ts-nocheck`) | Renders **vast majority** of `spec-hub-*` markup: badges, action lists, apply / verify / ai-takeover / proposal / autocombo floating sections, bootstrap panel, doctor card, change list, control center, artifacts pane, tabs, markdown, task list, spec-file switcher, etc. | **All clusters under `.spec-hub-changes` / `.spec-hub-artifacts` / `.spec-hub-control` / `.spec-hub-doctor` / `.spec-hub-action-*` / `.spec-hub-apply-floating` / `.spec-hub-ai-takeover*` / `.spec-hub-proposal-floating` / `.spec-hub-bootstrap-*` / `.spec-hub-mode-switch` / `.spec-hub-shared-engine` / `.spec-hub-feedback-*` / `.spec-hub-spec-file-*` / `.spec-hub-status-*` / `.spec-hub-passthrough` / `.spec-hub-validation-*` / `.spec-hub-gate-*` / `.spec-hub-change-context-menu` / etc.** | **IMPOSSIBLE without de-bundling** — see "Minified-Impl blocker" below |
| `src/features/spec/components/spec-hub/reader/SpecHubSurfaceFrame.tsx` | 507 | Renders surface frame: `.spec-hub-surface`, `.spec-hub-pane-toggle-button`, `.spec-hub-pane-header-actions`, `.spec-hub-reader-header-actions`, `.spec-hub-reader-detach-button`, `.spec-hub-reader-outline*`, `.spec-hub-reader-related-spec*`, `.spec-hub-changes-expand-button`, `.spec-hub-changes-resizer` (via createPortal hosts) | Clean source | Feasible IF reader-cluster CSS could be extracted from `spec-hub.chrome.css` + `spec-hub.reader-layout.css`. But the same files have cascading descendant rules onto minified-Impl markup — extraction not net-positive. |
| `src/features/spec/components/spec-hub/reader/SpecHubReaderDom.ts` | 296 | DOM querySelector consumer (`.spec-hub-tabs`, `.spec-hub-artifact-body`, `.spec-hub-markdown`, `.spec-hub-task-heading`, `.spec-hub-task-checkbox`, `.spec-hub-grid`, `.spec-hub-change-item.is-active`, `.spec-hub-change-id`, `.spec-hub-artifact-path`, `.spec-hub-spec-file-chip.is-active`) | None | **HARD CONTRACT** — these class names must continue to be emitted by the rendered markup regardless of styling pass |
| `src/features/spec/components/DetachedSpecHubWindow.tsx` | 191 | Renders `.detached-spec-hub-window-shell`, `.detached-spec-hub-menubar`, `.detached-spec-hub-menubar-copy/-label/-title`, `.detached-spec-hub-unavailable*` | Clean source | Feasible to inline, BUT cascade pin from `.macos-desktop .detached-spec-hub-menubar*` (in `spec-hub.reader-layout.css:27-37`) requires keeping the rule because `.macos-desktop` is on `app` root outside this component → keeper-only |

### Test pins (DOM querySelector / classList; **NO literal-CSS pin**)

Grep verified: **0 tests read any spec-hub CSS file via `readFileSync` / `getCssRuleBlock` / similar**.

Test pins on **class name presence** (must preserve as no-op semantic markers if CSS is migrated):
- `SpecHub.reader-layout.test.tsx`:
  - `.spec-hub-grid` querySelector + `is-control-collapsed` classList check
  - `.spec-hub-surface` querySelector + `style.getPropertyValue("--spec-hub-changes-width")`
  - `is-changes-collapsed` classList check
  - `screen.getByRole("separator", { name: "Resize changes pane" })`
- `SpecHubSurfaceFrame.test.tsx`:
  - `.spec-hub-reader-outline-pending-dot` querySelector
  - `is-pending` classList check (from reader-outline button)
  - `ReaderScaffold` mounts hand-crafted `.spec-hub` / `.spec-hub-grid` / `.spec-hub-changes` / `.spec-hub-artifacts` / `.spec-hub-panel-header` / `.spec-hub-panel-title` / `.spec-hub-tabs` / `.spec-hub-artifact-path` / `.spec-hub-artifact-content` / `.spec-hub-artifact-body` / `.spec-hub-task-heading.level-2` / `.spec-hub-task-row` / `.spec-hub-task-checkbox` / `.spec-hub-task-text` markup as test scaffold — **the test fixture itself pins these class names contractually**
- `SpecHub.test.tsx`:
  - `.spec-hub-apply-floating-header` querySelector
  - `.spec-hub-action-orchestrator-row` querySelector
  - `.spec-hub-change-item.is-backlog` querySelector

### Guard tests

- `layout-swapped-platform-guard.test.ts` — does NOT touch any spec-hub CSS. Safe.
- `sidebar-titlebar-drag-region.test.ts` — does NOT touch any spec-hub CSS. Safe.
- `settings-email-card-surface.test.ts` — out of scope, settings only.

## The minified-Impl blocker

`src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx` is a **25-line, 113 KB file with `@ts-nocheck`**. Line 1 is `// @ts-nocheck`. Line 2 is the entire minified React component (imports, helpers, ~50+ const declarations, the `SpecHubPresentational` function with ~2660-line-equivalent logic when de-minified). Lines 3-25 are 1-2 character continuation strings.

Empirically (`grep -oE "spec-hub-[a-z0-9_-]+"` on this single file): **all 225+ `spec-hub-*` class names** used anywhere in the codebase appear inside this minified blob. Cross-referenced with `spec-hub*.css` selectors: **every CSS class defined in the 5 phase-8 CSS files is referenced by markup that comes out of this minified file** (zero CSS-side orphans found, full sweep at the unique-name level).

Consequences for Phase 8 styling pass:

1. **Cannot inline Tailwind into JSX** — there is no readable JSX in the file; the className strings are interpolated inside minified template strings, e.g. `className:\`spec-hub-apply-floating spec-hub-continue-floating${Mt?...}\``. Hand-editing would require de-bundling the file back to source (~2660 lines of React with hooks / portals / effects / refs).

2. **Cannot delete CSS files** — every selector in `spec-hub.css` / `spec-hub.controls.css` / `spec-hub.chrome.css` / `spec-hub-header.css` is exercised by the rendered markup; deletion = blanket visual regression.

3. **Cannot partially delete `spec-hub.reader-layout.css`** — the file has ~40 selectors, of which ~25 are descendant rules (`.spec-hub-surface .spec-hub-grid`, `.spec-hub-surface .spec-hub-artifact-*`, `.detached-spec-hub-window .spec-hub-*`, `.macos-desktop .detached-spec-hub-menubar*`) whose right-hand targets are minified-Impl markup. Even the "clean-source rules" (`.spec-hub-pane-toggle-button`, `.spec-hub-changes-resizer`, `.spec-hub-changes-expand-button`, `.spec-hub-reader-outline*` portaled hosts) sit alongside cascade dependencies that cannot move; extracting them piecemeal does not reduce file count and increases coupling.

4. **`SpecHubReaderDom.ts` is a hard runtime DOM contract** — even if we somehow rewrote the minified file, we must preserve every querySelector hook there (`.spec-hub-tabs [role='tab']`, `.spec-hub-artifact-body`, `.spec-hub-markdown h1-h6`, `.spec-hub-task-heading`, `.spec-hub-task-checkbox`, `.spec-hub-grid`, `.spec-hub-change-item.is-active`, `.spec-hub-change-id`, `.spec-hub-artifact-path`, `.spec-hub-spec-file-chip.is-active`).

## Phase 8 final scope (this PR)

**IN scope**:
1. This discovery + defer plan doc (`phase-8-spec-hub-plan.md`).
2. Orchestrator action checklist (see "Orchestrator actions" below).

**OUT of scope (this PR)**:
- No CSS file deletion.
- No CSS file rewrite.
- No JSX className change.
- No bootstrap.ts edit (owned by orchestrator anyway).
- No docs/migration-to-coss-ui.md edit (owned by orchestrator; Phase 8.5 follow-up text drafted below for orchestrator copy-paste).

## Rationale for full deferral

Phase 8 is the third phase to defer its entire deliverable to a follow-up sub-PR — Phase 4 deferred composer to Phase 4.5, Phase 5 deferred home-chat + kanban to 5.5/5.6, Phase 6 deferred 7 of 8 files to 6.5/6.6/6.7. Phase 8's blocker is qualitatively different from those: not size, but the presence of a single 113 KB minified `@ts-nocheck` source file that owns ~95%+ of all spec-hub markup. The conservative engineering call is to:

1. **Acknowledge the blocker explicitly** in this plan doc so the orchestrator and any future agent can see why no file deletion happened.
2. **Resist the temptation** to do tactical "delete-the-leaves" work (e.g., extract one rule out of `spec-hub.reader-layout.css` and convert it to Tailwind in `SpecHubSurfaceFrame.tsx`) that would deliver near-zero progress while increasing entropy.
3. **Stage the real work** as Phase 8.5 (de-minify the bundled file) + Phase 8.6 (inline Tailwind across all 5 spec-hub CSS files at once now that the JSX is readable).

The same pattern was applied to `kanban.css` (Phase 5.6 sub-PR split) and `composer.part1/part2.css` (Phase 4.5 deferral). The PRD's "单文件超过 1000 行 tsx diff" scope-收缩 rule applies here in spirit: the relevant "tsx diff" would be the impossible 2660-line de-minification + parallel CSS inline.

## Phase 8.5 / 8.6 roadmap (drafted for orchestrator follow-up doc)

### Phase 8.5 — De-minify `SpecHubPresentationalImpl.tsx`

Prerequisite for any spec-hub CSS deletion. Two viable paths:

- **Path A (preferred)**: Locate the original source repo / commit history. The file's pattern (`@ts-nocheck` header + single-line minified bundle) suggests it was generated by Vite / esbuild and committed back into source. If git log shows a previous unminified version, restore + reapply changes via diff. Risk: low (mechanical rollback).
- **Path B (fallback)**: Hand-decompose with prettier + manual variable renaming. Use `npx prettier --write` to add whitespace, then iteratively rename `Mc` / `bc` / `Ee` / `ne` etc. back to meaningful identifiers based on call sites. Risk: medium-high (loses git blame, weeks of rename tedium).

Either path: the deliverable is an unminified `SpecHubPresentationalImpl.tsx` (~2660 lines, no `@ts-nocheck`, passes typecheck) that can be diffed in PR review.

### Phase 8.6 — Inline Tailwind across all 5 spec-hub CSS files

Once Phase 8.5 lands, repeat Phase 2/3/4/5/6 pattern for spec-hub:

| 文件 | 删/留 | 备注 |
|---|---|---|
| `spec-hub-header.css` (142 lines) | delete | Inline `.spec-hub` shell + `.spec-hub-header` + badge variants into de-minified Impl; keep no-op markers per Phase 2-6 pattern. Hex badge colors (`#bfdbfe` etc.) → Tailwind arbitrary values with `text-[#1d4ed8]` style. |
| `spec-hub.controls.css` (504 lines) | delete | Convert header icon-action / doctor / changes / artifacts / control panels / tabs / change filters / action lists / timeline / apply-floating / verify-floating / passthrough / validation / gate panels to Tailwind in Impl. |
| `spec-hub.chrome.css` (368 lines) | delete | Convert change-meta / change-id / change-chip / change-context-menu / reader-outline cluster / spec-file switcher / artifact-meta to Tailwind in Impl + `SpecHubSurfaceFrame.tsx`. |
| `spec-hub.css` (1854 lines including `@import` + `@keyframes` + 5 media queries) | delete | Convert markdown / task list / task heading / task row / task checkbox / blockquote / code / artifact body / passthrough / validation / gate / bootstrap-panel / project / shared-engine / auto / feedback / orchestrator / floating / status / summary clusters to Tailwind in Impl. Migrate `@keyframes spec-hub-spin` to `tw-animate-css` `animate-spin` (already imported via `globals.css`). Migrate 5 media queries to Tailwind arbitrary breakpoints (`max-[1300px]:`, `max-[1200px]:`, `max-[1100px]:`, `max-[980px]:`, `max-[720px]:`). |
| `spec-hub.reader-layout.css` (343 lines) | delete OR keeper | Convert `.detached-spec-hub-window-shell` / `.detached-spec-hub-menubar*` / `.detached-spec-hub-unavailable*` to Tailwind in `DetachedSpecHubWindow.tsx`. Convert `.spec-hub-surface` / `.spec-hub-pane-toggle-button` / `.spec-hub-changes-expand-button` / `.spec-hub-changes-resizer` / `.spec-hub-reader-outline*` to Tailwind in `SpecHubSurfaceFrame.tsx`. **`.macos-desktop .detached-spec-hub-menubar*` cascade pin** + descendant grid template-columns rules → **keeper file `spec-hub-detached-shell-keepers.css`** (~10-15 lines, same pattern as Phase 1 `proxy-status-badge.css` / Phase 3 `prompts-animations.css`). |

Expected Phase 8.6 outcome: bootstrap.ts CSS imports −3 (delete 3 direct) +1 (keeper) = net −2; spec-hub CSS surface 3211 → ~15 lines.

### Phase 8.6 → coss primitive structural swap (Phase 10 follow-up)

- `Tabs` (artifact tabs / control tabs) → `@coss/tabs` primitive
- `Dialog` (change context menu / spec root panel) → `@coss/dialog` primitive
- `Card` (doctor / bootstrap / orchestrator / action) → `@coss/card` primitive
- `Badge` (already partially uses `Badge` import per minified Impl line 2: `import{Badge as _e}from"../../../../../components/ui/badge"`) → audit Phase 8.6 to ensure all `spec-hub-badge*` rendered via `Badge` primitive consistently

## Orchestrator actions (post-merge)

> All shared-file edits are owned by orchestrator per parallel-worktree convention.

1. **Merge this worktree** — `git merge worktree-agent-ab03082c92dc4d9b1`.
   - Conflicts expected on `src/bootstrap.ts` (worktree base predates Phase 2-6 cleanup): take `chore/bump-version-0.5` version (post-Phase-6, 40 imports). My branch did NOT modify bootstrap.ts.
   - Conflicts expected on `src/styles/*.css` for files Phase 2-6 deleted (`home.css`, `release-notes.css`, etc.): take `chore/bump-version-0.5` version (deletion). My branch did NOT touch those.
   - For `src/styles/spec-hub*.css` and `src/styles/spec-hub-header.css`: my branch did NOT modify them — clean merge.
   - For `.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-8-spec-hub-plan.md`: take my version (only new file added in this PR).
2. **Do NOT bump bootstrap.ts spec-hub imports** — no spec-hub CSS was deleted this phase, all 3 imports (`spec-hub-header.css`, `spec-hub.css`, `spec-hub.reader-layout.css`) must remain in bootstrap.ts.
3. **Append to `docs/migration-to-coss-ui.md` follow-up list** (4 new entries):
   - Phase 8.5 — De-minify `SpecHubPresentationalImpl.tsx` (prerequisite; 113 KB / `@ts-nocheck` / single-line bundled artifact). Two paths: git-history rollback (preferred) or hand-decompose with prettier. Out of styling scope; needs its own dedicated PR.
   - Phase 8.6 — Inline Tailwind across all 5 spec-hub CSS files (3211 lines / ~560 selectors), after 8.5 lands. Expected outcome: bootstrap.ts CSS imports −2, spec-hub CSS surface 3211 → ~15 lines (1 keeper file).
   - Phase 8.6.x — Migrate `@keyframes spec-hub-spin` to `tw-animate-css` `animate-spin` (already imported via `globals.css`); migrate 5 media queries to Tailwind `max-[Xpx]:` arbitrary breakpoints.
   - Phase 10 / coss primitive swap — `Tabs` for artifact tabs / control tabs; `Dialog` for change context menu; `Card` for doctor / bootstrap / orchestrator / action; audit all `spec-hub-badge*` to ensure consistent `Badge` primitive usage.
4. **Commit message draft** (per `.claude/rules/git.md`): `refactor(coss-ui): Phase 8 Spec Hub 仅完成发现与延后规划`

## Verification (this PR)

Since no source code was changed, all baselines should be unchanged. Run to confirm:

- `npm run lint` — expected pass
- `npm run typecheck` — expected pass (0 errors)
- `npm run test:layout-guard` — expected pass (10/10)
- `npm run check:large-files:gate` — expected pass (found=0)

Targeted spec-hub tests (smoke check that nothing regressed despite no JSX/CSS edits):
- `npx vitest run src/features/spec/components/SpecHub.reader-layout.test.tsx`
- `npx vitest run src/features/spec/components/spec-hub/reader/SpecHubSurfaceFrame.test.tsx`

## Expected outcomes

- bootstrap.ts CSS import count: **unchanged** (3 spec-hub imports preserved)
- Files deleted: **0**
- Files added: **1** (`phase-8-spec-hub-plan.md`)
- Files modified: **0** in src/ + 1 in `.trellis/` (this plan doc)
- typecheck baseline: 0 errors (unchanged from worktree HEAD)
- lint / test:layout-guard / check:large-files:gate: unchanged
- 4 new follow-ups deferred for orchestrator to append to `docs/migration-to-coss-ui.md`
