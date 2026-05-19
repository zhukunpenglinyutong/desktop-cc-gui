import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import Bell from "lucide-react/dist/esm/icons/bell";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Flag from "lucide-react/dist/esm/icons/flag";
import MessageSquareText from "lucide-react/dist/esm/icons/message-square-text";
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
import { parseReasoning } from "./messagesReasoning";
import type { RuntimeReconnectRecoveryCallbackResult } from "./runtimeReconnect";
import {
  formatCompletedTimeMs,
  type HistoryStickyCandidate,
  type MessagesEngine,
  resolveProvenanceEngineLabel,
  shouldHideCodexCanvasCommandCard,
} from "./messagesRenderUtils";
import { buildTimelineProjectionRows, groupedEntryContainsItemId } from "./messagesTimelineProjection";
import {
  estimateTimelineProjectionRowSize,
  shouldVirtualizeTimelineRows,
} from "./messagesTimelineVirtualization";

type MessagesTimelineProps = {
  activeCollaborationModeId: string | null;
  activeEngine: MessagesEngine;
  activeUserInputAnchorItemId: string | null;
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
  scrollElementRef: RefObject<HTMLDivElement | null>;
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
  activeUserInputAnchorItemId,
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
  scrollElementRef,
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

  const shouldRenderUserInputAtTail = Boolean(
    userInputNode &&
      (!activeUserInputAnchorItemId ||
        !groupedEntries.some((entry) =>
          groupedEntryContainsItemId(entry, activeUserInputAnchorItemId),
        )),
  );
  const timelineProjectionRows = buildTimelineProjectionRows({
    activeUserInputAnchorItemId,
    approvalVisible: Boolean(approvalNode),
    claudeDockedReasoningItemIds: claudeDockedReasoningItems.map(({ item }) => item.id),
    collapsedMiddleStepCount,
    collapseLiveMiddleStepsEnabled,
    effectiveItemsCount,
    groupedEntries,
    hasVisibleUserInputRequest,
    hiddenClaudeReasoningOnly,
    isHistoryLoading,
    isThinking,
    shouldRenderUserInputAtTail,
  });
  const timelineRowByKey = useMemo(
    () => new Map(timelineProjectionRows.map((row) => [row.key, row])),
    [timelineProjectionRows],
  );
  const dockedReasoningById = useMemo(
    () => new Map(claudeDockedReasoningItems.map((entry) => [entry.item.id, entry])),
    [claudeDockedReasoningItems],
  );
  const shouldVirtualizeTimeline = shouldVirtualizeTimelineRows({
    isThinking,
    rowCount: timelineProjectionRows.length,
  });
  const timelineVirtualizer = useVirtualizer({
    count: shouldVirtualizeTimeline ? timelineProjectionRows.length : 0,
    estimateSize: (index) =>
      estimateTimelineProjectionRowSize(timelineProjectionRows[index] ?? {
        kind: "bottomAnchor",
        key: "bottom-anchor",
      }),
    getItemKey: (index) => timelineProjectionRows[index]?.key ?? `missing:${index}`,
    getScrollElement: () => scrollElementRef.current,
    overscan: 12,
  });

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
    const shouldRenderUserInputAfterEntry = Boolean(
      userInputNode &&
        activeUserInputAnchorItemId &&
        groupedEntryContainsItemId(entry, activeUserInputAnchorItemId),
    );
    const renderWithAnchoredUserInput = (node: ReactNode) => {
      if (!shouldRenderUserInputAfterEntry) {
        return node;
      }
      return (
        <Fragment key={`user-input-anchor:${activeUserInputAnchorItemId}`}>
          {node}
          {userInputNode}
        </Fragment>
      );
    };
    if (entry.kind === "readGroup") {
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <ReadToolGroupBlock key={`rg-${firstItem?.id ?? "read-group"}`} items={entry.items} />,
      );
    }
    if (entry.kind === "editGroup") {
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <EditToolGroupBlock
          key={`eg-${firstItem?.id ?? "edit-group"}`}
          items={entry.items}
          onOpenDiffPath={onOpenDiffPath}
        />,
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
      return renderWithAnchoredUserInput(
        <BashToolGroupBlock
          key={`bg-${firstItem?.id ?? "bash-group"}`}
          items={entry.items}
          onRequestAutoScroll={requestAutoScroll}
        />,
      );
    }
    if (entry.kind === "searchGroup") {
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <SearchToolGroupBlock key={`sg-${firstItem?.id ?? "search-group"}`} items={entry.items} />,
      );
    }
    return renderWithAnchoredUserInput(renderSingleItem(entry.item));
  };
  const renderProjectionRow = (row: ReturnType<typeof timelineRowByKey.get>) => {
    if (!row) {
      return null;
    }
    if (row.kind === "entry") {
      return renderEntry(row.entry);
    }
    if (row.kind === "dockedReasoning") {
      const dockedReasoning = dockedReasoningById.get(row.itemId);
      if (!dockedReasoning) {
        return null;
      }
      const { item, parsed } = dockedReasoning;
      return (
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
      );
    }
    if (row.kind === "tailUserInput") {
      return userInputNode;
    }
    if (row.kind === "liveMiddleCollapsed") {
      return (
        <div className="messages-live-middle-collapsed-indicator" role="status">
          {t("messages.middleStepsCollapsedHint", { count: row.count })}
        </div>
      );
    }
    if (row.kind === "workingIndicator") {
      return (
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
      );
    }
    if (row.kind === "emptyState") {
      if (row.state === "historyLoading") {
        return (
          <div
            className="empty messages-empty messages-history-loading"
            role="status"
            aria-live="polite"
          >
            <span className="working-spinner" aria-hidden="true" />
            <div className="messages-history-loading-copy">
              <strong>{t("messages.restoringHistory")}</strong>
              <span>{t("messages.restoringHistoryHint")}</span>
            </div>
          </div>
        );
      }
      if (row.state === "hiddenReasoning") {
        return (
          <div className="empty messages-empty messages-hidden-reasoning">
            {t("messages.hiddenThinkingContent")}
          </div>
        );
      }
      return <div className="empty messages-empty">{t("messages.emptyThread")}</div>;
    }
    if (row.kind === "approval") {
      return approvalNode;
    }
    if (row.kind === "bottomAnchor") {
      return null;
    }
    return null;
  };
  const renderVirtualProjectionRows = () => (
    <div
      className="messages-virtualized-canvas"
      style={{
        height: `${timelineVirtualizer.getTotalSize()}px`,
        position: "relative",
      }}
    >
      {timelineVirtualizer.getVirtualItems().map((virtualRow) => {
        const row = timelineProjectionRows[virtualRow.index];
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            data-timeline-row-kind={row?.kind}
            ref={timelineVirtualizer.measureElement}
            style={{
              left: 0,
              position: "absolute",
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
              width: "100%",
            }}
          >
            {renderProjectionRow(row)}
          </div>
        );
      })}
    </div>
  );
  const renderStaticProjectionRows = () =>
    timelineProjectionRows.map((row) => (
      <Fragment key={row.key}>{renderProjectionRow(row)}</Fragment>
    ));

  return (
    <>
      {activeStickyHeaderCandidate && (
        <div
          className="messages-history-sticky-header"
          data-history-sticky-message-id={activeStickyHeaderCandidate.id}
          data-history-sticky-collapsed={isStickyHeaderCollapsed ? "true" : "false"}
        >
          <div className="messages-history-sticky-header-inner">
            <div className="messages-history-sticky-header-content">
              <div
                className={`messages-history-sticky-header-bubble${
                  isStickyHeaderCollapsed ? " is-collapsed" : ""
                }`}
              >
                {!isStickyHeaderCollapsed ? (
                  <button
                    type="button"
                    className="messages-history-sticky-header-toggle"
                    data-history-sticky-toggle="collapse"
                    aria-label={t("messages.collapseStickyHeader")}
                    title={t("messages.collapseStickyHeader")}
                    aria-expanded={!isStickyHeaderCollapsed}
                    onClick={() => {
                      setIsStickyHeaderCollapsed(true);
                    }}
                  >
                    <ChevronRight size={15} aria-hidden />
                  </button>
                ) : null}
                <span className="messages-history-sticky-header-leading" aria-hidden="true">
                  <MessageSquareText size={12} />
                </span>
                <div className="messages-history-sticky-header-text">
                  {activeStickyHeaderCandidate.text}
                </div>
                {isStickyHeaderCollapsed ? (
                  <button
                    type="button"
                    className="messages-history-sticky-header-peek"
                    data-history-sticky-toggle="expand"
                    aria-label={t("messages.expandStickyHeader")}
                    title={t("messages.expandStickyHeader")}
                    aria-expanded={!isStickyHeaderCollapsed}
                    onClick={() => {
                      setIsStickyHeaderCollapsed(false);
                    }}
                  >
                    <ChevronLeft size={14} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
      <div
        className="messages-full"
        data-timeline-projection-row-count={timelineProjectionRows.length}
        data-timeline-virtualized={shouldVirtualizeTimeline ? "true" : "false"}
      >
        {visibleCollapsedHistoryItemCount > 0 && (
          <div
            className="messages-collapsed-indicator"
            data-collapsed-count={visibleCollapsedHistoryItemCount}
            onClick={onShowAllHistoryItems}
          >
            {t("messages.showEarlierMessages", { count: visibleCollapsedHistoryItemCount })}
          </div>
        )}
        {shouldVirtualizeTimeline ? renderVirtualProjectionRows() : renderStaticProjectionRows()}
        <div ref={bottomRef} />
      </div>
    </>
  );
});
