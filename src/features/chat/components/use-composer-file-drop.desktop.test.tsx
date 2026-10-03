import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useComposerFileDrop } from "./use-composer-file-drop";

// Desktop branch: force native mode and capture the webview drag-drop
// listener the hook registers through @tauri-apps/api/webview.
vi.mock("@/lib/transport", () => ({ isWeb: false }));

type DragDropPayload = {
  type: "enter" | "over" | "leave" | "drop";
  position: { x: number; y: number };
  paths?: string[];
};
const dragDropListeners: Array<(e: { payload: DragDropPayload }) => void> = [];
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (e: { payload: DragDropPayload }) => void) => {
      dragDropListeners.push(cb);
      return Promise.resolve(() => {});
    },
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let latest: { isDragOver: boolean };

function Harness({
  disabled = false,
  onDropPaths,
}: {
  disabled?: boolean;
  onDropPaths?: (paths: string[]) => void;
}) {
  const { dropRef, isDragOver } = useComposerFileDrop({ disabled, onDropPaths });
  latest = { isDragOver };
  return <div ref={dropRef} />;
}

function emit(payload: DragDropPayload) {
  for (const cb of dragDropListeners) cb({ payload });
}

// jsdom's getBoundingClientRect returns zeros; stub the drop zone at
// CSS-pixel rect (0,0)-(100,50). DOMRect has no public constructor shape
// here, so the full record is asserted once at the mock boundary.
const ZONE_RECT: DOMRect = {
  left: 0,
  top: 0,
  right: 100,
  bottom: 50,
  width: 100,
  height: 50,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

describe("useComposerFileDrop (desktop/Tauri branch)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    dragDropListeners.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      ZONE_RECT,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function render(props: Parameters<typeof Harness>[0]) {
    await act(async () => {
      root.render(<Harness {...props} />);
    });
    // Flush the onDragDropEvent .then() that stores the unlisten fn.
    await act(async () => {});
  }

  it("lights the hint only while the drag is over the drop zone", async () => {
    await render({});
    await act(async () => {
      emit({ type: "enter", position: { x: 10, y: 10 } });
    });
    expect(latest.isDragOver).toBe(true);

    await act(async () => {
      emit({ type: "over", position: { x: 200, y: 10 } });
    });
    expect(latest.isDragOver).toBe(false);

    await act(async () => {
      emit({ type: "over", position: { x: 50, y: 40 } });
    });
    expect(latest.isDragOver).toBe(true);

    await act(async () => {
      emit({ type: "leave", position: { x: 50, y: 40 } });
    });
    expect(latest.isDragOver).toBe(false);
  });

  it("delivers trimmed drop paths landing inside the zone", async () => {
    const onDropPaths = vi.fn();
    await render({ onDropPaths });
    await act(async () => {
      emit({ type: "drop", position: { x: 10, y: 10 }, paths: [" /a.png ", "", "/b.md"] });
    });
    expect(onDropPaths).toHaveBeenCalledWith(["/a.png", "/b.md"]);
    expect(latest.isDragOver).toBe(false);
  });

  it("ignores a drop outside the zone", async () => {
    const onDropPaths = vi.fn();
    await render({ onDropPaths });
    await act(async () => {
      emit({ type: "drop", position: { x: 300, y: 300 }, paths: ["/a.png"] });
    });
    expect(onDropPaths).not.toHaveBeenCalled();
  });

  it("accepts physical-pixel positions on HiDPI displays", async () => {
    const onDropPaths = vi.fn();
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    await render({ onDropPaths });
    // Physical (150,60) is outside the 100×50 CSS rect; logical (75,30) is in.
    await act(async () => {
      emit({ type: "drop", position: { x: 150, y: 60 }, paths: ["/a.png"] });
    });
    expect(onDropPaths).toHaveBeenCalledWith(["/a.png"]);
  });

  it("never subscribes when disabled", async () => {
    const onDropPaths = vi.fn();
    await render({ disabled: true, onDropPaths });
    expect(dragDropListeners).toHaveLength(0);
    await act(async () => {
      emit({ type: "drop", position: { x: 10, y: 10 }, paths: ["/a.png"] });
    });
    expect(onDropPaths).not.toHaveBeenCalled();
  });
});
