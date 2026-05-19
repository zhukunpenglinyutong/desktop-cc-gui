# normalize-user-input-question-card Proposal

## Why

Claude Code `AskUserQuestion` and Codex `RequestUserInput` used adjacent but drifting UI contracts. The drift caused:

- stale or timed-out question cards to remain as sticky bottom UI without a reliable close path;
- multi-question cards to show `Submit` before the user reached the final question;
- request cards to reuse normal chat `.bubble` width rules, making interactive forms too narrow and visually inconsistent;
- Claude/Codex question card fixes to be applied in separate places, increasing regression risk.

## What Changes

- Normalize Claude `AskUserQuestionDialog` and Codex `RequestUserInputMessage` onto a shared `UserInputQuestionCard` rendering contract.
- Render multiple questions as tabs with one active question body at a time.
- For multi-question cards, show `Next` before the final tab and show `Submit` only on the final tab.
- Provide a close/dismiss affordance on active question cards.
- Keep live request cards anchored in the message timeline near their originating tool/message item, not as a permanently sticky bottom card.
- Use a dedicated request-card width class instead of reusing normal chat `.bubble` width constraints.

## Scope

- In scope: frontend card rendering, timeline placement, tab navigation semantics, close affordance, i18n copy, and regression tests.
- Out of scope: backend `respond_to_server_request` payload format, runtime policy for when engines decide to ask questions, and completed-answer history rendering beyond existing submitted-summary behavior.

## Verification

- `src/features/app/components/AskUserQuestionDialog.test.tsx`
- `src/features/app/components/RequestUserInputMessage.test.tsx`
- `src/features/messages/components/chatCanvasSmoke.test.tsx`
- `npm run lint`
- `npm run typecheck`
- `npm run check:large-files`

