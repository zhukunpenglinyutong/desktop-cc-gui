import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import Bell from "lucide-react/dist/esm/icons/bell";
import Flag from "lucide-react/dist/esm/icons/flag";
import type {
  AccessMode,
  ConversationItem,
  QueuedMessage,
} from "../../../types";
import type { StreamMitigationProfile } from "../../threads/utils/streamLatencyDiagnostics";
import type { GroupedEntry } from "../utils/groupToolItems";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";
import type { PresentationProfile } from "../presentation/presentationProfile";
import {
  ToolBlockRenderer,
  ReadToolGroupBlock,
  EditToolGroupBlock,
  BashToolGroupBlock,
  SearchToolGroupBlock,
} from "./toolBlocks";
import {
  DiffRow,
  ExploreRow,
  GeneratedImageRow,
  MessageRow,
  ReasoningRow,
  ReviewRow,
  WorkingIndicator,
} from "./MessagesRows";
import { MessagesHistoryStickyHeader } from "./MessagesHistoryStickyHeader";
import { parseReasoning } from "./messagesReasoning";
import type { RuntimeReconnectRecoveryCallbackResult } from "./runtimeReconnect";
import {
  formatCompletedTimeMs,
  type HistoryStickyCandidate,
  type MessagesEngine,
  resolveProvenanceEngineLabel,
  shouldHideCodexCanvasCommandCard,
} from "./messagesRenderUtils";

/**
 * Inline styles previously defined in `src/styles/messages.status-shell.css`.
 * Migrated here so the CSS file can shrink — the original class names
 * (`messages-empty`, `messages-history-loading*`, etc.) are retained as
 * no-op markers for existing selectors / QA hooks.
 */
const MESSAGES_EMPTY_STYLE: CSSProperties = {
  padding: "24px 0",
  maxWidth: "750px",
  marginLeft: "auto",
  marginRight: "auto",
  width: "100%",
};
const MESSAGES_HISTORY_LOADING_STYLE: CSSProperties = {
  ...MESSAGES_EMPTY_STYLE,
  minHeight: "220px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "14px",
  color: "var(--text-fainter)",
};
const MESSAGES_HISTORY_LOADING_SPINNER_STYLE: CSSProperties = {
  flex: "0 0 auto",
};
const MESSAGES_HISTORY_LOADING_COPY_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};
const MESSAGES_HISTORY_LOADING_COPY_STRONG_STYLE: CSSProperties = {
  color: "var(--text-stronger)",
  fontSize: "14px",
  fontWeight: 600,
};
const MESSAGES_HISTORY_LOADING_COPY_SPAN_STYLE: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.5,
};
const MESSAGES_LIVE_MIDDLE_COLLAPSED_INDICATOR_STYLE: CSSProperties = {
  margin: "4px 0 10px",
  padding: "7px 10px",
  borderRadius: "10px",
  border:
    "1px dashed color-mix(in srgb, var(--border-subtle) 86%, transparent)",
  background:
    "color-mix(in srgb, var(--surface-card-muted) 78%, transparent)",
  color: "var(--text-faint)",
  fontSize: "12px",
};

type MessagesTimelineProps = {
  activeCollaborationModeId: string | null;
  activeEngine: MessagesEngine;
  activeStickyHeaderCandidate: HistoryStickyCandidate | null;
  activeUserInputRequestId: string | number | null;
  agentTaskNodeByTaskIdRef: MutableRefObject<Map<string, HTMLDivElement>>;
  agentTaskNodeByToolUseIdRef: MutableRefObject<Map<string, HTMLDivElement>>;
  approvalNode: ReactNode;
  assistantFinalBoundarySet: Set<string>;
  assistantFinalWithVisibleProcessSet: Set<string>;
  assistantLiveTurnFinalBoundarySuppressedSet: Set<string>;
  bottomRef: RefObject<HTMLDivElement | null>;
  claudeDockedReasoningItems: Array<{
    item: Extract<ConversationItem, { kind: "reasoning" }>;
    parsed: ReturnType<typeof parseReasoning>;
  }>;
  collapseLiveMiddleStepsEnabled: boolean;
  collapsedMiddleStepCount: number;
  codeBlockCopyUseModifier: boolean;
  copiedMessageId: string | null;
  effectiveItemsCount: number;
  expandedItems: Set<string>;
  groupedEntries: GroupedEntry[];
  liveAssistantItem: Extract<ConversationItem, { kind: "message" }> | null;
  liveReasoningItem: Extract<ConversationItem, { kind: "reasoning" }> | null;
  handleCopyMessage: (
    item: Extract<ConversationItem, { kind: "message" }>,
    copyText?: string,
  ) => void;
  handleExitPlanModeExecuteForItem: (
    itemId: string,
    mode: Extract<AccessMode, "default" | "full-access">,
  ) => Promise<void>;
  heartbeatPulse: number;
  hiddenClaudeReasoningOnly: boolean;
  isHistoryLoading: boolean;
  isThinking: boolean;
  isWorking: boolean;
  lastDurationMs: number | null;
  liveAssistantMessageId: string | null;
  latestReasoningLabel: string | null;
  latestReasoningId: string | null;
  latestRetryMessage: Pick<QueuedMessage, "text" | "images"> | null;
  latestRuntimeReconnectItemId: string | null;
  latestWorkingActivityLabel: string | null;
  liveAutoExpandedExploreId: string | null;
  messageNodeByIdRef: MutableRefObject<Map<string, HTMLDivElement>>;
  onOpenDiffPath?: (path: string) => void;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onAssistantVisibleTextRender?: (payload: {
    itemId: string;
    visibleText: string;
  }) => void;
  onShowAllHistoryItems: () => void;
  openFileLink?: (path: string) => void;
  presentationProfile: PresentationProfile | null;
  primaryWorkingLabel: string | null;
  processingStartedAt: number | null;
  proxyEnabled: boolean;
  proxyUrl: string | null;
  reasoningMetaById: Map<string, ReturnType<typeof parseReasoning>>;
  requestAutoScroll: () => void;
  selectedExitPlanExecutionByItemKey: Record<string, Extract<AccessMode, "default" | "full-access">>;
  showFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
  streamMitigationProfile: StreamMitigationProfile | null;
  streamActivityPhase: "idle" | "waiting" | "ingress";
  suppressedUserMemoryContextMessageIds: Set<string>;
  suppressedUserNoteCardContextMessageIds: Set<string>;
  threadId: string | null;
  toggleExpanded: (id: string) => void;
  claudeHistoryTranscriptFallbackActive: boolean;
  hasVisibleUserInputRequest: boolean;
  userInputNode: ReactNode;
  visibleCollapsedHistoryItemCount: number;
  waitingForFirstChunk: boolean;
  workspaceId: string | null | undefined;
};

type NormalizedRenderKind = ConversationItem["kind"];

function resolveNormalizedRenderKind(item: ConversationItem): NormalizedRenderKind {
  return item.kind;
}

function resolveLiveRenderItem(
  item: ConversationItem,
  liveAssistantItem: Extract<ConversationItem, { kind: "message" }> | null,
  liveReasoningItem: Extract<ConversationItem, { kind: "reasoning" }> | null,
) {
  if (item.kind === "message" && liveAssistantItem?.id === item.id) {
    return liveAssistantItem;
  }
  if (item.kind === "reasoning" && liveReasoningItem?.id === item.id) {
    return liveReasoningItem;
  }
  return item;
}

export const MessagesTimeline = memo(function MessagesTimeline({
  activeCollaborationModeId,
  activeEngine,
  activeStickyHeaderCandidate,
  activeUserInputRequestId,
  agentTaskNodeByTaskIdRef,
  agentTaskNodeByToolUseIdRef,
  approvalNode,
  assistantFinalBoundarySet,
  assistantFinalWithVisibleProcessSet,
  assistantLiveTurnFinalBoundarySuppressedSet,
  bottomRef,
  claudeDockedReasoningItems,
  collapseLiveMiddleStepsEnabled,
  collapsedMiddleStepCount,
  codeBlockCopyUseModifier,
  copiedMessageId,
  effectiveItemsCount,
  expandedItems,
  groupedEntries,
  liveAssistantItem,
  liveReasoningItem,
  handleCopyMessage,
  handleExitPlanModeExecuteForItem,
  heartbeatPulse,
  hiddenClaudeReasoningOnly,
  isHistoryLoading,
  isThinking,
  isWorking,
  lastDurationMs,
  liveAssistantMessageId,
  latestReasoningLabel,
  latestReasoningId,
  latestRetryMessage,
  latestRuntimeReconnectItemId,
  latestWorkingActivityLabel,
  liveAutoExpandedExploreId,
  messageNodeByIdRef,
  onOpenDiffPath,
  onRecoverThreadRuntime,
  onRecoverThreadRuntimeAndResend,
  onAssistantVisibleTextRender,
  onShowAllHistoryItems,
  openFileLink,
  presentationProfile,
  primaryWorkingLabel,
  processingStartedAt,
  proxyEnabled,
  proxyUrl,
  reasoningMetaById,
  requestAutoScroll,
  selectedExitPlanExecutionByItemKey,
  showFileLinkMenu,
  streamMitigationProfile,
  streamActivityPhase,
  suppressedUserMemoryContextMessageIds,
  suppressedUserNoteCardContextMessageIds,
  threadId,
  toggleExpanded,
  claudeHistoryTranscriptFallbackActive,
  hasVisibleUserInputRequest,
  userInputNode,
  visibleCollapsedHistoryItemCount,
  waitingForFirstChunk,
  workspaceId,
}: MessagesTimelineProps) {
  const { t } = useTranslation();
  const [isStickyHeaderCollapsed, setIsStickyHeaderCollapsed] = useState(false);

  useEffect(() => {
    setIsStickyHeaderCollapsed(false);
  }, [threadId]);

  const renderSingleItem = (item: ConversationItem) => {
    const renderItem = resolveLiveRenderItem(
      item,
      liveAssistantItem,
      liveReasoningItem,
    );
    const renderKind = resolveNormalizedRenderKind(renderItem);
    if (renderKind === "message" && renderItem.kind === "message") {
      const itemRenderKey = `message:${renderItem.id}`;
      const isCopied = copiedMessageId === renderItem.id;
      const agentTaskNotification = parseAgentTaskNotification(renderItem.text);
      const shouldRenderFinalBoundary =
        renderItem.role === "assistant" &&
        renderItem.isFinal === true &&
        assistantFinalBoundarySet.has(renderItem.id) &&
        !assistantLiveTurnFinalBoundarySuppressedSet.has(renderItem.id);
      const shouldRenderReasoningBoundary =
        shouldRenderFinalBoundary && assistantFinalWithVisibleProcessSet.has(renderItem.id);
      const finalMetaParts: string[] = [];
      if (typeof renderItem.finalCompletedAt === "number" && renderItem.finalCompletedAt > 0) {
        finalMetaParts.push(formatCompletedTimeMs(renderItem.finalCompletedAt));
      }
      const finalMetaText = finalMetaParts.join(" · ");
      const bindMessageNode = (node: HTMLDivElement | null) => {
        if (renderItem.role === "user" && node) {
          messageNodeByIdRef.current.set(renderItem.id, node);
        } else {
          messageNodeByIdRef.current.delete(renderItem.id);
        }
        if (agentTaskNotification?.taskId && node) {
          agentTaskNodeByTaskIdRef.current.set(agentTaskNotification.taskId, node);
        } else if (agentTaskNotification?.taskId) {
          agentTaskNodeByTaskIdRef.current.delete(agentTaskNotification.taskId);
        }
        if (agentTaskNotification?.toolUseId && node) {
          agentTaskNodeByToolUseIdRef.current.set(agentTaskNotification.toolUseId, node);
        } else if (agentTaskNotification?.toolUseId) {
          agentTaskNodeByToolUseIdRef.current.delete(agentTaskNotification.toolUseId);
        }
      };
      return (
        <Fragment key={itemRenderKey}>
          {shouldRenderReasoningBoundary && (
            <div className="messages-turn-boundary messages-reasoning-boundary" role="separator">
              <span className="messages-turn-boundary-label">
                <span className="messages-turn-boundary-label-content">
                  <Bell className="messages-turn-boundary-icon" size={13} aria-hidden />
                  <span>{t("messages.reasoningProcessBoundary")}</span>
                </span>
              </span>
              {finalMetaText && (
                <span
                  className="messages-turn-boundary-meta messages-turn-boundary-meta-placeholder"
                  aria-hidden="true"
                >
                  {finalMetaText}
                </span>
              )}
            </div>
          )}
          <div
            ref={bindMessageNode}
            data-message-anchor-id={renderItem.id}
            data-agent-task-id={agentTaskNotification?.taskId ?? undefined}
            data-agent-tool-use-id={agentTaskNotification?.toolUseId ?? undefined}
          >
            <MessageRow
              item={renderItem}
              workspaceId={workspaceId}
              threadId={threadId}
              isStreaming={
                (activeEngine === "claude" ||
                  activeEngine === "codex" ||
                  activeEngine === "gemini") &&
                renderItem.role === "assistant" &&
                renderItem.id === liveAssistantMessageId
              }
              activeEngine={activeEngine}
              activeCollaborationModeId={activeCollaborationModeId}
              enableCollaborationBadge={activeEngine === "codex"}
              presentationProfile={presentationProfile}
              showRuntimeReconnectCard={renderItem.id === latestRuntimeReconnectItemId}
              onRecoverThreadRuntime={onRecoverThreadRuntime}
              onRecoverThreadRuntimeAndResend={onRecoverThreadRuntimeAndResend}
              retryMessage={
                renderItem.id === latestRuntimeReconnectItemId
                  ? latestRetryMessage
                  : null
              }
              isCopied={isCopied}
              onCopy={handleCopyMessage}
              codeBlockCopyUseModifier={codeBlockCopyUseModifier}
              onOpenFileLink={openFileLink}
              onOpenFileLinkMenu={showFileLinkMenu}
              streamMitigationProfile={streamMitigationProfile}
              onAssistantVisibleTextRender={onAssistantVisibleTextRender}
              suppressMemorySummaryCard={suppressedUserMemoryContextMessageIds.has(renderItem.id)}
              suppressNoteCardSummaryCard={suppressedUserNoteCardContextMessageIds.has(renderItem.id)}
            />
          </div>
          {shouldRenderFinalBoundary && (
            <div className="messages-turn-boundary messages-final-boundary" role="separator">
              <span className="messages-turn-boundary-label">
                <span className="messages-turn-boundary-label-content">
                  <Flag className="messages-turn-boundary-icon" size={13} aria-hidden />
                  <span>{t("messages.finalMessageBoundary")}</span>
                </span>
              </span>
              {finalMetaText && (
                <span className="messages-turn-boundary-meta">{finalMetaText}</span>
              )}
            </div>
          )}
        </Fragment>
      );
    }
    if (renderKind === "reasoning" && renderItem.kind === "reasoning") {
      const itemRenderKey = `reasoning:${renderItem.id}`;
      const isExpanded = expandedItems.has(renderItem.id);
      const parsed = reasoningMetaById.get(renderItem.id) ?? parseReasoning(renderItem);
      const isLiveReasoning =
        isThinking && latestReasoningId === renderItem.id;
      return (
        <ReasoningRow
          key={itemRenderKey}
          item={renderItem}
          workspaceId={workspaceId}
          parsed={parsed}
          isExpanded={isExpanded}
          isLive={isLiveReasoning}
          activeEngine={activeEngine}
          onToggle={toggleExpanded}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          presentationProfile={presentationProfile}
          streamMitigationProfile={streamMitigationProfile}
        />
      );
    }
    if (renderKind === "review" && renderItem.kind === "review") {
      return (
        <ReviewRow
          key={`review:${renderItem.id}`}
          item={renderItem}
          workspaceId={workspaceId}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
        />
      );
    }
    if (renderKind === "generatedImage" && renderItem.kind === "generatedImage") {
      return (
        <GeneratedImageRow
          key={`generated-image:${renderItem.id}`}
          item={renderItem}
          workspaceId={workspaceId}
        />
      );
    }
    if (renderKind === "diff" && renderItem.kind === "diff") {
      return <DiffRow key={`diff:${renderItem.id}`} item={renderItem} />;
    }
    if (renderKind === "tool" && renderItem.kind === "tool") {
      if (shouldHideCodexCanvasCommandCard(renderItem, activeEngine)) {
        return null;
      }
      const isExpanded = expandedItems.has(renderItem.id);
      const selectedExitPlanExecutionMode =
        selectedExitPlanExecutionByItemKey[`${threadId ?? "no-thread"}:${renderItem.id}`] ?? null;
      const provenanceLabel = resolveProvenanceEngineLabel(renderItem.engineSource);
      return (
        <div key={`tool:${renderItem.id}`} className="message-tool-block-shell">
          {provenanceLabel ? (
            <div className="message-provenance-row">
              <span className="message-provenance-badge">{provenanceLabel}</span>
            </div>
          ) : null}
          <ToolBlockRenderer
            item={renderItem}
            workspaceId={workspaceId}
            isExpanded={isExpanded}
            onToggle={toggleExpanded}
            onRequestAutoScroll={requestAutoScroll}
            activeCollaborationModeId={activeCollaborationModeId}
            activeEngine={activeEngine}
            hasPendingUserInputRequest={activeUserInputRequestId !== null}
            onOpenDiffPath={onOpenDiffPath}
            selectedExitPlanExecutionMode={selectedExitPlanExecutionMode}
            onExitPlanModeExecute={handleExitPlanModeExecuteForItem}
          />
        </div>
      );
    }
    if (renderKind === "explore" && renderItem.kind === "explore") {
      const isExpanded =
        liveAutoExpandedExploreId === renderItem.id || expandedItems.has(renderItem.id);
      return (
        <ExploreRow
          key={`explore:${renderItem.id}`}
          item={renderItem}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
        />
      );
    }
    return null;
  };

  const renderEntry = (entry: GroupedEntry) => {
    if (entry.kind === "readGroup") {
      const firstItem = entry.items[0];
      return <ReadToolGroupBlock key={`rg-${firstItem?.id ?? "read-group"}`} items={entry.items} />;
    }
    if (entry.kind === "editGroup") {
      const firstItem = entry.items[0];
      return (
        <EditToolGroupBlock
          key={`eg-${firstItem?.id ?? "edit-group"}`}
          items={entry.items}
          onOpenDiffPath={onOpenDiffPath}
        />
      );
    }
    if (entry.kind === "bashGroup") {
      if (
        activeEngine === "codex" ||
        (activeEngine === "claude" && !claudeHistoryTranscriptFallbackActive)
      ) {
        return null;
      }
      const firstItem = entry.items[0];
      return (
        <BashToolGroupBlock
          key={`bg-${firstItem?.id ?? "bash-group"}`}
          items={entry.items}
          onRequestAutoScroll={requestAutoScroll}
        />
      );
    }
    if (entry.kind === "searchGroup") {
      const firstItem = entry.items[0];
      return <SearchToolGroupBlock key={`sg-${firstItem?.id ?? "search-group"}`} items={entry.items} />;
    }
    return renderSingleItem(entry.item);
  };

  const handleStickyCollapse = useCallback(() => {
    setIsStickyHeaderCollapsed(true);
  }, []);
  const handleStickyExpand = useCallback(() => {
    setIsStickyHeaderCollapsed(false);
  }, []);

  return (
    <>
      {activeStickyHeaderCandidate && (
        <MessagesHistoryStickyHeader
          candidate={activeStickyHeaderCandidate}
          isCollapsed={isStickyHeaderCollapsed}
          onCollapse={handleStickyCollapse}
          onExpand={handleStickyExpand}
        />
      )}
      <div className="messages-full">
        {visibleCollapsedHistoryItemCount > 0 && (
          <div
            className="messages-collapsed-indicator"
            data-collapsed-count={visibleCollapsedHistoryItemCount}
            onClick={onShowAllHistoryItems}
          >
            {t("messages.showEarlierMessages", { count: visibleCollapsedHistoryItemCount })}
          </div>
        )}
        {groupedEntries.map(renderEntry)}
        {claudeDockedReasoningItems.map(({ item, parsed }) => (
          <ReasoningRow
            key={`claude-live-${item.id}`}
            item={item}
            workspaceId={workspaceId}
            parsed={parsed}
            isExpanded={isThinking && latestReasoningId === item.id ? true : expandedItems.has(item.id)}
            isLive={isThinking && latestReasoningId === item.id}
            onToggle={toggleExpanded}
            onOpenFileLink={openFileLink}
            onOpenFileLinkMenu={showFileLinkMenu}
            presentationProfile={presentationProfile}
            streamMitigationProfile={streamMitigationProfile}
          />
        ))}
        {userInputNode}
        {isThinking && collapseLiveMiddleStepsEnabled && collapsedMiddleStepCount > 0 && (
          <div
            className="messages-live-middle-collapsed-indicator"
            role="status"
            style={MESSAGES_LIVE_MIDDLE_COLLAPSED_INDICATOR_STYLE}
          >
            {t("messages.middleStepsCollapsedHint", { count: collapsedMiddleStepCount })}
          </div>
        )}
        <WorkingIndicator
          isThinking={isWorking}
          proxyEnabled={proxyEnabled}
          proxyUrl={proxyUrl}
          processingStartedAt={processingStartedAt}
          lastDurationMs={lastDurationMs}
          heartbeatPulse={heartbeatPulse}
          hasItems={effectiveItemsCount > 0}
          reasoningLabel={latestReasoningLabel}
          activityLabel={latestWorkingActivityLabel}
          primaryLabel={primaryWorkingLabel}
          activeEngine={activeEngine}
          waitingForFirstChunk={waitingForFirstChunk}
          presentationProfile={presentationProfile}
          streamActivityPhase={streamActivityPhase}
        />
        {!effectiveItemsCount && !hasVisibleUserInputRequest && (
          isHistoryLoading ? (
            <div
              className="empty messages-empty messages-history-loading"
              role="status"
              aria-live="polite"
              style={MESSAGES_HISTORY_LOADING_STYLE}
            >
              <span
                className="working-spinner"
                aria-hidden="true"
                style={MESSAGES_HISTORY_LOADING_SPINNER_STYLE}
              />
              <div
                className="messages-history-loading-copy"
                style={MESSAGES_HISTORY_LOADING_COPY_STYLE}
              >
                <strong style={MESSAGES_HISTORY_LOADING_COPY_STRONG_STYLE}>
                  {t("messages.restoringHistory")}
                </strong>
                <span style={MESSAGES_HISTORY_LOADING_COPY_SPAN_STYLE}>
                  {t("messages.restoringHistoryHint")}
                </span>
              </div>
            </div>
          ) : hiddenClaudeReasoningOnly ? (
            <div
              className="empty messages-empty messages-hidden-reasoning"
              style={MESSAGES_EMPTY_STYLE}
            >
              {t("messages.hiddenThinkingContent")}
            </div>
          ) : (
            <div className="empty messages-empty" style={MESSAGES_EMPTY_STYLE}>
              {t("messages.emptyThread")}
            </div>
          )
        )}
        {approvalNode}
        <div ref={bottomRef} />
      </div>
    </>
  );
});
