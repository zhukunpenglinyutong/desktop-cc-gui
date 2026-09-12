import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Download from "lucide-react/dist/esm/icons/download";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import SquareArrowOutUpRight from "lucide-react/dist/esm/icons/square-arrow-out-up-right";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { Input } from "@/components/base/input/input";
import { cx } from "@/utils/cx";
import { isWeb, openExternal } from "@/lib/platform";
import type { MarketPlugin } from "@/lib/ipc";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "./store";

const BADGE =
  "rounded-md bg-background-secondary-default px-1.5 py-0.5 text-xs text-text-secondary";

const ACTION_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded-lg bg-background-secondary-default whitespace-nowrap px-3 py-1.5 text-body-medium text-text-primary transition-colors hover:bg-background-secondary-hover disabled:cursor-not-allowed disabled:opacity-60";
/** Where plugins are submitted (central index) and a real reference plugin
 *  to learn from — both repos actually exist; the template repo is still
 *  local-only, so the tutorial points at the example instead of a dead link. */
const SUBMIT_REPO_URL = "https://github.com/zhukunpenglinyutong/ccgui-plugins";
const EXAMPLE_PLUGIN_URL =
  "https://github.com/zhukunpenglinyutong/ccgui-plugin-react-doctor";

function LinkButton({ url, label }: { url: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => openExternal(url)}
      className="flex cursor-pointer items-center gap-1 text-body-medium text-text-brand-secondary hover:underline"
    >
      {label}
      <SquareArrowOutUpRight className="size-3.5" aria-hidden />
    </button>
  );
}

/** Authoring + submission tutorial (用户教育): how to build a plugin locally
 *  and how to get it into the market. Plain ordered steps — the full guide
 *  lives in the template repo README, linked through the example repo. */
function DevelopCard() {
  const { t } = useTranslation();
  const localSteps = t("plugins.market.localSteps", { returnObjects: true }) as string[];
  const submitSteps = t("plugins.market.submitSteps", { returnObjects: true }) as string[];
  return (
    <SettingsCard className="flex flex-col gap-4 px-4 py-3">
      <span className="text-body-medium font-medium text-text-primary">
        {t("plugins.market.developTitle")}
      </span>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-primary">
          {t("plugins.market.localTitle")}
        </span>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-body-medium text-text-secondary">
          {localSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <LinkButton url={EXAMPLE_PLUGIN_URL} label={t("plugins.market.viewExample")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-primary">
          {t("plugins.market.submitTitle")}
        </span>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-body-medium text-text-secondary">
          {submitSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-medium text-text-tertiary">
            {t("plugins.market.repoAddress")}
          </span>
          <code className="rounded-md bg-background-secondary-default px-1.5 py-0.5 text-xs text-text-secondary">
            github.com/zhukunpenglinyutong/ccgui-plugins
          </code>
          <LinkButton url={SUBMIT_REPO_URL} label={t("plugins.market.openSubmitRepo")} />
        </div>
      </div>
    </SettingsCard>
  );
}

function MarketRow({ entry }: { entry: MarketPlugin }) {
  const { t } = useTranslation();
  const installed = usePluginsStore((s) => s.installed.find((p) => p.id === entry.id));
  const update = useMarketplaceStore((s) => s.updates.find((u) => u.id === entry.id));
  const installing = useMarketplaceStore((s) => s.installing);
  const install = useMarketplaceStore((s) => s.install);
  const busy = installing?.id === entry.id;

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate text-body-medium text-text-primary">{entry.name}</span>
            <span className={BADGE}>v{entry.version}</span>
            <span className={BADGE}>{entry.tier === "declarative" ? "Tier-0" : "JS"}</span>
            {entry.author && (
              <span className="truncate text-xs text-text-tertiary">{entry.author}</span>
            )}
          </div>
          {entry.description && (
            <span className="text-body-medium text-text-secondary">{entry.description}</span>
          )}
          {entry.permissions.length > 0 && (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              <span className="text-xs text-text-tertiary">
                {t("plugins.market.permissions")}
              </span>
              {entry.permissions.map((permission) => (
                <span key={permission} className={BADGE}>
                  {permission}
                </span>
              ))}
            </span>
          )}
        </div>
        {busy ? (
          <span className={cx(ACTION_BUTTON, "cursor-wait opacity-70")}>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {installing.total > 0
              ? t("plugins.installingPct", {
                  pct: Math.round((installing.done / installing.total) * 100),
                })
              : t("plugins.installing")}
          </span>
        ) : installed && !update ? (
          <span className={cx(BADGE, "text-text-tertiary")}>
            {t("plugins.market.installed")}
          </span>
        ) : (
          <button
            type="button"
            disabled={!!installing || isWeb}
            title={isWeb ? t("plugins.market.desktopOnly") : undefined}
            onClick={() => void install(entry.id)}
            className={ACTION_BUTTON}
          >
            <Download className="size-4" aria-hidden />
            {update
              ? t("plugins.market.updateTo", { version: update.latestVersion })
              : t("plugins.market.install")}
          </button>
        )}
      </div>
    </div>
  );
}

/** 插件市场 settings section (plan §6.3): browse/search the GitHub central
 *  index, one-click install and update. Uninstall/enable live in the
 *  插件管理 section — this page is the storefront, not the manager. */
export default function MarketplaceSection() {
  const { t } = useTranslation();
  const { entries, loaded, error, fetchIndex, checkUpdates } = useMarketplaceStore();
  const refreshInstalled = usePluginsStore((s) => s.refresh);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void fetchIndex();
    void checkUpdates();
    // Installed state decides install/update/已安装 — make sure it's current
    // even if the user opens the market before ever visiting 插件管理.
    void refreshInstalled();
  }, [fetchIndex, checkUpdates, refreshInstalled]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.id, entry.name, entry.description, entry.author]
        .join("\n")
        .toLowerCase()
        .includes(needle),
    );
  }, [entries, query]);

  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-background-secondary-default px-4 py-2 text-body-medium text-text-error-primary">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button
            type="button"
            onClick={() => void fetchIndex(true)}
            className="cursor-pointer whitespace-nowrap rounded-lg px-2 py-1 text-text-primary hover:bg-background-primary-hover"
          >
            {t("plugins.market.retry")}
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <SettingsSectionLabel>{t("plugins.marketTitle")}</SettingsSectionLabel>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={setQuery}
            placeholder={t("plugins.market.searchPlaceholder")}
            fieldClassName="w-56"
          />
          <button
            type="button"
            aria-label={t("plugins.market.refresh")}
            title={t("plugins.market.refresh")}
            onClick={() => void fetchIndex(true)}
            className="cursor-pointer rounded-lg p-2 text-foreground-icon-secondary transition-colors hover:bg-background-primary-hover hover:text-foreground-icon-primary"
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <SettingsCard className="divide-y divide-separator-border">
        {!loaded || entries.length === 0 ? (
          <div className="px-4 py-3 text-body-medium text-text-secondary">
            {loaded ? t("plugins.market.empty") : t("common.loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-3 text-body-medium text-text-secondary">
            {t("plugins.market.noMatch")}
          </div>
        ) : (
          filtered.map((entry) => <MarketRow key={entry.id} entry={entry} />)
        )}
      </SettingsCard>
      <p className="text-body-medium text-text-tertiary">{t("plugins.market.hint")}</p>
      <DevelopCard />
    </div>
  );
}
