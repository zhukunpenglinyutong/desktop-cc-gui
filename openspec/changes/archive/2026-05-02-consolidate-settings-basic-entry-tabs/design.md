## Context

设置页当前通过 `SettingsView` 的左侧菜单控制 `activeSection`，其中“基础设置”内部已经有 `basicSubTab`，但它只覆盖 `appearance` 与 `behavior`。多个功能相近的 section 仍作为左侧一级入口出现：`shortcuts/open-apps/web-service/email`、`projects/session-management/usage`、`agents/prompts`、`runtime/codex`。

用户目标是把这些功能相近的入口合并为父级管理页，并在父级页内用 tab 切换。这个变更是导航结构调整，不是配置能力重写；所以核心约束是复用现有 section 组件与 handler，避免改动内部业务逻辑、持久化或 backend command。

## Goals / Non-Goals

**Goals:**

- 扩展基础设置 tab：`appearance | behavior | shortcuts | open-apps | web-service | email`。
- 新增或调整项目管理 tab：`groups | sessions | usage`，承载 `ProjectsSection`、`SessionManagementSection` 与 `UsageSection`。
- 新增或调整智能体/提示词 tab：`agents | prompts`，承载 `AgentSettingsSection` 与 `PromptSection`。
- 新增或调整运行环境 tab：`runtime-pool | cli-validation`，承载 `RuntimePoolSection` 与 `CodexSection`。
- 新增或调整 `MCP / Skills` tab：`servers | skills`，承载 `McpSection` 与 `SkillsSection`。
- 左侧菜单移除被合并的子入口，只保留父级入口。
- 迁移所有旧 child section 调用方；`openSettings("shortcuts")`、`openSettings("open-apps")`、`openSettings("web-service")`、`openSettings("email")`、`openSettings("projects")`、`openSettings("session-management")`、`openSettings("usage")`、`openSettings("agents")`、`openSettings("prompts")`、`openSettings("runtime")`、`openSettings("codex")` 不再作为可支持入口保留。
- 现有 section 的业务逻辑和保存/诊断行为保持不变。
- 测试覆盖导航收口、tab 渲染、旧入口删除和关键交互可达性。

**Non-Goals:**

- 不调整 `其他设置` 等未被明确要求合并的入口。
- 不重构全部 SettingsView 状态。
- 不改变快捷键 matcher、AppSettings schema、open app target schema、runtime pool command、CLI doctor command、项目/会话管理 command。
- 不引入 router 或独立设置窗口。

## Decisions

### Decision 1: Add Parent-Level Tab State Instead Of Creating A Router

为每个父级 section 使用局部 tab state：

- `basicSubTab`: `appearance | behavior | shortcuts | open-apps | web-service | email`
- `projectManagementSubTab`: `groups | sessions | usage`
- `agentPromptSubTab`: `agents | prompts`
- `runtimeCliSubTab`: `runtime-pool | cli-validation`

这些 state 仍由 `SettingsView` 维护，避免引入新的 router 或全局状态。

Alternatives considered:

- Add a new nested router object: rejected because SettingsView 当前不是 router 驱动，容易引入重复 state。
- Keep old sections hidden and proxy-click into them: rejected because active state 会漂移，测试也更脆。

Rationale: 现有实现已经有基础 tab seam。扩展为多个父级 tab state 是最小、最可回滚的做法。

### Decision 2: Reuse Existing Section Components

被合并的 section component 不改业务逻辑，只允许对 outer wrapper 做必要适配。它们仍接收原 props，active 判断由父级 section 和 tab 控制。

Alternatives considered:

- Inline section 到父级 JSX: rejected because会让 `SettingsView.tsx` 继续膨胀。
- 拆成更细的 basic tab components: 可以作为后续重构，不放进本次入口调整。

Rationale: 用户要的是入口调整，不是内部重构。复用现有 component 能最大限度保证功能不变。

### Decision 3: Remove Legacy Child Section Keys After Caller Migration

`SettingsView` 的可打开 section contract 应只保留实际左侧父级入口。被合并的 child section key 不是长期兼容 alias；实现前必须先搜索并迁移内部调用方，再删除旧 key 类型、旧 `initialSection` 分支和旧映射逻辑。

新的定向打开应表达为父级 section + tab 意图，例如基础设置快捷键、基础设置 Web 服务、项目管理使用情况、运行环境 CLI 验证，而不是继续传入旧一级 section key。

Alternatives considered:

- 保留旧 section key 到父级 tab 的兼容映射: rejected because用户明确要求迁移成功后不保留旧入口，长期 alias 会让入口收口只停留在 UI 层。
- 只删除 sidebar entry、不迁移调用方: rejected because隐藏入口但保留代码入口会形成两套 navigation contract。

Rationale: 本变更的目标是入库并删除旧入口，而不是隐藏入口。迁移调用方后删除旧 key，能让 UI、类型和测试对齐到同一个 contract。

### Decision 4: Sidebar Entry Removal Should Be Data-Driven

左侧菜单应从 section list/render 层移除被合并的子入口，而不是用 CSS 隐藏。测试应断言菜单中没有这些一级入口，同时父级入口存在。

Alternatives considered:

- CSS display none: rejected because a11y tree 和 keyboard path 仍可能保留。
- Temporarily disable via feature flag only: possible，但本需求是明确移除入口，不只是临时隐藏。

### Decision 5: Keep `mcp` As The Parent Section Key And Remove Standalone `skills`

`MCP / Skills` 继续复用现有 `mcp` 父级 section key，新增 tab state `servers | skills`；同时删除独立 `skills` 一级 Settings section contract。需要打开 Skills 时，改为 `openSettings("mcp", "mcp-skills")` 这一类父级 section + tab 的定位表达。

`McpSection` 与 `SkillsSection` 保留原内部逻辑，但新增轻量 `embedded` 模式，只在被父级 tab 承载时隐藏各自标题区，避免页面出现双重主标题。

Alternatives considered:

- 新增一个全新的 `mcp-skills` section key：rejected，因为 `mcp` 已经是稳定父级入口，额外 key 只会增加 routing 表面积。
- 保留 `skills` 一级入口并同时在 `mcp` 里镜像一份：rejected，因为这会重新制造双入口和状态漂移。

## Risks / Trade-offs

- Risk: 遗漏旧 `openSettings("<child-section>")` 调用方 → Mitigation: 使用 `rg` 覆盖所有旧 key，并增加旧 key 不再出现在入口 contract / sidebar render 的测试或静态断言。
- Risk: tab 内复用 section 导致 nested `<section>` 样式边距变化 → Mitigation: 实现时保留现有 `settings-section` visual contract 或给 basic tab surface 明确 wrapper。
- Risk: 左侧菜单移除后用户找不到入口 → Mitigation: 父级入口文案必须清晰，并在 tab label 中保留原功能名。
- Risk: `SettingsView.tsx` 继续变大 → Mitigation: 本次只做入口调整；若需要内部减肥，单独拆 `BasicSettingsSection`。
- Risk: `McpSection` / `SkillsSection` 被嵌入后出现双重标题或额外空白 → Mitigation: 通过可选 `embedded` prop 仅隐藏标题区，不改动各自主体逻辑。

## Migration Plan

1. 扩展基础 tab 类型和 tab button 列表。
2. 新增项目管理、智能体/提示词、运行环境三个父级 tab state 和 tab button 列表。
3. 从 sidebar section render 中移除被合并的子入口，并添加父级入口。
4. 将被合并 section 的渲染位置移动到对应父级 tab content 内。
5. 搜索并迁移旧 child section 调用方到新的父级 section + tab 定位契约。
6. 将 `SkillsSection` 迁入 `mcp` 父级页的 `Skills` tab，并删除独立 `skills` sidebar/public contract。
7. 删除旧 child section key 类型、`initialSection` 分支和兼容映射。
8. 更新 SettingsView tests。
9. 运行 focused settings test、typecheck、large-file check。

Rollback strategy:

- 恢复 sidebar entries。
- 将被合并 section 的渲染分支移回原 `activeSection`。
- 恢复旧 child section key 类型和调用方。
- 移除新增 sub tab state 和枚举值。

## Open Questions

- 合并后的父级入口中文文案建议为 `项目管理`、`智能体/提示词`、`运行环境`；如果需要更短文案，可在实现前调整为 `项目`、`AI 资产`、`运行环境`。
