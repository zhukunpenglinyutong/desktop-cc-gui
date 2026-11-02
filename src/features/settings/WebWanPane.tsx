import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard } from "@/components/application/settings/settings-rows";
import { ipc } from "@/lib/ipc";
import { isWeb } from "@/lib/platform";
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

  useEffect(() => {
    void ipc
      .getAppSettings()
      .then((s) => {
        setRelayUrl(s.webRelayUrl ?? "");
        setRelayKey(s.webRelayKey ?? "");
      })
      .catch(() => {});
  }, []);

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
            saveRelayFields={saveRelayFields}
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
