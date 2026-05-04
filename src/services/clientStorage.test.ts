import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

describe("clientStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unmock("./clientStorage");
  });

  it("hydrates legacy object stores and rewrites schema metadata immediately", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockImplementation(async (command, payload) => {
      const args =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      if (command === "client_store_read" && args?.store === "layout") {
        return { sidebarWidth: 280 };
      }
      if (command === "client_store_read") {
        return null;
      }
      return null;
    });

    await storage.preloadClientStores();
    await Promise.resolve();

    expect(storage.getClientStoreSync("layout", "sidebarWidth")).toBe(280);
    expect(invokeMock).toHaveBeenCalledWith("client_store_write", {
      store: "layout",
      data: {
        __schemaVersion: 1,
        sidebarWidth: 280,
      },
    });
  });

  it("drops invalid root payloads and rewrites defaults", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockImplementation(async (command, payload) => {
      const args =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      if (command === "client_store_read" && args?.store === "app") {
        return ["broken"];
      }
      if (command === "client_store_read") {
        return null;
      }
      return null;
    });

    await storage.preloadClientStores();
    await Promise.resolve();

    expect(storage.getClientStoreFullSync("app")).toEqual({});
    expect(invokeMock).toHaveBeenCalledWith("client_store_write", {
      store: "app",
      data: {
        __schemaVersion: 1,
      },
    });
  });

  it("does not create empty schema files for missing stores during preload", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockResolvedValue(null);

    await storage.preloadClientStores();
    await Promise.resolve();

    expect(storage.getClientStoreFullSync("layout")).toEqual({});
    expect(invokeMock).not.toHaveBeenCalledWith(
      "client_store_write",
      expect.objectContaining({ data: { __schemaVersion: 1 } }),
    );
  });

  it("writes patch updates with schema metadata while keeping sync cache payload clean", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockResolvedValue(null);

    storage.writeClientStoreValue(
      "threads",
      "customNames",
      { "ws:thread": "Name" },
      { immediate: true },
    );
    await Promise.resolve();

    expect(storage.getClientStoreSync("threads", "customNames")).toEqual({
      "ws:thread": "Name",
    });
    expect(invokeMock).toHaveBeenCalledWith("client_store_patch", {
      store: "threads",
      patch: {
        __schemaVersion: 1,
        customNames: { "ws:thread": "Name" },
      },
    });
  });

  it("writes full replace updates with schema metadata", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockResolvedValue(null);

    storage.writeClientStoreData(
      "composer",
      {
        promptHistory: { demo: ["hi"] },
      },
      { immediate: true },
    );
    await Promise.resolve();

    expect(storage.getClientStoreFullSync("composer")).toEqual({
      promptHistory: { demo: ["hi"] },
    });
    expect(invokeMock).toHaveBeenCalledWith("client_store_write", {
      store: "composer",
      data: {
        __schemaVersion: 1,
        promptHistory: { demo: ["hi"] },
      },
    });
  });
});
