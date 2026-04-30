## ADDED Requirements

### Requirement: Built-In Terminal MUST Support Optional Shell Path Override

系统 MUST allow users to configure an optional executable path used when opening the built-in terminal. The override MUST be app-level and MUST NOT require changing workspace settings.

#### Scenario: configured shell path is used for new terminals

- **WHEN** `terminalShellPath` is a non-empty value after trimming
- **AND** the user opens a built-in terminal
- **THEN** the backend MUST spawn the PTY command with that trimmed shell path
- **AND** the configured path MUST be allowed to contain spaces

#### Scenario: blank shell path preserves platform fallback

- **WHEN** `terminalShellPath` is missing, null, or blank after trimming
- **AND** the user opens a built-in terminal
- **THEN** the backend MUST use the existing platform fallback
- **AND** Windows MUST continue to prefer `COMSPEC` before `cmd.exe`
- **AND** non-Windows platforms MUST continue to prefer `SHELL` before `/bin/zsh`

#### Scenario: settings UI persists trimmed shell path

- **WHEN** the user enters a terminal shell path with leading or trailing whitespace and saves
- **THEN** app settings MUST persist the trimmed path
- **AND** clearing the input MUST persist an empty override rather than an empty executable command
