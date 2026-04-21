## Why

历史幕布在长对话里会出现明显的阅读断点：用户向上或向下滚动时，当前视口里的 assistant/reasoning/tool 内容已经属于某一轮问答，但对应的用户问题很容易滑出视口顶部，用户需要反复回拉才能确认“这段回答是在回答哪个问题”。

现有 `pin-live-user-question-bubble` 只解决 realtime processing 期间的当前 turn 锚点，不覆盖历史浏览。现在需要把“用户问题作为阅读分段标题”这件事扩展到 history scrolling 场景，让历史阅读也具备稳定、可预期的顶部锚点。

## 目标与边界

- 在历史浏览幕布中，ordinary user question 作为分段标题参与顶部 sticky。
- sticky 切换遵循物理滚动位置：下一条 ordinary user question 真正滚到顶部后接替上一条。
- 上下滚动都保持同一套规则，不做“智能预测当前语义块”的提前切换。
- 该能力只影响展示层，不改变 message payload、copy 内容、runtime event、history loader、storage schema。
- 保持现有 realtime sticky 能力独立存在，不把两个场景混成同一条 requirement。

## 非目标

- 不新增手动 pin/unpin 控件。
- 不让 assistant、reasoning、tool card 参与 sticky 顶部接棒。
- 不引入 overlay 副本 DOM 或浮动复制版本。
- 不改 Tauri command、持久化结构、线程恢复 contract。
- 不重做整套消息虚拟列表或滚动容器架构。

## What Changes

- 为历史幕布新增“按分段吸顶 ordinary user question”的行为定义。
- 当用户滚动浏览历史消息时，当前分段对应的 ordinary user question SHALL 吸附在消息视口顶部，直到下一条 ordinary user question 到达顶部后接棒。
- 上滚时 SHALL 恢复上一条 ordinary user question 的顶部吸附，保持对称、可预测的 section-header 行为。
- agent task notification、memory-only 注入消息、空 user payload 等非 ordinary user question SHALL 不参与顶部吸附。
- realtime processing 下的 `pin-live-user-question-bubble` 继续保留现有 contract；history sticky 不修改其 requirement，而是新增独立 capability。

## 技术方案对比

| 方案 | 做法 | 优点 | 风险/取舍 |
|---|---|---|---|
| A. CSS sticky + 普通 user 气泡自然接棒 | 历史视图中的 ordinary user question 保持在文档流中，使用 `position: sticky` 形成章节标题式接棒 | 行为直观、与滚动物理位置一致、无需复制 DOM、易于解释和测试 | 需要精确排除伪 user 消息，并处理窗口裁剪时的可见性 |
| B. 语义归属驱动的智能切换 | 根据当前视口主要内容属于哪轮问答，提前切换顶部问题 | 理论上更“聪明”，可减少临界区过渡 | 规则不透明，容易抖动，用户难以预判切换时机 |
| C. 顶部浮层复制当前问题 | 独立渲染一个 overlay，根据滚动状态同步内容 | 视觉控制力强 | 双份 DOM 容易造成 copy/selection/accessibility 漂移，状态同步复杂 |

选择方案 A。历史阅读更像文档章节导航，最重要的是稳定和可预期，而不是“猜用户现在在看哪一段”。

## Capabilities

### New Capabilities
- `conversation-history-user-bubble-pinning`: Defines section-header-style sticky behavior for ordinary user question bubbles while browsing conversation history.

### Modified Capabilities
- None.

## Impact

- Frontend component: `src/features/messages/components/Messages.tsx`
- Frontend helper: `src/features/messages/components/messagesLiveWindow.ts`
- Frontend style: `src/styles/messages.css`
- Tests: `src/features/messages/components/Messages.live-behavior.test.tsx` or a dedicated history-scroll behavior test file
- No backend/API/storage/runtime dependency changes

## 验收标准

- 历史浏览时，当前滚动分段对应的 ordinary user question 在触达顶部后保持 sticky。
- 继续向下滚动时，下一条 ordinary user question 到达顶部后接替 sticky；向上滚动时，上一条 ordinary user question 恢复 sticky。
- 切换规则基于实际滚动位置，不允许在下一条 user question 尚未到达顶部时提前切换。
- 非 ordinary user question（如 agent task notification、memory-only user payload）不参与 sticky 顶部吸附。
- realtime processing 的现有 sticky 行为保持不变，runtime/storage/history contract 无新增字段。
