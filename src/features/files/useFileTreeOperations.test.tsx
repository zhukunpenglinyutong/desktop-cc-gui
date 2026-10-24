import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisibleNode } from "./FileTreeRow";

const mocks = vi.hoisted(() => ({
  clipboardFilePaths: vi.fn(),
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
vi.mock("react-i18next", () => ({
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

describe("file tree clipboard sync", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.clipboardFilePaths.mockResolvedValue([]);
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

  it("Copy stages the item and puts the file on the OS clipboard", async () => {
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;

    act(() => hook.result.current.openContextMenu(contextMenuEvent(), node("/repo/notes.md")));
    await act(async () => {
      hook.result.current.copyItem();
      await flush();
    });

    expect(useFilesStore.getState().clipboard).toEqual({ path: "/repo/notes.md", isDir: false });
    expect(mocks.setClipboardFilePaths).toHaveBeenCalledWith(["/repo/notes.md"]);
  });

  it("Paste uses the OS clipboard even when the in-app item differs", async () => {
    mocks.clipboardFilePaths.mockResolvedValue(["/elsewhere/draft.md"]);
    mocks.pasteClipboardItems.mockResolvedValue({
      created: [{ path: "/repo/draft.md", isDir: false }],
      failed: [],
    });
    useFilesStore.setState({ clipboard: { path: "/repo/stale.md", isDir: false } });

    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await act(async () => {
      hook.result.current.paste("/repo");
      await flush();
    });

    expect(mocks.pasteClipboardItems).toHaveBeenCalledWith("/repo");
    expect(mocks.pasteItem).not.toHaveBeenCalled();
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
    mocks.clipboardFilePaths.mockResolvedValue(["/elsewhere/gone.md"]);
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
    mocks.clipboardFilePaths.mockResolvedValue(["/elsewhere/draft.md"]);
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
    mocks.clipboardFilePaths.mockResolvedValue(["/elsewhere/draft.md"]);
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
});
