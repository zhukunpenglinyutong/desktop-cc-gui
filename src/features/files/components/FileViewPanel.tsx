import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useTranslation } from "react-i18next";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import Columns2 from "lucide-react/dist/esm/icons/columns-2";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Eye from "lucide-react/dist/esm/icons/eye";
import Code from "lucide-react/dist/esm/icons/code";
import FileSearch from "lucide-react/dist/esm/icons/file-search";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2";
import Minimize2 from "lucide-react/dist/esm/icons/minimize-2";
import Rows2 from "lucide-react/dist/esm/icons/rows-2";
import Save from "lucide-react/dist/esm/icons/save";
import Search from "lucide-react/dist/esm/icons/search";
import X from "lucide-react/dist/esm/icons/x";
import type {
  ReactCodeMirrorProps,
  ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { search } from "@codemirror/search";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  getGitFileFullDiff,
  readLocalImageDataUrl,
} from "../../../services/tauri";
import {
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
  parseShortcut,
} from "../../../utils/shortcuts";
import { highlightLine } from "../../../utils/syntax";
import { OpenAppMenu } from "../../app/components/OpenAppMenu";
import FileIcon from "../../../components/FileIcon";
import type { GitFileStatus, OpenAppTarget } from "../../../types";
import type {
  CodeAnnotationDraftInput,
  CodeAnnotationLineRange,
  CodeAnnotationSelection,
} from "../../code-annotations/types";
import { isSameCodeAnnotationPath } from "../../code-annotations/utils/codeAnnotations";
import { codeMirrorExtensionsForEditorLanguage } from "../utils/codemirrorLanguageExtensions";
import {
  parseLineMarkersFromDiff,
  type GitLineMarkers,
} from "../utils/gitLineMarkers";
import {
  isLikelyWindowsFsPath,
  normalizeComparablePath,
  normalizeFsPath,
  resolveFileReadTarget,
  resolveGitRootWorkspacePrefix,
  resolveGitStatusPathCandidates,
  resolveWorkspacePathCandidates,
} from "../../../utils/workspacePaths";
import { reduceExternalChangeSyncState } from "../externalChangeStateMachine";
import {
  measureFilePreviewMetrics,
  resolveFileRenderProfile,
} from "../utils/fileRenderProfile";
import {
  resolveDefaultFileViewMode,
  resolveFileViewSurface,
} from "../utils/fileViewSurface";
import { FileViewBody } from "./FileViewBody";
import { FileViewNavigationPanel } from "./FileViewNavigationPanel";
import { useFileDocumentState } from "../hooks/useFileDocumentState";
import { useFileExternalSync } from "../hooks/useFileExternalSync";
import { useFileNavigation } from "../hooks/useFileNavigation";
import { useFilePreviewPayload } from "../hooks/useFilePreviewPayload";
import {
  isThemeMutationAttribute,
  readDocumentThemeAppearance,
} from "../../theme/utils/themeAppearance";

type FileViewPanelProps = {
  workspaceId: string;
  workspacePath: string;
  gitRoot?: string | null;
  customSpecRoot?: string | null;
  filePath: string;
  gitStatusFiles?: GitFileStatus[];
  openTabs?: string[];
  activeTabPath?: string | null;
  onActivateTab?: (path: string) => void;
  onCloseTab?: (path: string) => void;
  onCloseAllTabs?: () => void;
  fileReferenceMode?: "path" | "none";
  onFileReferenceModeChange?: (mode: "path" | "none") => void;
  activeFileLineRange?: { startLine: number; endLine: number } | null;
  onActiveFileLineRangeChange?: (range: { startLine: number; endLine: number } | null) => void;
  initialMode?: "edit" | "preview";
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  editorSplitLayout?: "vertical" | "horizontal";
  onToggleEditorSplitLayout?: () => void;
  isEditorFileMaximized?: boolean;
  onToggleEditorFileMaximized?: () => void;
  navigationTarget?: {
    path: string;
    line: number;
    column: number;
    requestId: number;
  } | null;
  highlightMarkers?: GitLineMarkers | null;
  onNavigateToLocation?: (
    path: string,
    location: { line: number; column: number },
  ) => void;
  onClose: () => void;
  onInsertText?: (text: string) => void;
  onCreateCodeAnnotation?: (annotation: CodeAnnotationDraftInput) => void;
  onRemoveCodeAnnotation?: (annotationId: string) => void;
  codeAnnotations?: CodeAnnotationSelection[];
  headerLayout?: "stacked" | "single-row";
  onSingleRowLeadingAction?: () => void;
  singleRowLeadingDirection?: "left" | "right";
  singleRowLeadingLabel?: string;
  externalChangeMonitoringEnabled?: boolean;
  externalChangeTransportMode?: "watcher" | "polling";
  externalChangePollIntervalMs?: number;
  saveFileShortcut?: string | null;
  findInFileShortcut?: string | null;
  onSaveSuccess?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
};

const EXTERNAL_CHANGE_POLL_INTERVAL_MS = 2_000;
type EditorTheme = "light" | "dark";

const CODE_MIRROR_KEY_LABELS: Record<string, string> = {
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  enter: "Enter",
  escape: "Escape",
  space: "Space",
  tab: "Tab",
};

function toCodeMirrorShortcut(value: string | null | undefined): string | null {
  const parsed = parseShortcut(value);
  if (!parsed) {
    return null;
  }
  const modifiers: string[] = [];
  if (parsed.meta && !parsed.ctrl) {
    modifiers.push("Mod");
  } else {
    if (parsed.meta) {
      modifiers.push("Meta");
    }
    if (parsed.ctrl) {
      modifiers.push("Ctrl");
    }
  }
  if (parsed.alt) {
    modifiers.push("Alt");
  }
  if (parsed.shift) {
    modifiers.push("Shift");
  }
  const keyLabel =
    CODE_MIRROR_KEY_LABELS[parsed.key] ??
    (parsed.key.length === 1 ? parsed.key : parsed.key);
  return [...modifiers, keyLabel].join("-");
}

function resolveEditorTheme(): EditorTheme {
  return readDocumentThemeAppearance();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveAbsolutePath(workspacePath: string, relativePath: string) {
  const normalizedBase = normalizeFsPath(workspacePath).trim();
  const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedBase) {
    return normalizedRelativePath;
  }
  if (!normalizedRelativePath) {
    return normalizedBase;
  }
  if (normalizedBase === "/" || /^[a-zA-Z]:\/$/.test(normalizedBase)) {
    return `${normalizedBase}${normalizedRelativePath}`;
  }
  return `${normalizedBase.replace(/\/+$/, "")}/${normalizedRelativePath}`;
}

function buildGitLineDecorations(
  doc: { lines: number; line: (lineNumber: number) => { from: number } },
  markers: GitLineMarkers,
) {
  if (markers.added.length === 0 && markers.modified.length === 0) {
    return Decoration.none;
  }
  const builder = new RangeSetBuilder<Decoration>();
  const maxLine = doc.lines;
  const markerByLine = new Map<number, "added" | "modified">();

  for (const lineNumber of markers.added) {
    markerByLine.set(lineNumber, "added");
  }
  for (const lineNumber of markers.modified) {
    markerByLine.set(lineNumber, "modified");
  }

  const sortedMarkers = Array.from(markerByLine.entries()).sort(
    ([leftLineNumber], [rightLineNumber]) => leftLineNumber - rightLineNumber,
  );

  for (const [lineNumber, kind] of sortedMarkers) {
    if (lineNumber < 1 || lineNumber > maxLine) {
      continue;
    }
    const line = doc.line(lineNumber);
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        attributes: {
          class: kind === "modified" ? "cm-git-modified-line" : "cm-git-added-line",
        },
      }),
    );
  }
  return builder.finish();
}

const setGitLineMarkersEffect = StateEffect.define<GitLineMarkers>();
const gitLineMarkersField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    let nextDecorations = decorations;
    if (transaction.docChanged) {
      nextDecorations = nextDecorations.map(transaction.changes);
    }
    for (const effect of transaction.effects) {
      if (effect.is(setGitLineMarkersEffect)) {
        nextDecorations = buildGitLineDecorations(transaction.state.doc, effect.value);
      }
    }
    return nextDecorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function gitLineMarkersExtension(): Extension {
  return [gitLineMarkersField];
}

function hasGitLineMarkers(markers: GitLineMarkers | null | undefined) {
  if (!markers) {
    return false;
  }
  return markers.added.length > 0 || markers.modified.length > 0;
}

function formatAnnotationLineLabel(lineRange: CodeAnnotationLineRange) {
  return lineRange.startLine === lineRange.endLine
    ? `L${lineRange.startLine}`
    : `L${lineRange.startLine}-L${lineRange.endLine}`;
}

type FileAnnotationDraftState = {
  lineRange: CodeAnnotationLineRange;
  source: "file-preview-mode" | "file-edit-mode";
  body: string;
};

type AnnotationWidgetCallbacks = {
  onDraftCancel: () => void;
  onDraftConfirm: (bodyOverride?: string) => void;
  onRemoveAnnotation?: (annotationId: string) => void;
};

class CodeAnnotationMarkerWidget extends WidgetType {
  constructor(
    private readonly annotation: CodeAnnotationSelection,
    private readonly label: string,
    private readonly labels: { title: string; remove: string },
    private readonly callbacks: AnnotationWidgetCallbacks,
  ) {
    super();
  }

  eq(other: CodeAnnotationMarkerWidget) {
    return (
      other.annotation.id === this.annotation.id &&
      other.annotation.body === this.annotation.body &&
      other.label === this.label &&
      other.labels.title === this.labels.title &&
      other.labels.remove === this.labels.remove
    );
  }

  toDOM() {
    const root = document.createElement("div");
    root.className = "fvp-annotation-marker";
    root.setAttribute("role", "note");
    const head = document.createElement("div");
    head.className = "fvp-annotation-marker-head";
    const title = document.createElement("span");
    title.className = "fvp-annotation-title";
    const icon = document.createElement("span");
    icon.className = "codicon codicon-comment-discussion";
    icon.setAttribute("aria-hidden", "true");
    title.textContent = this.labels.title;
    title.prepend(icon);
    const tools = document.createElement("span");
    tools.className = "fvp-annotation-marker-tools";
    const line = document.createElement("code");
    line.textContent = this.label;
    tools.append(line);
    if (this.callbacks.onRemoveAnnotation) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "fvp-annotation-remove";
      removeButton.title = this.labels.remove;
      removeButton.setAttribute("aria-label", this.labels.remove);
      removeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onRemoveAnnotation?.(this.annotation.id);
      });
      const removeIcon = document.createElement("span");
      removeIcon.className = "codicon codicon-close";
      removeIcon.setAttribute("aria-hidden", "true");
      removeButton.append(removeIcon);
      tools.append(removeButton);
    }
    head.append(title, tools);
    const body = document.createElement("p");
    body.textContent = this.annotation.body;
    root.append(head, body);
    return root;
  }
}

class CodeAnnotationDraftWidget extends WidgetType {
  constructor(
    private readonly draft: FileAnnotationDraftState,
    private readonly label: string,
    private readonly labels: {
      title: string;
      placeholder: string;
      cancel: string;
      submit: string;
    },
    private readonly callbacks: AnnotationWidgetCallbacks,
  ) {
    super();
  }

  eq(other: CodeAnnotationDraftWidget) {
    return (
      other.label === this.label &&
      other.draft.lineRange.startLine === this.draft.lineRange.startLine &&
      other.draft.lineRange.endLine === this.draft.lineRange.endLine
    );
  }

  toDOM() {
    const root = document.createElement("div");
    root.className = "fvp-annotation-draft fvp-annotation-draft-inline";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", this.labels.title);
    root.addEventListener("mousedown", (event) => event.stopPropagation());
    root.addEventListener("click", (event) => event.stopPropagation());

    const head = document.createElement("div");
    head.className = "fvp-annotation-draft-head";
    const title = document.createElement("span");
    title.className = "fvp-annotation-title";
    const icon = document.createElement("span");
    icon.className = "codicon codicon-comment-discussion";
    icon.setAttribute("aria-hidden", "true");
    title.textContent = this.labels.title;
    title.prepend(icon);
    const line = document.createElement("code");
    line.textContent = this.label;
    head.append(title, line);

    const textarea = document.createElement("textarea");
    textarea.className = "fvp-annotation-draft-input";
    textarea.value = this.draft.body;
    textarea.placeholder = this.labels.placeholder;

    const actions = document.createElement("div");
    actions.className = "fvp-annotation-draft-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost fvp-action-btn";
    cancel.textContent = this.labels.cancel;
    cancel.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onDraftCancel();
    });

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "fvp-annotation-submit";
    submit.textContent = this.labels.submit;
    submit.disabled = !this.draft.body.trim();
    submit.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onDraftConfirm(textarea.value);
    });
    textarea.addEventListener("input", () => {
      submit.disabled = !textarea.value.trim();
    });

    actions.append(cancel, submit);
    root.append(head, textarea, actions);
    queueMicrotask(() => {
      if (!textarea.isConnected) {
        return;
      }
      textarea.focus();
      const cursorPosition = textarea.value.length;
      textarea.setSelectionRange(cursorPosition, cursorPosition);
    });
    return root;
  }
}

function codeAnnotationWidgetsExtension({
  annotations,
  draft,
  labels,
  callbacks,
}: {
  annotations: CodeAnnotationSelection[];
  draft: FileAnnotationDraftState | null;
  labels: {
    title: string;
    remove: string;
    placeholder: string;
    cancel: string;
    submit: string;
  };
  callbacks: AnnotationWidgetCallbacks;
}): Extension {
  return EditorView.decorations.compute([], (state) => {
    const builder = new RangeSetBuilder<Decoration>();
    const maxLine = state.doc.lines;
    const sortedAnnotations = [...annotations].sort(
      (left, right) => left.lineRange.endLine - right.lineRange.endLine,
    );
    for (const annotation of sortedAnnotations) {
      const targetLine = Math.min(Math.max(annotation.lineRange.endLine, 1), maxLine);
      const line = state.doc.line(targetLine);
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new CodeAnnotationMarkerWidget(
            annotation,
            formatAnnotationLineLabel(annotation.lineRange),
            labels,
            callbacks,
          ),
          block: true,
          side: 1,
        }),
      );
    }
    if (draft?.source === "file-edit-mode") {
      const targetLine = Math.min(Math.max(draft.lineRange.endLine, 1), maxLine);
      const line = state.doc.line(targetLine);
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new CodeAnnotationDraftWidget(
            draft,
            formatAnnotationLineLabel(draft.lineRange),
            labels,
            callbacks,
          ),
          block: true,
          side: 2,
        }),
      );
    }
    return builder.finish();
  });
}

export function FileViewPanel({
  workspaceId,
  workspacePath,
  gitRoot = null,
  customSpecRoot = null,
  filePath,
  gitStatusFiles,
  openTabs,
  activeTabPath,
  onActivateTab,
  onCloseTab,
  onCloseAllTabs,
  fileReferenceMode = "path",
  onFileReferenceModeChange,
  activeFileLineRange = null,
  onActiveFileLineRangeChange,
  initialMode = "edit",
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  editorSplitLayout = "vertical",
  onToggleEditorSplitLayout,
  isEditorFileMaximized = false,
  onToggleEditorFileMaximized,
  navigationTarget = null,
  highlightMarkers = null,
  onNavigateToLocation,
  onClose,
  onInsertText,
  onCreateCodeAnnotation,
  onRemoveCodeAnnotation,
  codeAnnotations = [],
  headerLayout = "stacked",
  onSingleRowLeadingAction,
  singleRowLeadingDirection = "left",
  singleRowLeadingLabel,
  externalChangeMonitoringEnabled = false,
  externalChangeTransportMode = "polling",
  externalChangePollIntervalMs = EXTERNAL_CHANGE_POLL_INTERVAL_MS,
  saveFileShortcut = "cmd+s",
  findInFileShortcut = "cmd+f",
  onSaveSuccess,
  onDirtyChange,
}: FileViewPanelProps) {
  const { t } = useTranslation();
  const renderProfile = useMemo(() => resolveFileRenderProfile(filePath), [filePath]);
  const defaultMode = useMemo(
    () => resolveDefaultFileViewMode(renderProfile, initialMode),
    [initialMode, renderProfile],
  );
  const isImage = renderProfile.kind === "image";
  const skipTextRead = renderProfile.previewSourceKind !== "inline-bytes";
  const canEditDocument = renderProfile.editCapability !== "read-only";
  const [mode, setMode] = useState<"preview" | "edit">(
    () => defaultMode,
  );
  const [editorTheme, setEditorTheme] = useState<EditorTheme>(() => resolveEditorTheme());
  const [gitLineMarkers, setGitLineMarkers] = useState<GitLineMarkers>({
    added: [],
    modified: [],
  });
  const [annotationDraft, setAnnotationDraft] = useState<{
    lineRange: CodeAnnotationLineRange;
    source: "file-preview-mode" | "file-edit-mode";
    body: string;
  } | null>(null);
  const annotationDraftBodyRef = useRef("");
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const lastReportedLineRangeRef = useRef<string>("");
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const tabContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({
    visible: false,
    x: 0,
    y: 0,
  });
  const activeAnnotationLineRange =
    annotationDraft?.source === "file-edit-mode"
      ? annotationDraft.lineRange
      : activeFileLineRange;
  const effectiveAnnotationDraftBody = annotationDraft
    ? annotationDraftBodyRef.current || annotationDraft.body
    : "";
  const effectiveAnnotationDraft = useMemo(
    () =>
      annotationDraft
        ? {
            ...annotationDraft,
            body: effectiveAnnotationDraftBody,
          }
        : null,
    [annotationDraft, effectiveAnnotationDraftBody],
  );
  const beginAnnotationDraft = useCallback(
    (
      lineRange: CodeAnnotationLineRange,
      source: "file-preview-mode" | "file-edit-mode",
    ) => {
      annotationDraftBodyRef.current = "";
      setAnnotationDraft({
        lineRange: {
          startLine: lineRange.startLine,
          endLine: lineRange.endLine,
        },
        source,
        body: "",
      });
    },
    [],
  );
  const handleConfirmAnnotationDraft = useCallback((bodyOverride?: string) => {
    if (!annotationDraft) {
      return;
    }
    const body = (bodyOverride ?? annotationDraftBodyRef.current ?? annotationDraft.body).trim();
    if (!body) {
      return;
    }
    onCreateCodeAnnotation?.({
      path: filePath,
      lineRange: annotationDraft.lineRange,
      body,
      source: annotationDraft.source,
    });
    annotationDraftBodyRef.current = "";
    setAnnotationDraft(null);
  }, [annotationDraft, filePath, onCreateCodeAnnotation]);
  const [fileReferenceShouldRender, setFileReferenceShouldRender] = useState(false);
  const [fileReferenceVisible, setFileReferenceVisible] = useState(false);
  const usesSingleRowHeader = headerLayout === "single-row";
  const splitResizeCleanupRef = useRef<(() => void) | null>(null);
  const pendingOpenFindPanelRef = useRef(false);
  const gitRootWorkspacePrefix = useMemo(
    () => resolveGitRootWorkspacePrefix(workspacePath, gitRoot),
    [gitRoot, workspacePath],
  );
  const gitStatusMap = useMemo(() => {
    const map = new Map<string, { status: string; path: string }>();
    if (!gitStatusFiles) {
      return map;
    }
    for (const entry of gitStatusFiles) {
      const entryPath = entry.path?.trim();
      const entryStatus = entry.status?.trim();
      if (!entryPath || !entryStatus) {
        continue;
      }
      const candidates = resolveGitStatusPathCandidates(
        workspacePath,
        gitRootWorkspacePrefix,
        entryPath,
      );
      for (const candidate of candidates) {
        if (!map.has(candidate)) {
          map.set(candidate, { status: entryStatus, path: entryPath });
        }
      }
    }
    return map;
  }, [gitRootWorkspacePrefix, gitStatusFiles, workspacePath]);
  const fileReadTarget = useMemo(
    () => resolveFileReadTarget(workspacePath, filePath, customSpecRoot),
    [workspacePath, filePath, customSpecRoot],
  );
  const workspaceRelativeFilePath = fileReadTarget.workspaceRelativePath;
  const matchedGitStatus = useMemo(() => {
    const fileCandidates = new Set<string>([
      ...resolveWorkspacePathCandidates(workspacePath, workspaceRelativeFilePath),
      ...resolveWorkspacePathCandidates(workspacePath, filePath),
    ]);
    for (const candidate of fileCandidates) {
      const matched = gitStatusMap.get(candidate);
      if (matched) {
        return matched;
      }
    }
    return null;
  }, [
    filePath,
    gitStatusMap,
    workspacePath,
    workspaceRelativeFilePath,
  ]);
  const fileGitStatus = matchedGitStatus?.status ?? null;
  const gitDiffTargetPath = matchedGitStatus?.path ?? workspaceRelativeFilePath;
  const resolveMatchedGitStatusByPath = useCallback(
    (path: string) => {
      for (const candidate of resolveWorkspacePathCandidates(workspacePath, path)) {
        const matched = gitStatusMap.get(candidate);
        if (matched) {
          return matched;
        }
      }
      return null;
    },
    [gitStatusMap, workspacePath],
  );
  const fileGitStatusClass = fileGitStatus ? `git-${fileGitStatus.toLowerCase()}` : "";
  const absolutePath = useMemo(
    () =>
      fileReadTarget.domain === "workspace"
        ? resolveAbsolutePath(workspacePath, workspaceRelativeFilePath)
        : fileReadTarget.normalizedInputPath,
    [workspacePath, workspaceRelativeFilePath, fileReadTarget],
  );
  const caseInsensitivePathCompare = useMemo(
    () => isLikelyWindowsFsPath(normalizeFsPath(workspacePath)),
    [workspacePath],
  );
  const isSameWorkspacePath = useCallback(
    (leftPath: string, rightPath: string) =>
      normalizeComparablePath(leftPath, caseInsensitivePathCompare) ===
      normalizeComparablePath(rightPath, caseInsensitivePathCompare),
    [caseInsensitivePathCompare],
  );
  const {
    content,
    setContent,
    error,
    isDirty,
    isLoading,
    isSaving,
    savedContentRef,
    latestIsDirtyRef,
    externalDiskSnapshotRef,
    truncated,
    setTruncated,
    handleSave: handleDocumentSave,
  } = useFileDocumentState({
    workspaceId,
    customSpecRoot,
    workspaceRelativeFilePath,
    fileReadTarget,
    skipTextRead,
    externalAbsoluteReadOnlyMessage: t("files.externalAbsoluteReadOnly"),
  });
  const {
    externalChangeConflict,
    externalCompareOpen,
    externalAutoSyncAt,
    externalChangeSyncState,
    handleExternalReloadFromDisk,
    handleExternalKeepLocal,
    handleExternalToggleCompare,
    setExternalChangeSyncState,
    setExternalChangeConflict,
    setExternalCompareOpen,
    setExternalAutoSyncAt,
  } = useFileExternalSync({
    filePath,
    workspaceId,
    workspaceRelativeFilePath,
    fileReadTargetDomain: fileReadTarget.domain,
    externalChangeMonitoringEnabled,
    externalChangeTransportMode,
    externalChangePollIntervalMs,
    isBinary: skipTextRead,
    isLoading,
    caseInsensitivePathCompare,
    setContent,
    setTruncated,
    savedContentRef,
    latestIsDirtyRef,
    externalDiskSnapshotRef,
    autoSyncedMessage: t("files.externalChangeAutoSynced"),
  });
  const handleSave = useCallback(async () => {
    const saved = await handleDocumentSave();
    if (!saved) {
      return;
    }
    setExternalChangeSyncState((current) =>
      reduceExternalChangeSyncState(current, { type: "file-loaded" }),
    );
    setExternalChangeConflict(null);
    setExternalCompareOpen(false);
    setExternalAutoSyncAt(null);
    onSaveSuccess?.();
  }, [
    handleDocumentSave,
    onSaveSuccess,
    setExternalChangeConflict,
    setExternalChangeSyncState,
    setExternalCompareOpen,
    setExternalAutoSyncAt,
  ]);
  const {
    isDefinitionLoading,
    isReferencesLoading,
    navigationError,
    definitionCandidates,
    setDefinitionCandidates,
    referenceResults,
    setReferenceResults,
    navigateToLocation,
    runDefinitionFromCursor,
    runReferencesFromCursor,
    editorNavigationKeymapExt,
    ctrlClickDefinitionExt,
    openFindPanelInEditor,
    toggleFindPanelInEditor,
  } = useFileNavigation({
    workspaceId,
    workspacePath,
    filePath,
    absolutePath,
    caseInsensitivePathCompare,
    isSameWorkspacePath,
    navigationTarget,
    isLoading,
    t,
    onNavigateToLocation,
    setMode,
    cmRef,
  });
  const hasExplicitHighlightMarkers = useMemo(
    () => hasGitLineMarkers(highlightMarkers),
    [highlightMarkers],
  );
  const effectiveGitLineMarkers = useMemo(
    () => (hasExplicitHighlightMarkers ? highlightMarkers! : gitLineMarkers),
    [hasExplicitHighlightMarkers, highlightMarkers, gitLineMarkers],
  );
  const gitAddedLineNumberSet = useMemo(
    () => new Set(effectiveGitLineMarkers.added),
    [effectiveGitLineMarkers.added],
  );
  const gitModifiedLineNumberSet = useMemo(
    () => new Set(effectiveGitLineMarkers.modified),
    [effectiveGitLineMarkers.modified],
  );

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);

  const [imageInfo, setImageInfo] = useState<{
    width: number;
    height: number;
    sizeBytes: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImageSrc(null);
    setImageInfo(null);
    setImageLoadError(null);
    if (!isImage) return;

    const fallbackToAssetUrl = () => {
      try {
        return convertFileSrc(absolutePath);
      } catch {
        return null;
      }
    };

    readLocalImageDataUrl(workspaceId, absolutePath)
      .then((dataUrl) => {
        if (cancelled) return;
        setImageSrc(dataUrl ?? fallbackToAssetUrl());
      })
      .catch(() => {
        if (cancelled) return;
        setImageSrc(fallbackToAssetUrl());
      });

    return () => {
      cancelled = true;
    };
  }, [absolutePath, isImage, workspaceId]);

  useEffect(() => {
    setImageInfo(null);
    if (!imageSrc) return;
    let cancelled = false;
    fetch(imageSrc)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to read image bytes: ${res.status}`);
        }
        return res.blob();
      })
      .then((blob) => {
        if (!cancelled) {
          setImageInfo((prev) =>
            prev
              ? { ...prev, sizeBytes: blob.size }
              : { width: 0, height: 0, sizeBytes: blob.size },
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImageInfo(null);
        }
      });
    return () => { cancelled = true; };
  }, [imageSrc]);

  const handleImageLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setImageLoadError(null);
      setImageInfo((prev) => ({
        width: img.naturalWidth,
        height: img.naturalHeight,
        sizeBytes: prev?.sizeBytes ?? null,
      }));
    },
    [],
  );
  const handleImageError = useCallback(() => {
    setImageInfo(null);
    setImageLoadError(t("files.imagePreviewLoadFailed"));
  }, [t]);

  useEffect(() => {
    const normalizedStatus = (fileGitStatus ?? "").toUpperCase();
    if (hasExplicitHighlightMarkers) {
      setGitLineMarkers({ added: [], modified: [] });
      return;
    }
    if (fileReadTarget.domain !== "workspace") {
      setGitLineMarkers({ added: [], modified: [] });
      return;
    }
    if (!normalizedStatus || normalizedStatus === "D" || skipTextRead) {
      setGitLineMarkers({ added: [], modified: [] });
      return;
    }

    let cancelled = false;
    getGitFileFullDiff(workspaceId, gitDiffTargetPath)
      .then((diff) => {
        if (cancelled) {
          return;
        }
        setGitLineMarkers(parseLineMarkersFromDiff(diff));
      })
      .catch(() => {
        if (!cancelled) {
          setGitLineMarkers({ added: [], modified: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    workspaceId,
    gitDiffTargetPath,
    fileGitStatus,
    fileReadTarget.domain,
    hasExplicitHighlightMarkers,
    skipTextRead,
  ]);

  // Reset mode when file changes
  useEffect(() => {
    pendingOpenFindPanelRef.current = false;
    setMode(defaultMode);
    onActiveFileLineRangeChange?.(null);
    lastReportedLineRangeRef.current = "";
  }, [defaultMode, filePath, onActiveFileLineRangeChange]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const updateTheme = () => {
      setEditorTheme((prev) => {
        const next = resolveEditorTheme();
        return prev === next ? prev : next;
      });
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (isThemeMutationAttribute(mutation.attributeName)) {
          updateTheme();
          return;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    const media =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: light)")
        : null;
    const handleMediaChange = () => updateTheme();
    if (media?.addEventListener) {
      media.addEventListener("change", handleMediaChange);
    } else if (media?.addListener) {
      media.addListener(handleMediaChange);
    }
    return () => {
      observer.disconnect();
      if (media?.removeEventListener) {
        media.removeEventListener("change", handleMediaChange);
      } else if (media?.removeListener) {
        media.removeListener(handleMediaChange);
      }
    };
  }, []);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Auto-focus CodeMirror when entering edit mode
  useEffect(() => {
    if (mode === "edit" && !isLoading && !truncated) {
      requestAnimationFrame(() => {
        cmRef.current?.view?.focus();
      });
    }
  }, [mode, isLoading, truncated]);

  // CodeMirror extensions (Mod-s handled inside CM; window-level handles preview mode)
  const cmExtensions = useMemo(() => {
    const langExt = codeMirrorExtensionsForEditorLanguage(renderProfile.editorLanguage);
    return [...langExt, gitLineMarkersExtension()];
  }, [renderProfile.editorLanguage]);

  useEffect(() => {
    const view = cmRef.current?.view;
    if (!view || mode !== "edit") {
      return;
    }
    view.dispatch({
      effects: setGitLineMarkersEffect.of(effectiveGitLineMarkers),
    });
  }, [effectiveGitLineMarkers, mode, filePath, content]);

  // Use ref to always have latest handleSave for CodeMirror keymap
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const saveKeymapExt = useMemo(
    () => {
      const codeMirrorSaveShortcut = toCodeMirrorShortcut(saveFileShortcut);
      if (!codeMirrorSaveShortcut) {
        return [];
      }
      return keymap.of([
        {
          key: codeMirrorSaveShortcut,
          run: () => {
            handleSaveRef.current();
            return true;
          },
        },
      ]);
    },
    [saveFileShortcut],
  );
  const persistentSearchExtension = useMemo(() => search({ top: true }), []);
  const handleCodeMirrorCreate: NonNullable<ReactCodeMirrorProps["onCreateEditor"]> =
    useCallback((view) => {
      view.dispatch({
        effects: setGitLineMarkersEffect.of(effectiveGitLineMarkers),
      });
    }, [effectiveGitLineMarkers]);

  // Keyboard shortcut: Cmd+S / Ctrl+S (works in any mode, including preview)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) {
        return;
      }
      if (matchesShortcutForPlatform(event, saveFileShortcut)) {
        event.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleSave, saveFileShortcut]);

  // Handle close with unsaved changes
  const handleClose = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(t("files.discardChangesMessage"));
      if (!confirmed) return;
    }
    onClose();
  }, [isDirty, onClose, t]);

  // Switch to edit mode
  const handleEnterEdit = useCallback(() => {
    if (truncated || !canEditDocument) return;
    setMode("edit");
    requestAnimationFrame(() => {
      cmRef.current?.view?.focus();
    });
  }, [canEditDocument, truncated]);

  // Switch to preview mode
  const handleEnterPreview = useCallback(() => {
    setMode("preview");
    onActiveFileLineRangeChange?.(null);
    lastReportedLineRangeRef.current = "";
  }, [onActiveFileLineRangeChange]);

  const handleOpenFindPanel = useCallback(() => {
    if (skipTextRead || truncated) {
      return;
    }
    pendingOpenFindPanelRef.current = true;
    if (mode !== "edit") {
      setMode("edit");
      return;
    }
    if (toggleFindPanelInEditor()) {
      pendingOpenFindPanelRef.current = false;
    }
  }, [mode, skipTextRead, toggleFindPanelInEditor, truncated]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcutForPlatform(event, findInFileShortcut)) {
        return;
      }
      const panelRoot = panelRootRef.current;
      const target = event.target;
      if (!panelRoot || !(target instanceof Node) || !panelRoot.contains(target)) {
        return;
      }
      if (isEditableShortcutTarget(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleOpenFindPanel();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [findInFileShortcut, handleOpenFindPanel]);

  useEffect(() => {
    if (!pendingOpenFindPanelRef.current) {
      return;
    }
    if (mode !== "edit" || isLoading || truncated) {
      return;
    }
    let rafId = 0;
    let attemptCount = 0;
    const attemptOpen = () => {
      attemptCount += 1;
      if (openFindPanelInEditor()) {
        pendingOpenFindPanelRef.current = false;
        return;
      }
      if (attemptCount < 10) {
        rafId = window.requestAnimationFrame(attemptOpen);
      }
    };
    rafId = window.requestAnimationFrame(attemptOpen);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [isLoading, mode, openFindPanelInEditor, truncated]);

  // Syntax highlighted lines for code preview
  const previewMetrics = useMemo(
    () => measureFilePreviewMetrics(content, truncated),
    [content, truncated],
  );
  const viewSurface = useMemo(
    () => resolveFileViewSurface(renderProfile, mode, previewMetrics),
    [mode, previewMetrics, renderProfile],
  );
  const previewPayloadEnabled =
    mode === "preview" &&
    (viewSurface.kind === "pdf-preview" ||
      viewSurface.kind === "tabular-preview" ||
      viewSurface.kind === "document-preview");
  const {
    payload: previewPayload,
    isLoading: previewPayloadLoading,
    error: previewPayloadError,
  } = useFilePreviewPayload({
    workspaceId,
    customSpecRoot,
    fileReadTarget,
    absolutePath,
    renderProfile,
    content,
    truncated,
    enabled: previewPayloadEnabled,
  });
  const previewLanguage = renderProfile.previewLanguage;
  const highlightedPreviewLanguage = useMemo(
    () => (viewSurface.kind === "code-preview" && !viewSurface.useLowCostPreview
      ? previewLanguage
      : null),
    [previewLanguage, viewSurface.kind, viewSurface.useLowCostPreview],
  );
  const lines = useMemo(() => content.split("\n"), [content]);
  const visibleCodeAnnotations = useMemo(
    () =>
      codeAnnotations.filter((annotation) =>
        isSameCodeAnnotationPath(annotation.path, filePath),
      ),
    [codeAnnotations, filePath],
  );
  const highlightedLines = useMemo(
    () =>
      lines.map((line) => {
        const html = highlightLine(line, highlightedPreviewLanguage);
        return html || "&nbsp;";
      }),
    [highlightedPreviewLanguage, lines],
  );
  const annotationWidgetLabels = useMemo(
    () => ({
      title: t("files.annotationDraft"),
      remove: t("files.annotationRemove"),
      placeholder: t("files.annotationPlaceholder"),
      cancel: t("common.cancel"),
      submit: t("files.annotationSubmit"),
    }),
    [t],
  );
  const annotationWidgetCallbacks = useMemo<AnnotationWidgetCallbacks>(
    () => ({
      onDraftCancel: () => {
        annotationDraftBodyRef.current = "";
        setAnnotationDraft(null);
      },
      onDraftConfirm: handleConfirmAnnotationDraft,
      onRemoveAnnotation: onRemoveCodeAnnotation,
    }),
    [handleConfirmAnnotationDraft, onRemoveCodeAnnotation],
  );
  const annotationWidgetsExt = useMemo(
    () =>
      codeAnnotationWidgetsExtension({
        annotations: visibleCodeAnnotations.filter(
          (annotation) => annotation.source === "file-edit-mode",
        ),
        draft: effectiveAnnotationDraft?.source === "file-edit-mode"
          ? effectiveAnnotationDraft
          : null,
        labels: annotationWidgetLabels,
        callbacks: annotationWidgetCallbacks,
      }),
    [
      effectiveAnnotationDraft,
      annotationWidgetCallbacks,
      annotationWidgetLabels,
      visibleCodeAnnotations,
    ],
  );
  const editorExtensions = useMemo(
    () => [
      saveKeymapExt,
      editorNavigationKeymapExt,
      ctrlClickDefinitionExt,
      persistentSearchExtension,
      annotationWidgetsExt,
      ...cmExtensions,
    ],
    [
      annotationWidgetsExt,
      cmExtensions,
      ctrlClickDefinitionExt,
      editorNavigationKeymapExt,
      persistentSearchExtension,
      saveKeymapExt,
    ],
  );

  const visibleTabs = openTabs && openTabs.length > 0 ? openTabs : [filePath];
  const canCloseAllTabs = Boolean(onCloseAllTabs && visibleTabs.length > 0);
  const activeFileLineLabel = activeFileLineRange
    ? activeFileLineRange.startLine === activeFileLineRange.endLine
      ? `L${activeFileLineRange.startLine}`
      : `L${activeFileLineRange.startLine}-L${activeFileLineRange.endLine}`
    : null;

  useEffect(() => {
    if (activeFileLineLabel) {
      setFileReferenceShouldRender(true);
      setFileReferenceVisible(true);
      return;
    }
    if (!fileReferenceShouldRender) {
      return;
    }
    setFileReferenceVisible(false);
    const timerId = window.setTimeout(() => {
      setFileReferenceShouldRender(false);
    }, 120);
    return () => window.clearTimeout(timerId);
  }, [activeFileLineLabel, fileReferenceShouldRender]);

  const closeTabContextMenu = useCallback(() => {
    setTabContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  const openTabContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!canCloseAllTabs) {
        return;
      }
      event.preventDefault();
      const container = tabsContainerRef.current;
      const containerRect = container?.getBoundingClientRect();
      const panelRoot = panelRootRef.current;
      const panelRootRect = panelRoot?.getBoundingClientRect();
      if (!container || !containerRect || !panelRoot || !panelRootRect) {
        return;
      }
      const menuWidth = 156;
      const menuHeight = 44;
      const relativeX = event.clientX - panelRootRect.left + 8;
      const minX = 8;
      const maxX = Math.max(minX, panelRoot.clientWidth - menuWidth - 8);
      const clampedX = Math.min(
        Math.max(minX, relativeX),
        maxX,
      );
      const baseY = containerRect.bottom - panelRootRect.top + 6;
      const minY = 8;
      const maxY = Math.max(minY, panelRoot.clientHeight - menuHeight - 8);
      const clampedY = Math.min(Math.max(minY, baseY), maxY);
      setTabContextMenu({
        visible: true,
        x: clampedX,
        y: clampedY,
      });
    },
    [canCloseAllTabs],
  );

  const handleCloseAllTabs = useCallback(() => {
    onCloseAllTabs?.();
    closeTabContextMenu();
  }, [closeTabContextMenu, onCloseAllTabs]);

  useEffect(() => {
    if (!tabContextMenu.visible) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        closeTabContextMenu();
        return;
      }
      if (tabContextMenuRef.current?.contains(target)) {
        return;
      }
      closeTabContextMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTabContextMenu();
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeTabContextMenu, tabContextMenu.visible]);

  useEffect(() => {
    return () => {
      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = null;
    };
  }, []);

  const handleFooterPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "button,a,input,textarea,select,[role='button'],[role='menuitem']",
        )
      ) {
        return;
      }
      const footer = event.currentTarget;
      const splitRoot = footer.closest(".content.is-editor-split-vertical") as HTMLElement | null;
      if (!splitRoot) {
        return;
      }
      const editorLayer = splitRoot.querySelector(
        ".content-layer--editor",
      ) as HTMLElement | null;
      const chatLayer = splitRoot.querySelector(
        ".content-layer--chat",
      ) as HTMLElement | null;
      if (!editorLayer || !chatLayer) {
        return;
      }
      const editorRect = editorLayer.getBoundingClientRect();
      const chatRect = chatLayer.getBoundingClientRect();
      const totalHeight = editorRect.height + chatRect.height;
      if (totalHeight <= 0) {
        return;
      }

      event.preventDefault();

      const startY = event.clientY;
      const startEditorHeight = editorRect.height;
      const minEditorHeight = Math.max(140, totalHeight * 0.28);
      const maxEditorHeight = Math.min(totalHeight - 120, totalHeight * 0.82);
      if (maxEditorHeight <= minEditorHeight) {
        return;
      }

      document.body.classList.add("editor-split-resizing");

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.classList.remove("editor-split-resizing");
        splitResizeCleanupRef.current = null;
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaY = moveEvent.clientY - startY;
        const nextHeight = Math.min(
          maxEditorHeight,
          Math.max(minEditorHeight, startEditorHeight + deltaY),
        );
        const nextRatio = (nextHeight / totalHeight) * 100;
        splitRoot.style.setProperty("--editor-split-ratio", nextRatio.toFixed(2));
      };

      const handlePointerUp = () => {
        cleanup();
      };

      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [],
  );

  // ── Topbar ──
  // Action button base utilities. Within `.fvp-action-group` CSS rules previously
  // overrode these defaults, but inline migration applies the effective styles
  // directly so the rule block can be dropped.
  const ACTION_BTN_BASE_CLS =
    "inline-flex items-center gap-1.5 px-0 py-px text-[9px] font-semibold whitespace-nowrap bg-transparent text-[var(--text-muted)] border-0 rounded-none min-h-[15px] transition-[color,opacity] duration-[120ms] enabled:hover:opacity-95 enabled:hover:text-[var(--text-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color-mix(in_srgb,var(--border-accent)_56%,transparent)] focus-visible:outline-offset-[3px]";
  const renderTopbarActions = (className = "fvp-topbar-right") => (
    <div
      className={
        className === "fvp-topbar-right"
          ? "fvp-topbar-right flex items-center gap-[3px] shrink-0"
          : `${className} inline-flex items-center gap-[3px] shrink-0`
      }
    >
      {canEditDocument && (
        <>
          {mode === "preview" ? (
            <div className="fvp-action-group fvp-preview-tools inline-flex items-center gap-1.5" role="group">
              <button
                type="button"
                className={`fvp-action-btn ${ACTION_BTN_BASE_CLS}`}
                onClick={handleEnterEdit}
                disabled={truncated || !canEditDocument}
                title={truncated ? t("files.fileTooLarge") : t("files.edit")}
              >
                <Pencil size={14} aria-hidden />
                <span>{t("files.edit")}</span>
              </button>
            </div>
          ) : (
            <div className="fvp-action-group inline-flex items-center gap-1.5" role="group">
              <button
                type="button"
                className={`ghost fvp-action-btn ${ACTION_BTN_BASE_CLS}`}
                onClick={runDefinitionFromCursor}
                aria-busy={isDefinitionLoading}
                title={t("files.gotoDefinition")}
              >
                <Code size={14} aria-hidden />
                <span>
                  {isDefinitionLoading
                    ? t("files.navigating")
                    : t("files.gotoDefinition")}
                </span>
              </button>
              <button
                type="button"
                className={`ghost fvp-action-btn ${ACTION_BTN_BASE_CLS}`}
                onClick={runReferencesFromCursor}
                aria-busy={isReferencesLoading}
                title={t("files.findReferences")}
              >
                <Search size={14} aria-hidden />
                <span>
                  {isReferencesLoading
                    ? t("files.searchingReferences")
                    : t("files.findReferences")}
                </span>
              </button>
              <button
                type="button"
                className={`ghost fvp-action-btn ${ACTION_BTN_BASE_CLS}`}
                onClick={handleEnterPreview}
              >
                <Eye size={14} aria-hidden />
                <span>{t("files.preview")}</span>
              </button>
              <button
                type="button"
                className={`primary fvp-action-btn fvp-save-btn ${ACTION_BTN_BASE_CLS} justify-center text-[var(--text-strong)] ${isDirty ? "" : "is-saved opacity-75"}`}
                onClick={handleSave}
                disabled={!isDirty || isSaving}
              >
                <Save size={14} aria-hidden />
                <span>{isSaving ? t("files.saving") : isDirty ? t("files.save") : t("files.saved")}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderTopbar = () => (
    <div className="fvp-topbar flex items-center justify-between gap-1.5 px-3.5 py-[3px] border-b border-[var(--border-subtle)] bg-[var(--surface-messages)] shrink-0">
      <div className="fvp-topbar-left flex items-center gap-1.5 min-w-0 flex-1">
        <button
          type="button"
          className="icon-button fvp-back p-px shrink-0"
          onClick={handleClose}
          aria-label={t("files.backToChat")}
          title={t("files.backToChat")}
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <span
          className={`fvp-filepath ${fileGitStatusClass} text-[12px] font-semibold text-[var(--text-strong)] whitespace-nowrap overflow-hidden text-ellipsis font-[var(--code-font-family)]`.trim()}
          title={filePath}
        >
          {filePath}
        </span>
        {isDirty && <span className="fvp-dirty-dot inline-block w-2 h-2 rounded-full bg-[var(--border-accent)] shrink-0" aria-label={t("files.unsavedChanges")} />}
        {truncated && <span className="fvp-truncated text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)] shrink-0">{t("files.truncated")}</span>}
      </div>
      {renderTopbarActions()}
    </div>
  );

  const renderExternalChangeNotice = () => {
    if (externalChangeSyncState === "in-sync") {
      return null;
    }
    if (externalChangeSyncState === "external-changed-clean" && !externalAutoSyncAt) {
      return null;
    }
    if (externalChangeSyncState !== "external-changed-dirty" || !externalChangeConflict) {
      return (
        <div className="fvp-external-change-banner is-auto-sync flex items-center justify-between gap-3 px-3.5 py-2 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)] text-[var(--text-muted)] text-[12px]" role="status" aria-live="polite">
          {t("files.externalChangeAutoSynced")}
        </div>
      );
    }
    return (
      <div className="fvp-external-change-banner is-conflict flex items-center justify-between gap-3 px-3.5 py-2 border-b border-b-[color-mix(in_srgb,var(--border-accent)_36%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--surface-control)_70%,var(--surface-card))]" role="status" aria-live="polite">
        <div className="fvp-external-change-banner-copy flex flex-col gap-0.5 min-w-0 [&_strong]:text-[12px] [&_strong]:text-[var(--text-strong)] [&_span]:text-[11px] [&_span]:text-[var(--text-muted)]">
          <strong>{t("files.externalChangeConflictTitle")}</strong>
          <span>
            {t("files.externalChangeConflictBody", {
              count: externalChangeConflict.updateCount,
            })}
          </span>
        </div>
        <div className="fvp-external-change-banner-actions inline-flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            className="ghost fvp-action-btn inline-flex items-center gap-[3px] px-1.5 py-[3px] text-[10px] rounded-lg whitespace-nowrap"
            onClick={handleExternalToggleCompare}
          >
            {externalCompareOpen ? t("files.externalChangeHideCompare") : t("files.externalChangeCompare")}
          </button>
          <button
            type="button"
            className="ghost fvp-action-btn inline-flex items-center gap-[3px] px-1.5 py-[3px] text-[10px] rounded-lg whitespace-nowrap"
            onClick={handleExternalKeepLocal}
          >
            {t("files.externalChangeKeepLocal")}
          </button>
          <button
            type="button"
            className="primary fvp-action-btn inline-flex items-center gap-[3px] px-1.5 py-[3px] text-[10px] rounded-lg whitespace-nowrap"
            onClick={handleExternalReloadFromDisk}
          >
            {t("files.externalChangeReload")}
          </button>
        </div>
      </div>
    );
  };

  const renderExternalComparePanel = () => {
    if (!externalCompareOpen || !externalChangeConflict) {
      return null;
    }
    const localPreview =
      content.length > 6_000 ? `${content.slice(0, 6_000)}\n\n...` : content;
    const diskPreview =
      externalChangeConflict.diskContent.length > 6_000
        ? `${externalChangeConflict.diskContent.slice(0, 6_000)}\n\n...`
        : externalChangeConflict.diskContent;
    return (
      <div className="fvp-external-compare grid grid-cols-2 max-[980px]:grid-cols-1 gap-2.5 px-3.5 py-2.5 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-command)_74%,transparent)]">
        <div className="fvp-external-compare-column min-w-0 border border-[var(--border-subtle)] rounded-lg bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)] [&_header]:px-2 [&_header]:py-1.5 [&_header]:text-[11px] [&_header]:font-semibold [&_header]:text-[var(--text-muted)] [&_header]:border-b [&_header]:border-[var(--border-subtle)] [&_pre]:m-0 [&_pre]:p-2 [&_pre]:max-h-40 [&_pre]:overflow-auto [&_pre]:text-[11px] [&_pre]:leading-[1.45] [&_pre]:text-[var(--text-strong)] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:font-[var(--code-font-family)]">
          <header>{t("files.externalChangeCompareLocal")}</header>
          <pre>{localPreview}</pre>
        </div>
        <div className="fvp-external-compare-column min-w-0 border border-[var(--border-subtle)] rounded-lg bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)] [&_header]:px-2 [&_header]:py-1.5 [&_header]:text-[11px] [&_header]:font-semibold [&_header]:text-[var(--text-muted)] [&_header]:border-b [&_header]:border-[var(--border-subtle)] [&_pre]:m-0 [&_pre]:p-2 [&_pre]:max-h-40 [&_pre]:overflow-auto [&_pre]:text-[11px] [&_pre]:leading-[1.45] [&_pre]:text-[var(--text-strong)] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:font-[var(--code-font-family)]">
          <header>{t("files.externalChangeCompareDisk")}</header>
          <pre>{diskPreview}</pre>
        </div>
      </div>
    );
  };

  const renderTabs = (className?: string) => {
    const isInline = className === "fvp-tabs-inline";
    return (
      <div
        ref={tabsContainerRef}
        className={`fvp-tabs${className ? ` ${className}` : ""} ${
          isInline
            ? "flex-1 min-w-0 min-h-[24px] border-b-0 bg-transparent w-full overflow-x-auto overflow-y-hidden p-0 shrink-0 relative z-[1]"
            : "block min-h-[30px] overflow-x-auto overflow-y-hidden p-0 border-b border-[var(--border-subtle)] bg-[var(--surface-messages)] shrink-0 relative z-[1]"
        }`}
        role="tablist"
        aria-label="Open files"
        onContextMenu={openTabContextMenu}
      >
        <div className={`fvp-tabs-track inline-flex items-stretch gap-px min-w-max pt-0 border-0 rounded-none bg-transparent shadow-none ${isInline ? "min-h-[24px]" : ""}`}>
          {visibleTabs.map((tabPath) => {
            const isActive = (activeTabPath ?? filePath) === tabPath;
            const tabName = tabPath.split("/").pop() || tabPath;
            const tabGitStatus = resolveMatchedGitStatusByPath(tabPath)?.status ?? null;
            const tabGitStatusClass = tabGitStatus ? `git-${tabGitStatus.toLowerCase()}` : "";
            return (
              <div
                key={tabPath}
                className={`fvp-tab ${isActive ? "is-active" : ""} ${tabGitStatusClass} inline-flex items-center max-w-[220px] ${
                  isInline ? "min-h-[24px]" : "min-h-[26px]"
                } border border-[color-mix(in_srgb,var(--border-subtle)_60%,transparent)] border-b-0 rounded-none transition-[background,border-color,color] duration-[140ms] relative ${
                  isActive
                    ? "border-[color-mix(in_srgb,var(--border-subtle)_90%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)] text-[var(--text-stronger)] z-[1] after:content-[''] after:absolute after:left-0 after:right-0 after:bottom-0 after:h-0.5 after:rounded-none after:bg-[color-mix(in_srgb,var(--border-accent)_88%,#7aa2ff_12%)]"
                    : "bg-[color-mix(in_srgb,var(--surface-control)_48%,transparent)] text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--surface-hover)_58%,transparent)] hover:text-[var(--text-strong)]"
                }`.trim()}
                role="presentation"
              >
                <button
                  type="button"
                  className="fvp-tab-main border-0 bg-transparent text-inherit text-[10px] font-semibold leading-[1.1] max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap px-[5px] pl-[7px] py-1"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onActivateTab?.(tabPath)}
                  onDoubleClick={() => onToggleEditorFileMaximized?.()}
                  onContextMenu={openTabContextMenu}
                  title={tabPath}
                >
                  <span className="fvp-tab-main-content inline-flex items-center gap-[5px] min-w-0">
                    <FileIcon filePath={tabPath} className="fvp-tab-icon !w-3 !h-3 opacity-[0.92] [filter:saturate(0.86)_contrast(1.03)]" />
                    <span className="fvp-tab-main-label overflow-hidden text-ellipsis whitespace-nowrap">{tabName}</span>
                  </span>
                </button>
                {onCloseTab ? (
                  <button
                    type="button"
                    className={`fvp-tab-close border-0 bg-transparent text-inherit pr-1 pl-0.5 py-[3px] inline-flex items-center justify-center rounded-none transition-[background,opacity] duration-[120ms] hover:bg-[color-mix(in_srgb,var(--surface-active)_42%,transparent)] hover:opacity-100 ${
                      isActive ? "opacity-90" : "opacity-60"
                    }`}
                    aria-label={`Close ${tabName}`}
                    onClick={() => onCloseTab(tabPath)}
                    onContextMenu={openTabContextMenu}
                  >
                    <X size={11} aria-hidden />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSingleRowHeader = () => (
    <div className="fvp-header-row flex items-center gap-2 px-3 py-[3px] border-b border-[var(--border-subtle)] bg-[var(--surface-messages)] shrink-0">
      <button
        type="button"
        className="icon-button fvp-back p-px shrink-0"
        onClick={onSingleRowLeadingAction ?? handleClose}
        aria-label={singleRowLeadingLabel ?? t("files.backToChat")}
        title={singleRowLeadingLabel ?? t("files.backToChat")}
      >
        {singleRowLeadingDirection === "right" && onSingleRowLeadingAction ? (
          <ArrowRight size={16} aria-hidden />
        ) : (
          <ArrowLeft size={16} aria-hidden />
        )}
      </button>
      <div className="fvp-header-row-tabs min-w-0 flex-1">
        {renderTabs("fvp-tabs-inline")}
      </div>
      <div className="fvp-header-row-right inline-flex items-center gap-2 min-w-0 shrink-0 ml-auto">
        {isDirty ? <span className="fvp-dirty-dot inline-block w-2 h-2 rounded-full bg-[var(--border-accent)] shrink-0" aria-label={t("files.unsavedChanges")} /> : null}
        {truncated ? <span className="fvp-truncated text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)] shrink-0">{t("files.truncated")}</span> : null}
        {renderTopbarActions("fvp-header-actions")}
      </div>
    </div>
  );

  // ── Content area ──
  const renderContent = () => (
    <FileViewBody
      filePath={filePath}
      imageSrc={imageSrc}
      imageInfo={imageInfo}
      handleImageLoad={handleImageLoad}
      handleImageError={handleImageError}
      imageLoadError={imageLoadError}
      error={error}
      isLoading={isLoading}
      previewPayload={previewPayload}
      previewPayloadLoading={previewPayloadLoading}
      previewPayloadError={previewPayloadError}
      viewSurface={viewSurface}
      content={content}
      setContent={setContent}
      cmRef={cmRef}
      handleCodeMirrorCreate={handleCodeMirrorCreate}
      onActiveFileLineRangeChange={onActiveFileLineRangeChange}
      onPreviewAnnotationStart={(lineRange) =>
        beginAnnotationDraft(lineRange, "file-preview-mode")
      }
      onEditorAnnotationStart={() => {
        if (!activeAnnotationLineRange) {
          return;
        }
        beginAnnotationDraft(activeAnnotationLineRange, "file-edit-mode");
      }}
      editorAnnotationLineRange={
        viewSurface.kind === "editor" ? activeAnnotationLineRange : null
      }
      annotationDraft={effectiveAnnotationDraft}
      codeAnnotations={visibleCodeAnnotations}
      onRemoveCodeAnnotation={onRemoveCodeAnnotation}
      onAnnotationDraftBodyChange={(body) => {
        annotationDraftBodyRef.current = body;
      }}
      onAnnotationDraftCancel={() => {
        annotationDraftBodyRef.current = "";
        setAnnotationDraft(null);
      }}
      onAnnotationDraftConfirm={handleConfirmAnnotationDraft}
      lastReportedLineRangeRef={lastReportedLineRangeRef}
      editorExtensions={editorExtensions}
      editorTheme={editorTheme}
      highlightedLines={highlightedLines}
      lines={lines}
      gitAddedLineNumberSet={gitAddedLineNumberSet}
      gitModifiedLineNumberSet={gitModifiedLineNumberSet}
      formatFileSize={formatFileSize}
      t={t}
    />
  );

  // ── Footer ──
  // Footer action button — within `.fvp-footer .fvp-action-btn` cascade (overrides
  // global base with tighter dimensions). Plus toggle variants (find/maximize/layout)
  // share a 20×18 icon-button look.
  const FOOTER_ACTION_BTN_CLS =
    "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] leading-[1.1] rounded-md min-h-[18px] whitespace-nowrap";
  const FOOTER_TOGGLE_BTN_CLS =
    "inline-flex items-center justify-center min-w-[20px] min-h-[18px] px-[5px] py-0.5 text-[10px] leading-[1.1] rounded-md";
  const renderFooter = () => (
    <div
      className="fvp-footer flex items-center justify-between gap-2 px-2.5 py-[3px] border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-faint)] shrink-0 bg-[var(--surface-messages)] min-h-[20px] [&_.open-app-button]:rounded-lg [&_.open-app-action]:min-h-[18px] [&_.open-app-action]:px-[7px] [&_.open-app-action]:py-0.5 [&_.open-app-toggle]:min-h-[18px] [&_.open-app-toggle]:px-[5px] [&_.open-app-toggle]:py-0.5 [&_.open-app-label]:gap-1 [&_.open-app-label]:text-[11px] [&_.open-app-label]:leading-[1.1] [&_.open-app-icon]:w-3 [&_.open-app-icon]:h-3"
      onPointerDown={handleFooterPointerDown}
      title={t("layout.resizePlanPanel")}
    >
      <div className="fvp-footer-left flex items-center gap-1.5 min-w-0 flex-1">
        {canEditDocument && mode === "edit" && isDirty && (
          <span className="fvp-footer-hint flex items-center gap-1.5">
            <span className="fvp-dirty-dot inline-block w-2 h-2 rounded-full bg-[var(--border-accent)] shrink-0" />
            {t("files.unsavedChanges")}
            <span className="fvp-footer-shortcut text-[var(--text-fainter)] font-[var(--code-font-family)] text-[9px] px-[3px] rounded-[3px] bg-[var(--surface-control)] border border-[var(--border-subtle)]">{t("files.saveShortcut")}</span>
          </span>
        )}
        {canEditDocument && mode === "edit" && !isDirty && (
          <span className="fvp-footer-hint fvp-footer-saved flex items-center gap-1.5 text-[var(--text-muted)]">{t("files.saved")}</span>
        )}
        {(mode === "preview" && (truncated || !canEditDocument)) && (
          <span className="fvp-footer-hint flex items-center gap-1.5">{t("files.readOnly")}</span>
        )}
      </div>
      <div className="fvp-footer-right flex items-center gap-1 shrink-0 justify-end min-w-0">
        {fileReferenceShouldRender ? (
          <div
            className={`fvp-file-reference-bar flex items-center gap-1.5 min-w-0 max-w-[min(56vw,560px)] border border-[color-mix(in_srgb,var(--border-accent)_34%,var(--border-subtle))] rounded-full pl-2 pr-1.5 py-0.5 bg-[linear-gradient(120deg,color-mix(in_srgb,var(--surface-control)_88%,transparent),color-mix(in_srgb,var(--surface-card)_82%,transparent))] shadow-[inset_0_1px_0_color-mix(in_srgb,white_18%,transparent)] transition-[opacity,transform] duration-[120ms] ${
              fileReferenceVisible
                ? "is-visible opacity-100 translate-y-0 pointer-events-auto"
                : "opacity-0 translate-y-0.5 pointer-events-none"
            }`}
            role="group"
            aria-label={t("composer.fileReference")}
          >
            <span className="fvp-file-reference-label text-[10px] text-[var(--text-faint)] whitespace-nowrap">{t("composer.activeFile")}:</span>
            <code className="fvp-file-reference-path min-w-0 flex-1 text-[10px] text-[var(--text-strong)] overflow-hidden text-ellipsis whitespace-nowrap bg-transparent" title={filePath}>
              {filePath.split("/").pop() || filePath}
            </code>
            {activeFileLineLabel ? (
              <span className="fvp-file-reference-lines text-[9px] text-[var(--text-strong)] border border-[var(--border-subtle)] rounded-full px-1.5 py-px whitespace-nowrap bg-[color-mix(in_srgb,var(--surface-strong)_80%,transparent)]">{activeFileLineLabel}</span>
            ) : null}
            <button
              type="button"
              className={`fvp-file-reference-toggle border border-[var(--border-subtle)] rounded-full text-[10px] px-[7px] py-0.5 whitespace-nowrap leading-[1.1] ${
                fileReferenceMode === "path"
                  ? "is-active border-[color-mix(in_srgb,var(--border-accent)_60%,var(--border-subtle))] text-[var(--text-strong)] bg-[color-mix(in_srgb,var(--surface-active)_72%,var(--surface-control))]"
                  : "bg-[var(--surface-control)] text-[var(--text-muted)]"
              }`}
              onClick={() =>
                onFileReferenceModeChange?.(fileReferenceMode === "path" ? "none" : "path")
              }
              title={t("composer.fileReferenceHint")}
            >
              {fileReferenceMode === "path"
                ? t("composer.fileReferencePathOn")
                : t("composer.fileReferencePathOff")}
            </button>
          </div>
        ) : null}
        {mode === "preview" && onInsertText && content.trim().length > 0 && (
          <button
            type="button"
            className={`ghost fvp-action-btn ${FOOTER_ACTION_BTN_CLS}`}
            onClick={() => {
              const fence = previewLanguage ? `\`\`\`${previewLanguage}` : "```";
              const snippet = `${filePath}\n${fence}\n${content}\n\`\`\``;
              onInsertText(snippet);
            }}
          >
            {t("files.addToChat")}
          </button>
        )}
        {!skipTextRead && !truncated ? (
          <button
            type="button"
            className={`ghost fvp-action-btn fvp-find-toggle ${FOOTER_TOGGLE_BTN_CLS}`}
            aria-label={t("files.openFind")}
            title={t("files.openFind")}
            onClick={handleOpenFindPanel}
          >
            <FileSearch size={12} aria-hidden />
          </button>
        ) : null}
        {onToggleEditorFileMaximized ? (
          <button
            type="button"
            className={`ghost fvp-action-btn fvp-maximize-toggle ${FOOTER_TOGGLE_BTN_CLS}`}
            aria-label={isEditorFileMaximized ? t("common.restore") : t("menu.maximize")}
            title={isEditorFileMaximized ? t("common.restore") : t("menu.maximize")}
            onClick={onToggleEditorFileMaximized}
          >
            {isEditorFileMaximized ? (
              <Minimize2 size={12} aria-hidden />
            ) : (
              <Maximize2 size={12} aria-hidden />
            )}
          </button>
        ) : null}
        {onToggleEditorSplitLayout ? (
          <button
            type="button"
            className={`ghost fvp-action-btn fvp-layout-toggle ${FOOTER_TOGGLE_BTN_CLS} ${
              editorSplitLayout === "horizontal"
                ? "is-side-by-side text-[var(--text-strong)] border-[color-mix(in_srgb,var(--border-accent)_46%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--surface-card)_76%,var(--surface-active))]"
                : ""
            }`}
            aria-label={
              editorSplitLayout === "horizontal"
                ? t("files.switchToStackedSplit")
                : t("files.switchToSideBySideSplit")
            }
            title={
              editorSplitLayout === "horizontal"
                ? t("files.switchToStackedSplit")
                : t("files.switchToSideBySideSplit")
            }
            onClick={onToggleEditorSplitLayout}
          >
            {editorSplitLayout === "horizontal" ? (
              <Rows2 size={12} aria-hidden />
            ) : (
              <Columns2 size={12} aria-hidden />
            )}
          </button>
        ) : null}
        <OpenAppMenu
          path={absolutePath}
          openTargets={openTargets}
          selectedOpenAppId={selectedOpenAppId}
          onSelectOpenAppId={onSelectOpenAppId}
          iconById={openAppIconById}
        />
      </div>
    </div>
  );

  const renderNavigationPanel = () => (
    <FileViewNavigationPanel
      workspacePath={workspacePath}
      navigationError={navigationError}
      definitionCandidates={definitionCandidates}
      onCloseDefinitionCandidates={() => setDefinitionCandidates([])}
      referenceResults={referenceResults}
      onCloseReferenceResults={() => setReferenceResults(null)}
      onNavigateToLocation={navigateToLocation}
      t={t}
    />
  );

  return (
    <div className={`fvp${usesSingleRowHeader ? " fvp-single-row-header" : ""}`} ref={panelRootRef}>
      {usesSingleRowHeader ? renderSingleRowHeader() : renderTabs()}
      {tabContextMenu.visible && canCloseAllTabs ? (
        <div
          ref={tabContextMenuRef}
          className="fvp-tab-context-menu absolute z-[1000] flex min-w-[148px] flex-col border border-[var(--border-subtle)] rounded-lg bg-[color-mix(in_srgb,var(--surface-card)_92%,transparent)] shadow-[0_10px_24px_rgba(0,0,0,0.24)] p-1"
          role="menu"
          style={{ left: `${tabContextMenu.x}px`, top: `${tabContextMenu.y}px` }}
        >
          <button
            type="button"
            className="fvp-tab-context-menu-item border-0 rounded-md bg-transparent text-[var(--text-strong)] text-[12px] text-left px-[9px] py-[7px] hover:bg-[color-mix(in_srgb,var(--surface-hover)_74%,transparent)]"
            role="menuitem"
            onClick={handleCloseAllTabs}
          >
            {t("files.closeAllTabs")}
          </button>
        </div>
      ) : null}
      {!usesSingleRowHeader ? renderTopbar() : null}
      {renderExternalChangeNotice()}
      {renderExternalComparePanel()}
      <div className="fvp-body flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col w-full">{renderContent()}</div>
      {renderNavigationPanel()}
      {renderFooter()}
    </div>
  );
}
