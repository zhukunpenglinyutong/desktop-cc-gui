import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { SearchQuery, replaceNext, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileContent, SessionFileDocument, SessionMeta } from "@/lib/ipc";
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

  it("offers the local external editor to repair invalid native JSONL", async () => {
    await openOversized(session, "invalid native JSONL on line 2: expected value");
    expect(button("files.openInDefaultEditor")?.disabled).toBe(false);
    await act(async () => button("files.openInDefaultEditor")!.click());
    expect(mocks.openSessionFileInDefaultEditor).toHaveBeenCalledWith("omp", "edited");
  });

  it.each(["zh", "en", "ko"])("keeps the draft and version after a conflict in %s", async (language) => {
    await i18n.changeLanguage(language);
    mocks.readSessionFile.mockResolvedValue({ path: session.filePath, name: "edited.jsonl", text: "A", version: "version-A" });
    await useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    await act(async () => root.render(<EditorPane path={key} />));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    await act(async () => view.dispatch({ changes: { from: 1, insert: " draft" } }));
    mocks.writeSessionFile.mockRejectedValueOnce(new Error("SESSION_EDIT_CONFLICT"));
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === i18n.t("files.saveFile"))!;
    await act(async () => save.click());
    expect(view.state.doc.toString()).toBe("A draft");
    expect(container.textContent).toContain(i18n.t("files.sessionEditConflict"));
    expect(i18n.t("files.sessionEditConflict")).not.toBe("files.sessionEditConflict");
    expect(useFilesStore.getState().fileStates[key].version).toBe("version-A");
    await act(async () => useFilesStore.getState().openSessionFile(session));
    expect(EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)).toBe(view);
    expect(view.state.doc.toString()).toBe("A draft");
    expect(mocks.readSessionFile).toHaveBeenCalledTimes(1);
  });

  it("uses the new version for a second save without replacing edits typed during saving", async () => {
    mocks.readSessionFile.mockResolvedValue({ path: session.filePath, name: "edited.jsonl", text: "A", version: "v1" });
    await useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    await act(async () => root.render(<EditorPane path={key} />));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === i18n.t("files.saveFile"))!;
    const pending = Promise.withResolvers<SessionFileDocument>();
    mocks.writeSessionFile.mockReturnValueOnce(pending.promise);
    await act(async () => view.dispatch({ changes: { from: 1, insert: " first" } }));
    await act(async () => save.click());
    await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: " second" } }));
    await act(async () => pending.resolve({ path: session.filePath, name: "edited.jsonl", text: "A first", version: "v2" }));
    expect(view.state.doc.toString()).toBe("A first second");
    expect(useFilesStore.getState().dirtyPaths[key]).toBe(true);
    mocks.writeSessionFile.mockResolvedValueOnce({ path: session.filePath, name: "edited.jsonl", text: "A first second", version: "v3" });
    await act(async () => save.click());
    expect(mocks.writeSessionFile).toHaveBeenLastCalledWith("omp", "edited", "A first second", "v2", undefined, undefined);
    expect(useFilesStore.getState().fileStates[key].version).toBe("v3");
    expect(useFilesStore.getState().dirtyPaths[key]).toBeUndefined();
  });

  it("reopens a clean editor with the newly appended turn", async () => {
    mocks.readSessionFile.mockResolvedValueOnce({ path: session.filePath, name: "edited.jsonl", text: "A", version: "A" })
      .mockResolvedValueOnce({ path: session.filePath, name: "edited.jsonl", text: "A+B", version: "AB" });
    await useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    await act(async () => root.render(<EditorPane path={key} />));
    await act(async () => useFilesStore.getState().openSessionFile(session));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(view.state.doc.toString()).toBe("A+B");
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

  it.each(["LICENSE", "main.ts", "data.json"])(
    "uses the new find card instead of CodeMirror's native panel for %s",
    async (name) => {
      const path = `/repo/${name}`;
      const content: FileContent = { kind: "text", text: "needle\nneedle\n", dataUrl: null, truncated: false };
      useFilesStore.setState({
        openFiles: [path],
        activeFilePath: path,
        fileStates: { [path]: { path, content, loading: false, error: null, loadNonce: 1, name } },
      });
      await act(async () => root.render(<EditorPane path={path} />));
      const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;

      await act(async () => {
        view.contentDOM.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, bubbles: true, cancelable: true }),
        );
      });

      expect(container.querySelector(".cm-panel.cm-search")).toBeNull();
      const panel = container.querySelector<HTMLElement>('[role="search"]');
      expect(panel).not.toBeNull();
      expect(panel!.classList.contains("hidden")).toBe(false);
    },
  );

  it("closes the find card when another file tab becomes active", async () => {
    const path = "/repo/data.json";
    const nextPath = "/repo/note.md";
    const content: FileContent = { kind: "text", text: '{"a": 1}', dataUrl: null, truncated: false };
    useFilesStore.setState({
      openFiles: [path, nextPath],
      activeFilePath: path,
      fileStates: {
        [path]: { path, content, loading: false, error: null, loadNonce: 1, name: "data.json" },
        [nextPath]: { path: nextPath, content, loading: false, error: null, loadNonce: 1, name: "note.md" },
      },
    });
    await act(async () => root.render(<EditorPane path={path} />));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;

    await act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    const panel = container.querySelector<HTMLElement>('[role="search"]');
    expect(panel).not.toBeNull();
    expect(panel!.classList.contains("hidden")).toBe(false);
    expect(searchPanelOpen(view.state)).toBe(true);

    const expand = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${i18n.t("files.editorSearch.expandReplace")}"]`,
    );
    await act(async () => expand!.click());
    expect(
      container.querySelector(`input[placeholder="${i18n.t("files.editorSearch.replace")}"]`),
    ).not.toBeNull();

    // The hidden tab keeps its FileEditor mounted; its expanded replace row
    // must not stay painted over the newly active file.
    await act(async () => useFilesStore.setState({ activeFilePath: nextPath }));
    expect(panel!.classList.contains("hidden")).toBe(true);
    expect(searchPanelOpen(view.state)).toBe(false);
  });

  it("opens the find card with F3 instead of a search behind the hidden panel", async () => {
    const path = "/repo/f3.ts";
    const content: FileContent = { kind: "text", text: "alpha foo beta foo\n", dataUrl: null, truncated: false };
    useFilesStore.setState({
      openFiles: [path],
      activeFilePath: path,
      fileStates: { [path]: { path, content, loading: false, error: null, loadNonce: 1, name: "f3.ts" } },
    });
    await act(async () => root.render(<EditorPane path={path} />));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    await act(async () => view.dispatch({ selection: { anchor: 6, head: 9 } }));

    await act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F3", code: "F3", bubbles: true, cancelable: true }),
      );
    });

    const panel = container.querySelector<HTMLElement>('[role="search"]');
    expect(panel!.classList.contains("hidden")).toBe(false);
    expect(
      container.querySelector<HTMLInputElement>(`input[placeholder="${i18n.t("files.editorSearch.find")}"]`)!.value,
    ).toBe("foo");
  });

  it("keeps the cursors from select-all-matches when the card closes", async () => {
    const path = "/repo/multi.ts";
    const content: FileContent = { kind: "text", text: "one two one\n", dataUrl: null, truncated: false };
    useFilesStore.setState({
      openFiles: [path],
      activeFilePath: path,
      fileStates: { [path]: { path, content, loading: false, error: null, loadNonce: 1, name: "multi.ts" } },
    });
    await act(async () => root.render(<EditorPane path={path} />));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    const pressInEditor = (init: KeyboardEventInit) =>
      act(async () => {
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
      });

    await pressInEditor({ key: "f", code: "KeyF", ctrlKey: true });
    // What "select all matches" leaves behind: one cursor per match.
    await act(async () => view.dispatch({ selection: EditorSelection.create([
      EditorSelection.range(0, 3),
      EditorSelection.range(8, 11),
    ]) }));
    await pressInEditor({ key: "Escape", code: "Escape" });

    expect(container.querySelector<HTMLElement>('[role="search"]')!.classList.contains("hidden")).toBe(true);
    expect(view.state.selection.ranges.map((range) => [range.from, range.to])).toEqual([[0, 3], [8, 11]]);

    // A single match selection still collapses, as before.
    await pressInEditor({ key: "f", code: "KeyF", ctrlKey: true });
    await act(async () => view.dispatch({ selection: { anchor: 8, head: 11 } }));
    await pressInEditor({ key: "Escape", code: "Escape" });
    expect(view.state.selection.ranges.map((range) => [range.from, range.to])).toEqual([[11, 11]]);
  });

  it("clears the unsaved state after undoing a find/replace edit", async () => {
    const path = "/repo/replace.ts";
    const original = "const test = 1;\nconst other = test;\n";
    const content: FileContent = { kind: "text", text: original, dataUrl: null, truncated: false };
    useFilesStore.setState({
      openFiles: [path],
      activeFilePath: path,
      fileStates: { [path]: { path, content, loading: false, error: null, loadNonce: 1, name: "replace.ts" } },
    });
    await act(async () => root.render(<EditorPane path={path} />));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;

    await act(async () => {
      view.dispatch({ selection: { anchor: 6, head: 10 } });
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: "test", replace: "TEST" })),
      });
    });
    expect(replaceNext(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("const TEST = 1;\nconst other = test;\n");

    await act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(view.state.doc.toString()).toBe(original);
    expect(useFilesStore.getState().dirtyPaths[path]).toBeUndefined();
  });
});
