import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Folder from "lucide-react/dist/esm/icons/folder";
import Inbox from "lucide-react/dist/esm/icons/inbox";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type {
  FolderProjection,
  FolderProjectionNode,
} from "./folderProjection";

export type SessionFolderSelection =
  | { kind: "unfiled" }
  | { kind: "folder"; folderId: string };

type SessionFolderTreeProps = {
  projection: FolderProjection;
  selection: SessionFolderSelection;
  collapsedFolderIds: ReadonlySet<string>;
  onSelectionChange: (selection: SessionFolderSelection) => void;
  onToggleCollapse: (folderId: string) => void;
  onSetCollapsedFolderIds?: (ids: ReadonlySet<string>) => void;
  onCreateFolder?: (parentId: string | null, name: string) => Promise<void>;
  onRenameFolder?: (folderId: string, name: string) => Promise<void>;
  onDeleteFolder?: (folderId: string, cascade: boolean) => Promise<void>;
};

type EditorState =
  | { kind: "idle" }
  | { kind: "creating"; parentId: string | null }
  | { kind: "renaming"; folderId: string };

const INDENT_BASE_REM = 0.5;
const INDENT_REM_PER_DEPTH = 1.25;
const ROW_HOVER_CLASSES =
  "group hover:bg-black/5 dark:hover:bg-white/10 transition-colors";

function computeIndentStyle(depth: number) {
  return {
    paddingInlineStart: `${INDENT_BASE_REM + depth * INDENT_REM_PER_DEPTH}rem`,
  };
}

function isFolderSelected(
  selection: SessionFolderSelection,
  folderId: string,
): boolean {
  return selection.kind === "folder" && selection.folderId === folderId;
}

export function SessionFolderTree({
  projection,
  selection,
  collapsedFolderIds,
  onSelectionChange,
  onToggleCollapse,
  onSetCollapsedFolderIds,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: SessionFolderTreeProps) {
  const { t } = useTranslation();
  const unfiledSelected = selection.kind === "unfiled";

  const [editor, setEditor] = useState<EditorState>({ kind: "idle" });
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteCascade, setDeleteCascade] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editor.kind === "idle") {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editor]);

  const canCreate = Boolean(onCreateFolder);
  const canRename = Boolean(onRenameFolder);
  const canDelete = Boolean(onDeleteFolder);
  const hasAnyFolders = projection.rootFolders.length > 0;
  const canBatchExpand = Boolean(onSetCollapsedFolderIds) && hasAnyFolders;

  const breadcrumbSegments = useMemo(() => {
    if (selection.kind === "unfiled") {
      return [t("settings.sessionOrganizationUnfiledNodeLabel")];
    }
    const segments: string[] = [];
    let cursor = projection.folderById.get(selection.folderId);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.folder.id)) {
      seen.add(cursor.folder.id);
      segments.unshift(cursor.folder.name);
      const parentId = cursor.folder.parentId?.trim();
      cursor = parentId ? projection.folderById.get(parentId) : undefined;
    }
    return segments;
  }, [projection.folderById, selection, t]);

  const breadcrumbSeparator = t(
    "settings.sessionOrganizationTreeBreadcrumbSeparator",
  );
  const breadcrumbText = breadcrumbSegments.join(breadcrumbSeparator);

  const collapsibleFolderIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (node: FolderProjectionNode) => {
      if (node.children.length > 0) {
        ids.push(node.folder.id);
      }
      node.children.forEach(walk);
    };
    projection.rootFolders.forEach(walk);
    return ids;
  }, [projection.rootFolders]);

  const beginCreate = (parentId: string | null) => {
    if (submitting || !onCreateFolder) return;
    setEditor({ kind: "creating", parentId });
    setDraftName("");
    setActionError(null);
    setPendingDeleteId(null);
  };
  const beginRename = (node: FolderProjectionNode) => {
    if (submitting || !onRenameFolder) return;
    setEditor({ kind: "renaming", folderId: node.folder.id });
    setDraftName(node.folder.name);
    setActionError(null);
    setPendingDeleteId(null);
  };
  const cancelEdit = () => {
    if (submitting) return;
    setEditor({ kind: "idle" });
    setDraftName("");
    setActionError(null);
  };

  const submitEditor = async () => {
    if (submitting) return;
    const trimmed = draftName.trim();
    if (!trimmed) {
      setActionError(t("settings.sessionOrganizationFolderNameRequired"));
      return;
    }
    setSubmitting(true);
    try {
      if (editor.kind === "creating" && onCreateFolder) {
        await onCreateFolder(editor.parentId, trimmed);
      } else if (editor.kind === "renaming" && onRenameFolder) {
        await onRenameFolder(editor.folderId, trimmed);
      } else {
        return;
      }
      setEditor({ kind: "idle" });
      setDraftName("");
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const requestDelete = (node: FolderProjectionNode) => {
    if (submitting || !onDeleteFolder) return;
    setPendingDeleteId(node.folder.id);
    setDeleteCascade(false);
    setActionError(null);
  };

  const cancelDelete = () => {
    if (submitting) return;
    setPendingDeleteId(null);
    setDeleteCascade(false);
    setActionError(null);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId || !onDeleteFolder) return;
    const folderId = pendingDeleteId;
    const cascade = deleteCascade;
    setSubmitting(true);
    try {
      await onDeleteFolder(folderId, cascade);
      setPendingDeleteId(null);
      setDeleteCascade(false);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const pendingDeleteNode = pendingDeleteId
    ? projection.folderById.get(pendingDeleteId) ?? null
    : null;
  const pendingDeleteSessionCount = pendingDeleteNode?.totalEntryCount ?? 0;
  const pendingDeleteSubfolderCount = useMemo(() => {
    if (!pendingDeleteNode) return 0;
    let count = 0;
    const walk = (n: FolderProjectionNode) => {
      n.children.forEach((child) => {
        count += 1;
        walk(child);
      });
    };
    walk(pendingDeleteNode);
    return count;
  }, [pendingDeleteNode]);
  const pendingDeleteIsEmpty =
    pendingDeleteSessionCount === 0 && pendingDeleteSubfolderCount === 0;

  useEffect(() => {
    if (!pendingDeleteId) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        event.preventDefault();
        cancelDelete();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDeleteId, submitting]);

  const expandAll = () => {
    if (!onSetCollapsedFolderIds) return;
    onSetCollapsedFolderIds(new Set<string>());
  };
  const collapseAll = () => {
    if (!onSetCollapsedFolderIds) return;
    onSetCollapsedFolderIds(new Set<string>(collapsibleFolderIds));
  };

  const editorInputAriaLabel = t(
    "settings.sessionOrganizationFolderNameInputAria",
  );
  const editorPlaceholder = t(
    "settings.sessionOrganizationFolderNamePlaceholder",
  );

  const renderEditorContent = (parentId: string | null, depth: number) => {
    const indentStyle = computeIndentStyle(depth);
    const testId =
      editor.kind === "renaming"
        ? `session-organization-tree-editor-rename-${editor.folderId}`
        : `session-organization-tree-editor-create-${parentId ?? "__root__"}`;
    const trimmedEmpty = draftName.trim().length === 0;
    return (
      <div
        className="session-organization-tree-row session-organization-tree-row-editor"
        data-testid={testId}
        style={{
          ...indentStyle,
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
        }}
      >
        <span
          className="session-organization-tree-collapse-placeholder"
          aria-hidden
        />
        <Folder
          size={13}
          aria-hidden
          className="session-organization-tree-icon"
        />
        <input
          ref={inputRef}
          type="text"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitEditor();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
            }
          }}
          disabled={submitting}
          aria-label={editorInputAriaLabel}
          placeholder={editorPlaceholder}
          data-testid="session-organization-tree-editor-input"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "0.125rem 0.375rem",
            border: "1px solid var(--border, rgba(0,0,0,0.18))",
            borderRadius: "4px",
            background: "transparent",
            color: "inherit",
            font: "inherit",
          }}
        />
        <button
          type="button"
          onClick={() => void submitEditor()}
          disabled={submitting || trimmedEmpty}
          data-testid="session-organization-tree-editor-save"
          className="session-organization-tree-editor-btn"
          style={{
            padding: "0.125rem 0.5rem",
            borderRadius: "4px",
            border: "1px solid var(--primary, #2563eb)",
            background:
              trimmedEmpty || submitting
                ? "transparent"
                : "var(--primary, #2563eb)",
            color:
              trimmedEmpty || submitting
                ? "inherit"
                : "var(--primary-foreground, #fff)",
            cursor: trimmedEmpty || submitting ? "not-allowed" : "pointer",
            fontSize: "0.75rem",
          }}
        >
          {t("settings.sessionOrganizationFolderNameSave")}
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          disabled={submitting}
          data-testid="session-organization-tree-editor-cancel"
          className="session-organization-tree-editor-btn"
          style={{
            padding: "0.125rem 0.5rem",
            borderRadius: "4px",
            border: "1px solid var(--border, rgba(0,0,0,0.18))",
            background: "transparent",
            cursor: submitting ? "not-allowed" : "pointer",
            fontSize: "0.75rem",
          }}
        >
          {t("settings.sessionOrganizationFolderNameCancel")}
        </button>
      </div>
    );
  };

  const renderEditorListItem = (parentId: string | null, depth: number) => (
    <li key="__editor__" role="none">
      {renderEditorContent(parentId, depth)}
    </li>
  );

  const renderNode = (node: FolderProjectionNode, depth: number) => {
    const isCollapsed = collapsedFolderIds.has(node.folder.id);
    const isSelected = isFolderSelected(selection, node.folder.id);
    const hasChildren = node.children.length > 0;
    const indentStyle = computeIndentStyle(depth);
    const isRenaming =
      editor.kind === "renaming" && editor.folderId === node.folder.id;
    const isCreatingChild =
      editor.kind === "creating" && editor.parentId === node.folder.id;
    const select = () =>
      onSelectionChange({ kind: "folder", folderId: node.folder.id });
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft" && hasChildren && !isCollapsed) {
        event.preventDefault();
        onToggleCollapse(node.folder.id);
        return;
      }
      if (event.key === "ArrowRight" && hasChildren && isCollapsed) {
        event.preventDefault();
        onToggleCollapse(node.folder.id);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    };

    const showChildList = (hasChildren && !isCollapsed) || isCreatingChild;

    return (
      <li key={node.folder.id} role="none">
        {isRenaming ? (
          renderEditorContent(null, depth)
        ) : (
          <div
            role="treeitem"
            aria-selected={isSelected}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            tabIndex={0}
            className={`session-organization-tree-row ${ROW_HOVER_CLASSES}${
              isSelected ? " is-selected" : ""
            }`}
            style={{
              ...indentStyle,
              display: "flex",
              alignItems: "center",
              whiteSpace: "nowrap",
              width: "max-content",
              paddingBlock: "0.25rem",
            }}
            data-testid={`session-organization-tree-folder-${node.folder.id}`}
            onClick={(event) => {
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest(
                  "button[data-collapse='true'], button[data-tree-action='true']",
                )
              ) {
                return;
              }
              select();
            }}
            onKeyDown={handleKeyDown}
          >
            <button
              type="button"
              data-collapse="true"
              className={`session-organization-tree-collapse${
                isCollapsed ? " is-collapsed" : ""
              }`}
              disabled={!hasChildren}
              aria-hidden={!hasChildren}
              aria-label={
                hasChildren
                  ? isCollapsed
                    ? t("settings.sessionOrganizationExpandFolder", {
                        name: node.folder.name,
                      })
                    : t("settings.sessionOrganizationCollapseFolder", {
                        name: node.folder.name,
                      })
                  : undefined
              }
              onClick={(event) => {
                event.stopPropagation();
                if (hasChildren) {
                  onToggleCollapse(node.folder.id);
                }
              }}
            >
              {hasChildren ? (
                isCollapsed ? (
                  <ChevronRight size={12} aria-hidden />
                ) : (
                  <ChevronDown size={12} aria-hidden />
                )
              ) : (
                <span
                  className="session-organization-tree-collapse-placeholder"
                  aria-hidden
                />
              )}
            </button>
            <Folder
              size={13}
              aria-hidden
              className="session-organization-tree-icon"
              style={{ flexShrink: 0 }}
            />
            <span
              className="session-organization-tree-name"
              style={{
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
              title={node.folder.name}
            >
              {node.folder.name}
            </span>
            <span
              aria-hidden
              className="session-organization-tree-name-count-separator"
              style={{
                flexShrink: 0,
                margin: "0 0.375rem",
                opacity: 0.4,
              }}
            >
              ·
            </span>
            <span
              className="session-organization-tree-count"
              style={{
                flexShrink: 0,
                opacity: 0.55,
                fontVariantNumeric: "tabular-nums",
              }}
              aria-label={t("settings.sessionOrganizationFolderCount", {
                count: node.directEntryCount,
              })}
            >
              {node.directEntryCount}
            </span>
          </div>
        )}
        {showChildList ? (
          <ul
            role="group"
            className="session-organization-tree-children"
            style={{
              listStyle: "none",
              marginBlock: 0,
              marginInlineEnd: 0,
              marginInlineStart: "0.5rem",
              paddingBlock: 0,
              paddingInlineEnd: 0,
              paddingInlineStart: "0.75rem",
              borderInlineStart: "1px solid var(--border, rgba(0,0,0,0.08))",
            }}
          >
            {isCreatingChild
              ? renderEditorListItem(node.folder.id, depth + 1)
              : null}
            {hasChildren && !isCollapsed
              ? node.children.map((child) => renderNode(child, depth + 1))
              : null}
          </ul>
        ) : null}
      </li>
    );
  };

  const isCreatingRoot =
    editor.kind === "creating" && editor.parentId === null;

  const contextualCreateLabel =
    selection.kind === "folder"
      ? t("settings.sessionOrganizerCreateSubfolderButton")
      : t("settings.sessionOrganizationCreateRootFolderButton");
  const contextualCreateParentId =
    selection.kind === "folder" ? selection.folderId : null;
  const selectedFolderNode =
    selection.kind === "folder"
      ? projection.folderById.get(selection.folderId) ?? null
      : null;
  const canRenameSelected = canRename && Boolean(selectedFolderNode);
  const canDeleteSelected = canDelete && Boolean(selectedFolderNode);
  const handleContextualCreateClick = () => {
    if (
      selection.kind === "folder" &&
      collapsedFolderIds.has(selection.folderId)
    ) {
      onToggleCollapse(selection.folderId);
    }
    beginCreate(contextualCreateParentId);
  };

  return (
    <nav
      className="session-organization-tree"
      aria-label={t("settings.sessionOrganizationTreeLabel")}
    >
      <div
        className="session-organization-tree-breadcrumb"
        data-testid="session-organization-tree-breadcrumb"
        aria-label={t("settings.sessionOrganizationTreeBreadcrumbLabel")}
        style={{
          padding: "0.25rem 0.5rem",
          fontSize: "0.75rem",
          opacity: 0.7,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {breadcrumbText}
      </div>
      {canCreate || canRename || canDelete ? (
        <div
          className="session-organization-tree-toolbar"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.25rem",
            padding: "0.25rem 0.25rem 0.5rem",
          }}
        >
          {canCreate ? (
            <button
              type="button"
              data-testid="session-organization-tree-add-root"
              data-context={selection.kind}
              onClick={handleContextualCreateClick}
              disabled={submitting}
              className="session-organization-tree-action-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.125rem 0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--border, rgba(0,0,0,0.18))",
                background: "transparent",
                cursor: submitting ? "not-allowed" : "pointer",
                fontSize: "0.75rem",
                color: "inherit",
              }}
            >
              <Plus size={12} aria-hidden />
              {contextualCreateLabel}
            </button>
          ) : null}
          {canRename ? (
            <button
              type="button"
              data-testid="session-organization-tree-rename-selected"
              onClick={() => {
                if (selectedFolderNode) beginRename(selectedFolderNode);
              }}
              disabled={submitting || !canRenameSelected}
              className="session-organization-tree-action-btn"
              aria-label={
                selectedFolderNode
                  ? t("settings.sessionOrganizationRenameFolderButtonAria", {
                      name: selectedFolderNode.folder.name,
                    })
                  : t("settings.sessionOrganizationRenameSelectedButton")
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.125rem 0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--border, rgba(0,0,0,0.18))",
                background: "transparent",
                cursor:
                  submitting || !canRenameSelected ? "not-allowed" : "pointer",
                fontSize: "0.75rem",
                color: "inherit",
                opacity: canRenameSelected ? 1 : 0.5,
              }}
            >
              <Pencil size={12} aria-hidden />
              {t("settings.sessionOrganizationRenameSelectedButton")}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              data-testid="session-organization-tree-delete-selected"
              onClick={() => {
                if (selectedFolderNode) requestDelete(selectedFolderNode);
              }}
              disabled={submitting || !canDeleteSelected}
              className="session-organization-tree-action-btn"
              aria-label={
                selectedFolderNode
                  ? t("settings.sessionOrganizationDeleteFolderButtonAria", {
                      name: selectedFolderNode.folder.name,
                    })
                  : t("settings.sessionOrganizationDeleteSelectedButton")
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.125rem 0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--destructive, #c0392b)",
                background: "transparent",
                cursor:
                  submitting || !canDeleteSelected ? "not-allowed" : "pointer",
                fontSize: "0.75rem",
                color: canDeleteSelected
                  ? "var(--destructive, #c0392b)"
                  : "inherit",
                opacity: canDeleteSelected ? 1 : 0.5,
              }}
            >
              <Trash2 size={12} aria-hidden />
              {t("settings.sessionOrganizationDeleteSelectedButton")}
            </button>
          ) : null}
          {canBatchExpand ? (
            <button
              type="button"
              data-testid="session-organization-tree-toggle-all"
              data-state={
                collapsibleFolderIds.some((id) =>
                  collapsedFolderIds.has(id),
                )
                  ? "expand"
                  : "collapse"
              }
              onClick={
                collapsibleFolderIds.some((id) =>
                  collapsedFolderIds.has(id),
                )
                  ? expandAll
                  : collapseAll
              }
              disabled={submitting}
              className="session-organization-tree-action-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.125rem 0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--border, rgba(0,0,0,0.18))",
                background: "transparent",
                cursor: submitting ? "not-allowed" : "pointer",
                fontSize: "0.75rem",
                color: "inherit",
              }}
            >
              {collapsibleFolderIds.some((id) => collapsedFolderIds.has(id))
                ? t("settings.sessionOrganizationTreeExpandAll")
                : t("settings.sessionOrganizationTreeCollapseAll")}
            </button>
          ) : null}
        </div>
      ) : null}
      {actionError ? (
        <div
          role="alert"
          data-testid="session-organization-tree-action-error"
          className="session-organization-tree-error"
          style={{
            margin: "0 0.25rem 0.5rem",
            padding: "0.25rem 0.5rem",
            border: "1px solid var(--destructive, #c0392b)",
            borderRadius: "4px",
            color: "var(--destructive, #c0392b)",
            fontSize: "0.75rem",
          }}
        >
          {actionError}
        </div>
      ) : null}
      <ul
        role="tree"
        style={{ listStyle: "none", margin: 0, padding: 0 }}
      >
        <li role="none">
          <div
            role="treeitem"
            aria-selected={unfiledSelected}
            tabIndex={0}
            className={`session-organization-tree-row session-organization-tree-row-unfiled ${ROW_HOVER_CLASSES}${
              unfiledSelected ? " is-selected" : ""
            }`}
            style={{
              display: "flex",
              alignItems: "center",
              whiteSpace: "nowrap",
              width: "max-content",
              paddingBlock: "0.25rem",
              paddingInlineStart: `${INDENT_BASE_REM}rem`,
            }}
            data-testid="session-organization-tree-unfiled"
            onClick={() => onSelectionChange({ kind: "unfiled" })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectionChange({ kind: "unfiled" });
              }
            }}
          >
            <span
              className="session-organization-tree-collapse-placeholder"
              aria-hidden
            />
            <Inbox
              size={13}
              aria-hidden
              className="session-organization-tree-icon"
              style={{ flexShrink: 0 }}
            />
            <span
              className="session-organization-tree-name"
              style={{
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {t("settings.sessionOrganizationUnfiledNodeLabel")}
            </span>
            <span
              aria-hidden
              className="session-organization-tree-name-count-separator"
              style={{
                flexShrink: 0,
                margin: "0 0.375rem",
                opacity: 0.4,
              }}
            >
              ·
            </span>
            <span
              className="session-organization-tree-count"
              data-testid="session-organization-tree-unfiled-count"
              style={{
                flexShrink: 0,
                opacity: 0.55,
                fontVariantNumeric: "tabular-nums",
              }}
              aria-label={t("settings.sessionOrganizationUnfiledCount", {
                count: projection.unfiledEntryCount,
              })}
            >
              {projection.unfiledEntryCount}
            </span>
          </div>
        </li>
        {isCreatingRoot ? renderEditorListItem(null, 0) : null}
        {projection.rootFolders.map((node) => renderNode(node, 0))}
      </ul>
      {pendingDeleteNode && typeof document !== "undefined"
        ? createPortal(
            <div
              role="presentation"
              data-testid="session-organization-tree-delete-dialog-backdrop"
              onClick={() => {
                if (!submitting) cancelDelete();
              }}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1175,
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="session-organization-tree-delete-dialog-title"
                data-testid="session-organization-tree-delete-dialog"
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: "min(480px, 92vw)",
                  background: "var(--background, #fff)",
                  color: "inherit",
                  borderRadius: "10px",
                  boxShadow: "0 16px 48px rgba(0,0,0,0.28)",
                  padding: "1rem 1.25rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                <h3
                  id="session-organization-tree-delete-dialog-title"
                  style={{
                    margin: 0,
                    fontSize: "1rem",
                    fontWeight: 600,
                  }}
                >
                  {t("settings.sessionOrganizationDeleteFolderDialogTitle", {
                    name: pendingDeleteNode.folder.name,
                  })}
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.875rem",
                    lineHeight: 1.5,
                  }}
                >
                  {pendingDeleteIsEmpty
                    ? t(
                        "settings.sessionOrganizationDeleteFolderDialogEmptyBody",
                      )
                    : t(
                        "settings.sessionOrganizationDeleteFolderDialogNonEmptyBody",
                        {
                          sessionCount: pendingDeleteSessionCount,
                          subfolderCount: pendingDeleteSubfolderCount,
                        },
                      )}
                </p>
                {!pendingDeleteIsEmpty ? (
                  <>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        fontSize: "0.8125rem",
                        cursor: submitting ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={deleteCascade}
                        onChange={(event) =>
                          setDeleteCascade(event.target.checked)
                        }
                        disabled={submitting}
                        data-testid="session-organization-tree-delete-dialog-cascade"
                        style={{ marginTop: "0.125rem" }}
                      />
                      <span>
                        {t(
                          "settings.sessionOrganizationDeleteFolderCascadeOption",
                        )}
                      </span>
                    </label>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.75rem",
                        opacity: 0.7,
                        lineHeight: 1.4,
                      }}
                    >
                      {t(
                        "settings.sessionOrganizationDeleteFolderUnfileHint",
                      )}
                    </p>
                  </>
                ) : null}
                {actionError ? (
                  <div
                    role="alert"
                    data-testid="session-organization-tree-delete-dialog-error"
                    style={{
                      padding: "0.375rem 0.5rem",
                      border:
                        "1px solid var(--destructive, #c0392b)",
                      borderRadius: "4px",
                      color: "var(--destructive, #c0392b)",
                      fontSize: "0.8125rem",
                    }}
                  >
                    {actionError}
                  </div>
                ) : null}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "0.5rem",
                    marginTop: "0.25rem",
                  }}
                >
                  <button
                    type="button"
                    onClick={cancelDelete}
                    disabled={submitting}
                    data-testid="session-organization-tree-delete-dialog-cancel"
                    style={{
                      padding: "0.375rem 0.875rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border, rgba(0,0,0,0.18))",
                      background: "transparent",
                      color: "inherit",
                      fontSize: "0.8125rem",
                      cursor: submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {t(
                      "settings.sessionOrganizationDeleteFolderCancel",
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmDelete()}
                    disabled={submitting}
                    data-testid="session-organization-tree-delete-dialog-confirm"
                    style={{
                      padding: "0.375rem 0.875rem",
                      borderRadius: "6px",
                      border:
                        "1px solid var(--destructive, #c0392b)",
                      background: submitting
                        ? "transparent"
                        : "var(--destructive, #c0392b)",
                      color: submitting
                        ? "var(--destructive, #c0392b)"
                        : "#fff",
                      fontSize: "0.8125rem",
                      cursor: submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {submitting
                      ? t(
                          "settings.sessionOrganizationDeleteFolderInProgress",
                        )
                      : t(
                          "settings.sessionOrganizationDeleteFolderConfirm",
                        )}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </nav>
  );
}
