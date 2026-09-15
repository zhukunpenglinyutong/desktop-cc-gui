import type { OmpServiceTier } from "@/lib/omp-service-tier";
import type {
  EngineInfo,
  SessionMeta,
  Workspace,
  WorkspaceGroup,
} from "@/lib/ipc";
import type { EffortLevel } from "@/components/application/ai-chat/cli-menu";
import type { ComposerPermission } from "@/components/application/ai-chat/permission-menu";
import type { ActiveSession } from "./persistence";
import type { SessionState } from "./stream";

export interface ChatStore {
  workspaces: Workspace[];
  sessions: SessionMeta[];
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

  init: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  /** Re-read engines + sessions after CLI config changes (enable switch,
   * channel edits): refreshes the picker's enabled set and re-filters the
   * history list, migrating the engine pref off a disabled CLI. */
  refreshEngines: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (path: string) => Promise<void>;
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
  pinModels: (updates: Record<string, string>) => Promise<void>;
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
  loadEarlier: () => Promise<void>;
  send: (prompt: string, images: string[]) => Promise<void>;
  /** Answer a permission-denial grant card: persist the directory grant
   * (accept) or mark the card declined. */
  respondToGrant: (key: string, seq: number, accept: boolean) => Promise<void>;
  /** Re-send the session's last user message (grant card's one-click retry
   * after a directory grant takes effect on the next launch). */
  resendLastUser: (key: string) => Promise<void>;
  /** Enqueue a message on the active session while a turn streams. */
  queueMessage: (text: string, images: string[]) => void;
  /** Drop a queued message from the active session. */
  removeQueued: (id: string) => void;
  /** Send one queued message now: it takes the head of the queue, and a
   *  running turn is stopped so the send is not left behind it. */
  sendQueuedNow: (id: string) => Promise<void>;
  /** Drop every queued message from the active session. */
  clearQueue: () => void;
  interrupt: () => Promise<void>;
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
  /** Send /compact to compress conversation context. */
  compactContext: (key?: string) => Promise<void>;
  /** Re-fetch the latest token usage from session history for the current session. */
  refreshSessionUsage: (key?: string) => Promise<void>;
}
