import type { ReactNode } from "react";
import type {
  GitBranchListItem,
  GitCommitDetails,
  GitCommitDiff,
  GitFileDiff,
  GitHistoryCommit,
  WorkspaceInfo,
} from "../../../../../types";
import type { CodeAnnotationBridgeProps } from "../../../../code-annotations/types";
import type { CommitActionId } from "./GitHistoryPanelImplHelpers";

export type GitHistoryPanelProps = CodeAnnotationBridgeProps & {
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

export type BranchGroup = {
  key: string;
  label: string;
  items: GitBranchListItem[];
};

export type GitHistoryPanelPersistedState = {
  overviewWidth?: number;
  branchesWidth?: number;
  commitsWidth?: number;
  detailsSplitRatio?: number;
  selectedBranch?: string;
  commitQuery?: string;
  selectedCommitSha?: string | null;
  diffStyle?: "split" | "unified";
};

export type GitOperationErrorState = {
  userMessage: string;
  debugMessage: string;
  retryable: boolean;
};

export type GitOperationNoticeState = {
  kind: "success" | "error";
  message: string;
  debugMessage?: string;
};

export type ForceDeleteDialogMode = "notMerged" | "worktreeOccupied";

export type ForceDeleteDialogState = {
  mode: ForceDeleteDialogMode;
  branch: string;
  worktreePath: string | null;
};

export type GitResetMode = "soft" | "mixed" | "hard" | "keep";

export type BranchMenuSource = "local" | "remote";

export type BranchContextMenuState = {
  x: number;
  y: number;
  branch: GitBranchListItem;
  source: BranchMenuSource;
};

export type BranchContextAction = {
  id: string;
  label: string;
  icon: ReactNode;
  tone?: "normal" | "danger";
  disabled?: boolean;
  disabledReason?: string | null;
  dividerBefore?: boolean;
  onSelect: () => void;
};

export type WorktreeBranchDiffState = {
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

export type BranchCompareDirection = "targetOnly" | "currentOnly";

export type BranchCompareState = {
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

export type BranchDiffState = WorktreeBranchDiffState | BranchCompareState;

export type CommitContextMenuState = {
  x: number;
  y: number;
  commitSha: string;
};

export type CommitActionDescriptor = {
  id: CommitActionId;
  label: string;
  group: "quick" | "branch" | "write";
  disabled: boolean;
  disabledReason?: string;
};

export type PushTargetBranchGroup = {
  scope: string;
  label: string;
  items: string[];
};

export type WorktreePreviewFile = GitFileDiff & {
  status: string;
  additions: number;
  deletions: number;
};

export type CreatePrFormState = {
  upstreamRepo: string;
  baseBranch: string;
  headOwner: string;
  headBranch: string;
  title: string;
  body: string;
  commentAfterCreate: boolean;
  commentBody: string;
};
