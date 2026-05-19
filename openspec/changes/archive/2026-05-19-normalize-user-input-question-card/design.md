# normalize-user-input-question-card Design

## Architecture

Question-card UI is centralized in `src/features/app/components/UserInputQuestionCard.tsx`.

The shared component owns presentation semantics only:

- header/title/timer/close affordance;
- fixed-width tab list for multi-question flows;
- single active question body;
- option grid, note/secret input, error and action area;
- step-action button labeling.

Engine-specific containers still own runtime state:

- `AskUserQuestionDialog.tsx` keeps modal/composer-overlay behavior and Claude/Codex plan-blocker specifics.
- `RequestUserInputMessage.tsx` keeps queue filtering, request draft state, timeout/dismiss lifecycle, and `respond_to_server_request` submission.
- `Messages.tsx` / `MessagesTimeline.tsx` decide where pending request cards appear in the message timeline.

## Key Decisions

1. Do not reuse `.bubble` for interactive question cards.
   - Normal chat bubbles intentionally cap at narrow readable width.
   - Question cards are forms and need a larger operation surface.

2. Treat `questions.length > 1` as step mode even if the caller does not explicitly pass `showStepActions`.
   - The user intent of a multi-question payload is progressive completion.
   - `Submit` before the final question is a misleading terminal action.

3. Keep tabs and body synchronized through `activeQuestionIndex`.
   - Only one question body renders at a time.
   - Manual tab clicks and `Next`/`Back` update the same state.

4. Keep close/dismiss local and explicit.
   - A timed-out or stale card must not become an unclosable surface.
   - A local dismiss hides the card even if the runtime no longer has a pending request handler.

## Risk Controls

- The shared component does not change the response payload shape.
- Request live card width uses `request-user-input-live-card` and `.request-user-input-message`, not `.bubble`.
- Existing submitted/history cards still use their own historical submitted styling.

