import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/features/chat/store";
import { useFilesStore } from "./store";
import { FileTree } from "./FileTree";
import { FileSearchOverlay } from "./FileSearchOverlay";

/**
 * Right-panel file browser rooted at the active workspace. Clicking a file
 * opens it as a tab in the center area (see ChatPage). The workspace search
 * overlay (tree right-click → Search) covers the tree while it is open.
 *
 * 工作区多目录:除了主目录 `workspacePath`,还从 chat store 里取该工作区的
 * 附加根(`Workspace.roots`),把全部根一起交给文件树并列渲染。签名保持
 * `{ workspacePath }` 以对齐 PanelTabDef 契约。
 */
export function FilesPanel({ workspacePath }: { workspacePath: string }) {
  const { t } = useTranslation();
  const storeRoots = useFilesStore((s) => s.roots);
  const setRoots = useFilesStore((s) => s.setRoots);
  const searchRoot = useFilesStore((s) => s.searchRoot);
  // 整个 workspaces 数组引用稳定;按主目录路径取该工作区的附加根。
  const workspaces = useChatStore((s) => s.workspaces);
  const extraRoots = useMemo(
    () => workspaces.find((w) => w.path === workspacePath)?.roots ?? [],
    [workspaces, workspacePath],
  );
  // 主目录在前,附加根在后(去空、取首次出现以去重)。
  const expected = useMemo(() => {
    const out: string[] = [];
    for (const r of [workspacePath, ...extraRoots]) {
      const trimmed = r.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
    return out;
  }, [workspacePath, extraRoots]);

  useEffect(() => {
    setRoots(expected);
  }, [expected, setRoots]);

  // Guard against the store still pointing at a previously persisted root:
  // the tree only renders once it tracks this workspace's roots.
  const ready =
    storeRoots.length === expected.length && storeRoots.every((r, i) => r === expected[i]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {ready ? (
        <FileTree />
      ) : (
        <p className="px-3 py-4 text-caption-1-regular text-text-tertiary">
          {t("common.loading")}
        </p>
      )}
      {searchRoot ? <FileSearchOverlay searchRoot={searchRoot} /> : null}
    </div>
  );
}
