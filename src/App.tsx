import { lazy, Suspense, useEffect, useState } from "react";
import { LazyMotion, domAnimation } from "motion/react";
import { HashRouter, Route, Routes } from "react-router-dom";
import ChatPage from "@/features/chat/ChatPage";
import { CommandPalette } from "@/features/commands/CommandPalette";
import PluginPageHost from "@/features/plugins/manager/PluginPageHost";
import { PluginOverlayHost } from "@/features/plugins/runtime/overlay-host";
import { bindSystemThemeSync, bindThemeChangePersistence } from "@/features/settings/theme";
import { UpdateToast } from "@/features/update/UpdateToast";
import { useUpdateStore } from "@/features/update/store";
import { announceReleaseAfterUpgrade } from "@/features/update/upgrade-announcement";
import { GrantAccessDialogHost } from "@/components/dialogs";
import { startPluginSystem } from "@/features/plugins";
import { CloseConfirmDialogHost } from "@/components/dialogs";
import { installCloseConfirm } from "@/lib/close-confirm";
import { startShortcutRuntime } from "@/features/shortcuts/runtime";
import { ShortcutsGuideModal } from "@/features/shortcuts/ShortcutsGuideModal";
import PetOverlayApp from "@/features/pet/PetOverlayApp";
import { PetRuntime } from "@/features/pet/PetRuntime";

// Settings is a rare route; load it on demand so startup ships less JS.
// Warm the chunk shortly after startup so the first click has no fetch gap.
const loadSettingsPage = () => import("@/features/settings/SettingsPage");
const SettingsPage = lazy(loadSettingsPage);

export default function App() {
  const [overlay, setOverlay] = useState(() => window.location.hash === "#/pet-overlay");
  useEffect(() => {
    const update = () => setOverlay(window.location.hash === "#/pet-overlay");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  if (overlay) return <PetOverlayApp />;
  return <MainApp />;
}

function MainApp() {
  // Startup theme/language init lives in bootstrap.tsx; only the
  // theme-change listeners (with their own cleanup) are registered here.
  useEffect(() => bindThemeChangePersistence(), []);
  // bindSystemThemeSync keeps a "system" theme following OS color-scheme
  // flips app-wide — this used to live in the settings page, where it only
  // worked while Settings was open.
  useEffect(() => bindSystemThemeSync(), []);
  // Prefetch the settings chunk once startup work has settled.
  useEffect(() => {
    const id = setTimeout(() => void loadSettingsPage(), 2000);
    return () => clearTimeout(id);
  }, []);
  // Plugin system bootstrap: hardening + event bridge + builtin/installed
  // plugin activation. Failures are logged, never fatal to the host UI.
  useEffect(() => startPluginSystem(), []);
  // Intercept the window close button so quitting needs a confirmation.
  useEffect(() => installCloseConfirm(), []);
  // Global keyboard-shortcut runtime: one dispatcher handler binding the
  // configured keys to registered action handlers / palette commands.
  useEffect(() => startShortcutRuntime(), []);
  // 升级后首启：版本真的前进了就把这次更新的说明开成中心页签（「新版本」标记
  // 直到用户关掉页签；每个版本只宣布一次，见 upgrade-announcement.ts）。
  useEffect(() => {
    void announceReleaseAfterUpgrade();
  }, []);
  // Background update check after startup settles; dev builds skip it so
  // `tauri dev` doesn't nag about the published release being newer.
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const id = setTimeout(() => void useUpdateStore.getState().checkForUpdates(), 3000);
    return () => clearTimeout(id);
  }, []);

  return (
    <LazyMotion features={domAnimation}>
      <HashRouter>
        {/* ChatPage stays mounted on every route; /settings only adds the
            modal overlay on top, so opening/closing settings never rebuilds
            the chat tree. */}
        <ChatPage />
        {/* ⌘K command palette (plan §4.2 #9); a pure projection of
            commandRegistry, mounted once for the whole app. */}
        <CommandPalette />
        <Routes>
          <Route
            path="/settings"
            element={
              <Suspense fallback={null}>
                <SettingsPage />
              </Suspense>
            }
          />
          {/* Plugin overlay pages (plan §4.2 #10); ChatPage stays mounted
              underneath, same as the /settings overlay. */}
          <Route path="/p/:pageId" element={<PluginPageHost />} />
        </Routes>
        {/* Non-modal plugin viewport mounts, independent of the route. */}
        <PluginOverlayHost />
      </HashRouter>
      <UpdateToast />
      <GrantAccessDialogHost />
      <CloseConfirmDialogHost />
      <ShortcutsGuideModal />
      <PetRuntime />
    </LazyMotion>
  );
}
