import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import CircleDot from "lucide-react/dist/esm/icons/circle-dot";
import Download from "lucide-react/dist/esm/icons/download";
import Github from "lucide-react/dist/esm/icons/github";
import Tag from "lucide-react/dist/esm/icons/tag";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import SquareArrowOutUpRight from "lucide-react/dist/esm/icons/square-arrow-out-up-right";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Button } from "@/components/base/buttons/button";
import { CenteredSpinner } from "@/components/base/empty-state";
import { ConfirmDialog } from "@/components/dialogs";
import { isWeb, openExternal } from "@/lib/platform";
import {
  ipc,
  type MarketPlugin,
  type PluginInfo,
  type PluginUpdate,
} from "@/lib/ipc";
import { githubAvatarUrl } from "@/lib/github-avatar";
import {
  categorizePlugin,
  githubLoginFor,
  indexUpdatedAt,
  isOfficialPlugin,
  OFFICIAL_PLUGIN_LOGIN,
} from "./catalog";
import { formatInstallCount } from "./install-count";
import { PluginAvatar } from "./PluginAvatar";
import { usePluginArtwork } from "./artwork";
import { PluginReadme } from "./PluginReadme";
import { PluginScreenshotCarousel } from "./PluginScreenshotCarousel";
import { describePermission } from "./permissions";
import { usePluginSettingsKey } from "./use-plugin-settings-key";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";

const BADGE =
  "rounded-md bg-background-secondary-default px-1.5 py-0.5 text-xs text-text-secondary";
const BADGE_OK = "rounded-md bg-status-lime-background px-1.5 py-0.5 text-xs text-status-lime-text";
// `w-fit`: the rail is a flex column, so a badge without it stretches across
// the whole 272px rail and reads as a filled row instead of a chip.
const OFFICIAL_BADGE =
  "w-fit shrink-0 rounded-md bg-status-purple-background px-1.5 py-0.5 text-xs text-status-purple-text";
const RAIL_LABEL = "text-caption-1-regular text-text-tertiary";
const RAIL_VALUE = "text-body-2-regular text-text-primary";
const LINK_BUTTON =
  "flex w-fit cursor-pointer items-center gap-1.5 text-body-2-regular text-text-brand-secondary hover:underline";

/** Progress placeholder that keeps the medium Button's height while it runs. */
const INSTALLING_BUTTON =
  "flex h-9 items-center gap-1.5 rounded-2lg border border-border-button-default bg-background-primary-default px-2.5 text-body-medium whitespace-nowrap text-text-tertiary";

/**
 * Right-hand rail. It sticks under the detail header and, because its rows can
 * be taller than the window (a 22-permission plugin after 展开全部), it scrolls
 * inside that box: a pinned rail without a height bound pushed its 链接 rows
 * below the viewport, where only scrolling the README to its end revealed them.
 * 10.5rem: session tab strip 2.5 + hub header 3 + status bar 1.75 + sticky
 * top 1.5 + bottom gap 1.75. The rail scrolls from there, so taller window
 * chrome costs a few pixels of that gap instead of hiding rows.
 */
const RAIL =
  "flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-10.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-separator-border lg:pl-6";

/** One label + value block in the right-hand rail. */
function RailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={RAIL_LABEL}>{label}</span>
      {children}
    </div>
  );
}

/**
 * One destination in the rail's 链接 row. The leading icon names the target
 * surface (the GitHub mark, a release tag, an issue dot) so the three links
 * stay tellable apart at a glance; the trailing arrow keeps the "leaves the
 * app" meaning that predates the icons.
 */
function ExternalLink({ icon: Icon, label, url }: { icon: LucideIcon; label: string; url: string }) {
  return (
    <button type="button" onClick={() => openExternal(url)} className={LINK_BUTTON}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
      <SquareArrowOutUpRight className="size-3.5 shrink-0" aria-hidden />
    </button>
  );
}

/**
 * Developer identity in the rail. First-party plugins show the official badge
 * instead of the account: it is the publisher, not a person to credit. The
 * badge still links to that brand account, so the publisher stays reachable
 * without printing the login next to it. For third-party plugins, when the
 * index resolves a GitHub account (`githubLoginFor`: the indexed `author`, or
 * the repo owner when `author` is only a display name) the whole avatar + name
 * chip links to that profile; a display name alone stays inert text rather
 * than pointing at a guessed URL.
 */
function AuthorChip({
  author,
  login,
  official,
}: {
  author: string;
  login: string | null;
  official: boolean;
}) {
  const { t } = useTranslation();
  if (official) {
    const profile = login || OFFICIAL_PLUGIN_LOGIN;
    return (
      <button
        type="button"
        title={t("plugins.hub.authorGithub", { login: profile })}
        onClick={() => openExternal(`https://github.com/${profile}`)}
        className="w-fit cursor-pointer rounded-md outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-border-focus-ring motion-reduce:transition-none"
      >
        <span className={OFFICIAL_BADGE}>{t("plugins.hub.official")}</span>
      </button>
    );
  }
  const label = author || login || "";
  const chip = (
    <>
      {label && (
        <PluginAvatar
          id={label}
          name={label}
          src={login ? githubAvatarUrl(login, 20) : null}
          size={20}
          shape="circle"
        />
      )}
      <span className="truncate">{label || "—"}</span>
    </>
  );

  if (!login) return <span className="flex min-w-0 items-center gap-2">{chip}</span>;
  return (
    <button
      type="button"
      title={t("plugins.hub.authorGithub", { login })}
      onClick={() => openExternal(`https://github.com/${login}`)}
      className="flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring"
    >
      {chip}
    </button>
  );
}

type ReadmeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; markdown: string }
  | { status: "error" };

/** Long-form intro lives on the repo, so it is fetched per detail open (the
 *  backend caches for an hour and answers instantly after the first hit). */
function useMarketReadme(entry?: MarketPlugin): ReadmeState {
  const [state, setState] = useState<ReadmeState>({ status: "idle" });
  const id = entry?.id;
  useEffect(() => {
    if (!id) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    ipc
      .pluginFetchMarketReadme(id)
      .then((markdown) => {
        if (!cancelled) setState({ status: "ready", markdown });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return state;
}

/**
 * Grants in the rail: the count is always visible, the first four read as
 * sentences, and the rest stay one click away — collapsed by default so a
 * 20-permission plugin doesn't push everything else out of the rail.
 */
function PermissionList({ permissions }: { permissions: string[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (permissions.length === 0) {
    return <span className={RAIL_VALUE}>{t("plugins.hub.permissionsEmpty")}</span>;
  }
  const visible = expanded ? permissions : permissions.slice(0, 4);

  return (
    <div className="flex flex-col gap-1.5">
      <span className={RAIL_VALUE}>
        {t("plugins.hub.permissionsCount", { n: permissions.length })}
      </span>
      <ul className="flex flex-col gap-1">
        {visible.map((permission) => {
          const label = describePermission(permission);
          return (
            <li
              key={permission}
              className="flex items-start gap-2 text-body-2-regular text-text-secondary"
            >
              <span
                aria-hidden
                className="mt-2 size-1 shrink-0 rounded-full bg-foreground-icon-secondary"
              />
              {t(label.key, label.params ?? {})}
            </li>
          );
        })}
      </ul>
      {permissions.length > 4 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="w-fit cursor-pointer text-body-2-regular text-text-brand-secondary hover:underline"
        >
          {expanded
            ? t("plugins.hub.permissionsCollapse")
            : t("plugins.hub.permissionsExpand", { n: permissions.length })}
        </button>
      )}
    </div>
  );
}

/** Every identity/metadata field the header and rail share, resolved once so
 *  the market entry and the installed record can't disagree mid-render. */
function pluginDetailModel(
  id: string,
  entry: MarketPlugin | undefined,
  installed: PluginInfo | undefined,
) {
  const name = entry?.name ?? installed?.name ?? id;
  const author = entry?.author || installed?.author || "";
  const repo = entry?.repo;
  return {
    id,
    name,
    description: installed?.description || entry?.description || "",
    author,
    authorLogin: githubLoginFor({ author, repo }),
    version: installed?.version || entry?.version || "",
    tier: installed?.tier ?? entry?.tier,
    repo,
    permissions: installed?.permissions.length
      ? installed.permissions
      : (entry?.permissions ?? []),
    downloads: entry?.downloads ?? null,
    updatedAt: indexUpdatedAt(entry?.updatedAt),
    minAppVersion: entry?.minAppVersion ?? installed?.minAppVersion ?? null,
    sdkVersion: entry?.sdkVersion ?? null,
    category: entry ? categorizePlugin(entry) : null,
  };
}

type PluginDetailModel = ReturnType<typeof pluginDetailModel>;

type InstallProgress = { id: string; done: number; total: number } | null;

/**
 * Full-page plugin detail (plan A layout): actions sit on the title row, the
 * long-form content owns the left column, and the metadata/permissions/links
 * rail is sticky on the right so it survives a README scroll.
 */
export function PluginDetailPage({
  id,
  entry,
  installed,
  onClose,
}: {
  id: string;
  entry?: MarketPlugin;
  installed?: PluginInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const install = useMarketplaceStore((s) => s.install);
  const installing = useMarketplaceStore((s) => (s.installing?.id === id ? s.installing : null));
  const update = useMarketplaceStore((s) => s.updates.find((u) => u.id === id));
  const uninstall = usePluginsStore((s) => s.uninstall);
  const settingsKey = usePluginSettingsKey(id);
  const readme = useMarketReadme(entry);
  const [confirming, setConfirming] = useState(false);

  const model = pluginDetailModel(id, entry, installed);
  // Market-first artwork, with the installed manifest as the fallback for
  // plugins the index does not carry (locally developed ones).
  const artwork = usePluginArtwork(entry, installed);
  const installPct =
    installing && installing.total > 0
      ? Math.round((installing.done / installing.total) * 100)
      : null;

  const openSettings = () => {
    if (!settingsKey) return;
    onClose();
    window.location.hash = `#/settings?page=${encodeURIComponent(settingsKey)}`;
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background-primary-default">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-separator-border px-4">
        <button
          type="button"
          onClick={onClose}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-primary-hover hover:text-text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("plugins.hub.backToList")}
        </button>
        <span className="min-w-0 truncate text-body-2-regular text-text-tertiary">
          {t("plugins.hub.title")} / {model.name}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-6 py-6">
          <PluginDetailHeader
            id={id}
            model={model}
            icon={artwork.icon}
            entry={entry}
            installed={installed}
            installing={installing}
            installPct={installPct}
            update={update}
            settingsKey={settingsKey}
            onInstall={() => void install(id)}
            onOpenSettings={openSettings}
            onRequestUninstall={() => setConfirming(true)}
          />

          <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_272px]">
            <div className="flex min-w-0 flex-col gap-6">
              <PluginScreenshotCarousel images={artwork.screenshots} name={model.name} />
              {readme.status === "loading" && <CenteredSpinner className="py-8" />}
              {readme.status === "ready" && (
                <PluginReadme markdown={readme.markdown} repo={model.repo ?? ""} />
              )}
              {readme.status === "error" && (
                <p className="text-body-2-regular text-text-tertiary">
                  {t("plugins.hub.readmeUnavailable")}
                </p>
              )}
              {!installed && entry && (
                <p className="text-body-2-regular text-text-tertiary">
                  {t("plugins.market.hint")}
                </p>
              )}
            </div>

            <PluginDetailRail model={model} installed={installed} />
          </div>
        </div>
      </div>

      {confirming && installed && (
        <ConfirmDialog
          danger
          message={t("plugins.uninstallConfirm", { name: model.name })}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onClose();
            void uninstall(installed, false);
          }}
        />
      )}
    </div>
  );
}

/** Title row: avatar, name/description/badges and the action cluster. */
function PluginDetailHeader({
  id,
  model,
  icon,
  entry,
  installed,
  installing,
  installPct,
  update,
  settingsKey,
  onInstall,
  onOpenSettings,
  onRequestUninstall,
}: {
  id: string;
  model: PluginDetailModel;
  icon: string | null;
  entry?: MarketPlugin;
  installed?: PluginInfo;
  installing: InstallProgress;
  installPct: number | null;
  update: PluginUpdate | undefined;
  settingsKey: string | null;
  onInstall: () => void;
  onOpenSettings: () => void;
  onRequestUninstall: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-start gap-4">
      <PluginAvatar id={id} name={model.name} src={icon} size={56} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-title-3-medium text-text-primary">{model.name}</h2>
        {model.description && (
          <p className="max-w-2xl text-body-2-regular text-text-secondary">{model.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {model.version && <span className={BADGE}>v{model.version}</span>}
          {model.tier && (
            <span className={BADGE}>
              {t(
                model.tier === "declarative"
                  ? "plugins.hub.tierDeclarative"
                  : "plugins.hub.tierJs",
              )}
            </span>
          )}
          {installed && <span className={BADGE_OK}>{t("plugins.hub.installed")}</span>}
          {model.downloads != null && (
            <span className={BADGE}>
              {t("plugins.hub.downloadsShort", { n: formatInstallCount(model.downloads) })}
            </span>
          )}
        </div>
      </div>

      <PluginHeaderActions
        entry={entry}
        installed={installed}
        installing={installing}
        installPct={installPct}
        update={update}
        settingsKey={settingsKey}
        onInstall={onInstall}
        onOpenSettings={onOpenSettings}
        onRequestUninstall={onRequestUninstall}
      />
    </header>
  );
}

/** Install / update / settings / uninstall cluster on the title row. */
function PluginHeaderActions({
  entry,
  installed,
  installing,
  installPct,
  update,
  settingsKey,
  onInstall,
  onOpenSettings,
  onRequestUninstall,
}: {
  entry?: MarketPlugin;
  installed?: PluginInfo;
  installing: InstallProgress;
  installPct: number | null;
  update: PluginUpdate | undefined;
  settingsKey: string | null;
  onInstall: () => void;
  onOpenSettings: () => void;
  onRequestUninstall: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1">
      {installing ? (
        <button type="button" disabled className={INSTALLING_BUTTON}>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {installPct != null
            ? t("plugins.installingPct", { pct: installPct })
            : t("plugins.installing")}
        </button>
      ) : entry && !installed ? (
        <Button
          variant="primary"
          leadingIcon={Download}
          disabled={isWeb}
          title={isWeb ? t("plugins.market.desktopOnly") : undefined}
          onClick={onInstall}
        >
          {t("plugins.hub.install")}
        </Button>
      ) : null}
      {entry && update && (
        <Button
          variant="primary"
          leadingIcon={Download}
          disabled={!!installing || isWeb}
          title={isWeb ? t("plugins.market.desktopOnly") : undefined}
          onClick={onInstall}
        >
          {t("plugins.hub.updateTo", { version: update.latestVersion })}
        </Button>
      )}
      {installed && settingsKey && (
        <Button variant="secondary" leadingIcon={Settings2} onClick={onOpenSettings}>
          {t("plugins.hub.openSettings")}
        </Button>
      )}
      {installed && installed.source !== "builtin" && (
        <Button
          variant="danger"
          leadingIcon={Trash2}
          disabled={isWeb}
          title={isWeb ? t("plugins.market.desktopOnly") : undefined}
          onClick={onRequestUninstall}
        >
          {t("plugins.uninstall")}
        </Button>
      )}
    </div>
  );
}

/** Sticky metadata/permissions/links rail. */
function PluginDetailRail({
  model,
  installed,
}: {
  model: PluginDetailModel;
  installed?: PluginInfo;
}) {
  const { t, i18n } = useTranslation();
  return (
    <aside className={RAIL}>
      <RailRow label={t("plugins.hub.author")}>
        <AuthorChip
          author={model.author}
          login={model.authorLogin}
          official={isOfficialPlugin({ author: model.author, repo: model.repo })}
        />
      </RailRow>

      {model.category && (
        <RailRow label={t("plugins.hub.infoCategory")}>
          <span className={RAIL_VALUE}>{t(`plugins.hub.categories.${model.category}`)}</span>
        </RailRow>
      )}

      {model.tier && (
        <RailRow label={t("plugins.hub.tier")}>
          <span className={RAIL_VALUE}>
            {t(
              model.tier === "declarative"
                ? "plugins.hub.tierDeclarative"
                : "plugins.hub.tierJs",
            )}
          </span>
        </RailRow>
      )}

      {(model.version || installed) && (
        <RailRow label={t("plugins.hub.version")}>
          <span className={RAIL_VALUE}>v{model.version}</span>
        </RailRow>
      )}

      {(model.minAppVersion || model.sdkVersion) && (
        <RailRow label={t("plugins.hub.compatibility")}>
          <span className={RAIL_VALUE}>
            {model.minAppVersion && (
              <span className="block">
                {t("plugins.hub.minAppShort", { version: model.minAppVersion })}
              </span>
            )}
            {model.sdkVersion && (
              <span className="block">
                {t("plugins.hub.sdkVersion")} {model.sdkVersion}
              </span>
            )}
          </span>
        </RailRow>
      )}

      {model.downloads != null && (
        <RailRow label={t("plugins.hub.downloadsLabel")}>
          <span className={RAIL_VALUE}>
            {t("plugins.hub.downloadsShort", { n: formatInstallCount(model.downloads) })}
          </span>
        </RailRow>
      )}

      {model.updatedAt && (
        <RailRow label={t("plugins.hub.updatedAt")}>
          <span className={RAIL_VALUE}>{model.updatedAt.toLocaleDateString(i18n.language)}</span>
        </RailRow>
      )}

      <RailRow label={t("plugins.hub.permissionsTitle")}>
        <PermissionList key={model.id} permissions={model.permissions} />
      </RailRow>

      {model.repo && (
        <RailRow label={t("plugins.hub.infoLinks")}>
          <div className="flex flex-col items-start gap-1.5">
            <ExternalLink
              icon={Github}
              label={t("plugins.hub.repo")}
              url={`https://github.com/${model.repo}`}
            />
            <ExternalLink
              icon={Tag}
              label={t("plugins.hub.releases")}
              url={`https://github.com/${model.repo}/releases`}
            />
            <ExternalLink
              icon={CircleDot}
              label={t("plugins.hub.issues")}
              url={`https://github.com/${model.repo}/issues`}
            />
          </div>
        </RailRow>
      )}
    </aside>
  );
}
