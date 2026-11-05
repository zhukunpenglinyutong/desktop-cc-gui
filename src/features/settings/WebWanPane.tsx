import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard } from "@/components/application/settings/settings-rows";
import { ipc } from "@/lib/ipc";
import { isWeb } from "@/lib/platform";
import { listenSettingsChanged } from "@/lib/events";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { WebRelayDeployCard } from "./WebRelayDeployCard";
import { WebRelayCard } from "./WebRelayCard";
import { WebAuthCard } from "./WebAuthCard";
import { WebDevicesCard } from "./WebDevicesCard";

/**
 * 外网访问 pane: relay deploy, relay connection, pairing authorization, and
 * device approvals. All of it decides who can reach this desktop, so a
 * web-access client gets a desktop-only notice (the bridge refuses these
 * commands and keeps the desktop's values on settings writes).
 */
export function WebWanPane({ onInfoRefresh }: { onInfoRefresh: () => void }) {
  return isWeb ? <WanDesktopOnlyNotice /> : <WanControls onInfoRefresh={onInfoRefresh} />;
}

function WanDesktopOnlyNotice() {
  const { t } = useTranslation();
  return (
    <SettingsCard>
      <p className="px-4 py-3.5 text-body-regular text-text-secondary">
        {t("settings.webWanDesktopOnly")}
      </p>
    </SettingsCard>
  );
}

/** The relay URL/key fields are shared between the deploy card (which fills
 *  them) and the relay card (which edits them), so they live here. */
function WanControls({ onInfoRefresh }: { onInfoRefresh: () => void }) {
  const [relayUrl, setRelayUrl] = useState("");
  const [relayKey, setRelayKey] = useState("");
  const savedRelay = useRef<{ url: string; key: string } | null>(null);
  const refreshSequence = useRef(0);

  const refreshRelayFields = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const settings = await ipc.refreshAppSettings();
      if (sequence !== refreshSequence.current) return;
      const saved = { url: settings.webRelayUrl ?? "", key: settings.webRelayKey ?? "" };
      // A deployment can finish after this page was closed and reopened.
      // Reconcile committed changes, but don't erase drafts on unrelated events.
      if (savedRelay.current?.url !== saved.url || savedRelay.current?.key !== saved.key) {
        savedRelay.current = saved;
        setRelayUrl(saved.url);
        setRelayKey(saved.key);
      }
    } catch {
      // Keep the current fields when a settings refresh is unavailable.
    }
  }, []);
  useTauriEvent(() => listenSettingsChanged(refreshRelayFields));
  useEffect(() => {
    void refreshRelayFields();
    return () => { ++refreshSequence.current; };
  }, [refreshRelayFields]);

  const saveRelayFields = useCallback(async (url: string, key: string) => {
    const latest = await ipc.getAppSettings();
    await ipc.updateAppSettings({ ...latest, webRelayUrl: url || null, webRelayKey: key || null });
  }, []);

  return (
    <>
      <div className="flex w-full items-stretch gap-2">
        <div className="flex min-w-0 flex-1">
          <WebRelayDeployCard
            relayKey={relayKey}
            onRelayKeyChange={setRelayKey}
            onDeployed={(url, key) => {
              setRelayUrl(url);
              setRelayKey(key);
            }}
          />
        </div>
        <div className="flex min-w-0 flex-1">
          <WebRelayCard
            relayUrl={relayUrl}
            relayKey={relayKey}
            onRelayUrlChange={setRelayUrl}
            onRelayKeyChange={setRelayKey}
            saveRelayFields={saveRelayFields}
            onInfoRefresh={onInfoRefresh}
          />
        </div>
        <div className="flex min-w-0 flex-1">
          <WebAuthCard />
        </div>
      </div>
      <WebDevicesCard />
    </>
  );
}
