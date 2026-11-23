import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
  Pressable,
} from "react-aria-components";
import { MENU_POPOVER_SURFACE } from "@/components/base/dropdown/menu-styles";
import { cx } from "@/utils/cx";
import { useDismissOnOutsidePress, useTriggerToggle } from "@/utils/use-dismiss-on-outside-press";
import {
  deriveRunPhase,
  isRunSilenceSuspicious,
  runSilenceMs,
  type RunActivitySnapshot,
  type RunPhase,
} from "../run-activity";
import { useRunActivity, type RunActivityState } from "../use-run-activity";
import { formatDuration } from "./format-duration";

/**
 * The streaming tail's status line ("Responding · 15m35s · …") as a press
 * target: clicking it opens a panel saying what the run is doing right now —
 * waiting on the provider, the model thinking or writing, a local tool or
 * subagents running, a provider retry and its cause — and when the CLI last
 * said anything. Facts come from the host (`run_activity`), polled once a
 * second only while the panel is open, so the closed status line costs
 * nothing.
 *
 * The trigger is a `role="button"` element via `Pressable`, not a <button>:
 * the status line already holds its own button (the response check badge),
 * and buttons must not nest. The popover is non-modal like every menu here
 * (see Dropdown) with outside-press dismissal restored by hand.
 */
export function RunActivityTrigger({
  sessionKey,
  className,
  children,
}: {
  sessionKey: string | null;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const activity = useRunActivity(sessionKey, open);
  useDismissOnOutsidePress(open, () => setOpen(false), [triggerRef, popoverRef]);
  const allowOpenChange = useTriggerToggle(open, triggerRef);
  return (
    <AriaDialogTrigger isOpen={open} onOpenChange={(next) => allowOpenChange(next) && setOpen(next)}>
      <Pressable>
        <div
          ref={triggerRef}
          role="button"
          tabIndex={0}
          aria-label={t("chat.runActivity.open")}
          aria-expanded={open}
          className={cx(
            "-mx-2 w-fit max-w-[calc(100%+16px)] cursor-pointer rounded-xl px-2 outline-none transition-colors",
            "hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring",
            open && "bg-background-secondary-hover",
            className,
          )}
        >
          {children}
        </div>
      </Pressable>
      <AriaPopover
        ref={popoverRef}
        isNonModal
        placement="top start"
        offset={6}
        className={cx("w-[440px]", MENU_POPOVER_SURFACE)}
      >
        <AriaDialog aria-label={t("chat.runActivity.title")} className="outline-none">
          <RunActivityBody activity={activity} />
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}

function ago(ms: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const duration = formatDuration(ms);
  return duration ? t("chat.runActivity.ago", { duration }) : t("chat.runActivity.justNow");
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function RunActivityBody({ activity }: { activity: RunActivityState }) {
  const { t } = useTranslation();
  const { snapshot, loaded, failed } = activity;
  return (
    <div className="flex flex-col gap-3 text-caption-1-regular text-text-secondary" data-testid="run-activity-panel">
      <div className="text-caption-1-semibold text-text-primary">{t("chat.runActivity.title")}</div>
      {!snapshot ? (
        <div className="text-text-tertiary">
          {!loaded
            ? t("chat.runActivity.loading")
            : failed
              ? t("chat.runActivity.failed")
              : t("chat.runActivity.noRun")}
        </div>
      ) : (
        <SnapshotView snapshot={snapshot} stale={failed} />
      )}
    </div>
  );
}

function SnapshotView({ snapshot, stale }: { snapshot: RunActivitySnapshot; stale: boolean }) {
  const { t } = useTranslation();
  const phase = deriveRunPhase(snapshot);
  const silence = runSilenceMs(snapshot);
  const suspicious = isRunSilenceSuspicious(snapshot, phase);
  const lastOutputAt = Math.max(snapshot.lastOutputAtMs ?? 0, snapshot.lastEventAtMs ?? 0);
  const retries = [...snapshot.retries].reverse();
  return (
    <>
      <PhaseView snapshot={snapshot} phase={phase} />
      {suspicious && (
        <div role="alert" className="rounded-lg bg-background-secondary-default px-2.5 py-2 text-text-warning-primary">
          {t("chat.runActivity.silenceWarning", { duration: formatDuration(silence) ?? "" })}
        </div>
      )}
      <dl className="m-0 flex flex-col gap-1">
        <FactRow
          label={t("chat.runActivity.lastOutput")}
          value={lastOutputAt > 0 ? ago(snapshot.nowMs - lastOutputAt, t) : t("chat.runActivity.never")}
        />
        <FactRow
          label={t("chat.runActivity.process")}
          value={
            snapshot.pid != null && snapshot.pid > 0
              ? t("chat.runActivity.processPid", { engine: snapshot.engine, pid: snapshot.pid })
              : snapshot.engine
          }
        />
        {snapshot.backgroundTasks > 0 && (
          <FactRow
            label={t("chat.runActivity.backgroundTasks")}
            value={String(snapshot.backgroundTasks)}
          />
        )}
        {snapshot.lastWarn && snapshot.lastWarnAtMs != null && (
          <FactRow
            label={t("chat.runActivity.lastWarn")}
            value={`${snapshot.lastWarn} · ${ago(snapshot.nowMs - snapshot.lastWarnAtMs, t)}`}
            warn
          />
        )}
      </dl>
      {retries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-caption-1-semibold text-text-primary">
            {t("chat.runActivity.retriesTitle", { count: retries.length })}
          </div>
          <ul className="m-0 flex max-h-[180px] list-none flex-col gap-1.5 overflow-y-auto p-0">
            {retries.map((retry) => (
              <li key={`${retry.atMs}-${retry.attempt}`} className="flex flex-col">
                <span className="tabular-nums text-text-primary">
                  {clock(retry.atMs)} ·{" "}
                  {retry.max > 0
                    ? t("chat.runActivity.attemptOf", { attempt: retry.attempt, max: retry.max })
                    : t("chat.runActivity.attempt", { attempt: retry.attempt })}{" "}
                  ·{" "}
                  <span className="text-text-warning-primary">
                    {t(`chat.runActivity.retryCategory.${retry.category}`)}
                    {retry.status != null ? ` (HTTP ${retry.status})` : ""}
                  </span>
                </span>
                {retry.message && (
                  <span className="break-words text-text-tertiary">{retry.message}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {stale && <div className="text-text-tertiary">{t("chat.runActivity.failed")}</div>}
    </>
  );
}

function PhaseView({ snapshot, phase }: { snapshot: RunActivitySnapshot; phase: RunPhase }) {
  const { t } = useTranslation();
  const elapsed = formatDuration(snapshot.nowMs - phase.sinceMs);
  const lastRetry = snapshot.retries[snapshot.retries.length - 1];
  const showTools = phase.kind === "tools" || phase.kind === "subagents";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body-medium text-text-primary">
          {t(`chat.runActivity.phase.${phase.kind}`)}
        </span>
        {elapsed && <span className="shrink-0 tabular-nums text-text-tertiary">{elapsed}</span>}
      </div>
      <div className="text-text-tertiary">{t(`chat.runActivity.phaseHint.${phase.kind}`)}</div>
      {phase.kind === "retrying" && lastRetry && (
        <div className="text-text-warning-primary">
          {t(`chat.runActivity.retryCategory.${lastRetry.category}`)}
          {lastRetry.status != null ? ` (HTTP ${lastRetry.status})` : ""}
          {" — "}
          {t(`chat.runActivity.retryCategoryHint.${lastRetry.category}`)}
        </div>
      )}
      {showTools && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
          {snapshot.tools.map((tool, index) => (
            <li key={tool.id ?? `${tool.name}-${index}`} className="flex items-baseline gap-2">
              <span className="shrink-0 text-text-primary">{tool.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-text-tertiary" title={tool.detail}>
                {tool.detail ?? ""}
              </span>
              <span className="shrink-0 tabular-nums text-text-tertiary">
                {formatDuration(snapshot.nowMs - tool.sinceMs) ?? ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FactRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4">
      <dt className="whitespace-nowrap text-text-tertiary">{label}</dt>
      <dd
        className={cx(
          "m-0 min-w-0 break-words text-right tabular-nums",
          warn ? "text-text-warning-primary" : "text-text-primary",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
