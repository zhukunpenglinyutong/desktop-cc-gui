import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const THUMB = "data:image/png;base64,VElOVw==";
const FULL = "data:image/png;base64,RlVMTA==";
const loadSessionImage = vi.fn(
  async (_reference: string, full?: boolean) => (full ? FULL : THUMB),
);
const readFile = vi.fn(async (_path: string) => ({
  kind: "image" as const,
  dataUrl: "data:image/png;base64,RklMRQ==",
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    loadSessionImage: (reference: string, full?: boolean) =>
      loadSessionImage(reference, full),
    readFile: (path: string) => readFile(path),
  },
}));
vi.mock("@/features/files/store", () => ({
  fileName: (path: string) => path.split(/[\\/]/).pop() ?? path,
}));
// The lightbox has its own dialog/zoom machinery; this suite only asserts
// which URL the timeline asks for.
vi.mock("@/components/base/image-lightbox", () => ({
  ImageLightbox: ({ src }: { src: string }) => (
    <div data-testid="lightbox">{src}</div>
  ),
}));

import { MessageImages } from "./MessageImages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const REF = `ccgui-image:${"a".repeat(64)}.png`;

describe("MessageImages", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    loadSessionImage.mockClear();
    readFile.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  const render = async (images: string[]) => {
    await act(async () => {
      root.render(<MessageImages images={images} />);
    });
    await act(async () => {});
  };

  it("loads a stored history image as a thumbnail", async () => {
    await render([REF]);
    expect(loadSessionImage).toHaveBeenCalledWith(REF, false);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(THUMB);
  });

  it("asks for the original only after a click", async () => {
    await render([REF]);
    await act(async () => {
      container.querySelector("button")?.click();
    });
    await act(async () => {});
    expect(loadSessionImage).toHaveBeenLastCalledWith(REF, true);
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(
      FULL,
    );
  });

  it("degrades an unavailable store reference to a chip", async () => {
    await render(["ccgui-image:unavailable"]);
    expect(loadSessionImage).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("image");
  });

  it("keeps data URLs and file paths on their existing paths", async () => {
    const inline = "data:image/png;base64,SU5MSU5F";
    await render([inline, "/tmp/pic.png"]);
    expect(loadSessionImage).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith("/tmp/pic.png");
    const sources = Array.from(container.querySelectorAll("img")).map((img) =>
      img.getAttribute("src"),
    );
    expect(sources).toEqual([inline, "data:image/png;base64,RklMRQ=="]);
  });
});
