import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { confirm } from "@tauri-apps/plugin-dialog";
import Plus from "lucide-react/dist/esm/icons/plus";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import Search from "lucide-react/dist/esm/icons/search";
import FileIcon from "../../../components/FileIcon";
import { PanelTabs, type PanelTabId } from "../../layout/components/PanelTabs";
import { copyWorkspaceItem, readWorkspaceFile, trashWorkspaceItem, writeWorkspaceFile } from "../../../services/tauri";
import type { GitFileStatus, OpenAppTarget } from "../../../types";
import { languageFromPath } from "../../../utils/syntax";
import { FilePreviewPopover } from "./FilePreviewPopover";

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTreeNode[];
};

type FileTreePanelProps = {
  workspaceId: string;
  workspacePath: string;
  files: string[];
  isLoading: boolean;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  onInsertText?: (text: string) => void;
  onOpenFile?: (path: string) => void;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  onToggleRuntimeConsole?: () => void;
  isRuntimeConsoleVisible?: boolean;
  gitStatusFiles?: GitFileStatus[];
  gitignoredFiles?: Set<string>;
  onRefreshFiles?: () => void;
};

type FileTreeBuildNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: Map<string, FileTreeBuildNode>;
};

function buildTree(paths: string[]): { nodes: FileTreeNode[]; folderPaths: Set<string> } {
  const root = new Map<string, FileTreeBuildNode>();
  const addNode = (
    map: Map<string, FileTreeBuildNode>,
    name: string,
    path: string,
    type: "file" | "folder",
  ) => {
    const existing = map.get(name);
    if (existing) {
      if (type === "folder") {
        existing.type = "folder";
      }
      return existing;
    }
    const node: FileTreeBuildNode = {
      name,
      path,
      type,
      children: new Map(),
    };
    map.set(name, node);
    return node;
  };

  paths.forEach((path) => {
    const parts = path.split("/").filter(Boolean);
    let currentMap = root;
    let currentPath = "";
    parts.forEach((segment, index) => {
      const isFile = index === parts.length - 1;
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
      const node = addNode(currentMap, segment, nextPath, isFile ? "file" : "folder");
      if (!isFile) {
        currentMap = node.children;
        currentPath = nextPath;
      }
    });
  });

  const folderPaths = new Set<string>();

  const toArray = (map: Map<string, FileTreeBuildNode>): FileTreeNode[] => {
    const nodes = Array.from(map.values()).map((node) => {
      if (node.type === "folder") {
        folderPaths.add(node.path);
      }
      return {
        name: node.name,
        path: node.path,
        type: node.type,
        children: node.type === "folder" ? toArray(node.children) : [],
      };
    });
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
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

export function FileTreePanel({
  workspaceId,
  workspacePath,
  files,
  isLoading,
  filePanelMode,
  onFilePanelModeChange,
  onInsertText,
  onOpenFile,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  gitStatusFiles,
  gitignoredFiles,
  onRefreshFiles,
}: FileTreePanelProps) {
  const { t } = useTranslation();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
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
  const panelRef = useRef<HTMLElement | null>(null);
  const [newFileParent, setNewFileParent] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const newFileInputRef = useRef<HTMLInputElement | null>(null);

  const showLoading = isLoading && files.length === 0;
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const previewKind = useMemo(
    () => (previewPath && isImagePath(previewPath) ? "image" : "text"),
    [previewPath],
  );

  const gitStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    if (gitStatusFiles) {
      for (const entry of gitStatusFiles) {
        map.set(entry.path, entry.status);
      }
    }
    return map;
  }, [gitStatusFiles]);

  const filteredFiles = useMemo(() => {
    if (!normalizedQuery) {
      return files;
    }
    return files.filter((path) => path.toLowerCase().includes(normalizedQuery));
  }, [files, normalizedQuery]);

  const { nodes, folderPaths } = useMemo(
    () => buildTree(normalizedQuery ? filteredFiles : files),
    [files, filteredFiles, normalizedQuery],
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

  useEffect(() => {
    setExpandedFolders((prev) => {
      if (normalizedQuery) {
        return new Set(folderPaths);
      }
      // Keep only folders that still exist; default is all collapsed.
      const next = new Set<string>();
      prev.forEach((path) => {
        if (folderPaths.has(path)) {
          next.add(path);
        }
      });
      return next;
    });
  }, [folderPaths, normalizedQuery]);

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
        if (selectedNodePath === relativePath) {
          setSelectedNodePath(null);
          setSelectedNodeType(null);
        }
        onRefreshFiles?.();
      } catch {
        // trash operation failed
      }
    },
    [workspaceId, t, onRefreshFiles, selectedNodePath],
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

  const showContextMenu = useCallback(
    async (event: MouseEvent<HTMLButtonElement>, relativePath: string, isFolder: boolean) => {
      event.preventDefault();
      event.stopPropagation();

      const parentFolder = isFolder
        ? relativePath
        : relativePath.includes("/")
          ? relativePath.substring(0, relativePath.lastIndexOf("/"))
          : "";

      const menuItems = [
        await MenuItem.new({
          text: t("files.newFile"),
          action: () => {
            openNewFilePrompt(parentFolder);
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
    [resolvePath, copyPath, trashItem, duplicateItem, openNewFilePrompt, t],
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
    const isExpanded = isFolder && expandedFolders.has(node.path);
    const fileGitStatus = isFolder
      ? folderGitStatusMap.get(node.path) ?? null
      : gitStatusMap.get(node.path) ?? null;
    const gitStatusClass = fileGitStatus
      ? ` git-${fileGitStatus.toLowerCase()}`
      : "";
    const isGitignored = gitignoredFiles?.has(node.path) ?? false;
    return (
      <div key={node.path}>
        <div className="file-tree-row-wrap">
          <button
            type="button"
            className={`file-tree-row${isFolder ? " is-folder" : " is-file"}${isGitignored ? " is-gitignored" : ""}${selectedNodePath === node.path ? " is-selected" : ""}`}
            style={{ paddingLeft: `${depth * 10}px` }}
            onClick={(event) => {
              setSelectedNodePath(node.path);
              setSelectedNodeType(node.type);
              if (isFolder) {
                toggleFolder(node.path);
                return;
              }
              if (onOpenFile) {
                onOpenFile(node.path);
              } else {
                openPreview(node.path, event.currentTarget);
              }
            }}
            onContextMenu={(event) => {
              setSelectedNodePath(node.path);
              setSelectedNodeType(node.type);
              void showContextMenu(event, node.path, isFolder);
            }}
          >
            {isFolder ? (
              <span className={`file-tree-chevron${isExpanded ? " is-open" : ""}`}>
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
            className={`ghost icon-button file-tree-action${selectedNodePath === node.path ? " is-visible" : ""}`}
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
        {isFolder && isExpanded && node.children.length > 0 && (
          <div className="file-tree-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="diff-panel file-tree-panel" ref={panelRef}>
      <div className="git-panel-header">
        <PanelTabs active={filePanelMode} onSelect={onFilePanelModeChange} />
        <div className="file-tree-meta">
          <div className="file-tree-count">
          {filteredFiles.length
            ? normalizedQuery
              ? t("files.matchCount", { count: filteredFiles.length })
              : t("files.fileCount", { count: filteredFiles.length })
            : showLoading
              ? t("files.loadingFiles")
              : t("files.noFiles")}
        </div>
          {hasFolders ? (
            <button
              type="button"
              className="ghost icon-button file-tree-toggle"
              onClick={toggleAllFolders}
              aria-label={allVisibleExpanded ? t("files.collapseAllFolders") : t("files.expandAllFolders")}
              title={allVisibleExpanded ? t("files.collapseAllFolders") : t("files.expandAllFolders")}
            >
              <ChevronsUpDown aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      <div className="file-tree-search">
        <Search className="file-tree-search-icon" aria-hidden />
        <input
          className="file-tree-search-input"
          type="search"
          placeholder={t("files.filterPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("files.filterPlaceholder")}
        />
      </div>
      <div className="file-tree-list">
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
        ) : nodes.length === 0 ? (
          <div className="file-tree-empty">
            {normalizedQuery ? t("files.noMatchesFound") : t("files.noFilesAvailable")}
          </div>
        ) : (
          nodes.map((node) => renderNode(node, 0))
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
    </aside>
  );
}
