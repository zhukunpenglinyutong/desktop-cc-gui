import {
  Fragment,
  useEffect,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
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
  handleCopyMessage: (
    item: Extract<ConversationItem, { kind: "message" }>,
    copyText?: string,
  ) => void;
  handleExitPlanModeExecuteForItem: (
    itemId: string,
    mode: Extract<AccessMode, "default" | "full-access">,
  ) => Promise<void>;
  heartbeatPulse: number;
  isHistoryLoading: boolean;
  isThinking: boolean;
  isWorking: boolean;
  lastDurationMs: number | null;
  latestAssistantMessageId: string | null;
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
  hasVisibleUserInputRequest: boolean;
  userInputNode: ReactNode;
  visibleCollapsedHistoryItemCount: number;
  waitingForFirstChunk: boolean;
  workspaceId: string | null | undefined;
};

export function MessagesTimeline({
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
  handleCopyMessage,
  handleExitPlanModeExecuteForItem,
  heartbeatPulse,
  isHistoryLoading,
  isThinking,
  isWorking,
  lastDurationMs,
  latestAssistantMessageId,
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
    if (item.kind === "message") {
      const itemRenderKey = `message:${item.id}`;
      const isCopied = copiedMessageId === item.id;
      const agentTaskNotification = parseAgentTaskNotification(item.text);
      const shouldRenderFinalBoundary =
        item.role === "assistant" &&
        item.isFinal === true &&
        assistantFinalBoundarySet.has(item.id) &&
        !assistantLiveTurnFinalBoundarySuppressedSet.has(item.id);
      const shouldRenderReasoningBoundary =
        shouldRenderFinalBoundary && assistantFinalWithVisibleProcessSet.has(item.id);
      const finalMetaParts: string[] = [];
      if (typeof item.finalCompletedAt === "number" && item.finalCompletedAt > 0) {
        finalMetaParts.push(formatCompletedTimeMs(item.finalCompletedAt));
      }
      const finalMetaText = finalMetaParts.join(" · ");
      const bindMessageNode = (node: HTMLDivElement | null) => {
        if (item.role === "user" && node) {
          messageNodeByIdRef.current.set(item.id, node);
        } else {
          messageNodeByIdRef.current.delete(item.id);
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
                  <span>推理过程</span>
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
            data-message-anchor-id={item.id}
            data-agent-task-id={agentTaskNotification?.taskId ?? undefined}
            data-agent-tool-use-id={agentTaskNotification?.toolUseId ?? undefined}
          >
            <MessageRow
              item={item}
              workspaceId={workspaceId}
              threadId={threadId}
              isStreaming={
                (activeEngine === "claude" || activeEngine === "codex") &&
                isThinking &&
                item.role === "assistant" &&
                item.id === latestAssistantMessageId
              }
              activeEngine={activeEngine}
              activeCollaborationModeId={activeCollaborationModeId}
              enableCollaborationBadge={activeEngine === "codex"}
              presentationProfile={presentationProfile}
              showRuntimeReconnectCard={item.id === latestRuntimeReconnectItemId}
              onRecoverThreadRuntime={onRecoverThreadRuntime}
              onRecoverThreadRuntimeAndResend={onRecoverThreadRuntimeAndResend}
              retryMessage={
                item.id === latestRuntimeReconnectItemId
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
              suppressMemorySummaryCard={suppressedUserMemoryContextMessageIds.has(item.id)}
              suppressNoteCardSummaryCard={suppressedUserNoteCardContextMessageIds.has(item.id)}
            />
          </div>
          {shouldRenderFinalBoundary && (
            <div className="messages-turn-boundary messages-final-boundary" role="separator">
              <span className="messages-turn-boundary-label">
                <span className="messages-turn-boundary-label-content">
                  <Flag className="messages-turn-boundary-icon" size={13} aria-hidden />
                  <span>最终消息</span>
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
    if (item.kind === "reasoning") {
      const itemRenderKey = `reasoning:${item.id}`;
      const isExpanded = expandedItems.has(item.id);
      const parsed = reasoningMetaById.get(item.id) ?? parseReasoning(item);
      const isLiveReasoning =
        isThinking && latestReasoningId === item.id;
      return (
        <ReasoningRow
          key={itemRenderKey}
          item={item}
          workspaceId={workspaceId}
          parsed={parsed}
          isExpanded={isExpanded}
          isLive={isLiveReasoning}
          activeEngine={activeEngine}
          onToggle={toggleExpanded}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          streamMitigationProfile={streamMitigationProfile}
        />
      );
    }
    if (item.kind === "review") {
      return (
        <ReviewRow
          key={`review:${item.id}`}
          item={item}
          workspaceId={workspaceId}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
        />
      );
    }
    if (item.kind === "generatedImage") {
      return (
        <GeneratedImageRow
          key={`generated-image:${item.id}`}
          item={item}
          workspaceId={workspaceId}
        />
      );
    }
    if (item.kind === "diff") {
      return <DiffRow key={`diff:${item.id}`} item={item} />;
    }
    if (item.kind === "tool") {
      if (shouldHideCodexCanvasCommandCard(item, activeEngine)) {
        return null;
      }
      const isExpanded = expandedItems.has(item.id);
      const selectedExitPlanExecutionMode =
        selectedExitPlanExecutionByItemKey[`${threadId ?? "no-thread"}:${item.id}`] ?? null;
      const provenanceLabel = resolveProvenanceEngineLabel(item.engineSource);
      return (
        <div key={`tool:${item.id}`} className="message-tool-block-shell">
          {provenanceLabel ? (
            <div className="message-provenance-row">
              <span className="message-provenance-badge">{provenanceLabel}</span>
            </div>
          ) : null}
          <ToolBlockRenderer
            item={item}
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
    if (item.kind === "explore") {
      const isExpanded = liveAutoExpandedExploreId === item.id || expandedItems.has(item.id);
      return (
        <ExploreRow
          key={`explore:${item.id}`}
          item={item}
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
      if (activeEngine === "codex" || activeEngine === "claude") {
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
            streamMitigationProfile={streamMitigationProfile}
          />
        ))}
        {userInputNode}
        {isThinking && collapseLiveMiddleStepsEnabled && collapsedMiddleStepCount > 0 && (
          <div className="messages-live-middle-collapsed-indicator" role="status">
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
            >
              <span className="working-spinner" aria-hidden="true" />
              <div className="messages-history-loading-copy">
                <strong>{t("messages.restoringHistory")}</strong>
                <span>{t("messages.restoringHistoryHint")}</span>
              </div>
            </div>
          ) : (
            <div className="empty messages-empty">
              {t("messages.emptyThread")}
            </div>
          )
        )}
        {approvalNode}
        <div ref={bottomRef} />
      </div>
    </>
  );
}
