## 1. Contract And Default Audit

- [x] 1.1 [P0][depends: none][input: current `AppSettings`, `ShortcutsSection`, shortcut hooks][output: current shortcut action inventory][verify: documented in implementation notes] List all existing shortcut setting keys, defaults, scopes, and trigger surfaces.
- [x] 1.2 [P0][depends: 1.1][input: proposed session/sidebar/runtime/files actions][output: final default shortcut table][verify: code review] Audit collisions against existing app shortcuts, editor shortcuts, native menu accelerators, and high-risk platform shortcuts.
- [x] 1.3 [P0][depends: 1.2][input: shortcut action list][output: stable action metadata shape][verify: typecheck] Define a reusable metadata structure for setting key, draft key, category, label key, default shortcut, scope, and trigger surface.

## 2. Settings Schema And UI

- [x] 2.1 [P0][depends: 1.3][input: `src/types.ts`, `useAppSettings.ts`][output: new shortcut fields with defaults and legacy-safe normalization][verify: `useAppSettings` tests + typecheck] Add settings for open session previous/next, left/right sidebar toggle, runtime console toggle, and files surface shortcut.
- [x] 2.2 [P0][depends: 1.3,2.1][input: `settingsViewShortcuts.ts`, `ShortcutsSection.tsx`][output: Settings -> Shortcuts renders all new actions][verify: Settings focused tests] Drive shortcut rows from action metadata or an equivalent shared source.
- [x] 2.3 [P1][depends: 2.2][input: locale files][output: zh/en copy for all new shortcut labels, group descriptions, and helper text][verify: no missing translation key in focused tests] Add i18n for session navigation, sidebars, runtime console, and files shortcut labels.

## 3. Session Navigation Shortcuts

- [x] 3.1 [P0][depends: 2.1][input: topbar/open session projection utilities][output: previous/next open session resolver based on visible tab order][verify: unit tests] Reuse the same order users see in open session tabs.
- [x] 3.2 [P0][depends: 3.1][input: app-shell session activation actions][output: shortcut handlers activate previous/next open session][verify: focused hook/component tests] Switch workspace when the target session belongs to another workspace.
- [x] 3.3 [P1][depends: 3.2][input: no active session / single session cases][output: no-op guards][verify: tests] Ensure unavailable navigation does not show error toast or mutate state.

## 4. Sidebar, Terminal, Runtime Console, And Files Wiring

- [x] 4.1 [P0][depends: 2.1][input: layout/sidebar state actions][output: left conversation sidebar shortcut toggle][verify: layout focused tests] Toggle only existing left layout visibility/collapse state.
- [x] 4.2 [P0][depends: 2.1][input: right panel/sidebar state actions][output: right conversation/sidebar shortcut toggle][verify: layout focused tests] Toggle only existing right layout visibility/collapse state.
- [x] 4.3 [P0][depends: 2.1][input: terminal panel controller][output: terminal shortcut remains configurable and unchanged semantically][verify: existing panel shortcut tests] Confirm terminal toggle is not conflated with runtime console.
- [x] 4.4 [P0][depends: 2.1][input: runtime console toggle action][output: runtime console shortcut handler][verify: focused tests] Toggle console UI without starting/stopping runtime.
- [x] 4.5 [P1][depends: 2.1][input: files surface open/focus/toggle action][output: files surface shortcut handler][verify: files focused tests] Open/focus/toggle files surface while preserving editor scoped save/find.

## 5. Shortcut Matching And Conflict Guards

- [x] 5.1 [P0][depends: 3,4][input: global shortcut hooks][output: all new handlers use shared platform-aware matcher][verify: shortcut matcher and hook tests] Remove any new hardcoded modifier checks.
- [x] 5.2 [P0][depends: 5.1][input: editable target guard][output: global shortcuts skip input/textarea/contenteditable/editor targets][verify: tests] Protect composer and file editor typing paths.
- [x] 5.3 [P1][depends: 5.1][input: native menu accelerator controller][output: only native-menu capable actions are registered as menu accelerators][verify: controller tests or code review] Avoid double-triggering DOM-only actions.

## 6. Validation

- [x] 6.1 [P0][depends: 2-5][input: changed TS files][output: zero TypeScript errors][verify: `npm run typecheck`] Run full typecheck.
- [x] 6.2 [P0][depends: 2-5][input: focused shortcut/settings/session/layout/files tests][output: focused regression evidence][verify: `npx vitest run <focused files>`] Run targeted tests for Settings, shortcut hooks, session navigation, sidebar/runtime console/files wiring.
- [x] 6.3 [P1][depends: 2.2][input: Settings UI / styles changed if applicable][output: large-file guard evidence][verify: `npm run check:large-files` when styles or large files are touched] Run large-file check if implementation modifies CSS or near-threshold files.
- [ ] 6.4 [P1][depends: 6.1,6.2][input: running app][output: manual smoke notes][verify: checklist] Smoke test macOS-style and non-macOS-style display labels, Settings edit/clear, session next/previous, sidebars, runtime console, terminal, and files surface.
