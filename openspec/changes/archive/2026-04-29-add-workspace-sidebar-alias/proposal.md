## Why

多个历史项目可能使用相同目录名，左侧 workspace 列表只显示目录 basename 时难以快速区分。用户需要一个轻量的展示别名，只帮助识别，不改变 workspace identity、路径或会话语义。

## 目标与边界

- 目标：允许用户为 workspace 设置一个可选 sidebar alias，并在左侧 workspace 标签优先展示该 alias。
- 边界：alias 只服务左侧 workspace 可视标签；底层 `workspace.name`、`workspace.path`、session 归属、runtime、排序和 workspace home 均保持现状。

## 非目标

- 不重命名项目目录或 backend `WorkspaceEntry.name`。
- 不改变 workspace 搜索、分组、排序、session 历史、runtime command payload。
- 不新增 Tauri command，不引入新依赖。

## What Changes

- `WorkspaceSettings` 增加可选 `projectAlias` 字段，复用现有 `updateWorkspaceSettings` 持久化。
- 左侧 workspace 右键菜单增加“设置别名”动作。
- `WorkspaceCard` 显示时优先使用 alias；alias 清空后回退原 `workspace.name`。
- 补充 sidebar 菜单与 workspace 卡片测试，验证 alias 展示和清空回退。

## 方案选项

| 选项 | 做法 | 取舍 |
|---|---|---|
| A. 修改 `workspace.name` | 把用户输入直接写进 workspace name | 实现直观，但会污染 identity 和所有依赖 name 的 surface，不符合边界 |
| B. `settings.projectAlias` + sidebar-only display | alias 作为可选 UI setting，只在 sidebar 渲染 | 推荐；最小持久化改动，不影响现有功能语义 |
| C. 独立 alias storage | 新建独立 client storage 或 backend command | 过度设计；会制造第二事实源 |

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `workspace-sidebar-visual-harmony`: sidebar workspace row MUST support an optional display alias without changing workspace identity or non-sidebar surfaces.

## Impact

- Frontend: `WorkspaceCard`、sidebar menu hook、相关 i18n 与测试。
- Shared types: TypeScript `WorkspaceSettings` 增加可选字段。
- Backend: Rust `WorkspaceSettings` 增加兼容旧 JSON 的可选字段。
- Storage: 继续使用既有 workspace settings JSON 写入路径；旧数据缺字段时保持默认 `None/null`。

## 验收标准

- 用户能从左侧 workspace 菜单设置 alias。
- 设置 alias 后左侧 workspace 标签显示 alias。
- 清空 alias 后左侧 workspace 标签回退原目录名。
- `workspace.name`、路径、排序、分组、session 与 workspace home 不因 alias 改变。
