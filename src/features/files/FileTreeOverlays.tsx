import { useTranslation } from "react-i18next";
import { ConfirmDialog, PromptDialog } from "@/components/dialogs";
import { fileName, useFilesStore } from "./store";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import type { FileTreeOperations } from "./useFileTreeOperations";

/**
 * Transient UI layered over the tree: the auto-dismissing operation-failure
 * notice, the right-click context menu, and the prompt/confirm dialogs for
 * file operations.
 */
export function FileTreeOverlays({ ops }: { ops: FileTreeOperations }) {
  const { t } = useTranslation();
  const { menu, prompt, trashTarget, notice } = ops;

  return (
    <>
      {notice ? (
        <div
          role="alert"
          className="sticky bottom-1 z-10 mx-2 mt-auto flex items-center gap-2 rounded-lg border border-border-button-default bg-background-primary-default px-2.5 py-1.5 text-caption-1-regular text-text-error-primary shadow-dropdown"
        >
          <span className="min-w-0 flex-1 break-all">{notice}</span>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={ops.dismissNotice}
            className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-background-tertiary-hover"
          >
            ×
          </button>
        </div>
      ) : null}
      {menu ? (
        <FileTreeContextMenu
          menu={menu}
          pasteDisabled={!ops.canPaste}
          onClose={ops.closeMenu}
          onNewFile={ops.startNewFile}
          onNewFolder={ops.startNewFolder}
          onSearchFiles={(dir) => useFilesStore.getState().openSearch(dir)}
          onCopy={ops.copyItem}
          onPaste={ops.paste}
          onDuplicate={ops.duplicate}
          onRename={ops.startRename}
          onCopyPath={ops.copyPath}
          onSendPath={ops.sendPath}
          onReveal={ops.revealInFileManager}
          onTrash={ops.startTrash}
        />
      ) : null}
      {prompt ? (
        <PromptDialog
          title={t(
            prompt.kind === "newFile"
              ? "files.newFile"
              : prompt.kind === "newFolder"
                ? "files.newFolder"
                : "files.renameItem",
          )}
          initial={prompt.kind === "rename" ? fileName(prompt.path) : ""}
          onSubmit={ops.submitPrompt}
          onCancel={ops.cancelPrompt}
        />
      ) : null}
      {trashTarget ? (
        <ConfirmDialog
          danger
          message={t(
            trashTarget.isDir ? "files.deleteFolderConfirm" : "files.deleteFileConfirm",
            { name: fileName(trashTarget.path) },
          )}
          onConfirm={ops.confirmTrash}
          onCancel={ops.cancelTrash}
        />
      ) : null}
    </>
  );
}
