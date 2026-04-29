## Context

当前 workspace 的显示名来自 backend 按路径 basename 派生的 `WorkspaceEntry.name`，sidebar、settings、workspace home 等多个 surface 直接或间接消费它。Issue #442 的痛点只发生在左侧 workspace 列表：同名目录难区分。

本变更需要跨 TypeScript/Rust `WorkspaceSettings` schema，但不需要新增 command 或新的存储写入路径。现有 `updateWorkspaceSettings` 已经负责 workspace settings 的持久化，并复用 workspace JSON 的 lock + atomic write 机制。

## Goals / Non-Goals

**Goals:**

- 为 workspace 增加一个可选 `projectAlias` setting。
- 左侧 workspace row 优先显示 alias，alias 为空时回退 `workspace.name`。
- 通过左侧 workspace 菜单提供设置/清空 alias 的最小入口。
- 保持旧数据兼容：缺少 `projectAlias` 字段时等价于未设置 alias。

**Non-Goals:**

- 不修改 `WorkspaceEntry.name` 或路径派生规则。
- 不改变排序、搜索、workspace home、settings project list、session attribution 或 runtime 行为。
- 不新增 backend command、client storage key 或外部依赖。

## Decisions

### Decision 1: Alias 存在 `WorkspaceSettings.projectAlias`

选择 `WorkspaceSettings` 而不是 `WorkspaceEntry.name` 或独立 client storage。

- 相比修改 `workspace.name`：不会污染 workspace identity 和所有非 sidebar surface。
- 相比独立 storage：复用现有 `updateWorkspaceSettings`，避免第二事实源。
- 兼容性：Rust 字段使用 `#[serde(default, rename = "projectAlias")] Option<String>`，旧 JSON 自动得到 `None`。

### Decision 2: 仅在 sidebar render path 派生 display label

新增 feature-local pure helper，例如 `getWorkspaceSidebarLabel(workspace)`，只由 sidebar/card/menu 测试路径使用。

- sidebar row 显示 alias。
- 右键菜单、settings 项目列表、workspace home 继续使用原 `workspace.name`。
- 搜索暂不匹配 alias，符合“只展示，不改变老功能”的边界。

### Decision 3: 右键菜单使用 prompt 式轻量编辑

在 workspace actions group 增加“设置别名”，使用浏览器/宿主 prompt 获取文本，提交时通过现有 `onUpdateWorkspaceSettings(workspace.id, { projectAlias })` 更新。

- 清空输入保存为 `null`。
- 取消 prompt 不做任何写入。
- 无需新增 modal 或复杂表单。

## Risks / Trade-offs

- [Risk] prompt 交互不如专用 modal 精致 → Mitigation: 本需求是窄范围 sidebar display label，优先低复杂度；后续若要批量管理 alias 再升级 settings 表单。
- [Risk] alias 与原名混淆 → Mitigation: 只替换 sidebar 可视标签，不影响 path tooltip、workspace home 或 settings 列表。
- [Risk] 新字段被误用于非 sidebar surface → Mitigation: helper 命名明确为 `getWorkspaceSidebarLabel`，测试覆盖 non-alias fallback。

## Migration Plan

1. Rust/TypeScript `WorkspaceSettings` 增加可选 `projectAlias`。
2. sidebar 菜单注入 `onRenameWorkspaceAlias` handler。
3. sidebar workspace row 使用 helper 派生显示标签。
4. 补 i18n 与单元测试。

Rollback：删除菜单入口、helper 使用点和 `projectAlias` 字段。已写入的旧 JSON 字段可被后续版本忽略，不影响读取。

## Open Questions

- None. 本变更按 sidebar-only 范围执行。
