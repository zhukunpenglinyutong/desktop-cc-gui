import { memo, useEffect, useMemo, useState } from "react";
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

function resolveSequenceLabel(
  chronologicalIndex: number,
  reverseChronologicalIndex: number,
  total: number,
) {
  return {
    newestToOldestLabel: `${reverseChronologicalIndex}/${total}`,
    chronologicalLabel: `#${chronologicalIndex}`,
  };
}

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
    return <div className="sp-empty">{t("statusPanel.emptyLatestUserMessage")}</div>;
  }

  return (
    <div className="sp-user-conversation-timeline">
      {renderedItems.map((item) => {
        const hasText = item.text.length > 0;
        const hasImages = item.imageCount > 0;
        const { newestToOldestLabel, chronologicalLabel } = resolveSequenceLabel(
          item.chronologicalIndex,
          timeline.items.length - item.chronologicalIndex + 1,
          timeline.items.length,
        );
        return (
          <article key={item.id} className="sp-user-conversation-item">
            <div className="sp-user-conversation-header">
              <div className="sp-user-conversation-order">
                <span className="sp-user-conversation-order-primary">
                  {t("statusPanel.userConversationSequence", {
                    index: newestToOldestLabel,
                  })}
                </span>
                <span className="sp-user-conversation-order-secondary">
                  {t("statusPanel.userConversationChronologicalIndex", {
                    index: chronologicalLabel,
                  })}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="sp-user-conversation-jump"
              onClick={() => onJumpToMessage?.(item.id)}
            >
              {t("statusPanel.jumpToConversationMessage")}
            </button>

            {hasText ? (
              <pre
                className={`sp-user-conversation-text${
                  !item.expanded && item.isExpandable ? " is-collapsed" : ""
                }`}
              >
                {item.text}
              </pre>
            ) : null}

            {hasImages ? (
              <div className="sp-user-conversation-meta">
                {t("statusPanel.latestUserMessageImages", { count: item.imageCount })}
              </div>
            ) : null}

            {item.isExpandable ? (
              <button
                type="button"
                className="sp-user-conversation-toggle"
                onClick={() =>
                  setExpandedIds((current) => ({
                    ...current,
                    [item.id]: !current[item.id],
                  }))
                }
              >
                {item.expanded
                  ? t("statusPanel.collapseLatestUserMessage")
                  : t("statusPanel.expandLatestUserMessage")}
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
});
