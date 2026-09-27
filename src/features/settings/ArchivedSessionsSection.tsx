import { useCallback, useEffect, useMemo, useState } from "react";
import type { Key } from "react";
import { useTranslation } from "react-i18next";
import ArchiveRestore from "lucide-react/dist/esm/icons/archive-restore";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Button } from "@/components/base/buttons/button";
import { Select, SelectItem } from "@/components/base/select/select";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { ConfirmDialog } from "@/components/dialogs";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { listenSessionsChanged } from "@/lib/events";
import { ipc, type SessionMeta } from "@/lib/ipc";
import { useChatStore } from "@/features/chat/store";

const ALL_WORKSPACES = "*";

const sessionTitle = (session: SessionMeta) =>
  session.customTitle || session.title || session.sessionId.slice(0, 8);

const pathName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).at(-1) || path;

/** Settings archive manager: app-owned markers hide sessions without moving
 * native CLI files. The archived snapshot keeps remote/plugin sessions
 * restorable and deletable even though they have no local history row. */
export function ArchivedSessionsSection() {
  const { t, i18n } = useTranslation();
  const workspaces = useChatStore((s) => s.workspaces);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [workspacePath, setWorkspacePath] = useState(ALL_WORKSPACES);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SessionMeta | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSessions(await ipc.listArchivedSessions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unlisten = listenSessionsChanged(() => void refresh());
    return () => {
      void unlisten.then((off) => off());
    };
  }, [refresh]);

  // Building an Intl formatter is slow; do it once per locale, not per row.
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );
  const workspaceLabels = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.path, workspace.name])),
    [workspaces],
  );
  const workspacePaths = useMemo(
    () => [...new Set(sessions.map((session) => session.workspacePath))],
    [sessions],
  );
  const grouped = useMemo(() => {
    const filtered =
      workspacePath === ALL_WORKSPACES
        ? sessions
        : sessions.filter((session) => session.workspacePath === workspacePath);
    const groups = new Map<string, SessionMeta[]>();
    for (const session of filtered) {
      const list = groups.get(session.workspacePath) ?? [];
      list.push(session);
      groups.set(session.workspacePath, list);
    }
    return [...groups.entries()];
  }, [sessions, workspacePath]);

  const run = async (session: SessionMeta, action: () => Promise<void>) => {
    const key = `${session.engine}/${session.sessionId}`;
    setBusyKey(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const restore = (session: SessionMeta) =>
    run(session, () => ipc.restoreSession(session.engine, session.sessionId));

  const permanentlyDelete = (session: SessionMeta) =>
    run(session, async () => {
      if (session.remote && session.remotePath) {
        await ipc.deleteRemoteSession(
          session.workspacePath,
          session.engine,
          session.sessionId,
          session.remotePath,
        );
        // Remote rows have no local sessions-table record, so their archive
        // marker is cleared explicitly after the original remote delete path.
        await ipc.restoreSession(session.engine, session.sessionId);
      } else {
        // Local deletion also removes the archive marker in the same DB tx.
        await ipc.deleteSession(session.engine, session.sessionId);
      }
    });

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <SettingsSectionLabel className="px-0">
            {t("settings.archivedSessions")}
          </SettingsSectionLabel>
          <p className="text-body-2-regular text-text-secondary">
            {t("settings.archivedSessionsDesc")}
          </p>
        </div>
        <Select
          aria-label={t("settings.archivedWorkspaceFilter")}
          size="sm"
          selectedKey={workspacePath}
          onSelectionChange={(key: Key | null) =>
            key != null && setWorkspacePath(String(key))
          }
          triggerClassName="min-w-44"
        >
          <SelectItem id={ALL_WORKSPACES}>
            {t("settings.archivedAllWorkspaces")}
          </SelectItem>
          {workspacePaths.map((path) => (
            <SelectItem key={path} id={path}>
              {workspaceLabels.get(path) || pathName(path)}
            </SelectItem>
          ))}
        </Select>
      </div>

      {error && (
        <p role="alert" className="text-body-2-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}

      {!loading && grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-button-default px-4 py-8 text-center text-body-regular text-text-secondary">
          {t("settings.archivedEmpty")}
        </div>
      ) : (
        grouped.map(([path, rows]) => (
          <div key={path} className="flex w-full flex-col gap-2">
            <SettingsSectionLabel>
              {workspaceLabels.get(path) || pathName(path) || t("settings.archivedUnknownWorkspace")}
            </SettingsSectionLabel>
            <SettingsCard>
              {rows.map((session) => {
                const key = `${session.engine}/${session.sessionId}`;
                const busy = busyKey === key;
                const when = session.updatedAt
                  ? dateFormatter.format(new Date(session.updatedAt))
                  : "";
                return (
                  <div
                    key={key}
                    className="flex min-h-[60px] items-center gap-3 border-b border-separator-border py-2.5 pr-2.5 last:border-b-0"
                  >
                    <EngineIcon
                      engine={session.engine}
                      size={18}
                      className="shrink-0 text-foreground-icon-secondary"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-body-regular text-text-primary"
                        title={sessionTitle(session)}
                      >
                        {sessionTitle(session)}
                      </p>
                      <p className="truncate text-body-2-regular text-text-secondary">
                        {session.engine}{when ? ` · ${when}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="small"
                        variant="secondary"
                        leadingIcon={ArchiveRestore}
                        disabled={busy}
                        onClick={() => void restore(session)}
                      >
                        {t("settings.restoreSession")}
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        leadingIcon={Trash2}
                        disabled={busy}
                        onClick={() => setDeleting(session)}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </SettingsCard>
          </div>
        ))
      )}

      {deleting && (
        <ConfirmDialog
          danger
          message={t("settings.confirmDeleteArchivedSession", {
            name: sessionTitle(deleting),
          })}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const session = deleting;
            setDeleting(null);
            void permanentlyDelete(session);
          }}
        />
      )}
    </div>
  );
}
