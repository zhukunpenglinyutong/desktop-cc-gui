import { ipc, type WorkspaceGroup } from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { newId } from "@/lib/id";
import { pruneMentionIndex } from "@/components/application/ai-chat/mention-files";
import { pruneSlashCommands } from "@/components/application/ai-chat/slash-commands";
import { persistTabs, sessionKey, type ActiveSession } from "./persistence";
import { persistSettings } from "./settings-persist";
import type { ChatStore } from "./types";
import type { StoreGet, StoreSet } from "./context";

/**
 * Workspace and sidebar management: workspace list ops and the sidebar's
 * groups / aliases / archived section (all persisted in app settings).
 */

export interface WorkspaceDeps {
  set: StoreSet;
  get: StoreGet;
  activateTab: (tab: ActiveSession | null) => void;
  forgetClosedTabs: (keys: Set<string>) => void;
}

export function createWorkspaceActions(
  deps: WorkspaceDeps,
): Pick<
  ChatStore,
  | "refreshWorkspaces"
  | "addWorkspace"
  | "reorderWorkspaces"
  | "removeWorkspace"
  | "createWorkspaceGroup"
  | "renameWorkspaceGroup"
  | "reorderWorkspaceGroups"
  | "deleteWorkspaceGroup"
  | "assignWorkspaceGroup"
  | "setWorkspaceAlias"
  | "setWorkspaceArchived"
> {
  const { set, get, activateTab, forgetClosedTabs } = deps;

  return {
    refreshWorkspaces: async () => {
      const workspaces = await ipc.listWorkspaces().catch(() => null);
      if (workspaces) set({ workspaces });
    },

    addWorkspace: async (path, meta) => {
      try {
        await ipc.addWorkspace(path, meta);
        await get().refreshWorkspaces();
        set({ actionError: null });
        // 登记失败只 set actionError 会让调用方以为成功：「新建会话」据此接着
        // 开出的待发会话会指向一个并未登记的目录，恰好复现输入框不可用的形态。
        // 返回成功与否，让调用方决定要不要往下走（错误条仍由这里负责）。
        return true;
      } catch (error) {
        set({ actionError: errorText(error) });
        return false;
      }
    },

    reorderWorkspaces: async (ids) => {
      // Optimistic: listed ids first in the given order, the rest keep their
      // relative order after them.
      const order = new Map(ids.map((id, index) => [id, index]));
      set((s) => ({
        workspaces: [...s.workspaces].sort(
          (a, b) =>
            (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        ),
      }));
      try {
        await ipc.reorderWorkspaces(ids);
      } catch {
        await get().refreshWorkspaces();
      }
    },

    removeWorkspace: async (id) => {
      try {
        const removedPath = get().workspaces.find((w) => w.id === id)?.path;
        await ipc.removeWorkspace(id);
        await get().refreshWorkspaces();
        set({ actionError: null });
        if (!removedPath) return;
        // The composer's per-root picker caches die with the workspace.
        pruneMentionIndex(removedPath);
        pruneSlashCommands(removedPath);
        // Evict cached session state belonging to the removed workspace:
        // real session keys come from the list cache, pending-chat keys
        // carry the path in the key itself.
        const dead = new Set<string>();
        for (const sess of get().sessions) {
          if (sess.workspacePath === removedPath) {
            dead.add(sessionKey(sess.engine, sess.sessionId, ""));
          }
        }
        const current = get();
        for (const key of [
          ...Object.keys(current.bySession),
          ...Object.keys(current.drafts),
          ...Object.keys(current.unseen),
        ]) {
          if (key.startsWith("new:") && key.endsWith(`:${removedPath}`)) {
            dead.add(key);
          }
        }
        if (dead.size > 0) {
          forgetClosedTabs(dead);
          set((s) => {
            const bySession = { ...s.bySession };
            const drafts = { ...s.drafts };
            const unseen = { ...s.unseen };
            for (const key of dead) {
              delete bySession[key];
              delete drafts[key];
              delete unseen[key];
            }
            return { bySession, drafts, unseen };
          });
        }
        const openTabs = get().openTabs.filter(
          (t) => t.workspacePath !== removedPath,
        );
        set({ openTabs });
        const active = get().active;
        if (active && active.workspacePath === removedPath) {
          activateTab(openTabs[0] ?? null);
        } else {
          persistTabs(openTabs, active);
        }
      } catch (error) {
        set({ actionError: errorText(error) });
      }
    },

    createWorkspaceGroup: async (name) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Group name is required.");
      const current = get().workspaceGroups;
      if (current.some((g) => g.name === trimmed)) {
        throw new Error("Group name already exists.");
      }
      const group: WorkspaceGroup = {
        id: newId(),
        name: trimmed,
        sortOrder:
          current.reduce((max, g) => Math.max(max, g.sortOrder ?? -1), -1) + 1,
      };
      const workspaceGroups = [...current, group];
      set({ workspaceGroups });
      await persistSettings((settings) => ({
        workspaceGroups: [...(settings.workspaceGroups ?? []), group],
      }));
      return group;
    },
    renameWorkspaceGroup: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Group name is required.");
      const current = get().workspaceGroups;
      if (current.some((g) => g.id !== id && g.name === trimmed)) {
        throw new Error("Group name already exists.");
      }
      set({
        workspaceGroups: current.map((g) =>
          g.id === id ? { ...g, name: trimmed } : g,
        ),
      });
      await persistSettings((settings) => ({
        workspaceGroups: (settings.workspaceGroups ?? []).map((g) =>
          g.id === id ? { ...g, name: trimmed } : g,
        ),
      }));
      return true;
    },
    reorderWorkspaceGroups: async (orderedIds) => {
      const current = get().workspaceGroups;
      const byId = new Map(current.map((g) => [g.id, g]));
      const ordered = orderedIds
        .map((id) => byId.get(id))
        .filter((g): g is WorkspaceGroup => Boolean(g));
      // Groups missing from the submitted order keep trailing positions.
      const orderedIdSet = new Set(orderedIds);
      const rest = current.filter((g) => !orderedIdSet.has(g.id));
      const workspaceGroups = [...ordered, ...rest].map((g, i) => ({
        ...g,
        sortOrder: i,
      }));
      set({ workspaceGroups });
      await persistSettings(() => ({ workspaceGroups }));
    },
    deleteWorkspaceGroup: async (id) => {
      const affected = get().workspaces.filter((w) => w.groupId === id);
      const workspaceGroups = get().workspaceGroups.filter((g) => g.id !== id);
      set({
        workspaceGroups,
        workspaces: get().workspaces.map((w) =>
          w.groupId === id ? { ...w, groupId: null } : w,
        ),
      });
      await persistSettings((settings) => ({
        workspaceGroups: (settings.workspaceGroups ?? []).filter(
          (g) => g.id !== id,
        ),
      }));
      // Members of the deleted group fall back to ungrouped.
      await Promise.all(
        affected.map((w) => ipc.setWorkspaceGroup(w.id, null).catch(() => {})),
      );
    },
    assignWorkspaceGroup: async (workspaceId, groupId) => {
      const valid =
        groupId && get().workspaceGroups.some((g) => g.id === groupId);
      const resolved = valid ? groupId : null;
      set({
        workspaces: get().workspaces.map((w) =>
          w.id === workspaceId ? { ...w, groupId: resolved } : w,
        ),
      });
      try {
        await ipc.setWorkspaceGroup(workspaceId, resolved);
      } catch (error) {
        // Roll back to the persisted truth.
        await get().refreshWorkspaces();
        throw error;
      }
    },
    setWorkspaceAlias: async (workspaceId, alias) => {
      // An alias equal to the folder name is no alias at all — same rule the
      // sidebar display applies — so it clears the entry instead of storing.
      const name = get().workspaces.find((w) => w.id === workspaceId)?.name;
      const trimmed = alias?.trim() ?? "";
      const resolved = trimmed && trimmed !== name ? trimmed : null;
      const workspaceAliases = { ...get().workspaceAliases };
      if (resolved) workspaceAliases[workspaceId] = resolved;
      else delete workspaceAliases[workspaceId];
      set({ workspaceAliases });
      await persistSettings((settings) => {
        const next = { ...(settings.workspaceAliases ?? {}) };
        if (resolved) next[workspaceId] = resolved;
        else delete next[workspaceId];
        return { workspaceAliases: next };
      });
    },
    setWorkspaceArchived: async (workspaceId, archived) => {
      const current = get().archivedWorkspaces;
      const archivedWorkspaces = archived
        ? current.includes(workspaceId)
          ? current
          : [...current, workspaceId]
        : current.filter((id) => id !== workspaceId);
      if (archivedWorkspaces === current) return;
      set({ archivedWorkspaces });
      await persistSettings((settings) => {
        const next = (settings.archivedWorkspaces ?? []).filter(
          (id) => id !== workspaceId,
        );
        if (archived) next.push(workspaceId);
        return { archivedWorkspaces: next };
      });
    },
  };
}
