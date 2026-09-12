import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import { Button } from "@/components/base/buttons/button";
import {
  SettingsCard,
  SettingsRow,
} from "@/components/application/settings/settings-rows";
import { ipc, type WebAccessInfo } from "@/lib/ipc";
import { isWeb } from "@/lib/platform";
import { cx } from "@/utils/cx";
import { readStoredBool, writeStored } from "@/lib/storage";
import { WebWanPane } from "./WebWanPane";
import { WebWanRiskDialog } from "./WebWanRiskDialog";

/**
 * Set once the user has accepted the internet-exposure warning. Local to this
 * machine on purpose: the risk is about *this* desktop being reachable, and a
 * fresh install deserves to be told again.
 */
const WAN_RISK_ACK_KEY = "ccgui-next.webWanRiskAccepted";

/**
 * Mobile/web access page: starts the LAN bridge (src-tauri/src/web.rs) and
 * shows the token-bearing URL as text + QR. Start/stop are desktop-only —
 * the bridge does not route them, so on web this page is a read-only status.
 */
export function WebAccessSection() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<WebAccessInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pane, setPane] = useState<"lan" | "wan">("lan");
  /** The 外网访问 tab stays behind a one-time warning: everything it enables
   *  hands a remote browser the same reach the user has on this machine. A
   *  ref, not state: it is only read by the tab's click handler, so a state
   *  update would redraw the page for nothing — accepting already re-renders
   *  via setPane/setRiskPrompt. */
  const wanRiskAcceptedRef = useRef(readStoredBool(WAN_RISK_ACK_KEY, false));
  /** Which tab to reveal once the warning is accepted; null when no ask is
   *  pending. Kept separate from `pane` so declining leaves 内网访问 showing. */
  const [riskPrompt, setRiskPrompt] = useState<"wan" | null>(null);

  /** Accepting reveals the tab and is remembered, so the warning is a
   *  first-run gate rather than a toll on every visit. */
  const acceptWanRisk = useCallback(() => {
    wanRiskAcceptedRef.current = true;
    writeStored(WAN_RISK_ACK_KEY, "1");
    if (riskPrompt) setPane(riskPrompt);
    setRiskPrompt(null);
  }, [riskPrompt]);

  useEffect(() => {
    let cancelled = false;
    ipc
      .webAccessStatus()
      .then((status) => {
        if (!cancelled) setInfo(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshInfo = useCallback(() => {
    void ipc
      .webAccessStatus()
      .then(setInfo)
      .catch(() => {});
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      setInfo(await ipc.webAccessStart());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await ipc.webAccessStop();
      setInfo(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const copyUrl = useCallback(() => {
    if (!info) return;
    void navigator.clipboard.writeText(info.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [info]);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-fit items-center gap-1 rounded-full bg-background-tertiary-default p-1">
        {(["lan", "wan"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={pane === id}
            onClick={() => {
              // 内网访问 is upstream's LAN behaviour and needs no warning; the
              // internet tab does, exactly once per machine.
              if (id === "wan" && !wanRiskAcceptedRef.current) {
                setRiskPrompt("wan");
                return;
              }
              setPane(id);
            }}
            className={cx(
              "cursor-pointer rounded-full px-3 py-1 text-body-2-medium transition-colors",
              pane === id
                ? "bg-background-primary-default text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {t(id === "lan" ? "settings.webLan" : "settings.webWan")}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}
      {pane === "lan" && (
        <>
          <SettingsCard>
            <SettingsRow
              label={info ? t("settings.webAccessRunning") : t("settings.webAccessStopped")}
              description={t("settings.webAccessDesc")}
            >
              {!isWeb && (
                <Button
                  size="small"
                  variant={info ? "secondary" : "primary"}
                  disabled={busy}
                  onClick={() => void (info ? stop() : start())}
                >
                  {info ? t("settings.webAccessStop") : t("settings.webAccessStart")}
                </Button>
              )}
            </SettingsRow>
            {info && (
              <div className="flex w-full flex-col gap-2 py-3 pr-3">
                <p className="text-body-regular text-text-primary">{t("settings.webAccessUrl")}</p>
                <div className="flex h-8 w-full items-center gap-1 rounded-2lg bg-background-tertiary-default pr-1 pl-2">
                  <span
                    className="min-w-0 flex-1 truncate text-body-regular text-text-primary"
                    title={info.url}
                  >
                    {info.url}
                  </span>
                  <button
                    type="button"
                    aria-label={t("settings.webAccessCopy")}
                    title={copied ? t("common.copied") : t("settings.webAccessCopy")}
                    onClick={copyUrl}
                    className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
                  >
                    {copied ? (
                      <Check className="size-4 text-notification-success-foreground" aria-hidden />
                    ) : (
                      <Copy className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
                <p className="text-body-2-regular text-text-secondary">
                  {t("settings.webAccessScanHint")}
                </p>
              </div>
            )}
          </SettingsCard>
          {info && (
            <div className="flex w-full flex-col items-center gap-3 py-2">
              <div className="rounded-2xl border border-separator-border bg-white p-3 shadow-sm">
                <QRCodeSVG value={info.url} size={180} />
              </div>
              <p className="max-w-[420px] text-center text-body-2-regular text-text-error-primary">
                {t("settings.webAccessWarning")}
              </p>
            </div>
          )}
        </>
      )}
      {pane === "wan" && <WebWanPane onInfoRefresh={refreshInfo} />}
      {riskPrompt && (
        <WebWanRiskDialog onCancel={() => setRiskPrompt(null)} onAccept={acceptWanRisk} />
      )}
    </div>
  );
}
