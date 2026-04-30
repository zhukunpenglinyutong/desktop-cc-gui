import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import Archive from "lucide-react/dist/esm/icons/archive";
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
import { Markdown } from "../../messages/components/Markdown";
import { pickImageFiles, type WorkspaceNoteCard, type WorkspaceNoteCardSummary } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { noteCardsFacade } from "../services/noteCardsFacade";

type WorkspaceNoteCardPanelProps = {
  workspaceId: string | null;
  workspaceName?: string | null;
  workspacePath?: string | null;
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

export function WorkspaceNoteCardPanel({
  workspaceId,
  workspaceName = null,
  workspacePath = null,
}: WorkspaceNoteCardPanelProps) {
  const { t, i18n } = useTranslation();
  const [collection, setCollection] = useState<NoteCardCollection>("active");
  const [items, setItems] = useState<WorkspaceNoteCardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<WorkspaceNoteCard | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [attachmentDrafts, setAttachmentDrafts] = useState<string[]>([]);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [imagePreview, setImagePreview] = useState<NoteCardImagePreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const archived = collection === "archive";
  const projectName = useMemo(
    () => deriveProjectName(workspaceId, workspaceName, workspacePath),
    [workspaceId, workspaceName, workspacePath],
  );

  const resetDraft = useCallback(() => {
    setSelectedId(null);
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
    setSelectedNote(null);
    setEditorExpanded(false);
    setError(null);
  }, [collection]);

  useEffect(() => {
    if (!workspaceId) {
      setItems([]);
      setSelectedId(null);
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
    if (!workspaceId || !selectedId) {
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
  }, [archived, selectedId, workspaceId, workspaceName, workspacePath]);

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
        refreshList();
      } catch (restoreError) {
        setError(restoreError instanceof Error ? restoreError.message : String(restoreError));
      }
    },
    [refreshList, workspaceId, workspaceName, workspacePath],
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
        }
        refreshList();
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      }
    },
    [refreshList, resetDraft, selectedId, t, workspaceId, workspaceName, workspacePath],
  );

  const handleSelectCard = useCallback((noteId: string) => {
    setSelectedId(noteId);
  }, []);

  const previewNote = selectedNote;
  const saveLabel = selectedId && !archived ? t("noteCards.saveUpdate") : t("noteCards.saveCreate");
  const editorToggleLabel = editorExpanded ? t("noteCards.restoreEditor") : t("noteCards.maximizeEditor");
  const attachImageLabel = t("noteCards.attachImage");
  const editorHintLabel = t("noteCards.editorHint");
  const storageHint = t("noteCards.storageHint", {
    path: `~/.ccgui/note_card/${projectName}/active | archive`,
  });
  const listItems = useMemo(
    () => (selectedId ? items.filter((item) => item.id !== selectedId) : items),
    [items, selectedId],
  );
  const shouldShowList = listItems.length > 0 || (!selectedId && items.length === 0);

  return (
    <div className={`workspace-note-cards-panel${editorExpanded && !archived ? " is-editor-expanded" : ""}`}>
      <header className="workspace-note-cards-topbar">
        <div className="workspace-note-cards-topbar-main">
          <span className="workspace-note-cards-title-icon" aria-hidden>
            <NotebookPen size={16} />
          </span>

          <div className="workspace-note-cards-collection-switch" role="tablist" aria-label={t("noteCards.title")}>
            <button
              type="button"
              className={`workspace-note-cards-collection-tab${!archived ? " is-active" : ""}`}
              onClick={() => setCollection("active")}
            >
              {t("noteCards.pool")}
            </button>
            <button
              type="button"
              className={`workspace-note-cards-collection-tab${archived ? " is-active" : ""}`}
              onClick={() => setCollection("archive")}
            >
              {t("noteCards.archive")}
            </button>
          </div>

          <div className="workspace-note-cards-header-actions">
            <button
              type="button"
              className="ghost icon-button"
              onClick={resetDraft}
              aria-label={t("noteCards.new")}
              title={t("noteCards.new")}
            >
              <Plus size={14} aria-hidden />
            </button>
          </div>
        </div>
        <p className="workspace-note-cards-storage-hint">{storageHint}</p>
      </header>

      {!archived ? (
        <section className="workspace-note-cards-editor">
          <div className="workspace-note-cards-editor-head">
            <div className="workspace-note-cards-editor-copy" title={editorHintLabel}>
              <h3>{selectedId ? t("noteCards.editorEdit") : t("noteCards.editorCreate")}</h3>
              <span>{editorHintLabel}</span>
            </div>
            <div className="workspace-note-cards-head-actions">
              <button
                type="button"
                className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action"
                onClick={() => setEditorExpanded((value) => !value)}
                aria-label={editorToggleLabel}
                title={editorToggleLabel}
              >
                {editorExpanded ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
              </button>
              {selectedId ? (
                <button
                  type="button"
                  className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action workspace-note-cards-danger"
                  onClick={() => void handleDelete(selectedId, selectedNote?.title ?? titleDraft)}
                  aria-label={t("noteCards.deleteAction")}
                  title={t("noteCards.deleteAction")}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              ) : null}
              {selectedId ? (
                <button
                  type="button"
                  className="ghost workspace-note-cards-clear workspace-note-cards-icon-action"
                  onClick={resetDraft}
                  aria-label={t("noteCards.clear")}
                  title={t("noteCards.clear")}
                >
                  <X size={14} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          <input
            className="workspace-note-cards-title-input"
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
            footerClassName="workspace-note-cards-rich-footer"
            footerLeft={(
              <button
                type="button"
                className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action"
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
                className="workspace-note-cards-save workspace-note-cards-icon-action"
                onClick={() => void handleSave()}
                disabled={saving || !workspaceId}
                aria-label={saveLabel}
                title={saveLabel}
              >
                <Save size={14} aria-hidden />
              </button>
            )}
          />
        </section>
      ) : (
        <section className="workspace-note-cards-preview-panel">
          <div className="workspace-note-cards-editor-head">
            <div>
              <h3>{t("noteCards.previewTitle")}</h3>
              <p>{t("noteCards.previewHint")}</p>
            </div>
          </div>
          {detailLoading ? (
            <div className="workspace-note-cards-empty">{t("noteCards.loading")}</div>
          ) : previewNote ? (
            <article className="workspace-note-cards-preview-card">
              <div className="workspace-note-cards-preview-head">
                <div className="workspace-note-cards-preview-meta">
                  <h4>{previewNote.title || t("noteCards.untitled")}</h4>
                  <span>{t("noteCards.updatedAt", { time: formatDate(previewNote.updatedAt) })}</span>
                </div>
                <div className="workspace-note-cards-head-actions">
                  <button
                    type="button"
                    className="workspace-note-cards-inline-action workspace-note-cards-icon-action"
                    onClick={() => void handleRestore(previewNote.id)}
                    aria-label={t("noteCards.restore")}
                    title={t("noteCards.restore")}
                  >
                    <Undo2 size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action workspace-note-cards-danger"
                    onClick={() => void handleDelete(previewNote.id, previewNote.title)}
                    aria-label={t("noteCards.deleteAction")}
                    title={t("noteCards.deleteAction")}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </div>
              <Markdown
                className="markdown workspace-note-cards-preview-markdown"
                value={previewNote.bodyMarkdown || previewNote.plainTextExcerpt}
              />
              {previewNote.attachments.length > 0 ? (
                <div className="workspace-note-cards-preview-images">
                  {previewNote.attachments.map((attachment) => {
                    const src = attachmentPreviewSrc(attachment.absolutePath);
                    return (
                      <button
                        key={attachment.id}
                        type="button"
                        className="workspace-note-cards-preview-image"
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
            <div className="workspace-note-cards-empty">{t("noteCards.previewEmpty")}</div>
          )}
        </section>
      )}

      {error ? (
        <div className="workspace-note-cards-error">{error}</div>
      ) : null}

      {shouldShowList ? (
        <section className="workspace-note-cards-list">
          {listItems.length === 0 ? (
            <div className="workspace-note-cards-empty">{emptyMessage}</div>
          ) : (
            listItems.map((item) => {
              const isSelected = item.id === selectedId;
              return (
                <article
                  key={item.id}
                  className={`workspace-note-cards-card${isSelected ? " is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="workspace-note-cards-card-main"
                    onClick={() => handleSelectCard(item.id)}
                  >
                    <div className="workspace-note-cards-card-head">
                      <strong>{item.title || t("noteCards.untitled")}</strong>
                      {item.imageCount > 0 ? (
                        <span className="workspace-note-cards-card-badge">
                          {t("noteCards.imageCount", { count: item.imageCount })}
                        </span>
                      ) : null}
                    </div>
                    <p>{item.plainTextExcerpt || t("noteCards.previewEmpty")}</p>
                    <div className="workspace-note-cards-card-meta">
                      <span>{t("noteCards.updatedAt", { time: formatDate(item.updatedAt) })}</span>
                      {item.archived ? (
                        <span>{t("noteCards.archivedState")}</span>
                      ) : null}
                    </div>
                  </button>
                  <div className="workspace-note-cards-card-actions">
                    {archived ? (
                      <button
                        type="button"
                        className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action"
                        onClick={() => void handleRestore(item.id)}
                        aria-label={t("noteCards.restore")}
                        title={t("noteCards.restore")}
                      >
                        <Undo2 size={14} aria-hidden />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action"
                        onClick={() => void handleArchive(item.id)}
                        aria-label={t("noteCards.archiveAction")}
                        title={t("noteCards.archiveAction")}
                      >
                        <Archive size={14} aria-hidden />
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost workspace-note-cards-inline-action workspace-note-cards-icon-action workspace-note-cards-danger"
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
