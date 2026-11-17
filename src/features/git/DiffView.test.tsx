import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  gitDiff: vi.fn(),
  gitDiffImages: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({ ipc: ipcMock }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The lightbox pulls in the native browser/webview bridges; not part of this
// view's rendering contract.
vi.mock("@/components/base/image-lightbox", () => ({ ImageLightbox: () => null }));

import { DiffView } from "./DiffView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const status = { branch: "main", staged: [], unstaged: [], untracked: [] };

describe("DiffView image files", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.resetAllMocks();
  });

  async function render(target: { file: string; staged: boolean }) {
    act(() => {
      root.render(
        <DiffView workspacePath="/ws" target={target} status={status} onBack={() => {}} />,
      );
    });
    await act(async () => {});
  }

  it("renders both revisions for a changed image instead of patch text", async () => {
    ipcMock.gitDiffImages.mockResolvedValue({
      old: "data:image/png;base64,b2xk",
      new: "data:image/png;base64,bmV3",
    });
    await render({ file: "brand/logo.png", staged: false });
    expect(ipcMock.gitDiffImages).toHaveBeenCalledWith("/ws", "brand/logo.png", false);
    expect(ipcMock.gitDiff).not.toHaveBeenCalled();
    const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toEqual(["data:image/png;base64,b2xk", "data:image/png;base64,bmV3"]);
    expect(container.textContent).toContain("git.imageBefore");
    expect(container.textContent).toContain("git.imageAfter");
  });

  it("shows one pane for an added image", async () => {
    ipcMock.gitDiffImages.mockResolvedValue({
      old: null,
      new: "data:image/webp;base64,bmV3",
    });
    await render({ file: "brand/hero.webp", staged: true });
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.textContent).toContain("git.newFile");
    expect(container.textContent).not.toContain("git.imageBefore");
    expect(ipcMock.gitDiff).not.toHaveBeenCalled();
  });

  it("keeps rendering patch text for non-image files", async () => {
    ipcMock.gitDiff.mockResolvedValue("@@ -1 +1 @@\n-old\n+new");
    await render({ file: "src/app.ts", staged: false });
    expect(ipcMock.gitDiffImages).not.toHaveBeenCalled();
    expect(container.textContent).toContain("+new");
  });
});
