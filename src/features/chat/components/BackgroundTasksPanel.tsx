import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Activity from "lucide-react/dist/esm/icons/activity";
import Bot from "lucide-react/dist/esm/icons/bot";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import Workflow from "lucide-react/dist/esm/icons/workflow";
import { cx } from "@/utils/cx";
import { groupTasksByRun, taskLabel } from "../background-tasks";
import { sessionKey, useChatStore } from "../store";
import { EMPTY_TASKS, type BackgroundTask } from "../store/stream";
import { formatDuration } from "./format-duration";

const TYPE_ICON: Record<string, typeof Activity> = {
  local_workflow: Workflow,
  local_agent: Bot,
  local_bash: TerminalSquare,
};

function StatusBadge({ status }: { status: BackgroundTask["status"] }) {
  const { t } = useTranslation();
  return (
    <span
      className={cx(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
        status === "running" && "bg-accent-500/15 text-accent-600",
        status === "completed" && "bg-green-500/15 text-green-600",
        (status === "failed" || status === "interrupted") && "bg-red-500/15 text-red-600",
        status === "stopped" && "bg-foreground-icon-tertiary/15 text-foreground-icon-tertiary",
      )}
    >
      {t(`chat.tasks.status.${status}`)}
    </span>
  );
}

/** One row. `now` is the panel's 1s tick: a running task counts up from its
 *  start, a settled one shows the span it actually ran (updatedAt - startedAt). */
function TaskRow({ task, now }: { task: BackgroundTask; now: number }) {
  const { t } = useTranslation();
  const Icon = TYPE_ICON[task.taskType] ?? Activity;
  const duration = formatDuration(
    (task.status === "running" ? now : task.updatedAt) - task.startedAt,
  );
  return (
    <div className="flex flex-col gap-0.5 rounded-[6px] px-2 py-1.5 hover:bg-background-tertiary-default/50">
      <div className="flex min-w-0 items-center gap-2">
        <Icon aria-hidden className="size-3.5 shrink-0 text-foreground-icon-secondary" />
        <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
          {/* Bare-type fallback goes through chat.tasks.type.* so the panel never
              surfaces a raw `local_bash` (defaultValue keeps unknown types). */}
          {taskLabel(task, (type) => t(`chat.tasks.type.${type}`, { defaultValue: type }))}
        </span>
        {duration && (
          <span
            className="shrink-0 tabular-nums text-[10px] text-foreground-icon-tertiary"
            title={t("chat.metaDuration", { duration })}
          >
            {duration}
          </span>
        )}
        <StatusBadge status={task.status} />
      </div>
      {(task.progress || task.lastTool) && (
        <div className="truncate pl-5 text-[11px] text-foreground-icon-tertiary">
          {task.progress || task.lastTool}
        </div>
      )}
    </div>
  );
}

/** Turn-group header timestamp: HH:mm today, MM-dd HH:mm this year, full
 *  date beyond — MessageTimeline's formatMessageTime pattern, because a
 *  bare clock time misreads once a run crosses midnight. */
function formatTurnTime(startedAt: number): string {
  const d = new Date(startedAt);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return hm;
  if (d.getFullYear() === now.getFullYear())
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/** Right-panel tab: background tasks of this session, grouped by turn. */
export function BackgroundTasksPanel({ workspacePath }: { workspacePath: string }) {
  // The tab registry hands every panel the active workspace, but tasks belong
  // to a *session*: two tabs can share one workspace, so the active tab (the
  // same store selector QuestionDock/GrantCard use) is what identifies them.
  void workspacePath;
  const { t } = useTranslation();
  const active = useChatStore((s) => s.active);
  const tasks = useChatStore((s) => {
    if (!active) return EMPTY_TASKS;
    const key = sessionKey(active.engine, active.sessionId, active.workspacePath);
    return s.bySession[key]?.tasks ?? EMPTY_TASKS;
  });
  // Running rows count up. One ticker for the whole panel, alive only while
  // something runs: a settled list needs no clock, and a background panel
  // must not re-render every second for nothing.
  const hasRunning = tasks.some((task) => task.status === "running");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasRunning) return;
    setNow(Date.now());
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, [hasRunning]);
  const groups = groupTasksByRun(tasks);
  if (groups.length === 0) {
    return <div className="p-3 text-xs text-foreground-icon-tertiary">{t("chat.tasks.empty")}</div>;
  }
  return (
    <div className="flex h-full flex-col overflow-y-auto p-1.5">
      {groups.map((group) => (
        <div key={group.runId} className="mb-1.5">
          <div className="px-2 py-1 text-[11px] text-foreground-icon-tertiary">
            {t("chat.tasks.turnAt", { time: formatTurnTime(group.startedAt) })}
          </div>
          {group.tasks.map((task) => <TaskRow key={task.id} task={task} now={now} />)}
        </div>
      ))}
    </div>
  );
}

/** One-line background marker for the timeline tail (MessageTimeline renders
 *  it while the turn waits on background tasks). */
export function BackgroundTasksLine({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-2 text-xs text-foreground-icon-secondary">
      <span className="size-1.5 animate-pulse rounded-full bg-accent-500 motion-reduce:animate-none" />
      {t("chat.tasks.runningIndicator", { count })}
    </div>
  );
}
