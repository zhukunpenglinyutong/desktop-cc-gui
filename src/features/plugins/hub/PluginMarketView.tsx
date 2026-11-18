import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { Select, SelectItem } from "@/components/base/select/select";
import { Input } from "@/components/base/input/input";
import { CenteredSpinner } from "@/components/base/empty-state";
import {
  categorizePlugin,
  categoryCounts,
  pluginMatchesQuery,
  sortPlugins,
  type PluginCategory,
  type PluginSort,
} from "./catalog";
import { PluginMarketRow } from "./PluginMarketRow";
import { PluginSpotlight } from "./PluginSpotlight";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";
import { translationKey, usePluginTranslationStore } from "./translation/store";

const SELECT_TRIGGER = "min-w-36";
const TH = "px-4 py-2.5 text-left text-caption-1-medium text-text-tertiary";

/**
 * One category filter chip. Counts come from `categoryCounts` so the row shows
 * the shape of the index before anything is clicked.
 */
function CategoryChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={
        selected
          ? "flex cursor-pointer items-center gap-1.5 rounded-full bg-background-secondary-default px-3 py-1.5 text-body-2-medium text-text-primary"
          : "flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-primary-hover hover:text-text-primary"
      }
    >
      {label}
      <span className="text-caption-1-regular text-text-tertiary tabular-nums">{count}</span>
    </button>
  );
}

/**
 * 市场 tab: category chips + search/sort toolbar over the market table.
 *
 * 市场 tab: 编辑精选轮播 + category chips + search/sort toolbar over the market
 * table.
 *
 * 表格是主体（一行一个插件，列可比较，安装/更新/已安装状态由动作按钮承担，
 * 不重复徽标）。轮播是上面的编辑层：没有精选数据时它自己不渲染，工具栏与表格
 * 的位置不变 —— 推荐位不是表格的替代品。索引刷新、安装进度、web 只读护栏都沿用
 * 原来的行为。
 */
export function PluginMarketView({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const { t } = useTranslation();
  const { entries, loaded, error, fetchIndex, checkUpdates } = useMarketplaceStore();
  const refreshInstalled = usePluginsStore((s) => s.refresh);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | PluginCategory>("all");
  const [sort, setSort] = useState<PluginSort>("smart");
  const refreshAction = useActionFeedback({ spin: true });
  const refreshing = refreshAction.feedback === "running";

  const handleRefresh = () => {
    if (refreshing) return;
    void refreshAction.start(
      () => fetchIndex(true),
      // fetchIndex reports failure through store state instead of throwing.
      () => useMarketplaceStore.getState().error != null,
    );
  };

  useEffect(() => {
    void fetchIndex();
    void checkUpdates();
    // Installed state decides install/update/✓ — make sure it's current even
    // if the user opens the hub before ever visiting 已安装.
    void refreshInstalled();
  }, [fetchIndex, checkUpdates, refreshInstalled]);

  const counts = useMemo(() => categoryCounts(entries), [entries]);
  // The column only exists when the index actually carries stats (counts are
  // decorative, never a gate) — an all-dashes column is noise.
  const showDownloads = useMemo(
    () => entries.some((entry) => entry.downloads != null),
    [entries],
  );
  // 官方 / 第三方 narrow the list, so they count as an active filter for the
  // empty-state reset button too.
  const filtering =
    query.trim().length > 0 ||
    category !== "all" ||
    sort === "official" ||
    sort === "thirdParty";
  // 显示译文时，搜索也命中译文：用户照着屏幕上的文字搜，不该只匹配看不见的原文。
  const displayLanguage = usePluginTranslationStore((s) => s.displayLanguage);
  const summaries = usePluginTranslationStore((s) => s.summaries);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matchesTranslation = (id: string): boolean => {
      if (!needle || !displayLanguage) return false;
      const translated = summaries[translationKey(id, displayLanguage)];
      return !!translated && `${translated.name}\n${translated.description}`.toLowerCase().includes(needle);
    };
    return sortPlugins(
      entries.filter(
        (entry) =>
          (pluginMatchesQuery(entry, query) || matchesTranslation(entry.id)) &&
          (category === "all" || categorizePlugin(entry) === category),
      ),
      sort,
    );
  }, [entries, query, category, sort, displayLanguage, summaries]);

  return (
    <div className="flex w-full flex-col gap-4">
      <PluginSpotlight onOpenDetail={onOpenDetail} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          role="group"
          aria-label={t("plugins.hub.categoryFilter")}
          className="flex flex-wrap items-center gap-1"
        >
          <CategoryChip
            label={t("plugins.hub.categoryAll")}
            count={entries.length}
            selected={category === "all"}
            onSelect={() => setCategory("all")}
          />
          {counts.map(({ category: id, count }) => (
            <CategoryChip
              key={id}
              label={t(`plugins.hub.categories.${id}`)}
              count={count}
              selected={category === id}
              onSelect={() => setCategory(id)}
            />
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            aria-label={t("plugins.hub.sortLabel")}
            selectedKey={sort}
            onSelectionChange={(key) => setSort(String(key) as PluginSort)}
            triggerClassName={SELECT_TRIGGER}
          >
            <SelectItem id="smart">{t("plugins.hub.sortSmart")}</SelectItem>
            <SelectItem id="official">{t("plugins.hub.sortOfficial")}</SelectItem>
            <SelectItem id="thirdParty">{t("plugins.hub.sortThirdParty")}</SelectItem>
            <SelectItem id="downloads">{t("plugins.hub.sortDownloads")}</SelectItem>
          </Select>
          <Input
            value={query}
            onChange={setQuery}
            placeholder={t("plugins.hub.searchPlaceholder")}
            className="w-64 max-w-full"
          />
          <button
            type="button"
            aria-label={t("plugins.hub.refresh")}
            title={t("plugins.hub.refresh")}
            disabled={refreshing}
            onClick={handleRefresh}
            className="cursor-pointer rounded-lg p-2 text-foreground-icon-secondary transition-colors hover:bg-background-primary-hover hover:text-foreground-icon-primary disabled:cursor-default disabled:opacity-60"
          >
            <ActionFeedbackIcon icon={RefreshCw} feedback={refreshAction.feedback} spin />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-background-secondary-default px-4 py-2 text-body-medium text-text-error-primary">
          <span className="min-w-0 flex-1 truncate">
            {t("plugins.hub.loadFailed")}: {error}
          </span>
          <button
            type="button"
            onClick={() => void fetchIndex(true)}
            className="cursor-pointer whitespace-nowrap rounded-lg px-2 py-1 text-text-primary hover:bg-background-primary-hover"
          >
            {t("plugins.market.retry")}
          </button>
        </div>
      )}

      {!loaded ? (
        <CenteredSpinner className="py-16" />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-14">
          <p className="text-body-regular text-text-tertiary">
            {entries.length === 0 ? t("plugins.hub.empty") : t("plugins.hub.noMatch")}
          </p>
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("all");
                setSort("smart");
              }}
              className="cursor-pointer rounded-lg bg-background-secondary-default px-3 py-1.5 text-body-2-medium text-text-primary transition-colors hover:bg-background-secondary-hover"
            >
              {t("plugins.hub.clearFilters")}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-separator-border bg-background-primary-default">
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr className="border-b border-separator-border">
                  <th scope="col" className={TH}>
                    {t("plugins.hub.tableName")}
                  </th>
                  <th scope="col" className={`${TH} w-[180px]`}>
                    {t("plugins.hub.tableDeveloper")}
                  </th>
                  {showDownloads && (
                    <th scope="col" className={`${TH} w-[96px] text-right`}>
                      {t("plugins.hub.tableDownloads")}
                    </th>
                  )}
                  <th scope="col" className={`${TH} w-[96px] text-right`}>
                    {t("plugins.hub.tableVersion")}
                  </th>
                  <th scope="col" className={`${TH} w-[190px] text-right`}>
                    {t("plugins.hub.tableActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <PluginMarketRow
                    key={entry.id}
                    entry={entry}
                    onOpenDetail={onOpenDetail}
                    showDownloads={showDownloads}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-1 text-body-2-regular text-text-tertiary">
            {t("plugins.market.hint")}
            {showDownloads ? ` ${t("plugins.hub.downloadsHint")}` : ""}
          </p>
        </>
      )}
    </div>
  );
}
