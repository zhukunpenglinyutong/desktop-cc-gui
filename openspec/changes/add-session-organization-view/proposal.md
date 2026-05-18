## Why

ccgui 现有的 `设置 → 项目管理 → 会话管理` 页面是一个 catalog 表格，擅长「找一条会话」和「批量 archive / delete」。但对于把 ccgui 当作长期写作 / 研究 / 知识整理工作台的用户来说，缺乏一个能稳定承担「按专题组织数百条历史会话」职责的视图。Sidebar 因为列宽紧张只能承担快速切换职责，无法承担整理与浏览职责。

后端已经具备所需全部能力（`folderId` 字段、`createWorkspaceSessionFolder` / `assignWorkspaceSessionFolder` 等 Tauri commands、`WorkspaceSessionCatalogEntry.folderId`、`WorkspaceSessionFolderTree`），真正缺的是一个 product 化的整理 UX surface。

本提案在 `SessionManagementSection` 内**新增一颗「会话整理」按钮**，点击后**以独立 modal 形式弹出双面板整理视图**（不替换 catalog 视图、不动 sidebar），把后端已具备的 folder 与 session catalog 能力收口成一个适合长期使用的「会话整理视图」。

> **2026-05-17 修订**：初版方案是「在 section 主体内嵌双面板视图（catalog / organize toggle）」。实测后发现 section 顶部 chrome（mode 切换 / workspace picker / 引擎 + 状态过滤 / thread 数量调节 / 批量工具栏）会把整理视图夹得过窄，CSS 缺失时还会退化成纵向堆叠，视觉上「和目录视图没有任何区别」。改为 modal 化弹出后，整理视图拥有完整专属画布且与 catalog 视图职责清晰隔离。详见 `design.md` Decision 8。

## 目标与边界

### 目标

- 在现有 `设置 → 项目管理 → 会话管理` 页面内提供一个新视图模式，支持按专题（folder）组织 workspace 内的真实会话历史。
- 双面板布局：左栏专题树（含一个固定虚拟节点「📥 未分类」），右栏展示当前选中节点内容。
- 用户能在不离开整理视图的情况下，通过大 modal 查看任意会话完整 message timeline。
- 用户能在整理视图内完成专题 CRUD（新建子专题 / 重命名 / 删除）与会话归类（移动到专题 / 取消归类）。
- 后端零新增 contract；完全复用 `src/services/tauri/sessionManagement.ts` 现有 bridge。
- 不影响现有 catalog 视图与 sidebar 行为。

### 边界

- v1 只覆盖 **project 模式**，不动 `global archive` 视图。
- v1 不引入拖拽、不引入右键菜单（folder/session 操作只通过显式按钮 + picker 弹层）。
- v1 不引入 sidebar 反向联动（sidebar 仍按现有规则展示线程，不感知 organization view 的选中态）。
- v1 不引入会话分支关系图、思维导图、自由画布等可视化形态。
- v1 不引入 modal 内 inline 编辑或续聊；modal 只读，提供「在主窗口打开此会话」跳转。
- v1 不引入自动智能分类。

## 非目标

- 不重做 sidebar 的会话展示。
- 不替换或下线现有 `SessionManagementSection` 的 catalog 视图。
- 不修改后端 `assignWorkspaceSessionFolder` / `createWorkspaceSessionFolder` 等 command 的契约或语义。
- 不引入新的 persisted schema（folder 与 assignment metadata 已经存在）。
- 不扩展到 Claude / Codex / Gemini 之外的引擎。

## What Changes

- 在 `SessionManagementSection` 工具栏新增一颗「会话整理」按钮（`mode === "project"` 且选中 workspace 后可用），点击 = 弹出独立 modal；section 主体保持 catalog 视图为唯一默认呈现，**不再有 catalog/organization toggle**。
- 整理 modal 尺寸约 `min(1280px, 92vw) × min(820px, 88vh)`，关闭支持 × / 遮罩 / Esc（mutation 进行中可临时禁用关闭）。
- modal 主体采用双面板布局：
  - 左栏：固定虚拟节点「📥 未分类 (n)」+ 真实专题树。
  - 右栏：选中虚拟节点时显示 unfiled 会话列表；选中真实专题时显示该专题直属会话 + 底部子专题卡片区。
- 子专题卡片采用极简三行设计：名称 / 直属会话数 / 最近更新时间；点卡片 = 左栏选中切换。
- 会话行交互严格分离两个语义动作：复选框承担「选中」（沿用现有批量操作），点会话标题承担「打开详情 modal」。
- 详情 Modal（嵌套于整理 modal 之上）：尺寸约为主窗口 80–90%（非全屏），顶部 metadata，主体只读 message timeline，显眼「在主窗口打开此会话」按钮触发现有 thread switching。
- modal 底部一行 toolbar 承载批量操作（选中数 / 全选 / 清空 / 移动到专题 / 归档 / 取消归档 / 删除二次确认）；移动到专题入口仅在 modal 内出现。
- 左栏专题节点提供新建子专题 / 重命名 / 删除入口；删除非空专题默认拦截并提示用户先清空或解除归类。

## Capabilities

### New Capabilities

- `workspace-session-organization-view`: 定义会话整理视图的入口位置、双面板布局、虚拟未分类节点、子专题卡片、详情 modal、归类入口与 folder CRUD 的 UX 契约。

### Modified Capabilities

- （无）后端零改动，现有 `workspace-session-management` / `workspace-session-folder-tree` 契约保持不变；本提案只新增一个独立 UX surface 的行为契约。

## 验收标准

- 用户 MUST 能在 `设置 → 项目管理 → 会话管理` 现有页面内进入会话整理视图，且 MUST 不替换现有 catalog 视图。
- 整理视图 MUST 呈现双面板布局；左栏顶部 MUST 固定一个虚拟节点「📥 未分类」展示 `folderId == null` 会话的总数。
- 选中虚拟节点「📥 未分类」时，右栏 MUST 只渲染 unfiled 会话列表，MUST NOT 渲染子专题卡片区。
- 选中真实专题时，右栏 MUST 同时渲染直属会话列表 + 子专题卡片区；没有子专题时卡片区 MUST 不渲染。
- 点子专题卡片 MUST 把左栏选中切换到该子专题，右栏跟随刷新。
- 会话行 MUST 把「选中」与「打开详情」拆成两个独立 hit area；MUST NOT 引入双击交互。
- 详情 modal MUST 复用现有 message 渲染组件以只读方式呈现完整 timeline，MUST 提供「在主窗口打开此会话」按钮触发现有 thread switching。
- 工具栏「移动到专题…」按钮 MUST 在用户选中至少一条会话后可用，并 MUST 通过 folder picker（含「取消归类」）执行 `assignWorkspaceSessionFolder`。
- 删除包含子专题或直属会话的专题 MUST 默认拦截并向用户解释如何继续。
- 视图 MUST 完全消费现有 `sessionManagement.ts` bridge，MUST NOT 新增 Tauri command 或后端契约。
- 现有 `SessionManagementSection` 的 catalog 视图、批量操作、sidebar 行为 MUST 保持不变。
- 质量门禁至少覆盖：
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - 视图相关 vitest + RTL 单元 / 集成测试

## Impact

- Frontend (新增):
  - `src/features/settings/components/settings-view/sections/components/SessionOrganizationView.tsx`（容器）
  - `src/features/settings/components/settings-view/sections/components/SessionFolderTree.tsx`（左栏树 + 虚拟节点）
  - `src/features/settings/components/settings-view/sections/components/SessionFolderPanel.tsx`（右栏直属列表 + 卡片区）
  - `src/features/settings/components/settings-view/sections/components/SubfolderCard.tsx`（子专题卡片）
  - `src/features/settings/components/settings-view/sections/components/SessionDetailModal.tsx`（详情 modal）
  - `src/features/settings/components/settings-view/sections/components/MoveToFolderPicker.tsx`（归类 picker）
  - `src/features/settings/components/settings-view/sections/hooks/useFolderTree.ts`（folder CRUD 状态封装）
  - 上述路径为建议；实现阶段可在不偏离视图边界的前提下调整。
- Frontend (最小化插入):
  - `src/features/settings/components/settings-view/sections/SessionManagementSection.tsx`（视图模式入口）
  - i18n 文案文件（沿用现有 `t("settings....")` 命名空间）
- Frontend (复用):
  - `src/services/tauri/sessionManagement.ts`
  - `src/features/settings/components/settings-view/sections/hooks/useWorkspaceSessionCatalog.ts`
  - `src/features/workspaces/hooks/useWorkspaceSessionProjectionSummary.ts`
  - 现有 message timeline 渲染组件（`src/features/threads/**`，具体边界见 `design.md`）
- Backend: 无改动。
- Contracts: 无新增 / 无修改。
- Specs:
  - 新增 `workspace-session-organization-view`
