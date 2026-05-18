# Plan: Session Organizer UX Fixes (2026-05-17)

> 这份计划是上一轮「会话整理 modal」的视觉 / 交互 polish，独立可执行。新会话窗口的 agent **先完整读这份文档 + 同目录的 prd / 上下文段 §2**，再按 §6「实现指引」逐文件落地。这是 polish 任务，**不动 OpenSpec 行为契约**（modal isolation surface 与双面板布局已 spec 化，本任务在其内做视觉与交互优化）。

---

## 0. 一句话目标

修复用户在实测中发现的 3 个具体问题，让会话整理 modal 真正可用：detail modal 不被 organizer modal 遮、子专题创建入口看得见、文件夹名与会话数视觉分得开，并补齐多级专题（股票/行业/个股/...）的深度展示。

---

## 1. 上下文（必读前置）

- 上游 brainstorm：`.trellis/tasks/05-13-session-tree-view-brainstorm/plan.md` + `prd.md`
- 当前实现（已 commit 候选）：
  - `src/features/settings/components/settings-view/sections/SessionManagementSection.tsx`
  - `src/features/settings/components/settings-view/sections/sessionOrganization/`（13 个 .tsx/.ts 文件 + .test）
- OpenSpec change：`openspec/changes/add-session-organization-view/`（含 design.md Decision 8 = modal isolation surface；spec.md「Organization Surface MUST Open As A Dedicated Modal」requirement）
- 整理 modal 入口：`设置 → 项目管理 → 会话管理 → 顶部「会话整理」按钮`
- 上一轮门禁：vitest 482/482、tsc 零错误、lint 静默通过、build ✓ 36.67s
- **PR 边界沿用 plan §3**：进 commit 的仅 `src/.../sessionOrganization/` + `SessionManagementSection.tsx` + `i18n/{zh,en}.part1.ts` + `openspec/changes/add-session-organization-view/`；`.trellis/**` / `.omc/**` / host adapter / `AGENTS.md` 严禁 commit。

---

## 2. 待解决的 3 个问题（根因 + 修法）

### 问题 1：单击会话后弹出的 SessionDetailModal 被 organizer modal 遮住

**根因（已定位）**

- `SessionDetailModal.tsx:114` 用 `zIndex: 1000`
- `SessionOrganizerModal.tsx` 用 `zIndex: 1050`
- `MoveToFolderPicker.tsx` 用 `zIndex: 1100`
- 三者全部 portal 到 `document.body`，浏览器按 z-index 渲染。Detail modal 最低 → 被 organizer 盖住。

**修法（无设计决断，按数值修）**

- `SessionDetailModal.tsx` 的 backdrop `zIndex` 由 `1000` 改为 `1150`
- 验证 layering：organizer(1050) < move picker(1100) < detail modal(1150)
- detail modal 关闭后焦点回到 organizer modal（已是默认行为，无需额外代码）

**验收**

- 在 organizer modal 内点会话标题 → detail modal 出现在 organizer **之上**且 backdrop 覆盖 organizer
- 在 organizer modal 内打开 move picker → picker 仍在 organizer 之上
- 同时打开 organizer + detail modal 时，detail modal 的 backdrop 点击仅关闭 detail modal（不冒泡到 organizer backdrop）—— stopPropagation 已经在各 dialog 内部生效，z-index 修复后不需要额外改

### 问题 2：子专题创建入口不显眼 + 多级专题深度看不清

**根因（已定位）**

- 每个 folder 行右侧其实有 `FolderPlus` / `Pencil` / `Trash` 三个按钮（`SessionFolderTree.tsx:270-380`），但：
  - 尺寸 12px 图标 / 1.25rem × 1.25rem 容器
  - `background: transparent`、无 hover 反馈
  - 紧贴行尾，与 count 数字粘在一起
  - 用户实测后认为「只能在顶部按钮创建根节点」
- 多级嵌套缩进只有 `0.75rem`/级，无视觉 guide line
- 顶部「新建专题」按钮**永远创建根**，与「选中专题再新建」直觉不符

**修法（用户已锁定 Q1 = 始终可见图标按钮 + 行级 hover 高亮 + 顶部新建按钮上下文化；Q3 = guide lines + 大缩进 + breadcrumb + 展开/折叠全部）**

视觉 / 交互调整：

1. **行级 hover 高亮**
   - row 容器加 `hover:bg-accent/40`（Tailwind）或等价 inline style with React state；选中态保持现有高亮样式
   - 行高从内嵌的 `0` padding 改成 `padding-block: 0.25rem` 让 hover 区域稍厚

2. **始终可见的图标按钮 + 加大 hit area**
   - 三按钮尺寸从 `1.25rem` 改成 `1.5rem`、图标 12 → 14
   - 默认 `opacity: 0.6` + `background: transparent`；hover button 时 `opacity: 1` + `background: var(--accent, rgba(0,0,0,0.06))`
   - 与 count 之间留 `0.5rem` 间隔，与边缘留 `0.25rem`
   - 保留现有 `data-tree-action="true"` 与 testid 不变（兼容现有 12 个 SessionFolderTree 测试）

3. **顶部「新建」按钮上下文化**
   - 当 selection.kind === "folder" 时：label = `t("settings.sessionOrganizerCreateSubfolderButton")`（zh: "新建子专题"，en: "New subfolder"），创建 child of selectedFolderId
   - 当 selection.kind === "unfiled" 或无选中时：label = `t("settings.sessionOrganizationCreateRootFolderButton")`（沿用旧 key "新建专题"），创建 root
   - 用户视觉上能看到「我现在按下去会创建在哪儿」
   - data-testid 保留：`session-organization-tree-add-root` 沿用；新加 `session-organization-tree-add-contextual` 作为别名（如选择不同 testid 也可）

4. **多级深度 guide lines + 大缩进**
   - 每级缩进 `0.75rem` → `1.25rem`
   - 子节点 `<ul>` 加 `border-inline-start: 1px solid var(--border, rgba(0,0,0,0.08))`、`margin-inline-start: 0.5rem`、`padding-inline-start: 0.75rem`
   - guide line 颜色用 muted（low contrast，避免视觉噪音）
   - row 与 guide line 之间用 padding 而不是 margin，避免错位

5. **顶部 breadcrumb**
   - 树 nav 顶部、在「新建」按钮上方加一行 breadcrumb，渲染当前选中节点的完整路径
   - `selection.kind === "unfiled"` 时显示 `"📥 未分类"` 单段
   - `selection.kind === "folder"` 时显示 `"📁 股票 ▸ 行业 ▸ 个股"`，通过 `projection.folderById` 反向 walk parentId
   - testid：`session-organization-tree-breadcrumb`
   - 长路径用 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`

6. **展开 / 折叠全部**
   - tree toolbar（新建按钮一行）加 `「展开全部」`、`「折叠全部」` 两个小按钮（无图标也可，icon 可选 `ChevronsDownUp` / `ChevronsUpDown`）
   - 展开 = `setCollapsedFolderIds(new Set())`
   - 折叠 = `setCollapsedFolderIds(new Set(allFolderIdsWithChildren))`；helper 通过遍历 projection 算出
   - testid：`session-organization-tree-expand-all` / `session-organization-tree-collapse-all`
   - 仅在 `projection.rootFolders.length > 0` 时显示，否则按钮 disable 或 hide

**验收**

- 任意层级 folder 行 hover 时 row 整体有视觉反馈
- 任意层级 folder 行右侧 3 个按钮 default 半透明、hover 不透明 + 背景
- 点 row 任意位置（除按钮）= 选中；点 + = 创建子；点 ✎ = 重命名；点 🗑 = armed delete
- 顶部「新建」按钮 label 随 selection 动态切换；点击行为也跟 label 一致
- 多级嵌套时左侧能看到 vertical guide line，缩进足够区分层级
- breadcrumb 渲染当前选中路径，长路径不撑爆树宽度
- 展开全部 → 所有 children 都展开；折叠全部 → 所有 children 折叠

### 问题 3：文件夹名 + 数字会话数视觉粘连

**根因（已定位）**

- `SessionFolderTree.tsx:380-400` 行渲染：`<span name>{name}</span><span count>{count}</span>`
- 无 gap、同色、同字号
- 文件夹名为「111」、count = 3 → 渲染成「1113」

**修法（用户已锁定 Q2 = 中点分隔 + 暗色：`股票 · 3`）**

- 在 name 与 count 之间插入分隔符：`<span aria-hidden style={{margin: "0 0.375rem", opacity: 0.4}}>·</span>`
- count 文字用 `opacity: 0.55` + `font-variant-numeric: tabular-nums` 让数字宽度稳定
- count 不再用单独的 badge / bracket，靠中点 + 暗色区分
- 保持 count testid 不变：`session-organization-tree-folder-${id}` row 仍渲染 count；count 自身可以保留 aria-label（用于 SR 念出）
- 未分类虚拟节点也同步使用 `· N` 格式

**视觉示例**

```
📁 股票 · 3
📁 111 · 12
📁 这是一个很长的专题名字 · 7
```

**验收**

- 数字文件夹名（如「111」）+ 数字 count 不再粘连
- 中点颜色暗于文字，readable hierarchy 是「主名 > 中点 > 数字」
- 屏幕阅读器仍能正确念出「stocks, 3 direct sessions」（aria-label 保留）

---

## 3. 用户锁定的设计决断（不要再讨论）

> 这些是 2026-05-17 与用户当面对齐的结论，不要在新窗口里重新征求意见。

| # | 决断 | 选项 |
|---|---|---|
| Q1 | 子专题创建入口 | 始终可见的图标按钮 + 行级 hover 高亮 + 顶部「新建」按钮上下文化 |
| Q2 | 会话数视觉分隔 | 中点 + 暗色：`股票 · 3` |
| Q3 | 多级深度展示 | Guide lines + 大缩进 + 顶部 breadcrumb + 展开/折叠全部 |
| Q4 | 落盘位置 | `.trellis/tasks/05-17-session-organizer-ux-fixes/plan.md`（本文件） |

---

## 4. 范围（v1.1 polish）

### 必须做
- 问题 1/2/3 全部修
- 现有 51 个 vitest 测试保持全绿
- tsc / lint / build 全绿
- 中英 i18n 同步增减 key

### 不做
- 不重做 modal 整体架构（Decision 8 已锁）
- 不引入拖拽 / 右键菜单（Decision 5 仍然适用）
- 不动后端 / Tauri command
- 不动 SessionDetailModal 的内容渲染逻辑，**只**改 zIndex
- 不重写 MoveToFolderPicker、SubfolderCardGrid、OrganizationSessionList、ReadOnlyTimelineViewer
- 不动 sidebar、catalog 视图

---

## 5. PR 边界 / Commit 规范

### 必须 commit
- `src/features/settings/components/settings-view/sections/sessionOrganization/SessionFolderTree.tsx`（主要改动）
- `src/features/settings/components/settings-view/sections/sessionOrganization/SessionDetailModal.tsx`（zIndex）
- `src/features/settings/components/settings-view/sections/sessionOrganization/SessionFolderTree.test.tsx`（追加用例）
- `src/i18n/locales/zh.part1.ts` + `en.part1.ts`（新增 contextual create button / breadcrumb / expand-all i18n key）
- 若动到 `SessionOrganizerModal.tsx`（如 modal body 加 breadcrumb），同步 commit + 测试

### 严禁 commit（继承上游 plan §3）
- `AGENTS.md`、`.trellis/**`（含本文件）、`.omc/**`、`.codex/**`、`.claude/**`
- `package.json` / `Cargo.toml` / `package-lock.json` 的非功能性差异（行尾、版本号）
- 无关 bugfix / 重构

### Commit message
- 中文主体 Conventional Commits（沿用 `AGENTS.md`「Git Commit Message」段）
- 建议：`fix(settings): 修复会话整理 modal 的视觉与多级专题创建交互`

---

## 6. 实现指引（按文件 + 顺序）

> 推荐顺序：先修 zIndex（影响小，立即可见效果）→ 再做 count 中点（最小代码 + 用户高优）→ 再做行级 hover + 上下文按钮 → 最后 guide lines + breadcrumb + expand-all。

### 6.1 `SessionDetailModal.tsx`（z-index 修复）

- 仅修一行：backdrop style 中 `zIndex: 1000` → `zIndex: 1150`
- 不动其它任何逻辑

测试：
- 现有 `ReadOnlyTimelineViewer.test.tsx` 不动；detail modal 没有独立 .test.tsx，z-index 改动属于 layering 修复，不必新增测试
- 视觉手测在 §7 验收清单里

### 6.2 `SessionFolderTree.tsx`（主要改动）

**新加 props（保持向后兼容，全部 optional）：**
```ts
type SessionFolderTreeProps = {
  // ... existing props
  // 无新增 props；breadcrumb 与 expand-all 数据完全由现有 props 派生
};
```

**新加 / 改造内部状态：**
- 无需新 state；breadcrumb 通过 `projection.folderById` + `selection` 派生
- expand-all / collapse-all 通过 `onToggleCollapse` 多次调用 OR 添加新 prop `onSetCollapsedFolderIds?: (ids: ReadonlySet<string>) => void`（推荐后者，一次性 batch 更新；如此则 `SessionOrganizationView` 也要新增对应 setter pass-through）

**改造 renderActionButtons：**
- 三个 button 容器尺寸：1.25rem → 1.5rem，图标 12 → 14
- 默认 style：`opacity: 0.6`；hover：`opacity: 1, background: var(--accent, rgba(0,0,0,0.06))`
  - inline style 不支持 `:hover`，需切换到 Tailwind utility 或 React state 管理 hover
  - **推荐**：使用 Tailwind 类（项目已用 Tailwind，见 SessionManagementSection 中的 `flex flex-wrap gap-2` 用法），class 形如：
    ```
    className="inline-flex items-center justify-center w-6 h-6 rounded
               opacity-60 hover:opacity-100 hover:bg-accent/60
               focus-visible:opacity-100 transition-opacity"
    ```
  - 仍保留 `data-tree-action="true"` 与 `data-testid`
- 与 count 之间靠 `marginInlineStart: 0.5rem`（容器层），与 row 边缘 `marginInlineEnd: 0.25rem`

**改造行渲染：**
- 现有 row 容器（`<div role="treeitem" style={{...indentStyle, display: "flex", alignItems: "center"}}>`）：
  - 加 `padding-block: 0.25rem`
  - 加 Tailwind hover 类 `hover:bg-accent/40 rounded transition-colors`
  - 与选中态 `is-selected` 不冲突
- name + count 之间插入中点：
  ```tsx
  <span className="...name">{node.folder.name}</span>
  <span aria-hidden style={{ margin: "0 0.375rem", opacity: 0.4 }}>·</span>
  <span
    className="...count"
    style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}
    aria-label={t("settings.sessionOrganizationFolderCount", { count })}
  >
    {node.directEntryCount}
  </span>
  ```

**改造缩进 + guide lines：**
- 缩进常量从 `0.75rem` 改成 `1.25rem`：所有 `paddingInlineStart: \`${0.5 + depth * 0.75}rem\`` → `${0.5 + depth * 1.25}rem`
- 子节点 `<ul role="group" className="session-organization-tree-children">` inline style 加：
  ```js
  {
    borderInlineStart: "1px solid var(--border, rgba(0,0,0,0.08))",
    marginInlineStart: "0.5rem",
    paddingInlineStart: "0.75rem",
    listStyle: "none",
    padding: 0,
  }
  ```

**顶部 toolbar 重构：**

当前 toolbar 只有「新建专题」一个按钮 + actionError；扩展为：

```
┌──────────────────────────────────────────────────────────┐
│ Breadcrumb: 📁 股票 ▸ 行业 ▸ 个股                          │  data-testid="session-organization-tree-breadcrumb"
├──────────────────────────────────────────────────────────┤
│ [+ 新建专题 / 新建子专题]   [⇕ 展开全部] [⇣ 折叠全部]      │
├──────────────────────────────────────────────────────────┤
│ (actionError 仍然在这一行下方)                            │
└──────────────────────────────────────────────────────────┘
```

实现关键点：
- breadcrumb 派生：
  ```ts
  const breadcrumb = useMemo(() => {
    if (selection.kind === "unfiled") {
      return [t("settings.sessionOrganizationUnfiledNodeLabel")];
    }
    const segments: string[] = [];
    let cursor = projection.folderById.get(selection.folderId);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.folder.id)) {
      seen.add(cursor.folder.id);
      segments.unshift(cursor.folder.name);
      const parentId = cursor.folder.parentId?.trim();
      cursor = parentId ? projection.folderById.get(parentId) : undefined;
    }
    return segments;
  }, [projection.folderById, selection, t]);
  ```
- breadcrumb 渲染：`segments.join(" ▸ ")`，外层 `<div data-testid="session-organization-tree-breadcrumb" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", opacity: 0.7, padding: "0.25rem 0.5rem" }}>...`

- 顶部按钮 label 上下文化：
  ```tsx
  const contextualLabel = selection.kind === "folder"
    ? t("settings.sessionOrganizerCreateSubfolderButton")
    : t("settings.sessionOrganizationCreateRootFolderButton");
  const contextualParentId = selection.kind === "folder" ? selection.folderId : null;
  // 在 button onClick 里调用 beginCreate(contextualParentId)
  ```

- expand-all / collapse-all：
  ```ts
  const allCollapsibleIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (node: FolderProjectionNode) => {
      if (node.children.length > 0) ids.push(node.folder.id);
      node.children.forEach(walk);
    };
    projection.rootFolders.forEach(walk);
    return ids;
  }, [projection.rootFolders]);
  ```
  - 需要新加 `onSetCollapsedFolderIds?: (ids: ReadonlySet<string>) => void` prop（让父组件 batch 替换 state，避免多次触发 reducer）
  - 或者保留 `onToggleCollapse` 反复调用（简单但 N 次重渲染；折叠 100 个 folder 时会卡）
  - **推荐**：新加 `onSetCollapsedFolderIds`；`SessionOrganizationView` 内的 `setCollapsedFolderIds` 直接 pass through

### 6.3 `SessionOrganizationView.tsx`（pass-through 适配）

- 加 `setCollapsedFolderIds` 的 pass-through prop 给 SessionFolderTree
- 其余不变

### 6.4 i18n（zh.part1.ts + en.part1.ts）

新增 key：

**zh:**
```
sessionOrganizerCreateSubfolderButton: "新建子专题",
sessionOrganizationTreeBreadcrumbLabel: "当前选中路径",
sessionOrganizationTreeExpandAll: "展开全部",
sessionOrganizationTreeCollapseAll: "折叠全部",
sessionOrganizationTreeBreadcrumbSeparator: " ▸ ",
```

**en:**
```
sessionOrganizerCreateSubfolderButton: "New subfolder",
sessionOrganizationTreeBreadcrumbLabel: "Current selection path",
sessionOrganizationTreeExpandAll: "Expand all",
sessionOrganizationTreeCollapseAll: "Collapse all",
sessionOrganizationTreeBreadcrumbSeparator: " ▸ ",
```

（separator 用 i18n key 避免硬编码 unicode，方便 locale 调整）

### 6.5 SessionFolderTree.test.tsx（追加 / 修订用例）

**保留**（不动）：现有 12 个测试（CRUD / 编辑器 / 行为）全部要继续 pass。

**追加**（建议至少 5 个）：

1. `renders contextual top button label when a real folder is selected`
   - 给 selection = `{kind: "folder", folderId: "alpha"}`
   - 断言顶部按钮的 testid 仍是 `session-organization-tree-add-root` 但 textContent 不再是「新建专题」key（或新加 data-context attr 验证）

2. `clicking the contextual top button creates child under the selected folder`
   - selection = `{kind: "folder", folderId: "alpha"}`
   - fireEvent.click 顶部按钮 → fireEvent.change input → submit
   - 断言 onCreateFolder called with `("alpha", "newName")`

3. `clicking expand-all replaces collapsedFolderIds with empty set`
   - 给 onSetCollapsedFolderIds mock
   - 渲染含 3 个有 children 的 folder、初始全 collapsed
   - 点 expand-all → 断言 mock called with `new Set()`

4. `clicking collapse-all replaces collapsedFolderIds with the ids of every folder with children`
   - 渲染含 3 个有 children 的 folder
   - 点 collapse-all → 断言 mock called with `new Set(["f1","f2","f3"])`

5. `renders breadcrumb of the current selection path`
   - 渲染嵌套结构 `alpha > beta > gamma`，selection = gamma
   - 断言 `session-organization-tree-breadcrumb` 的 textContent 含 "alpha" / "beta" / "gamma"

6. （可选）`row hover does not interfere with action button hit area`
   - fireEvent.mouseEnter on row → fireEvent.click on add button
   - 断言 onSelectionChange 未被调用，beginCreate 走通

### 6.6 SessionOrganizerModal（可能不动）

如果 breadcrumb / expand-all 都放在 tree 内部，modal 不需要改动。
若想把 breadcrumb 提升到 modal header（让它更显眼），则改 modal header 副标题区。**推荐**：保留在 tree 内部，避免 modal 与 tree 双重源。

---

## 7. 验收 / 门禁

### 视觉手测（必须在浏览器里跑一遍）

1. 设置 → 项目管理 → 会话管理 → 点「会话整理」按钮
2. modal 弹出，左栏树有 breadcrumb + 顶部按钮 + 展开/折叠 toolbar
3. 创建多级专题：股票 → 行业 → 个股 → 财报，验证 guide line 与缩进
4. 给文件夹起名「111」，count = 3，验证「111 · 3」可读
5. hover row → row 整体高亮 + 三按钮 opacity = 1
6. 点 + → 在该专题下创建子专题（contextual create）
7. 选中某专题 → 顶部按钮 label 变成「新建子专题」+ 创建到该专题下
8. 点击某会话标题 → detail modal 出现在 organizer 之上（z-index 修复）
9. 点击展开全部 / 折叠全部，验证批量行为
10. 长路径 / 多级别下 breadcrumb 不撑爆 modal 宽度

### 自动化门禁
- `npx vitest run src/features/settings/components/settings-view/sections/sessionOrganization/` → 51 + 新增 ≥ 5 个用例全部绿
- `npx tsc --noEmit` → 零错误
- `npm run lint` → 静默通过
- `npm test` → 全量 482+ 全绿
- `npm run build` → exit 0

### PR 边界终检
- `git status` 仅看到 §5「必须 commit」列出的路径
- `git diff --stat` 无 `package.json` / `Cargo.toml` / `package-lock.json` 行尾噪声
- 严禁路径全部 untracked 但 `git add` 时按文件名手动选择

---

## 8. 给新窗口 agent 的 onboarding

1. **先读本文件 §0 → §7**，再视需要看上游 brainstorm（`.trellis/tasks/05-13-session-tree-view-brainstorm/plan.md`）。
2. **不要重新讨论 §3 决断** —— 用户已签字。
3. **不要扩散范围**：仅 §6 列出的文件 + §2 列出的修复。其它逻辑（detail modal 内容、move picker、catalog 视图、sidebar）一律不动。
4. PR 边界（§5）非常严格，每次 staging 前都对一遍清单。
5. 用户偏好：简洁回复、中文主体、技术术语保留英文、不要混入无关改动。
6. **接力执行顺序**：§6.1 → §6.4 → §6.2 → §6.3 → §6.5 → 自动化门禁 → 视觉手测。
7. 实测 modal 时如果 hover affordance 不够强，可与用户商量加 `transition`、调高 hover background 透明度（属于在 §3 决断内的微调，不需要重新规划）。
8. 任何超出本计划 §2 / §3 / §4 范围的需求 → 不擅自做；先和用户确认或在 plan.md 写一段 follow-up。

---

## 9. 当前进度

> 本文件落盘时**未开始任何代码改动**。新窗口 agent 接力时按 §6 推荐顺序执行。

- [ ] §6.1 SessionDetailModal z-index 1000 → 1150
- [ ] §6.2 SessionFolderTree 主体改造（中点 / hover / always-visible / 上下文按钮 / guide lines / breadcrumb / expand-all）
- [ ] §6.3 SessionOrganizationView pass-through `setCollapsedFolderIds`
- [ ] §6.4 i18n zh + en 新增 5 个 key
- [ ] §6.5 SessionFolderTree.test.tsx 追加 ≥5 个用例
- [ ] §7 自动化门禁全套
- [ ] §7 视觉手测（10 项）

---

## 10. 参考链接

- 上游 brainstorm plan：`.trellis/tasks/05-13-session-tree-view-brainstorm/plan.md`
- 上游 brainstorm prd：`.trellis/tasks/05-13-session-tree-view-brainstorm/prd.md`
- OpenSpec design：`openspec/changes/add-session-organization-view/design.md`（Decision 8）
- OpenSpec spec delta：`openspec/changes/add-session-organization-view/specs/workspace-session-organization-view/spec.md`
- 当前 SessionFolderTree：`src/features/settings/components/settings-view/sections/sessionOrganization/SessionFolderTree.tsx`
- 当前 SessionDetailModal：`src/features/settings/components/settings-view/sections/sessionOrganization/SessionDetailModal.tsx`（zIndex 在 line 114）
- 当前 SessionOrganizerModal：`src/features/settings/components/settings-view/sections/sessionOrganization/SessionOrganizerModal.tsx`
