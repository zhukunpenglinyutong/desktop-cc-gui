## Why

右下角状态面板当前仅提供“最新对话”的单条用户消息预览，适合快速 glance，但不适合回看当前线程内的用户提问脉络。现在需要把它升级为轻量时间线，让用户在不打断主幕布滚动位置的前提下查看当前线程的用户对话历史。

## 目标与边界

- 目标：把 dock 状态面板中的单条 latest preview 升级为当前 active thread 的用户对话时间线。
- 边界：仅修改 frontend `status-panel` 能力，不改 backend、thread storage、主幕布消息排序或跨线程聚合逻辑。

## 非目标

- 不新增 assistant 消息时间线。
- 不在 popover 版状态面板中复用该能力。
- 不引入搜索、筛选或分页。

## What Changes

- 将 dock 状态面板 tab 文案从“最新对话”调整为“用户对话”。
- 将 tab 内容从“当前线程最后一条用户消息预览”调整为“当前线程全部用户消息时间线”。
- 时间线按当前线程消息顺序反向展示，即最新消息在上、最旧消息在下。
- 每条时间线项继续支持文本内容与图片数量摘要。
- 长文本折叠/展开从“整个面板一条消息”调整为“逐条消息独立折叠/展开”。
- 每条时间线项提供跳转主幕布对应消息锚点的入口。
- 保持现有手动切换 tab 语义，不因新消息自动切换面板焦点。

## Capabilities

### New Capabilities

- `status-panel-user-conversation-timeline`: 定义 dock 状态面板中用户对话时间线的新增行为与展示契约。

### Modified Capabilities

- `status-panel-latest-user-message-tab`: 将原有“最后一条用户消息预览”能力升级为“用户对话时间线”，同时保留 dock scoped、手动查看与当前线程范围等约束。

## Impact

- Affected code:
  - `src/features/status-panel/components/StatusPanel.tsx`
  - `src/features/status-panel/components/UserConversationTimelinePanel.tsx`
  - `src/features/status-panel/utils/userConversationTimeline.ts`
  - `src/styles/status-panel.css`
  - `src/i18n/locales/*`
  - 相关 Vitest 测试文件
- APIs / backend: 无
- Dependencies: 无新增依赖
- Validation:
  - focused Vitest suites for `status-panel`
  - `npm run lint`
  - `npm run typecheck`
