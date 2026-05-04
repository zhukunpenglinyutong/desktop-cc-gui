## Thread / Message / Composer Lifecycle Boundaries

### Current Boundary Inventory

| Boundary | Current owner | First-batch extraction | Stability contract |
|---|---|---|---|
| thread state reducer | `useThreadsReducer.ts` | 保持 reducer state shape 不变，仅继续把 pure derive / reconcile 逻辑从 hook 下沉到 `utils` | `useThreads` outward state/actions contract 不变 |
| pending thread reconciliation | `useThreads.ts` | 已抽到 `src/features/threads/utils/threadPendingResolution.ts` | pending -> finalized thread 绑定语义保持等价 |
| selected agent persistence | `useSelectedAgentSession.ts` + `selectedAgentSession.ts` | 已完成 pure helper 下沉与 flow test 覆盖 | agent selection 不跨 workspace/thread 泄漏 |
| selected composer persistence | `useSelectedComposerSession.ts` + `selectedComposerSession.ts` | 已完成 pure helper 下沉与 flow test 覆盖 | model/effort selection 在 pending->session finalize 后保持连续 |
| event handling / app-server listeners | `useThreadEventHandlers.ts`、`useAppServerEvents` | 暂不改 outward wiring，仅通过 focused tests 固化现有 lifecycle 结论 | processing/completed/error/recovery 不因 helper 抽取漂移 |
| streaming / completion / recovery | `useThreadMessaging.ts`、`useThreadStatus.ts`、message surfaces | 本批只补 focused contract evidence，不做大范围重写 | blocked / recovery / completion 结论保持一致 |

### First-Batch Extraction Order

1. `selectedAgentSession` pure helper
2. `selectedComposerSession` pure helper
3. `threadPendingResolution` pure helper
4. 后续再考虑 reducer slice / event normalization，而不是直接切 `useThreads` 主体

### Focused Evidence Replacing Large Integration Pressure

| Lifecycle concern | Focused evidence |
|---|---|
| pending thread -> finalized session continuity | `src/features/threads/hooks/useThreads.pendingResolution.test.ts` |
| selected agent continuity | `src/app-shell-parts/selectedAgentSession.test.ts` + `selectedAgentSession.flow.test.ts` |
| selected composer continuity | `src/app-shell-parts/selectedComposerSession.test.ts` + `selectedComposerSession.flow.test.ts` |
| persistent session key isolation | selected-agent / selected-composer flow tests（workspace-scoped key assertions） |

### Remaining Phase-2 Candidates

- `useThreads` 内部更细的 reducer-slice / event normalization 拆分
- `useThreadMessaging` 的 streaming settlement / recovery rule helper 化
- `Messages` / timeline surface 的 completion / blocked 状态 contract tests

### Guardrails

- 不在本批更改 `useThreads`、`useThreadActions`、`useThreadMessaging` 的 outward signature。
- 不引入新的 runtime bridge 调用路径。
- 所有 helper 抽取必须带 focused tests，避免只靠超大集成测试兜底。
