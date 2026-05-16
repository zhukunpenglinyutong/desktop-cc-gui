# coss Table

## When to use

- Structured tabular datasets.
- Sortable/filterable row and column displays.

## Install

```bash
npx shadcn@latest add @coss/table
```

Manual deps from docs:

```bash
# No extra runtime dependency required for basic table usage.
# For interactive data tables, add TanStack Table:
npm install @tanstack/react-table
```

## Canonical imports

```tsx
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
```

## Minimal pattern

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Ada Lovelace</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

## Patterns from coss particles

- **Semantic baseline**: start with `TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, then add `TableCaption` and `TableFooter` as needed.
- **Card variant**: set `variant="card"` on `Table` for rounded, card-like rows and separated borders (`p-table-5`). Combine with `Frame` for app-surface framing (`p-table-2`), with `CardFrame` for static tables in a card shell (`p-table-7`), or with TanStack inside `CardFrame` for selection (`p-table-6`) or sorting and pagination (`p-table-8`).
- **Status-rich rows**: combine `Badge` and decorative dots/icons for state columns while keeping text primary.
- **Interactive data grids**: pair coss table parts with TanStack Table (`flexRender`, row models, selection state) for sorting/pagination/selection.
- **No-results state**: always render an explicit empty-state row with `colSpan` matching visible columns.
- **Fixed layout control**: use `className="table-fixed"` and column width styles when predictable column sizing is required.

## Common pitfalls

- Assuming `Table` itself provides sorting/filter/pagination state; these come from your data layer (for example TanStack Table).
- Mixing header/body cell semantics (`TableHead` in body rows or `TableCell` in headers).
- Forgetting to align `colSpan` with actual visible columns in footer/empty rows.
- Using table patterns where card/list layouts are more suitable on small screens without responsive handling.
- Omitting `aria-label` for row-selection checkboxes in interactive tables.

## Useful particle references

- basic semantic table with caption/footer: `p-table-1`
- `Frame` + card variant: `p-table-2`
- TanStack + checkboxes + `Frame`: `p-table-3`
- TanStack sorting + pagination + `Frame`: `p-table-4`
- card variant only (no shell): `p-table-5`
- `CardFrame` + static table: `p-table-7`
- `CardFrame` + TanStack + checkboxes: `p-table-6`
- `CardFrame` + TanStack + sort + pagination: `p-table-8`

