## 1. Spec 对齐

- [x] 1.1 回写 `project-memory-ui` delta，定义同一轮 memory summary card 只显示一次，输入 bubble 仅保留真实用户文本
- [x] 1.2 回写 `conversation-curtain-normalization-core` delta，定义 attributed `project-memory` wrapper canonicalization 与普通用户截图保留 contract

## 2. Normalization 修复

- [x] 2.1 更新 `conversationNormalization` 的 `project-memory` wrapper strip 规则，支持带 attributes 的 injected XML，并验证 optimistic user 与 authoritative user 的等价收敛
- [x] 2.2 为 memory summary 增加 same-turn suppress 机制，对齐 note-card context card 的 assistant-summary-first surface

## 3. Attachment 可见性修复

- [x] 3.1 收紧 note-card attachment filtering，只过滤已从当前消息 text 解析出的 injected attachment identities
- [x] 3.2 验证 history reopen / hydrate 路径下普通用户截图仍显示在用户图片网格中

## 4. Regression 验证

- [x] 4.1 补 `Messages` focused tests：memory summary dedupe、user bubble clean surface、普通截图保留
- [x] 4.2 补 `useThreadsReducer.normalized-realtime` focused test：带 attributes 的 `project-memory` authoritative user 替换 optimistic user
- [x] 4.3 运行最小验证集：focused Vitest，必要时补 `npm run typecheck`
