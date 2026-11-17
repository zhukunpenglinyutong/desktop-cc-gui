/**
 * The native create is async (Windows needs add_child off the IPC thread),
 * so hide and resize calls sent while it is pending find no webview and are
 * dropped. These tests pin that the pane reconciles once the create lands:
 * a tab switched away stays hidden, the page takes the latest rect, and the
 * expected "not found" from an early resize is not reported as an error.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  setBounds: vi.fn(),
  setVisible: vi.fn(),
}));

vi.mock("@/lib/transport", () => ({ invoke: vi.fn(), isWeb: false, listen: vi.fn() }));
vi.mock("./webview", () => ({
  createBrowserWebview: mocks.create,
  setBrowserWebviewBounds: mocks.setBounds,
  setBrowserWebviewVisible: mocks.setVisible,
  browserCurrentUrl: vi.fn(() => Promise.resolve(null)),
  browserGoBack: vi.fn(),
  browserGoForward: vi.fn(),
  browserReload: vi.fn(),
  navigateBrowserWebview: vi.fn(),
  listenBrowserNav: vi.fn(),
  listenBrowserTitle: vi.fn(),
}));

import { BrowserPane } from "./BrowserPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAB = { id: "b1", url: "https://example.com", title: "" };

let box = { left: 10, top: 20, width: 640, height: 480 };
const resizeCallbacks = new Set<() => void>();

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe() {
    resizeCallbacks.add(this.callback);
  }
  unobserve() {}
  disconnect() {
    resizeCallbacks.delete(this.callback);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;
const originalResizeObserver = globalThis.ResizeObserver;

function render(active: boolean) {
  act(() => root.render(<BrowserPane tab={TAB} active={active} />));
}

async function land(creation: ReturnType<typeof deferred>) {
  await act(async () => {
    creation.resolve();
    // Let the create -> bounds -> visibility chain run to the end.
    await new Promise((done) => setTimeout(done, 0));
  });
}

beforeEach(() => {
  box = { left: 10, top: 20, width: 640, height: 480 };
  resizeCallbacks.clear();
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: box.left,
        y: box.top,
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  mocks.create.mockReset();
  mocks.setBounds.mockReset().mockResolvedValue(undefined);
  mocks.setVisible.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.ResizeObserver = originalResizeObserver;
  vi.restoreAllMocks();
});

describe("BrowserPane webview sync while the native create is pending", () => {
  it("hides a webview that lands after its tab was switched away", async () => {
    const creation = deferred();
    mocks.create.mockReturnValue(creation.promise);
    render(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);

    // The cleanup's hide reaches the backend before the webview exists.
    render(false);
    mocks.setVisible.mockClear();
    await land(creation);

    expect(mocks.setVisible).toHaveBeenCalledWith("b1", false);
    expect(mocks.setVisible).not.toHaveBeenCalledWith("b1", true);
  });

  it("applies the pane's latest rect when the create lands", async () => {
    const creation = deferred();
    mocks.create.mockReturnValue(creation.promise);
    render(true);

    box = { left: 0, top: 44, width: 900, height: 600 };
    await land(creation);

    expect(mocks.setBounds).toHaveBeenLastCalledWith("b1", { x: 0, y: 44, width: 900, height: 600 });
    expect(mocks.setVisible).toHaveBeenLastCalledWith("b1", true);
  });

  it("does not report the expected not-found from a resize before the create lands", async () => {
    const creation = deferred();
    mocks.create.mockReturnValue(creation.promise);
    mocks.setBounds.mockRejectedValueOnce("browser webview b1 not found");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(true);

    for (const callback of resizeCallbacks) callback();
    await land(creation);

    expect(error).not.toHaveBeenCalled();
    expect(mocks.setVisible).toHaveBeenLastCalledWith("b1", true);
  });
});
