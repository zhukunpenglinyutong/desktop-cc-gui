## Context

当前 `status-panel` 通过 selector 从当前线程 `ConversationItem[]` 中提取可展示的 user message。上一轮改造后已经能渲染时间线，但代码文件名与组件名仍保留 `LatestUserMessage*` 的历史命名，不利于后续维护；同时用户还需要从 dock 时间线快速跳回主幕布对应消息。

本次变更限定在 frontend `status-panel` feature 内，数据源仍然是 `StatusPanel` 已拿到的当前线程 `items`。因此不需要修改 runtime contract，也不需要引入新的持久化状态。

## Goals / Non-Goals

**Goals:**

- 将状态面板用户消息视图升级为 thread-scoped timeline。
- 保持当前线程范围、dock 限定、手动切换 tab 等既有约束不变。
- 保持文本与图片摘要能力，并让折叠/展开按单条消息独立工作。
- 支持从时间线项跳转到主幕布对应消息锚点。
- 让 selector / panel 命名与当前 timeline 语义一致。

**Non-Goals:**

- 不修改主幕布中的消息排序或 sticky 逻辑。
- 不添加 assistant / tool 混排时间线。
- 不增加跨线程聚合、搜索或分页。

## Decisions

### Decision 1: 复用现有 tab 和组件入口，只替换 selector contract

- 方案 A：保留 `latestUserMessage` 这个 tab identity，仅把数据模型从单 preview 升级为 timeline items。
- 方案 B：新建独立 tab type 和组件链路。
- 取舍：采用方案 A。这个能力仍然是同一个 dock 入口，只是行为升级；保留 tab identity 可以减少对可见性控制、默认 tab 选择和已有样式骨架的影响。

### Decision 2: 时间线顺序以当前 `items` 顺序为 canonical，再在 selector 中反转为新到旧

- 方案 A：假设 `items` 已按旧到新排列，selector 过滤后反转。
- 方案 B：为每条消息补显式 timestamp 后排序。
- 取舍：采用方案 A。当前 `ConversationItem.message` 没有 timestamp 字段，且现有 thread surface 普遍把 `items` 顺序当作时间线顺序。继续沿用该 contract，风险最小。

### Decision 3: 折叠状态按 message id 维护，而不是整个面板共享一个 expanded 布尔值

- 方案 A：每条消息独立折叠，使用 `Record<string, boolean>` 或 `Set<string>` 表示展开项。
- 方案 B：继续使用单一 `expanded` 状态。
- 取舍：采用方案 A。时间线下会有多条长消息，单一布尔值会把全部消息一起展开，交互语义错误。

### Decision 4: 跳转主幕布采用现有 DOM anchor contract，而不是新增跨层状态桥

- 方案 A：复用 `MessagesTimeline` 已存在的 `data-message-anchor-id`，在时间线项点击后直接滚动到对应 DOM 节点。
- 方案 B：新增 app-shell 级 callback，把 message id 通过 props 一路透传到 `Messages` 组件内部处理。
- 取舍：采用方案 A。现有主幕布已经稳定暴露消息锚点 DOM，直接复用可避免把这个需求升级成跨 feature / cross-layer 变更。

### Decision 5: 本轮同步完成语义重命名，避免 `LatestUserMessage*` 历史命名继续漂移

- 方案 A：仅保留行为修复，名字留待未来整理。
- 方案 B：在同一轮里把组件、selector、测试文件统一重命名为 `UserConversationTimeline*`。
- 取舍：采用方案 B。当前改动面仍然局限在 `status-panel` feature，顺手收敛命名成本低，能减少后续认知噪音。

## Risks / Trade-offs

- [Risk] DOM anchor 跳转依赖主幕布节点存在 → Mitigation：跳转逻辑在找不到锚点时 no-op，不影响状态面板其它能力。
- [Risk] 用户消息很多时，dock 面板长度增加 → Mitigation：保持轻量 DOM 结构，仅展示 user messages，并继续使用文本截断避免单条消息过高。
- [Risk] 基于 `items` 顺序推断时间线若未来被破坏会导致排序错误 → Mitigation：在 spec 与测试中显式固定“以当前线程 items 顺序为 canonical”的假设。

## Migration Plan

1. 更新 OpenSpec proposal/spec/tasks，明确从 latest preview 升级为 user conversation timeline。
2. 重构 selector，输出 timeline items（新到旧）。
3. 重构 panel 组件，支持多条消息渲染、逐条展开与主幕布锚点跳转。
4. 同步完成 selector / panel / test 文件的语义重命名。
5. 更新 i18n 文案与样式。
6. 补 focused tests 并运行 lint/typecheck/test。

Rollback strategy:

- 若发现时间线 UI 对 dock 信息密度影响过大，可回退到单条 preview selector 与单块 panel 渲染；该回退只影响 frontend 展示层，不涉及数据迁移。

## Open Questions

- 当前无阻塞性开放问题；“新到旧排序”和“用户对话”文案已由用户确认。
