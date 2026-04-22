// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const createRootMock = vi.hoisted(() => vi.fn());
const renderMock = vi.hoisted(() => vi.fn());
const preloadClientStoresMock = vi.hoisted(() => vi.fn());
const migrateLocalStorageToFileStoreMock = vi.hoisted(() => vi.fn());
const initInputHistoryStoreMock = vi.hoisted(() => vi.fn());
const appendRendererDiagnosticMock = vi.hoisted(() => vi.fn());
const flushRendererDiagnosticsBufferMock = vi.hoisted(() => vi.fn());
const pushGlobalRuntimeNoticeMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const isTauriMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: createRootMock,
  },
}));

vi.mock("./services/clientStorage", () => ({
  preloadClientStores: preloadClientStoresMock,
}));

vi.mock("./services/migrateLocalStorage", () => ({
  migrateLocalStorageToFileStore: migrateLocalStorageToFileStoreMock,
}));

vi.mock("./features/composer/hooks/useInputHistoryStore", () => ({
  initInputHistoryStore: initInputHistoryStoreMock,
}));

vi.mock("./services/rendererDiagnostics", () => ({
  appendRendererDiagnostic: appendRendererDiagnosticMock,
  flushRendererDiagnosticsBuffer: flushRendererDiagnosticsBufferMock,
}));

vi.mock("./services/globalRuntimeNotices", () => ({
  pushGlobalRuntimeNotice: pushGlobalRuntimeNoticeMock,
}));

vi.mock("./i18n", () => ({}));

vi.mock("./App", () => ({
  default: () => null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

vi.mock("./components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: unknown }) => children,
}));

describe("startApp", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
    createRootMock.mockReset();
    renderMock.mockReset();
    preloadClientStoresMock.mockReset();
    migrateLocalStorageToFileStoreMock.mockReset();
    initInputHistoryStoreMock.mockReset();
    appendRendererDiagnosticMock.mockReset();
    flushRendererDiagnosticsBufferMock.mockReset();
    pushGlobalRuntimeNoticeMock.mockReset();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(false);
    createRootMock.mockReturnValue({ render: renderMock });
  });

  it("pushes detailed bootstrap notices during a successful startup", async () => {
    const { startApp } = await import("./bootstrapApp");

    await startApp();

    expect(pushGlobalRuntimeNoticeMock.mock.calls).toEqual([
      [
        expect.objectContaining({
          messageKey: "runtimeNotice.bootstrap.start",
        }),
      ],
      [
        expect.objectContaining({
          messageKey: "runtimeNotice.bootstrap.storageMigrationCheck",
        }),
      ],
      [
        expect.objectContaining({
          messageKey: "runtimeNotice.bootstrap.inputHistoryRestore",
        }),
      ],
      [
        expect.objectContaining({
          messageKey: "runtimeNotice.bootstrap.interfaceResources",
        }),
      ],
      [
        expect.objectContaining({
          messageKey: "runtimeNotice.bootstrap.mountShell",
        }),
      ],
      [
        expect.objectContaining({
          messageKey: "runtimeNotice.bootstrap.ready",
        }),
      ],
    ]);
    expect(preloadClientStoresMock).toHaveBeenCalledTimes(1);
    expect(migrateLocalStorageToFileStoreMock).toHaveBeenCalledTimes(1);
    expect(initInputHistoryStoreMock).toHaveBeenCalledTimes(1);
    expect(createRootMock).toHaveBeenCalledWith(document.getElementById("root"));
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it("renders the bootstrap fallback and flushes diagnostics when preload fails early", async () => {
    const preloadError = new Error("preload failed");
    preloadClientStoresMock.mockRejectedValue(preloadError);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startApp } = await import("./bootstrapApp");

    await startApp();

    expect(appendRendererDiagnosticMock).toHaveBeenNthCalledWith(1, "bootstrap/start");
    expect(appendRendererDiagnosticMock).toHaveBeenNthCalledWith(2, "bootstrap/failed", {
      error: "Error: preload failed",
    });
    expect(pushGlobalRuntimeNoticeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messageKey: "runtimeNotice.bootstrap.start",
      }),
    );
    expect(pushGlobalRuntimeNoticeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messageKey: "runtimeNotice.bootstrap.failed",
      }),
    );
    expect(flushRendererDiagnosticsBufferMock).toHaveBeenCalledTimes(1);
    expect(createRootMock).toHaveBeenCalledWith(document.getElementById("root"));
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith("[bootstrap] Startup failed:", preloadError);

    consoleErrorSpy.mockRestore();
  });
});
