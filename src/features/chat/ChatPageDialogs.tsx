import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import FolderMinus from "lucide-react/dist/esm/icons/folder-minus";
import { ConfirmDialog, ConfirmPopover, ModalShell, PromptDialog } from "@/components/dialogs";
import { Button } from "@/components/base/buttons/button";
import { fileName, useFilesStore } from "@/features/files/store";
import { WorktreeCreateDialog } from "@/features/worktree/WorktreeCreateDialog";
import { DeleteWorktreeDialog } from "@/features/worktree/DeleteWorktreeDialog";
import { useTerminalStore } from "@/features/terminal/store";
import { worktreeMetaOf, type SessionMeta, type Workspace } from "@/lib/ipc";
import { useChatStore } from "./store";

/** Modal dialogs owned by the chat page. */
export type ChatPageDialog =
  | { kind: "rename"; session: SessionMeta }
  // anchor: pointer position of the delete click — the confirmation opens
  // next to the cursor (ConfirmPopover) instead of screen center; absent
  // (keyboard/no recent pointer) falls back to the centered ConfirmDialog.
  | { kind: "delete"; session: SessionMeta; anchor?: { x: number; y: number } }
  | { kind: "removeWorkspace"; workspaceId: string }
  | { kind: "workspaceAlias"; workspaceId: string }
  /** 工作区多目录:移除一个附加根(主目录不在可选范围)。 */
  | { kind: "removeWorkspaceRoot"; workspaceId: string }
  /** 新建 worktree（目标是该 id 对应的父仓库工作区）。 */
  | { kind: "createWorktree"; workspaceId: string }
  /** 删除 worktree 子工作区的分级确认。 */
  | { kind: "deleteWorktree"; workspaceId: string }
  /** 归档带 worktree 子项的父工作区时的级联确认。 */
  | { kind: "archiveWorkspace"; workspaceId: string }
  | { kind: "closeFile"; path: string };

/** Session rename/delete, dirty-file close, and workspace removal
 * confirmations, rendered above the chat page. */
export function ChatPageDialogs({
  dialog,
  onClose,
}: {
  dialog: ChatPageDialog | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { renameSession, removeWorkspace, setWorkspaceAlias, setWorkspaceArchived, removeWorkspaceRoot } = useChatStore(
    useShallow((s) => ({
      renameSession: s.renameSession,
      removeWorkspace: s.removeWorkspace,
      setWorkspaceAlias: s.setWorkspaceAlias,
      setWorkspaceArchived: s.setWorkspaceArchived,
      removeWorkspaceRoot: s.removeWorkspaceRoot,
    })),
  );
  const workspaces = useChatStore((s) => s.workspaces);
  const workspaceAliases = useChatStore((s) => s.workspaceAliases);
  const closeFile = useFilesStore((s) => s.closeFile);
  const removeTerminalWorkspace = useTerminalStore((s) => s.removeWorkspace);

  return (
    <>
      {dialog?.kind === "rename" && (
        <PromptDialog
          title={t("chat.renameSession")}
          initial={dialog.session.customTitle || dialog.session.title}
          onSubmit={(title) => {
            onClose();
            void renameSession(dialog.session.engine, dialog.session.sessionId, title);
          }}
          onCancel={onClose}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteSessionConfirm dialog={dialog} onClose={onClose} />
      )}
      {dialog?.kind === "closeFile" && (
        <ConfirmDialog
          danger
          message={t("files.confirmCloseDirty", { name: fileName(dialog.path) })}
          onConfirm={() => {
            closeFile(dialog.path);
            onClose();
          }}
          onCancel={onClose}
        />
      )}
      {dialog?.kind === "workspaceAlias" && (
        <PromptDialog
          allowEmpty
          title={t("chat.workspaceAliasTitle")}
          hint={t("chat.workspaceAliasHint")}
          placeholder={t("chat.workspaceAliasPlaceholder")}
          initial={workspaceAliases[dialog.workspaceId] ?? ""}
          onSubmit={(alias) => {
            onClose();
            void setWorkspaceAlias(dialog.workspaceId, alias);
          }}
          onCancel={onClose}
        />
      )}
      {dialog?.kind === "removeWorkspaceRoot" && (
        <RemoveWorkspaceRootDialog
          workspace={workspaces.find((w) => w.id === dialog.workspaceId)}
          onRemove={(path) => removeWorkspaceRoot(dialog.workspaceId, path)}
          onClose={onClose}
        />
      )}
      {dialog?.kind === "createWorktree" &&
        (() => {
          const parent = workspaces.find((w) => w.id === dialog.workspaceId);
          return parent ? (
            <WorktreeCreateDialog parent={parent} onClose={onClose} />
          ) : null;
        })()}
      {dialog?.kind === "deleteWorktree" &&
        (() => {
          const workspace = workspaces.find((w) => w.id === dialog.workspaceId);
          return workspace ? (
            <DeleteWorktreeDialog workspace={workspace} onClose={onClose} />
          ) : null;
        })()}
      {dialog?.kind === "removeWorkspace" &&
        (() => {
          const parent = workspaces.find((w) => w.id === dialog.workspaceId);
          const children = workspaces.filter((w) => w.parentId === dialog.workspaceId);
          const removeOne = async (id: string) => {
            const target = workspaces.find((w) => w.id === id);
            if (target) removeTerminalWorkspace(target.path);
            await removeWorkspace(id);
          };
          // 级联提示（确认决策）：父行带 worktree 子项时列出受影响分支，
          // 确认后先移除子项登记再移除父行；磁盘目录不动。
          if (parent && children.length > 0) {
            return (
              <ConfirmDialog
                danger
                confirmLabel={t("worktree.cascadeConfirm")}
                message={t("worktree.cascadeMessage", {
                  name: parent.name,
                  count: children.length,
                })}
                onConfirm={() => {
                  onClose();
                  void (async () => {
                    // 顺序执行（非并行）：每次 removeWorkspace 都会整体刷新工作区
                    // 列表，并行的刷新可能乱序返回，把已注销的兄弟行又写回 state。
                    await children.reduce(
                      (chain, child) => chain.then(() => removeOne(child.id)),
                      Promise.resolve(),
                    );
                    await removeOne(parent.id);
                  })();
                }}
                onCancel={onClose}
              >
                <ul className="mt-2 flex flex-col gap-0.5 text-caption-1-regular text-text-secondary">
                  {children.map((child) => (
                    <li key={child.id}>{worktreeMetaOf(child)?.branch ?? child.name}</li>
                  ))}
                </ul>
              </ConfirmDialog>
            );
          }
          return (
            <ConfirmDialog
              message={t("chat.confirmRemoveWorkspace")}
              onConfirm={() => {
                onClose();
                void removeOne(dialog.workspaceId);
              }}
              onCancel={onClose}
            />
          );
        })()}
      {dialog?.kind === "archiveWorkspace" &&
        (() => {
          const parent = workspaces.find((w) => w.id === dialog.workspaceId);
          const children = workspaces.filter((w) => w.parentId === dialog.workspaceId);
          if (!parent || children.length === 0) return null;
          return (
            <ConfirmDialog
              confirmLabel={t("worktree.cascadeArchiveConfirm")}
              message={t("worktree.cascadeArchiveMessage", {
                name: parent.name,
                count: children.length,
              })}
              onConfirm={() => {
                onClose();
                for (const child of children) void setWorkspaceArchived(child.id, true);
                void setWorkspaceArchived(parent.id, true);
              }}
              onCancel={onClose}
            />
          );
        })()}
    </>
  );
}
/** Session delete confirmation: pointer-anchored popover when the delete
 *  came from a pointer click (the cursor is already there), centered modal
 *  as the keyboard/no-anchor fallback. */
function DeleteSessionConfirm({
  dialog,
  onClose,
}: {
  dialog: Extract<ChatPageDialog, { kind: "delete" }>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteSession = useChatStore((s) => s.deleteSession);
  const props = {
    danger: true,
    message: t("chat.confirmDeleteSession"),
    onConfirm: () => {
      onClose();
      void deleteSession(dialog.session.engine, dialog.session.sessionId);
    },
    onCancel: onClose,
  };
  return dialog.anchor ? (
    <ConfirmPopover anchor={dialog.anchor} {...props} />
  ) : (
    <ConfirmDialog {...props} />
  );
}

/** 工作区多目录:移除附加根的对话框。只列 `Workspace.roots`(附加根),主目录
 *  恒不出现,因此「移除主目录」在 UI 上不可能发生。无附加根时给出空态提示,
 *  不发命令。 */
function RemoveWorkspaceRootDialog({
  workspace,
  onRemove,
  onClose,
}: {
  workspace: Workspace | undefined;
  onRemove: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const roots = workspace?.roots ?? [];
  const handleRemove = (path: string) => {
    onClose();
    void onRemove(path).catch(() => {});
  };
  return (
    <ModalShell label={t("chat.removeWorkspaceRootTitle")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <h3 className="text-title-3-semibold text-text-primary">
          {t("chat.removeWorkspaceRootTitle")}
        </h3>
        {roots.length === 0 ? (
          <p className="text-body-medium text-text-secondary">
            {t("chat.removeWorkspaceRootEmpty")}
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {roots.map((root) => (
              <li key={root}>
                <button
                  type="button"
                  onClick={() => handleRemove(root)}
                  title={root}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body-medium text-text-secondary transition-colors hover:bg-background-primary-hover"
                >
                  <FolderMinus aria-hidden className="size-4 shrink-0 text-foreground-icon-tertiary" />
                  <span className="min-w-0 flex-1 truncate">{root}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-caption-1-regular text-text-tertiary">
          {t("chat.removeWorkspaceRootHint")}
        </p>
        <div className="flex justify-end">
          <Button variant="secondary" size="small" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
