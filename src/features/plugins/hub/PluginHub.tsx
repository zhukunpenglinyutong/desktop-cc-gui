import { useState } from "react";
import { useTranslation } from "react-i18next";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import FolderInput from "lucide-react/dist/esm/icons/folder-input";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import { cx } from "@/utils/cx";
import { isWeb } from "@/lib/platform";
import { usePluginHubStore } from "./store";
import { PluginDetailPage } from "./PluginDetailPage";
import { PluginInstalledView } from "./PluginInstalledView";
import { PluginMarketView } from "./PluginMarketView";
import { DevelopGuideDialog } from "./DevelopGuideDialog";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";
import { PluginListTranslateMenu } from "./translation/PluginTranslateControl";

const HEADER_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-primary-hover hover:text-text-primary";
/** 安装中：进度语言（转圈）由按钮内容表达，禁用光标是「等待」。 */
const HEADER_BUTTON_BUSY = "disabled:cursor-wait disabled:opacity-70";
/** 前提不满足（无工作区）：不是等待，是点不了。 */
const HEADER_BUTTON_BLOCKED = "disabled:cursor-not-allowed disabled:opacity-50";

/**
 * 插件 hub (native center tab): 市场 storefront + 已安装 manager, opened from
 * the sidebar entry and the palette commands. Replaces the two settings
 * sections — the settings rail now only carries plugin-registered settings
 * pages.
 *
 * 头部三个动作：从本地目录安装、创建插件（开新会话并预填内置 skill 调用，
 * 见 creator-chat.ts）、插件开发指南。
 */
export function PluginHub({
  onCreatePluginChat,
}: {
  /** 由 ChatCenterPane 提供（它持有 composer ref）；null = 还没有工作区，
   *  开不了会话，按钮置灰。 */
  onCreatePluginChat?: (() => void) | null;
} = {}) {
  const { t } = useTranslation();
  const view = usePluginHubStore((s) => s.view);
  const setView = usePluginHubStore((s) => s.setView);
  const installed = usePluginsStore((s) => s.installed);
  const installing = usePluginsStore((s) => s.installing);
  const installFromDirectory = usePluginsStore((s) => s.installFromDirectory);
  const entries = useMarketplaceStore((s) => s.entries);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  // Live lookups: an install that finishes while the detail page is open
  // flips it to the installed state without reopening.
  const detailEntry = detailId ? entries.find((entry) => entry.id === detailId) : undefined;
  const detailInstalled = detailId
    ? installed.find((plugin) => plugin.id === detailId)
    : undefined;

  // Detail is a full-page surface: it owns the whole hub area (including the
  // header row) so the back affordance matches the browse chrome height.
  if (detailId) {
    return (
      <PluginDetailPage
        id={detailId}
        entry={detailEntry}
        installed={detailInstalled}
        onClose={() => setDetailId(null)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background-primary-default">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-separator-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="shrink-0 text-title-3-medium text-text-primary">
            {t("plugins.hub.title")}
          </h1>
          <PillTabList>
            <PillTab
              variant="gray"
              isSelected={view === "market"}
              onSelect={() => setView("market")}
            >
              {t("plugins.hub.marketTab")}
            </PillTab>
            <PillTab
              variant="gray"
              isSelected={view === "installed"}
              onSelect={() => setView("installed")}
            >
              {t("plugins.hub.installedTab")}
            </PillTab>
          </PillTabList>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PluginListTranslateMenu />
          <button
            type="button"
            disabled={!onCreatePluginChat}
            title={
              onCreatePluginChat
                ? t("plugins.hub.createHint")
                : t("plugins.hub.createNoWorkspace")
            }
            onClick={() => onCreatePluginChat?.()}
            className={cx(HEADER_BUTTON, HEADER_BUTTON_BLOCKED)}
          >
            <Sparkles className="size-4" aria-hidden />
            {t("plugins.hub.create")}
          </button>
          <button
            type="button"
            disabled={!!installing || isWeb}
            title={isWeb ? t("plugins.market.desktopOnly") : undefined}
            onClick={() => void installFromDirectory()}
            className={cx(HEADER_BUTTON, HEADER_BUTTON_BUSY)}
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
              : t("plugins.hub.installLocal")}
          </button>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className={HEADER_BUTTON}
          >
            <BookOpen className="size-4" aria-hidden />
            {t("plugins.hub.guide")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 1080px: the market table needs the width its columns promise (the
            已安装 rows live with the same chrome so switching tabs doesn't
            shift the frame). */}
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-2 px-6 py-6">
          {view === "market" ? (
            <PluginMarketView onOpenDetail={setDetailId} />
          ) : (
            <PluginInstalledView onOpenDetail={setDetailId} />
          )}
        </div>
      </div>

      {guideOpen && <DevelopGuideDialog onClose={() => setGuideOpen(false)} />}
    </div>
  );
}
