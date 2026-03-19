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
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { confirm } from "@tauri-apps/plugin-dialog";
import FilePlus from "lucide-react/dist/esm/icons/file-plus";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard";
import Plus from "lucide-react/dist/esm/icons/plus";
import SquareMinus from "lucide-react/dist/esm/icons/square-minus";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import TreePine from "lucide-react/dist/esm/icons/tree-pine";
import FileIcon from "../../../components/FileIcon";
import type { PanelTabId } from "../../layout/components/PanelTabs";
import {
  createWorkspaceDirectory,
  copyWorkspaceItem,
  getWorkspaceDirectoryChildren,
  readWorkspaceFile,
  trashWorkspaceItem,
  writeWorkspaceFile,
} from "../../../services/tauri";
import type { GitFileStatus, OpenAppTarget } from "../../../types";
import { languageFromPath } from "../../../utils/syntax";
import { FilePreviewPopover } from "./FilePreviewPopover";

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTreeNode[];
  isLazyLoadable?: boolean;
};

type VisibleTreeNodeEntry = {
  path: string;
  type: "file" | "folder" | "root";
};

type FileTreePanelProps = {
  workspaceId: string;
  workspaceName?: string;
  workspacePath: string;
  files: string[];
  directories?: string[];
  isLoading: boolean;
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
    const visualTarget = target ?? getSingleChatInputContainer();
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
    window.handleFilePathFromJava(paths[0]);
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
): { nodes: FileTreeNode[]; folderPaths: Set<string> } {
  const root = new Map<string, FileTreeBuildNode>();
  const addNode = (
    map: Map<string, FileTreeBuildNode>,
    name: string,
    path: string,
    type: "file" | "folder",
    isLazyLoadable = false,
  ) => {
    const existing = map.get(name);
    if (existing) {
      if (type === "folder") {
        existing.type = "folder";
      }
      if (isLazyLoadable) {
        existing.isLazyLoadable = true;
      }
      return existing;
    }
    const node: FileTreeBuildNode = {
      name,
      path,
      type,
      children: new Map(),
      isLazyLoadable,
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
      const node = addNode(
        currentMap,
        segment,
        nextPath,
        nodeType,
        nodeType === "folder" && lazyLoadableDirectories.has(nextPath),
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

export function FileTreePanel({
  workspaceId,
  workspaceName,
  workspacePath,
  files,
  directories,
  isLoading,
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
  const selectionAnchorPathRef = useRef<string | null>(null);
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
  const [loadedLazyDirectories, setLoadedLazyDirectories] = useState<Set<string>>(new Set());
  const [loadingLazyDirectories, setLoadingLazyDirectories] = useState<Set<string>>(new Set());
  const [lazyDirectoryLoadErrors, setLazyDirectoryLoadErrors] = useState<Map<string, string>>(
    new Map(),
  );
  const loadedLazyDirectoriesRef = useRef<Set<string>>(new Set());
  const loadingLazyDirectoriesRef = useRef<Set<string>>(new Set());

  const workspaceRootLabel = useMemo(
    () => resolveWorkspaceRootLabel(workspacePath, workspaceName),
    [workspaceName, workspacePath],
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
  const seededLazyLoadableDirectories = useMemo(() => {
    const result = new Set<string>();
    mergedDirectories.forEach((path) => {
      if (isSpecialDirectoryPath(path)) {
        result.add(path);
      }
    });
    return result;
  }, [mergedDirectories]);
  const effectiveLazyLoadableDirectories = useMemo(() => {
    const result = new Set(seededLazyLoadableDirectories);
    lazyLoadableDirectories.forEach((path) => result.add(path));
    return result;
  }, [seededLazyLoadableDirectories, lazyLoadableDirectories]);
  const showLoading = isLoading && mergedFiles.length === 0;

  const gitStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    if (gitStatusFiles) {
      for (const entry of gitStatusFiles) {
        map.set(entry.path, entry.status);
      }
    }
    return map;
  }, [gitStatusFiles]);

  const { nodes, folderPaths } = useMemo(
    () => buildTree(
      mergedFiles,
      mergedDirectories,
      effectiveLazyLoadableDirectories,
    ),
    [
      effectiveLazyLoadableDirectories,
      mergedDirectories,
      mergedFiles,
    ],
  );

  const folderGitStatusMap = useMemo(() => {
    if (gitStatusMap.size === 0) {
      return new Map<string, string>();
    }
    const priority: Record<string, number> = { D: 4, A: 3, M: 2, R: 1, T: 0 };
    const map = new Map<string, string>();
    const computeForNode = (node: FileTreeNode): string | null => {
      if (node.type === "file") {
        return gitStatusMap.get(node.path) ?? null;
      }
      let highest: string | null = null;
      let highestPri = -1;
      for (const child of node.children) {
        const childStatus = computeForNode(child);
        if (childStatus && (priority[childStatus] ?? -1) > highestPri) {
          highest = childStatus;
          highestPri = priority[childStatus] ?? -1;
        }
      }
      if (highest) {
        map.set(node.path, highest);
      }
      return highest;
    };
    for (const node of nodes) {
      computeForNode(node);
    }
    return map;
  }, [nodes, gitStatusMap]);

  const visibleFolderPaths = folderPaths;
  const hasFolders = visibleFolderPaths.size > 0;
  const allVisibleExpanded =
    hasFolders && Array.from(visibleFolderPaths).every((path) => expandedFolders.has(path));
  const isRootVisibleExpanded = rootExpanded;
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

  const toggleAllFolders = () => {
    if (!hasFolders) {
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (allVisibleExpanded) {
        visibleFolderPaths.forEach((path) => next.delete(path));
      } else {
        visibleFolderPaths.forEach((path) => next.add(path));
      }
      return next;
    });

  };

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
  const orderedSelectedNodePaths = useMemo(
    () =>
      visibleTreePathOrder.filter((path) => path.length > 0 && selectedNodePaths.has(path)),
    [selectedNodePaths, visibleTreePathOrder],
  );
  const canTrashSelectedNode =
    selectedNodeType !== null && selectedNodePath !== null && selectedNodePath.length > 0;

  const showContextMenu = useCallback(
    async (event: MouseEvent<HTMLButtonElement>, relativePath: string, isFolder: boolean) => {
      event.preventDefault();
      event.stopPropagation();

      const parentFolder = resolveParentFolderForNode(relativePath, isFolder ? "folder" : "file");

      const menuItems = [
        await MenuItem.new({
          text: t("files.newFile"),
          action: () => {
            openNewFilePrompt(parentFolder);
          },
        }),
        await MenuItem.new({
          text: t("files.newFolder"),
          action: () => {
            openNewFolderPrompt(parentFolder);
          },
        }),
        await MenuItem.new({
          text: t("files.duplicateItem"),
          action: async () => {
            await duplicateItem(relativePath);
          },
        }),
        await MenuItem.new({
          text: t("files.copyPath"),
          action: async () => {
            await copyPath(relativePath);
          },
        }),
        await MenuItem.new({
          text: t("files.revealInFinder"),
          action: async () => {
            await revealItemInDir(resolvePath(relativePath));
          },
        }),
        ...(onInsertText && !isFolder
          ? [
              await MenuItem.new({
                text: t("files.insertLspDiagnostics"),
                action: () => {
                  onInsertText(`/lsp diagnostics "${relativePath}"`);
                },
              }),
              await MenuItem.new({
                text: t("files.insertLspDocumentSymbols"),
                action: () => {
                  onInsertText(`/lsp document-symbols "${relativePath}"`);
                },
              }),
            ]
          : []),
        await MenuItem.new({
          text: t("files.deleteItem"),
          action: async () => {
            await trashItem(relativePath, isFolder);
          },
        }),
      ];

      const menu = await Menu.new({ items: menuItems });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [
      resolvePath,
      copyPath,
      trashItem,
      duplicateItem,
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

  const renderNode = (node: FileTreeNode, depth: number) => {
    const isFolder = node.type === "folder";
    const isLazyFolder = isFolder && (node.isLazyLoadable ?? false);
    const hasChildren = isFolder && node.children.length > 0;
    const canExpand = isFolder && (hasChildren || isLazyFolder);
    const isExpanded = canExpand && expandedFolders.has(node.path);
    const isLazyLoading = isLazyFolder && loadingLazyDirectories.has(node.path);
    const lazyLoadError = isLazyFolder ? lazyDirectoryLoadErrors.get(node.path) ?? null : null;
    const fileGitStatus = isFolder
      ? folderGitStatusMap.get(node.path) ?? null
      : gitStatusMap.get(node.path) ?? null;
    const gitStatusClass = fileGitStatus
      ? ` git-${fileGitStatus.toLowerCase()}`
      : "";
    const isGitignored = isFolder
      ? mergedGitignoredDirectories.has(node.path)
      : mergedGitignoredFiles.has(node.path);
    const isSelected = selectedNodePaths.has(node.path);
    const isPrimarySelection = selectedNodePath === node.path;
    return (
      <div key={node.path}>
        <div className="file-tree-row-wrap">
          <button
            type="button"
            className={`file-tree-row${isFolder ? " is-folder" : " is-file"}${isGitignored ? " is-gitignored" : ""}${isSelected ? " is-selected" : ""}${isPrimarySelection ? " is-primary" : ""}`}
            style={{ paddingLeft: `${depth * 10}px` }}
            onClick={(event) => {
              const isToggleSelect = event.metaKey || event.ctrlKey;
              if (event.shiftKey) {
                setRangeSelection(node.path, node.type);
                return;
              }
              if (isToggleSelect) {
                togglePathSelection(node.path, node.type);
                return;
              }
              setSingleSelection(node.path, node.type);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              if (isFolder) {
                if (!canExpand) {
                  return;
                }
                toggleFolderExpandedState(node.path, isLazyFolder);
                return;
              }
              if (onOpenFile) {
                onOpenFile(node.path);
                return;
              }
              openPreview(node.path, event.currentTarget);
            }}
            onContextMenu={(event) => {
              if (!selectedNodePaths.has(node.path)) {
                setSingleSelection(node.path, node.type);
              } else {
                setSelectedNodePath(node.path);
                setSelectedNodeType(node.type);
              }
              void showContextMenu(event, node.path, isFolder);
            }}
            draggable
            onDragStart={(event: DragEvent<HTMLButtonElement>) => {
              const dragSourcePaths = isSelected
                ? orderedSelectedNodePaths
                : [node.path];
              const uniqueSourcePaths = Array.from(new Set(dragSourcePaths));
              if (uniqueSourcePaths.length === 0) {
                return;
              }
              if (!isSelected) {
                setSingleSelection(node.path, node.type);
              }
              if (
                typeof window !== "undefined" &&
                (window.__fileTreeDragActive === true ||
                  typeof window.__fileTreeDragCleanup === "function")
              ) {
                clearFileTreeDragBridge();
              }
              const absolutePaths = uniqueSourcePaths.map((path) => resolvePath(path));
              setFileTreeDragBridge(absolutePaths);
              window.__fileTreeDragCleanup = bindChatDropTargetsForTreeDrag(absolutePaths);
              setFileTreeDragPosition(event.clientX, event.clientY);
              if (!event.dataTransfer) {
                return;
              }
              const encodedPaths = JSON.stringify(absolutePaths);
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData("application/x-codemoss-file-paths", encodedPaths);
              event.dataTransfer.setData("text/plain", absolutePaths.join("\n"));
            }}
            onDrag={(event: DragEvent<HTMLButtonElement>) => {
              setFileTreeDragPosition(event.clientX, event.clientY);
            }}
            onDragEnd={(event: DragEvent<HTMLButtonElement>) => {
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
            }}
          >
            {isFolder && canExpand ? (
              <span
                className={`file-tree-chevron${isExpanded ? " is-open" : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleFolderExpandedState(node.path, isLazyFolder);
                }}
              >
                ›
              </span>
            ) : (
              <span className="file-tree-spacer" aria-hidden />
            )}
            <span className="file-tree-icon" aria-hidden>
              <FileIcon filePath={node.name} isFolder={isFolder} isOpen={isExpanded} />
            </span>
            <span className={`file-tree-name${gitStatusClass}`}>{node.name}</span>
          </button>
          <button
            type="button"
            className={`ghost icon-button file-tree-action${isSelected ? " is-visible" : ""}`}
            onMouseDown={(event) => {
              // Keep row click from stealing the pointer sequence on dense list rows.
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              const absolutePath = resolvePath(node.path);
              // Prefer ChatInputBox bridge so `+` follows the same render/update
              // path as native @ file-reference insertion.
              if (typeof window !== "undefined" && window.handleFilePathFromJava) {
                window.handleFilePathFromJava(absolutePath);
                return;
              }
              // Fallback for non-ChatInputBox contexts.
              const mentionText = `@${absolutePath}${node.type === "file" ? " " : ""}`;
              onInsertText?.(mentionText);
            }}
            aria-label={t("files.mentionFile", { name: node.name })}
            title={t("files.mentionInChat")}
          >
            <Plus size={10} aria-hidden />
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div className="file-tree-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
        {isLazyFolder && isExpanded && node.children.length === 0 && (
          <div className="file-tree-children">
            {isLazyLoading ? (
              <div className="file-tree-lazy-state">{t("files.loadingFiles")}</div>
            ) : lazyLoadError ? (
              <button
                type="button"
                className="file-tree-lazy-retry"
                onClick={() => void loadLazyDirectoryChildren(node.path)}
                title={lazyLoadError}
              >
                加载失败，点击重试
              </button>
            ) : (
              <div className="file-tree-lazy-state">{t("files.noFilesAvailable")}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="diff-panel file-tree-panel" ref={panelRef}>
      <div className="file-tree-top-zone">
        <div className="file-tree-root-row">
          <div className="file-tree-root-wrap">
            <button
              type="button"
              className={`file-tree-row is-folder is-root${selectedNodePaths.has("") ? " is-selected" : ""}${selectedNodePath === "" ? " is-primary" : ""}`}
              onClick={() => {
                setSingleSelection("", "root");
                setRootExpanded((prev) => !prev);
              }}
              onContextMenu={(event) => {
                if (!selectedNodePaths.has("")) {
                  setSingleSelection("", "root");
                } else {
                  setSelectedNodePath("");
                  setSelectedNodeType("folder");
                }
                void showContextMenu(event, "", true);
              }}
            >
              <span
                className={`file-tree-chevron file-tree-root-chevron${isRootVisibleExpanded ? " is-open" : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setRootExpanded((prev) => !prev);
                }}
              >
                ›
              </span>
              <span className="file-tree-icon file-tree-icon-root-special" aria-hidden>
                <TreePine size={13} />
              </span>
              <span className="file-tree-name">{workspaceRootLabel}</span>
            </button>
          </div>
          <div className="file-tree-root-actions">
            <button
              type="button"
              className={`ghost icon-button file-tree-root-action${isSpecHubActive ? " is-active" : ""}`}
              onClick={onOpenSpecHub}
              disabled={!onOpenSpecHub}
              aria-label={t("sidebar.specHub")}
              title={t("sidebar.specHub")}
            >
              <LayoutDashboard aria-hidden />
            </button>
            <button
              type="button"
              className="ghost icon-button file-tree-root-action"
              onClick={() => openNewFilePrompt(selectedParentFolder)}
              aria-label={t("files.newFile")}
              title={t("files.newFile")}
            >
              <FilePlus aria-hidden />
            </button>
            <button
              type="button"
              className="ghost icon-button file-tree-root-action"
              onClick={() => openNewFolderPrompt(selectedParentFolder)}
              aria-label={t("files.newFolder")}
              title={t("files.newFolder")}
            >
              <FolderPlus aria-hidden />
            </button>
            <button
              type="button"
              className="ghost icon-button file-tree-root-action"
              onClick={toggleAllFolders}
              disabled={!hasFolders}
              aria-label={allVisibleExpanded ? t("files.collapseAllFolders") : t("files.expandAllFolders")}
              title={allVisibleExpanded ? t("files.collapseAllFolders") : t("files.expandAllFolders")}
            >
              <SquareMinus aria-hidden />
            </button>
            <button
              type="button"
              className="ghost icon-button file-tree-root-action file-tree-root-action-danger"
              onClick={() => {
                if (!canTrashSelectedNode || !selectedNodePath || !selectedNodeType) {
                  return;
                }
                void trashItem(selectedNodePath, selectedNodeType === "folder");
              }}
              disabled={!canTrashSelectedNode}
              aria-label={t("files.deleteItem")}
              title={t("files.deleteItem")}
            >
              <Trash2 aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div className={`file-tree-list${isRootVisibleExpanded && nodes.length > 0 ? " has-root-guide" : ""}`}>
        {showLoading ? (
          <div className="file-tree-skeleton">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                className="file-tree-skeleton-row"
                key={`file-tree-skeleton-${index}`}
                style={{ width: `${68 + index * 3}%` }}
              />
            ))}
          </div>
        ) : !isRootVisibleExpanded ? null : nodes.length === 0 ? (
          <div className="file-tree-empty">
            {t("files.noFilesAvailable")}
          </div>
        ) : (
          nodes.map((node) => renderNode(node, 1))
        )}
      </div>
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
      {newFileParent !== null && (
        <div className="new-file-prompt" role="dialog" aria-modal="true">
          <div className="new-file-prompt-backdrop" onClick={cancelNewFile} />
          <div className="new-file-prompt-card">
            <div className="new-file-prompt-title">{t("files.newFile")}</div>
            {newFileParent && (
              <div className="new-file-prompt-path">{newFileParent}/</div>
            )}
            <input
              id="new-file-name"
              ref={newFileInputRef}
              className="new-file-prompt-input"
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
            <div className="new-file-prompt-actions">
              <button type="button" className="ghost" onClick={cancelNewFile}>
                {t("files.cancel")}
              </button>
              <button
                type="button"
                className="primary"
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
        <div className="new-file-prompt" role="dialog" aria-modal="true">
          <div className="new-file-prompt-backdrop" onClick={cancelNewFolder} />
          <div className="new-file-prompt-card">
            <div className="new-file-prompt-title">{t("files.newFolder")}</div>
            {newFolderParent && (
              <div className="new-file-prompt-path">{newFolderParent}/</div>
            )}
            <input
              id="new-folder-name"
              ref={newFolderInputRef}
              className="new-file-prompt-input"
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
            <div className="new-file-prompt-actions">
              <button type="button" className="ghost" onClick={cancelNewFolder}>
                {t("files.cancel")}
              </button>
              <button
                type="button"
                className="primary"
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
