import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import i18n from "./lib/i18n";
import { ipc } from "./lib/ipc";
import { applyTheme, THEME_STORAGE_KEY } from "./features/settings/theme";
import { applyFontPreferences, readCachedFontPreferences } from "./features/settings/font";
import { hydrateBetaFeatures } from "./features/settings/beta-features";
import { initializePerformancePreference } from "./lib/performance-preference";
import { sessionKey, useChatStore } from "./features/chat/store";
import { getAppVersion } from "./lib/platform";
import { installTauriUnlistenGuard } from "./lib/tauri-unlisten-guard";
import {
  installGlobalCrashHandlers,
  setCrashAppVersion,
} from "./lib/crash";
import { AppCrashBoundary } from "./components/crash/AppCrashBoundary";

/**
 * Mount the app. Loaded from ./main only after the react-scan overlay (when
 * the settings switch is on) has instrumented React — this module (via App)
 * imports React, so it must never be pulled in statically by the entry.
 */
export function startApp() {
  // Tauri 2.11's generated unlisten script throws when the registration eval
  // for the id has not reached the webview yet (tauri#15799). Patch it before
  // any component/effect can tear a listener down.
  installTauriUnlistenGuard();

  const stopPerformanceMonitor = initializePerformancePreference(() => {
    const state = useChatStore.getState();
    const sessions = Object.values(state.bySession);
    const active = state.active;
    const messages = active ? state.bySession[sessionKey(active.engine, active.sessionId, active.workspacePath)]?.messages : undefined;
    let liveTextUnits = 0;
    let liveThinkingUnits = 0;
    for (const message of messages?.slice(-8) ?? []) {
      if (message.live && message.role === "assistant") liveTextUnits += message.text.length;
      if (message.live && message.role === "thinking") liveThinkingUnits += message.text.length;
    }
    return {
      sessions: sessions.length,
      messages: sessions.reduce((total, session) => total + session.messages.length, 0),
      streaming: sessions.reduce((total, session) => total + Number(session.streaming), 0),
      activeMessages: messages?.length ?? 0,
      liveTextUnits,
      liveThinkingUnits,
      timelineMounted: Number(Boolean(document.querySelector("[data-virtual-inner]"))),
      mountedProcessItems: document.querySelectorAll("[data-process-item-index]").length,
    };
  });
  if (import.meta.hot) import.meta.hot.dispose(stopPerformanceMonitor);

  // Capture uncaught errors / rejections and tag crash reports with the
  // running version. The boundary below renders what these record.
  installGlobalCrashHandlers();
  void getAppVersion().then(setCrashAppVersion);

  // Apply the locally cached theme synchronously, before first paint, so the
  // window never flashes the wrong color scheme while settings load.
  const cachedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (cachedTheme) applyTheme(cachedTheme);
  // Same for the font preferences: set the root font variables before first
  // paint so custom UI/code fonts don't swap in visibly after settings load.
  applyFontPreferences(readCachedFontPreferences());

  // Kick off the authoritative settings fetch at module scope (shared cached
  // promise in ipc.ts); apply theme/language as soon as it resolves. Rendering
  // is not blocked on this.
  void ipc
    .getAppSettings()
    .then((settings) => {
      applyTheme(settings.theme);
      applyFontPreferences({
        fontFamily: settings.fontFamily,
        uiFontSize: settings.uiFontSize,
        contentFontSize: settings.contentFontSize,
        codeFontSize: settings.codeFontSize,
        uiFontWeight: settings.uiFontWeight,
        codeFontFamily: settings.codeFontFamily,
        fontFile: settings.fontFile,
        codeFontFile: settings.codeFontFile,
      });
      if (settings.language && settings.language !== i18n.language) {
        void i18n.changeLanguage(settings.language);
      }
    })
    .catch(() => {});

  // 内测入口（设置 → 其他 → 内测功能）决定侧栏和页签条是否渲染，随启动设置
  // 一起水合（共用同一个缓存的 settings promise）。
  void hydrateBetaFeatures();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppCrashBoundary>
        <App />
      </AppCrashBoundary>
    </React.StrictMode>,
  );
  // Analytics stays off the cold-start critical path: install after first paint
  // via dynamic import. setTimeout (not requestIdleCallback) because older
  // WebKitGTK lacks it. The install itself no-ops outside production.
  window.setTimeout(() => {
    void import("./lib/analytics")
      .then(({ installBaiduTongji }) => installBaiduTongji())
      .catch((error) => {
        console.warn(
          "[analytics] deferred Baidu Tongji install failed",
          error instanceof Error ? error.message : String(error),
        );
      });
  }, 3000);
}
