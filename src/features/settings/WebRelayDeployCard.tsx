import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Download from "lucide-react/dist/esm/icons/download";
import LogIn from "lucide-react/dist/esm/icons/log-in";
import Zap from "lucide-react/dist/esm/icons/zap";
import {
  Dropdown,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { InfoTip } from "@/components/base/tooltip/tooltip";
import { Input } from "@/components/base/input/input";
import {
  SettingsCard,
  SettingsRow,
} from "@/components/application/settings/settings-rows";
import { ipc } from "@/lib/ipc";
import { pickSavePath } from "@/lib/platform";
import { WebRelayLoginDialog } from "./WebRelayLoginDialog";
import { useWebRelayLogin } from "./useWebRelayLogin";

/**
 * 部署中转: one-click deploy of the relay Worker into the user's own
 * Cloudflare account, or export of the wrangler project for a manual deploy.
 */
export function WebRelayDeployCard({
  relayKey,
  onRelayKeyChange,
  onDeployed,
}: {
  /** Current pairing key, so the exported pack and the field never disagree. */
  relayKey: string;
  onRelayKeyChange: (key: string) => void;
  /** Adopt the URL + key a deploy produced into the relay card's fields. */
  onDeployed: (url: string, key: string) => void;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const busyRef = useRef(false);
  const login = useWebRelayLogin((result) => {
    busyRef.current = false;
    onDeployed(result.url, result.key);
    setDeployStatus({
      ok: !result.error,
      text: result.error ?? t("settings.webRelayDeployed", { account: result.accountName }),
    });
  });
  const busy = deployBusy || login.state.status !== "idle";

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const beginLogin = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setMenuOpen(false);
    setDeployStatus(null);
    void login.begin();
  }, [login.begin]);

  /** Deploy the Worker into the user's account and fill both fields from the
   *  result, so the relay is usable without typing anything. The URL stays a
   *  plain input: whoever needs a custom domain (some regions cannot reach
   *  *.workers.dev) just edits it afterwards. */
  const deployRelay = useCallback(() => {
    if (busyRef.current || !apiToken.trim()) return;
    busyRef.current = true;
    setMenuOpen(false);
    void (async () => {
      setDeployBusy(true);
      setDeployStatus(null);
      try {
        const result = await ipc.relayDeploy(apiToken.trim(), accountId.trim() || null);
        onDeployed(result.url, result.key);
        // Both fields are one-shot for this action: the token is a secret that
        // has just done its job, and the id is only meaningful next to one.
        setApiToken("");
        setAccountId("");
        setDeployStatus({
          ok: !result.error,
          text: result.error ?? t("settings.webRelayDeployed", { account: result.accountName }),
        });
      } catch (error) {
        setDeployStatus({
          ok: false,
          text: error instanceof Error ? error.message : String(error),
        });
      } finally {
        busyRef.current = false;
        setDeployBusy(false);
      }
    })();
  }, [apiToken, accountId, onDeployed, t]);

  /** Write the whole wrangler project (source + config + this key) to disk, so
   *  the user can read it and `npx wrangler deploy` it themselves. */
  const exportDeployPack = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setMenuOpen(false);
    setDeployBusy(true);
    void (async () => {
      try {
        const path = await pickSavePath(t("settings.webRelayExportSource"), "ccgui-relay.zip");
        if (!path) return;
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
      } finally {
        busyRef.current = false;
        setDeployBusy(false);
      }
    })();
  }, [relayKey, onRelayKeyChange, t]);

  return (
    <SettingsCard>
      <SettingsRow
        anchor="webRelayDeploy"
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
        <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownTrigger
            aria-label={t("settings.webRelayDeployNow")}
            isDisabled={busy}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border-button-default bg-background-primary-default px-2 py-1.5 text-body-medium text-text-primary shadow-xs hover:bg-background-primary-hover hover:border-border-button-hover disabled:opacity-50"
          >
            <span className="inline-flex items-center px-0.5">{t("settings.webRelayDeployNow")}</span>
            <ChevronDown className="size-4 shrink-0" aria-hidden />
          </DropdownTrigger>
          <DropdownPopover
            aria-label={t("settings.webRelayDeployNow")}
            placement="bottom end"
            className="w-max min-w-48"
          >
            <DropdownItem
              disabled={!apiToken.trim()}
              className="px-2 py-1.5 whitespace-nowrap"
              onSelect={deployRelay}
            >
              <Zap className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
              {t("settings.webRelayDeployNow")}
            </DropdownItem>
            <DropdownItem className="px-2 py-1.5 whitespace-nowrap" onSelect={beginLogin}>
              <LogIn className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
              {t("settings.webRelayLoginDeploy")}
            </DropdownItem>
            <DropdownItem className="px-2 py-1.5 whitespace-nowrap" onSelect={exportDeployPack}>
              <Download className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
              {t("settings.webRelayExportSource")}
            </DropdownItem>
          </DropdownPopover>
        </Dropdown>
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
      {login.state.status !== "idle" && <WebRelayLoginDialog flow={login} />}
    </SettingsCard>
  );
}
