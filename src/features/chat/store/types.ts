import type { OmpServiceTier } from "@/lib/omp-service-tier";
import type {
  EngineInfo,
  PlanReview,
  PlanReviewDecision,
  SessionMeta,
  Workspace,
  WorkspaceGroup,
} from "@/lib/ipc";
import type { EffortLevel } from "@/components/application/ai-chat/cli-menu";
import type { ComposerPermission } from "@/components/application/ai-chat/permission-menu";
import type { ActiveSession } from "./persistence";
import type { SessionContributions } from "./session-contributions";
import type { QueueMoveDirection, SessionState } from "./stream";

/** Result of a plan-decision submit. `applied`/`conflict` come from the
 *  backend CAS (the returned record already replaced the local card);
 *  `error` keeps the card pending — a failure is never shown as approval. */
export type PlanReviewRespondResult =
  | { kind: "applied"; record: PlanReview }
  | { kind: "conflict"; record: PlanReview }
  | { kind: "error"; error: string };

/** Per-send options carried from the composer to the spawn request. */
export interface SendOptions {
  /** 电脑操控: mount the app's computer-use driver (screenshot/input MCP
   *  server + virtual pointer overlay) for this turn. Engines that cannot
   *  mount it are refused before the send (see computer-use.ts). */
  computerUse?: boolean;
  /** ccgui 自己拦下的 `/compact`（底部按钮或内置 app 命令）：OMP 改走原生
   *  compact RPC 命令。用户自定义的同名目录命令不带这个标记，仍按普通
   *  提示词发给 CLI。 */
  nativeCompact?: boolean;
  /** 内部：宿主能力（插件 session-run bridge）用它在 spawn 成功后拿到
   *  runId / 原生 sessionId，好把轮次回执给发起方。聊天发送不传。 */
  onStarted?: (info: { runId: string; sessionId: string | null }) => void;
}

export interface ChatStore {
  workspaces: Workspace[];
  sessions: SessionMeta[];
  /** Persisted archive identities mirrored from the backend. Engine events
   * consult this map so a late event cannot reinsert an archived row. */
  archivedSessionKeys: Record<string, true>;
  engines: EngineInfo[];
  active: ActiveSession | null;
  /** Open conversation tabs, in display order. Persisted in localStorage. */
  openTabs: ActiveSession[];
  activeEngine: string;
  /** Composer permission mode ("auto" | "manual" | "plan" | "bypass"),
   * persisted in localStorage; engines resolve unsupported modes to their
   * first supported one at send time (and the picker greys them out). */
  permission: ComposerPermission;
  /** Per-engine reasoning effort ("low" | … | "ultra"), persisted in app settings. */
  efforts: Record<string, EffortLevel>;
  ompServiceTier: OmpServiceTier;
  /** Codex Fast override; null preserves ~/.codex. */
  codexServiceTier: OmpServiceTier;
  /** Per-engine model override ("" = CLI/provider default), persisted in app settings. */
  models: Record<string, string>;
  /** Per-engine default channel (settings `current`). New chats and sessions
   *  that never recorded one fall back to this; spawn injects env, never
   *  writes the CLI's own config file. */
  providers: Record<string, string>;
  /** Max sessions listed per workspace in the sidebar, persisted in app settings. */
  threadLimit: number;
  /** Sidebar workspace groups, persisted in app settings. The assignment
   *  lives on each workspace (`Workspace.groupId`), same as the legacy app. */
  workspaceGroups: WorkspaceGroup[];
  /** Workspace id -> sidebar display alias, persisted in app settings;
   *  workspaces missing here show their folder name. */
  workspaceAliases: Record<string, string>;
  /** Ids of workspaces hidden into the sidebar's collapsible 已归档 section,
   *  persisted in app settings; records and sessions stay intact. */
  archivedWorkspaces: string[];
  /** Composer send gesture ("enter" | "cmdEnter"), persisted in app settings. */
  sendShortcut: string;
  /** Thinking-process row behavior once its thinking settles: true = auto-fold
   *  (default), false = stay expanded until the user folds it. Persisted in
   *  app settings. */
  thinkingAutoCollapse: boolean;
  bySession: Record<string, SessionState>;
  /** Flat sessionKey -> streaming map, written only when a flag flips. The
   * tab strip and sidebar select this instead of scanning bySession on every
   * store write (streaming deltas would otherwise re-render them per frame). */
  streamingByKey: Record<string, true>;
  /** Flat sessionKey -> retrying flag, written only on retry start/stop.
   * Keeps the sidebar out of the per-token bySession update path. */
  retryingByKey: Record<string, true>;
  /** Sessions with activity the user has not opened yet (sidebar green dot),
   * keyed `${engine}/${sessionId}` like the sidebar thread id. In-memory only. */
  unseen: Record<string, boolean>;
  drafts: Record<string, string>;
  /** File-tree "+" click asking the active composer to insert an @path
   * mention; nonce re-fires for the same path. */
  pendingMention: { path: string; nonce: number } | null;
  /** Last failed store action (add/remove workspace, delete/pin/rename
   * session); surfaced as a dismissable banner in ChatPage. */
  actionError: string | null;
  initialized: boolean;
  /** Session lifecycle events already emitted for the current frontend lifetime. */
  restoredSessionKeys: Record<string, true>;
  createdSessionKeys: Record<string, true>;
  /** `persistence:"session"` internal contributions remembered per
   * (engine, nativeSessionId) scope and keyed by contribution id; re-injected
   * on every later turn of that session. Bounded; cleared with the tab or
   * session. */
  sessionContributions: SessionContributions;
  /** A never-launched tab retargeted to another runtime; consumed on first send. */
  pendingRuntimeSwitch: {
    sourceEngine: string;
    targetEngine: string;
    sourceSessionId: string | null;
    targetSessionId: string | null;
    workspacePath: string;
  } | null;

  init: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  /** Re-read engines + sessions after CLI config changes (enable switch,
   * channel edits): refreshes the picker's enabled set and re-filters the
   * history list, migrating the engine pref off a disabled CLI. */
  refreshEngines: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (path: string, meta?: Record<string, unknown>) => Promise<void>;
  /** 工作区多目录:登记一个附加根(不能是主目录);后端失败(如路径不存在)
   *  原样进 actionError 横幅。 */
  addWorkspaceRoot: (workspaceId: string, path: string) => Promise<void>;
  /** 移除一个附加根;主目录(`Workspace.path`)不在可移除范围内。 */
  removeWorkspaceRoot: (workspaceId: string, path: string) => Promise<void>;
  reorderWorkspaces: (ids: string[]) => Promise<void>;
  removeWorkspace: (id: string) => Promise<void>;
  selectSession: (
    engine: string,
    sessionId: string,
    workspacePath: string,
  ) => Promise<void>;
  closeTab: (
    engine: string,
    sessionId: string | null,
    workspacePath: string,
  ) => void;
  /** Activate an already-open tab without changing the tab list. */
  focusTab: (
    engine: string,
    sessionId: string | null,
    workspacePath: string,
  ) => void;
  /** Move an open tab to a new position (drag-reorder in the tab strip). */
  moveTab: (
    engine: string,
    sessionId: string | null,
    workspacePath: string,
    toIndex: number,
  ) => void;
  startNewChat: (workspacePath: string) => void;
  setActiveEngine: (engine: string) => void;
  setPermission: (permission: ComposerPermission) => void;
  setEffort: (engine: string, effort: EffortLevel) => Promise<void>;
  setOmpServiceTier: (tier: OmpServiceTier) => Promise<void>;
  setCodexServiceTier: (tier: OmpServiceTier) => Promise<void>;
  setModel: (engine: string, model: string) => Promise<void>;
  /** Session-scoped channel. An existing conversation keeps the pick; only a
   *  pending new-chat tab also updates the engine default for the next chat. */
  setProvider: (engine: string, providerId: string) => Promise<void>;
  /** Pin several engines' models at once (startup defaulting); one settings
   * write instead of one per engine. */
  /** persist=false keeps the update session-scoped (remote-catalog resets
   *  must not rewrite the persisted default for local workspaces). */
  pinModels: (updates: Record<string, string>, persist?: boolean) => Promise<void>;
  setThreadLimit: (limit: number) => void;
  /** Create a named sidebar group; throws on empty/duplicate names. */
  createWorkspaceGroup: (name: string) => Promise<WorkspaceGroup | null>;
  /** Rename a group; throws on empty/duplicate names. */
  renameWorkspaceGroup: (id: string, name: string) => Promise<boolean>;
  /** Persist a new sidebar group order (ids in display order). */
  reorderWorkspaceGroups: (orderedIds: string[]) => Promise<void>;
  /** Delete a group; its workspaces fall back to ungrouped. */
  deleteWorkspaceGroup: (id: string) => Promise<void>;
  /** Put a workspace into a group (null = ungrouped). */
  assignWorkspaceGroup: (
    workspaceId: string,
    groupId: string | null,
  ) => Promise<void>;
  /** Set (or clear, null/empty/name-equal) the sidebar alias of a workspace. */
  setWorkspaceAlias: (
    workspaceId: string,
    alias: string | null,
  ) => Promise<void>;
  /** Move a workspace into / out of the sidebar's archived section. */
  setWorkspaceArchived: (
    workspaceId: string,
    archived: boolean,
  ) => Promise<void>;
  setSendShortcut: (shortcut: string) => void;
  setThinkingAutoCollapse: (autoCollapse: boolean) => void;
  setDraft: (key: string, text: string) => void;
  /** Ask the active composer to insert an @path mention at the caret. */
  requestMention: (path: string) => void;
  clearPendingMention: () => void;
  dismissActionError: () => void;
  /** Clear a session's turn/load error banner. */
  dismissSessionError: (key: string) => void;
  /** Surface a banner on a session without a send (e.g. a refused
   *  computer-use command); the composer keeps the user's draft. */
  setSessionError: (key: string, message: string) => void;
  loadEarlier: (key?: string) => Promise<void>;
  /** 发送。`target` 不传时发给当前激活会话；分屏里每格带上自己的会话。 */
  send: (
    prompt: string,
    images: string[],
    options?: SendOptions,
    target?: ActiveSession | null,
  ) => Promise<void>;
  /** Answer a permission-denial grant card: persist the directory grant
   * (accept) or mark the card declined. */
  respondToGrant: (key: string, seq: number, accept: boolean) => Promise<void>;
  /** Answer a pending AskUserQuestion card: send the picked labels (null =
   * skipped) to the parked CLI process via the control protocol. */
  respondToQuestion: (
    key: string,
    seq: number,
    answers: Record<string, string | string[]> | null,
  ) => Promise<void>;
  /** Submit a plan decision: optimistic `submitting`, then the backend CAS
   *  decides applied/conflict (expectedRevision stale = conflict, never a
   *  duplicate execution). Errors keep the revision open for a retry. */
  respondToPlanReview: (
    key: string,
    planId: string,
    expectedRevision: number,
    decision: PlanReviewDecision,
    feedback?: string,
  ) => Promise<PlanReviewRespondResult>;
  /** Reopen the approval dock for a deferred plan (its timeline card's
   *  「继续审批」), or clear the marker (null) once a decision lands. */
  resumePlanReview: (key: string, resume: string | null) => void;
  /** Re-send the session's last user message (grant card's one-click retry
   * after a directory grant takes effect on the next launch). */
  resendLastUser: (key: string) => Promise<void>;
  /** Enqueue a message while a turn streams (default: the active session). */
  queueMessage: (
    text: string,
    images: string[],
    options?: SendOptions,
    target?: ActiveSession | null,
  ) => void;
  /** Drop a queued message (default: the active session). */
  removeQueued: (id: string, key?: string) => void;
  /** Move a queued message one row up or down in the queue card; directions
   *  are screen-relative, see `QueueMoveDirection`. */
  moveQueued: (id: string, direction: QueueMoveDirection, key?: string) => void;
  /** Send one queued message now: it takes the head of the queue, and a
   *  running turn is stopped so the send is not left behind it. */
  sendQueuedNow: (id: string, key?: string) => Promise<void>;
  /** Drop every queued message from a session (default: the active one). */
  clearQueue: (key?: string) => void;
  /** Stop the running turn (default: the active session). */
  interrupt: (target?: ActiveSession | null) => Promise<void>;
  archiveSession: (session: SessionMeta) => Promise<void>;
  deleteSession: (engine: string, sessionId: string) => Promise<void>;
  pinSession: (
    engine: string,
    sessionId: string,
    pinned: boolean,
  ) => Promise<void>;
  renameSession: (
    engine: string,
    sessionId: string,
    title: string,
  ) => Promise<void>;
  /** Send /compact to compress conversation context. `trigger` records who
   *  asked: the composer action/command ("manual") or the per-session
   *  auto-compaction threshold ("threshold"). */
  compactContext: (
    key?: string,
    options?: { trigger?: "manual" | "threshold" },
  ) => Promise<void>;
  /** Re-fetch the latest token usage from session history for the current session. */
  refreshSessionUsage: (key?: string) => Promise<void>;
}
