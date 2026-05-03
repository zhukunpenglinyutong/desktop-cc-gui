# Execute Context Ledger Phase 1

## Goal

先把 `add-context-ledger` 做成一个真实、可验证、纯前端可落地的 Phase 1：基于现有 `Composer` / manual memory / compaction state 构建 `ContextLedgerProjection`，并交付一个不改变 send 行为的账本 surface。

## Linked OpenSpec Change

- `openspec/changes/add-context-ledger`

## Execution Position

- 本 task 必须先于 `05-03-task-center-phase1` 执行。
- 目标不是重写 prompt attribution protocol，而是把现有前端可观察真值投影成稳定 contract。

## Requirements

- 新增前端 `ContextLedgerProjection` builder，统一派生 recent-turn usage、compaction freshness、manual memories、note cards、file references，以及 provider-only attribution gap 的 `degraded/shared` markers。
- `Context Ledger` 与现有 Codex dual-view 复用同一份 usage / compaction snapshot，不允许因为新 surface 改变现有 send behavior。
- Phase 1 只允许消费前端现有可观察 source，不新增 backend prompt attribution protocol。
- project memory 在 Phase 1 仍然只允许表现“用户显式选择”的 truth；不得重新引入 hidden auto retrieval。
- ledger surface 必须提供 grouped blocks、total usage summary、truthful compaction status，以及 source/freshness/participation/degraded marker copy。

## Acceptance Criteria

- [ ] `ContextLedgerProjection` 可以从现有 composer / memory / thread reducer state 构建稳定 projection。
- [ ] provider-only attribution gaps 以明确 `degraded/shared` 标记呈现，而不是伪装成精确 attribution。
- [ ] 未打开 ledger 时，send behavior 与现有路径完全一致。
- [ ] project memory truth 仍以 manual selection 为准，没有偷偷恢复 auto injection。
- [ ] 有 focused tests 覆盖 projection builder、ledger rendering、dual-view shared snapshot 边界。
- [ ] `openspec validate add-context-ledger --strict --no-interactive` 通过。

## Technical Notes

- 优先新建：
  - `src/features/context-ledger/types.ts`
  - `src/features/context-ledger/utils/contextLedgerProjection.ts`
  - `src/features/context-ledger/utils/contextLedgerProjection.test.ts`
- 主要真值来源：
  - `src/features/composer/components/Composer.tsx`
  - `src/features/project-memory/utils/memoryContextInjection.ts`
  - `src/features/threads/hooks/useThreadsReducer.ts`
- 重点回归：
  - `src/features/composer/components/Composer.context-dual-view.test.tsx`
  - `src/features/threads/hooks/useThreadsReducer.compaction.test.ts`

## Verification

```bash
openspec validate add-context-ledger --strict --no-interactive
npm run lint
npm run typecheck
npm run test -- Composer.context-dual-view useThreadsReducer.compaction memoryContextInjection
```
