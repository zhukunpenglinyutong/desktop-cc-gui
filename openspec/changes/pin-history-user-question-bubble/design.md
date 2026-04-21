## Context

`Messages.tsx` 当前已经支持 realtime 场景下“仅最后一条 ordinary user question sticky”的展示逻辑，用于在 active turn 持续 streaming 时固定当前问题锚点。历史浏览的阅读模式不同：用户会沿着已经完成的多轮问答上下滚动，当前视口里的 assistant/reasoning/tool 内容通常属于某一条更早的用户问题，但这条问题会随着继续滚动离开顶部，导致阅读分段失去标题。

消息幕布本身已经是一个 `.messages` scroll container，并且每条消息都有独立 wrapper，因此它天然适合“章节标题 sticky”式交接：前一个标题吸顶，后一个标题滚到顶部后把前一个顶走。

本变更仍然是 frontend-only，不应影响 runtime command、history loader、message payload、copy text、storage schema 或 event contract。

## Goals / Non-Goals

**Goals:**

- 在历史浏览中，将 ordinary user question 作为 section header 参与顶部 sticky。
- sticky 切换严格跟随滚动位置，不做提前预测。
- 向下滚动和向上滚动都使用同一套物理规则。
- 保留 realtime sticky 能力的原有 contract，不让两种模式互相污染。
- 继续排除 agent task notification、memory-only user payload 等伪 user 消息。

**Non-Goals:**

- 不新增手动 pin/unpin UI。
- 不让 assistant、reasoning、tool message 参与 sticky。
- 不引入复制 DOM 的浮层副本。
- 不重写消息虚拟窗口或 scroll scheduling。
- 不改变历史折叠指示器、anchor rail、copy 行为的现有契约。

## Decisions

### Decision 1: History 模式使用“多 ordinary user wrapper 同时 sticky”的自然接棒模型

历史模式不再像 realtime 那样只给单条 message 挂 sticky class，而是让所有 ordinary user question wrapper 具备 sticky section-header 能力。浏览器会根据文档流自然完成“后一条到顶后接棒”的效果。

Alternatives considered:

- 复用 realtime 的“只选一条 sticky id”模式：无法表达向上/向下滚动时的自然接棒，必须引入额外 scroll 监听和判定逻辑。
- 用 IntersectionObserver / scroll math 手动计算当前标题：更复杂，也更容易出现抖动和边界漂移。

### Decision 2: Realtime sticky 优先级高于 history sticky

当对话仍处于 realtime processing 时，继续沿用现有 `pin-live-user-question-bubble` contract，只固定最后一条 ordinary user question。只有在非 realtime 浏览状态下，history section-header sticky 才接管。

这样可以避免在 active turn 中多个 user bubble 同时具备 sticky 资格，破坏当前“最后问题是实时锚点”的语义。

### Decision 3: 继续复用 ordinary-user 过滤契约

history sticky 与 realtime sticky 都必须基于同一套 ordinary user question 判定逻辑，排除：

- agent task notification user rows
- memory-only injected payload
- 空白或不构成真实用户问题的 user 文本

这样可以避免“历史里吸附了一条并不是真问题的 user 卡片”。

### Decision 4: 不为被窗口裁剪的历史消息制造 phantom sticky

当历史列表仍处于折叠窗口状态时，只允许已渲染到 DOM 中的 ordinary user question 参与 sticky。隐藏在 collapsed-history 之前的消息不应凭空成为顶部标题；用户点击显示更早消息后，sticky 范围再自然扩展到完整渲染窗口。

## Risks / Trade-offs

- 多个 sticky user wrapper 共存时，视觉层叠和背景衔接需要更稳。Mitigation: 复用现有 sticky wrapper 背景 separation，并在 history 模式下保持清晰 top inset / z-index。
- 超长用户问题会占用较多视口。Mitigation: 继续依赖现有 `CollapsibleUserTextBlock` 收敛高度。
- 与 collapsed-history、anchor rail、copy button 的叠加可能出现边界问题。Mitigation: 增加 dedicated scroll-behavior tests，覆盖裁剪窗口、history restore 和伪 user 过滤。

## Migration Plan

1. 新增 history sticky OpenSpec spec 与 tasks。
2. 在 `Messages.tsx` 区分 realtime sticky 与 history sticky 的渲染条件。
3. 复用 `messagesLiveWindow.ts` 中 ordinary user 判定逻辑，避免重复分叉。
4. 在 `messages.css` 增加 history section-header sticky 样式或将现有 sticky class 拆成 mode-specific contract。
5. 添加/扩展测试，覆盖向下接棒、向上回退、窗口裁剪和 realtime 优先级。

Rollback 仍然是纯前端回退：移除 history sticky 渲染条件、样式和测试即可，不涉及数据迁移。

## Open Questions

None for MVP. 当前方案明确采用“物理滚动位置驱动”的 A 方案，不做语义预测切换。
