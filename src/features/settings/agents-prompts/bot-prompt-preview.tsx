import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import type { BotConfig } from "@/lib/ipc";
import {
  PROSE_LIMIT,
  assembleBotPrompt,
  type PromptBlock,
} from "@/features/bots/bot-prompt";
import { skillIndexFor } from "@/features/bots/bot-block";
import { renderMemory, useMemoryStore } from "@/features/bots/memory";

/** Per-block ceiling shown next to the count. SOUL and AGENTS share one
 *  budget (the editor's own bar tracks it), so neither carries a trailing
 *  limit here — a slash followed by a number that belongs to both blocks
 *  reads as a per-block ceiling it is not. */
function limitLabel(block: PromptBlock): string | null {
  if (block.id === "soul" || block.id === "instructions") return null;
  return block.limit ? `/ ${block.limit}` : null;
}

/**
 * 拼装预览: the blocks this bot contributes, in the order the model reads
 * them, with each block's size and opening line. It is assembled from the
 * live editor state — the point is to show the *consequence* of an edit
 * before the next session freezes it.
 *
 * A block that is empty is listed as omitted rather than hidden: the user
 * needs to see that leaving 工作规则 blank is a deliberate "nothing here",
 * not a silent drop.
 */
export function BotPromptPreview({
  bot,
  onClose,
  onRefreshContext,
}: {
  bot: BotConfig;
  onClose: () => void;
  /** Drops the frozen block of this bot's open sessions (下次发送重新拼装). */
  onRefreshContext?: () => void;
}) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<{ name: string; description: string }[] | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const refreshMemory = useMemoryStore((s) => s.refresh);
  const memoryView = useMemoryStore((s) => (s.botId === bot.id ? s.view : null));

  useEffect(() => {
    void refreshMemory(bot.id);
  }, [bot.id, refreshMemory]);

  const skillsKey = bot.capabilities.skills.join(",");
  useEffect(() => {
    let cancelled = false;
    void skillIndexFor(bot)
      .then((entries) => {
        if (!cancelled) setSkills(entries);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
    // Re-resolve when the capability list changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillsKey]);

  // 记忆区块按预览打开时的账本渲染。工具可用性由引擎决定（Claude Code /
  // Codex / omp），预览不知道下一个会话选哪个引擎，所以按「记忆开着就有
  // 说明」展示；记忆页签里说明了哪些引擎真能写入。
  const assembled = useMemo(
    () =>
      assembleBotPrompt({
        bot,
        skills: skills ?? [],
        user: memoryView ? renderMemory(memoryView.user.entries) : "",
        memory: memoryView?.memory ? renderMemory(memoryView.memory.entries) : "",
        memoryAvailable: bot.memory.enabled !== false,
      }),
    [bot, skills, memoryView],
  );

  const proseChars = assembled.blocks
    .filter((block) => block.id === "soul" || block.id === "instructions")
    .reduce((sum, block) => sum + block.chars, 0);

  return (
    <aside
      aria-label={t("settings.botPreviewTitle")}
      className={cx(
        "absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border-button-default",
        "bg-background-secondary-default shadow-[-18px_0_40px_rgba(0,0,0,0.25)] sm:w-[400px]",
      )}
    >
      <div className="flex items-center gap-2 border-b border-separator-border px-4 py-3">
        <span aria-hidden>👁</span>
        <p className="text-body-medium text-text-primary">{t("settings.botPreviewTitle")}</p>
        <span className="ml-auto rounded-md bg-background-tertiary-default px-2 py-0.5 text-caption-1-regular text-text-tertiary">
          {t("settings.botPreviewFrozen")}
        </span>
        <button
          type="button"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
          className="flex size-6 cursor-pointer items-center justify-center rounded-full text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {assembled.blocks.map((block, index) => {
          const over = block.id === "soul" || block.id === "instructions"
            ? proseChars > PROSE_LIMIT
            : block.limit !== undefined && block.chars > block.limit;
          const near = !over && block.limit !== undefined && block.chars > block.limit * 0.8;
          const limit = limitLabel(block);
          return (
            <div
              key={block.id}
              className={cx(
                "rounded-2lg border p-2.5",
                block.omitted
                  ? "border-dashed border-separator-border bg-background-primary-default"
                  : "border-separator-border bg-background-primary-default",
              )}
            >
              <div className="flex items-center gap-2">
                {index > 0 && !block.external && (
                  <span className="font-mono text-caption-1-regular text-text-quaternary">
                    {index}
                  </span>
                )}
                <span
                  className={cx(
                    "text-caption-1-medium",
                    block.omitted ? "text-text-quaternary" : "text-text-secondary",
                  )}
                >
                  {block.external ? block.title : `# ${block.title}`}
                </span>
                <span
                  className={cx(
                    "ml-auto shrink-0 font-mono text-caption-1-regular",
                    over
                      ? "text-text-error-primary"
                      : near
                        ? "text-text-warning-primary"
                        : "text-text-tertiary",
                  )}
                >
                  {block.external
                    ? t("settings.botPreviewHostPrompt")
                    : block.planned !== undefined
                      ? t("settings.botComingSoon")
                      : block.omitted
                        ? t("settings.botPreviewOmitted")
                        : `${block.chars.toLocaleString()} ${limit ?? ""}`.trim()}
                </span>
              </div>
              {!block.omitted && (
                <p className="mt-1.5 truncate font-mono text-caption-1-regular text-text-quaternary">
                  {block.preview || "…"}
                </p>
              )}
            </div>
          );
        })}
        <div className="rounded-2lg border border-separator-border bg-background-primary-default p-2.5">
          <div className="flex items-center gap-2 text-caption-1-regular text-text-secondary">
            <span>{t("settings.botPreviewTotal")}</span>
            <span className="ml-auto font-mono text-text-tertiary">
              {assembled.totalChars.toLocaleString()} ·{" "}
              {t("settings.botPreviewTokens", {
                count: Math.round(assembled.totalChars / 1.6),
                formatted: Math.round(assembled.totalChars / 1.6),
              })}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-caption-1-regular text-text-tertiary">
            <span>{t("settings.botProseUsageLabel")}</span>
            <span
              className={cx(
                "font-mono",
                proseChars > PROSE_LIMIT ? "text-text-error-primary" : "text-text-secondary",
              )}
            >
              {proseChars.toLocaleString()} / {PROSE_LIMIT.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-separator-border px-4 py-3">
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(assembled.text).catch(() => {});
          }}
        >
          {t("settings.botPreviewCopy")}
        </Button>
        {onRefreshContext && (
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              onRefreshContext();
              setRefreshed(true);
            }}
          >
            {t("settings.botPreviewRefreshContext")}
          </Button>
        )}
        <span role="status" className="ml-auto text-caption-1-regular text-text-quaternary">
          {refreshed
            ? t("settings.botPreviewRefreshed")
            : t("settings.botPreviewRefreshHint")}
        </span>
      </div>
    </aside>
  );
}
