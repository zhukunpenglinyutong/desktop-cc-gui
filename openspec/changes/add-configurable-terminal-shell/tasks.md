## 1. Settings Contract

- [x] 1.1 [P0][Input: frontend and Rust app settings schemas][Output: optional `terminalShellPath` / `terminal_shell_path` field][Verify: `npm run typecheck`, Cargo unit tests] Add a backward-compatible terminal shell path setting.
- [x] 1.2 [P0][Depends: 1.1][Input: persisted settings values][Output: trimmed path or null/None][Verify: `useAppSettings` and `settings_core` tests] Normalize whitespace and blank values consistently.

## 2. Terminal Runtime

- [x] 2.1 [P0][Depends: 1.x][Input: `terminal_open` command][Output: PTY command uses configured shell path when set][Verify: `cargo test --manifest-path src-tauri/Cargo.toml terminal_shell_path`] Resolve terminal shell path from app settings before spawning.
- [x] 2.2 [P0][Depends: 2.1][Input: empty configuration][Output: unchanged platform fallback][Verify: resolver code path + existing terminal behavior] Preserve `COMSPEC` / `$SHELL` defaults.

## 3. Settings UI

- [x] 3.1 [P1][Depends: 1.x][Input: Basic Behavior settings][Output: terminal shell path input with save/clear actions][Verify: `SettingsView` focused test] Add user-facing configuration controls.
- [x] 3.2 [P1][Depends: 3.1][Input: user-visible strings][Output: zh/en i18n copy and test mock keys][Verify: Vitest] Add localized labels, hints, and actions.

## 4. Verification

- [x] 4.1 [P0][Depends: 1-3][Input: changed frontend/backend surface][Output: focused tests pass][Verify: targeted Vitest and Cargo tests] Run focused regression tests.
- [x] 4.2 [P0][Depends: 4.1][Input: full changed surface][Output: typecheck, lint, build/static checks][Verify: final verification commands] Run broader PR gates before publishing. OpenSpec CLI was unavailable in the local PATH, so strict validation is recorded as a tool gap.
