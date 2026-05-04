// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const clientStorageMocks = vi.hoisted(() => ({
  writeClientStoreData: vi.fn(),
  getClientStoreFullSync: vi.fn(),
}));

vi.mock("./clientStorage", () => ({
  writeClientStoreData: clientStorageMocks.writeClientStoreData,
  getClientStoreFullSync: clientStorageMocks.getClientStoreFullSync,
}));

import { migrateLocalStorageToFileStore } from "./migrateLocalStorage";

describe("migrateLocalStorageToFileStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clientStorageMocks.writeClientStoreData.mockReset();
    clientStorageMocks.getClientStoreFullSync.mockReset();
    clientStorageMocks.getClientStoreFullSync.mockReturnValue(undefined);
  });

  it("copies legacy localStorage prefixes into ccgui-prefixed keys", () => {
    window.localStorage.setItem("mossx.promptUsage.v1", '{"prompt:test":{"count":1,"lastUsedAt":10}}');
    window.localStorage.setItem("mossx.runtimeConsole.height", "280");
    window.localStorage.setItem("codemoss:memory-debug", "1");

    migrateLocalStorageToFileStore();

    expect(window.localStorage.getItem("ccgui.promptUsage.v1")).toBe(
      '{"prompt:test":{"count":1,"lastUsedAt":10}}',
    );
    expect(window.localStorage.getItem("ccgui.runtimeConsole.height")).toBe("280");
    expect(window.localStorage.getItem("ccgui:memory-debug")).toBe("1");
    expect(window.localStorage.getItem("ccgui.clientStorageMigrated")).toBe("true");
  });

  it("migrates legacy mossx layout values into the client file store", () => {
    window.localStorage.setItem("mossx.sidebarWidth", "320");
    window.localStorage.setItem("mossx.rightPanelCollapsed", "true");
    window.localStorage.setItem("mossx.language", "zh");

    migrateLocalStorageToFileStore();

    expect(clientStorageMocks.writeClientStoreData).toHaveBeenCalledWith(
      "layout",
      expect.objectContaining({
        sidebarWidth: 320,
        rightPanelCollapsed: true,
      }),
    );
    expect(clientStorageMocks.writeClientStoreData).toHaveBeenCalledWith(
      "app",
      expect.objectContaining({
        language: "zh",
      }),
    );
  });

  it("skips migration when file store already contains normalized data", () => {
    clientStorageMocks.getClientStoreFullSync.mockReturnValue({
      __schemaVersion: 1,
      sidebarWidth: 320,
    });
    window.localStorage.setItem("mossx.sidebarWidth", "280");

    migrateLocalStorageToFileStore();

    expect(clientStorageMocks.writeClientStoreData).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("ccgui.clientStorageMigrated")).toBe("true");
  });
});
