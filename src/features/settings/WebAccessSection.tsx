import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import { Button } from "@/components/base/buttons/button";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { ipc, type WebAccessInfo } from "@/lib/ipc";
import { isWeb } from "@/lib/platform";

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
      <SettingsSectionLabel>{t("settings.webAccess")}</SettingsSectionLabel>
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}
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
          <SettingsRow label={t("settings.webAccessUrl")} description={t("settings.webAccessScanHint")}>
            <div className="flex shrink-0 items-center gap-2">
              <span className="max-w-[260px] truncate text-body-regular text-text-secondary" title={info.url}>
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
          </SettingsRow>
        )}
      </SettingsCard>
      {info && (
        <div className="flex w-full flex-col items-center gap-3 py-2">
          <div className="rounded-2xl bg-white p-3">
            <QRCodeSVG value={info.url} size={180} />
          </div>
          <p className="max-w-[420px] text-center text-body-2-regular text-text-error-primary">
            {t("settings.webAccessWarning")}
          </p>
        </div>
      )}
    </div>
  );
}
