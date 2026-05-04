import { invoke } from "@tauri-apps/api/core";
import type {
  DiagnosticsBundleExportResult,
  RuntimePoolSnapshot,
  WorkspaceInfo,
  WorkspaceSettings,
} from "../../types";

export type WorktreeSetupStatus = {
  shouldRun: boolean;
  script: string | null;
};

export async function addWorkspace(
  path: string,
  codex_bin: string | null,
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("add_workspace", { path, codex_bin });
}

export async function isWorkspacePathDir(path: string): Promise<boolean> {
  return invoke<boolean>("is_workspace_path_dir", { path });
}

export async function ensureWorkspacePathDir(path: string): Promise<void> {
  return invoke("ensure_workspace_path_dir", { path });
}

export async function addClone(
  sourceWorkspaceId: string,
  copiesFolder: string,
  copyName: string,
): Promise<WorkspaceInfo> {
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

export async function getWorktreeSetupStatus(
  workspaceId: string,
): Promise<WorktreeSetupStatus> {
  return invoke<WorktreeSetupStatus>("worktree_setup_status", { workspaceId });
}

export async function markWorktreeSetupRan(workspaceId: string): Promise<void> {
  return invoke("worktree_setup_mark_ran", { workspaceId });
}

export async function updateWorkspaceSettings(
  id: string,
  settings: WorkspaceSettings,
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("update_workspace_settings", { id, settings });
}

export async function updateWorkspaceCodexBin(
  id: string,
  codex_bin: string | null,
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("update_workspace_codex_bin", { id, codex_bin });
}

export async function removeWorkspace(id: string): Promise<void> {
  return invoke("remove_workspace", { id });
}

export async function removeWorktree(id: string): Promise<void> {
  return invoke("remove_worktree", { id });
}

export async function renameWorktree(
  id: string,
  branch: string,
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("rename_worktree", { id, branch });
}

export async function renameWorktreeUpstream(
  id: string,
  oldBranch: string,
  newBranch: string,
): Promise<void> {
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

export async function writePanelLockPasswordFile(
  password: string,
): Promise<void> {
  return invoke("client_panel_lock_password_write", { password });
}

export async function connectWorkspace(
  id: string,
  recoverySource?: string,
): Promise<void> {
  return invoke("connect_workspace", { id, recoverySource });
}

export async function ensureRuntimeReady(
  workspaceId: string,
): Promise<void> {
  return invoke("ensure_runtime_ready", { workspaceId });
}

export async function getRuntimePoolSnapshot(): Promise<RuntimePoolSnapshot> {
  return invoke("get_runtime_pool_snapshot");
}

export async function exportDiagnosticsBundle(): Promise<DiagnosticsBundleExportResult> {
  return invoke("export_diagnostics_bundle");
}

export async function mutateRuntimePool(mutation: {
  action: "close" | "releaseToCold" | "pin";
  workspaceId: string;
  engine?: string;
  pinned?: boolean;
}): Promise<RuntimePoolSnapshot> {
  const { workspaceId, ...rest } = mutation;
  return invoke("mutate_runtime_pool", {
    mutation: {
      ...rest,
      workspace_id: workspaceId,
    },
  });
}
