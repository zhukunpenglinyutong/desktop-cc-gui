import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Message, PlanReview } from "@/lib/ipc";
import { sessionKey, useChatStore } from "../store";
import { EMPTY_SESSION, type SessionState } from "../store/stream";
import { SessionScope, useScopedSession } from "../split/session-scope";
import { useTabModelDisplay } from "./use-tab-model-display";
import { usePendingQuestion } from "./QuestionDock";
import { usePendingPlanReview, usePlanReviewGateActive } from "./PlanReviewDock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACTIVE = { engine: "codex", sessionId: "visible", workspacePath: "/synthetic" };
const OTHER = { ...ACTIVE, sessionId: "background" };
const KEY = sessionKey(ACTIVE.engine, ACTIVE.sessionId, ACTIVE.workspacePath);
const OTHER_KEY = sessionKey(OTHER.engine, OTHER.sessionId, OTHER.workspacePath);
const MODELS = { codex: "default-model" };
const EFFORTS = { codex: "medium" as const };
const PROVIDERS = {};
let renders = 0;

function Probe() {
  renders++;
  const active = useScopedSession();
  const { displayModels, displayEfforts } = useTabModelDisplay({
    active,
    activeEngine: "codex",
    sessionKey: active ? sessionKey(active.engine, active.sessionId, active.workspacePath) : "",
    models: MODELS,
    efforts: EFFORTS,
    providers: PROVIDERS,
  });
  const question = usePendingQuestion();
  const plan = usePendingPlanReview();
  const gate = usePlanReviewGateActive();
  return <output>{JSON.stringify({
    model: displayModels.codex,
    effort: displayEfforts.codex,
    question: question?.seq ?? null,
    plan: plan?.seq ?? null,
    gate,
  })}</output>;
}

function planReview(status: PlanReview["status"]): PlanReview {
  return {
    planId: "plan", revision: 1, status, engine: ACTIVE.engine,
    sessionId: ACTIVE.sessionId, workspacePath: ACTIVE.workspacePath,
    runId: "run", title: "Synthetic plan", content: "Synthetic content",
    contentHash: "hash", complete: true, reviewKind: "native_request",
    nativePlanId: null, execPermission: "manual", execution: "not_started",
    decisionIntentAt: null, appliedAt: null, createdAt: 1, updatedAt: 1,
    supersededBy: null,
  };
}

function questionMessage(seq: number, status: NonNullable<Message["question"]>["status"]): Message {
  return {
    seq, role: "question", text: "Synthetic question", ts: null,
    question: { requestId: "question", runId: "run", questions: [], status },
  };
}

function countedHistory(length: number) {
  const reads = { model: 0, effort: 0, question: 0, planReview: 0 };
  const messages = Array.from({ length }, (_, seq): Message => ({
    ...questionMessage(seq, "answered"),
    get model() { reads.model++; return null; },
    get effort() { reads.effort++; return null; },
    get question() { reads.question++; return { requestId: "past", runId: "past", questions: [], status: "answered" as const }; },
    get planReview() { reads.planReview++; return undefined; },
  }));
  return { messages, reads, reset: () => { for (const field of Object.keys(reads) as Array<keyof typeof reads>) reads[field] = 0; } };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  renders = 0;
  useChatStore.setState({
    active: ACTIVE, openTabs: [ACTIVE, OTHER], activeEngine: "codex",
    bySession: {
      [KEY]: { ...EMPTY_SESSION, streaming: true },
      [OTHER_KEY]: { ...EMPTY_SESSION, streaming: true },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useChatStore.setState({ active: null, openTabs: [], bySession: {} });
});

function patch(key: string, fields: Partial<SessionState>) {
  act(() => useChatStore.setState((s) => ({
    bySession: { ...s.bySession, [key]: { ...s.bySession[key], ...fields } },
  })));
}

function shown() { return JSON.parse(container.querySelector("output")!.textContent!); }

describe("session history selector isolation", () => {
  it("does not rescan 2000 unchanged rows for 100 background stream updates", () => {
    const history = countedHistory(2000);
    patch(KEY, { messages: history.messages, activeModel: "known-model", activeEffort: "high" });
    act(() => root.render(<Probe />));
    history.reset();
    const before = renders;

    for (let i = 0; i < 100; i++) {
      patch(OTHER_KEY, { messages: [{ seq: i, role: "assistant", text: "中文🙂", ts: null, live: true }] });
    }

    expect(renders).toBe(before);
    expect(history.reads).toEqual({ model: 0, effort: 0, question: 0, planReview: 0 });
  });

  it("does not rescan or rerender for unrelated state and same-session usage updates", () => {
    const history = countedHistory(20);
    patch(KEY, { messages: history.messages });
    act(() => root.render(<Probe />));
    history.reset();
    const before = renders;

    patch(KEY, { usage: { inputTokens: 10 } });
    act(() => useChatStore.setState({ drafts: { [OTHER_KEY]: "draft" } }));

    expect(renders).toBe(before);
    expect(history.reads).toEqual({ model: 0, effort: 0, question: 0, planReview: 0 });
  });

  it("keeps narrow results while observing appended and replaced message arrays immediately", () => {
    act(() => root.render(<Probe />));
    const before = renders;
    patch(KEY, { messages: [{ seq: 1, role: "assistant", text: "中文🙂", ts: null }] });
    expect(renders).toBe(before);

    const question = questionMessage(2, "pending");
    const plan: Message = { seq: 3, role: "plan_review", text: "plan", ts: null, planReview: planReview("awaiting_review") };
    const history = [{ seq: 1, role: "assistant", text: "reply", ts: null, model: "history-model", effort: "low" }, question, plan];
    patch(KEY, { messages: history });
    expect(shown()).toEqual({ model: "history-model", effort: "low", question: 2, plan: 3, gate: true });

    patch(KEY, { activeModel: "reported-model", activeEffort: "high" });
    expect(shown()).toMatchObject({ model: "reported-model", effort: "high" });
    patch(KEY, { activeModel: null, activeEffort: null });
    expect(shown()).toMatchObject({ model: "history-model", effort: "low" });

    patch(KEY, { messages: [history[0], questionMessage(2, "answered"), { ...plan, planReview: planReview("approved") }] });
    expect(shown()).toEqual({ model: "history-model", effort: "low", question: null, plan: null, gate: false });
  });

  it("invalidates approval results when resume or streaming changes without replacing history", () => {
    const messages: Message[] = [{ seq: 1, role: "plan_review", text: "plan", ts: null, planReview: planReview("deferred") }];
    patch(KEY, { messages });
    act(() => root.render(<Probe />));
    expect(shown()).toMatchObject({ plan: null, gate: true });

    patch(KEY, { planReviewResume: "plan:1" });
    expect(shown()).toMatchObject({ plan: 1, gate: true });
    patch(KEY, { streaming: false });
    expect(shown()).toMatchObject({ plan: 1, gate: false });
    patch(KEY, { planReviewResume: null });
    expect(shown()).toMatchObject({ plan: null, gate: false });
    patch(KEY, { streaming: true });
    expect(shown()).toMatchObject({ plan: null, gate: true });
    expect(useChatStore.getState().bySession[KEY].messages).toBe(messages);
  });

  it("switches session history and honors a split pane's own session", () => {
    patch(OTHER_KEY, { messages: [{ ...questionMessage(7, "pending"), model: "other-model", effort: "high" }] });
    act(() => root.render(<Probe />));
    expect(shown()).toMatchObject({ model: "default-model", question: null });
    act(() => useChatStore.setState({ active: OTHER }));
    expect(shown()).toMatchObject({ model: "other-model", effort: "high", question: 7 });
    act(() => root.render(<SessionScope session={ACTIVE}><Probe /></SessionScope>));
    expect(shown()).toMatchObject({ model: "default-model", effort: "medium", question: null });
    act(() => root.render(<SessionScope session={null}><Probe /></SessionScope>));
    expect(shown()).toMatchObject({ model: "default-model", effort: "medium", question: null, plan: null, gate: false });
  });
});
