import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ openFilePreview: vi.fn() }));
vi.mock("@/lib/preview-url", () => ({ openFilePreview: mocks.openFilePreview }));

import { HtmlPreview } from "./HtmlPreview";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const URL = "ccgui-preview://localhost/0123456789abcdef0123456789abcdef/index.html";

describe("HtmlPreview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.openFilePreview.mockReset().mockResolvedValue(URL);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const frame = () => container.querySelector("iframe");
  const render = async (reloadKey: number, active = true) =>
    act(async () =>
      root.render(
        <HtmlPreview
          path="/ws/draft/index.html"
          name="index.html"
          reloadKey={reloadKey}
          active={active}
        />,
      ),
    );

  it("renders through a directory-scoped preview URL with an opaque-origin sandbox", async () => {
    await render(0);
    expect(mocks.openFilePreview).toHaveBeenCalledWith("/ws/draft/index.html");
    const iframe = frame();
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe(URL);
    // No allow-same-origin: the page gets an opaque origin, so it cannot read
    // other preview responses; no top-level navigation, no popups.
    const sandbox = iframe!.getAttribute("sandbox") ?? "";
    expect(sandbox.split(" ")).not.toContain("allow-same-origin");
    expect(sandbox.split(" ")).toContain("allow-scripts");
    expect(sandbox).not.toMatch(/allow-(top-navigation|popups)/);
    expect(iframe!.getAttribute("title")).toBe("index.html");
  });

  it("shows an error instead of a frame when the preview cannot be opened", async () => {
    mocks.openFilePreview.mockRejectedValueOnce("path is outside the registered workspaces: /x");
    await render(0);
    expect(frame()).toBeNull();
    expect(container.textContent).toContain(i18n.t("files.htmlPreviewUnavailable"));
  });

  it("remounts the frame when the reload key changes", async () => {
    await render(0);
    const before = frame();
    await render(1);
    const after = frame();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after!.getAttribute("src")).toBe(before!.getAttribute("src"));
  });

  it("unmounts the frame while the tab is hidden and reloads it on return", async () => {
    await render(0);
    const before = frame();
    await render(0, false);
    expect(frame()).toBeNull();
    await render(0);
    const after = frame();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });
});
