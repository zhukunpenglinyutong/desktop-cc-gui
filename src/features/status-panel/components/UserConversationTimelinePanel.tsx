import { memo, useEffect, useMemo, useState } from "react";
import ArrowUpRight from "lucide-react/dist/esm/icons/arrow-up-right";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Images from "lucide-react/dist/esm/icons/images";
import { useTranslation } from "react-i18next";
import type { UserConversationTimeline } from "../utils/userConversationTimeline";

const PREVIEW_LINE_LIMIT = 4;

interface UserConversationTimelinePanelProps {
  timeline: UserConversationTimeline;
  onJumpToMessage?: (messageId: string) => void;
}

function countLines(text: string) {
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

const JUMP_TOGGLE_CLASS =
  "self-start inline-flex items-center gap-1.5 min-h-6 px-2 py-0 pl-2 rounded-full border-0 bg-transparent text-(--accent-primary,#6ea8fe) text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-[background,color,opacity] duration-150 hover:no-underline hover:[background:color-mix(in_srgb,var(--surface-hover,rgba(255,255,255,.06))_72%,transparent)] hover:opacity-95 focus-visible:outline-2 focus-visible:[outline-color:color-mix(in_srgb,var(--accent-primary,#6ea8fe)_42%,transparent)] focus-visible:outline-offset-2 max-[640px]:min-h-6 max-[640px]:pl-1.5";

export const UserConversationTimelinePanel = memo(function UserConversationTimelinePanel({
  timeline,
  onJumpToMessage,
}: UserConversationTimelinePanelProps) {
  const { t } = useTranslation();
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedIds({});
  }, [timeline]);

  const renderedItems = useMemo(
    () =>
      timeline.items.map((item) => ({
        ...item,
        isExpandable: countLines(item.text) > PREVIEW_LINE_LIMIT,
        expanded: expandedIds[item.id] === true,
      })),
    [expandedIds, timeline.items],
  );

  if (!timeline.hasMessage) {
    return (
      <div className="sp-empty p-4 text-center text-(--text-faint) text-xs">
        {t("statusPanel.emptyLatestUserMessage")}
      </div>
    );
  }

  return (
    <div className="sp-user-conversation-timeline flex flex-col gap-2 min-h-full pt-1.5 pb-3">
      {renderedItems.map((item) => {
        const hasText = item.text.length > 0;
        const hasImages = item.imageCount > 0;
        const chronologicalLabel = `#${item.chronologicalIndex}`;
        return (
          <article
            key={item.id}
            className="sp-user-conversation-item relative grid grid-cols-[16px_minmax(0,1fr)] gap-2.5 items-stretch max-[640px]:grid-cols-[14px_minmax(0,1fr)] max-[640px]:gap-2"
          >
            <div
              className="sp-user-conversation-rail flex flex-col items-center pt-3"
              aria-hidden="true"
            >
              <span className="sp-user-conversation-node w-2 h-2 rounded-full shrink-0 [background:color-mix(in_srgb,var(--accent-primary,#6ea8fe)_78%,white_22%)] [box-shadow:0_0_0_3px_color-mix(in_srgb,var(--accent-primary,#6ea8fe)_12%,transparent)]" />
              <span className="sp-user-conversation-stem flex-1 w-px mt-2 [background:color-mix(in_srgb,var(--accent-primary,#6ea8fe)_28%,transparent)] [.sp-user-conversation-item:last-child_&]:opacity-0" />
            </div>
            <div className="sp-user-conversation-card flex flex-col gap-2 min-w-0 pt-2.5 pb-3 px-0 rounded-none bg-transparent border-0 border-b [border-bottom-color:color-mix(in_srgb,var(--border-subtle,rgba(255,255,255,.08))_72%,transparent)] transition-colors duration-200 hover:[border-color:color-mix(in_srgb,var(--accent-primary,#6ea8fe)_24%,var(--border-subtle,rgba(255,255,255,.08)))] [.sp-user-conversation-item:last-child_&]:border-b-transparent">
              <div className="sp-user-conversation-header flex items-start justify-between gap-2.5 flex-wrap max-[640px]:gap-2">
                <div className="sp-user-conversation-order flex items-center gap-2 flex-1 flex-wrap min-w-0">
                  <span className="sp-user-conversation-order-secondary inline-flex items-center gap-0 text-(--text-muted) text-[11px] whitespace-nowrap">
                    <span className="sp-user-conversation-order-index font-bold tracking-wide [color:color-mix(in_srgb,var(--accent-primary,#6ea8fe)_86%,var(--text-strong))]">
                      {chronologicalLabel}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  className={`sp-user-conversation-jump ${JUMP_TOGGLE_CLASS}`}
                  onClick={() => onJumpToMessage?.(item.id)}
                >
                  <ArrowUpRight
                    size={12}
                    className="sp-user-conversation-inline-icon shrink-0 opacity-75"
                    aria-hidden="true"
                  />
                  {t("statusPanel.jumpToConversationMessage")}
                </button>
              </div>

              {hasText ? (
                <pre
                  className={`sp-user-conversation-text m-0 text-(--text-strong) text-[13px] leading-[1.6] whitespace-pre-wrap break-words font-[inherit] pl-0${
                    !item.expanded && item.isExpandable
                      ? " is-collapsed [display:-webkit-box] overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:4]"
                      : ""
                  }`}
                >
                  {item.text}
                </pre>
              ) : null}

              {(hasImages || item.isExpandable) && (
                <div className="sp-user-conversation-footer flex items-center justify-between gap-2 flex-wrap">
                  {hasImages ? (
                    <div className="sp-user-conversation-meta inline-flex items-center gap-1.5 min-h-5 pr-0.5 rounded-full text-(--text-muted) text-[11px] tracking-wide">
                      <Images
                        size={12}
                        className="sp-user-conversation-inline-icon shrink-0 opacity-75"
                        aria-hidden="true"
                      />
                      {t("statusPanel.latestUserMessageImages", { count: item.imageCount })}
                    </div>
                  ) : (
                    <span />
                  )}

                  {item.isExpandable ? (
                    <button
                      type="button"
                      className={`sp-user-conversation-toggle ${JUMP_TOGGLE_CLASS}`}
                      onClick={() =>
                        setExpandedIds((current) => ({
                          ...current,
                          [item.id]: !current[item.id],
                        }))
                      }
                    >
                      {item.expanded ? (
                        <ChevronUp
                          size={12}
                          className="sp-user-conversation-inline-icon shrink-0 opacity-75"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronDown
                          size={12}
                          className="sp-user-conversation-inline-icon shrink-0 opacity-75"
                          aria-hidden="true"
                        />
                      )}
                      {item.expanded
                        ? t("statusPanel.collapseLatestUserMessage")
                        : t("statusPanel.expandLatestUserMessage")}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
});
