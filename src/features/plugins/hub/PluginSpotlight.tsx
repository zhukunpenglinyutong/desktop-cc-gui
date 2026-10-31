import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "motion/react";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import type { FeaturedPlugin, MarketPlugin } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { githubLoginFor, isOfficialPlugin, pluginAvatarGradient } from "./catalog";
import { formatInstallCount } from "./install-count";
import { PluginAvatar } from "./PluginAvatar";
import { MarketActionButton } from "./MarketActionButton";
import { useMarketplaceStore } from "../marketplace/store";

/**
 * 封面素材链（方案 A）：编辑封面 → 插件自己的截图 → 插件 icon →
 * 确定性渐变块。索引里绝大多数插件一张图都没有，所以「没有图」必须是一条正常
 * 分支而不是空洞：卡片永远画满，「没有图」表现为品牌色 + 首字瓦片。
 *
 * 编辑封面按 `object-cover` 铺满（编辑承诺 16:9）；插件截图一律按原比例装帧
 * ——索引里的截图从 3600×740 到 357×425 都有，裁切会把其中一头毁掉。
 */
type CoverStep =
  | { kind: "cover"; src: string }
  | { kind: "screenshot"; src: string }
  | { kind: "icon"; src: string }
  | { kind: "tile" };

function coverChain(entry: MarketPlugin, image: string | null): CoverStep[] {
  const chain: CoverStep[] = [];
  if (image) chain.push({ kind: "cover", src: image });
  const screenshot = entry.screenshots[0];
  if (screenshot) chain.push({ kind: "screenshot", src: screenshot });
  if (entry.icon) chain.push({ kind: "icon", src: entry.icon });
  chain.push({ kind: "tile" });
  return chain;
}

/** 卡片底色：与身份瓦片同一套确定性渐变（catalog.ts），换机器也一样。 */
function BrandWash({ id }: { id: string }) {
  const { from, to } = pluginAvatarGradient(id);
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
    />
  );
}

function SpotlightCover({ entry, image }: { entry: MarketPlugin; image: string | null }) {
  // 素材链随索引刷新而变（可能多出截图），跟着回到第一档重试。
  const chain = useMemo(() => coverChain(entry, image), [entry, image]);
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [chain]);
  const active = chain[Math.min(step, chain.length - 1)]!;

  return (
    <>
      <BrandWash id={entry.id} />
      {active.kind === "cover" && (
        <img
          src={active.src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setStep((current) => current + 1)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {active.kind === "screenshot" && (
        <div className="absolute inset-y-5 right-5 flex w-[46%] items-center justify-end max-lg:inset-y-4 max-lg:right-4 max-lg:w-[44%]">
          <img
            src={active.src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setStep((current) => current + 1)}
            className="max-h-full max-w-full rounded-xl border border-white/15 object-contain shadow-lg"
          />
        </div>
      )}
      {(active.kind === "icon" || active.kind === "tile") && (
        <div className="absolute inset-y-0 right-0 flex w-[46%] items-center justify-center max-lg:hidden">
          <PluginAvatar
            id={entry.id}
            name={entry.name}
            src={active.kind === "icon" ? active.src : null}
            size={112}
            className="rounded-3xl shadow-lg"
          />
        </div>
      )}
    </>
  );
}

/** 一张幻灯片：封面 + 编辑文案 + 与表格同一套安装动作。 */
function Slide({
  featured,
  entry,
  active,
  total,
  index,
  onOpenDetail,
}: {
  featured: FeaturedPlugin;
  entry: MarketPlugin;
  active: boolean;
  total: number;
  index: number;
  onOpenDetail: (id: string) => void;
}) {
  const { t } = useTranslation();
  const official = isOfficialPlugin(entry);
  // 官方插件的作者位是品牌账号：用徽标代替账号，与表格同一规则。
  const login = official ? null : githubLoginFor(entry);
  const pitch = featured.tagline ?? entry.description;

  return (
    <article
      aria-hidden={!active}
      aria-roledescription="slide"
      aria-label={`${index + 1} / ${total}`}
      className={cx(
        "absolute inset-0 transition-opacity duration-300 ease-out motion-reduce:transition-none",
        active ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <SpotlightCover entry={entry} image={featured.image} />

      {/* 压暗左半侧：白色文案要压在任意截图/渐变上，对比度不能靠运气 */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-transparent"
      />

      <div className="absolute inset-y-0 left-0 flex w-[46%] flex-col justify-center gap-2.5 px-8 max-lg:w-[52%] max-lg:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {official && (
            <span className="rounded-md bg-status-purple-background px-1.5 py-0.5 text-caption-1-medium text-status-purple-text">
              {t("plugins.hub.official")}
            </span>
          )}
          <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-caption-1-medium text-text-white">
            {t("plugins.hub.spotlight")}
          </span>
        </div>

        <h3 className="truncate text-title-2-medium text-text-white">{entry.name}</h3>
        {pitch && <p className="line-clamp-2 text-body-regular text-text-white/85">{pitch}</p>}
        {featured.note && (
          <p className="border-l-2 border-white/30 pl-2.5 text-body-2-regular text-text-white/70 max-lg:hidden">
            {featured.note}
          </p>
        )}

        <div className="flex min-w-0 items-center gap-2 text-body-2-regular text-text-white/80">
          {!official && login && (
            <PluginAvatar id={login} name={entry.author} size={20} shape="circle" />
          )}
          <span className="truncate">{entry.author || "—"}</span>
          {entry.downloads != null && (
            <>
              <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-white/50" />
              <span className="shrink-0 tabular-nums">
                {t("plugins.hub.downloadsShort", { n: formatInstallCount(entry.downloads) })}
              </span>
            </>
          )}
          <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-white/50" />
          <span className="shrink-0 tabular-nums">v{entry.version.replace(/^v/, "")}</span>
        </div>

        <div className="mt-1 flex items-center gap-2">
          <MarketActionButton entry={entry} onOpenDetail={onOpenDetail} size="medium" />
          <Button
            variant="secondary"
            size="medium"
            tabIndex={active ? 0 : -1}
            onClick={() => onOpenDetail(entry.id)}
          >
            {t("plugins.hub.spotlightDetail")}
          </Button>
        </div>
      </div>
    </article>
  );
}

/**
 * 编辑精选轮播（方案 A，市场页首屏）。
 *
 * 三个约定值得记住：
 * 1. 轮播是**装饰层**：featured 为空（后端拿不到、或索引里已经没有这些 id）时
 *    整个区块不渲染，市场表格与筛选不受影响。
 * 2. 自动播放由进度条的关键帧驱动（animationend = 翻页），所以悬停 / 焦点进入 /
 *    切到后台 / 系统减少动效时，进度条与翻页一起冻结、一起恢复，不会各跑各的。
 * 3. 只有「编辑封面」和「插件截图（原比例装帧）」两种装帧；icon 与渐变瓦片是
 *    同一张卡上的正常降级，不是错误态。
 */
export function PluginSpotlight({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const { t } = useTranslation();
  const featured = useMarketplaceStore((s) => s.featured);
  const entries = useMarketplaceStore((s) => s.entries);
  // 精选行只带编辑文案；版本、安装状态、截图仍以索引为准。索引里没有的 id
  // 后端已经丢掉，这里再兜一次，避免「刷新到一半」的中间态读到 undefined。
  const slides = useMemo(
    () =>
      featured.flatMap((row) => {
        const entry = entries.find((candidate) => candidate.id === row.id);
        return entry ? [{ featured: row, entry }] : [];
      }),
    [featured, entries],
  );
  const [rawIndex, setRawIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const total = slides.length;

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // 列表变短（刷新后少了精选）时跟着收，而不是渲染到越界的那一张。
  const index = total > 0 ? Math.min(rawIndex, total - 1) : 0;
  if (total === 0) return null;

  const go = (next: number) => setRawIndex(((next % total) + total) % total);
  const paused = hovered || focused || hidden || reduceMotion;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t("plugins.hub.spotlight")}
      className="relative h-[320px] overflow-hidden rounded-2xl border border-separator-border bg-background-secondary-default max-lg:h-[300px]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        // 焦点在内部控件之间移动不算离开（blur 先于 focus 到达）。
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (total < 2) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(index - 1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          go(index + 1);
        }
      }}
    >
      {slides.map((slide, slideIndex) => (
        <Slide
          key={slide.entry.id}
          {...slide}
          active={slideIndex === index}
          total={total}
          index={slideIndex}
          onOpenDetail={onOpenDetail}
        />
      ))}

      {/* 进度条即计时器：整条走满 → animationend → 下一张。悬停/焦点/后台/减少
          动效时 animation-play-state 暂停，翻页随之冻结（不是各跑各的）。 */}
      <div className="absolute inset-x-8 bottom-3 flex items-center gap-2.5 max-lg:inset-x-6">
        <div role="tablist" aria-label={t("plugins.hub.spotlight")} className="flex items-center">
          {slides.map((slide, dot) => (
            <button
              key={slide.entry.id}
              type="button"
              role="tab"
              aria-selected={dot === index}
              aria-label={t("plugins.hub.spotlightDot", { n: dot + 1, name: slide.entry.name })}
              tabIndex={dot === index ? 0 : -1}
              onClick={() => go(dot)}
              className="cursor-pointer px-0.5 py-2.5"
            >
              <span className="block h-[3px] w-6 overflow-hidden rounded-full bg-white/30">
                {dot === index && (
                  <span
                    // key = 当前页：每翻一页重新起跑，手动翻页也不会“接力”上一张的进度
                    key={index}
                    onAnimationEnd={() => go(index + 1)}
                    className={cx(
                      "block h-full w-full origin-left rounded-full bg-white",
                      "animate-spotlight-progress motion-reduce:animate-none",
                      paused && "[animation-play-state:paused]",
                    )}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
        <span className="text-caption-1-regular text-text-white/70 tabular-nums">
          {index + 1} / {total}
        </span>
      </div>

      {total > 1 && (
        <div className="absolute right-8 bottom-3 flex items-center gap-2 max-lg:right-6">
          <IconButton
            size="medium"
            icon={ChevronLeft}
            aria-label={t("plugins.hub.spotlightPrev")}
            title={t("plugins.hub.spotlightPrev")}
            onClick={() => go(index - 1)}
            className="border-white/20 bg-white/15 text-text-white backdrop-blur-sm hover:bg-white/25"
          />
          <IconButton
            size="medium"
            icon={ChevronRight}
            aria-label={t("plugins.hub.spotlightNext")}
            title={t("plugins.hub.spotlightNext")}
            onClick={() => go(index + 1)}
            className="border-white/20 bg-white/15 text-text-white backdrop-blur-sm hover:bg-white/25"
          />
        </div>
      )}
    </section>
  );
}
