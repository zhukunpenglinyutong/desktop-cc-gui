// Production approval UI with synthetic requests; no CLI, native IPC or real grants.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import i18n from "../../src/lib/i18n";
import { ipc, type Message, type QuestionSpec } from "../../src/lib/ipc";
import { useChatStore } from "../../src/features/chat/store";
import { EMPTY_SESSION } from "../../src/features/chat/store/stream";
import { sessionKey } from "../../src/features/chat/store/persistence";
import { QuestionDock } from "../../src/features/chat/components/QuestionDock";
import { QuestionRecord } from "../../src/features/chat/components/QuestionCard";

type Kind = NonNullable<QuestionSpec["approval"]>["kind"];
const session = { engine: "codex", sessionId: "approval-fixture", workspacePath: "/project" };
const key = sessionKey(session.engine, session.sessionId, session.workspacePath);
let seq = 0;
let report: (value: string) => void = () => {};
ipc.answerQuestion = async (runId, requestId, answers) => {
  report(JSON.stringify({ runId, requestId, answers }, null, 2));
};

function request(kind: Kind) {
  const question = `Codex: ${kind} approval`;
  const details = kind === "command"
    ? { reason: "Stage the reviewed changes", command: "git add src/main.ts", cwd: "/project" }
    : kind === "file"
      ? { reason: "Update a shared configuration file", grantRoot: "/shared/project" }
      : { reason: "Fetch dependencies and write build artifacts", permissions: { network: { enabled: true }, fileSystem: { write: ["/shared/build"] } } };
  const message: Message = {
    seq: ++seq, role: "question", text: question, ts: null,
    question: {
      runId: `fixture-run-${seq}`, requestId: "0", toolUseId: null, status: "pending",
      questions: [{
        question, header: "Codex approval", allowOther: false,
        options: [{ label: "Allow once" }, { label: "Reject" }],
        approval: { kind, details },
      }],
    },
  };
  useChatStore.setState({ active: session, bySession: { [key]: { ...EMPTY_SESSION, messages: [message] } } });
  report("No answer sent");
}
request("command");

function Fixture() {
  const [answer, setAnswer] = useState("No answer sent");
  report = setAnswer;
  const messages = useChatStore((store) => store.bySession[key]?.messages ?? []);
  const button = "rounded border border-border-button-default px-3 py-1.5 text-caption-1-medium";
  return (
    <main className="min-h-screen bg-background-primary-default p-8 text-text-primary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <h1 className="text-body-medium">Codex approval</h1>
        <div className="flex flex-wrap gap-2">
          {(["command", "file", "permissions"] as const).map((kind) => (
            <button key={kind} className={button} onClick={() => request(kind)}>{kind}</button>
          ))}
          {(["zh", "en", "ko"] as const).map((language) => (
            <button key={language} className={button} onClick={() => void i18n.changeLanguage(language)}>{language}</button>
          ))}
        </div>
        <QuestionDock />
        {messages.filter((message) => message.question?.status !== "pending").map((message) => (
          <QuestionRecord key={message.seq} message={message} />
        ))}
        <pre id="answer" className="whitespace-pre-wrap text-caption-1-regular">{answer}</pre>
      </div>
    </main>
  );
}
createRoot(document.getElementById("fixture")!).render(<Fixture />);
