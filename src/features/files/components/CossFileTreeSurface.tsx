import {
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from "@headless-tree/core";
import { AssistiveTreeDescription, useTree } from "@headless-tree/react";
import type { DragEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useMemo } from "react";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import Plus from "lucide-react/dist/esm/icons/plus";

import FileIcon from "../../../components/FileIcon";
import { Tree, TreeItem, TreeItemLabel } from "../../../components/ui/tree";
import { cn } from "../../../lib/utils";

export type CossFileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: CossFileTreeNode[];
  isLazyLoadable?: boolean;
  hasMore?: boolean;
};

export type CossFileTreeItemData = {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder" | "root";
  children: string[];
  isLazyLoadable: boolean;
};

type FileTreeTranslate = (
  key: string,
  options?: { name?: string },
) => string;

type CossFileTreeSurfaceProps = {
  nodes: CossFileTreeNode[];
  workspaceRootLabel: string;
  rootExpanded: boolean;
  expandedFolders: Set<string>;
  selectedNodePaths: Set<string>;
  selectedNodePath: string | null;
  loadingLazyDirectories: Set<string>;
  lazyDirectoryLoadErrors: Map<string, string>;
  gitStatusMap: Map<string, string>;
  folderGitStatusMap: Map<string, string>;
  gitignoredFiles: Set<string>;
  gitignoredDirectories: Set<string>;
  showLoading: boolean;
  hasTreeEntries: boolean;
  normalizedLoadError: string | null;
  rootActions: ReactNode;
  showMentionActions: boolean;
  translate: FileTreeTranslate;
  onRootContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onItemClick: (
    event: MouseEvent<HTMLButtonElement>,
    item: CossFileTreeItemData,
  ) => void;
  onItemDoubleClick: (
    event: MouseEvent<HTMLButtonElement>,
    item: CossFileTreeItemData,
  ) => void;
  onItemToggle: (item: CossFileTreeItemData) => void;
  onItemContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    item: CossFileTreeItemData,
  ) => void;
  onItemDragStart: (
    event: DragEvent<HTMLButtonElement>,
    item: CossFileTreeItemData,
  ) => void;
  onItemDrag: (event: DragEvent<HTMLButtonElement>) => void;
  onItemDragEnd: (event: DragEvent<HTMLButtonElement>) => void;
  onMentionItem: (item: CossFileTreeItemData) => void;
  onRetryLazyDirectory: (path: string) => void;
  onRefreshFiles?: () => void;
};

const INTERNAL_TREE_ROOT_ID = "__ccgui_tree_root__";
const PATH_ITEM_PREFIX = "path:";
const TREE_INDENT = 20;

function itemIdForPath(path: string) {
  return `${PATH_ITEM_PREFIX}${path}`;
}

function buildTreeItems(
  nodes: CossFileTreeNode[],
  workspaceRootLabel: string,
  rootExpanded: boolean,
) {
  const items = new Map<string, CossFileTreeItemData>();

  const addNode = (node: CossFileTreeNode): string => {
    const id = itemIdForPath(node.path);
    const children = node.children.map(addNode);
    items.set(id, {
      id,
      name: node.name,
      path: node.path,
      type: node.type,
      children,
      isLazyLoadable: Boolean(node.isLazyLoadable),
    });
    return id;
  };

  const rootChildren = rootExpanded ? nodes.map(addNode) : [];
  items.set(INTERNAL_TREE_ROOT_ID, {
    id: INTERNAL_TREE_ROOT_ID,
    name: workspaceRootLabel,
    path: "",
    type: "root",
    children: rootChildren,
    isLazyLoadable: false,
  });

  return items;
}

function gitClassForStatus(status: string | null) {
  return status ? `git-${status.toLowerCase()}` : "";
}

export function CossFileTreeSurface({
  nodes,
  workspaceRootLabel,
  rootExpanded,
  expandedFolders,
  selectedNodePaths,
  selectedNodePath,
  loadingLazyDirectories,
  lazyDirectoryLoadErrors,
  gitStatusMap,
  folderGitStatusMap,
  gitignoredFiles,
  gitignoredDirectories,
  showLoading,
  hasTreeEntries,
  normalizedLoadError,
  rootActions,
  showMentionActions,
  translate,
  onRootContextMenu,
  onItemClick,
  onItemDoubleClick,
  onItemToggle,
  onItemContextMenu,
  onItemDragStart,
  onItemDrag,
  onItemDragEnd,
  onMentionItem,
  onRetryLazyDirectory,
  onRefreshFiles,
}: CossFileTreeSurfaceProps) {
  const itemMap = useMemo(
    () => buildTreeItems(nodes, workspaceRootLabel, rootExpanded),
    [nodes, workspaceRootLabel, rootExpanded],
  );
  const expandedItems = useMemo(() => {
    const items: string[] = [];
    expandedFolders.forEach((path) => {
      const id = itemIdForPath(path);
      if (itemMap.has(id)) {
        items.push(id);
      }
    });
    return items;
  }, [expandedFolders, itemMap]);
  const selectedItems = useMemo(() => {
    const items: string[] = [];
    selectedNodePaths.forEach((path) => {
      const id = itemIdForPath(path);
      if (itemMap.has(id)) {
        items.push(id);
      }
    });
    return items;
  }, [itemMap, selectedNodePaths]);

  const tree = useTree<CossFileTreeItemData>({
    rootItemId: INTERNAL_TREE_ROOT_ID,
    dataLoader: {
      getItem: (id) => {
        const item = itemMap.get(id);
        if (!item) {
          return {
            id,
            name: id,
            path: "",
            type: "file" as const,
            children: [],
            isLazyLoadable: false,
          };
        }
        return item;
      },
      getChildren: (id) => itemMap.get(id)?.children ?? [],
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().type !== "file",
    state: {
      expandedItems,
      selectedItems,
    },
  });

  useEffect(() => {
    tree.rebuildTree();
  }, [itemMap, tree]);

  const renderRootState = () => {
    if (!rootExpanded) {
      return null;
    }
    if (showLoading) {
      return (
        <div
          className="coss-file-tree-loading-row ms-7 mt-1 inline-flex min-h-6 items-center gap-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle
            aria-hidden
            className="size-3.5 animate-spin text-primary"
          />
          <span>{translate("files.loadingFiles")}</span>
        </div>
      );
    }
    if (normalizedLoadError && !hasTreeEntries) {
      return (
        <div
          className="coss-file-tree-empty ms-7 mt-1 text-xs text-muted-foreground"
          title={normalizedLoadError}
        >
          <div>{translate("files.loadFilesFailed")}</div>
          {onRefreshFiles ? (
            <button
              type="button"
              className="mt-1 w-[calc(100%-20px)] cursor-pointer rounded-md border border-dashed border-border bg-transparent px-1.5 py-1 text-left text-[10px] text-destructive shadow-none transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => onRefreshFiles()}
              title={normalizedLoadError}
            >
              {translate("files.retryLoadFiles")}
            </button>
          ) : null}
        </div>
      );
    }
    if (!hasTreeEntries) {
      return (
        <div className="coss-file-tree-empty ms-7 mt-1 text-xs text-muted-foreground">
          {translate("files.noFilesAvailable")}
        </div>
      );
    }
    return null;
  };

  const handleSurfaceContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('[data-slot="tree-item"], .coss-file-tree-root-actions')
    ) {
      return;
    }
    onRootContextMenu(event);
  };

  return (
    <div
      className="coss-file-tree-surface relative flex min-h-0 flex-1 flex-col overflow-hidden"
      onContextMenu={handleSurfaceContextMenu}
    >
      <div
        className="coss-file-tree-root-actions-slot absolute right-2 top-1.5 z-20 opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        {rootActions}
      </div>
      <div className="coss-file-tree-scroll min-h-0 flex-1 overflow-y-auto pr-px">
        <Tree
          className="coss-file-tree relative"
          indent={TREE_INDENT}
          tree={tree}
          treeLabel={workspaceRootLabel}
        >
          <AssistiveTreeDescription tree={tree} />
          {tree.getItems().map((item) => {
            const itemData = item.getItemData();
            const isRoot = itemData.type === "root";
            if (isRoot) {
              return null;
            }
            const isLazyFolder = itemData.type === "folder" && itemData.isLazyLoadable;
            const canExpand =
              itemData.type === "folder" && (itemData.children.length > 0 || isLazyFolder);
            const isExpanded = item.isExpanded();
            const isLazyLoading =
              itemData.type === "folder" && loadingLazyDirectories.has(itemData.path);
            const lazyLoadError =
              itemData.type === "folder"
                ? lazyDirectoryLoadErrors.get(itemData.path) ?? null
                : null;
            const rawGitStatus =
              itemData.type === "folder"
                ? folderGitStatusMap.get(itemData.path) ?? null
                : itemData.type === "file"
                  ? gitStatusMap.get(itemData.path) ?? null
                  : null;
            const fileGitStatus =
              itemData.type === "folder" && rawGitStatus?.toUpperCase() === "D"
                ? "M"
                : rawGitStatus;
            const gitStatusClass = gitClassForStatus(fileGitStatus);
            const visualLevel = item.getItemMeta().level;
            const isGitignored =
              itemData.type === "folder"
                ? gitignoredDirectories.has(itemData.path)
                : itemData.type === "file"
                  ? gitignoredFiles.has(itemData.path)
                  : false;
            const isPrimarySelection = selectedNodePath === itemData.path;
            const iconPath = itemData.path || itemData.name;

            return (
              <div className="coss-file-tree-entry" key={item.getId()}>
                <div className="coss-file-tree-row-wrap group/tree-row relative flex items-center">
                  <TreeItem
                    item={item}
                    className={cn(
                      "coss-file-tree-item relative block w-full appearance-none !rounded-none !border-0 !bg-transparent !text-left !text-sm !font-normal text-foreground !shadow-none !transition-none [-webkit-app-region:no-drag]",
                      "!m-0 !min-h-0 !cursor-default !font-sans !leading-normal !outline-none !py-0 !pe-0 ![transform:none]",
                      isGitignored && "opacity-50",
                    )}
                    data-file-tree-path={itemData.path}
                    data-file-tree-kind={itemData.type}
                    data-primary-selection={isPrimarySelection || undefined}
                    draggable={!isRoot}
                    onClick={(event) => {
                      item.setFocused();
                      const target = event.target;
                      if (
                        canExpand &&
                        target instanceof Element &&
                        target.closest("[data-tree-toggle]")
                      ) {
                        event.preventDefault();
                        event.stopPropagation();
                        onItemToggle(itemData);
                        return;
                      }
                      onItemClick(event, itemData);
                    }}
                    onDoubleClick={(event) => {
                      onItemDoubleClick(event, itemData);
                    }}
                    onContextMenu={(event) => {
                      onItemContextMenu(event, itemData);
                    }}
                    onDragStart={(event) => {
                      if (!isRoot) {
                        onItemDragStart(event, itemData);
                      }
                    }}
                    onDrag={onItemDrag}
                    onDragEnd={onItemDragEnd}
                    style={{
                      paddingInlineStart: `${visualLevel * TREE_INDENT}px`,
                    }}
                  >
                    {Array.from({ length: visualLevel }, (_, guideIndex) => (
                      <span
                        className="coss-file-tree-guide pointer-events-none absolute inset-y-0 z-20 w-px bg-zinc-300/80"
                        key={guideIndex}
                        aria-hidden
                        style={{
                          left: `${(guideIndex + 1) * TREE_INDENT - 1}px`,
                        }}
                      />
                    ))}
                    <TreeItemLabel
                      className={cn(
                        "coss-file-tree-label relative z-10 min-h-8 w-full rounded-none bg-background py-1 font-sans text-[15px] font-normal leading-6 text-foreground",
                        "hover:bg-[color-mix(in_srgb,var(--background)_96%,var(--foreground)_4%)] hover:text-accent-foreground in-data-[selected=true]:!bg-[color-mix(in_srgb,var(--background)_94%,var(--foreground)_6%)] in-data-[selected=true]:text-accent-foreground",
                        isGitignored && "text-muted-foreground",
                      )}
                    >
                      <FileIcon
                        filePath={iconPath}
                        isFolder={itemData.type === "folder"}
                        isOpen={itemData.type === "folder" && isExpanded}
                        className={cn(
                          "coss-file-tree-icon pointer-events-none shrink-0 opacity-[0.9] [filter:saturate(0.88)_contrast(1.02)] transition-opacity duration-150 group-hover/tree-row:opacity-100",
                          itemData.type === "folder" &&
                            "opacity-[0.86] [filter:saturate(0.82)_contrast(1)] group-hover/tree-row:opacity-[0.96]",
                          isPrimarySelection &&
                            "opacity-100 [filter:saturate(0.96)_contrast(1.04)]",
                        )}
                      />
                      <span
                        className={cn(
                          "coss-file-tree-name min-w-0 truncate leading-tight",
                          gitStatusClass,
                          isGitignored && "italic",
                        )}
                      >
                        {itemData.name}
                      </span>
                    </TreeItemLabel>
                  </TreeItem>
                  {showMentionActions ? (
                    <button
                      type="button"
                      className="coss-file-tree-action pointer-events-none absolute right-1 top-1/2 z-[2] inline-flex !size-5 -translate-y-1/2 items-center justify-center !rounded-sm !border-0 !bg-transparent !p-0 !text-xs !font-normal text-muted-foreground opacity-0 !shadow-none !transition-colors hover:bg-[color-mix(in_srgb,var(--background)_92%,var(--foreground)_8%)] hover:text-accent-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 group-hover/tree-row:pointer-events-auto group-hover/tree-row:opacity-100"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onMentionItem(itemData);
                      }}
                      aria-label={translate("files.mentionFile", { name: itemData.name })}
                      title={translate("files.mentionInChat")}
                    >
                      <Plus className="size-3" aria-hidden />
                    </button>
                  ) : null}
                </div>
                {isLazyFolder && isExpanded && itemData.children.length === 0 ? (
                  <div
                    className="coss-file-tree-lazy-state py-1 text-[10px] text-muted-foreground"
                    style={{
                      paddingLeft: `${(visualLevel + 1) * TREE_INDENT + 28}px`,
                    }}
                  >
                    {isLazyLoading ? (
                      translate("files.loadingFiles")
                    ) : lazyLoadError ? (
                      <button
                        type="button"
                        className="w-[calc(100%-20px)] cursor-pointer rounded-md border border-dashed border-border bg-transparent px-1.5 py-1 text-left text-[10px] text-destructive shadow-none transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        onClick={() => onRetryLazyDirectory(itemData.path)}
                        title={lazyLoadError}
                      >
                        {translate("files.retryLoadFiles")}
                      </button>
                    ) : (
                      translate("files.noFilesAvailable")
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Tree>
        {renderRootState()}
      </div>
    </div>
  );
}
