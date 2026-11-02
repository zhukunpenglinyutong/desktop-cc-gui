import { describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./transport", () => ({ invoke: transport.invoke }));

import { openFilePreview, previewUrl } from "./preview-url";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("previewUrl", () => {
  it("serves the file under its preview root token, never its absolute path", () => {
    expect(previewUrl({ token: TOKEN, name: "index.html" })).toBe(
      `ccgui-preview://localhost/${TOKEN}/index.html`,
    );
  });

  it("encodes the file name like a URL segment", () => {
    expect(previewUrl({ token: TOKEN, name: "中文 稿.html" })).toBe(
      `ccgui-preview://localhost/${TOKEN}/%E4%B8%AD%E6%96%87%20%E7%A8%BF.html`,
    );
  });

  it("uses the http-over-localhost form on Windows", async () => {
    vi.resetModules();
    vi.doMock("@/lib/platform", () => ({ IS_WINDOWS: true }));
    const windowsUrl = await import("./preview-url");
    expect(windowsUrl.previewUrl({ token: TOKEN, name: "index.html" })).toBe(
      `http://ccgui-preview.localhost/${TOKEN}/index.html`,
    );
    vi.doUnmock("@/lib/platform");
  });
});

describe("openFilePreview", () => {
  it("asks the backend to scope the preview to the file's directory", async () => {
    transport.invoke.mockResolvedValueOnce({ token: TOKEN, name: "index.html" });
    await expect(openFilePreview("/ws/draft/index.html")).resolves.toBe(
      `ccgui-preview://localhost/${TOKEN}/index.html`,
    );
    expect(transport.invoke).toHaveBeenCalledWith("preview_open", {
      path: "/ws/draft/index.html",
    });
  });
});
