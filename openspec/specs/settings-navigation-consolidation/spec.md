# settings-navigation-consolidation Specification

## Purpose
TBD - created by archiving change consolidate-settings-basic-entry-tabs. Update Purpose after archive.
## Requirements
### Requirement: Basic Settings SHALL Host Shortcut And Open-App Tabs

系统 SHALL 在“基础设置”中承载 `快捷键`、`打开方式`、`Web 服务` 与 `邮件发送` 四个基础偏好配置 tab，并与现有 `外观`、`行为` tab 同级呈现。

#### Scenario: Basic settings shows six tabs
- **WHEN** 用户打开设置页并进入“基础设置”
- **THEN** 系统 MUST 显示 `外观`、`行为`、`快捷键`、`打开方式`、`Web 服务`、`邮件发送` 六个 tab
- **AND** 用户 MUST 能通过点击 tab 在六个基础设置面板之间切换

#### Scenario: Shortcut tab preserves shortcut editor behavior
- **WHEN** 用户切换到“基础设置 -> 快捷键”
- **THEN** 系统 MUST 展示原快捷键配置列表
- **AND** 用户 MUST 仍能录入、清空并查看默认快捷键
- **AND** 快捷键分组、平台化展示与默认值提示 MUST 与迁移前保持等价

#### Scenario: Open-app tab preserves app target editor behavior
- **WHEN** 用户切换到“基础设置 -> 打开方式”
- **THEN** 系统 MUST 展示原打开方式配置列表
- **AND** 用户 MUST 仍能新增、编辑、排序、删除打开方式
- **AND** 用户 MUST 仍能选择默认打开方式
- **AND** 保存语义 MUST 与迁移前保持等价

#### Scenario: Web service tab preserves service control behavior
- **WHEN** 用户切换到“基础设置 -> Web 服务”
- **THEN** 系统 MUST 展示原 Web 服务配置与状态内容
- **AND** 端口保存、服务启动/停止、daemon 启动/停止、RPC endpoint、地址与访问 token 展示行为 MUST 与迁移前保持等价

#### Scenario: Email tab preserves email sender behavior
- **WHEN** 用户切换到“基础设置 -> 邮件发送”
- **THEN** 系统 MUST 展示原邮件发送配置内容
- **AND** 启用开关、SMTP 表单、密钥保存/清除、测试发送、提示和错误展示行为 MUST 与迁移前保持等价

### Requirement: Project Management SHALL Host Group, Session, And Usage Tabs

系统 SHALL 将 `项目`、`会话管理` 与 `使用情况` 合并为一个左侧一级入口 `项目管理`，并通过 tab 切换项目分组、会话管理与使用情况能力。

#### Scenario: Project management shows group, session, and usage tabs
- **WHEN** 用户打开设置页并进入 `项目管理`
- **THEN** 系统 MUST 显示 `分组`、`会话管理` 与 `使用情况` 三个 tab
- **AND** 用户 MUST 能通过点击 tab 在项目分组、会话管理与使用情况面板之间切换

#### Scenario: Group tab preserves project management behavior
- **WHEN** 用户切换到 `项目管理 -> 分组`
- **THEN** 系统 MUST 展示原 `项目` section 的项目分组与 workspace 管理内容
- **AND** 创建、重命名、移动、删除分组与 workspace 分组分配行为 MUST 与迁移前保持等价

#### Scenario: Session tab preserves session management behavior
- **WHEN** 用户切换到 `项目管理 -> 会话管理`
- **THEN** 系统 MUST 展示原 `会话管理` section 的会话治理内容
- **AND** workspace 选择、会话列表、分页、筛选和会话变更回调行为 MUST 与迁移前保持等价

#### Scenario: Usage tab preserves usage behavior
- **WHEN** 用户切换到 `项目管理 -> 使用情况`
- **THEN** 系统 MUST 展示原 `使用情况` section 内容
- **AND** workspace 选择、统计卡片、日期范围、模型/会话/时间线 tab、分页和趋势展示行为 MUST 与迁移前保持等价

### Requirement: Agent Prompt Management SHALL Host Agent And Prompt Tabs

系统 SHALL 将 `智能体` 与 `提示词库` 合并为一个左侧一级入口，并通过 tab 切换智能体管理与提示词库能力。

#### Scenario: Agent prompt management shows agent and prompt tabs
- **WHEN** 用户打开设置页并进入合并后的智能体/提示词入口
- **THEN** 系统 MUST 显示 `智能体` 与 `提示词库` 两个 tab
- **AND** 用户 MUST 能通过点击 tab 在智能体管理与提示词库面板之间切换

#### Scenario: Agent tab preserves agent behavior
- **WHEN** 用户切换到 `智能体/提示词 -> 智能体`
- **THEN** 系统 MUST 展示原 `智能体` section 内容
- **AND** 智能体读取、创建、编辑、删除或刷新行为 MUST 与迁移前保持等价

#### Scenario: Prompt tab preserves prompt behavior
- **WHEN** 用户切换到 `智能体/提示词 -> 提示词库`
- **THEN** 系统 MUST 展示原 `提示词库` section 内容
- **AND** 提示词读取、创建、编辑、删除、移动与 workspace 选择行为 MUST 与迁移前保持等价

### Requirement: Runtime Environment SHALL Host Runtime Pool And CLI Validation Tabs

系统 SHALL 将 `Runtime 池` 与 `CLI 验证` 合并为一个左侧一级入口，并通过 tab 切换 Runtime 池管理与 CLI 验证能力。

#### Scenario: Runtime environment shows runtime and CLI tabs
- **WHEN** 用户打开设置页并进入合并后的运行环境入口
- **THEN** 系统 MUST 显示 `Runtime 池` 与 `CLI 验证` 两个 tab
- **AND** 用户 MUST 能通过点击 tab 在 Runtime 池与 CLI 验证面板之间切换

#### Scenario: Runtime pool tab preserves pool behavior
- **WHEN** 用户切换到 `运行环境 -> Runtime 池`
- **THEN** 系统 MUST 展示原 `Runtime 池` section 内容
- **AND** runtime snapshot、budget、retention、pin/close 等行为 MUST 与迁移前保持等价

#### Scenario: CLI validation tab preserves doctor behavior
- **WHEN** 用户切换到 `运行环境 -> CLI 验证`
- **THEN** 系统 MUST 展示原 `CLI 验证` section 内容
- **AND** Codex 与 Claude Code tab、path editor、doctor action、remote backend fields 和结果展示 MUST 与迁移前保持等价

### Requirement: MCP Skills Management SHALL Host MCP Server And Skills Tabs

系统 SHALL 将 `MCP 服务器` 与 `Skills` 收口为一个左侧一级入口 `MCP / Skills`，并在页内通过 tab 切换 MCP 状态面板与 Skills 浏览能力。

#### Scenario: MCP Skills management shows MCP and Skills tabs
- **WHEN** 用户打开设置页并进入 `MCP / Skills`
- **THEN** 系统 MUST 显示 `MCP 服务器` 与 `Skills` 两个 tab
- **AND** 用户 MUST 能通过点击 tab 在 MCP 状态面板与 Skills 浏览面板之间切换

#### Scenario: MCP tab preserves server inventory behavior
- **WHEN** 用户切换到 `MCP / Skills -> MCP 服务器`
- **THEN** 系统 MUST 展示原 `MCP 服务器` section 内容
- **AND** 引擎概览、配置来源、运行时服务、工具列表、刷新行为与迁移前保持等价

#### Scenario: Skills tab preserves browser behavior
- **WHEN** 用户切换到 `MCP / Skills -> Skills`
- **THEN** 系统 MUST 展示原 `Skills` section 内容
- **AND** 引擎切换、搜索、文件树、内容预览、Reveal 和编辑保存入口 MUST 与迁移前保持等价

### Requirement: Consolidated Parent Tabs SHALL Match Basic Settings Tab Treatment

系统 SHALL 让所有合并后的父入口 tab 复用“基础设置”页的 tab 视觉语言，并默认兼容自定义主题、深色主题和浅色主题。

#### Scenario: Consolidated tabs use the same visual treatment as basic settings
- **WHEN** 用户进入 `项目管理`、`智能体/提示词` 或 `运行环境`
- **THEN** tab 容器 MUST 与 `基础设置` tab 使用一致的圆角、边框、背景、hover、active 视觉规则
- **AND** tab MUST 使用主题变量或 scoped CSS variables，而不是写死只适用于浅色或深色的颜色

#### Scenario: Consolidated tabs show icons for every tab
- **WHEN** 用户浏览 `基础设置` 或任一合并后的父入口 tab
- **THEN** 每个 tab MUST 显示与 tab 语义匹配的 icon
- **AND** icon MUST 不改变 tab 的可访问名称

#### Scenario: Consolidated tabs fill available width
- **WHEN** tab 数量为 2 个、3 个、4 个或 6 个
- **THEN** tab 按可用宽度等分拉满 tab 容器
- **AND** tab 容器 MUST 不再被固定窄宽度限制截断

### Requirement: Settings Sidebar SHALL Remove Consolidated Entries

系统 SHALL 从设置页左侧一级菜单中移除已合并到父级 tab 的子入口，并显示对应父级入口。

#### Scenario: Sidebar omits basic child entries
- **WHEN** 用户浏览设置页左侧菜单
- **THEN** 菜单 MUST NOT 显示独立的 `快捷键` 入口
- **AND** 菜单 MUST NOT 显示独立的 `打开方式` 入口
- **AND** 菜单 MUST NOT 显示独立的 `Web 服务` 入口
- **AND** 菜单 MUST NOT 显示独立的 `邮件发送` 入口
- **AND** `基础设置` 入口 MUST 仍然可见

#### Scenario: Sidebar omits project child entries
- **WHEN** 用户浏览设置页左侧菜单
- **THEN** 菜单 MUST NOT 显示独立的 `项目` 入口
- **AND** 菜单 MUST NOT 显示独立的 `会话管理` 入口
- **AND** 菜单 MUST NOT 显示独立的 `使用情况` 入口
- **AND** 菜单 MUST 显示 `项目管理` 父级入口

#### Scenario: Sidebar omits agent prompt child entries
- **WHEN** 用户浏览设置页左侧菜单
- **THEN** 菜单 MUST NOT 显示独立的 `智能体` 入口
- **AND** 菜单 MUST NOT 显示独立的 `提示词库` 入口
- **AND** 菜单 MUST 显示合并后的智能体/提示词父级入口

#### Scenario: Sidebar omits runtime CLI child entries
- **WHEN** 用户浏览设置页左侧菜单
- **THEN** 菜单 MUST NOT 显示独立的 `Runtime 池` 入口
- **AND** 菜单 MUST NOT 显示独立的 `CLI 验证` 入口
- **AND** 菜单 MUST 显示合并后的运行环境父级入口

#### Scenario: Sidebar omits standalone Skills entry
- **WHEN** 合并后的子入口被移除为一级入口
- **THEN** 菜单 MUST NOT 显示独立的 `Skills` 入口
- **AND** 菜单 MUST 显示 `MCP / Skills` 父级入口

#### Scenario: Other sidebar entries remain stable
- **WHEN** 合并后的子入口被移除为一级入口
- **THEN** `供应商管理`、`权限设置`、`其他设置` 等未纳入本 change 的入口 MUST 按既有 feature flag 与可见性规则继续显示或隐藏

### Requirement: Legacy Child Section Inputs SHALL Be Removed After Migration

系统 SHALL 在迁移成功后删除已合并 child section 的旧入口契约，不保留旧 key 到父级 tab 的兼容 alias。

#### Scenario: Consolidated child section keys are no longer public settings inputs
- **WHEN** 实现完成设置入口收口
- **THEN** `shortcuts`、`open-apps`、`web-service`、`email`、`projects`、`session-management`、`usage`、`agents`、`prompts`、`runtime`、`codex`、`skills` MUST NOT 作为可打开的一级 Settings section 输入保留
- **AND** 类型定义、section registry、sidebar config 与 `initialSection` 解析逻辑 MUST NOT 暴露这些旧 child section key

#### Scenario: Existing callers are migrated before old keys are removed
- **WHEN** 旧 child section key 被删除
- **THEN** 仓库内调用方 MUST 已迁移到新的父级 section + tab 定位契约
- **AND** 代码中 MUST NOT 存在 `openSettings("shortcuts")`、`openSettings("open-apps")`、`openSettings("web-service")`、`openSettings("email")`、`openSettings("projects")`、`openSettings("session-management")`、`openSettings("usage")`、`openSettings("agents")`、`openSettings("prompts")`、`openSettings("runtime")`、`openSettings("codex")` 或 `openSettings("skills")` 调用

#### Scenario: Parent section tab targeting replaces child section deep links
- **WHEN** 代码需要打开已合并能力的设置面板
- **THEN** 系统 MUST 使用对应父级 section 与 tab 意图定位
- **AND** 快捷键 MUST 定位到 `基础设置 -> 快捷键`
- **AND** 打开方式 MUST 定位到 `基础设置 -> 打开方式`
- **AND** Web 服务 MUST 定位到 `基础设置 -> Web 服务`
- **AND** 邮件发送 MUST 定位到 `基础设置 -> 邮件发送`
- **AND** 项目分组 MUST 定位到 `项目管理 -> 分组`
- **AND** 会话管理 MUST 定位到 `项目管理 -> 会话管理`
- **AND** 使用情况 MUST 定位到 `项目管理 -> 使用情况`
- **AND** 智能体 MUST 定位到 `智能体/提示词 -> 智能体`
- **AND** 提示词库 MUST 定位到 `智能体/提示词 -> 提示词库`
- **AND** Skills MUST 定位到 `MCP / Skills -> Skills`
- **AND** Runtime 池 MUST 定位到 `运行环境 -> Runtime 池`
- **AND** CLI 验证 MUST 定位到 `运行环境 -> CLI 验证`

#### Scenario: Other section inputs remain unchanged
- **WHEN** 代码请求打开 `providers`、`mcp` 或其他剩余 section
- **THEN** 系统 MUST 按既有 section 定位逻辑打开对应设置页
- **AND** `mcp` MUST 打开 `MCP / Skills` 父级入口的默认 tab，而不是跳回已删除的独立 `skills` section
