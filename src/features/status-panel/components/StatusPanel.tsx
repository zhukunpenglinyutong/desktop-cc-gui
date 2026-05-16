import {
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import Bot from "lucide-react/dist/esm/icons/bot";
import FileEdit from "lucide-react/dist/esm/icons/file-edit";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import ListTodo from "lucide-react/dist/esm/icons/list-todo";
import MessageSquareQuote from "lucide-react/dist/esm/icons/message-square-quote";
import type { LucideIcon } from "lucide-react";
import type { ConversationItem, GitFileStatus, TurnPlan } from "../../../types";
import { useStatusPanelData } from "../hooks/useStatusPanelData";
import type { FileChangeSummary, SubagentInfo, TabType } from "../types";
import {
  buildCheckpointViewModel,
  resolveCheckpointGeneratedSummary,
} from "../utils/checkpoint";
import { resolvePlanStepStatusForDisplay } from "../../threads/utils/threadNormalize";
import { CheckpointPanel } from "./CheckpointPanel";
import type { CodeAnnotationBridgeProps } from "../../code-annotations/types";
import { PlanList } from "./PlanList";
import { SubagentList } from "./SubagentList";
import { TodoList } from "./TodoList";
import { UserConversationTimelinePanel } from "./UserConversationTimelinePanel";
import { resolveUserConversationTimeline } from "../utils/userConversationTimeline";

interface StatusPanelProps extends CodeAnnotationBridgeProps {
  workspaceId?: string | null;
  workspacePath?: string | null;
  items: ConversationItem[];
  isProcessing: boolean;
  expanded?: boolean;
  plan?: TurnPlan | null;
  isPlanMode?: boolean;
  isCodexEngine?: boolean;
  activeThreadId?: string | null;
  activeTurnId?: string | null;
  workspaceGitFiles?: GitFileStatus[];
  workspaceGitStagedFiles?: GitFileStatus[];
  workspaceGitUnstagedFiles?: GitFileStatus[];
  workspaceGitTotals?: {
    additions: number;
    deletions: number;
  } | null;
  workspaceGitDiffs?: Array<{
    path: string;
    status: string;
    diff: string;
  }>;
  itemsByThread?: Record<string, ConversationItem[]>;
  threadParentById?: Record<string, string>;
  threadStatusById?: Record<string, { isProcessing?: boolean } | undefined>;
  onOpenDiffPath?: (path: string) => void;
  onOpenFilePath?: (path: string) => void;
  onSelectSubagent?: (agent: SubagentInfo) => void;
  onJumpToConversationMessage?: (messageId: string) => void;
  variant?: "popover" | "dock";
  visibleDockTabs?: Partial<Record<TabType, boolean>>;
  onRefreshGitStatus?: (() => void) | null;
  commitMessage?: string;
  commitMessageLoading?: boolean;
  commitMessageError?: string | null;
  onCommitMessageChange?: (value: string) => void;
  onGenerateCommitMessage?: (
    language?: "zh" | "en",
    engine?: "codex" | "claude" | "gemini" | "opencode",
    selectedPaths?: string[],
  ) => void | Promise<void>;
  onCommit?: (selectedPaths?: string[]) => void | Promise<void>;
  commitLoading?: boolean;
  commitError?: string | null;
  preferredDockTab?: TabType | null;
  preferredDockTabRequestKey?: number;
  onExpandToDock?: () => void;
}

type StatusPanelTabDefinition = {
  tab: TabType;
  labelKey: string;
  icon: LucideIcon;
  visible: boolean;
  badge?: ReactNode;
  loading?: boolean;
};

const DOCK_TAB_ORDER: readonly TabType[] = [
  "latestUserMessage",
  "todo",
  "subagent",
  "checkpoint",
  "plan",
];

const POPOVER_TAB_ORDER: readonly TabType[] = ["todo", "subagent", "checkpoint", "plan"];

const SP_TAB_COUNT_CLASS =
  "sp-tab-count text-[11px] tabular-nums opacity-80 font-mono";

// Base .sp-tab styles (popover variant)
// flex: 1 0 auto, with border-radius logic via sibling selectors
const SP_TAB_BASE_CLASS =
  "sp-tab [flex:1_0_auto] flex items-center justify-center gap-[5px] px-2.5 py-[5px] border-0 bg-transparent text-(--text-muted) cursor-pointer rounded-[7px] transition-colors duration-150 whitespace-nowrap text-xs leading-none hover:text-(--text-strong) not-last:border-r not-last:border-(--border-subtle) not-last:rounded-r-none not-first:rounded-l-none";

const SP_TAB_ACTIVE_POPOVER_CLASS = "sp-tab-active bg-(--surface-item) text-(--text-strong)";

// Dock variant .sp-tabs--dock .sp-tab override
const SP_TAB_DOCK_CLASS =
  "sp-tab group relative justify-start gap-1 px-[1px] py-[3px] border-0 rounded-none bg-transparent text-(--text-muted) text-xs font-medium cursor-pointer transition-colors duration-150 whitespace-nowrap leading-none flex items-center hover:bg-transparent hover:text-(--text-strong)";

const SP_TAB_ACTIVE_DOCK_CLASS = "sp-tab-active bg-transparent border-transparent text-(--text-strong)";

const SP_TAB_ICON_CLASS =
  "sp-tab-icon shrink-0 opacity-70 transition-[color,filter,opacity] duration-200";
const SP_TAB_ICON_DOCK_CLASS =
  "sp-tab-icon shrink-0 w-4 h-4 opacity-[0.68] transition-[color,filter,opacity] duration-200 group-hover:opacity-90 group-[.sp-tab-active]:text-(--color-link,#2563eb) group-[.sp-tab-active]:opacity-100 group-[.sp-tab-active]:[filter:drop-shadow(0_0_5px_color-mix(in_srgb,var(--color-link,#2563eb)_28%,transparent))]";

const SP_TAB_LABEL_CLASS = "sp-tab-label font-medium";
const SP_TAB_LABEL_DOCK_CLASS = "sp-tab-label text-xs font-semibold leading-none";

const SP_TAB_LOADING_CLASS =
  "sp-tab-loading w-2.5 h-2.5 border-2 border-(--border-strong) border-t-(--text-strong) rounded-full animate-[sp-spin_0.8s_linear_infinite]";

const SP_TABS_BASE_CLASS =
  "sp-tabs flex items-center bg-(--surface-card) border border-(--border-muted) rounded-[10px] p-1 gap-0 text-xs";

const SP_TABS_DOCK_CLASS =
  "sp-tabs sp-tabs--dock relative border [border-color:color-mix(in_srgb,var(--border-subtle,rgba(255,255,255,.08))_88%,transparent)] rounded-[7px] px-2 py-[3px] bg-transparent overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] order-1 mx-3 mb-[3px] flex-none gap-[18px] items-end flex [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0";

const SP_POPOVER_CLASS =
  "sp-popover absolute left-0 right-0 bottom-[calc(100%+4px)] bg-(--surface-card) border border-(--border-muted) rounded-xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] z-20 overflow-hidden animate-[sp-slide-up_0.15s_ease-out]";

const SP_POPOVER_CONTENT_CLASS =
  "sp-popover-content max-h-[280px] overflow-y-auto p-1.5 [--sb-thumb-color:transparent] hover:[--sb-thumb-color:var(--border-muted)] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--sb-thumb-color)] [&::-webkit-scrollbar-thumb]:rounded-full";

const SP_DOCK_CONTENT_CLASS =
  "sp-dock-content min-h-28 max-h-none h-full px-3 pt-0 pb-2";

const SP_DOCK_SHELL_CLASS = "sp-dock-shell min-h-0 flex-1 order-2";

const SP_ROOT_BASE_CLASS = "sp-root relative mb-1";
const SP_ROOT_DOCK_CLASS =
  "sp-root sp-root--dock w-full mb-0 ml-0 border-0 rounded-none bg-transparent shadow-none overflow-hidden h-full flex flex-col max-[920px]:w-full";

function resolvePreferredTab(
  variant: "popover" | "dock",
  showPlanTab: boolean,
  visibleDockTabs?: Partial<Record<TabType, boolean>>,
  dockTabAvailability?: Partial<Record<TabType, boolean>>,
): TabType | null {
  if (variant === "dock") {
    const isVisible = (tab: TabType) =>
      isDockTabVisible(variant, tab, showPlanTab, visibleDockTabs, dockTabAvailability);

    if (isVisible("plan")) {
      return "plan";
    }

    for (const tab of DOCK_TAB_ORDER.filter((entry) => entry !== "plan")) {
      if (isVisible(tab)) {
        return tab;
      }
    }
  }
  return null;
}

function hasTabData(completed: number, total: number) {
  return completed > 0 || total > 0;
}

function isDockTabVisible(
  variant: "popover" | "dock",
  tab: TabType,
  showPlanTab: boolean,
  visibleDockTabs?: Partial<Record<TabType, boolean>>,
  dockTabAvailability?: Partial<Record<TabType, boolean>>,
): boolean {
  if (variant !== "dock") {
    return true;
  }
  if (tab === "plan" && !showPlanTab) {
    return false;
  }
  if (visibleDockTabs?.[tab] === false) {
    return false;
  }
  return dockTabAvailability?.[tab] !== false;
}

export const StatusPanel = memo(function StatusPanel({
  workspaceId = null,
  workspacePath = null,
  items,
  isProcessing,
  expanded = true,
  plan = null,
  isPlanMode = false,
  isCodexEngine = false,
  activeThreadId = null,
  activeTurnId = null,
  workspaceGitFiles,
  workspaceGitStagedFiles = [],
  workspaceGitUnstagedFiles = [],
  workspaceGitTotals = null,
  workspaceGitDiffs = [],
  itemsByThread,
  threadParentById,
  threadStatusById,
  onOpenDiffPath,
  onOpenFilePath,
  onSelectSubagent,
  onJumpToConversationMessage,
  variant = "popover",
  visibleDockTabs,
  onRefreshGitStatus = null,
  commitMessage = "",
  commitMessageLoading = false,
  commitMessageError = null,
  onCommitMessageChange,
  onGenerateCommitMessage,
  onCommit,
  commitLoading = false,
  commitError = null,
  preferredDockTab = null,
  preferredDockTabRequestKey = 0,
  onExpandToDock,
  onCreateCodeAnnotation,
  onRemoveCodeAnnotation,
  codeAnnotations,
}: StatusPanelProps) {
  const { t } = useTranslation();
  const deferredItems = useDeferredValue(items);
  const effectiveItems = isProcessing ? deferredItems : items;
  const {
    commands,
    fileChanges,
    subagents,
    todoCompleted,
    todoTotal,
    todos,
    hasInProgressTodo,
    subagentCompleted,
    subagentTotal,
    hasRunningSubagent,
    totalAdditions,
    totalDeletions,
  } = useStatusPanelData(effectiveItems, {
    isCodexEngine,
    activeThreadId,
    activeTurnId,
    itemsByThread,
    threadParentById,
    threadStatusById,
  });

  const hasPlanData = isPlanMode || Boolean(plan);
  const showPlanTab = hasPlanData && !isCodexEngine;
  const panelRef = useRef<HTMLDivElement>(null);
  const planTotal = plan?.steps.length ?? 0;
  const planCompleted =
    plan?.steps.filter((step) => step.status === "completed").length ?? 0;
  const codexTaskItems = useMemo(() => {
    if (isCodexEngine && plan && plan.steps.length > 0) {
      return plan.steps.map((step) => {
        const statusForDisplay = resolvePlanStepStatusForDisplay(step.status, isProcessing);
        return {
          content: step.step,
          status:
            statusForDisplay === "completed"
              ? ("completed" as const)
              : statusForDisplay === "inProgress"
                ? ("in_progress" as const)
                : ("pending" as const),
        };
      });
    }
    return todos;
  }, [isCodexEngine, isProcessing, plan, todos]);
  const codexTaskCompleted = useMemo(
    () => codexTaskItems.filter((item) => item.status === "completed").length,
    [codexTaskItems],
  );
  const codexTaskTotal = codexTaskItems.length;
  const codexTaskInProgress = codexTaskItems.some((item) => item.status === "in_progress");
  const userConversationTimeline = useMemo(
    () =>
      resolveUserConversationTimeline(effectiveItems, {
        enableCollaborationBadge: isCodexEngine,
      }),
    [effectiveItems, isCodexEngine],
  );
  const workspaceFileChanges = useMemo<FileChangeSummary[]>(
    () => {
      const diffByPath = new Map(
        (workspaceGitDiffs ?? []).map((entry) => [entry.path, entry.diff]),
      );
      return (workspaceGitFiles ?? []).map((entry) => ({
        filePath: entry.path,
        fileName: entry.path.split(/[\\/]/).pop() ?? entry.path,
        status:
          entry.status === "A" || entry.status === "D" || entry.status === "R"
            ? entry.status
            : "M",
        additions: entry.additions,
        deletions: entry.deletions,
        diff: diffByPath.get(entry.path),
      }));
    },
    [workspaceGitDiffs, workspaceGitFiles],
  );
  const canonicalCheckpointFileFacts =
    workspaceGitFiles !== undefined ? workspaceFileChanges : null;
  const checkpoint = useMemo(
    () =>
      buildCheckpointViewModel({
        todos: isCodexEngine ? codexTaskItems : todos,
        subagents,
        fileChanges,
        commands,
        isProcessing,
        generatedSummary: resolveCheckpointGeneratedSummary(effectiveItems),
        canonicalFileFacts: canonicalCheckpointFileFacts,
      }),
    [
      canonicalCheckpointFileFacts,
      commands,
      codexTaskItems,
      effectiveItems,
      fileChanges,
      isCodexEngine,
      isProcessing,
      subagents,
      todos,
    ],
  );
  const displayedFileChanges =
    workspaceGitFiles !== undefined ? workspaceFileChanges : fileChanges;
  const displayedTotalAdditions =
    workspaceGitFiles !== undefined
      ? workspaceGitTotals?.additions ??
        workspaceFileChanges.reduce((sum, entry) => sum + entry.additions, 0)
      : totalAdditions;
  const displayedTotalDeletions =
    workspaceGitFiles !== undefined
      ? workspaceGitTotals?.deletions ??
        workspaceFileChanges.reduce((sum, entry) => sum + entry.deletions, 0)
      : totalDeletions;
  const shouldShowTodoTab = isCodexEngine
    ? hasTabData(codexTaskCompleted, codexTaskTotal)
    : hasTabData(todoCompleted, todoTotal);
  const shouldShowSubagentTab = hasTabData(subagentCompleted, subagentTotal);
  const shouldShowPlanTab = showPlanTab && hasTabData(planCompleted, planTotal);
  const dockTabAvailability = useMemo<Partial<Record<TabType, boolean>>>(
    () => ({
      latestUserMessage: true,
      todo: shouldShowTodoTab,
      subagent: shouldShowSubagentTab,
      checkpoint: true,
      plan: shouldShowPlanTab,
    }),
    [shouldShowPlanTab, shouldShowSubagentTab, shouldShowTodoTab],
  );
  const [openTab, setOpenTab] = useState<TabType | null>(() =>
    resolvePreferredTab(variant, showPlanTab, visibleDockTabs, dockTabAvailability),
  );

  useEffect(() => {
    if (variant !== "popover" || !openTab) return;
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpenTab(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openTab, variant]);

  useEffect(() => {
    if (variant !== "popover" || !openTab) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenTab(null);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [openTab, variant]);

  const preferredTab = resolvePreferredTab(
    variant,
    showPlanTab,
    visibleDockTabs,
    dockTabAvailability,
  );
  const resolvedPreferredDockTab =
    variant === "dock" &&
    preferredDockTab &&
    isDockTabVisible(variant, preferredDockTab, showPlanTab, visibleDockTabs, dockTabAvailability)
      ? preferredDockTab
      : null;

  useEffect(() => {
    if (!resolvedPreferredDockTab) {
      return;
    }
    setOpenTab(resolvedPreferredDockTab);
  }, [preferredDockTabRequestKey, resolvedPreferredDockTab]);

  useEffect(() => {
    if (variant === "dock") {
      if (
        !openTab ||
        !isDockTabVisible(variant, openTab, showPlanTab, visibleDockTabs, dockTabAvailability)
      ) {
        setOpenTab(preferredTab);
      }
      return;
    }
    if (openTab === "plan" && !showPlanTab) {
      setOpenTab(preferredTab);
    }
  }, [dockTabAvailability, openTab, preferredTab, showPlanTab, variant, visibleDockTabs]);

  const handleTabClick = useCallback(
    (tab: TabType) => {
      setOpenTab((previous) => {
        if (variant === "dock") {
          return tab;
        }
        return previous === tab ? null : tab;
      });
    },
    [variant],
  );

  const tabDefinitions = useMemo<Record<TabType, StatusPanelTabDefinition>>(
    () => ({
      latestUserMessage: {
        tab: "latestUserMessage",
        labelKey: "statusPanel.tabLatestUserMessage",
        icon: MessageSquareQuote,
        visible:
          variant === "dock" &&
          isDockTabVisible(
            variant,
            "latestUserMessage",
            showPlanTab,
            visibleDockTabs,
            dockTabAvailability,
          ),
        badge: <span className={SP_TAB_COUNT_CLASS}>{userConversationTimeline.items.length}</span>,
      },
      todo: {
        tab: "todo",
        labelKey: "statusPanel.tabTodos",
        icon: ListChecks,
        visible:
          variant === "dock"
            ? isDockTabVisible(variant, "todo", showPlanTab, visibleDockTabs, dockTabAvailability)
            : shouldShowTodoTab,
        badge: (
          <span className={SP_TAB_COUNT_CLASS}>
            {isCodexEngine ? `${codexTaskCompleted}/${codexTaskTotal}` : `${todoCompleted}/${todoTotal}`}
          </span>
        ),
        loading: isProcessing && (isCodexEngine ? codexTaskInProgress : hasInProgressTodo),
      },
      subagent: {
        tab: "subagent",
        labelKey: isCodexEngine ? "statusPanel.tabAgents" : "statusPanel.tabSubagents",
        icon: Bot,
        visible:
          variant === "dock"
            ? isDockTabVisible(
                variant,
                "subagent",
                showPlanTab,
                visibleDockTabs,
                dockTabAvailability,
              )
            : shouldShowSubagentTab,
        badge: <span className={SP_TAB_COUNT_CLASS}>{subagentCompleted}/{subagentTotal}</span>,
        loading: isProcessing && hasRunningSubagent,
      },
      checkpoint: {
        tab: "checkpoint",
        labelKey: "statusPanel.tabCheckpoint",
        icon: FileEdit,
        visible:
          variant === "dock"
            ? isDockTabVisible(
                variant,
                "checkpoint",
                showPlanTab,
                visibleDockTabs,
                dockTabAvailability,
              )
            : true,
        badge: (
          <span className={SP_TAB_COUNT_CLASS}>
            {t(`statusPanel.checkpoint.verdict.${checkpoint.verdict}`)}
          </span>
        ),
      },
      plan: {
        tab: "plan",
        labelKey: "statusPanel.tabPlan",
        icon: ListTodo,
        visible:
          variant === "dock"
            ? isDockTabVisible(variant, "plan", showPlanTab, visibleDockTabs, dockTabAvailability)
            : shouldShowPlanTab,
        badge: <span className={SP_TAB_COUNT_CLASS}>{planCompleted}/{planTotal}</span>,
        loading: isProcessing && isPlanMode,
      },
      command: {
        tab: "command",
        labelKey: "statusPanel.tabCommands",
        icon: FileEdit,
        visible: false,
      },
    }),
    [
      checkpoint.verdict,
      codexTaskCompleted,
      codexTaskInProgress,
      codexTaskTotal,
      dockTabAvailability,
      hasInProgressTodo,
      hasRunningSubagent,
      isCodexEngine,
      isProcessing,
      isPlanMode,
      planCompleted,
      planTotal,
      shouldShowPlanTab,
      shouldShowSubagentTab,
      shouldShowTodoTab,
      showPlanTab,
      subagentCompleted,
      subagentTotal,
      t,
      todoCompleted,
      todoTotal,
      userConversationTimeline.items.length,
      variant,
      visibleDockTabs,
    ],
  );

  if (!expanded) return null;

  if (variant === "dock" && !preferredTab) {
    return null;
  }

  const activeTab =
    variant === "dock"
      ? openTab &&
          isDockTabVisible(variant, openTab, showPlanTab, visibleDockTabs, dockTabAvailability)
        ? openTab
        : preferredTab
      : openTab;
  const contentNode = (
    <>
      {activeTab === "todo" && <TodoList todos={isCodexEngine ? codexTaskItems : todos} />}
      {activeTab === "subagent" && (
        <SubagentList
          subagents={subagents}
          onSelectSubagent={(agent) => {
            onSelectSubagent?.(agent);
            if (variant !== "dock") {
              setOpenTab(null);
            }
          }}
        />
      )}
      {activeTab === "checkpoint" && (
        <CheckpointPanel
          checkpoint={checkpoint}
          compact={variant !== "dock"}
          fileChanges={displayedFileChanges}
          totalAdditions={displayedTotalAdditions}
          totalDeletions={displayedTotalDeletions}
          onOpenDiffPath={onOpenDiffPath}
          onOpenFilePath={onOpenFilePath}
          workspaceId={workspaceId}
          workspacePath={workspacePath}
          onRefreshGitStatus={onRefreshGitStatus}
          commitMessage={commitMessage}
          commitMessageLoading={commitMessageLoading}
          commitMessageError={commitMessageError}
          onCommitMessageChange={onCommitMessageChange}
          onGenerateCommitMessage={onGenerateCommitMessage}
          onCommit={onCommit}
          commitLoading={commitLoading}
          commitError={commitError}
          stagedFiles={workspaceGitStagedFiles}
          unstagedFiles={workspaceGitUnstagedFiles}
          onCreateCodeAnnotation={onCreateCodeAnnotation}
          onRemoveCodeAnnotation={onRemoveCodeAnnotation}
          codeAnnotations={codeAnnotations}
          onExpandToDock={
            onExpandToDock
              ? () => {
                  onExpandToDock();
                  if (variant !== "dock") {
                    setOpenTab(null);
                  }
                }
              : undefined
          }
          onAfterSelect={() => {
            if (variant !== "dock") {
              setOpenTab(null);
            }
          }}
        />
      )}
      {activeTab === "latestUserMessage" && variant === "dock" && (
        <UserConversationTimelinePanel
          timeline={userConversationTimeline}
          onJumpToMessage={onJumpToConversationMessage}
        />
      )}
      {activeTab === "plan" && (
        <PlanList
          plan={plan}
          isPlanMode={isPlanMode}
          isProcessing={isProcessing}
          isCodexEngine={isCodexEngine}
        />
      )}
    </>
  );

  const orderedTabs = variant === "dock" ? DOCK_TAB_ORDER : POPOVER_TAB_ORDER;

  return (
    <div
      className={variant === "dock" ? SP_ROOT_DOCK_CLASS : SP_ROOT_BASE_CLASS}
      ref={panelRef}
    >
      <style>{STATUS_PANEL_KEYFRAMES}</style>
      {variant === "dock" ? (
        <>
          <div className={SP_TABS_DOCK_CLASS}>
            {orderedTabs
              .map((tab) => tabDefinitions[tab])
              .filter((definition) => definition.visible)
              .map((definition) => {
                const Icon = definition.icon;
                const isActive = activeTab === definition.tab;
                return (
                  <button
                    key={definition.tab}
                    type="button"
                    className={`${SP_TAB_DOCK_CLASS}${isActive ? ` ${SP_TAB_ACTIVE_DOCK_CLASS}` : ""}`}
                    onClick={() => handleTabClick(definition.tab)}
                    aria-expanded={isActive}
                  >
                    <Icon size={14} className={SP_TAB_ICON_DOCK_CLASS} />
                    <span className={SP_TAB_LABEL_DOCK_CLASS}>{t(definition.labelKey)}</span>
                    {definition.badge}
                    {definition.loading ? <span className={SP_TAB_LOADING_CLASS} /> : null}
                  </button>
                );
              })}
          </div>
          <div className={SP_DOCK_SHELL_CLASS}>
            <div className={`${SP_POPOVER_CONTENT_CLASS} ${SP_DOCK_CONTENT_CLASS}`}>
              {contentNode}
            </div>
          </div>
        </>
      ) : (
        <>
          {openTab ? (
            <div className={SP_POPOVER_CLASS}>
              <div className={SP_POPOVER_CONTENT_CLASS}>{contentNode}</div>
            </div>
          ) : null}
          <div className={SP_TABS_BASE_CLASS}>
            {orderedTabs
              .map((tab) => tabDefinitions[tab])
              .filter((definition) => definition.visible)
              .map((definition) => {
                const Icon = definition.icon;
                const isActive = activeTab === definition.tab;
                return (
                  <button
                    key={definition.tab}
                    type="button"
                    className={`${SP_TAB_BASE_CLASS}${isActive ? ` ${SP_TAB_ACTIVE_POPOVER_CLASS}` : ""}`}
                    onClick={() => handleTabClick(definition.tab)}
                    aria-expanded={isActive}
                  >
                    <Icon size={14} className={SP_TAB_ICON_CLASS} />
                    <span className={SP_TAB_LABEL_CLASS}>{t(definition.labelKey)}</span>
                    {definition.badge}
                    {definition.loading ? <span className={SP_TAB_LOADING_CLASS} /> : null}
                  </button>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
});

const STATUS_PANEL_KEYFRAMES = `
@keyframes sp-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes sp-slide-up {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
`;
