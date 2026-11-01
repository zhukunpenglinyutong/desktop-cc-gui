import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorSelection, type Extension } from "@codemirror/state";
import { closeSearchPanel, openSearchPanel } from "@codemirror/search";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import { useTranslation } from "react-i18next";
import type { FileContent } from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { Button } from "@/components/base/buttons/button";
import { useActionFeedback } from "@/components/base/action-feedback";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { IS_MAC, isWeb } from "@/lib/platform";
import { fileName, useFilesStore } from "./store";
import type { OpenFileState } from "./store";
import { BinaryFileView, ImageFileView } from "./EditorFallbackViews";
import {
  EditorSearchPanel,
  type EditorSearchDirection,
  type EditorSearchFocusRequest,
} from "./EditorSearchPanel";
import {
  clearEditorSearchQuery,
  createEditorSearchExtensions,
  type EditorSearchKeymapActions,
} from "./editor-search";
import { FileEditorHeader } from "./FileEditorHeader";
import { HtmlPreview } from "./HtmlPreview";
import { MarkdownPreview } from "./MarkdownPreview";
import { isHtmlFile, isMarkdownFile, opensInPreview, type EditorViewMode } from "./editor-view-mode";
import { registerShortcutHandler } from "@/features/shortcuts/runtime";
import { EditorView, lineNumbers } from "@codemirror/view";
import { FONT_CHANGE_EVENT } from "@/features/settings/font";
import { TYPOGRAPHY_CHANGE_EVENT } from "@/features/settings/interface-typography";

const CM_BASIC_SETUP = { foldGutter: false, highlightActiveLine: true };
const CM_LINE_SELECTION = lineNumbers({
  domEventHandlers: {
    mousedown(view, block, event) {
      if ((event as MouseEvent).button !== 0) return false;
      const line = view.state.doc.lineAt(block.from);
      const end = line.to < view.state.doc.length ? line.to + 1 : line.to;
      view.focus();
      view.dispatch({ selection: { anchor: line.from, head: end }, userEvent: "select.pointer" });
      return true;
    },
  },
});

/** Tracks the app theme class on <html> so CodeMirror follows light/dark. */
function useIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function EditorPane({ path }: { path: string }) {
  const entry = useFilesStore((s) => s.fileStates[path]);
  const [wordWrap, setWordWrap] = useState(false);

  if (!entry || entry.loading) {
    return <CenteredSpinner />;
  }
  if (entry.error) {
    return <FileLoadError key={`${path}:${entry.error}`} path={path} entry={entry} />;
  }
  if (!entry.content) {
    return <CenteredSpinner />;
  }
  // key remounts the editor with a fresh draft whenever the file (re)loads.
  return (
    <FileEditor
      key={`${path}:${entry.loadNonce}`}
      path={path}
      content={entry.content}
      wordWrap={wordWrap}
      onToggleWordWrap={() => setWordWrap((wrap) => !wrap)}
    />
  );
}

function FileLoadError({ path, entry }: { path: string; entry: OpenFileState }) {
  const { t } = useTranslation();
  const reloadFile = useFilesStore((s) => s.reloadFile);
  const openSessionFileExternally = useFilesStore((s) => s.openSessionFileExternally);
  const launch = useFilesStore((s) => s.externalEditorLaunches[path]);
  const opening = launch?.status === "opening";
  const opened = launch?.status === "opened";
  const openError = launch?.status === "error" ? launch.error : null;

  // Native read commands return strings; all document-size guards name the
  // same limit, including compressed, database and remote read paths.
  const tooLarge = entry.session !== undefined && /\bexceeds\b[^\n]*\b64 MiB\b/.test(entry.error ?? "");
  const invalidJsonl = entry.session !== undefined && /(?:invalid native JSONL on line|native JSONL line \d+ must be an object)/.test(entry.error ?? "");
  const externalRecovery = tooLarge || invalidJsonl;
  const unavailableReason = isWeb
    ? "files.externalEditorDesktopOnly"
    : entry.session?.remote || entry.session?.remotePath
      ? "files.externalEditorRemote"
      : ["dsh", "opencode", "agy"].includes(entry.session?.engine ?? "")
        ? "files.externalEditorStructured"
        : null;

  const openExternalEditor = async () => {
    if (opening || unavailableReason) return;
    try {
      await openSessionFileExternally(path);
    } catch {
      // The store retains the failure for this tab, including across reloads.
    }
  };

  return (
    <EmptyState className="flex-col gap-3 p-6">
      <p className={tooLarge ? "text-body-medium text-text-primary" : "text-body-medium text-text-error-primary"}>
        {t(tooLarge ? "files.sessionFileTooLargeTitle" : "files.fileNotFound")}
      </p>
      <p className="max-w-md break-all text-caption-1-regular text-text-tertiary">
        {tooLarge ? t("files.sessionFileTooLarge") : entry.error}
      </p>
      {externalRecovery && unavailableReason && (
        <p className="max-w-md text-caption-1-regular text-text-tertiary">{t(unavailableReason)}</p>
      )}
      {externalRecovery && entry.sourcePath && (
        <p className="max-w-md break-all text-caption-1-regular text-text-tertiary">{entry.sourcePath}</p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {externalRecovery && !unavailableReason && (
          <Button
            variant="secondary"
            size="small"
            leadingIcon={ExternalLink}
            aria-label={t("files.openInDefaultEditor")}
            aria-busy={opening}
            disabled={opening}
            onClick={() => void openExternalEditor()}
          >
            {t(opening ? "files.externalEditorOpening" : "files.openInDefaultEditor")}
          </Button>
        )}
        <Button variant="secondary" size="small" onClick={() => void reloadFile(path)}>
          {t("common.refresh")}
        </Button>
      </div>
      {openError && (
        <p role="alert" className="max-w-md break-all text-caption-1-regular text-text-error-primary">
          {t("files.externalEditorFailed", { error: openError })}
        </p>
      )}
      {opened && (
        <p role="status" className="max-w-md text-caption-1-regular text-text-tertiary">{t("files.externalEditorOpened")}</p>
      )}
    </EmptyState>
  );
}

function FileEditor({ path, content, wordWrap, onToggleWordWrap }: {
  path: string;
  content: FileContent;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
}) {
  const setFileDirty = useFilesStore((s) => s.setFileDirty);
  const entry = useFilesStore((s) => s.fileStates[path]);
  const saveFile = useFilesStore((s) => s.saveFile);
  // Inactive (invisible) editors stay mounted; only the visible tab may
  // answer Cmd/Ctrl+S, or every open file would save at once.
  const isActiveTab = useFilesStore((s) => s.activeFilePath === path);
  const dark = useIsDark();
  const editorRef = useRef<EditorView | null>(null);
  useEffect(() => {
    const measure = () => {
      const view = editorRef.current;
      if (view?.dom.isConnected) view.requestMeasure();
    };
    window.addEventListener(FONT_CHANGE_EVENT, measure);
    window.addEventListener(TYPOGRAPHY_CHANGE_EVENT, measure);
    return () => {
      window.removeEventListener(FONT_CHANGE_EVENT, measure);
      window.removeEventListener(TYPOGRAPHY_CHANGE_EVENT, measure);
      editorRef.current = null;
    };
  }, []);

  const name = entry?.name ?? fileName(path);
  const isMarkdown = isMarkdownFile(name);
  const isHtml = isHtmlFile(name);
  // HTML opens rendered too, but only where the asset protocol serves real
  // paths — web-access mode keeps the code view (see editor-view-mode.ts).
  const canPreview = opensInPreview(name, !isWeb);

  const [draft, setDraft] = useState(content.text ?? "");
  const [savedText, setSavedText] = useState(content.text ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<EditorViewMode>(canPreview ? "preview" : "edit");
  // HTML preview reload: bumped to remount the iframe (the frame reads the
  // saved file itself, so there is nothing else to refresh).
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  // Find bar for the markdown preview (⌘F / header button); closing the
  // preview drops it so switching back to read mode starts clean.
  const [previewSearchOpen, setPreviewSearchOpen] = useState(false);
  const [langExt, setLangExt] = useState<Extension[]>([]);
  // Truncated files are partial (editing + saving would clobber the tail);
  // remote-readOnly files are complete but unwritable — both stay read-only.
  const readOnly = content.truncated || content.readOnly === true;

  // Editor find/replace: React owns the visible card, CodeMirror owns the
  // search state, match highlighting and navigation commands. The native
  // panel is replaced by a hidden element (see editor-search.ts).
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [editorSearchOpen, setEditorSearchOpen] = useState(false);
  const [editorSearchReplace, setEditorSearchReplace] = useState(false);
  const [editorSearchFocus, setEditorSearchFocus] = useState<EditorSearchFocusRequest>({
    target: "find",
    token: 0,
  });
  const editorSearchOpenRef = useRef(false);
  const editorSearchNavigateRef = useRef<((direction: EditorSearchDirection) => void) | null>(null);
  const readOnlyRef = useRef(readOnly);
  useEffect(() => {
    readOnlyRef.current = readOnly;
  });

  const openEditorSearch = useCallback((view: EditorView, replace: boolean) => {
    if (replace && readOnlyRef.current) return;
    // Opening the CodeMirror panel state also enables cm-searchMatch
    // highlighting; the panel element itself is the hidden span.
    openSearchPanel(view);
    editorSearchOpenRef.current = true;
    setEditorSearchOpen(true);
    setEditorSearchReplace(replace);
    setEditorSearchFocus((current) => ({
      target: replace ? "replace" : "find",
      token: current.token + 1,
    }));
  }, []);

  const closeEditorSearchInternal = useCallback((focusEditor: boolean) => {
    if (!editorSearchOpenRef.current) return false;
    editorSearchOpenRef.current = false;
    setEditorSearchOpen(false);
    setEditorSearchReplace(false);
    const view = editorRef.current;
    if (view?.dom.isConnected) {
      closeSearchPanel(view);
      // Clear the query and collapse a single selection to its head like dbx
      // does, so the match highlight does not outlive the dismissed search.
      // Cursors from "select all matches" are kept: closing the card first
      // and then typing is how they get edited.
      clearEditorSearchQuery(view);
      const { selection } = view.state;
      if (selection.ranges.length === 1) {
        view.dispatch({ selection: EditorSelection.single(selection.main.head) });
      }
      // Switching tabs must not pull focus into the now-hidden editor.
      if (focusEditor) view.focus();
    }
    return true;
  }, []);
  const closeEditorSearch = useCallback(
    () => closeEditorSearchInternal(true),
    [closeEditorSearchInternal],
  );
  const dismissEditorSearch = useCallback(
    () => closeEditorSearchInternal(false),
    [closeEditorSearchInternal],
  );

  // The find card belongs to the active editor. Close it when another tab
  // becomes active, before the old SurfaceItem turns invisible: its expanded
  // replace row is a Collapsible, and content kept mounted there used to stay
  // painted over the newly active file.
  useLayoutEffect(() => {
    if (isActiveTab) return;
    dismissEditorSearch();
    // The preview find bar belongs to this tab too; do not bring it back
    // when the tab is activated again.
    setPreviewSearchOpen(false);
  }, [isActiveTab, dismissEditorSearch]);

  // F3 / Mod-G: step through the card (keeps its counter current), or open it
  // when it is closed.
  const stepEditorSearch = useCallback(
    (view: EditorView, direction: EditorSearchDirection) => {
      if (!editorSearchOpenRef.current) {
        openEditorSearch(view, false);
        return true;
      }
      editorSearchNavigateRef.current?.(direction);
      return true;
    },
    [openEditorSearch],
  );

  // Stable source for the CodeMirror keymap, which is built once but must
  // always call the latest callbacks.
  const searchActionsRef = useRef<EditorSearchKeymapActions>({
    openFind: (view) => {
      openEditorSearch(view, false);
      return true;
    },
    openReplace: (view) => {
      // Consume the shortcut in read-only files without offering mutation.
      if (readOnlyRef.current) return true;
      openEditorSearch(view, true);
      return true;
    },
    findNext: (view) => stepEditorSearch(view, "next"),
    findPrevious: (view) => stepEditorSearch(view, "prev"),
    close: () => closeEditorSearch(),
  });
  const searchExtensions = useMemo(
    () => createEditorSearchExtensions(searchActionsRef, IS_MAC),
    [],
  );
  const extensions = useMemo(
    () => [
      CM_LINE_SELECTION,
      ...langExt,
      ...searchExtensions,
      ...(wordWrap ? [EditorView.lineWrapping] : []),
    ],
    [langExt, wordWrap, searchExtensions],
  );
  const dirty = !readOnly && draft !== savedText;

  // Publish dirty state so the tab strip can dot the tab and confirm closes.
  useEffect(() => {
    setFileDirty(path, dirty);
    return () => setFileDirty(path, false);
  }, [dirty, path, setFileDirty]);

  const handleViewModeChange = useCallback((mode: EditorViewMode) => {
    setPreviewSearchOpen(false);
    // Close before the CodeMirror view unmounts, otherwise the open-panel
    // state and match highlights would be dropped without a teardown.
    closeEditorSearch();
    setViewMode(mode);
  }, [closeEditorSearch]);

  // 刷新走 §4.1 转圈 → 对号：iframe 重挂载没有可等待的完成事件，对号 = 重新
  // 加载指令已下发（与内置浏览器的刷新语义一致）。
  const reloadPreview = useActionFeedback({ spin: true });
  const handleReloadPreview = () => {
    void reloadPreview.start(() => {
      setPreviewReloadKey((key) => key + 1);
      return Promise.resolve();
    });
  };

  // Resolve a CodeMirror grammar from the file extension (lazy-loaded).
  useEffect(() => {
    let cancelled = false;
    setLangExt([]);
    const desc = LanguageDescription.matchFilename(languages, name);
    if (!desc) return;
    void desc.load().then((ext) => {
      if (!cancelled) setLangExt([ext]);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const committed = await saveFile(path, draft);
      setSavedText(committed);
      setDraft((current) => current === draft ? committed : current);
    } catch (e) {
      setSaveError(errorText(e));
    } finally {
      setSaving(false);
    }
  }, [path, draft, saveFile]);

  // Cmd/Ctrl+S saves from anywhere while this editor is mounted. The listener
  // subscribes once; refs keep it reading the latest save/dirty/saving so it
  // isn't re-attached on every keystroke. The refs sync after commit; the
  // only reader is the keydown handler, which always fires post-commit.
  const saveRef = useRef(save);
  const dirtyRef = useRef(dirty);
  const savingRef = useRef(saving);
  const activeRef = useRef(isActiveTab);
  useEffect(() => {
    saveRef.current = save;
    dirtyRef.current = dirty;
    savingRef.current = saving;
    activeRef.current = isActiveTab;
  });
  // Save key lives in the shortcut runtime (default ⌘S, configurable in
  // Settings → Shortcuts). Refs keep the handler reading the latest
  // save/dirty/saving so it isn't re-registered on every keystroke.
  useEffect(() => {
    if (readOnly) return;
    return registerShortcutHandler("saveFile", () => {
      if (!activeRef.current) return;
      if (dirtyRef.current && !savingRef.current) void saveRef.current();
    });
  }, [readOnly]);

  if (content.kind === "image") {
    return <ImageFileView name={name} dataUrl={content.dataUrl} />;
  }

  if (content.kind === "binary") {
    return <BinaryFileView name={name} />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <FileEditorHeader
        path={entry?.sourcePath ?? path}
        name={name}
        dirty={dirty}
        readOnly={readOnly}
        canPreview={canPreview}
        isMarkdown={isMarkdown}
        isHtml={isHtml}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        reloadFeedback={reloadPreview.feedback}
        onReloadPreview={handleReloadPreview}
        saving={saving}
        onSave={save}
        searchOpen={previewSearchOpen}
        onToggleSearch={() => setPreviewSearchOpen((open) => !open)}
        wordWrap={wordWrap}
        onToggleWordWrap={onToggleWordWrap}
      />
      {saveError && (
        <p className="shrink-0 break-all border-b border-border-button-default px-3 py-1.5 text-caption-1-regular text-text-error-primary">
          {saveError}
        </p>
      )}
      {canPreview && viewMode === "preview" ? (
        isMarkdown ? (
          <MarkdownPreview
            path={path}
            draft={draft}
            active={isActiveTab}
            searchOpen={previewSearchOpen}
            onSearchOpenChange={setPreviewSearchOpen}
            bindSearchShortcut={isActiveTab}
          />
        ) : (
          <HtmlPreview
            path={path}
            name={name}
            reloadKey={previewReloadKey}
            active={isActiveTab}
          />
        )
      ) : (
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <CodeMirror
            className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full"
            height="100%"
            value={draft}
            onCreateEditor={(view) => {
              editorRef.current = view;
              setEditorView(view);
            }}
            onChange={setDraft}
            extensions={extensions}
            theme={dark ? "dark" : "light"}
            readOnly={readOnly || (entry?.session !== undefined && saving)}
            basicSetup={CM_BASIC_SETUP}
          />
          <EditorSearchPanel
            view={editorView}
            open={editorSearchOpen}
            showReplace={editorSearchReplace}
            readOnly={readOnly}
            isMac={IS_MAC}
            focusRequest={editorSearchFocus}
            documentText={draft}
            onShowReplaceChange={setEditorSearchReplace}
            onClose={closeEditorSearch}
            navigateRef={editorSearchNavigateRef}
          />
        </div>
      )}
    </div>
  );
}

export default EditorPane;
