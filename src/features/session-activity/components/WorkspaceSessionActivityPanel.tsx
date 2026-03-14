import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Activity from "lucide-react/dist/esm/icons/activity";
import Bot from "lucide-react/dist/esm/icons/bot";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import FileCode2 from "lucide-react/dist/esm/icons/file-code-2";
import LayoutList from "lucide-react/dist/esm/icons/layout-list";
import ListTodo from "lucide-react/dist/esm/icons/list-todo";
import Search from "lucide-react/dist/esm/icons/search";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import type { ReactNode } from "react";
import { Markdown } from "../../messages/components/Markdown";
import type { SessionActivityEvent, WorkspaceSessionActivityViewModel } from "../types";

type WorkspaceSessionActivityPanelProps = {
  workspaceId: string | null;
  viewModel: WorkspaceSessionActivityViewModel;
  onOpenDiffPath: (
    path: string,
    location?: { line: number; column: number },
    options?: { highlightMarkers?: { added: number[]; modified: number[] } | null },
  ) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  liveEditPreviewEnabled?: boolean;
  onToggleLiveEditPreview?: () => void;
};

type ActivityTab = "all" | "command" | "fileChange" | "task" | "explore" | "reasoning";
type SessionActivityTurnGroup = {
  id: string;
  turnIndex: number | null;
  threadName: string;
  sessionRole: SessionActivityEvent["sessionRole"];
  occurredAt: number;
  events: SessionActivityEvent[];
};

const tabIconMap: Record<ActivityTab, ReactNode> = {
  all: <LayoutList size={14} aria-hidden />,
  command: <Terminal size={14} aria-hidden />,
  fileChange: <FileCode2 size={14} aria-hidden />,
  task: <ListTodo size={14} aria-hidden />,
  explore: <Search size={14} aria-hidden />,
  reasoning: <span className="codicon codicon-thinking session-activity-tab-codicon" aria-hidden />,
};

function formatSignedCount(value: number | undefined, positivePrefix: "+" | "-") {
  if (!value || value <= 0) {
    return null;
  }
  return `${positivePrefix}${value}`;
}

function formatActivityTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function buildHeaderSummary(
  t: ReturnType<typeof useTranslation>["t"],
  timelineCount: number,
  sessionCount: number,
  isProcessing: boolean,
) {
  return [
    t("activityPanel.eventsCount", { count: timelineCount }),
    t("activityPanel.sessionsCount", { count: sessionCount }),
    isProcessing ? t("activityPanel.liveNow") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function canExpandCommand(event: SessionActivityEvent) {
  if (event.kind !== "command") {
    return false;
  }
  return (
    event.status === "running" ||
    Boolean(
    event.commandText ||
      event.commandDescription ||
      event.commandWorkingDirectory ||
      event.commandPreview,
    )
  );
}

function canExpandReasoning(event: SessionActivityEvent) {
  return event.kind === "reasoning" && Boolean(event.reasoningPreview);
}

function looksLikeNavigablePreviewText(preview: string) {
  const normalized = preview.trim();
  if (!normalized || normalized.includes("\n")) {
    return false;
  }
  if (/^[a-z]+:\/\//i.test(normalized)) {
    return true;
  }
  if (
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(normalized)
  ) {
    return true;
  }
  return /\.[A-Za-z0-9]{1,16}$/.test(normalized) && !/\s/.test(normalized);
}

function canExpandExplore(event: SessionActivityEvent) {
  if (event.kind !== "explore" || !event.explorePreview) {
    return false;
  }
  if (event.jumpTarget?.type === "file") {
    return false;
  }
  return !looksLikeNavigablePreviewText(event.explorePreview);
}

function canExpandEvent(event: SessionActivityEvent) {
  return canExpandCommand(event) || canExpandReasoning(event) || canExpandExplore(event);
}

function unwrapShellCommand(command: string) {
  let normalized = command.trim();
  const shellWrapperPattern =
    /^(?:\/\S+\/)?(?:bash|zsh|sh|fish)(?:\.exe)?\s+-lc\s+(?:(['"])([\s\S]+)\1|([\s\S]+))$/i;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const wrapperMatch = normalized.match(shellWrapperPattern);
    if (!wrapperMatch) {
      break;
    }
    normalized = (wrapperMatch[2] ?? wrapperMatch[3] ?? "").trim();
  }
  return normalized;
}

function stripShellPrelude(command: string) {
  let normalized = command.trim();
  const sourcePattern = /^\s*(?:source|\.)\s+~\/\.zshrc\s*(?:&&|;)\s*/i;
  const cdPattern = /^\s*cd\s+[^;&|]+(?:&&|;)\s*/i;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = normalized.replace(sourcePattern, "").replace(cdPattern, "").trim();
    if (next === normalized) {
      break;
    }
    normalized = next;
  }
  return normalized;
}

function normalizeCollapsedCommand(command: string) {
  const unwrapped = unwrapShellCommand(command);
  const stripped = stripShellPrelude(unwrapped);
  return stripped || unwrapped || command.trim();
}

function splitCommandTokens(command: string) {
  const primarySegment = command.split(/\s*(?:&&|\|\||;|\|)\s*/)[0]?.trim() ?? "";
  if (!primarySegment) {
    return [];
  }
  return primarySegment.split(/\s+/).filter(Boolean);
}

function resolvePackageSubcommand(tokens: string[]) {
  const packageRunners = new Set(["pnpm", "npm", "yarn", "bun", "npx"]);
  if (tokens.length === 0 || !packageRunners.has(tokens[0]?.toLowerCase() ?? "")) {
    return "";
  }
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]?.toLowerCase() ?? "";
    if (!token || token.startsWith("-")) {
      continue;
    }
    if (token === "run" && index + 1 < tokens.length) {
      const nextToken = tokens[index + 1]?.toLowerCase() ?? "";
      if (nextToken && !nextToken.startsWith("-")) {
        return nextToken;
      }
      continue;
    }
    return token;
  }
  return "";
}

function resolveCollapsedCommandCategory(
  command: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const tokens = splitCommandTokens(command);
  const primary = tokens[0]?.toLowerCase() ?? "";
  const packageSubcommand = resolvePackageSubcommand(tokens);
  const resolvedRunner = packageSubcommand || primary;

  if (["rg", "grep", "find", "fd", "ag"].includes(primary)) {
    return t("activityPanel.commandCategories.search");
  }
  if (["sed", "cat", "head", "tail", "less", "more", "awk"].includes(primary)) {
    return t("activityPanel.commandCategories.read");
  }
  if (primary === "ls" || primary === "tree") {
    return t("activityPanel.commandCategories.list");
  }
  if (["git", "gh"].includes(primary)) {
    return t("activityPanel.commandCategories.git");
  }
  if (
    ["vitest", "jest", "pytest", "mocha", "ava", "tap", "test"].includes(resolvedRunner) ||
    resolvedRunner.endsWith(":test") ||
    resolvedRunner.endsWith("_test")
  ) {
    return t("activityPanel.commandCategories.test");
  }
  if (
    ["lint", "eslint", "stylelint"].includes(resolvedRunner) ||
    resolvedRunner.endsWith(":lint")
  ) {
    return t("activityPanel.commandCategories.lint");
  }
  if (
    ["build", "tsc", "webpack", "rollup", "vite"].includes(resolvedRunner) ||
    resolvedRunner.endsWith(":build")
  ) {
    return t("activityPanel.commandCategories.build");
  }
  if (["node", "python", "python3", "ruby", "perl", "php", "go", "java"].includes(primary)) {
    return t("activityPanel.commandCategories.run");
  }
  return t("activityPanel.commandCategories.command");
}

function truncateCollapsedCommand(command: string, maxLength = 108) {
  if (command.length <= maxLength) {
    return command;
  }
  return `${command.slice(0, maxLength - 1)}…`;
}

function shouldAutoExpandRunningEvent(
  event: SessionActivityEvent,
  latestRunningReasoningEventId: string | null,
) {
  if (event.status !== "running") {
    return false;
  }
  if (event.kind === "reasoning") {
    return event.eventId === latestRunningReasoningEventId;
  }
  return true;
}

function getCollapsedCommandSummary(
  event: SessionActivityEvent,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (event.kind !== "command") {
    return event.summary;
  }
  const description = event.commandDescription?.trim();
  if (description) {
    return description;
  }
  const commandText = event.commandText?.trim();
  if (commandText) {
    const normalized = normalizeCollapsedCommand(commandText);
    const category = resolveCollapsedCommandCategory(normalized, t);
    const concise = truncateCollapsedCommand(normalized);
    return `${category} · ${concise}`;
  }
  return t("activityPanel.commandPendingSummary");
}

function sortTurnGroupEvents(events: SessionActivityEvent[]) {
  return [...events].sort((left, right) => {
    const leftReasoningPriority = left.kind === "reasoning" ? 0 : 1;
    const rightReasoningPriority = right.kind === "reasoning" ? 0 : 1;
    if (leftReasoningPriority !== rightReasoningPriority) {
      return leftReasoningPriority - rightReasoningPriority;
    }
    if (left.kind === "reasoning" && right.kind === "reasoning") {
      return left.occurredAt - right.occurredAt;
    }
    return right.occurredAt - left.occurredAt;
  });
}

export function WorkspaceSessionActivityPanel({
  workspaceId,
  viewModel,
  onOpenDiffPath,
  onSelectThread,
  liveEditPreviewEnabled = false,
  onToggleLiveEditPreview,
}: WorkspaceSessionActivityPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ActivityTab>("all");
  const [expandedExpandableIds, setExpandedExpandableIds] = useState<Record<string, true>>({});
  const [collapsedTurnGroupIds, setCollapsedTurnGroupIds] = useState<Record<string, true>>({});
  const [manuallyToggledTurnGroupIds, setManuallyToggledTurnGroupIds] = useState<Record<string, true>>(
    {},
  );
  const [manuallyExpandedExpandableIds, setManuallyExpandedExpandableIds] = useState<
    Record<string, true>
  >({});
  const [manuallyCollapsedRunningExpandableIds, setManuallyCollapsedRunningExpandableIds] = useState<
    Record<string, true>
  >({});
  const [completedDelayExpandedExpandableIds, setCompletedDelayExpandedExpandableIds] = useState<
    Record<string, true>
  >({});
  const previousExpandableStatusRef = useRef<Record<string, SessionActivityEvent["status"]>>({});
  const collapseDelayTimerByExpandableIdRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const reasoningPreviewScrollContainerByEventIdRef = useRef<Record<string, HTMLDivElement>>({});

  const emptyCopy = useMemo(() => {
    if (viewModel.emptyState === "running") {
      return t("activityPanel.emptyRunning");
    }
    if (viewModel.emptyState === "completed") {
      return t("activityPanel.emptyCompleted");
    }
    return t("activityPanel.emptyIdle");
  }, [t, viewModel.emptyState]);

  const headerSummary = useMemo(
    () =>
      buildHeaderSummary(
        t,
        activeTab === "all"
          ? viewModel.timeline.length
          : viewModel.timeline.filter((event) => event.kind === activeTab).length,
        viewModel.sessionSummaries.length,
        viewModel.isProcessing,
      ),
    [activeTab, t, viewModel.isProcessing, viewModel.sessionSummaries.length, viewModel.timeline],
  );

  const filteredTimeline = useMemo(() => {
    if (activeTab === "all") {
      return viewModel.timeline;
    }
    return viewModel.timeline.filter((event) => event.kind === activeTab);
  }, [activeTab, viewModel.timeline]);

  const groupedTimeline = useMemo(() => {
    const groupsById = new Map<string, SessionActivityTurnGroup>();
    for (const event of filteredTimeline) {
      const groupId = event.turnId ?? `${event.threadId}:legacy`;
      const groupTurnIndex = typeof event.turnIndex === "number" ? event.turnIndex : null;
      const existing = groupsById.get(groupId);
      if (existing) {
        existing.events.push(event);
        if (event.occurredAt > existing.occurredAt) {
          existing.occurredAt = event.occurredAt;
        }
        continue;
      }
      groupsById.set(groupId, {
        id: groupId,
        turnIndex: groupTurnIndex,
        threadName: event.threadName,
        sessionRole: event.sessionRole,
        occurredAt: event.occurredAt,
        events: [event],
      });
    }
    return Array.from(groupsById.values())
      .map((group) => ({
        ...group,
        events: sortTurnGroupEvents(group.events),
      }))
      .sort((left, right) => right.occurredAt - left.occurredAt);
  }, [filteredTimeline]);

  const tabCounts = useMemo(
    () => ({
      all: viewModel.timeline.length,
      command: viewModel.timeline.filter((event) => event.kind === "command").length,
      fileChange: viewModel.timeline.filter((event) => event.kind === "fileChange").length,
      task: viewModel.timeline.filter((event) => event.kind === "task").length,
      explore: viewModel.timeline.filter((event) => event.kind === "explore").length,
      reasoning: viewModel.timeline.filter((event) => event.kind === "reasoning").length,
    }),
    [viewModel.timeline],
  );

  const tabItems: { id: ActivityTab; label: string }[] = [
    { id: "all", label: t("activityPanel.tabs.all") },
    { id: "command", label: t("activityPanel.tabs.command") },
    { id: "fileChange", label: t("activityPanel.tabs.file") },
    { id: "task", label: t("activityPanel.tabs.task") },
    { id: "explore", label: t("activityPanel.tabs.explore") },
    { id: "reasoning", label: t("activityPanel.tabs.reasoning") },
  ];
  const relatedSessionSummaries = useMemo(
    () => viewModel.sessionSummaries.filter((session) => session.sessionRole === "child"),
    [viewModel.sessionSummaries],
  );
  const latestRunningReasoningEventId = useMemo(() => {
    let latestEvent: SessionActivityEvent | null = null;
    for (const event of viewModel.timeline) {
      if (event.kind !== "reasoning" || event.status !== "running") {
        continue;
      }
      if (!latestEvent || event.occurredAt > latestEvent.occurredAt) {
        latestEvent = event;
      }
    }
    return latestEvent?.eventId ?? null;
  }, [viewModel.timeline]);

  useEffect(() => {
    if (groupedTimeline.length === 0) {
      setCollapsedTurnGroupIds((current) =>
        Object.keys(current).length === 0 ? current : {},
      );
      setManuallyToggledTurnGroupIds((current) =>
        Object.keys(current).length === 0 ? current : {},
      );
      return;
    }
    const latestGroupId = groupedTimeline[0]?.id ?? null;
    setCollapsedTurnGroupIds((current) => {
      const nextCollapsed: Record<string, true> = {};
      for (const group of groupedTimeline) {
        const isLatestGroup = group.id === latestGroupId;
        if (manuallyToggledTurnGroupIds[group.id]) {
          if (current[group.id]) {
            nextCollapsed[group.id] = true;
          }
          continue;
        }
        if (!isLatestGroup) {
          nextCollapsed[group.id] = true;
        }
      }
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextCollapsed);
      if (
        currentKeys.length === nextKeys.length &&
        currentKeys.every((key) => nextCollapsed[key])
      ) {
        return current;
      }
      return nextCollapsed;
    });
    setManuallyToggledTurnGroupIds((current) => {
      const nextEntries = Object.entries(current).filter(([groupId]) =>
        groupedTimeline.some((group) => group.id === groupId),
      );
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [groupedTimeline, manuallyToggledTurnGroupIds]);

  useEffect(() => {
    const nextStatusById: Record<string, SessionActivityEvent["status"]> = {};
    const previousStatusById = previousExpandableStatusRef.current;
    const existingTimers = collapseDelayTimerByExpandableIdRef.current;
    let shouldUpdateCompletedDelayExpanded = false;
    const nextCompletedDelayExpanded: Record<string, true> = { ...completedDelayExpandedExpandableIds };

    for (const event of viewModel.timeline) {
      if (!canExpandEvent(event)) continue;
      nextStatusById[event.eventId] = event.status;
      if (event.status === "running") {
        if (existingTimers[event.eventId]) {
          clearTimeout(existingTimers[event.eventId]);
          delete existingTimers[event.eventId];
        }
        if (nextCompletedDelayExpanded[event.eventId]) {
          delete nextCompletedDelayExpanded[event.eventId];
          shouldUpdateCompletedDelayExpanded = true;
        }
        continue;
      }
      const previousStatus = previousStatusById[event.eventId];
      if (previousStatus !== "running") {
        continue;
      }
      nextCompletedDelayExpanded[event.eventId] = true;
      shouldUpdateCompletedDelayExpanded = true;
      if (existingTimers[event.eventId]) {
        clearTimeout(existingTimers[event.eventId]);
      }
      existingTimers[event.eventId] = setTimeout(() => {
        setCompletedDelayExpandedExpandableIds((current) => {
          if (!current[event.eventId]) {
            return current;
          }
          const next = { ...current };
          delete next[event.eventId];
          return next;
        });
        delete collapseDelayTimerByExpandableIdRef.current[event.eventId];
      }, 1000);
    }

    for (const commandId of Object.keys(nextCompletedDelayExpanded)) {
      if (nextStatusById[commandId]) {
        continue;
      }
      delete nextCompletedDelayExpanded[commandId];
      shouldUpdateCompletedDelayExpanded = true;
      if (existingTimers[commandId]) {
        clearTimeout(existingTimers[commandId]);
        delete existingTimers[commandId];
      }
    }

    if (shouldUpdateCompletedDelayExpanded) {
      setCompletedDelayExpandedExpandableIds(nextCompletedDelayExpanded);
    }
    previousExpandableStatusRef.current = nextStatusById;

    setExpandedExpandableIds((current) => {
      const nextExpanded: Record<string, true> = {};

      for (const event of viewModel.timeline) {
        if (!canExpandEvent(event)) continue;
        if (shouldAutoExpandRunningEvent(event, latestRunningReasoningEventId)) {
          if (!manuallyCollapsedRunningExpandableIds[event.eventId]) {
            nextExpanded[event.eventId] = true;
          }
          continue;
        }
        if (completedDelayExpandedExpandableIds[event.eventId]) {
          nextExpanded[event.eventId] = true;
          continue;
        }
        if (manuallyExpandedExpandableIds[event.eventId]) {
          nextExpanded[event.eventId] = true;
        }
      }

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextExpanded);
      if (
        currentKeys.length === nextKeys.length &&
        currentKeys.every((key) => nextExpanded[key])
      ) {
        return current;
      }
      return nextExpanded;
    });
    setManuallyExpandedExpandableIds((current) => {
      const nextEntries = Object.entries(current).filter(([eventId]) =>
        viewModel.timeline.some(
          (event) =>
            event.eventId === eventId &&
            canExpandEvent(event) &&
            event.status !== "running",
        ),
      );
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
    setManuallyCollapsedRunningExpandableIds((current) => {
      const nextEntries = Object.entries(current).filter(([eventId]) =>
        viewModel.timeline.some(
          (event) =>
            event.eventId === eventId &&
            canExpandEvent(event) &&
            shouldAutoExpandRunningEvent(event, latestRunningReasoningEventId),
        ),
      );
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [
    completedDelayExpandedExpandableIds,
    latestRunningReasoningEventId,
    manuallyCollapsedRunningExpandableIds,
    manuallyExpandedExpandableIds,
    viewModel.timeline,
  ]);

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(collapseDelayTimerByExpandableIdRef.current)) {
        clearTimeout(timeoutId);
      }
      collapseDelayTimerByExpandableIdRef.current = {};
    };
  }, []);

  useLayoutEffect(() => {
    const activeReasoningIds = new Set(
      viewModel.timeline
        .filter(
          (event) =>
            event.kind === "reasoning" &&
            event.status === "running" &&
            Boolean(expandedExpandableIds[event.eventId]),
        )
        .map((event) => event.eventId),
    );
    for (const [eventId, container] of Object.entries(
      reasoningPreviewScrollContainerByEventIdRef.current,
    )) {
      if (!activeReasoningIds.has(eventId)) {
        continue;
      }
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [expandedExpandableIds, viewModel.timeline]);

  if (!workspaceId) {
    return (
      <div className="session-activity-panel">
        <div className="session-activity-empty">{t("activityPanel.selectWorkspace")}</div>
      </div>
    );
  }

  const handleToggleExpand = (
    eventId: string,
    options?: { isRunning?: boolean },
  ) => {
    const isRunning = options?.isRunning ?? false;
    const isCurrentlyExpanded = Boolean(expandedExpandableIds[eventId]);
    setExpandedExpandableIds((current) => {
      if (current[eventId]) {
        const next = { ...current };
        delete next[eventId];
        return next;
      }
      return { ...current, [eventId]: true };
    });
    if (isRunning) {
      setManuallyCollapsedRunningExpandableIds((current) => {
        if (isCurrentlyExpanded) {
          return { ...current, [eventId]: true };
        }
        if (!current[eventId]) {
          return current;
        }
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      setManuallyExpandedExpandableIds((current) => {
        if (!current[eventId]) {
          return current;
        }
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      return;
    }
    if (isCurrentlyExpanded) {
      setCompletedDelayExpandedExpandableIds((current) => {
        if (!current[eventId]) {
          return current;
        }
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      const timeoutId = collapseDelayTimerByExpandableIdRef.current[eventId];
      if (timeoutId) {
        clearTimeout(timeoutId);
        delete collapseDelayTimerByExpandableIdRef.current[eventId];
      }
    }
    setManuallyExpandedExpandableIds((current) => {
      if (isCurrentlyExpanded) {
        if (!current[eventId]) {
          return current;
        }
        const next = { ...current };
        delete next[eventId];
        return next;
      }
      return { ...current, [eventId]: true };
    });
  };

  const handleCardPrimaryAction = (
    event: WorkspaceSessionActivityViewModel["timeline"][number],
  ) => {
    const isRunning = event.status === "running";
    if (canExpandEvent(event)) {
      handleToggleExpand(event.eventId, { isRunning });
      return;
    }
    if (!workspaceId || !event.jumpTarget) {
      return;
    }
    if (event.jumpTarget.type === "file") {
      const markers = event.jumpTarget.markers;
      const hasHighlightMarkers = Boolean(
        markers && (markers.added.length > 0 || markers.modified.length > 0),
      );
      onOpenDiffPath(
        event.jumpTarget.path,
        event.jumpTarget.line
          ? { line: event.jumpTarget.line, column: 1 }
          : undefined,
        hasHighlightMarkers
          ? { highlightMarkers: markers }
          : undefined,
      );
      return;
    }
    if (event.jumpTarget.type === "diff") {
      onOpenDiffPath(event.jumpTarget.path);
      return;
    }
    onSelectThread(workspaceId, event.jumpTarget.threadId);
  };

  const handleToggleTurnGroup = (groupId: string) => {
    setCollapsedTurnGroupIds((current) => {
      if (current[groupId]) {
        const next = { ...current };
        delete next[groupId];
        return next;
      }
      return { ...current, [groupId]: true };
    });
    setManuallyToggledTurnGroupIds((current) => ({ ...current, [groupId]: true }));
  };

  const renderTimelineEvent = (event: SessionActivityEvent) => {
    const isExpanded = Boolean(expandedExpandableIds[event.eventId]);
    const isRunning = event.status === "running";
    const signedAdditions = formatSignedCount(event.additions, "+");
    const signedDeletions = formatSignedCount(event.deletions, "-");
    const showThreadChip = event.sessionRole === "child";
    const isExpandable = canExpandEvent(event);
    const collapsedSummary = getCollapsedCommandSummary(event, t);
    const displaySummary =
      event.kind === "reasoning" ? t("messages.thinkingLabel") : collapsedSummary;
    const cardMainAriaLabel =
      event.kind === "reasoning"
        ? event.summary || displaySummary
        : undefined;
    return (
      <article
        key={event.eventId}
        className={`session-activity-event session-activity-event-${event.kind}${
          isExpanded ? " is-expanded" : ""
        }${isRunning ? " is-live" : ""}`}
      >
        <div className="session-activity-rail" aria-hidden>
          <span className={`session-activity-kind session-activity-kind-${event.kind}`}>
            {event.kind === "command" ? (
              <Terminal size={13} />
            ) : event.kind === "task" ? (
              <ListTodo size={13} />
            ) : event.kind === "explore" ? (
              <Search size={13} />
            ) : event.kind === "reasoning" ? (
              <span className="codicon codicon-thinking session-activity-kind-codicon" />
            ) : (
              <FileCode2 size={13} />
            )}
          </span>
        </div>

        <div className="session-activity-card">
          <div className="session-activity-card-top">
            <button
              type="button"
              className="session-activity-card-main"
              onClick={() => handleCardPrimaryAction(event)}
              aria-label={cardMainAriaLabel}
              title={cardMainAriaLabel}
            >
              <span className="session-activity-card-copy">
                <span className="session-activity-card-title">{displaySummary}</span>
                <span className="session-activity-card-meta">
                  <time
                    className="session-activity-card-time"
                    dateTime={new Date(event.occurredAt).toISOString()}
                  >
                    {formatActivityTime(event.occurredAt)}
                  </time>
                  <span className={`session-activity-chip is-status-${event.status}`}>
                    {t(`activityPanel.status.${event.status}`)}
                  </span>
                  {showThreadChip ? (
                    <span
                      className="session-activity-chip"
                      title={event.threadName}
                    >
                      {event.threadName}
                    </span>
                  ) : null}
                  {event.relationshipSource === "fallbackLinking" ? (
                    <span className="session-activity-chip is-fallback">
                      {t("activityPanel.fallbackLinking")}
                    </span>
                  ) : null}
                </span>
              </span>

              {event.kind === "fileChange" && (signedAdditions || signedDeletions) ? (
                <span className="session-activity-file-stats">
                  {signedAdditions ? <span className="is-add">{signedAdditions}</span> : null}
                  {signedDeletions ? <span className="is-del">{signedDeletions}</span> : null}
                </span>
              ) : null}
            </button>

            {isExpandable ? (
              <button
                type="button"
                className="session-activity-preview-toggle"
                onClick={(toggleEvent) => {
                  toggleEvent.stopPropagation();
                  handleToggleExpand(event.eventId, { isRunning });
                }}
                aria-label={
                  isExpanded
                    ? t("activityPanel.hideOutput")
                    : t("activityPanel.showOutput")
                }
                title={
                  isExpanded
                    ? t("activityPanel.hideOutput")
                    : t("activityPanel.showOutput")
                }
              >
                {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            ) : null}
          </div>

          {isExpandable && isExpanded ? (
            <div className="session-activity-preview">
              {event.kind === "command" ? (
                <div className="session-activity-command-detail">
                  {event.commandText ? (
                    <div className="session-activity-command-row">
                      <span className="session-activity-command-label">
                        {t("activityPanel.command")}
                      </span>
                      <code className="session-activity-command-value">{event.commandText}</code>
                    </div>
                  ) : null}
                  {event.commandWorkingDirectory ? (
                    <div className="session-activity-command-row">
                      <span className="session-activity-command-label">
                        {t("activityPanel.cwd")}
                      </span>
                      <code className="session-activity-command-value">
                        {event.commandWorkingDirectory}
                      </code>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {event.kind === "reasoning" ? (
                <div
                  className="session-activity-preview-text is-markdown"
                  ref={(node) => {
                    if (!node) {
                      delete reasoningPreviewScrollContainerByEventIdRef.current[event.eventId];
                      return;
                    }
                    reasoningPreviewScrollContainerByEventIdRef.current[event.eventId] = node;
                  }}
                >
                  <div className="session-activity-reasoning-surface">
                    <Markdown
                      value={event.reasoningPreview || t("activityPanel.waitingForReasoning")}
                      className={`markdown reasoning-markdown session-activity-preview-markdown${
                        event.status === "running" ? " markdown-live-streaming" : ""
                      }`}
                      codeBlockStyle="message"
                      streamingThrottleMs={event.status === "running" ? 220 : 80}
                      softBreaks
                    />
                  </div>
                </div>
              ) : (
                <pre className="session-activity-preview-text">
                  {event.kind === "explore"
                    ? event.explorePreview || t("activityPanel.waitingForOutput")
                    : event.commandPreview || t("activityPanel.waitingForOutput")}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      </article>
    );
  };

  return (
    <div className="session-activity-panel">
      <div className="session-activity-header">
        <div className="session-activity-title-group">
          <div className="session-activity-heading-row">
            <div
              className={`session-activity-title-row${viewModel.isProcessing ? " is-live" : ""}`}
            >
              <Activity size={15} aria-hidden />
              <span>{t("activityPanel.title")}</span>
            </div>
            {onToggleLiveEditPreview ? (
              <button
                type="button"
                className={`session-activity-live-edit-toggle${
                  liveEditPreviewEnabled ? " is-active" : ""
                }`}
                aria-pressed={liveEditPreviewEnabled}
                aria-label={t("activityPanel.liveEditPreview")}
                onClick={onToggleLiveEditPreview}
                title={t(
                  liveEditPreviewEnabled
                    ? "activityPanel.disableLiveEditPreview"
                    : "activityPanel.enableLiveEditPreview",
                )}
              >
                <Bot size={15} aria-hidden />
              </button>
            ) : null}
          </div>
          {viewModel.timeline.length > 0 ? (
            <div
              className="session-activity-tabs"
              role="tablist"
              aria-label={t("activityPanel.tabs.ariaLabel")}
            >
              {tabItems.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`session-activity-tab${activeTab === tab.id ? " is-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="session-activity-tab-icon">{tabIconMap[tab.id]}</span>
                  <span className="session-activity-tab-label">{tab.label}</span>
                  <span className="session-activity-tab-count">{tabCounts[tab.id]}</span>
                </button>
              ))}
              {relatedSessionSummaries.length > 0 ? (
                <div
                  className="session-activity-related-inline"
                  role="group"
                  aria-label={t("activityPanel.relatedSessions")}
                >
                  <span className="session-activity-related-label">
                    {t("activityPanel.relatedSessions")}
                  </span>
                  {relatedSessionSummaries.map((session) => (
                    <button
                      key={session.threadId}
                      type="button"
                      className={`session-activity-session-pill${session.isProcessing ? " is-processing" : ""}`}
                      onClick={() => onSelectThread(workspaceId, session.threadId)}
                      title={session.threadName}
                    >
                      <span className="session-activity-session-name">{session.threadName}</span>
                      {session.relationshipSource === "fallbackLinking" ? (
                        <span className="session-activity-session-meta">
                          {t("activityPanel.fallbackLinking")}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="session-activity-summary">{headerSummary}</div>
      </div>

      {filteredTimeline.length === 0 ? (
        <div className="session-activity-empty">{emptyCopy}</div>
      ) : (
        <div className="session-activity-timeline">
          {groupedTimeline.map((group) => (
            <section key={group.id} className="session-activity-turn-group">
              <button
                type="button"
                className="session-activity-turn-group-header"
                onClick={() => handleToggleTurnGroup(group.id)}
                aria-expanded={!collapsedTurnGroupIds[group.id]}
                aria-label={
                  collapsedTurnGroupIds[group.id]
                    ? t("activityPanel.expandTurnGroup")
                    : t("activityPanel.collapseTurnGroup")
                }
              >
                <span className="session-activity-turn-group-title">
                  {group.turnIndex
                    ? t("activityPanel.turnGroup", { index: group.turnIndex })
                    : t("activityPanel.turnGroupFallback")}
                </span>
                <span className="session-activity-turn-group-header-tail">
                  {group.sessionRole === "child" ? (
                    <span className="session-activity-turn-group-meta" title={group.threadName}>
                      {group.threadName}
                    </span>
                  ) : null}
                  <span className="session-activity-turn-group-toggle" aria-hidden>
                    {collapsedTurnGroupIds[group.id] ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                  </span>
                </span>
              </button>
              {!collapsedTurnGroupIds[group.id] ? (
                <div className="session-activity-turn-group-events">
                  {group.events.map((event) => renderTimelineEvent(event))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
