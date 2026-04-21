## 1. OpenSpec And Task Context

- [x] 1.1 Verify proposal/design/spec artifacts are complete and apply-ready. Input: `openspec/changes/pin-history-user-question-bubble/*`. Output: OpenSpec status shows `tasks` ready for apply. Validation: `openspec status --change pin-history-user-question-bubble`.
- [x] 1.2 Create and start a Trellis task linked to `pin-history-user-question-bubble`. Input: change id and frontend scope. Output: `.trellis/tasks/*` current task bound to this change. Validation: `python3 ./.trellis/scripts/task.py list`.

## 2. Core Implementation

- [x] 2.1 Separate realtime sticky and history sticky eligibility in `Messages.tsx`. Input: rendered timeline, `isThinking`, `conversationState.meta.historyRestoredAtMs`, ordinary-user predicates. Output: realtime continues pinning only the latest ordinary user question, while non-realtime history browsing enables section-header sticky candidates. Validation: component tests cover realtime priority and non-realtime history eligibility.
- [x] 2.2 Reuse or extend ordinary user question filtering in `messagesLiveWindow.ts` so history sticky excludes agent task notifications, memory-only payloads, and empty user rows. Input: existing `findLatestOrdinaryUserQuestionId` helper and user presentation normalization. Output: shared predicate contract for realtime/history sticky. Validation: targeted tests assert pseudo-user rows never become sticky headers.
- [x] 2.3 Add history section-header sticky styling in `src/styles/messages.css`. Input: existing `.messages` scroll container and sticky wrapper styles. Output: ordinary user question wrappers hand off naturally at the top boundary during history scrolling without overlay duplication. Validation: visual DOM assertions and manual scroll check.
- [x] 2.4 Preserve collapsed-history and rendered-window behavior. Input: current `buildRenderedItemsWindow(...)` flow and collapsed indicator logic. Output: only rendered user rows participate in sticky handoff, with no phantom sticky header from hidden history items. Validation: regression test for collapsed-history + expanded-history boundaries.

## 3. Verification

- [x] 3.1 Add regression tests for downward handoff, upward handoff, no-early-switch behavior, pseudo-user exclusion, and realtime-priority coexistence. Input: `Messages.live-behavior.test.tsx` or a dedicated history-scroll test file. Output: failing-before/passing-after coverage for the new capability. Validation: `pnpm vitest run src/features/messages/components/Messages.live-behavior.test.tsx`.
- [x] 3.2 Run required frontend quality gates for changed files. Input: messages component/style/test changes. Output: passing targeted test, typecheck, and large-file guard or documented blocker. Validation: `npm run typecheck`, `npm run check:large-files`, plus targeted Vitest command.
- [x] 3.3 Validate the OpenSpec change after implementation. Input: completed artifacts and implementation outcome. Output: strict validation passes for the change. Validation: `openspec validate pin-history-user-question-bubble --type change --strict --no-interactive`.

## 4. Delivery Follow-up

- [x] 4.1 Sync implementation notes back into OpenSpec/Trellis records. Input: merged code changes and validation results. Output: updated task checklist, linked Trellis task state, and ready-to-archive change artifacts. Validation: `openspec status --change pin-history-user-question-bubble` and Trellis task status reflect completion.

## Validation Notes

- `openspec status --change pin-history-user-question-bubble --json`: proposal/design/specs/tasks all ready before apply, and all marked done after implementation.
- `python3 ./.trellis/scripts/task.py create "Pin history user question bubble (OpenSpec: pin-history-user-question-bubble)" --slug pin-history-user-question-bubble`: created `.trellis/tasks/04-21-pin-history-user-question-bubble/`.
- `python3 ./.trellis/scripts/task.py start 04-21-pin-history-user-question-bubble`: set the Trellis current task to this change.
- `pnpm vitest run src/features/messages/components/Messages.live-behavior.test.tsx`: passed, 27 tests.
- `npm run typecheck`: passed.
- `npm run check:large-files`: passed, threshold `3000`, found `0`.
