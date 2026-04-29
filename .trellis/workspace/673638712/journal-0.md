# Journal - 673638712 (Part 0)

> AI development session journal
> Started: 2026-04-29

---



## Session 1: 修复非自定义主题预设污染

**Date**: 2026-04-29
**Task**: 修复非自定义主题预设污染
**Branch**: `feat/settings-custom-theme-presets-clean`

### Summary

修复 PR #448 自定义主题配色引入的回归：未选择“自定义”主题时，系统原有 `dark` / `light` / `system` / `dim` 主题不再被 VS Code preset token 覆盖。

### Main Changes

任务目标：修复 PR #448 自定义主题引入的回归，确保未选择“自定义”时保留原有系统深色/浅色主题逻辑。

主要改动：
- 非 `custom` 主题模式下不再应用 VS Code preset 映射出的全局 CSS token。
- 切出 `custom` 模式时清理此前写入的 preset inline CSS variables 与 `data-theme-preset` 标记。
- 增加 custom preset token 生效条件的回归测试。
- 修复样式守卫测试在 Windows CRLF 工作区下的 CSS 读取稳定性。

涉及模块：
- frontend theme preference
- theme preset utils
- style guard tests

验证结果：
- `npx vitest run src/features/theme/utils/themePreset.test.ts` 通过。
- `npx vitest run src/styles/layout-swapped-platform-guard.test.ts` 通过。
- `npm run lint` 通过。
- `npm run typecheck` 通过。
- `npm run test` 通过，369 个测试文件完成。

后续事项：
- 无。

### Git Commits

| Hash | Message |
|------|---------|
| `102671987c94011fc55b9f71fc3ff09c79571cf7` | fix(theme): 避免非自定义主题套用预设色 |

### Testing

- [OK] Theme preset unit test passed
- [OK] Style guard test passed
- [OK] lint / typecheck / full test passed

### Status

[OK] **Completed**

### Next Steps

- None - task complete
