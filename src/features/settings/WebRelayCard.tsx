import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Focusable } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import { Input } from "@/components/base/input/input";
import {
  SettingsCard,
  SettingsRow,
} from "@/components/application/settings/settings-rows";
import { ipc, type RelayInfo } from "@/lib/ipc";
import { listenRelay } from "@/lib/events";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { cx } from "@/utils/cx";

/**
 * 中转服务: connects this desktop to the relay Worker. The address and key
 * fields stay editable by hand — a custom domain is pointed at the relay here.
 */
export function WebRelayCard({
  relayUrl,
  relayKey,
  onRelayUrlChange,
  onRelayKeyChange,
  saveRelayFields,
  onInfoRefresh,
}: {
  relayUrl: string;
  relayKey: string;
  onRelayUrlChange: (url: string) => void;
  onRelayKeyChange: (key: string) => void;
  saveRelayFields: (url: string, key: string) => Promise<void>;
  /** Connecting the relay starts the local bridge (it forwards through it),
   *  so the LAN pane re-reads its status instead of sitting on a stale
   *  已停止. */
  onInfoRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [relay, setRelay] = useState<RelayInfo | null>(null);
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);

  const refreshRelay = useCallback(() => {
    void ipc
      .webRelayStatus()
      .then((status) => {
        setRelay(status);
        // A healthy backend clears any local error text: the connected event
        // and the failure text describe the same thing.
        if (status && !status.error) setRelayError(null);
      })
      .catch(() => {});
  }, []);

  useTauriEvent(() =>
    listenRelay((error) => {
      // A give-up drops the session and carries the reason: keep it, so the
      // dot can still explain itself once the switch is back to 连接中转.
      if (error) setRelayError(error);
      refreshRelay();
    }),
  );

  // The status is event-driven while the card is mounted; this fetch runs once
  // so opening the tab shows the real state, not idle grey.
  useEffect(() => {
    refreshRelay();
  }, [refreshRelay]);

  const startRelay = useCallback(async () => {
    setRelayBusy(true);
    setRelayError(null);
    try {
      await ipc.webRelayStart(relayUrl.trim(), relayKey.trim());
      await saveRelayFields(relayUrl.trim(), relayKey.trim());
      // Not the snapshot the command returned: the agent dials in milliseconds
      // and pushes its `connected` event before that response lands, so
      // writing the snapshot would paint 未连接 over a relay that is already
      // up. The status read happens after both and is authoritative.
      refreshRelay();
      onInfoRefresh();
    } catch (e) {
      setRelayError(String(e));
    } finally {
      setRelayBusy(false);
    }
  }, [relayUrl, relayKey, saveRelayFields, refreshRelay, onInfoRefresh]);

  const stopRelay = useCallback(async () => {
    setRelayBusy(true);
    try {
      await ipc.webRelayStop();
      setRelay(null);
    } catch (e) {
      setRelayError(String(e));
    } finally {
      setRelayBusy(false);
    }
  }, []);

  // Relay state dot: driven by the backend's own state, so a reconnect clears
  // it by itself. The local message is the one a give-up hands over — by then
  // the backend has already dropped the session, so this is the only thing
  // left to explain the red dot on a switch that reads 连接中转 again.
  //
  // The dot doubles as the error surface: relay failures run long ("IO error:
  // 由于目标计算机积极拒绝，无法连接。 (os error 10061)") and an inline line
  // would shove the whole card row up and down on every reconnect. Same
  // pattern as the deploy status icon.
  const relayState = relay?.error
    ? {
        dot: "bg-text-error-primary",
        text: `${t("settings.webRelayFailed")}: ${relay.error}`,
      }
    : relay?.connected
      ? { dot: "bg-[var(--color-status-unseen)]", text: t("settings.webRelayStateLive") }
      : relayError
        ? {
            dot: "bg-text-error-primary",
            text: `${t("settings.webRelayFailed")}: ${relayError}`,
          }
        : { dot: "bg-foreground-icon-tertiary", text: t("settings.webRelayStateIdle") };

  return (
    <SettingsCard>
      <SettingsRow
        label={t("settings.webRelay")}
        labelAdornment={
          <Tooltip delay={150}>
            <Focusable>
              <button
                type="button"
                aria-label={relayState.text}
                className="flex size-3.5 shrink-0 cursor-help items-center justify-center"
              >
                <span className={cx("size-2 rounded-full", relayState.dot)} aria-hidden />
              </button>
            </Focusable>
            <TooltipContent className="max-w-[320px] whitespace-pre-line">
              {relayState.text}
            </TooltipContent>
          </Tooltip>
        }
      >
        <Button
          size="small"
          variant={relay ? "secondary" : "primary"}
          disabled={relayBusy || (!relay && (!relayUrl.trim() || !relayKey.trim()))}
          onClick={() => void (relay ? stopRelay() : startRelay())}
        >
          {relay ? t("settings.webRelayStop") : t("settings.webRelayStart")}
        </Button>
      </SettingsRow>
      <div className="flex w-full flex-col gap-2 pt-3 pr-3 pb-3">
        <Input
          aria-label={t("settings.webRelayUrl")}
          size="small"
          placeholder="https://ccgui-relay.<account>.workers.dev"
          value={relayUrl}
          onChange={onRelayUrlChange}
        />
        <Input
          aria-label={t("settings.webRelayKey")}
          type="password"
          size="small"
          placeholder={t("settings.webRelayKeyHint")}
          value={relayKey}
          onChange={onRelayKeyChange}
        />
        {/* No inline error line: the state dot's tooltip carries the full
            message, so a failure (or its disappearance on reconnect) never
            changes the card's height. */}
      </div>
    </SettingsCard>
  );
}
