# Plan: Session Organization View (MVP)

> 这份文档是一次完整脑暴 + 多轮讨论的设计冻结。新会话窗口的 agent 应当**先完整读这份文档**，再读同目录的 `prd.md`（背景资料），不需要重新讨论已锁定的决断。

## 0. 一句话目标

在 ccgui 现有的 `Settings → Project Management → Session Management` 页面里，新增一个适合长期使用（写作 / 研究 / 知识整理）的会话整理视图，让用户能把大量历史会话按"专题"组织起来，并能在弹层中查看完整会话历史。

视图位置不替换 sidebar，sidebar 继续承担快速切换职责。

---

## 1. 已锁定的设计决断（不要再讨论）

### 1.1 入口（**2026-05-17 修订**）

- 位置：现有的 `src/features/settings/components/settings-view/sections/SessionManagementSection.tsx` 工具栏上新增一颗「会话整理」按钮（`mode === "project"` 且选中 workspace 后可用）。
- 点击 = **弹出独立 modal**（约 `min(1280px, 92vw) × min(820px, 88vh)`，参照 SessionDetailModal 的视觉语法）；不再走「catalog 视图 / 整理视图」内嵌 toggle。
- catalog 视图永远是 section 主体的唯一默认呈现；section 顶部 mode / workspace / 引擎 / 状态过滤等 chrome 仅服务 catalog。
- 关闭支持 × / 遮罩 / Esc（mutation 进行中临时禁用关闭）；关闭时 reset selection + 关 movePicker。
- 不动 sidebar、不动 global archive。

> **修订原因**：初版方案是「section 主体内嵌双面板视图」，实测被 section chrome 挤得过窄；CSS 缺失时退化为纵向堆叠，视觉上与 catalog 没有区分。modal 化让整理视图拥有完整专属画布，且与 catalog 职责清晰隔离。详见 OpenSpec `design.md` Decision 8。

### 1.2 布局：双面板（不是三栏）
- **左栏（专题树）**
  - 顶部固定一个虚拟节点「📥 未分类 (n)」，n = `folderId == null` 的会话数
  - 下方是真实专题树（基于现有 `WorkspaceSessionFolderTree`，支持嵌套）
  - 节点级操作：新建子专题 / 重命名 / 删除（详见 §1.6）
- **右栏（当前选中节点的内容）**
  - 选中虚拟节点「📥 未分类」时：会话列表（仅 `folderId == null`），**不渲染子专题卡片区**
  - 选中真实专题时：**直属会话列表 + 底部子专题卡片区**（详见 §1.3）

**注意**：早期 PRD 提到的「左栏未分类 / 中栏专题树 / 右栏内容」三栏方案已**废弃**。原因：写作/研究场景下未分类不需要常驻一栏；虚拟节点把"整理模式 vs 浏览模式"收敛成"选中哪个节点"的差别，省一栏宽度，无隐藏状态切换。

### 1.3 右栏专题视图：A 方案（直属列表 + 子专题卡片）
- 顶部：直属会话列表（`folderId == 当前专题`）
- 底部：子专题卡片区，每张卡片 = 子专题名 + 直属会话数 + 最近更新时间
- 点卡片 = 把左栏选中切到该子专题，右栏跟着换
- 没有子专题时，卡片区不渲染
- **不做** B 方案（折叠分组）：会和左栏树视图功能重叠
- **不做** C 方案（纯会话列表）：丢失结构性信息
- 卡片视觉极简：三行文字（名 / 数 / 时间），不加 icon、不加预览

### 1.4 会话行交互
- **复选框** → 选中（用于批量操作，沿用现有 `SessionManagementSection` 行为）
- **点会话标题** → 打开大 modal 查看完整历史
- **不引入双击**
- "选中"和"查看"是两个语义动作，hit area 必须分离

### 1.5 大 Modal（会话详情）
- 尺寸：参考更新公告 modal — 主窗口的 80–90%，**非全屏**
- 关闭：右上角 ×，点遮罩关闭
- 内容：
  - 顶部 metadata：engine / updated / 所属专题路径 / parent session（若有）
  - 主体：完整 message timeline，**只读**，复用现有聊天渲染组件
  - 显眼按钮：「在主窗口打开此会话」→ 触发现有 thread switching，把这个 session 切换到 sidebar / 主聊天区
- **不做**：inline 编辑、inline 续聊、message 级操作

### 1.6 归类与 folder 操作
- **归类入口**：工具栏新增「移动到专题…」按钮，选中会话后点开 → 弹出 folder picker（树形选择器，含"取消归类"选项）
- **不做拖拽**（v2）
- **不做右键菜单**（v2）
- **专题 CRUD**：新建子专题 / 重命名 / 删除，通过左栏节点旁的操作按钮触发（具体按钮位置和样式实现时定）
- **删除非空专题策略**：留待实现阶段决定（拦截 / 解除归类 / 递归删除三选一，倾向"拦截 + 提示用户先清空或解除归类"）

### 1.7 范围（v1 MVP）
- 仅 **project 模式**，不动 global archive（v2）
- 不做 sidebar 反向联动（v2）
- 不做拖拽、右键菜单（v2）
- 不做会话分支关系图、思维导图、自由画布（v2 或更后）
- 不做自动智能分类
- 不做 modal 内 inline 编辑/续聊

---

## 2. 实现指引（给写代码的 agent）

### 2.1 后端：零新增

**完全复用现有 Tauri commands**（已存在于 `src/services/tauri/sessionManagement.ts`）：

| 用途 | Command |
|---|---|
| 列表 | `listWorkspaceSessions` (按 folderId 客户端分组) |
| 列 folder 树 | `listWorkspaceSessionFolders` |
| 新建 folder | `createWorkspaceSessionFolder(workspaceId, name, parentId?)` |
| 重命名 folder | `renameWorkspaceSessionFolder` |
| 移动 folder | `moveWorkspaceSessionFolder` |
| 删除 folder | `deleteWorkspaceSessionFolder` |
| 会话归类 | `assignWorkspaceSessionFolder(workspaceId, sessionId, folderId?)`（folderId=null = 取消归类）|

**关键数据**：`WorkspaceSessionCatalogEntry.folderId` 已存在，直接用。

### 2.2 前端：关键文件

| 路径 | 当前状态 | 这次的角色 |
|---|---|---|
| `src/features/settings/components/settings-view/sections/SessionManagementSection.tsx` | 已存在，完整 | 在此页内嵌入新视图（不重写） |
| `src/services/tauri/sessionManagement.ts` | 已存在，bridge 完整 | 直接消费，不改 |
| `src/features/settings/components/settings-view/sections/hooks/useWorkspaceSessionCatalog.ts` | 已存在 | 直接复用拉取/分页/筛选 |
| `src/features/workspaces/hooks/useWorkspaceSessionProjectionSummary.ts` | 已存在 | 直接复用统计 |

**建议新建**（具体路径实现阶段定，下面是建议）：
- `…/sections/components/SessionOrganizationView.tsx` — 双面板容器
- `…/sections/components/SessionFolderTree.tsx` — 左栏树（含虚拟节点）
- `…/sections/components/SessionFolderPanel.tsx` — 右栏内容（直属 + 子专题卡片）
- `…/sections/components/SubfolderCard.tsx` — 子专题卡片
- `…/sections/components/SessionDetailModal.tsx` — 大 modal
- `…/sections/components/MoveToFolderPicker.tsx` — 归类用 folder picker
- `…/sections/hooks/useFolderTree.ts` — folder CRUD 状态封装（包一层 toast / error / reload）

复用 `SessionListSection`（已在 `SessionManagementSection.tsx` 内部）作为右栏直属列表的渲染。

### 2.3 状态管理
- folder 树和会话列表分两路：
  - `listWorkspaceSessionFolders` → folder 树状态
  - `listWorkspaceSessions` + 客户端按 `folderId` 分桶 → 右栏会话来源
- 选中节点是 view-local state（`selectedFolderId: string | null | "__unfiled__"`）
- 选中会话的 selection 沿用现有 `selectedIds` 模式

### 2.4 实现前必须先验证的几件事（**不要跳过**）
1. **聊天渲染组件能否独立于 thread runtime 渲染**：大 modal 要复用聊天 UI 但不挂事件输入框。先 trace `src/features/threads/**` 找出 message 渲染组件的 props 边界。如果它强耦合 runtime，需要先抽一层只读 viewer 或者在 modal 里挂一个"只读 thread context"。这是这次最大的实现风险点。
2. **`listWorkspaceSessions` 返回的会话能否拿到 message timeline**：catalog 给的是 summary，完整 message 一般要另一个 command 拉取。先确认这个拉取链路在哪。
3. **`assignWorkspaceSessionFolder` 是否对 archived 会话也有效**：MVP 至少要在 active 状态下工作；archived 行为留待实现阶段确认或在 PR 里限定 scope。

### 2.5 测试范围
- 单元：虚拟节点筛选逻辑、folder 树到右栏数据映射、子专题卡片聚合（数量 / 最近更新）
- 集成（vitest + RTL）：
  - 选中虚拟节点 → 只显示未分类
  - 选中专题 → 显示直属 + 子专题卡片
  - 点子专题卡片 → 左栏选中切换
  - 点会话标题 → modal 打开
  - 工具栏「移动到专题…」→ folder picker → 应用归类后右栏更新
- e2e（如果项目有）：至少走一遍"未分类 → 创建专题 → 移动 → 查看 modal → 跳转主窗口"

---

## 3. PR / Commit 边界（**必读**）

这个工作的目标是提上游 PR。**为了让 PR 容易被接受**，commit 内容必须严格限定：

### 必须 commit
- 新增的 view component 文件（§2.2 列表）
- 对 `SessionManagementSection.tsx` 的最小化插入（视图入口 + 切换）
- i18n 文案（沿用现有 `t("settings....")` 风格）
- 相关测试

### 严禁 commit
- `AGENTS.md` 或其它项目治理类文件的修改
- `.trellis/**`（含本文件、prd.md、journal）
- `.omc/**`
- `.codex/**` / `.claude/**` 等 host adapter 配置
- 任何与会话整理视图无关的 bugfix / 重构（即便顺手发现）
- `package.json` / `Cargo.toml` / `package-lock.json` 的非功能性改动（行尾差异、版本号微调等）

### 已知陷阱
- Windows 上 `git diff` 会出现 LF/CRLF 警告导致 `package-lock.json` 等文件看起来被修改。**这些不是真实改动**，commit 前用 `git diff` 仔细核对每个 staged 文件，行尾差异要 `git restore`。
- 本仓库 commit message 规则：**中文主体的 Conventional Commits**（`type(scope): 中文动宾短句`），见 `AGENTS.md` "Git Commit Message" 段。

---

## 4. 推荐开发顺序

1. **创建 OpenSpec change**（按 AGENTS.md，behavior 变更必须）
   - change id 建议：`add-session-organization-view`
   - 把本文件 §1 的设计决断映射到 `proposal.md` / `tasks.md`
2. **新建 feature 分支**（基于最新 `main`）
   - 建议名：`feat/session-organization-view`
   - 旧分支 `feat/session-tree-view` 没有 unique commit，可以删可以留
3. **实现前 trace**（§2.4 三件事）
4. **左栏专题树 + 虚拟节点**（最小可见骨架，能切换节点即可）
5. **右栏直属列表**（复用 `SessionListSection`）
6. **右栏子专题卡片**
7. **大 Modal**（只读 timeline + 跳转按钮）
8. **「移动到专题…」按钮 + folder picker**
9. **folder CRUD UI**（新建 / 重命名 / 删除）
10. **i18n + 样式润色**
11. **测试**
12. **OpenSpec verify + archive**

每步完成后跑：`npm run lint && npm test && npm run build`（按项目内现有脚本，参见 `package.json`）。

---

## 5. 当前进度

> 这一段是 **session 之间的接力标记**。新窗口先读完它就能知道走到哪一步。

### 已完成（branch：`feat/session-organization-view`，未 commit）

- ✅ Brainstorm 完成（`prd.md`）
- ✅ 多轮讨论 + 设计冻结（本文件 §1）
- ✅ 工作区已切回 `main` 并 fast-forward 到 `upstream/main`（`40137918`）
- ✅ OpenSpec change 创建：`openspec/changes/add-session-organization-view/`（proposal / design / tasks / spec deltas 齐全）
- ✅ Trace 三件事（plan §2.4）— 详情见 journal 2026-05-17 三个 Trace 段：
  - Trace 1：message 渲染组件路径在 `src/features/messages/`（不是 plan 假设的 `src/features/threads/`），原子 Row 组件可纯 prop 复用
  - Trace 2：catalog 只给 summary；timeline 走 `loadSharedSession` (codex/claude) + gemini/opencode 各自 loader
  - Trace 3：`assign_workspace_session_folder` 后端无 archived 限制，v1 UI 不限制
- ✅ §2 左栏专题树骨架 + 虚拟未分类节点
- ✅ §3 右栏直属会话列表（hit area 分离的 checkbox + title button）
- ✅ §4 右栏底部子专题卡片（三行卡片 / 点击切左栏选中）
- ✅ §5 会话详情 Modal（85vw × 85vh、只读 timeline、跳转按钮 stub、ReadOnlyTimelineViewer 覆盖 7 种 kind）
- ✅ §6 工具栏「移动到专题…」按钮 + folder picker（modal、平铺路径、Apply/Cancel、批量 `assignWorkspaceSessionFolder`）
- ✅ §7 Folder CRUD UI（新建/重命名/删除按钮 + 内嵌输入 + 非空拦截 + 错误回显，挂在 `SessionFolderTree` 节点旁；mutation handler 走 `SessionOrganizationView.reloadFolders`）
- ✅ §8.4 **Modal pivot**（2026-05-17）：去掉「目录视图 / 整理视图」inline toggle 与 section 内嵌渲染，新增「会话整理」按钮 + `SessionOrganizerModal`（92vw × 88vh、header + 双面板 body + 批量 toolbar）；`SessionOrganizationView` 顶层加 inline grid（左 220–280px / 右 1fr，独立 overflow）；i18n 删除 `sessionOrganizationCatalogModeLabel` / `sessionOrganizationViewModeLabel`，新增 5 个 modal 相关 key（open button / aria / title / subtitle / close aria）

### 测试 / 类型门禁状态

- `npx vitest run sessionOrganization/` → **51/51 通过**（含 12 个 `SessionFolderTree.test.tsx` + 3 个 `SessionOrganizationView.test.tsx` 集成旅程 + 9 个 `SessionOrganizerModal.test.tsx`）
- `npm test`（全量 480 个 test files via `scripts/test-batched.mjs`） → **全绿，exit 0**
- `npm run lint` → 静默通过（eslint 无 issue）
- `npx tsc --noEmit` → 零 TS 错误
- `npm run build` → **✓ built in 50.49s（exit 0）**（chunk-size 警告 `App-BVf_mLxs.js ~6 MB` 为既有 issue，非本次引入）
- `openspec validate --all --strict --no-interactive` → **阻塞：openspec CLI 未安装**（本机无全局 binary，仓库内也未发现 `.claude/skills/osp-openspec-sync/scripts/validate-consistency.py`）。需要手动安装或由 CI 跑。

### 已知 v1 缺口（不阻塞 §7，但 §9 之前要处理）

1. **Modal 内 multi-engine timeline loader 分派**：当前只调 `loadSharedSession`（codex/claude）。gemini/opencode 各有独立 loader，需补一层 dispatch
2. **「在主窗口打开此会话」按钮接通**：UI 就位且 callback 入口在，但 `SessionManagementSection` 没传 `onOpenSessionInMainWindow`，所以 modal 中按钮 disabled + tooltip。实际接通需要 settings page 顶层 ↔ app shell 集成
3. **Tool block 渲染** in `ReadOnlyTimelineViewer`：当前是简陋 fallback；需要复用 `MessagesTimeline` 的 `groupToolItems` + `ToolBlockRenderer` 链路
4. **测试中的 `act(...)` warning**（MoveToFolderPicker.test.tsx）：异步 fetch 状态过渡引起，断言全过，polish 阶段消除

### 已创建 / 修改但未 commit 的文件清单（git status 复核基线）

**新文件（13 个，全部在 `src/features/settings/components/settings-view/sections/sessionOrganization/`）：**
- `folderProjection.ts` + `folderProjection.test.ts`
- `sessionFilters.ts` + `sessionFilters.test.ts`
- `formatUpdatedAt.ts`
- `SessionFolderTree.tsx` + `SessionFolderTree.test.tsx`
- `OrganizationSessionList.tsx`
- `SessionOrganizationView.tsx` + `SessionOrganizationView.test.tsx`
- `SessionOrganizerModal.tsx` + `SessionOrganizerModal.test.tsx`
- `SubfolderCardGrid.tsx` + `SubfolderCardGrid.test.tsx`
- `ReadOnlyTimelineViewer.tsx` + `ReadOnlyTimelineViewer.test.tsx`
- `SessionDetailModal.tsx`
- `MoveToFolderPicker.tsx` + `MoveToFolderPicker.test.tsx`

**修改文件：**
- `src/features/settings/components/settings-view/sections/SessionManagementSection.tsx`（嵌入 viewMode toggle + 移动按钮 + handler）
- `src/i18n/locales/zh.part1.ts` + `en.part1.ts`（新增 ~50 个 key）
- `openspec/changes/add-session-organization-view/**`（已 ready，未 commit）

**严禁 commit**（plan §3 复核）：`.trellis/**`、`.omc/**`、`AGENTS.md`、host adapter、`package.json` 行尾差异

### 下一步

**等 `npm run build` 跑完**（vite build 阶段），若通过则 §9.1 三大门禁完成。剩余事项：

1. **§9.4 OpenSpec verify 阻塞** — 本机/仓库无 `openspec` 可执行。两个选项：
   - a. 全局/本地安装 OpenSpec CLI 再跑 `openspec validate --all --strict --no-interactive`
   - b. 跳过本地 verify、依赖 CI 校验（如果 CI 配置了的话）
2. **§9.3 PR 边界已核对**：modified 3 个文件 + untracked 2 类（`sessionOrganization/` 与 `openspec/changes/...`）需要进 commit；`.trellis/**`、`.omc/**`、`.trellis/workspace/whitea02/` 必须排除；commit 时按路径 `git add`，禁用 `git add -A`/`git add .`。
3. **§10 sync + archive** 在 PR 合并后由维护流程触发，本会话不动。

PR 标题 / 提交规范沿用 AGENTS.md「Git Commit Message」段（中文主体 Conventional Commits）。

---

## 6. 给新窗口 agent 的 onboarding 指引

如果你在新会话里读到这份文档：

1. **先读 §0 → §5**，再按需要看 §6 后的指引。`prd.md` 是背景资料，§1 是冻结决断。
2. **不要重新讨论 §1 的设计决断** — 用户已签字。
3. **不要重做 §2.4 的 trace** — 三件事已经验证过了，结论在 journal 2026-05-17。看 §5 摘要即可。
4. **PR 边界（§3）非常严格**，每次 staging 文件前都对一遍清单。
5. 用户偏好：简洁回复、中文主体、技术术语保留英文、不要混入不相关改动。
6. **§5 "已完成"清单是接力基线**。新窗口先 `git status` 复核 — 应当看到 §5 列的全部 untracked / modified 文件。若有偏差，先回放 journal 排查再开新工作。
7. **如果是接力执行下一步**，默认从 §5 "下一步"段开始（当前是 OpenSpec tasks §7）。除非用户另有指示。

任何对 §1 决断的反对意见，先和用户沟通再动，不要擅自变更。
