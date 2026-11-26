import { MemoryRouter } from "react-router-dom";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import { extractText } from "@/components/application/ai-chat/file-tags";
import { EditorPane } from "@/features/files/EditorPane";
import { useFilesStore } from "@/features/files/store";
import type { EngineEventPayload } from "@/lib/events";
import type { FileContent, Message, SessionMeta } from "@/lib/ipc";
import i18n from "@/lib/i18n";
import { sessionKey, useChatStore } from "../store";
import { EMPTY_SESSION } from "../store/stream";
import { MessageRow } from "./MessageTimeline";
import { useComposerActions } from "./use-composer-actions";

const transport = vi.hoisted(() => ({
  deliver: null as ((events: EngineEventPayload[]) => void) | null,
  readFile: vi.fn(),
  sendMessage: vi.fn(),
  loadSessionPage: vi.fn(),
}));
const focusComposer = vi.hoisted(() => vi.fn());
vi.mock("@/features/chat/focus-composer", () => ({ focusComposerWhenVisible: focusComposer }));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    ...transport,
    listWorkspaces: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    listArchivedSessions: vi.fn(async () => []),
    listEngines: vi.fn(async () => []),
    listPlanReviews: vi.fn(async () => []),
    rememberSessionModel: vi.fn(async () => {}),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
  },
}));

vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async (deliver: typeof transport.deliver) => {
    transport.deliver = deliver;
    return () => {};
  }),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const A = { engine: "claude", sessionId: "reference-a", workspacePath: "/repo" };
const B = { ...A, sessionId: "reference-b", workspacePath: "/repo-other" };
const keyOf = (tab: typeof A) => sessionKey(tab.engine, tab.sessionId, tab.workspacePath);
const KEY_A = keyOf(A);
const KEY_B = keyOf(B);
const FILE = "/repo/源 文件.md";
const HEADER = "./源 文件.md#L2-L3";
const QUOTE = `${HEADER}\n>   中文🙂\n>     unsaved\n> `;
const noop = () => {};
const file = (text: string): FileContent => ({ kind: "text", text, dataUrl: null, truncated: false });

function Fixture() {
  const active = useChatStore((s) => s.active)!;
  const key = sessionKey(active.engine, active.sessionId, active.workspacePath);
  const draft = useChatStore((s) => s.drafts[key] ?? "");
  const session = useChatStore((s) => s.bySession[key]);
  // Open editors stay mounted behind the chat, as in ChatCenterPane.
  const openFiles = useFilesStore((s) => s.openFiles);
  const inputRef = useRef<ComposerInputHandle>(null);
  const streaming = session?.streaming ?? false;
  const actions = useComposerActions({
    active, sessionKey: key, streaming, images: [], clearImages: noop,
    importImageFiles: noop, supportsImages: false, composerInputRef: inputRef,
  });
  return <>
    {openFiles.map((path) => <EditorPane key={path} path={path} />)}
    <Composer inputRef={inputRef} value={draft} onValueChange={actions.handleDraftChange}
      onSubmit={actions.submit} streaming={streaming} />
    {session?.messages.map((message) => (
      <MessageRow key={message.seq} message={message} workspacePath={active.workspacePath} turnFinal />
    ))}
  </>;
}

describe("#1521 text reference acceptance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    await i18n.changeLanguage("zh");
    await useChatStore.getState().init();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
    transport.readFile.mockReset().mockResolvedValue(file("top\n  中文🙂\n    saved\nbottom"));
    transport.sendMessage.mockReset().mockImplementation(async ({ runId }) => ({ runId, sessionId: null }));
    transport.loadSessionPage.mockReset().mockResolvedValue({ messages: [], nextBefore: null, subagentHistory: [] });
    useChatStore.setState({
      active: A, openTabs: [A, B], drafts: { [KEY_A]: "first draft", [KEY_B]: "second draft" },
      bySession: { [KEY_A]: { ...EMPTY_SESSION }, [KEY_B]: { ...EMPTY_SESSION } },
      streamingByKey: {}, models: { claude: "claude-sonnet-4" },
    });
    useFilesStore.setState({ openFiles: [], fileStates: {}, activeFilePath: null, lineLocation: null, dirtyPaths: {} });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<MemoryRouter><Fixture /></MemoryRouter>));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const button = (label: string) => Array.from(container.querySelectorAll("button"))
    .find((element) => element.textContent === label || element.getAttribute("aria-label") === label);
  const quoteButton = () => button(i18n.t("files.quoteSelection"));
  const box = () => container.querySelector<HTMLElement>("[data-placeholder]")!;
  const editor = () => EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  const selectedText = () => {
    const { state } = editor();
    return state.sliceDoc(state.selection.main.from, state.selection.main.to);
  };

  async function quote() {
    await act(async () => useFilesStore.getState().openFile(FILE));
    await act(async () => button(i18n.t("files.editMode"))?.click());
    const view = editor();
    expect(quoteButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(quoteButton()?.title).toBe(i18n.t("files.quoteSelectionEmpty"));
    const third = view.state.doc.line(3);
    await act(async () => view.dispatch({
      changes: { from: third.from + 4, to: third.to, insert: "unsaved" },
      selection: { anchor: third.to + 3, head: view.state.doc.line(2).from },
    }));
    expect(selectedText()).toBe("  中文🙂\n    unsaved\n");
    await act(async () => quoteButton()!.click());
    expect(extractText(box())).toBe(`first draft\n\n${QUOTE}\n\n`);
    expect(useFilesStore.getState().activeFilePath).toBeNull();
    expect(focusComposer).toHaveBeenCalledOnce();
  }

  async function send() {
    await act(async () => box().dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true,
    })));
  }

  it("quotes the unsaved reverse selection, isolates drafts and allows editing after switching back", async () => {
    await quote();
    await act(async () => useChatStore.setState({ active: B }));
    expect(extractText(box())).toBe("second draft");
    expect(quoteButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(quoteButton()?.title).toBe(i18n.t("files.quoteSelectionOutsideWorkspace"));
    await act(async () => quoteButton()!.click());
    expect(extractText(box())).toBe("second draft");
    await act(async () => useChatStore.setState({ active: A }));
    expect(extractText(box())).toContain(QUOTE);
    await act(async () => {
      box().append(document.createTextNode("revision"));
      box().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(useChatStore.getState().drafts[KEY_A]).toContain("revision");
    expect(useChatStore.getState().drafts[KEY_B]).toBe("second draft");
  });

  it("sends the visible quote through the composer and IPC", async () => {
    await quote();
    const visible = extractText(box());
    await send();
    expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sessionId: A.sessionId, workspacePath: A.workspacePath, prompt: visible }),
    );
  });

  it("drains the queued quote once to its original session after editing and switching away", async () => {
    await quote();
    const visible = extractText(box());
    await act(async () => useChatStore.setState((s) => ({
      bySession: { ...s.bySession, [KEY_A]: { ...s.bySession[KEY_A], streaming: true } },
    })));
    await send();
    expect(transport.sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().bySession[KEY_A].queue.map(({ text }) => text)).toEqual([visible]);
    await act(async () => {
      const view = editor();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "changed" } });
      useChatStore.setState({ active: B });
    });
    const done: EngineEventPayload = {
      runId: "previous-reference-run", engine: A.engine, sessionId: A.sessionId,
      seq: 9, kind: "done", data: { usage: null },
    };
    await act(async () => {
      transport.deliver!([done]);
      transport.deliver!([done]);
    });
    expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sessionId: A.sessionId, workspacePath: A.workspacePath, prompt: visible }),
    );
    expect(useChatStore.getState().bySession[KEY_A].queue).toHaveLength(0);
    expect(extractText(box())).toBe("second draft");
  });

  async function loadHistory(text: string) {
    const message: Message = { seq: 1, role: "user", text, ts: null };
    transport.loadSessionPage.mockResolvedValue({ messages: [message], nextBefore: null, subagentHistory: [] });
    await act(async () => useChatStore.getState().reloadSession(A as SessionMeta));
    expect(transport.loadSessionPage).toHaveBeenCalled();
  }

  it.each(["closed", "open editor", "preview", "shortened"])("locates reloaded history in a %s file", async (scenario) => {
    await loadHistory(QUOTE);
    transport.readFile.mockResolvedValue(file(scenario === "shortened" ? "only remaining line" : "top\nnew two\nnew three\nlast"));
    if (scenario === "preview" || scenario === "open editor") {
      await act(async () => useFilesStore.getState().openFile(FILE));
      expect(container.querySelector(".cm-editor")).toBeNull();
      if (scenario === "open editor") {
        await act(async () => button(i18n.t("files.editMode"))!.click());
        expect(selectedText()).toBe("");
      }
    }
    if (scenario === "closed") {
      let finishRead!: (content: FileContent) => void;
      transport.readFile.mockReturnValueOnce(new Promise<FileContent>((resolve) => { finishRead = resolve; }));
      await act(async () => button(HEADER)!.click());
      expect(useFilesStore.getState().fileStates[FILE]?.loading).toBe(true);
      expect(container.querySelector(".cm-editor")).toBeNull();
      await act(async () => finishRead(file("top\nnew two\nnew three\nlast")));
    } else {
      await act(async () => button(HEADER)!.click());
    }
    expect(transport.readFile).toHaveBeenCalledOnce();
    expect(transport.readFile.mock.calls[0][0]).toBe(FILE);
    expect(transport.readFile.mock.calls[0][1]).toBeUndefined();
    expect(useFilesStore.getState().activeFilePath).toBe(FILE);
    expect(selectedText()).toBe(scenario === "shortened" ? "only remaining line" : "new two\nnew three");
    expect(container.textContent).toContain(">     unsaved");
  });

  it("shows the file-load error for a deleted file and retains the historical text", async () => {
    await loadHistory(QUOTE);
    transport.readFile.mockRejectedValue(new Error("ENOENT: deleted"));
    await act(async () => button(HEADER)!.click());
    expect(container.textContent).toContain("ENOENT: deleted");
    expect(container.textContent).toContain(">     unsaved");
    expect(container.querySelector(".cm-editor")).toBeNull();

    transport.readFile.mockResolvedValue(file("top\nrestored two\nrestored three"));
    await act(async () => button(HEADER)!.click());
    expect(selectedText()).toBe("restored two\nrestored three");
    expect(transport.readFile).toHaveBeenCalledTimes(2);
  });

  it("does not expose invalid or escaping historical locations as file actions", async () => {
    const invalid = ["./源 文件.md#L0", "./源 文件.md#L4-L2", "./src/../../secret#L1",
      "./.. /secret#L1", "./源 文件.md#L99999999999999999"];
    await loadHistory(invalid.map((line) => `${line}\n> code`).join("\n\n"));
    for (const line of invalid) {
      expect(container.textContent).toContain(line);
      expect(button(line)).toBeUndefined();
    }
    expect(transport.readFile).not.toHaveBeenCalled();
  });
});
