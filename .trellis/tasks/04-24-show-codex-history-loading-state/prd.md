# Show Codex History Loading State

## Goal
避免用户首次打开 `Codex` 历史会话时先看到空白消息区，在历史恢复期间显示明确的 loading 状态。

## Requirements
- 仅针对打开 `Codex` 历史会话且消息区尚未恢复完成的场景显示 loading。
- loading 必须替换当前空白态，避免同时出现“空线程”文案。
- 不改变现有历史恢复逻辑和 runtime contract。
- 不影响 Claude、Gemini、OpenCode 以及已有实时处理中状态。

## Acceptance Criteria
- [x] 打开尚未恢复完成的 `Codex` 历史会话时，消息区显示全局 loading。
- [x] 历史恢复完成后，loading 自动消失并渲染实际消息。
- [x] 非 Codex 会话不会误显示该 loading。

## Technical Notes
- 使用前端 thread-local 状态追踪历史恢复中，不新增 Tauri command。
- 在 `Messages` 空态分支中渲染 loading，占位文案走 i18n。
