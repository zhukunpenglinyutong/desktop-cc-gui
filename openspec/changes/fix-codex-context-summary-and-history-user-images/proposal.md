## Why

Codex 手动记忆引用进入发送链后，实时幕布会同时出现 assistant 侧的 `记忆上下文摘要` 卡片和一条仍携带 injected memory wrapper 的 user bubble，导致同一轮多出一段重复展示。与此同时，历史会话里的普通用户截图在 reopen / history hydrate 后出现不可见回归，怀疑与 note-card 引用阶段引入的图片去重逻辑误伤正常附件有关。

现在需要把这两类问题收敛成同一个 `conversation curtain normalization` 修复 change：一方面确保记忆摘要在 realtime 与 authoritative user payload 收敛时只显示一次，另一方面恢复历史会话中普通用户截图的可见性，避免 note-card 去重规则继续侵蚀非 note-card 附件。

## 目标与边界

- 目标：修复 Codex 手动记忆引用时的 summary 重复渲染，保证 user bubble 只显示真实输入文本。
- 目标：恢复历史会话中普通用户截图/附件缩略图的可见性，不再被 note-card image filtering 误删。
- 目标：把这两个行为沉淀成 OpenSpec contract，覆盖 realtime、authoritative payload、history hydrate 三条路径。
- 边界：本 change 仅覆盖 frontend conversation curtain normalization / render surface，不改 backend command、存储 schema 或 memory/note-card 数据模型。
- 边界：本 change 不重新设计 project memory 或 note-card 的发送协议，只修复现有 contract 的收敛与可见性回归。

## 非目标

- 不调整 `记忆上下文摘要` 或 `便签上下文` 卡片的视觉样式。
- 不修改 note-card picker、memory picker、composer 输入交互本身。
- 不扩展到 Claude / Gemini / OpenCode 的其他历史会话问题，除非共享 normalization contract 直接受影响。

## What Changes

- 修复 `记忆上下文摘要` 在 Codex realtime 幕布中的双份展示，要求同一轮 assistant summary item 与 injected user wrapper 只能收敛为一张 summary card。
- 放宽 user message normalization 对 `project-memory` wrapper 的 canonicalization，覆盖带 attributes 的 XML 注入块，而不只识别裸 `<project-memory>`。
- 收紧 note-card 图片去重边界：只允许 suppress 经过证明属于 injected note-card attachment 的图片，普通用户截图必须继续显示。
- 为上述行为补回归测试，覆盖 optimistic user -> authoritative user 收敛、summary card 去重、history reopen 用户截图可见性。

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `project-memory-ui`: 记忆摘要卡片在 realtime 与历史兼容展示中新增“同一轮只显示一张等价 summary card”的约束。
- `conversation-curtain-normalization-core`: user message normalization 与 attachment filtering 需要正确 canonicalize attributed project-memory wrappers，并保证普通用户截图不会被 note-card 去重误隐藏。

## Impact

- Affected frontend:
  - `src/features/messages/components/messagesMemoryContext.ts`
  - `src/features/messages/components/messagesUserPresentation.ts`
  - `src/features/messages/components/Messages.tsx`
  - `src/features/messages/components/MessagesTimeline.tsx`
  - `src/features/messages/components/MessagesRows.tsx`
  - `src/features/messages/components/messagesNoteCardContext.ts`
  - `src/features/threads/assembly/conversationNormalization.ts`
- Affected tests:
  - `src/features/messages/components/Messages.test.tsx`
  - `src/features/messages/components/Messages.note-card-context.test.tsx`
  - `src/features/threads/hooks/useThreadsReducer.normalized-realtime.test.ts`
- Dependencies / APIs:
  - 不引入新的外部依赖
  - 不改变 Tauri command 或 persisted payload schema

## Acceptance

- Codex 手动记忆引用的一轮发送中，幕布 MUST 只显示一张 `记忆上下文摘要` 卡片，且 user bubble MUST 只保留真实输入文本。
- authoritative user payload 即使包含带 attributes 的 `<project-memory ...>` wrapper，也 MUST 能替换掉等价的 optimistic user bubble，而不是形成两条并列 user row。
- 历史会话 reopen 后，普通用户截图 MUST 继续显示为用户附件缩略图；仅 note-card 注入附件可被去重出普通图片网格。
