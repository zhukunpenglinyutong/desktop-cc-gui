import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileContent, SessionMeta } from "@/lib/ipc";
import type * as Platform from "@/lib/platform";
import i18n from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  readSessionFile: vi.fn(),
  writeSessionFile: vi.fn(),
  openSessionFileInDefaultEditor: vi.fn(),
}));
const platform = vi.hoisted(() => ({ isWeb: false }));
vi.mock("@/lib/ipc", () => ({ ipc: mocks }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...await importOriginal<typeof Platform>(),
  get isWeb() { return platform.isWeb; },
}));

import { useFilesStore } from "./store";
import { EditorPane } from "./EditorPane";

// React's testing flag is a test-runner global, not part of the DOM globals.
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const sizeError = "native session document exceeds the complete-document limit (64 MiB); no editable prefix was returned";
const session: SessionMeta = {
  engine: "omp", sessionId: "edited", workspacePath: "/repo",
  filePath: "/home/me/.omp/agent/sessions/repo/timestamp_edited.jsonl",
  fileSize: 65 * 1024 * 1024, fileMtimeMs: 1, title: "Edited", preview: "",
  createdAt: 1, updatedAt: 1, messageCount: 2, pinned: false, customTitle: null,
};

// jsdom has no layout; the browser smoke checks actual wrapped line geometry.
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
});
afterAll(() => {
  if (rangeRects) Object.defineProperty(Range.prototype, "getClientRects", rangeRects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (rangeBounds) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeBounds);
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});

describe("session editor recovery and wrapping", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.resetAllMocks();
    platform.isWeb = false;
    await i18n.changeLanguage("zh");
    useFilesStore.setState({ openFiles: [], fileStates: {}, activeFilePath: null, dirtyPaths: {}, externalEditorLaunches: {} });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useFilesStore.setState({ openFiles: [], fileStates: {}, activeFilePath: null, dirtyPaths: {}, externalEditorLaunches: {} });
  });

  const button = (key: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t(key)}"]`);

  async function openOversized(target = session, error = sizeError) {
    mocks.readSessionFile.mockRejectedValue(error);
    await useFilesStore.getState().openSessionFile(target);
    const key = useFilesStore.getState().activeFilePath!;
    await act(async () => root.render(<EditorPane path={key} />));
    return key;
  }

  it("offers external editing without exposing a truncated editable document", async () => {
    await openOversized();
    expect(button("files.openInDefaultEditor")?.disabled).toBe(false);
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("blocks repeat external launches while opening and allows retry after a failure", async () => {
    const opening = Promise.withResolvers<void>();
    mocks.openSessionFileInDefaultEditor.mockReturnValueOnce(opening.promise);
    await openOversized();
    const open = button("files.openInDefaultEditor");
    expect(open).not.toBeNull();
    await act(async () => open!.click());
    expect(open!.disabled).toBe(true);
    await act(async () => opening.reject(new Error("Default text editor is unavailable")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Default text editor is unavailable");
    expect(button("files.openInDefaultEditor")?.disabled).toBe(false);
  });

  it.each(["reload", "close and reopen"])("keeps a pending external launch through %s", async (transition) => {
    const opening = Promise.withResolvers<void>();
    mocks.openSessionFileInDefaultEditor.mockReturnValueOnce(opening.promise);
    const key = await openOversized();
    await act(async () => button("files.openInDefaultEditor")!.click());
    await act(async () => {
      if (transition === "reload") {
        await useFilesStore.getState().reloadFile(key);
      } else {
        useFilesStore.getState().closeFile(key);
        await useFilesStore.getState().openSessionFile(session);
      }
    });
    expect(button("files.openInDefaultEditor")?.disabled).toBe(true);
    const joined = useFilesStore.getState().openSessionFileExternally(key);
    await act(async () => {
      opening.resolve();
      await joined;
    });
    expect(mocks.openSessionFileInDefaultEditor).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button("files.openInDefaultEditor")?.disabled).toBe(false);
  });

  it.each([
    { ...session, engine: "dsh", filePath: "/data/session.jsonl.zstd" },
    { ...session, engine: "agy", filePath: "/data/edited.db" },
    { ...session, engine: "opencode", filePath: "/data/opencode.db\u001fedited" },
    { ...session, remote: true, remotePath: "/remote/session.jsonl" },
  ])("does not offer local text editing for $engine structured or remote sources", async (target) => {
    await openOversized(target);
    expect(button("files.openInDefaultEditor")).toBeNull();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("does not misclassify unavailable files as oversized", async () => {
    await openOversized(session, "native source is unavailable: Access denied");
    expect(button("files.openInDefaultEditor")).toBeNull();
  });

  it("does not offer a host editor launch from the browser client", async () => {
    platform.isWeb = true;
    await openOversized();
    expect(button("files.openInDefaultEditor")).toBeNull();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it.each([1, 2, 3])("selects and deletes only logical line %i from its line number", async (lineNumber) => {
    const path = `session:${session.engine}/${session.sessionId}`;
    const rows = [JSON.stringify({ text: "第一行🦀" }), JSON.stringify({ text: "第二行正文" }), JSON.stringify({ text: "末行无换行" })];
    const original = rows.join("\n");
    useFilesStore.setState({
      openFiles: [path], activeFilePath: path,
      fileStates: { [path]: { path, session, sourcePath: session.filePath, content: { kind: "text", text: original, dataUrl: null, truncated: false }, loading: false, error: null, loadNonce: 1 } },
    });
    await act(async () => root.render(<EditorPane path={path} />));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    const line = view.state.doc.line(lineNumber);
    const block = view.lineBlockAt(line.from);
    const gutter = [...container.querySelectorAll<HTMLElement>(".cm-lineNumbers .cm-gutterElement")].find((node) => node.textContent === String(lineNumber))!;
    // Give jsdom the line geometry that a browser measures for this gutter cell.
    vi.spyOn(gutter, "getBoundingClientRect").mockReturnValue(new DOMRect(0, view.documentTop + block.top, 40, block.height));
    await act(async () => gutter.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true })));
    const selected = view.state.selection.main;
    expect(view.state.sliceDoc(selected.from, selected.to)).toBe(rows[lineNumber - 1] + (lineNumber < rows.length ? "\n" : ""));
    expect(view.state.doc.toString()).toBe(original);
    await act(async () => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true, cancelable: true })));
    const remaining = lineNumber === rows.length ? rows.slice(0, -1).join("\n") + "\n" : rows.filter((_, index) => index !== lineNumber - 1).join("\n");
    expect(view.state.doc.toString()).toBe(remaining);
    await act(async () => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true })));
    expect(view.state.doc.toString()).toBe(original);
  });

  it("keeps edited Unicode text, selection and undo history across wrap toggles", async () => {
    const path = session.filePath;
    const original = `${JSON.stringify({ text: "正文汉🦀".repeat(80) })}\n`;
    const content: FileContent = { kind: "text", text: original, dataUrl: null, truncated: false };
    useFilesStore.setState({
      openFiles: [path], activeFilePath: path,
      fileStates: { [path]: { path, content, loading: false, error: null, loadNonce: 1 } },
    });
    await act(async () => root.render(<EditorPane path={path} />));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    await act(async () => view.dispatch({ changes: { from: 10, insert: "修改🦀" }, selection: { anchor: 15 } }));
    const edited = view.state.doc.toString();
    const selection = view.state.selection.main.head;
    const wrap = button("files.wordWrap");
    expect(wrap).not.toBeNull();
    await act(async () => wrap!.click());
    expect(wrap!.getAttribute("aria-pressed")).toBe("true");
    expect(view.state.doc.toString()).toBe(edited);
    expect(view.state.selection.main.head).toBe(selection);
    await act(async () => wrap!.click());
    expect(wrap!.getAttribute("aria-pressed")).toBe("false");
    expect(view.state.doc.toString()).toBe(edited);
    await act(async () => {
      view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(view.state.doc.toString()).toBe(original);
    expect(useFilesStore.getState().dirtyPaths[path]).toBeUndefined();
  });
});
