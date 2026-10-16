import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { useTranslation } from "react-i18next";
import { ipc, type FileContent } from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { Button } from "@/components/base/buttons/button";
import { useActionFeedback } from "@/components/base/action-feedback";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { isWeb } from "@/lib/platform";
import { fileName, useFilesStore } from "./store";
import { BinaryFileView, ImageFileView } from "./EditorFallbackViews";
import { FileEditorHeader } from "./FileEditorHeader";
import { HtmlPreview } from "./HtmlPreview";
import { MarkdownPreview } from "./MarkdownPreview";
import { isHtmlFile, isMarkdownFile, opensInPreview, type EditorViewMode } from "./editor-view-mode";
import { registerShortcutHandler } from "@/features/shortcuts/runtime";
import type { EditorView } from "@codemirror/view";
import { FONT_CHANGE_EVENT } from "@/features/settings/font";
import { TYPOGRAPHY_CHANGE_EVENT } from "@/features/settings/interface-typography";

const CM_BASIC_SETUP = { foldGutter: false, highlightActiveLine: true };

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
  const { t } = useTranslation();
  const entry = useFilesStore((s) => s.fileStates[path]);
  const reloadFile = useFilesStore((s) => s.reloadFile);

  if (!entry || entry.loading) {
    return <CenteredSpinner />;
  }
  if (entry.error) {
    return (
      <EmptyState className="flex-col gap-3 p-6">
        <p className="text-body-medium text-text-error-primary">{t("files.fileNotFound")}</p>
        <p className="max-w-md break-all text-caption-1-regular text-text-tertiary">
          {entry.error}
        </p>
        <Button variant="secondary" size="small" onClick={() => void reloadFile(path)}>
          {t("common.refresh")}
        </Button>
      </EmptyState>
    );
  }
  if (!entry.content) {
    return <CenteredSpinner />;
  }
  // key remounts the editor with a fresh draft whenever the file (re)loads.
  return <FileEditor key={`${path}:${entry.loadNonce}`} path={path} content={entry.content} />;
}

function FileEditor({ path, content }: { path: string; content: FileContent }) {
  const setFileDirty = useFilesStore((s) => s.setFileDirty);
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

  const name = fileName(path);
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
  const dirty = !readOnly && draft !== savedText;

  // Publish dirty state so the tab strip can dot the tab and confirm closes.
  useEffect(() => {
    setFileDirty(path, dirty);
    return () => setFileDirty(path, false);
  }, [dirty, path, setFileDirty]);

  const handleViewModeChange = useCallback((mode: EditorViewMode) => {
    setPreviewSearchOpen(false);
    setViewMode(mode);
  }, []);

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
      await ipc.writeFile(path, draft);
      setSavedText(draft);
    } catch (e) {
      setSaveError(errorText(e));
    } finally {
      setSaving(false);
    }
  }, [path, draft]);

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
    <div className="flex min-h-0 flex-1 flex-col">
      <FileEditorHeader
        path={path}
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
        <CodeMirror
          className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full"
          height="100%"
          value={draft}
          onCreateEditor={(view) => { editorRef.current = view; }}
          onChange={setDraft}
          extensions={langExt}
          theme={dark ? "dark" : "light"}
          readOnly={readOnly}
          basicSetup={CM_BASIC_SETUP}
        />
      )}
    </div>
  );
}

export default EditorPane;
