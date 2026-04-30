# Add Configurable Terminal Shell Path

## Goal

让用户可以在 Settings 中配置内置 terminal 使用的 shell executable path，例如 Windows 上的 PowerShell 7，同时未配置时保持现有 `COMSPEC` / `$SHELL` fallback。

## Linked OpenSpec

- `openspec/changes/add-configurable-terminal-shell`

## Requirements

- 新增 app-level `terminalShellPath` 设置字段，并兼容旧 settings 文件。
- Settings -> Basic -> Behavior 提供路径输入、保存和清空操作。
- 保存时 trim 首尾空白；空白值保存为 `null` / `None`。
- `terminal_open` 启动新 PTY 时优先使用配置路径。
- 未配置时保持 Windows `COMSPEC` -> `cmd.exe`、非 Windows `SHELL` -> `/bin/zsh` 的既有行为。
- 不新增 terminal command，不改变 workspace-level settings。

## Acceptance Criteria

- [x] 配置 `C:\Program Files\PowerShell\7\pwsh.exe` 后，新 terminal 使用该路径启动。
- [x] 清空配置后，新 terminal 回到平台默认 fallback。
- [x] 前端 hook、Settings UI、Rust resolver/settings core 均有 focused tests。
- [x] PR 发布前完成 typecheck、lint、Cargo focused tests 与 diff check。

## Technical Notes

- Frontend schema: `src/types.ts` `AppSettings.terminalShellPath`.
- Rust schema: `src-tauri/src/types.rs` `terminal_shell_path` with serde rename.
- Runtime resolver stays inside `src-tauri/src/terminal.rs` to keep spawn behavior local.
- Settings normalization lives in both `useAppSettings` and `shared/settings_core` to handle UI and manually edited persisted files.
