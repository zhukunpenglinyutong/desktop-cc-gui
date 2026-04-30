# Design

## Settings Contract

`terminalShellPath` is an optional app-level setting because the built-in terminal launcher is global rather than workspace-specific. The field uses camelCase in frontend JSON and maps to `terminal_shell_path` in Rust via serde rename. Both frontend and backend normalize whitespace-only values to empty configuration so old or manually edited settings files cannot force a broken empty command.

## Runtime Behavior

`terminal_open` resolves the shell immediately before building the PTY command. Resolution order is:

1. Trimmed `app_settings.terminal_shell_path` when non-empty.
2. Existing platform default: `COMSPEC` or `cmd.exe` on Windows, `$SHELL` or `/bin/zsh` on non-Windows.

This keeps #445 configurable without changing #395-era fallback semantics for users who do not opt in.

## UI Placement

The control lives under Basic -> Behavior near streaming/proxy settings because it affects interactive app behavior rather than provider validation. The input is explicit text entry so users can paste Windows paths with spaces such as `C:\Program Files\PowerShell\7\pwsh.exe`.

## Error Handling

The settings layer does not validate executable existence. Spawn errors continue to be reported by the existing terminal open path as `Failed to spawn shell: ...`, which is the correct runtime boundary for missing or invalid executables.
