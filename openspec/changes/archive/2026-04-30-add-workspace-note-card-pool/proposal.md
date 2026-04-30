# Proposal: Add Workspace Note Card Pool

## Why

在 vibecoding 过程中，灵感片段、待验证命令、临时方案和截图证据经常出现在会话中途。现有 chat input 太瞬时，`project-memory` 又偏长期知识沉淀与管理语义，两者都不适合“先记下来、稍后再用”的即时捕捉场景。

因此需要一个更轻的 `workspace note card` 能力：就在客户端内、贴着当前 workspace、可随手记、可快速搜、可通过 `@#` 回引到对话，但不演变成传统后台或复杂知识库。

## 目标与边界

### 目标

- 在客户端内提供 project-scoped 的便签录入、查询、归档能力。
- 支持格式化文案编辑与图片插入，满足灵感片段、草稿方案、截图证据记录。
- 在右侧面板顶区新增 note icon 入口，位置与文件夹/搜索区域同层，并继承现有显隐规则。
- 在对话输入框中支持 `@#` 触发便签选择与引用，减少复制粘贴。
- 将便签数据持久化到用户电脑 `~/.ccgui/note_card/<project-name>/` 下，并按 `active` / `archive` 分目录管理。

### 边界

- 首期只提供两个集合：`便签池` 与 `便签归档`，不做文件夹树、看板、审批流、多层标签体系。
- 首期坚持 local-first 与 file-based storage，不引入云同步、数据库或服务端依赖。
- 首期不替代 `project-memory`；note cards 关注“即时灵感与片段”，memory 继续承担“长期知识沉淀”。
- 首期不做多人协作、评论、共享链接、版本历史。

## 非目标

- 不做传统管理平台式的多列表、多表头、多筛选矩阵界面。
- 不做完整文档系统或重型 WYSIWYG editor。
- 不做自动把所有 note 注入对话的隐式行为；引用必须是显式 `@#` 选择。
- 不做跨项目聚合搜索首页；查询范围限定在当前项目 note cards。

## What Changes

- 新增右侧面板 note icon 入口：
  - 入口位于文件夹、搜索同一顶区 action zone。
  - 入口使用现有右侧面板 show/hide、compact、layout-swapped 规则，不额外创造第二套显隐状态。
- 新增轻量 `Note Card Surface`：
  - 默认展示 `便签池`，可切换 `便签归档`。
  - 保持 side-surface 语义，不打开 full-screen modal，不打断当前会话。
  - 列表使用 card-first 扫描体验，而不是 admin table。
- 新增快速录入能力：
  - 支持标题与正文快速录入。
  - 支持常用格式化文案能力（heading、list、quote、code block、bold/italic、line break）。
  - 支持图片上传、粘贴、拖拽插入，并提供预览/移除。
  - 编辑态支持在右侧面板内展开到更高可用高度，避免被列表持续挤压。
  - 标题可选；为空时由首条有效文本生成回退标题。
- 新增查询与归档能力：
  - 在 `便签池` 与 `便签归档` 内分别提供关键词查询。
  - 支持把活跃 note 一键归档，以及把 archive note 恢复回 pool。
  - 支持对 active 或 archived note 执行物理删除，并同步清理该 note 的本地图片资产。
  - 查询结果以标题、摘要、更新时间、图片数量等轻量信息展示。
- 新增本地存储契约：
  - 持久化目录为 `~/.ccgui/note_card/<project-name>/active/` 与 `~/.ccgui/note_card/<project-name>/archive/`。
  - 图片资产保存在项目 note card 目录内，不与聊天附件目录混放。
- 新增 `@#` note reference：
  - 在 composer 输入 `@#` 打开 note picker。
  - 候选支持标题/正文搜索，活跃 note 优先，归档 note 带状态标记。
  - 选中后以 chip/reference 形式附着在本次消息上，而不是把全文直接塞回 textarea。
  - 发送时系统一次性注入所选 note 的正文与图片引用元数据，发送完成后自动清空选择。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险 / 成本 | 结论 |
|---|---|---|---|---|
| A | 直接复用 `project-memory` 面板，扩成“便签模式” | 复用现有 CRUD 与存储底座 | `project-memory` 交互偏管理面板，过重；会把“即时灵感”与“长期知识”混在一起 | 不采用 |
| B | 新建独立的 `workspace note card` 轻量能力，右侧面板承载，复用现有 Tauri/file-based 模式 | 场景贴合、改动边界清晰、最符合“快速记录/快速找到/快速引用” | 需要新增 storage contract、composer reference source 和新 surface | **采用** |
| C | 直接做完整笔记中心（目录树、标签、模板、看板、历史版本） | 长期上限高 | 明显偏离“轻量、不打断当前流程”的目标，产品和实现都过重 | 不采用 |

## Capabilities

### New Capabilities

- `workspace-note-card-pool`: 定义右侧面板 note icon、便签池/归档 surface、快速录入、查询与归档恢复交互。
- `workspace-note-card-storage`: 定义 `~/.ccgui/note_card/<project-name>/` 本地存储布局、格式化正文与图片资产持久化契约。
- `composer-note-card-reference`: 定义 `@#` 触发、候选选择、引用 chip 与发送时注入 note 内容的语义。

### Modified Capabilities

无。

## 验收标准

- 用户 MUST 能在客户端内新建便签，并保存到当前项目的 note card pool。
- 便签录入 MUST 支持图片插入与常用格式化文案能力。
- 便签数据 MUST 落到 `~/.ccgui/note_card/<project-name>/active/` 与 `archive/` 目录体系。
- 用户 MUST 能在 `便签池` 与 `便签归档` 中分别进行查询。
- 用户 MUST 能把活跃便签归档，并把归档便签恢复回活跃池。
- 用户 MUST 能对便签执行物理删除，且删除后对应本地图片资产一起被清理。
- 右侧面板顶区 MUST 提供新的 note icon 入口，并与现有右侧面板显隐行为保持一致。
- 对话输入框输入 `@#` 时 MUST 能搜索并选择便签内容进行引用。
- 方案 MUST 保持轻量，不得演变成传统后台或复杂管理平台。

## Impact

- Frontend:
  - `src/features/layout/components/PanelTabs.tsx`
  - `src/features/layout/hooks/useLayoutNodes.tsx`
  - `src/features/composer/hooks/useComposerAutocomplete.ts`
  - `src/features/composer/hooks/useComposerAutocompleteState.ts`
  - `src/features/composer/components/Composer.tsx`
  - `src/features/composer/components/ChatInputBox/ChatInputBox.tsx`
  - `src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.tsx`
  - `src/features/composer/components/ChatInputBox/ChatInputBoxFooter.tsx`
  - 新增 `src/features/note-cards/**`
  - `src/features/client-ui-visibility/utils/clientUiVisibility.ts`
  - i18n locale files
- Backend:
  - `src-tauri/src/app_paths.rs`
  - `src-tauri/src/command_registry.rs`
  - 新增 `src-tauri/src/note_cards/**` 或等价模块
  - `src/services/tauri.ts` / `src/services/tauri/*`
- Storage:
  - `~/.ccgui/note_card/<project-name>/active/`
  - `~/.ccgui/note_card/<project-name>/archive/`
  - `~/.ccgui/note_card/<project-name>/assets/`
