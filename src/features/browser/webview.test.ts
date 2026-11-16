import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/transport", () => ({
  invoke: mocks.invoke,
  isWeb: false,
  listen: vi.fn(),
}));

import { closeBrowserWebview, createBrowserWebview } from "./webview";

const rect = { x: 10, y: 20, width: 640, height: 480 };

describe("browser webview IPC", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("coalesces concurrent creates for the same tab", async () => {
    let finish!: () => void;
    mocks.invoke.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    const first = createBrowserWebview("tab-coalesce", "https://example.com", rect);
    const second = createBrowserWebview("tab-coalesce", "https://example.com", rect);

    expect(second).toBe(first);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
  });

  it("clears a failed create so a later attempt can retry", async () => {
    mocks.invoke
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      createBrowserWebview("tab-retry", "https://example.com", rect),
    ).rejects.toThrow("create failed");
    await createBrowserWebview("tab-retry", "https://example.com", rect);

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("waits for a pending create before closing its tab", async () => {
    let finish!: () => void;
    mocks.invoke
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce(undefined);

    const creation = createBrowserWebview("tab-close-race", "https://example.com", rect);
    const closing = closeBrowserWebview("tab-close-race");

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    finish();
    await creation;
    await closing;

    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "browser_close", { id: "tab-close-race" });
  });
});
