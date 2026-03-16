// @ts-nocheck
import { ask } from "@tauri-apps/plugin-dialog";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import Download from "lucide-react/dist/esm/icons/download";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ChevronsDownUp from "lucide-react/dist/esm/icons/chevrons-down-up";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import Cherry from "lucide-react/dist/esm/icons/cherry";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import Cloud from "lucide-react/dist/esm/icons/cloud";
import CloudDownload from "lucide-react/dist/esm/icons/cloud-download";
import Copy from "lucide-react/dist/esm/icons/copy";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Folder from "lucide-react/dist/esm/icons/folder";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import GitBranchPlus from "lucide-react/dist/esm/icons/git-branch-plus";
import GitCommit from "lucide-react/dist/esm/icons/git-commit-horizontal";
import GitMerge from "lucide-react/dist/esm/icons/git-merge";
import GitPullRequestCreate from "lucide-react/dist/esm/icons/git-pull-request-create";
import HardDrive from "lucide-react/dist/esm/icons/hard-drive";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import MessageSquareText from "lucide-react/dist/esm/icons/message-square-text";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Repeat from "lucide-react/dist/esm/icons/repeat";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import Search from "lucide-react/dist/esm/icons/search";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import Upload from "lucide-react/dist/esm/icons/upload";
import X from "lucide-react/dist/esm/icons/x";
import type {
  GitBranchListItem,
  GitCommitDiff,
  GitCommitDetails,
  GitCommitFileChange,
  GitFileDiff,
  GitHistoryCommit,
  GitPrWorkflowDefaults,
  GitPrWorkflowResult,
  GitPrWorkflowStage,
  WorkspaceInfo,
} from "../../../../../types";
import {
  checkoutGitBranch,
  cherryPickCommit,
  createGitPrWorkflow,
  createGitBranchFromBranch,
  createGitBranchFromCommit,
  deleteGitBranch,
  fetchGit,
  getGitPrWorkflowDefaults,
  type GitPullStrategyOption,
  getGitBranchCompareCommits,
  getGitCommitDiff,
  getGitDiffs,
  getGitFileFullDiff,
  getGitStatus,
  getGitCommitDetails,
  getGitCommitHistory,
  getGitPushPreview,
  getGitWorktreeDiffAgainstBranch,
  getGitWorktreeDiffFileAgainstBranch,
  listGitRoots,
  listGitBranches,
  mergeGitBranch,
  pullGit,
  pushGit,
  rebaseGitBranch,
  renameGitBranch,
  resetGitCommit,
  revertCommit,
  syncGit,
} from "../../../../../services/tauri";
import { getClientStoreSync, writeClientStoreValue } from "../../../../../services/clientStorage";
import FileIcon from "../../../../../components/FileIcon";
import { GitDiffViewer } from "../../../../git/components/GitDiffViewer";
import { GitHistoryWorktreePanel } from "../../GitHistoryWorktreePanel";
import { isWorkingTreeDirtyBlockingError, localizeGitErrorMessage } from "../../../gitErrorI18n";
import { useGitHistoryPanelInteractions } from "../hooks/useGitHistoryPanelInteractions";
import { renderGitHistoryPanelView } from "./GitHistoryPanelView";
import { ActionSurface, GitHistoryInlinePicker, GitHistoryProjectPicker, type GitHistoryInlinePickerOption } from "./GitHistoryPanelPickers";
import { isRepositoryUnavailableError, formatRelativeTime, statusLabel, buildFileKey, getTreeLineOpacity, renderChangedFilesSummary, getPathLeafName, collectDirPaths, pickSelectedFileKey, buildFileTreeItems, getBranchScope, getBranchLeafName, trimRemotePrefix, getSpecialBranchBadges } from "../utils/gitHistoryPanelSharedUtils";


type GitHistoryPanelProps = {
  workspace: WorkspaceInfo | null;
  workspaces?: WorkspaceInfo[];
  groupedWorkspaces?: Array<{
    id: string | null;
    name: string;
    workspaces: WorkspaceInfo[];
  }>;
  onSelectWorkspace?: (workspaceId: string) => void;
  onSelectWorkspacePath?: (path: string) => Promise<void> | void;
  onOpenDiffPath?: (path: string) => void;
  onRequestClose?: () => void;
};

type ActionSurfaceProps = {
  className?: string;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  onActivate?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  title?: string;
  ariaLabel?: string;
  style?: CSSProperties;
};

type BranchGroup = {
  key: string;
  label: string;
  items: GitBranchListItem[];
};

type FileTreeNode = {
  name: string;
  path: string;
  dirs: Map<string, FileTreeNode>;
  files: GitCommitFileChange[];
};

type FileTreeItem =
  | {
      id: string;
      type: "dir";
      label: string;
      path: string;
      depth: number;
      expanded: boolean;
    }
  | {
      id: string;
      type: "file";
      label: string;
      path: string;
      depth: number;
      change: GitCommitFileChange;
    };

type GitHistoryPanelPersistedState = {
  overviewWidth?: number;
  branchesWidth?: number;
  commitsWidth?: number;
  detailsSplitRatio?: number;
  selectedBranch?: string;
  commitQuery?: string;
  selectedCommitSha?: string | null;
  diffStyle?: "split" | "unified";
};

type GitOperationErrorState = {
  userMessage: string;
  debugMessage: string;
  retryable: boolean;
};

type GitOperationNoticeState = {
  kind: "success" | "error";
  message: string;
  debugMessage?: string;
};

type ForceDeleteDialogMode = "notMerged" | "worktreeOccupied";

type ForceDeleteDialogState = {
  mode: ForceDeleteDialogMode;
  branch: string;
  worktreePath: string | null;
};

type GitResetMode = "soft" | "mixed" | "hard" | "keep";

type BranchMenuSource = "local" | "remote";

type BranchContextMenuState = {
  x: number;
  y: number;
  branch: GitBranchListItem;
  source: BranchMenuSource;
};

type BranchContextAction = {
  id: string;
  label: string;
  icon: ReactNode;
  tone?: "normal" | "danger";
  disabled?: boolean;
  disabledReason?: string | null;
  dividerBefore?: boolean;
  onSelect: () => void;
};

type WorktreeBranchDiffState = {
  mode: "worktree";
  branch: string;
  compareBranch: string;
  files: Pick<GitCommitDiff, "path" | "status">[];
  selectedPath: string | null;
  loading: boolean;
  error: string | null;
  selectedDiff: GitCommitDiff | null;
  selectedDiffLoading: boolean;
  selectedDiffError: string | null;
};

type BranchCompareDirection = "targetOnly" | "currentOnly";

type BranchCompareState = {
  mode: "branch";
  branch: string;
  compareBranch: string;
  targetOnlyCommits: GitHistoryCommit[];
  currentOnlyCommits: GitHistoryCommit[];
  loading: boolean;
  error: string | null;
  selectedDirection: BranchCompareDirection | null;
  selectedCommitSha: string | null;
  selectedCommitDetails: GitCommitDetails | null;
  selectedCommitLoading: boolean;
  selectedCommitError: string | null;
};

type BranchDiffState = WorktreeBranchDiffState | BranchCompareState;

type CommitContextMenuState = {
  x: number;
  y: number;
  commitSha: string;
};

type CommitActionId =
  | "copyRevision"
  | "copyMessage"
  | "createBranch"
  | "reset"
  | "cherryPick"
  | "revert";

type CommitActionDescriptor = {
  id: CommitActionId;
  label: string;
  group: "quick" | "branch" | "write";
  disabled: boolean;
  disabledReason?: string;
};

type PushTargetBranchGroup = {
  scope: string;
  label: string;
  items: string[];
};

type WorktreePreviewFile = GitFileDiff & {
  status: string;
  additions: number;
  deletions: number;
};

type CreatePrFormState = {
  upstreamRepo: string;
  baseBranch: string;
  headOwner: string;
  headBranch: string;
  title: string;
  body: string;
  commentAfterCreate: boolean;
  commentBody: string;
};

type CreatePrStageView = {
  key: "precheck" | "push" | "create" | "comment";
  label: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  detail: string;
};

const PAGE_SIZE = 100;
const DEFAULT_DETAILS_SPLIT = 42;
const DETAILS_SPLIT_MIN = 24;
const DETAILS_SPLIT_MAX = 78;
const COMPACT_LAYOUT_BREAKPOINT = 1120;
const VERTICAL_SPLITTER_SIZE = 8;
const OVERVIEW_MIN_WIDTH = 170;
const BRANCHES_MIN_WIDTH = 220;
const COMMITS_MIN_WIDTH = 260;
const DETAILS_MIN_WIDTH = 260;
const DISABLE_HISTORY_ACTION_BUTTONS = false;
const DISABLE_HISTORY_COMMIT_ACTIONS = false;
const COMMIT_ROW_ESTIMATED_HEIGHT = 56;
const SORT_ORDER_FALLBACK = Number.MAX_SAFE_INTEGER;
const PUSH_TARGET_MENU_MAX_HEIGHT = 220;
const PUSH_TARGET_MENU_MIN_HEIGHT = 120;
const PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT = 34;
const PUSH_TARGET_MENU_VIEWPORT_PADDING = 16;
const CREATE_PR_PREVIEW_COMMIT_LIMIT = 200;
const FILE_TREE_ROOT_PATH = "__repo_root__";

function getSortOrderValue(value: number | null | undefined) {
  return typeof value === "number" ? value : SORT_ORDER_FALLBACK;
}

function isActivationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" || event.key === " ";
}

function clamp(value: number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function extractCommitBody(summary: string, message: string): string {
  const normalizedSummary = summary.trim();
  const normalizedMessage = message.replace(/\r\n/g, "\n").trim();
  if (!normalizedMessage) {
    return "";
  }
  if (!normalizedSummary) {
    return normalizedMessage;
  }
  if (normalizedMessage === normalizedSummary) {
    return "";
  }
  const messageLines = normalizedMessage.split("\n");
  if (messageLines[0]?.trim() !== normalizedSummary) {
    return normalizedMessage;
  }
  return messageLines.slice(1).join("\n").trim();
}

function getCommitActionIcon(actionId: CommitActionId, size: number): ReactNode {
  const strokeWidth = 1.9;
  switch (actionId) {
    case "copyRevision":
      return <Copy size={size} strokeWidth={strokeWidth} />;
    case "copyMessage":
      return <MessageSquareText size={size} strokeWidth={strokeWidth} />;
    case "createBranch":
      return <GitBranchPlus size={size} strokeWidth={strokeWidth} />;
    case "reset":
      return <RotateCcw size={size} strokeWidth={strokeWidth} />;
    case "cherryPick":
      return <Cherry size={size} strokeWidth={strokeWidth} />;
    case "revert":
      return <Undo2 size={size} strokeWidth={strokeWidth} />;
  }
}

function buildCreatePrInitialStages(t: (key: string) => string): CreatePrStageView[] {
  return [
    {
      key: "precheck",
      label: t("git.historyCreatePrStagePrecheck"),
      status: "pending",
      detail: t("git.historyCreatePrStageWaiting"),
    },
    {
      key: "push",
      label: t("git.historyCreatePrStagePush"),
      status: "pending",
      detail: t("git.historyCreatePrStageWaiting"),
    },
    {
      key: "create",
      label: t("git.historyCreatePrStageCreate"),
      status: "pending",
      detail: t("git.historyCreatePrStageWaiting"),
    },
    {
      key: "comment",
      label: t("git.historyCreatePrStageComment"),
      status: "pending",
      detail: t("git.historyCreatePrStageWaiting"),
    },
  ];
}

function mapCreatePrStagesFromResult(
  t: (key: string) => string,
  stages: GitPrWorkflowStage[],
): CreatePrStageView[] {
  const defaults = buildCreatePrInitialStages(t);
  return defaults.map((defaultStage) => {
    const backendStage = stages.find((entry) => entry.key === defaultStage.key);
    if (!backendStage) {
      return defaultStage;
    }
    const status = (() => {
      switch (backendStage.status) {
        case "running":
        case "success":
        case "failed":
        case "skipped":
          return backendStage.status;
        default:
          return "pending";
      }
    })();
    return {
      ...defaultStage,
      status,
      detail: backendStage.detail?.trim() || defaultStage.detail,
    };
  });
}

function splitGitHubRepo(value: string): { owner: string; repo: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { owner: "", repo: "" };
  }
  const [owner, ...rest] = trimmed.split("/");
  return {
    owner: owner?.trim() ?? "",
    repo: rest.join("/").trim(),
  };
}

function scrollElementToTop(element: HTMLDivElement | null): void {
  if (!element) {
    return;
  }
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ top: 0 });
    return;
  }
  element.scrollTop = 0;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function sortOptionsWithPriority(values: string[], priorityValues: string[]): string[] {
  const uniqueValues = uniqueNonEmpty(values);
  const priority = uniqueNonEmpty(priorityValues);
  const valueSet = new Set(uniqueValues);
  const prioritized = priority.filter((entry) => valueSet.has(entry));
  const prioritizedSet = new Set(prioritized);
  const rest = uniqueValues
    .filter((entry) => !prioritizedSet.has(entry))
    .sort((left, right) =>
      left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: "base",
      }));
  return [...prioritized, ...rest];
}

export function getDefaultColumnWidths(containerWidth: number): {
  overviewWidth: number;
  branchesWidth: number;
  commitsWidth: number;
} {
  const safeWidth = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 1600;
  const splitterTotalWidth = VERTICAL_SPLITTER_SIZE * 3;
  const minimumColumnsWidth =
    OVERVIEW_MIN_WIDTH + BRANCHES_MIN_WIDTH + COMMITS_MIN_WIDTH + DETAILS_MIN_WIDTH;
  const availableColumnsWidth = Math.max(
    minimumColumnsWidth,
    safeWidth - splitterTotalWidth,
  );

  let overviewWidth = Math.round((availableColumnsWidth * 3) / 10);
  let branchesWidth = Math.round((availableColumnsWidth * 2) / 10);
  let commitsWidth = Math.round((availableColumnsWidth * 3) / 10);
  let detailsWidth = availableColumnsWidth - overviewWidth - branchesWidth - commitsWidth;

  const columns = [overviewWidth, branchesWidth, commitsWidth, detailsWidth];
  const minimums = [
    OVERVIEW_MIN_WIDTH,
    BRANCHES_MIN_WIDTH,
    COMMITS_MIN_WIDTH,
    DETAILS_MIN_WIDTH,
  ];

  let deficit = 0;
  for (let index = 0; index < columns.length; index += 1) {
    if (columns[index] < minimums[index]) {
      deficit += minimums[index] - columns[index];
      columns[index] = minimums[index];
    }
  }

  if (deficit > 0) {
    const shrinkOrder = [2, 0, 1, 3];
    for (const index of shrinkOrder) {
      if (deficit <= 0) {
        break;
      }
      const spare = columns[index] - minimums[index];
      if (spare <= 0) {
        continue;
      }
      const take = Math.min(spare, deficit);
      columns[index] -= take;
      deficit -= take;
    }
  }

  [overviewWidth, branchesWidth, commitsWidth, detailsWidth] = columns;
  return { overviewWidth, branchesWidth, commitsWidth };
}

export const GitHistoryPanel = memo(function GitHistoryPanel({
  workspace,
  workspaces = [],
  groupedWorkspaces = [],
  onSelectWorkspace,
  onSelectWorkspacePath,
  onOpenDiffPath,
  onRequestClose,
}: GitHistoryPanelProps) {
  const { t } = useTranslation();
  const owner = workspace?.name ?? "";
  const trimmed = (value: string) => value.trim();
  const strokeWidth = 1.5;
  const workspaceId = workspace?.id ?? null;
  const repositoryRootName = useMemo(
    () =>
      getPathLeafName(workspace?.settings?.gitRoot) ||
      getPathLeafName(workspace?.path) ||
      workspace?.name?.trim() ||
      workspace?.id ||
      "",
    [workspace?.id, workspace?.name, workspace?.path, workspace?.settings?.gitRoot],
  );
  const persistenceKey = useMemo(
    () => `gitHistoryPanel:${workspaceId ?? "default"}`,
    [workspaceId],
  );
  const persistedPanelState = useMemo(
    () => getClientStoreSync<GitHistoryPanelPersistedState>("layout", persistenceKey) ?? {},
    [persistenceKey],
  );
  const workbenchGridRef = useRef<HTMLDivElement | null>(null);
  const mainGridRef = useRef<HTMLDivElement | null>(null);
  const detailsBodyRef = useRef<HTMLDivElement | null>(null);
  const commitListRef = useRef<HTMLDivElement | null>(null);
  const branchContextMenuRef = useRef<HTMLDivElement | null>(null);
  const historySnapshotIdRef = useRef<string | null>(null);
  const createBranchNameInputRef = useRef<HTMLInputElement | null>(null);
  const renameBranchNameInputRef = useRef<HTMLInputElement | null>(null);
  const commitFullDiffCacheRef = useRef(new Map<string, Map<string, string>>());
  const branchDiffCacheRef = useRef<Map<string, GitCommitDiff>>(new Map());
  const branchCompareDetailsCacheRef = useRef<Map<string, GitCommitDetails>>(new Map());
  const initialColumnWidths = useMemo(
    () =>
      getDefaultColumnWidths(
        typeof window !== "undefined" ? window.innerWidth : 1600,
      ),
    [],
  );

  const [localBranches, setLocalBranches] = useState<GitBranchListItem[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<GitBranchListItem[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>(
    () => persistedPanelState.selectedBranch ?? "all",
  );
  const [branchQuery, setBranchQuery] = useState("");
  const [commitQuery, setCommitQuery] = useState(
    () => persistedPanelState.commitQuery ?? "",
  );
  const [localSectionExpanded, setLocalSectionExpanded] = useState(true);
  const [remoteSectionExpanded, setRemoteSectionExpanded] = useState(true);
  const [expandedLocalScopes, setExpandedLocalScopes] = useState<Set<string>>(new Set());
  const [expandedRemoteScopes, setExpandedRemoteScopes] = useState<Set<string>>(new Set());
  const [overviewListView, setOverviewListView] = useState<"flat" | "tree">("flat");
  const [overviewCommitSectionCollapsed, setOverviewCommitSectionCollapsed] = useState(true);
  const [workingTreeChangedFiles, setWorkingTreeChangedFiles] = useState(0);
  const [workingTreeTotalAdditions, setWorkingTreeTotalAdditions] = useState(0);
  const [workingTreeTotalDeletions, setWorkingTreeTotalDeletions] = useState(0);
  const [, setWorkingTreeStatusError] = useState<string | null>(null);

  const [commits, setCommits] = useState<GitHistoryCommit[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(
    () => persistedPanelState.selectedCommitSha ?? null,
  );
  const [details, setDetails] = useState<GitCommitDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  const [previewFileKey, setPreviewFileKey] = useState<string | null>(null);
  const [comparePreviewFileKey, setComparePreviewFileKey] = useState<string | null>(null);
  const [isHistoryDiffModalMaximized, setIsHistoryDiffModalMaximized] = useState(false);
  const [worktreePreviewFile, setWorktreePreviewFile] = useState<WorktreePreviewFile | null>(null);
  const [worktreePreviewLoading, setWorktreePreviewLoading] = useState(false);
  const [worktreePreviewError, setWorktreePreviewError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const [detailsSplitRatio, setDetailsSplitRatio] = useState(() =>
    clamp(
      persistedPanelState.detailsSplitRatio ?? DEFAULT_DETAILS_SPLIT,
      DETAILS_SPLIT_MIN,
      DETAILS_SPLIT_MAX,
    ),
  );
  const [overviewWidth, setOverviewWidth] = useState(
    () => persistedPanelState.overviewWidth ?? initialColumnWidths.overviewWidth,
  );
  const [branchesWidth, setBranchesWidth] = useState(
    () => persistedPanelState.branchesWidth ?? initialColumnWidths.branchesWidth,
  );
  const [commitsWidth, setCommitsWidth] = useState(
    () => persistedPanelState.commitsWidth ?? initialColumnWidths.commitsWidth,
  );
  const [diffViewMode, setDiffViewMode] = useState<"split" | "unified">(
    () => persistedPanelState.diffStyle ?? "split",
  );
  const [desktopSplitLayout, setDesktopSplitLayout] = useState(() =>
    typeof window !== "undefined"
      ? window.innerWidth > COMPACT_LAYOUT_BREAKPOINT
      : true,
  );

  const [operationLoading, setOperationLoading] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<GitOperationNoticeState | null>(null);
  const operationNoticeTimerRef = useRef<number | null>(null);
  const createPrProgressTimerRef = useRef<number | null>(null);
  const createPrPreviewLoadTokenRef = useRef(0);
  const createPrPreviewDetailsLoadTokenRef = useRef(0);
  const createPrPreviewDetailsCacheRef = useRef<Map<string, GitCommitDetails>>(new Map());
  const [forceDeleteDialogState, setForceDeleteDialogState] = useState<ForceDeleteDialogState | null>(null);
  const forceDeleteDialogResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [forceDeleteCountdown, setForceDeleteCountdown] = useState(0);
  const [forceDeleteCopiedPath, setForceDeleteCopiedPath] = useState(false);
  const [createPrDialogOpen, setCreatePrDialogOpen] = useState(false);
  const [isCreatePrDialogMaximized, setIsCreatePrDialogMaximized] = useState(false);
  const [createPrDefaultsLoading, setCreatePrDefaultsLoading] = useState(false);
  const [createPrDefaultsError, setCreatePrDefaultsError] = useState<string | null>(null);
  const [createPrDefaults, setCreatePrDefaults] = useState<GitPrWorkflowDefaults | null>(null);
  const defaults = null;
  const [createPrForm, setCreatePrForm] = useState<CreatePrFormState>({
    upstreamRepo: "",
    baseBranch: "",
    headOwner: "",
    headBranch: "",
    title: "",
    body: "",
    commentAfterCreate: true,
    commentBody: "",
  });
  const [createPrStages, setCreatePrStages] = useState<CreatePrStageView[]>(() =>
    buildCreatePrInitialStages((key) => key),
  );
  const [createPrResult, setCreatePrResult] = useState<GitPrWorkflowResult | null>(null);
  const [createPrCopiedPrUrl, setCreatePrCopiedPrUrl] = useState(false);
  const [createPrCopiedRetryCommand, setCreatePrCopiedRetryCommand] = useState(false);
  const [createPrPreviewLoading, setCreatePrPreviewLoading] = useState(false);
  const [createPrPreviewError, setCreatePrPreviewError] = useState<string | null>(null);
  const [createPrPreviewCommits, setCreatePrPreviewCommits] = useState<GitHistoryCommit[]>([]);
  const [createPrPreviewBaseOnlyCount, setCreatePrPreviewBaseOnlyCount] = useState(0);
  const [createPrPreviewSelectedSha, setCreatePrPreviewSelectedSha] = useState<string | null>(null);
  const [createPrPreviewExpanded, setCreatePrPreviewExpanded] = useState(false);
  const [createPrPreviewDetails, setCreatePrPreviewDetails] = useState<GitCommitDetails | null>(null);
  const [createPrPreviewDetailsLoading, setCreatePrPreviewDetailsLoading] = useState(false);
  const [createPrPreviewDetailsError, setCreatePrPreviewDetailsError] = useState<string | null>(null);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [pullDialogOpen, setPullDialogOpen] = useState(false);
  const [pullRemote, setPullRemote] = useState("origin");
  const [pullTargetBranch, setPullTargetBranch] = useState("");
  const [pullTargetBranchQuery, setPullTargetBranchQuery] = useState("");
  const [pullRemoteMenuOpen, setPullRemoteMenuOpen] = useState(false);
  const [pullRemoteMenuPlacement, setPullRemoteMenuPlacement] = useState<"down" | "up">("up");
  const [pullTargetBranchMenuOpen, setPullTargetBranchMenuOpen] = useState(false);
  const [pullTargetBranchActiveScopeTab, setPullTargetBranchActiveScopeTab] = useState<string | null>(null);
  const [pullTargetBranchMenuPlacement, setPullTargetBranchMenuPlacement] = useState<"down" | "up">(
    "down",
  );
  const [pullOptionsMenuOpen, setPullOptionsMenuOpen] = useState(false);
  const [pullStrategy, setPullStrategy] = useState<GitPullStrategyOption | null>(null);
  const [pullNoCommit, setPullNoCommit] = useState(false);
  const [pullNoVerify, setPullNoVerify] = useState(false);
  const pullRemotePickerRef = useRef<HTMLDivElement | null>(null);
  const pullTargetBranchPickerRef = useRef<HTMLDivElement | null>(null);
  const pullTargetBranchFieldRef = useRef<HTMLLabelElement | null>(null);
  const pullTargetBranchMenuRef = useRef<HTMLDivElement | null>(null);
  const pullOptionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [fetchDialogOpen, setFetchDialogOpen] = useState(false);
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const [syncPreviewError, setSyncPreviewError] = useState<string | null>(null);
  const [syncPreviewTargetRemote, setSyncPreviewTargetRemote] = useState("origin");
  const [syncPreviewTargetBranch, setSyncPreviewTargetBranch] = useState("");
  const [syncPreviewCommits, setSyncPreviewCommits] = useState<GitHistoryCommit[]>([]);
  const [syncPreviewTargetFound, setSyncPreviewTargetFound] = useState(true);
  const [pushRemote, setPushRemote] = useState("origin");
  const [pushTargetBranch, setPushTargetBranch] = useState("");
  const [pushTargetBranchQuery, setPushTargetBranchQuery] = useState("");
  const [pushTags, setPushTags] = useState(false);
  const [pushRunHooks, setPushRunHooks] = useState(true);
  const [pushForceWithLease, setPushForceWithLease] = useState(false);
  const [pushToGerrit, setPushToGerrit] = useState(false);
  const [pushTopic, setPushTopic] = useState("");
  const [pushReviewers, setPushReviewers] = useState("");
  const [pushCc, setPushCc] = useState("");
  const [pushRemoteMenuOpen, setPushRemoteMenuOpen] = useState(false);
  const [pushRemoteMenuPlacement, setPushRemoteMenuPlacement] = useState<"down" | "up">("up");
  const [pushTargetBranchMenuOpen, setPushTargetBranchMenuOpen] = useState(false);
  const [pushTargetBranchActiveScopeTab, setPushTargetBranchActiveScopeTab] = useState<string | null>(null);
  const [pushTargetBranchMenuPlacement, setPushTargetBranchMenuPlacement] = useState<"down" | "up">(
    "down",
  );
  const pushRemotePickerRef = useRef<HTMLDivElement | null>(null);
  const pushTargetBranchPickerRef = useRef<HTMLDivElement | null>(null);
  const pushTargetBranchFieldRef = useRef<HTMLLabelElement | null>(null);
  const pushTargetBranchMenuRef = useRef<HTMLDivElement | null>(null);
  const [pushPreviewLoading, setPushPreviewLoading] = useState(false);
  const [pushPreviewError, setPushPreviewError] = useState<string | null>(null);
  const [pushPreviewTargetFound, setPushPreviewTargetFound] = useState(true);
  const [pushPreviewHasMore, setPushPreviewHasMore] = useState(false);
  const [pushPreviewCommits, setPushPreviewCommits] = useState<GitHistoryCommit[]>([]);
  const [pushPreviewSelectedSha, setPushPreviewSelectedSha] = useState<string | null>(null);
  const [pushPreviewDetails, setPushPreviewDetails] = useState<GitCommitDetails | null>(null);
  const [pushPreviewDetailsLoading, setPushPreviewDetailsLoading] = useState(false);
  const [pushPreviewDetailsError, setPushPreviewDetailsError] = useState<string | null>(null);
  const [pushPreviewExpandedDirs, setPushPreviewExpandedDirs] = useState<Set<string>>(new Set());
  const [pushPreviewSelectedFileKey, setPushPreviewSelectedFileKey] = useState<string | null>(null);
  const [pushPreviewModalFileKey, setPushPreviewModalFileKey] = useState<string | null>(null);
  const pushPreviewLoadTokenRef = useRef(0);
  const pushPreviewDetailsLoadTokenRef = useRef(0);
  const [branchContextMenu, setBranchContextMenu] = useState<BranchContextMenuState | null>(null);
  const [branchDiffState, setBranchDiffState] = useState<BranchDiffState | null>(null);
  const [commitContextMenu, setCommitContextMenu] = useState<CommitContextMenuState | null>(null);
  const [commitContextMoreOpen, setCommitContextMoreOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetTargetSha, setResetTargetSha] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState<GitResetMode>("mixed");
  const [createBranchDialogOpen, setCreateBranchDialogOpen] = useState(false);
  const [createBranchSource, setCreateBranchSource] = useState("");
  const [createBranchName, setCreateBranchName] = useState("");
  const [renameBranchDialogOpen, setRenameBranchDialogOpen] = useState(false);
  const [renameBranchSource, setRenameBranchSource] = useState("");
  const [renameBranchName, setRenameBranchName] = useState("");
  const [repositoryUnavailable, setRepositoryUnavailable] = useState(false);
  const [fallbackGitRoots, setFallbackGitRoots] = useState<string[]>([]);
  const [fallbackGitRootsLoading, setFallbackGitRootsLoading] = useState(false);
  const [fallbackGitRootsError, setFallbackGitRootsError] = useState<string | null>(null);
  const [fallbackSelectingRoot, setFallbackSelectingRoot] = useState<string | null>(null);
  const [workspaceSelectingId, setWorkspaceSelectingId] = useState<string | null>(null);

  const currentLocalBranchEntry = useMemo(() => {
    if (!currentBranch) {
      return null;
    }
    return localBranches.find((entry) => entry.name === currentBranch) ?? null;
  }, [currentBranch, localBranches]);

  const resolveUpstreamTarget = useCallback(
    (upstream: string | null | undefined) => {
      const value = upstream?.trim();
      if (!value) {
        return {
          remote: "origin",
          branch: currentBranch ?? "main",
        };
      }
      const normalized = value
        .replace(/^refs\/remotes\//, "")
        .replace(/^remotes\//, "");
      const slashIndex = normalized.indexOf("/");
      if (slashIndex <= 0 || slashIndex === normalized.length - 1) {
        return {
          remote: "origin",
          branch: currentBranch ?? "main",
        };
      }
      return {
        remote: normalized.slice(0, slashIndex),
        branch: normalized.slice(slashIndex + 1),
      };
    },
    [currentBranch],
  );

  const closeBranchContextMenu = useCallback(() => {
    setBranchContextMenu(null);
  }, []);

  const closeBranchDiff = useCallback(() => {
    setBranchDiffState(null);
    setComparePreviewFileKey(null);
  }, []);

  const handleOpenBranchContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>, branch: GitBranchListItem, source: BranchMenuSource) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedBranch(branch.name);
      setCommitContextMenu(null);
      setBranchContextMenu({
        x: event.clientX,
        y: event.clientY,
        branch,
        source,
      });
    },
    [],
  );

  const applyHistorySnapshotId = useCallback((snapshotId: string | null) => {
    historySnapshotIdRef.current = snapshotId;
  }, []);

  const resolveGitRootPath = useCallback((workspacePath: string, relativeRoot: string) => {
    const useBackslash = workspacePath.includes("\\") && !workspacePath.includes("/");
    const separator = useBackslash ? "\\" : "/";
    const normalizedRelative = relativeRoot.split("/").join(separator);
    if (workspacePath.endsWith("/") || workspacePath.endsWith("\\")) {
      return `${workspacePath}${normalizedRelative}`;
    }
    return `${workspacePath}${separator}${normalizedRelative}`;
  }, []);

  const clearCommitAndDetailColumns = useCallback(() => {
    setCommits([]);
    setHistoryTotal(0);
    setHistoryHasMore(false);
    applyHistorySnapshotId(null);
    setSelectedCommitSha(null);
    setDetails(null);
    setDetailsError(null);
    setSelectedFileKey(null);
    setPreviewFileKey(null);
    setExpandedDirs(new Set());
  }, [applyHistorySnapshotId]);

  const clearHistoryColumns = useCallback(() => {
    setLocalBranches([]);
    setRemoteBranches([]);
    setCurrentBranch(null);
    setSelectedBranch("all");
    clearCommitAndDetailColumns();
  }, [clearCommitAndDetailColumns]);

  const refreshBranches = useCallback(async () => {
    if (!workspaceId) {
      setLocalBranches([]);
      setRemoteBranches([]);
      setCurrentBranch(null);
      return;
    }
    try {
      const response = await listGitBranches(workspaceId);
      const local = response.localBranches ?? [];
      const remote = response.remoteBranches ?? [];
      setLocalBranches(local);
      setRemoteBranches(remote);
      setCurrentBranch(response.currentBranch ?? null);
      setSelectedBranch((prev) => {
        if (prev === "all") {
          return prev;
        }
        const existsLocal = local.some((entry) => entry.name === prev);
        const existsRemote = remote.some((entry) => entry.name === prev);
        if (existsLocal || existsRemote) {
          return prev;
        }
        return response.currentBranch ?? "all";
      });
      setRepositoryUnavailable(false);
    } catch (error) {
      if (isRepositoryUnavailableError(error)) {
        setRepositoryUnavailable(true);
        clearHistoryColumns();
      }
    }
  }, [workspaceId, clearHistoryColumns]);

  const refreshWorkingTreeStatus = useCallback(async () => {
    if (!workspaceId) {
      setWorkingTreeChangedFiles(0);
      setWorkingTreeTotalAdditions(0);
      setWorkingTreeTotalDeletions(0);
      setWorkingTreeStatusError(null);
      return;
    }
    try {
      const status = await getGitStatus(workspaceId);
      setWorkingTreeChangedFiles(status.files.length);
      setWorkingTreeTotalAdditions(status.totalAdditions);
      setWorkingTreeTotalDeletions(status.totalDeletions);
      setWorkingTreeStatusError(null);
      setRepositoryUnavailable(false);
    } catch (error) {
      setWorkingTreeChangedFiles(0);
      setWorkingTreeTotalAdditions(0);
      setWorkingTreeTotalDeletions(0);
      if (isRepositoryUnavailableError(error)) {
        setRepositoryUnavailable(true);
      }
      setWorkingTreeStatusError(error instanceof Error ? error.message : String(error));
    }
  }, [workspaceId]);

  const loadHistory = useCallback(
    async (append: boolean, startOffset?: number) => {
      if (!workspaceId) {
        setCommits([]);
        setHistoryTotal(0);
        setHistoryHasMore(false);
        applyHistorySnapshotId(null);
        setHistoryError(null);
        return;
      }

      if (append) {
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
      }
      setHistoryError(null);

      try {
        const offset = append ? startOffset ?? 0 : 0;
        const response = await getGitCommitHistory(workspaceId, {
          branch: selectedBranch === "all" ? "all" : selectedBranch,
          query: commitQuery.trim() || null,
          snapshotId: append ? historySnapshotIdRef.current : null,
          offset,
          limit: PAGE_SIZE,
        });

        setHistoryTotal(response.total);
        setHistoryHasMore(response.hasMore);
        applyHistorySnapshotId(response.snapshotId);
        setCommits((prev) => {
          if (!append) {
            return response.commits;
          }
          const seen = new Set(prev.map((item) => item.sha));
          const merged = [...prev];
          for (const commit of response.commits) {
            if (!seen.has(commit.sha)) {
              merged.push(commit);
              seen.add(commit.sha);
            }
          }
          return merged;
        });
        setRepositoryUnavailable(false);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        const isSnapshotExpired = rawMessage.toLowerCase().includes("snapshot expired");
        if (append && isSnapshotExpired) {
          try {
            const refreshed = await getGitCommitHistory(workspaceId, {
              branch: selectedBranch === "all" ? "all" : selectedBranch,
              query: commitQuery.trim() || null,
              snapshotId: null,
              offset: 0,
              limit: PAGE_SIZE,
            });
            setHistoryTotal(refreshed.total);
            setHistoryHasMore(refreshed.hasMore);
            applyHistorySnapshotId(refreshed.snapshotId);
            setCommits(refreshed.commits);
            setHistoryError(null);
            return;
          } catch (refreshError) {
            setHistoryError(
              refreshError instanceof Error ? refreshError.message : String(refreshError),
            );
            return;
          }
        }
        if (isRepositoryUnavailableError(error)) {
          setRepositoryUnavailable(true);
        }
        if (!append) {
          clearCommitAndDetailColumns();
        }
        setHistoryError(rawMessage);
      } finally {
        setHistoryLoading(false);
        setHistoryLoadingMore(false);
      }
    },
    [
      workspaceId,
      selectedBranch,
      commitQuery,
      applyHistorySnapshotId,
      clearCommitAndDetailColumns,
    ],
  );

  const refreshAll = useCallback(async () => {
    await refreshBranches();
    await refreshWorkingTreeStatus();
    await loadHistory(false, 0);

    if (selectedCommitSha && workspaceId) {
      try {
        const commitDetails = await getGitCommitDetails(workspaceId, selectedCommitSha);
        setDetails(commitDetails);
        setExpandedDirs(collectDirPaths(commitDetails.files));
        setDetailsError(null);
        setSelectedFileKey((previous) =>
          pickSelectedFileKey(previous, commitDetails.files),
        );
        setPreviewFileKey(null);
      } catch (error) {
        if (isRepositoryUnavailableError(error)) {
          setRepositoryUnavailable(true);
          clearHistoryColumns();
        }
        setDetails(null);
        setSelectedFileKey(null);
        setPreviewFileKey(null);
        setDetailsError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [
    clearHistoryColumns,
    loadHistory,
    refreshBranches,
    refreshWorkingTreeStatus,
    selectedCommitSha,
    workspaceId,
  ]);

  useEffect(() => {
    setRepositoryUnavailable(false);
    setSelectedBranch(persistedPanelState.selectedBranch ?? "all");
    setSelectedCommitSha(persistedPanelState.selectedCommitSha ?? null);
    setDetails(null);
    setSelectedFileKey(null);
    setPreviewFileKey(null);
    setExpandedDirs(new Set());
    setCommitQuery(persistedPanelState.commitQuery ?? "");
    applyHistorySnapshotId(null);
    setCreateBranchDialogOpen(false);
    setCreateBranchSource("");
    setCreateBranchName("");
    if (!workspaceId) {
      setCommits([]);
      setHistoryTotal(0);
      setHistoryHasMore(false);
      setHistoryError(null);
      setWorkingTreeChangedFiles(0);
      setWorkingTreeTotalAdditions(0);
      setWorkingTreeTotalDeletions(0);
      setWorkingTreeStatusError(null);
      return;
    }
    void (async () => {
      await refreshBranches();
      await refreshWorkingTreeStatus();
    })();
  }, [
    workspaceId,
    refreshBranches,
    refreshWorkingTreeStatus,
    applyHistorySnapshotId,
    persistedPanelState.commitQuery,
    persistedPanelState.selectedBranch,
    persistedPanelState.selectedCommitSha,
  ]);

  useEffect(() => {
    commitFullDiffCacheRef.current.clear();
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    void loadHistory(false, 0);
  }, [workspaceId, selectedBranch, commitQuery, loadHistory]);

  useEffect(() => {
    if (!workspaceId || !selectedCommitSha) {
      setDetails(null);
      setSelectedFileKey(null);
      setPreviewFileKey(null);
      setExpandedDirs(new Set());
      setDetailsError(null);
      return;
    }

    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);

    void getGitCommitDetails(workspaceId, selectedCommitSha)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setDetails(response);
        setExpandedDirs(collectDirPaths(response.files));
        setSelectedFileKey((previous) => pickSelectedFileKey(previous, response.files));
        setPreviewFileKey(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (isRepositoryUnavailableError(error)) {
          setRepositoryUnavailable(true);
          clearHistoryColumns();
        }
        setDetails(null);
        setExpandedDirs(new Set());
        setSelectedFileKey(null);
        setPreviewFileKey(null);
        setDetailsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setDetailsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCommitSha, workspaceId, clearHistoryColumns]);

  const filteredLocalBranches = useMemo(() => {
    const needle = branchQuery.trim().toLowerCase();
    if (!needle) {
      return localBranches;
    }
    return localBranches.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [branchQuery, localBranches]);

  const filteredRemoteBranches = useMemo(() => {
    const needle = branchQuery.trim().toLowerCase();
    if (!needle) {
      return remoteBranches;
    }
    return remoteBranches.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [branchQuery, remoteBranches]);

  const groupedRemoteBranches = useMemo(() => {
    const groups = new Map<string, GitBranchListItem[]>();
    for (const entry of filteredRemoteBranches) {
      const group = entry.remote ?? entry.name.split("/")[0] ?? "remote";
      const existing = groups.get(group) ?? [];
      existing.push(entry);
      groups.set(group, existing);
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([remote, items]) => ({
        remote,
        items: items.slice().sort((left, right) => left.name.localeCompare(right.name)),
      }));
  }, [filteredRemoteBranches]);

  const groupedLocalBranches = useMemo<BranchGroup[]>(() => {
    const groups = new Map<string, GitBranchListItem[]>();
    for (const entry of filteredLocalBranches) {
      const scope = getBranchScope(entry.name);
      const items = groups.get(scope) ?? [];
      items.push(entry);
      groups.set(scope, items);
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => {
        if (left === "__root__") {
          return -1;
        }
        if (right === "__root__") {
          return 1;
        }
        return left.localeCompare(right);
      })
      .map(([key, items]) => ({
        key,
        label: key === "__root__" ? t("git.historyRootGroup") : key.toUpperCase(),
        items: items.slice().sort((left, right) => left.name.localeCompare(right.name)),
      }));
  }, [filteredLocalBranches, t]);

  const createBranchSourceOptions = useMemo(() => {
    const names = new Set(localBranches.map((entry) => entry.name));
    if (currentBranch) {
      names.add(currentBranch);
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [currentBranch, localBranches]);

  useEffect(() => {
    if (branchQuery.trim()) {
      setLocalSectionExpanded(true);
      setRemoteSectionExpanded(true);
    }
  }, [branchQuery]);

  useEffect(() => {
    setExpandedLocalScopes((prev) => {
      const next = new Set<string>();
      const activeScope = currentBranch ? getBranchScope(currentBranch) : null;
      const searching = branchQuery.trim().length > 0;
      for (const group of groupedLocalBranches) {
        if (searching || prev.has(group.key) || group.key === "__root__" || group.key === activeScope) {
          next.add(group.key);
        }
      }
      return next;
    });
  }, [branchQuery, currentBranch, groupedLocalBranches]);

  useEffect(() => {
    setExpandedRemoteScopes((prev) => {
      const next = new Set<string>();
      const searching = branchQuery.trim().length > 0;
      for (const group of groupedRemoteBranches) {
        if (searching || prev.has(group.remote)) {
          next.add(group.remote);
        }
      }
      return next;
    });
  }, [branchQuery, groupedRemoteBranches]);

  useEffect(() => {
    if (!createBranchDialogOpen) {
      return;
    }
    createBranchNameInputRef.current?.focus();
  }, [createBranchDialogOpen]);

  useEffect(() => {
    if (!renameBranchDialogOpen) {
      return;
    }
    renameBranchNameInputRef.current?.focus();
    renameBranchNameInputRef.current?.select();
  }, [renameBranchDialogOpen]);

  useEffect(() => {
    setBranchDiffState(null);
    branchDiffCacheRef.current.clear();
    branchCompareDetailsCacheRef.current.clear();
    setComparePreviewFileKey(null);
  }, [workspaceId]);

  useEffect(() => {
    if (createBranchDialogOpen && branchContextMenu) {
      closeBranchContextMenu();
    }
  }, [branchContextMenu, closeBranchContextMenu, createBranchDialogOpen]);

  useEffect(() => {
    if (renameBranchDialogOpen && branchContextMenu) {
      closeBranchContextMenu();
    }
  }, [branchContextMenu, closeBranchContextMenu, renameBranchDialogOpen]);

  useEffect(() => {
    if (!branchContextMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!branchContextMenuRef.current?.contains(target)) {
        closeBranchContextMenu();
      }
    };
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBranchContextMenu();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [branchContextMenu, closeBranchContextMenu]);

  const fileTreeItems = useMemo(() => {
    if (!details) {
      return [];
    }
    return buildFileTreeItems(details.files, expandedDirs, repositoryRootName);
  }, [details, expandedDirs, repositoryRootName]);

  const detailsMessageContent = useMemo(() => {
    if (!details) {
      return "";
    }
    const commitBody = extractCommitBody(details.summary, details.message);
    return commitBody || t("git.historyCommitMetaNoContent");
  }, [details, t]);

  const previewDetailFile = useMemo(() => {
    if (!details || !previewFileKey) {
      return null;
    }
    return details.files.find((entry) => buildFileKey(entry) === previewFileKey) ?? null;
  }, [details, previewFileKey]);

  const previewDetailFileDiff = useMemo(() => {
    if (!previewDetailFile) {
      return null;
    }
    if (previewDetailFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (previewDetailFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [previewDetailFile, t]);

  const previewDiffEntries = useMemo(() => {
    if (!previewDetailFile) {
      return [];
    }
    return [
      {
        path: previewDetailFile.path,
        status: previewDetailFile.status,
        diff: previewDetailFile.diff ?? "",
      },
    ];
  }, [previewDetailFile]);

  const comparePreviewDetailFile = useMemo(() => {
    if (!comparePreviewFileKey || !branchDiffState || branchDiffState.mode !== "branch") {
      return null;
    }
    const selectedCommitDetails = branchDiffState.selectedCommitDetails;
    if (!selectedCommitDetails) {
      return null;
    }
    return selectedCommitDetails.files.find(
      (entry) => buildFileKey(entry) === comparePreviewFileKey,
    ) ?? null;
  }, [branchDiffState, comparePreviewFileKey]);

  const comparePreviewDetailFileDiff = useMemo(() => {
    if (!comparePreviewDetailFile) {
      return null;
    }
    if (comparePreviewDetailFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (comparePreviewDetailFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [comparePreviewDetailFile, t]);

  const comparePreviewDiffEntries = useMemo(() => {
    if (!comparePreviewDetailFile) {
      return [];
    }
    return [
      {
        path: comparePreviewDetailFile.path,
        status: comparePreviewDetailFile.status,
        diff: comparePreviewDetailFile.diff ?? "",
      },
    ];
  }, [comparePreviewDetailFile]);

  const worktreePreviewDiffText = useMemo(() => {
    if (!worktreePreviewFile) {
      return null;
    }
    if (worktreePreviewFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (worktreePreviewFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [worktreePreviewFile, t]);

  const worktreePreviewDiffEntries = useMemo(() => {
    if (!worktreePreviewFile) {
      return [];
    }
    return [
      {
        path: worktreePreviewFile.path,
        status: worktreePreviewFile.status,
        diff: worktreePreviewFile.diff ?? "",
        isImage: worktreePreviewFile.isImage,
        oldImageData: worktreePreviewFile.oldImageData,
        newImageData: worktreePreviewFile.newImageData,
        oldImageMime: worktreePreviewFile.oldImageMime,
        newImageMime: worktreePreviewFile.newImageMime,
      },
    ];
  }, [worktreePreviewFile]);

  const pushPreviewFileTreeItems = useMemo(() => {
    if (!pushPreviewDetails) {
      return [];
    }
    return buildFileTreeItems(
      pushPreviewDetails.files,
      pushPreviewExpandedDirs,
      repositoryRootName,
    );
  }, [pushPreviewDetails, pushPreviewExpandedDirs, repositoryRootName]);

  const pushPreviewModalFile = useMemo(() => {
    if (!pushPreviewDetails || !pushPreviewModalFileKey) {
      return null;
    }
    return (
      pushPreviewDetails.files.find((entry) => buildFileKey(entry) === pushPreviewModalFileKey) ?? null
    );
  }, [pushPreviewDetails, pushPreviewModalFileKey]);

  const pushPreviewModalFileDiff = useMemo(() => {
    if (!pushPreviewModalFile) {
      return null;
    }
    if (pushPreviewModalFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (pushPreviewModalFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [pushPreviewModalFile, t]);

  const pushPreviewModalDiffEntries = useMemo(() => {
    if (!pushPreviewModalFile) {
      return [];
    }
    return [
      {
        path: pushPreviewModalFile.path,
        status: pushPreviewModalFile.status,
        diff: pushPreviewModalFile.diff ?? "",
      },
    ];
  }, [pushPreviewModalFile]);

  const activeHistoryDiffModalKey = useMemo(() => {
    if (previewDetailFile) {
      return `commit:${previewDetailFile.path}`;
    }
    if (worktreePreviewFile) {
      return `worktree:${worktreePreviewFile.path}`;
    }
    if (branchDiffState) {
      return `branch:${branchDiffState.mode}:${branchDiffState.branch}:${branchDiffState.compareBranch ?? ""}`;
    }
    if (comparePreviewDetailFile) {
      return `compare:${comparePreviewDetailFile.path}`;
    }
    if (pushPreviewModalFile) {
      return `push:${pushPreviewModalFile.path}`;
    }
    return null;
  }, [
    branchDiffState,
    comparePreviewDetailFile,
    previewDetailFile,
    pushPreviewModalFile,
    worktreePreviewFile,
  ]);

  useEffect(() => {
    setIsHistoryDiffModalMaximized(false);
  }, [activeHistoryDiffModalKey]);

  const loadCommitFileFullDiff = useCallback(
    async (commitSha: string, path: string): Promise<string> => {
      if (!workspaceId) {
        return "";
      }
      const normalizedPath = path.replace(/^(?:a|b)\//, "");
      const cachePathKey = `full_ctx200k:${normalizedPath}`;
      const cachedByPath = commitFullDiffCacheRef.current.get(commitSha);
      if (cachedByPath && cachedByPath.has(cachePathKey)) {
        return cachedByPath.get(cachePathKey) ?? "";
      }

      const commitDiffs = await getGitCommitDiff(workspaceId, commitSha, {
        path: normalizedPath,
        contextLines: 200_000,
      });
      const fullDiff =
        commitDiffs.find((entry) => entry.path === normalizedPath)?.diff
        ?? commitDiffs[0]?.diff
        ?? "";

      const nextCache = cachedByPath ? new Map(cachedByPath) : new Map<string, string>();
      nextCache.set(cachePathKey, fullDiff);
      commitFullDiffCacheRef.current.set(commitSha, nextCache);
      return fullDiff;
    },
    [workspaceId],
  );

  const previewModalFullDiffLoader = useCallback(
    (path: string) => {
      if (!selectedCommitSha) {
        return Promise.resolve("");
      }
      return loadCommitFileFullDiff(selectedCommitSha, path);
    },
    [loadCommitFileFullDiff, selectedCommitSha],
  );

  const pushPreviewModalFullDiffLoader = useCallback(
    (path: string) => {
      if (!pushPreviewSelectedSha) {
        return Promise.resolve("");
      }
      return loadCommitFileFullDiff(pushPreviewSelectedSha, path);
    },
    [loadCommitFileFullDiff, pushPreviewSelectedSha],
  );

  const worktreePreviewFullDiffLoader = useCallback(
    (path: string) => {
      if (!workspaceId) {
        return Promise.resolve("");
      }
      return getGitFileFullDiff(workspaceId, path.replace(/^(?:a|b)\//, ""));
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!previewFileKey) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewFileKey(null);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [previewFileKey]);

  useEffect(() => {
    if (!comparePreviewFileKey) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setComparePreviewFileKey(null);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [comparePreviewFileKey]);

  useEffect(() => {
    if (!pushPreviewModalFileKey) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPushPreviewModalFileKey(null);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [pushPreviewModalFileKey]);

  useEffect(() => {
    if (!worktreePreviewFile) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorktreePreviewFile(null);
        setWorktreePreviewError(null);
        setWorktreePreviewLoading(false);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [worktreePreviewFile]);

  useEffect(() => {
    if (comparePreviewFileKey && !comparePreviewDetailFile) {
      setComparePreviewFileKey(null);
    }
  }, [comparePreviewDetailFile, comparePreviewFileKey]);

  useEffect(() => {
    if (!commitContextMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".git-history-commit-context-menu")) {
        return;
      }
      setCommitContextMenu(null);
    };
    const handleScroll = () => setCommitContextMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommitContextMenu(null);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [commitContextMenu]);

  useEffect(() => {
    if (!commitContextMenu) {
      setCommitContextMoreOpen(false);
    }
  }, [commitContextMenu]);

  useEffect(() => {
    if (!pullDialogOpen) {
      setPullRemoteMenuOpen(false);
      setPullRemoteMenuPlacement("up");
      setPullOptionsMenuOpen(false);
      setPullTargetBranchQuery("");
      setPullTargetBranchMenuOpen(false);
      setPullTargetBranchMenuPlacement("down");
    }
  }, [pullDialogOpen]);

  useEffect(() => {
    if (!syncDialogOpen) {
      setSyncPreviewLoading(false);
      setSyncPreviewError(null);
      setSyncPreviewCommits([]);
      setSyncPreviewTargetFound(true);
    }
  }, [syncDialogOpen]);

  useEffect(() => {
    if (!pullDialogOpen || !pullOptionsMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!pullOptionsMenuRef.current?.contains(target)) {
        setPullOptionsMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pullDialogOpen, pullOptionsMenuOpen]);

  useEffect(() => {
    if (!pullDialogOpen || (!pullRemoteMenuOpen && !pullTargetBranchMenuOpen)) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (pullRemotePickerRef.current?.contains(target)) {
        return;
      }
      if (pullTargetBranchFieldRef.current?.contains(target)) {
        return;
      }
      setPullRemoteMenuOpen(false);
      setPullTargetBranchMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pullDialogOpen, pullRemoteMenuOpen, pullTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pushDialogOpen) {
      setPushRemoteMenuOpen(false);
      setPushRemoteMenuPlacement("up");
      setPushTargetBranchMenuOpen(false);
      setPushTargetBranchMenuPlacement("down");
      setPushTargetBranchQuery("");
      pushPreviewLoadTokenRef.current += 1;
      pushPreviewDetailsLoadTokenRef.current += 1;
      setPushPreviewLoading(false);
      setPushPreviewError(null);
      setPushPreviewTargetFound(true);
      setPushPreviewHasMore(false);
      setPushPreviewCommits([]);
      setPushPreviewSelectedSha(null);
      setPushPreviewDetails(null);
      setPushPreviewDetailsLoading(false);
      setPushPreviewDetailsError(null);
      setPushPreviewExpandedDirs(new Set());
      setPushPreviewSelectedFileKey(null);
      setPushPreviewModalFileKey(null);
    }
  }, [pushDialogOpen]);

  useEffect(() => {
    if (!pushDialogOpen || (!pushRemoteMenuOpen && !pushTargetBranchMenuOpen)) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (pushRemotePickerRef.current?.contains(target)) {
        return;
      }
      if (pushTargetBranchFieldRef.current?.contains(target)) {
        return;
      }
      setPushRemoteMenuOpen(false);
      setPushTargetBranchMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pushDialogOpen, pushRemoteMenuOpen, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (previewFileKey && !previewDetailFile) {
      setPreviewFileKey(null);
    }
  }, [previewDetailFile, previewFileKey]);

  useEffect(() => {
    if (!pushPreviewDetails) {
      setPushPreviewExpandedDirs(new Set());
      setPushPreviewSelectedFileKey(null);
      setPushPreviewModalFileKey(null);
      return;
    }
    setPushPreviewExpandedDirs(collectDirPaths(pushPreviewDetails.files));
    setPushPreviewSelectedFileKey((previousKey) =>
      pickSelectedFileKey(previousKey, pushPreviewDetails.files),
    );
    // Diff modal should only open when user explicitly clicks a file item.
    setPushPreviewModalFileKey(null);
  }, [pushPreviewDetails]);

  useEffect(() => {
    if (pushPreviewModalFileKey && !pushPreviewModalFile) {
      setPushPreviewModalFileKey(null);
    }
  }, [pushPreviewModalFile, pushPreviewModalFileKey]);

  const getOperationDisplayName = useCallback(
    (operationName: string) => {
      const nameMap: Record<string, string> = {
        pull: t("git.pull"),
        push: t("git.push"),
        createPr: t("git.historyOperationCreatePr"),
        sync: t("git.sync"),
        fetch: t("git.fetch"),
        refresh: t("git.refresh"),
        checkout: t("git.historyOperationCheckout"),
        createBranch: t("git.historyOperationCreateBranch"),
        createFromCommit: t("git.historyOperationCreateFromCommit"),
        deleteBranch: t("git.historyOperationDeleteBranch"),
        renameBranch: t("git.historyOperationRenameBranch"),
        mergeBranch: t("git.historyOperationMergeBranch"),
        checkoutRebase: t("git.historyOperationCheckoutAndRebase"),
        rebaseBranch: t("git.historyOperationRebaseCurrentBranch"),
        reset: t("git.historyOperationReset"),
        revert: t("git.historyOperationRevertCommit"),
        "cherry-pick": t("git.historyOperationCherryPick"),
      };
      return nameMap[operationName] ?? operationName;
    },
    [t],
  );

  const clearOperationNotice = useCallback(() => {
    if (operationNoticeTimerRef.current !== null) {
      window.clearTimeout(operationNoticeTimerRef.current);
      operationNoticeTimerRef.current = null;
    }
    setOperationNotice(null);
  }, []);

  const showOperationNotice = useCallback((notice: GitOperationNoticeState) => {
    if (operationNoticeTimerRef.current !== null) {
      window.clearTimeout(operationNoticeTimerRef.current);
      operationNoticeTimerRef.current = null;
    }
    setOperationNotice(notice);
    if (notice.kind === "success") {
      operationNoticeTimerRef.current = window.setTimeout(() => {
        setOperationNotice(null);
        operationNoticeTimerRef.current = null;
      }, 5000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (operationNoticeTimerRef.current !== null) {
        window.clearTimeout(operationNoticeTimerRef.current);
      }
      if (createPrProgressTimerRef.current !== null) {
        window.clearInterval(createPrProgressTimerRef.current);
      }
      if (forceDeleteDialogResolverRef.current) {
        forceDeleteDialogResolverRef.current(false);
        forceDeleteDialogResolverRef.current = null;
      }
    };
  }, []);

  const localizedOperationName = useMemo(() => {
    if (!operationLoading) {
      return null;
    }
    return getOperationDisplayName(operationLoading);
  }, [getOperationDisplayName, operationLoading]);

  const localizeKnownGitError = useCallback(
    (message: string | null): string | null => {
      return localizeGitErrorMessage(message, t);
    },
    [t],
  );

  const createOperationErrorState = useCallback(
    (rawMessage: string): GitOperationErrorState => {
      const normalized = rawMessage.toLowerCase();
      if (isWorkingTreeDirtyBlockingError(rawMessage)) {
        return {
          userMessage: t("git.historyErrorWorkingTreeDirty"),
          debugMessage: rawMessage,
          retryable: true,
        };
      }
      if (normalized.includes("snapshot expired")) {
        return {
          userMessage: t("git.historySnapshotExpired"),
          debugMessage: rawMessage,
          retryable: true,
        };
      }
      return {
        userMessage: localizeKnownGitError(rawMessage) ?? rawMessage,
        debugMessage: rawMessage,
        retryable: true,
      };
    },
    [localizeKnownGitError, t],
  );

  const isBranchDeleteNotFullyMergedError = useCallback((rawMessage: string): boolean => {
    const normalized = rawMessage.toLowerCase();
    return normalized.includes("is not fully merged");
  }, []);

  const isBranchDeleteUsedByWorktreeError = useCallback((rawMessage: string): boolean => {
    const normalized = rawMessage.toLowerCase();
    return (
      normalized.includes("cannot delete branch") &&
      normalized.includes("used by worktree")
    );
  }, []);

  const extractWorktreePathFromDeleteError = useCallback((rawMessage: string): string | null => {
    const matched = rawMessage.match(/used by worktree at ['"]?([^'"\n]+)['"]?/i);
    const path = matched?.[1]?.trim();
    return path ? path : null;
  }, []);

  const promptForceDeleteDialog = useCallback(
    (
      mode: ForceDeleteDialogMode,
      branch: string,
      worktreePath: string | null,
    ) =>
      new Promise<boolean>((resolve) => {
        forceDeleteDialogResolverRef.current = resolve;
        setForceDeleteDialogState({ mode, branch, worktreePath });
      }),
    [],
  );

  const closeForceDeleteDialog = useCallback((confirmed: boolean) => {
    setForceDeleteDialogState(null);
    const resolver = forceDeleteDialogResolverRef.current;
    forceDeleteDialogResolverRef.current = null;
    resolver?.(confirmed);
  }, []);

  useEffect(() => {
    if (!forceDeleteDialogState) {
      setForceDeleteCountdown(0);
      setForceDeleteCopiedPath(false);
      return;
    }
    setForceDeleteCountdown(2);
    setForceDeleteCopiedPath(false);
    const timer = window.setInterval(() => {
      setForceDeleteCountdown((previous) => (previous > 0 ? previous - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [forceDeleteDialogState]);

  const handleCopyForceDeleteWorktreePath = useCallback(async () => {
    const path = forceDeleteDialogState?.worktreePath;
    if (!path) {
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      setForceDeleteCopiedPath(true);
      window.setTimeout(() => setForceDeleteCopiedPath(false), 1200);
    } catch {
      setForceDeleteCopiedPath(false);
    }
  }, [forceDeleteDialogState?.worktreePath]);

  const runOperation = useCallback(
    async (name: string, action: () => Promise<void>) => {
      clearOperationNotice();
      setOperationLoading(name);
      try {
        await action();
        await refreshAll();
        showOperationNotice({
          kind: "success",
          message: t("git.historyOperationSucceeded", {
            operation: getOperationDisplayName(name),
          }),
        });
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        const operationState = createOperationErrorState(rawMessage);
        showOperationNotice({
          kind: "error",
          message: `${t("git.historyOperationFailed", {
            operation: getOperationDisplayName(name),
          })} ${operationState.userMessage}${
            operationState.retryable ? ` ${t("git.historyOperationRetryHint")}` : ""
          }`,
          debugMessage: operationState.debugMessage,
        });
      } finally {
        setOperationLoading(null);
      }
    },
    [
      clearOperationNotice,
      createOperationErrorState,
      getOperationDisplayName,
      refreshAll,
      showOperationNotice,
      t,
    ],
  );

  const createBranchNameTrimmed = createBranchName.trim();
  const createBranchSubmitting = operationLoading === "createBranch";
  const createBranchCanConfirm = Boolean(
    workspaceId &&
      !createBranchSubmitting &&
      createBranchSource.trim() &&
      createBranchNameTrimmed,
  );
  const renameBranchNameTrimmed = renameBranchName.trim();
  const renameBranchSubmitting = operationLoading === "renameBranch";
  const renameBranchCanConfirm = Boolean(
    workspaceId &&
      !renameBranchSubmitting &&
      renameBranchSource.trim() &&
      renameBranchNameTrimmed &&
      renameBranchNameTrimmed !== renameBranchSource,
  );
  const createPrSubmitting = operationLoading === "createPr";
  const createPrToolbarDisabledReason = !currentBranch
    ? t("git.historyCreatePrUnavailableNoBranch")
    : null;
  const createPrCanOpen = Boolean(
    workspaceId &&
      !operationLoading &&
      currentBranch &&
      !repositoryUnavailable,
  );
  const createPrUpstreamParts = useMemo(
    () => splitGitHubRepo(createPrForm.upstreamRepo),
    [createPrForm.upstreamRepo],
  );
  const createPrHeadRepositoryValue = useMemo(() => {
    const owner = createPrForm.headOwner.trim();
    if (!owner) {
      return "";
    }
    if (!createPrUpstreamParts.repo) {
      return owner;
    }
    return `${owner}/${createPrUpstreamParts.repo}`;
  }, [createPrForm.headOwner, createPrUpstreamParts.repo]);
  const createPrBaseRepoOptions = useMemo<GitHistoryInlinePickerOption[]>(
    () =>
      uniqueNonEmpty([
        createPrForm.upstreamRepo,
        createPrDefaults?.upstreamRepo ?? "",
      ]).map((repo) => ({
        value: repo,
        label: repo,
        description: t("git.historyCreatePrFieldUpstreamRepo"),
        group: t("git.historyCreatePrGroupSuggested"),
      })),
    [createPrDefaults?.upstreamRepo, createPrForm.upstreamRepo, t],
  );
  const createPrHeadRepoOptions = useMemo(() => {
    const upstreamOwner = createPrUpstreamParts.owner;
    const repoName = createPrUpstreamParts.repo;
    const ownerCandidates = uniqueNonEmpty([
      createPrForm.headOwner,
      createPrDefaults?.headOwner ?? "",
      upstreamOwner,
    ]);
    return ownerCandidates.map((owner) => {
      const repo = repoName ? `${owner}/${repoName}` : owner;
      return {
        value: repo,
        label: repo,
        description: t("git.historyCreatePrFieldHeadOwner"),
        group: t("git.historyCreatePrGroupSuggested"),
      } satisfies GitHistoryInlinePickerOption;
    });
  }, [
    createPrDefaults?.headOwner,
    createPrForm.headOwner,
    createPrUpstreamParts.owner,
    createPrUpstreamParts.repo,
    t,
  ]);
  const createPrUpstreamRemoteName = useMemo(() => {
    const remoteNames = uniqueNonEmpty(
      remoteBranches
        .map((entry) => entry.remote?.trim() ?? "")
        .filter((name) => name.length > 0),
    );
    const explicitUpstream = remoteNames.find((name) => name.toLowerCase() === "upstream");
    return explicitUpstream ?? null;
  }, [remoteBranches]);
  const createPrPreviewBaseRemoteName = createPrUpstreamRemoteName ?? "upstream";
  const createPrPreviewHeadRef = createPrForm.headBranch.trim();
  const createPrPreviewBaseRef = createPrForm.baseBranch.trim()
    ? `${createPrPreviewBaseRemoteName}/${createPrForm.baseBranch.trim()}`
    : "";
  const createPrBaseBranchOptions = useMemo<GitHistoryInlinePickerOption[]>(() => {
    const remoteBranchLeaves = remoteBranches
      .filter((entry) => {
        if (!createPrUpstreamRemoteName) {
          return true;
        }
        return (entry.remote?.trim() ?? "") === createPrUpstreamRemoteName;
      })
      .map((entry) => {
        const remoteName = entry.remote?.trim();
        if (remoteName && entry.name.startsWith(`${remoteName}/`)) {
          return entry.name.slice(remoteName.length + 1);
        }
        const slashIndex = entry.name.indexOf("/");
        return slashIndex >= 0 ? entry.name.slice(slashIndex + 1) : entry.name;
      });
    const prioritized = sortOptionsWithPriority(
      uniqueNonEmpty([
        ...remoteBranchLeaves,
        createPrForm.baseBranch,
        createPrDefaults?.baseBranch ?? "",
      ]),
      [
        createPrForm.baseBranch,
        createPrDefaults?.baseBranch ?? "",
        "main",
        "master",
        "develop",
      ],
    );
    const suggested = new Set(
      uniqueNonEmpty([
        createPrForm.baseBranch,
        createPrDefaults?.baseBranch ?? "",
        "main",
        "master",
        "develop",
      ]),
    );
    return prioritized.map((branch) => ({
      value: branch,
      label: branch,
      description: t("git.historyCreatePrFieldBaseBranch"),
      group: suggested.has(branch)
        ? t("git.historyCreatePrGroupSuggested")
        : t("git.historyCreatePrGroupRemote"),
    }));
  }, [
    createPrDefaults?.baseBranch,
    createPrForm.baseBranch,
    createPrUpstreamRemoteName,
    remoteBranches,
    t,
  ]);
  const createPrCompareBranchOptions = useMemo<GitHistoryInlinePickerOption[]>(
    () => sortOptionsWithPriority(
      uniqueNonEmpty([
        ...localBranches.map((entry) => entry.name),
        createPrForm.headBranch,
        currentBranch ?? "",
      ]),
      [createPrForm.headBranch, currentBranch ?? ""],
    ).map((branch) => {
      const scope = getBranchScope(branch);
      return {
        value: branch,
        label: getBranchLeafName(branch),
        description: t("git.historyCreatePrFieldHeadBranch"),
        group: scope === "__root__" ? t("git.historyPushDialogGroupRoot") : scope,
      };
    }),
    [createPrForm.headBranch, currentBranch, localBranches, t],
  );
  const createPrCanConfirm = Boolean(
    workspaceId &&
      !createPrSubmitting &&
      !createPrDefaultsLoading &&
      !createPrDefaultsError &&
      (createPrDefaults?.canCreate ?? true) &&
      createPrForm.upstreamRepo.trim() &&
      createPrForm.baseBranch.trim() &&
      createPrForm.headOwner.trim() &&
      createPrForm.headBranch.trim() &&
      createPrForm.title.trim(),
  );
  const createPrResultHeadline = useMemo(() => {
    if (!createPrResult) {
      return "";
    }
    if (createPrResult.status === "existing") {
      return t("git.historyCreatePrResultExisting");
    }
    if (createPrResult.ok) {
      return t("git.historyCreatePrResultSuccess");
    }
    return t("git.historyCreatePrResultFailed");
  }, [createPrResult, t]);
  const createPrPreviewHasMore = createPrPreviewCommits.length >= CREATE_PR_PREVIEW_COMMIT_LIMIT;
  const createPrPreviewSelectedCommit = useMemo(
    () => createPrPreviewCommits.find((entry) => entry.sha === createPrPreviewSelectedSha) ?? null,
    [createPrPreviewCommits, createPrPreviewSelectedSha],
  );
  const selectedLocalBranchForRename = useMemo(() => {
    const candidate = selectedBranch === "all" ? currentBranch : selectedBranch;
    if (!candidate) {
      return null;
    }
    return localBranches.some((entry) => entry.name === candidate) ? candidate : null;
  }, [currentBranch, localBranches, selectedBranch]);
  const renameBranchToolbarDisabledReason = useMemo(() => {
    if (operationLoading) {
      return t("git.historyBranchMenuUnavailableBusy");
    }
    if (selectedBranch !== "all" && selectedBranch && !localBranches.some((entry) => entry.name === selectedBranch)) {
      return t("git.historyBranchMenuUnavailableRemote");
    }
    if (!selectedLocalBranchForRename) {
      return t("git.historyBranchMenuUnavailableNoCurrent");
    }
    return null;
  }, [localBranches, operationLoading, selectedBranch, selectedLocalBranchForRename, t]);
  const pullSubmitting = operationLoading === "pull";
  const syncSubmitting = operationLoading === "sync";
  const fetchSubmitting = operationLoading === "fetch";
  const refreshSubmitting = operationLoading === "refresh";
  const pushSubmitting = operationLoading === "push";
  const pullRemoteTrimmed = pullRemote.trim();
  const pushRemoteTrimmed = pushRemote.trim();
  const pushTargetBranchTrimmed = pushTargetBranch.trim();
  const pushTargetBranchQueryTrimmed = pushTargetBranchQuery.trim();

  const resolvePushTargetBranchOptions = useCallback(
    (remoteName: string): string[] => {
      const normalizedRemote = remoteName.trim();
      if (!normalizedRemote) {
        return [];
      }
      const branchSet = new Set<string>();
      const remotePrefix = `${normalizedRemote}/`;
      for (const branch of remoteBranches) {
        const fromMeta = branch.remote?.trim();
        if (fromMeta && fromMeta !== normalizedRemote) {
          continue;
        }
        const normalizedName = branch.name.trim();
        if (normalizedName.startsWith(remotePrefix)) {
          const leaf = normalizedName.slice(remotePrefix.length).trim();
          if (leaf) {
            branchSet.add(leaf);
          }
        }
      }
      return Array.from(branchSet).sort((a, b) => a.localeCompare(b));
    },
    [remoteBranches],
  );

  const pushRemoteOptions = useMemo(() => {
    const set = new Set<string>();
    for (const branch of remoteBranches) {
      if (branch.remote?.trim()) {
        set.add(branch.remote.trim());
      }
      const slashIndex = branch.name.indexOf("/");
      if (slashIndex > 0) {
        set.add(branch.name.slice(0, slashIndex));
      }
    }
    if (!set.size) {
      set.add("origin");
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [remoteBranches]);

  const pushTargetBranchOptions = useMemo(
    () => resolvePushTargetBranchOptions(pushRemoteTrimmed || pushRemote),
    [pushRemote, pushRemoteTrimmed, resolvePushTargetBranchOptions],
  );

  const filteredPushTargetBranchOptions = useMemo(() => {
    const keyword = pushTargetBranchQueryTrimmed.toLowerCase();
    if (!keyword) {
      return pushTargetBranchOptions;
    }
    const matched = pushTargetBranchOptions.filter((branchName) =>
      branchName.toLowerCase().includes(keyword),
    );
    return matched.length > 0 ? matched : pushTargetBranchOptions;
  }, [pushTargetBranchOptions, pushTargetBranchQueryTrimmed]);

  const pushTargetBranchGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const grouped = new Map<string, string[]>();
    for (const branchName of filteredPushTargetBranchOptions) {
      const scope = getBranchScope(branchName);
      const bucket = grouped.get(scope) ?? [];
      bucket.push(branchName);
      grouped.set(scope, bucket);
    }
    const sortedScopes = Array.from(grouped.keys()).sort((a, b) => {
      if (a === "__root__") {
        return -1;
      }
      if (b === "__root__") {
        return 1;
      }
      return a.localeCompare(b);
    });
    return sortedScopes.map((scope) => ({
      scope,
      label: scope === "__root__" ? t("git.historyPushDialogGroupRoot") : scope,
      items: (grouped.get(scope) ?? []).sort((a, b) => a.localeCompare(b)),
    }));
  }, [filteredPushTargetBranchOptions, t]);
  const visiblePushTargetBranchGroups = useMemo(() => {
    if (pushTargetBranchGroups.length <= 1) {
      return pushTargetBranchGroups;
    }
    const activeScope = pushTargetBranchActiveScopeTab ?? pushTargetBranchGroups[0]?.scope ?? null;
    return pushTargetBranchGroups.filter((group) => group.scope === activeScope);
  }, [pushTargetBranchActiveScopeTab, pushTargetBranchGroups]);

  const pullRemoteOptions = pushRemoteOptions;
  const pullRemoteGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const sortedRemotes = [...pullRemoteOptions].sort((left, right) => left.localeCompare(right));
    if (!sortedRemotes.length) {
      return [];
    }
    return [
      {
        scope: "__root__",
        label: t("git.historyPushDialogGroupRoot"),
        items: sortedRemotes,
      },
    ];
  }, [pullRemoteOptions, t]);
  const pullTargetBranchTrimmed = pullTargetBranch.trim();
  const pullTargetBranchQueryTrimmed = pullTargetBranchQuery.trim();
  const pullTargetBranchOptions = useMemo(
    () => resolvePushTargetBranchOptions(pullRemoteTrimmed || "origin"),
    [pullRemoteTrimmed, resolvePushTargetBranchOptions],
  );
  const filteredPullTargetBranchOptions = useMemo(() => {
    const keyword = pullTargetBranchQueryTrimmed.toLowerCase();
    if (!keyword) {
      return pullTargetBranchOptions;
    }
    const matched = pullTargetBranchOptions.filter((branchName) =>
      branchName.toLowerCase().includes(keyword),
    );
    return matched.length > 0 ? matched : pullTargetBranchOptions;
  }, [pullTargetBranchOptions, pullTargetBranchQueryTrimmed]);
  const pullTargetBranchGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const grouped = new Map<string, string[]>();
    for (const branchName of filteredPullTargetBranchOptions) {
      const scope = getBranchScope(branchName);
      const bucket = grouped.get(scope) ?? [];
      bucket.push(branchName);
      grouped.set(scope, bucket);
    }
    const sortedScopes = Array.from(grouped.keys()).sort((a, b) => {
      if (a === "__root__") {
        return -1;
      }
      if (b === "__root__") {
        return 1;
      }
      return a.localeCompare(b);
    });
    return sortedScopes.map((scope) => ({
      scope,
      label: scope === "__root__" ? t("git.historyPushDialogGroupRoot") : scope,
      items: (grouped.get(scope) ?? []).sort((a, b) => a.localeCompare(b)),
    }));
  }, [filteredPullTargetBranchOptions, t]);
  const visiblePullTargetBranchGroups = useMemo(() => {
    if (pullTargetBranchGroups.length <= 1) {
      return pullTargetBranchGroups;
    }
    const activeScope = pullTargetBranchActiveScopeTab ?? pullTargetBranchGroups[0]?.scope ?? null;
    return pullTargetBranchGroups.filter((group) => group.scope === activeScope);
  }, [pullTargetBranchActiveScopeTab, pullTargetBranchGroups]);
  const pullSelectedOptions = useMemo(() => {
    const options: Array<{ id: string; label: string; onRemove: () => void }> = [];
    if (pullStrategy) {
      options.push({
        id: pullStrategy,
        label: pullStrategy,
        onRemove: () => setPullStrategy(null),
      });
    }
    if (pullNoCommit) {
      options.push({
        id: "--no-commit",
        label: "--no-commit",
        onRemove: () => setPullNoCommit(false),
      });
    }
    if (pullNoVerify) {
      options.push({
        id: "--no-verify",
        label: "--no-verify",
        onRemove: () => setPullNoVerify(false),
      });
    }
    return options;
  }, [pullNoCommit, pullNoVerify, pullStrategy]);

  useEffect(() => {
    if (!pullTargetBranchMenuOpen) {
      return;
    }
    const availableScopes = pullTargetBranchGroups.map((group) => group.scope);
    const currentBranchScope = currentBranch ? getBranchScope(currentBranch) : null;
    const selectedScope = pullTargetBranchTrimmed ? getBranchScope(pullTargetBranchTrimmed) : null;
    setPullTargetBranchActiveScopeTab((previous) => {
      if (currentBranchScope && availableScopes.includes(currentBranchScope)) {
        return currentBranchScope;
      }
      if (selectedScope && availableScopes.includes(selectedScope)) {
        return selectedScope;
      }
      if (previous && availableScopes.includes(previous)) {
        return previous;
      }
      return availableScopes[0] ?? null;
    });
  }, [currentBranch, pullTargetBranchGroups, pullTargetBranchMenuOpen, pullTargetBranchTrimmed]);

  useEffect(() => {
    if (!pushTargetBranchMenuOpen) {
      return;
    }
    const availableScopes = pushTargetBranchGroups.map((group) => group.scope);
    const currentBranchScope = currentBranch ? getBranchScope(currentBranch) : null;
    const selectedScope = pushTargetBranchTrimmed ? getBranchScope(pushTargetBranchTrimmed) : null;
    setPushTargetBranchActiveScopeTab((previous) => {
      if (currentBranchScope && availableScopes.includes(currentBranchScope)) {
        return currentBranchScope;
      }
      if (selectedScope && availableScopes.includes(selectedScope)) {
        return selectedScope;
      }
      if (previous && availableScopes.includes(previous)) {
        return previous;
      }
      return availableScopes[0] ?? null;
    });
  }, [currentBranch, pushTargetBranchGroups, pushTargetBranchMenuOpen, pushTargetBranchTrimmed]);

  const updatePullTargetBranchMenuPlacement = useCallback(() => {
    if (typeof window === "undefined") {
      setPullTargetBranchMenuPlacement("down");
      return;
    }
    const anchorElement = pullTargetBranchPickerRef.current;
    if (!anchorElement) {
      setPullTargetBranchMenuPlacement("down");
      return;
    }
    const anchorRect = anchorElement.getBoundingClientRect();
    const spaceAbove = anchorRect.top - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const spaceBelow = window.innerHeight - anchorRect.bottom - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const estimatedRowCount = pullTargetBranchGroups.reduce(
      (total, group) => total + group.items.length + 1,
      0,
    );
    const estimatedMenuHeight = Math.max(
      PUSH_TARGET_MENU_MIN_HEIGHT,
      Math.min(
        PUSH_TARGET_MENU_MAX_HEIGHT,
        estimatedRowCount * PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT + 28,
      ),
    );
    const shouldOpenUpward =
      spaceBelow < estimatedMenuHeight &&
      spaceAbove > spaceBelow &&
      spaceAbove > PUSH_TARGET_MENU_MIN_HEIGHT;
    setPullTargetBranchMenuPlacement(shouldOpenUpward ? "up" : "down");
  }, [pullTargetBranchGroups]);

  const updatePullRemoteMenuPlacement = useCallback(() => {
    setPullRemoteMenuPlacement("up");
  }, []);

  const openPullTargetBranchMenu = useCallback(
    (resetQuery: boolean) => {
      if (pullSubmitting) {
        return;
      }
      setPullRemoteMenuOpen(false);
      setPullOptionsMenuOpen(false);
      if (resetQuery) {
        setPullTargetBranchQuery("");
      }
      updatePullTargetBranchMenuPlacement();
      setPullTargetBranchMenuOpen(true);
    },
    [pullSubmitting, updatePullTargetBranchMenuPlacement],
  );

  useEffect(() => {
    if (!pullDialogOpen || !pullTargetBranchMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePullTargetBranchMenuPlacement();
    handleLayoutChange();
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [pullDialogOpen, pullTargetBranchMenuOpen, updatePullTargetBranchMenuPlacement]);

  useEffect(() => {
    if (!pullTargetBranchMenuOpen) {
      return;
    }
    scrollElementToTop(pullTargetBranchMenuRef.current);
  }, [pullTargetBranchActiveScopeTab, pullTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pullDialogOpen || !pullRemoteMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePullRemoteMenuPlacement();
    handleLayoutChange();
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [pullDialogOpen, pullRemoteMenuOpen, updatePullRemoteMenuPlacement]);

  const updatePushTargetBranchMenuPlacement = useCallback(() => {
    if (typeof window === "undefined") {
      setPushTargetBranchMenuPlacement("down");
      return;
    }
    const anchorElement = pushTargetBranchPickerRef.current;
    if (!anchorElement) {
      setPushTargetBranchMenuPlacement("down");
      return;
    }
    const anchorRect = anchorElement.getBoundingClientRect();
    const spaceAbove = anchorRect.top - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const spaceBelow = window.innerHeight - anchorRect.bottom - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const estimatedRowCount = pushTargetBranchGroups.reduce(
      (total, group) => total + group.items.length + 1,
      0,
    );
    const estimatedMenuHeight = Math.max(
      PUSH_TARGET_MENU_MIN_HEIGHT,
      Math.min(
        PUSH_TARGET_MENU_MAX_HEIGHT,
        estimatedRowCount * PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT + 28,
      ),
    );
    const shouldOpenUpward =
      spaceBelow < estimatedMenuHeight &&
      spaceAbove > spaceBelow &&
      spaceAbove > PUSH_TARGET_MENU_MIN_HEIGHT;
    setPushTargetBranchMenuPlacement(shouldOpenUpward ? "up" : "down");
  }, [pushTargetBranchGroups]);

  const updatePushRemoteMenuPlacement = useCallback(() => {
    setPushRemoteMenuPlacement("up");
  }, []);

  const openPushTargetBranchMenu = useCallback(
    (resetQuery: boolean) => {
      if (pushSubmitting) {
        return;
      }
      setPushRemoteMenuOpen(false);
      if (resetQuery) {
        setPushTargetBranchQuery("");
      }
      updatePushTargetBranchMenuPlacement();
      setPushTargetBranchMenuOpen(true);
    },
    [pushSubmitting, updatePushTargetBranchMenuPlacement],
  );

  useEffect(() => {
    if (!pushDialogOpen || !pushTargetBranchMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePushTargetBranchMenuPlacement();
    handleLayoutChange();
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [pushDialogOpen, pushTargetBranchMenuOpen, updatePushTargetBranchMenuPlacement]);

  useEffect(() => {
    if (!pushTargetBranchMenuOpen) {
      return;
    }
    scrollElementToTop(pushTargetBranchMenuRef.current);
  }, [pushTargetBranchActiveScopeTab, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pushDialogOpen || !pushRemoteMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePushRemoteMenuPlacement();
    handleLayoutChange();
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [pushDialogOpen, pushRemoteMenuOpen, updatePushRemoteMenuPlacement]);

  const pushHasOutgoingCommits = pushPreviewCommits.length > 0;
  const pushIsNewBranchTarget = Boolean(
    pushDialogOpen && !pushPreviewLoading && !pushPreviewError && !pushPreviewTargetFound,
  );
  const pushTargetSummaryBranch = useMemo(() => {
    const targetBranch = pushTargetBranchTrimmed || currentBranch || "main";
    if (pushToGerrit) {
      return `refs/for/${targetBranch}`;
    }
    return targetBranch;
  }, [currentBranch, pushTargetBranchTrimmed, pushToGerrit]);
  const pushPreviewSelectedCommit = useMemo(
    () => pushPreviewCommits.find((entry) => entry.sha === pushPreviewSelectedSha) ?? null,
    [pushPreviewCommits, pushPreviewSelectedSha],
  );

  const pushCanConfirm = Boolean(
    workspaceId &&
      !pushSubmitting &&
      pushRemoteTrimmed &&
      pushTargetBranchTrimmed &&
      !pushPreviewLoading &&
      !pushPreviewError &&
      pushHasOutgoingCommits,
  );

  const workingTreeSummaryLabel =
    workingTreeChangedFiles > 0
      ? t("git.filesChanged", { count: workingTreeChangedFiles })
      : t("git.workingTreeClean");
  const projectOptions = useMemo(() => {
    if (workspaces.length > 0) {
      return workspaces;
    }
    return workspace ? [workspace] : [];
  }, [workspace, workspaces]);
  const projectSections = useMemo(() => {
    const worktreesByParent = new Map<string, WorkspaceInfo[]>();
    for (const entry of workspaces) {
      if ((entry.kind ?? "main") !== "worktree" || !entry.parentId) {
        continue;
      }
      const bucket = worktreesByParent.get(entry.parentId) ?? [];
      bucket.push(entry);
      worktreesByParent.set(entry.parentId, bucket);
    }
    for (const bucket of worktreesByParent.values()) {
      bucket.sort((a, b) => {
        const orderDiff =
          getSortOrderValue(a.settings.sortOrder) - getSortOrderValue(b.settings.sortOrder);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return a.name.localeCompare(b.name);
      });
    }

    const toOption = (
      entry: WorkspaceInfo,
      kind: "main" | "worktree",
      parentLabel?: string | null,
    ) =>
      ({
        id: entry.id,
        label: entry.name,
        kind,
        parentLabel: parentLabel ?? null,
      }) satisfies GitHistoryPickerOption;

    if (groupedWorkspaces.length > 0) {
      return groupedWorkspaces
        .map((section) => ({
          id: section.id,
          name: section.name,
          options: section.workspaces.flatMap((entry) => {
            const worktreeOptions = (worktreesByParent.get(entry.id) ?? []).map((worktree) =>
              toOption(worktree, "worktree", entry.name),
            );
            return [toOption(entry, "main"), ...worktreeOptions];
          }),
        }))
        .filter((section) => section.options.length > 0);
    }
    return [
      {
        id: null,
        name: "",
        options: projectOptions.map((entry) =>
          toOption(
            entry,
            (entry.kind ?? "main") === "worktree" ? "worktree" : "main",
          ),
        ),
      },
    ];
  }, [groupedWorkspaces, projectOptions, workspaces]);
  const shouldShowWorkspacePickerPage = !workspace || repositoryUnavailable;
  const workspacePickerMessage = repositoryUnavailable
    ? t("git.historySelectGitWorkspace")
    : t("git.historySelectWorkspace");

  const {refreshFallbackGitRoots,handleFallbackGitRootSelect,workspaceSelectingName,emptyStateStatusText,handleWorktreeSummaryChange,handleToggleLocalScope,handleToggleRemoteScope,handleCheckoutBranch,handleCreateBranch,handleCreateBranchConfirm,applyCreatePrDefaults,handleCreatePrHeadRepositoryChange,loadCreatePrCommitPreview,handleOpenCreatePrDialog,closeCreatePrDialog,handleCopyCreatePrUrl,handleCopyCreatePrRetryCommand,handleConfirmCreatePr,handleOpenPullDialog,handleSelectPullTargetBranch,handleSelectPullRemote,handleConfirmPull,handleOpenSyncDialog,handleConfirmSync,handleOpenFetchDialog,handleConfirmFetch,handleOpenRefreshDialog,handleConfirmRefresh,handleSelectPushRemote,handleSelectPushTargetBranch,handleOpenPushDialog,loadPushPreview,handleConfirmPush,handleCreateBranchFromCommit,handleDeleteBranch,handleOpenRenameBranchDialog,closeRenameBranchDialog,handleRenameBranchConfirm,handleMergeBranch,handleCheckoutAndRebaseCurrent,handleRebaseCurrentOntoBranch,handleShowDiffWithWorktree,handleCompareWithCurrentBranch,handleSelectWorktreeDiffFile,handleSelectBranchCompareCommit,handleRevertSelectedCommit,handleCherryPickCommit,handleCopyCommitRevision,handleCopyCommitMessage,openResetDialog,handleConfirmResetCommit,handleFileTreeDirToggle,handlePushPreviewDirToggle,closeWorktreePreview,handleOpenWorktreePreview,resetTargetCommit,branchContextTrackingSummary,branchContextActions,handleBranchContextMenuKeyDown,branchContextMenuStyle,buildCommitActions,contextCommitActions,contextPrimaryActionGroups,contextWriteActions,contextMoreDisabledReason,runCommitAction,handleOpenCommitContextMenu,getCurrentDefaultColumnWidths,beginVerticalResize,handleOverviewSplitResizeStart,handleBranchesSplitResizeStart,handleCommitsSplitResizeStart,handleDetailsSplitResizeStart,workbenchGridStyle,mainGridStyle,commitRowVirtualizer,virtualCommitRows} = useGitHistoryPanelInteractions({BRANCHES_MIN_WIDTH,COMMITS_MIN_WIDTH,COMMIT_ROW_ESTIMATED_HEIGHT,COMPACT_LAYOUT_BREAKPOINT,CREATE_PR_PREVIEW_COMMIT_LIMIT,DETAILS_MIN_WIDTH,DETAILS_SPLIT_MAX,DETAILS_SPLIT_MIN,DISABLE_HISTORY_COMMIT_ACTIONS,Download,FileText,FolderTree,GitBranch,GitMerge,OVERVIEW_MIN_WIDTH,Pencil,Plus,RefreshCw,Repeat,Trash2,Upload,VERTICAL_SPLITTER_SIZE,ask,branchCompareDetailsCacheRef,branchContextMenu,branchContextMenuRef,branchDiffCacheRef,branchesWidth,buildCreatePrInitialStages,checkoutGitBranch,cherryPickCommit,clamp,clearOperationNotice,closeBranchContextMenu,commitContextMenu,commitListRef,commits,commitsWidth,createBranchName,createBranchSource,createBranchSourceOptions,createGitBranchFromBranch,createGitBranchFromCommit,createGitPrWorkflow,createOperationErrorState,createPrCanConfirm,createPrCanOpen,createPrDefaultsLoading,createPrDialogOpen,createPrForm,createPrPreviewBaseRef,createPrPreviewBaseRemoteName,createPrPreviewDetailsCacheRef,createPrPreviewDetailsLoadTokenRef,createPrPreviewHeadRef,createPrPreviewLoadTokenRef,createPrPreviewSelectedSha,createPrProgressTimerRef,createPrResult,createPrSubmitting,currentBranch,currentLocalBranchEntry,defaults,deleteGitBranch,desktopSplitLayout,details,detailsBodyRef,extractWorktreePathFromDeleteError,fallbackGitRoots,fallbackGitRootsLoading,fallbackSelectingRoot,fetchGit,getGitBranchCompareCommits,getGitCommitDetails,getGitDiffs,getGitPrWorkflowDefaults,getGitPushPreview,getGitStatus,getGitWorktreeDiffAgainstBranch,getGitWorktreeDiffFileAgainstBranch,getOperationDisplayName,historyHasMore,historyLoading,historyLoadingMore,isBranchDeleteNotFullyMergedError,isBranchDeleteUsedByWorktreeError,listGitRoots,loadHistory,localBranches,localizeKnownGitError,mainGridRef,mapCreatePrStagesFromResult,mergeGitBranch,onOpenDiffPath,onSelectWorkspace,onSelectWorkspacePath,operationLoading,overviewWidth,owner,projectOptions,promptForceDeleteDialog,pullGit,pullNoCommit,pullNoVerify,pullRemote,pullRemoteOptions,pullStrategy,pullTargetBranch,pushCanConfirm,pushCc,pushDialogOpen,pushForceWithLease,pushGit,pushPreviewDetailsLoadTokenRef,pushPreviewLoadTokenRef,pushPreviewSelectedSha,pushRemoteOptions,pushRemoteTrimmed,pushReviewers,pushRunHooks,pushTags,pushTargetBranchTrimmed,pushToGerrit,pushTopic,rebaseGitBranch,refreshAll,renameBranchCanConfirm,renameBranchNameTrimmed,renameBranchSource,renameBranchSubmitting,renameGitBranch,repositoryUnavailable,resetGitCommit,resetMode,resetTargetSha,resolveGitRootPath,resolvePushTargetBranchOptions,resolveUpstreamTarget,revertCommit,runOperation,selectedBranch,selectedCommitSha,setBranchContextMenu,setBranchDiffState,setBranchesWidth,setCommitContextMenu,setCommitContextMoreOpen,setCommitsWidth,setComparePreviewFileKey,setCreateBranchDialogOpen,setCreateBranchName,setCreateBranchSource,setCreatePrCopiedPrUrl,setCreatePrCopiedRetryCommand,setCreatePrDefaults,setCreatePrDefaultsError,setCreatePrDefaultsLoading,setCreatePrDialogOpen,setCreatePrForm,setCreatePrPreviewBaseOnlyCount,setCreatePrPreviewCommits,setCreatePrPreviewDetails,setCreatePrPreviewDetailsError,setCreatePrPreviewDetailsLoading,setCreatePrPreviewError,setCreatePrPreviewExpanded,setCreatePrPreviewLoading,setCreatePrPreviewSelectedSha,setCreatePrResult,setCreatePrStages,setDesktopSplitLayout,setDetailsSplitRatio,setExpandedDirs,setExpandedLocalScopes,setExpandedRemoteScopes,setFallbackGitRoots,setFallbackGitRootsError,setFallbackGitRootsLoading,setFallbackSelectingRoot,setFetchDialogOpen,setIsCreatePrDialogMaximized,setOperationLoading,setOverviewWidth,setPullDialogOpen,setPullNoCommit,setPullNoVerify,setPullOptionsMenuOpen,setPullRemote,setPullRemoteMenuOpen,setPullRemoteMenuPlacement,setPullStrategy,setPullTargetBranch,setPullTargetBranchMenuOpen,setPullTargetBranchMenuPlacement,setPullTargetBranchQuery,setPushCc,setPushDialogOpen,setPushForceWithLease,setPushPreviewCommits,setPushPreviewDetails,setPushPreviewDetailsError,setPushPreviewDetailsLoading,setPushPreviewError,setPushPreviewExpandedDirs,setPushPreviewHasMore,setPushPreviewLoading,setPushPreviewSelectedSha,setPushPreviewTargetFound,setPushRemote,setPushRemoteMenuOpen,setPushReviewers,setPushRunHooks,setPushTags,setPushTargetBranch,setPushTargetBranchMenuOpen,setPushTargetBranchMenuPlacement,setPushTargetBranchQuery,setPushToGerrit,setPushTopic,setRefreshDialogOpen,setRenameBranchDialogOpen,setRenameBranchName,setRenameBranchSource,setResetDialogOpen,setResetMode,setResetTargetSha,setSelectedBranch,setSelectedCommitSha,setSyncDialogOpen,setSyncPreviewCommits,setSyncPreviewError,setSyncPreviewLoading,setSyncPreviewTargetBranch,setSyncPreviewTargetFound,setSyncPreviewTargetRemote,setWorkingTreeChangedFiles,setWorkingTreeTotalAdditions,setWorkingTreeTotalDeletions,setWorkspaceSelectingId,setWorktreePreviewError,setWorktreePreviewFile,setWorktreePreviewLoading,showOperationNotice,splitGitHubRepo,syncDialogOpen,syncGit,syncPreviewTargetBranch,syncPreviewTargetRemote,t,trimmed,useCallback,useEffect,useMemo,useVirtualizer,workbenchGridRef,workspace,workspaceId,workspaceSelectingId,workspaces});
  useEffect(() => {
    writeClientStoreValue("layout", persistenceKey, {
      overviewWidth,
      branchesWidth,
      commitsWidth,
      detailsSplitRatio,
      selectedBranch,
      commitQuery,
      selectedCommitSha,
      diffStyle: diffViewMode,
    } satisfies GitHistoryPanelPersistedState);
  }, [
    branchesWidth,
    commitQuery,
    commitsWidth,
    detailsSplitRatio,
    diffViewMode,
    overviewWidth,
    persistenceKey,
    selectedBranch,
    selectedCommitSha,
  ]);

  return renderGitHistoryPanelView({ActionSurface,CREATE_PR_PREVIEW_COMMIT_LIMIT,ChevronDown,ChevronLeft,ChevronRight,ChevronsDownUp,ChevronsUpDown,CircleAlert,CircleCheck,Cloud,CloudDownload,Copy,DEFAULT_DETAILS_SPLIT,DISABLE_HISTORY_ACTION_BUTTONS,Download,FileIcon,FileText,Folder,FolderOpen,FolderTree,GitBranch,GitCommit,GitDiffViewer,GitHistoryInlinePicker,GitHistoryProjectPicker,GitHistoryWorktreePanel,GitMerge,GitPullRequestCreate,HardDrive,LayoutGrid,LoaderCircle,MessageSquareText,Pencil,Plus,RefreshCw,Repeat,Search,ShieldAlert,Trash2,Upload,X,branchContextActions,branchContextMenu,branchContextMenuRef,branchContextMenuStyle,branchContextTrackingSummary,branchDiffState,branchQuery,branchesWidth,buildFileKey,clearOperationNotice,closeBranchContextMenu,closeBranchDiff,closeCreatePrDialog,closeForceDeleteDialog,closeRenameBranchDialog,closeWorktreePreview,commitContextMenu,commitContextMoreOpen,commitListRef,commitQuery,commitRowVirtualizer,commits,commitsWidth,comparePreviewDetailFile,comparePreviewDetailFileDiff,comparePreviewDiffEntries,comparePreviewFileKey,contextMoreDisabledReason,contextPrimaryActionGroups,contextWriteActions,createBranchCanConfirm,createBranchDialogOpen,createBranchName,createBranchNameInputRef,createBranchSource,createBranchSourceOptions,createBranchSubmitting,createPortal,createPrBaseBranchOptions,createPrBaseRepoOptions,createPrCanConfirm,createPrCanOpen,createPrCompareBranchOptions,createPrCopiedPrUrl,createPrCopiedRetryCommand,createPrDefaultsError,createPrDefaultsLoading,createPrDialogOpen,createPrForm,createPrHeadRepoOptions,createPrHeadRepositoryValue,createPrPreviewBaseOnlyCount,createPrPreviewBaseRef,createPrPreviewCommits,createPrPreviewDetails,createPrPreviewDetailsError,createPrPreviewDetailsLoading,createPrPreviewError,createPrPreviewExpanded,createPrPreviewHasMore,createPrPreviewHeadRef,createPrPreviewLoading,createPrPreviewSelectedCommit,createPrPreviewSelectedSha,createPrResult,createPrResultHeadline,createPrStages,createPrSubmitting,createPrToolbarDisabledReason,currentBranch,currentLocalBranchEntry,defaults,desktopSplitLayout,details,detailsBodyRef,detailsError,detailsLoading,detailsMessageContent,detailsSplitRatio,diffViewMode,emptyStateStatusText,expandedLocalScopes,expandedRemoteScopes,extractCommitBody,fallbackGitRoots,fallbackGitRootsError,fallbackGitRootsLoading,fallbackSelectingRoot,fetchDialogOpen,fetchSubmitting,fileTreeItems,forceDeleteCopiedPath,forceDeleteCountdown,forceDeleteDialogState,formatRelativeTime,getBranchLeafName,getBranchScope,getCommitActionIcon,getCurrentDefaultColumnWidths,getSpecialBranchBadges,getTreeLineOpacity,groupedLocalBranches,groupedRemoteBranches,handleBranchContextMenuKeyDown,handleBranchesSplitResizeStart,handleCommitsSplitResizeStart,handleConfirmCreatePr,handleConfirmFetch,handleConfirmPull,handleConfirmPush,handleConfirmRefresh,handleConfirmResetCommit,handleConfirmSync,handleCopyCreatePrRetryCommand,handleCopyCreatePrUrl,handleCopyForceDeleteWorktreePath,handleCreateBranch,handleCreateBranchConfirm,handleCreatePrHeadRepositoryChange,handleDeleteBranch,handleDetailsSplitResizeStart,handleFallbackGitRootSelect,handleFileTreeDirToggle,handleMergeBranch,handleOpenBranchContextMenu,handleOpenCommitContextMenu,handleOpenCreatePrDialog,handleOpenFetchDialog,handleOpenPullDialog,handleOpenPushDialog,handleOpenRefreshDialog,handleOpenRenameBranchDialog,handleOpenSyncDialog,handleOpenWorktreePreview,handleOverviewSplitResizeStart,handlePushPreviewDirToggle,handleRenameBranchConfirm,handleSelectBranchCompareCommit,handleSelectPullRemote,handleSelectPullTargetBranch,handleSelectPushRemote,handleSelectPushTargetBranch,handleSelectWorktreeDiffFile,handleToggleLocalScope,handleToggleRemoteScope,handleWorktreeSummaryChange,historyError,historyHasMore,historyLoading,historyLoadingMore,historyTotal,isCreatePrDialogMaximized,isHistoryDiffModalMaximized,loadCreatePrCommitPreview,loadHistory,localSectionExpanded,localizeKnownGitError,localizedOperationName,mainGridRef,mainGridStyle,onOpenDiffPath,onRequestClose,onSelectWorkspace,openPullTargetBranchMenu,openPushTargetBranchMenu,operationLoading,operationNotice,overviewCommitSectionCollapsed,overviewListView,overviewWidth,previewDetailFile,previewDetailFileDiff,previewDiffEntries,previewModalFullDiffLoader,projectOptions,projectSections,pullDialogOpen,pullNoCommit,pullNoVerify,pullOptionsMenuOpen,pullOptionsMenuRef,pullRemote,pullRemoteGroups,pullRemoteMenuOpen,pullRemoteMenuPlacement,pullRemotePickerRef,pullRemoteTrimmed,pullSelectedOptions,pullStrategy,pullSubmitting,pullTargetBranch,pullTargetBranchActiveScopeTab,pullTargetBranchFieldRef,pullTargetBranchGroups,pullTargetBranchMenuOpen,pullTargetBranchMenuPlacement,pullTargetBranchMenuRef,pullTargetBranchPickerRef,pullTargetBranchTrimmed,pushCanConfirm,pushCc,pushDialogOpen,pushForceWithLease,pushHasOutgoingCommits,pushIsNewBranchTarget,pushPreviewCommits,pushPreviewDetails,pushPreviewDetailsError,pushPreviewDetailsLoading,pushPreviewError,pushPreviewFileTreeItems,pushPreviewHasMore,pushPreviewLoading,pushPreviewModalDiffEntries,pushPreviewModalFile,pushPreviewModalFileDiff,pushPreviewModalFullDiffLoader,pushPreviewSelectedCommit,pushPreviewSelectedFileKey,pushPreviewSelectedSha,pushRemoteMenuOpen,pushRemoteMenuPlacement,pushRemoteOptions,pushRemotePickerRef,pushRemoteTrimmed,pushReviewers,pushRunHooks,pushSubmitting,pushTags,pushTargetBranch,pushTargetBranchActiveScopeTab,pushTargetBranchFieldRef,pushTargetBranchGroups,pushTargetBranchMenuOpen,pushTargetBranchMenuPlacement,pushTargetBranchMenuRef,pushTargetBranchPickerRef,pushTargetBranchTrimmed,pushTargetSummaryBranch,pushToGerrit,pushTopic,refreshAll,refreshDialogOpen,refreshSubmitting,remoteSectionExpanded,renameBranchCanConfirm,renameBranchDialogOpen,renameBranchName,renameBranchNameInputRef,renameBranchSource,renameBranchSubmitting,renameBranchToolbarDisabledReason,renderChangedFilesSummary,repositoryRootName,repositoryUnavailable,resetDialogOpen,resetMode,resetTargetCommit,resetTargetSha,runCommitAction,selectedBranch,selectedCommitSha,selectedFileKey,selectedLocalBranchForRename,setBranchQuery,setBranchesWidth,setCommitContextMenu,setCommitContextMoreOpen,setCommitQuery,setCommitsWidth,setComparePreviewFileKey,setCreateBranchDialogOpen,setCreateBranchName,setCreateBranchSource,setCreatePrForm,setCreatePrPreviewExpanded,setCreatePrPreviewSelectedSha,setDetailsSplitRatio,setDiffViewMode,setFallbackSelectingRoot,setFetchDialogOpen,setIsCreatePrDialogMaximized,setIsHistoryDiffModalMaximized,setLocalSectionExpanded,setOverviewCommitSectionCollapsed,setOverviewListView,setOverviewWidth,setPreviewFileKey,setPullDialogOpen,setPullNoCommit,setPullNoVerify,setPullOptionsMenuOpen,setPullRemoteMenuOpen,setPullStrategy,setPullTargetBranch,setPullTargetBranchActiveScopeTab,setPullTargetBranchMenuOpen,setPullTargetBranchQuery,setPushCc,setPushDialogOpen,setPushForceWithLease,setPushPreviewModalFileKey,setPushPreviewSelectedFileKey,setPushPreviewSelectedSha,setPushRemoteMenuOpen,setPushReviewers,setPushRunHooks,setPushTags,setPushTargetBranch,setPushTargetBranchActiveScopeTab,setPushTargetBranchMenuOpen,setPushTargetBranchQuery,setPushToGerrit,setPushTopic,setRefreshDialogOpen,setRemoteSectionExpanded,setRenameBranchName,setResetDialogOpen,setResetMode,setSelectedBranch,setSelectedCommitSha,setSelectedFileKey,setSyncDialogOpen,setWorkspaceSelectingId,shouldShowWorkspacePickerPage,statusLabel,strokeWidth,syncDialogOpen,syncPreviewCommits,syncPreviewError,syncPreviewLoading,syncPreviewTargetBranch,syncPreviewTargetFound,syncPreviewTargetRemote,syncSubmitting,t,trimRemotePrefix,updatePullRemoteMenuPlacement,updatePushRemoteMenuPlacement,virtualCommitRows,visiblePullTargetBranchGroups,visiblePushTargetBranchGroups,workbenchGridRef,workbenchGridStyle,workingTreeChangedFiles,workingTreeSummaryLabel,workingTreeTotalAdditions,workingTreeTotalDeletions,workspace,workspaceId,workspacePickerMessage,workspaceSelectingId,worktreePreviewDiffEntries,worktreePreviewDiffText,worktreePreviewError,worktreePreviewFile,worktreePreviewFullDiffLoader,worktreePreviewLoading});
});
