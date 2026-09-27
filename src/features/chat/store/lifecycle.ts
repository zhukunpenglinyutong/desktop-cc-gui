import type { WorkspaceMetadata } from "@ccgui/plugin-sdk";
import type { Workspace } from "@/lib/ipc";
import type { ActiveSession } from "./persistence";
import {
  forgetSessionContributions,
  migrateSessionContributions,
} from "./session-contributions";
import type { StoreGet, StoreSet } from "./context";

/**
 * Plugin session-lifecycle plumbing shared by the store's action groups:
 * tabs (close), sessions (archive / restore) and messaging (send) all need the
 * same workspace identity and the same contribution bookkeeping. It lives here
 * rather than in one group so the three cannot drift apart — an event dispatched
 * with a different workspace id than the one a plugin was handed would look like
 * a different workspace to that plugin.
 */

/** Stable id for a workspace the host has not registered yet: normalize the
 * absolute path and hash it, so hooks still run and the same directory yields
 * the same identity across restarts. A registered workspace's own id always
 * wins (design §7 priority 1). */
function derivedWorkspaceId(workspacePath: string): string {
  const normalized = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `path-${hash.toString(16).padStart(8, "0")}`;
}

export function workspaceMetadata(
  workspaces: Workspace[],
  workspacePath: string,
): WorkspaceMetadata {
  const workspace = workspaces.find((candidate) => candidate.path === workspacePath);
  return workspace
    ? { id: workspace.id, path: workspace.path }
    : { id: derivedWorkspaceId(workspacePath), path: workspacePath };
}

/** Common envelope of every session lifecycle event (created/restored/closed). */
export function sessionLifecycleBase(
  get: StoreGet,
  tab: Pick<ActiveSession, "engine" | "sessionId" | "workspacePath">,
) {
  return {
    engine: tab.engine,
    sessionId: tab.sessionId,
    workspace: workspaceMetadata(get().workspaces, tab.workspacePath),
    occurredAt: new Date().toISOString(),
  };
}

/** A pending tab just adopted its native id: carry the remembered session
 * contributions from the placeholder scope onto the real one. */
export function adoptNativeContributions(
  set: StoreSet,
  engine: string,
  workspacePath: string,
  sessionId: string,
) {
  set((s) => {
    const next = migrateSessionContributions(
      s.sessionContributions,
      engine,
      workspacePath,
      sessionId,
    );
    return next ? { sessionContributions: next } : {};
  });
}

/** Drop a session's remembered contributions (tab closed, session deleted). */
export function clearScopedContributions(
  set: StoreSet,
  engine: string,
  sessionId: string | null,
  workspacePath: string,
) {
  set((s) => {
    const next = forgetSessionContributions(
      s.sessionContributions,
      engine,
      sessionId,
      workspacePath,
    );
    return next ? { sessionContributions: next } : {};
  });
}
