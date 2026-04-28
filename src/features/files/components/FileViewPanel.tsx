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
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { search } from "@codemirror/search";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { getGitFileFullDiff } from "../../../services/tauri";
import {
  matchesShortcutForPlatform,
  parseShortcut,
} from "../../../utils/shortcuts";
import { highlightLine } from "../../../utils/syntax";
import { OpenAppMenu } from "../../app/components/OpenAppMenu";
import FileIcon from "../../../components/FileIcon";
import type { GitFileStatus, OpenAppTarget } from "../../../types";
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
  headerLayout?: "stacked" | "single-row";
  onSingleRowLeadingAction?: () => void;
  singleRowLeadingDirection?: "left" | "right";
  singleRowLeadingLabel?: string;
  externalChangeMonitoringEnabled?: boolean;
  externalChangeTransportMode?: "watcher" | "polling";
  externalChangePollIntervalMs?: number;
  saveFileShortcut?: string | null;
  findInFileShortcut?: string | null;
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
  if (typeof document === "undefined") {
    return "dark";
  }
  const dataTheme = document.documentElement.dataset.theme;
  if (dataTheme === "light") return "light";
  if (dataTheme === "dark" || dataTheme === "dim") return "dark";
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return "dark";
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
  headerLayout = "stacked",
  onSingleRowLeadingAction,
  singleRowLeadingDirection = "left",
  singleRowLeadingLabel,
  externalChangeMonitoringEnabled = false,
  externalChangeTransportMode = "polling",
  externalChangePollIntervalMs = EXTERNAL_CHANGE_POLL_INTERVAL_MS,
  saveFileShortcut = "cmd+s",
  findInFileShortcut = "cmd+f",
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
  }, [
    handleDocumentSave,
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

  const imageSrc = useMemo(() => {
    if (!isImage) return null;
    try {
      return convertFileSrc(absolutePath);
    } catch {
      return null;
    }
  }, [isImage, absolutePath]);

  const [imageInfo, setImageInfo] = useState<{
    width: number;
    height: number;
    sizeBytes: number | null;
  } | null>(null);

  // Fetch image file size when imageSrc changes
  useEffect(() => {
    setImageInfo(null);
    if (!imageSrc) return;
    let cancelled = false;
    fetch(imageSrc)
      .then((res) => res.blob())
      .then((blob) => {
        if (!cancelled) {
          setImageInfo((prev) =>
            prev
              ? { ...prev, sizeBytes: blob.size }
              : { width: 0, height: 0, sizeBytes: blob.size },
          );
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [imageSrc]);

  const handleImageLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setImageInfo((prev) => ({
        width: img.naturalWidth,
        height: img.naturalHeight,
        sizeBytes: prev?.sizeBytes ?? null,
      }));
    },
    [],
  );

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
        if (mutation.attributeName === "data-theme") {
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
  const highlightedLines = useMemo(
    () =>
      lines.map((line) => {
        const html = highlightLine(line, highlightedPreviewLanguage);
        return html || "&nbsp;";
      }),
    [highlightedPreviewLanguage, lines],
  );
  const editorExtensions = useMemo(
    () => [
      saveKeymapExt,
      editorNavigationKeymapExt,
      ctrlClickDefinitionExt,
      persistentSearchExtension,
      ...cmExtensions,
    ],
    [
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
  const renderTopbarActions = (className = "fvp-topbar-right") => (
    <div className={className}>
      {canEditDocument && (
        <>
          {mode === "preview" ? (
            <div className="fvp-action-group fvp-preview-tools" role="group">
              <button
                type="button"
                className="fvp-action-btn"
                onClick={handleEnterEdit}
                disabled={truncated || !canEditDocument}
                title={truncated ? t("files.fileTooLarge") : t("files.edit")}
              >
                <Pencil size={14} aria-hidden />
                <span>{t("files.edit")}</span>
              </button>
            </div>
          ) : (
            <div className="fvp-action-group" role="group">
              <button
                type="button"
                className="ghost fvp-action-btn"
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
                className="ghost fvp-action-btn"
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
                className="ghost fvp-action-btn"
                onClick={handleEnterPreview}
              >
                <Eye size={14} aria-hidden />
                <span>{t("files.preview")}</span>
              </button>
              <button
                type="button"
                className={`primary fvp-action-btn fvp-save-btn ${isDirty ? "" : "is-saved"}`}
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
    <div className="fvp-topbar">
      <div className="fvp-topbar-left">
        <button
          type="button"
          className="icon-button fvp-back"
          onClick={handleClose}
          aria-label={t("files.backToChat")}
          title={t("files.backToChat")}
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <span
          className={`fvp-filepath ${fileGitStatusClass}`.trim()}
          title={filePath}
        >
          {filePath}
        </span>
        {isDirty && <span className="fvp-dirty-dot" aria-label={t("files.unsavedChanges")} />}
        {truncated && <span className="fvp-truncated">{t("files.truncated")}</span>}
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
        <div className="fvp-external-change-banner is-auto-sync" role="status" aria-live="polite">
          {t("files.externalChangeAutoSynced")}
        </div>
      );
    }
    return (
      <div className="fvp-external-change-banner is-conflict" role="status" aria-live="polite">
        <div className="fvp-external-change-banner-copy">
          <strong>{t("files.externalChangeConflictTitle")}</strong>
          <span>
            {t("files.externalChangeConflictBody", {
              count: externalChangeConflict.updateCount,
            })}
          </span>
        </div>
        <div className="fvp-external-change-banner-actions">
          <button
            type="button"
            className="ghost fvp-action-btn"
            onClick={handleExternalToggleCompare}
          >
            {externalCompareOpen ? t("files.externalChangeHideCompare") : t("files.externalChangeCompare")}
          </button>
          <button
            type="button"
            className="ghost fvp-action-btn"
            onClick={handleExternalKeepLocal}
          >
            {t("files.externalChangeKeepLocal")}
          </button>
          <button
            type="button"
            className="primary fvp-action-btn"
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
      <div className="fvp-external-compare">
        <div className="fvp-external-compare-column">
          <header>{t("files.externalChangeCompareLocal")}</header>
          <pre>{localPreview}</pre>
        </div>
        <div className="fvp-external-compare-column">
          <header>{t("files.externalChangeCompareDisk")}</header>
          <pre>{diskPreview}</pre>
        </div>
      </div>
    );
  };

  const renderTabs = (className?: string) => (
    <div
      ref={tabsContainerRef}
      className={`fvp-tabs${className ? ` ${className}` : ""}`}
      role="tablist"
      aria-label="Open files"
      onContextMenu={openTabContextMenu}
    >
      <div className="fvp-tabs-track">
        {visibleTabs.map((tabPath) => {
          const isActive = (activeTabPath ?? filePath) === tabPath;
          const tabName = tabPath.split("/").pop() || tabPath;
          const tabGitStatus = resolveMatchedGitStatusByPath(tabPath)?.status ?? null;
          const tabGitStatusClass = tabGitStatus ? `git-${tabGitStatus.toLowerCase()}` : "";
          return (
            <div
              key={tabPath}
              className={`fvp-tab ${isActive ? "is-active" : ""} ${tabGitStatusClass}`.trim()}
              role="presentation"
            >
              <button
                type="button"
                className="fvp-tab-main"
                role="tab"
                aria-selected={isActive}
                onClick={() => onActivateTab?.(tabPath)}
                onDoubleClick={() => onToggleEditorFileMaximized?.()}
                onContextMenu={openTabContextMenu}
                title={tabPath}
              >
                <span className="fvp-tab-main-content">
                  <FileIcon filePath={tabPath} className="fvp-tab-icon" />
                  <span className="fvp-tab-main-label">{tabName}</span>
                </span>
              </button>
              {onCloseTab ? (
                <button
                  type="button"
                  className="fvp-tab-close"
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

  const renderSingleRowHeader = () => (
    <div className="fvp-header-row">
      <button
        type="button"
        className="icon-button fvp-back"
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
      <div className="fvp-header-row-tabs">
        {renderTabs("fvp-tabs-inline")}
      </div>
      <div className="fvp-header-row-right">
        {isDirty ? <span className="fvp-dirty-dot" aria-label={t("files.unsavedChanges")} /> : null}
        {truncated ? <span className="fvp-truncated">{t("files.truncated")}</span> : null}
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
  const renderFooter = () => (
    <div
      className="fvp-footer"
      onPointerDown={handleFooterPointerDown}
      title={t("layout.resizePlanPanel")}
    >
      <div className="fvp-footer-left">
        {canEditDocument && mode === "edit" && isDirty && (
          <span className="fvp-footer-hint">
            <span className="fvp-dirty-dot" />
            {t("files.unsavedChanges")}
            <span className="fvp-footer-shortcut">{t("files.saveShortcut")}</span>
          </span>
        )}
        {canEditDocument && mode === "edit" && !isDirty && (
          <span className="fvp-footer-hint fvp-footer-saved">{t("files.saved")}</span>
        )}
        {(mode === "preview" && (truncated || !canEditDocument)) && (
          <span className="fvp-footer-hint">{t("files.readOnly")}</span>
        )}
      </div>
      <div className="fvp-footer-right">
        {fileReferenceShouldRender ? (
          <div
            className={`fvp-file-reference-bar${fileReferenceVisible ? " is-visible" : ""}`}
            role="group"
            aria-label={t("composer.fileReference")}
          >
            <span className="fvp-file-reference-label">{t("composer.activeFile")}:</span>
            <code className="fvp-file-reference-path" title={filePath}>
              {filePath.split("/").pop() || filePath}
            </code>
            {activeFileLineLabel ? (
              <span className="fvp-file-reference-lines">{activeFileLineLabel}</span>
            ) : null}
            <button
              type="button"
              className={`fvp-file-reference-toggle${fileReferenceMode === "path" ? " is-active" : ""}`}
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
            className="ghost fvp-action-btn"
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
            className="ghost fvp-action-btn fvp-find-toggle"
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
            className="ghost fvp-action-btn fvp-maximize-toggle"
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
            className={`ghost fvp-action-btn fvp-layout-toggle${
              editorSplitLayout === "horizontal" ? " is-side-by-side" : ""
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
          className="fvp-tab-context-menu"
          role="menu"
          style={{ left: `${tabContextMenu.x}px`, top: `${tabContextMenu.y}px` }}
        >
          <button
            type="button"
            className="fvp-tab-context-menu-item"
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
      <div className="fvp-body">{renderContent()}</div>
      {renderNavigationPanel()}
      {renderFooter()}
    </div>
  );
}
