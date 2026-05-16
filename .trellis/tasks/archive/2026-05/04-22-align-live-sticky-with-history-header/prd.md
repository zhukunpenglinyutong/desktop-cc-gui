# Align Live Sticky With History Header

> **【2026-05-16 STATUS: MERGED INTO PHASE 3 OF `05-16-migrate-css-to-coss-ui`】**
> 本任务的 acceptance criteria（realtime/history 共用 sticky header、handoff、live trimming 保底等 4 条）已 carry-forward 到 coss UI 全量重构 task 的 Phase 3 DoD。
> 旧 CSS 体系即将被彻底替换，再单独做 split-style 类拆分已无意义。本任务 archive。

## Goal

把 realtime 用户问题吸顶从“原气泡 wrapper sticky”统一为与 history 一致的 condensed sticky header，并复用 history-style section handoff；同时保留 live window trimming 下对最新 ordinary user question source row 的 render-window 保底。

## Requirements

- realtime 与 history 使用同一种 sticky header 视觉与 DOM 语义
- realtime 对当前 rendered ordinary user sections 复用与 history 一致的 physical handoff 规则
- history section handoff 规则保持不变
- restored history、window trimming、pseudo-user 过滤继续正确
- 最新 ordinary user question 即使被 live window trimming 裁掉，也仍能重新参与 sticky 计算

## Acceptance Criteria

- [ ] realtime 不再渲染 `.messages-live-sticky-user-message`
- [ ] realtime/history 都通过同一条 sticky header 出口渲染
- [ ] realtime 回看更早 rendered sections 时，sticky header 会按 history-style handoff 接棒
- [ ] trimmed live latest question 仍然可以驱动 sticky header
- [ ] `Messages.live-behavior.test.tsx` 通过

## Technical Notes

- Primary files:
  - `src/features/messages/components/Messages.tsx`
  - `src/features/messages/components/MessagesTimeline.tsx`
  - `src/features/messages/components/messagesLiveWindow.ts`
  - `src/styles/messages.css`
  - `src/styles/messages.history-sticky.css`
  - `src/features/messages/components/Messages.live-behavior.test.tsx`
