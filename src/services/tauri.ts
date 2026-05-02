import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  EmailSendError,
  EmailSenderSettingsView,
  EmailSendResult,
  SendConversationCompletionEmailRequest,
  SendTestEmailRequest,
  UpdateEmailSenderSettingsRequest,
  LocalUsageSnapshot,
  LocalUsageStatistics,
  RuntimePoolSnapshot,
  DiagnosticsBundleExportResult,
  WorkspaceInfo,
  WorkspaceSettings,
  EngineStatus,
  EngineType,
  EngineModelInfo,
  CustomPromptOption,
} from "../types";
import type {
  GitFileDiff,
  GitFileStatus,
  GitHistoryResponse,
  GitCommitDetails,
  GitCommitDiff,
  GitBranchCompareCommitSets,
  GitBranchListResponse,
  GitBranchUpdateResult,
  GitPrWorkflowDefaults,
  GitPrWorkflowResult,
  GitHubIssuesResponse,
  GitHubPullRequestComment,
  GitHubPullRequestDiff,
  GitHubPullRequestsResponse,
  GitLogResponse,
  GitPushPreviewResponse,
  ReviewTarget,
} from "../types";
export type {
  WorkspaceSessionCatalogEntry,
  WorkspaceSessionCatalogQuery,
  WorkspaceSessionCatalogPage,
  WorkspaceSessionProjectionSummary,
  WorkspaceSessionBatchMutationResult,
  WorkspaceSessionBatchMutationResponse,
} from "./tauri/sessionManagement";
export {
  archiveWorkspaceSessions,
  deleteWorkspaceSessions,
  getWorkspaceSessionProjectionSummary,
  listGlobalCodexSessions,
  listProjectRelatedCodexSessions,
  listWorkspaceSessions,
  unarchiveWorkspaceSessions,
} from "./tauri/sessionManagement";
export type { CodexRuntimeReloadResult } from "./tauri/settings";
export { getCodexConfigPath, getCodexUnifiedExecExternalStatus, reloadCodexRuntimeConfig, restoreCodexUnifiedExecOfficialDefault, setCodexUnifiedExecOfficialOverride } from "./tauri/settings";
export { getComputerUseBridgeStatus, runComputerUseActivationProbe, runComputerUseCodexBroker, runComputerUseHostContractDiagnostics } from "./tauri/computerUse";
export { runClaudeDoctor, runCodexDoctor } from "./tauri/doctor";
export type {
  ComputerUseActivationFailureKind,
  ComputerUseActivationOutcome,
  ComputerUseActivationResult,
  ComputerUseAuthorizationBackendMode,
  ComputerUseAuthorizationContinuityKind,
  ComputerUseAuthorizationContinuityStatus,
  ComputerUseAuthorizationHostRole,
  ComputerUseAuthorizationHostSnapshot,
  ComputerUseAuthorizationLaunchMode,
  ComputerUseBrokerFailureKind,
  ComputerUseBrokerOutcome,
  ComputerUseBrokerRequest,
  ComputerUseBrokerResult,
  ComputerUseBridgeStatus,
  ComputerUseHostContractDiagnosticsKind,
  ComputerUseHostContractDiagnosticsResult,
  ComputerUseHostContractEvidence,
  ComputerUseOfficialParentHandoffDiscovery,
  ComputerUseOfficialParentHandoffEvidence,
  ComputerUseOfficialParentHandoffKind,
  ComputerUseOfficialParentHandoffMethod,
} from "../types";
export {
  cancelDictation,
  cancelDictationDownload,
  downloadDictationModel,
  getDictationModelStatus,
  removeDictationModel,
  requestDictationPermission,
  startDictation,
  stopDictation,
} from "./tauri/dictation";
export {
  closeTerminalSession,
  openTerminalSession,
  resizeTerminalSession,
  runtimeLogDetectProfiles,
  runtimeLogGetSession,
  runtimeLogMarkExit,
  runtimeLogStart,
  runtimeLogStop,
  writeTerminalSession,
} from "./tauri/terminalRuntime";
export type { RuntimeLogSessionSnapshot, RuntimeLogSessionStatus, RuntimeProfileDescriptor } from "./tauri/terminalRuntime";
export {
  projectMemoryCaptureAuto,
  projectMemoryCreate,
  projectMemoryDelete,
  projectMemoryGet,
  projectMemoryGetSettings,
  projectMemoryList,
  projectMemoryUpdate,
  projectMemoryUpdateSettings,
} from "./tauri/projectMemory";
export type { ProjectMemoryItem, ProjectMemoryListResult, ProjectMemorySettings } from "./tauri/projectMemory";
export {
  noteCardArchive,
  noteCardCreate,
  noteCardDelete,
  noteCardGet,
  noteCardList,
  noteCardRestore,
  noteCardUpdate,
} from "./tauri/noteCards";
export type {
  NoteCardAttachment,
  NoteCardPreviewAttachment,
  WorkspaceNoteCard,
  WorkspaceNoteCardListResult,
  WorkspaceNoteCardSummary,
} from "./tauri/noteCards";
export {
  addClaudeProvider,
  addCodexProvider,
  deleteClaudeProvider,
  deleteCodexProvider,
  getClaudeAlwaysThinkingEnabled,
  getClaudeProviders,
  getCodexProviders,
  getCurrentClaudeConfig,
  getGeminiVendorPreflight,
  getGeminiVendorSettings,
  saveGeminiVendorSettings,
  setClaudeAlwaysThinkingEnabled,
  switchClaudeProvider,
  switchCodexProvider,
  updateClaudeProvider,
  updateCodexProvider,
} from "./tauri/vendors";
export type { GeminiVendorPreflightCheck, GeminiVendorPreflightResult, GeminiVendorSettings } from "./tauri/vendors";
export {
  addAgentConfig,
  applyImportAgentConfigs,
  deleteAgentConfig,
  exportAgentConfigs,
  getSelectedAgentConfig,
  listAgentConfigs,
  previewImportAgentConfigs,
  setSelectedAgentConfig,
  updateAgentConfig,
} from "./tauri/agents";

function isMissingTauriInvokeError(error: unknown) {
  return error instanceof TypeError && (error.message.includes("reading 'invoke'") || error.message.includes('reading "invoke"'));
}

const WEB_SERVICE_CLI_ENGINE_MESSAGE = "Web 服务当前仅支持 Codex CLI。请切换到 Codex CLI（Web service currently supports Codex CLI only）.";
let daemonEngineRpcSupported: boolean | null = null;

function normalizeInvokeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isUnknownMethodError(error: unknown, method: string): boolean {
  return normalizeInvokeErrorMessage(error).toLowerCase().includes(`unknown method: ${method}`);
}

function shouldUseWebServiceFallback(): boolean {
  return isWebServiceRuntime();
}

export function isWebServiceRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.__MOSSX_WEB_SERVICE__ === true;
}

function isEngineRpcFallbackMode(): boolean {
  return shouldUseWebServiceFallback() && daemonEngineRpcSupported === false;
}

function webServiceEngineFeatures(engineType: EngineType): EngineStatus["features"] {
  if (engineType === "codex") {
    return {
      streaming: true,
      reasoning: true,
      toolUse: true,
      imageInput: true,
      sessionContinuation: true,
    };
  }
  return {
    streaming: true,
    reasoning: true,
    toolUse: true,
    imageInput: false,
    sessionContinuation: true,
  };
}

function webServiceCodexOnlyStatuses(): EngineStatus[] {
  const types: EngineType[] = ["claude", "codex", "gemini", "opencode"];
  return types.map((engineType) => ({
    engineType,
    installed: engineType === "codex",
    version: engineType === "codex" ? "web-service" : null,
    binPath: null,
    features: webServiceEngineFeatures(engineType),
    models: [],
    error: engineType === "codex" ? null : WEB_SERVICE_CLI_ENGINE_MESSAGE,
  }));
}

export async function pickWorkspacePath(): Promise<string | null> {
  const selection = await open({ directory: true, multiple: false });
  if (!selection || Array.isArray(selection)) {
    return null;
  }
  return selection;
}

export async function pickImageFiles(): Promise<string[]> {
  const selection = await open({
    multiple: true,
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif"],
      },
    ],
  });
  if (!selection) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

export async function pickFiles(): Promise<string[]> {
  const selection = await open({
    multiple: true,
  });
  if (!selection) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  try {
    return await invoke<WorkspaceInfo[]>("list_workspaces");
  } catch (error) {
    if (isMissingTauriInvokeError(error)) {
      // In non-Tauri environments (e.g., Electron/web previews), the invoke
      // bridge may be missing. Treat this as "no workspaces" instead of crashing.
      console.warn("Tauri invoke bridge unavailable; returning empty workspaces list.");
      return [];
    }
    throw error;
  }
}

type RpcObject = Record<string, unknown>;

export interface ThreadListResultPayload extends RpcObject {
  data?: unknown[];
  nextCursor?: string | null;
  next_cursor?: string | null;
  partialSource?: string;
  partial_source?: string;
}

export interface ThreadListPayload extends RpcObject {
  result?: ThreadListResultPayload;
  data?: unknown[];
  nextCursor?: string | null;
  next_cursor?: string | null;
}

export interface ClaudeSessionSummaryPayload {
  sessionId: string;
  firstMessage: string;
  updatedAt: number;
  fileSizeBytes?: number;
}

export type TextFileResponse = {
  exists: boolean;
  content: string;
  truncated: boolean;
};

export type GlobalAgentsResponse = TextFileResponse;
export type GlobalCodexConfigResponse = TextFileResponse;
export type GlobalCodexAuthResponse = TextFileResponse;
export type AgentMdResponse = TextFileResponse;

type FileScope = "workspace" | "global";
type FileKind = "agents" | "claude" | "config" | "auth";

async function fileRead(scope: FileScope, kind: FileKind, workspaceId?: string): Promise<TextFileResponse> {
  return invoke<TextFileResponse>("file_read", { scope, kind, workspaceId });
}

async function fileWrite(scope: FileScope, kind: FileKind, content: string, workspaceId?: string): Promise<void> {
  return invoke("file_write", { scope, kind, workspaceId, content });
}

export async function readGlobalAgentsMd(): Promise<GlobalAgentsResponse> {
  return fileRead("global", "agents");
}

export async function writeGlobalAgentsMd(content: string): Promise<void> {
  return fileWrite("global", "agents", content);
}

export async function readGlobalCodexConfigToml(): Promise<GlobalCodexConfigResponse> {
  return fileRead("global", "config");
}

export async function writeGlobalCodexConfigToml(content: string): Promise<void> {
  return fileWrite("global", "config", content);
}

export async function readGlobalCodexAuthJson(): Promise<GlobalCodexAuthResponse> {
  return fileRead("global", "auth");
}

export async function getConfigModel(workspaceId: string): Promise<string | null> {
  const response = await invoke<{ model?: string | null }>("get_config_model", {
    workspaceId,
  });
  const model = response?.model;
  if (typeof model !== "string") {
    return null;
  }
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function addWorkspace(path: string, codex_bin: string | null): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("add_workspace", { path, codex_bin });
}

export async function isWorkspacePathDir(path: string): Promise<boolean> {
  return invoke<boolean>("is_workspace_path_dir", { path });
}

export async function ensureWorkspacePathDir(path: string): Promise<void> {
  return invoke("ensure_workspace_path_dir", { path });
}

export async function addClone(sourceWorkspaceId: string, copiesFolder: string, copyName: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("add_clone", {
    sourceWorkspaceId,
    copiesFolder,
    copyName,
  });
}

export async function addWorktree(
  parentId: string,
  branch: string,
  options?: {
    baseRef?: string | null;
    publishToOrigin?: boolean;
  },
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("add_worktree", {
    parentId,
    branch,
    baseRef: options?.baseRef ?? null,
    publishToOrigin: options?.publishToOrigin ?? true,
  });
}

export type WorktreeSetupStatus = {
  shouldRun: boolean;
  script: string | null;
};

export async function getWorktreeSetupStatus(workspaceId: string): Promise<WorktreeSetupStatus> {
  return invoke<WorktreeSetupStatus>("worktree_setup_status", { workspaceId });
}

export async function markWorktreeSetupRan(workspaceId: string): Promise<void> {
  return invoke("worktree_setup_mark_ran", { workspaceId });
}

export async function updateWorkspaceSettings(id: string, settings: WorkspaceSettings): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("update_workspace_settings", { id, settings });
}

export async function updateWorkspaceCodexBin(id: string, codex_bin: string | null): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("update_workspace_codex_bin", { id, codex_bin });
}

export async function removeWorkspace(id: string): Promise<void> {
  return invoke("remove_workspace", { id });
}

export async function removeWorktree(id: string): Promise<void> {
  return invoke("remove_worktree", { id });
}

export async function renameWorktree(id: string, branch: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("rename_worktree", { id, branch });
}

export async function renameWorktreeUpstream(id: string, oldBranch: string, newBranch: string): Promise<void> {
  return invoke("rename_worktree_upstream", { id, oldBranch, newBranch });
}

export async function applyWorktreeChanges(workspaceId: string): Promise<void> {
  return invoke("apply_worktree_changes", { workspaceId });
}

export async function openWorkspaceIn(
  path: string,
  options: {
    appName?: string | null;
    command?: string | null;
    args?: string[];
  },
): Promise<void> {
  return invoke("open_workspace_in", {
    path,
    app: options.appName ?? null,
    command: options.command ?? null,
    args: options.args ?? [],
  });
}

export async function openNewWindow(path?: string | null): Promise<void> {
  return invoke("open_new_window", {
    path: path ?? null,
  });
}

export async function getOpenAppIcon(appName: string): Promise<string | null> {
  return invoke<string | null>("get_open_app_icon", { appName });
}

export async function readPanelLockPasswordFile(): Promise<string | null> {
  return invoke<string | null>("client_panel_lock_password_read");
}

export async function writePanelLockPasswordFile(password: string): Promise<void> {
  return invoke("client_panel_lock_password_write", { password });
}

export async function connectWorkspace(id: string, recoverySource?: string): Promise<void> {
  return invoke("connect_workspace", { id, recoverySource });
}

export async function ensureRuntimeReady(workspaceId: string): Promise<void> {
  return invoke("ensure_runtime_ready", { workspaceId });
}

export async function getRuntimePoolSnapshot(): Promise<RuntimePoolSnapshot> {
  return invoke("get_runtime_pool_snapshot");
}

export async function exportDiagnosticsBundle(): Promise<DiagnosticsBundleExportResult> {
  return invoke("export_diagnostics_bundle");
}

export async function mutateRuntimePool(mutation: { action: "close" | "releaseToCold" | "pin"; workspaceId: string; engine?: string; pinned?: boolean }): Promise<RuntimePoolSnapshot> {
  const { workspaceId, ...rest } = mutation;
  return invoke("mutate_runtime_pool", {
    mutation: {
      ...rest,
      workspace_id: workspaceId,
    },
  });
}

export async function startThread(workspaceId: string) {
  return invoke<Record<string, unknown> | null | undefined>("start_thread", {
    workspaceId,
  });
}

export async function forkThread(workspaceId: string, threadId: string, messageId?: string | null) {
  return invoke<Record<string, unknown> | null | undefined>("fork_thread", {
    workspaceId,
    threadId,
    messageId: messageId ?? null,
  });
}

export async function rewindCodexThread(
  workspaceId: string,
  threadId: string,
  targetUserTurnIndex: number,
  messageId?: string | null,
  rewindHint?: {
    targetUserMessageText?: string | null;
    targetUserMessageOccurrence?: number | null;
    localUserMessageCount?: number | null;
  },
) {
  const normalizedTargetUserTurnIndex = Number.isFinite(targetUserTurnIndex) ? Math.trunc(targetUserTurnIndex) : Number.NaN;
  if (!(normalizedTargetUserTurnIndex >= 1)) {
    throw new Error("targetUserTurnIndex must be >= 1 for codex rewind");
  }
  const normalizedMessageId = typeof messageId === "string" ? messageId.trim() : "";
  const targetUserMessageText = typeof rewindHint?.targetUserMessageText === "string" ? rewindHint.targetUserMessageText.trim() : "";
  const targetUserMessageOccurrence =
    typeof rewindHint?.targetUserMessageOccurrence === "number" && Number.isFinite(rewindHint.targetUserMessageOccurrence) ? Math.trunc(rewindHint.targetUserMessageOccurrence) : null;
  const localUserMessageCount = typeof rewindHint?.localUserMessageCount === "number" && Number.isFinite(rewindHint.localUserMessageCount) ? Math.trunc(rewindHint.localUserMessageCount) : null;

  return invoke<Record<string, unknown> | null | undefined>("rewind_codex_thread", {
    workspaceId,
    threadId,
    messageId: normalizedMessageId || null,
    targetUserTurnIndex: normalizedTargetUserTurnIndex,
    ...(targetUserMessageText ? { targetUserMessageText } : {}),
    ...(targetUserMessageOccurrence && targetUserMessageOccurrence > 0 ? { targetUserMessageOccurrence } : {}),
    ...(localUserMessageCount && localUserMessageCount > 0 ? { localUserMessageCount } : {}),
  });
}

export async function sendUserMessage(
  workspaceId: string,
  threadId: string,
  text: string,
  options?: {
    model?: string | null;
    effort?: string | null;
    accessMode?: "default" | "read-only" | "current" | "full-access";
    images?: string[];
    collaborationMode?: Record<string, unknown> | null;
    preferredLanguage?: string | null;
    customSpecRoot?: string | null;
    resumeSource?: "queue-fusion-cutover" | null;
    resumeTurnId?: string | null;
  },
) {
  const payload: Record<string, unknown> = {
    workspaceId,
    threadId,
    text,
    model: options?.model ?? null,
    effort: options?.effort ?? null,
    accessMode: options?.accessMode ?? null,
    images: options?.images ?? null,
    preferredLanguage: options?.preferredLanguage ?? null,
    resumeSource: options?.resumeSource ?? null,
    resumeTurnId: options?.resumeTurnId ?? null,
  };
  if (options?.customSpecRoot !== undefined) {
    payload.customSpecRoot = options.customSpecRoot;
  }
  if (options?.collaborationMode) {
    payload.collaborationMode = options.collaborationMode;
  }
  return invoke("send_user_message", payload);
}

export async function interruptTurn(workspaceId: string, threadId: string, turnId: string) {
  return invoke("turn_interrupt", { workspaceId, threadId, turnId });
}

export async function engineInterruptTurn(workspaceId: string, turnId: string, engine?: EngineType | null): Promise<void> {
  return invoke("engine_interrupt_turn", {
    workspaceId,
    turnId,
    engine: engine ?? null,
  });
}

export async function compactThreadContext(workspaceId: string, threadId: string) {
  return invoke("thread_compact", { workspaceId, threadId });
}

export async function startReview(workspaceId: string, threadId: string, target: ReviewTarget, delivery?: "inline" | "detached") {
  const payload: Record<string, unknown> = { workspaceId, threadId, target };
  if (delivery) {
    payload.delivery = delivery;
  }
  return invoke("start_review", payload);
}

export async function respondToServerRequest(workspaceId: string, requestId: number | string, decision: "accept" | "decline") {
  return invoke("respond_to_server_request", {
    workspaceId,
    requestId,
    result: { decision },
  });
}

export async function respondToUserInputRequest(
  workspaceId: string,
  requestId: number | string,
  answers: Record<string, { answers: string[] }>,
  options?: { threadId?: string | null; turnId?: string | null },
) {
  return invoke("respond_to_server_request", {
    workspaceId,
    requestId,
    result: { answers },
    threadId: options?.threadId ?? null,
    turnId: options?.turnId ?? null,
  });
}

export async function rememberApprovalRule(workspaceId: string, command: string[]) {
  return invoke("remember_approval_rule", { workspaceId, command });
}

export async function getGitStatus(workspace_id: string): Promise<{
  branchName: string;
  files: GitFileStatus[];
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  totalAdditions: number;
  totalDeletions: number;
}> {
  return invoke("get_git_status", { workspaceId: workspace_id });
}

export async function listGitRoots(workspace_id: string, depth: number): Promise<string[]> {
  return invoke("list_git_roots", { workspaceId: workspace_id, depth });
}

export async function getGitDiffs(workspace_id: string): Promise<GitFileDiff[]> {
  return invoke("get_git_diffs", { workspaceId: workspace_id });
}

export async function getGitFileFullDiff(workspace_id: string, path: string): Promise<string> {
  return invoke("get_git_file_full_diff", { workspaceId: workspace_id, path });
}

export async function getGitLog(workspace_id: string, limit = 40): Promise<GitLogResponse> {
  return invoke("get_git_log", { workspaceId: workspace_id, limit });
}

export async function getGitCommitHistory(
  workspace_id: string,
  options?: {
    branch?: string | null;
    query?: string | null;
    author?: string | null;
    dateFrom?: number | null;
    dateTo?: number | null;
    snapshotId?: string | null;
    offset?: number;
    limit?: number;
  },
): Promise<GitHistoryResponse> {
  return invoke("get_git_commit_history", {
    workspaceId: workspace_id,
    branch: options?.branch ?? null,
    query: options?.query ?? null,
    author: options?.author ?? null,
    dateFrom: options?.dateFrom ?? null,
    dateTo: options?.dateTo ?? null,
    snapshotId: options?.snapshotId ?? null,
    offset: options?.offset ?? 0,
    limit: options?.limit ?? 100,
  });
}

export async function getGitPushPreview(
  workspace_id: string,
  options: {
    remote: string;
    branch: string;
    limit?: number;
  },
): Promise<GitPushPreviewResponse> {
  return invoke("get_git_push_preview", {
    workspaceId: workspace_id,
    remote: options.remote,
    branch: options.branch,
    limit: options.limit ?? 120,
  });
}

export type CreateGitPrWorkflowOptions = {
  upstreamRepo: string;
  baseBranch: string;
  headOwner: string;
  headBranch: string;
  title: string;
  body?: string | null;
  commentAfterCreate?: boolean;
  commentBody?: string | null;
};

export async function getGitPrWorkflowDefaults(workspaceId: string): Promise<GitPrWorkflowDefaults> {
  return invoke<GitPrWorkflowDefaults>("get_git_pr_workflow_defaults", {
    workspaceId,
  });
}

export async function createGitPrWorkflow(workspaceId: string, options: CreateGitPrWorkflowOptions): Promise<GitPrWorkflowResult> {
  return invoke<GitPrWorkflowResult>("create_git_pr_workflow", {
    workspaceId,
    upstreamRepo: options.upstreamRepo,
    baseBranch: options.baseBranch,
    headOwner: options.headOwner,
    headBranch: options.headBranch,
    title: options.title,
    body: options.body ?? null,
    commentAfterCreate: options.commentAfterCreate ?? null,
    commentBody: options.commentBody ?? null,
  });
}

export async function resolveGitCommitRef(workspace_id: string, target: string): Promise<string> {
  return invoke("resolve_git_commit_ref", {
    workspaceId: workspace_id,
    target,
  });
}

export async function getGitCommitDetails(workspace_id: string, commitHash: string, maxDiffLines = 10_000): Promise<GitCommitDetails> {
  return invoke("get_git_commit_details", {
    workspaceId: workspace_id,
    commitHash,
    maxDiffLines,
  });
}

export async function getGitCommitDiff(
  workspace_id: string,
  sha: string,
  options?: {
    path?: string | null;
    contextLines?: number;
  },
): Promise<GitCommitDiff[]> {
  return invoke("get_git_commit_diff", {
    workspaceId: workspace_id,
    sha,
    path: options?.path ?? null,
    contextLines: options?.contextLines ?? null,
  });
}

export async function getGitRemote(workspace_id: string): Promise<string | null> {
  return invoke("get_git_remote", { workspaceId: workspace_id });
}

export async function stageGitFile(workspaceId: string, path: string) {
  return invoke("stage_git_file", { workspaceId, path });
}

export async function stageGitAll(workspaceId: string): Promise<void> {
  return invoke("stage_git_all", { workspaceId });
}

export async function unstageGitFile(workspaceId: string, path: string) {
  return invoke("unstage_git_file", { workspaceId, path });
}

export async function revertGitFile(workspaceId: string, path: string) {
  return invoke("revert_git_file", { workspaceId, path });
}

export async function revertGitAll(workspaceId: string) {
  return invoke("revert_git_all", { workspaceId });
}

export async function commitGit(workspaceId: string, message: string): Promise<void> {
  return invoke("commit_git", { workspaceId, message });
}

export type GitPushOptions = {
  remote?: string | null;
  branch?: string | null;
  forceWithLease?: boolean;
  pushTags?: boolean;
  runHooks?: boolean;
  pushToGerrit?: boolean;
  topic?: string | null;
  reviewers?: string | null;
  cc?: string | null;
};

export type GitPullStrategyOption = "--rebase" | "--ff-only" | "--no-ff" | "--squash";

export type GitPullOptions = {
  remote?: string | null;
  branch?: string | null;
  strategy?: GitPullStrategyOption | null;
  noCommit?: boolean;
  noVerify?: boolean;
};

export async function pushGit(workspaceId: string, options?: GitPushOptions): Promise<void> {
  return invoke("push_git", {
    workspaceId,
    remote: options?.remote ?? null,
    branch: options?.branch ?? null,
    forceWithLease: options?.forceWithLease ?? null,
    pushTags: options?.pushTags ?? null,
    runHooks: options?.runHooks ?? null,
    pushToGerrit: options?.pushToGerrit ?? null,
    topic: options?.topic ?? null,
    reviewers: options?.reviewers ?? null,
    cc: options?.cc ?? null,
  });
}

export async function pullGit(workspaceId: string, options?: GitPullOptions): Promise<void> {
  return invoke("pull_git", {
    workspaceId,
    remote: options?.remote ?? null,
    branch: options?.branch ?? null,
    strategy: options?.strategy ?? null,
    noCommit: options?.noCommit ?? null,
    noVerify: options?.noVerify ?? null,
  });
}

export async function syncGit(workspaceId: string): Promise<void> {
  return invoke("sync_git", { workspaceId });
}

export async function fetchGit(workspaceId: string, remote?: string | null): Promise<void> {
  return invoke("git_fetch", { workspaceId, remote: remote ?? null });
}

export async function updateGitBranch(workspaceId: string, branchName: string): Promise<GitBranchUpdateResult> {
  return invoke<GitBranchUpdateResult>("update_git_branch", { workspaceId, branchName });
}

export async function cherryPickCommit(workspaceId: string, commitHash: string): Promise<void> {
  return invoke("cherry_pick_commit", { workspaceId, commitHash });
}

export async function revertCommit(workspaceId: string, commitHash: string): Promise<void> {
  return invoke("revert_commit", { workspaceId, commitHash });
}

export type GitResetMode = "soft" | "mixed" | "hard" | "keep";

export async function resetGitCommit(workspaceId: string, commitHash: string, mode: GitResetMode): Promise<void> {
  return invoke("reset_git_commit", { workspaceId, commitHash, mode });
}

export async function getGitHubIssues(workspace_id: string): Promise<GitHubIssuesResponse> {
  return invoke("get_github_issues", { workspaceId: workspace_id });
}

export async function getGitHubPullRequests(workspace_id: string): Promise<GitHubPullRequestsResponse> {
  return invoke("get_github_pull_requests", { workspaceId: workspace_id });
}

export async function getGitHubPullRequestDiff(workspace_id: string, prNumber: number): Promise<GitHubPullRequestDiff[]> {
  return invoke("get_github_pull_request_diff", {
    workspaceId: workspace_id,
    prNumber,
  });
}

export async function getGitHubPullRequestComments(workspace_id: string, prNumber: number): Promise<GitHubPullRequestComment[]> {
  return invoke("get_github_pull_request_comments", {
    workspaceId: workspace_id,
    prNumber,
  });
}

export async function localUsageSnapshot(days?: number, workspacePath?: string | null): Promise<LocalUsageSnapshot> {
  const payload: { days: number; workspacePath?: string } = {
    days: days ?? 30,
  };
  if (workspacePath) {
    payload.workspacePath = workspacePath;
  }
  return invoke("local_usage_snapshot", payload);
}

export async function localUsageStatistics(input: {
  scope: "current" | "all";
  provider?: string | null;
  dateRange: "7d" | "30d" | "all";
  workspacePath?: string | null;
}): Promise<LocalUsageStatistics> {
  return invoke<LocalUsageStatistics>("local_usage_statistics", {
    scope: input.scope,
    provider: input.provider ?? "all",
    dateRange: input.dateRange,
    workspacePath: input.workspacePath ?? null,
  });
}

export async function getModelList(workspaceId: string) {
  return invoke<{
    data?: Record<string, unknown>[];
    result?: { data?: Record<string, unknown>[]; [key: string]: unknown };
    [key: string]: unknown;
  }>("model_list", { workspaceId });
}

export async function generateRunMetadata(workspaceId: string, prompt: string) {
  return invoke<{ title: string; worktreeName: string }>("generate_run_metadata", {
    workspaceId,
    prompt,
  });
}

export async function getCollaborationModes(workspaceId: string) {
  return invoke<{
    data?: Record<string, unknown>[];
    result?: { data?: Record<string, unknown>[]; [key: string]: unknown };
    [key: string]: unknown;
  }>("collaboration_mode_list", { workspaceId });
}

export async function getAccountRateLimits(workspaceId: string) {
  return invoke<{
    rateLimits?: unknown;
    rate_limits?: unknown;
    result?: {
      rateLimits?: unknown;
      rate_limits?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>("account_rate_limits", { workspaceId });
}

export async function getAccountInfo(workspaceId: string) {
  return invoke<Record<string, unknown> | null>("account_read", {
    workspaceId,
  });
}

export async function runCodexLogin(workspaceId: string) {
  return invoke<{ output: string }>("codex_login", { workspaceId });
}

export async function cancelCodexLogin(workspaceId: string) {
  return invoke<{ canceled: boolean }>("codex_login_cancel", { workspaceId });
}

export async function getSkillsList(workspaceId: string) {
  return invoke<unknown>("skills_list", { workspaceId });
}

export async function getClaudeCommandsList(workspaceId?: string | null) {
  return invoke<unknown>("claude_commands_list", {
    workspaceId: workspaceId ?? null,
  });
}

export async function getOpenCodeCommandsList(refresh = false) {
  return invoke<unknown>("opencode_commands_list", { refresh });
}

export async function getOpenCodeAgentsList(refresh = false) {
  return invoke<unknown>("opencode_agents_list", { refresh });
}

export async function getOpenCodeSessionList(workspaceId: string) {
  return invoke<
    Array<{
      sessionId: string;
      title: string;
      updatedLabel: string;
      updatedAt?: number | null;
    }>
  >("opencode_session_list", { workspaceId });
}

export async function getOpenCodeStats(workspaceId: string, days?: number | null) {
  return invoke<string>("opencode_stats", {
    workspaceId,
    days: days ?? null,
  });
}

export async function exportOpenCodeSession(workspaceId: string, sessionId: string, outputPath?: string | null) {
  return invoke<{ sessionId: string; filePath: string }>("opencode_export_session", {
    workspaceId,
    sessionId,
    outputPath: outputPath ?? null,
  });
}

export async function importOpenCodeSession(workspaceId: string, source: string) {
  return invoke<{ sessionId?: string | null; source: string; output: string }>("opencode_import_session", {
    workspaceId,
    source,
  });
}

export async function shareOpenCodeSession(workspaceId: string, sessionId: string) {
  return invoke<{ sessionId: string; url: string }>("opencode_share_session", {
    workspaceId,
    sessionId,
  });
}

export async function getOpenCodeMcpStatus(workspaceId: string) {
  return invoke<{ text: string }>("opencode_mcp_status", { workspaceId });
}

export async function getOpenCodeProviderHealth(workspaceId: string, provider?: string | null) {
  return invoke<{
    provider: string;
    connected: boolean;
    credentialCount: number;
    matched: boolean;
    authenticatedProviders?: string[];
    error?: string | null;
  }>("opencode_provider_health", {
    workspaceId,
    provider: provider ?? null,
  });
}

export async function getOpenCodeProviderCatalog(workspaceId: string) {
  return invoke<
    Array<{
      id: string;
      label: string;
      description?: string | null;
      category: "popular" | "other";
      recommended: boolean;
    }>
  >("opencode_provider_catalog", { workspaceId });
}

export async function connectOpenCodeProvider(workspaceId: string, providerId?: string | null) {
  return invoke<{
    started: boolean;
    providerId?: string | null;
    command?: string | null;
  }>("opencode_provider_connect", {
    workspaceId,
    providerId: providerId ?? null,
  });
}

export async function getOpenCodeStatusSnapshot(input: { workspaceId: string; threadId?: string | null; model?: string | null; agent?: string | null; variant?: string | null }) {
  return invoke<{
    sessionId?: string | null;
    model?: string | null;
    agent?: string | null;
    variant?: string | null;
    provider?: string | null;
    providerHealth: {
      provider: string;
      connected: boolean;
      credentialCount: number;
      matched: boolean;
      authenticatedProviders?: string[];
      error?: string | null;
    };
    mcpEnabled: boolean;
    mcpServers: Array<{
      name: string;
      enabled: boolean;
      status?: string | null;
      permissionHint?: string | null;
    }>;
    mcpRaw: string;
    managedToggles: boolean;
    tokenUsage?: number | null;
    contextWindow?: number | null;
  }>("opencode_status_snapshot", {
    workspaceId: input.workspaceId,
    threadId: input.threadId ?? null,
    model: input.model ?? null,
    agent: input.agent ?? null,
    variant: input.variant ?? null,
  });
}

export async function setOpenCodeMcpToggle(
  workspaceId: string,
  input: {
    serverName?: string | null;
    enabled?: boolean | null;
    globalEnabled?: boolean | null;
  },
) {
  return invoke<{
    workspaceId: string;
    mcpEnabled: boolean;
    serverStates: Record<string, boolean>;
    managedToggles: boolean;
  }>("opencode_mcp_toggle", {
    workspaceId,
    serverName: input.serverName ?? null,
    enabled: input.enabled ?? null,
    globalEnabled: input.globalEnabled ?? null,
  });
}

export async function getOpenCodeLspDiagnostics(workspaceId: string, filePath: string) {
  return invoke<{ filePath: string; result: unknown }>("opencode_lsp_diagnostics", {
    workspaceId,
    filePath,
  });
}

export async function getOpenCodeLspSymbols(workspaceId: string, query: string) {
  return invoke<{ query: string; result: unknown }>("opencode_lsp_symbols", {
    workspaceId,
    query,
  });
}

export async function getOpenCodeLspDocumentSymbols(workspaceId: string, fileUri: string) {
  return invoke<{ fileUri: string; result: unknown }>("opencode_lsp_document_symbols", {
    workspaceId,
    fileUri,
  });
}

export async function getCodeIntelDefinition(
  workspaceId: string,
  input: {
    filePath: string;
    line: number;
    character: number;
  },
) {
  return invoke<{
    filePath: string;
    line: number;
    character: number;
    result: unknown;
  }>("code_intel_definition", {
    workspaceId,
    filePath: input.filePath,
    line: input.line,
    character: input.character,
  });
}

export async function getCodeIntelReferences(
  workspaceId: string,
  input: {
    filePath: string;
    line: number;
    character: number;
    includeDeclaration?: boolean;
  },
) {
  return invoke<{
    filePath: string;
    line: number;
    character: number;
    includeDeclaration: boolean;
    result: unknown;
  }>("code_intel_references", {
    workspaceId,
    filePath: input.filePath,
    line: input.line,
    character: input.character,
    includeDeclaration: input.includeDeclaration ?? false,
  });
}

export type LspPosition = {
  line: number;
  character: number;
};

export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

export type LspLocation = {
  uri: string;
  range: LspRange;
};

export async function getOpenCodeLspDefinition(
  workspaceId: string,
  input: {
    fileUri: string;
    line: number;
    character: number;
  },
) {
  return invoke<{
    fileUri: string;
    line: number;
    character: number;
    result: unknown;
  }>("opencode_lsp_definition", {
    workspaceId,
    fileUri: input.fileUri,
    line: input.line,
    character: input.character,
  });
}

export async function getOpenCodeLspReferences(
  workspaceId: string,
  input: {
    fileUri: string;
    line: number;
    character: number;
    includeDeclaration?: boolean;
  },
) {
  return invoke<{
    fileUri: string;
    line: number;
    character: number;
    includeDeclaration: boolean;
    result: unknown;
  }>("opencode_lsp_references", {
    workspaceId,
    fileUri: input.fileUri,
    line: input.line,
    character: input.character,
    includeDeclaration: input.includeDeclaration ?? false,
  });
}

export async function getPromptsList(workspaceId: string): Promise<CustomPromptOption[]> {
  return invoke<CustomPromptOption[]>("prompts_list", { workspaceId });
}

export async function getWorkspacePromptsDir(workspaceId: string) {
  return invoke<string>("prompts_workspace_dir", { workspaceId });
}

export async function getGlobalPromptsDir(workspaceId: string) {
  return invoke<string>("prompts_global_dir", { workspaceId });
}

export async function createPrompt(
  workspaceId: string,
  data: {
    scope: "workspace" | "global";
    name: string;
    description?: string | null;
    argumentHint?: string | null;
    content: string;
  },
): Promise<CustomPromptOption> {
  return invoke<CustomPromptOption>("prompts_create", {
    workspaceId,
    scope: data.scope,
    name: data.name,
    description: data.description ?? null,
    argumentHint: data.argumentHint ?? null,
    content: data.content,
  });
}

export async function updatePrompt(
  workspaceId: string,
  data: {
    path: string;
    name: string;
    description?: string | null;
    argumentHint?: string | null;
    content: string;
  },
): Promise<CustomPromptOption> {
  return invoke<CustomPromptOption>("prompts_update", {
    workspaceId,
    path: data.path,
    name: data.name,
    description: data.description ?? null,
    argumentHint: data.argumentHint ?? null,
    content: data.content,
  });
}

export async function deletePrompt(workspaceId: string, path: string): Promise<void> {
  return invoke<void>("prompts_delete", { workspaceId, path });
}

export async function movePrompt(workspaceId: string, data: { path: string; scope: "workspace" | "global" }): Promise<CustomPromptOption> {
  return invoke<CustomPromptOption>("prompts_move", {
    workspaceId,
    path: data.path,
    scope: data.scope,
  });
}

export async function getAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_app_settings");
}

export async function updateAppSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>("update_app_settings", { settings });
}

const EMAIL_SEND_ERROR_PREFIX = "EMAIL_SEND_ERROR:";

function normalizeEmailSendError(error: unknown): EmailSendError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(EMAIL_SEND_ERROR_PREFIX)) {
    try {
      return JSON.parse(message.slice(EMAIL_SEND_ERROR_PREFIX.length)) as EmailSendError;
    } catch {
      // Fall through to a generic structured error.
    }
  }
  return {
    code: "unknown",
    retryable: false,
    userMessage: message || "Email command failed.",
  };
}

async function invokeEmailCommand<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    throw normalizeEmailSendError(error);
  }
}

export async function getEmailSenderSettings(): Promise<EmailSenderSettingsView> {
  return invokeEmailCommand<EmailSenderSettingsView>("get_email_sender_settings");
}

export async function updateEmailSenderSettings(
  request: UpdateEmailSenderSettingsRequest,
): Promise<EmailSenderSettingsView> {
  return invokeEmailCommand<EmailSenderSettingsView>("update_email_sender_settings", {
    request,
  });
}

export async function sendTestEmail(
  request: SendTestEmailRequest,
): Promise<EmailSendResult> {
  return invokeEmailCommand<EmailSendResult>("send_test_email", { request });
}

export async function sendConversationCompletionEmail(
  request: SendConversationCompletionEmailRequest,
): Promise<EmailSendResult> {
  return invokeEmailCommand<EmailSendResult>("send_conversation_completion_email", { request });
}

export type WebServerStatus = {
  running: boolean;
  rpcEndpoint: string;
  webPort: number;
  addresses: string[];
  webAccessToken: string | null;
  lastError?: string | null;
};

export type DaemonStatus = {
  running: boolean;
  host: string;
  lastError?: string | null;
};

export async function startWebServer(options: { port?: number | null; token?: string | null }): Promise<WebServerStatus> {
  return invoke<WebServerStatus>("start_web_server", {
    port: options.port ?? null,
    token: options.token ?? null,
  });
}

export async function stopWebServer(): Promise<WebServerStatus> {
  return invoke<WebServerStatus>("stop_web_server");
}

export async function getWebServerStatus(): Promise<WebServerStatus> {
  return invoke<WebServerStatus>("get_web_server_status");
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("get_daemon_status");
}

export async function startDaemon(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("start_daemon");
}

export async function stopDaemon(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("stop_daemon");
}

type MenuAcceleratorUpdate = {
  id: string;
  accelerator: string | null;
};

export async function setMenuAccelerators(updates: MenuAcceleratorUpdate[]): Promise<void> {
  return invoke("menu_set_accelerators", { updates });
}

type MenuLabelUpdate = {
  id: string;
  text: string;
};

export async function updateMenuLabels(updates: MenuLabelUpdate[]): Promise<void> {
  return invoke("menu_update_labels", { updates });
}

export type WorkspaceFilesResponse = {
  files: string[];
  directories: string[];
  gitignored_files: string[];
  gitignored_directories: string[];
};

export type WorkspaceTextSearchMatch = {
  line: number;
  column: number;
  end_column: number;
  preview: string;
};

export type WorkspaceTextSearchFileResult = {
  path: string;
  match_count: number;
  matches: WorkspaceTextSearchMatch[];
};

export type WorkspaceTextSearchResponse = {
  files: WorkspaceTextSearchFileResult[];
  file_count: number;
  match_count: number;
  limit_hit: boolean;
};

export type ExternalSpecFileResponse = {
  exists: boolean;
  content: string;
  truncated: boolean;
};

export type DetachedExternalChangeMonitorStatus = {
  mode: "watcher" | "polling";
  fallbackReason?: string | null;
};

export async function getWorkspaceFiles(workspaceId: string) {
  return invoke<WorkspaceFilesResponse>("list_workspace_files", {
    workspaceId,
  });
}

export async function getWorkspaceDirectoryChildren(workspaceId: string, path: string) {
  return invoke<WorkspaceFilesResponse>("list_workspace_directory_children", {
    workspaceId,
    path,
  });
}

export async function listExternalAbsoluteDirectoryChildren(workspaceId: string, path: string) {
  return invoke<WorkspaceFilesResponse>("list_external_absolute_directory_children", {
    workspaceId,
    path,
  });
}

export async function searchWorkspaceText(
  workspaceId: string,
  options: {
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    isRegex: boolean;
    includePattern?: string | null;
    excludePattern?: string | null;
  },
) {
  return invoke<WorkspaceTextSearchResponse>("search_workspace_text", {
    workspaceId,
    query: options.query,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    isRegex: options.isRegex,
    includePattern: options.includePattern ?? null,
    excludePattern: options.excludePattern ?? null,
  });
}

export async function listExternalSpecTree(workspaceId: string, specRoot: string) {
  return invoke<WorkspaceFilesResponse>("list_external_spec_tree", {
    workspaceId,
    specRoot,
  });
}

export async function readWorkspaceFile(workspaceId: string, path: string): Promise<{ content: string; truncated: boolean }> {
  return invoke<{ content: string; truncated: boolean }>("read_workspace_file", {
    workspaceId,
    path,
  });
}

export async function readExternalSpecFile(workspaceId: string, specRoot: string, path: string): Promise<ExternalSpecFileResponse> {
  return invoke<ExternalSpecFileResponse>("read_external_spec_file", {
    workspaceId,
    specRoot,
    path,
  });
}

export async function readExternalAbsoluteFile(workspaceId: string, path: string): Promise<{ content: string; truncated: boolean }> {
  return invoke<{ content: string; truncated: boolean }>("read_external_absolute_file", {
    workspaceId,
    path,
  });
}

export type FilePreviewHandle = {
  absolutePath: string;
  byteLength: number;
  extension: string | null;
};

export async function resolveFilePreviewHandle(
  workspaceId: string,
  options: {
    domain: "workspace" | "external-spec" | "external-absolute";
    path: string;
    specRoot?: string | null;
  },
): Promise<FilePreviewHandle> {
  return invoke<FilePreviewHandle>("resolve_file_preview_handle", {
    workspaceId,
    domain: options.domain,
    path: options.path,
    specRoot: options.specRoot ?? null,
  });
}

export async function readLocalImageDataUrl(workspaceId: string, path: string): Promise<string | null> {
  try {
    const result = await invoke<string>("read_local_image_data_url", {
      workspaceId,
      path,
    });
    return typeof result === "string" && result.startsWith("data:image/") ? result : null;
  } catch (error) {
    if (isUnknownMethodError(error, "read_local_image_data_url")) {
      return null;
    }
    return null;
  }
}

export async function writeWorkspaceFile(workspaceId: string, path: string, content: string): Promise<void> {
  return invoke("write_workspace_file", { workspaceId, path, content });
}

export type ExportRewindFilesParams = {
  workspaceId: string;
  engine: "claude" | "codex" | "gemini";
  sessionId: string;
  targetMessageId: string;
  conversationLabel: string;
  files: Array<{
    path: string;
    status?: "A" | "D" | "R" | "M";
  }>;
};

export type ExportRewindFilesResult = {
  outputPath: string;
  filesPath: string;
  manifestPath: string;
  exportId: string;
  fileCount: number;
};

export async function exportRewindFiles(params: ExportRewindFilesParams): Promise<ExportRewindFilesResult> {
  return invoke<ExportRewindFilesResult>("export_rewind_files", params);
}

export async function createWorkspaceDirectory(workspaceId: string, path: string): Promise<void> {
  return invoke("create_workspace_directory", { workspaceId, path });
}

export async function writeExternalSpecFile(workspaceId: string, specRoot: string, path: string, content: string): Promise<void> {
  return invoke("write_external_spec_file", {
    workspaceId,
    specRoot,
    path,
    content,
  });
}

export async function writeExternalAbsoluteFile(workspaceId: string, path: string, content: string): Promise<void> {
  return invoke("write_external_absolute_file", { workspaceId, path, content });
}

export async function trashWorkspaceItem(workspaceId: string, path: string): Promise<void> {
  return invoke("trash_workspace_item", { workspaceId, path });
}

export async function copyWorkspaceItem(workspaceId: string, path: string): Promise<string> {
  return invoke("copy_workspace_item", { workspaceId, path });
}

export async function configureDetachedExternalChangeMonitor(
  workspaceId: string,
  workspacePath: string,
  activeFilePath: string,
  watcherEnabled: boolean,
): Promise<DetachedExternalChangeMonitorStatus> {
  return invoke<DetachedExternalChangeMonitorStatus>("configure_detached_external_change_monitor", {
    workspaceId,
    workspacePath,
    activeFilePath,
    watcherEnabled,
  });
}

export async function clearDetachedExternalChangeMonitor(workspaceId: string): Promise<void> {
  return invoke("clear_detached_external_change_monitor", { workspaceId });
}

export type WorkspaceCommandResult = {
  command: string[];
  exitCode: number;
  success: boolean;
  stdout: string;
  stderr: string;
};

export async function runWorkspaceCommand(workspaceId: string, command: string[], timeoutMs?: number | null): Promise<WorkspaceCommandResult> {
  return invoke<WorkspaceCommandResult>("run_workspace_command", {
    workspaceId,
    command,
    timeoutMs: timeoutMs ?? null,
  });
}

export async function runSpecCommand(
  workspaceId: string,
  command: string[],
  options?: {
    customSpecRoot?: string | null;
    timeoutMs?: number | null;
  },
): Promise<WorkspaceCommandResult> {
  return invoke<WorkspaceCommandResult>("run_spec_command", {
    workspaceId,
    command,
    customSpecRoot: options?.customSpecRoot ?? null,
    timeoutMs: options?.timeoutMs ?? null,
  });
}

export async function readAgentMd(workspaceId: string): Promise<AgentMdResponse> {
  return fileRead("workspace", "agents", workspaceId);
}

export async function writeAgentMd(workspaceId: string, content: string): Promise<void> {
  return fileWrite("workspace", "agents", content, workspaceId);
}

export type ClaudeMdResponse = TextFileResponse;

export async function readClaudeMd(workspaceId: string): Promise<ClaudeMdResponse> {
  return fileRead("workspace", "claude", workspaceId);
}

export async function writeClaudeMd(workspaceId: string, content: string): Promise<void> {
  return fileWrite("workspace", "claude", content, workspaceId);
}

export async function listGitBranches(workspaceId: string): Promise<GitBranchListResponse> {
  return invoke<GitBranchListResponse>("list_git_branches", { workspaceId });
}

export async function checkoutGitBranch(workspaceId: string, name: string) {
  return invoke("checkout_git_branch", { workspaceId, name });
}

export async function createGitBranch(workspaceId: string, name: string) {
  return invoke("create_git_branch", { workspaceId, name });
}

export async function createGitBranchFromBranch(workspaceId: string, name: string, sourceBranch: string) {
  return invoke("create_git_branch_from_branch", {
    workspaceId,
    name,
    sourceBranch,
  });
}

export async function createGitBranchFromCommit(workspaceId: string, name: string, commitHash: string) {
  return invoke("create_git_branch_from_commit", {
    workspaceId,
    name,
    commitHash,
  });
}

export async function deleteGitBranch(
  workspaceId: string,
  name: string,
  options?: {
    force?: boolean;
    removeOccupiedWorktree?: boolean;
  },
) {
  return invoke("delete_git_branch", {
    workspaceId,
    name,
    force: options?.force ?? false,
    removeOccupiedWorktree: options?.removeOccupiedWorktree ?? false,
  });
}

export async function renameGitBranch(workspaceId: string, oldName: string, newName: string) {
  return invoke("rename_git_branch", { workspaceId, oldName, newName });
}

export async function mergeGitBranch(workspaceId: string, name: string) {
  return invoke("merge_git_branch", { workspaceId, name });
}

export async function rebaseGitBranch(workspaceId: string, ontoBranch: string) {
  return invoke("rebase_git_branch", { workspaceId, ontoBranch });
}

export async function getGitBranchCompareCommits(workspaceId: string, targetBranch: string, currentBranch: string, limit = 200): Promise<GitBranchCompareCommitSets> {
  return invoke<GitBranchCompareCommitSets>("get_git_branch_compare_commits", {
    workspaceId,
    targetBranch,
    currentBranch,
    limit,
  });
}

export async function getGitBranchDiffBetweenBranches(workspaceId: string, fromBranch: string, toBranch: string): Promise<GitCommitDiff[]> {
  return invoke<GitCommitDiff[]>("get_git_branch_diff_between_branches", {
    workspaceId,
    fromBranch,
    toBranch,
  });
}

export async function getGitBranchDiffFileBetweenBranches(workspaceId: string, fromBranch: string, toBranch: string, path: string): Promise<GitCommitDiff> {
  return invoke<GitCommitDiff>("get_git_branch_file_diff_between_branches", {
    workspaceId,
    fromBranch,
    toBranch,
    path,
  });
}

export async function getGitWorktreeDiffAgainstBranch(workspaceId: string, branch: string): Promise<GitCommitDiff[]> {
  return invoke<GitCommitDiff[]>("get_git_worktree_diff_against_branch", {
    workspaceId,
    branch,
  });
}

export async function getGitWorktreeDiffFileAgainstBranch(workspaceId: string, branch: string, path: string): Promise<GitCommitDiff> {
  return invoke<GitCommitDiff>("get_git_worktree_file_diff_against_branch", {
    workspaceId,
    branch,
    path,
  });
}

export async function listThreads(workspaceId: string, cursor?: string | null, limit?: number | null) {
  return invoke<ThreadListPayload | null | undefined>("list_threads", {
    workspaceId,
    cursor,
    limit,
  });
}

export async function listMcpServerStatus(workspaceId: string, cursor?: string | null, limit?: number | null) {
  return invoke<unknown>("list_mcp_server_status", {
    workspaceId,
    cursor,
    limit,
  });
}

export type GlobalMcpServerEntry = {
  name: string;
  enabled: boolean;
  transport?: string | null;
  command?: string | null;
  url?: string | null;
  argsCount: number;
  source: "claude_json" | "ccgui_config";
};

export async function listGlobalMcpServers() {
  return invoke<GlobalMcpServerEntry[]>("list_global_mcp_servers");
}

export async function resumeThread(workspaceId: string, threadId: string) {
  return invoke<Record<string, unknown> | null>("resume_thread", {
    workspaceId,
    threadId,
  });
}

export async function archiveThread(workspaceId: string, threadId: string) {
  return invoke<Record<string, unknown> | null>("archive_thread", {
    workspaceId,
    threadId,
  });
}

export async function deleteCodexSession(workspaceId: string, sessionId: string) {
  return invoke<{
    deleted: boolean;
    deletedCount: number;
    method: "filesystem";
    archivedBeforeDelete?: boolean;
  }>("delete_codex_session", {
    workspaceId,
    sessionId,
  });
}
export async function deleteCodexSessions(workspaceId: string, sessionIds: string[]) {
  return invoke<{
    results: Array<{
      sessionId: string;
      deleted: boolean;
      deletedCount: number;
      method: "filesystem";
      archivedBeforeDelete?: boolean;
      error?: string | null;
    }>;
  }>("delete_codex_sessions", {
    workspaceId,
    sessionIds,
  });
}
export async function deleteOpenCodeSession(workspaceId: string, sessionId: string) {
  return invoke<{ deleted: boolean; method: "cli" | "filesystem" }>("opencode_delete_session", { workspaceId, sessionId });
}

export type CommitMessageLanguage = "zh" | "en";
export type CommitMessageEngine = EngineType;

export async function getCommitMessagePrompt(
  workspaceId: string,
  language: CommitMessageLanguage = "zh",
  selectedPaths?: string[],
): Promise<string> {
  return invoke("get_commit_message_prompt", { workspaceId, language, selectedPaths });
}

export async function generateCommitMessage(
  workspaceId: string,
  language: CommitMessageLanguage = "zh",
  selectedPaths?: string[],
): Promise<string> {
  return invoke("generate_commit_message", { workspaceId, language, selectedPaths });
}

export async function generateCommitMessageWithEngine(
  workspaceId: string,
  language: CommitMessageLanguage = "zh",
  engine: CommitMessageEngine = "codex",
  selectedPaths?: string[],
): Promise<string> {
  if (engine === "codex") {
    return generateCommitMessage(workspaceId, language, selectedPaths);
  }
  const prompt = await getCommitMessagePrompt(workspaceId, language, selectedPaths);
  const response = await engineSendMessageSync(workspaceId, {
    text: prompt,
    engine,
  });
  return response.text;
}

export async function listThreadTitles(workspaceId: string): Promise<Record<string, string>> {
  return invoke("list_thread_titles", { workspaceId });
}

export async function setThreadTitle(workspaceId: string, threadId: string, title: string): Promise<string> {
  return invoke("set_thread_title", { workspaceId, threadId, title });
}

export async function renameThreadTitleKey(workspaceId: string, oldThreadId: string, newThreadId: string): Promise<void> {
  return invoke("rename_thread_title_key", {
    workspaceId,
    oldThreadId,
    newThreadId,
  });
}

export async function generateThreadTitle(workspaceId: string, threadId: string, userMessage: string, preferredLanguage?: "zh" | "en"): Promise<string> {
  return invoke("generate_thread_title", {
    workspaceId,
    threadId,
    userMessage,
    preferredLanguage: preferredLanguage ?? null,
  });
}

// ==================== Engine API ====================

/**
 * Detect all installed engines and their status
 */
export async function detectEngines(): Promise<EngineStatus[]> {
  try {
    const statuses = await invoke<EngineStatus[]>("detect_engines");
    daemonEngineRpcSupported = true;
    return statuses;
  } catch (error) {
    if (isUnknownMethodError(error, "detect_engines")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      daemonEngineRpcSupported = false;
      return webServiceCodexOnlyStatuses();
    }
    throw error;
  }
}

/**
 * Get the currently active engine type
 */
export async function getActiveEngine(): Promise<EngineType> {
  try {
    const engine = await invoke<EngineType>("get_active_engine");
    daemonEngineRpcSupported = true;
    return engine;
  } catch (error) {
    if (isUnknownMethodError(error, "get_active_engine")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      daemonEngineRpcSupported = false;
      return "codex";
    }
    throw error;
  }
}

/**
 * Switch to a different engine
 */
export async function switchEngine(engineType: EngineType): Promise<void> {
  if (isEngineRpcFallbackMode() && engineType !== "codex") {
    throw new Error(WEB_SERVICE_CLI_ENGINE_MESSAGE);
  }
  try {
    await invoke("switch_engine", { engineType });
    daemonEngineRpcSupported = true;
    return;
  } catch (error) {
    if (isUnknownMethodError(error, "switch_engine")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      daemonEngineRpcSupported = false;
      if (engineType === "codex") {
        return;
      }
      throw new Error(WEB_SERVICE_CLI_ENGINE_MESSAGE);
    }
    throw error;
  }
}

/**
 * Get status of a specific engine
 */
export async function getEngineStatus(engineType: EngineType): Promise<EngineStatus | null> {
  try {
    const status = await invoke<EngineStatus | null>("get_engine_status", {
      engineType,
    });
    daemonEngineRpcSupported = true;
    return status;
  } catch (error) {
    if (isUnknownMethodError(error, "get_engine_status")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      daemonEngineRpcSupported = false;
      return webServiceCodexOnlyStatuses().find((entry) => entry.engineType === engineType) ?? null;
    }
    throw error;
  }
}

/**
 * Get available models for a specific engine
 */
export async function getEngineModels(
  engineType: EngineType,
  options: { forceRefresh?: boolean } = {},
): Promise<EngineModelInfo[]> {
  if (isEngineRpcFallbackMode() && engineType !== "codex") {
    return [];
  }
  try {
    const params: { engineType: EngineType; forceRefresh?: boolean } = {
      engineType,
    };
    if (options.forceRefresh) {
      params.forceRefresh = true;
    }
    const models = await invoke<EngineModelInfo[]>("get_engine_models", params);
    daemonEngineRpcSupported = true;
    return models;
  } catch (error) {
    if (isUnknownMethodError(error, "get_engine_models")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      daemonEngineRpcSupported = false;
      return [];
    }
    throw error;
  }
}

/**
 * Send a message using an engine
 */
export async function engineSendMessage(
  workspaceId: string,
  params: {
    text: string;
    engine?: EngineType | null;
    model?: string | null;
    effort?: string | null;
    images?: string[] | null;
    continueSession?: boolean;
    sessionId?: string | null;
    accessMode?: string | null;
    threadId?: string | null;
    agent?: string | null;
    variant?: string | null;
    customSpecRoot?: string | null;
  },
): Promise<Record<string, unknown>> {
  if (isEngineRpcFallbackMode() && params.engine && params.engine !== "codex") {
    return {
      error: {
        message: WEB_SERVICE_CLI_ENGINE_MESSAGE,
      },
    };
  }
  try {
    return await invoke<Record<string, unknown>>("engine_send_message", {
      workspaceId,
      text: params.text,
      engine: params.engine ?? null,
      model: params.model ?? null,
      effort: params.effort ?? null,
      images: params.images ?? null,
      continueSession: params.continueSession ?? false,
      accessMode: params.accessMode ?? null,
      threadId: params.threadId ?? null,
      sessionId: params.sessionId ?? null,
      agent: params.agent ?? null,
      variant: params.variant ?? null,
      customSpecRoot: params.customSpecRoot ?? null,
    });
  } catch (error) {
    if (isUnknownMethodError(error, "engine_send_message")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      daemonEngineRpcSupported = false;
      return {
        error: {
          message: WEB_SERVICE_CLI_ENGINE_MESSAGE,
        },
      };
    }
    throw error;
  }
}

/**
 * Send a message using an engine and wait for a final plain-text response.
 */
export async function engineSendMessageSync(
  workspaceId: string,
  params: {
    text: string;
    engine?: EngineType | null;
    model?: string | null;
    effort?: string | null;
    images?: string[] | null;
    continueSession?: boolean;
    sessionId?: string | null;
    accessMode?: string | null;
    agent?: string | null;
    variant?: string | null;
    customSpecRoot?: string | null;
  },
): Promise<{ engine: EngineType; text: string }> {
  if (isEngineRpcFallbackMode() && params.engine && params.engine !== "codex") {
    throw new Error(WEB_SERVICE_CLI_ENGINE_MESSAGE);
  }
  try {
    return await invoke<{ engine: EngineType; text: string }>("engine_send_message_sync", {
      workspaceId,
      text: params.text,
      engine: params.engine ?? null,
      model: params.model ?? null,
      effort: params.effort ?? null,
      images: params.images ?? null,
      continueSession: params.continueSession ?? false,
      accessMode: params.accessMode ?? null,
      sessionId: params.sessionId ?? null,
      agent: params.agent ?? null,
      variant: params.variant ?? null,
      customSpecRoot: params.customSpecRoot ?? null,
    });
  } catch (error) {
    if (isUnknownMethodError(error, "engine_send_message_sync")) {
      if (!shouldUseWebServiceFallback()) {
        throw error;
      }
      daemonEngineRpcSupported = false;
      throw new Error(WEB_SERVICE_CLI_ENGINE_MESSAGE);
    }
    throw error;
  }
}

/**
 * Interrupt the current engine operation
 */
export async function engineInterrupt(workspaceId: string): Promise<void> {
  return invoke("engine_interrupt", { workspaceId });
}

/**
 * List Claude Code session history for a workspace path.
 * Reads JSONL files from ~/.claude/projects/{encoded-path}/.
 */
export async function listClaudeSessions(workspacePath: string, limit?: number | null): Promise<ClaudeSessionSummaryPayload[] | Record<string, unknown> | null | undefined> {
  return invoke<ClaudeSessionSummaryPayload[] | Record<string, unknown> | null | undefined>("list_claude_sessions", {
    workspacePath,
    limit: limit ?? null,
  });
}

/**
 * Load full message history for a specific Claude Code session.
 */
export async function loadClaudeSession(workspacePath: string, sessionId: string): Promise<Record<string, unknown> | null> {
  return invoke<Record<string, unknown> | null>("load_claude_session", {
    workspacePath,
    sessionId,
  });
}

/**
 * List Gemini CLI session history for a workspace path.
 */
export async function listGeminiSessions(workspacePath: string, limit?: number | null): Promise<Record<string, unknown> | unknown[] | null> {
  return invoke<Record<string, unknown> | unknown[] | null>("list_gemini_sessions", {
    workspacePath,
    limit: limit ?? null,
  });
}

/**
 * Load full message history for a specific Gemini CLI session.
 */
export async function loadGeminiSession(workspacePath: string, sessionId: string): Promise<Record<string, unknown> | null> {
  return invoke<Record<string, unknown> | null>("load_gemini_session", {
    workspacePath,
    sessionId,
  });
}

/**
 * Load full Codex local session history for a specific workspace/session.
 */
export async function loadCodexSession(workspaceId: string, sessionId: string): Promise<Record<string, unknown> | null> {
  return invoke<Record<string, unknown> | null>("load_codex_session", {
    workspaceId,
    sessionId,
  });
}

/**
 * Fork a Claude Code session into a new session id.
 */
export async function forkClaudeSession(workspacePath: string, sessionId: string): Promise<Record<string, unknown> | null> {
  return invoke<Record<string, unknown> | null>("fork_claude_session", {
    workspacePath,
    sessionId,
  });
}

/**
 * Fork a Claude Code session from a target user message.
 */
export async function forkClaudeSessionFromMessage(workspacePath: string, sessionId: string, messageId: string): Promise<Record<string, unknown> | null> {
  return invoke<Record<string, unknown> | null>("fork_claude_session_from_message", {
    workspacePath,
    sessionId,
    messageId,
  });
}

/**
 * Delete a Claude Code session (remove JSONL file from disk).
 */
export async function deleteClaudeSession(workspacePath: string, sessionId: string): Promise<void> {
  return invoke<void>("delete_claude_session", {
    workspacePath,
    sessionId,
  });
}

/**
 * Delete a Gemini CLI session (remove session JSON file from disk).
 */
export async function deleteGeminiSession(workspacePath: string, sessionId: string): Promise<void> {
  return invoke<void>("delete_gemini_session", {
    workspacePath,
    sessionId,
  });
}

/**
 * Get and clear any pending paths that were passed to the app on launch
 * (via drag-drop to app icon or command line arguments)
 */
export async function getPendingOpenPaths(): Promise<string[]> {
  return invoke<string[]>("get_pending_open_paths");
}
