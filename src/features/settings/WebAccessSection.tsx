import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Switch } from "@/components/base/switch/switch";
import { Select, SelectItem } from "@/components/base/select/select";
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
import {
  WEB_ACCESS_AUTO_START_KEY,
  WEB_ACCESS_SELECTED_IP_KEY,
} from "./web-access-keys";

/**
 * Set once the user has accepted the internet-exposure warning. Local to this
 * machine on purpose: the risk is about *this* desktop being reachable, and a
 * fresh install deserves to be told again.
 */
const WAN_RISK_ACK_KEY = "ccgui-next.webWanRiskAccepted";

/** Compact select trigger (h 32, radius/lg) per settings design conventions. */
const SELECT_TRIGGER = "h-8 min-w-[200px] w-auto gap-1 rounded-lg px-2 py-1.5";

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
  const [autoStart, setAutoStart] = useState(() =>
    readStoredBool(WEB_ACCESS_AUTO_START_KEY, false),
  );
  const [selectedIp, setSelectedIp] = useState<string | null>(() => {
    try {
      return localStorage.getItem(WEB_ACCESS_SELECTED_IP_KEY);
    } catch {
      return null;
    }
  });

  const wanRiskAcceptedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (wanRiskAcceptedRef.current === null) {
      wanRiskAcceptedRef.current = readStoredBool(WAN_RISK_ACK_KEY, false);
    }
  }, []);

  const [riskPrompt, setRiskPrompt] = useState<"wan" | null>(null);

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

  const [configuredPort, setConfiguredPort] = useState<number | null>(null);
  const [portDraft, setPortDraft] = useState<string>("");
  const [configuredToken, setConfiguredToken] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState<string>("");
  const [rotatingToken, setRotatingToken] = useState(false);

  useEffect(() => {
    if (!isWeb) {
      ipc
        .getAppSettings()
        .then((s) => {
          if (typeof s.webAccessAutoStart === "boolean") {
            setAutoStart(s.webAccessAutoStart);
            writeStored(
              WEB_ACCESS_AUTO_START_KEY,
              s.webAccessAutoStart ? "1" : "0",
            );
          }
          if (typeof s.webAccessPort === "number" && s.webAccessPort > 0) {
            setConfiguredPort(s.webAccessPort);
            setPortDraft(String(s.webAccessPort));
          } else {
            setConfiguredPort(null);
            setPortDraft("");
          }
          if (s.webAccessToken) {
            setConfiguredToken(s.webAccessToken);
            setTokenDraft(s.webAccessToken);
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleAutoStartChange = useCallback((enabled: boolean) => {
    setAutoStart(enabled);
    writeStored(WEB_ACCESS_AUTO_START_KEY, enabled ? "1" : "0");
    if (!isWeb) {
      void ipc
        .getAppSettings()
        .then((s) => {
          void ipc.updateAppSettings({ ...s, webAccessAutoStart: enabled });
        })
        .catch(() => {});
    }
  }, []);

  const commitPort = useCallback(() => {
    if (isWeb) return;
    const trimmed = portDraft.trim();
    const nextPort = trimmed ? Math.min(65535, Math.max(1, parseInt(trimmed, 10) || 0)) : null;
    setConfiguredPort(nextPort);
    setPortDraft(nextPort ? String(nextPort) : "");
    void ipc
      .getAppSettings()
      .then((s) => {
        void ipc.updateAppSettings({ ...s, webAccessPort: nextPort });
      })
      .catch(() => {});
  }, [portDraft]);

  const commitToken = useCallback(() => {
    if (isWeb) return;
    const trimmed = tokenDraft.trim();
    if (!trimmed) {
      setTokenDraft(configuredToken ?? info?.token ?? "");
      return;
    }
    setConfiguredToken(trimmed);
    void ipc
      .getAppSettings()
      .then((s) => {
        void ipc.updateAppSettings({ ...s, webAccessToken: trimmed });
      })
      .catch(() => {});
  }, [tokenDraft, configuredToken, info]);

  const rotateToken = useCallback(async () => {
    if (isWeb) return;
    setRotatingToken(true);
    try {
      const newToken = await ipc.webAccessRotateToken();
      setConfiguredToken(newToken);
      setTokenDraft(newToken);
    } catch (e) {
      setError(String(e));
    } finally {
      setRotatingToken(false);
    }
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

  const restart = useCallback(async () => {
    setBusy(true);
    try {
      await ipc.webAccessStop();
      setInfo(await ipc.webAccessStart());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const needsRestart = useMemo(() => {
    if (!info) return false;
    if (configuredPort !== null && configuredPort !== info.port) return true;
    if (configuredToken !== null && configuredToken !== info.token) return true;
    return false;
  }, [info, configuredPort, configuredToken]);

  const availableIps = useMemo(() => {
    if (!info) return [];
    const list =
      info.availableIps && info.availableIps.length > 0
        ? [...info.availableIps]
        : [{ ip: info.lanIp, label: info.lanIp }];
    if (!list.some((item) => item.ip === info.lanIp)) {
      list.unshift({ ip: info.lanIp, label: info.lanIp });
    }
    return list;
  }, [info]);

  const activeIp = useMemo(() => {
    if (!info) return "";
    if (selectedIp && availableIps.some((item) => item.ip === selectedIp)) {
      return selectedIp;
    }
    return info.lanIp;
  }, [info, selectedIp, availableIps]);

  const displayUrl = useMemo(() => {
    if (!info) return "";
    return `http://${activeIp}:${info.port}/?token=${info.token}`;
  }, [info, activeIp]);

  const copyUrl = useCallback(() => {
    if (!displayUrl) return;
    void navigator.clipboard.writeText(displayUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [displayUrl]);

  const handleIpChange = useCallback((key: unknown) => {
    if (key === null || key === undefined) return;
    const nextIp = String(key);
    setSelectedIp(nextIp);
    writeStored(WEB_ACCESS_SELECTED_IP_KEY, nextIp);
  }, []);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-fit items-center gap-1 rounded-full bg-background-tertiary-default p-1">
        {(["lan", "wan"] as const).map((id) => (
          <button
            key={id}
            type="button"
            data-setting-anchor={id === "lan" ? "webLanTab" : "webWanTab"}
            aria-pressed={pane === id}
            onClick={() => {
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
            {!isWeb && (
              <SettingsRow
                label={t("settings.webAccessAutoStart")}
                description={t("settings.webAccessAutoStartDesc")}
              >
                <Switch
                  size="sm"
                  aria-label={t("settings.webAccessAutoStart")}
                  isSelected={autoStart}
                  onChange={handleAutoStartChange}
                />
              </SettingsRow>
            )}
            {!isWeb && (
              <SettingsRow
                label={t("settings.webAccessPort")}
                description={t("settings.webAccessPortDesc")}
              >
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={t("settings.webAccessPort")}
                    size="small"
                    className="w-28"
                    inputClassName="text-center"
                    inputMode="numeric"
                    placeholder={t("settings.webAccessPortAuto")}
                    value={portDraft}
                    onChange={(v) => setPortDraft(v.replace(/\D/g, ""))}
                    onBlur={commitPort}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitPort();
                    }}
                  />
                  {Boolean(portDraft) && (
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => {
                        setPortDraft("");
                        setConfiguredPort(null);
                        void ipc.getAppSettings().then((s) => {
                          void ipc.updateAppSettings({ ...s, webAccessPort: null });
                        });
                      }}
                    >
                      {t("settings.webAccessPortReset")}
                    </Button>
                  )}
                </div>
              </SettingsRow>
            )}
            {!isWeb && (
              <SettingsRow
                label={t("settings.webAccessToken")}
                description={t("settings.webAccessTokenDesc")}
              >
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={t("settings.webAccessToken")}
                    size="small"
                    className="w-56"
                    inputClassName="font-mono text-xs"
                    value={tokenDraft || (info?.token ?? "")}
                    onChange={setTokenDraft}
                    onBlur={commitToken}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitToken();
                    }}
                  />
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={rotatingToken}
                    onClick={() => void rotateToken()}
                    title={t("settings.webAccessRotateToken")}
                  >
                    <RefreshCw className={cx("size-3.5", rotatingToken && "animate-spin")} />
                    {t("settings.webAccessRotateTokenBtn")}
                  </Button>
                </div>
              </SettingsRow>
            )}
            {needsRestart && (
              <div className="mx-3 my-1 flex items-center justify-between gap-3 rounded-lg bg-background-tertiary-warning p-2.5">
                <span className="text-body-2-medium text-text-warning-primary">
                  {t("settings.webAccessRestartNotice")}
                </span>
                <Button size="small" variant="secondary" onClick={() => void restart()} disabled={busy}>
                  {t("settings.webAccessRestartBtn")}
                </Button>
              </div>
            )}
            {info && (
              <SettingsRow
                label={t("settings.webAccessHostIp")}
                description={t("settings.webAccessHostIpDesc")}
              >
                <Select
                  aria-label={t("settings.webAccessHostIp")}
                  selectedKey={activeIp}
                  onSelectionChange={handleIpChange}
                  triggerClassName={SELECT_TRIGGER}
                >
                  {availableIps.map((entry) => (
                    <SelectItem key={entry.ip} id={entry.ip} textValue={entry.label}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </Select>
              </SettingsRow>
            )}
            {info && (
              <div className="flex w-full flex-col gap-2 py-3 pr-3">
                <p className="text-body-regular text-text-primary">{t("settings.webAccessUrl")}</p>
                <div className="flex h-8 w-full items-center gap-1 rounded-2lg bg-background-tertiary-default pr-1 pl-2">
                  <span
                    className="min-w-0 flex-1 truncate text-body-regular text-text-primary"
                    title={displayUrl}
                  >
                    {displayUrl}
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
                <QRCodeSVG value={displayUrl} size={180} />
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
