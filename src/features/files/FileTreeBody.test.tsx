import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Virtualizer } from "@tanstack/react-virtual";
import "@/lib/i18n";
import { FileTreeBody } from "./FileTreeBody";
import type { VisibleNode } from "./FileTreeRow";
import { useFilesStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dirNode: VisibleNode = {
  name: "src",
  isDir: true,
  size: 0,
  mtimeMs: 0,
  path: "/ws/desktop-cc-gui/src",
  depth: 0,
  expanded: true,
  loading: false,
};

/** Minimal virtualizer stub: one row at offset 0. */
function fakeVirtualizer(): Virtualizer<HTMLDivElement, Element> {
  return {
    getTotalSize: () => 40,
    getVirtualItems: () => [{ index: 0, start: 0 }],
    measureElement: () => {},
  } as unknown as Virtualizer<HTMLDivElement, Element>;
}

describe("FileTreeBody directory errors", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useFilesStore.setState({
      root: "/ws/desktop-cc-gui",
      dirErrors: {},
      loadingDirs: {},
      selectedPath: null,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() => {
      root.render(
        <FileTreeBody
          virtualizer={fakeVirtualizer()}
          visible={[dirNode]}
          onContextMenu={() => {}}
        />,
      );
    });
  }

  it("a failed expand renders role=alert with a retry, and the error clears after success", async () => {
    // Expanding the directory failed: the row shows an inline alert.
    act(() => {
      useFilesStore.setState({ dirErrors: { [dirNode.path]: "read failed" } });
    });
    render();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("read failed");

    // Retry: clicking the button re-runs ensureDir for the failed directory.
    // The stub mimics a successful reload by clearing the error, the same
    // way the real ensureDir does on success.
    const ensureDir = vi.fn(async () => {
      useFilesStore.setState({ dirErrors: {} });
    });
    act(() => {
      useFilesStore.setState({ ensureDir });
    });
    const retry = alert!.querySelector("button");
    expect(retry).not.toBeNull();
    await act(async () => {
      retry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(ensureDir).toHaveBeenCalledWith(dirNode.path);

    // After the successful reload the alert is gone.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
