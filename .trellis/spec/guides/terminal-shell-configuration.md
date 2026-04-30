# Terminal Shell Configuration Contract

内置 terminal 的 shell path 是 app-level runtime setting，而不是 workspace setting。

## Contract

- Frontend field: `AppSettings.terminalShellPath`.
- Rust field: `AppSettings.terminal_shell_path` serialized as `terminalShellPath`.
- Empty or whitespace-only values mean “no override”.
- No override MUST preserve the platform fallback:
  - Windows: `COMSPEC`, then `cmd.exe`.
  - non-Windows: `SHELL`, then `/bin/zsh`.
- The settings layer MUST NOT validate executable existence. Spawn-time failure belongs to `terminal_open`.

## Touch Points

- Settings UI may edit this field through the existing `get_app_settings` / `update_app_settings` flow.
- Terminal runtime should resolve the shell immediately before constructing `CommandBuilder`.
- Future changes must keep configured path trimming and fallback behavior covered by tests.
