## 1. Spec And Contract Alignment

- [x] 1.1 更新 proposal / design / delta spec，明确 `最新对话` 升级为 `用户对话` 时间线。输入：现有 status-panel latest spec 与用户确认的排序/命名；输出：可 apply 的 OpenSpec artifacts；验证：`openspec status --change status-panel-user-conversation-timeline`
- [x] 1.2 校对 Trellis task PRD 与 OpenSpec change 语义一致。输入：任务目标与范围；输出：PRD 落盘；验证：人工审阅 `.trellis/tasks/05-04-dock-user-conversation-timeline/prd.md`

## 2. Frontend Timeline Implementation

- [x] 2.1 重构 status-panel selector，输出按新到旧排序的用户消息时间线数据。输入：当前线程 `ConversationItem[]`；输出：timeline item 数组；验证：selector unit tests 覆盖多条消息、图片-only、空态
- [x] 2.2 重构 dock 面板组件，使其按时间线渲染多条用户消息并支持逐条展开/收起。输入：timeline item 数组；输出：列表式 panel UI；验证：component tests 覆盖多条消息顺序与独立展开
- [x] 2.3 更新 tab 文案、空态与样式 contract。输入：现有 i18n key 和 status-panel CSS；输出：`用户对话` 文案与 timeline styles；验证：StatusPanel focused tests + 样式人工检查
- [x] 2.4 为时间线项增加“跳到主幕布消息锚点”的交互。输入：时间线 message id 与现有 `data-message-anchor-id` DOM contract；输出：可点击的跳转入口；验证：component test 覆盖命中锚点与缺失锚点
- [x] 2.5 将 `LatestUserMessage*` 相关 selector / panel / tests 重命名为 `UserConversationTimeline*` 语义。输入：当前 status-panel 时间线实现；输出：一致的文件名与导出名；验证：`rg -n "LatestUserMessagePanel|latestUserMessage"` 仅保留 i18n/tab identity 等必要历史兼容点

## 3. Validation

- [x] 3.1 更新 targeted tests，确保其它 dock tabs 行为不回退。输入：现有 `StatusPanel` / `UserConversationTimelinePanel` tests；输出：新增或调整断言；验证：`npx vitest run src/features/status-panel/utils/userConversationTimeline.test.ts src/features/status-panel/components/UserConversationTimelinePanel.test.tsx src/features/status-panel/components/StatusPanel.test.tsx`
- [x] 3.2 运行 lint 与 typecheck，确认改动不破坏前端契约。输入：完成后的 frontend 改动；输出：通过的质量门禁；验证：`npm run lint && npm run typecheck`
- [x] 3.3 追加验证锚点跳转与重命名后的 focused tests。输入：更新后的 timeline panel/test 文件；输出：通过的 focused Vitest；验证：`npx vitest run src/features/status-panel/utils/userConversationTimeline.test.ts src/features/status-panel/components/UserConversationTimelinePanel.test.tsx src/features/status-panel/components/StatusPanel.test.tsx`
