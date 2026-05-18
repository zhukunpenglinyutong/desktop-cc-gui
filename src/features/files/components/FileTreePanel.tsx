import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DragEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { PanelTabId } from "../../layout/components/PanelTabs";
import {
  createWorkspaceDirectory,
  copyWorkspaceItem,
  getWorkspaceDirectoryChildren,
  readWorkspaceFile,
  trashWorkspaceItem,
  writeWorkspaceFile,
  type WorkspaceDirectoryEntry,
  type WorkspaceDirectoryChildState,
} from "../../../services/tauri";
import type { GitFileStatus, OpenAppTarget } from "../../../types";
import { languageFromPath } from "../../../utils/syntax";
import {
  resolveGitRootWorkspacePrefix,
  resolveGitStatusPathCandidates,
} from "../../../utils/workspacePaths";
import {
  writeDetachedFileTreeDragSnapshot,
  DETACHED_FILE_TREE_DRAG_BRIDGE_EVENT,
  type DetachedFileTreeDragBridgePayload,
} from "../detachedFileTreeDragBridge";
import { FilePreviewPopover } from "./FilePreviewPopover";
import { FileTreeRootActions } from "./FileTreeRootActions";
import {
  CossFileTreeSurface,
  type CossFileTreeItemData,
} from "./CossFileTreeSurface";
import {
  clampRendererContextMenuPosition,
  RendererContextMenu,
  type RendererContextMenuItem,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTreeNode[];
  isLazyLoadable?: boolean;
  childState?: WorkspaceDirectoryChildState;
  hasMore?: boolean;
};

type VisibleTreeNodeEntry = {
  path: string;
  type: "file" | "folder" | "root";
};

type FileTreePanelProps = {
  workspaceId: string;
  workspaceName?: string;
  workspacePath: string;
  gitRoot?: string | null;
  files: string[];
  directories?: string[];
  directoryMetadata?: WorkspaceDirectoryEntry[];
  isLoading: boolean;
  loadError?: string | null;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  onInsertText?: (text: string) => void;
  onOpenFile?: (path: string, location?: FileOpenLocation) => void;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  onToggleRuntimeConsole?: () => void;
  isRuntimeConsoleVisible?: boolean;
  onOpenSpecHub?: () => void;
  isSpecHubActive?: boolean;
  onOpenDetachedExplorer?: (initialFilePath?: string | null) => void;
  showSpecHubAction?: boolean;
  showDetachedExplorerAction?: boolean;
  crossWindowDragTargetLabel?: string | null;
  gitStatusFiles?: GitFileStatus[];
  gitignoredFiles?: Set<string>;
  gitignoredDirectories?: Set<string>;
  onRefreshFiles?: () => void;
};

type FileOpenLocation = {
  line: number;
  column: number;
};

type FileTreeBuildNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: Map<string, FileTreeBuildNode>;
  isLazyLoadable: boolean;
  childState?: WorkspaceDirectoryChildState;
  hasMore: boolean;
};

const EMPTY_DIRECTORIES: string[] = [];
const EMPTY_SET: Set<string> = new Set();
const SPECIAL_DEPENDENCY_DIRECTORIES = new Set([
  "node_modules",
  ".pnpm-store",
  ".yarn",
  "bower_components",
  "vendor",
  ".venv",
  "venv",
  "env",
  "__pypackages__",
  "Pods",
  "Carthage",
  ".m2",
  ".ivy2",
  ".cargo",
]);
const SPECIAL_BUILD_ARTIFACT_DIRECTORIES = new Set([
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".angular",
  ".parcel-cache",
  ".turbo",
  ".cache",
  ".gradle",
  "CMakeFiles",
  "bin",
  "obj",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  ".dart_tool",
]);
const CROSS_WINDOW_TREE_DRAG_REBROADCAST_THROTTLE_MS = 120;
const EMPTY_DIRECTORY_METADATA: WorkspaceDirectoryEntry[] = [];

function setFileTreeDragBridge(paths: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  document.documentElement.classList.add("file-tree-dragging");
  window.__fileTreeDragPaths = paths;
  window.__fileTreeDragStamp = Date.now();
  window.__fileTreeDragActive = true;
  window.__fileTreeDragOverChat = false;
  window.__fileTreeDragDropped = false;
}

function setFileTreeDragPosition(x: number, y: number) {
  if (typeof window === "undefined") {
    return;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) {
    return;
  }
  window.__fileTreeDragPosition = { x, y };
}

const CHAT_DROP_ZONE_SELECTORS = [
  ".chat-input-box",
  ".input-editable-wrapper",
  ".composer-input-area",
];

function getChatDropZones() {
  const zones: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  CHAT_DROP_ZONE_SELECTORS.forEach((selector) => {
    const elements = document.querySelectorAll(selector);
    elements.forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const container = element.closest(".chat-input-box");
      const zone = container instanceof HTMLElement ? container : element;
      if (seen.has(zone)) {
        return;
      }
      seen.add(zone);
      zones.push(zone);
    });
  });
  return zones;
}

function getChatInputContainerFromElement(element: Element | null): HTMLElement | null {
  if (!element) {
    return null;
  }
  const container = element.closest(".chat-input-box");
  return container instanceof HTMLElement ? container : null;
}

function getSingleChatInputContainer() {
  const containers = Array.from(document.querySelectorAll(".chat-input-box"))
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
  if (containers.length !== 1) {
    return null;
  }
  return containers[0];
}

function clearChatDropTargetHighlight() {
  const highlighted = document.querySelectorAll(".chat-input-box.file-tree-drop-target-active");
  highlighted.forEach((element) => {
    element.classList.remove("file-tree-drop-target-active");
  });
}

function applyChatDropTargetHighlight(target: HTMLElement | null) {
  clearChatDropTargetHighlight();
  if (!target) {
    return;
  }
  const container = getChatInputContainerFromElement(target);
  if (container) {
    container.classList.add("file-tree-drop-target-active");
    return;
  }
  if (target.classList.contains("chat-input-box")) {
    target.classList.add("file-tree-drop-target-active");
  }
}

function resolveChatDropTargetFromPoint(point: { x: number; y: number } | null) {
  if (!point) {
    return null;
  }

  const points = normalizePointCandidates(point);
  if (typeof document.elementFromPoint === "function") {
    for (const candidate of points) {
      const hovered = document.elementFromPoint(candidate.x, candidate.y);
      const container = getChatInputContainerFromElement(hovered);
      if (container) {
        return container;
      }
    }
  }

  const zones = getChatDropZones();
  for (const candidate of points) {
    for (const zone of zones) {
      const rect = zone.getBoundingClientRect();
      if (
        candidate.x >= rect.left &&
        candidate.x <= rect.right &&
        candidate.y >= rect.top &&
        candidate.y <= rect.bottom
      ) {
        return zone;
      }
    }
  }
  return null;
}

function resolveChatDropTargetFromDragEvent(event: globalThis.DragEvent) {
  const eventTarget = event.target instanceof Element ? event.target : null;
  const byTarget = getChatInputContainerFromElement(eventTarget);
  if (byTarget) {
    return byTarget;
  }
  if (
    Number.isFinite(event.clientX) &&
    Number.isFinite(event.clientY) &&
    !(event.clientX === 0 && event.clientY === 0)
  ) {
    return resolveChatDropTargetFromPoint({ x: event.clientX, y: event.clientY });
  }
  return null;
}

function bindChatDropTargetsForTreeDrag(paths: string[]) {
  const onDocumentDragEnterOrOver = (event: globalThis.DragEvent) => {
    if (typeof window === "undefined" || window.__fileTreeDragActive !== true) {
      return;
    }
    setFileTreeDragPosition(event.clientX, event.clientY);
    const target = resolveChatDropTargetFromDragEvent(event);
    const visualTarget = target ?? getSingleChatInputContainer() ?? null;
    const isOverChat = Boolean(target);
    window.__fileTreeDragOverChat = isOverChat;
    applyChatDropTargetHighlight(visualTarget);
    if (isOverChat) {
      event.preventDefault();
    }
  };

  const onDocumentDragLeave = (event: globalThis.DragEvent) => {
    if (typeof window === "undefined" || window.__fileTreeDragActive !== true) {
      return;
    }
    const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (related && isChatInputElement(related)) {
      return;
    }
    const target = resolveChatDropTargetFromDragEvent(event);
    if (target) {
      window.__fileTreeDragOverChat = true;
      applyChatDropTargetHighlight(target);
      return;
    }
    window.__fileTreeDragOverChat = false;
    clearChatDropTargetHighlight();
  };

  const onDocumentDrop = (event: globalThis.DragEvent) => {
    if (typeof window === "undefined" || window.__fileTreeDragActive !== true) {
      return;
    }
    setFileTreeDragPosition(event.clientX, event.clientY);
    const target = resolveChatDropTargetFromDragEvent(event) ??
      resolveChatDropTargetFromPoint(window.__fileTreeDragPosition ?? null);
    window.__fileTreeDragOverChat = Boolean(target);
    if (!target) {
      clearFileTreeDragBridge();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (insertPathsIntoChat(paths)) {
      window.__fileTreeDragDropped = true;
    }
    clearFileTreeDragBridge();
  };

  document.addEventListener("dragenter", onDocumentDragEnterOrOver, true);
  document.addEventListener("dragover", onDocumentDragEnterOrOver, true);
  document.addEventListener("dragleave", onDocumentDragLeave, true);
  document.addEventListener("drop", onDocumentDrop, true);

  return () => {
    document.removeEventListener("dragenter", onDocumentDragEnterOrOver, true);
    document.removeEventListener("dragover", onDocumentDragEnterOrOver, true);
    document.removeEventListener("dragleave", onDocumentDragLeave, true);
    document.removeEventListener("drop", onDocumentDrop, true);
    clearChatDropTargetHighlight();
  };
}

function isChatInputElement(node: Element | null) {
  if (!node) {
    return false;
  }
  return CHAT_DROP_ZONE_SELECTORS.some((selector) => Boolean(node.closest(selector)));
}

function normalizePointCandidates(point: { x: number; y: number }) {
  const candidates = [{ x: point.x, y: point.y }];
  const scale = window.devicePixelRatio || 1;
  if (scale !== 1) {
    candidates.push({ x: point.x / scale, y: point.y / scale });
  }
  return candidates;
}

function isPointInsideChatInput(point: { x: number; y: number }) {
  const zones = getChatDropZones();
  if (zones.length === 0) {
    return false;
  }
  const points = normalizePointCandidates(point);
  if (typeof document.elementFromPoint === "function") {
    for (const candidate of points) {
      const hovered = document.elementFromPoint(candidate.x, candidate.y);
      if (isChatInputElement(hovered)) {
        return true;
      }
    }
  }
  return points.some((candidate) =>
    zones.some((zone) => {
      const rect = zone.getBoundingClientRect();
      return (
        candidate.x >= rect.left &&
        candidate.x <= rect.right &&
        candidate.y >= rect.top &&
        candidate.y <= rect.bottom
      );
    }),
  );
}

function insertPathsIntoChat(paths: string[]) {
  if (typeof window === "undefined" || !window.handleFilePathFromJava) {
    return false;
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    return false;
  }
  if (paths.length === 1) {
    window.handleFilePathFromJava(paths[0] ?? "");
    return true;
  }
  window.handleFilePathFromJava(paths);
  return true;
}

function triggerChatInputInsertFromTreeDrag(
  event: DragEvent<HTMLButtonElement>,
  fallbackPaths: string[],
) {
  const paths = window.__fileTreeDragPaths ?? fallbackPaths;
  if (!Array.isArray(paths) || paths.length === 0) return false;
  if (window.__fileTreeDragOverChat === true) {
    return insertPathsIntoChat(paths);
  }
  const pointer = (
    Number.isFinite(event.clientX) &&
    Number.isFinite(event.clientY) &&
    !(event.clientX === 0 && event.clientY === 0)
  )
    ? { x: event.clientX, y: event.clientY }
    : window.__fileTreeDragPosition;
  if (pointer) {
    if (!isPointInsideChatInput(pointer)) {
      return false;
    }
  } else {
    const activeElement = document.activeElement instanceof Element
      ? document.activeElement
      : null;
    if (!isChatInputElement(activeElement)) {
      return false;
    }
  }
  return insertPathsIntoChat(paths);
}

function clearFileTreeDragBridge() {
  if (typeof window === "undefined") {
    return;
  }
  document.documentElement.classList.remove("file-tree-dragging");
  if (typeof window.__fileTreeDragCleanup === "function") {
    try {
      window.__fileTreeDragCleanup();
    } catch {
      // ignore cleanup errors
    }
  }
  delete window.__fileTreeDragPaths;
  delete window.__fileTreeDragStamp;
  delete window.__fileTreeDragActive;
  delete window.__fileTreeDragPosition;
  delete window.__fileTreeDragOverChat;
  delete window.__fileTreeDragDropped;
  delete window.__fileTreeDragCleanup;
  clearChatDropTargetHighlight();
}

function isSpecialDirectoryPath(path: string) {
  const leaf = path.split("/").filter(Boolean).pop() ?? "";
  if (!leaf) {
    return false;
  }
  return (
    SPECIAL_DEPENDENCY_DIRECTORIES.has(leaf) ||
    SPECIAL_BUILD_ARTIFACT_DIRECTORIES.has(leaf) ||
    leaf.startsWith("cmake-build-")
  );
}

function buildTree(
  files: string[],
  directories: string[],
  lazyLoadableDirectories: Set<string>,
  directoryMetadataByPath: Map<string, WorkspaceDirectoryEntry>,
): { nodes: FileTreeNode[]; folderPaths: Set<string> } {
  const root = new Map<string, FileTreeBuildNode>();
  const addNode = (
    map: Map<string, FileTreeBuildNode>,
    name: string,
    path: string,
    type: "file" | "folder",
    isLazyLoadable = false,
    childState?: WorkspaceDirectoryChildState,
    hasMore = false,
  ) => {
    const existing = map.get(name);
    if (existing) {
      if (type === "folder") {
        existing.type = "folder";
      }
      if (isLazyLoadable) {
        existing.isLazyLoadable = true;
      }
      if (childState) {
        existing.childState = childState;
      }
      if (hasMore) {
        existing.hasMore = true;
      }
      return existing;
    }
    const node: FileTreeBuildNode = {
      name,
      path,
      type,
      children: new Map(),
      isLazyLoadable,
      childState,
      hasMore,
    };
    map.set(name, node);
    return node;
  };

  const insertPath = (path: string, leafType: "file" | "folder") => {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) {
      return;
    }
    let currentMap = root;
    let currentPath = "";
    parts.forEach((segment, index) => {
      const isLeaf = index === parts.length - 1;
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
      const nodeType: "file" | "folder" = isLeaf ? leafType : "folder";
      const metadata = nodeType === "folder" ? directoryMetadataByPath.get(nextPath) : undefined;
      const node = addNode(
        currentMap,
        segment,
        nextPath,
        nodeType,
        nodeType === "folder" && lazyLoadableDirectories.has(nextPath),
        metadata?.child_state,
        Boolean(metadata?.has_more),
      );
      if (nodeType === "folder") {
        currentMap = node.children;
        currentPath = nextPath;
      }
    });
  };

  directories.forEach((path) => insertPath(path, "folder"));
  files.forEach((path) => insertPath(path, "file"));

  const folderPaths = new Set<string>();

  const sortNodes = (a: FileTreeBuildNode, b: FileTreeBuildNode) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  };

  const collapseFolderChain = (
    start: FileTreeBuildNode,
  ): { node: FileTreeBuildNode; label: string; path: string } => {
    let node = start;
    const labels = [start.name];
    let path = start.path;

    for (;;) {
      const children = Array.from(node.children.values());
      const hasDirectFile = children.some((child) => child.type === "file");
      const directFolders = children.filter((child) => child.type === "folder");
      const hasLazyLoadableChild = directFolders.some((child) => child.isLazyLoadable);
      if (node.isLazyLoadable || hasDirectFile || hasLazyLoadableChild || directFolders.length !== 1) {
        break;
      }
      const next = directFolders[0];
      if (!next) {
        break;
      }
      labels.push(next.name);
      node = next;
      path = node.path;
    }

    return {
      node,
      label: labels.join("."),
      path,
    };
  };

  const toArray = (map: Map<string, FileTreeBuildNode>): FileTreeNode[] => {
    const nodes = Array.from(map.values())
      .sort(sortNodes)
      .map((node) => {
        if (node.type === "folder") {
          const collapsed = collapseFolderChain(node);
          folderPaths.add(collapsed.path);
          return {
            name: collapsed.label,
            path: collapsed.path,
            type: "folder" as const,
            children: toArray(collapsed.node.children),
            isLazyLoadable: collapsed.node.isLazyLoadable,
            childState: collapsed.node.childState,
            hasMore: collapsed.node.hasMore,
          };
        }
        return {
          name: node.name,
          path: node.path,
          type: "file" as const,
          children: [],
        };
      });
    return nodes;
  };

  return { nodes: toArray(root), folderPaths };
}

const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "bmp",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

function isImagePath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return imageExtensions.has(ext);
}

function resolveWorkspaceRootLabel(workspacePath: string, workspaceName?: string) {
  const fromName = workspaceName?.trim();
  if (fromName) {
    return fromName;
  }
  const normalizedPath = workspacePath.replace(/[\\/]+$/, "");
  const segments = normalizedPath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || normalizedPath || "workspace";
}

function isWindowsDragPreviewRuntime() {
  if (typeof navigator === "undefined") {
    return false;
  }
  const platform = (
    (
      navigator as Navigator & {
        userAgentData?: { platform?: string };
      }
    ).userAgentData?.platform ??
    navigator.platform ??
    ""
  ).toLowerCase();
  return platform.includes("win");
}

function getDragPreviewLeafLabel(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || path;
}

function createWindowsFileTreeDragImage(
  primaryPath: string,
  totalCount: number,
  isFolder: boolean,
) {
  if (typeof document === "undefined") {
    return null;
  }
  const dragImage = document.createElement("div");
  dragImage.setAttribute("aria-hidden", "true");
  dragImage.style.position = "fixed";
  dragImage.style.top = "-9999px";
  dragImage.style.left = "-9999px";
  dragImage.style.pointerEvents = "none";
  dragImage.style.display = "inline-flex";
  dragImage.style.alignItems = "center";
  dragImage.style.gap = "8px";
  dragImage.style.maxWidth = "420px";
  dragImage.style.padding = "8px 12px";
  dragImage.style.borderRadius = "12px";
  dragImage.style.border = "1px solid rgba(37, 99, 235, 0.26)";
  dragImage.style.background = "rgba(23, 27, 36, 0.94)";
  dragImage.style.boxShadow = "0 10px 30px rgba(15, 23, 42, 0.34)";
  dragImage.style.color = "#e5eefc";
  dragImage.style.fontSize = "12px";
  dragImage.style.fontWeight = "600";
  dragImage.style.lineHeight = "1.2";
  dragImage.style.fontFamily =
    '"SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  const icon = document.createElement("span");
  icon.textContent = isFolder ? "[DIR]" : "[FILE]";
  icon.style.fontSize = "11px";
  icon.style.flexShrink = "0";
  icon.style.color = "#93c5fd";

  const text = document.createElement("span");
  const primaryLabel = getDragPreviewLeafLabel(primaryPath);
  text.textContent =
    totalCount > 1 ? `${primaryLabel} +${totalCount - 1}` : primaryLabel;
  text.style.whiteSpace = "nowrap";
  text.style.overflow = "hidden";
  text.style.textOverflow = "ellipsis";
  text.style.maxWidth = "340px";

  dragImage.append(icon, text);
  document.body.appendChild(dragImage);

  return {
    element: dragImage,
    cleanup: () => {
      dragImage.remove();
    },
  };
}

export function FileTreePanel({
  workspaceId,
  workspaceName,
  workspacePath,
  gitRoot = null,
  files,
  directories,
  directoryMetadata = EMPTY_DIRECTORY_METADATA,
  isLoading,
  loadError = null,
  filePanelMode: _filePanelMode,
  onFilePanelModeChange: _onFilePanelModeChange,
  onInsertText,
  onOpenFile,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  onToggleRuntimeConsole: _onToggleRuntimeConsole,
  isRuntimeConsoleVisible: _isRuntimeConsoleVisible = false,
  onOpenSpecHub,
  isSpecHubActive = false,
  onOpenDetachedExplorer,
  showSpecHubAction = true,
  showDetachedExplorerAction = true,
  crossWindowDragTargetLabel = null,
  gitStatusFiles,
  gitignoredFiles,
  gitignoredDirectories,
  onRefreshFiles,
}: FileTreePanelProps) {
  const directoryEntries = directories ?? EMPTY_DIRECTORIES;
  const ignoredFileEntries = gitignoredFiles ?? EMPTY_SET;
  const ignoredDirectoryEntries = gitignoredDirectories ?? EMPTY_SET;
  const { t } = useTranslation();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [rootExpanded, setRootExpanded] = useState(true);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<{
    top: number;
    left: number;
    arrowTop: number;
    height: number;
  } | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewSelection, setPreviewSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const dragAnchorLineRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<"file" | "folder" | null>(null);
  const [selectedNodePaths, setSelectedNodePaths] = useState<Set<string>>(new Set());
  const [fileTreeContextMenu, setFileTreeContextMenu] =
    useState<RendererContextMenuState | null>(null);
  const selectionAnchorPathRef = useRef<string | null>(null);
  const activeCrossWindowDragPathsRef = useRef<string[]>([]);
  const lastCrossWindowDragBroadcastRef = useRef(0);
  const dragImageCleanupRef = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [newFileParent, setNewFileParent] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const newFileInputRef = useRef<HTMLInputElement | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [lazyFiles, setLazyFiles] = useState<Set<string>>(new Set());
  const [lazyDirectories, setLazyDirectories] = useState<Set<string>>(new Set());
  const [lazyGitignoredFiles, setLazyGitignoredFiles] = useState<Set<string>>(new Set());
  const [lazyGitignoredDirectories, setLazyGitignoredDirectories] = useState<Set<string>>(new Set());
  const [lazyLoadableDirectories, setLazyLoadableDirectories] = useState<Set<string>>(new Set());
  const [lazyDirectoryMetadata, setLazyDirectoryMetadata] = useState<Map<string, WorkspaceDirectoryEntry>>(
    new Map(),
  );
  const [loadedLazyDirectories, setLoadedLazyDirectories] = useState<Set<string>>(new Set());
  const [loadingLazyDirectories, setLoadingLazyDirectories] = useState<Set<string>>(new Set());
  const [lazyDirectoryLoadErrors, setLazyDirectoryLoadErrors] = useState<Map<string, string>>(
    new Map(),
  );
  const loadedLazyDirectoriesRef = useRef<Set<string>>(new Set());
  const loadingLazyDirectoriesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      dragImageCleanupRef.current?.();
      dragImageCleanupRef.current = null;
    };
  }, []);

  const workspaceRootLabel = useMemo(
    () => resolveWorkspaceRootLabel(workspacePath, workspaceName),
    [workspaceName, workspacePath],
  );
  const gitRootWorkspacePrefix = useMemo(
    () => resolveGitRootWorkspacePrefix(workspacePath, gitRoot),
    [gitRoot, workspacePath],
  );
  const previewKind = useMemo(
    () => (previewPath && isImagePath(previewPath) ? "image" : "text"),
    [previewPath],
  );
  const mergedFiles = useMemo(() => {
    const next = new Set<string>(files);
    lazyFiles.forEach((path) => next.add(path));
    return Array.from(next);
  }, [files, lazyFiles]);
  const mergedDirectories = useMemo(() => {
    const next = new Set<string>(directoryEntries);
    lazyDirectories.forEach((path) => next.add(path));
    return Array.from(next);
  }, [directoryEntries, lazyDirectories]);
  const mergedGitignoredFiles = useMemo(() => {
    const next = new Set<string>(ignoredFileEntries);
    lazyGitignoredFiles.forEach((path) => next.add(path));
    return next;
  }, [ignoredFileEntries, lazyGitignoredFiles]);
  const mergedGitignoredDirectories = useMemo(() => {
    const next = new Set<string>(ignoredDirectoryEntries);
    lazyGitignoredDirectories.forEach((path) => next.add(path));
    return next;
  }, [ignoredDirectoryEntries, lazyGitignoredDirectories]);
  const directoryMetadataByPath = useMemo(() => {
    const next = new Map<string, WorkspaceDirectoryEntry>();
    directoryMetadata.forEach((entry) => {
      if (entry.path) {
        next.set(entry.path, entry);
      }
    });
    lazyDirectoryMetadata.forEach((entry, path) => {
      next.set(path, entry);
    });
    return next;
  }, [directoryMetadata, lazyDirectoryMetadata]);
  const seededLazyLoadableDirectories = useMemo(() => {
    const result = new Set<string>();
    mergedDirectories.forEach((path) => {
      if (isSpecialDirectoryPath(path)) {
        result.add(path);
      }
      const childState = directoryMetadataByPath.get(path)?.child_state;
      if (childState === "unknown" || childState === "partial") {
        result.add(path);
      }
    });
    return result;
  }, [directoryMetadataByPath, mergedDirectories]);
  const effectiveLazyLoadableDirectories = useMemo(() => {
    const result = new Set(seededLazyLoadableDirectories);
    lazyLoadableDirectories.forEach((path) => result.add(path));
    return result;
  }, [seededLazyLoadableDirectories, lazyLoadableDirectories]);
  const hasTreeEntries = mergedFiles.length > 0 || mergedDirectories.length > 0;
  const showLoading = isLoading && !hasTreeEntries;
  const normalizedLoadError =
    typeof loadError === "string" && loadError.trim().length > 0 ? loadError.trim() : null;

  const gitStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    if (gitStatusFiles) {
      for (const entry of gitStatusFiles) {
        const entryPath = entry.path?.trim();
        const entryStatus = entry.status?.trim();
        if (!entryPath || !entryStatus) {
          continue;
        }
        resolveGitStatusPathCandidates(
          workspacePath,
          gitRootWorkspacePrefix,
          entryPath,
        ).forEach((path) => map.set(path, entryStatus));
      }
    }
    return map;
  }, [gitRootWorkspacePrefix, gitStatusFiles, workspacePath]);

  const { nodes, folderPaths } = useMemo(
    () => buildTree(
      mergedFiles,
      mergedDirectories,
      effectiveLazyLoadableDirectories,
      directoryMetadataByPath,
    ),
    [
      effectiveLazyLoadableDirectories,
      directoryMetadataByPath,
      mergedDirectories,
      mergedFiles,
    ],
  );
  const folderGitStatusMap = useMemo(() => {
    if (!gitStatusFiles || gitStatusFiles.length === 0) {
      return new Map<string, string>();
    }
    const priority: Record<string, number> = { D: 4, A: 3, M: 2, R: 1, T: 0 };
    const map = new Map<string, string>();
    const assignIfHigherPriority = (folderPath: string, status: string) => {
      const nextStatus = status.trim().toUpperCase();
      const nextPriority = priority[nextStatus];
      if (nextPriority === undefined) {
        return;
      }
      const current = map.get(folderPath);
      const currentPriority = current ? (priority[current] ?? -1) : -1;
      if (nextPriority > currentPriority) {
        map.set(folderPath, nextStatus);
      }
    };

    for (const entry of gitStatusFiles) {
      const entryPath = entry.path?.trim();
      const entryStatus = entry.status?.trim();
      if (!entryPath || !entryStatus) {
        continue;
      }
      const pathCandidates = resolveGitStatusPathCandidates(
        workspacePath,
        gitRootWorkspacePrefix,
        entryPath,
      );
      pathCandidates.forEach((candidatePath) => {
        const segments = candidatePath.split("/").filter(Boolean);
        if (segments.length <= 1) {
          return;
        }
        let folderPath = "";
        for (let index = 0; index < segments.length - 1; index += 1) {
          const segment = segments[index] ?? "";
          folderPath = folderPath
            ? `${folderPath}/${segment}`
            : segment;
          assignIfHigherPriority(folderPath, entryStatus);
        }
      });
    }

    return map;
  }, [gitRootWorkspacePrefix, gitStatusFiles, workspacePath]);

  const visibleTreeNodeEntries = useMemo(() => {
    const entries: VisibleTreeNodeEntry[] = [{ path: "", type: "root" }];
    const visit = (node: FileTreeNode) => {
      entries.push({ path: node.path, type: node.type });
      if (node.type === "folder" && expandedFolders.has(node.path)) {
        node.children.forEach(visit);
      }
    };
    if (rootExpanded) {
      nodes.forEach(visit);
    }
    return entries;
  }, [expandedFolders, nodes, rootExpanded]);
  const visibleTreePathOrder = useMemo(
    () => visibleTreeNodeEntries.map((entry) => entry.path),
    [visibleTreeNodeEntries],
  );
  const visibleTreePathTypeMap = useMemo(
    () =>
      new Map<string, "file" | "folder" | "root">(
        visibleTreeNodeEntries.map((entry) => [entry.path, entry.type]),
      ),
    [visibleTreeNodeEntries],
  );
  const allTreeNodePaths = useMemo(() => {
    const result = new Set<string>([""]);
    const visit = (node: FileTreeNode) => {
      result.add(node.path);
      if (node.type === "folder") {
        node.children.forEach(visit);
      }
    };
    nodes.forEach(visit);
    return result;
  }, [nodes]);

  const setSingleSelection = useCallback((path: string, type: "file" | "folder" | "root") => {
    setSelectedNodePaths(new Set([path]));
    setSelectedNodePath(path);
    setSelectedNodeType(type === "root" ? "folder" : type);
    selectionAnchorPathRef.current = path;
  }, []);

  const setRangeSelection = useCallback(
    (targetPath: string, targetType: "file" | "folder" | "root") => {
      const anchorPath = selectionAnchorPathRef.current ?? selectedNodePath ?? targetPath;
      const anchorIndex = visibleTreePathOrder.indexOf(anchorPath);
      const targetIndex = visibleTreePathOrder.indexOf(targetPath);
      if (anchorIndex < 0 || targetIndex < 0) {
        setSingleSelection(targetPath, targetType);
        return;
      }
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const rangePaths = visibleTreePathOrder.slice(start, end + 1);
      setSelectedNodePaths(new Set(rangePaths));
      setSelectedNodePath(targetPath);
      setSelectedNodeType(targetType === "root" ? "folder" : targetType);
    },
    [selectedNodePath, setSingleSelection, visibleTreePathOrder],
  );

  const togglePathSelection = useCallback((path: string, type: "file" | "folder" | "root") => {
    setSelectedNodePaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      const fallbackPath = next.has(path)
        ? path
        : visibleTreePathOrder.find((entryPath) => next.has(entryPath)) ?? null;
      setSelectedNodePath(fallbackPath);
      setSelectedNodeType(
        fallbackPath ? ((visibleTreePathTypeMap.get(fallbackPath) ?? type) === "root" ? "folder" : (visibleTreePathTypeMap.get(fallbackPath) ?? type) as "file" | "folder") : null,
      );
      selectionAnchorPathRef.current = path;
      return next;
    });
  }, [visibleTreePathOrder, visibleTreePathTypeMap]);

  useEffect(() => {
    setExpandedFolders((prev) => {
      // Keep only folders that still exist; default is all collapsed.
      const next = new Set<string>();
      prev.forEach((path) => {
        if (folderPaths.has(path)) {
          next.add(path);
        }
      });
      if (next.size === prev.size && [...next].every((path) => prev.has(path))) {
        return prev;
      }
      return next;
    });
  }, [folderPaths]);

  useEffect(() => {
    setSelectedNodePaths((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      let changed = false;
      const next = new Set<string>();
      prev.forEach((path) => {
        if (allTreeNodePaths.has(path)) {
          next.add(path);
        } else {
          changed = true;
        }
      });
      if (!changed) {
        return prev;
      }
      const nextPrimaryPath =
        selectedNodePath && next.has(selectedNodePath)
          ? selectedNodePath
          : visibleTreePathOrder.find((path) => next.has(path)) ?? null;
      setSelectedNodePath(nextPrimaryPath);
      setSelectedNodeType(
        nextPrimaryPath
          ? (visibleTreePathTypeMap.get(nextPrimaryPath) === "file" ? "file" : "folder")
          : null,
      );
      if (selectionAnchorPathRef.current && !next.has(selectionAnchorPathRef.current)) {
        selectionAnchorPathRef.current = nextPrimaryPath;
      }
      return next;
    });
  }, [allTreeNodePaths, selectedNodePath, visibleTreePathOrder, visibleTreePathTypeMap]);

  useEffect(() => {
    loadedLazyDirectoriesRef.current = loadedLazyDirectories;
  }, [loadedLazyDirectories]);

  useEffect(() => {
    loadingLazyDirectoriesRef.current = loadingLazyDirectories;
  }, [loadingLazyDirectories]);

  useEffect(() => {
    setPreviewPath(null);
    setPreviewAnchor(null);
    setPreviewSelection(null);
    setPreviewContent("");
    setPreviewTruncated(false);
    setPreviewError(null);
    setPreviewLoading(false);
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
    dragMovedRef.current = false;
    setLazyFiles(new Set());
    setLazyDirectories(new Set());
    setLazyGitignoredFiles(new Set());
    setLazyGitignoredDirectories(new Set());
    setLazyLoadableDirectories(new Set());
    setLazyDirectoryMetadata(new Map());
    setLoadedLazyDirectories(new Set());
    setLoadingLazyDirectories(new Set());
    setLazyDirectoryLoadErrors(new Map());
    setNewFileParent(null);
    setNewFileName("");
    setNewFolderParent(null);
    setNewFolderName("");
    setRootExpanded(true);
    setSelectedNodePath(null);
    setSelectedNodeType(null);
    setSelectedNodePaths(new Set());
    selectionAnchorPathRef.current = null;
    loadedLazyDirectoriesRef.current = new Set();
    loadingLazyDirectoriesRef.current = new Set();
  }, [workspaceId]);

  const closePreview = useCallback(() => {
    setPreviewPath(null);
    setPreviewAnchor(null);
    setPreviewSelection(null);
    setPreviewContent("");
    setPreviewTruncated(false);
    setPreviewError(null);
    setPreviewLoading(false);
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
    dragMovedRef.current = false;
  }, []);

  const loadLazyDirectoryChildren = useCallback(
    async (path: string) => {
      if (
        loadedLazyDirectoriesRef.current.has(path) ||
        loadingLazyDirectoriesRef.current.has(path)
      ) {
        return;
      }
      loadingLazyDirectoriesRef.current = new Set(loadingLazyDirectoriesRef.current).add(path);
      setLoadingLazyDirectories((prev) => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      setLazyDirectoryLoadErrors((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      try {
        const response = await getWorkspaceDirectoryChildren(workspaceId, path);
        const nextFiles = Array.isArray(response.files) ? response.files : [];
        const nextDirectories = Array.isArray(response.directories) ? response.directories : [];
        const nextGitignoredFiles = Array.isArray(response.gitignored_files)
          ? response.gitignored_files
          : [];
        const nextGitignoredDirectories = Array.isArray(response.gitignored_directories)
          ? response.gitignored_directories
          : [];
        const nextDirectoryMetadata = Array.isArray(response.directory_entries)
          ? response.directory_entries.filter((entry): entry is WorkspaceDirectoryEntry =>
              Boolean(entry && typeof entry.path === "string" && typeof entry.child_state === "string"),
            )
          : [];

        setLazyFiles((prev) => {
          const next = new Set(prev);
          nextFiles.forEach((entry) => next.add(entry));
          return next;
        });
        setLazyDirectories((prev) => {
          const next = new Set(prev);
          nextDirectories.forEach((entry) => next.add(entry));
          return next;
        });
        setLazyLoadableDirectories((prev) => {
          const next = new Set(prev);
          nextDirectories.forEach((entry) => next.add(entry));
          nextDirectoryMetadata.forEach((entry) => {
            if (entry.child_state === "unknown" || entry.child_state === "partial") {
              next.add(entry.path);
            }
            if (entry.child_state === "empty" || entry.child_state === "loaded") {
              next.delete(entry.path);
            }
          });
          return next;
        });
        setLazyDirectoryMetadata((prev) => {
          const next = new Map(prev);
          if (nextDirectoryMetadata.length === 0) {
            const childState = nextFiles.length === 0 && nextDirectories.length === 0
              ? "empty"
              : "loaded";
            next.set(path, { path, child_state: childState });
          } else {
            nextDirectoryMetadata.forEach((entry) => next.set(entry.path, entry));
          }
          return next;
        });
        setLazyGitignoredFiles((prev) => {
          const next = new Set(prev);
          nextGitignoredFiles.forEach((entry) => next.add(entry));
          return next;
        });
        setLazyGitignoredDirectories((prev) => {
          const next = new Set(prev);
          nextGitignoredDirectories.forEach((entry) => next.add(entry));
          return next;
        });
        loadedLazyDirectoriesRef.current = new Set(loadedLazyDirectoriesRef.current).add(path);
        setLoadedLazyDirectories((prev) => {
          const next = new Set(prev);
          next.add(path);
          return next;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLazyDirectoryLoadErrors((prev) => {
          const next = new Map(prev);
          next.set(path, message);
          return next;
        });
      } finally {
        const nextLoadingDirectories = new Set(loadingLazyDirectoriesRef.current);
        nextLoadingDirectories.delete(path);
        loadingLazyDirectoriesRef.current = nextLoadingDirectories;
        setLoadingLazyDirectories((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!previewPath) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewPath, closePreview]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleFolderExpandedState = useCallback(
    (path: string, isLazyFolder: boolean) => {
      const shouldExpand = !expandedFolders.has(path);
      toggleFolder(path);
      if (shouldExpand && isLazyFolder) {
        void loadLazyDirectoryChildren(path);
      }
    },
    [expandedFolders, loadLazyDirectoryChildren],
  );

  const resolvePath = useCallback(
    (relativePath: string) => {
      const usesWindowsSeparator = workspacePath.includes("\\");
      const separator = usesWindowsSeparator ? "\\" : "/";
      const base = workspacePath.replace(/[\\/]+$/, "");
      const normalizedRelative = usesWindowsSeparator
        ? relativePath.replaceAll("/", "\\")
        : relativePath;
      return `${base}${separator}${normalizedRelative}`;
    },
    [workspacePath],
  );

  const previewImageSrc = useMemo(() => {
    if (!previewPath || previewKind !== "image") {
      return null;
    }
    try {
      return convertFileSrc(resolvePath(previewPath));
    } catch {
      return null;
    }
  }, [previewPath, previewKind, resolvePath]);

  const openPreview = useCallback((path: string, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const estimatedWidth = 640;
    const estimatedHeight = 520;
    const padding = 16;
    const maxHeight = Math.min(estimatedHeight, window.innerHeight - padding * 2);
    const left = Math.min(
      Math.max(padding, rect.left - estimatedWidth - padding),
      Math.max(padding, window.innerWidth - estimatedWidth - padding),
    );
    const top = Math.min(
      Math.max(padding, rect.top - maxHeight * 0.35),
      Math.max(padding, window.innerHeight - maxHeight - padding),
    );
    const arrowTop = Math.min(
      Math.max(16, rect.top + rect.height / 2 - top),
      Math.max(16, maxHeight - 16),
    );
    setPreviewPath(path);
    setPreviewAnchor({ top, left, arrowTop, height: maxHeight });
    setPreviewSelection(null);
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
    dragMovedRef.current = false;
  }, []);

  useEffect(() => {
    if (!previewPath) {
      return;
    }
    let cancelled = false;
    if (previewKind === "image") {
      setPreviewContent("");
      setPreviewTruncated(false);
      setPreviewError(null);
      setPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setPreviewLoading(true);
    setPreviewError(null);
    readWorkspaceFile(workspaceId, previewPath)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPreviewContent(response.content ?? "");
        setPreviewTruncated(Boolean(response.truncated));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setPreviewError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewKind, previewPath, workspaceId]);

  useEffect(() => {
    if (!isDragSelecting) {
      return;
    }
    const handleMouseUp = () => {
      setIsDragSelecting(false);
      dragAnchorLineRef.current = null;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [isDragSelecting]);

  const selectRangeFromAnchor = useCallback((anchor: number, index: number) => {
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);
    setPreviewSelection({ start, end });
  }, []);

  const handleSelectLine = useCallback(
    (index: number, event: MouseEvent<HTMLButtonElement>) => {
      if (dragMovedRef.current) {
        dragMovedRef.current = false;
        return;
      }
      if (event.shiftKey && previewSelection) {
        const anchor = previewSelection.start;
        selectRangeFromAnchor(anchor, index);
        return;
      }
      setPreviewSelection({ start: index, end: index });
    },
    [previewSelection, selectRangeFromAnchor],
  );

  const handleLineMouseDown = useCallback(
    (index: number, event: MouseEvent<HTMLButtonElement>) => {
      if (previewKind !== "text" || event.button !== 0) {
        return;
      }
      event.preventDefault();
      setIsDragSelecting(true);
      const anchor =
        event.shiftKey && previewSelection ? previewSelection.start : index;
      dragAnchorLineRef.current = anchor;
      dragMovedRef.current = false;
      selectRangeFromAnchor(anchor, index);
    },
    [previewKind, previewSelection, selectRangeFromAnchor],
  );

  const handleLineMouseEnter = useCallback(
    (index: number, _event: MouseEvent<HTMLButtonElement>) => {
      if (!isDragSelecting) {
        return;
      }
      const anchor = dragAnchorLineRef.current;
      if (anchor === null) {
        return;
      }
      if (anchor !== index) {
        dragMovedRef.current = true;
      }
      selectRangeFromAnchor(anchor, index);
    },
    [isDragSelecting, selectRangeFromAnchor],
  );

  const handleLineMouseUp = useCallback(() => {
    if (!isDragSelecting) {
      return;
    }
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
  }, [isDragSelecting]);

  const selectionHints = useMemo(
    () =>
      previewKind === "text"
        ? [t("files.selectionHintShiftClick"), t("files.selectionHintMultiLine")]
        : [],
    [previewKind, t],
  );

  const handleAddSelection = useCallback(() => {
    if (previewKind !== "text" || !previewPath || !previewSelection || !onInsertText) {
      return;
    }
    const lines = previewContent.split("\n");
    const selected = lines.slice(previewSelection.start, previewSelection.end + 1);
    const language = languageFromPath(previewPath);
    const fence = language ? `\`\`\`${language}` : "```";
    const start = previewSelection.start + 1;
    const end = previewSelection.end + 1;
    const rangeLabel = start === end ? `L${start}` : `L${start}-L${end}`;
    const snippet = `${previewPath}:${rangeLabel}\n${fence}\n${selected.join("\n")}\n\`\`\``;
    onInsertText(snippet);
    closePreview();
  }, [
    previewContent,
    previewKind,
    previewPath,
    previewSelection,
    onInsertText,
    closePreview,
  ]);

  const copyPath = useCallback(
    async (relativePath: string) => {
      try {
        await navigator.clipboard.writeText(resolvePath(relativePath));
      } catch {
        // clipboard write is not critical
      }
    },
    [resolvePath],
  );

  const trashItem = useCallback(
    async (relativePath: string, isFolder: boolean) => {
      const name = relativePath.split("/").pop() ?? relativePath;
      const confirmMessage = isFolder
        ? t("files.deleteFolderConfirm", { name })
        : t("files.deleteFileConfirm", { name });

      const confirmed = await confirm(confirmMessage, {
        title: t("files.deleteItem"),
        kind: "warning",
        okLabel: t("files.deleteItem"),
        cancelLabel: t("files.cancel"),
      });

      if (!confirmed) {
        return;
      }

      try {
        await trashWorkspaceItem(workspaceId, relativePath);
        setSelectedNodePaths((prev) => {
          if (!prev.has(relativePath)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(relativePath);
          const nextPrimaryPath = next.size > 0
            ? visibleTreePathOrder.find((path) => next.has(path)) ?? null
            : null;
          setSelectedNodePath(nextPrimaryPath);
          setSelectedNodeType(
            nextPrimaryPath
              ? (visibleTreePathTypeMap.get(nextPrimaryPath) === "file" ? "file" : "folder")
              : null,
          );
          if (selectionAnchorPathRef.current === relativePath) {
            selectionAnchorPathRef.current = nextPrimaryPath;
          }
          return next;
        });
        onRefreshFiles?.();
      } catch {
        // trash operation failed
      }
    },
    [onRefreshFiles, t, visibleTreePathOrder, visibleTreePathTypeMap, workspaceId],
  );

  const duplicateItem = useCallback(
    async (relativePath: string) => {
      try {
        await copyWorkspaceItem(workspaceId, relativePath);
        onRefreshFiles?.();
      } catch {
        // copy operation failed
      }
    },
    [workspaceId, onRefreshFiles],
  );

  const openNewFilePrompt = useCallback(
    (parentFolder: string) => {
      setNewFileParent(parentFolder);
      setNewFileName("");
      requestAnimationFrame(() => {
        newFileInputRef.current?.focus();
      });
    },
    [],
  );

  const confirmNewFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name || newFileParent === null) {
      setNewFileParent(null);
      setNewFileName("");
      return;
    }
    const relativePath = newFileParent ? `${newFileParent}/${name}` : name;
    try {
      await writeWorkspaceFile(workspaceId, relativePath, "");
      onRefreshFiles?.();
    } catch {
      // create file failed
    }
    setNewFileParent(null);
    setNewFileName("");
  }, [newFileName, newFileParent, workspaceId, onRefreshFiles]);

  const cancelNewFile = useCallback(() => {
    setNewFileParent(null);
    setNewFileName("");
  }, []);

  const openNewFolderPrompt = useCallback(
    (parentFolder: string) => {
      setNewFolderParent(parentFolder);
      setNewFolderName("");
      requestAnimationFrame(() => {
        newFolderInputRef.current?.focus();
      });
    },
    [],
  );

  const confirmNewFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || newFolderParent === null) {
      setNewFolderParent(null);
      setNewFolderName("");
      return;
    }
    const relativePath = newFolderParent ? `${newFolderParent}/${name}` : name;
    try {
      await createWorkspaceDirectory(workspaceId, relativePath);
      onRefreshFiles?.();
    } catch {
      // create folder failed
    }
    setNewFolderParent(null);
    setNewFolderName("");
  }, [newFolderName, newFolderParent, workspaceId, onRefreshFiles]);

  const cancelNewFolder = useCallback(() => {
    setNewFolderParent(null);
    setNewFolderName("");
  }, []);

  const resolveParentFolderForNode = useCallback(
    (relativePath: string | null, nodeType: "file" | "folder" | null) => {
      if (!relativePath) {
        return "";
      }
      if (nodeType === "folder") {
        return relativePath;
      }
      const separatorIndex = relativePath.lastIndexOf("/");
      return separatorIndex >= 0 ? relativePath.slice(0, separatorIndex) : "";
    },
    [],
  );

  const selectedParentFolder = useMemo(
    () => resolveParentFolderForNode(selectedNodePath, selectedNodeType),
    [resolveParentFolderForNode, selectedNodePath, selectedNodeType],
  );
  const detachedInitialFilePath = selectedNodeType === "file" ? selectedNodePath : null;
  const orderedSelectedNodePaths = useMemo(
    () =>
      visibleTreePathOrder.filter((path) => path.length > 0 && selectedNodePaths.has(path)),
    [selectedNodePaths, visibleTreePathOrder],
  );
  const broadcastCrossWindowTreeDrag = useCallback(
    (payload: DetachedFileTreeDragBridgePayload) => {
      if (!crossWindowDragTargetLabel) {
        return;
      }
      if (payload.type === "start") {
        writeDetachedFileTreeDragSnapshot(payload.paths);
      }
      void emitTo(
        crossWindowDragTargetLabel,
        DETACHED_FILE_TREE_DRAG_BRIDGE_EVENT,
        payload,
      ).catch(() => {});
    },
    [crossWindowDragTargetLabel],
  );
  const rebroadcastCrossWindowTreeDrag = useCallback(() => {
    if (!crossWindowDragTargetLabel) {
      return;
    }
    const paths = activeCrossWindowDragPathsRef.current;
    if (paths.length === 0) {
      return;
    }
    const now = Date.now();
    if (
      now - lastCrossWindowDragBroadcastRef.current <
      CROSS_WINDOW_TREE_DRAG_REBROADCAST_THROTTLE_MS
    ) {
      return;
    }
    lastCrossWindowDragBroadcastRef.current = now;
    broadcastCrossWindowTreeDrag({
      type: "start",
      paths,
    });
  }, [broadcastCrossWindowTreeDrag, crossWindowDragTargetLabel]);
  const canTrashSelectedNode =
    selectedNodeType !== null && selectedNodePath !== null && selectedNodePath.length > 0;

  const showContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, relativePath: string, isFolder: boolean) => {
      event.preventDefault();
      event.stopPropagation();

      const parentFolder = resolveParentFolderForNode(relativePath, isFolder ? "folder" : "file");

      const menuItems: RendererContextMenuItem[] = [
        {
          type: "item",
          id: "new-file",
          label: t("files.newFile"),
          onSelect: () => {
            setFileTreeContextMenu(null);
            openNewFilePrompt(parentFolder);
          },
        },
        {
          type: "item",
          id: "new-folder",
          label: t("files.newFolder"),
          onSelect: () => {
            setFileTreeContextMenu(null);
            openNewFolderPrompt(parentFolder);
          },
        },
        {
          type: "item",
          id: "duplicate",
          label: t("files.duplicateItem"),
          onSelect: async () => {
            await duplicateItem(relativePath);
          },
        },
        {
          type: "item",
          id: "copy-path",
          label: t("files.copyPath"),
          onSelect: async () => {
            await copyPath(relativePath);
          },
        },
        {
          type: "item",
          id: "reveal",
          label: t("files.revealInFinder"),
          onSelect: async () => {
            await revealItemInDir(resolvePath(relativePath));
          },
        },
        ...(onInsertText && !isFolder
          ? [
              {
                type: "item" as const,
                id: "insert-lsp-diagnostics",
                label: t("files.insertLspDiagnostics"),
                onSelect: () => {
                  onInsertText(`/lsp diagnostics "${relativePath}"`);
                },
              },
              {
                type: "item" as const,
                id: "insert-lsp-document-symbols",
                label: t("files.insertLspDocumentSymbols"),
                onSelect: () => {
                  onInsertText(`/lsp document-symbols "${relativePath}"`);
                },
              },
            ]
          : []),
        {
          type: "item",
          id: "delete",
          label: t("files.deleteItem"),
          tone: "danger",
          onSelect: async () => {
            setFileTreeContextMenu(null);
            await trashItem(relativePath, isFolder);
          },
        },
      ];

      const position = clampRendererContextMenuPosition(event.clientX, event.clientY);
      setFileTreeContextMenu({
        ...position,
        label: t("files.fileActions"),
        items: menuItems,
      });
    },
    [
      resolvePath,
      copyPath,
      trashItem,
      duplicateItem,
      onInsertText,
      openNewFilePrompt,
      openNewFolderPrompt,
      resolveParentFolderForNode,
      t,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedNodePath || !selectedNodeType) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }
      // Ensure the event originates within the file tree panel
      if (panelRef.current && !panelRef.current.contains(target)) {
        return;
      }

      const isMac = navigator.platform.includes("Mac");
      const primaryModifier = isMac ? event.metaKey : event.ctrlKey;

      // Cmd+Delete / Ctrl+Delete → trash
      if (primaryModifier && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        void trashItem(selectedNodePath, selectedNodeType === "folder");
        return;
      }

      // Cmd+C / Ctrl+C → copy path
      if (primaryModifier && !event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyPath(selectedNodePath);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodePath, selectedNodeType, trashItem, copyPath]);

  const handleRootContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!selectedNodePaths.has("")) {
        setSingleSelection("", "root");
      } else {
        setSelectedNodePath("");
        setSelectedNodeType("folder");
      }
      showContextMenu(event, "", true);
    },
    [selectedNodePaths, setSingleSelection, showContextMenu],
  );

  const handleTreeItemClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, item: CossFileTreeItemData) => {
      if (item.type === "root") {
        return;
      }
      const nodeType = item.type === "folder" ? "folder" : "file";
      const isToggleSelect = event.metaKey || event.ctrlKey;
      if (event.shiftKey) {
        setRangeSelection(item.path, nodeType);
        return;
      }
      if (isToggleSelect) {
        togglePathSelection(item.path, nodeType);
        return;
      }
      setSingleSelection(item.path, nodeType);
      if (item.type === "folder") {
        const canExpand = item.children.length > 0 || item.isLazyLoadable;
        if (canExpand) {
          toggleFolderExpandedState(item.path, item.isLazyLoadable);
        }
      }
    },
    [setRangeSelection, setSingleSelection, toggleFolderExpandedState, togglePathSelection],
  );

  const handleTreeItemToggle = useCallback(
    (item: CossFileTreeItemData) => {
      if (item.type !== "folder") {
        return;
      }
      const canExpand = item.children.length > 0 || item.isLazyLoadable;
      if (!canExpand) {
        return;
      }
      toggleFolderExpandedState(item.path, item.isLazyLoadable);
    },
    [toggleFolderExpandedState],
  );

  const handleTreeItemDoubleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, item: CossFileTreeItemData) => {
      event.preventDefault();
      if (item.type === "folder") {
        handleTreeItemToggle(item);
        return;
      }
      if (item.type !== "file") {
        return;
      }
      if (onOpenFile) {
        onOpenFile(item.path);
        return;
      }
      openPreview(item.path, event.currentTarget);
    },
    [handleTreeItemToggle, onOpenFile, openPreview],
  );

  const handleTreeItemContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, item: CossFileTreeItemData) => {
      if (item.type === "root") {
        return;
      }
      const nodeType = item.type === "folder" ? "folder" : "file";
      if (!selectedNodePaths.has(item.path)) {
        setSingleSelection(item.path, nodeType);
      } else {
        setSelectedNodePath(item.path);
        setSelectedNodeType(nodeType);
      }
      showContextMenu(event, item.path, item.type === "folder");
    },
    [selectedNodePaths, setSingleSelection, showContextMenu],
  );

  const handleTreeItemDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, item: CossFileTreeItemData) => {
      if (item.type === "root") {
        return;
      }
      const isSelected = selectedNodePaths.has(item.path);
      const dragSourcePaths = isSelected ? orderedSelectedNodePaths : [item.path];
      const uniqueSourcePaths = Array.from(new Set(dragSourcePaths));
      if (uniqueSourcePaths.length === 0) {
        return;
      }
      if (!isSelected) {
        setSingleSelection(item.path, item.type);
      }
      if (
        typeof window !== "undefined" &&
        (window.__fileTreeDragActive === true ||
          typeof window.__fileTreeDragCleanup === "function")
      ) {
        clearFileTreeDragBridge();
      }
      const absolutePaths = uniqueSourcePaths.map((path) => resolvePath(path));
      activeCrossWindowDragPathsRef.current = absolutePaths;
      lastCrossWindowDragBroadcastRef.current = Date.now();
      dragImageCleanupRef.current?.();
      dragImageCleanupRef.current = null;
      setFileTreeDragBridge(absolutePaths);
      window.__fileTreeDragCleanup = bindChatDropTargetsForTreeDrag(absolutePaths);
      setFileTreeDragPosition(event.clientX, event.clientY);
      broadcastCrossWindowTreeDrag({
        type: "start",
        paths: absolutePaths,
      });
      const encodedPaths = JSON.stringify(absolutePaths);
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-ccgui-file-paths", encodedPaths);
      event.dataTransfer.setData("text/plain", absolutePaths.join("\n"));
      if (
        isWindowsDragPreviewRuntime() &&
        typeof event.dataTransfer.setDragImage === "function"
      ) {
        const preview = createWindowsFileTreeDragImage(
          absolutePaths[0] ?? "",
          absolutePaths.length,
          item.type === "folder",
        );
        if (preview) {
          event.dataTransfer.setDragImage(preview.element, 18, 14);
          dragImageCleanupRef.current = preview.cleanup;
        }
      }
    },
    [
      broadcastCrossWindowTreeDrag,
      orderedSelectedNodePaths,
      resolvePath,
      selectedNodePaths,
      setSingleSelection,
    ],
  );

  const handleTreeItemDrag = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      setFileTreeDragPosition(event.clientX, event.clientY);
      rebroadcastCrossWindowTreeDrag();
    },
    [rebroadcastCrossWindowTreeDrag],
  );

  const handleTreeItemDragEnd = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      activeCrossWindowDragPathsRef.current = [];
      lastCrossWindowDragBroadcastRef.current = 0;
      dragImageCleanupRef.current?.();
      dragImageCleanupRef.current = null;
      if (typeof window !== "undefined" && window.__fileTreeDragDropped === true) {
        clearFileTreeDragBridge();
        return;
      }
      const inserted = triggerChatInputInsertFromTreeDrag(
        event,
        window.__fileTreeDragPaths ?? [],
      );
      if (!inserted) {
        const fallbackPaths = window.__fileTreeDragPaths ?? [];
        const hasChatInput = Boolean(document.querySelector(".chat-input-box"));
        if (hasChatInput && fallbackPaths.length > 0) {
          // Fallback channel for runtimes where native HTML drag does not expose
          // stable dragover/drop coordinates across panes.
          insertPathsIntoChat(fallbackPaths);
        }
      }
      clearFileTreeDragBridge();
    },
    [],
  );

  const handleMentionTreeItem = useCallback(
    (item: CossFileTreeItemData) => {
      if (item.type === "root") {
        return;
      }
      const absolutePath = resolvePath(item.path);
      // Prefer ChatInputBox bridge so `+` follows the same render/update path
      // as native @ file-reference insertion.
      if (typeof window !== "undefined" && window.handleFilePathFromJava) {
        window.handleFilePathFromJava(absolutePath);
        return;
      }
      const mentionText = `@${absolutePath}${item.type === "file" ? " " : ""}`;
      onInsertText?.(mentionText);
    },
    [onInsertText, resolvePath],
  );

  return (
    <aside
      className="coss-file-tree-panel flex min-h-0 flex-1 flex-col overflow-hidden bg-background py-3 pl-4 pr-3 font-sans text-sm text-foreground [-webkit-app-region:no-drag]"
      ref={panelRef}
    >
      <CossFileTreeSurface
        nodes={nodes}
        workspaceRootLabel={workspaceRootLabel}
        rootExpanded={rootExpanded}
        expandedFolders={expandedFolders}
        selectedNodePaths={selectedNodePaths}
        selectedNodePath={selectedNodePath}
        loadingLazyDirectories={loadingLazyDirectories}
        lazyDirectoryLoadErrors={lazyDirectoryLoadErrors}
        gitStatusMap={gitStatusMap}
        folderGitStatusMap={folderGitStatusMap}
        gitignoredFiles={mergedGitignoredFiles}
        gitignoredDirectories={mergedGitignoredDirectories}
        showLoading={showLoading}
        hasTreeEntries={hasTreeEntries}
        normalizedLoadError={normalizedLoadError}
        showMentionActions={Boolean(onInsertText)}
        translate={t}
        onRootContextMenu={handleRootContextMenu}
        onItemClick={handleTreeItemClick}
        onItemDoubleClick={handleTreeItemDoubleClick}
        onItemToggle={handleTreeItemToggle}
        onItemContextMenu={handleTreeItemContextMenu}
        onItemDragStart={handleTreeItemDragStart}
        onItemDrag={handleTreeItemDrag}
        onItemDragEnd={handleTreeItemDragEnd}
        onMentionItem={handleMentionTreeItem}
        onRetryLazyDirectory={(path) => void loadLazyDirectoryChildren(path)}
        onRefreshFiles={onRefreshFiles}
        rootActions={
          <FileTreeRootActions
            canTrashSelectedNode={canTrashSelectedNode}
            isSpecHubActive={isSpecHubActive}
            selectedParentFolder={selectedParentFolder}
            onOpenDetachedExplorer={onOpenDetachedExplorer}
            detachedInitialFilePath={detachedInitialFilePath}
            onOpenNewFile={(parentFolder) => openNewFilePrompt(parentFolder ?? "")}
            onOpenNewFolder={(parentFolder) => openNewFolderPrompt(parentFolder ?? "")}
            onRefreshFiles={onRefreshFiles}
            onTrashSelected={() => {
              if (!canTrashSelectedNode || !selectedNodePath || !selectedNodeType) {
                return;
              }
              void trashItem(selectedNodePath, selectedNodeType === "folder");
            }}
            onOpenSpecHub={onOpenSpecHub}
            showSpecHubAction={showSpecHubAction}
            showDetachedExplorerAction={showDetachedExplorerAction}
          />
        }
      />
      {previewPath && previewAnchor
        ? createPortal(
            <FilePreviewPopover
              path={previewPath}
              absolutePath={resolvePath(previewPath)}
              content={previewContent}
              truncated={previewTruncated}
              previewKind={previewKind}
              imageSrc={previewImageSrc}
              openTargets={openTargets}
              openAppIconById={openAppIconById}
              selectedOpenAppId={selectedOpenAppId}
              onSelectOpenAppId={onSelectOpenAppId}
              selection={previewSelection}
              onSelectLine={handleSelectLine}
              onLineMouseDown={handleLineMouseDown}
              onLineMouseEnter={handleLineMouseEnter}
              onLineMouseUp={handleLineMouseUp}
              onClearSelection={() => setPreviewSelection(null)}
              onAddSelection={handleAddSelection}
              onClose={closePreview}
              selectionHints={selectionHints}
              style={{
                position: "fixed",
                top: previewAnchor.top,
                left: previewAnchor.left,
                width: 640,
                maxHeight: previewAnchor.height,
                ["--file-preview-arrow-top" as string]: `${previewAnchor.arrowTop}px`,
              }}
              isLoading={previewLoading}
              error={previewError}
            />,
            document.body,
          )
        : null}
      {fileTreeContextMenu ? (
        <RendererContextMenu
          menu={fileTreeContextMenu}
          onClose={() => setFileTreeContextMenu(null)}
          className="renderer-context-menu file-tree-context-menu"
        />
      ) : null}
      {newFileParent !== null && (
        <div className="new-file-prompt fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="new-file-prompt-backdrop absolute inset-0 bg-black/55 [backdrop-filter:blur(6px)]" onClick={cancelNewFile} />
          <div className="new-file-prompt-card relative w-[min(380px,calc(100vw-48px))] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] rounded-[14px] p-5 flex flex-col gap-[14px] shadow-[0_24px_48px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.04)_inset]">
            <div className="new-file-prompt-title text-[15px] font-semibold text-[var(--text-strong)] tracking-[-0.01em]">{t("files.newFile")}</div>
            {newFileParent && (
              <div className="new-file-prompt-path text-xs text-[var(--text-faint)] font-[var(--code-font-family)] overflow-hidden text-ellipsis whitespace-nowrap -mt-1.5">{newFileParent}/</div>
            )}
            <input
              id="new-file-name"
              ref={newFileInputRef}
              className="new-file-prompt-input w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card-muted)] text-[var(--text-strong)] py-[9px] px-3 text-[13px] font-[var(--code-font-family)] transition-[border-color,box-shadow] duration-150 ease-out"
              placeholder={t("files.newFileNamePlaceholder")}
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelNewFile();
                }
                if (e.key === "Enter" && newFileName.trim()) {
                  e.preventDefault();
                  void confirmNewFile();
                }
              }}
            />
            <div className="new-file-prompt-actions flex justify-end gap-2 mt-0.5">
              <button
                type="button"
                className="ghost py-1.5 px-3.5 rounded-lg text-[13px] font-medium"
                onClick={cancelNewFile}
              >
                {t("files.cancel")}
              </button>
              <button
                type="button"
                className="primary py-1.5 px-3.5 rounded-lg text-[13px] font-medium"
                disabled={!newFileName.trim()}
                onClick={() => void confirmNewFile()}
              >
                {t("files.newFile")}
              </button>
            </div>
          </div>
        </div>
      )}
      {newFolderParent !== null && (
        <div className="new-file-prompt fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="new-file-prompt-backdrop absolute inset-0 bg-black/55 [backdrop-filter:blur(6px)]" onClick={cancelNewFolder} />
          <div className="new-file-prompt-card relative w-[min(380px,calc(100vw-48px))] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] rounded-[14px] p-5 flex flex-col gap-[14px] shadow-[0_24px_48px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.04)_inset]">
            <div className="new-file-prompt-title text-[15px] font-semibold text-[var(--text-strong)] tracking-[-0.01em]">{t("files.newFolder")}</div>
            {newFolderParent && (
              <div className="new-file-prompt-path text-xs text-[var(--text-faint)] font-[var(--code-font-family)] overflow-hidden text-ellipsis whitespace-nowrap -mt-1.5">{newFolderParent}/</div>
            )}
            <input
              id="new-folder-name"
              ref={newFolderInputRef}
              className="new-file-prompt-input w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card-muted)] text-[var(--text-strong)] py-[9px] px-3 text-[13px] font-[var(--code-font-family)] transition-[border-color,box-shadow] duration-150 ease-out"
              placeholder={t("files.newFolderNamePlaceholder")}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelNewFolder();
                }
                if (e.key === "Enter" && newFolderName.trim()) {
                  e.preventDefault();
                  void confirmNewFolder();
                }
              }}
            />
            <div className="new-file-prompt-actions flex justify-end gap-2 mt-0.5">
              <button
                type="button"
                className="ghost py-1.5 px-3.5 rounded-lg text-[13px] font-medium"
                onClick={cancelNewFolder}
              >
                {t("files.cancel")}
              </button>
              <button
                type="button"
                className="primary py-1.5 px-3.5 rounded-lg text-[13px] font-medium"
                disabled={!newFolderName.trim()}
                onClick={() => void confirmNewFolder()}
              >
                {t("files.newFolder")}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
