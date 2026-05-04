## 1. Spec and guideline alignment

- [x] 1.1 Validate this OpenSpec change with `openspec validate extend-conversation-curtain-assembly-to-claude-gemini --strict`.
- [x] 1.2 Review `.trellis/spec/frontend/*` and update conversation curtain / streaming profile guidance after implementation decisions are proven.

## 2. Shared normalization and assembler tests

- [x] 2.1 Add Claude fixtures for long Markdown stream + completed snapshot + history replay, asserting one assistant row and stable final Markdown.
- [x] 2.2 Add Claude fixtures for `ExitPlanMode` and synthetic approval / file changes history replay, asserting no duplicate plan or approval rows.
- [x] 2.3 Add Gemini fixtures for assistant replay, reasoning replay, and tool snapshot replay, asserting stable visible row cardinality.
- [x] 2.4 Extend assembler tests so Claude / Gemini history hydrate goes through shared assembly helpers rather than raw loader rows.

## 3. Claude Code assembly integration

- [x] 3.1 Route `claudeHistoryLoader.ts` output through `ConversationAssembler.hydrateHistory()` or equivalent shared assembly boundary.
- [x] 3.2 Audit `claudeRealtimeAdapter.ts` outputs and normalize assistant、reasoning、tool snapshot、approval、ExitPlanMode observations for assembler consumption.
- [x] 3.3 Remove or thin any Claude loader/reducer-local duplicate comparator that now overlaps with shared normalization.
- [x] 3.4 Add focused tests for Claude realtime/history parity, approval card replay, plan card replay, and long Markdown completion.

## 4. Gemini assembly integration

- [x] 4.1 Route Gemini history hydrate through `ConversationAssembler.hydrateHistory()` or equivalent shared assembly boundary.
- [x] 4.2 Audit `geminiRealtimeAdapter.ts` and `geminiHistoryParser.ts` outputs for assistant、reasoning、tool observations.
- [x] 4.3 Replace Gemini adjacent reasoning merge comparator with shared reasoning equivalence helper or preserve fragments for assembler convergence.
- [x] 4.4 Add focused tests for Gemini realtime/history parity, reasoning cardinality, tool snapshot replay, and assistant replay.

## 5. Streaming presentation profile

- [x] 5.1 Document existing Codex presentation defaults as baseline without changing Codex behavior.
- [x] 5.2 Define or extend baseline presentation profile inputs and defaults for Claude Code、Gemini.
- [x] 5.3 Keep provider-scoped mitigation as an evidence-triggered override lane, separate from normal baseline profile defaults.
- [x] 5.4 Move Claude / Gemini Markdown throttle and reasoning pacing decisions behind baseline profile / provider-scoped mitigation helpers.
- [x] 5.5 Ensure waiting、ingress、stop affordance visibility remains stable under profile throttling.
- [x] 5.6 Add diagnostics for active mitigation reason and scoped rollback; baseline profile activation alone MUST NOT be reported as mitigation.

## 6. Migration gates

- [x] 6.1 Define independent migration gates for Claude and Gemini assembler paths, including default state、storage/setting ownership、diagnostic label、and removal condition.
- [x] 6.2 Verify rollback can disable Claude or Gemini assembler/profile integration without affecting Codex baseline or the other migrated engine.

## 7. Regression and gates

- [x] 7.1 Run focused Vitest suites for normalization、assembler、realtime adapters、history loaders、Messages streaming.
- [x] 7.2 Run `npm run typecheck`.
- [x] 7.3 Run `npm run test` or document why a narrower suite is sufficient.
- [x] 7.4 Run Codex baseline tests to prove no regression in existing normalization / assembler / staged markdown behavior.
- [x] 7.5 Run `npm run check:large-files` if `MessagesRows.tsx`、large CSS、or large thread files are touched.
