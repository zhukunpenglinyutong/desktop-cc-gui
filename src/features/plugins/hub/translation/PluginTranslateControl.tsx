import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Languages from "lucide-react/dist/esm/icons/languages";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import {
  Dropdown,
  DropdownDivider,
  DropdownGroup,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { ipc, type FeaturedPlugin, type MarketPlugin } from "@/lib/ipc";
import { isWeb } from "@/lib/platform";
import { cx } from "@/utils/cx";
import { useMarketplaceStore } from "../../marketplace/store";
import type { TranslationExecutionResolution } from "./execution";
import {
  describeExecution,
  engineName,
  openTranslationSettings,
  useTranslationExecution,
} from "./execution-view";
import {
  defaultTranslationLanguage,
  findTranslationLanguage,
  TRANSLATION_LANGUAGES,
} from "./languages";
import {
  listJobKey,
  pluginJobKey,
  readmeFreshness,
  summaryFreshness,
  translationKey,
  usePluginTranslationStore,
  type ReadmeTranslation,
  type SummarySource,
  type SummaryTranslation,
  type TranslationFreshness,
} from "./store";

// ------------------------------------------------------------------ sources

/**
 * 一个插件的摘要原文。列表、精选卡与详情页必须用同一个来源算指纹，否则
 * 同一份译文会在不同位置被判成新鲜/过期两种结果——所以集中在这里。
 */
export function summarySourceFor(
  entry: Pick<MarketPlugin, "name" | "description"> | { name: string; description: string },
  featured?: Pick<FeaturedPlugin, "tagline" | "note"> | null,
): SummarySource {
  return {
    name: entry.name,
    description: entry.description ?? "",
    tagline: featured?.tagline ?? null,
    note: featured?.note ?? null,
  };
}

/** 市场条目的摘要原文（自动带上它在精选里的卖点与推荐语）。 */
export function useMarketSummarySource(
  pluginId: string,
  base: { name: string; description: string },
): SummarySource {
  const featured = useMarketplaceStore((s) => s.featured.find((item) => item.id === pluginId));
  return summarySourceFor(base, featured);
}

// -------------------------------------------------------------------- views

export interface SummaryView extends SummarySource {
  /** 正在显示的译文；null = 显示原文。 */
  translation: SummaryTranslation | null;
  freshness: TranslationFreshness | null;
}

/** 当前显示语言下这个插件该显示的名称 / 简介 / 精选文案。 */
export function useSummaryView(pluginId: string, source: SummarySource): SummaryView {
  const translation = usePluginTranslationStore((s) =>
    s.displayLanguage
      ? (s.summaries[translationKey(pluginId, s.displayLanguage)] ?? null)
      : null,
  );
  if (!translation) return { ...source, translation: null, freshness: null };
  return {
    name: translation.name,
    description: translation.description,
    tagline: translation.tagline,
    note: translation.note,
    translation,
    freshness: summaryFreshness(translation, source),
  };
}

/** 当前显示语言下这个插件的 README 译文（没有则 null）。 */
export function useReadmeTranslation(pluginId: string): ReadmeTranslation | null {
  return usePluginTranslationStore((s) =>
    s.displayLanguage ? (s.readmes[translationKey(pluginId, s.displayLanguage)] ?? null) : null,
  );
}

const useExecution = useTranslationExecution;

/** 菜单底部：用哪个模型 + 「翻译设置…」入口。 */
function ModelFooter({
  resolution,
  extra,
  onNavigate,
}: {
  resolution: TranslationExecutionResolution;
  extra?: ReactNode;
  /** 跳转前先关菜单（菜单浮层不会随路由切换自己消失）。 */
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p
        className={cx(
          "px-2 text-caption-1-regular",
          resolution.execution ? "text-text-tertiary" : "text-text-warning-primary",
        )}
      >
        {describeExecution(resolution, t)}
        {extra}
      </p>
      <DropdownItem
        className="px-2 py-1.5 text-body-2-medium"
        onSelect={() => {
          onNavigate();
          openTranslationSettings();
        }}
      >
        {t("plugins.hub.translate.openSettings")}
      </DropdownItem>
    </>
  );
}

function StatusBadge({ freshness, label }: { freshness: TranslationFreshness; label?: string }) {
  const { t } = useTranslation();
  return freshness === "fresh" ? (
    <span className="flex shrink-0 items-center gap-1 text-caption-1-regular text-text-tertiary">
      <Check className="size-3.5" aria-hidden />
      {label ?? t("plugins.hub.translate.cached")}
    </span>
  ) : (
    <span className="flex shrink-0 items-center gap-1 text-caption-1-regular text-text-warning-primary">
      <TriangleAlert className="size-3.5" aria-hidden />
      {label ?? t("plugins.hub.translate.stale")}
    </span>
  );
}

// -------------------------------------------------------- per-plugin menu

/** 行内图标按钮：与 IconButton 同形（small 32×32 / medium 36×36、radius 2lg）。 */
const ICON_SIZE = { small: "size-8", medium: "size-9" } as const;
const ICON_TRIGGER =
  "relative inline-flex shrink-0 items-center justify-center rounded-2lg border border-border-button-default bg-background-primary-default text-foreground-icon-primary shadow-xs transition-colors hover:bg-background-primary-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";
/** 详情页页头：与 medium Button 同高（h-9）。 */
const BUTTON_TRIGGER =
  "flex h-9 items-center gap-1.5 rounded-2lg border border-border-button-default bg-background-primary-default px-2.5 text-body-medium whitespace-nowrap text-text-primary transition-colors hover:bg-background-primary-hover data-[disabled]:cursor-not-allowed data-[disabled]:text-text-tertiary";

/** 拿 README 原文：调用方已加载就用；否则现拉（市场插件），拉不到当作没有。 */
async function resolveReadme(
  pluginId: string,
  readme: string | null | undefined,
  fetchable: boolean,
): Promise<string | null> {
  if (readme !== undefined) return readme;
  if (!fetchable) return null;
  try {
    return await ipc.pluginFetchMarketReadme(pluginId);
  } catch {
    return null;
  }
}

/**
 * 单个插件的「翻译」入口：列表行与精选卡用图标按钮，详情页用带文字的
 * 按钮。菜单里选语言：已有该语言译文（哪怕过期）就直接切换显示，不替
 * 用户花一次模型调用；没有才发起翻译（摘要 + README）。正在显示的语言
 * 另给「重新翻译」。翻译中按钮转圈，再点即取消。
 */
export function PluginTranslateMenu({
  pluginId,
  summary,
  readme,
  fetchReadme,
  variant,
  size = "small",
  excludeFromTabOrder,
}: {
  pluginId: string;
  summary: SummarySource;
  /** 已加载的 README；undefined = 未加载（需要时按 fetchReadme 现拉）。 */
  readme?: string | null;
  /** 市场插件可以现拉 README；本地插件没有。 */
  fetchReadme: boolean;
  variant: "icon" | "button";
  /** 图标按钮的尺寸：表格行 small，精选卡 medium（与旁边的按钮同高）。 */
  size?: "small" | "medium";
  excludeFromTabOrder?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const resolution = useExecution();
  const { summaries, displayLanguage, lastLanguage, jobs, translatePlugin, setDisplayLanguage, cancel } =
    usePluginTranslationStore(
      useShallow((s) => ({
        summaries: s.summaries,
        displayLanguage: s.displayLanguage,
        lastLanguage: s.lastLanguage,
        jobs: s.jobs,
        translatePlugin: s.translatePlugin,
        setDisplayLanguage: s.setDisplayLanguage,
        cancel: s.cancel,
      })),
    );

  const runningLanguage =
    TRANSLATION_LANGUAGES.find((language) => jobs[pluginJobKey(pluginId, language.code)])?.code ??
    null;
  const runningJob = runningLanguage ? jobs[pluginJobKey(pluginId, runningLanguage)] : null;
  const shown = displayLanguage ? summaries[translationKey(pluginId, displayLanguage)] : undefined;
  const shownFreshness = shown ? summaryFreshness(shown, summary) : null;
  const preferred = displayLanguage ?? lastLanguage ?? defaultTranslationLanguage(i18n.language);
  const hasText = summary.name.trim().length > 0 || summary.description.trim().length > 0;
  const disabledReason = isWeb
    ? t("plugins.market.desktopOnly")
    : !hasText
      ? t("plugins.hub.translate.nothing")
      : null;

  const start = async (language: string): Promise<void> => {
    if (!resolution.execution) return;
    const execution = resolution.execution;
    const text = await resolveReadme(pluginId, readme, fetchReadme);
    await translatePlugin({ pluginId, language, summary, readme: text, execution });
  };
  const pick = (language: string): void => {
    setOpen(false);
    if (summaries[translationKey(pluginId, language)]) setDisplayLanguage(language);
    else void start(language);
  };

  if (runningLanguage && runningJob) {
    const name = findTranslationLanguage(runningLanguage)?.name ?? runningLanguage;
    const step = runningJob.total > 1 ? ` ${runningJob.done + 1}/${runningJob.total}` : "";
    const label = t("plugins.hub.translate.runningCancel", { language: name, step });
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        tabIndex={excludeFromTabOrder ? -1 : undefined}
        className={variant === "icon" ? cx(ICON_TRIGGER, ICON_SIZE[size]) : BUTTON_TRIGGER}
        onClick={() => cancel(pluginJobKey(pluginId, runningLanguage))}
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {variant === "button" && t("plugins.hub.translate.running", { language: name, step })}
      </button>
    );
  }

  const triggerTitle =
    disabledReason ??
    (shown && shownFreshness === "stale"
      ? t("plugins.hub.translate.staleShort")
      : t("plugins.hub.translate.menuLabel"));

  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger
        className={variant === "icon" ? cx(ICON_TRIGGER, ICON_SIZE[size]) : BUTTON_TRIGGER}
        isDisabled={disabledReason !== null}
        excludeFromTabOrder={excludeFromTabOrder}
        aria-label={t("plugins.hub.translate.menuLabel")}
      >
        <span className="contents" title={triggerTitle}>
          {shownFreshness === "stale" ? (
            <TriangleAlert className="size-4 text-text-warning-primary" aria-hidden />
          ) : (
            <Languages
              className={cx("size-4", shown && "text-text-brand-secondary")}
              aria-hidden
            />
          )}
          {variant === "button" && (
            <>
              {t("plugins.hub.translate.button")}
              <ChevronDown className="size-3.5 text-text-tertiary" aria-hidden />
            </>
          )}
        </span>
      </DropdownTrigger>
      <DropdownPopover
        aria-label={t("plugins.hub.translate.menuLabel")}
        placement="bottom end"
        className="w-[280px]"
        dialogClassName="max-h-[min(480px,70dvh)] overflow-y-auto"
      >
        {displayLanguage && (
          <DropdownItem
            onSelect={() => {
              setOpen(false);
              setDisplayLanguage(null);
            }}
          >
            {t("plugins.hub.translate.showOriginal")}
          </DropdownItem>
        )}
        {shown && resolution.execution && (
          <DropdownItem
            onSelect={() => {
              setOpen(false);
              void start(shown.language);
            }}
          >
            {t("plugins.hub.translate.retranslateTo", {
              language: findTranslationLanguage(shown.language)?.name ?? shown.language,
            })}
          </DropdownItem>
        )}
        {(displayLanguage || shown) && <DropdownDivider />}
        <DropdownGroup label={t("plugins.hub.translate.languageGroup")}>
          {TRANSLATION_LANGUAGES.map((language) => {
            const key = translationKey(pluginId, language.code);
            const cached = summaries[key];
            const blocked = !cached && !resolution.execution;
            return (
              <DropdownItem
                key={language.code}
                selected={displayLanguage === language.code && !!cached}
                onSelect={blocked ? undefined : () => pick(language.code)}
                className={cx(
                  "justify-between px-2 py-1.5",
                  blocked && "cursor-not-allowed opacity-50",
                  !cached && language.code === preferred && "font-medium",
                )}
              >
                <span className="truncate">{language.name}</span>
                {cached && <StatusBadge freshness={summaryFreshness(cached, summary)} />}
              </DropdownItem>
            );
          })}
        </DropdownGroup>
        <DropdownDivider />
        <ModelFooter resolution={resolution} onNavigate={() => setOpen(false)} />
      </DropdownPopover>
    </Dropdown>
  );
}

// --------------------------------------------------------------- list menu

const HEADER_TRIGGER =
  "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-primary-hover hover:text-text-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

/**
 * 插件中心页头的「翻译列表」：把市场里所有插件的名称与简介（精选卡文案
 * 一并）译成所选语言。只翻没有译文或已过期的，分批进行，每批译完立即
 * 显示并落盘；取消或失败时已译部分保留。
 */
export function PluginListTranslateMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const resolution = useExecution();
  const entries = useMarketplaceStore((s) => s.entries);
  const featured = useMarketplaceStore((s) => s.featured);
  const { summaries, displayLanguage, jobs, errors, translateList, setDisplayLanguage, cancel, dismissError } =
    usePluginTranslationStore(
      useShallow((s) => ({
        summaries: s.summaries,
        displayLanguage: s.displayLanguage,
        jobs: s.jobs,
        errors: s.errors,
        translateList: s.translateList,
        setDisplayLanguage: s.setDisplayLanguage,
        cancel: s.cancel,
        dismissError: s.dismissError,
      })),
    );

  const items = entries.map((entry) => ({
    pluginId: entry.id,
    summary: summarySourceFor(entry, featured.find((item) => item.id === entry.id)),
  }));
  const stats = (language: string) => {
    let fresh = 0;
    let stale = 0;
    for (const item of items) {
      const cached = summaries[translationKey(item.pluginId, language)];
      if (!cached) continue;
      if (summaryFreshness(cached, item.summary) === "fresh") fresh += 1;
      else stale += 1;
    }
    return { fresh, stale, total: items.length };
  };

  const runningLanguage =
    TRANSLATION_LANGUAGES.find((language) => jobs[listJobKey(language.code)])?.code ?? null;
  const failedLanguage =
    TRANSLATION_LANGUAGES.find((language) => errors[listJobKey(language.code)])?.code ?? null;

  const run = (language: string): void => {
    setOpen(false);
    if (failedLanguage) dismissError(listJobKey(failedLanguage));
    const s = stats(language);
    if (s.fresh === s.total || !resolution.execution) {
      setDisplayLanguage(language);
      return;
    }
    void translateList({ language, items, execution: resolution.execution });
  };

  if (runningLanguage) {
    const job = jobs[listJobKey(runningLanguage)];
    const label = t("plugins.hub.translate.listRunning", {
      language: findTranslationLanguage(runningLanguage)?.name ?? runningLanguage,
      done: job.done,
      total: job.total,
    });
    return (
      <button
        type="button"
        title={t("plugins.hub.translate.cancel")}
        onClick={() => cancel(listJobKey(runningLanguage))}
        className={HEADER_TRIGGER}
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {label}
      </button>
    );
  }

  const shownName = displayLanguage ? findTranslationLanguage(displayLanguage)?.name : null;
  const shownStats = displayLanguage ? stats(displayLanguage) : null;
  const disabled = isWeb || entries.length === 0;
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger
        className={HEADER_TRIGGER}
        isDisabled={disabled}
        aria-label={t("plugins.hub.translate.listMenuLabel")}
      >
        <span className="contents" title={isWeb ? t("plugins.market.desktopOnly") : undefined}>
          {failedLanguage || (shownStats && shownStats.stale > 0) ? (
            <TriangleAlert
              className={cx(
                "size-4",
                failedLanguage ? "text-text-error-primary" : "text-text-warning-primary",
              )}
              aria-hidden
            />
          ) : (
            <Languages className={cx("size-4", shownName && "text-text-brand-secondary")} aria-hidden />
          )}
          {shownName
            ? t("plugins.hub.translate.listShown", { language: shownName })
            : t("plugins.hub.translate.listButton")}
        </span>
      </DropdownTrigger>
      <DropdownPopover
        aria-label={t("plugins.hub.translate.listMenuLabel")}
        placement="bottom end"
        className="w-[300px]"
        dialogClassName="max-h-[min(520px,75dvh)] overflow-y-auto"
      >
        {failedLanguage && (
          <p role="alert" className="px-2 pt-1 text-caption-1-regular text-text-error-primary" title={errors[listJobKey(failedLanguage)]?.detail}>
            {t(
              errors[listJobKey(failedLanguage)]?.reason === "unparsable"
                ? "plugins.hub.translate.errorUnparsable"
                : "plugins.hub.translate.errorFailed",
              { language: findTranslationLanguage(failedLanguage)?.name ?? failedLanguage },
            )}
          </p>
        )}
        {displayLanguage && (
          <>
            <DropdownItem
              onSelect={() => {
                setOpen(false);
                setDisplayLanguage(null);
              }}
            >
              {t("plugins.hub.translate.showOriginal")}
            </DropdownItem>
            <DropdownDivider />
          </>
        )}
        <DropdownGroup label={t("plugins.hub.translate.listLanguageGroup")}>
          {TRANSLATION_LANGUAGES.map((language) => {
            const s = stats(language.code);
            const blocked = s.fresh === 0 && s.stale === 0 && !resolution.execution;
            return (
              <DropdownItem
                key={language.code}
                selected={displayLanguage === language.code}
                onSelect={blocked ? undefined : () => run(language.code)}
                className={cx("justify-between px-2 py-1.5", blocked && "cursor-not-allowed opacity-50")}
              >
                <span className="truncate">{language.name}</span>
                {s.fresh + s.stale > 0 && (
                  <span
                    className={cx(
                      "shrink-0 text-caption-1-regular tabular-nums",
                      s.stale > 0 ? "text-text-warning-primary" : "text-text-tertiary",
                    )}
                  >
                    {s.stale > 0
                      ? t("plugins.hub.translate.listCountStale", { done: s.fresh, total: s.total, stale: s.stale })
                      : t("plugins.hub.translate.listCount", { done: s.fresh, total: s.total })}
                  </span>
                )}
              </DropdownItem>
            );
          })}
        </DropdownGroup>
        <DropdownDivider />
        <ModelFooter
          resolution={resolution}
          onNavigate={() => setOpen(false)}
          extra={<span className="mt-1 block">{t("plugins.hub.translate.listHint")}</span>}
        />
      </DropdownPopover>
    </Dropdown>
  );
}

// ------------------------------------------------------- detail notice line

/**
 * 详情页简介上方的状态行：翻译失败（重试 / 关闭）、摘要或 README 译文已
 * 过期（重新翻译）、README 还没有当前语言的译文（翻译 README）、正在看
 * 译文（显示原文）。都不适用时不占位。
 */
export function PluginTranslationNotice({
  pluginId,
  summary,
  view,
  readme,
  readmeTranslation,
  fetchReadme,
}: {
  pluginId: string;
  summary: SummarySource;
  view: SummaryView;
  /** README 原文：undefined = 加载中或拉取失败。 */
  readme: string | null | undefined;
  readmeTranslation: ReadmeTranslation | null;
  fetchReadme: boolean;
}) {
  const { t } = useTranslation();
  const resolution = useExecution();
  const store = usePluginTranslationStore(
    useShallow((s) => ({
      displayLanguage: s.displayLanguage,
      errors: s.errors,
      jobs: s.jobs,
      translatePlugin: s.translatePlugin,
      setDisplayLanguage: s.setDisplayLanguage,
      dismissError: s.dismissError,
    })),
  );
  const LINK =
    "cursor-pointer text-text-brand-secondary hover:underline disabled:cursor-not-allowed disabled:text-text-tertiary disabled:no-underline";
  const running = TRANSLATION_LANGUAGES.some((language) => store.jobs[pluginJobKey(pluginId, language.code)]);
  const canRun = !!resolution.execution && !isWeb && !running;
  const rerun = (language: string): void => {
    if (!resolution.execution) return;
    const execution = resolution.execution;
    void resolveReadme(pluginId, readme, fetchReadme).then((text) =>
      store.translatePlugin({ pluginId, language, summary, readme: text, execution }),
    );
  };

  const failed = TRANSLATION_LANGUAGES.map((language) => ({
    language: language.code,
    error: store.errors[pluginJobKey(pluginId, language.code)],
  })).find((row) => row.error);
  if (failed?.error && !running) {
    const name = findTranslationLanguage(failed.language)?.name ?? failed.language;
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-2-regular text-text-error-primary">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span title={failed.error.detail}>
          {t(
            failed.error.reason === "unparsable"
              ? "plugins.hub.translate.errorUnparsable"
              : "plugins.hub.translate.errorFailed",
            { language: name },
          )}
        </span>
        <button type="button" className={LINK} disabled={!canRun} onClick={() => rerun(failed.language)}>
          {t("plugins.hub.translate.retry")}
        </button>
        <button
          type="button"
          className="cursor-pointer text-text-tertiary hover:underline"
          onClick={() => store.dismissError(pluginJobKey(pluginId, failed.language))}
        >
          {t("plugins.hub.translate.dismiss")}
        </button>
      </div>
    );
  }

  const translation = view.translation;
  if (!translation || !store.displayLanguage) return null;
  const name = findTranslationLanguage(translation.language)?.name ?? translation.language;
  const readmeStale = readmeTranslation ? readmeFreshness(readmeTranslation, readme) === "stale" : false;
  const stale = view.freshness === "stale" || readmeStale;
  const readmeMissing = !readmeTranslation && typeof readme === "string" && readme.trim().length > 0;
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-body-2-regular",
        stale ? "text-text-warning-primary" : "text-text-tertiary",
      )}
    >
      {stale ? (
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
      ) : (
        <Languages className="size-4 shrink-0" aria-hidden />
      )}
      <span>
        {stale
          ? t("plugins.hub.translate.staleNotice", { language: name })
          : readmeMissing
            ? t("plugins.hub.translate.readmeMissing", { language: name })
            : t("plugins.hub.translate.shownAs", { language: name, engine: engineName(translation.engine) })}
      </span>
      {(stale || readmeMissing) && (
        <button
          type="button"
          className={LINK}
          disabled={!canRun}
          title={!resolution.execution ? describeExecution(resolution, t) : undefined}
          onClick={() => rerun(translation.language)}
        >
          {stale ? t("plugins.hub.translate.retranslate") : t("plugins.hub.translate.translateReadme")}
        </button>
      )}
      <button type="button" className={LINK} onClick={() => store.setDisplayLanguage(null)}>
        {t("plugins.hub.translate.showOriginal")}
      </button>
    </div>
  );
}
