import type { KeyboardEvent, ReactNode } from "react";
import Cherry from "lucide-react/dist/esm/icons/cherry";
import Copy from "lucide-react/dist/esm/icons/copy";
import GitBranchPlus from "lucide-react/dist/esm/icons/git-branch-plus";
import MessageSquareText from "lucide-react/dist/esm/icons/message-square-text";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import type { GitPrWorkflowStage } from "../../../../../types";

export type CommitActionId =
  | "copyRevision"
  | "copyMessage"
  | "createBranch"
  | "reset"
  | "cherryPick"
  | "revert";

export type CreatePrStageView = {
  key: "precheck" | "push" | "create" | "comment";
  label: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  detail: string;
};

export const DEFAULT_DETAILS_SPLIT = 42;
export const DETAILS_SPLIT_MIN = 24;
export const DETAILS_SPLIT_MAX = 78;
export const COMPACT_LAYOUT_BREAKPOINT = 1120;
export const VERTICAL_SPLITTER_SIZE = 8;
export const OVERVIEW_MIN_WIDTH = 170;
export const BRANCHES_MIN_WIDTH = 220;
export const COMMITS_MIN_WIDTH = 260;
export const DETAILS_MIN_WIDTH = 260;
export const DISABLE_HISTORY_ACTION_BUTTONS = false;
export const DISABLE_HISTORY_COMMIT_ACTIONS = false;
export const COMMIT_ROW_ESTIMATED_HEIGHT = 56;
export const GIT_HISTORY_PAGE_SIZE = 100;
export const PUSH_TARGET_MENU_MAX_HEIGHT = 220;
export const PUSH_TARGET_MENU_MIN_HEIGHT = 120;
export const PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT = 34;
export const PUSH_TARGET_MENU_VIEWPORT_PADDING = 16;
export const CREATE_PR_PREVIEW_COMMIT_LIMIT = 200;
export const FILE_TREE_ROOT_PATH = "__repo_root__";

const SORT_ORDER_FALLBACK = Number.MAX_SAFE_INTEGER;

export function getSortOrderValue(value: number | null | undefined) {
  return typeof value === "number" ? value : SORT_ORDER_FALLBACK;
}

export function isActivationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" || event.key === " ";
}

export function clamp(value: number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

export function extractCommitBody(summary: string, message: string): string {
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

export function getCommitActionIcon(actionId: CommitActionId, size: number): ReactNode {
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

export function buildCreatePrInitialStages(t: (key: string) => string): CreatePrStageView[] {
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

export function mapCreatePrStagesFromResult(
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

export function splitGitHubRepo(value: string): { owner: string; repo: string } {
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

export function scrollElementToTop(element: HTMLDivElement | null): void {
  if (!element) {
    return;
  }
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ top: 0 });
    return;
  }
  element.scrollTop = 0;
}

export function uniqueNonEmpty(values: string[]): string[] {
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

export function sortOptionsWithPriority(values: string[], priorityValues: string[]): string[] {
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
