# Design: Workspace Note Card Pool

## Context

当前产品已经有两类相邻但不等价的能力：

- chat/composer：适合即时发送，但不适合中途暂存灵感片段；
- `project-memory`：适合长期沉淀与结构化回看，但交互更偏“管理面板”。

这次需求需要的是第三种能力：一个贴近当前 workspace 的轻量 note surface，让用户在 vibecoding 过程中不离开当前上下文就能记、搜、归档、回引。

核心约束已经明确：

- 入口必须在右侧面板顶区，且继承现有显隐规则。
- 只做 `便签池` 与 `便签归档` 两个集合，不做复杂平台化 IA。
- 录入必须支持格式化文案和图片。
- 存储必须落地到 `~/.ccgui/note_card/<project-name>/active|archive`。
- composer 必须支持 `@#` 选择 note card 并引用。

## Goals / Non-Goals

**Goals:**

- 建立独立于 `project-memory` 的 `workspace note card` 轻量域模型。
- 在右侧面板内提供不会打断当前对话的 quick capture / search / archive flow。
- 用 file-based local storage 实现格式化正文与图片资产的 project-scoped 持久化。
- 在 composer 中增加 `@#` note reference 流程，并保持 `@` / `@@` 既有语义不回退。

**Non-Goals:**

- 不做 full document editor、多人协作、云同步、分享链接。
- 不做多级目录、复杂标签面板、批量运营后台、权限系统。
- 不把 note cards 合并进 `project-memory` 的 data model。

## Decisions

### Decision 1: note cards 与 project memory 保持两个独立 domain

`project-memory` 的目的在于长期知识沉淀、筛选和后续消费；note cards 的目的在于会话中途的即时捕捉与轻量回引。若强行复用同一 domain，会把“灵感草稿”和“长期知识”混成一层语义，最终 UI 与存储都会被拉向复杂管理面板。

因此本次采用独立 capability：

- `workspace-note-card-*` 只负责即时 note workflow。
- `project-memory-*` 保持原长期记忆职责，不被本提案重塑。

### Decision 2: 入口复用右侧面板顶区 action slot，而不是新开 modal 或新主导航

右侧面板已经承载 file/search 这类“贴着当前 workspace 的辅助上下文”。note cards 本质上也属于这一类，因此最自然的位置就是右侧面板顶区 action zone。

采用方式：

- 在右侧面板顶部 `PanelTabs/right-toolbar` icon 区新增 note icon，与 files/search 同域。
- 点击 icon 后切换右侧 surface 到 note cards，而不是打开 full-screen modal。
- 入口显隐跟随现有右侧面板 show/hide、compact、layout-swapped 规则，不再引入额外 UI state。

这样可以保证：

- 打开 note surface 不会打断当前 thread；
- 关闭右侧面板时，note surface 一起隐藏；
- UI 心智模型仍然只有“一块右侧辅助区”，不会裂变出第三套容器。

### Decision 3: 正文格式采用 Markdown-first，图片采用 local asset attachment

需求要求“正常文案格式能力”和“图片插入”，但又强调轻量。完整 WYSIWYG 太重，纯 plaintext 又不够。

因此采用：

- note 正文 canonical format = `bodyMarkdown`
- 查询 projection = `plainTextExcerpt`
- 图片资产 = 项目 note card 目录下的本地文件
- 编辑器 UI = Markdown-first + 常用格式化 affordance + inline preview

好处：

- 存储简单，可读，可迁移；
- 查询与引用都能直接消费 `bodyMarkdown/plainTextExcerpt`；
- 图片只保存本地引用，不需要造新的媒体服务。

补充交互约束：

- 编辑器需要支持在右侧面板内进入 expanded mode，让新增/编辑时正文区域优先占据高度。
- 图片预览不能只依赖 asset url；对于 `~/.ccgui/note_card/**` 这类非 workspace 根目录资源，UI 必须具备 local data-url fallback。

### Decision 4: 存储结构采用“按项目目录 + active/archive 双集合 + assets”布局

为贴合明确的路径要求，同时保持查询和归档简单，存储布局定为：

```text
~/.ccgui/note_card/<project-name>/
  active/
    <note-id>.json
  archive/
    <note-id>.json
  assets/
    <note-id>/
      <asset-file>
```

`<project-name>` 来源于当前项目名，并做 filesystem-safe sanitization，但仍保持“按项目名分目录”的用户心智。

每个 note 文档包含：

- `id`
- `title`
- `bodyMarkdown`
- `plainTextExcerpt`
- `attachments[]`
- `createdAt`
- `updatedAt`
- `archivedAt | null`

归档不是软标记列表过滤，而是 active/archive 集合切换，这样路径语义直观，也便于后续清理和恢复。

物理删除策略：

- delete 直接删除 active 或 archive 中对应的 note document。
- `assets/<note-id>/` 必须一起删除，避免残留 orphan image files。
- UI 必须明确提示“不可撤销”，但仍保持轻量，不引入复杂回收站。

### Decision 5: `@#` 引用采用“picker + chip + send-time injection”，而不是把全文回填 textarea

如果用户选中 note 后把全文直接塞回 textarea，会立刻破坏 composer 可读性，尤其是带图片和较长片段时。

因此采用：

- 输入 `@#` 打开 note picker。
- 选择后在 composer 展示 note chips / compact references。
- 真正发送时，再将选中 note 组装为结构化 note context block 注入本次请求。
- 发送成功后自动清空选择，保持 one-shot 语义。

这也能和现有 `@` 文件引用、`@@` memory 引用保持一致的“选择即挂载、发送时注入”设计方向。

### Decision 6: note 引用中的图片优先复用现有本地附件/路径引用链路

带图片的 note 被 `@#` 引用时，不能简单丢失图片语义，也不应为了引用再复制一份二进制。

处理策略：

- 若当前 engine/bridge 已支持本地图片附件引用，则优先复用该链路。
- 若当前发送路径不支持二进制图片附带，则在注入的 note context block 中保留稳定的本地图片引用元数据（路径、文件名、caption/alt）。

这样可以做到：

- note 自身的图片语义不丢；
- 不为 note reference 再造第二套上传系统；
- 不阻塞不同 provider 的既有发送路径。

## Risks / Trade-offs

- [Risk] 右侧面板顶区 action 过挤，新增 icon 后影响文件/搜索可读性
  - Mitigation：复用现有 action density 与 tooltip 规则；优先保证 icon-only 入口，避免额外文案占位。

- [Risk] 图片先插入后放弃保存，可能留下 orphan assets
  - Mitigation：区分 draft asset 与 committed asset；取消保存时清理未绑定文件，应用启动时补一次惰性清扫。

- [Risk] `@#` 引用多个长 note 时导致 prompt 膨胀
  - Mitigation：候选卡片显示摘要与图片数；composer chip 保持可移除；发送时使用结构化 note block，而不是任意冗长拼接。

- [Risk] active/archive 双目录如果只靠文件扫描，查询延迟可能抖动
  - Mitigation：返回 lightweight projection；图片查询永不读取二进制正文；必要时在模块内部维护小型 manifest/cache，但不把它暴露为产品能力。

## Migration Plan

1. 以 additive 方式引入 `workspace-note-card-*` capability，不改写现有 `project-memory` 数据。
2. 新增本地目录 `~/.ccgui/note_card/<project-name>/...`；首次使用某项目 note cards 时按需创建。
3. 右侧面板入口上线后，不影响未使用该功能的用户。
4. 若需要回滚，只需隐藏 note icon、停用对应 commands；本地 note 数据保留，不做 destructive 清理。

## Open Questions

- 暂无阻塞性 open question。
- 本提案已直接决定：`@#` 默认可搜 active 与 archive，但 active 排序优先，archive 必须显式带状态标记。
