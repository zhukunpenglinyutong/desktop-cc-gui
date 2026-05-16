import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import Archive from "lucide-react/dist/esm/icons/archive";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import ImagePlus from "lucide-react/dist/esm/icons/image-plus";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2";
import Minimize2 from "lucide-react/dist/esm/icons/minimize-2";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen";
import Plus from "lucide-react/dist/esm/icons/plus";
import Save from "lucide-react/dist/esm/icons/save";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import X from "lucide-react/dist/esm/icons/x";
import { confirm } from "@tauri-apps/plugin-dialog";
import { ImagePreviewOverlay } from "../../../components/common/ImagePreviewOverlay";
import { LocalImage } from "../../../components/common/LocalImage";
import { RichTextInput } from "../../../components/common/RichTextInput/RichTextInput";
import { isWindowsPlatform } from "../../../utils/platform";
import { Markdown } from "../../messages/components/Markdown";
import { pickImageFiles, type WorkspaceNoteCard, type WorkspaceNoteCardSummary } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { noteCardsFacade } from "../services/noteCardsFacade";

type WorkspaceNoteCardPanelProps = {
  workspaceId: string | null;
  workspaceName?: string | null;
  workspacePath?: string | null;
  focusNoteId?: string | null;
  focusRequestKey?: number;
};

type NoteCardCollection = "active" | "archive";
type NoteCardImagePreview = {
  src: string;
  localPath: string;
  fileName: string;
};

function attachmentPreviewSrc(path: string) {
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

function deriveProjectName(
  workspaceId?: string | null,
  workspaceName?: string | null,
  workspacePath?: string | null,
) {
  const rawCandidate = (() => {
    const normalizedPath = workspacePath?.trim().replace(/\\/g, "/") ?? "";
    if (normalizedPath) {
      const segments = normalizedPath.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      if (lastSegment) {
        return lastSegment;
      }
    }
    return workspaceName?.trim() || workspaceId?.trim() || "workspace";
  })();

  const sanitized = Array.from(rawCandidate)
    .map((character) => (/^[a-z0-9]$/i.test(character) ? character.toLowerCase() : "-"))
    .join("");
  const collapsed = sanitized.split("-").filter(Boolean).join("-");
  return collapsed || "workspace";
}

function buildNoteCardStorageHintPath(projectName: string) {
  if (isWindowsPlatform()) {
    return `%USERPROFILE%\\.ccgui\\note_card\\${projectName}\\active | archive`;
  }
  return `~/.ccgui/note_card/${projectName}/active | archive`;
}

export function WorkspaceNoteCardPanel({
  workspaceId,
  workspaceName = null,
  workspacePath = null,
  focusNoteId = null,
  focusRequestKey = 0,
}: WorkspaceNoteCardPanelProps) {
  const { t, i18n } = useTranslation();
  const [collection, setCollection] = useState<NoteCardCollection>("active");
  const [items, setItems] = useState<WorkspaceNoteCardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWorkspaceScope, setSelectedWorkspaceScope] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<WorkspaceNoteCard | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [attachmentDrafts, setAttachmentDrafts] = useState<string[]>([]);
  const [pendingEditorOpen, setPendingEditorOpen] = useState(false);
  const [editorCollapsed, setEditorCollapsed] = useState(true);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [imagePreview, setImagePreview] = useState<NoteCardImagePreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const archived = collection === "archive";
  const projectName = useMemo(
    () => deriveProjectName(workspaceId, workspaceName, workspacePath),
    [workspaceId, workspaceName, workspacePath],
  );
  const workspaceScopeKey = useMemo(
    () => [workspaceId?.trim() ?? "", workspaceName?.trim() ?? "", workspacePath?.trim() ?? ""].join("::"),
    [workspaceId, workspaceName, workspacePath],
  );

  const resetDraft = useCallback(() => {
    setSelectedId(null);
    setSelectedWorkspaceScope(null);
    setSelectedNote(null);
    setTitleDraft("");
    setBodyDraft("");
    setAttachmentDrafts([]);
    setError(null);
  }, []);

  const refreshList = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setSelectedWorkspaceScope(null);
    setSelectedNote(null);
    setEditorCollapsed(true);
    setEditorExpanded(false);
    setError(null);
  }, [collection]);

  useEffect(() => {
    setItems([]);
    setLoading(false);
    setDetailLoading(false);
    setPendingEditorOpen(false);
    setEditorCollapsed(true);
    setEditorExpanded(false);
    setImagePreview(null);
    resetDraft();
  }, [resetDraft, workspaceScopeKey]);

  useEffect(() => {
    if (!workspaceId || !focusNoteId) {
      return;
    }
    setCollection("active");
    setSelectedId(focusNoteId);
    setSelectedWorkspaceScope(workspaceScopeKey);
    setEditorCollapsed(false);
    setEditorExpanded(false);
  }, [focusNoteId, focusRequestKey, workspaceId, workspaceScopeKey]);

  useEffect(() => {
    if (!archived && selectedId) {
      setEditorCollapsed(false);
    }
  }, [archived, selectedId]);

  useEffect(() => {
    if (!archived && pendingEditorOpen) {
      setEditorCollapsed(false);
      setEditorExpanded(false);
      setPendingEditorOpen(false);
    }
  }, [archived, pendingEditorOpen]);

  useEffect(() => {
    if (!workspaceId) {
      setItems([]);
      setSelectedId(null);
      setSelectedWorkspaceScope(null);
      setSelectedNote(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void noteCardsFacade
        .list({
          workspaceId,
          workspaceName,
          workspacePath,
          archived,
          query: null,
          page: 0,
          pageSize: 200,
        })
        .then((response) => {
          if (cancelled) {
            return;
          }
          setItems(response.items);
          if (selectedId && !response.items.some((item) => item.id === selectedId)) {
            setSelectedId(null);
            setSelectedWorkspaceScope(null);
            setSelectedNote(null);
            if (!archived) {
              setTitleDraft("");
              setBodyDraft("");
              setAttachmentDrafts([]);
            }
          }
        })
        .catch((listError) => {
          if (cancelled) {
            return;
          }
          setItems([]);
          setError(
            listError instanceof Error ? listError.message : String(listError),
          );
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    archived,
    refreshNonce,
    selectedId,
    workspaceId,
    workspaceName,
    workspacePath,
  ]);

  useEffect(() => {
    if (!workspaceId || !selectedId || selectedWorkspaceScope !== workspaceScopeKey) {
      setSelectedNote(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setError(null);
    void noteCardsFacade
      .get({
        noteId: selectedId,
        workspaceId,
        workspaceName,
        workspacePath,
      })
      .then((note) => {
        if (cancelled) {
          return;
        }
        setSelectedNote(note);
        if (!note || archived) {
          return;
        }
        setTitleDraft(note.title);
        setBodyDraft(note.bodyMarkdown);
        setAttachmentDrafts(note.attachments.map((attachment) => attachment.absolutePath));
      })
      .catch((detailError) => {
        if (!cancelled) {
          setError(detailError instanceof Error ? detailError.message : String(detailError));
          setSelectedNote(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [archived, selectedId, selectedWorkspaceScope, workspaceId, workspaceName, workspacePath, workspaceScopeKey]);

  const emptyMessage = useMemo(() => {
    if (!workspaceId) {
      return t("noteCards.emptyWorkspace");
    }
    if (loading) {
      return t("noteCards.loading");
    }
    return archived ? t("noteCards.emptyArchive") : t("noteCards.emptyPool");
  }, [archived, loading, t, workspaceId]);

  const formatDate = useCallback(
    (value?: number | null) => {
      if (!value) {
        return "--";
      }
      return new Intl.DateTimeFormat(i18n.language || undefined, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    },
    [i18n.language],
  );

  const handlePickImages = useCallback(async () => {
    try {
      const picked = await pickImageFiles();
      if (picked.length === 0) {
        return;
      }
      setAttachmentDrafts((previous) => {
        const next = [...previous];
        for (const path of picked) {
          if (!next.includes(path)) {
            next.push(path);
          }
        }
        return next;
      });
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : String(pickError));
    }
  }, []);

  const handleAttachImages = useCallback((paths: string[]) => {
    setAttachmentDrafts((previous) => {
      const next = [...previous];
      for (const path of paths) {
        if (!next.includes(path)) {
          next.push(path);
        }
      }
      return next;
    });
  }, []);

  const handleRemoveAttachment = useCallback((path: string) => {
    setAttachmentDrafts((previous) => previous.filter((entry) => entry !== path));
  }, []);

  const handleSave = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    if (!titleDraft.trim() && !bodyDraft.trim() && attachmentDrafts.length === 0) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const currentSelectedId = selectedId;
      const isUpdate = Boolean(currentSelectedId && !archived);
      const payload = {
        workspaceId,
        workspaceName,
        workspacePath,
        title: titleDraft.trim() || null,
        bodyMarkdown: bodyDraft,
        attachmentInputs: attachmentDrafts,
      };
      const note =
        isUpdate && currentSelectedId
          ? await noteCardsFacade.update(currentSelectedId, workspaceId, payload)
          : await noteCardsFacade.create(payload);
      setSelectedId(note.id);
      setSelectedWorkspaceScope(workspaceScopeKey);
      setSelectedNote(note);
      setTitleDraft(note.title);
      setBodyDraft(note.bodyMarkdown);
      setAttachmentDrafts(note.attachments.map((attachment) => attachment.absolutePath));
      if (archived) {
        setCollection("active");
      }
      refreshList();
      pushErrorToast({
        id: "workspace-note-card-save-success",
        title: t("noteCards.saveSuccessTitle"),
        message: t(isUpdate ? "noteCards.saveSuccessUpdateMessage" : "noteCards.saveSuccessCreateMessage"),
        variant: "success",
        durationMs: 2400,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [
    archived,
    attachmentDrafts,
    bodyDraft,
    refreshList,
    selectedId,
    t,
    titleDraft,
    workspaceId,
    workspaceName,
    workspacePath,
    workspaceScopeKey,
  ]);

  const handleArchive = useCallback(
    async (noteId: string) => {
      if (!workspaceId) {
        return;
      }
      try {
        await noteCardsFacade.archive({
          noteId,
          workspaceId,
          workspaceName,
          workspacePath,
        });
        if (selectedId === noteId) {
          resetDraft();
          setEditorCollapsed(true);
          setEditorExpanded(false);
        }
        refreshList();
      } catch (archiveError) {
        setError(archiveError instanceof Error ? archiveError.message : String(archiveError));
      }
    },
    [refreshList, resetDraft, selectedId, workspaceId, workspaceName, workspacePath],
  );

  const handleRestore = useCallback(
    async (noteId: string) => {
      if (!workspaceId) {
        return;
      }
      try {
        const restored = await noteCardsFacade.restore({
          noteId,
          workspaceId,
          workspaceName,
          workspacePath,
        });
        setCollection("active");
        setSelectedId(restored.id);
        setSelectedWorkspaceScope(workspaceScopeKey);
        refreshList();
      } catch (restoreError) {
        setError(restoreError instanceof Error ? restoreError.message : String(restoreError));
      }
    },
    [refreshList, workspaceId, workspaceName, workspacePath, workspaceScopeKey],
  );

  const handleDelete = useCallback(
    async (noteId: string, title?: string | null) => {
      const confirmed = await confirm(
        t("noteCards.deleteConfirm", {
          title: title?.trim() || t("noteCards.untitled"),
        }),
        {
          title: t("noteCards.deleteAction"),
          kind: "warning",
          okLabel: t("noteCards.deleteAction"),
          cancelLabel: t("common.cancel"),
        },
      );
      if (!confirmed) {
        return;
      }
      if (!workspaceId) {
        return;
      }
      try {
        await noteCardsFacade.delete({
          noteId,
          workspaceId,
          workspaceName,
          workspacePath,
        });
        if (selectedId === noteId) {
          resetDraft();
          setEditorCollapsed(true);
          setEditorExpanded(false);
        }
        refreshList();
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      }
    },
    [refreshList, resetDraft, selectedId, t, workspaceId, workspaceName, workspacePath],
  );

  const handleSelectCard = useCallback(
    (noteId: string) => {
      setSelectedId(noteId);
      setSelectedWorkspaceScope(workspaceScopeKey);
      if (!archived) {
        setEditorCollapsed(false);
      }
    },
    [archived, workspaceScopeKey],
  );

  const handleCreateNote = useCallback(() => {
    setPendingEditorOpen(true);
    if (archived) {
      setCollection("active");
    }
    resetDraft();
  }, [archived, resetDraft]);

  const handleCollapseEditor = useCallback(() => {
    setEditorCollapsed(true);
    setEditorExpanded(false);
  }, []);

  const previewNote = selectedNote;
  const saveLabel = selectedId && !archived ? t("noteCards.saveUpdate") : t("noteCards.saveCreate");
  const editorToggleLabel = editorExpanded ? t("noteCards.restoreEditor") : t("noteCards.maximizeEditor");
  const editorCollapseLabel = editorCollapsed ? t("noteCards.expandEditor") : t("noteCards.collapseEditor");
  const attachImageLabel = t("noteCards.attachImage");
  const editorHintLabel = t("noteCards.editorHint");
  const storageHint = t("noteCards.storageHint", {
    path: buildNoteCardStorageHintPath(projectName),
  });
  const shouldShowExpandedEditor = !archived && !editorCollapsed;
  const listItems = useMemo(
    () => (selectedId && shouldShowExpandedEditor ? items.filter((item) => item.id !== selectedId) : items),
    [items, selectedId, shouldShowExpandedEditor],
  );
  const isListEmpty = listItems.length === 0;
  const shouldShowList = listItems.length > 0 || (!selectedId && items.length === 0);

  return (
    <div
      className={`workspace-note-cards-panel${
        editorExpanded && shouldShowExpandedEditor ? " is-editor-expanded" : ""
      } [--note-card-accent:var(--accent-primary,var(--text-accent,#2563eb))] [--note-card-list-card-height:196px] [--note-card-surface:color-mix(in_srgb,var(--surface-card,#ffffff)_94%,var(--surface-panel,#f8fafc))] [--note-card-surface-muted:color-mix(in_srgb,var(--surface-item,var(--surface-card,#ffffff))_86%,transparent)] [--note-card-surface-active:color-mix(in_srgb,var(--surface-active,var(--surface-item,#f1f5f9))_74%,var(--surface-card,#ffffff))] [--note-card-border:color-mix(in_srgb,var(--border-subtle,#cbd5e1)_82%,transparent)] [--note-card-border-strong:color-mix(in_srgb,var(--border-strong,var(--border-subtle,#cbd5e1))_88%,transparent)] [--note-card-text-strong:var(--text-strong,var(--text-primary,inherit))] [--note-card-text-muted:var(--text-muted,var(--text-secondary,inherit))] [--note-card-danger:var(--status-error,var(--text-danger,#dc2626))] flex flex-col gap-3 h-full p-3 overflow-hidden text-[var(--note-card-text-strong)] bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--note-card-accent)_12%,transparent),transparent_34%),linear-gradient(180deg,color-mix(in_srgb,var(--surface-panel,var(--surface-card,#ffffff))_96%,transparent),color-mix(in_srgb,var(--surface-panel,var(--surface-card,#ffffff))_88%,transparent))]`}
    >
      <header className="workspace-note-cards-topbar flex flex-col gap-2.5 p-3 shrink-0 border border-[var(--note-card-border)] bg-[var(--note-card-surface)] rounded-[14px]">
        <div className="workspace-note-cards-topbar-main grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 min-w-0 justify-between">
          <span className="workspace-note-cards-title-icon inline-flex items-center justify-center w-[34px] h-[34px] rounded-xl bg-[color-mix(in_srgb,var(--note-card-accent)_14%,transparent)] text-[var(--note-card-accent)]" aria-hidden>
            <NotebookPen size={16} />
          </span>

          <div className="workspace-note-cards-collection-switch inline-flex gap-1.5 p-1 bg-[var(--note-card-surface-muted)] rounded-full justify-self-start shrink-0" role="tablist" aria-label={t("noteCards.title")}>
            <button
              type="button"
              className={`workspace-note-cards-collection-tab border-0 bg-transparent text-inherit py-1.5 px-2.5 rounded-full cursor-pointer text-xs ${!archived ? "is-active bg-[color-mix(in_srgb,var(--note-card-accent)_14%,transparent)] text-[var(--note-card-accent)]" : ""}`}
              onClick={() => setCollection("active")}
            >
              {t("noteCards.pool")}
            </button>
            <button
              type="button"
              className={`workspace-note-cards-collection-tab border-0 bg-transparent text-inherit py-1.5 px-2.5 rounded-full cursor-pointer text-xs ${archived ? "is-active bg-[color-mix(in_srgb,var(--note-card-accent)_14%,transparent)] text-[var(--note-card-accent)]" : ""}`}
              onClick={() => setCollection("archive")}
            >
              {t("noteCards.archive")}
            </button>
          </div>

          <div className="workspace-note-cards-header-actions flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="ghost icon-button"
              onClick={handleCreateNote}
              aria-label={t("noteCards.new")}
              title={t("noteCards.new")}
            >
              <Plus size={14} aria-hidden />
            </button>
          </div>
        </div>
        <p className="workspace-note-cards-storage-hint m-0 text-xs leading-[1.5] text-[var(--note-card-text-muted)] [overflow-wrap:anywhere]">{storageHint}</p>
      </header>

      {!archived ? (
        <section
          className={`workspace-note-cards-editor${editorCollapsed ? " is-collapsed gap-0" : " gap-2.5"} border border-[var(--note-card-border)] bg-[var(--note-card-surface)] rounded-[14px] p-3 shrink-0 flex flex-col min-h-0`}
        >
          <div className="workspace-note-cards-editor-head flex items-center justify-between gap-3 min-w-0">
            <div className="workspace-note-cards-editor-copy flex items-center gap-2 min-w-0 flex-1" title={editorHintLabel}>
              <h3 className="m-0 text-sm font-bold whitespace-nowrap">{selectedId ? t("noteCards.editorEdit") : t("noteCards.editorCreate")}</h3>
              <span className="m-0 text-[var(--note-card-text-muted)] text-xs whitespace-nowrap overflow-hidden text-ellipsis">{editorHintLabel}</span>
            </div>
            <div className="workspace-note-cards-head-actions flex items-center gap-2 flex-nowrap justify-end shrink-0">
              <button
                type="button"
                className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-inherit cursor-pointer text-xs shrink-0"
                onClick={() => {
                  if (editorCollapsed) {
                    setEditorCollapsed(false);
                    return;
                  }
                  handleCollapseEditor();
                }}
                aria-label={editorCollapseLabel}
                title={editorCollapseLabel}
              >
                {editorCollapsed ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />}
              </button>
              {shouldShowExpandedEditor ? (
                <button
                  type="button"
                  className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-inherit cursor-pointer text-xs shrink-0"
                  onClick={() => setEditorExpanded((value) => !value)}
                  aria-label={editorToggleLabel}
                  title={editorToggleLabel}
                >
                  {editorExpanded ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
                </button>
              ) : null}
              {shouldShowExpandedEditor && selectedId ? (
                <button
                  type="button"
                  className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action workspace-note-cards-danger inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-[var(--note-card-danger)] cursor-pointer text-xs shrink-0"
                  onClick={() => void handleDelete(selectedId, selectedNote?.title ?? titleDraft)}
                  aria-label={t("noteCards.deleteAction")}
                  title={t("noteCards.deleteAction")}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              ) : null}
              {shouldShowExpandedEditor && selectedId ? (
                <button
                  type="button"
                  className="ghost workspace-note-cards-clear workspace-note-cards-icon-action inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-inherit cursor-pointer text-xs shrink-0"
                  onClick={resetDraft}
                  aria-label={t("noteCards.clear")}
                  title={t("noteCards.clear")}
                >
                  <X size={14} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
          {shouldShowExpandedEditor ? (
            <div className="workspace-note-cards-editor-body flex flex-col gap-2.5 min-h-0">
              <input
                className="workspace-note-cards-title-input w-full border-0 bg-transparent text-inherit outline-none h-[38px] px-3 border border-[var(--note-card-border)] rounded-xl mb-2.5"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                placeholder={t("noteCards.titlePlaceholder")}
              />

              <RichTextInput
                key={editorExpanded ? "expanded" : "default"}
                value={bodyDraft}
                onChange={setBodyDraft}
                attachments={attachmentDrafts}
                attachmentWorkspaceId={workspaceId}
                onAttachImages={handleAttachImages}
                onRemoveAttachment={handleRemoveAttachment}
                placeholder={t("noteCards.bodyPlaceholder")}
                enableResize
                initialHeight={editorExpanded ? 520 : 180}
                minHeight={editorExpanded ? 340 : 140}
                maxHeight={editorExpanded ? 1600 : 320}
                className="workspace-note-cards-rich-input"
                footerClassName="workspace-note-cards-rich-footer flex-nowrap"
                footerLeft={(
                  <button
                    type="button"
                    className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-inherit cursor-pointer text-xs shrink-0"
                    onClick={() => void handlePickImages()}
                    aria-label={attachImageLabel}
                    title={attachImageLabel}
                  >
                    <ImagePlus size={14} aria-hidden />
                  </button>
                )}
                footerRight={(
                  <button
                    type="button"
                    className="workspace-note-cards-save workspace-note-cards-icon-action inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-accent)] bg-[var(--note-card-accent)] text-white p-0 w-[34px] h-[34px] cursor-pointer text-xs shrink-0 disabled:opacity-60 disabled:cursor-default"
                    onClick={() => void handleSave()}
                    disabled={saving || !workspaceId}
                    aria-label={saveLabel}
                    title={saveLabel}
                  >
                    <Save size={14} aria-hidden />
                  </button>
                )}
              />
            </div>
          ) : null}
        </section>
      ) : (
        <section className="workspace-note-cards-preview-panel border border-[var(--note-card-border)] bg-[var(--note-card-surface)] rounded-[14px] p-3 shrink-0 flex flex-col gap-2.5 min-h-0">
          <div className="workspace-note-cards-editor-head flex items-center justify-between gap-3 min-w-0">
            <div>
              <h3 className="m-0 text-sm font-bold">{t("noteCards.previewTitle")}</h3>
              <p className="m-0 text-[var(--note-card-text-muted)] text-xs">{t("noteCards.previewHint")}</p>
            </div>
          </div>
          {detailLoading ? (
            <div className="workspace-note-cards-empty p-4 rounded-[14px] text-center text-[var(--note-card-text-muted)] bg-[var(--note-card-surface-muted)]">
              {t("noteCards.loading")}
            </div>
          ) : previewNote ? (
            <article className="workspace-note-cards-preview-card flex flex-col gap-3 min-h-0">
              <div className="workspace-note-cards-preview-head flex items-center justify-between gap-2.5 min-w-0">
                <div className="workspace-note-cards-preview-meta flex-1 min-w-0 text-[var(--note-card-text-muted)] text-[11px]">
                  <h4 className="m-0 text-sm font-bold">{previewNote.title || t("noteCards.untitled")}</h4>
                  <span>{t("noteCards.updatedAt", { time: formatDate(previewNote.updatedAt) })}</span>
                </div>
                <div className="workspace-note-cards-head-actions flex items-center gap-2 flex-nowrap justify-end shrink-0">
                  <button
                    type="button"
                    className="workspace-note-cards-inline-action workspace-note-cards-icon-action inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-inherit cursor-pointer text-xs shrink-0"
                    onClick={() => void handleRestore(previewNote.id)}
                    aria-label={t("noteCards.restore")}
                    title={t("noteCards.restore")}
                  >
                    <Undo2 size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action workspace-note-cards-danger inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-[var(--note-card-danger)] cursor-pointer text-xs shrink-0"
                    onClick={() => void handleDelete(previewNote.id, previewNote.title)}
                    aria-label={t("noteCards.deleteAction")}
                    title={t("noteCards.deleteAction")}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </div>
              <Markdown
                className="markdown workspace-note-cards-preview-markdown max-h-[220px] overflow-auto p-3 rounded-xl bg-[var(--note-card-surface-muted)]"
                value={previewNote.bodyMarkdown || previewNote.plainTextExcerpt}
              />
              {previewNote.attachments.length > 0 ? (
                <div className="workspace-note-cards-preview-images grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-2">
                  {previewNote.attachments.map((attachment) => {
                    const src = attachmentPreviewSrc(attachment.absolutePath);
                    return (
                      <button
                        key={attachment.id}
                        type="button"
                        className="workspace-note-cards-preview-image flex items-center justify-center w-full min-h-[116px] p-2 overflow-hidden appearance-none rounded-xl bg-[var(--note-card-surface-muted)] border border-[var(--note-card-border)] cursor-zoom-in hover:border-[color-mix(in_srgb,var(--note-card-accent)_36%,var(--note-card-border))] [&_img]:w-full [&_img]:h-full [&_img]:max-h-[160px] [&_img]:object-contain"
                        onClick={() => {
                          if (src) {
                            setImagePreview({
                              src,
                              localPath: attachment.absolutePath,
                              fileName: attachment.fileName,
                            });
                          }
                        }}
                        title={attachment.fileName}
                      >
                        {src ? (
                          <LocalImage
                            src={src}
                            localPath={attachment.absolutePath}
                            workspaceId={workspaceId}
                            alt={attachment.fileName}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </article>
          ) : (
            <div className="workspace-note-cards-empty p-4 rounded-[14px] text-center text-[var(--note-card-text-muted)] bg-[var(--note-card-surface-muted)]">
              {t("noteCards.previewEmpty")}
            </div>
          )}
        </section>
      )}

      {error ? (
        <div className="workspace-note-cards-error p-4 rounded-[14px] text-center text-[var(--note-card-danger)] bg-[color-mix(in_srgb,var(--note-card-danger)_10%,var(--note-card-surface))]">
          {error}
        </div>
      ) : null}

      {shouldShowList ? (
        <section
          className={`workspace-note-cards-list${
            isListEmpty
              ? " is-empty flex items-center justify-center pr-0"
              : " grid grid-cols-2 max-[860px]:grid-cols-1 pr-0.5"
          } flex-1 gap-2.5 content-start min-h-0 overflow-auto`}
        >
          {isListEmpty ? (
            <div className="workspace-note-cards-empty w-[min(100%,520px)] min-h-[164px] flex items-center justify-center p-6 rounded-[14px] text-center text-[var(--note-card-text-muted)] bg-[var(--note-card-surface-muted)]">
              {emptyMessage}
            </div>
          ) : (
            listItems.map((item) => {
              const isSelected = item.id === selectedId;
              return (
                <article
                  key={item.id}
                  className={`workspace-note-cards-card${isSelected ? " is-selected border-[color-mix(in_srgb,var(--note-card-accent)_45%,var(--note-card-border))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--note-card-accent)_18%,transparent)]" : ""} grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 min-h-[var(--note-card-list-card-height)] h-[var(--note-card-list-card-height)] p-3 overflow-hidden border border-[var(--note-card-border)] bg-[var(--note-card-surface)] rounded-[14px]`}
                >
                  <button
                    type="button"
                    className="workspace-note-cards-card-main flex flex-col gap-2 h-full min-w-0 p-0 border-0 bg-transparent text-left text-inherit cursor-pointer"
                    onClick={() => handleSelectCard(item.id)}
                  >
                    <div className="workspace-note-cards-card-head flex items-center justify-between gap-2 min-w-0">
                      <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{item.title || t("noteCards.untitled")}</strong>
                      {item.imageCount > 0 ? (
                        <span className="workspace-note-cards-card-badge inline-flex items-center px-2 py-1 rounded-full bg-[color-mix(in_srgb,var(--note-card-accent)_12%,transparent)] text-[var(--note-card-accent)] text-[11px]">
                          {t("noteCards.imageCount", { count: item.imageCount })}
                        </span>
                      ) : null}
                    </div>
                    <p className="m-0 text-[var(--note-card-text-muted)] text-xs leading-[1.5] overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5] [line-clamp:5]">
                      {item.plainTextExcerpt || t("noteCards.previewEmpty")}
                    </p>
                    <div className="workspace-note-cards-card-meta flex items-center mt-auto gap-2 flex-wrap text-[var(--note-card-text-muted)] text-[11px] justify-between">
                      <span>{t("noteCards.updatedAt", { time: formatDate(item.updatedAt) })}</span>
                      {item.archived ? (
                        <span>{t("noteCards.archivedState")}</span>
                      ) : null}
                    </div>
                  </button>
                  <div className="workspace-note-cards-card-actions flex items-center gap-2 flex-nowrap self-start text-[var(--note-card-text-muted)] text-[11px]">
                    {archived ? (
                      <button
                        type="button"
                        className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-inherit cursor-pointer text-xs shrink-0"
                        onClick={() => void handleRestore(item.id)}
                        aria-label={t("noteCards.restore")}
                        title={t("noteCards.restore")}
                      >
                        <Undo2 size={14} aria-hidden />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-inherit cursor-pointer text-xs shrink-0"
                        onClick={() => void handleArchive(item.id)}
                        aria-label={t("noteCards.archiveAction")}
                        title={t("noteCards.archiveAction")}
                      >
                        <Archive size={14} aria-hidden />
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action workspace-note-cards-danger inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--note-card-border)] p-0 w-[34px] h-[34px] bg-transparent text-[var(--note-card-danger)] cursor-pointer text-xs shrink-0"
                      onClick={() => void handleDelete(item.id, item.title)}
                      aria-label={t("noteCards.deleteAction")}
                      title={t("noteCards.deleteAction")}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      ) : null}

      {imagePreview ? (
        <ImagePreviewOverlay
          src={imagePreview.src}
          localPath={imagePreview.localPath}
          workspaceId={workspaceId}
          alt={imagePreview.fileName}
          onClose={() => setImagePreview(null)}
        />
      ) : null}
    </div>
  );
}
