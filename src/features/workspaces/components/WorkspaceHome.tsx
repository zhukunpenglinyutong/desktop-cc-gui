import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import { useTranslation } from "react-i18next";
import type { WorkspaceInfo } from "../../../types";
import type { EngineType } from "../../../types";
import type { EngineDisplayInfo } from "../../engine/hooks/useEngineController";
import type { TaskRunRecord } from "../../tasks/types";
import type { ThreadDeleteErrorCode } from "../../threads/hooks/useThreads";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { TaskCenterView } from "../../tasks/components/TaskCenterView";
import { useTaskRunStore } from "../../tasks/hooks/useTaskRunStore";
import { compareTaskRunSurfacePriority, describeTaskRunSurface } from "../../tasks/utils/taskRunSurface";
import { taskCenterBadgeClasses } from "../../tasks/utils/taskCenterClasses";

export type WorkspaceHomeThreadSummary = {
  id: string;
  workspaceId: string;
  threadId: string;
  title: string;
  updatedAt: number;
  isProcessing: boolean;
  isReviewing: boolean;
};

export type WorkspaceHomeDeleteResult = {
  succeededThreadIds: string[];
  failed: Array<{ threadId: string; code: ThreadDeleteErrorCode; message: string }>;
};

type WorkspaceHomeProps = {
  workspace: WorkspaceInfo;
  engines?: EngineDisplayInfo[];
  currentBranch: string | null;
  recentThreads: WorkspaceHomeThreadSummary[];
  onSelectConversation: (workspaceId: string, threadId: string) => void;
  onStartConversation: (engine: EngineType) => Promise<void>;
  onStartSharedConversation?: (engine: EngineType) => Promise<void>;
  onContinueLatestConversation: () => void;
  onStartGuidedConversation: (prompt: string, engine: EngineType) => Promise<void>;
  onOpenSpecHub: () => void;
  onRevealWorkspace: () => Promise<void>;
  onDeleteConversations: (threadIds: string[]) => Promise<WorkspaceHomeDeleteResult>;
  onRetryTaskRun?: (run: TaskRunRecord) => void;
  onResumeTaskRun?: (run: TaskRunRecord) => void;
  onCancelTaskRun?: (run: TaskRunRecord) => void;
  onForkTaskRun?: (run: TaskRunRecord) => void;
};

function splitWorkspacePath(path: string, fallbackName: string) {
  const normalizedPath = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");

  if (!normalizedPath) {
    return {
      prefix: "",
      name: fallbackName,
    };
  }

  const lastSlashIndex = normalizedPath.lastIndexOf("/");

  if (lastSlashIndex === -1) {
    return {
      prefix: "",
      name: normalizedPath,
    };
  }

  return {
    prefix: normalizedPath.slice(0, lastSlashIndex + 1),
    name: normalizedPath.slice(lastSlashIndex + 1) || fallbackName,
  };
}

export function WorkspaceHome({
  workspace,
  currentBranch,
  recentThreads: _recentThreads,
  onSelectConversation,
  onRetryTaskRun,
  onResumeTaskRun,
  onCancelTaskRun,
  onForkTaskRun,
}: WorkspaceHomeProps) {
  const { t } = useTranslation();
  const taskRunStore = useTaskRunStore();
  const workspaceRuns = taskRunStore.runs
    .filter((run) => run.task.workspaceId === workspace.path)
    .sort(compareTaskRunSurfacePriority);
  const highlightedRun = workspaceRuns[0] ?? null;
  const highlightedSurface = highlightedRun ? describeTaskRunSurface(highlightedRun) : null;
  const branchLabel = currentBranch || workspace.worktree?.branch || null;
  const branchDescriptor = workspace.kind === "worktree"
    ? t("workspace.homeBranchLabelWorktree")
    : t("workspace.homeBranchLabelMain");
  const { prefix: pathPrefix, name: pathName } = splitWorkspacePath(workspace.path, workspace.name);

  const heroSeverity = highlightedSurface?.severity ?? "muted";
  const heroBorderClass =
    heroSeverity === "active"
      ? "border-[color-mix(in_srgb,#2563eb_42%,var(--border-subtle))]"
      : heroSeverity === "attention"
        ? "border-[color-mix(in_srgb,var(--status-warning)_44%,var(--border-subtle))]"
        : heroSeverity === "danger"
          ? "border-[color-mix(in_srgb,var(--status-error)_42%,var(--border-subtle))]"
          : heroSeverity === "success"
            ? "border-[color-mix(in_srgb,var(--status-success)_42%,var(--border-subtle))]"
            : "border-[color-mix(in_srgb,var(--text-faint)_28%,var(--border-subtle))]";
  const heroBgClass =
    heroSeverity === "active"
      ? "bg-[linear-gradient(135deg,color-mix(in_srgb,#2563eb_16%,var(--surface-card)),color-mix(in_srgb,var(--surface-card-muted)_94%,transparent))]"
      : heroSeverity === "attention"
        ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--status-warning)_16%,var(--surface-card)),color-mix(in_srgb,var(--surface-card-muted)_94%,transparent))]"
        : heroSeverity === "danger"
          ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--status-error)_14%,var(--surface-card)),color-mix(in_srgb,var(--surface-card-muted)_94%,transparent))]"
          : heroSeverity === "success"
            ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--status-success)_14%,var(--surface-card)),color-mix(in_srgb,var(--surface-card-muted)_94%,transparent))]"
            : "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_92%,transparent),color-mix(in_srgb,var(--surface-card-muted)_92%,transparent))]";

  return (
    <section
      className="workspace-home workspace-home-minimal w-full h-full overflow-y-auto py-6 px-4 pb-10 max-md:py-5 max-md:px-4 max-md:pb-7 [grid-column:1/-1] [grid-row:1/-1] flex items-center justify-center bg-[var(--surface-messages)] text-[var(--text-strong)] bg-[radial-gradient(72%_44%_at_50%_0%,color-mix(in_srgb,var(--border-accent-soft)_28%,transparent),transparent_72%),var(--surface-messages)]"
    >
      <div className="workspace-home-shell w-[min(100%,1080px)] min-h-[calc(100%-56px)] max-md:min-h-[calc(100%-36px)] mx-auto flex items-start justify-center">
        <div className="workspace-home-stack w-[min(100%,920px)] flex flex-col items-stretch gap-8 max-md:gap-6 py-10 pb-14 max-md:py-5 max-md:pb-7">
          <header className="workspace-home-hero flex flex-col items-center justify-center gap-7 max-md:gap-[22px] text-center">
            <div
              className="workspace-home-mark w-24 h-24 max-md:w-[76px] max-md:h-[76px] inline-flex items-center justify-center text-[var(--text-strong)]"
              role="img"
              aria-label={t("workspace.engineOpenCode")}
            >
              <EngineIcon engine="opencode" size={72} className="workspace-home-mark-icon w-[72px] h-[72px] max-md:w-[58px] max-md:h-[58px]" />
            </div>

            <div className="workspace-home-copy flex flex-col items-center gap-[26px] max-md:gap-5">
              <h1 className="workspace-home-title m-0 text-[var(--text-stronger)] text-[clamp(54px,7.2vw,88px)] max-md:text-[clamp(42px,12vw,64px)] leading-[0.94] tracking-[-0.06em] font-[740]">
                {t("workspace.homeHeroTitle")}
              </h1>

              <p
                className="workspace-home-path-line m-0 max-w-[min(100%,900px)] text-[clamp(22px,2.2vw,32px)] max-md:text-[clamp(18px,5vw,24px)] leading-[1.35] tracking-[-0.035em] [overflow-wrap:anywhere]"
                title={workspace.path}
              >
                {pathPrefix ? (
                  <span className="workspace-home-path-prefix text-[var(--text-faint)]">{pathPrefix}</span>
                ) : null}
                <span className="workspace-home-path-name text-[var(--text-strong)] font-[650]">{pathName}</span>
              </p>

              {branchLabel ? (
                <div className="workspace-home-branch-line inline-flex items-center justify-center gap-3 max-md:gap-2.5 flex-wrap text-[var(--text-subtle)] text-[clamp(20px,1.8vw,28px)] max-md:text-[clamp(17px,4.6vw,22px)] leading-[1.35] tracking-[-0.03em]">
                  <GitBranch size={20} aria-hidden className="workspace-home-branch-icon text-[var(--text-faint)] shrink-0" />
                  <span className="workspace-home-branch-label font-medium">{branchDescriptor}</span>
                  <span className="workspace-home-branch-value text-[var(--text-muted)] font-semibold">({branchLabel})</span>
                </div>
              ) : null}
            </div>
          </header>

          <div className="workspace-home-task-center w-full">
            {highlightedRun && highlightedSurface ? (
              <section
                className={`workspace-home-run-hero workspace-home-run-hero--${highlightedSurface.severity} grid gap-2.5 mb-4 py-[18px] px-5 border rounded-3xl ${heroBorderClass} ${heroBgClass} shadow-[0_18px_48px_color-mix(in_srgb,#000000_18%,transparent)]`}
                aria-label={t("taskCenter.workspaceHero")}
              >
                <div className="workspace-home-run-hero__topline flex items-center justify-between gap-3">
                  <span className="workspace-home-run-hero__eyebrow m-0 text-[color-mix(in_srgb,var(--text-accent)_88%,var(--text-strong))] text-xs font-[750] tracking-[0.12em] uppercase">
                    {t("taskCenter.workspaceHero")}
                  </span>
                  <span className={`task-center__badge task-center__badge--${highlightedSurface.severity} rounded-full border px-2.5 py-1.5 text-xs font-bold whitespace-nowrap ${taskCenterBadgeClasses(highlightedSurface.severity)}`}>
                    {t(`taskCenter.status.${highlightedRun.status}`)}
                  </span>
                </div>
                <h2 className="workspace-home-run-hero__title m-0 text-[var(--text-stronger)] text-[clamp(22px,3vw,28px)] tracking-[-0.04em]">
                  {highlightedRun.task.title || highlightedRun.task.taskId}
                </h2>
                <p className="workspace-home-run-hero__summary m-0 text-[var(--text-strong)] text-[15px] leading-[1.55]">
                  {highlightedSurface.summary || t("taskCenter.unavailable")}
                </p>
                <p className="workspace-home-run-hero__hint m-0 text-[var(--text-muted)] text-[13px] font-[650]">
                  {t(highlightedSurface.hintKey)}
                </p>
              </section>
            ) : null}
            <TaskCenterView
              runs={taskRunStore.runs}
              workspaceId={workspace.path}
              onOpenConversation={(threadId) => onSelectConversation(workspace.id, threadId)}
              onRetryRun={onRetryTaskRun}
              onResumeRun={onResumeTaskRun}
              onCancelRun={onCancelTaskRun}
              onForkRun={onForkTaskRun}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
