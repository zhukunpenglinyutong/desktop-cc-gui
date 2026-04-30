## Why

Windows 内置 terminal 当前始终通过 `COMSPEC` 回退到 `cmd.exe`，用户无法选择 PowerShell 7、Git Bash 或其他 shell。GitHub issues #445/#395 明确要求在 Settings 中提供 “terminal shell path” 配置，同时未配置时保持现有默认行为。

## What Changes

- 在 app settings schema 中新增 `terminalShellPath`，前端与 Rust 均将空白值规范化为 `null` / `None`。
- 在 Settings -> Basic -> Behavior 增加 terminal shell path 输入、保存和清空操作。
- `terminal_open` 启动 PTY 前优先读取 settings 中的 shell path；未配置时继续使用 Windows `COMSPEC` 或非 Windows `$SHELL` fallback。
- 补充 focused tests 覆盖 settings normalization、UI 保存行为和 Rust shell path resolver。

## Non-Goals

- 不改变现有默认 shell 选择逻辑。
- 不验证 shell executable 是否存在，避免阻塞 portable / staged path 配置。
- 不新增 Tauri command；复用现有 `get_app_settings` / `update_app_settings` contract。

## Impact

- Frontend: `src/types.ts`, `src/features/settings/**`, `src/i18n/locales/**`, `src/test/vitest.setup.ts`
- Backend: `src-tauri/src/types.rs`, `src-tauri/src/shared/settings_core.rs`, `src-tauri/src/terminal.rs`
- Tests: focused Vitest and Cargo unit tests.
