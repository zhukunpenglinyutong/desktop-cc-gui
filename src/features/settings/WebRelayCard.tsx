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
import { listenRelay, listenSettingsChanged } from "@/lib/events";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { Switch } from "@/components/base/switch/switch";
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
  /** 无人值守: the one piece of the relay that is remembered across launches.
   *  Re-read from settings, not derived from `relay` — 断开中转 clears it
   *  backend-side, and the web build shares the same command. */
  const [unattended, setUnattended] = useState(false);

  const refreshUnattended = useCallback(
    () =>
      // De-cached read: 断开中转 clears the marker backend-side, and that write
      // never passes through the frontend's cached copy.
      ipc
        .refreshAppSettings()
        .then((s) => setUnattended(s.webRelayUnattended === true))
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    void refreshUnattended();
  }, [refreshUnattended]);

  useTauriEvent(() => listenSettingsChanged(refreshUnattended));

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
    listenRelay(() => {
      // The backend never gives up while the switch is on, so the event only
      // says "the status moved" — the read below is what the dot paints.
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
      // 断开 also clears 无人值守 backend-side: one action says "stop it and
      // do not come back by yourself".
      setUnattended(false);
    } catch (e) {
      setRelayError(String(e));
    } finally {
      setRelayBusy(false);
    }
  }, []);

  /** 无人值守: write the marker and, when switching it on, dial right away —
   *  the point of the switch is a tunnel that is up, not one that waits for
   *  the next launch. Switching it off only drops the marker; the running
   *  tunnel is the button's business. */
  const toggleUnattended = useCallback(
    async (enabled: boolean) => {
      setRelayError(null);
      try {
        await ipc.webRelayUnattended(enabled);
        setUnattended(enabled);
        if (enabled && !relay) await startRelay();
      } catch (e) {
        setRelayError(String(e));
        // The marker may have committed before the dial failed: re-read
        // instead of guessing which half landed.
        void refreshUnattended();
      }
    },
    [relay, startRelay, refreshUnattended],
  );

  // Relay state dot: driven by the backend's own state, so a reconnect clears
  // it by itself. The failure reason rides on RelayInfo.error from the status
  // read — listenRelay carries no payload, it only says the status moved.
  // relayError covers the failures that never reach backend state: local
  // start/stop command errors.
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
        anchor="webRelay"
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
        <div className="flex items-center gap-2">
          {/* 无人值守 sits next to the button, not in the label: it is a
              modifier of the relay, and the row has no space for a second
              line of copy. The hint carries the whole meaning.
              The Tooltip needs the Focusable wrapper: react-aria's
              TooltipTrigger only wires triggers that consume its context, and
              RAC's Switch does not. Focusable then refs the `<label>` RAC
              renders, so react-aria logs a dev-only "child must be focusable"
              warning (that label carries no tabindex — the input inside it is
              the real focus target); production builds strip the check. */}
          <Tooltip delay={150}>
            <Focusable>
              <Switch
                aria-label={t("settings.webRelayUnattended")}
                size="sm"
                shape="pill"
                isSelected={unattended}
                isDisabled={relayBusy || (!relay && (!relayUrl.trim() || !relayKey.trim()))}
                onChange={(enabled) => void toggleUnattended(enabled)}
              />
            </Focusable>
            <TooltipContent className="max-w-[320px]">
              {t("settings.webRelayUnattendedHint")}
            </TooltipContent>
          </Tooltip>
          <Button
            size="small"
            variant={relay ? "secondary" : "primary"}
            disabled={relayBusy || (!relay && (!relayUrl.trim() || !relayKey.trim()))}
            onClick={() => void (relay ? stopRelay() : startRelay())}
          >
            {relay ? t("settings.webRelayStop") : t("settings.webRelayStart")}
          </Button>
        </div>
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
