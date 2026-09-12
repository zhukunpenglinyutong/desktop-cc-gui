import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import { Button } from "@/components/base/buttons/button";
import { InfoTip } from "@/components/base/tooltip/tooltip";
import { Input } from "@/components/base/input/input";
import {
  SettingsCard,
  SettingsRow,
} from "@/components/application/settings/settings-rows";
import { ipc } from "@/lib/ipc";
import { pickSavePath } from "@/lib/platform";

/**
 * 部署中转: one-click deploy of the relay Worker into the user's own
 * Cloudflare account, or export of the wrangler project for a manual deploy.
 */
export function WebRelayDeployCard({
  relayKey,
  onRelayKeyChange,
  onDeployed,
  saveRelayFields,
}: {
  /** Current pairing key, so the exported pack and the field never disagree. */
  relayKey: string;
  onRelayKeyChange: (key: string) => void;
  /** Adopt the URL + key a deploy produced into the relay card's fields. */
  onDeployed: (url: string, key: string) => void;
  saveRelayFields: (url: string, key: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  /** Cloudflare API Token for the one-click deploy; kept in memory only —
   *  deploying is a once-per-user action, so storing a credential that can
   *  edit the whole account buys nothing. */
  const [apiToken, setApiToken] = useState("");
  /** Cloudflare Account ID, for account-owned tokens (`cfat_…`): those may not
   *  list accounts, so the id has to come from the user. Left blank with a user
   *  token, the backend reads the account by itself. Not a credential, but it
   *  lives next to the token and is only useful while one is in the field. */
  const [accountId, setAccountId] = useState("");
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployStatus, setDeployStatus] = useState<{ ok: boolean; text: string } | null>(null);

  /** Deploy the Worker into the user's account and fill both fields from the
   *  result, so the relay is usable without typing anything. The URL stays a
   *  plain input: whoever needs a custom domain (some regions cannot reach
   *  *.workers.dev) just edits it afterwards. */
  const deployRelay = useCallback(() => {
    void (async () => {
      setDeployBusy(true);
      setDeployStatus(null);
      try {
        const result = await ipc.relayDeploy(apiToken.trim(), accountId.trim() || null);
        onDeployed(result.url, result.key);
        // Persist right away: the key is uploaded as a Cloudflare secret, so
        // Cloudflare never shows it back — losing it here would mean the
        // Worker can only be used by deploying (and re-keying) again.
        await saveRelayFields(result.url, result.key);
        // Both fields are one-shot for this action: the token is a secret that
        // has just done its job, and the id is only meaningful next to one.
        setApiToken("");
        setAccountId("");
        setDeployStatus({
          ok: true,
          text: t("settings.webRelayDeployed", { account: result.accountName }),
        });
      } catch (error) {
        setDeployStatus({
          ok: false,
          text: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setDeployBusy(false);
      }
    })();
  }, [apiToken, accountId, onDeployed, saveRelayFields, t]);

  /** Write the whole wrangler project (source + config + this key) to disk, so
   *  the user can read it and `npx wrangler deploy` it themselves. */
  const exportDeployPack = useCallback(() => {
    void (async () => {
      const path = await pickSavePath(t("settings.webRelayExportSource"), "ccgui-relay.zip");
      if (!path) return;
      try {
        const key = await ipc.relayDeployPack(path, relayKey.trim() || null);
        // The pack carries a key; adopt it when the field was still empty so
        // GUI and pack never disagree.
        if (!relayKey.trim()) onRelayKeyChange(key);
        setDeployStatus(null);
      } catch (error) {
        setDeployStatus({
          ok: false,
          text: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [relayKey, onRelayKeyChange, t]);

  return (
    <SettingsCard>
      <SettingsRow
        label={t("settings.webRelayDeploy")}
        labelAdornment={
          // One trigger for both jobs: the hint before anything happened,
          // the Cloudflare answer afterwards — red when the deploy failed,
          // green when it landed. A second icon would have squeezed the
          // label onto two lines in a three-column row.
          <InfoTip
            label={deployStatus ? deployStatus.text : t("settings.webRelayDeployHint")}
            icon={CircleAlert}
            tone={deployStatus ? (deployStatus.ok ? "success" : "error") : "hint"}
          />
        }
      >
        <div className="flex items-center gap-2">
          <Button size="small" variant="secondary" onClick={exportDeployPack}>
            {t("settings.webRelayExportSource")}
          </Button>
          <Button
            size="small"
            variant="primary"
            disabled={deployBusy || !apiToken.trim()}
            onClick={deployRelay}
          >
            {t("settings.webRelayDeployNow")}
          </Button>
        </div>
      </SettingsRow>
      <div className="flex w-full flex-col gap-2 pt-3 pr-3 pb-3">
        <Input
          aria-label={t("settings.webRelayAccountId")}
          size="small"
          placeholder={t("settings.webRelayAccountIdPlaceholder")}
          value={accountId}
          onChange={setAccountId}
        />
        <Input
          aria-label={t("settings.webRelayApiKey")}
          type="password"
          size="small"
          placeholder={t("settings.webRelayApiKeyPlaceholder")}
          value={apiToken}
          onChange={setApiToken}
        />
      </div>
    </SettingsCard>
  );
}
