import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import i18n from "@/lib/i18n";
import { panelTabRegistry } from "@ccgui/plugin-sdk";
import { FilesPanel } from "@/features/files/FilesPanel";
import { ChangesPanel } from "@/features/git/ChangesPanel";

/**
 * Builtin right-panel tabs, registered through the same extension-point
 * registry plugins use (plan §4.2 #4 — files/changes are the dogfood
 * surface). Module-scope side effect, imported once by ChatPage; the
 * registry's upsert semantics make HMR re-runs harmless.
 */

/** ChangesPanel keeps its per-workspace remount (key) and full-width class
 *  exactly as it was inlined in ChatSidePanel. 工作区多目录：附加根随
 *  `roots` 透传，供 Git 面板按根分组。 */
export const ChangesTab = ({
  workspacePath,
  roots,
  visible = true,
}: {
  workspacePath: string;
  roots?: readonly string[];
  visible?: boolean;
}) => (
  <ChangesPanel
    key={workspacePath}
    workspacePath={workspacePath}
    roots={roots}
    visible={visible}
    className="w-full"
  />
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
