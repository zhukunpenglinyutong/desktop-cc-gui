import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Smartphone from "lucide-react/dist/esm/icons/smartphone";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import {
  SettingsCard,
  SettingsRow,
} from "@/components/application/settings/settings-rows";
import { ipc, type WebDevice } from "@/lib/ipc";
import { listenWebDevices } from "@/lib/events";
import { useTauriEvent } from "@/hooks/use-tauri-event";

/** "iPhone · Safari": the raw UA is unreadable in a list row. */
function summarizeUa(ua: string): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  return [os, browser].filter(Boolean).join(" · ");
}

/** 设备授权: a paired browser waits here until 授权 lets it in. */
export function WebDevicesCard() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<WebDevice[]>([]);
  /** Id of the row being renamed, and the value in its field. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const refreshDevices = useCallback(() => {
    void ipc
      .webDevices()
      .then(setDevices)
      .catch(() => {});
  }, []);

  useEffect(() => refreshDevices(), [refreshDevices]);
  useTauriEvent(() => listenWebDevices(refreshDevices));

  const revoke = useCallback(
    (id: string) => {
      void ipc
        .webDeviceRevoke(id)
        .then(refreshDevices)
        .catch(() => {});
    },
    [refreshDevices],
  );

  // Approving is what actually lets a paired browser in — the key alone only
  // files the request.
  const approveDevice = useCallback(
    (id: string) => {
      void ipc
        .webDeviceApprove(id)
        .then(refreshDevices)
        .catch(() => {});
    },
    [refreshDevices],
  );

  const saveRename = useCallback(
    (id: string) => {
      setRenaming(null);
      void ipc
        .webDeviceRename(id, renameValue.trim())
        .then(refreshDevices)
        .catch(() => {});
    },
    [renameValue, refreshDevices],
  );

  return (
    <SettingsCard>
      <SettingsRow label={t("settings.webDevices")} />
      {devices.length === 0 ? (
        <p className="pt-3 pr-3 pb-3 text-body-2-regular text-text-secondary">
          {t("settings.webDevicesEmpty")}
        </p>
      ) : (
        <div className="flex w-full flex-col">
          {devices.map((device) => {
            const approved = device.approvedAt !== null;
            return (
              <div
                key={device.id}
                className="flex w-full items-center gap-3 border-t border-separator-border py-2.5 pr-3"
              >
                <Smartphone
                  className="size-4 shrink-0 text-foreground-icon-tertiary"
                  aria-hidden
                />
                {renaming === device.id ? (
                  <Input
                    autoFocus
                    size="small"
                    aria-label={t("settings.webDeviceRename")}
                    placeholder={summarizeUa(device.userAgent)}
                    value={renameValue}
                    onChange={setRenameValue}
                    className="min-w-0 flex-1"
                    onKeyDown={(event) => {
                      // Enter confirms an IME candidate mid-composition; only a
                      // post-composition Enter may commit the rename.
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") saveRename(device.id);
                      if (event.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => {
                      // Enter already saved and cleared `renaming`; a second
                      // call would just repeat the same write.
                      if (renaming === device.id) saveRename(device.id);
                    }}
                  />
                ) : (
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-regular text-text-primary">
                      {device.name ||
                        summarizeUa(device.userAgent) ||
                        t("settings.webDeviceAnonymous")}
                    </span>
                    <span className="truncate text-body-2-regular text-text-secondary">
                      {/* Matches the code the phone shows while it waits for approval. */}
                      {device.id.slice(0, 8).toUpperCase()} ·{" "}
                      {approved
                        ? t("settings.webDeviceApproved")
                        : t("settings.webDevicePending")}
                    </span>
                  </div>
                )}
                {approved ? (
                  <>
                    <button
                      type="button"
                      aria-label={t("settings.webDeviceRename")}
                      title={t("settings.webDeviceRename")}
                      onClick={() => {
                        setRenameValue(device.name ?? "");
                        setRenaming(device.id);
                      }}
                      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <Button size="small" variant="secondary" onClick={() => revoke(device.id)}>
                      {t("settings.webDeviceRevoke")}
                    </Button>
                  </>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="small" variant="secondary" onClick={() => revoke(device.id)}>
                      {t("settings.webDeviceCancel")}
                    </Button>
                    <Button size="small" variant="primary" onClick={() => approveDevice(device.id)}>
                      {t("settings.webDeviceApprove")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SettingsCard>
  );
}
