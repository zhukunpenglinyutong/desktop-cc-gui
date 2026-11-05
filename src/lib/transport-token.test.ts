import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no __TAURI_INTERNALS__, so transport.ts runs as the web client.

async function loadTransport() {
  vi.resetModules();
  return import("./transport");
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("web access token", () => {
  it("takes the token from the URL, then removes it from the address bar", async () => {
    window.history.replaceState(null, "", "/?token=abc123&view=chat#tab");
    const { webToken } = await loadTransport();
    expect(webToken).toBe("abc123");
    // Gone from what third parties, history and screenshots can read…
    expect(window.location.search).toBe("?view=chat");
    expect(window.location.hash).toBe("#tab");
    expect(window.location.href).not.toContain("abc123");
  });

  it("keeps working after a reload of the cleaned URL", async () => {
    window.history.replaceState(null, "", "/?token=abc123");
    await loadTransport();
    expect(window.location.search).toBe("");
    // …the reload sees no token in the URL and reads the tab's session copy.
    const { webToken } = await loadTransport();
    expect(webToken).toBe("abc123");
  });

  it("prefers a fresh URL token over the stored one", async () => {
    window.history.replaceState(null, "", "/?token=old");
    await loadTransport();
    window.history.replaceState(null, "", "/?token=new");
    const { webToken } = await loadTransport();
    expect(webToken).toBe("new");
  });
});
