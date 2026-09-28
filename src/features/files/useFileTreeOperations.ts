import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "@/lib/clipboard";
import { ipc } from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { joinPath, parentPath, useFilesStore, type TreeClipboard } from "./store";
import type { FileTreeMenuState } from "./FileTreeContextMenu";
import type { VisibleNode } from "./FileTreeRow";
import { useChatStore } from "@/features/chat/store";

interface PromptState {
  kind: "newFile" | "newFolder" | "rename";
  /** Parent dir for newFile/newFolder; the item itself for rename. */
  path: string;
  isDir: boolean;
}

interface TrashTarget {
  path: string;
  isDir: boolean;
}

export interface FileTreeOperations {
  clipboard: TreeClipboard | null;
  menu: FileTreeMenuState | null;
  prompt: PromptState | null;
  trashTarget: TrashTarget | null;
  notice: string | null;
  openContextMenu: (event: MouseEvent<HTMLElement>, node: VisibleNode) => void;
  closeMenu: () => void;
  startNewFile: (dir: string) => void;
  startNewFolder: (dir: string) => void;
  copyItem: () => void;
  paste: (dir: string) => void;
  duplicate: () => void;
  startRename: () => void;
  copyPath: () => void;
  sendPath: () => void;
  revealInFileManager: () => void;
  startTrash: () => void;
  submitPrompt: (name: string) => void;
  cancelPrompt: () => void;
  confirmTrash: () => void;
  cancelTrash: () => void;
  dismissNotice: () => void;
}

/**
 * Context-menu and file-operation state for the tree: menu/prompt/trash
 * dialog targets, the auto-dismissing failure notice, and every action the
 * menu entries trigger.
 */
export function useFileTreeOperations(): FileTreeOperations {
  const { t } = useTranslation();
  const root = useFilesStore((s) => s.root);
  const clipboard = useFilesStore((s) => s.clipboard);
  const toggleDir = useFilesStore((s) => s.toggleDir);
  const invalidateDir = useFilesStore((s) => s.invalidateDir);
  const selectPath = useFilesStore((s) => s.selectPath);

  const [menu, setMenu] = useState<FileTreeMenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [trashTarget, setTrashTarget] = useState<TrashTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const opFailed = useCallback(
    (e: unknown) => setNotice(t("files.opFailed", { message: errorText(e) })),
    [t],
  );

  const openContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, node: VisibleNode) => {
      event.preventDefault();
      selectPath(node.path, node.isDir);
      setMenu({ x: event.clientX, y: event.clientY, path: node.path, isDir: node.isDir });
    },
    [selectPath],
  );

  /** Refresh the (loaded) parent listing, expand it when collapsed, and
   *  select the operation result so the user sees what changed. */
  const revealInTree = useCallback(
    async (dir: string, target: string | null, isDir: boolean) => {
      if (dir && dir !== root && !useFilesStore.getState().expanded[dir]) {
        await toggleDir(dir);
      }
      await invalidateDir(dir);
      if (target) selectPath(target, isDir);
    },
    [root, toggleDir, invalidateDir, selectPath],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const submitPrompt = useCallback(
    async (name: string) => {
      const p = prompt;
      setPrompt(null);
      if (!p) return;
      if (name.includes("/") || name.includes("\\")) {
        setNotice(t("files.opFailed", { message: name }));
        return;
      }
      try {
        if (p.kind === "rename") {
          const parent = parentPath(p.path);
          const to = joinPath(parent, name);
          if (to !== p.path) {
            await ipc.renameItem(p.path, to);
            useFilesStore.getState().remapTreePath(p.path, to);
            await invalidateDir(parent);
            selectPath(to, p.isDir);
          }
          return;
        }
        const target = joinPath(p.path, name);
        if (p.kind === "newFile") {
          await ipc.createFile(target);
          await revealInTree(p.path, target, false);
        } else {
          await ipc.createDir(target);
          await revealInTree(p.path, target, true);
        }
      } catch (e) {
        opFailed(e);
      }
    },
    [prompt, t, invalidateDir, selectPath, revealInTree, opFailed],
  );

  const confirmTrash = useCallback(async () => {
    const target = trashTarget;
    setTrashTarget(null);
    if (!target) return;
    try {
      await ipc.trashItem(target.path);
      useFilesStore.getState().removeTreePath(target.path);
      await invalidateDir(parentPath(target.path));
    } catch (e) {
      opFailed(e);
    }
  }, [trashTarget, invalidateDir, opFailed]);

  const handlePaste = useCallback(
    async (targetDir: string) => {
      const item = useFilesStore.getState().clipboard;
      if (!item) {
        setNotice(t("files.pasteUnavailable"));
        return;
      }
      try {
        const result = await ipc.pasteItem(item.path, targetDir);
        await revealInTree(targetDir, result.path, result.isDir);
      } catch (e) {
        opFailed(e);
      }
    },
    [t, revealInTree, opFailed],
  );

  const handleDuplicate = useCallback(async () => {
    if (!menu) return;
    try {
      const result = await ipc.duplicateItem(menu.path);
      await revealInTree(parentPath(menu.path), result.path, result.isDir);
    } catch (e) {
      opFailed(e);
    }
  }, [menu, revealInTree, opFailed]);

  const copyItem = useCallback(() => {
    if (!menu) return;
    useFilesStore.getState().setClipboard({ path: menu.path, isDir: menu.isDir });
  }, [menu]);

  const copyPath = useCallback(() => {
    if (!menu) return;
    void copyText(menu.path).then((ok) => {
      if (!ok) opFailed(new Error("Failed to copy path"));
    }).catch(opFailed);
  }, [menu, opFailed]);

  const sendPath = useCallback(() => {
    if (!menu) return;
    useChatStore.getState().requestMention(menu.path);
  }, [menu]);

  const revealInFileManager = useCallback(() => {
    if (!menu) return;
    void ipc.revealInFileManager(menu.path).catch(opFailed);
  }, [menu, opFailed]);

  return {
    clipboard,
    menu,
    prompt,
    trashTarget,
    notice,
    openContextMenu,
    closeMenu,
    startNewFile: useCallback(
      (dir: string) => setPrompt({ kind: "newFile", path: dir, isDir: true }),
      [],
    ),
    startNewFolder: useCallback(
      (dir: string) => setPrompt({ kind: "newFolder", path: dir, isDir: true }),
      [],
    ),
    copyItem,
    paste: useCallback((dir: string) => void handlePaste(dir), [handlePaste]),
    duplicate: useCallback(() => void handleDuplicate(), [handleDuplicate]),
    startRename: useCallback(() => {
      if (menu) setPrompt({ kind: "rename", path: menu.path, isDir: menu.isDir });
    }, [menu]),
    copyPath,
    sendPath,
    revealInFileManager,
    startTrash: useCallback(() => {
      if (menu) setTrashTarget({ path: menu.path, isDir: menu.isDir });
    }, [menu]),
    submitPrompt: useCallback((name: string) => void submitPrompt(name), [submitPrompt]),
    cancelPrompt: useCallback(() => setPrompt(null), []),
    confirmTrash: useCallback(() => void confirmTrash(), [confirmTrash]),
    cancelTrash: useCallback(() => setTrashTarget(null), []),
    dismissNotice: useCallback(() => setNotice(null), []),
  };
}
