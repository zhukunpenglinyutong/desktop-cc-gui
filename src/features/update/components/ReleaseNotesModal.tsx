import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "../../messages/components/Markdown";
import type { ReleaseNotesEntry } from "../hooks/useReleaseNotes";

type ReleaseNotesModalProps = {
  isOpen: boolean;
  entries: ReleaseNotesEntry[];
  activeIndex: number;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRetry: () => void;
};

export function ReleaseNotesModal({
  isOpen,
  entries,
  activeIndex,
  loading,
  error,
  onClose,
  onPrev,
  onNext,
  onRetry,
}: ReleaseNotesModalProps) {
  const { t } = useTranslation();

  const currentEntry = useMemo(
    () => entries[activeIndex] ?? null,
    [activeIndex, entries],
  );
  const currentPage = entries.length > 0 ? activeIndex + 1 : 0;
  const hasPrevious = activeIndex > 0;
  const hasNext = activeIndex < entries.length - 1;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowLeft" && hasPrevious) {
        event.preventDefault();
        onPrev();
      }
      if (event.key === "ArrowRight" && hasNext) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [hasNext, hasPrevious, isOpen, onClose, onNext, onPrev]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="release-notes-modal fixed inset-0 z-[60] grid place-items-center [-webkit-app-region:no-drag]"
      role="dialog"
      aria-modal="true"
      aria-label={t("update.releaseNotesTitle")}
    >
      <button
        type="button"
        className="release-notes-modal-backdrop absolute inset-0 border-0 m-0 p-0 bg-black/60 backdrop-blur-[2px] cursor-default"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <section
        className="release-notes-modal-card relative z-[1] w-[min(480px,calc(100vw-24px))] h-[min(640px,calc(100vh-28px))] max-md:w-[calc(100vw-24px)] max-md:h-[calc(100vh-24px)] rounded-2xl max-md:rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-context-core)] shadow-[0_30px_64px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden"
      >
        <header
          className="release-notes-modal-header min-h-[66px] max-md:min-h-[58px] py-2.5 px-3.5 max-md:px-3.5 max-md:py-0 flex items-center justify-between border-b border-[var(--border-subtle)] gap-3"
        >
          <div className="release-notes-modal-heading min-w-0 flex items-center flex-wrap gap-x-3.5 gap-y-2">
            <h2 className="m-0 text-[28px] max-md:text-2xl leading-[1.1] tracking-[-0.02em]">
              {t("update.releaseNotesTitle")}
            </h2>
            {currentEntry ? (
              <>
                <span
                  className="release-notes-modal-version inline-flex items-center justify-center min-h-[24px] max-md:min-h-[22px] px-2.5 max-md:px-2 rounded-full border border-[color-mix(in_srgb,var(--border-accent)_58%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_82%,var(--surface-active))] text-[color-mix(in_srgb,var(--text-accent)_80%,var(--text-strong)_20%)] text-xs max-md:text-[11px] font-semibold leading-none tracking-normal"
                >
                  {currentEntry.tagName}
                </span>
                {currentEntry.dateLabel ? (
                  <span className="release-notes-modal-date text-muted-foreground text-[13px] max-md:text-xs">
                    {currentEntry.dateLabel}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="release-notes-modal-close text-muted-foreground"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="release-notes-modal-body min-h-0 flex-1 flex flex-col">
          {loading ? (
            <div className="release-notes-modal-state flex-1 grid gap-3 place-content-center justify-items-center text-center text-muted-foreground p-6">
              {t("update.releaseNotesLoading")}
            </div>
          ) : null}

          {!loading && error ? (
            <div className="release-notes-modal-state release-notes-modal-state-error flex-1 grid gap-3 place-content-center justify-items-center text-center text-muted-foreground p-6">
              <p>{t("update.releaseNotesLoadFailed")}</p>
              <code className="block max-w-[min(760px,80vw)] max-h-[180px] overflow-auto rounded-lg bg-[var(--surface-card-muted)] border border-[var(--border-subtle)] text-[var(--text-faint)] px-3 py-2.5 font-mono text-xs text-left whitespace-pre-wrap break-words">
                {error}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}

          {!loading && !error && !currentEntry ? (
            <div className="release-notes-modal-state flex-1 grid gap-3 place-content-center justify-items-center text-center text-muted-foreground p-6">
              {t("update.releaseNotesEmpty")}
            </div>
          ) : null}

          {!loading && !error && currentEntry ? (
            <ScrollArea className="release-notes-modal-scroll h-full" scrollbarGutter>
              <div className="release-notes-modal-content px-4 py-3.5 pb-4 flex flex-col gap-3.5">
                <section className="release-notes-language-block grid gap-2">
                  <h3 className="release-notes-language-title m-0 text-[13px] text-muted-foreground font-semibold">
                    {t("update.releaseNotesEnglish")}
                  </h3>
                  <Markdown
                    value={currentEntry.englishBody || t("update.releaseNotesEmpty")}
                    className="release-notes-markdown markdown"
                  />
                </section>
                <section className="release-notes-language-block grid gap-2">
                  <h3 className="release-notes-language-title m-0 text-[13px] text-muted-foreground font-semibold">
                    {t("update.releaseNotesChinese")}
                  </h3>
                  <Markdown
                    value={currentEntry.chineseBody || t("update.releaseNotesEmpty")}
                    className="release-notes-markdown markdown"
                  />
                </section>
              </div>
            </ScrollArea>
          ) : null}
        </div>

        <footer
          className="release-notes-modal-footer min-h-[60px] max-md:min-h-[56px] flex items-center justify-center gap-3.5 px-4 border-t border-[var(--border-subtle)]"
        >
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="release-notes-modal-nav w-9 h-8"
            aria-label={t("update.releaseNotesPrev")}
            onClick={onPrev}
            disabled={!hasPrevious}
          >
            <ChevronLeft />
          </Button>
          <div className="release-notes-modal-pagination min-w-[84px] text-center text-sm text-muted-foreground tabular-nums">
            {t("update.releaseNotesPage", {
              current: currentPage,
              total: entries.length,
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="release-notes-modal-nav w-9 h-8"
            aria-label={t("update.releaseNotesNext")}
            onClick={onNext}
            disabled={!hasNext}
          >
            <ChevronRight />
          </Button>
        </footer>
      </section>
    </div>
  );
}
