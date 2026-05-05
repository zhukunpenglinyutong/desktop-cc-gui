import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import Bot from "lucide-react/dist/esm/icons/bot";
import FileEdit from "lucide-react/dist/esm/icons/file-edit";
import ListTodo from "lucide-react/dist/esm/icons/list-todo";
import MessageSquareQuote from "lucide-react/dist/esm/icons/message-square-quote";
import type { ConversationItem } from "../../../types";
import type { TurnPlan } from "../../../types";
import type { TabType } from "../types";
import { useStatusPanelData } from "../hooks/useStatusPanelData";
import { resolvePlanStepStatusForDisplay } from "../../threads/utils/threadNormalize";
import { TodoList } from "./TodoList";
import { SubagentList } from "./SubagentList";
import { FileChangesList } from "./FileChangesList";
import { PlanList } from "./PlanList";
import type { SubagentInfo } from "../types";
import { resolveUserConversationTimeline } from "../utils/userConversationTimeline";
import { UserConversationTimelinePanel } from "./UserConversationTimelinePanel";

interface StatusPanelProps {
  items: ConversationItem[];
  isProcessing: boolean;
  expanded?: boolean;
  plan?: TurnPlan | null;
  isPlanMode?: boolean;
  isCodexEngine?: boolean;
  activeThreadId?: string | null;
  itemsByThread?: Record<string, ConversationItem[]>;
  threadParentById?: Record<string, string>;
  threadStatusById?: Record<string, { isProcessing?: boolean } | undefined>;
  onOpenDiffPath?: (path: string) => void;
  onSelectSubagent?: (agent: SubagentInfo) => void;
  onJumpToConversationMessage?: (messageId: string) => void;
  variant?: "popover" | "dock";
  visibleDockTabs?: Partial<Record<TabType, boolean>>;
}

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
    for (const tab of ["latestUserMessage", "todo", "subagent", "files"] as const) {
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
  items,
  isProcessing,
  expanded = true,
  plan = null,
  isPlanMode = false,
  isCodexEngine = false,
  activeThreadId = null,
  itemsByThread,
  threadParentById,
  threadStatusById,
  onOpenDiffPath,
  onSelectSubagent,
  onJumpToConversationMessage,
  variant = "popover",
  visibleDockTabs,
}: StatusPanelProps) {
  const { t } = useTranslation();
  const deferredItems = useDeferredValue(items);
  const effectiveItems = isProcessing ? deferredItems : items;
  const {
    todos,
    subagents,
    fileChanges,
    todoCompleted,
    todoTotal,
    hasInProgressTodo,
    subagentCompleted,
    subagentTotal,
    hasRunningSubagent,
    totalAdditions,
    totalDeletions,
  } = useStatusPanelData(effectiveItems, {
    isCodexEngine,
    activeThreadId,
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
      files: true,
      plan: shouldShowPlanTab,
    }),
    [shouldShowPlanTab, shouldShowSubagentTab, shouldShowTodoTab],
  );
  const [openTab, setOpenTab] = useState<TabType | null>(() =>
    resolvePreferredTab(variant, showPlanTab, visibleDockTabs, dockTabAvailability),
  );

  // 点击外部关闭 popover
  useEffect(() => {
    if (variant !== "popover" || !openTab) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
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
      setOpenTab((prev) => {
        if (variant === "dock") {
          return tab;
        }
        return prev === tab ? null : tab;
      });
    },
    [variant],
  );

  if (!expanded) return null;

  if (variant === "dock" && !preferredTab) {
    return null;
  }

  const activeTab = variant === "dock"
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
      {activeTab === "files" && (
        <FileChangesList
          fileChanges={fileChanges}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
          onOpenDiffPath={onOpenDiffPath}
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

  return (
    <div className={`sp-root${variant === "dock" ? " sp-root--dock" : ""}`} ref={panelRef}>
      {variant === "dock" ? (
        <>
          <div className="sp-tabs sp-tabs--dock">
            {isDockTabVisible(
              variant,
              "latestUserMessage",
              showPlanTab,
              visibleDockTabs,
              dockTabAvailability,
            ) && (
              <button
                type="button"
                className={`sp-tab${activeTab === "latestUserMessage" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("latestUserMessage")}
                aria-expanded={activeTab === "latestUserMessage"}
              >
                <MessageSquareQuote size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabLatestUserMessage")}</span>
              </button>
            )}

            {isCodexEngine && isDockTabVisible(
              variant,
              "todo",
              showPlanTab,
              visibleDockTabs,
              dockTabAvailability,
            ) && (
              <button
                type="button"
                className={`sp-tab${activeTab === "todo" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("todo")}
              >
                <ListChecks size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabTodos")}</span>
                <span className="sp-tab-count">
                  {codexTaskCompleted}/{codexTaskTotal}
                </span>
                {isProcessing && codexTaskInProgress && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}

            {isCodexEngine && isDockTabVisible(
              variant,
              "subagent",
              showPlanTab,
              visibleDockTabs,
              dockTabAvailability,
            ) && (
              <button
                type="button"
                className={`sp-tab${activeTab === "subagent" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("subagent")}
              >
                <Bot size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabAgents")}</span>
                <span className="sp-tab-count">
                  {subagentCompleted}/{subagentTotal}
                </span>
                {isProcessing && hasRunningSubagent && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}

            {isCodexEngine && isDockTabVisible(
              variant,
              "files",
              showPlanTab,
              visibleDockTabs,
              dockTabAvailability,
            ) && (
              <button
                type="button"
                className={`sp-tab${activeTab === "files" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("files")}
                aria-expanded={activeTab === "files"}
              >
                <FileEdit size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabEdits")}</span>
                <span className="sp-tab-file-stats">
                  <span className="sp-stat-add">+{totalAdditions}</span>
                  <span className="sp-stat-mod">-{totalDeletions}</span>
                </span>
              </button>
            )}

            {!isCodexEngine && isDockTabVisible(
              variant,
              "todo",
              showPlanTab,
              visibleDockTabs,
              dockTabAvailability,
            ) && (
              <button
                type="button"
                className={`sp-tab${activeTab === "todo" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("todo")}
              >
                <ListChecks size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabTodos")}</span>
                <span className="sp-tab-count">
                  {todoCompleted}/{todoTotal}
                </span>
                {isProcessing && hasInProgressTodo && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}

            {!isCodexEngine && isDockTabVisible(
              variant,
              "subagent",
              showPlanTab,
              visibleDockTabs,
              dockTabAvailability,
            ) && (
              <button
                type="button"
                className={`sp-tab${activeTab === "subagent" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("subagent")}
              >
                <Bot size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabSubagents")}</span>
                <span className="sp-tab-count">
                  {subagentCompleted}/{subagentTotal}
                </span>
                {isProcessing && hasRunningSubagent && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}

            {!isCodexEngine && isDockTabVisible(
              variant,
              "files",
              showPlanTab,
              visibleDockTabs,
              dockTabAvailability,
            ) && (
              <button
                type="button"
                className={`sp-tab${activeTab === "files" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("files")}
                aria-expanded={activeTab === "files"}
              >
                <FileEdit size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabEdits")}</span>
                <span className="sp-tab-file-stats">
                  <span className="sp-stat-add">+{totalAdditions}</span>
                  <span className="sp-stat-mod">-{totalDeletions}</span>
                </span>
              </button>
            )}

            {showPlanTab && isDockTabVisible(
              variant,
              "plan",
              showPlanTab,
              visibleDockTabs,
              dockTabAvailability,
            ) && (
              <button
                type="button"
                className={`sp-tab${activeTab === "plan" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("plan")}
                aria-expanded={activeTab === "plan"}
              >
                <ListTodo size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabPlan")}</span>
                <span className="sp-tab-count">
                  {planCompleted}/{planTotal}
                </span>
                {isProcessing && isPlanMode && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}
          </div>
          <div className="sp-dock-shell">
            <div className="sp-popover-content sp-dock-content">
              {contentNode}
            </div>
          </div>
        </>
      ) : (
        <>
          {openTab && (
            <div className="sp-popover">
              <div className="sp-popover-content">
                {contentNode}
              </div>
            </div>
          )}
          <div className="sp-tabs">
            {isCodexEngine && shouldShowTodoTab && (
              <button
                type="button"
                className={`sp-tab${activeTab === "todo" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("todo")}
              >
                <ListChecks size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabTodos")}</span>
                <span className="sp-tab-count">
                  {codexTaskCompleted}/{codexTaskTotal}
                </span>
                {isProcessing && codexTaskInProgress && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}

            {isCodexEngine && shouldShowSubagentTab && (
              <button
                type="button"
                className={`sp-tab${activeTab === "subagent" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("subagent")}
              >
                <Bot size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabAgents")}</span>
                <span className="sp-tab-count">
                  {subagentCompleted}/{subagentTotal}
                </span>
                {isProcessing && hasRunningSubagent && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}

            {isCodexEngine && (
              <button
                type="button"
                className={`sp-tab${activeTab === "files" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("files")}
                aria-expanded={activeTab === "files"}
              >
                <FileEdit size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabEdits")}</span>
                <span className="sp-tab-file-stats">
                  <span className="sp-stat-add">+{totalAdditions}</span>
                  <span className="sp-stat-mod">-{totalDeletions}</span>
                </span>
              </button>
            )}

            {!isCodexEngine && shouldShowTodoTab && (
              <button
                type="button"
                className={`sp-tab${activeTab === "todo" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("todo")}
              >
                <ListChecks size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabTodos")}</span>
                <span className="sp-tab-count">
                  {todoCompleted}/{todoTotal}
                </span>
                {isProcessing && hasInProgressTodo && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}

            {!isCodexEngine && shouldShowSubagentTab && (
              <button
                type="button"
                className={`sp-tab${activeTab === "subagent" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("subagent")}
              >
                <Bot size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabSubagents")}</span>
                <span className="sp-tab-count">
                  {subagentCompleted}/{subagentTotal}
                </span>
                {isProcessing && hasRunningSubagent && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}

            {!isCodexEngine && (
              <button
                type="button"
                className={`sp-tab${activeTab === "files" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("files")}
                aria-expanded={activeTab === "files"}
              >
                <FileEdit size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabEdits")}</span>
                <span className="sp-tab-file-stats">
                  <span className="sp-stat-add">+{totalAdditions}</span>
                  <span className="sp-stat-mod">-{totalDeletions}</span>
                </span>
              </button>
            )}

            {shouldShowPlanTab && (
              <button
                type="button"
                className={`sp-tab${activeTab === "plan" ? " sp-tab-active" : ""}`}
                onClick={() => handleTabClick("plan")}
                aria-expanded={activeTab === "plan"}
              >
                <ListTodo size={14} className="sp-tab-icon" />
                <span className="sp-tab-label">{t("statusPanel.tabPlan")}</span>
                <span className="sp-tab-count">
                  {planCompleted}/{planTotal}
                </span>
                {isProcessing && isPlanMode && (
                  <span className="sp-tab-loading" />
                )}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
});
