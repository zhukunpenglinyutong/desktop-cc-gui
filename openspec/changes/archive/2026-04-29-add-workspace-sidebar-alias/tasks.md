## 1. Data Contract

- [x] 1.1 [P0][Input: TypeScript and Rust `WorkspaceSettings`][Output: optional `projectAlias` field with backward-compatible defaults][Verify: `npm run typecheck`] Add sidebar alias field to workspace settings schemas without changing `WorkspaceInfo.name`.

## 2. Sidebar UI

- [x] 2.1 [P0][Depends: 1.1][Input: workspace row render path][Output: sidebar row displays `projectAlias || workspace.name`][Verify: `WorkspaceCard` test] Add a sidebar-only display label helper and wire it into workspace card rendering.
- [x] 2.2 [P0][Depends: 1.1][Input: workspace context menu][Output: “set alias” action writes `projectAlias` via existing `updateWorkspaceSettings` handler][Verify: `useSidebarMenus` test] Add the minimal alias editing action without adding new Tauri commands.
- [x] 2.3 [P1][Depends: 2.2][Input: user-visible labels][Output: zh/en i18n copy for alias action and prompt][Verify: i18n keys compile through tests/typecheck] Add localized sidebar alias copy.
- [x] 2.4 [P0][Depends: 2.2][Input: workspace menu action][Output: React modal opens, saves alias, and clears alias on empty value][Verify: `WorkspaceAliasPrompt` and `Sidebar` tests] Close the menu-to-edit loop without relying on native `window.prompt`.
- [x] 2.5 [P1][Depends: 2.1][Input: aliased workspace row][Output: compact alias badge with original-name tooltip][Verify: `Sidebar` test] Add a subtle visual cue so users can tell the visible label is an alias.

## 3. Verification

- [x] 3.1 [P0][Depends: 2.x][Input: unit tests][Output: alias display, fallback, and menu action coverage][Verify: targeted Vitest files pass] Add or update focused tests.
- [x] 3.2 [P0][Depends: 3.1][Input: full changed surface][Output: clean typecheck and OpenSpec validation][Verify: `npm run typecheck`, `openspec validate add-workspace-sidebar-alias --strict`] Run validation gates and record results.
