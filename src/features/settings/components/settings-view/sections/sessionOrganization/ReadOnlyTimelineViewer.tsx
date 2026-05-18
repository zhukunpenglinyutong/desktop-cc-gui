import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DiffRow,
  ExploreRow,
  GeneratedImageRow,
  MessageRow,
  ReasoningRow,
  ReviewRow,
} from "../../../../../messages/components/MessagesRows";
import { parseReasoning } from "../../../../../messages/components/messagesReasoning";
import type { EngineType, ConversationItem } from "../../../../../../types";

type ReadOnlyTimelineViewerProps = {
  items: ConversationItem[];
  engine: EngineType;
  workspaceId?: string | null;
  threadId?: string | null;
  emptyMessage: string;
};

type MessageItem = Extract<ConversationItem, { kind: "message" }>;
type ReasoningItem = Extract<ConversationItem, { kind: "reasoning" }>;
type DiffItem = Extract<ConversationItem, { kind: "diff" }>;
type ReviewItem = Extract<ConversationItem, { kind: "review" }>;
type ExploreItem = Extract<ConversationItem, { kind: "explore" }>;
type GeneratedImageItem = Extract<ConversationItem, { kind: "generatedImage" }>;
type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

function ToolRow({ item }: { item: ToolItem }) {
  const { t } = useTranslation();
  const title = item.title?.trim() || item.toolType;
  return (
    <div
      className="session-organization-timeline-tool"
      data-testid={`session-organization-timeline-tool-${item.id}`}
      role="article"
    >
      <header className="session-organization-timeline-tool-header">
        <span className="session-organization-timeline-tool-kind">
          {t("settings.sessionOrganizationTimelineToolBadge", {
            type: item.toolType,
          })}
        </span>
        <span className="session-organization-timeline-tool-title">{title}</span>
        {item.status ? (
          <span className="session-organization-timeline-tool-status">
            {item.status}
          </span>
        ) : null}
      </header>
      {item.detail ? (
        <pre className="session-organization-timeline-tool-detail">
          {item.detail}
        </pre>
      ) : null}
      {item.output ? (
        <pre className="session-organization-timeline-tool-output">
          {item.output}
        </pre>
      ) : null}
    </div>
  );
}

function ReadOnlyMessageRow({
  item,
  workspaceId,
  threadId,
  engine,
}: {
  item: MessageItem;
  workspaceId: string | null;
  threadId: string | null;
  engine: EngineType;
}) {
  const handleCopy = useCallback(() => {
    /* no-op: read-only viewer */
  }, []);
  return (
    <MessageRow
      item={item}
      workspaceId={workspaceId}
      threadId={threadId}
      isStreaming={false}
      activeEngine={engine}
      enableCollaborationBadge={false}
      isCopied={false}
      onCopy={handleCopy}
      showRuntimeReconnectCard={false}
    />
  );
}

function ReadOnlyReasoningRow({
  item,
  workspaceId,
  engine,
}: {
  item: ReasoningItem;
  workspaceId: string | null;
  engine: EngineType;
}) {
  const parsed = useMemo(() => parseReasoning(item), [item]);
  const [expanded, setExpanded] = useState(true);
  return (
    <ReasoningRow
      item={item}
      workspaceId={workspaceId}
      parsed={parsed}
      isExpanded={expanded}
      isLive={false}
      activeEngine={engine}
      onToggle={() => setExpanded((current) => !current)}
    />
  );
}

function ReadOnlyExploreRow({ item }: { item: ExploreItem }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <ExploreRow
      item={item}
      isExpanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
    />
  );
}

export const ReadOnlyTimelineViewer = memo(function ReadOnlyTimelineViewer({
  items,
  engine,
  workspaceId = null,
  threadId = null,
  emptyMessage,
}: ReadOnlyTimelineViewerProps) {
  if (items.length === 0) {
    return (
      <div
        className="session-organization-timeline-empty"
        data-testid="session-organization-timeline-empty"
      >
        {emptyMessage}
      </div>
    );
  }
  return (
    <div
      className="session-organization-timeline"
      data-testid="session-organization-timeline"
    >
      {items.map((item) => {
        switch (item.kind) {
          case "message":
            return (
              <ReadOnlyMessageRow
                key={item.id}
                item={item as MessageItem}
                workspaceId={workspaceId}
                threadId={threadId}
                engine={engine}
              />
            );
          case "reasoning":
            return (
              <ReadOnlyReasoningRow
                key={item.id}
                item={item as ReasoningItem}
                workspaceId={workspaceId}
                engine={engine}
              />
            );
          case "diff":
            return <DiffRow key={item.id} item={item as DiffItem} />;
          case "review":
            return (
              <ReviewRow
                key={item.id}
                item={item as ReviewItem}
                workspaceId={workspaceId}
              />
            );
          case "explore":
            return (
              <ReadOnlyExploreRow key={item.id} item={item as ExploreItem} />
            );
          case "generatedImage":
            return (
              <GeneratedImageRow
                key={item.id}
                item={item as GeneratedImageItem}
                workspaceId={workspaceId}
              />
            );
          case "tool":
            return <ToolRow key={item.id} item={item as ToolItem} />;
          default:
            return null;
        }
      })}
    </div>
  );
});
