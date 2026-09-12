import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import FolderInput from "lucide-react/dist/esm/icons/folder-input";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Switch } from "@/components/base/switch/switch";
import { isWeb } from "@/lib/platform";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { cx } from "@/utils/cx";
import { ConfirmDialog } from "@/components/dialogs";
import type { PluginInfo } from "@/lib/ipc";
import { usePluginsStore, usePluginStates } from "./usePlugins";
import { useMarketplaceStore } from "../marketplace/store";

const BADGE =
  "rounded-md bg-background-secondary-default px-1.5 py-0.5 text-xs text-text-secondary";

function PluginRow({ plugin }: { plugin: PluginInfo }) {
  const { t } = useTranslation();
  const states = usePluginStates();
  const setEnabled = usePluginsStore((s) => s.setEnabled);
  const uninstall = usePluginsStore((s) => s.uninstall);
  const runtime = states.find((s) => s.id === plugin.id);
  const update = useMarketplaceStore((s) => s.updates.find((u) => u.id === plugin.id));
  const installing = useMarketplaceStore((s) => s.installing);
  const installUpdate = useMarketplaceStore((s) => s.install);

  const stateText =
    runtime?.state === "quarantined"
      ? t("plugins.stateQuarantined")
      : runtime?.state === "failed"
        ? t("plugins.stateFailed")
        : runtime?.state === "incompatible"
          ? t("plugins.stateIncompatible")
          : null;
  const errorText = runtime?.error ?? plugin.lastError;

  // window.confirm is unreliable in Tauri's WKWebView (no JS confirm-panel
  // delegate — it can return a non-boolean, which the backend rejects as
  // "invalid type: map, expected a boolean"), so uninstall confirmation is
  // a real modal. Saved plugin data is never wiped on uninstall: deleteData
  // stays false and the KV rows ride the 30-day tombstone purge instead.
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate text-body-medium text-text-primary">{plugin.name}</span>
            <span className={BADGE}>v{plugin.version}</span>
            <span className={BADGE}>{plugin.tier === "declarative" ? "Tier-0" : "JS"}</span>
            <span className={BADGE}>
              {t(`plugins.source.${plugin.source}`, plugin.source)}
            </span>
            {stateText && (
              <span className={cx(BADGE, "text-text-error-primary")}>
                {stateText}
              </span>
            )}
          </div>
          {plugin.description && (
            <span className="truncate text-body-medium text-text-secondary">
              {plugin.description}
            </span>
          )}
          {errorText && (
            <span className="truncate text-body-medium text-text-error-primary">{errorText}</span>
          )}
        </div>
        <Switch
          size="sm"
          aria-label={plugin.name}
          isSelected={plugin.enabled}
          onChange={(next) => void setEnabled(plugin, next)}
        />
        {update && (
          <button
            type="button"
            disabled={!!installing || isWeb}
            title={isWeb ? t("plugins.market.desktopOnly") : undefined}
            onClick={() => void installUpdate(plugin.id)}
            className="flex cursor-pointer items-center gap-1 rounded-lg bg-background-secondary-default whitespace-nowrap px-2.5 py-1.5 text-body-medium text-text-primary transition-colors hover:bg-background-secondary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {installing?.id === plugin.id ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              t("plugins.market.updateTo", { version: update.latestVersion })
            )}
          </button>
        )}
        {plugin.source !== "builtin" && (
          <button
            type="button"
            aria-label={t("plugins.uninstall")}
            onClick={() => setConfirming(true)}
            className="cursor-pointer rounded-lg p-1.5 text-foreground-icon-secondary transition-colors hover:bg-background-primary-hover hover:text-foreground-icon-primary"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          danger
          message={t("plugins.uninstallConfirm", { name: plugin.name })}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void uninstall(plugin, false);
          }}
        />
      )}
    </div>
  );
}

/** 插件管理 settings section (plan §7 Phase 1 item 5): installed list,
 *  enable/disable, uninstall, install-from-directory. Marketplace browsing
 *  is Phase 3. */
export default function PluginsSection() {
  const { t } = useTranslation();
  const { installed, loaded, error, installing, refresh, installFromDirectory } =
    usePluginsStore();

  useEffect(() => {
    void refresh();
    // Update badges on marketplace rows ride the same 1h index cache; a
    // failed check just leaves the list empty, so fire and forget.
    void useMarketplaceStore.getState().checkUpdates();
  }, [refresh]);

  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <div className="rounded-xl bg-background-secondary-default px-4 py-2 text-body-medium text-text-error-primary">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between">
        <SettingsSectionLabel>{t("plugins.installedLabel")}</SettingsSectionLabel>
        <button
          type="button"
          disabled={!!installing}
          onClick={() => void installFromDirectory()}
          className={cx(
            "flex cursor-pointer items-center gap-1.5 rounded-lg bg-background-secondary-default whitespace-nowrap px-3 py-1.5 text-body-medium text-text-primary transition-colors hover:bg-background-secondary-hover",
            installing && "cursor-wait opacity-70",
          )}
        >
          {installing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <FolderInput className="size-4" aria-hidden />
          )}
          {installing
            ? installing.total > 0
              ? t("plugins.installingPct", {
                  pct: Math.round((installing.done / installing.total) * 100),
                })
              : t("plugins.installing")
            : t("plugins.installFromDir")}
        </button>
      </div>
      <SettingsCard className="divide-y divide-separator-border">
        {!loaded || installed.length === 0 ? (
          <div className="px-4 py-3 text-body-medium text-text-secondary">
            {loaded ? t("plugins.empty") : t("common.loading")}
          </div>
        ) : (
          installed.map((plugin) => <PluginRow key={plugin.id} plugin={plugin} />)
        )}
      </SettingsCard>
    </div>
  );
}
