# Phase 1 — coss Token Coverage Audit

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 1 (coss token finalisation + globals.css cleanup)
> Date: 2026-05-16

## Scope

Audit `src/styles/globals.css`, `src/styles/themes.light.css`, and
`src/styles/themes.dark.css` against the coss token contract documented in
`.agents/skills/coss/references/rules/styling.md` and the typical primitive
references (Button / Card / Dialog / AlertDialog / Sidebar).

Only the coss-standard token chain is in scope here. Pre-existing project
tokens (`--text-*`, `--surface-*`, `--bg-*`, `--dropdown-*`, ...) are
intentionally untouched.

## Required tokens (coss styling.md + primitive refs)

| Token | Light | Dark | `@theme` mapping |
|---|---|---|---|
| `--background` / `--foreground` | yes (`themes.light.css:68-69`) | yes (`themes.dark.css:81-82`) | yes (`globals.css:11-12`) |
| `--card` / `--card-foreground` | yes (`themes.light.css:70-71`) | yes (`themes.dark.css:83-84`) | yes (`globals.css:13-14`) |
| `--popover` / `--popover-foreground` | yes (`themes.light.css:72-73`) | yes (`themes.dark.css:85-86`) | yes (`globals.css:15-16`) |
| `--primary` / `--primary-foreground` | yes (`themes.light.css:74-75`) | yes (`themes.dark.css:87-88`) | yes (`globals.css:17-18`) |
| `--secondary` / `--secondary-foreground` | yes (`themes.light.css:76-77`) | yes (`themes.dark.css:89-90`) | yes (`globals.css:19-20`) |
| `--muted` / `--muted-foreground` | yes (`themes.light.css:78-79`) | yes (`themes.dark.css:91-92`) | yes (`globals.css:21-22`) |
| `--accent` / `--accent-foreground` | yes (`themes.light.css:80-81`) | yes (`themes.dark.css:93-94`) | yes (`globals.css:23-24`) |
| `--destructive` / `--destructive-foreground` | yes (`themes.light.css:82-83`) | yes (`themes.dark.css:95-96`) | yes (`globals.css:25-26`) |
| `--success` / `--success-foreground` | yes (`themes.light.css:84-85`) | yes (`themes.dark.css:97-98`) | yes (`globals.css:27-28`) |
| `--warning` / `--warning-foreground` | yes (`themes.light.css:86-87`) | yes (`themes.dark.css:99-100`) | yes (`globals.css:29-30`) |
| `--info` / `--info-foreground` | yes (`themes.light.css:88-89`) | yes (`themes.dark.css:101-102`) | yes (`globals.css:31-32`) |
| `--border` | yes (`themes.light.css:90`) | yes (`themes.dark.css:103`) | yes (`globals.css:33`) |
| `--input` | yes (`themes.light.css:91`) | yes (`themes.dark.css:104`) | yes (`globals.css:34`) |
| `--ring` | yes (`themes.light.css:92`) | yes (`themes.dark.css:105`) | yes (`globals.css:35`) |
| `--radius` | yes (`themes.light.css:93`) | yes (`themes.dark.css:106`) | yes (`globals.css:42-44`) |
| `--sidebar-background` / `--sidebar-foreground` | yes (`themes.light.css:94-95`) | yes (`themes.dark.css:107-108`) | yes (`globals.css:36-37`) |
| `--sidebar-border` | yes (`themes.light.css:96`) | yes (`themes.dark.css:109`) | yes (`globals.css:38`) |
| `--sidebar-accent` / `--sidebar-accent-foreground` | yes (`themes.light.css:97-98`) | yes (`themes.dark.css:110-111`) | yes (`globals.css:39-40`) |
| `--font-sans` | n/a (entry-level only) | n/a | yes (`globals.css:46`) |
| `--font-mono` | n/a (entry-level only) | n/a | yes (`globals.css:47-53`) |
| `--font-heading` | n/a (entry-level only) | n/a | **NEW — added in Phase 1** (`globals.css:54`) |

## Findings

- Both theme files already define **every** coss-standard color token
  identified by `.agents/skills/coss/references/rules/styling.md` and the
  Button / Card / Dialog / Sidebar primitive references.
- `globals.css` `@theme` block already wires all of those colors to Tailwind
  v4 utility classes (`bg-background`, `text-foreground`, `bg-card`, ...).
- **One missing token**: `--font-heading`. coss `Dialog.DialogTitle` /
  `AlertDialog` / heading scales use `font-heading`; without the variable the
  utility class fell back to UA defaults.
- **Bonus check**: `--sidebar-ring` is *not* required by
  `.agents/skills/coss/references/primitives/sidebar.md`. Skipped.

## Resolution

| Action | Outcome |
|---|---|
| Add `--font-heading` to `globals.css` `@theme` block | done (chained to `--ui-font-family`, same source as `--font-sans` — preserves current SF Pro Text visual) |
| Bump light / dark themes for new colors | not needed — coverage was already complete |
| Add `--sidebar-ring` | skipped — not part of coss sidebar primitive contract |

## Font strategy (Phase 1, conservative)

- `--font-sans`: continues to point at `--ui-font-family` (SF Pro Text fallback).
- `--font-mono`: continues to point at `--code-font-family` (SF Mono fallback).
- `--font-heading`: **new**, chained to the same source as `--font-sans` to
  avoid any visual regression.
- Phase 2+ may switch to Inter / Geist Mono per coss styling.md, but that is
  a deliberate visual change and lives on the `docs/migration-to-coss-ui.md`
  follow-up list, not Phase 1.

## globals.css responsibility refactor

`globals.css` previously hosted three responsibilities:

1. Tailwind v4 entry (`@import "tailwindcss"`).
2. coss `@theme` token registration.
3. `.proxy-status-badge*` business styles + two keyframes.

(3) violated the coss styling.md "theme entry" responsibility and is now
extracted to `src/styles/proxy-status-badge.css`, loaded from
`src/bootstrap.ts` alongside the other feature stylesheets.

| Metric | Before | After |
|---|---|---|
| `globals.css` line count | 167 | 59 |
| Business style files in `globals.css` | 1 (`.proxy-status-badge*`) | 0 |
| New stylesheet appended to `bootstrap.ts` | n/a | `proxy-status-badge.css` |

## coss utility smoke test

- Location: `src/components/ui/__coss-smoke__/`
  - `CossSmokeTest.tsx` — renders a panel using `bg-background`,
    `text-foreground`, `border-border`, `bg-card`, `text-card-foreground`,
    `bg-primary`, `text-primary-foreground`, `bg-secondary`,
    `text-secondary-foreground`, `bg-destructive`, `text-destructive-foreground`,
    `text-muted-foreground`, and `font-heading`.
  - `CossSmokeTest.test.tsx` — Vitest jsdom suite asserting `className`
    contract (does not validate computed colours since jsdom cannot render
    Tailwind preflight).
  - `README.md` — clarifies the fixture is a Phase 1 self-check artifact and
    safe to delete once real coss primitives cover the same surface area.
- Not wired into production routes — only exists for the unit test.

## Verification commands

Run from project root:

```bash
npm run lint
npm run typecheck
npx vitest run src/components/ui/__coss-smoke__/CossSmokeTest.test.tsx
```

Baseline reminder: `npm run typecheck` reports 3 pre-existing errors
(`src/components/ui/input.tsx:48` + `src/services/perfBaseline/index.ts:1, 81`),
unrelated to this Phase. DoD is "no new errors", not "all green".

## Follow-ups (not in Phase 1)

- Phase 2 visual refresh may switch `--font-sans` / `--font-mono` /
  `--font-heading` to Inter + Geist Mono per coss styling.md.
- Phase 10 should remove the smoke fixture once real coss primitives cover the
  same utility surface area.
- Token coverage check has zero observable gaps, but a future audit could
  also verify the brand-token override layer once the design team picks one.
