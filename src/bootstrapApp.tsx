import React from "react";
import ReactDOM from "react-dom/client";
import { preloadClientStores } from "./services/clientStorage";
import {
  pushGlobalRuntimeNotice,
  type GlobalRuntimeNoticeSeverity,
} from "./services/globalRuntimeNotices";
import { migrateLocalStorageToFileStore } from "./services/migrateLocalStorage";
import { initInputHistoryStore } from "./features/composer/hooks/useInputHistoryStore";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  appendRendererDiagnostic,
  flushRendererDiagnosticsBuffer,
} from "./services/rendererDiagnostics";

function renderBootstrapFallback(error: unknown) {
  const root = document.getElementById("root");
  if (!root) {
    console.error("[bootstrap] Failed before root mount and root element is missing:", error);
    return;
  }

  const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0d0f14",
          color: "#e2e8f0",
          fontFamily: "ui-monospace, monospace",
          fontSize: 13,
          padding: 32,
          overflow: "auto",
        }}
      >
        <h2 style={{ color: "#f87171", margin: "0 0 12px", fontSize: 18 }}>Application Startup Error</h2>
        <p style={{ color: "#94a3b8", margin: "0 0 16px" }}>
          The app failed to initialize. Please reload and try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "8px 16px",
            background: "#1e293b",
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Reload
        </button>
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: "#1e1e2e",
            borderRadius: 6,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            lineHeight: 1.5,
            color: "#f87171",
          }}
        >
          {errorMessage}
        </pre>
      </div>
    </React.StrictMode>,
  );
}

function resolveRootElement() {
  const root = document.getElementById("root");
  if (!(root instanceof HTMLElement)) {
    throw new Error("Bootstrap root element #root is missing");
  }
  return root;
}

function pushBootstrapNotice(
  messageKey: string,
  severity: GlobalRuntimeNoticeSeverity = "info",
) {
  pushGlobalRuntimeNotice({
    severity,
    category: "bootstrap",
    messageKey,
    dedupeKey: `bootstrap:${messageKey}`,
  });
}

async function markRendererReady() {
  try {
    const { invoke, isTauri } = await import("@tauri-apps/api/core");
    if (!isTauri()) {
      return;
    }
    await invoke("bootstrap_mark_renderer_ready");
    appendRendererDiagnostic("bootstrap/renderer-ready-marked");
  } catch (error) {
    appendRendererDiagnostic("bootstrap/renderer-ready-mark-failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

async function bootstrap() {
  appendRendererDiagnostic("bootstrap/start");
  pushBootstrapNotice("runtimeNotice.bootstrap.start");
  await preloadClientStores();
  flushRendererDiagnosticsBuffer();
  appendRendererDiagnostic("bootstrap/preload-complete");
  pushBootstrapNotice("runtimeNotice.bootstrap.storageMigrationCheck");
  try {
    migrateLocalStorageToFileStore();
  } catch (error) {
    appendRendererDiagnostic("bootstrap/local-storage-migration-failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    pushBootstrapNotice("runtimeNotice.bootstrap.localStorageMigrationFailed", "warning");
    console.error("[bootstrap] localStorage migration failed, continue startup:", error);
  }
  pushBootstrapNotice("runtimeNotice.bootstrap.inputHistoryRestore");
  await initInputHistoryStore();
  appendRendererDiagnostic("bootstrap/input-history-ready");
  pushBootstrapNotice("runtimeNotice.bootstrap.interfaceResources");
  await import("./i18n");
  appendRendererDiagnostic("bootstrap/i18n-ready");
  pushBootstrapNotice("runtimeNotice.bootstrap.mountShell");
  const { default: App } = await import("./App");
  const root = resolveRootElement();
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
  appendRendererDiagnostic("bootstrap/render-committed");
  pushBootstrapNotice("runtimeNotice.bootstrap.ready");
  void markRendererReady();
}

export async function startApp() {
  try {
    await bootstrap();
  } catch (error) {
    appendRendererDiagnostic("bootstrap/failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    pushBootstrapNotice("runtimeNotice.bootstrap.failed", "error");
    flushRendererDiagnosticsBuffer();
    console.error("[bootstrap] Startup failed:", error);
    renderBootstrapFallback(error);
  }
}
