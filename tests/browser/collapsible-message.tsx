// Open /tests/browser/collapsible-message.html with the Vite dev server
// running. Renders the real user-bubble stack (CollapsibleMessage inside the
// bubble) with a long pasted message and a short one, so the fade + chevron
// affordance can be checked without a model or session.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { CollapsibleMessage } from "../../src/features/chat/components/CollapsibleMessage";

const LONG_PASTE = `Curl with no cache & follow the canonical fix and false positive check recipe before fixing: https://react.doctor/docs/rules/react-doctor/dangerous-html-sink

Scope:
- Fix only react-doctor/dangerous-html-sink.
- Fix the root cause; do not suppress, disable, or silence the rule.
- Keep unrelated refactors out of this pass.

Affected sites:
- src/components/application/ai-chat/ai-chat-composer.tsx:198
- src/components/application/ai-chat/ai-chat-composer.tsx:228

Learn more: https://react.doctor/docs/rules/react-doctor/dangerous-html-sink

Verify with \`npx react-doctor@latest --verbose\` and confirm react-doctor/dangerous-html-sink is gone before moving on.

Checklist:
1. Reproduce the lint error locally.
2. Replace the dangerous HTML sink with a safe renderer.
3. Add a regression test for the sanitized path.
4. Re-run the rule and confirm zero hits.
5. Confirm no other rule regressed in the same file.

Notes:
- The composer renders markdown via a shared pipeline; reuse it.
- Do not introduce a new sanitizer dependency for this fix.
- Keep the diff minimal; follow-up refactors land separately.`;

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto w-fit max-w-[85%] rounded-xl bg-bubble-user px-3.5 py-2.5 text-left text-body-regular whitespace-pre-wrap break-words text-text-white">
      <CollapsibleMessage>{text}</CollapsibleMessage>
    </div>
  );
}

function Fixture() {
  return (
    <div className="min-h-dvh bg-background-primary-default px-4 py-8">
      <div className="mx-auto flex max-w-[750px] flex-col gap-8">
        <UserBubble text={LONG_PASTE} />
        <UserBubble text="短消息不需要收起。" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
