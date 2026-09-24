import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cx } from "@/utils/cx";
import { useGitStore } from "@/features/git/store";
import type { GitStatus, Message, TodoItem } from "@/lib/ipc";
import { useChatStore } from "../store";
import { EMPTY_TASKS } from "../store/stream";
import { stepsFromTasks } from "../background-tasks";
import {
  deriveAgentTaskSteps,
  deriveEditedFiles,
  deriveTodoList,
  type AgentTaskStep,
  type AgentTaskStepState,
} from "./agent-task-steps";
import { createEditLineStatsBuilder, type EditLineStat } from "./edit-line-stats";
import { RollingStat } from "./RollingStat";

const EMPTY_MESSAGES: Message[] = [];

/**
 * Run-status strip above the composer, ported from the reference app's
 * Composer run-status interaction contract:
 *
 * - Data surfaces as dashed pills (子代理 / 已编辑) on a toolbar row, not
 *   stacked cards; the right edge holds a chrome toggle that hides the whole
 *   pill row (persisted in localStorage).
 * - Clicking a pill floats its panel ABOVE the strip (absolute, never pushes
 *   the message list). Single-open: clicking another pill switches, clicking
 *   the same pill or pressing Esc collapses.
 * - Pills never auto-hide after a turn completes — counts freeze until a
 *   newer turn contributes fresh data. A panel auto-collapses when its
 *   section's data disappears.
 * - The 已编辑 pill carries line stats (+/−) aggregated over the files this
 *   session edited, counted from the session's own edit tool payloads with
 *   workspace git status as a fallback. Each number rolls like an odometer as
 *   the tally grows (see RollingStat) instead of swapping text.
 */

const CHROME_OPEN_KEY = "ccgui.chat.runStatusChromeOpen";

function readChromeOpen(): boolean {
  try {
    return localStorage.getItem(CHROME_OPEN_KEY) !== "0";
  } catch {
    return true; // storage unavailable (private mode) — default to open
  }
}

function writeChromeOpen(open: boolean) {
  try {
    localStorage.setItem(CHROME_OPEN_KEY, open ? "1" : "0");
  } catch {
    // preference simply doesn't persist
  }
}

type SectionId = "todo" | "subagent" | "files";

function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Same shape as the session-derived stat; the two sources are interchangeable
 * at the render layer. */
type FileStat = EditLineStat;

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Strip the workspace prefix; tool-call paths may be absolute while git
 * status paths are workspace-relative. */
function toWorkspaceRel(path: string, workspacePath: string): string {
  const norm = normalizeSlashes(path);
  const ws = normalizeSlashes(workspacePath).replace(/\/+$/, "");
  if (ws && norm.startsWith(ws + "/")) return norm.slice(ws.length + 1);
  return norm;
}

/** Line stats for the session-edited files. The session's own edit payloads
 * are authoritative: git status misses gitignored targets (`.omp/**`),
 * non-repo workspaces and files already committed mid-session, which is why
 * the pill used to show no numbers at all. Git status is the fallback for
 * files the transcript recorded without usable args. One file may appear in
 * several git status lists (staged + unstaged) — take the per-side max
 * instead of double-counting. `total` is null only when no file resolved a
 * stat from either source, so stats stay hidden rather than showing zeros. */
function collectFileStats(
  files: string[],
  sessionStats: Map<string, FileStat>,
  status: GitStatus | undefined,
  workspacePath: string,
): { perFile: Map<string, FileStat>; total: FileStat | null } {
  const perFile = new Map<string, FileStat>();
  const byRel = new Map<string, FileStat>();
  for (const entry of status
    ? [...status.staged, ...status.unstaged, ...status.untracked]
    : []) {
    const rel = normalizeSlashes(entry.path);
    const prev = byRel.get(rel);
    byRel.set(rel, {
      additions: Math.max(prev?.additions ?? 0, entry.additions ?? 0),
      deletions: Math.max(prev?.deletions ?? 0, entry.deletions ?? 0),
    });
  }
  const total: FileStat = { additions: 0, deletions: 0 };
  let matched = false;
  for (const file of files) {
    const stat = sessionStats.get(file) ?? byRel.get(toWorkspaceRel(file, workspacePath));
    if (!stat) continue;
    matched = true;
    perFile.set(file, stat);
    total.additions += stat.additions;
    total.deletions += stat.deletions;
  }
  return { perFile, total: matched ? total : null };
}

function LineStats({ stat }: { stat: FileStat }) {
  // min-w + justify-end: one-digit values keep the pill from twitching, and a
  // growing digit count pushes leftward instead of shifting the label.
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <RollingStat
        className="min-w-[1.5ch] justify-end text-[var(--color-status-unseen)]"
        prefix="+"
        value={stat.additions}
        data-testid="run-status-edit-additions"
      />
      <RollingStat
        className="min-w-[1.5ch] justify-end text-text-error-primary"
        prefix="−"
        value={stat.deletions}
        data-testid="run-status-edit-deletions"
      />
    </span>
  );
}

function BotIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="5" width="10" height="8" rx="2" />
      <path d="M8 2v3M5.5 9h.01M10.5 9h.01" strokeLinecap="round" />
    </svg>
  );
}

function ListChecksIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8M6 8h8M6 12h8" />
      <path d="M2 4l1 1 1.5-1.5M2 8l1 1 1.5-1.5M2 12l1 1 1.5-1.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor">
      <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 1.237-8.61 8.61a.25.25 0 0 0-.063.108l-.62 2.168 2.168-.62a.25.25 0 0 0 .108-.064l8.61-8.61a.25.25 0 0 0 0-.354l-1.086-1.086a.25.25 0 0 0-.354 0Z" />
    </svg>
  );
}

function PanelTopIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="3" />
      <path d="M2 6h12" />
    </svg>
  );
}

function PanelTopCloseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="3" />
      <path d="M2 6h12M6.5 12.5 8 11l1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BreathingDot({
  active = true,
  className,
}: {
  active?: boolean;
  className?: string;
}) {
  if (!active) {
    return (
      <span
        aria-hidden="true"
        className={cx("inline-flex size-2.5 shrink-0 items-center justify-center", className)}
      >
        <span className="size-1.5 rounded-full bg-[var(--color-status-unseen)]" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cx("relative inline-flex size-2.5 shrink-0 items-center justify-center", className)}
    >
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-75 duration-1000" />
      <span className="relative inline-flex size-1.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.9)]" />
    </span>
  );
}

function Pill({
  selected,
  running,
  label,
  count,
  stats,
  title,
  onClick,
  icon,
}: {
  selected: boolean;
  running?: boolean;
  label: string;
  count?: string;
  stats?: React.ReactNode;
  title?: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title={title}
      onClick={onClick}
      className={cx(
        "flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-dashed px-2 text-caption-1-medium transition-colors duration-150",
        selected
          ? "border-foreground-icon-secondary bg-background-tertiary-default/60 text-text-primary"
          : "border-border-button-default text-text-secondary hover:bg-background-tertiary-default/60",
      )}
    >
      {running && <BreathingDot active={true} className="mr-0.5" />}
      {icon}
      <span>{label}</span>
      {count ? <span className="tabular-nums text-text-tertiary">{count}</span> : null}
      {stats}
    </button>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 4 6 8l3.5 4" />
    </svg>
  );
}

/** One task's full assignment, overlaid on the list inside the same panel:
 *  allows drilling down into task details and execution status. */
function TodoStatusGlyph({
  status,
  live,
  wrap = false,
}: {
  status: TodoItem["status"];
  live: boolean;
  /** Row layout wraps the small glyphs in a sized grid cell; the detail
   *  header places them inline. */
  wrap?: boolean;
}) {
  const glyph =
    status === "complete" ? (
      <svg aria-hidden viewBox="0 0 14 14" className="size-3.5">
        <circle cx="7" cy="7" r="7" fill="var(--color-status-unseen)" />
        <path d="M4 7.5 5.646 9.146a.5.5 0 0 0 .708 0L10 5.5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ) : status === "active" ? (
      <BreathingDot active={live} />
    ) : status === "blocked" ? (
      <span className="size-1.5 rounded-full bg-text-error-primary" />
    ) : (
      <span className="size-3.5 rounded-full border border-dashed border-border-checkbox-default" />
    );
  return wrap ? <span className="grid size-3.5 place-items-center">{glyph}</span> : glyph;
}

/** Status label for the todo list and detail header; `live` decides whether an
 *  active row reads "running" or is still waiting. */
function todoStatusLabel(
  t: TFunction,
  status: TodoItem["status"],
  live: boolean,
): string {
  if (status === "complete") return t("chat.agentStatusDone");
  if (status === "active") return live ? t("chat.agentStatusRunning") : t("chat.todoStatusPending");
  if (status === "blocked") return t("chat.todoStatusBlocked");
  if (status === "dropped") return "";
  return t("chat.todoStatusPending");
}

/** Text tone shared by the todo status label in both layouts. */
function todoStatusTone(status: TodoItem["status"], live: boolean): string {
  if (status === "complete") return "text-[var(--color-status-unseen)]";
  if (status === "blocked") return "text-text-error-primary";
  if (status === "active" && live) return "text-blue-500";
  return "text-text-secondary";
}

/** The detail body: the assignment, phase, live status, and long payloads. */
function TodoDetailFields({
  item,
  statusLabel,
  statusTone,
}: {
  item: TodoItem;
  statusLabel: string;
  statusTone: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 rounded bg-background-secondary-default p-2 text-caption-1-medium text-text-secondary">
      <div>
        <span className="text-text-tertiary">{t("chat.todoPill")}: </span>
        <span className="text-text-primary select-text font-medium">{item.content}</span>
      </div>
      {item.phase && (
        <div>
          <span className="text-text-tertiary">{t("chat.todoPhase")}: </span>
          <span className="text-text-primary select-text">{item.phase}</span>
        </div>
      )}
      <div>
        <span className="text-text-tertiary">{t("chat.todoExecutionStatus")}: </span>
        <span className={cx("font-medium", statusTone)}>{statusLabel}</span>
      </div>
      {item.reason && (
        <div className="rounded border border-red-500/20 bg-red-500/10 p-1.5 text-text-error-primary">
          <span className="font-medium">{t("chat.todoBlockReason")}: </span>
          <span className="select-text">{item.reason}</span>
        </div>
      )}
      {item.detail && (
        <pre className="max-h-40 overflow-y-auto rounded bg-background-tertiary-default/60 p-1.5 text-[12px] break-words whitespace-pre-wrap text-text-secondary select-text">
          {item.detail}
        </pre>
      )}
    </div>
  );
}

function TodoDetail({
  item,
  live,
  onBack,
}: {
  item: TodoItem;
  live: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus(), []);

  const statusLabel = todoStatusLabel(t, item.status, live);
  const statusTone = todoStatusTone(item.status, live);
  const running = item.status === "active" && live;

  return (
    <div data-testid="todo-detail-overlay" className="flex flex-col gap-1 p-1">
      <div className="flex items-center gap-1.5 px-1">
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          aria-label={t("chat.todoDetailBack")}
          title={t("chat.todoDetailBack")}
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded text-foreground-icon-tertiary hover:bg-background-tertiary-hover hover:text-foreground-icon-primary"
        >
          <BackIcon />
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          {item.phase && (
            <span className="shrink-0 rounded border border-border-button-default bg-background-tertiary-default px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
              {item.phase}
            </span>
          )}
          <span className="truncate text-caption-1-medium text-text-primary">{item.content}</span>
        </div>
        <span
          className={cx(
            "ml-auto flex shrink-0 items-center gap-1 text-caption-2-medium",
            statusTone,
            running && "font-medium",
          )}
        >
          <TodoStatusGlyph status={item.status} live={live} />
          <span>{statusLabel}</span>
        </span>
      </div>

      <TodoDetailFields item={item} statusLabel={statusLabel} statusTone={statusTone} />
    </div>
  );
}

function TodoRows({ items, live }: { items: TodoItem[]; live: boolean }) {
  const { t } = useTranslation();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const restoreKey = useRef<string | null>(null);

  useEffect(() => {
    if (openKey !== null) {
      restoreKey.current = openKey;
      return;
    }
    const key = restoreKey.current;
    if (key === null) return;
    restoreKey.current = null;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-todo-item-key]")) {
      if (button.dataset.todoItemKey === key) {
        button.focus();
        break;
      }
    }
  }, [openKey]);

  const openItem = openKey ? items.find((item) => (item.id ?? item.content) === openKey) : undefined;
  if (openItem) {
    return (
      <div data-testid="run-status-todos">
        <TodoDetail item={openItem} live={live} onBack={() => setOpenKey(null)} />
      </div>
    );
  }

  const statusText: Record<TodoItem["status"], string> = {
    pending: t("chat.todoStatusPending"),
    active: live ? t("chat.agentStatusRunning") : t("chat.todoStatusPending"),
    complete: t("chat.agentStatusDone"),
    blocked: t("chat.todoStatusBlocked"),
    dropped: "",
  };
  return (
    <ul className="flex flex-col gap-0.5 p-1" data-testid="run-status-todos">
      {items.map((item) => {
        const itemKey = item.id ?? item.content;
        return (
          <li key={itemKey}>
            <button
              type="button"
              data-todo-item-key={itemKey}
              onClick={() => setOpenKey(itemKey)}
              title={item.content}
              className="grid w-full cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-background-tertiary-default/50"
            >
              <TodoStatusGlyph status={item.status} live={live} wrap />
              <div className="flex min-w-0 items-center gap-1.5">
                {item.phase && (
                  <span className="shrink-0 rounded border border-border-button-default bg-background-tertiary-default px-1 py-0.2 text-[10px] text-text-tertiary">
                    {item.phase}
                  </span>
                )}
                <span
                  className={cx(
                    "truncate text-caption-1-medium",
                    item.status === "complete" ? "text-text-tertiary" : "text-text-primary",
                  )}
                >
                  {item.content}
                </span>
              </div>
              <span
                className={cx(
                  "text-caption-2-medium shrink-0",
                  todoStatusTone(item.status, live),
                  item.status === "active" && live && "font-medium",
                )}
              >
                {statusText[item.status]}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One step's status text. The settled-without-success states reuse the
 *  background-task status keys so the report panel and the pill panel name
 *  the same state the same way. */
function agentStatusText(t: TFunction, state: AgentTaskStepState): string {
  if (state === "complete") return t("chat.agentStatusDone");
  if (state === "active") return t("chat.agentStatusRunning");
  return t(`chat.tasks.status.${state}`);
}
/** One agent's full assignment, overlaid on the list inside the same panel:
 *  task briefs run long, and leaving the strip to read one loses the panel. */
function SubagentDetail({ step, onBack }: { step: AgentTaskStep; onBack: () => void }) {
  const { t } = useTranslation();
  // Settled steps step down so their name does not fight the status beside
  // it; a dead run (failed/interrupted) goes red, a stopped one gray.
  const settled = step.state !== "active";
  const dead = step.state === "failed" || step.state === "interrupted";
  // The row that opened this overlay unmounted with the list; move focus
  // into the overlay instead of dropping it on document.body.
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus(), []);
  return (
    <div data-testid="subagent-detail-overlay" className="flex flex-col gap-1 p-1">
      <div className="flex items-center gap-1.5 px-1">
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          aria-label={t("chat.agentDetailBack")}
          title={t("chat.agentDetailBack")}
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded text-foreground-icon-tertiary hover:bg-background-tertiary-hover hover:text-foreground-icon-primary"
        >
          <BackIcon />
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          {step.subagentType && (
            <span className="shrink-0 rounded border border-border-button-default bg-background-tertiary-default px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
              {step.subagentType}
            </span>
          )}
          <span
            className={cx(
              "truncate text-caption-1-medium",
              settled ? "text-text-secondary" : "text-text-primary",
            )}
          >
            {step.label}
          </span>
        </div>
        <span
          className={cx(
            "ml-auto shrink-0 text-caption-2-medium",
            dead
              ? "font-medium text-text-error-primary"
              : step.state === "stopped"
                ? "text-text-tertiary"
                : step.state === "complete"
                  ? "text-[var(--color-status-unseen)]"
                  : "font-medium text-blue-500",
          )}
        >
          {agentStatusText(t, step.state)}
        </span>
      </div>
      <pre className="max-h-52 overflow-y-auto rounded bg-background-secondary-default px-2 py-1.5 text-caption-1-medium break-words whitespace-pre-wrap text-text-secondary">
        {step.detail ?? step.label}
      </pre>
    </div>
  );
}

function SubagentRows({ steps }: { steps: AgentTaskStep[] }) {
  const { t } = useTranslation();
  // Open detail lives here, not in the strip: closing the panel unmounts this
  // component, so reopening always starts on the list.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Hand focus back to the row that opened the detail once the list returns.
  const restoreKey = useRef<string | null>(null);
  useEffect(() => {
    if (openKey !== null) {
      restoreKey.current = openKey;
      return;
    }
    const key = restoreKey.current;
    if (key === null) return;
    restoreKey.current = null;
    // No CSS.escape in every webview/jsdom: match by dataset instead.
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-agent-step-key]")) {
      if (button.dataset.agentStepKey === key) {
        button.focus();
        break;
      }
    }
  }, [openKey]);
  const open = openKey ? steps.find((step) => step.key === openKey) : undefined;
  if (open) return (
    <div data-testid="run-status-subagents">
      <SubagentDetail step={open} onBack={() => setOpenKey(null)} />
    </div>
  );
  return (
    <div data-testid="run-status-subagents">
      <ul className="flex flex-col gap-0.5 p-1">
        {steps.map((step) => {
          const complete = step.state === "complete";
          // A dead run (failed/interrupted) gets the static error dot the
          // blocked todo row uses; a stopped one a gray dot — breathing
          // means "still working".
          const dead = step.state === "failed" || step.state === "interrupted";
          const stopped = step.state === "stopped";
          return (
            <li key={step.key}>
              <button
                type="button"
                data-agent-step-key={step.key}
                onClick={() => setOpenKey(step.key)}
                title={step.label}
                className="grid w-full cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-background-tertiary-default/50"
              >
                <div className="flex items-center justify-center">
                  {dead ? (
                    <span className="grid size-3.5 place-items-center">
                      <span className="size-1.5 rounded-full bg-text-error-primary" />
                    </span>
                  ) : stopped ? (
                    <span className="grid size-3.5 place-items-center">
                      <span className="size-1.5 rounded-full bg-foreground-icon-tertiary" />
                    </span>
                  ) : (
                    <BreathingDot active={!complete} />
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  {step.subagentType && (
                    <span className="shrink-0 rounded border border-border-button-default bg-background-tertiary-default px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
                      {step.subagentType}
                    </span>
                  )}
                  <span
                    className={cx(
                      "truncate text-caption-1-medium",
                      // A settled step is as dim as a finished one: the
                      // brightest text would fight the status beside it.
                      step.state !== "active" ? "text-text-secondary" : "text-text-primary",
                    )}
                  >
                    {step.label}
                  </span>
                </div>
                <span
                  className={cx(
                    "text-caption-2-medium flex shrink-0 items-center gap-1",
                    dead
                      ? "font-medium text-text-error-primary"
                      : stopped
                        ? "text-text-tertiary"
                        : complete
                          ? "text-[var(--color-status-unseen)]"
                          : "font-medium text-blue-500",
                  )}
                >
                  {agentStatusText(t, step.state)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileRows({
  files,
  perFile,
  total,
  live,
}: {
  files: string[];
  perFile: Map<string, FileStat>;
  total: FileStat | null;
  live: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div data-testid="run-status-files">
      <div className="flex h-8 items-center gap-1.5 px-2.5 text-caption-1-medium text-text-secondary">
        <span>{t("chat.editedFiles", { count: files.length })}</span>
        {total ? <LineStats stat={total} /> : null}
        {live ? (
          <span className="size-1.5 animate-pulse rounded-full bg-foreground-icon-secondary" />
        ) : null}
      </div>
      <ul className="flex flex-col gap-0.5 px-1 pb-1">
        {files.map((file) => {
          const stat = perFile.get(file);
          return (
            <li
              key={file}
              title={file}
              className="flex h-7 items-center gap-2 rounded px-2 text-caption-1-medium"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-background-quaternary-default" />
              <span className="min-w-0 flex-1 truncate text-text-primary">{baseName(file)}</span>
              {stat && <LineStats stat={stat} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Floating panel anchored above the toolbar so it overlays the message
 * list instead of pushing it; collapses via grid-rows animation. */
function RunStatusPanel({
  section,
  steps,
  todos,
  files,
  perFile,
  total,
  live,
}: {
  section: SectionId | null;
  steps: AgentTaskStep[];
  todos: TodoItem[];
  files: string[];
  perFile: Map<string, FileStat>;
  total: FileStat | null;
  live: boolean;
}) {
  return (
    <div
      className={cx(
        "absolute inset-x-0 bottom-full z-20 grid transition-[grid-template-rows,opacity] duration-200 ease-out",
        section ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          role="tabpanel"
          className="mb-1.5 max-h-[min(40vh,280px)] overflow-y-auto rounded-md border border-dashed border-border-button-default bg-background-primary-default shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
        >
          {section === "subagent" && <SubagentRows steps={steps} />}
          {section === "todo" && <TodoRows items={todos} live={live} />}
          {section === "files" && (
            <FileRows files={files} perFile={perFile} total={total} live={live} />
          )}
        </div>
      </div>
    </div>
  );
}

/** The dashed pill row: one pill per data section, hidden entirely when the
 * section has no data. Counts freeze after a turn completes. */
function RunStatusPills({
  section,
  steps,
  todos,
  files,
  stats,
  streaming,
  onToggle,
}: {
  section: SectionId | null;
  steps: AgentTaskStep[];
  todos: TodoItem[];
  files: string[];
  stats: FileStat | null;
  streaming: boolean;
  onToggle: (id: SectionId) => void;
}) {
  const { t } = useTranslation();
  // The numerator counts SETTLED steps, not just succeeded ones: a failed
  // step is as settled as a finished one, and a settled pill reading "1/2"
  // forever would imply outstanding work that is not coming.
  const settledCount = steps.filter((step) => step.state !== "active").length;
  // "Still working" is the active state, not "not complete": a pill that keeps
  // breathing after a failure promises progress that is not coming.
  const anyRunning = steps.some((step) => step.state === "active");
  const todosDone = todos.filter((item) => item.status === "complete").length;
  const todosRunning = streaming && todos.some((item) => item.status === "active");
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="tablist">
      {todos.length > 0 && (
        <Pill
          selected={section === "todo"}
          running={todosRunning}
          label={t("chat.todoPill")}
          count={`${todosDone}/${todos.length}`}
          icon={<ListChecksIcon />}
          onClick={() => onToggle("todo")}
        />
      )}
      {steps.length > 0 && (
        <Pill
          selected={section === "subagent"}
          running={anyRunning}
          label={t("chat.subagentPill")}
          count={`${settledCount}/${steps.length}`}
          icon={<BotIcon />}
          onClick={() => onToggle("subagent")}
        />
      )}
      {files.length > 0 && (
        <Pill
          selected={section === "files"}
          label={t("chat.editedPill")}
          title={t("chat.editedFiles", { count: files.length })}
          icon={<PencilIcon />}
          stats={stats ? <LineStats stat={stats} /> : undefined}
          onClick={() => onToggle("files")}
        />
      )}
    </div>
  );
}

/** Right-edge chrome toggle: hides/shows the whole pill row. */
function ChromeToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const label = open ? t("chat.runStatusCollapse") : t("chat.runStatusExpand");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[5px] border border-dashed border-border-button-default text-foreground-icon-tertiary transition-colors hover:bg-background-tertiary-default/60 hover:text-foreground-icon-secondary"
    >
      {open ? <PanelTopCloseIcon /> : <PanelTopIcon />}
    </button>
  );
}

export const RunStatusStrip = memo(function RunStatusStrip({
  sessionKey,
  engine,
  workspacePath,
}: {
  sessionKey: string;
  engine: string;
  workspacePath: string;
}) {
  const messages = useChatStore((s) =>
    sessionKey ? (s.bySession[sessionKey]?.messages ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  );
  const { t } = useTranslation();
  const subagentHistory = useChatStore((s) =>
    sessionKey ? (s.bySession[sessionKey]?.subagentHistory ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  );
  const streaming = useChatStore((s) =>
    sessionKey ? (s.bySession[sessionKey]?.streaming ?? false) : false,
  );
  const allHistory = useMemo(
    () => (subagentHistory.length ? [...subagentHistory, ...messages] : messages),
    [subagentHistory, messages],
  );
  // Claude reports its subagents as background tasks, so that table is the
  // real data for its pill — a task that failed says so, which the message
  // fold cannot tell. Keep the baseline's combined history for other engines
  // and todo extraction (including separately paged subagent history).
  const tasks = useChatStore((s) =>
    sessionKey ? (s.bySession[sessionKey]?.tasks ?? EMPTY_TASKS) : EMPTY_TASKS,
  );
  // The run the session's live turn belongs to: the pill's task subset follows
  // it (see stepsFromTasks) so it counts this turn's subagents, not every row
  // the session ever reported.
  const currentRunId = useChatStore((s) =>
    sessionKey ? (s.bySession[sessionKey]?.currentRunId ?? null) : null,
  );
  const steps = useMemo(
    () =>
      engine === "claude" && tasks.length > 0
        ? stepsFromTasks(tasks, currentRunId, (type) =>
            t(`chat.tasks.type.${type}`, { defaultValue: type }),
          )
        : deriveAgentTaskSteps(allHistory, streaming, engine),
    [tasks, currentRunId, allHistory, streaming, engine, t],
  );
  const files = useMemo(() => deriveEditedFiles(messages), [messages]);
  const todos = useMemo(() => deriveTodoList(allHistory), [allHistory]);
  const buildEditLineStats = useMemo(createEditLineStatsBuilder, [sessionKey]);
  const sessionStats = useMemo(() => buildEditLineStats(messages), [buildEditLineStats, messages]);

  // git line stats are the fallback for files the session recorded without an
  // edit payload; force-refresh when the turn settles.
  const gitStatus = useGitStore((s) =>
    workspacePath ? s.statusByWorkspace[workspacePath] : undefined,
  );
  const refreshGit = useGitStore((s) => s.refresh);
  useEffect(() => {
    if (!workspacePath || files.length === 0) return;
    void refreshGit(workspacePath, !streaming).catch(() => undefined);
  }, [workspacePath, streaming, files.length, refreshGit]);
  const { perFile, total } = useMemo(
    () => collectFileStats(files, sessionStats, gitStatus, workspacePath),
    [files, sessionStats, gitStatus, workspacePath],
  );

  const [chromeOpen, setChromeOpen] = useState(readChromeOpen);
  const [section, setSection] = useState<SectionId | null>(null);

  // A section whose data vanished collapses itself.
  // Render-time adjustment (React re-renders before paint): an effect would
  // flash the stale panel for a frame first.
  const sectionData: Record<SectionId, number> = {
    todo: todos.length,
    subagent: steps.length,
    files: files.length,
  };
  if (section && sectionData[section] === 0) setSection(null);

  // Esc collapses the open panel.
  useEffect(() => {
    if (!section) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section]);

  if (steps.length === 0 && files.length === 0 && todos.length === 0) return null;

  const toggleSection = (id: SectionId) =>
    setSection((current) => (current === id ? null : id));
  const toggleChrome = () => {
    setSection(null);
    const next = !chromeOpen;
    writeChromeOpen(next);
    setChromeOpen(next);
  };

  return (
    <div className="relative" data-testid="run-status-strip">
      <RunStatusPanel
        section={section}
        steps={steps}
        todos={todos}
        files={files}
        perFile={perFile}
        total={total}
        live={streaming}
      />
      <div className="flex min-h-7 items-center gap-1.5">
        {chromeOpen ? (
          <RunStatusPills
            section={section}
            steps={steps}
            todos={todos}
            files={files}
            stats={total}
            streaming={streaming}
            onToggle={toggleSection}
          />
        ) : (
          <div className="flex-1" />
        )}
        <ChromeToggle open={chromeOpen} onToggle={toggleChrome} />
      </div>
    </div>
  );
});
