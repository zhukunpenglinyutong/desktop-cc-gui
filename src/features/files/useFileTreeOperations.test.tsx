import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ReactI18next from "react-i18next";
import type { VisibleNode } from "./FileTreeRow";

const mocks = vi.hoisted(() => ({
  clipboardFileSnapshot: vi.fn(),
  clipboardChangeCount: vi.fn(),
  setClipboardFilePaths: vi.fn(),
  pasteClipboardItems: vi.fn(),
  pasteItem: vi.fn(),
  listDir: vi.fn(async () => []),
  gitTreeStatus: vi.fn(async () => ({ repositories: [], fileColors: {} })),
  gitRepositorySummaries: vi.fn(async () => []),
  gitFileColors: vi.fn(async () => ({})),
  requestMention: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({ ipc: mocks }));
vi.mock("@/features/browser/store", () => ({
  useBrowserStore: { getState: () => ({ deactivate: vi.fn() }) },
}));
vi.mock("@/features/chat/store", () => ({
  useChatStore: { getState: () => ({ requestMention: mocks.requestMention }) },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...await importOriginal<typeof ReactI18next>(),
  useTranslation: () => ({
    t: (key: string, opts?: { message?: string }) =>
      opts?.message ? `${key}: ${opts.message}` : key,
  }),
}));

import { useFilesStore } from "./store";
import { useFileTreeOperations } from "./useFileTreeOperations";

/**
 * The tree's Copy/Paste must be the OS clipboard's Copy/Paste: Copy stages
 * the item for the menu *and* puts the file on the system clipboard, Paste
 * reads that clipboard first (a copy made in Finder / Explorer, or a newer
 * copy than our own) and only falls back to the in-app stage.
 */
function renderHook<T>(hook: () => T) {
  const result: { current: T } = {} as { current: T };
  function TestComponent() {
    result.current = hook();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<TestComponent />);
  });
  return {
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const node = (path: string, isDir = false): VisibleNode => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  isDir,
  size: 0,
  mtimeMs: 0,
  depth: 0,
  expanded: false,
  loading: false,
});

const contextMenuEvent = () =>
  ({ preventDefault: vi.fn(), clientX: 40, clientY: 60 }) as unknown as React.MouseEvent<HTMLElement>;

/** Drain the chained `await`s inside the fire-and-forget menu handlers. */
async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("file tree clipboard sync", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: [], changeCount: null });
    mocks.clipboardChangeCount.mockResolvedValue(null);
    mocks.setClipboardFilePaths.mockResolvedValue(undefined);
    mocks.pasteClipboardItems.mockResolvedValue({ created: [], failed: [] });
    mocks.pasteItem.mockResolvedValue({ path: "/repo/notes.md", isDir: false });
    useFilesStore.setState({
      root: "/repo",
      // No cached listing: revealInTree's invalidateDir then has nothing to
      // re-read, keeping the assertions to the clipboard calls.
      children: {},
      expanded: { "/repo": true },
      loadingDirs: {},
      dirErrors: {},
      clipboard: null,
      selectedPath: null,
      selectedIsDir: false,
    });
  });

  let unmount: (() => void) | null = null;
  afterEach(() => {
    unmount?.();
    unmount = null;
  });

  type Hook = { result: { current: ReturnType<typeof useFileTreeOperations> } };
  /** Open the menu on `path`, then click Copy. Separate acts: React must
   *  commit the menu first, or Copy sees no menu and silently does nothing. */
  async function copyFromMenu(hook: Hook, path: string) {
    act(() => hook.result.current.openContextMenu(contextMenuEvent(), node(path)));
    await act(async () => {
      hook.result.current.copyItem();
      await flush();
    });
  }
  async function pasteInto(hook: Hook, dir = "/repo") {
    await act(async () => {
      hook.result.current.paste(dir);
      await flush();
    });
  }

  it("Copy stages the item, puts the file on the OS clipboard and records the generation", async () => {
    mocks.clipboardChangeCount.mockResolvedValue(8);
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/notes.md");

    expect(mocks.setClipboardFilePaths).toHaveBeenCalledWith(["/repo/notes.md"]);
    expect(useFilesStore.getState().clipboard).toEqual({
      path: "/repo/notes.md",
      isDir: false,
      osChangeCount: 8,
    });
  });

  it("Paste uses a newer OS copy over an older tree item", async () => {
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/elsewhere/draft.md"], changeCount: 7 });
    mocks.pasteClipboardItems.mockResolvedValue({
      created: [{ path: "/repo/draft.md", isDir: false }],
      failed: [],
    });
    useFilesStore.setState({ clipboard: { path: "/repo/stale.md", isDir: false, osChangeCount: 6 } });

    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await pasteInto(hook);

    expect(mocks.pasteClipboardItems).toHaveBeenCalledWith("/repo");
    expect(mocks.pasteItem).not.toHaveBeenCalled();
  });

  it("Paste uses the new tree copy when its OS write failed and the old OS files remain", async () => {
    mocks.setClipboardFilePaths.mockRejectedValue(new Error("clipboard is occupied"));
    mocks.clipboardChangeCount.mockResolvedValue(7);
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/elsewhere/old-a.md"], changeCount: 7 });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/new-b.md");
    await pasteInto(hook);

    expect(mocks.setClipboardFilePaths).toHaveBeenCalledWith(["/repo/new-b.md"]);
    expect(mocks.pasteItem).toHaveBeenCalledWith("/repo/new-b.md", "/repo");
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
  });

  /** Windows while another program holds the clipboard open: every call
   *  that needs OpenClipboard fails until `release()`; the generation, which
   *  needs no open, still answers. */
  function holdClipboardOpen() {
    let busy = true;
    mocks.setClipboardFilePaths.mockRejectedValue(new Error("cannot open the clipboard"));
    mocks.clipboardFileSnapshot.mockImplementation(async () => {
      if (busy) throw new Error("cannot open the clipboard");
      return { paths: ["/elsewhere/old-a.md"], changeCount: 7 };
    });
    return {
      release: () => {
        busy = false;
      },
    };
  }

  it("Paste uses the tree copy when the clipboard was busy for the whole Copy", async () => {
    const clipboard = holdClipboardOpen();
    mocks.clipboardChangeCount.mockResolvedValue(7);
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/new-b.md");
    clipboard.release();
    await pasteInto(hook);

    expect(mocks.setClipboardFilePaths).toHaveBeenCalledTimes(1);
    expect(mocks.pasteItem).toHaveBeenCalledWith("/repo/new-b.md", "/repo");
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
  });

  it("Paste keeps the tree copy when even the generation cannot be read", async () => {
    const clipboard = holdClipboardOpen();
    mocks.clipboardChangeCount.mockRejectedValue(new Error("host unavailable"));
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/new-b.md");
    clipboard.release();
    await pasteInto(hook);

    expect(mocks.pasteItem).toHaveBeenCalledWith("/repo/new-b.md", "/repo");
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
  });

  it("Paste keeps the tree copy when its failed write had already cleared the clipboard", async () => {
    // macOS clearContents / Windows EmptyClipboard bump the generation
    // before the write itself is refused.
    let generation = 7;
    mocks.setClipboardFilePaths.mockImplementation(async () => {
      generation = 8;
      throw new Error("the system refused the clipboard write");
    });
    mocks.clipboardChangeCount.mockImplementation(async () => generation);
    mocks.clipboardFileSnapshot.mockImplementation(async () => ({
      paths: generation === 7 ? ["/elsewhere/old-a.md"] : [],
      changeCount: generation,
    }));
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/new-b.md");
    await pasteInto(hook);

    expect(mocks.pasteItem).toHaveBeenCalledWith("/repo/new-b.md", "/repo");
  });

  it("Paste prefers a newer external copy when its own OS write failed", async () => {
    mocks.setClipboardFilePaths.mockRejectedValue(new Error("clipboard is occupied"));
    mocks.clipboardChangeCount.mockResolvedValue(7);
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/elsewhere/new-c.md"], changeCount: 8 });
    mocks.pasteClipboardItems.mockResolvedValue({
      created: [{ path: "/repo/new-c.md", isDir: false }],
      failed: [],
    });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/new-b.md");
    await pasteInto(hook);

    expect(mocks.setClipboardFilePaths).toHaveBeenCalledWith(["/repo/new-b.md"]);
    expect(mocks.pasteClipboardItems).toHaveBeenCalledWith("/repo");
    expect(mocks.pasteItem).not.toHaveBeenCalled();
  });

  it("does not paste the failed tree copy after an external text-only copy", async () => {
    mocks.setClipboardFilePaths.mockRejectedValue(new Error("clipboard is occupied"));
    mocks.clipboardChangeCount.mockResolvedValue(7);
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: [], changeCount: 8 });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/new-b.md");
    await pasteInto(hook);

    expect(mocks.setClipboardFilePaths).toHaveBeenCalledWith(["/repo/new-b.md"]);
    expect(mocks.pasteItem).not.toHaveBeenCalled();
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
    expect(hook.result.current.notice).toBe("files.pasteUnavailable");
  });

  it("does not paste a successful tree copy after a newer text-only copy", async () => {
    mocks.clipboardChangeCount.mockResolvedValue(8);
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: [], changeCount: 9 });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/b.md");
    await pasteInto(hook);

    expect(mocks.pasteItem).not.toHaveBeenCalled();
    expect(hook.result.current.notice).toBe("files.pasteUnavailable");
  });

  it("Paste pastes the renamed tree item, not the old path still on the OS clipboard", async () => {
    mocks.clipboardChangeCount.mockResolvedValue(8);
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/repo/b.md"], changeCount: 8 });
    mocks.pasteItem.mockResolvedValue({ path: "/repo/b2 copy.md", isDir: false });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/b.md");
    act(() => useFilesStore.getState().remapTreePath("/repo/b.md", "/repo/b2.md"));
    await pasteInto(hook);

    expect(mocks.pasteItem).toHaveBeenCalledWith("/repo/b2.md", "/repo");
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
  });

  it("records the Copy's generation when an unrelated rename lands before its write settles", async () => {
    const write = deferred<void>();
    mocks.setClipboardFilePaths.mockReturnValue(write.promise);
    mocks.clipboardChangeCount.mockResolvedValue(8);
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/b.md");
    act(() => useFilesStore.getState().remapTreePath("/repo/other.md", "/repo/other-2.md"));
    await act(async () => {
      write.resolve();
      await flush();
    });
    expect(useFilesStore.getState().clipboard).toEqual({
      path: "/repo/b.md",
      isDir: false,
      osChangeCount: 8,
    });

    // Without the recorded generation, a later Finder copy would lose to b.md.
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/elsewhere/c.md"], changeCount: 9 });
    await pasteInto(hook);
    expect(mocks.pasteClipboardItems).toHaveBeenCalledWith("/repo");
    expect(mocks.pasteItem).not.toHaveBeenCalled();
  });

  it("Paste uses the current tree copy while another program holds the clipboard", async () => {
    mocks.clipboardChangeCount.mockResolvedValue(8);
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/b.md");
    // Windows: the snapshot needs OpenClipboard, the generation does not.
    mocks.clipboardFileSnapshot.mockRejectedValue(new Error("cannot open the clipboard"));
    await pasteInto(hook);

    expect(mocks.pasteItem).toHaveBeenCalledWith("/repo/b.md", "/repo");
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
    expect(hook.result.current.notice).toBeNull();
  });

  it("Paste still reports a busy clipboard once something newer was copied", async () => {
    mocks.clipboardChangeCount.mockResolvedValueOnce(8).mockResolvedValue(9);
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/b.md");
    mocks.clipboardFileSnapshot.mockRejectedValue(new Error("cannot open the clipboard"));
    await pasteInto(hook);

    expect(mocks.pasteItem).not.toHaveBeenCalled();
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
    expect(hook.result.current.notice).toBe("files.opFailed: cannot open the clipboard");
  });

  it("disables Paste once a newer text-only copy replaced the tree item", async () => {
    mocks.clipboardChangeCount.mockResolvedValue(8);
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/repo/b.md"], changeCount: 8 });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/b.md");
    await act(async () => {
      hook.result.current.openContextMenu(contextMenuEvent(), node("/repo"));
      await flush();
    });
    expect(hook.result.current.canPaste).toBe(true);

    // Text copied afterwards (a chat message, the tree's own Copy Path).
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: [], changeCount: 9 });
    await act(async () => {
      hook.result.current.openContextMenu(contextMenuEvent(), node("/repo"));
      await flush();
    });
    expect(hook.result.current.canPaste).toBe(false);
  });

  it("probes the menu's Paste state only after an in-flight Copy write settles", async () => {
    const write = deferred<void>();
    let written = false;
    mocks.setClipboardFilePaths.mockReturnValue(write.promise);
    mocks.clipboardChangeCount.mockResolvedValue(8);
    // Before the write lands the OS still holds an older text-only copy.
    mocks.clipboardFileSnapshot.mockImplementation(async () =>
      written ? { paths: ["/repo/b.md"], changeCount: 8 } : { paths: [], changeCount: 7 },
    );
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/b.md");
    await act(async () => {
      hook.result.current.openContextMenu(contextMenuEvent(), node("/repo"));
      await flush();
    });
    await act(async () => {
      written = true;
      write.resolve();
      await flush();
    });

    // A probe read before the write would compare generation 7 with the
    // recorded 8 and grey out Paste for the newest copy.
    expect(hook.result.current.canPaste).toBe(true);
  });

  it("keeps Paste enabled for the tree copy when the menu probe cannot read the clipboard", async () => {
    mocks.clipboardChangeCount.mockResolvedValue(8);
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/b.md");
    mocks.clipboardFileSnapshot.mockRejectedValue(new Error("cannot open the clipboard"));
    await act(async () => {
      hook.result.current.openContextMenu(contextMenuEvent(), node("/repo"));
      await flush();
    });

    expect(hook.result.current.canPaste).toBe(true);
  });

  it("Paste waits for an in-flight copy write before choosing its source", async () => {
    const write = deferred<void>();
    mocks.setClipboardFilePaths.mockReturnValue(write.promise);
    mocks.clipboardChangeCount.mockResolvedValue(8);
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/repo/new-b.md"], changeCount: 8 });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await copyFromMenu(hook, "/repo/new-b.md");
    await pasteInto(hook);
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
    expect(mocks.pasteItem).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve();
      await flush();
    });
    expect(mocks.pasteItem).toHaveBeenCalledWith("/repo/new-b.md", "/repo");
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
  });

  it("serializes consecutive copies so an older write cannot finish last", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    mocks.setClipboardFilePaths
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await copyFromMenu(hook, "/repo/a.md");
    await copyFromMenu(hook, "/repo/b.md");
    expect(mocks.setClipboardFilePaths).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await flush();
    });
    expect(mocks.setClipboardFilePaths).toHaveBeenLastCalledWith(["/repo/b.md"]);
    expect(mocks.setClipboardFilePaths).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve();
      await flush();
    });
    expect(useFilesStore.getState().clipboard?.path).toBe("/repo/b.md");
  });

  it("Paste falls back to the in-app item when the OS clipboard has no files", async () => {
    useFilesStore.setState({ clipboard: { path: "/repo/notes.md", isDir: false } });

    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await act(async () => {
      hook.result.current.paste("/repo");
      await flush();
    });

    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
    expect(mocks.pasteItem).toHaveBeenCalledWith("/repo/notes.md", "/repo");
  });

  it("Paste reports an OS read failure instead of falling back to a stale tree item", async () => {
    mocks.clipboardFileSnapshot.mockRejectedValue(new Error("clipboard is occupied"));
    useFilesStore.setState({ clipboard: { path: "/repo/stale-a.md", isDir: false } });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    await act(async () => {
      hook.result.current.paste("/repo");
      await flush();
    });

    expect(mocks.pasteItem).not.toHaveBeenCalled();
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
    expect(hook.result.current.notice).toBe("files.opFailed: clipboard is occupied");
  });

  it("Paste says so when neither clipboard has a source", async () => {
    useFilesStore.setState({ clipboard: null });

    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await act(async () => {
      hook.result.current.paste("/repo");
      await flush();
    });

    expect(mocks.pasteItem).not.toHaveBeenCalled();
    expect(hook.result.current.notice).toBe("files.pasteUnavailable");
  });

  it("reports items the host could not copy instead of failing silently", async () => {
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/elsewhere/gone.md"], changeCount: 7 });
    mocks.pasteClipboardItems.mockResolvedValue({
      created: [],
      failed: ["stat /elsewhere/gone.md: not found"],
    });

    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await act(async () => {
      hook.result.current.paste("/repo");
      await flush();
    });

    expect(hook.result.current.notice).toBe(
      "files.opFailed: stat /elsewhere/gone.md: not found",
    );
  });

  it("says so when the OS clipboard empties before the host reads it", async () => {
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/elsewhere/draft.md"], changeCount: 7 });
    mocks.pasteClipboardItems.mockResolvedValue({ created: [], failed: [] });

    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await act(async () => {
      hook.result.current.paste("/repo");
      await flush();
    });

    expect(hook.result.current.notice).toBe("files.pasteUnavailable");
  });

  it("enables Paste from the OS clipboard alone", async () => {
    mocks.clipboardFileSnapshot.mockResolvedValue({ paths: ["/elsewhere/draft.md"], changeCount: 7 });
    useFilesStore.setState({ clipboard: null });

    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    expect(hook.result.current.canPaste).toBe(false);

    await act(async () => {
      hook.result.current.openContextMenu(contextMenuEvent(), node("/repo"));
      await flush();
    });

    expect(hook.result.current.canPaste).toBe(true);
  });

  it("ignores an older menu clipboard probe that resolves after the latest one", async () => {
    const first = deferred<{ paths: string[]; changeCount: number }>();
    const second = deferred<{ paths: string[]; changeCount: number }>();
    mocks.clipboardFileSnapshot
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    useFilesStore.setState({ clipboard: null });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    act(() => {
      hook.result.current.openContextMenu(contextMenuEvent(), node("/repo/first"));
      hook.result.current.openContextMenu(contextMenuEvent(), node("/repo/second"));
    });
    await act(async () => {
      second.resolve({ paths: [], changeCount: 8 });
      await flush();
    });
    expect(hook.result.current.canPaste).toBe(false);

    await act(async () => {
      first.resolve({ paths: ["/elsewhere/old-a.md"], changeCount: 7 });
      await flush();
    });
    expect(hook.result.current.canPaste).toBe(false);
  });

  it("ignores a menu clipboard probe that resolves after unmount", async () => {
    const probe = deferred<{ paths: string[]; changeCount: number }>();
    mocks.clipboardFileSnapshot.mockReturnValue(probe.promise);
    useFilesStore.setState({ clipboard: null });
    const hook = renderHook(() => useFileTreeOperations());

    act(() => hook.result.current.openContextMenu(contextMenuEvent(), node("/repo")));
    hook.unmount();
    await act(async () => {
      probe.resolve({ paths: ["/elsewhere/old-a.md"], changeCount: 7 });
      await flush();
    });
    expect(mocks.setClipboardFilePaths).not.toHaveBeenCalled();
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
  });

  it("restarts Paste source selection when a Copy arrives during its read", async () => {
    const firstRead = deferred<{ paths: string[]; changeCount: number }>();
    mocks.clipboardFileSnapshot
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValue({ paths: ["/repo/new-b.md"], changeCount: 8 });
    mocks.clipboardChangeCount.mockResolvedValue(8);
    useFilesStore.setState({ clipboard: null });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await pasteInto(hook);
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();

    // The Copy lands while Paste's first read is still pending.
    await copyFromMenu(hook, "/repo/new-b.md");
    await act(async () => {
      firstRead.resolve({ paths: ["/elsewhere/old-a.md"], changeCount: 7 });
      await flush();
    });

    // Deciding on the first read would have pasted old-a from the OS.
    expect(mocks.pasteItem).toHaveBeenCalledWith("/repo/new-b.md", "/repo");
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
  });

  it("ignores a menu clipboard probe that resolves after the menu closes", async () => {
    const probe = deferred<{ paths: string[]; changeCount: number }>();
    mocks.clipboardFileSnapshot.mockReturnValue(probe.promise);
    useFilesStore.setState({ clipboard: null });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    act(() => {
      hook.result.current.openContextMenu(contextMenuEvent(), node("/repo"));
      hook.result.current.closeMenu();
    });
    await act(async () => {
      probe.resolve({ paths: ["/elsewhere/old-a.md"], changeCount: 7 });
      await flush();
    });
    expect(hook.result.current.canPaste).toBe(false);
    expect(mocks.pasteClipboardItems).not.toHaveBeenCalled();
  });
});
