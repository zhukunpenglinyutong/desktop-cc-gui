import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { ipc } from "@/lib/ipc";

import { useComposerImages, type ComposerImages } from "./use-composer-images";
import { useChatStore } from "../store";
import { NO_ATTACHMENT_MOVES, moveComposerState } from "../store/attachments";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    importAttachments: vi.fn(async (paths: string[]) =>
      paths.map((p) => `/sandbox/${p.split("/").pop()}`),
    ),
    readFile: vi.fn(async () => ({ kind: "other" })),
    savePastedImage: vi.fn(async () => "/sandbox/pasted.png"),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const KEY = "claude/s-1";

let latest: ComposerImages;

function Harness({ sessionKey = KEY }: { sessionKey?: string }) {
  latest = useComposerImages(sessionKey);
  return null;
}

function reset() {
  useChatStore.setState({
    composerAttachments: {},
    composerAttachmentMoves: NO_ATTACHMENT_MOVES,
  });
}

describe("useComposerImages.importImageFiles", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    reset();
  });

  it("attaches sandboxed copies of picked images, deduped", async () => {
    await act(async () => {
      latest.importImageFiles(["/tmp/a.png", "/tmp/b.jpg"], true);
    });
    expect(vi.mocked(ipc.importAttachments)).toHaveBeenCalledWith([
      "/tmp/a.png",
      "/tmp/b.jpg",
    ]);
    expect(latest.images).toEqual(["/sandbox/a.png", "/sandbox/b.jpg"]);

    // Picking the same file again must not duplicate the chip.
    await act(async () => {
      latest.importImageFiles(["/tmp/a.png"], true);
    });
    expect(latest.images).toEqual(["/sandbox/a.png", "/sandbox/b.jpg"]);
  });

  it("refuses images for engines without image input, without touching the backend", async () => {
    await act(async () => {
      latest.importImageFiles(["/tmp/a.png"], false);
    });
    expect(latest.images).toEqual([]);
    expect(latest.imageError).toBeTruthy();
    expect(vi.mocked(ipc.importAttachments)).not.toHaveBeenCalled();
  });

  it("surfaces an import failure instead of attaching", async () => {
    vi.mocked(ipc.importAttachments).mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      latest.importImageFiles(["/tmp/a.png"], true);
    });
    expect(latest.images).toEqual([]);
    expect(latest.imageError).toContain("boom");
  });

  it("keeps attachments under the session key they were added for", async () => {
    await act(async () => {
      latest.importImageFiles(["/tmp/a.png"], true);
    });
    // The state lives in the store, not in the hook's instance: another
    // session reads its own (empty) slice, and this one keeps its chip.
    expect(useChatStore.getState().composerAttachments[KEY]?.images).toEqual([
      "/sandbox/a.png",
    ]);
    await act(async () => {
      root.render(<Harness sessionKey="claude/s-2" />);
    });
    expect(latest.images).toEqual([]);
    await act(async () => {
      root.render(<Harness />);
    });
    expect(latest.images).toEqual(["/sandbox/a.png"]);
  });

  it("does not resurrect a removed attachment when its preview resolves late", async () => {
    let release: (() => void) | null = null;
    vi.mocked(ipc.readFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ kind: "image", dataUrl: "data:image/png;base64,AA==" } as never);
        }),
    );
    await act(async () => {
      latest.importImageFiles(["/tmp/a.png"], true);
    });
    const path = "/sandbox/a.png";
    await act(async () => {
      latest.removeImage(path);
    });
    expect(latest.images).toEqual([]);
    await act(async () => {
      release?.();
      await Promise.resolve();
    });
    // An empty slice is stored as absent, so nothing (least of all a preview
    // for the removed path) survives the late resolve.
    expect(useChatStore.getState().composerAttachments[KEY]).toBeUndefined();
  });
});

describe("useComposerImages.pasteImages", () => {
  const PENDING = "new:claude:/tmp/ws";
  const NATIVE = "claude/s-1";
  let container: HTMLDivElement;
  let root: Root;

  async function show(sessionKey: string) {
    await act(async () => {
      root.render(<Harness sessionKey={sessionKey} />);
    });
  }

  /** Paste one PNG and wait until FileReader has handed it to the backend. */
  async function startPaste() {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
      type: "image/png",
    });
    await act(async () => {
      latest.pasteImages([file]);
      for (
        let i = 0;
        i < 50 && vi.mocked(ipc.savePastedImage).mock.calls.length === 0;
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    });
    expect(vi.mocked(ipc.savePastedImage)).toHaveBeenCalledTimes(1);
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    reset();
  });

  it("lands a paste still being saved on the key its tab moved to", async () => {
    let finish: (path: string) => void = () => {};
    vi.mocked(ipc.savePastedImage).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await show(PENDING);
    await startPaste();

    // The CLI reports the native id while the file is still being written.
    await act(async () => {
      useChatStore.setState((s) => moveComposerState(s, PENDING, NATIVE));
    });
    await show(NATIVE);
    await act(async () => {
      finish("/sandbox/late.png");
    });
    await settle();

    expect(latest.images).toEqual(["/sandbox/late.png"]);
    // Nothing is left under the pending key for the next new chat to inherit.
    expect(useChatStore.getState().composerAttachments[PENDING]).toBeUndefined();
  });

  it("follows the move with a callback captured before it (file picker)", async () => {
    // "Add → Files" awaits the native dialog with the click-time callbacks;
    // the tab may adopt its native id while the dialog is open.
    await show(PENDING);
    const importFromPicker = latest.importImageFiles;
    await act(async () => {
      useChatStore.setState((s) => moveComposerState(s, PENDING, NATIVE));
    });
    await show(NATIVE);

    await act(async () => {
      importFromPicker(["/tmp/pic.png"], true);
    });
    await settle();

    expect(latest.images).toEqual(["/sandbox/pic.png"]);
    expect(useChatStore.getState().composerAttachments[PENDING]).toBeUndefined();
  });

  it("keeps a paste made after the move in the chat that reuses the key", async () => {
    useChatStore.setState((s) => moveComposerState(s, PENDING, NATIVE));
    await show(PENDING);
    await startPaste();
    await settle();

    expect(latest.images).toEqual(["/sandbox/pasted.png"]);
    expect(useChatStore.getState().composerAttachments[NATIVE]).toBeUndefined();
  });

  it("keeps a paste made with no tab open under the unbound key", async () => {
    await show("");
    await startPaste();
    await settle();

    expect(latest.images).toEqual(["/sandbox/pasted.png"]);
    expect(useChatStore.getState().composerAttachments[""]?.images).toEqual([
      "/sandbox/pasted.png",
    ]);
  });
});
