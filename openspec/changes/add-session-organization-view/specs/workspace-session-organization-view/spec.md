## ADDED Requirements

### Requirement: Session Organization View MUST Live Inside Session Management Section

系统 MUST 在 `设置 → 项目管理 → 会话管理` 现有 section 内提供一个独立的「会话整理视图」模式，MUST NOT 替换现有 catalog 视图，MUST NOT 修改 sidebar 行为。

#### Scenario: organization view entry sits inside session management section

- **WHEN** 用户进入 `设置 → 项目管理 → 会话管理`
- **THEN** 系统 MUST 在该 section 内提供一个明确的视图模式入口用于进入整理视图
- **AND** MUST NOT 在 sidebar 中新增 entry
- **AND** MUST NOT 在设置侧导航树中新增独立的整理视图一级入口

#### Scenario: organization view does not replace catalog view

- **WHEN** 用户在该 section 内切换视图模式
- **THEN** 现有 catalog 视图、批量 archive / unarchive / delete、关键词 / 引擎 / 状态过滤、分页 MUST 保持原有行为
- **AND** sidebar 默认展示窗口与会话切换行为 MUST 不受影响

#### Scenario: organization view scope is project mode only in v1

- **WHEN** 用户在 `global archive` 模式下查看该 section
- **THEN** 系统 MUST NOT 暴露整理视图入口
- **AND** 现有 `global archive` 视图行为 MUST 保持不变

### Requirement: Organization View MUST Use Two-Pane Layout With Unfiled Virtual Node

整理视图 MUST 使用双面板布局；左栏 MUST 在顶部固定一个虚拟节点「📥 未分类 (n)」，下方为真实专题树。

#### Scenario: left pane shows unfiled virtual node above folder tree

- **WHEN** 用户进入整理视图
- **THEN** 左栏顶部 MUST 固定一个虚拟节点「📥 未分类」并显示当前 workspace 下 `folderId == null` 的会话总数
- **AND** 该虚拟节点 MUST 出现在所有真实专题节点之上

#### Scenario: real folder tree supports nesting and selection

- **WHEN** 用户查看左栏真实专题树
- **THEN** 系统 MUST 渲染嵌套 folder 结构
- **AND** 用户 MUST 能展开 / 折叠节点并切换当前选中节点

#### Scenario: layout stays two-pane

- **WHEN** 用户在整理视图任意状态下查看布局
- **THEN** 系统 MUST 呈现「左栏树 + 右栏内容」的双面板结构
- **AND** MUST NOT 在视图内引入第三栏

### Requirement: Selecting Unfiled Virtual Node MUST Render Unfiled Sessions Only

选中左栏「📥 未分类」虚拟节点时，右栏 MUST 只渲染 `folderId == null` 的会话列表，MUST NOT 渲染子专题卡片区。

#### Scenario: unfiled selection renders unfiled session list

- **WHEN** 用户在左栏选中虚拟节点「📥 未分类」
- **THEN** 右栏 MUST 渲染当前 workspace 下 `folderId == null` 的会话列表
- **AND** MUST NOT 渲染子专题卡片区

#### Scenario: unfiled count stays consistent with rendered list

- **WHEN** 用户查看左栏虚拟节点上的计数 n
- **THEN** n MUST 等于右栏当前渲染的 unfiled 会话总数（不考虑分页时为完整 unfiled 总数）

### Requirement: Selecting Real Folder MUST Render Direct Sessions And Subfolder Cards

选中左栏真实专题节点时，右栏 MUST 同时渲染该专题直属会话列表与底部子专题卡片区；没有子专题时卡片区 MUST 不渲染。

#### Scenario: real folder selection renders direct sessions on top

- **WHEN** 用户在左栏选中真实专题
- **THEN** 右栏顶部 MUST 渲染 `folderId == 当前专题` 的直属会话列表
- **AND** MUST 沿用现有 catalog 视图的会话列表渲染能力

#### Scenario: subfolder card region appears when subfolders exist

- **WHEN** 当前选中专题存在至少一个子专题
- **THEN** 右栏底部 MUST 渲染子专题卡片区
- **AND** 每张卡片 MUST 至少包含子专题名称、直属会话数与最近更新时间

#### Scenario: subfolder card region collapses when there are no subfolders

- **WHEN** 当前选中专题没有子专题
- **THEN** 右栏 MUST NOT 渲染子专题卡片区

#### Scenario: card click switches left pane selection

- **WHEN** 用户点子专题卡片
- **THEN** 系统 MUST 把左栏选中切换为该子专题
- **AND** 右栏 MUST 跟随刷新为该子专题的直属会话列表与（若有）孙级专题卡片

#### Scenario: cards stay visually minimal

- **WHEN** 系统渲染子专题卡片
- **THEN** 卡片 MUST 仅包含名称、直属会话数与最近更新时间三类信息
- **AND** MUST NOT 包含会话预览、消息片段或其它额外内容

### Requirement: Session Row Interaction MUST Separate Selection From Detail Viewing

会话行内 MUST 把「选中」与「打开详情」拆分为两个独立 hit area；MUST NOT 引入双击交互。

#### Scenario: checkbox toggles selection only

- **WHEN** 用户点击会话行的复选框
- **THEN** 系统 MUST 仅切换该会话的选中状态
- **AND** MUST NOT 打开详情 modal

#### Scenario: title click opens detail modal only

- **WHEN** 用户点击会话标题
- **THEN** 系统 MUST 打开详情 modal 展示该会话完整 timeline
- **AND** MUST NOT 改变当前选中集合

#### Scenario: no double-click interaction

- **WHEN** 用户双击会话行任意位置
- **THEN** 系统 MUST NOT 把双击作为独立交互动作绑定
- **AND** 行为 MUST 与对应单击 hit area 一致或为 no-op

### Requirement: Session Detail Modal MUST Be Large Read-Only Timeline With Main-Window Open Action

会话详情 modal MUST 以主窗口 80–90% 的尺寸（非全屏）呈现完整 message timeline 的只读视图，并 MUST 提供「在主窗口打开此会话」按钮触发现有 thread switching。

#### Scenario: modal sized at 80 to 90 percent of main window

- **WHEN** 用户从整理视图打开会话详情 modal
- **THEN** modal MUST 以约 80%–90% 主窗口面积呈现
- **AND** MUST NOT 切换为全屏

#### Scenario: modal closes via X button or backdrop

- **WHEN** 用户点击右上角 × 或点击 modal 外的遮罩
- **THEN** 系统 MUST 关闭 modal
- **AND** 关闭 MUST NOT 影响整理视图当前的左栏选中或会话选中集合

#### Scenario: modal header exposes metadata

- **WHEN** modal 打开
- **THEN** 顶部 MUST 至少呈现 engine、updated、所属专题路径
- **AND** 若该会话存在 parent session，MUST 同时展示 parent session 信息

#### Scenario: modal body renders timeline read-only

- **WHEN** modal 主体渲染会话 message timeline
- **THEN** 系统 MUST 以只读形式展示完整 timeline
- **AND** MUST NOT 在 modal 内提供输入框、message 级操作或续聊能力

#### Scenario: open in main window button triggers thread switching

- **WHEN** 用户在 modal 内点击「在主窗口打开此会话」
- **THEN** 系统 MUST 触发现有 thread switching，把该会话切换到 sidebar / 主聊天区
- **AND** MUST NOT 引入新的 thread runtime 路径

### Requirement: Folder Assignment MUST Be Driven By Explicit Toolbar Menu Without Drag Or Context Menu

整理视图的会话归类入口 MUST 通过工具栏「移动到专题…」按钮 + folder picker 提供；v1 MUST NOT 引入拖拽与右键菜单。

#### Scenario: toolbar move button is the primary assignment entry

- **WHEN** 用户选中至少一条会话
- **THEN** 工具栏「移动到专题…」按钮 MUST 可用
- **AND** 点击该按钮 MUST 弹出 folder picker

#### Scenario: folder picker exposes target folders and unfile option

- **WHEN** 用户打开 folder picker
- **THEN** picker MUST 以树形选择器形式展示当前 workspace 内可选 folder
- **AND** MUST 同时提供「取消归类」选项映射为 `folderId = null`

#### Scenario: applying picker uses existing assignment command

- **WHEN** 用户在 picker 中选定目标并确认
- **THEN** 系统 MUST 调用现有 `assignWorkspaceSessionFolder` command 执行归类
- **AND** 成功后 MUST 失效相关数据并刷新右栏与左栏计数
- **AND** MUST NOT 引入新的 Tauri command 或修改现有契约

#### Scenario: drag and right-click are not introduced in v1

- **WHEN** 用户尝试拖拽会话行或在会话行 / folder 节点上右键
- **THEN** 系统 MUST NOT 在 v1 提供拖拽归类或右键菜单作为归类入口
- **AND** 现有 sidebar 与 catalog 视图的右键 / 拖拽行为 MUST 保持原状

### Requirement: Folder CRUD Operations MUST Surface From Left Pane Without Bypassing Non-Empty Delete Guard

左栏专题节点 MUST 提供新建子专题 / 重命名 / 删除入口；删除包含子专题或直属会话的专题 MUST 默认被拦截并向用户解释如何继续。

#### Scenario: create child folder from selected node

- **WHEN** 用户在左栏某个专题节点上触发「新建子专题」
- **THEN** 系统 MUST 调用现有 `createWorkspaceSessionFolder` 在该专题下创建子专题
- **AND** 新子专题 MUST 出现在左栏树中

#### Scenario: rename folder from left pane

- **WHEN** 用户在左栏某个专题节点上触发「重命名」
- **THEN** 系统 MUST 调用现有 `renameWorkspaceSessionFolder` 更新该专题名称
- **AND** MUST NOT 修改 folder id、child folders 或已分配 sessions

#### Scenario: delete empty folder succeeds

- **WHEN** 用户删除一个没有子专题且没有直属会话的专题
- **THEN** 系统 MUST 调用现有 `deleteWorkspaceSessionFolder` 删除该专题
- **AND** 左栏树 MUST 移除该节点

#### Scenario: delete non-empty folder is blocked by default

- **WHEN** 用户尝试删除一个包含子专题或直属会话的专题
- **THEN** 系统 MUST 默认拦截该操作
- **AND** MUST 提示用户先清空 / 解除归类
- **AND** MUST NOT 静默递归删除或自动解除归类

### Requirement: Organization Surface MUST Open As A Dedicated Modal From Session Management Section

整理视图 MUST 以独立 modal 的形式从 `SessionManagementSection` 弹出，MUST NOT 内嵌入 section 主体；catalog 视图永远是 section 的默认主体。

#### Scenario: section exposes a single button entry for the organizer

- **WHEN** 用户进入 `设置 → 项目管理 → 会话管理` 且 `mode === "project"` 并选中一个 workspace
- **THEN** section 工具栏 MUST 提供一颗「会话整理」按钮
- **AND** MUST NOT 在 section 主体内嵌入双面板视图、整理视图 toggle 或独立移动到专题按钮

#### Scenario: clicking the entry button opens a full-canvas modal

- **WHEN** 用户点击「会话整理」按钮
- **THEN** 系统 MUST 弹出一个 modal，尺寸约为 `min(1280px, 92vw) × min(820px, 88vh)`
- **AND** modal 头部 MUST 至少呈现当前 workspace label
- **AND** modal 主体 MUST 渲染双面板（左栏树 + 右栏直属会话 / 子专题卡片）
- **AND** modal 底部 MUST 呈现批量操作 toolbar（至少包含选中数、全选、清空选择、移动到专题、归档、取消归档、删除二次确认）

#### Scenario: modal closes via X / backdrop / Escape

- **WHEN** 用户点击右上角 × / 点击 modal 外的遮罩 / 按 Esc
- **THEN** 系统 MUST 关闭 modal，回到 catalog 默认视图
- **AND** 关闭前 MUST 重置当前选中集合，避免残留状态污染 catalog 的批量工具栏
- **AND** 若有正在进行的 mutation（归档 / 移动等），系统 MAY 暂时禁用关闭直至 mutation 结束

#### Scenario: workspace picker stays outside the modal in v1

- **WHEN** 用户打开整理 modal
- **THEN** 系统 MUST 把 modal 绑定到打开时所在的 workspace
- **AND** MUST NOT 在 modal 内暴露 workspace 切换器；切换 workspace 需关闭 modal 后由 section 的 workspace picker 处理

### Requirement: Organization View MUST Consume Existing Tauri Bridge Without New Contracts

整理视图 MUST 完全消费现有 `src/services/tauri/sessionManagement.ts` bridge；v1 MUST NOT 新增 Tauri command、MUST NOT 修改 folder / assignment 契约。

#### Scenario: view reuses existing list and mutation commands

- **WHEN** 整理视图执行任意读 / 写操作
- **THEN** 系统 MUST 通过 `listWorkspaceSessionFolders`、`listWorkspaceSessions`、`createWorkspaceSessionFolder`、`renameWorkspaceSessionFolder`、`deleteWorkspaceSessionFolder`、`assignWorkspaceSessionFolder` 等现有 command 完成
- **AND** MUST NOT 引入新的 Tauri command 或 backend 端点

#### Scenario: no schema or contract change

- **WHEN** 整理视图被引入
- **THEN** `WorkspaceSessionCatalogEntry`、folder metadata、assignment metadata 的现有 schema MUST 保持不变
- **AND** 现有 `workspace-session-management` 与 `workspace-session-folder-tree` capability 的对外行为契约 MUST 保持不变
