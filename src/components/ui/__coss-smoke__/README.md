# coss Smoke Test

> Phase 1 self-check artifact for the coss.ui migration.
> See `.trellis/tasks/05-16-migrate-css-to-coss-ui/prd.md`.

## Purpose

After Phase 1 wires up coss design tokens (`themes.*.css`) into the Tailwind
`@theme` block in `src/styles/globals.css`, we need a low-risk way to verify
that:

1. The token chain is intact (`--background` → `--color-background` →
   `bg-background` utility class).
2. coss / shadcn-style utility classes (`bg-card`, `text-card-foreground`,
   `border-border`, `bg-primary`, `text-primary-foreground`, ...) resolve to
   real classes without runtime errors.
3. Mounting a coss-style component in jsdom does not regress the test setup.

## Scope

- The fixture in `CossSmokeTest.tsx` is **not** wired into any production
  route. It exists only to give the unit test something tangible to render.
- The Vitest contract in `CossSmokeTest.test.tsx` only asserts DOM
  `className` membership — colour rendering is not testable in jsdom.

## Lifecycle

- Created during Phase 1.
- May be deleted once Phase 2+ replace real surfaces with coss primitives and
  cover the same utility classes through real components.
