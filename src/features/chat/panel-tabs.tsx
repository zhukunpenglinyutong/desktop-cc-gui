import Activity from "lucide-react/dist/esm/icons/activity";
import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import i18n from "@/lib/i18n";
import { panelTabRegistry } from "@ccgui/plugin-sdk";
import { FilesPanel } from "@/features/files/FilesPanel";
import { ChangesPanel } from "@/features/git/ChangesPanel";
import { BackgroundTasksPanel } from "./components/BackgroundTasksPanel";

/**
 * Builtin right-panel tabs, registered through the same extension-point
 * registry plugins use (plan §4.2 #4 — files/changes/tasks are the dogfood
 * surface). Module-scope side effect, imported once by ChatPage; the
 * registry's upsert semantics make HMR re-runs harmless.
 */

/** ChangesPanel keeps its per-workspace remount (key) and full-width class
 *  exactly as it was inlined in ChatSidePanel. */
export const ChangesTab = ({ workspacePath, visible = true }: { workspacePath: string; visible?: boolean }) => (
  <ChangesPanel key={workspacePath} workspacePath={workspacePath} visible={visible} className="w-full" />
);

panelTabRegistry.register({
  id: "files",
  label: () => i18n.t("files.tab"),
  icon: FolderSymlink,
  order: 0,
  component: FilesPanel,
});
panelTabRegistry.register({
  id: "changes",
  label: () => i18n.t("git.changes"),
  icon: GitBranch,
  order: 1,
  component: ChangesTab,
});
panelTabRegistry.register({
  id: "tasks",
  label: () => i18n.t("chat.tasks.tab"),
  icon: Activity,
  order: 2,
  component: BackgroundTasksPanel,
});

/* Sorting (useSortedPanelTabs) and the persisted-tab fallback
 * (resolveActivePanelTab) live in ./use-panel-tabs — the single source both
 * ChatPanelHeader and ChatSidePanel consume. Do not re-add copies here. */
