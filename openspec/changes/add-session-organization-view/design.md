## Context

ccgui 当前的会话整理能力分布在三个相对独立的 surface：

- **Sidebar**：承担「快速切换当前线程」职责，受列宽限制，不适合长任务式整理。
- **设置 → 项目管理 → 会话管理（catalog 视图）**：已支持分页、关键词 / 引擎 / 状态筛选、批量 archive / unarchive / delete，但本质上是一个表格，没有专题维度的整理体验。
- **后端 folder 能力**：`folderId` 字段、folder CRUD command、folder assignment command 已落地（参见 `src/services/tauri/sessionManagement.ts` 与现有 `workspace-session-folder-tree` capability），但前端只在 sidebar 树里做了消费，没有专门为长期整理设计的视图。

写作 / 研究 / 知识整理场景下用户的核心诉求是「把数百条历史会话按专题组织起来，并能在不离开整理上下文的前提下查看任意会话完整历史」。这个诉求在当前任何 surface 上都没有得到 first-class 支持。

本提案不引入新后端能力、不替换任何现有 UX surface，只在 `SessionManagementSection` 内新增一个**视图模式**：左栏专题树（含虚拟未分类节点）+ 右栏选中节点内容 + 大 modal 看完整历史。所有交互动作 MUST 复用现有 `sessionManagement.ts` bridge。

## Goals / Non-Goals

**Goals:**

- 提供一个稳定的「整理台」UX surface，让用户能按专题组织 workspace 内的真实会话历史。
- 把后端已具备的 folder / assignment 能力做产品化，落到一个用户可理解的视图里。
- 让用户能在整理视图内查看任意会话完整 timeline 并跳转到主聊天界面继续会话。
- 保持现有 catalog 视图、sidebar 与全局历史 / 归档中心行为不变。
- 后端零改动；前端完全消费现有 Tauri bridge。

**Non-Goals:**

- 不引入新 Tauri command、不修改 folder / assignment 契约。
- 不替换现有 catalog 视图或 sidebar。
- 不引入拖拽、右键菜单、自动智能分类、思维导图、自由画布。
- 不引入 modal 内 inline 编辑 / 续聊 / message 级操作。
- 不覆盖 `global archive` 视图（留待 v2）。
- 不引入 sidebar 反向联动（留待 v2）。

## Decisions

### Decision 1: 双面板 + 虚拟未分类节点，而非三栏布局

**Decision**

- 视图采用**双面板**布局：
  - 左栏：固定虚拟节点「📥 未分类 (n)」+ 真实专题树。
  - 右栏：选中节点对应的内容。
- 「未分类」以**虚拟节点**形式出现在左栏顶部，不单独占据一栏。

**Why**

- brainstorm 初稿曾提出三栏方案（左栏未分类 / 中栏专题树 / 右栏内容），但在写作 / 研究场景下「未分类」并不需要常驻一栏。
- 虚拟节点把「整理模式 vs 浏览已整理知识库模式」收敛成「选中哪个节点」的差别，省一栏宽度、无隐藏状态切换、心智负担更低。
- 与现有 `WorkspaceSessionFolderTree` 结构天然对齐，只需在树顶部插一个虚拟节点即可。

**Alternative considered**

- 三栏（未分类 / 树 / 内容）：早期 PRD 思路，已废弃。原因：栏宽紧张、有额外的折叠状态、需要解释「整理模式 vs 浏览模式」语义。

### Decision 2: 右栏专题视图 = 直属列表 + 子专题卡片（A 方案）

**Decision**

- 选中真实专题时，右栏自上而下：
  - 顶部：该专题直属会话列表（`folderId == 当前专题`）。
  - 底部：子专题卡片区，每张卡片 = 子专题名 + 直属会话数 + 最近更新时间。
- 点子专题卡片 = 把左栏选中切换到该子专题，右栏跟随刷新。
- 没有子专题时，卡片区不渲染。
- 卡片视觉极简：三行文字，**不**加 icon、**不**加预览。

**Why**

- 用户场景里专题往往是「话题 → 子话题 → 会话」，直属内容和子结构都需要在同一屏被看见。
- 卡片承担「这里还有更深的层次，要不要进去」的导览职责；列表承担「直属内容是什么」的展示职责。
- 极简卡片避免视觉噪音，与 catalog 表格视觉风格区分开。

**Alternative considered**

- B 方案（折叠分组）：会和左栏树视图功能重叠，用户在两个地方看到同一层级。
- C 方案（纯会话列表）：丢失子专题结构，整理价值减半。

### Decision 3: 会话行交互 = 复选框选中 + 点标题查看（hit area 分离）

**Decision**

- 会话行内**复选框** → 选中（用于批量「移动到专题…」/ archive / delete）。
- 会话行内**点会话标题** → 打开大 modal 看完整历史。
- **不引入双击**。

**Why**

- 「选中」与「查看」是两个语义动作，应当对应两个独立 hit area，避免用户在「单击切换 / 单击查看 / 双击查看」之间猜。
- 沿用现有 `SessionManagementSection` 的复选框模式，与 catalog 视图的批量操作行为一致。
- 双击在 catalog/list 类视图里 affordance 极弱，且与现有交互不一致。

**Alternative considered**

- 双击查看：affordance 弱、与现有交互不一致。
- 单击切换选中：把「查看」挤到一个特殊按钮，违反「点标题 = 看会话」的直觉。

### Decision 4: 详情 modal = 主窗口 80–90% 尺寸，只读 timeline + 跳转按钮

**Decision**

- modal 尺寸：参考更新公告 modal，主窗口的 80–90%，**非**全屏。
- 关闭方式：右上角 ×、点遮罩。
- 内容：
  - 顶部 metadata：engine / updated / 所属专题路径 / parent session（若有）。
  - 主体：完整 message timeline，**只读**，复用现有聊天渲染组件。
  - 显眼按钮：「在主窗口打开此会话」→ 触发现有 thread switching，把这个 session 切到 sidebar / 主聊天区。
- 不做：inline 编辑、inline 续聊、message 级操作。

**Why**

- 整理过程中需要的是「快速看一眼内容再决定如何归类」，全屏会让用户失去左栏整理上下文。
- 只读 modal 责任边界清晰：modal 看历史，主聊天区继续会话；不需要在两套渲染逻辑之间维持状态。
- 「在主窗口打开此会话」复用现有 thread switching 行为，避免在 modal 内重新实现 runtime 连接。

**Alternative considered**

- 全屏 modal：失去整理上下文。
- modal 内续聊：需要把 runtime 输入框、流式消息、actions、文件 attach 等全部塞进 modal，作用域极大且与现有 thread runtime 强耦合，远超 v1 范围。

### Decision 5: 归类入口 = 工具栏按钮 + folder picker，不做拖拽 / 右键

**Decision**

- 工具栏新增「移动到专题…」按钮，选中会话后点开 → 弹出 folder picker。
- folder picker：树形选择器，含「取消归类」选项；选定后调用 `assignWorkspaceSessionFolder(workspaceId, sessionId, folderId | null)`。
- **不**做拖拽。
- **不**做右键菜单。

**Why**

- 拖拽和右键在 desktop app 里 affordance 较弱、键盘可访问性差，且容易在 React 树里引入跨组件 drag state 的复杂度。
- 显式按钮 + picker：100% 键盘可达、与「批量操作」工具栏现有模式一致、folder 选择树天然对齐左栏数据源。
- v2 可在不破坏现有契约的情况下增加拖拽 / 右键，本期先把语义路径打通。

**Alternative considered**

- 拖拽：affordance 强但实现成本高、键盘不友好，v2 再加。
- 右键：affordance 中等但与 sidebar / catalog 现有交互不一致，v2 再加。

### Decision 6: 删除非空专题默认拦截

**Decision**

- 用户尝试删除包含子专题或直属会话的专题时，系统**默认拦截**并提示用户先清空或解除归类。
- 不在本次提供「递归删除」或「自动解除归类」选项；这两条留待 v2 评估。

**Why**

- 「删除专题 = 同时删除会话」对用户是高风险动作，默认应当让用户显式承担。
- 「删除专题 = 自动解除归类」语义模糊（会话去哪了？），应当让用户主动选「取消归类」或「移到别的专题」。
- 拦截 + 提示是最低成本、最安全的默认行为，符合现有 `workspace-session-folder-tree` 已有的 `delete non-empty folder is blocked by default` requirement。

**Alternative considered**

- 递归删除：高风险，v1 不开。
- 自动解除归类：语义模糊，v1 不开。

### Decision 7: v1 只覆盖 project 模式

**Decision**

- 视图只在 `project` 模式下提供；`global archive` 模式继续走现有 catalog 视图。
- folder 与 assignment mutation 只对 active 状态会话生效；archived 会话的归类行为留待实现阶段验证或在 PR 中限定 scope。

**Why**

- project 模式有明确的 workspace scope 和 folder tree 数据源，是 folder 能力的天然落地点。
- `global archive` 缺少 workspace scope，需要先定义跨 project 的 folder 模型，远超 v1 范围。
- v1 先把 project 模式做稳，v2 再讨论 global / archive 的整理体验。

**Alternative considered**

- 一次覆盖 project + global：需要重新定义 folder 跨 project 语义。
- 顺手覆盖 archived：需要先确认 archived assignment 行为，会拉长 v1 周期。

## Interaction Contract

### View State Model

视图本地状态（不进入 Redux / Zustand 全局，按现有 `SessionManagementSection` 模式管理）：

```ts
type SelectedFolderId = string | null;

type OrganizationViewState = {
  // 左栏选中节点。null 表示「📥 未分类」虚拟节点；string 表示真实 folder id
  selectedFolderId: SelectedFolderId | "__unfiled__";

  // 会话选中集合（沿用现有 catalog 视图的 selectedIds 模式）
  selectedSessionIds: ReadonlySet<string>;

  // 详情 modal 状态
  detailModalSessionId: string | null;

  // 「移动到专题…」picker 状态
  movePickerOpen: boolean;
};
```

### Data Sources (复用，不新增)

| 数据 | Command | 用法 |
|---|---|---|
| folder 树 | `listWorkspaceSessionFolders` | 渲染左栏树 |
| 会话列表 | `listWorkspaceSessions` | 客户端按 `folderId` 分桶，喂给右栏 |
| 直属会话计数（虚拟节点） | 同上 | 客户端聚合 `folderId == null` |
| 子专题卡片元数据 | 同上 + folder 树 | 客户端聚合每个子 folder 的直属数 + 最近更新时间 |
| 完整 message timeline | 现有渲染组件入口 | 详情 modal 内只读消费（边界见下文） |

### Mutation Contract (复用，不新增)

| 动作 | Command |
|---|---|
| 新建子专题 | `createWorkspaceSessionFolder(workspaceId, name, parentId?)` |
| 重命名专题 | `renameWorkspaceSessionFolder` |
| 删除专题（仅在空时） | `deleteWorkspaceSessionFolder` |
| 移动会话到专题 | `assignWorkspaceSessionFolder(workspaceId, sessionId, folderId)` |
| 取消归类 | `assignWorkspaceSessionFolder(workspaceId, sessionId, null)` |

### Read-Only Message Timeline 边界

整理视图最大的实现风险是「现有聊天渲染组件能否独立于 thread runtime 渲染」。详情 modal 需要复用现有聊天 UI，但**不**挂事件输入框、actions、stream listener。

实现前 MUST 完成以下 trace（参见 `tasks.md` 1.x）：

1. 找到 `src/features/threads/**` 内 message 渲染组件的 props 边界。
2. 评估其与 thread runtime context 的耦合度：
   - 如果 props 即可独立渲染：直接消费。
   - 如果耦合 runtime：抽一层 `ReadOnlyTimelineViewer` 或在 modal 内挂一个 `read-only` thread context。
3. 找出完整 message timeline 的拉取链路（catalog 给的是 summary，timeline 一般要另一个 command 拉）。

**Risk acknowledged**: 这是 v1 最大不确定点，可能影响实现顺序。trace 结果会决定 modal 是否需要在主体实现前先做小幅 refactor。

### Decision 8: 整理视图以独立 modal 形式从 `SessionManagementSection` 弹出（修订 Decision 1 entry 决定）

**Decision**

- 整理视图 MUST 以全屏型 modal（约 92vw × 88vh，最大 1280×820）的形式弹出，**不是**内嵌入 `SessionManagementSection` 主体。
- 入口为 section 工具栏内一颗独立按钮「会话整理」（`mode === "project"` 且选中 workspace 后可用）；点击 = open modal。
- modal 头部呈现当前 workspace label + 副标题；modal 主体内**继续沿用 Decision 1 / Decision 2 的双面板布局**（左栏专题树 + 右栏直属会话 / 子专题卡片）；modal 底部一行 toolbar 承载批量操作（选中数 / 全选 / 清空 / 移动到专题 / 归档 / 取消归档 / 删除二次确认）。
- 关闭方式：右上角 × / 点遮罩 / Esc（mutation 进行中时禁用关闭）。
- 取消之前内嵌在 section 内的「目录视图 / 整理视图」toggle 按钮；catalog 视图永远是 section 的默认主体，整理通过 modal 走。
- 取消之前在 section 内显眼位置的「移动到专题…」按钮；该按钮 MUST 仅在 modal 内出现。

**Why**

- 实际跑通后用户反馈：把双面板嵌在 section 主体内，会被 section 已有的 chrome（mode 切换 / workspace 选择 / 引擎 + 状态过滤 / thread 数量调节 / 批量工具栏）夹得很挤；CSS 缺失时还会退化成纵向堆叠，视觉上「和目录视图没有任何区别」。
- modal 隔离层让整理视图拥有完整、专属的画布（>=88vh × 92vw），把布局、滚动、配色、toolbar 与 section 主体解耦。
- 单一入口按钮 + 单一 modal 比「视图模式 toggle」心智更轻——用户不需要记住「我现在在哪种视图」。
- 与本仓库已有「在 section 内弹层（如更新公告 modal、SessionDetailModal、MoveToFolderPicker）」的视觉语法一致。
- modal 出口语义清晰：关掉 modal = 回到 catalog 默认视图，selection 自动 reset，不会污染 catalog 的批量操作。

**Alternative considered**

- 继续走 Decision 1 的内嵌视图：实测视觉拥挤、CSS 缺失时严重退化；除非额外补 stylesheet 并把 section 上方 chrome 折叠 / 隐藏，否则不可用。
- modal 内挂 workspace picker：实际场景中切 project 频率低、modal 内重置 folders + entries + selection 的复杂度高，v1 不暴露。
- 把 catalog 与 organization 都放进 modal：catalog 已是 section 默认视图，再套 modal 是冗余。

### Decision 1 (revised): 双面板 + 虚拟未分类节点（保留，但只在 modal 主体内呈现）

> Decision 1 的双面板设计依然成立——左栏专题树（含「📥 未分类」虚拟节点）+ 右栏内容——只是承载它的 surface 由「section 主体」改为「Decision 8 描述的 modal 主体」。Decision 2 / Decision 3 / Decision 4 / Decision 5 / Decision 6 / Decision 7 全部继续适用，未受 modal 化影响。

## Risks / Trade-offs

- **[Risk] Message 渲染组件与 thread runtime 强耦合**  
  Mitigation: 实现前 trace 边界；如必要先抽 read-only viewer 层。若耦合严重，可考虑 modal 内挂一个 read-only thread context shim，但仍然不引入输入 / runtime / stream。

- **[Risk] 客户端按 `folderId` 分桶在大量会话场景下性能退化**  
  Mitigation: v1 不做服务端分桶；如果实测有性能问题，先用 memoization / 虚拟列表缓解，再评估服务端分桶（v2）。

- **[Risk] 删除非空专题的拦截 UX 不清晰**  
  Mitigation: 拦截时返回明确文案，告诉用户「该专题包含 N 个直属会话和 M 个子专题，请先清空」。

- **[Risk] 子专题卡片元数据（直属数 / 最近更新时间）在并发归类下与服务端不同步**  
  Mitigation: 归类 mutation 成功后 invalidate 当前 folder + parent folder 的聚合；不做乐观更新。

- **[Risk] 整理视图与 catalog 视图共存导致用户困惑**  
  Mitigation: 视图模式切换 UX 文案明确标注「整理 / 浏览」职责差别；实现阶段可调整入口呈现。

## Gates

### Functional Gate

- 选中虚拟节点「📥 未分类」时，右栏 only 显示 unfiled 会话；MUST NOT 显示子专题卡片区。
- 选中真实专题时，右栏 MUST 显示直属会话列表 + 子专题卡片（如果有）。
- 点子专题卡片 MUST 切换左栏选中且右栏跟随刷新。
- 工具栏「移动到专题…」MUST 走 folder picker 并调用 `assignWorkspaceSessionFolder`。
- 详情 modal MUST 以只读形式呈现完整 message timeline。
- 「在主窗口打开此会话」MUST 触发现有 thread switching。
- 删除非空专题 MUST 默认被拦截。

### No-Regression Gate

- 现有 `SessionManagementSection` catalog 视图、批量 archive / unarchive / delete、状态过滤、分页 MUST 保持不变。
- sidebar 行为 MUST 不受影响。
- 全局历史 / 归档中心入口 MUST 不受影响。
- 后端 `assignWorkspaceSessionFolder` 等 command 契约 MUST 保持不变。

### Quality Gates

- `npm run lint`
- `npm test`
- `npm run build`
- 视图相关 vitest + RTL 单元 / 集成测试覆盖：
  - 虚拟节点筛选逻辑
  - folder 树到右栏数据映射
  - 子专题卡片聚合（数量 / 最近更新时间）
  - 选中虚拟节点 → 只显示未分类
  - 选中真实专题 → 显示直属 + 子专题卡片
  - 点子专题卡片 → 左栏选中切换
  - 点会话标题 → modal 打开
  - 工具栏「移动到专题…」→ folder picker → 应用归类后右栏更新
  - 删除非空专题 → 拦截

## Migration Plan

1. **trace 三件事**（详情 modal 复用边界、message timeline 拉取链路、archived assignment 行为）。trace 结果决定后续顺序，可能需要先做小幅 refactor 暴露 read-only viewer。
2. **左栏专题树 + 虚拟节点**（最小可见骨架，能切换节点即可）。
3. **右栏直属会话列表**（复用现有 `SessionListSection` 或等价渲染）。
4. **右栏子专题卡片**。
5. **详情 modal**（只读 timeline + 跳转按钮）。
6. **「移动到专题…」按钮 + folder picker**。
7. **folder CRUD UI**（新建 / 重命名 / 删除拦截）。
8. **i18n + 视觉润色**。
9. **测试**（参见 Quality Gates）。
10. **OpenSpec verify + archive**。

**Rollback**

- 整理视图作为新视图模式，可在切换器层面隐藏入口实现快速 disable，不影响 catalog 视图与 sidebar。
- 因为不修改后端契约 / persisted schema，无需数据回滚。

## Open Questions

- 视图模式入口的具体呈现（tab / segmented control / button）：实现阶段定，不脱离 section。
- `assignWorkspaceSessionFolder` 对 archived 会话是否生效：trace 中确认；如果 archived 不允许归类，整理视图在 v1 内可只对 active 会话开放归类按钮。
- 「在主窗口打开此会话」是否需要同时关闭 modal：实现阶段按用户测试体验决定。
- 子专题卡片「最近更新时间」字段口径（按直属会话最近更新 vs 整棵子树最近更新）：实现阶段对齐 catalog 视图现有口径。
