## Why

设置页左侧导航已经开始承载过多同层级配置入口，导致用户需要在左侧菜单里寻找细碎配置。把相关入口收口为父级管理页，并在父级页内使用 tab 切换，可以减少左侧菜单噪声，同时保持原功能可达。

## 目标与边界

### 目标

- 在“设置 -> 基础设置”内新增四个 tab：`快捷键`、`打开方式`、`Web 服务`、`邮件发送`。
- 保留现有 `外观`、`行为` tab，并让基础设置形成 `外观 / 行为 / 快捷键 / 打开方式 / Web 服务 / 邮件发送` 的同层 tab 结构。
- 从设置页左侧菜单移除独立的 `快捷键`、`打开方式`、`Web 服务` 与 `邮件发送` 入口。
- 迁移完成后不保留旧入口兼容：`shortcuts`、`open-apps`、`web-service`、`email` 等被合并的 child section key 不再作为可支持的设置入口。
- 保持快捷键配置、平台化显示、清空、录入、默认值提示、打开方式列表编辑、默认应用选择、排序、删除、保存语义不变。
- 将 `项目`、`会话管理` 与 `使用情况` 合并为左侧一级入口 `项目管理`，内部使用 `分组`、`会话管理` 与 `使用情况` tab 切换。
- 将 `智能体` 与 `提示词库` 合并为左侧一级入口，内部使用 `智能体` 与 `提示词库` tab 切换。
- 将 `Runtime 池` 与 `CLI 验证` 合并为左侧一级入口，内部使用 `Runtime 池` 与 `CLI 验证` tab 切换。
- 将 `MCP 服务器` 与 `Skills` 合并为左侧一级入口，内部使用 `MCP 服务器` 与 `Skills` tab 切换。
- 所有旧 child section 调用方必须迁移到新的父级 section + tab 定位契约；迁移验证成功后，直接删除旧入口和旧 key 支持，不保留 alias。

### 边界

- 本变更只调整设置页导航结构与承载位置。
- 本变更允许移动组件、调整 `SettingsView` section routing、更新 i18n 文案和测试。
- 本变更不新增 AppSettings 字段，不新增 Tauri command，不修改现有持久化 schema。
- 本变更不改变已有快捷键默认值、快捷键匹配逻辑、打开方式执行逻辑或外部 App icon 解析逻辑。
- 本变更不改变项目分组、会话管理、智能体、提示词库、Runtime 池、CLI 验证各自内部功能和保存/诊断逻辑。

## 非目标

- 不重设计整个设置页视觉体系。
- 不把设置页改成独立窗口或 URL/router 驱动。
- 不在本变更中拆分所有设置 section 大文件。
- 不调整 `其他设置` 等未被明确要求合并的入口。
- 不调整侧边栏入口排序以外的设置项业务含义。

## What Changes

- “基础设置”现有 tab 从 `外观 / 行为` 扩展为 `外观 / 行为 / 快捷键 / 打开方式 / Web 服务 / 邮件发送`。
- `ShortcutsSection` 从左侧一级 section 迁入基础设置的 `快捷键` tab。
- `OpenAppsSection` 从左侧一级 section 迁入基础设置的 `打开方式` tab。
- `WebServiceSettings` 从左侧一级 section 迁入基础设置的 `Web 服务` tab。
- `EmailSenderSettings` 从左侧一级 section 迁入基础设置的 `邮件发送` tab。
- 设置左侧导航不再渲染独立 `快捷键`、`打开方式`、`Web 服务` 与 `邮件发送` 菜单项。
- 迁移并删除 `initialSection="shortcuts"`、`initialSection="open-apps"`、`initialSection="web-service"`、`initialSection="email"` 等旧 child section 输入；最终 contract 只暴露父级 section 与对应 tab。
- 新增或调整 `项目管理` 父级 section：
  - `ProjectsSection` 迁入 `项目管理 -> 分组` tab。
  - `SessionManagementSection` 迁入 `项目管理 -> 会话管理` tab。
  - `UsageSection` 迁入 `项目管理 -> 使用情况` tab。
  - 左侧不再渲染独立 `项目`、`会话管理` 与 `使用情况` 入口。
- 新增或调整 `智能体/提示词` 父级 section：
  - `AgentSettingsSection` 迁入 `智能体/提示词 -> 智能体` tab。
  - `PromptSection` 迁入 `智能体/提示词 -> 提示词库` tab。
  - 左侧不再渲染独立 `智能体` 与 `提示词库` 入口。
- 新增或调整 `运行环境` 父级 section：
  - `RuntimePoolSection` 迁入 `运行环境 -> Runtime 池` tab。
  - `CodexSection` 迁入 `运行环境 -> CLI 验证` tab。
  - 左侧不再渲染独立 `Runtime 池` 与 `CLI 验证` 入口。
- 新增或调整 `MCP / Skills` 父级 section：
  - `McpSection` 保留在 `MCP / Skills -> MCP 服务器` tab。
  - `SkillsSection` 迁入 `MCP / Skills -> Skills` tab。
  - 左侧不再渲染独立 `Skills` 入口。
- 现有测试需要覆盖：
  - 左侧菜单不显示 `快捷键`、`打开方式`、`Web 服务`、`邮件发送` 与 `使用情况`。
  - 基础设置显示新增四个 tab。
  - 左侧菜单显示合并后的父级入口，并不再显示被合并的子入口。
  - 点击基础设置内新增 tab 后，原 section 内容仍可操作。
  - 点击新增父级入口内 tab 后，原 section 内容仍可操作。
  - `MCP / Skills` 页面能在 `MCP 服务器` 与 `Skills` tab 之间切换，且 `Skills` 不再是独立 sidebar entry。
  - 代码中不再存在被合并 child section 的旧入口调用或兼容映射。

## 技术方案对比与取舍

| Option | Description | Benefits | Risks / Costs | Decision |
|---|---|---|---|---|
| A | 只隐藏左侧菜单，仍保留原 section render 分支 | 改动最小 | UI 看似收口，但代码仍是两套入口；deep link 与 active state 容易漂移 | Reject |
| B | 将相关 section 组件迁入父级 tab，迁移所有旧调用方后删除旧 section key 支持 | 最终 contract 干净，避免长期 alias 漂移；左侧入口与代码入口一致 | 需要一次性完成调用方迁移，并用 `rg`/测试证明无旧入口残留 | Adopt |
| C | 一次性重构设置页为 settings router + overview + nested tabs | 长期结构更干净 | 范围过大，容易和当前入口调整混成大重构 | Reject for this change |

## Capabilities

### New Capabilities

- `settings-navigation-consolidation`: 定义设置页左侧入口收口到父级 tab 的行为契约，包括基础设置、项目管理、智能体/提示词、运行环境四组合并，以及迁移成功后删除旧 child section 入口。

### Modified Capabilities

- `app-shortcuts`: 快捷键配置仍必须完整可编辑，但设置入口从独立左侧 `快捷键` section 调整为 `基础设置 -> 快捷键` tab。
- `workspace-session-management`: 会话管理仍必须完整可用，但设置入口从独立左侧 `会话管理` section 调整为 `项目管理 -> 会话管理` tab。
- `runtime-pool-console`: Runtime 池仍必须完整可用，但设置入口从独立左侧 `Runtime 池` section 调整为 `运行环境 -> Runtime 池` tab。
- `claude-cli-settings-doctor`: CLI 验证仍必须完整可用，但设置入口从独立左侧 `CLI 验证` section 调整为 `运行环境 -> CLI 验证` tab。
- `settings-navigation-consolidation`: 扩展包含 `MCP / Skills` 父级入口，其中 `Skills` 不再作为独立左侧一级入口暴露。

## Impact

- Frontend:
  - `src/features/settings/components/SettingsView.tsx`
  - `src/features/settings/components/SettingsView.test.tsx`
  - `src/features/settings/components/settings-view/sections/ShortcutsSection.tsx`
  - `src/features/settings/components/settings-view/sections/OpenAppsSection.tsx`
  - `src/features/settings/components/settings-view/sections/ProjectsSection.tsx`
  - `src/features/settings/components/settings-view/sections/SessionManagementSection.tsx`
  - `src/features/settings/components/AgentSettingsSection.tsx`
  - `src/features/settings/components/PromptSection/index.tsx`
  - `src/features/settings/components/settings-view/sections/RuntimePoolSection.tsx`
  - `src/features/settings/components/settings-view/sections/CodexSection.tsx`
  - `src/features/settings/components/UsageSection.tsx`
  - `src/features/settings/components/McpSection.tsx`
  - `src/features/settings/components/SkillsSection.tsx`
  - `src/features/settings/components/settings-view/sections/WebServiceSettings.tsx`
  - `src/features/settings/components/settings-view/sections/EmailSenderSettings.tsx`
  - `src/features/app/hooks/useSettingsModalState.ts`
  - `src/features/settings/components/settings-view/settingsViewAppearance.ts`
  - `src/features/settings/components/settings-view/settingsViewConstants.ts`
  - `src/i18n/locales/*`
- Behavior:
  - 设置页左侧菜单项减少。
  - 多个父级 section 增加 tab。
  - 被合并 child section 的旧定向入口需要完成迁移并移除，不保留兼容 alias。
- Backend / storage:
  - 无 backend command 变更。
  - 无持久化 schema 变更。
  - 无新依赖。

## 验收标准

- 打开设置页后，左侧菜单不再出现独立 `快捷键` 与 `打开方式`。
- 进入“基础设置”后，可以看到并切换 `外观`、`行为`、`快捷键`、`打开方式`、`Web 服务`、`邮件发送` 六个 tab。
- 打开设置页后，左侧菜单显示 `项目管理`，不再出现独立 `项目`、`会话管理` 与 `使用情况`。
- 进入“项目管理”后，可以在 `分组`、`会话管理` 与 `使用情况` tab 之间切换。
- 打开设置页后，左侧菜单显示合并后的 `智能体/提示词` 入口，不再出现独立 `智能体` 与 `提示词库`。
- 进入该入口后，可以在 `智能体` 与 `提示词库` tab 之间切换。
- 打开设置页后，左侧菜单显示合并后的 `运行环境` 入口，不再出现独立 `Runtime 池` 与 `CLI 验证`。
- 进入该入口后，可以在 `Runtime 池` 与 `CLI 验证` tab 之间切换。
- 打开设置页后，左侧菜单显示 `MCP / Skills` 入口，不再出现独立 `Skills`。
- 进入该入口后，可以在 `MCP 服务器` 与 `Skills` tab 之间切换。
- `基础设置 -> 快捷键` 中所有快捷键配置项、默认值展示、清空和录入行为与迁移前一致。
- `基础设置 -> 打开方式` 中应用列表、默认项、排序、删除、新增、保存行为与迁移前一致。
- `基础设置 -> Web 服务` 中端口、运行状态、daemon 控制、RPC endpoint、地址与 token 展示行为与迁移前一致。
- `基础设置 -> 邮件发送` 中启用、SMTP 表单、密钥保存/清除、测试发送与错误展示行为与迁移前一致。
- `项目管理 -> 使用情况` 中 workspace 选择、统计、筛选、趋势与列表行为与迁移前一致。
- `MCP / Skills -> MCP 服务器` 中引擎概览、运行时清单、规则说明与刷新行为与迁移前一致。
- `MCP / Skills -> Skills` 中引擎切换、搜索、文件树、内容预览与编辑入口与迁移前一致。
- 代码中不再存在 `openSettings("shortcuts")`、`openSettings("open-apps")`、`openSettings("web-service")`、`openSettings("email")`、`openSettings("projects")`、`openSettings("session-management")`、`openSettings("usage")`、`openSettings("agents")`、`openSettings("prompts")`、`openSettings("runtime")`、`openSettings("codex")` 等旧 child section 定向调用。
- `SettingsView` 的 public section contract 不再把 `shortcuts`、`open-apps`、`web-service`、`email`、`projects`、`session-management`、`usage`、`agents`、`prompts`、`runtime`、`codex`、`skills` 作为可打开的一级 section。
- `openSettings("basic")` 默认仍进入基础设置的 `外观` 或当前既有默认 tab，不因本变更跳到新 tab。
- `openSettings("providers")` 等其他现有定向入口不受影响。
- `npm exec vitest run src/features/settings/components/SettingsView.test.tsx` 通过。
- `npm run typecheck` 通过。
- 若 touched file 继续接近大文件阈值，必须运行 `npm run check:large-files` 或记录不运行原因。
