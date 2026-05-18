# brainstorm: ccgui 会话管理树视图

## Goal

在 ccgui 现有 `设置 -> 项目管理 -> 会话管理` 能力基础上，探索一个适合长期、多分支、多主题对话场景的树状会话管理视图，并把需求范围收敛为一个适合首次提交上游 PR 的 MVP。

## What I already know

* 用户希望新增的是一个独立的“系统整理”视图，而不是继续挤在左侧 sidebar 里做小修小补。
* 用户当前倾向把能力放在 `设置 -> 会话管理`，并让右侧主区域承担主要展示与管理职责。
* 用户希望第一版尽量只做最小可用版本，优先只读展示、展开/折叠、点击跳转，不优先做拖拽整理或智能分类。
* 仓库里已经存在设置页入口：`src/features/settings/components/settings-view/sections/SessionManagementSection.tsx`。
* 这个设置页当前已经支持 project/global 两种模式、分页、筛选、批量归档/取消归档/删除，不是空白页。
* 会话 catalog 数据结构 `WorkspaceSessionCatalogEntry` 已经包含 `parentSessionId` 与 `folderId`，说明后端已有分支关系与文件夹归类的基础字段。
* 前端 `ThreadSummary` 已包含 `parentThreadId`，sidebar 现有线程树通过 `useThreadRows()` 基于 parent-child 关系构建层级。
* sidebar 还支持文件夹树 `WorkspaceSessionFolderTree`，说明“文件夹归类”和“会话分支”在当前系统里是两套不同维度。

## Assumptions (temporary)

* MVP 应尽量复用现有 `SessionManagementSection` 和现有 session catalog 数据，而不是新开完全独立的数据源。
* 如果 tree 以“分支关系”为核心，首版可以先不支持 folder 操作，只保留现有 folder 数据兼容空间。
* 正式开发前，大概率需要创建一个 OpenSpec change，因为这属于用户可见的 behavior 变更，而不是纯内部重构。

## Open Questions

* 首版在专题节点被选中时，右侧主区域应该如何展示“子专题 + 会话”的组合内容？
* 会话详情弹层首版需要展示到什么粒度：完整历史、只读、是否附带跳转入口？
* tree 是否只针对 `project` 模式，还是也要覆盖 `global archive` 模式？
* 点击会话节点后的目标行为应是“切换到该会话聊天界面”还是“在设置页内显示会话详情”？
* sidebar 与设置页 tree 之间，MVP 需要做到什么程度的一致性或联动？

## Requirements (evolving)

* 在现有会话管理能力附近提供专题化整理入口。
* 第一优先目标是管理大量历史会话的专题归类与批量整理，而不是会话分支关系可视化。
* 支持未分类会话进入专题，专题可继续拥有子专题。
* 主页面采用三栏思路：
  * 左栏：未分类会话，可折叠
  * 中栏：专题树
  * 右栏：当前专题直属会话 + 子专题
* 右侧主区域承担主要整理与管理职责，不依赖 sidebar 的窄列交互。
* 无论未分类还是已分类会话，用户都需要能够查看完整会话历史，而不只是标题或摘要。
* 完整会话历史不直接塞进主布局；应通过一个较大的详情弹层承载，以避免打乱整理页面布局。
* 选中专题后，右侧默认显示：
  * 当前专题直属会话
  * 当前专题的子专题
  * 子专题内容默认折叠，不一次性展开整棵子树
* 保持 PR 范围聚焦，不顺手混入无关逻辑改动。
* 兼容现有 sidebar 的快速切换职责，而不是直接替换 sidebar。

## Acceptance Criteria (evolving)

* [ ] 用户能在现有设置中的会话管理相关区域进入树状视图。
* [ ] 用户能展开/折叠会话树节点。
* [ ] 用户能折叠左栏未分类区，在“整理模式”和“浏览已整理知识库模式”之间切换重心。
* [ ] 用户能更容易定位专题层级与直属会话归属关系。
* [ ] 用户能点击或双击未分类/已分类会话，并查看其完整会话历史详情。
* [ ] 首版实现范围足够小，适合作为上游首次 PR。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 首版不优先做全局思维导图式自由画布
* 首版不优先做会话分支关系可视化
* 自动智能分类
* 借此机会重做整个 sidebar
* 与当前 tree 目标无关的启动逻辑、运行时逻辑或杂项 bugfix

## Technical Notes

* 现有会话管理页：
  * `src/features/settings/components/settings-view/sections/SessionManagementSection.tsx`
* 现有会话 catalog / folder bridge：
  * `src/services/tauri/sessionManagement.ts`
* 现有 sidebar tree 构建：
  * `src/features/app/hooks/useThreadRows.ts`
  * `src/features/app/components/Sidebar.tsx`
* 现有 thread model：
  * `src/types.ts` 中 `ThreadSummary.parentThreadId`
* 现有 catalog -> thread summary 映射：
  * `src/features/threads/hooks/useThreadActions.helpers.ts`
* 当前已确认的关键约束：
  * session 分支关系与 folder 归类是两套轴线
  * 当前讨论优先的是“专题归类/整理轴线”
  * 设置页当前主打的是 catalog 管理，不是 runtime conversation viewer
* 当前已确认的右侧显示策略：
  * 当前专题直属会话直接显示
  * 子专题同时显示
  * 子专题内部会话默认折叠，避免右侧一次性铺满
* 当前已确认的浏览诉求：
  * 未分类会话不能只显示标题列表
  * 用户需要在管理界面中查看会话具体内容，再决定如何归类
  * 已归类会话后续也需要同样的完整查看能力
* 当前已确认的详情承载方式倾向：
  * 主页面继续负责组织/整理
  * 完整会话内容通过大尺寸弹层展示
  * 弹层交互参考现有更新公告：右上角关闭、点击空白关闭
* 当前已确认的主布局方向：
  * 三栏布局比两栏更符合“整理台”心智模型
  * 左栏未分类区应可折叠，避免与已整理浏览场景冲突

---

## History Notes

* **2026-05-13**：brainstorm 初稿确定「三栏」方向（未分类 / 专题树 / 右侧内容）。
* **2026-05-15**：与用户多轮讨论后冻结为「双面板 + 虚拟未分类节点」方案，写入 `plan.md` §1.2。原因：写作 / 研究场景下「未分类」不需要常驻一栏，虚拟节点把「整理模式 vs 浏览模式」收敛成「选中哪个节点」的差别，省一栏宽度。
* **2026-05-17**：双面板视图代码 + 测试落地后实际跑通，发现 section 顶部 chrome（mode 切换 / workspace picker / 引擎 + 状态过滤 / thread 数量调节 / 批量工具栏）会把整理视图夹得很挤，CSS 缺失时还会退化为纵向堆叠；视觉上和 catalog 表格没有区别。基于用户反馈把整理视图改为「从 section 工具栏的『会话整理』按钮弹出的独立 modal」（约 92vw × 88vh），modal 主体仍然是双面板。详见 OpenSpec `design.md` Decision 8、`spec.md`「Organization Surface MUST Open As A Dedicated Modal」requirement。
