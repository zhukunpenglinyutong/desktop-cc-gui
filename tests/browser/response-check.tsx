import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import i18n from "@/lib/i18n";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { ResponseCheckBadge } from "@/features/chat/components/response-check-badge";
import { MessageRow } from "@/features/chat/components/MessageTimeline";
import { checkResponseSelection } from "@/features/chat/response-check";
import { useChatStore } from "@/features/chat/store";
import { handleEngineEvents, type EngineEventDeps } from "@/features/chat/store/engine-events";
import { sessionKey } from "@/features/chat/store/persistence";
import { EMPTY_SESSION, runRouting } from "@/features/chat/store/stream";
import { modelDisplayName } from "@/features/settings/usage-model";

/**
 * Response-check fixture: drives the production pipeline (engine events →
 * store → tail indicator meta row) with synthetic `launch`/`served` payloads
 * and shows the badge it produces. The badge itself is the real component;
 * no model, IPC or saved conversation is involved.
 */

const SID = "response-check-fixture";
const KEY = sessionKey("omp", SID, "/tmp/fixture");
let runCounter = 0;

const deps: EngineEventDeps = {
  set: useChatStore.setState,
  get: useChatStore.getState,
  drainQueue: () => {},
  markUnseenIfBackground: () => {},
  upsertSessionMeta: () => {},
};

type Scenario = {
  label: string;
  events: ({ kind: "launch" | "served" | "done" } & Record<string, unknown>)[];
  expected: { verdict: string; visible: boolean };
};

const SCENARIOS: Record<string, Scenario> = {
  match: {
    label: "一致",
    events: [
      { kind: "launch", data: { model: "百倍baibei/claude-opus-5-5", effort: "xhigh" } },
      { kind: "served", data: { model: "claude-opus-5-5", effort: "xhigh" } },
    ],
    expected: { verdict: "match", visible: true },
  },
  mismatch: {
    label: "模型不一致",
    events: [
      { kind: "launch", data: { model: "gpt-6-astra", effort: "max" } },
      { kind: "served", data: { model: "gpt-5.6-luna", effort: "low" } },
    ],
    expected: { verdict: "mismatch", visible: true },
  },
  downgraded: {
    label: "档位降级",
    events: [
      { kind: "launch", data: { model: "claude-opus-5-5", effort: "xhigh" } },
      { kind: "served", data: { model: "claude-opus-5-5", effort: "high" } },
    ],
    expected: { verdict: "mismatch", visible: true },
  },
  variant: {
    label: "日期版本",
    events: [
      { kind: "launch", data: { model: "claude-opus-4-5", effort: "high" } },
      { kind: "served", data: { model: "claude-opus-4-5-20251101", effort: "high" } },
    ],
    expected: { verdict: "mismatch", visible: true },
  },
  daily: {
    label: "日构建版本",
    events: [
      { kind: "launch", data: { model: "ds4.1", effort: null } },
      { kind: "served", data: { model: "deepseek/ds4.1-1017", effort: null } },
    ],
    expected: { verdict: "mismatch", visible: true },
  },
  gateway: {
    label: "网关实际模型",
    events: [
      { kind: "launch", data: { model: "ds/deepseek-v4.1-flash", effort: "max" } },
      { kind: "served", data: { model: "deepseek/deepseek-v4.1-flash-1017", effort: null } },
    ],
    expected: { verdict: "mismatch", visible: true },
  },
  unreported: {
    label: "未上报",
    events: [{ kind: "launch", data: { model: "claude-opus-5-5", effort: "xhigh" } }],
    expected: { verdict: "unknown", visible: true },
  },
  settled: {
    label: "已结算",
    events: [
      { kind: "launch", data: { model: "gpt-6-astra", effort: "max" } },
      { kind: "served", data: { model: "gpt-5.6-luna", effort: "low" } },
      { kind: "done", data: {} },
    ],
    expected: { verdict: "mismatch", visible: true },
  },
};

function applyScenario(name: string) {
  runRouting.clear();
  const runId = `response-check-fixture-run-${++runCounter}`;
  useChatStore.setState({
    bySession: {
      [KEY]: {
        ...EMPTY_SESSION,
        streaming: true,
        turnStartedAt: Date.now() - 7000,
        // One assistant row for the settle path to stamp the check onto.
        messages: [
          { seq: 1, role: "user", text: "读一下 package.json", ts: null },
          { seq: 2, role: "assistant", text: "ok", ts: null, live: true },
        ],
      },
    },
    streamingByKey: {},
  });
  const scenario = SCENARIOS[name];
  handleEngineEvents(
    scenario.events.map((event, index) => ({
      runId,
      sessionId: SID,
      engine: "omp",
      seq: index + 1,
      kind: event.kind as "launch" | "served" | "done",
      data: event.data,
    })),
    deps,
  );
}

function Harness() {
  const session = useChatStore((s) => s.bySession[KEY]);
  const [scenario, setScenario] = useState("mismatch");
  const [dark, setDark] = useState(true);
  const [result, setResult] = useState("waiting");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    applyScenario(scenario);
  }, [scenario]);

  const view = checkResponseSelection(session?.responseCheck);
  useEffect(() => {
    const expected = SCENARIOS[scenario].expected;
    const ok = view.verdict === expected.verdict && view.visible === expected.visible;
    setResult(
      ok
        ? `PASS ${scenario}: ${view.verdict}${view.visible ? "" : " (hidden)"}`
        : `FAIL ${scenario}: got ${view.verdict}/${view.visible}, want ${expected.verdict}/${expected.visible}`,
    );
  }, [scenario, view.verdict, view.visible]);

  const model = session?.activeModel
    ? i18n.t("chat.metaModel", { model: modelDisplayName(session.activeModel) })
    : null;
  const effort = session?.activeEffort
    ? i18n.t("chat.metaEffort", { effort: session.activeEffort })
    : null;

  const settled = [...(session?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");

  return (
    <div className="min-h-screen bg-background-primary-default p-6 text-text-primary">
      <div className="flex flex-wrap gap-2">
        {Object.entries(SCENARIOS).map(([name, entry]) => (
          <button
            key={name}
            type="button"
            onClick={() => setScenario(name)}
            className={`rounded-md border border-border-button-default px-2 py-1 text-caption-1-medium ${name === scenario ? "bg-background-tertiary-hover" : ""}`}
          >
            {entry.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setDark((value) => !value)}
          className="rounded-md border border-border-button-default px-2 py-1 text-caption-1-medium"
        >
          {dark ? "light" : "dark"}
        </button>
      </div>
      <div data-testid="row" className="mt-6">
        <AgentThinking
          label={i18n.t("chat.thinking")}
          startedAt={session?.turnStartedAt ?? undefined}
          durationFormatter={(d) => i18n.t("chat.metaDuration", { duration: d })}
          usage="↑12.3k ↓412"
          model={model}
          effort={effort}
          metaExtra={<ResponseCheckBadge check={session?.responseCheck} />}
        />
      </div>
      {/* Settled row: the recorded check must survive the turn's end. */}
      <div data-testid="settled-row" className="mt-8">
        {settled ? (
          <MessageRow message={settled} workspacePath="/ws" turnFinal />
        ) : null}
      </div>
      <pre data-testid="settled-check" className="mt-2 text-caption-1-regular">
        {JSON.stringify(settled?.responseCheck ?? null)}
      </pre>
      <pre data-testid="result" className="mt-6 text-caption-1-regular">
        {result}
      </pre>
      <pre data-testid="check" className="mt-2 text-caption-1-regular">
        {JSON.stringify(session?.responseCheck ?? null)}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(<Harness />);
