import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import Copy from "lucide-react/dist/esm/icons/copy";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { Button } from "@/components/base/buttons/button";
import { InfoTip } from "@/components/base/tooltip/tooltip";
import {
  SettingsCard,
  SettingsRow,
} from "@/components/application/settings/settings-rows";
import { ipc } from "@/lib/ipc";
import { listenSettingsChanged } from "@/lib/events";
import { useTauriEvent } from "@/hooks/use-tauri-event";

/**
 * 授权开关 + pairing key. These are settings-level: they belong to the relay,
 * not to the LAN bridge's runtime — and hiding them whenever the bridge was
 * stopped read as the whole feature having disappeared.
 */
export function WebAuthCard() {
  const { t } = useTranslation();
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authKey, setAuthKey] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  /** Re-read the switch and the code from the backend: it rotates the key on
   *  its own (after a pairing, and on a timer), so the cached copy is exactly
   *  what must not be trusted here. */
  const refreshAuth = useCallback(
    () =>
      ipc
        .refreshAppSettings()
        .then((s) => {
          setAuthEnabled(s.webAuthEnabled ?? false);
          setAuthKey(s.webAuthKey ?? "");
        })
        .catch(() => {}),
    [],
  );

  // The pairing key rotates by itself (after a pairing, and on a timer), so
  // this card re-reads settings whenever anything writes them.
  useTauriEvent(() => listenSettingsChanged(refreshAuth));
  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  /** Turning the switch on drops stored approvals and lets the backend mint
   *  the key (web_auth_key: null); the code is read back afterwards, so the
   *  screen always shows the one a phone has to type. */
  const setAuth = useCallback(
    async (enabled: boolean) => {
      setAuthBusy(true);
      try {
        const latest = await ipc.getAppSettings();
        await ipc.updateAppSettings({
          ...latest,
          webAuthEnabled: enabled,
          webAuthKey: null,
        });
        await refreshAuth();
      } finally {
        setAuthBusy(false);
      }
    },
    [refreshAuth],
  );

  /** Mint a new pairing key on demand — for the "that key has been seen by
   *  someone else" moment. The backend rotates it after every pairing and on a
   *  timer anyway; this just brings that forward. */
  const rotateKey = useCallback(() => {
    setAuthBusy(true);
    void ipc
      .rotateWebPairKey()
      .then((key) => {
        if (key) setAuthKey(key);
      })
      .catch(() => {})
      .finally(() => setAuthBusy(false));
  }, []);

  // The box is always there — with the switch off it shows a dash
  // placeholder so the card keeps its shape and the reader sees that
  // a key exists only while authorization is on. The copy button is
  // disabled then, so the placeholder can never be copied out.
  const canCopyKey = authEnabled && Boolean(authKey);

  return (
    <SettingsCard>
      <SettingsRow
        label={t("settings.webAuth")}
        labelAdornment={<InfoTip label={t("settings.webAuthKeyHint")} icon={CircleAlert} />}
      >
        <Button
          size="small"
          variant={authEnabled ? "secondary" : "primary"}
          disabled={authBusy}
          onClick={() => void setAuth(!authEnabled)}
        >
          {authEnabled ? t("settings.webAuthDisable") : t("settings.webAuthEnable")}
        </Button>
      </SettingsRow>
      <div className="flex w-full flex-1 items-center justify-center pt-3 pr-3 pb-3">
        <div className="flex h-9 w-fit items-center rounded-2lg bg-background-tertiary-default pr-1 pl-1">
          {/* Refresh mirrors the copy button: same size, same hover,
              one separator on each side of the key. */}
          <button
            type="button"
            aria-label={t("settings.webAuthRotate")}
            title={t("settings.webAuthRotate")}
            disabled={!canCopyKey || authBusy}
            onClick={rotateKey}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary disabled:cursor-default disabled:text-foreground-icon-quaternary disabled:hover:bg-transparent"
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
          <span aria-hidden className="mx-2 h-4 w-px shrink-0 bg-separator-border-strong" />
          <span className="font-mono text-title-3 tracking-[0.18em] text-text-primary">
            {canCopyKey ? authKey : "--------"}
          </span>
          <span aria-hidden className="mx-2 h-4 w-px shrink-0 bg-separator-border-strong" />
          <button
            type="button"
            aria-label={t("settings.webAuthCopy")}
            title={t("settings.webAuthCopy")}
            disabled={!canCopyKey}
            onClick={() => {
              if (canCopyKey) void navigator.clipboard.writeText(authKey);
            }}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary disabled:cursor-default disabled:text-foreground-icon-quaternary disabled:hover:bg-transparent"
          >
            <Copy className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </SettingsCard>
  );
}
