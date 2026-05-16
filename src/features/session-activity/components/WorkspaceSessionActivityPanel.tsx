import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import Bot from "lucide-react/dist/esm/icons/bot";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import FileCode2 from "lucide-react/dist/esm/icons/file-code-2";
import GitCompareArrows from "lucide-react/dist/esm/icons/git-compare-arrows";
import LayoutList from "lucide-react/dist/esm/icons/layout-list";
import ListTodo from "lucide-react/dist/esm/icons/list-todo";
import Search from "lucide-react/dist/esm/icons/search";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import X from "lucide-react/dist/esm/icons/x";
import type { CSSProperties, ReactNode } from "react";
import FileIcon from "../../../components/FileIcon";
import { resolveWorkspaceRelativePath } from "../../../utils/workspacePaths";
import { WorkspaceEditableDiffReviewSurface } from "../../git/components/WorkspaceEditableDiffReviewSurface";
import type { CodeAnnotationBridgeProps } from "../../code-annotations/types";
import { Markdown } from "../../messages/components/Markdown";
import {
  inferCommandOutputRenderMeta,
  normalizeCommandMarkdownOutput,
  renderCodeOutputHtml,
  renderShellOutputHtml,
} from "../utils/shellOutputHighlight";
import type {
  SessionActivityEvent,
  SessionActivityFileChangeEntry,
  SessionActivitySessionSummary,
  WorkspaceSessionActivityViewModel,
} from "../types";

type WorkspaceSessionActivityPanelProps = CodeAnnotationBridgeProps & {
  workspaceId: string | null;
  workspacePath?: string | null;
  viewModel: WorkspaceSessionActivityViewModel;
  onOpenDiffPath: (
    path: string,
    location?: { line: number; column: number },
    options?: { highlightMarkers?: { added: number[]; modified: number[] } | null },
  ) => void;
  onEnsureEditorFileMaximized?: () => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  liveEditPreviewEnabled?: boolean;
  onToggleLiveEditPreview?: () => void | Promise<void>;
  onRefreshGitStatus?: (() => void) | null;
};

type ActivityTab =
  | "all"
  | "command"
  | "fileChange"
  | "task"
  | "subagent"
  | "explore"
  | "reasoning";
type SessionActivityTurnGroup = {
  id: string;
  threadId: string;
  turnIndex: number | null;
  threadName: string;
  sessionRole: SessionActivityEvent["sessionRole"];
  occurredAt: number;
  events: SessionActivityEvent[];
};
type StickyChildSessionSummary = SessionActivitySessionSummary & {
  lastSeenAt: number;
};
type FollowNudgeContext = {
  turnKey: string;
  eventId: string;
};
type FollowBubbleGeometry = {
  top: number;
  left: number;
  width: number;
  arrowLeft: number;
};

const RUNNING_CARD_MIN_EXPANDED_MS = 2000;
const FOLLOW_BUBBLE_AUTO_DISMISS_MS = 1000;
const MAX_STICKY_CHILD_SESSION_COUNT = 24;
const SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY =
  "ccgui.sessionActivity.soloFollowCoachDismissedByWorkspace";
const SOLO_FOLLOW_DISCOVERY_COACH_FLAG_KEY = "ccgui.flags.soloFollow.discovery.coachmark";
const SOLO_FOLLOW_DISCOVERY_NUDGE_FLAG_KEY = "ccgui.flags.soloFollow.discovery.nudge";
const SESSION_PILL_COLOR_PALETTE = [
  { hue: 158, saturation: 66, lightness: 44 },
  { hue: 210, saturation: 72, lightness: 48 },
  { hue: 258, saturation: 68, lightness: 56 },
  { hue: 24, saturation: 88, lightness: 56 },
  { hue: 338, saturation: 76, lightness: 55 },
  { hue: 186, saturation: 70, lightness: 46 },
] as const;

const tabIconMap: Record<ActivityTab, ReactNode> = {
  all: <LayoutList size={14} aria-hidden />,
  command: <Terminal size={14} aria-hidden />,
  fileChange: <FileCode2 size={14} aria-hidden />,
  task: <ListTodo size={14} aria-hidden />,
  subagent: <Bot size={14} aria-hidden />,
  explore: <Search size={14} aria-hidden />,
  reasoning: <span className="codicon codicon-thinking session-activity-tab-codicon" aria-hidden />,
};

function readSoloFollowCoachDismissedByWorkspace() {
  if (typeof window === "undefined" || !window.localStorage) {
    return {} as Record<string, number>;
  }
  try {
    const raw = window.localStorage.getItem(
      SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY,
    );
    if (!raw) {
      return {} as Record<string, number>;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {} as Record<string, number>;
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([workspaceId, value]) =>
          typeof workspaceId === "string" &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value > 0,
      ),
    ) as Record<string, number>;
  } catch {
    return {} as Record<string, number>;
  }
}

function readSoloFollowFeatureFlag(flagKey: string, defaultValue = true) {
  if (typeof window === "undefined" || !window.localStorage) {
    return defaultValue;
  }
  try {
    const raw = window.localStorage.getItem(flagKey);
    if (typeof raw !== "string" || raw.trim() === "") {
      return defaultValue;
    }
    const normalized = raw.trim().toLowerCase();
    if (["0", "false", "off", "disabled", "no"].includes(normalized)) {
      return false;
    }
    if (["1", "true", "on", "enabled", "yes"].includes(normalized)) {
      return true;
    }
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeSoloFollowCoachDismissedByWorkspace(nextMap: Record<string, number>) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY,
      JSON.stringify(nextMap),
    );
  } catch {
    // ignore localStorage failures
  }
}

function resolveFollowNudgeTurnKey(event: SessionActivityEvent) {
  if (event.turnId?.trim()) {
    return event.turnId.trim();
  }
  if (typeof event.turnIndex === "number") {
    return `${event.threadId}:turn-index:${event.turnIndex}`;
  }
  return `${event.threadId}:event:${event.eventId}`;
}

function emitSoloFollowMetric(
  name: string,
  payload: { workspaceId: string; threadId: string | null; turnKey?: string } | undefined,
) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.dispatchEvent(
      new CustomEvent("ccgui:solo-follow-metric", {
        detail: {
          name,
          ...(payload ?? {}),
        },
      }),
    );
  } catch {
    // swallow metric dispatch failures
  }
}

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

function isPlaceholderCommandText(value: string | undefined) {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[：:。.!！?？]/g, "");
  return normalized === "command" || normalized === "命令";
}

function canExpandReasoning(event: SessionActivityEvent) {
  return event.kind === "reasoning" && Boolean(event.reasoningPreview);
}

function canExpandTask(event: SessionActivityEvent) {
  return event.kind === "task" && Boolean(event.explorePreview);
}

function canExpandExplore(event: SessionActivityEvent) {
  if (event.kind !== "explore" || !event.explorePreview) {
    return false;
  }
  if (event.jumpTarget?.type === "file") {
    return false;
  }
  return true;
}

function canExpandEvent(event: SessionActivityEvent) {
  return (
    canExpandCommand(event) ||
    canExpandReasoning(event) ||
    canExpandTask(event) ||
    canExpandExplore(event)
  );
}

function unwrapShellCommand(command: string) {
  let normalized = command.trim();
  const shellLaunchers = new Set([
    "bash",
    "zsh",
    "sh",
    "fish",
    "bash.exe",
    "zsh.exe",
    "sh.exe",
    "fish.exe",
  ]);
  const shellWrapperPattern = /^(.+?)\s+-lc\s+([\s\S]+)$/i;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const wrapperMatch = normalized.match(shellWrapperPattern);
    if (!wrapperMatch) {
      break;
    }
    const launcherRaw = (wrapperMatch[1] ?? "").trim();
    const payloadRaw = (wrapperMatch[2] ?? "").trim();
    const launcherUnquoted = launcherRaw.replace(/^['"]|['"]$/g, "");
    const launcherBase = launcherUnquoted.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    if (!shellLaunchers.has(launcherBase)) {
      break;
    }
    const payloadMatch = payloadRaw.match(/^(["'])([\s\S]*)\1$/);
    const payload = (payloadMatch ? payloadMatch[2] : payloadRaw)
      .replace(/\\{2,}(?=["'])/g, "\\")
      .trim();
    normalized = payload;
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

  if (["rg", "grep", "ripgrep", "findstr", "ag", "ack"].includes(primary)) {
    return t("activityPanel.commandCategories.search");
  }
  if (["sed", "cat", "head", "tail", "less", "more", "awk", "nl", "wc", "bat"].includes(primary)) {
    return t("activityPanel.commandCategories.read");
  }
  if (["ls", "tree", "find", "fd", "dir"].includes(primary)) {
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

function extractAgentNumber(value: string) {
  const agentMatch = value.match(/\bagent\s*([0-9]{1,4})\b/i);
  if (!agentMatch?.[1]) {
    return null;
  }
  return agentMatch[1];
}

function resolveChildSessionPillLabel(
  session: SessionActivitySessionSummary,
  index: number,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const fromName = extractAgentNumber(session.threadName);
  if (fromName) {
    return `Agent ${fromName}`;
  }
  const fromThreadId = extractAgentNumber(session.threadId);
  if (fromThreadId) {
    return `Agent ${fromThreadId}`;
  }
  return `${t("activityPanel.childSession")} ${index + 1}`;
}

function resolveStringHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function resolveSessionPillStyle(
  session: SessionActivitySessionSummary,
  index: number,
): CSSProperties & Record<string, string> {
  const hashSeed = resolveStringHash(`${session.threadId}:${session.threadName}:${index}`);
  const paletteEntry =
    SESSION_PILL_COLOR_PALETTE[hashSeed % SESSION_PILL_COLOR_PALETTE.length] ??
    SESSION_PILL_COLOR_PALETTE[0];
  return {
    "--session-pill-accent-h": `${paletteEntry?.hue ?? 214}`,
    "--session-pill-accent-s": `${paletteEntry?.saturation ?? 72}%`,
    "--session-pill-accent-l": `${paletteEntry?.lightness ?? 54}%`,
  };
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
  workspacePath = null,
  viewModel,
  onOpenDiffPath,
  onEnsureEditorFileMaximized,
  onSelectThread,
  liveEditPreviewEnabled = false,
  onToggleLiveEditPreview,
  onRefreshGitStatus = null,
  onCreateCodeAnnotation,
  onRemoveCodeAnnotation,
  codeAnnotations,
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
  const runningExpandedStartedAtByExpandableIdRef = useRef<Record<string, number>>({});
  const collapseDelayTimerByExpandableIdRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const reasoningPreviewScrollContainerByEventIdRef = useRef<Record<string, HTMLDivElement>>({});
  const activityScopeRef = useRef<string | null>(null);
  const followNudgeScopeRef = useRef<string | null>(null);
  const followNudgePresentedTurnKeysRef = useRef<Record<string, true>>({});
  const followNudgeDismissedTurnKeysRef = useRef<Record<string, true>>({});
  const followEntryExposureScopeRef = useRef<string | null>(null);
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const panelHeaderRef = useRef<HTMLDivElement | null>(null);
  const liveEditToggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const [stickyChildSessionSummariesByThreadId, setStickyChildSessionSummariesByThreadId] = useState<
    Record<string, StickyChildSessionSummary>
  >({});
  const [showFollowCoach, setShowFollowCoach] = useState(false);
  const [followNudgeContext, setFollowNudgeContext] = useState<FollowNudgeContext | null>(null);
  const [followNudgeError, setFollowNudgeError] = useState<string | null>(null);
  const [followBubbleGeometry, setFollowBubbleGeometry] = useState<FollowBubbleGeometry | null>(
    null,
  );
  const [selectedDiffPreviewEntry, setSelectedDiffPreviewEntry] =
    useState<SessionActivityFileChangeEntry | null>(null);
  const [isDiffPreviewMaximized, setIsDiffPreviewMaximized] = useState(false);
  const [diffPreviewStyle, setDiffPreviewStyle] = useState<"split" | "unified">("split");
  const [diffPreviewHeaderControlsTarget, setDiffPreviewHeaderControlsTarget] =
    useState<HTMLDivElement | null>(null);
  const selectedDiffPreviewGitPath = selectedDiffPreviewEntry
    ? resolveWorkspaceRelativePath(workspacePath, selectedDiffPreviewEntry.filePath)
    : null;
  const soloFollowDiscoveryFlags = useMemo(
    () => ({
      coach: readSoloFollowFeatureFlag(SOLO_FOLLOW_DISCOVERY_COACH_FLAG_KEY, true),
      nudge: readSoloFollowFeatureFlag(SOLO_FOLLOW_DISCOVERY_NUDGE_FLAG_KEY, true),
    }),
    [],
  );

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
        threadId: event.threadId,
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
      subagent: viewModel.timeline.filter((event) => event.kind === "subagent").length,
      explore: viewModel.timeline.filter((event) => event.kind === "explore").length,
      reasoning: viewModel.timeline.filter((event) => event.kind === "reasoning").length,
    }),
    [viewModel.timeline],
  );

  const visibleTabItems = useMemo(() => {
    const tabItems: { id: ActivityTab; label: string }[] = [
      { id: "all", label: t("activityPanel.tabs.all") },
      { id: "command", label: t("activityPanel.tabs.command") },
      { id: "fileChange", label: t("activityPanel.tabs.file") },
      { id: "task", label: t("activityPanel.tabs.task") },
      { id: "subagent", label: t("activityPanel.tabs.subagent") },
      { id: "explore", label: t("activityPanel.tabs.explore") },
      { id: "reasoning", label: t("activityPanel.tabs.reasoning") },
    ];
    return tabItems.filter((tab) => tabCounts[tab.id] > 0);
  }, [tabCounts, t]);
  const relatedSessionSummaries = useMemo(
    () => viewModel.sessionSummaries.filter((session) => session.sessionRole === "child"),
    [viewModel.sessionSummaries],
  );
  const stickyChildSessionSummaries = useMemo(() => {
    const mergedByThreadId = new Map<string, StickyChildSessionSummary>(
      Object.values(stickyChildSessionSummariesByThreadId).map((session) => [
        session.threadId,
        session,
      ]),
    );
    for (const session of relatedSessionSummaries) {
      const existing = mergedByThreadId.get(session.threadId);
      mergedByThreadId.set(session.threadId, {
        ...session,
        lastSeenAt: existing?.lastSeenAt ?? 0,
      });
    }
    return Array.from(mergedByThreadId.values()).sort((left, right) => {
      if (left.isProcessing !== right.isProcessing) {
        return left.isProcessing ? -1 : 1;
      }
      if (left.lastSeenAt !== right.lastSeenAt) {
        return right.lastSeenAt - left.lastSeenAt;
      }
      return right.eventCount - left.eventCount;
    });
  }, [relatedSessionSummaries, stickyChildSessionSummariesByThreadId]);

  const childSessionStyleByThreadId = useMemo(() => {
    const styleMap = new Map<string, CSSProperties & Record<string, string>>();
    stickyChildSessionSummaries.forEach((session, index) => {
      styleMap.set(session.threadId, resolveSessionPillStyle(session, index));
    });
    return styleMap;
  }, [stickyChildSessionSummaries]);
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
  const latestCompletedFileChangeEvent = useMemo(
    () =>
      viewModel.timeline.find(
        (event) => event.kind === "fileChange" && event.status === "completed",
      ) ?? null,
    [viewModel.timeline],
  );

  useEffect(() => {
    if (tabCounts[activeTab] > 0) {
      return;
    }
    setActiveTab("all");
  }, [activeTab, tabCounts]);

  useEffect(() => {
    const scope = `${workspaceId ?? "__none__"}:${viewModel.rootThreadId ?? "__none__"}`;
    if (activityScopeRef.current === scope) {
      return;
    }
    activityScopeRef.current = scope;
    setStickyChildSessionSummariesByThreadId({});
  }, [workspaceId, viewModel.rootThreadId]);

  useEffect(() => {
    const followScope = `${workspaceId ?? "__none__"}:${viewModel.rootThreadId ?? "__none__"}`;
    if (followNudgeScopeRef.current === followScope) {
      return;
    }
    followNudgeScopeRef.current = followScope;
    followNudgePresentedTurnKeysRef.current = {};
    followNudgeDismissedTurnKeysRef.current = {};
    setFollowNudgeContext(null);
    setFollowNudgeError(null);
  }, [workspaceId, viewModel.rootThreadId]);

  useEffect(() => {
    if (!workspaceId || !onToggleLiveEditPreview || !soloFollowDiscoveryFlags.coach) {
      setShowFollowCoach(false);
      return;
    }
    if (liveEditPreviewEnabled) {
      setShowFollowCoach(false);
      return;
    }
    const dismissedMap = readSoloFollowCoachDismissedByWorkspace();
    setShowFollowCoach(!dismissedMap[workspaceId]);
  }, [liveEditPreviewEnabled, onToggleLiveEditPreview, soloFollowDiscoveryFlags.coach, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !onToggleLiveEditPreview) {
      return;
    }
    const scope = `${workspaceId}:${viewModel.rootThreadId ?? "__none__"}`;
    if (followEntryExposureScopeRef.current === scope) {
      return;
    }
    followEntryExposureScopeRef.current = scope;
    emitSoloFollowMetric("solo_entry_exposed", {
      workspaceId,
      threadId: viewModel.rootThreadId,
    });
  }, [onToggleLiveEditPreview, viewModel.rootThreadId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !onToggleLiveEditPreview || !soloFollowDiscoveryFlags.nudge) {
      setFollowNudgeContext(null);
      return;
    }
    if (liveEditPreviewEnabled) {
      setFollowNudgeContext(null);
      return;
    }
    if (!latestCompletedFileChangeEvent) {
      return;
    }
    const turnKey = resolveFollowNudgeTurnKey(latestCompletedFileChangeEvent);
    if (followNudgeDismissedTurnKeysRef.current[turnKey]) {
      return;
    }
    if (followNudgePresentedTurnKeysRef.current[turnKey]) {
      return;
    }
    followNudgePresentedTurnKeysRef.current[turnKey] = true;
    setFollowNudgeContext({
      turnKey,
      eventId: latestCompletedFileChangeEvent.eventId,
    });
    setFollowNudgeError(null);
    emitSoloFollowMetric("solo_nudge_shown", {
      workspaceId,
      threadId: viewModel.rootThreadId,
      turnKey,
    });
  }, [
    latestCompletedFileChangeEvent,
    liveEditPreviewEnabled,
    onToggleLiveEditPreview,
    soloFollowDiscoveryFlags.nudge,
    viewModel.rootThreadId,
    workspaceId,
  ]);

  useEffect(() => {
    if (relatedSessionSummaries.length === 0) {
      return;
    }
    setStickyChildSessionSummariesByThreadId((current) => {
      let changed = false;
      const next: Record<string, StickyChildSessionSummary> = { ...current };
      for (let index = 0; index < relatedSessionSummaries.length; index += 1) {
        const session = relatedSessionSummaries[index];
        if (!session) {
          continue;
        }
        const existing = current[session.threadId];
        const candidate: StickyChildSessionSummary = {
          ...session,
          lastSeenAt: existing?.lastSeenAt ?? Date.now() + index,
        };
        if (
          !existing ||
          existing.threadName !== candidate.threadName ||
          existing.relationshipSource !== candidate.relationshipSource ||
          existing.eventCount !== candidate.eventCount ||
          existing.isProcessing !== candidate.isProcessing
        ) {
          next[session.threadId] = candidate;
          changed = true;
        }
      }

      const sorted = Object.values(next).sort((left, right) => right.lastSeenAt - left.lastSeenAt);
      if (sorted.length > MAX_STICKY_CHILD_SESSION_COUNT) {
        for (const stale of sorted.slice(MAX_STICKY_CHILD_SESSION_COUNT)) {
          delete next[stale.threadId];
        }
        changed = true;
      }

      return changed ? next : current;
    });
  }, [relatedSessionSummaries]);

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
    const runningExpandedStartedAtById = runningExpandedStartedAtByExpandableIdRef.current;
    const now = Date.now();
    let shouldUpdateCompletedDelayExpanded = false;
    const nextCompletedDelayExpanded: Record<string, true> = { ...completedDelayExpandedExpandableIds };

    for (const event of viewModel.timeline) {
      if (!canExpandEvent(event)) continue;
      nextStatusById[event.eventId] = event.status;
      if (event.status === "running") {
        if (!runningExpandedStartedAtById[event.eventId]) {
          runningExpandedStartedAtById[event.eventId] = now;
        }
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
      const runningExpandedStartedAt = runningExpandedStartedAtById[event.eventId] ?? now;
      const elapsedMs = Math.max(0, now - runningExpandedStartedAt);
      const collapseDelayMs = Math.max(0, RUNNING_CARD_MIN_EXPANDED_MS - elapsedMs);
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
        delete runningExpandedStartedAtByExpandableIdRef.current[event.eventId];
        delete collapseDelayTimerByExpandableIdRef.current[event.eventId];
      }, collapseDelayMs);
    }

    for (const commandId of Object.keys(nextCompletedDelayExpanded)) {
      if (nextStatusById[commandId]) {
        continue;
      }
      delete nextCompletedDelayExpanded[commandId];
      shouldUpdateCompletedDelayExpanded = true;
      delete runningExpandedStartedAtById[commandId];
      if (existingTimers[commandId]) {
        clearTimeout(existingTimers[commandId]);
        delete existingTimers[commandId];
      }
    }
    for (const eventId of Object.keys(runningExpandedStartedAtById)) {
      if (nextStatusById[eventId]) {
        continue;
      }
      delete runningExpandedStartedAtById[eventId];
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
      openActivityFile({
        filePath: event.jumpTarget.path,
        fileName: event.filePath ?? event.jumpTarget.path,
        statusLetter: event.fileChangeStatusLetter ?? "M",
        additions: event.additions ?? 0,
        deletions: event.deletions ?? 0,
        line: event.jumpTarget.line,
        markers: event.jumpTarget.markers,
      });
      return;
    }
    if (event.jumpTarget.type === "diff") {
      onOpenDiffPath(event.jumpTarget.path);
      return;
    }
    onSelectThread(workspaceId, event.jumpTarget.threadId);
  };

  const openActivityFile = (entry: SessionActivityFileChangeEntry) => {
    if (
      entry.statusLetter === "D" &&
      (Boolean(entry.diff?.trim()) || Boolean(workspaceId))
    ) {
      handleOpenDiffPreview(entry);
      return;
    }
    const markers = entry.markers;
    const hasHighlightMarkers = Boolean(
      markers && (markers.added.length > 0 || markers.modified.length > 0),
    );
    onOpenDiffPath(
      entry.filePath,
      entry.line ? { line: entry.line, column: 1 } : undefined,
      hasHighlightMarkers ? { highlightMarkers: markers } : undefined,
    );
    onEnsureEditorFileMaximized?.();
  };

  const handleOpenDiffPreview = (entry: SessionActivityFileChangeEntry) => {
    if (!entry.diff?.trim() && !workspaceId) {
      return;
    }
    setSelectedDiffPreviewEntry(entry);
    setIsDiffPreviewMaximized(false);
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

  const dismissFollowCoach = () => {
    if (!workspaceId) {
      setShowFollowCoach(false);
      return;
    }
    const nextDismissedByWorkspace = {
      ...readSoloFollowCoachDismissedByWorkspace(),
      [workspaceId]: Date.now(),
    };
    writeSoloFollowCoachDismissedByWorkspace(nextDismissedByWorkspace);
    setShowFollowCoach(false);
  };

  const handleToggleLiveFollow = async (
    source: "header" | "coach" | "nudge",
  ) => {
    if (!workspaceId || !onToggleLiveEditPreview) {
      return false;
    }
    setFollowNudgeError(null);
    try {
      const maybePromise = onToggleLiveEditPreview();
      if (
        maybePromise &&
        typeof (maybePromise as Promise<void>).then === "function"
      ) {
        await maybePromise;
      }
      emitSoloFollowMetric("solo_entry_clicked", {
        workspaceId,
        threadId: viewModel.rootThreadId,
      });
      if (!liveEditPreviewEnabled) {
        emitSoloFollowMetric("solo_follow_enabled", {
          workspaceId,
          threadId: viewModel.rootThreadId,
          turnKey: followNudgeContext?.turnKey,
        });
      }
      if (source === "coach") {
        dismissFollowCoach();
      }
      if (source === "nudge") {
        setFollowNudgeContext(null);
      }
      return true;
    } catch {
      if (source !== "header") {
        setFollowNudgeError(t("activityPanel.followToggleFailed"));
      }
      return false;
    }
  };

  const handleFollowNudgeLater = () => {
    if (followNudgeContext) {
      followNudgeDismissedTurnKeysRef.current[followNudgeContext.turnKey] = true;
      if (workspaceId) {
        emitSoloFollowMetric("solo_nudge_later_clicked", {
          workspaceId,
          threadId: viewModel.rootThreadId,
          turnKey: followNudgeContext.turnKey,
        });
      }
    }
    setFollowNudgeContext(null);
    setFollowNudgeError(null);
  };

  const showFollowCoachBubble =
    showFollowCoach && Boolean(onToggleLiveEditPreview) && soloFollowDiscoveryFlags.coach;
  const showFollowNudgeBubble =
    Boolean(followNudgeContext) &&
    !liveEditPreviewEnabled &&
    Boolean(onToggleLiveEditPreview) &&
    soloFollowDiscoveryFlags.nudge &&
    !showFollowCoachBubble;
  const showFollowErrorBubble =
    Boolean(followNudgeError) &&
    Boolean(onToggleLiveEditPreview) &&
    !showFollowCoachBubble;
  const shouldShowFollowBubble =
    showFollowCoachBubble || showFollowNudgeBubble || showFollowErrorBubble;
  const showInlineFollowCopy = showFollowCoachBubble || showFollowNudgeBubble;
  const followInlineCopyText = showFollowCoachBubble
    ? t("activityPanel.followCoachBody")
    : showFollowNudgeBubble
      ? t("activityPanel.followNudgeBody")
      : "";
  const followPrimaryActionLabel = showFollowErrorBubble
    ? t("activityPanel.followNudgeRetry")
    : showFollowCoachBubble
      ? t("activityPanel.followCoachEnable")
      : t("activityPanel.followNudgeEnable");
  const followSecondaryActionLabel = showFollowErrorBubble
    ? ""
    : showFollowCoachBubble
      ? t("activityPanel.followCoachDismiss")
      : t("activityPanel.followNudgeLater");

  useEffect(() => {
    if (!showFollowCoachBubble && !showFollowNudgeBubble) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      if (showFollowCoachBubble) {
        if (!workspaceId) {
          setShowFollowCoach(false);
          return;
        }
        const nextDismissedByWorkspace = {
          ...readSoloFollowCoachDismissedByWorkspace(),
          [workspaceId]: Date.now(),
        };
        writeSoloFollowCoachDismissedByWorkspace(nextDismissedByWorkspace);
        setShowFollowCoach(false);
        return;
      }

      if (showFollowNudgeBubble && followNudgeContext) {
        followNudgeDismissedTurnKeysRef.current[followNudgeContext.turnKey] = true;
      }
      setFollowNudgeContext(null);
      setFollowNudgeError(null);
    }, FOLLOW_BUBBLE_AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [followNudgeContext, showFollowCoachBubble, showFollowNudgeBubble, workspaceId]);

  useLayoutEffect(() => {
    if (!shouldShowFollowBubble || typeof window === "undefined") {
      setFollowBubbleGeometry(null);
      return;
    }

    const updateFollowBubbleGeometry = () => {
      const toggleButton = liveEditToggleButtonRef.current;
      if (!toggleButton) {
        return;
      }
      const toggleRect = toggleButton.getBoundingClientRect();
      const headerRect = panelHeaderRef.current?.getBoundingClientRect() ?? null;
      const panelRect = panelRootRef.current?.getBoundingClientRect() ?? null;
      const boundaryRect = headerRect ?? panelRect;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const viewportPadding = 12;
      const panelEdgeInset = 8;
      const preferredAnchorInset = 84;
      const anchorCenterX = toggleRect.left + toggleRect.width / 2;
      const leftBoundary = Math.max(
        viewportPadding,
        boundaryRect ? boundaryRect.left + panelEdgeInset : viewportPadding,
      );
      const rightBoundary = Math.min(
        viewportWidth - viewportPadding,
        boundaryRect ? boundaryRect.right - panelEdgeInset : viewportWidth - viewportPadding,
      );
      const boundaryWidth = Math.max(188, rightBoundary - leftBoundary);
      const estimatedInlineWidth = showInlineFollowCopy
        ? Math.ceil(
            followInlineCopyText.length * 10 +
              followPrimaryActionLabel.length * 13 +
              followSecondaryActionLabel.length * 13 +
              170,
          )
        : 300;
      const bubbleWidth = Math.min(
        boundaryWidth,
        Math.max(showInlineFollowCopy ? 300 : 188, estimatedInlineWidth),
      );
      const maxLeft = Math.max(leftBoundary, rightBoundary - bubbleWidth);
      const left = Math.min(Math.max(anchorCenterX - preferredAnchorInset, leftBoundary), maxLeft);
      const top = Math.min(toggleRect.bottom + 10, viewportHeight - 16);
      const arrowLeft = Math.min(Math.max(anchorCenterX - left, 24), bubbleWidth - 24);
      const nextGeometry: FollowBubbleGeometry = {
        top,
        left,
        width: bubbleWidth,
        arrowLeft,
      };
      setFollowBubbleGeometry((current) => {
        if (
          current &&
          Math.abs(current.top - nextGeometry.top) < 0.5 &&
          Math.abs(current.left - nextGeometry.left) < 0.5 &&
          Math.abs(current.width - nextGeometry.width) < 0.5 &&
          Math.abs(current.arrowLeft - nextGeometry.arrowLeft) < 0.5
        ) {
          return current;
        }
        return nextGeometry;
      });
    };

    updateFollowBubbleGeometry();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", updateFollowBubbleGeometry);
    window.addEventListener("scroll", updateFollowBubbleGeometry, scrollOptions);
    return () => {
      window.removeEventListener("resize", updateFollowBubbleGeometry);
      window.removeEventListener("scroll", updateFollowBubbleGeometry, scrollOptions);
    };
  }, [
    followInlineCopyText,
    followPrimaryActionLabel,
    followSecondaryActionLabel,
    shouldShowFollowBubble,
    showInlineFollowCopy,
  ]);

  if (!workspaceId) {
    return (
      <div className="session-activity-panel flex flex-col min-h-0 h-full bg-(--surface-right-panel) [background:color-mix(in_srgb,var(--surface-right-panel,transparent)_92%,transparent)] [--session-activity-expanded-card-max-height:min(60vh,320px)]">
        <div className="session-activity-empty flex items-center justify-center min-h-40 px-4 py-6 text-muted-foreground text-center text-[12px] leading-relaxed">{t("activityPanel.selectWorkspace")}</div>
      </div>
    );
  }

  const followBubbleNode =
    shouldShowFollowBubble && followBubbleGeometry ? (
      <div
        className={`session-activity-follow-bubble fixed top-0 left-0 right-auto z-[1400] w-[min(300px,calc(100vw-24px))] flex flex-col gap-[7px] p-[10px_11px] rounded-xl border border-[color-mix(in_srgb,var(--status-info,#3b82f6)_44%,var(--border-subtle))] bg-(--session-follow-bubble-surface) [box-shadow:0_10px_24px_color-mix(in_srgb,#000000_14%,transparent),inset_0_1px_0_color-mix(in_srgb,#ffffff_22%,transparent)] pointer-events-auto${
          showFollowErrorBubble ? " is-error border-[color-mix(in_srgb,var(--status-error,#ef4444)_48%,var(--border-subtle))] [background:color-mix(in_srgb,var(--session-follow-bubble-surface)_97%,#2a1111_3%)]" : ""
        }${
          showInlineFollowCopy ? " is-inline-layout flex-row items-center gap-2.5" : ""
        }`}
        style={{
          top: `${followBubbleGeometry.top}px`,
          left: `${followBubbleGeometry.left}px`,
          width: `${followBubbleGeometry.width}px`,
          "--session-follow-bubble-arrow-left": `${followBubbleGeometry.arrowLeft}px`,
          "--session-follow-bubble-surface": "var(--surface-sidebar-opaque, var(--surface-popover, #ffffff))",
        } as CSSProperties}
        role={showFollowErrorBubble ? "alert" : "status"}
      >
        {showInlineFollowCopy ? (
          <p className="session-activity-follow-bubble-inline-copy m-0 text-[12px] flex-[1_1_auto] min-w-0 whitespace-nowrap">
            <span className="session-activity-follow-bubble-inline-body font-semibold text-(--text-muted)">
              {showFollowCoachBubble ? t("activityPanel.followCoachBody") : t("activityPanel.followNudgeBody")}
            </span>
          </p>
        ) : (
          <>
            <div className="session-activity-follow-bubble-title text-[12px] font-bold text-(--text-strong)">
              {showFollowErrorBubble ? t("activityPanel.followNudgeErrorTitle") : t("activityPanel.followNudgeTitle")}
            </div>
            <p className="session-activity-follow-bubble-copy m-0 text-[11px] leading-[1.42] text-(--text-muted)">{followNudgeError ?? t("activityPanel.followNudgeBody")}</p>
          </>
        )}
        <div className="session-activity-follow-bubble-actions inline-flex items-center gap-2 flex-none">
          <button
            type="button"
            className="session-activity-follow-bubble-primary min-h-6 px-2.5 rounded-lg border border-[color-mix(in_srgb,var(--status-success)_40%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--surface-control)_70%,transparent)] text-[color-mix(in_srgb,var(--status-success)_80%,var(--text-strong))] text-[11px] font-semibold"
            onClick={() => {
              void handleToggleLiveFollow(showFollowCoachBubble ? "coach" : "nudge");
            }}
          >
            {showFollowErrorBubble
              ? t("activityPanel.followNudgeRetry")
              : showFollowCoachBubble
                ? t("activityPanel.followCoachEnable")
                : t("activityPanel.followNudgeEnable")}
          </button>
          {!showFollowErrorBubble ? (
            <button
              type="button"
              className="session-activity-follow-bubble-secondary min-h-6 px-2.5 rounded-lg border border-border bg-[color-mix(in_srgb,var(--surface-control)_70%,transparent)] text-(--text-muted) text-[11px] font-semibold"
              onClick={showFollowCoachBubble ? dismissFollowCoach : handleFollowNudgeLater}
            >
              {showFollowCoachBubble
                ? t("activityPanel.followCoachDismiss")
                : t("activityPanel.followNudgeLater")}
            </button>
          ) : null}
        </div>
      </div>
    ) : null;

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
    const commandRenderMeta =
      event.kind === "command" && event.commandPreview
        ? inferCommandOutputRenderMeta(event.commandText, event.commandPreview)
        : null;
    const cardMainAriaLabel =
      event.kind === "reasoning"
        ? event.summary || displaySummary
        : undefined;
    return (
      <article
        key={event.eventId}
        className={`session-activity-event session-activity-event-${event.kind} relative grid grid-cols-[18px_minmax(0,1fr)] gap-1 items-center before:content-[''] before:absolute before:left-2 before:top-3.5 before:-bottom-[3px] before:w-px before:[background:linear-gradient(180deg,rgba(148,163,184,0.42),rgba(148,163,184,0.14))] before:pointer-events-none last:before:bottom-[calc(100%-14px)]${
          isExpanded ? " is-expanded" : ""
        }${isRunning ? " is-live before:[background:linear-gradient(180deg,rgba(87,209,140,0.55),rgba(87,209,140,0.14))]" : ""}`}
      >
        <div className={`session-activity-rail relative z-[1] flex items-center justify-center pt-0${isExpanded ? " self-start pt-[5px]" : ""}`} aria-hidden>
          <span className={`session-activity-kind session-activity-kind-${event.kind} inline-flex items-center justify-center w-[18px] h-[18px] rounded-none flex-none relative z-[1] bg-transparent [&_svg]:w-[13px] [&_svg]:h-[13px] [&_svg]:[stroke-width:2.55] [&_.codicon]:text-[13px] [&_.codicon]:font-extrabold [&_.codicon]:leading-none${
            event.kind === "command" ? (isRunning ? " text-[#57d18c]" : " text-[#61afef]") : ""
          }${event.kind === "task" ? " text-[#d9b86c]" : ""}${event.kind === "fileChange" ? " text-[#7cd992]" : ""}`}>
            {event.kind === "command" ? (
              <Terminal size={13} />
            ) : event.kind === "subagent" ? (
              <Bot size={13} />
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

        <div className={`session-activity-card flex flex-col min-h-7 border border-transparent rounded-xl bg-transparent overflow-hidden shadow-none hover:[background:color-mix(in_srgb,var(--surface-card,#ffffff)_60%,transparent)]${
          isExpanded ? " h-auto max-h-[var(--session-activity-expanded-card-max-height)] border-x-0 border-y border-border rounded-none [background:color-mix(in_srgb,var(--surface-card,#ffffff)_96%,#f8fafc)] hover:[background:color-mix(in_srgb,var(--surface-card,#ffffff)_96%,#f8fafc)] shadow-[0_1px_0_rgba(15,23,42,0.03)]" : ""
        }`}>
          <div className="session-activity-card-top flex items-stretch min-h-7">
            <button
              type="button"
              className="session-activity-card-main flex-[1_1_auto] flex items-center gap-1.5 min-w-0 px-2 py-0.5 text-inherit text-left"
              onClick={() => handleCardPrimaryAction(event)}
              aria-label={cardMainAriaLabel}
              title={cardMainAriaLabel}
            >
              <span className="session-activity-card-copy flex flex-row items-center flex-[1_1_auto] min-w-0 gap-[3px]">
                <span className={`session-activity-card-title inline-flex items-center gap-2 ${isExpanded ? "flex-none max-w-[46%] whitespace-nowrap" : "flex-[1_1_auto]"} min-w-0 text-[12px] leading-[1.35] text-(--text-strong) whitespace-nowrap overflow-hidden text-ellipsis`}>
                  {event.kind === "fileChange" && event.fileChangeStatusLetter ? (
                    <span
                      className={`session-activity-file-kind-badge is-${event.fileChangeStatusLetter.toLowerCase()} flex-none inline-flex items-center justify-center w-4 h-4 p-0 rounded-full border border-[color-mix(in_srgb,currentColor_38%,var(--border-subtle))] [background:color-mix(in_srgb,currentColor_10%,var(--surface-secondary))] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,currentColor_8%,transparent)] text-[8px] font-bold leading-none${
                        event.fileChangeStatusLetter.toLowerCase() === "a" ? " text-(--color-success,var(--status-success,#107c10))" : ""
                      }${event.fileChangeStatusLetter.toLowerCase() === "d" ? " text-(--color-error,var(--status-error,#e81123))" : ""}${event.fileChangeStatusLetter.toLowerCase() === "r" ? " text-(--color-warning,var(--status-warning,#f7630c))" : ""}${event.fileChangeStatusLetter.toLowerCase() === "m" ? " text-(--color-info,var(--color-tool-icon,#0078d4))" : ""}`}
                      aria-hidden
                    >
                      {event.fileChangeStatusLetter}
                    </span>
                  ) : null}
                  <span>{displaySummary}</span>
                </span>
                <span className={`session-activity-card-meta inline-flex items-center gap-1 ${isExpanded ? "flex-none max-w-[46%] whitespace-nowrap" : "flex-none max-w-[46%] whitespace-nowrap"} max-w-full overflow-hidden text-[10px] text-(--text-muted)`}>
                  <time
                    className="session-activity-card-time flex-none text-[10px] text-(--text-muted) [font-variant-numeric:tabular-nums] whitespace-nowrap"
                    dateTime={new Date(event.occurredAt).toISOString()}
                  >
                    {formatActivityTime(event.occurredAt)}
                  </time>
                  <span className={`session-activity-chip is-status-${event.status} inline-flex items-center whitespace-nowrap min-w-0 max-w-full px-1.5 py-px rounded-full border border-[color-mix(in_srgb,var(--border-subtle)_86%,transparent)] [background:color-mix(in_srgb,var(--surface-card,#ffffff)_96%,#f3f6fa)] overflow-hidden text-ellipsis${
                    event.status === "running" ? " text-[#57d18c] border-[rgba(87,209,140,0.28)] bg-[rgba(87,209,140,0.12)]" : ""
                  }${event.status === "completed" ? " text-(--text-stronger)" : ""}${event.status === "failed" ? " text-[#ff8d88] border-[rgba(255,141,136,0.26)] bg-[rgba(255,141,136,0.12)]" : ""}`}>
                    {t(`activityPanel.status.${event.status}`)}
                  </span>
                  {showThreadChip ? (
                    <span
                      className="session-activity-chip inline-flex items-center whitespace-nowrap min-w-0 max-w-full px-1.5 py-px rounded-full border border-[color-mix(in_srgb,var(--border-subtle)_86%,transparent)] [background:color-mix(in_srgb,var(--surface-card,#ffffff)_96%,#f3f6fa)] overflow-hidden text-ellipsis"
                      title={event.threadName}
                    >
                      {event.threadName}
                    </span>
                  ) : null}
                  {event.relationshipSource === "fallbackLinking" ? (
                    <span className="session-activity-chip is-fallback inline-flex items-center whitespace-nowrap min-w-0 max-w-full px-1.5 py-px rounded-full overflow-hidden text-ellipsis text-[#d9b86c] border border-[rgba(217,184,108,0.24)] bg-[rgba(217,184,108,0.12)]">
                      {t("activityPanel.fallbackLinking")}
                    </span>
                  ) : null}
                </span>
              </span>

              {event.kind === "fileChange" && (signedAdditions || signedDeletions) ? (
                <span className="session-activity-file-stats inline-flex items-center gap-1 flex-none self-center text-[11px] font-mono [font-variant-numeric:tabular-nums] [&_.is-add]:text-[#7cd992] [&_.is-del]:text-[#ff8d88]">
                  {signedAdditions ? <span className="is-add">{signedAdditions}</span> : null}
                  {signedDeletions ? <span className="is-del">{signedDeletions}</span> : null}
                </span>
              ) : null}
            </button>

            {isExpandable ? (
              <button
                type="button"
                className="session-activity-preview-toggle inline-flex items-center justify-center self-center flex-none w-7 h-7 mt-px mr-1 mb-0 ml-0 p-0 text-(--text-muted) border-none rounded-lg bg-transparent hover:text-(--text-emphasis) hover:[background:color-mix(in_srgb,var(--surface-card,#ffffff)_74%,#eaf3ff)]"
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

          {event.kind === "fileChange" && event.fileChanges?.length ? (
            <div className="session-activity-file-list flex flex-col gap-1 pr-2 pb-1.5 pl-[22px]">
              {event.fileChanges.map((fileChangeEntry) => {
                const fileSignedAdditions = formatSignedCount(fileChangeEntry.additions, "+");
                const fileSignedDeletions = formatSignedCount(fileChangeEntry.deletions, "-");
                return (
                  <div
                    key={`${event.eventId}:${fileChangeEntry.filePath}`}
                    className="session-activity-file-row flex items-center gap-0.5"
                  >
                    <button
                      type="button"
                      className="session-activity-file-row-main flex items-center gap-[7px] min-w-0 flex-[1_1_auto] min-h-[34px] py-1.5 px-2.5 rounded-[11px] border border-(--session-activity-file-row-border) bg-(--session-activity-file-row-surface) text-inherit text-left transition-[border-color,background,transform] duration-[140ms] ease-linear hover:border-(--session-activity-file-row-border-hover) hover:bg-(--session-activity-file-row-surface-hover) hover:-translate-y-px"
                      title={fileChangeEntry.filePath}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        openActivityFile(fileChangeEntry);
                      }}
                    >
                      <span
                        className={`session-activity-file-kind-badge is-${fileChangeEntry.statusLetter.toLowerCase()} flex-none inline-flex items-center justify-center w-4 h-4 p-0 rounded-full border border-[color-mix(in_srgb,currentColor_38%,var(--border-subtle))] [background:color-mix(in_srgb,currentColor_10%,var(--surface-secondary))] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,currentColor_8%,transparent)] text-[8px] font-bold leading-none${
                          fileChangeEntry.statusLetter.toLowerCase() === "a" ? " text-(--color-success,var(--status-success,#107c10))" : ""
                        }${fileChangeEntry.statusLetter.toLowerCase() === "d" ? " text-(--color-error,var(--status-error,#e81123))" : ""}${fileChangeEntry.statusLetter.toLowerCase() === "r" ? " text-(--color-warning,var(--status-warning,#f7630c))" : ""}${fileChangeEntry.statusLetter.toLowerCase() === "m" ? " text-(--color-info,var(--color-tool-icon,#0078d4))" : ""}`}
                        aria-hidden
                      >
                        {fileChangeEntry.statusLetter}
                      </span>
                      <span className="session-activity-file-row-icon inline-flex items-center justify-center flex-none text-(--session-activity-file-row-icon-color)" aria-hidden>
                        <FileIcon filePath={fileChangeEntry.filePath} />
                      </span>
                      <span className="session-activity-file-row-copy flex items-center min-w-0 flex-[1_1_auto]">
                        <span className="session-activity-file-row-name min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold text-(--session-activity-file-row-name-color)">
                          {fileChangeEntry.fileName}
                        </span>
                      </span>
                      {fileSignedAdditions || fileSignedDeletions ? (
                        <span className="session-activity-file-row-stats inline-flex items-center gap-1 flex-none ml-auto pl-1.5 self-center text-[10px] font-mono [font-variant-numeric:tabular-nums] [&_.is-add]:text-(--session-activity-file-row-add-color) [&_.is-del]:text-(--session-activity-file-row-del-color)">
                          {fileSignedAdditions ? (
                            <span className="is-add">{fileSignedAdditions}</span>
                          ) : null}
                          {fileSignedDeletions ? (
                            <span className="is-del">{fileSignedDeletions}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="session-activity-file-row-action inline-flex items-center justify-center w-[30px] min-w-[30px] h-[30px] p-0 border-none rounded-lg bg-transparent shadow-none text-(--session-activity-file-row-action-color) transition-[transform,background,color,box-shadow] duration-[140ms] ease-linear enabled:hover:-translate-y-px enabled:hover:[background:color-mix(in_srgb,var(--surface-hover,var(--surface-control,transparent))_46%,transparent)] enabled:hover:text-(--session-activity-file-row-action-color-hover) focus-visible:outline-none focus-visible:[background:color-mix(in_srgb,var(--surface-hover,var(--surface-control,transparent))_52%,transparent)] focus-visible:[box-shadow:0_0_0_1px_color-mix(in_srgb,var(--status-info,#3b82f6)_52%,transparent)] disabled:opacity-[0.52] disabled:cursor-not-allowed disabled:shadow-none"
                      aria-label={t("git.previewModalAction")}
                      title={t("git.previewModalAction")}
                      disabled={!fileChangeEntry.diff?.trim() && !workspaceId}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        handleOpenDiffPreview(fileChangeEntry);
                      }}
                    >
                      <GitCompareArrows
                        size={18}
                        strokeWidth={2.25}
                        aria-hidden
                        className="session-activity-file-row-action-icon block"
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          {isExpandable && isExpanded ? (
            <div className="session-activity-preview flex flex-col gap-1 flex-[1_1_auto] min-h-0 pr-2 pb-1.5 pl-[22px]">
              {event.kind === "command" ? (
                <div className="session-activity-command-detail flex flex-col gap-0.5 flex-none">
                  {event.commandText && !isPlaceholderCommandText(event.commandText) ? (
                    <div className="session-activity-command-row grid grid-cols-[48px_minmax(0,1fr)] gap-1 items-start">
                      <span className="session-activity-command-label pt-0.5 text-[10px] text-(--text-muted) whitespace-nowrap">
                        {t("activityPanel.command")}
                      </span>
                      <code className="session-activity-command-value min-w-0 py-1 px-0 rounded-none border-none bg-transparent text-(--text-stronger) text-[11px] leading-[1.4] whitespace-pre-wrap break-words font-mono">{event.commandText}</code>
                    </div>
                  ) : null}
                  {event.commandWorkingDirectory ? (
                    <div className="session-activity-command-row grid grid-cols-[48px_minmax(0,1fr)] gap-1 items-start">
                      <span className="session-activity-command-label pt-0.5 text-[10px] text-(--text-muted) whitespace-nowrap">
                        {t("activityPanel.cwd")}
                      </span>
                      <code className="session-activity-command-value min-w-0 py-1 px-0 rounded-none border-none bg-transparent text-(--text-stronger) text-[11px] leading-[1.4] whitespace-pre-wrap break-words font-mono">
                        {event.commandWorkingDirectory}
                      </code>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {event.kind === "reasoning" ? (
                <div
                  className="session-activity-preview-text is-markdown m-0 flex-[1_1_auto] min-h-0 max-h-full overflow-auto pt-1 px-0 pb-0 rounded-none bg-transparent text-(--text-stronger) text-[11px] leading-[1.45] whitespace-normal break-words font-sans border-none shadow-none"
                  ref={(node) => {
                    if (!node) {
                      delete reasoningPreviewScrollContainerByEventIdRef.current[event.eventId];
                      return;
                    }
                    reasoningPreviewScrollContainerByEventIdRef.current[event.eventId] = node;
                  }}
                >
                  <div className="session-activity-reasoning-surface relative ml-1 border-none border-l-0 rounded-none py-0.5 px-0 pl-4 bg-transparent shadow-none">
                    <Markdown
                      value={event.reasoningPreview || t("activityPanel.waitingForReasoning")}
                      className={`markdown reasoning-markdown session-activity-preview-markdown text-(--text-secondary) text-[11px] leading-[1.4]${
                        event.status === "running" ? " markdown-live-streaming break-words [overflow-wrap:anywhere]" : ""
                      }`}
                      codeBlockStyle="message"
                      streamingThrottleMs={event.status === "running" ? 220 : 80}
                      softBreaks
                    />
                  </div>
                </div>
              ) : event.kind === "command" ? (
                event.commandPreview && commandRenderMeta?.mode === "markdown" ? (
                  <div className="session-activity-preview-text is-markdown is-command-markdown m-0 flex-[1_1_auto] min-h-0 max-h-full overflow-auto pt-1 rounded-none bg-transparent text-(--text-stronger) text-[11px] leading-[1.45] whitespace-normal break-words font-sans border-none shadow-none">
                    <Markdown
                      value={normalizeCommandMarkdownOutput(event.commandPreview)}
                      className="markdown session-activity-preview-markdown text-(--text-secondary) text-[11px] leading-[1.4]"
                      codeBlockStyle="message"
                      streamingThrottleMs={80}
                      softBreaks
                    />
                  </div>
                ) : event.commandPreview && commandRenderMeta?.mode === "code" ? (
                  <pre
                    className="session-activity-preview-text is-command-output is-command-code m-0 flex-[1_1_auto] min-h-0 max-h-full overflow-auto py-1.5 px-2 rounded-md border border-(--session-activity-command-output-border) bg-(--session-activity-command-output-bg) shadow-none leading-[1.52] text-(--text-stronger) text-[11px] whitespace-pre-wrap break-words font-mono [font-feature-settings:'tnum'_1,'zero'_1]"
                    dangerouslySetInnerHTML={{
                      __html: renderCodeOutputHtml(
                        event.commandPreview,
                        commandRenderMeta.language,
                      ),
                    }}
                  />
                ) : event.commandPreview ? (
                  <pre
                    className="session-activity-preview-text is-command-output m-0 flex-[1_1_auto] min-h-0 max-h-full overflow-auto py-1.5 px-2 rounded-md border border-(--session-activity-command-output-border) bg-(--session-activity-command-output-bg) shadow-none leading-[1.52] text-(--text-stronger) text-[11px] whitespace-pre-wrap break-words font-mono [font-feature-settings:'tnum'_1,'zero'_1]"
                    dangerouslySetInnerHTML={{
                      __html: renderShellOutputHtml(event.commandPreview),
                    }}
                  />
                ) : (
                  <pre className="session-activity-preview-text is-command-output m-0 flex-[1_1_auto] min-h-0 max-h-full overflow-auto py-1.5 px-2 rounded-md border border-(--session-activity-command-output-border) bg-(--session-activity-command-output-bg) shadow-none leading-[1.52] text-(--text-stronger) text-[11px] whitespace-pre-wrap break-words font-mono [font-feature-settings:'tnum'_1,'zero'_1]">
                    {t("activityPanel.waitingForOutput")}
                  </pre>
                )
              ) : (
                <pre className="session-activity-preview-text m-0 flex-[1_1_auto] min-h-0 max-h-full overflow-auto pt-1.5 px-0 pb-0 rounded-none bg-transparent text-(--text-stronger) text-[11px] leading-[1.45] whitespace-pre-wrap break-words font-mono border-none shadow-none">
                  {event.explorePreview || t("activityPanel.waitingForOutput")}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      </article>
    );
  };

  return (
    <div className="session-activity-panel flex flex-col min-h-0 h-full bg-(--surface-right-panel) [background:color-mix(in_srgb,var(--surface-right-panel,transparent)_92%,transparent)] [--session-activity-expanded-card-max-height:min(60vh,320px)]" ref={panelRootRef}>
      <div className="session-activity-header relative z-[2] overflow-visible flex items-center justify-between gap-3 px-3.5 pt-3 pb-2.5 border-b border-border" ref={panelHeaderRef}>
        <div className="session-activity-title-group flex items-center gap-3.5 flex-[1_1_auto] min-w-0 overflow-visible">
          <div className="session-activity-heading-row relative flex items-center gap-2.5 min-w-0 overflow-visible">
            <div
              className={`session-activity-title-row inline-flex items-center gap-2 text-[13px] font-semibold text-(--text-strong)${viewModel.isProcessing ? " is-live" : ""}`}
            >
              <span>{t("activityPanel.title")}</span>
            </div>
            {onToggleLiveEditPreview ? (
              <button
                ref={liveEditToggleButtonRef}
                type="button"
                className={`session-activity-live-edit-toggle relative inline-flex items-center justify-center h-6 w-6 p-0 border-none rounded-none bg-transparent text-(--text-muted) transition-[color,filter] duration-[160ms] ease-linear [animation:session-activity-live-toggle-breathe_2.9s_cubic-bezier(0.22,1,0.36,1)_infinite] [&_svg]:[stroke-width:2.4] [&_svg]:[transform-origin:center] [&_svg]:[animation:session-activity-live-toggle-heartbeat_2.9s_cubic-bezier(0.22,1,0.36,1)_infinite] hover:text-[color-mix(in_srgb,var(--status-success)_62%,var(--text-strong))] hover:[filter:drop-shadow(0_0_12px_rgba(87,209,140,0.24))] hover:[animation-duration:1.8s] hover:[&_svg]:[animation-duration:1.25s] motion-reduce:!animate-none motion-reduce:[&_svg]:!animate-none motion-reduce:transform-none${
                  liveEditPreviewEnabled ? " is-active text-(--status-success) [filter:drop-shadow(0_0_8px_rgba(87,209,140,0.28))_drop-shadow(0_0_16px_rgba(87,209,140,0.16))] [animation:session-activity-live-toggle-pulse_1.8s_ease-in-out_infinite] [&_svg]:[animation-duration:1.05s]" : ""
                }`}
                aria-pressed={liveEditPreviewEnabled}
                aria-label={t("activityPanel.liveEditPreview")}
                onClick={() => {
                  void handleToggleLiveFollow("header");
                }}
                title={t(
                  liveEditPreviewEnabled
                    ? "activityPanel.disableLiveEditPreview"
                    : "activityPanel.liveEditPreviewTooltip",
                )}
              >
                <Bot size={15} aria-hidden />
              </button>
            ) : null}
          </div>
          {viewModel.timeline.length > 0 ? (
            <div
              className="session-activity-tabs flex items-center gap-2.5 p-0 flex-[1_1_auto] min-w-0 overflow-x-auto"
              role="tablist"
              aria-label={t("activityPanel.tabs.ariaLabel")}
            >
              {visibleTabItems.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`session-activity-tab flex-none inline-flex items-center gap-[5px] min-h-[22px] p-0 border-none bg-transparent text-(--text-muted) text-[12px] font-semibold whitespace-nowrap rounded-none border-b-2 border-b-transparent transition-[color,border-color] duration-[120ms] ease-linear hover:text-(--text-strong) [&_.session-activity-tab-icon]:hover:text-(--text-strong) [&_.session-activity-tab-count]:hover:text-(--text-strong)${activeTab === tab.id ? " is-active text-(--text-strong) border-b-[color-mix(in_srgb,var(--status-success,#57d18c)_56%,transparent)] [&_.session-activity-tab-icon]:text-[color-mix(in_srgb,var(--status-success,#57d18c)_62%,var(--text-strong))] [&_.session-activity-tab-count]:text-[color-mix(in_srgb,var(--text-strong)_78%,var(--status-success,#57d18c))]" : " not-[:is-active]:gap-1"}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="session-activity-tab-icon inline-flex items-center text-(--text-muted) [color:color-mix(in_srgb,var(--text-muted)_88%,var(--text-strong))]">{tabIconMap[tab.id]}</span>
                  <span className="session-activity-tab-label text-inherit">{tab.label}</span>
                  <span className="session-activity-tab-count [font-variant-numeric:tabular-nums] text-(--text-muted) [color:color-mix(in_srgb,var(--text-muted)_82%,transparent)]">{tabCounts[tab.id]}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="session-activity-summary inline-flex items-center justify-end flex-[0_1_auto] min-w-0 max-w-full text-[11px] text-(--text-muted) [font-variant-numeric:tabular-nums] whitespace-nowrap overflow-hidden text-ellipsis">{headerSummary}</div>
      </div>
      {followBubbleNode && typeof document !== "undefined"
        ? createPortal(followBubbleNode, document.body)
        : null}
      {selectedDiffPreviewEntry && typeof document !== "undefined"
        ? createPortal(
            <div
              className="git-history-diff-modal-overlay is-popup"
              role="presentation"
              onClick={() => setSelectedDiffPreviewEntry(null)}
            >
              <div
                className={`git-history-diff-modal ${isDiffPreviewMaximized ? "is-maximized" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={selectedDiffPreviewGitPath ?? selectedDiffPreviewEntry.filePath}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="git-history-diff-modal-header">
                  <div className="git-history-diff-modal-title">
                    <span
                      className={`git-history-file-status git-status-${selectedDiffPreviewEntry.statusLetter.toLowerCase()}`}
                    >
                      {selectedDiffPreviewEntry.statusLetter}
                    </span>
                    <span className="git-history-tree-icon is-file" aria-hidden>
                      <FileIcon filePath={selectedDiffPreviewEntry.filePath} />
                    </span>
                    <span className="git-history-diff-modal-path">
                      {selectedDiffPreviewGitPath ?? selectedDiffPreviewEntry.filePath}
                    </span>
                    <span className="git-history-diff-modal-stats">
                      <span className="is-add">+{selectedDiffPreviewEntry.additions}</span>
                      <span className="is-sep">/</span>
                      <span className="is-del">-{selectedDiffPreviewEntry.deletions}</span>
                    </span>
                  </div>
                  <div className="git-history-diff-modal-actions" ref={setDiffPreviewHeaderControlsTarget}>
                    <button
                      type="button"
                      className="git-history-diff-modal-close"
                      onClick={() => setIsDiffPreviewMaximized((value) => !value)}
                      aria-label={
                        isDiffPreviewMaximized ? t("common.restore") : t("menu.maximize")
                      }
                      title={
                        isDiffPreviewMaximized ? t("common.restore") : t("menu.maximize")
                      }
                    >
                      <span className="git-history-diff-modal-close-glyph" aria-hidden>
                        {isDiffPreviewMaximized ? "❐" : "□"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="git-history-diff-modal-close"
                      onClick={() => setSelectedDiffPreviewEntry(null)}
                      aria-label={t("common.close")}
                      title={t("common.close")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="git-history-diff-modal-viewer">
                  <WorkspaceEditableDiffReviewSurface
                    workspaceId={workspaceId}
                    workspacePath={workspacePath}
                    files={[
                      {
                        filePath: selectedDiffPreviewGitPath ?? selectedDiffPreviewEntry.filePath,
                        status: selectedDiffPreviewEntry.statusLetter,
                        additions: selectedDiffPreviewEntry.additions,
                        deletions: selectedDiffPreviewEntry.deletions,
                        diff: selectedDiffPreviewEntry.diff ?? "",
                      },
                    ]}
                    selectedPath={selectedDiffPreviewGitPath ?? selectedDiffPreviewEntry.filePath}
                    stickyHeaderMode="controls-only"
                    embeddedAnchorVariant="modal-pager"
                    toolbarLayout="inline-actions"
                    headerControlsTarget={diffPreviewHeaderControlsTarget}
                    fullDiffSourceKey={[
                      selectedDiffPreviewGitPath ?? selectedDiffPreviewEntry.filePath,
                      selectedDiffPreviewEntry.statusLetter,
                      selectedDiffPreviewEntry.additions,
                      selectedDiffPreviewEntry.deletions,
                      selectedDiffPreviewEntry.diff ?? "",
                    ].join(":")}
                    diffStyle={diffPreviewStyle}
                    onDiffStyleChange={setDiffPreviewStyle}
                    focusSelectedFileOnly
                    allowEditing
                    onRequestGitStatusRefresh={onRefreshGitStatus}
                    onCreateCodeAnnotation={onCreateCodeAnnotation}
                    onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                    codeAnnotations={codeAnnotations}
                    codeAnnotationSurface="modal-diff-view"
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {stickyChildSessionSummaries.length > 0 ? (
        <div
          className="session-activity-related-toolbar flex items-center gap-2 px-3.5 py-[9px] pb-[11px] border-b border-border min-w-0"
          aria-label={t("activityPanel.relatedSessions")}
        >
          <div className="session-activity-related-toolbar-scroller inline-flex items-center gap-2 flex-[1_1_auto] min-w-0 overflow-x-auto py-px pr-0.5 pb-0.5 scroll-smooth [scrollbar-width:thin]">
            {stickyChildSessionSummaries.map((session, index) => {
              const fixedLabel = resolveChildSessionPillLabel(session, index, t);
              const pillStyle = resolveSessionPillStyle(session, index);
              return (
                <div
                  key={session.threadId}
                  className={`session-activity-session-pill flex-none inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full cursor-pointer border bg-card [background:color-mix(in_srgb,var(--surface-card,#ffffff)_90%,#f2f6fb)] text-(--text-strong) transition-[border-color,background,color,box-shadow] duration-[180ms] ease-linear [box-shadow:inset_0_1px_0_color-mix(in_srgb,#ffffff_68%,transparent),0_1px_2px_color-mix(in_srgb,hsl(var(--session-pill-accent-h)_var(--session-pill-accent-s)_var(--session-pill-accent-l))_12%,transparent)] hover:[box-shadow:inset_0_1px_0_color-mix(in_srgb,#ffffff_72%,transparent),0_3px_8px_color-mix(in_srgb,hsl(var(--session-pill-accent-h)_var(--session-pill-accent-s)_var(--session-pill-accent-l))_18%,transparent)]${session.isProcessing ? " is-processing relative [animation:session-activity-processing-pill_1.45s_ease-in-out_infinite]" : ""}`}
                  style={{
                    ...pillStyle,
                    borderColor: `color-mix(in srgb, hsl(var(--session-pill-accent-h) var(--session-pill-accent-s) var(--session-pill-accent-l)) 26%, var(--border-subtle))`,
                  } as CSSProperties}
                  role="button"
                  tabIndex={0}
                  aria-label={fixedLabel}
                  title={session.threadName}
                  onClick={() => onSelectThread(workspaceId, session.threadId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectThread(workspaceId, session.threadId);
                    }
                  }}
                >
                  <Bot size={12} aria-hidden />
                  <span className="session-activity-session-name text-[11px] font-semibold leading-none whitespace-nowrap">{fixedLabel}</span>
                  {session.relationshipSource === "fallbackLinking" ? (
                    <span className="session-activity-session-meta text-[10px] text-(--text-muted) whitespace-nowrap">
                      {t("activityPanel.fallbackLinking")}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {filteredTimeline.length === 0 ? (
        <div className="session-activity-empty flex items-center justify-center min-h-40 px-4 py-6 text-(--text-muted) text-center text-[12px] leading-relaxed">{emptyCopy}</div>
      ) : (
        <div className="session-activity-timeline flex flex-col gap-2.5 px-3.5 pt-3 pb-5 overflow-y-auto min-h-0">
          {groupedTimeline.map((group) => (
            <section key={group.id} className="session-activity-turn-group flex flex-col gap-1 pt-1.5 px-2 pb-2 rounded-xl border border-[color-mix(in_srgb,var(--border-subtle)_84%,transparent)] [background:color-mix(in_srgb,var(--surface-card,#ffffff)_86%,transparent)]">
              <button
                type="button"
                className="session-activity-turn-group-header flex items-center justify-between gap-2 min-h-5 w-full px-1 border-none bg-transparent text-inherit text-left rounded-[10px] hover:[background:color-mix(in_srgb,var(--surface-control)_48%,transparent)]"
                onClick={() => handleToggleTurnGroup(group.id)}
                aria-expanded={!collapsedTurnGroupIds[group.id]}
                aria-label={
                  collapsedTurnGroupIds[group.id]
                    ? t("activityPanel.expandTurnGroup")
                    : t("activityPanel.collapseTurnGroup")
                }
              >
                <span
                  className={`session-activity-turn-group-title inline-flex items-center px-1.5 min-h-[18px] rounded-full [background:color-mix(in_srgb,var(--surface-control)_72%,transparent)] text-(--text-muted) text-[10px] font-bold tracking-[0.02em] whitespace-nowrap${
                    group.sessionRole === "child" ? " is-child border border-[color-mix(in_srgb,hsl(var(--session-pill-accent-h)_var(--session-pill-accent-s)_var(--session-pill-accent-l))_36%,var(--border-subtle))] text-[color-mix(in_srgb,hsl(var(--session-pill-accent-h)_var(--session-pill-accent-s)_calc(var(--session-pill-accent-l)-10%))_32%,var(--text-strong))]" : ""
                  }`}
                  style={
                    group.sessionRole === "child"
                      ? childSessionStyleByThreadId.get(group.threadId)
                      : undefined
                  }
                >
                  {group.turnIndex
                    ? t("activityPanel.turnGroup", { index: group.turnIndex })
                    : t("activityPanel.turnGroupFallback")}
                </span>
                <span className="session-activity-turn-group-header-tail inline-flex items-center gap-2 min-w-0">
                  {group.sessionRole === "child" ? (
                    <span className="session-activity-turn-group-meta text-(--text-muted) text-[10px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={group.threadName}>
                      {group.threadName}
                    </span>
                  ) : null}
                  <span className="session-activity-turn-group-toggle inline-flex items-center justify-center w-[18px] h-[18px] text-(--text-muted) flex-none" aria-hidden>
                    {collapsedTurnGroupIds[group.id] ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                  </span>
                </span>
              </button>
              {!collapsedTurnGroupIds[group.id] ? (
                <div className="session-activity-turn-group-events flex flex-col gap-[3px]">
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
