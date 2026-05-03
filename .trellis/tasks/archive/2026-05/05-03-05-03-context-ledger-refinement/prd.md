# Context Ledger refinement

## 目标

- 修复 `相比最近一次发送` 跨 session/thread 泄漏
- 把 `本轮上下文来源` collapsed header 压成单行
- 增加可恢复的 hidden drawer 交互，减少输入时的视觉打断

## 关联 OpenSpec

- `refine-context-ledger-session-boundaries-and-drawer`

## 实现范围

- `src/features/composer/components/Composer.tsx`
- `src/features/context-ledger/components/ContextLedgerPanel.tsx`
- `src/styles/composer.part2.css`
- ledger/composer focused tests
