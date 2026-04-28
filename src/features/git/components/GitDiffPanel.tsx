import type { GitHubIssue, GitHubPullRequest, GitLogEntry } from "../../../types";
import type { CommitMessageEngine, CommitMessageLanguage } from "../../../services/tauri";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ChevronsDownUp from "lucide-react/dist/esm/icons/chevrons-down-up";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import GitPullRequest from "lucide-react/dist/esm/icons/git-pull-request";
import HardDrive from "lucide-react/dist/esm/icons/hard-drive";
import History from "lucide-react/dist/esm/icons/history";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import MessageSquareWarning from "lucide-react/dist/esm/icons/message-square-warning";
import Search from "lucide-react/dist/esm/icons/search";
import Upload from "lucide-react/dist/esm/icons/upload";
import X from "lucide-react/dist/esm/icons/x";
import { useMemo, useState, useCallback, useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { matchesShortcutForPlatform } from "../../../utils/shortcuts";
import { formatRelativeTime } from "../../../utils/time";
import type { PanelTabId } from "../../layout/components/PanelTabs";
import FileIcon from "../../../components/FileIcon";
import { CommitMessageEngineIcon } from "./CommitMessageEngineIcon";
import {
  CommitButton,
  useGitCommitSelection,
} from "./GitDiffPanelCommitScope";
import {
  DiffFileRow,
  DiffSection,
  type DiffFile,
  type DiffSectionProps,
  getTreeLineOpacity,
  renderSectionIndicator,
  TREE_INDENT_STEP,
} from "./GitDiffPanelFileSections";
import { GitDiffViewer } from "./GitDiffViewer";
import { GitDiffPanelSectionActions } from "./GitDiffPanelSectionActions";
import {
  type InclusionState,
  InclusionToggle,
  getFileInclusionState,
  getInclusionStateForScope,
  normalizeDiffPath,
} from "./GitDiffPanelInclusion";

type GitDiffPanelProps = {
  workspaceId?: string | null;
  workspacePath?: string | null;
  mode: "diff" | "log" | "issues" | "prs";
  onModeChange: (mode: "diff" | "log" | "issues" | "prs") => void;
  diffEntries?: {
    path: string;
    status: string;
    diff: string;
    isImage?: boolean;
    oldImageData?: string | null;
    newImageData?: string | null;
    oldImageMime?: string | null;
    newImageMime?: string | null;
  }[];
  gitDiffListView?: "flat" | "tree";
  onGitDiffListViewChange?: (view: "flat" | "tree") => void;
  toggleGitDiffListViewShortcut?: string | null;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  onOpenGitHistoryPanel?: () => void;
  isGitHistoryOpen?: boolean;
  worktreeApplyLabel?: string;
  worktreeApplyTitle?: string | null;
  worktreeApplyLoading?: boolean;
  worktreeApplyError?: string | null;
  worktreeApplySuccess?: boolean;
  onApplyWorktreeChanges?: () => void | Promise<void>;
  onRevertAllChanges?: () => void | Promise<void>;
  branchName: string;
  totalAdditions: number;
  totalDeletions: number;
  fileStatus: string;
  diffViewStyle?: "split" | "unified";
  onDiffViewStyleChange?: (style: "split" | "unified") => void;
  error?: string | null;
  logError?: string | null;
  logLoading?: boolean;
  logTotal?: number;
  logAhead?: number;
  logBehind?: number;
  logAheadEntries?: GitLogEntry[];
  logBehindEntries?: GitLogEntry[];
  logUpstream?: string | null;
  issues?: GitHubIssue[];
  issuesTotal?: number;
  issuesLoading?: boolean;
  issuesError?: string | null;
  pullRequests?: GitHubPullRequest[];
  pullRequestsTotal?: number;
  pullRequestsLoading?: boolean;
  pullRequestsError?: string | null;
  selectedPullRequest?: number | null;
  onSelectPullRequest?: (pullRequest: GitHubPullRequest) => void;
  gitRemoteUrl?: string | null;
  gitRoot?: string | null;
  gitRootCandidates?: string[];
  gitRootScanDepth?: number;
  gitRootScanLoading?: boolean;
  gitRootScanError?: string | null;
  gitRootScanHasScanned?: boolean;
  onGitRootScanDepthChange?: (depth: number) => void;
  onScanGitRoots?: () => void;
  onSelectGitRoot?: (path: string) => void;
  onClearGitRoot?: () => void;
  onPickGitRoot?: () => void | Promise<void>;
  selectedPath?: string | null;
  onSelectFile?: (path: string | null) => void;
  stagedFiles: {
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }[];
  unstagedFiles: {
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }[];
  onStageAllChanges?: () => void | Promise<void>;
  onStageFile?: (path: string) => Promise<void> | void;
  onUnstageFile?: (path: string) => Promise<void> | void;
  onRevertFile?: (path: string) => Promise<void> | void;
  logEntries: GitLogEntry[];
  selectedCommitSha?: string | null;
  onSelectCommit?: (entry: GitLogEntry) => void;
  commitMessage?: string;
  commitMessageLoading?: boolean;
  commitMessageError?: string | null;
  onCommitMessageChange?: (value: string) => void;
  onGenerateCommitMessage?: (
    language?: CommitMessageLanguage,
    engine?: CommitMessageEngine,
  ) => void | Promise<void>;
  // Git operations
  onCommit?: (selectedPaths?: string[]) => void | Promise<void>;
  onCommitAndPush?: (selectedPaths?: string[]) => void | Promise<void>;
  onCommitAndSync?: (selectedPaths?: string[]) => void | Promise<void>;
  onPush?: () => void | Promise<void>;
  onSync?: () => void | Promise<void>;
  commitLoading?: boolean;
  pushLoading?: boolean;
  syncLoading?: boolean;
  commitError?: string | null;
  pushError?: string | null;
  syncError?: string | null;
  // For showing push button when there are commits to push
  commitsAhead?: number;
};

type ModeMenuLayout = {
  align: "left" | "right";
  width: number;
};

function getPathLeafName(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function normalizeRootPath(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isMissingRepo(error: string | null | undefined) {
  if (!error) {
    return false;
  }
  const normalized = error.toLowerCase();
  return (
    normalized.includes("could not find repository") ||
    normalized.includes("not a git repository") ||
    (normalized.includes("repository") && normalized.includes("notfound")) ||
    normalized.includes("repository not found") ||
    normalized.includes("git root not found")
  );
}

function renderModeIcon(mode: GitDiffPanelProps["mode"], className: string, size = 12) {
  switch (mode) {
    case "diff":
      return <ArrowLeftRight className={className} size={size} aria-hidden />;
    case "log":
      return <History className={className} size={size} aria-hidden />;
    case "issues":
      return <MessageSquareWarning className={className} size={size} aria-hidden />;
    case "prs":
      return <GitPullRequest className={className} size={size} aria-hidden />;
    default:
      return <ArrowLeftRight className={className} size={size} aria-hidden />;
  }
}

const DEPTH_OPTIONS = [1, 2, 3, 4, 5, 6];
const DISALLOWED_GIT_LIST_VIEW_SHORTCUTS = new Set([
  "cmd+f",
  "ctrl+f",
  "cmd+o",
  "ctrl+o",
  "cmd+n",
  "ctrl+n",
  "ctrl+c",
  "ctrl+shift+c",
]);

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
    ),
  );
}

type DiffTreeFolderNode = {
  key: string;
  name: string;
  folders: Map<string, DiffTreeFolderNode>;
  files: DiffFile[];
};

export function buildDiffTree(
  files: DiffFile[],
  section: "staged" | "unstaged",
): DiffTreeFolderNode {
  const root: DiffTreeFolderNode = {
    key: `${section}:/`,
    name: "",
    folders: new Map(),
    files: [],
  };
  for (const file of files) {
    const parts = file.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    let node = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index] ?? "";
      const nextKey = `${node.key}${segment}/`;
      let child = node.folders.get(segment);
      if (!child) {
        child = {
          key: nextKey,
          name: segment,
          folders: new Map(),
          files: [],
        };
        node.folders.set(segment, child);
      }
      if (!child) {
        break;
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

function collectDiffTreePaths(folder: DiffTreeFolderNode): string[] {
  return [
    ...folder.files.map((file) => file.path),
    ...Array.from(folder.folders.values()).flatMap((child) => collectDiffTreePaths(child)),
  ];
}

type DiffTreeSectionProps = DiffSectionProps & {
  collapsedFolders: Set<string>;
  onToggleFolder: (key: string) => void;
  rootFolderName: string;
  leadingMeta?: ReactNode;
  compactHeader?: boolean;
};

function DiffTreeSection({
  title,
  files,
  section,
  includedPaths,
  excludedPaths,
  partialPaths,
  selectedFiles,
  selectedPath,
  onSelectFile,
  onStageAllChanges,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onDiscardFiles,
  isCommitPathLocked,
  onSetCommitSelection,
  onFileClick,
  onOpenFilePreview,
  onShowFileMenu,
  collapsedFolders,
  onToggleFolder,
  rootFolderName,
  leadingMeta,
  compactHeader = false,
}: DiffTreeSectionProps) {
  const { t } = useTranslation();
  const tree = useMemo(() => buildDiffTree(files, section), [files, section]);
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const normalizedIncludedPaths = useMemo(
    () => includedPaths.map((path) => normalizeDiffPath(path)),
    [includedPaths],
  );
  const normalizedExcludedPaths = useMemo(
    () => excludedPaths.map((path) => normalizeDiffPath(path)),
    [excludedPaths],
  );
  const normalizedPartialPaths = useMemo(
    () => partialPaths.map((path) => normalizeDiffPath(path)),
    [partialPaths],
  );
  const includedPathSet = useMemo(
    () => new Set(normalizedIncludedPaths),
    [normalizedIncludedPaths],
  );
  const excludedPathSet = useMemo(
    () => new Set(normalizedExcludedPaths),
    [normalizedExcludedPaths],
  );
  const partialPathSet = useMemo(
    () => new Set(normalizedPartialPaths),
    [normalizedPartialPaths],
  );
  const filePaths = useMemo(() => files.map((file) => file.path), [files]);
  const toggleableFilePaths = useMemo(
    () => files
      .map((file) => file.path)
      .filter((path) => !isCommitPathLocked?.(path)),
    [files, isCommitPathLocked],
  );
  const sectionInclusionState = useMemo(() => {
    if (files.length === 0) {
      return "none";
    }
    const fileStates = files.map((file) =>
      getFileInclusionState(file.path, includedPathSet, excludedPathSet, partialPathSet),
    );
    if (fileStates.every((state) => state === "all")) {
      return "all";
    }
    if (fileStates.every((state) => state === "none")) {
      return "none";
    }
    return "partial";
  }, [excludedPathSet, files, includedPathSet, partialPathSet]);
  const showSectionActions =
    toggleableFilePaths.length > 0 ||
    filePaths.length > 0;
  const hasTreeNodes = tree.folders.size > 0 || tree.files.length > 0;
  const hasRootFolderName = rootFolderName.trim().length > 0;
  const rootFolderKey = `${section}:__repo_root__/`;
  const rootCollapsed = collapsedFolders.has(rootFolderKey);
  const useCompactHeader = compactHeader && hasRootFolderName;

  const focusSiblingTreeNode = useCallback((from: HTMLElement, direction: -1 | 1) => {
    const container = treeContainerRef.current;
    if (!container) {
      return;
    }
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(".diff-tree-folder-row, .diff-row"),
    );
    const currentIndex = nodes.indexOf(from);
    if (currentIndex < 0) {
      return;
    }
    const nextNode = nodes[currentIndex + direction];
    if (!nextNode) {
      return;
    }
    nextNode.focus();
  }, []);

  const focusParentFolder = useCallback((from: HTMLElement) => {
    const container = treeContainerRef.current;
    if (!container) {
      return;
    }
    const depth = Number(from.dataset.treeDepth ?? "0");
    if (!Number.isFinite(depth) || depth <= 0) {
      return;
    }
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(".diff-tree-folder-row, .diff-row"),
    );
    const currentIndex = nodes.indexOf(from);
    if (currentIndex <= 0) {
      return;
    }
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const candidate = nodes[index];
      if (!candidate) {
        continue;
      }
      const candidateDepth = Number(candidate.dataset.treeDepth ?? "0");
      if (!Number.isFinite(candidateDepth)) {
        continue;
      }
      if (candidateDepth < depth && candidate.classList.contains("diff-tree-folder-row")) {
        candidate.focus();
        return;
      }
    }
  }, []);

  const handleTreeKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (target.closest(".diff-row-action, .diff-section-actions button, .git-commit-scope-toggle")) {
        return;
      }
      const currentNode = target.closest<HTMLElement>(".diff-tree-folder-row, .diff-row");
      if (!currentNode) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusSiblingTreeNode(currentNode, 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusSiblingTreeNode(currentNode, -1);
        return;
      }
      const isFolder = currentNode.classList.contains("diff-tree-folder-row");
      if (event.key === "ArrowRight" && isFolder) {
        const isCollapsed = currentNode.dataset.collapsed === "true";
        if (isCollapsed) {
          event.preventDefault();
          currentNode.click();
          return;
        }
        event.preventDefault();
        focusSiblingTreeNode(currentNode, 1);
        return;
      }
      if (event.key === "ArrowLeft") {
        if (isFolder && currentNode.dataset.collapsed !== "true") {
          event.preventDefault();
          currentNode.click();
          return;
        }
        event.preventDefault();
        focusParentFolder(currentNode);
      }
    },
    [focusParentFolder, focusSiblingTreeNode],
  );

  const getScopeInclusionState = useCallback(
    (scopePath?: string | null) =>
      getInclusionStateForScope(
        normalizedIncludedPaths,
        normalizedExcludedPaths,
        normalizedPartialPaths,
        scopePath,
      ),
    [normalizedExcludedPaths, normalizedIncludedPaths, normalizedPartialPaths],
  );

  const togglePathsForCurrentSection = useCallback(
    (paths: string[], inclusionState: InclusionState) => {
      const toggleablePaths = paths.filter((path) => !isCommitPathLocked?.(path));
      if (toggleablePaths.length === 0) {
        return;
      }
      onSetCommitSelection?.(toggleablePaths, inclusionState !== "all");
    },
    [isCommitPathLocked, onSetCommitSelection],
  );

  const renderFolder = useCallback(
    (folder: DiffTreeFolderNode, depth: number, parentKey?: string) => {
      const isCollapsed = collapsedFolders.has(folder.key);
      const hasChildren = folder.folders.size > 0 || folder.files.length > 0;
      const folderPaths = collectDiffTreePaths(folder);
      const toggleableFolderPaths = folderPaths.filter((path) => !isCommitPathLocked?.(path));
      const folderScopePath = normalizeDiffPath(folder.key.split(":/")[1] ?? "");
      const folderInclusionState = getScopeInclusionState(folderScopePath);
      const treeIndentPx = depth * TREE_INDENT_STEP;
      const folderStyle = {
        paddingLeft: `${treeIndentPx}px`,
        ["--git-tree-indent-x" as string]: `${Math.max(treeIndentPx - 5, 0)}px`,
        ["--git-tree-line-opacity" as string]: getTreeLineOpacity(depth),
      } as CSSProperties;
      const childTreeStyle = {
        ["--git-tree-branch-x" as string]: `${Math.max((depth + 1) * TREE_INDENT_STEP - 5, 0)}px`,
        ["--git-tree-branch-opacity" as string]: getTreeLineOpacity(depth + 1),
      } as CSSProperties;
      return (
        <div key={folder.key} className="diff-tree-folder-group">
          <div
            className="diff-tree-folder-row git-filetree-folder-row"
            style={folderStyle}
            data-folder-key={folder.key}
            data-tree-depth={depth + 1}
            data-collapsed={hasChildren ? String(isCollapsed) : undefined}
            role="treeitem"
            tabIndex={0}
            aria-level={depth + 1}
            aria-label={folder.name}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            onClick={() => {
              if (hasChildren) {
                onToggleFolder(folder.key);
              }
            }}
            onKeyDown={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest("button")) {
                return;
              }
              if ((event.key === "Enter" || event.key === " ") && hasChildren) {
                event.preventDefault();
                onToggleFolder(folder.key);
              }
            }}
          >
            <InclusionToggle
              state={folderInclusionState}
              label={t("git.commitSelectionToggleScope", { path: folder.name })}
              className="git-commit-scope-toggle--folder"
              disabled={toggleableFolderPaths.length === 0}
              stopPropagation
              onToggle={() =>
                togglePathsForCurrentSection(
                  toggleableFolderPaths,
                  folderInclusionState,
                )
              }
            />
            <span className="diff-tree-folder-toggle" aria-hidden>
              {hasChildren ? (
                isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />
              ) : (
                <span className="diff-tree-folder-spacer" />
              )}
            </span>
            <FileIcon
              filePath={folder.name}
              isFolder
              isOpen={!isCollapsed}
              className="diff-tree-folder-icon"
            />
            <span className="diff-tree-folder-name">{folder.name}</span>
          </div>
          {!isCollapsed && (
            <div className="diff-tree-folder-children" style={childTreeStyle}>
              {Array.from(folder.folders.values()).map((child) =>
                renderFolder(child, depth + 1, folder.key),
              )}
              {folder.files.map((file) => {
                const isSelected = selectedFiles.size > 1 && selectedFiles.has(file.path);
                const isActive = selectedPath === file.path;
                return (
                  <DiffFileRow
                    key={`${section}-${file.path}`}
                    file={file}
                    isSelected={isSelected}
                    isActive={isActive}
                    section={section}
                    inclusionState={getFileInclusionState(
                      file.path,
                      includedPathSet,
                      excludedPathSet,
                      partialPathSet,
                    )}
                    inclusionDisabled={Boolean(isCommitPathLocked?.(file.path))}
                    indentLevel={depth + 1}
                    showDirectory={false}
                    treeItem
                    treeDepth={depth + 2}
                    treeParentFolderKey={parentKey ?? folder.key}
                    onClick={(event) => onFileClick(event, file.path, section)}
                    onKeySelect={() => onSelectFile?.(file.path)}
                    onOpenPreview={() => onOpenFilePreview?.(file, section)}
                    onContextMenu={(event) => onShowFileMenu(event, file.path, section)}
                    onStageFile={onStageFile}
                    onUnstageFile={onUnstageFile}
                    onDiscardFile={onDiscardFile}
                    onSetCommitSelection={onSetCommitSelection}
                  />
                );
              })}
            </div>
          )}
        </div>
      );
    },
    [
      collapsedFolders,
      onFileClick,
      onOpenFilePreview,
      onSelectFile,
      onShowFileMenu,
      getScopeInclusionState,
      includedPathSet,
      excludedPathSet,
      partialPathSet,
      isCommitPathLocked,
      onSetCommitSelection,
      onStageFile,
      onToggleFolder,
      onUnstageFile,
      onDiscardFile,
      section,
      selectedFiles,
      selectedPath,
      t,
      togglePathsForCurrentSection,
    ],
  );

  return (
    <div className={`diff-section git-filetree-section diff-section--${section}`}>
      <div
        className={`diff-section-title diff-section-title--row git-filetree-section-header${
          useCompactHeader ? " is-compact" : ""
        }`}
      >
        {useCompactHeader ? (
          <button
            type="button"
            className="diff-tree-summary-root"
            aria-label={rootFolderName}
            aria-expanded={hasTreeNodes ? !rootCollapsed : undefined}
            onClick={() => {
              if (hasTreeNodes) {
                onToggleFolder(rootFolderKey);
              }
            }}
          >
            <span className="diff-tree-summary-root-toggle" aria-hidden>
              {hasTreeNodes ? (
                rootCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />
              ) : (
                <span className="diff-tree-folder-spacer" />
              )}
            </span>
            <FileIcon
              filePath={rootFolderName}
              isFolder
              isOpen={!rootCollapsed}
              className="diff-tree-summary-root-icon"
            />
            <span className="diff-tree-summary-root-name">{rootFolderName}</span>
          </button>
        ) : null}
        <span className="diff-tree-summary-section-label">
          {renderSectionIndicator(section, files.length, t)}
        </span>
        {leadingMeta ? <span className="diff-tree-summary-meta">{leadingMeta}</span> : null}
        {showSectionActions && (
          <GitDiffPanelSectionActions
            title={title}
            section={section}
            sectionInclusionState={sectionInclusionState}
            toggleableFilePaths={toggleableFilePaths}
            filePaths={filePaths}
            onSetCommitSelection={onSetCommitSelection}
            onStageAllChanges={onStageAllChanges}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            onDiscardFiles={onDiscardFiles}
          />
        )}
      </div>
      <div
        ref={treeContainerRef}
        className={`diff-section-list diff-section-tree-list git-filetree-list git-filetree-list--tree${
          useCompactHeader ? " is-compact-root" : ""
        }`}
        role="tree"
        aria-label={title}
        onKeyDownCapture={handleTreeKeyDownCapture}
      >
        {hasTreeNodes && hasRootFolderName && !useCompactHeader && (
          <div className="diff-tree-folder-group">
            <div
              className="diff-tree-folder-row git-filetree-folder-row"
              style={{ paddingLeft: "0px" }}
              data-folder-key={rootFolderKey}
              data-tree-depth={1}
              data-collapsed={String(rootCollapsed)}
              role="treeitem"
              tabIndex={0}
              aria-level={1}
              aria-label={rootFolderName}
              aria-expanded={!rootCollapsed}
              onClick={() => onToggleFolder(rootFolderKey)}
              onKeyDown={(event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest("button")) {
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleFolder(rootFolderKey);
                }
              }}
            >
              <InclusionToggle
                state={getScopeInclusionState()}
                label={t("git.commitSelectionToggleScope", { path: rootFolderName })}
                className="git-commit-scope-toggle--folder"
                disabled={toggleableFilePaths.length === 0}
                stopPropagation
                onToggle={() =>
                  togglePathsForCurrentSection(
                    toggleableFilePaths,
                    getScopeInclusionState(),
                  )
                }
              />
              <span className="diff-tree-folder-toggle" aria-hidden>
                {rootCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </span>
              <FileIcon
                filePath={rootFolderName}
                isFolder
                isOpen={!rootCollapsed}
                className="diff-tree-folder-icon"
              />
              <span className="diff-tree-folder-name">{rootFolderName}</span>
            </div>
            {!rootCollapsed && (
              <div
                className="diff-tree-folder-children"
                style={
                  {
                    ["--git-tree-branch-x" as string]: `${Math.max(TREE_INDENT_STEP - 5, 0)}px`,
                    ["--git-tree-branch-opacity" as string]: getTreeLineOpacity(1),
                  } as CSSProperties
                }
              >
                {Array.from(tree.folders.values()).map((folder) =>
                  renderFolder(folder, 1, rootFolderKey),
                )}
                {tree.files.map((file) => {
                  const isSelected = selectedFiles.size > 1 && selectedFiles.has(file.path);
                  const isActive = selectedPath === file.path;
                  return (
                    <DiffFileRow
                      key={`${section}-${file.path}`}
                      file={file}
                      isSelected={isSelected}
                      isActive={isActive}
                      section={section}
                      inclusionState={getFileInclusionState(
                        file.path,
                        includedPathSet,
                        excludedPathSet,
                        partialPathSet,
                      )}
                      inclusionDisabled={Boolean(isCommitPathLocked?.(file.path))}
                      indentLevel={1}
                      showDirectory={false}
                      treeItem
                      treeDepth={2}
                      treeParentFolderKey={rootFolderKey}
                      onClick={(event) => onFileClick(event, file.path, section)}
                      onKeySelect={() => onSelectFile?.(file.path)}
                      onOpenPreview={() => onOpenFilePreview?.(file, section)}
                      onContextMenu={(event) => onShowFileMenu(event, file.path, section)}
                      onStageFile={onStageFile}
                      onUnstageFile={onUnstageFile}
                      onDiscardFile={onDiscardFile}
                      onSetCommitSelection={onSetCommitSelection}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
        {hasTreeNodes && useCompactHeader && !rootCollapsed && (
          <>
            {Array.from(tree.folders.values()).map((folder) => renderFolder(folder, 1, rootFolderKey))}
            {tree.files.map((file) => {
              const isSelected = selectedFiles.size > 1 && selectedFiles.has(file.path);
              const isActive = selectedPath === file.path;
              return (
                <DiffFileRow
                  key={`${section}-${file.path}`}
                  file={file}
                  isSelected={isSelected}
                  isActive={isActive}
                  section={section}
                  inclusionState={getFileInclusionState(
                    file.path,
                    includedPathSet,
                    excludedPathSet,
                    partialPathSet,
                  )}
                  inclusionDisabled={Boolean(isCommitPathLocked?.(file.path))}
                  indentLevel={1}
                  showDirectory={false}
                  treeItem
                  treeDepth={2}
                  treeParentFolderKey={rootFolderKey}
                  onClick={(event) => onFileClick(event, file.path, section)}
                  onKeySelect={() => onSelectFile?.(file.path)}
                  onOpenPreview={() => onOpenFilePreview?.(file, section)}
                  onContextMenu={(event) => onShowFileMenu(event, file.path, section)}
                  onStageFile={onStageFile}
                  onUnstageFile={onUnstageFile}
                  onDiscardFile={onDiscardFile}
                  onSetCommitSelection={onSetCommitSelection}
                />
              );
            })}
          </>
        )}
        {hasTreeNodes && !hasRootFolderName && (
          <>
            {Array.from(tree.folders.values()).map((folder) => renderFolder(folder, 0))}
            {tree.files.map((file) => {
              const isSelected = selectedFiles.size > 1 && selectedFiles.has(file.path);
              const isActive = selectedPath === file.path;
              return (
                <DiffFileRow
                  key={`${section}-${file.path}`}
                  file={file}
                  isSelected={isSelected}
                  isActive={isActive}
                  section={section}
                  inclusionState={getFileInclusionState(
                    file.path,
                    includedPathSet,
                    excludedPathSet,
                    partialPathSet,
                  )}
                  inclusionDisabled={Boolean(isCommitPathLocked?.(file.path))}
                  indentLevel={0}
                  showDirectory={false}
                  treeItem
                  treeDepth={1}
                  onClick={(event) => onFileClick(event, file.path, section)}
                  onKeySelect={() => onSelectFile?.(file.path)}
                  onOpenPreview={() => onOpenFilePreview?.(file, section)}
                  onContextMenu={(event) => onShowFileMenu(event, file.path, section)}
                  onStageFile={onStageFile}
                  onUnstageFile={onUnstageFile}
                  onDiscardFile={onDiscardFile}
                  onSetCommitSelection={onSetCommitSelection}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

type GitLogEntryRowProps = {
  entry: GitLogEntry;
  isSelected: boolean;
  compact?: boolean;
  onSelect?: (entry: GitLogEntry) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

function GitLogEntryRow({
  entry,
  isSelected,
  compact = false,
  onSelect,
  onContextMenu,
}: GitLogEntryRowProps) {
  return (
    <div
      className={`git-log-entry ${compact ? "git-log-entry-compact" : ""} ${isSelected ? "active" : ""}`}
      onClick={() => onSelect?.(entry)}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(entry);
        }
      }}
    >
      <div className="git-log-summary">{entry.summary || "No message"}</div>
      <div className="git-log-meta">
        <span className="git-log-sha">{entry.sha.slice(0, 7)}</span>
        <span className="git-log-sep">·</span>
        <span className="git-log-author">{entry.author || "Unknown"}</span>
        <span className="git-log-sep">·</span>
        <span className="git-log-date">
          {formatRelativeTime(entry.timestamp * 1000)}
        </span>
      </div>
    </div>
  );
}

export function GitDiffPanel({
  workspaceId = null,
  workspacePath = null,
  mode,
  onModeChange,
  diffEntries = [],
  gitDiffListView = "flat",
  onGitDiffListViewChange,
  toggleGitDiffListViewShortcut = "alt+shift+v",
  filePanelMode: _filePanelMode,
  onFilePanelModeChange: _onFilePanelModeChange,
  onOpenGitHistoryPanel,
  isGitHistoryOpen = false,
  worktreeApplyTitle = null,
  worktreeApplyLoading = false,
  worktreeApplyError = null,
  worktreeApplySuccess = false,
  onApplyWorktreeChanges,
  onRevertAllChanges: _onRevertAllChanges,
  branchName,
  totalAdditions,
  totalDeletions,
  fileStatus,
  diffViewStyle = "split",
  onDiffViewStyleChange,
  error,
  logError,
  logLoading = false,
  logTotal = 0,
  gitRemoteUrl = null,
  onSelectFile,
  logEntries,
  logAhead = 0,
  logBehind = 0,
  logAheadEntries = [],
  logBehindEntries = [],
  logUpstream = null,
  selectedCommitSha = null,
  onSelectCommit,
  issues = [],
  issuesTotal = 0,
  issuesLoading = false,
  issuesError = null,
  pullRequests = [],
  pullRequestsTotal = 0,
  pullRequestsLoading = false,
  pullRequestsError = null,
  selectedPullRequest = null,
  onSelectPullRequest,
  gitRoot = null,
  gitRootCandidates = [],
  gitRootScanDepth = 2,
  gitRootScanLoading = false,
  gitRootScanError = null,
  gitRootScanHasScanned = false,
  selectedPath = null,
  stagedFiles = [],
  unstagedFiles = [],
  onStageAllChanges,
  onStageFile,
  onUnstageFile,
  onRevertFile,
  onGitRootScanDepthChange,
  onScanGitRoots,
  onSelectGitRoot,
  onClearGitRoot,
  onPickGitRoot: _onPickGitRoot,
  commitMessage = "",
  commitMessageLoading = false,
  commitMessageError = null,
  onCommitMessageChange,
  onGenerateCommitMessage,
  onCommit,
  onCommitAndPush: _onCommitAndPush,
  onCommitAndSync: _onCommitAndSync,
  onPush,
  onSync: _onSync,
  commitLoading = false,
  pushLoading = false,
  syncLoading: _syncLoading = false,
  commitError = null,
  pushError = null,
  syncError = null,
  commitsAhead = 0,
}: GitDiffPanelProps) {
  const { t } = useTranslation();
  // Multi-select state for file list
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lastClickedFile, setLastClickedFile] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [discardDialogPaths, setDiscardDialogPaths] = useState<string[] | null>(null);
  const [discardDialogSubmitting, setDiscardDialogSubmitting] = useState(false);
  const [isCommitSectionCollapsed, setIsCommitSectionCollapsed] = useState(true);
  const [previewFile, setPreviewFile] = useState<(DiffFile & { section: "staged" | "unstaged" }) | null>(
    null,
  );
  const [isPreviewModalMaximized, setIsPreviewModalMaximized] = useState(false);
  const [previewHeaderControlsTarget, setPreviewHeaderControlsTarget] = useState<HTMLDivElement | null>(null);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [commitMessageMenuEngine, setCommitMessageMenuEngine] = useState<CommitMessageEngine>("claude");
  const [isGitRootPanelOpen, setIsGitRootPanelOpen] = useState(
    () =>
      isMissingRepo(error) ||
      gitRootScanLoading ||
      gitRootScanHasScanned ||
      Boolean(gitRootScanError) ||
      gitRootCandidates.length > 0,
  );
  const [modeMenuLayout, setModeMenuLayout] = useState<ModeMenuLayout>({
    align: "right",
    width: 246,
  });
  const panelRef = useRef<HTMLElement | null>(null);
  const modeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);

  // Combine staged and unstaged files for range selection
  const allFiles = useMemo(
    () => [
      ...stagedFiles.map(f => ({ ...f, section: "staged" as const })),
      ...unstagedFiles.map(f => ({ ...f, section: "unstaged" as const })),
    ],
    [stagedFiles, unstagedFiles],
  );
  const {
    selectedCommitPaths,
    selectedCommitCount,
    includedCommitPaths,
    excludedCommitPaths,
    partialCommitPaths,
    isCommitPathLocked,
    setCommitSelection,
  } = useGitCommitSelection({
    stagedFiles,
    unstagedFiles,
  });
  const previewDiffEntry = useMemo(
    () => (previewFile ? diffEntries.find((entry) => entry.path === previewFile.path) ?? null : null),
    [diffEntries, previewFile],
  );
  const previewDiffEntries = useMemo(() => (previewDiffEntry ? [previewDiffEntry] : []), [previewDiffEntry]);

  const closePreviewModal = useCallback(() => {
    setPreviewFile(null);
    setIsPreviewModalMaximized(false);
  }, []);

  const handleOpenFilePreview = useCallback((file: DiffFile, section: "staged" | "unstaged") => {
    setIsPreviewModalMaximized(false);
    setPreviewFile({ ...file, section });
  }, []);
  const modeOptions = useMemo(
    () => [
      {
        value: "diff" as const,
        label: t("git.diffMode"),
        description: t("git.diffModeDescription"),
      },
      {
        value: "log" as const,
        label: t("git.logMode"),
        description: t("git.logModeDescription"),
      },
      {
        value: "issues" as const,
        label: t("git.issuesMode"),
        description: t("git.issuesModeDescription"),
      },
      {
        value: "prs" as const,
        label: t("git.prsMode"),
        description: t("git.prsModeDescription"),
      },
    ],
    [t],
  );
  const currentModeOption = useMemo(
    () =>
      modeOptions.find((option) => option.value === mode) ??
      modeOptions[0] ?? {
        value: "diff" as const,
        label: t("git.changesMode"),
        description: t("git.changesModeDescription"),
      },
    [mode, modeOptions, t],
  );

  const handleModeSelect = useCallback(
    (nextMode: GitDiffPanelProps["mode"]) => {
      setIsModeMenuOpen(false);
      if (nextMode === mode) {
        return;
      }
      onModeChange(nextMode);
    },
    [mode, onModeChange],
  );

  const updateModeMenuLayout = useCallback(() => {
    const panelElement = panelRef.current;
    const triggerElement = modeTriggerRef.current;
    if (!panelElement || !triggerElement) {
      return;
    }

    const viewportPadding = 12;
    const preferredWidth = 246;
    const minimumWidth = 160;
    const panelRect = panelElement.getBoundingClientRect();
    const triggerRect = triggerElement.getBoundingClientRect();
    const boundedPanelLeft = Math.max(panelRect.left, viewportPadding);
    const boundedPanelRight = Math.min(panelRect.right, window.innerWidth - viewportPadding);
    const availableByRightAlign = Math.max(0, triggerRect.right - boundedPanelLeft);
    const availableByLeftAlign = Math.max(0, boundedPanelRight - triggerRect.left);
    const align: ModeMenuLayout["align"] =
      availableByRightAlign >= availableByLeftAlign ? "right" : "left";
    const maxAvailable = align === "right" ? availableByRightAlign : availableByLeftAlign;
    if (maxAvailable <= 0) {
      setModeMenuLayout({ align: "right", width: preferredWidth });
      return;
    }
    const width = Math.max(Math.min(preferredWidth, maxAvailable), Math.min(minimumWidth, maxAvailable));
    setModeMenuLayout({ align, width: Math.round(width) });
  }, []);

  const handleFileClick = useCallback(
    (
      event: ReactMouseEvent<HTMLDivElement>,
      path: string,
      _section: "staged" | "unstaged",
    ) => {
      const isMetaKey = event.metaKey || event.ctrlKey;
      const isShiftKey = event.shiftKey;

      if (isMetaKey) {
        // Cmd/Ctrl+click: toggle selection
        setSelectedFiles((prev) => {
          const next = new Set(prev);
          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }
          return next;
        });
        setLastClickedFile(path);
      } else if (isShiftKey && lastClickedFile) {
        // Shift+click: select range
        const currentIndex = allFiles.findIndex((f) => f.path === path);
        const lastIndex = allFiles.findIndex((f) => f.path === lastClickedFile);
        if (currentIndex !== -1 && lastIndex !== -1) {
          const start = Math.min(currentIndex, lastIndex);
          const end = Math.max(currentIndex, lastIndex);
          const range = allFiles.slice(start, end + 1).map((f) => f.path);
          setSelectedFiles((prev) => {
            const next = new Set(prev);
            for (const p of range) {
              next.add(p);
            }
            return next;
          });
        }
      } else {
        // Regular click: select single file and view it
        setSelectedFiles(new Set([path]));
        setLastClickedFile(path);
        onSelectFile?.(path);
      }
    },
    [lastClickedFile, allFiles, onSelectFile],
  );

  // Clear selection when files change
  const filesKey = useMemo(
    () => [...stagedFiles, ...unstagedFiles].map((f) => f.path).join(","),
    [stagedFiles, unstagedFiles],
  );
  const prevFilesKeyRef = useRef(filesKey);
  useEffect(() => {
    if (filesKey === prevFilesKeyRef.current) {
      return;
    }
    prevFilesKeyRef.current = filesKey;
    setSelectedFiles(new Set());
    setLastClickedFile(null);
    setCollapsedFolders(new Set());
    setDiscardDialogPaths(null);
    setDiscardDialogSubmitting(false);
    setPreviewFile((current) => {
      if (!current) {
        return null;
      }
      const exists = allFiles.some(
        (file) => file.path === current.path && file.section === current.section,
      );
      return exists ? current : null;
    });
  }, [allFiles, filesKey]);

  useEffect(() => {
    if (!previewFile) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closePreviewModal();
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [closePreviewModal, previewFile]);

  useEffect(() => {
    if (!isModeMenuOpen) {
      return;
    }

    updateModeMenuLayout();

    const handleWindowMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (modeTriggerRef.current?.contains(target) || modeMenuRef.current?.contains(target)) {
        return;
      }
      setIsModeMenuOpen(false);
    };

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setIsModeMenuOpen(false);
      modeTriggerRef.current?.focus();
    };

    const handleWindowResize = () => {
      updateModeMenuLayout();
    };

    window.addEventListener("mousedown", handleWindowMouseDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("resize", handleWindowResize);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateModeMenuLayout();
          });
    if (resizeObserver) {
      if (panelRef.current) {
        resizeObserver.observe(panelRef.current);
      }
      if (modeTriggerRef.current) {
        resizeObserver.observe(modeTriggerRef.current);
      }
    }

    return () => {
      window.removeEventListener("mousedown", handleWindowMouseDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver?.disconnect();
    };
  }, [isModeMenuOpen, updateModeMenuLayout]);

  useEffect(() => {
    setIsModeMenuOpen(false);
  }, [mode]);

  const shouldAutoOpenGitRootPanel =
    isMissingRepo(error) ||
    gitRootScanLoading ||
    Boolean(gitRootScanError) ||
    gitRootCandidates.length > 0;
  const shouldAutoCollapseGitRootPanelAfterScan =
    gitRootScanHasScanned &&
    !gitRootScanLoading &&
    !gitRootScanError &&
    gitRootCandidates.length === 0;

  useEffect(() => {
    if (shouldAutoOpenGitRootPanel) {
      setIsGitRootPanelOpen(true);
      return;
    }
    if (shouldAutoCollapseGitRootPanelAfterScan) {
      setIsGitRootPanelOpen(false);
    }
  }, [shouldAutoCollapseGitRootPanelAfterScan, shouldAutoOpenGitRootPanel]);

  useEffect(() => {
    if (mode !== "diff" || !onGitDiffListViewChange) {
      return;
    }
    const normalizedShortcut = (toggleGitDiffListViewShortcut ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
    if (
      !normalizedShortcut ||
      DISALLOWED_GIT_LIST_VIEW_SHORTCUTS.has(normalizedShortcut)
    ) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) {
        return;
      }
      const panelElement = panelRef.current;
      const activeElement = document.activeElement;
      if (
        panelElement &&
        activeElement instanceof HTMLElement &&
        !panelElement.contains(activeElement)
      ) {
        return;
      }
      if (!matchesShortcutForPlatform(event, normalizedShortcut)) {
        return;
      }
      event.preventDefault();
      onGitDiffListViewChange(gitDiffListView === "tree" ? "flat" : "tree");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    gitDiffListView,
    mode,
    onGitDiffListViewChange,
    toggleGitDiffListViewShortcut,
  ]);

  const handleDiffListClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".diff-row")) {
        return;
      }
      setSelectedFiles(new Set());
      setLastClickedFile(null);
    },
    [],
  );
  const handleToggleFolder = useCallback((key: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const githubBaseUrl = useMemo(() => {
    if (!gitRemoteUrl) {
      return null;
    }
    const trimmed = gitRemoteUrl.trim();
    if (!trimmed) {
      return null;
    }
    let path = "";
    if (trimmed.startsWith("git@github.com:")) {
      path = trimmed.slice("git@github.com:".length);
    } else if (trimmed.startsWith("ssh://git@github.com/")) {
      path = trimmed.slice("ssh://git@github.com/".length);
    } else if (trimmed.includes("github.com/")) {
      path = trimmed.split("github.com/")[1] ?? "";
    }
    path = path.replace(/\.git$/, "").replace(/\/$/, "");
    if (!path) {
      return null;
    }
    return `https://github.com/${path}`;
  }, [gitRemoteUrl]);

  const showLogMenu = useCallback(
    async (event: ReactMouseEvent<HTMLDivElement>, entry: GitLogEntry) => {
      event.preventDefault();
      event.stopPropagation();
      const copyItem = await MenuItem.new({
        text: "Copy SHA",
        action: async () => {
          await navigator.clipboard.writeText(entry.sha);
        },
      });
      const items = [copyItem];
      if (githubBaseUrl) {
        const openItem = await MenuItem.new({
          text: "Open on GitHub",
          action: async () => {
            await openUrl(`${githubBaseUrl}/commit/${entry.sha}`);
          },
        });
        items.push(openItem);
      }
      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [githubBaseUrl],
  );

  const showPullRequestMenu = useCallback(
    async (
      event: ReactMouseEvent<HTMLDivElement>,
      pullRequest: GitHubPullRequest,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const openItem = await MenuItem.new({
        text: "Open on GitHub",
        action: async () => {
          await openUrl(pullRequest.url);
        },
      });
      const menu = await Menu.new({ items: [openItem] });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [],
  );

  const discardFiles = useCallback(
    async (paths: string[]) => {
      if (!onRevertFile || paths.length === 0 || discardDialogSubmitting) {
        return;
      }
      setDiscardDialogPaths(paths);
    },
    [discardDialogSubmitting, onRevertFile],
  );

  const handleConfirmDiscardFiles = useCallback(async () => {
    if (!onRevertFile || !discardDialogPaths || discardDialogPaths.length === 0 || discardDialogSubmitting) {
      return;
    }
    const targetPaths = [...discardDialogPaths];
    setDiscardDialogSubmitting(true);
    try {
      for (const path of targetPaths) {
        await onRevertFile(path);
      }
      setDiscardDialogPaths(null);
    } finally {
      setDiscardDialogSubmitting(false);
    }
  }, [discardDialogPaths, discardDialogSubmitting, onRevertFile]);

  const closeDiscardDialog = useCallback(() => {
    if (discardDialogSubmitting) {
      return;
    }
    setDiscardDialogPaths(null);
  }, [discardDialogSubmitting]);

  const discardFile = useCallback(
    async (path: string) => {
      await discardFiles([path]);
    },
    [discardFiles],
  );

  const showFileMenu = useCallback(
    async (
      event: ReactMouseEvent<HTMLDivElement>,
      path: string,
      _mode: "staged" | "unstaged",
    ) => {
      event.preventDefault();
      event.stopPropagation();

      // Determine which files to operate on
      // If clicked file is in selection, use all selected files; otherwise just this file
      const isInSelection = selectedFiles.has(path);
      const targetPaths =
        isInSelection && selectedFiles.size > 1
          ? Array.from(selectedFiles)
          : [path];

      // If clicking on unselected file, select it
      if (!isInSelection) {
        setSelectedFiles(new Set([path]));
        setLastClickedFile(path);
      }

      const fileCount = targetPaths.length;
      const plural = fileCount > 1 ? "s" : "";
      const countSuffix = fileCount > 1 ? ` (${fileCount})` : "";

      // Separate files by their section for stage/unstage operations
      const stagedPaths = targetPaths.filter((p) =>
        stagedFiles.some((f) => f.path === p),
      );
      const unstagedPaths = targetPaths.filter((p) =>
        unstagedFiles.some((f) => f.path === p),
      );

      const items: MenuItem[] = [];

      // Unstage action for staged files
      if (stagedPaths.length > 0 && onUnstageFile) {
        items.push(
          await MenuItem.new({
            text: `Unstage file${stagedPaths.length > 1 ? `s (${stagedPaths.length})` : ""}`,
            action: async () => {
              for (const p of stagedPaths) {
                await onUnstageFile(p);
              }
            },
          }),
        );
      }

      // Stage action for unstaged files
      if (unstagedPaths.length > 0 && onStageFile) {
        items.push(
          await MenuItem.new({
            text: `Stage file${unstagedPaths.length > 1 ? `s (${unstagedPaths.length})` : ""}`,
            action: async () => {
              for (const p of unstagedPaths) {
                await onStageFile(p);
              }
            },
          }),
        );
      }

      // Revert action for all selected files
      if (onRevertFile) {
        items.push(
          await MenuItem.new({
            text: `Discard change${plural}${countSuffix}`,
            action: async () => {
              await discardFiles(targetPaths);
            },
          }),
        );
      }

      if (!items.length) {
        return;
      }
      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [
      selectedFiles,
      stagedFiles,
      unstagedFiles,
      onUnstageFile,
      onStageFile,
      onRevertFile,
      discardFiles,
    ],
  );
  const logCountLabel = logTotal
    ? `${logTotal} commit${logTotal === 1 ? "" : "s"}`
    : logEntries.length
      ? `${logEntries.length} commit${logEntries.length === 1 ? "" : "s"}`
    : "No commits";
  const logSyncLabel = logUpstream
    ? `↑${logAhead} ↓${logBehind}`
    : "No upstream configured";
  const logUpstreamLabel = logUpstream ? `Upstream ${logUpstream}` : "";
  const showAheadSection = logUpstream && logAhead > 0;
  const showBehindSection = logUpstream && logBehind > 0;
  const hasDiffTotals = totalAdditions > 0 || totalDeletions > 0;
  const primaryTreeSection =
    stagedFiles.length > 0 ? "staged" : unstagedFiles.length > 0 ? "unstaged" : null;
  const diffTotalsNode = (
    <>
      <span className="diff-status-add">+{totalAdditions}</span>
      <span className="diff-status-sep" aria-hidden>
        /
      </span>
      <span className="diff-status-del">-{totalDeletions}</span>
    </>
  );
  const diffStatusNode = hasDiffTotals
    ? (
        <>
          {logUpstream && (
            <>
              <span>{logSyncLabel}</span>
              <span className="diff-status-sep" aria-hidden>
                ·
              </span>
            </>
          )}
          {diffTotalsNode}
        </>
      )
    : logUpstream
      ? `${logSyncLabel} · ${fileStatus}`
      : fileStatus;
  const compactTreeMetaNode = hasDiffTotals ? diffTotalsNode : <span>{fileStatus}</span>;
  const hasGitRoot = Boolean(gitRoot && gitRoot.trim());
  const activeRootPath = (gitRoot ?? "").trim() || (workspacePath ?? "").trim() || (workspaceId ?? "").trim();
  const activeRootPathDisplay = activeRootPath || t("git.unknown");
  const showActiveRootSummary = mode !== "issues";
  const rootAlertText =
    mode === "diff"
      ? isMissingRepo(error)
        ? t("git.noRepositoriesFound")
        : error
          ? t("git.statusUnavailable")
          : null
      : null;
  const normalizedGitRoot = normalizeRootPath(gitRoot);
  const normalizedWorkspacePath = normalizeRootPath(workspacePath);
  const repositoryRootName =
    getPathLeafName(normalizedGitRoot) ||
    getPathLeafName(normalizedWorkspacePath) ||
    (workspaceId?.trim() ?? "");
  const hasAnyChanges = stagedFiles.length > 0 || unstagedFiles.length > 0;
  const commitScopeHint =
    selectedCommitCount > 0
      ? t("git.selectedFilesForCommit", { count: selectedCommitCount })
      : hasAnyChanges
        ? t("git.selectFilesToCommit")
        : t("git.noChangesToCommit");
  const useCompactTreeSectionHeaders = gitDiffListView === "tree" && Boolean(repositoryRootName);
  const useUnifiedDiffSummary = mode === "diff" && hasAnyChanges;
  const showApplyWorktree =
    mode === "diff" && Boolean(onApplyWorktreeChanges) && hasAnyChanges;
  const canGenerateCommitMessage = hasAnyChanges;
  const showGenerateCommitMessage =
    mode === "diff" && Boolean(onGenerateCommitMessage) && hasAnyChanges;
  const worktreeApplyIcon = worktreeApplySuccess ? (
    <Check size={12} aria-hidden />
  ) : (
    <Upload size={12} aria-hidden />
  );
  const showCommitMessageLanguageMenu = useCallback(
    async (engine: CommitMessageEngine, position: LogicalPosition) => {
      if (!onGenerateCommitMessage || commitMessageLoading || commitLoading || !canGenerateCommitMessage) {
        return;
      }
      const items = [
        await MenuItem.new({
          text: t("git.generateCommitMessageChinese"),
          action: async () => {
            setCommitMessageMenuEngine(engine);
            await onGenerateCommitMessage("zh", engine);
          },
        }),
        await MenuItem.new({
          text: t("git.generateCommitMessageEnglish"),
          action: async () => {
            setCommitMessageMenuEngine(engine);
            await onGenerateCommitMessage("en", engine);
          },
        }),
      ];
      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      await menu.popup(position, window);
    },
    [canGenerateCommitMessage, commitLoading, commitMessageLoading, onGenerateCommitMessage, t],
  );
  const showCommitMessageEngineMenu = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!onGenerateCommitMessage || commitMessageLoading || commitLoading || !canGenerateCommitMessage) {
        return;
      }
      const position = new LogicalPosition(event.clientX, event.clientY);
      const engineItems: Array<{ engine: CommitMessageEngine; label: string }> = [
        { engine: "codex", label: t("git.generateCommitMessageEngineCodex") },
        { engine: "claude", label: t("git.generateCommitMessageEngineClaude") },
        { engine: "gemini", label: t("git.generateCommitMessageEngineGemini") },
        { engine: "opencode", label: t("git.generateCommitMessageEngineOpenCode") },
      ];
      const items = await Promise.all(
        engineItems.map(async ({ engine, label }) =>
          MenuItem.new({
            text: label,
            action: async () => {
              await showCommitMessageLanguageMenu(engine, position);
            },
          }),
        ),
      );
      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      await menu.popup(position, window);
    },
    [
      canGenerateCommitMessage,
      commitLoading,
      commitMessageLoading,
      onGenerateCommitMessage,
      showCommitMessageLanguageMenu,
      t,
    ],
  );
  return (
    <aside className="diff-panel" ref={panelRef}>
      <div className="git-panel-header">
        <div className="git-panel-actions" role="group" aria-label="Git panel">
          {mode === "diff" && (
            <div className="diff-list-view-toggle" role="group" aria-label={t("git.listView")}>
              <button
                type="button"
                className={`diff-list-view-button ${gitDiffListView === "flat" ? "active" : ""}`}
                onClick={() => onGitDiffListViewChange?.("flat")}
                aria-pressed={gitDiffListView === "flat"}
              >
                <LayoutGrid size={13} aria-hidden />
                <span>{t("git.listFlat")}</span>
              </button>
              <button
                type="button"
                className={`diff-list-view-button ${gitDiffListView === "tree" ? "active" : ""}`}
                onClick={() => onGitDiffListViewChange?.("tree")}
                aria-pressed={gitDiffListView === "tree"}
              >
                <FolderTree size={13} aria-hidden />
                <span>{t("git.listTree")}</span>
              </button>
              {showGenerateCommitMessage ? (
                <button
                  type="button"
                  className={`diff-list-view-collapse-toggle ${!isCommitSectionCollapsed ? "active" : ""}`}
                  onClick={() => setIsCommitSectionCollapsed((value) => !value)}
                  aria-label={t("git.toggleCommitSection")}
                  aria-expanded={!isCommitSectionCollapsed}
                  title={
                    isCommitSectionCollapsed
                      ? t("git.expandCommitSection")
                      : t("git.collapseCommitSection")
                  }
                >
                  {isCommitSectionCollapsed ? (
                    <ChevronsUpDown size={13} aria-hidden />
                  ) : (
                    <ChevronsDownUp size={13} aria-hidden />
                  )}
                  <span>{t("git.commit")}</span>
                </button>
              ) : null}
            </div>
          )}
          <button
            type="button"
            className={`git-panel-history-button${isGitHistoryOpen ? " is-active" : ""}`}
            onClick={onOpenGitHistoryPanel}
            aria-label={t("git.historyQuickAction")}
            title={t("git.historyQuickAction")}
            aria-pressed={isGitHistoryOpen}
          >
            <History size={12} aria-hidden />
            <span>{t("git.historyQuickAction")}</span>
          </button>
          <div className="git-panel-select">
            <button
              ref={modeTriggerRef}
              type="button"
              className={`git-panel-select-trigger${isModeMenuOpen ? " is-open" : ""}`}
              aria-label={t("git.panelView")}
              aria-haspopup="menu"
              aria-expanded={isModeMenuOpen}
              onClick={() => setIsModeMenuOpen((current) => !current)}
            >
              {renderModeIcon(currentModeOption.value, "git-panel-select-icon", 13)}
              <span className="git-panel-select-label">{currentModeOption.label}</span>
              <ChevronDown className="git-panel-select-caret" size={12} aria-hidden />
            </button>
            {isModeMenuOpen && (
              <div
                ref={modeMenuRef}
                className="git-panel-select-menu"
                role="menu"
                aria-label={t("git.panelView")}
                style={{
                  left: modeMenuLayout.align === "left" ? 0 : "auto",
                  right: modeMenuLayout.align === "right" ? 0 : "auto",
                  width: `${modeMenuLayout.width}px`,
                }}
              >
                <div className="git-panel-select-menu-title">{currentModeOption.label}</div>
                {modeOptions.map((option) => {
                  const isActive = option.value === mode;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`git-panel-select-option${isActive ? " is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={isActive}
                      onClick={() => handleModeSelect(option.value)}
                    >
                      <span className="git-panel-select-option-text">
                        <span className="git-panel-select-option-icon" aria-hidden>
                          {renderModeIcon(option.value, "git-panel-select-option-icon-glyph", 13)}
                        </span>
                        <span className="git-panel-select-option-copy">
                          <span className="git-panel-select-option-label">{option.label}</span>
                          <span className="git-panel-select-option-description">
                            {option.description}
                          </span>
                        </span>
                      </span>
                      <span
                        className={`git-panel-select-option-check${isActive ? " is-active" : ""}`}
                        aria-hidden
                      >
                        ✓
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {showApplyWorktree && (
            <button
              type="button"
              className="diff-row-action diff-row-action--apply"
              onClick={() => {
                void onApplyWorktreeChanges?.();
              }}
              disabled={worktreeApplyLoading || worktreeApplySuccess}
              data-tooltip={worktreeApplyTitle ?? t("git.applyWorktreeChanges")}
              aria-label={t("git.applyWorktreeChangesAction")}
            >
              {worktreeApplyIcon}
            </button>
          )}
        </div>
      </div>
      {showActiveRootSummary && (
        <div className="git-root-current">
          <span className="git-root-label">{t("git.path")}</span>
          <span className="git-root-path" title={activeRootPathDisplay}>
            {activeRootPathDisplay}
          </span>
          {rootAlertText && <span className="git-root-inline-alert">{rootAlertText}</span>}
          {onScanGitRoots && (
            <button
              type="button"
              className="ghost git-root-button git-root-button--toggle"
              onClick={() => setIsGitRootPanelOpen((open) => !open)}
              aria-label={t("git.change")}
              title={t("git.change")}
              aria-expanded={isGitRootPanelOpen}
            >
              <ArrowLeftRight className="git-root-button-icon" aria-hidden />
              <span>{t("git.change")}</span>
            </button>
          )}
        </div>
      )}
      {mode === "diff" ? (
        <>
          {!useUnifiedDiffSummary && !rootAlertText ? <div className="diff-status">{diffStatusNode}</div> : null}
          {worktreeApplyError && <div className="diff-error">{worktreeApplyError}</div>}
        </>
      ) : mode === "log" ? (
        <>
          <div className="diff-status">{logCountLabel}</div>
          <div className="git-log-sync">
            <span>{logSyncLabel}</span>
            {logUpstreamLabel && (
              <>
                <span className="git-log-sep">·</span>
                <span>{logUpstreamLabel}</span>
              </>
            )}
          </div>
        </>
      ) : mode === "issues" ? (
        <>
          <div className="diff-status diff-status-issues">
            <span>{t("git.githubIssues")}</span>
            {issuesLoading && <span className="git-panel-spinner" aria-hidden />}
          </div>
          <div className="git-log-sync">
            <span>{issuesTotal} {t("git.open")}</span>
          </div>
        </>
      ) : (
        <>
          <div className="diff-status diff-status-issues">
            <span>{t("git.githubPullRequests")}</span>
            {pullRequestsLoading && (
              <span className="git-panel-spinner" aria-hidden />
            )}
          </div>
          <div className="git-log-sync">
            <span>{pullRequestsTotal} {t("git.open")}</span>
          </div>
        </>
      )}
      {(mode === "diff" || mode === "log") && !useUnifiedDiffSummary && !rootAlertText ? (
        <div className="diff-branch">{branchName || t("git.unknown")}</div>
      ) : null}
      {mode === "diff" ? (
        <div className="diff-list" onClick={handleDiffListClick}>
          {isGitRootPanelOpen && (
            <div className="git-root-panel" id="git-root-panel">
              <div className="git-root-toolbar">
                <div className="git-root-title">{t("git.chooseRepo")}</div>
                <div className="git-root-actions">
                  <button
                    type="button"
                    className="ghost git-root-button git-root-button--scan"
                    onClick={onScanGitRoots}
                    disabled={!onScanGitRoots || gitRootScanLoading}
                  >
                    <Search className="git-root-button-icon" aria-hidden />
                    {t("git.scanWorkspace")}
                  </button>
                  <label className="git-root-depth">
                    <span>{t("git.depth")}</span>
                    <select
                      className="git-root-select"
                      value={gitRootScanDepth}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          onGitRootScanDepthChange?.(value);
                        }
                      }}
                      disabled={gitRootScanLoading}
                    >
                      {DEPTH_OPTIONS.map((depth) => (
                        <option key={depth} value={depth}>
                          {depth}
                        </option>
                      ))}
                    </select>
                  </label>
                  {hasGitRoot && onClearGitRoot && (
                    <button
                      type="button"
                      className="ghost git-root-button git-root-button--workspace-root"
                      onClick={() => {
                        onClearGitRoot();
                        setIsGitRootPanelOpen(false);
                      }}
                      disabled={gitRootScanLoading}
                    >
                      <HardDrive className="git-root-button-icon" aria-hidden />
                      {t("git.useWorkspaceRoot")}
                    </button>
                  )}
                </div>
              </div>
              {gitRootScanLoading && (
                <div className="diff-empty">{t("git.scanningRepositories")}</div>
              )}
              {gitRootScanError && <div className="diff-error">{gitRootScanError}</div>}
              {!gitRootScanLoading &&
                !gitRootScanError &&
                gitRootScanHasScanned &&
                gitRootCandidates.length === 0 && (
                  <div className="diff-empty">{t("git.noRepositoriesFound")}</div>
                )}
              {gitRootCandidates.length > 0 && (
                <div className="git-root-list">
                  {gitRootCandidates.map((path) => {
                    const normalizedPath = normalizeRootPath(path);
                    const isActive =
                      normalizedGitRoot && normalizedGitRoot === normalizedPath;
                    return (
                    <button
                      key={path}
                      type="button"
                      className={`git-root-item ${isActive ? "active" : ""}`}
                      onClick={() => {
                        onSelectGitRoot?.(path);
                        setIsGitRootPanelOpen(false);
                      }}
                    >
                      <span className="git-root-path">{path}</span>
                      {isActive && <span className="git-root-tag">{t("git.active")}</span>}
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {showGenerateCommitMessage && !isCommitSectionCollapsed && (
            <div className="commit-message-section">
              <div className="commit-message-input-wrapper">
                <textarea
                  className="commit-message-input"
                  placeholder={t("git.commitMessage")}
                  value={commitMessage}
                  onChange={(e) => onCommitMessageChange?.(e.target.value)}
                  disabled={commitMessageLoading}
                  rows={2}
                />
                <button
                  type="button"
                  className={`commit-message-generate-button${commitMessageLoading ? " commit-message-generate-button--loading" : ""}`}
                  onClick={(event) => {
                    void showCommitMessageEngineMenu(event);
                  }}
                  disabled={commitMessageLoading || !canGenerateCommitMessage}
                  aria-haspopup="menu"
                  title={
                    stagedFiles.length > 0
                      ? t("git.generateCommitMessageStaged")
                      : t("git.generateCommitMessageUnstaged")
                  }
                  aria-label={t("git.generateCommitMessage")}
                >
                  <CommitMessageEngineIcon
                    engine={commitMessageMenuEngine}
                    size={14}
                    className={`commit-message-engine-icon${commitMessageLoading ? " commit-message-engine-icon--spinning" : ""}`}
                  />
                </button>
              </div>
              {commitMessageError && (
                <div className="commit-message-error">{commitMessageError}</div>
              )}
              {commitError && (
                <div className="commit-message-error">{commitError}</div>
              )}
              {pushError && (
                <div className="commit-message-error">{pushError}</div>
              )}
              {syncError && (
                <div className="commit-message-error">{syncError}</div>
              )}
              <CommitButton
                commitMessage={commitMessage}
                selectedCount={selectedCommitCount}
                hasAnyChanges={hasAnyChanges}
                commitLoading={commitLoading}
                selectedPaths={selectedCommitPaths}
                onCommit={onCommit}
              />
              <div className="commit-message-hint" aria-live="polite">
                {commitScopeHint}
              </div>
            </div>
          )}
          {/* Show Push button when there are commits to push */}
          {commitsAhead > 0 && !stagedFiles.length && (
            <div className="push-section">
              {pushError && (
                <div className="commit-message-error">{pushError}</div>
              )}
              <button
                type="button"
                className="push-button"
                onClick={() => void onPush?.()}
                disabled={pushLoading}
                title={t("git.pushCommits", { count: commitsAhead })}
              >
                {pushLoading ? (
                  <span className="commit-button-spinner" aria-hidden />
                ) : (
                  <Upload size={14} aria-hidden />
                )}
                <span>{t("git.pushButton")}</span>
                <span className="push-count">{commitsAhead}</span>
              </button>
            </div>
          )}
          {!error && !stagedFiles.length && !unstagedFiles.length && commitsAhead === 0 && (
            <div className="diff-empty">{t("git.noChangesDetected")}</div>
          )}
          {(stagedFiles.length > 0 || unstagedFiles.length > 0) && (
            <>
              {stagedFiles.length > 0 &&
                (gitDiffListView === "tree" ? (
                  <DiffTreeSection
                    title={t("git.staged")}
                    files={stagedFiles}
                    section="staged"
                    includedPaths={includedCommitPaths}
                    excludedPaths={excludedCommitPaths}
                    partialPaths={partialCommitPaths}
                    rootFolderName={repositoryRootName}
                    leadingMeta={primaryTreeSection === "staged" ? compactTreeMetaNode : undefined}
                    compactHeader={useCompactTreeSectionHeaders}
                    selectedFiles={selectedFiles}
                    selectedPath={selectedPath}
                    onSelectFile={onSelectFile}
                    onUnstageFile={onUnstageFile}
                    onDiscardFile={onRevertFile ? discardFile : undefined}
                    onDiscardFiles={onRevertFile ? discardFiles : undefined}
                    isCommitPathLocked={isCommitPathLocked}
                    onSetCommitSelection={setCommitSelection}
                    onFileClick={handleFileClick}
                    onOpenFilePreview={handleOpenFilePreview}
                    onShowFileMenu={showFileMenu}
                    collapsedFolders={collapsedFolders}
                    onToggleFolder={handleToggleFolder}
                  />
                ) : (
                  <DiffSection
                    title={t("git.staged")}
                    files={stagedFiles}
                    section="staged"
                    includedPaths={includedCommitPaths}
                    excludedPaths={excludedCommitPaths}
                    partialPaths={partialCommitPaths}
                    rootFolderName={repositoryRootName}
                    leadingMeta={primaryTreeSection === "staged" ? compactTreeMetaNode : undefined}
                    compactHeader={primaryTreeSection === "staged"}
                    selectedFiles={selectedFiles}
                    selectedPath={selectedPath}
                    onSelectFile={onSelectFile}
                    onUnstageFile={onUnstageFile}
                    onDiscardFile={onRevertFile ? discardFile : undefined}
                    onDiscardFiles={onRevertFile ? discardFiles : undefined}
                    isCommitPathLocked={isCommitPathLocked}
                    onSetCommitSelection={setCommitSelection}
                    onFileClick={handleFileClick}
                    onOpenFilePreview={handleOpenFilePreview}
                    onShowFileMenu={showFileMenu}
                  />
                ))}
              {unstagedFiles.length > 0 &&
                (gitDiffListView === "tree" ? (
                  <DiffTreeSection
                    title={t("git.unstaged")}
                    files={unstagedFiles}
                    section="unstaged"
                    includedPaths={includedCommitPaths}
                    excludedPaths={excludedCommitPaths}
                    partialPaths={partialCommitPaths}
                    rootFolderName={repositoryRootName}
                    leadingMeta={primaryTreeSection === "unstaged" ? compactTreeMetaNode : undefined}
                    compactHeader={useCompactTreeSectionHeaders}
                    selectedFiles={selectedFiles}
                    selectedPath={selectedPath}
                    onSelectFile={onSelectFile}
                    onStageAllChanges={onStageAllChanges}
                    onStageFile={onStageFile}
                    onDiscardFile={onRevertFile ? discardFile : undefined}
                    onDiscardFiles={onRevertFile ? discardFiles : undefined}
                    isCommitPathLocked={isCommitPathLocked}
                    onSetCommitSelection={setCommitSelection}
                    onFileClick={handleFileClick}
                    onOpenFilePreview={handleOpenFilePreview}
                    onShowFileMenu={showFileMenu}
                    collapsedFolders={collapsedFolders}
                    onToggleFolder={handleToggleFolder}
                  />
                ) : (
                  <DiffSection
                    title={t("git.unstaged")}
                    files={unstagedFiles}
                    section="unstaged"
                    includedPaths={includedCommitPaths}
                    excludedPaths={excludedCommitPaths}
                    partialPaths={partialCommitPaths}
                    rootFolderName={repositoryRootName}
                    leadingMeta={primaryTreeSection === "unstaged" ? compactTreeMetaNode : undefined}
                    compactHeader={primaryTreeSection === "unstaged"}
                    selectedFiles={selectedFiles}
                    selectedPath={selectedPath}
                    onSelectFile={onSelectFile}
                    onStageAllChanges={onStageAllChanges}
                    onStageFile={onStageFile}
                    onDiscardFile={onRevertFile ? discardFile : undefined}
                    onDiscardFiles={onRevertFile ? discardFiles : undefined}
                    isCommitPathLocked={isCommitPathLocked}
                    onSetCommitSelection={setCommitSelection}
                    onFileClick={handleFileClick}
                    onOpenFilePreview={handleOpenFilePreview}
                    onShowFileMenu={showFileMenu}
                  />
                ))}
            </>
          )}
        </div>
      ) : mode === "log" ? (
        <div className="git-log-list">
          {logError && <div className="diff-error">{logError}</div>}
          {!logError && logLoading && (
            <div className="diff-viewer-loading">{t("git.loadingCommits")}</div>
          )}
          {!logError &&
            !logLoading &&
            !logEntries.length &&
            !showAheadSection &&
            !showBehindSection && (
            <div className="diff-empty">{t("git.noCommitsYet")}</div>
          )}
          {showAheadSection && (
            <div className="git-log-section">
              <div className="git-log-section-title">{t("git.toPush")}</div>
              <div className="git-log-section-list">
                {logAheadEntries.map((entry) => {
                  const isSelected = selectedCommitSha === entry.sha;
                  return (
                    <GitLogEntryRow
                      key={entry.sha}
                      entry={entry}
                      isSelected={isSelected}
                      compact
                      onSelect={onSelectCommit}
                      onContextMenu={(event) => showLogMenu(event, entry)}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {showBehindSection && (
            <div className="git-log-section">
              <div className="git-log-section-title">{t("git.toPull")}</div>
              <div className="git-log-section-list">
                {logBehindEntries.map((entry) => {
                  const isSelected = selectedCommitSha === entry.sha;
                  return (
                    <GitLogEntryRow
                      key={entry.sha}
                      entry={entry}
                      isSelected={isSelected}
                      compact
                      onSelect={onSelectCommit}
                      onContextMenu={(event) => showLogMenu(event, entry)}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {(logEntries.length > 0 || logLoading) && (
            <div className="git-log-section">
              <div className="git-log-section-title">{t("git.recentCommits")}</div>
              <div className="git-log-section-list">
                {logEntries.map((entry) => {
                  const isSelected = selectedCommitSha === entry.sha;
                  return (
                    <GitLogEntryRow
                      key={entry.sha}
                      entry={entry}
                      isSelected={isSelected}
                      onSelect={onSelectCommit}
                      onContextMenu={(event) => showLogMenu(event, entry)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : mode === "issues" ? (
        <div className="git-issues-list">
          {issuesError && <div className="diff-error">{issuesError}</div>}
          {!issuesError && !issuesLoading && !issues.length && (
            <div className="diff-empty">{t("git.noOpenIssues")}</div>
          )}
          {issues.map((issue) => {
            const relativeTime = formatRelativeTime(new Date(issue.updatedAt).getTime());
            return (
              <a
                key={issue.number}
                className="git-issue-entry"
                href={issue.url}
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(issue.url);
                }}
              >
                <div className="git-issue-summary">
                  <span className="git-issue-title">
                    <span className="git-issue-number">#{issue.number}</span>{" "}
                    {issue.title}{" "}
                    <span className="git-issue-date">· {relativeTime}</span>
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="git-pr-list">
          {pullRequestsError && (
            <div className="diff-error">{pullRequestsError}</div>
          )}
          {!pullRequestsError &&
            !pullRequestsLoading &&
            !pullRequests.length && (
            <div className="diff-empty">{t("git.noOpenPullRequests")}</div>
          )}
          {pullRequests.map((pullRequest) => {
            const relativeTime = formatRelativeTime(
              new Date(pullRequest.updatedAt).getTime(),
            );
            const author = pullRequest.author?.login ?? t("git.unknown");
            const isSelected = selectedPullRequest === pullRequest.number;
            return (
              <div
                key={pullRequest.number}
                className={`git-pr-entry ${isSelected ? "active" : ""}`}
                onClick={() => onSelectPullRequest?.(pullRequest)}
                onContextMenu={(event) => showPullRequestMenu(event, pullRequest)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectPullRequest?.(pullRequest);
                  }
                }}
              >
                <div className="git-pr-header">
                  <span className="git-pr-title">
                    <span className="git-pr-number">#{pullRequest.number}</span>
                    <span className="git-pr-title-text">
                      {pullRequest.title}{" "}
                      <span className="git-pr-author-inline">@{author}</span>
                    </span>
                  </span>
                  <span className="git-pr-time">{relativeTime}</span>
                </div>
                <div className="git-pr-meta">
                  {pullRequest.isDraft && (
                    <span className="git-pr-pill git-pr-draft">{t("git.draft")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {previewFile && typeof document !== "undefined"
        ? createPortal(
            <div
              className="git-history-diff-modal-overlay is-popup"
              role="presentation"
              onClick={closePreviewModal}
            >
              <div
                className={`git-history-diff-modal ${isPreviewModalMaximized ? "is-maximized" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={previewFile.path}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="git-history-diff-modal-header">
                  <div className="git-history-diff-modal-title">
                    <span className={`git-history-file-status git-status-${previewFile.status.toLowerCase()}`}>
                      {previewFile.status}
                    </span>
                    <span className="git-history-tree-icon is-file" aria-hidden>
                      <FileIcon filePath={previewFile.path} />
                    </span>
                    <span className="git-history-diff-modal-path">{previewFile.path}</span>
                    <span className="git-history-diff-modal-stats">
                      <span className="is-add">+{previewFile.additions}</span>
                      <span className="is-sep">/</span>
                      <span className="is-del">-{previewFile.deletions}</span>
                    </span>
                  </div>
                  <div className="git-history-diff-modal-actions" ref={setPreviewHeaderControlsTarget}>
                    <button
                      type="button"
                      className="git-history-diff-modal-close"
                      onClick={() => setIsPreviewModalMaximized((value) => !value)}
                      aria-label={isPreviewModalMaximized ? t("common.restore") : t("menu.maximize")}
                      title={isPreviewModalMaximized ? t("common.restore") : t("menu.maximize")}
                    >
                      <span className="git-history-diff-modal-close-glyph" aria-hidden>
                        {isPreviewModalMaximized ? "❐" : "□"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="git-history-diff-modal-close"
                      onClick={closePreviewModal}
                      aria-label={t("common.close")}
                      title={t("common.close")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="git-history-diff-modal-viewer">
                  {previewDiffEntry ? (
                    <GitDiffViewer
                      workspaceId={workspaceId}
                      diffs={previewDiffEntries}
                      selectedPath={previewFile.path}
                      isLoading={false}
                      error={null}
                      listView="flat"
                      stickyHeaderMode="controls-only"
                      showContentModeControls
                      headerControlsTarget={previewHeaderControlsTarget}
                      fullDiffSourceKey={previewFile.path}
                      diffStyle={diffViewStyle}
                      onDiffStyleChange={onDiffViewStyleChange}
                    />
                  ) : (
                    <div className="diff-empty">{t("git.diffUnavailable")}</div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {discardDialogPaths ? (
        <div
          className="diff-danger-dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDiscardDialog();
            }
          }}
        >
          <div
            className="diff-danger-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("git.discardConfirmTitle")}
          >
            <div className="diff-danger-dialog-title">{t("git.discardConfirmTitle")}</div>
            <div className="diff-danger-dialog-copy">
              <p>{t("git.discardDialogBeginnerLead")}</p>
              <div className="diff-danger-dialog-list">
                <div className="diff-danger-dialog-list-title">{t("git.discardDialogAffectsLabel")}</div>
                <ul>
                  {discardDialogPaths.map((path) => (
                    <li key={path}>
                      <code className="diff-danger-dialog-file">{path}</code>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="diff-danger-dialog-note">
                <span className="diff-danger-dialog-keyword">{t("git.revertAllKeywordIrreversible")}</span>
                <span>{t("git.discardDialogBeginnerHint")}</span>
              </div>
            </div>
            <div className="diff-danger-dialog-actions">
              <button
                type="button"
                className="ghost"
                onClick={closeDiscardDialog}
                disabled={discardDialogSubmitting}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="diff-danger-dialog-confirm"
                onClick={() => void handleConfirmDiscardFiles()}
                disabled={discardDialogSubmitting}
              >
                {discardDialogSubmitting ? t("common.loading") : t("git.discardDialogConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
