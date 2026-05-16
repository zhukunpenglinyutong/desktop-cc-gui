import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import CircleCheckBig from "lucide-react/dist/esm/icons/circle-check-big";
import Minus from "lucide-react/dist/esm/icons/minus";
import Plus from "lucide-react/dist/esm/icons/plus";
import SquarePen from "lucide-react/dist/esm/icons/square-pen";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import FileIcon from "../../../components/FileIcon";
import { CommitMessageEngineIcon } from "../../git/components/CommitMessageEngineIcon";
import {
  CommitButton,
  useGitCommitSelection,
} from "../../git/components/GitDiffPanelCommitScope";
import {
  type InclusionState,
  InclusionToggle,
  getFileInclusionState,
} from "../../git/components/GitDiffPanelInclusion";
import { GitDiffPanelSectionActions } from "../../git/components/GitDiffPanelSectionActions";
import {
  type CommitMessageEngine,
  type CommitMessageLanguage,
  commitGit,
  generateCommitMessageWithEngine,
  getGitStatus,
  revertGitAll,
  revertGitFile,
  stageGitAll,
  stageGitFile,
  unstageGitFile,
} from "../../../services/tauri";
import type { GitFileStatus } from "../../../types";
import { sanitizeGeneratedCommitMessage } from "../../../utils/commitMessage";
import { localizeGitErrorMessage } from "../gitErrorI18n";
import { runScopedCommitOperation } from "../../git/utils/commitScope";
import {
  clampRendererContextMenuPosition,
  RendererContextMenu,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";

type GitHistoryWorktreePanelProps = {
  workspaceId: string;
  listView: "flat" | "tree";
  commitSectionCollapsed?: boolean;
  rootFolderName?: string;
  onMutated?: () => void | Promise<void>;
  onOpenDiffPath?: (path: string) => void;
  onSummaryChange?: (summary: {
    changedFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  }) => void;
};

type GitStatusState = {
  branchName: string;
  files: GitFileStatus[];
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  totalAdditions: number;
  totalDeletions: number;
};

type DiffSection = "staged" | "unstaged";

type DiffTreeNode = {
  key: string;
  name: string;
  path: string;
  descendantPaths: string[];
  folders: Map<string, DiffTreeNode>;
  files: GitFileStatus[];
};

type CollapsedFolder = {
  key: string;
  name: string;
  iconName: string;
  node: DiffTreeNode;
};

const EMPTY_STATUS: GitStatusState = {
  branchName: "",
  files: [],
  stagedFiles: [],
  unstagedFiles: [],
  totalAdditions: 0,
  totalDeletions: 0,
};

function splitPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) {
    return { name: "", dir: "" };
  }
  if (parts.length <= 1) {
    return { name: parts[0] ?? "", dir: "" };
  }
  return { name: parts[parts.length - 1], dir: parts.slice(0, -1).join("/") };
}

function getPathLeafName(path: string | null | undefined): string {
  if (!path) {
    return "";
  }
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function statusSymbol(status: string) {
  switch (status) {
    case "A":
      return "(A)";
    case "M":
      return "(U)";
    case "D":
      return "(D)";
    case "R":
      return "(R)";
    case "T":
      return "(T)";
    default:
      return "(?)";
  }
}

function diffStatusClass(status: string) {
  switch (status) {
    case "A":
      return "diff-icon-added";
    case "M":
      return "diff-icon-modified";
    case "D":
      return "diff-icon-deleted";
    case "R":
      return "diff-icon-renamed";
    case "T":
      return "diff-icon-typechange";
    default:
      return "diff-icon-unknown";
  }
}

function hasToggleablePaths(
  paths: string[],
  isCommitPathLocked: (path: string) => boolean,
) {
  return paths.some((path) => !isCommitPathLocked(path));
}

function getToggleablePaths(
  paths: string[],
  isCommitPathLocked: (path: string) => boolean,
) {
  return paths.filter((path) => !isCommitPathLocked(path));
}

function getTreeLineOpacity(depth: number): string {
  return depth === 1 ? "1" : "0";
}

function buildDiffTree(files: GitFileStatus[], section: DiffSection): DiffTreeNode {
  const root: DiffTreeNode = {
    key: `${section}:/`,
    name: "",
    path: "",
    descendantPaths: [],
    folders: new Map(),
    files: [],
  };

  for (const file of files) {
    const parts = file.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    root.descendantPaths.push(file.path);
    let node = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index] ?? "";
      const key = `${node.key}${segment}/`;
      let child = node.folders.get(segment);
      if (!child) {
        child = {
          key,
          name: segment,
          path: node.path ? `${node.path}/${segment}` : segment,
          descendantPaths: [],
          folders: new Map(),
          files: [],
        };
        node.folders.set(segment, child);
      }
      child.descendantPaths.push(file.path);
      node = child;
    }
    node.files.push(file);
  }

  return root;
}

function collapseFolderChain(node: DiffTreeNode): CollapsedFolder {
  return {
    key: node.key,
    name: node.name,
    iconName: node.name,
    node,
  };
}

function normalizeErrorMessage(
  raw: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const localized = localizeGitErrorMessage(raw, t);
  if (!raw) {
    return localized;
  }
  const isCodexRequired =
    raw.includes("requires the Codex CLI") || raw.includes("workspace not connected");
  if (isCodexRequired) {
    return t("git.commitMessageRequiresCodex");
  }
  return localized;
}

function renderSectionIndicator(
  section: DiffSection,
  count: number,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const label = section === "staged" ? t("git.staged") : t("git.unstaged");
  const Icon = section === "staged" ? CircleCheckBig : SquarePen;
  return (
    <span
      className={`git-history-worktree-section-indicator inline-flex items-center gap-1 whitespace-nowrap leading-none [&_svg]:block [&_svg]:w-3 [&_svg]:h-3 [&_strong]:text-[12px] [&_strong]:leading-none is-${section}${section === "staged" ? " text-[color-mix(in_srgb,var(--status-success,#47d488)_78%,var(--text-primary))]" : " text-[color-mix(in_srgb,var(--text-secondary)_88%,var(--text-primary))]"}`}
      aria-label={`${label} (${count})`}
      title={label}
    >
      <Icon size={12} aria-hidden />
      <strong>{count}</strong>
    </span>
  );
}

function getGroupInclusionState(
  paths: string[],
  includedPaths: Set<string>,
  excludedPaths: Set<string>,
  partialPaths: Set<string>,
): InclusionState {
  if (paths.length === 0) {
    return "none";
  }
  let hasIncluded = false;
  let hasExcluded = false;
  for (const path of paths) {
    const state = getFileInclusionState(
      path,
      includedPaths,
      excludedPaths,
      partialPaths,
    );
    if (state === "partial") {
      return "partial";
    }
    if (state === "all") {
      hasIncluded = true;
    } else {
      hasExcluded = true;
    }
    if (hasIncluded && hasExcluded) {
      return "partial";
    }
  }
  return hasIncluded ? "all" : "none";
}

export function GitHistoryWorktreePanel({
  workspaceId,
  listView,
  commitSectionCollapsed = false,
  rootFolderName,
  onMutated,
  onOpenDiffPath,
  onSummaryChange,
}: GitHistoryWorktreePanelProps) {
  const { t } = useTranslation();
  const requestIdRef = useRef(0);
  const resolvedRootFolderName = useMemo(
    () => rootFolderName?.trim() || getPathLeafName(workspaceId) || workspaceId,
    [rootFolderName, workspaceId],
  );

  const [status, setStatus] = useState<GitStatusState>(EMPTY_STATUS);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [discardDialogPaths, setDiscardDialogPaths] = useState<string[] | null>(null);
  const [discardAllDialogOpen, setDiscardAllDialogOpen] = useState(false);

  const [commitMessage, setCommitMessage] = useState("");
  const [commitMessageLoading, setCommitMessageLoading] = useState(false);
  const [commitMessageError, setCommitMessageError] = useState<string | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitMessageMenuEngine, setCommitMessageMenuEngine] = useState<CommitMessageEngine>("claude");
  const [commitMessageContextMenu, setCommitMessageContextMenu] =
    useState<RendererContextMenuState | null>(null);
  const deferredCommitLanguageMenuTimerRef = useRef<number | null>(null);

  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const refreshStatus = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    try {
      const next = await getGitStatus(workspaceId);
      if (requestIdRef.current !== requestId) {
        return;
      }
      setStatus({
        branchName: next.branchName,
        files: next.files,
        stagedFiles: next.stagedFiles,
        unstagedFiles: next.unstagedFiles,
        totalAdditions: next.totalAdditions,
        totalDeletions: next.totalDeletions,
      });
      onSummaryChange?.({
        changedFiles: next.files.length,
        totalAdditions: next.totalAdditions,
        totalDeletions: next.totalDeletions,
      });
      setStatusError(null);
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStatusError(message);
    }
  }, [onSummaryChange, workspaceId]);

  useEffect(() => {
    requestIdRef.current += 1;
    setStatus(EMPTY_STATUS);
    setStatusError(null);
    setOperationError(null);
    setCommitMessageError(null);
    setDiscardDialogPaths(null);
    setCollapsedFolders(new Set());
    setDiscardAllDialogOpen(false);
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshStatus, workspaceId]);

  useEffect(() => {
    return () => {
      if (deferredCommitLanguageMenuTimerRef.current !== null) {
        window.clearTimeout(deferredCommitLanguageMenuTimerRef.current);
        deferredCommitLanguageMenuTimerRef.current = null;
      }
    };
  }, []);

  const handleMutation = useCallback(
    async (operation: () => Promise<unknown> | void) => {
      setOperationError(null);
      setOperationLoading(true);
      try {
        await operation();
        await refreshStatus();
        await onMutated?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setOperationError(message);
      } finally {
        setOperationLoading(false);
      }
    },
    [onMutated, refreshStatus],
  );

  const discardFiles = useCallback(
    async (paths: string[]) => {
      if (!paths.length) {
        return;
      }
      if (operationLoading) {
        return;
      }
      setDiscardDialogPaths(paths);
    },
    [operationLoading],
  );

  const handleConfirmDiscardFiles = useCallback(async () => {
    if (operationLoading || !discardDialogPaths || discardDialogPaths.length === 0) {
      return;
    }
    const targetPaths = [...discardDialogPaths];
    setDiscardDialogPaths(null);
    await handleMutation(async () => {
      for (const path of targetPaths) {
        await revertGitFile(workspaceId, path);
      }
    });
  }, [discardDialogPaths, handleMutation, operationLoading, workspaceId]);

  const handleDiscardAll = useCallback(() => {
    if (operationLoading || status.unstagedFiles.length === 0) {
      return;
    }
    setDiscardAllDialogOpen(true);
  }, [operationLoading, status.unstagedFiles.length]);

  const handleConfirmDiscardAll = useCallback(async () => {
    if (operationLoading) {
      return;
    }
    setDiscardAllDialogOpen(false);
    await handleMutation(() => revertGitAll(workspaceId));
  }, [handleMutation, operationLoading, workspaceId]);

  const hasWorktreeChanges = status.stagedFiles.length > 0 || status.unstagedFiles.length > 0;
  const stagedFiles = useMemo(
    () => status.stagedFiles.slice().sort((left, right) => left.path.localeCompare(right.path)),
    [status.stagedFiles],
  );
  const unstagedFiles = useMemo(
    () => status.unstagedFiles.slice().sort((left, right) => left.path.localeCompare(right.path)),
    [status.unstagedFiles],
  );
  const {
    selectedCommitPaths,
    selectedCommitCount,
    hasExplicitCommitSelection,
    includedCommitPaths,
    excludedCommitPaths,
    partialCommitPaths,
    isCommitPathLocked,
    setCommitSelection,
  } = useGitCommitSelection({
    stagedFiles,
    unstagedFiles,
  });
  const includedCommitPathSet = useMemo(
    () => new Set(includedCommitPaths),
    [includedCommitPaths],
  );
  const excludedCommitPathSet = useMemo(
    () => new Set(excludedCommitPaths),
    [excludedCommitPaths],
  );
  const partialCommitPathSet = useMemo(
    () => new Set(partialCommitPaths),
    [partialCommitPaths],
  );
  const stagedFilePaths = useMemo(
    () => stagedFiles.map((file) => file.path),
    [stagedFiles],
  );
  const unstagedFilePaths = useMemo(
    () => unstagedFiles.map((file) => file.path),
    [unstagedFiles],
  );
  const stagedToggleablePaths = useMemo(
    () => stagedFilePaths.filter((path) => !isCommitPathLocked(path)),
    [isCommitPathLocked, stagedFilePaths],
  );
  const unstagedToggleablePaths = useMemo(
    () => unstagedFilePaths.filter((path) => !isCommitPathLocked(path)),
    [isCommitPathLocked, unstagedFilePaths],
  );
  const stagedSectionInclusionState = useMemo(
    () =>
      getGroupInclusionState(
        stagedFilePaths,
        includedCommitPathSet,
        excludedCommitPathSet,
        partialCommitPathSet,
      ),
    [
      excludedCommitPathSet,
      includedCommitPathSet,
      partialCommitPathSet,
      stagedFilePaths,
    ],
  );
  const unstagedSectionInclusionState = useMemo(
    () =>
      getGroupInclusionState(
        unstagedFilePaths,
        includedCommitPathSet,
        excludedCommitPathSet,
        partialCommitPathSet,
      ),
    [
      excludedCommitPathSet,
      includedCommitPathSet,
      partialCommitPathSet,
      unstagedFilePaths,
    ],
  );
  const hasStagedFiles = stagedFiles.length > 0;
  const hasUnstagedFiles = unstagedFiles.length > 0;

  const handleGenerateCommitMessage = useCallback(
    async (
      language: CommitMessageLanguage = "zh",
      engine: CommitMessageEngine = "codex",
      selectedPaths?: string[],
    ) => {
      if (commitMessageLoading || commitLoading) {
        return;
      }
      setCommitMessageError(null);
      setCommitMessageLoading(true);
      try {
        const generated = await generateCommitMessageWithEngine(
          workspaceId,
          language,
          engine,
          selectedPaths,
        );
        setCommitMessage(sanitizeGeneratedCommitMessage(generated));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setCommitMessageError(message);
      } finally {
        setCommitMessageLoading(false);
      }
    },
    [commitLoading, commitMessageLoading, workspaceId],
  );

  const showCommitMessageLanguageMenu = useCallback(
    (engine: CommitMessageEngine, position: { x: number; y: number }) => {
      if (commitMessageLoading || commitLoading || operationLoading) {
        return;
      }
      const selectedPathsForGeneration =
        selectedCommitCount > 0
          ? selectedCommitPaths
          : hasExplicitCommitSelection
            ? []
            : undefined;
      setCommitMessageContextMenu({
        ...position,
        label: t("git.generateCommitMessage"),
        items: [
          {
            type: "item",
            id: "commit-message-zh",
            label: t("git.generateCommitMessageChinese"),
            onSelect: async () => {
              setCommitMessageMenuEngine(engine);
              await handleGenerateCommitMessage("zh", engine, selectedPathsForGeneration);
            },
          },
          {
            type: "item",
            id: "commit-message-en",
            label: t("git.generateCommitMessageEnglish"),
            onSelect: async () => {
              setCommitMessageMenuEngine(engine);
              await handleGenerateCommitMessage("en", engine, selectedPathsForGeneration);
            },
          },
        ],
      });
    },
    [
      commitLoading,
      commitMessageLoading,
      handleGenerateCommitMessage,
      operationLoading,
      selectedCommitCount,
      selectedCommitPaths,
      hasExplicitCommitSelection,
      t,
    ],
  );
  const showCommitMessageEngineMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (commitMessageLoading || commitLoading || operationLoading) {
        return;
      }
      const position = clampRendererContextMenuPosition(event.clientX, event.clientY, {
        width: 260,
        height: 180,
      });
      const engineItems: Array<{ engine: CommitMessageEngine; label: string }> = [
        { engine: "codex", label: t("git.generateCommitMessageEngineCodex") },
        { engine: "claude", label: t("git.generateCommitMessageEngineClaude") },
        { engine: "gemini", label: t("git.generateCommitMessageEngineGemini") },
        { engine: "opencode", label: t("git.generateCommitMessageEngineOpenCode") },
      ];
      setCommitMessageContextMenu({
        ...position,
        label: t("git.generateCommitMessage"),
        items: engineItems.map(({ engine, label }) => ({
          type: "item",
          id: `commit-message-engine-${engine}`,
          label,
          onSelect: () => {
            if (deferredCommitLanguageMenuTimerRef.current !== null) {
              window.clearTimeout(deferredCommitLanguageMenuTimerRef.current);
            }
            deferredCommitLanguageMenuTimerRef.current = window.setTimeout(() => {
              deferredCommitLanguageMenuTimerRef.current = null;
              showCommitMessageLanguageMenu(engine, position);
            }, 0);
          },
        })),
      });
    },
    [commitLoading, commitMessageLoading, operationLoading, showCommitMessageLanguageMenu, t],
  );
  const handleCommit = useCallback(
    async (selectedPaths?: string[]) => {
      if (
        commitLoading ||
        operationLoading ||
        commitMessageLoading ||
        !commitMessage.trim()
      ) {
        return;
      }
      setCommitMessageError(null);
      setCommitLoading(true);
      try {
        const result = await runScopedCommitOperation({
          workspaceId,
          gitStatus: {
            stagedFiles: status.stagedFiles,
            unstagedFiles: status.unstagedFiles,
          },
          selectedPaths: selectedPaths ?? selectedCommitPaths,
          commitMessage,
          stageFile: stageGitFile,
          unstageFile: unstageGitFile,
          commit: commitGit,
          formatRestoreSelectionFailed: (error) =>
            t("git.commitRestoreSelectionFailed", { error }),
        });
        if (!result.committed) {
          return;
        }
        setCommitMessage("");
        await refreshStatus();
        await onMutated?.();
        if (result.postCommitError) {
          setCommitMessageError(result.postCommitError);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setCommitMessageError(message);
      } finally {
        setCommitLoading(false);
      }
    },
    [
      commitLoading,
      commitMessage,
      commitMessageLoading,
      onMutated,
      operationLoading,
      refreshStatus,
      selectedCommitPaths,
      status.stagedFiles,
      status.unstagedFiles,
      t,
      workspaceId,
    ],
  );
  const revertAllPreviewPaths = useMemo(
    () => status.files.map((file) => file.path).slice().sort((left, right) => left.localeCompare(right)),
    [status.files],
  );

  const statusErrorText = normalizeErrorMessage(statusError, t);
  const operationErrorText = normalizeErrorMessage(operationError, t);
  const commitMessageErrorText = normalizeErrorMessage(commitMessageError, t);
  const shouldShowFileSections = hasStagedFiles || hasUnstagedFiles;
  const worktreeSectionsClassName = `git-history-worktree-sections min-h-0 flex-1 overflow-auto flex flex-col gap-[10px] pb-2${
    hasStagedFiles !== hasUnstagedFiles ? " is-single overflow-hidden" : ""
  }`;
  const visibleSectionCount = Number(hasStagedFiles) + Number(hasUnstagedFiles);
  const compactSection =
    visibleSectionCount === 1
      ? hasStagedFiles
        ? "staged"
        : "unstaged"
      : null;
  const compactSummaryLabel =
    compactSection === "staged"
      ? renderSectionIndicator("staged", stagedFiles.length, t)
      : compactSection === "unstaged"
        ? renderSectionIndicator("unstaged", unstagedFiles.length, t)
        : null;
  const compactSummaryBranch = status.branchName || resolvedRootFolderName;
  const commitStatusHint = selectedCommitCount > 0
    ? t("git.selectedFilesForCommit", { count: selectedCommitCount })
    : hasWorktreeChanges
      ? t("git.selectFilesToCommit")
      : t("git.noChangesToCommit");

  const toggleFolder = useCallback((key: string) => {
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

  const renderFileRow = useCallback(
    (file: GitFileStatus, section: DiffSection, depth = 0) => {
      const { name, dir } = splitPath(file.path);
      const showStage = section === "unstaged";
      const showUnstage = section === "staged";
      const showDiscard = section === "unstaged";
      const clickable = Boolean(onOpenDiffPath);
      const inclusionState = getFileInclusionState(
        file.path,
        includedCommitPathSet,
        excludedCommitPathSet,
        partialCommitPathSet,
      );
      const treeIndentPx = depth * 16;
      const treeRowStyle =
        listView === "tree"
          ? ({
              paddingLeft: `${treeIndentPx}px`,
              ["--git-tree-indent-x" as string]: `${Math.max(treeIndentPx - 7, 0)}px`,
              ["--git-tree-line-opacity" as string]: getTreeLineOpacity(depth),
            } as CSSProperties)
          : undefined;
      return (
        <div
          key={`${section}:${file.path}`}
          className={`git-history-worktree-file-row diff-row git-filetree-row w-full min-h-[var(--git-filetree-row-min-height)] border border-transparent rounded-[var(--git-filetree-row-radius)] bg-transparent text-[color:var(--text-primary)] relative hover:bg-[var(--git-filetree-row-hover-bg)] grid items-center [grid-template-columns:20px_26px_14px_minmax(0,1fr)_auto] gap-[var(--git-filetree-row-gap)] py-[var(--git-filetree-row-pad-y)] px-[var(--git-filetree-row-pad-x)] ${listView === "tree" ? "is-tree" : ""} ${
            clickable ? "is-clickable cursor-pointer focus-visible:outline focus-visible:outline-[1px] focus-visible:outline-[color-mix(in_srgb,var(--accent-primary,#2563eb)_62%,transparent)] focus-visible:outline-offset-[-1px]" : ""
          }`}
          data-status={file.status}
          data-section={section}
          style={treeRowStyle}
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={() => {
            onOpenDiffPath?.(file.path);
          }}
          onKeyDown={(event) => {
            if (!clickable) {
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenDiffPath?.(file.path);
            }
          }}
        >
          <InclusionToggle
            state={inclusionState}
            label={t("git.commitSelectionToggleFile", { path: file.path })}
            className="diff-row-selection"
            disabled={isCommitPathLocked(file.path)}
            stopPropagation
            onToggle={() => {
              setCommitSelection([file.path], inclusionState !== "all");
            }}
          />
          <span
            className={`git-history-worktree-file-status diff-icon text-[color:var(--git-worktree-file-status-color)] w-6 text-[10px] font-semibold font-[var(--code-font-family,monospace)] leading-none ${diffStatusClass(file.status)}`}
            aria-hidden
          >
            {statusSymbol(file.status)}
          </span>
          <span className="git-history-worktree-file-icon diff-file-icon w-4 h-4 inline-flex items-center justify-center" aria-hidden>
            <FileIcon filePath={file.path} />
          </span>
          <span className="git-history-worktree-file-path diff-file min-w-0 inline-flex items-baseline gap-[6px] overflow-hidden" title={file.path}>
            <span className="diff-path">
              <span className="diff-name">
                <span className="diff-name-base">{name}</span>
              </span>
            </span>
            {listView === "tree" || !dir ? null : <span className="diff-dir">{dir}</span>}
          </span>
          <span className="diff-row-meta">
            <span
              className="git-history-worktree-file-stats diff-counts-inline git-filetree-badge whitespace-nowrap text-[var(--git-filetree-badge-font-size)] inline-flex items-center gap-[var(--git-filetree-badge-gap)] py-[var(--git-filetree-badge-pad-y)] px-[var(--git-filetree-badge-pad-x)] min-h-[18px] rounded-[var(--git-filetree-badge-radius)] border border-[color-mix(in_srgb,var(--border-default)_58%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_64%,transparent)] font-[var(--code-font-family)] tabular-nums"
              aria-label={`+${file.additions} -${file.deletions}`}
            >
              <span className="is-add text-[#22c55e]">+{file.additions}</span>
              <span className="is-sep text-[color:var(--text-muted)]">/</span>
              <span className="is-del text-[#f87171]">-{file.deletions}</span>
            </span>
            <span
              className="git-history-worktree-file-actions diff-row-actions inline-flex items-center gap-1"
              role="group"
              aria-label={t("git.fileActions")}
            >
              {showStage ? (
                <button
                  type="button"
                  className="git-history-worktree-action git-history-worktree-action-stage diff-row-action diff-row-action--stage w-5 h-5 rounded-[6px] border border-[color-mix(in_srgb,var(--border-default)_68%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_68%,transparent)] text-[color:var(--text-muted)] inline-flex items-center justify-center cursor-pointer hover:not-disabled:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_55%,transparent)] hover:not-disabled:border-[color-mix(in_srgb,var(--border-default)_88%,transparent)] hover:not-disabled:text-[#22c55e] [&_svg]:block [&_svg]:w-[14px] [&_svg]:h-[14px] disabled:opacity-[0.45] disabled:cursor-not-allowed"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleMutation(() => stageGitFile(workspaceId, file.path));
                  }}
                  disabled={operationLoading}
                  title={t("git.stageFile")}
                  aria-label={t("git.stageFile")}
                >
                  <Plus size={12} aria-hidden />
                </button>
              ) : null}
              {showUnstage ? (
                <button
                  type="button"
                  className="git-history-worktree-action git-history-worktree-action-unstage diff-row-action diff-row-action--unstage w-5 h-5 rounded-[6px] border border-[color-mix(in_srgb,var(--border-default)_68%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_68%,transparent)] text-[color:var(--text-muted)] inline-flex items-center justify-center cursor-pointer hover:not-disabled:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_55%,transparent)] hover:not-disabled:border-[color-mix(in_srgb,var(--border-default)_88%,transparent)] hover:not-disabled:text-[#f87171] [&_svg]:block [&_svg]:w-[14px] [&_svg]:h-[14px] disabled:opacity-[0.45] disabled:cursor-not-allowed"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleMutation(() => unstageGitFile(workspaceId, file.path));
                  }}
                  disabled={operationLoading}
                  title={t("git.unstageFile")}
                  aria-label={t("git.unstageFile")}
                >
                  <Minus size={12} aria-hidden />
                </button>
              ) : null}
              {showDiscard ? (
                <button
                  type="button"
                  className="git-history-worktree-action git-history-worktree-action-discard diff-row-action diff-row-action--discard w-5 h-5 rounded-[6px] border border-[color-mix(in_srgb,var(--border-default)_68%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_68%,transparent)] text-[color:var(--text-muted)] inline-flex items-center justify-center cursor-pointer hover:not-disabled:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_55%,transparent)] hover:not-disabled:border-[color-mix(in_srgb,var(--border-default)_88%,transparent)] hover:not-disabled:text-[#f87171] [&_svg]:block [&_svg]:w-[14px] [&_svg]:h-[14px] disabled:opacity-[0.45] disabled:cursor-not-allowed"
                  onClick={(event) => {
                    event.stopPropagation();
                    void discardFiles([file.path]);
                  }}
                  disabled={operationLoading}
                  title={t("git.discardFile")}
                  aria-label={t("git.discardFile")}
                >
                  <Undo2 size={12} aria-hidden />
                </button>
              ) : null}
            </span>
          </span>
        </div>
      );
    },
    [
      discardFiles,
      excludedCommitPathSet,
      handleMutation,
      includedCommitPathSet,
      isCommitPathLocked,
      listView,
      onOpenDiffPath,
      operationLoading,
      partialCommitPathSet,
      setCommitSelection,
      t,
      workspaceId,
    ],
  );

  const renderTreeRows = useCallback(
    (files: GitFileStatus[], section: DiffSection) => {
      const tree = buildDiffTree(files, section);
      const rootFolderKey = `${section}:__repo_root__/`;
      const rootCollapsed = collapsedFolders.has(rootFolderKey);
      const rootFolderPaths = tree.descendantPaths;
      const rootFolderInclusionState = getGroupInclusionState(
        rootFolderPaths,
        includedCommitPathSet,
        excludedCommitPathSet,
        partialCommitPathSet,
      );
      const rootHasToggleablePaths = hasToggleablePaths(
        rootFolderPaths,
        isCommitPathLocked,
      );
      const walk = (node: DiffTreeNode, depth: number): ReactNode[] => {
        const rows: ReactNode[] = [];
        const folders = Array.from(node.folders.values()).sort((a, b) => a.name.localeCompare(b.name));
        for (const folder of folders) {
          const collapsedFolder = collapseFolderChain(folder);
          const collapsed = collapsedFolders.has(collapsedFolder.key);
          const descendantPaths = collapsedFolder.node.descendantPaths;
          const folderInclusionState = getGroupInclusionState(
            descendantPaths,
            includedCommitPathSet,
            excludedCommitPathSet,
            partialCommitPathSet,
          );
          const folderHasToggleablePaths = hasToggleablePaths(
            descendantPaths,
            isCommitPathLocked,
          );
          const treeIndentPx = depth * 16;
          const folderStyle = {
            paddingLeft: `${treeIndentPx}px`,
            ["--git-tree-indent-x" as string]: `${Math.max(treeIndentPx - 7, 0)}px`,
            ["--git-tree-line-opacity" as string]: getTreeLineOpacity(depth),
          } as CSSProperties;
          const childTreeStyle = {
            ["--git-tree-branch-x" as string]: `${Math.max((depth + 1) * 16 - 7, 0)}px`,
            ["--git-tree-branch-opacity" as string]: getTreeLineOpacity(depth + 1),
          } as CSSProperties;
          rows.push(
            <div key={collapsedFolder.key} className="git-history-worktree-folder-group flex flex-col gap-[var(--git-filetree-section-gap)]">
              <div
                className="git-history-worktree-folder-row diff-tree-folder-row git-filetree-folder-row w-full min-h-[var(--git-filetree-row-min-height)] border border-transparent rounded-[var(--git-filetree-row-radius)] bg-transparent text-[color:var(--text-secondary)] inline-flex items-center gap-[var(--git-filetree-row-gap)] py-[var(--git-filetree-row-pad-y)] px-[var(--git-filetree-row-pad-x)] cursor-pointer relative text-[13px] font-[560] hover:bg-[var(--git-filetree-row-hover-bg)]"
                style={folderStyle}
                role="button"
                tabIndex={0}
                onClick={() => toggleFolder(collapsedFolder.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleFolder(collapsedFolder.key);
                  }
                }}
              >
                <InclusionToggle
                  state={folderInclusionState}
                  label={t("git.commitSelectionToggleScope", {
                    path: collapsedFolder.node.path || collapsedFolder.name,
                  })}
                  className="git-commit-scope-toggle--folder"
                  disabled={!folderHasToggleablePaths}
                  stopPropagation
                  onToggle={() => {
                    setCommitSelection(
                      getToggleablePaths(descendantPaths, isCommitPathLocked),
                      folderInclusionState !== "all",
                    );
                  }}
                />
                <span className="git-history-worktree-folder-caret diff-tree-folder-toggle w-[var(--git-filetree-icon-size)] inline-flex items-center justify-center text-[color-mix(in_srgb,var(--text-muted)_88%,transparent)]" aria-hidden>
                  {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </span>
                <FileIcon
                  filePath={collapsedFolder.iconName}
                  isFolder
                  isOpen={!collapsed}
                  className="git-history-worktree-folder-icon diff-tree-folder-icon w-4 h-4 inline-flex items-center justify-center flex-shrink-0 [&_svg]:w-4 [&_svg]:h-4"
                />
                <span className="git-history-worktree-folder-name diff-tree-folder-name min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[560] text-[color:var(--text-stronger)]">{collapsedFolder.name}</span>
              </div>
              {!collapsed ? (
                <div
                  className="git-history-worktree-folder-children diff-tree-folder-children relative flex flex-col gap-[var(--git-filetree-section-gap)] before:content-[''] before:absolute before:left-[var(--git-tree-branch-x,calc(var(--git-filetree-row-pad-x)-3px))] before:top-0 before:bottom-0 before:w-[1.25px] before:bg-[var(--git-filetree-tree-line-color)] before:opacity-[var(--git-tree-branch-opacity,0.62)] before:pointer-events-none"
                  style={childTreeStyle}
                >
                  {walk(collapsedFolder.node, depth + 1)}
                </div>
              ) : null}
            </div>,
          );
        }

        const leafFiles = node.files.slice().sort((a, b) => a.path.localeCompare(b.path));
        for (const file of leafFiles) {
          rows.push(renderFileRow(file, section, depth));
        }

        return rows;
      };

      const rootChildrenStyle = {
        ["--git-tree-branch-x" as string]: `${Math.max(1 * 16 - 7, 0)}px`,
        ["--git-tree-branch-opacity" as string]: getTreeLineOpacity(1),
      } as CSSProperties;

      return [
        <div key={rootFolderKey} className="git-history-worktree-folder-group flex flex-col gap-[var(--git-filetree-section-gap)]">
          <div
            className="git-history-worktree-folder-row diff-tree-folder-row git-filetree-folder-row w-full min-h-[var(--git-filetree-row-min-height)] border border-transparent rounded-[var(--git-filetree-row-radius)] bg-transparent text-[color:var(--text-secondary)] inline-flex items-center gap-[var(--git-filetree-row-gap)] py-[var(--git-filetree-row-pad-y)] px-[var(--git-filetree-row-pad-x)] cursor-pointer relative text-[13px] font-[560] hover:bg-[var(--git-filetree-row-hover-bg)]"
            style={{ paddingLeft: "0px" }}
            role="button"
            tabIndex={0}
            onClick={() => toggleFolder(rootFolderKey)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleFolder(rootFolderKey);
              }
            }}
          >
            <InclusionToggle
              state={rootFolderInclusionState}
              label={t("git.commitSelectionToggleScope", {
                path: resolvedRootFolderName,
              })}
              className="git-commit-scope-toggle--folder"
              disabled={!rootHasToggleablePaths}
              stopPropagation
              onToggle={() => {
                setCommitSelection(
                  getToggleablePaths(rootFolderPaths, isCommitPathLocked),
                  rootFolderInclusionState !== "all",
                );
              }}
            />
            <span className="git-history-worktree-folder-caret diff-tree-folder-toggle w-[var(--git-filetree-icon-size)] inline-flex items-center justify-center text-[color-mix(in_srgb,var(--text-muted)_88%,transparent)]" aria-hidden>
              {rootCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </span>
            <FileIcon
              filePath={resolvedRootFolderName}
              isFolder
              isOpen={!rootCollapsed}
              className="git-history-worktree-folder-icon diff-tree-folder-icon w-4 h-4 inline-flex items-center justify-center flex-shrink-0 [&_svg]:w-4 [&_svg]:h-4"
            />
            <span className="git-history-worktree-folder-name diff-tree-folder-name min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[560] text-[color:var(--text-stronger)]">{resolvedRootFolderName}</span>
          </div>
          {!rootCollapsed ? (
            <div
              className="git-history-worktree-folder-children diff-tree-folder-children relative flex flex-col gap-[var(--git-filetree-section-gap)] before:content-[''] before:absolute before:left-[var(--git-tree-branch-x,calc(var(--git-filetree-row-pad-x)-3px))] before:top-0 before:bottom-0 before:w-[1.25px] before:bg-[var(--git-filetree-tree-line-color)] before:opacity-[var(--git-tree-branch-opacity,0.62)] before:pointer-events-none"
              style={rootChildrenStyle}
            >
              {walk(tree, 1)}
            </div>
          ) : null}
        </div>,
      ];
    },
    [
      collapsedFolders,
      excludedCommitPathSet,
      includedCommitPathSet,
      isCommitPathLocked,
      partialCommitPathSet,
      renderFileRow,
      resolvedRootFolderName,
      setCommitSelection,
      t,
      toggleFolder,
    ],
  );

  const renderSectionRows = useCallback(
    (files: GitFileStatus[], section: DiffSection) => {
      if (!files.length) {
        return <div className="git-history-empty">{t("git.noChangesDetected")}</div>;
      }
      if (listView === "tree") {
        return renderTreeRows(files, section);
      }
      return files.map((file) => renderFileRow(file, section));
    },
    [listView, renderFileRow, renderTreeRows, t],
  );

  return (
    <div className="git-history-worktree-panel flex flex-col gap-[10px] min-h-0 flex-1">
      {/* data-status CSS variable rules cannot be expressed in Tailwind — kept as scoped style */}
      <style>{`
        .git-history-worktree-file-row { --git-worktree-file-status-color: var(--text-primary); }
        .git-history-worktree-file-row[data-status="A"] { --git-worktree-file-status-color: color-mix(in srgb, var(--status-success, #22c55e) 88%, var(--text-primary) 12%); }
        .git-history-worktree-file-row[data-status="M"] { --git-worktree-file-status-color: color-mix(in srgb, var(--text-accent, #60a5fa) 92%, var(--text-primary) 8%); }
        .git-history-worktree-file-row[data-status="D"] { --git-worktree-file-status-color: color-mix(in srgb, var(--status-error, #f87171) 88%, var(--text-primary) 12%); }
        .git-history-worktree-file-row[data-status="R"] { --git-worktree-file-status-color: color-mix(in srgb, var(--status-warning, #f59e0b) 82%, var(--text-primary) 18%); }
        .git-history-worktree-file-row[data-status="T"] { --git-worktree-file-status-color: color-mix(in srgb, var(--status-warning, #f59e0b) 78%, var(--text-primary) 22%); }
        .git-history-worktree-file-path strong { color: var(--git-worktree-file-status-color); font-size: 13px; font-weight: 560; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .git-history-worktree-file-path em { color: var(--text-muted); font-style: normal; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        body[data-git-history-column-resizing="true"] .git-history-vertical-resizer::after { background: color-mix(in srgb, var(--accent-primary, #2563eb) 72%, transparent); }
        .git-history-worktree-section-list .git-history-worktree-folder-row::before,
        .git-history-worktree-section-list .git-history-worktree-file-row.is-tree::before { content: none; }
      `}</style>
      {!commitSectionCollapsed ? (
        <div className="git-history-worktree-commit-box commit-message-section flex flex-col gap-[6px] mb-0 pb-3 border-b border-[color-mix(in_srgb,var(--border-muted)_50%,transparent)]">
          <div className="git-history-worktree-commit-input-wrap commit-message-input-wrapper relative">
            <textarea
              className="git-history-worktree-commit-input commit-message-input w-full min-h-12 max-h-[120px] resize-y rounded-lg border border-[color:var(--border-strong)] bg-transparent text-[color:var(--text-muted)] font-[var(--code-font-family)] text-[var(--code-font-size,11px)] leading-[1.5] pt-2 pr-9 pb-2 pl-[10px] box-border transition-[border-color_160ms_ease,color_160ms_ease,box-shadow_160ms_ease] focus-visible:outline-none focus-visible:border-[color:var(--border-accent-soft)] focus-visible:text-[color:var(--text-emphasis)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--border-accent-soft)_20%,transparent)]"
              placeholder={t("git.commitMessage")}
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              disabled={commitMessageLoading || commitLoading || operationLoading}
              rows={2}
            />
            <button
              type="button"
              className={`git-history-worktree-generate commit-message-generate-button absolute right-[6px] top-[6px] w-6 h-6 rounded-[4px] inline-flex items-center justify-center bg-[color-mix(in_srgb,var(--surface-panel)_78%,transparent)] border border-[color-mix(in_srgb,var(--border-default)_82%,transparent)] text-[color:var(--text-emphasis)] cursor-pointer transition-[background_160ms_ease,color_160ms_ease,border-color_160ms_ease] hover:not-disabled:bg-[color:var(--surface-control-hover)] hover:not-disabled:border-[color-mix(in_srgb,var(--border-default)_96%,transparent)] hover:not-disabled:text-[color:var(--text-emphasis)] disabled:opacity-[0.45] disabled:cursor-not-allowed [&_svg]:block [&_svg]:w-[14px] [&_svg]:h-[14px] [&_img]:block [&_img]:w-[14px] [&_img]:h-[14px] [&_.codicon]:text-[14px] [&_.codicon]:leading-none${
                commitMessageLoading ? " git-history-worktree-generate--loading commit-message-generate-button--loading opacity-100 disabled:opacity-100" : ""
              }`}
              onClick={(event) => {
                void showCommitMessageEngineMenu(event);
              }}
              disabled={commitMessageLoading || commitLoading || operationLoading || !hasWorktreeChanges}
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
                className={`git-history-worktree-engine-icon commit-message-engine-icon block w-[14px] h-[14px]${
                  commitMessageLoading ? " git-history-worktree-engine-icon--spinning commit-message-engine-icon--spinning animate-spin origin-center will-change-transform" : ""
                }`}
              />
            </button>
          </div>
          {hasWorktreeChanges ? (
            <div className="git-history-worktree-commit-hint commit-message-hint text-[11px] text-[color:var(--text-muted)] leading-[1.4]" aria-live="polite">
              {commitStatusHint}
            </div>
          ) : null}
          <CommitButton
            commitMessage={commitMessage}
            selectedCount={selectedCommitCount}
            hasAnyChanges={hasWorktreeChanges}
            commitLoading={commitLoading}
            selectedPaths={selectedCommitPaths}
            onCommit={handleCommit}
          />
        </div>
      ) : null}
      {statusErrorText ? <div className="git-history-error">{statusErrorText}</div> : null}
      {operationErrorText ? <div className="git-history-error">{operationErrorText}</div> : null}
      {commitMessageErrorText ? <div className="git-history-error">{commitMessageErrorText}</div> : null}

      {shouldShowFileSections ? (
        <div className={worktreeSectionsClassName}>
          {compactSection && compactSummaryLabel ? (
            <div className="git-history-worktree-summary-bar flex items-center gap-2 min-h-[var(--git-filetree-row-min-height)] px-[var(--git-filetree-row-pad-x)] border border-[color-mix(in_srgb,var(--border-default)_34%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_32%,transparent)]">
              <span
                className="git-history-worktree-summary-lines inline-flex items-center gap-[6px] whitespace-nowrap flex-[0_0_auto]"
                aria-label={`+${status.totalAdditions} -${status.totalDeletions}`}
              >
                <span className="git-history-diff-add text-[color:var(--status-success,#22c55e)]">+{status.totalAdditions}</span>
                <span className="git-history-diff-sep text-[color:var(--text-muted)] opacity-[0.82]" aria-hidden>
                  /
                </span>
                <span className="git-history-diff-del text-[color:var(--status-error,#f87171)]">-{status.totalDeletions}</span>
              </span>
              <span className="git-history-worktree-summary-branch min-w-0 inline-flex items-center text-[color:var(--text-primary)] flex-[1_1_auto] [&_strong]:min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap" title={compactSummaryBranch}>
                <strong>{compactSummaryBranch}</strong>
              </span>
              <span className="git-history-worktree-summary-label text-[color:var(--text-secondary)] text-[13px] font-[560] flex-[0_1_auto] inline-flex items-center leading-none h-5 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [&_.git-history-worktree-section-indicator]:h-5 [&_.git-history-worktree-section-indicator]:items-center">{compactSummaryLabel}</span>
              <GitDiffPanelSectionActions
                title={compactSection === "staged" ? t("git.staged") : t("git.unstaged")}
                section={compactSection}
                sectionInclusionState={
                  compactSection === "staged"
                    ? stagedSectionInclusionState
                    : unstagedSectionInclusionState
                }
                toggleableFilePaths={
                  compactSection === "staged"
                    ? stagedToggleablePaths
                    : unstagedToggleablePaths
                }
                filePaths={compactSection === "staged" ? stagedFilePaths : unstagedFilePaths}
                onSetCommitSelection={setCommitSelection}
                onStageAllChanges={
                  compactSection === "unstaged"
                    ? () => handleMutation(() => stageGitAll(workspaceId))
                    : undefined
                }
                onUnstageFile={
                  compactSection === "staged"
                    ? (path) => handleMutation(() => unstageGitFile(workspaceId, path))
                    : undefined
                }
                onDiscardFiles={
                  compactSection === "unstaged"
                    ? () => {
                        handleDiscardAll();
                      }
                    : undefined
                }
              />
            </div>
          ) : null}
          {hasStagedFiles ? (
            <div className="git-history-worktree-section git-filetree-section border border-[color:var(--git-filetree-section-border)] rounded-[var(--git-filetree-section-radius)] bg-transparent overflow-hidden shadow-none [.is-single_&]:min-h-0 [.is-single_&]:flex-1 [.is-single_&]:flex [.is-single_&]:flex-col">
              <div
                className="git-history-worktree-section-header git-filetree-section-header flex items-center justify-between gap-2 min-h-[var(--git-filetree-row-min-height)] py-[var(--git-filetree-row-pad-y)] px-[var(--git-filetree-row-pad-x)] border-b border-[color-mix(in_srgb,var(--border-default)_34%,transparent)] text-[13px] font-[560] text-[color:var(--text-secondary)]"
                hidden={compactSection === "staged"}
              >
                <span>{renderSectionIndicator("staged", stagedFiles.length, t)}</span>
                <GitDiffPanelSectionActions
                  title={t("git.staged")}
                  section="staged"
                  sectionInclusionState={stagedSectionInclusionState}
                  toggleableFilePaths={stagedToggleablePaths}
                  filePaths={stagedFilePaths}
                  onSetCommitSelection={setCommitSelection}
                  onUnstageFile={(path) => handleMutation(() => unstageGitFile(workspaceId, path))}
                />
              </div>
              <div
                className={`git-history-worktree-section-list git-filetree-list max-h-[260px] overflow-auto flex flex-col gap-[var(--git-filetree-section-gap)] p-0.5 [.is-single_&]:min-h-0 [.is-single_&]:max-h-none [.is-single_&]:flex-1${
                  listView === "tree" ? " diff-section-tree-list git-filetree-list--tree" : ""
                }`}
              >
                {renderSectionRows(stagedFiles, "staged")}
              </div>
            </div>
          ) : null}

          {hasUnstagedFiles ? (
            <div className="git-history-worktree-section git-filetree-section border border-[color:var(--git-filetree-section-border)] rounded-[var(--git-filetree-section-radius)] bg-transparent overflow-hidden shadow-none [.is-single_&]:min-h-0 [.is-single_&]:flex-1 [.is-single_&]:flex [.is-single_&]:flex-col">
              <div
                className="git-history-worktree-section-header git-filetree-section-header flex items-center justify-between gap-2 min-h-[var(--git-filetree-row-min-height)] py-[var(--git-filetree-row-pad-y)] px-[var(--git-filetree-row-pad-x)] border-b border-[color-mix(in_srgb,var(--border-default)_34%,transparent)] text-[13px] font-[560] text-[color:var(--text-secondary)]"
                hidden={compactSection === "unstaged"}
              >
                <span>{renderSectionIndicator("unstaged", unstagedFiles.length, t)}</span>
                <GitDiffPanelSectionActions
                  title={t("git.unstaged")}
                  section="unstaged"
                  sectionInclusionState={unstagedSectionInclusionState}
                  toggleableFilePaths={unstagedToggleablePaths}
                  filePaths={unstagedFilePaths}
                  onSetCommitSelection={setCommitSelection}
                  onStageAllChanges={() => handleMutation(() => stageGitAll(workspaceId))}
                  onDiscardFiles={() => {
                    handleDiscardAll();
                  }}
                />
              </div>
              <div
                className={`git-history-worktree-section-list git-filetree-list max-h-[260px] overflow-auto flex flex-col gap-[var(--git-filetree-section-gap)] p-0.5 [.is-single_&]:min-h-0 [.is-single_&]:max-h-none [.is-single_&]:flex-1${
                  listView === "tree" ? " diff-section-tree-list git-filetree-list--tree" : ""
                }`}
              >
                {renderSectionRows(unstagedFiles, "unstaged")}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="git-history-empty">{t("git.noChangesDetected")}</div>
      )}
      {discardAllDialogOpen ? (
        <div
          className="git-history-create-branch-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !operationLoading) {
              setDiscardAllDialogOpen(false);
            }
          }}
        >
          <div
            className="git-history-worktree-danger-dialog w-[min(560px,100%)] rounded-xl border border-(--border-default)/78 bg-[color-mix(in_srgb,var(--surface-card-muted,#111725)_92%,#0b1220)] shadow-[0_14px_42px_rgba(0,0,0,0.34)] p-3.5 flex flex-col gap-2.5"
            role="dialog"
            aria-modal="true"
            aria-label={t("git.revertAllTitle")}
          >
            <div className="git-history-create-branch-title text-[13px] font-bold text-(--text-stronger)">{t("git.revertAllTitle")}</div>
            <div className="git-history-worktree-danger-copy flex flex-col gap-2">
              <p className="m-0 text-[13px] leading-[1.45] text-(--text-secondary)">{t("git.revertAllBeginnerLead")}</p>
              <div className="git-history-worktree-danger-list rounded-[10px] border border-(--border-default)/64 bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_54%,transparent)] px-2.5 py-2">
                <div className="git-history-worktree-danger-list-title text-xs text-(--text-secondary) mb-1.5">{t("git.revertAllAffectsLabel")}</div>
                <ul className="m-0 pl-[18px] flex flex-col gap-1 max-h-[180px] overflow-auto">
                  <li className="text-xs text-(--text-secondary)">
                    <span className="git-history-danger-keyword text-[#ef4444] font-bold">{t("git.revertAllKeywordStaged")}</span>
                  </li>
                  <li className="text-xs text-(--text-secondary)">
                    <span className="git-history-danger-keyword text-[#ef4444] font-bold">{t("git.revertAllKeywordUnstaged")}</span>
                  </li>
                  <li className="text-xs text-(--text-secondary)">
                    <span className="git-history-danger-keyword text-[#ef4444] font-bold">{t("git.revertAllKeywordUntracked")}</span>
                  </li>
                </ul>
              </div>
              <div className="git-history-worktree-danger-list rounded-[10px] border border-(--border-default)/64 bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_54%,transparent)] px-2.5 py-2">
                <div className="git-history-worktree-danger-list-title text-xs text-(--text-secondary) mb-1.5">
                  {t("git.revertAllFilesPreviewLabel", { count: revertAllPreviewPaths.length })}
                </div>
                <ul className="m-0 pl-[18px] flex flex-col gap-1 max-h-[180px] overflow-auto">
                  {revertAllPreviewPaths.map((path) => (
                    <li key={path} className="text-xs text-(--text-secondary)">
                      <code className="git-history-worktree-danger-file font-[var(--code-font-family,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace)] text-[11px] text-(--text-secondary)/88 break-all">{path}</code>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="git-history-worktree-danger-note rounded-lg px-2.5 py-2 bg-[color-mix(in_srgb,#ef4444_14%,transparent)] text-xs leading-[1.4] text-(--text-secondary) inline-flex flex-wrap gap-1">
                <span className="git-history-danger-keyword text-[#ef4444] font-bold">{t("git.revertAllKeywordIrreversible")}</span>
                <span>{t("git.revertAllBeginnerHint")}</span>
              </div>
            </div>
            <div className="git-history-create-branch-actions flex justify-end gap-2">
              <button
                type="button"
                className="git-history-create-branch-btn is-cancel min-w-[76px] h-[30px] rounded-lg text-xs font-semibold cursor-pointer border border-(--border-default)/76 bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_64%,transparent)] text-(--text-secondary) disabled:opacity-[0.48] disabled:cursor-not-allowed"
                disabled={operationLoading}
                onClick={() => setDiscardAllDialogOpen(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="git-history-create-branch-btn is-danger min-w-[76px] h-[30px] rounded-lg text-xs font-semibold cursor-pointer border border-[color-mix(in_srgb,#ef4444_54%,transparent)] bg-[color-mix(in_srgb,#ef4444_26%,transparent)] text-[color-mix(in_srgb,#ef4444_90%,#fee2e2)] disabled:opacity-[0.48] disabled:cursor-not-allowed"
                disabled={operationLoading}
                onClick={() => void handleConfirmDiscardAll()}
              >
                {operationLoading ? t("common.loading") : t("git.revertAllConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {discardDialogPaths ? (
        <div
          className="git-history-create-branch-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !operationLoading) {
              setDiscardDialogPaths(null);
            }
          }}
        >
          <div
            className="git-history-worktree-danger-dialog w-[min(560px,100%)] rounded-xl border border-(--border-default)/78 bg-[color-mix(in_srgb,var(--surface-card-muted,#111725)_92%,#0b1220)] shadow-[0_14px_42px_rgba(0,0,0,0.34)] p-3.5 flex flex-col gap-2.5"
            role="dialog"
            aria-modal="true"
            aria-label={t("git.discardConfirmTitle")}
          >
            <div className="git-history-create-branch-title text-[13px] font-bold text-(--text-stronger)">{t("git.discardConfirmTitle")}</div>
            <div className="git-history-worktree-danger-copy flex flex-col gap-2">
              <p className="m-0 text-[13px] leading-[1.45] text-(--text-secondary)">{t("git.discardDialogBeginnerLead")}</p>
              <div className="git-history-worktree-danger-list rounded-[10px] border border-(--border-default)/64 bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_54%,transparent)] px-2.5 py-2">
                <div className="git-history-worktree-danger-list-title text-xs text-(--text-secondary) mb-1.5">{t("git.discardDialogAffectsLabel")}</div>
                <ul className="m-0 pl-[18px] flex flex-col gap-1 max-h-[180px] overflow-auto">
                  {discardDialogPaths.map((path) => (
                    <li key={path} className="text-xs text-(--text-secondary)">
                      <code className="git-history-worktree-danger-file font-[var(--code-font-family,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace)] text-[11px] text-(--text-secondary)/88 break-all">{path}</code>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="git-history-worktree-danger-note rounded-lg px-2.5 py-2 bg-[color-mix(in_srgb,#ef4444_14%,transparent)] text-xs leading-[1.4] text-(--text-secondary) inline-flex flex-wrap gap-1">
                <span className="git-history-danger-keyword text-[#ef4444] font-bold">{t("git.revertAllKeywordIrreversible")}</span>
                <span>{t("git.discardDialogBeginnerHint")}</span>
              </div>
            </div>
            <div className="git-history-create-branch-actions flex justify-end gap-2">
              <button
                type="button"
                className="git-history-create-branch-btn is-cancel min-w-[76px] h-[30px] rounded-lg text-xs font-semibold cursor-pointer border border-(--border-default)/76 bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_64%,transparent)] text-(--text-secondary) disabled:opacity-[0.48] disabled:cursor-not-allowed"
                disabled={operationLoading}
                onClick={() => setDiscardDialogPaths(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="git-history-create-branch-btn is-danger min-w-[76px] h-[30px] rounded-lg text-xs font-semibold cursor-pointer border border-[color-mix(in_srgb,#ef4444_54%,transparent)] bg-[color-mix(in_srgb,#ef4444_26%,transparent)] text-[color-mix(in_srgb,#ef4444_90%,#fee2e2)] disabled:opacity-[0.48] disabled:cursor-not-allowed"
                disabled={operationLoading}
                onClick={() => void handleConfirmDiscardFiles()}
              >
                {operationLoading ? t("common.loading") : t("git.discardDialogConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {commitMessageContextMenu ? (
        <RendererContextMenu
          menu={commitMessageContextMenu}
          onClose={() => setCommitMessageContextMenu(null)}
          className="renderer-context-menu git-history-worktree-context-menu"
        />
      ) : null}
    </div>
  );
}
