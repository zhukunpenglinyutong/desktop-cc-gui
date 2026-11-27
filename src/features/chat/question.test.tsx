import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { ipc, type Message } from "@/lib/ipc";
import * as notifications from "@/lib/notifications";
import { QuestionDock } from "./components/QuestionDock";
import { QuestionCard, QuestionRecord } from "./components/QuestionCard";
import { useChatStore } from "./store";
import { handleEngineEvents, type EngineEventDeps } from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION } from "./store/stream";
import { ASK_OTHER_OPTION, askLoops } from "./store/ask-loop";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    answerQuestion: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const KEY = sessionKey("claude", "s-1", "/tmp/ws");
const QUESTION_TEXT = "选哪个方案？";

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

function questionEvent(requestId = "req-1") {
  return {
    runId: "run-1",
    sessionId: "s-1",
    engine: "claude",
    seq: 1,
    kind: "question" as const,
    data: {
      requestId,
      toolUseId: "call_1",
      input: {
        questions: [
          {
            question: QUESTION_TEXT,
            header: "方案",
            options: [
              { label: "A", description: "方案 A" },
              { label: "B", description: "方案 B" },
            ],
          },
        ],
      },
    },
  };
}

function settledEvent(requestId = "req-1") {
  return {
    runId: "run-1",
    sessionId: "s-1",
    engine: "claude",
    seq: 2,
    kind: "question_settled" as const,
    data: { requestId },
  };
}

function cardRows() {
  return (useChatStore.getState().bySession[KEY]?.messages ?? []).filter(
    (m) => m.role === "question",
  );
}

describe("ask-user-question flow", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useChatStore.setState({
      openTabs: [],
      active: null,
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          messages: [{ seq: 1, role: "user", text: "帮我做", ts: null }],
        },
      },
      streamingByKey: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("a question event appends one pending card", () => {
    handleEngineEvents([questionEvent()], deps());
    const rows = cardRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].question?.status).toBe("pending");
    expect(rows[0].question?.requestId).toBe("req-1");
    expect(rows[0].question?.runId).toBe("run-1");
    expect(rows[0].question?.questions[0].options).toHaveLength(2);
  });

  it("replayed frames for the same request id collapse into one card", () => {
    handleEngineEvents([questionEvent(), questionEvent()], deps());
    expect(cardRows()).toHaveLength(1);
  });

  it("answering sends the picked labels and flips the card", async () => {
    handleEngineEvents([questionEvent()], deps());
    const seq = cardRows()[0].seq;
    await useChatStore
      .getState()
      .respondToQuestion(KEY, seq, { [QUESTION_TEXT]: "B" });
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenCalledWith("run-1", "req-1", {
      [QUESTION_TEXT]: "B",
    });
    expect(cardRows()[0].question?.status).toBe("answered");
    expect(cardRows()[0].question?.answers).toEqual({ [QUESTION_TEXT]: "B" });
  });

  it("skipping sends null and records no answer", async () => {
    handleEngineEvents([questionEvent()], deps());
    const seq = cardRows()[0].seq;
    await useChatStore.getState().respondToQuestion(KEY, seq, null);
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenCalledWith("run-1", "req-1", null);
    expect(cardRows()[0].question?.status).toBe("dismissed");
    expect(cardRows()[0].question?.answers).toBeUndefined();
  });

  it("a settled event cancels a pending card", () => {
    handleEngineEvents([questionEvent()], deps());
    handleEngineEvents([settledEvent()], deps());
    expect(cardRows()[0].question?.status).toBe("cancelled");
  });
});

const MULTI_TEXT = "你更关注哪个方向？（可多选）";
const MULTI_TITLE = `${MULTI_TEXT} (3/3)`;
const MULTI_OPTIONS = [
  { label: "代码重构", description: "重构" },
  { label: "前端体验", description: "体验" },
  { label: "性能优化", description: "性能" },
];

/** The persisted ask tool row: the only place multi-select is declared. */
const askToolRow = () => ({
  seq: 2,
  role: "tool",
  text: "提问",
  ts: null,
  args: {
    questions: [
      { question: "先做哪一步？", header: "步", options: [{ label: "A" }], multi: false },
      { question: "再做什么？", header: "步", options: [{ label: "B" }], multi: false },
      { question: MULTI_TEXT, header: "方向", options: MULTI_OPTIONS, multi: true },
    ],
  },
});

const selectFrame = (requestId: string, title: string) => ({
  runId: "run-1",
  sessionId: "s-1",
  engine: "claude",
  seq: 3,
  kind: "question" as const,
  data: {
    requestId,
    toolUseId: "call_ask",
    input: {
      questions: [
        { question: title, header: "提问", options: [...MULTI_OPTIONS, { label: ASK_OTHER_OPTION }] },
      ],
      extui: { method: "select" },
    },
  },
});

const editorFrame = (requestId: string) => ({
  runId: "run-1",
  sessionId: "s-1",
  engine: "claude",
  seq: 4,
  kind: "question" as const,
  data: {
    requestId,
    input: {
      questions: [
        {
          question: `${MULTI_TEXT}\n\n☐ 代码重构\n☐ 性能优化`,
          header: "提问",
          options: [],
        },
      ],
      extui: { method: "editor" },
    },
  },
});

describe("multi-select ask rounds over the extension bridge", () => {

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    askLoops.clear();
    useChatStore.setState({
      openTabs: [],
      active: null,
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          messages: [{ seq: 1, role: "user", text: "帮我做", ts: null }, askToolRow() as never],
        },
      },
      streamingByKey: {},
    });
  });

  afterEach(() => {
    askLoops.clear();
    vi.clearAllMocks();
  });

  it("marks a frame the ask tool declared multi and hides the runtime rows", () => {
    handleEngineEvents([selectFrame("q1", MULTI_TITLE)], deps());
    const rows = cardRows();
    expect(rows).toHaveLength(1);
    const specs = rows[0].question?.questions ?? [];
    expect(specs).toHaveLength(1);
    expect(specs[0].multiSelect).toBe(true);
    expect(specs[0].options.map((option) => option.label)).toEqual([
      "代码重构",
      "前端体验",
      "性能优化",
    ]);
  });

  it("one submit ends through the CLI's editor and never stacks a card", async () => {
    handleEngineEvents([selectFrame("q1", MULTI_TITLE)], deps());
    const seq = cardRows()[0].seq;
    await useChatStore.getState().respondToQuestion(KEY, seq, {
      [MULTI_TITLE]: ["代码重构", "性能优化"],
    });
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenLastCalledWith("run-1", "q1", {
      [MULTI_TEXT]: ASK_OTHER_OPTION,
    });
    expect(cardRows()[0].question?.status).toBe("answered");

    handleEngineEvents([editorFrame("q2")], deps());
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenLastCalledWith("run-1", "q2", {
      [MULTI_TEXT]: "代码重构, 性能优化",
    });
    const rows = cardRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].question?.status).toBe("answered");
    expect(rows[0].question?.answers).toEqual({
      [MULTI_TITLE]: ["代码重构", "性能优化"],
    });
  });

  it("resumes the same card when the CLI re-asks an unanswered round", () => {
    handleEngineEvents([selectFrame("q1", MULTI_TITLE)], deps());
    handleEngineEvents([selectFrame("q1b", MULTI_TITLE)], deps());
    const rows = cardRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].question?.status).toBe("pending");
    expect(rows[0].question?.requestId).toBe("q1b");
    const specs = rows[0].question?.questions ?? [];
    expect(specs[0].multiSelect).toBe(true);
    expect(specs[0].options.map((option) => option.label)).toEqual([
      "代码重构",
      "前端体验",
      "性能优化",
    ]);
  });

  it("re-sends the terminator when the CLI re-asks after a submit", async () => {
    handleEngineEvents([selectFrame("q1", MULTI_TITLE)], deps());
    await useChatStore.getState().respondToQuestion(KEY, cardRows()[0].seq, {
      [MULTI_TITLE]: ["代码重构"],
    });
    vi.mocked(ipc.answerQuestion).mockClear();
    handleEngineEvents([selectFrame("q2", `(1 selected) ${MULTI_TITLE}`)], deps());
    expect(cardRows()).toHaveLength(1);
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenLastCalledWith("run-1", "q2", {
      [MULTI_TEXT]: ASK_OTHER_OPTION,
    });
  });
});

describe("QuestionCard free-form Other", () => {
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  let container: HTMLDivElement;
  let root: Root;

  function cardMessage(
    multiSelect = false,
  ): Message & { question: NonNullable<Message["question"]> } {
    return {
      seq: 7,
      role: "question",
      text: QUESTION_TEXT,
      ts: null,
      question: {
        requestId: "req-9",
        runId: "run-9",
        toolUseId: null,
        questions: [
          {
            question: QUESTION_TEXT,
            header: "方案",
            multiSelect,
            options: [
              { label: "A", description: "方案 A" },
              { label: "B", description: "方案 B" },
            ],
          },
        ],
        status: "pending" as const,
      },
    } as Message & { question: NonNullable<Message["question"]> };
  }

  const buttonByText = (needle: string) =>
    [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(needle),
    );

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    void i18n.changeLanguage("zh");
    useChatStore.setState({
      openTabs: [],
      active: { engine: "claude", sessionId: "s-1", workspacePath: "/tmp/ws" },
      bySession: {
        [KEY]: { ...EMPTY_SESSION, messages: [cardMessage() as never] },
      },
      streamingByKey: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([
    ["仅允许本次", { decision: "allow" }, "answered"],
    ["拒绝", null, "dismissed"],
  ] as const)("tool approval sends the explicit decision for %s", async (label, decision, status) => {
    const notify = vi.spyOn(notifications, "notifyQuestion").mockResolvedValue();
    const event = {
      ...questionEvent(),
      data: {
        requestId: "approval-1",
        permission: { toolName: "Bash", input: { command: "pwd" } },
      },
    };
    handleEngineEvents([event], deps());
    expect(notify).toHaveBeenCalledExactlyOnceWith(KEY, "Bash");
    notify.mockRestore();
    const message = cardRows().at(-1)!;
    act(() => root.render(<QuestionCard message={message} />));
    expect(container.textContent).toContain("Bash");
    expect(container.textContent).toContain("pwd");
    expect(container.querySelectorAll("button")).toHaveLength(2);
    await act(async () => buttonByText(label)?.click());
    expect(ipc.answerQuestion).toHaveBeenCalledExactlyOnceWith("run-1", "approval-1", decision);
    expect(cardRows().at(-1)?.question?.status).toBe("pending");
    const observer = useChatStore.getState().bySession;
    const settled = {
      ...settledEvent("approval-1"),
      data: { requestId: "approval-1", decision: decision?.decision ?? "deny" },
    };
    for (const client of [useChatStore.getState().bySession, observer]) {
      useChatStore.setState({ bySession: client });
      handleEngineEvents([settled], deps());
      expect(cardRows().at(-1)?.question?.status).toBe(status);
      expect(cardRows().at(-1)?.question?.permission).toEqual({ toolName: "Bash" });
    }
    act(() => root.render(<QuestionRecord message={cardRows().at(-1)!} />));
    expect(container.textContent).toContain("Bash");
    expect(container.textContent).not.toContain("pwd");
  });

  it("queues same-turn approvals in arrival order and scrubs expired details", () => {
    const permissionEvent = (requestId: string, command: string) => ({
      ...questionEvent(),
      data: { requestId, permission: { toolName: "Bash", input: { command } } },
    });
    act(() => {
      handleEngineEvents([permissionEvent("first", "first command"),
        permissionEvent("second", "second command")], deps());
      root.render(<QuestionDock />);
    });
    expect(container.textContent).toContain("待审批 2 项");
    expect(container.textContent).toContain("first command");
    expect(container.textContent).not.toContain("second command");
    act(() => handleEngineEvents([settledEvent("first")], deps()));
    expect(container.textContent).toContain("待审批 1 项");
    expect(container.textContent).toContain("second command");
    expect(cardRows().find((m) => m.question?.requestId === "first")?.question?.permission)
      .toEqual({ toolName: "Bash" });
  });

  it("a single-select question offers the free-form input; a multi-select one does not", () => {
    act(() => root.render(<QuestionCard message={cardMessage() as never} />));
    expect(container.querySelector("input")).toBeTruthy();
    act(() => root.render(<QuestionCard message={cardMessage(true) as never} />));
    expect(container.querySelector("input")).toBeFalsy();
  });

  it("uses a circular radio marker for single-select and a square checkbox for multi-select", async () => {
    act(() => root.render(<QuestionCard message={cardMessage() as never} />));
    await act(async () => {
      buttonByText("A")!.click();
    });
    const singleMarker = buttonByText("A")!.firstElementChild as HTMLElement;
    expect(singleMarker.classList.contains("rounded-full")).toBe(true);
    expect(singleMarker.firstElementChild?.classList.contains("rounded-full")).toBe(true);

    act(() => root.render(<QuestionCard message={cardMessage(true) as never} />));
    const multiMarker = buttonByText("A")!.firstElementChild as HTMLElement;
    expect(multiMarker.classList.contains("rounded-full")).toBe(false);
  });

  it("hides Submit on a multi-select question that is not the last question", async () => {
    const message = cardMessage(true);
    message.question.questions.push({
      question: "第二题",
      header: "后续",
      options: [{ label: "C" }],
    });
    act(() => root.render(<QuestionCard message={message as never} />));
    expect(buttonByText("提交")).toBeFalsy();

    await act(async () => {
      buttonByText("A")!.click();
    });
    expect(buttonByText("提交")).toBeFalsy();
    expect(buttonByText("确认本题并继续")).toBeTruthy();

    await act(async () => {
      buttonByText("确认本题并继续")!.click();
    });
    expect(buttonByText("提交")).toBeTruthy();
  });

  it("keeps Submit available on the final multi-select question", async () => {
    act(() => root.render(<QuestionCard message={cardMessage(true) as never} />));
    expect(buttonByText("提交")).toBeTruthy();
    await act(async () => {
      buttonByText("A")!.click();
    });
    expect(buttonByText("提交")!.disabled).toBe(false);
  });

  it("typing a custom answer and confirming sends the free text", async () => {
    act(() => root.render(<QuestionCard message={cardMessage() as never} />));
    const input = container.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "用 C 方案");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonByText("提交")!.click();
    });
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenCalledWith("run-9", "req-9", {
      [QUESTION_TEXT]: "用 C 方案",
    });
  });

  it("does not offer free text when the protocol only accepts declared options", () => {
    const message = cardMessage();
    Object.assign(message.question.questions[0], { allowOther: false });
    act(() => root.render(<QuestionCard message={message as never} />));
    expect(container.querySelector("input")).toBeNull();
    expect(buttonByText("A")).toBeTruthy();
  });

  it("an option pick replaces the typed answer (single select)", async () => {
    act(() => root.render(<QuestionCard message={cardMessage() as never} />));
    await act(async () => {
      buttonByText("A")!.click();
    });
    await act(async () => {
      buttonByText("提交")!.click();
    });
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenCalledWith("run-9", "req-9", {
      [QUESTION_TEXT]: "A",
    });
  });

  it("re-picking a chosen option deselects it and blocks submit", async () => {
    act(() => root.render(<QuestionCard message={cardMessage() as never} />));
    await act(async () => {
      buttonByText("A")!.click();
    });
    expect(container.querySelector('[aria-checked="true"]')).toBeTruthy();
    expect((buttonByText("提交") as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      buttonByText("A")!.click();
    });
    expect(container.querySelector('[aria-checked="true"]')).toBeFalsy();
    expect((buttonByText("提交") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      buttonByText("B")!.click();
    });
    await act(async () => {
      buttonByText("提交")!.click();
    });
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenCalledWith("run-9", "req-9", {
      [QUESTION_TEXT]: "B",
    });
  });

  it("a multi-select round picked on the card answers the CLI's editor", async () => {
    askLoops.clear();
    useChatStore.setState({
      bySession: {
        [KEY]: { ...EMPTY_SESSION, messages: [askToolRow() as never] },
      },
    });
    handleEngineEvents([selectFrame("card-q1", MULTI_TITLE)], deps());
    act(() => root.render(<QuestionCard message={cardRows()[0]} />));
    await act(async () => {
      buttonByText("代码重构")!.click();
    });
    await act(async () => {
      buttonByText("性能优化")!.click();
    });
    await act(async () => {
      buttonByText("提交")!.click();
    });
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenLastCalledWith("run-1", "card-q1", {
      [MULTI_TEXT]: ASK_OTHER_OPTION,
    });
    handleEngineEvents([editorFrame("card-q2")], deps());
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenLastCalledWith("run-1", "card-q2", {
      [MULTI_TEXT]: "代码重构, 性能优化",
    });
    expect(cardRows()).toHaveLength(1);
  });

  it("answering a question walks to the next one, and submit waits for the rest", async () => {
    const option = (label: string, description: string) => ({ label, description });
    const message = {
      seq: 7,
      role: "question",
      text: "Q1",
      ts: null,
      question: {
        requestId: "req-3p",
        runId: "run-3p",
        toolUseId: null,
        questions: [
          { question: "Q1", header: "一", multiSelect: false, options: [option("A", "甲"), option("B", "乙")] },
          { question: "Q2", header: "二", multiSelect: false, options: [option("A", "甲"), option("B", "乙")] },
          { question: "Q3", header: "三", multiSelect: false, options: [option("A", "甲"), option("B", "乙")] },
        ],
        status: "pending" as const,
      },
    };
    useChatStore.setState({
      bySession: { [KEY]: { ...EMPTY_SESSION, messages: [message as never] } },
    });
    act(() => root.render(<QuestionCard message={message as never} />));
    expect(container.textContent).toContain("1/3");
    expect(container.textContent).toContain("还有 3 题未作答");
    expect((buttonByText("提交") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      buttonByText("A")!.click();
    });
    expect(container.textContent).toContain("2/3");
    expect(container.textContent).toContain("还有 2 题未作答");
    await act(async () => {
      buttonByText("A")!.click();
    });
    expect(container.textContent).toContain("3/3");
    expect((buttonByText("提交") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      buttonByText("B")!.click();
    });
    // The last answer stays put: submit is one click away right there.
    expect(container.textContent).toContain("3/3");
    expect(container.textContent).toContain("使用 Tab / 上下键选择，回车或空格选中");
    expect((buttonByText("提交") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      buttonByText("提交")!.click();
    });
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenLastCalledWith("run-3p", "req-3p", {
      Q1: "A",
      Q2: "A",
      Q3: "B",
    });
  });

  it("confirms a multi-select answer before moving to the next unanswered question", async () => {
    const message = {
      seq: 7,
      role: "question",
      text: "Q1",
      ts: null,
      question: {
        requestId: "req-multi",
        runId: "run-multi",
        questions: [
          {
            question: "Q1",
            header: "一",
            multiSelect: true,
            options: [{ label: "A" }, { label: "B" }],
          },
          {
            question: "Q2",
            header: "二",
            multiSelect: false,
            options: [{ label: "A" }, { label: "B" }],
          },
        ],
        status: "pending" as const,
      },
    } as Message;
    useChatStore.setState({
      bySession: { [KEY]: { ...EMPTY_SESSION, messages: [message as never] } },
    });
    act(() => root.render(<QuestionCard message={message as never} />));
    await act(async () => buttonByText("A")!.click());
    expect(buttonByText(i18n.t("chat.questionConfirmAndContinue"))).toBeTruthy();
    expect(buttonByText(i18n.t("chat.questionSubmit"))).toBeFalsy();

    await act(async () =>
      buttonByText(i18n.t("chat.questionConfirmAndContinue"))!.click(),
    );
    expect(container.textContent).toContain("2/2");
    expect(container.querySelector('[aria-checked="true"]')).toBeFalsy();
    await act(async () => buttonByText("B")!.click());
    await act(async () => buttonByText(i18n.t("chat.questionSubmit"))!.click());
    expect(vi.mocked(ipc.answerQuestion)).toHaveBeenLastCalledWith("run-multi", "req-multi", {
      Q1: ["A"],
      Q2: "B",
    });
  });

});
