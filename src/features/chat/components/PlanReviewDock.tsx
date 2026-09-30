import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message, PlanReviewDecision } from "@/lib/ipc";
import { useChatStore } from "../store";
import { useScopedSession, useScopedSessionKey } from "../split/session-scope";
import { isPlanActionable } from "../store/plan-review";
import { memoizeMessageHistory } from "./memoize-message-history";
import {
  CopyPlanButton,
  PlanCardHeader,
  PlanViewFullButton,
  execPermissionLabel,
  planSummary,
} from "./PlanReviewCard";

/**
 * Plan-approval dock (composer form): the three primary actions — approve &
 * execute, request changes, defer — while a plan revision awaits decision.
 * Mirrors QuestionDock's layout/focus pattern: the dock covers the composer,
 * and the only way out is an explicit decision (closing the preview, Esc or
 * switching sessions never sends one).
 */

/** The active session's plan awaiting a dock decision: awaiting_review /
 *  submitting always; a deferred plan only after the user reopened it from
 *  its card (「继续审批」) — defer settles the round, so the dock closing is
 *  the visible effect of the click. Resolved like usePendingQuestion. */
export function usePendingPlanReview() {
  const key = useScopedSessionKey();
  const pendingPlan = useMemo(() => memoizeMessageHistory<Message | null, string | null>((messages, resume) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const record = messages[i].planReview;
      if (!record) continue;
      if (record.status === "awaiting_review" || record.status === "submitting") {
        return messages[i];
      }
      if (
        record.status === "deferred" &&
        resume === `${record.planId}:${record.revision}`
      ) {
        return messages[i];
      }
    }
    return null;
  }), []);
  return useChatStore((s) => {
    if (!key) return null;
    const session = s.bySession[key];
    return pendingPlan(session?.messages, session?.planReviewResume);
  });
}

/** Conversation-mode mutex: true while a plan awaits decision AND its run is
 *  alive — switching the session into a plugin conversation mode then would
 *  strand the native waiting point, so the picker entry stays disabled. A
 *  settled plan turn (next_turn) does not block the switch. */
export function usePlanReviewGateActive(): boolean {
  const key = useScopedSessionKey();
  const actionablePlan = useMemo(() => memoizeMessageHistory((messages) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const record = messages[i].planReview;
      if (record && isPlanActionable(record.status)) return true;
    }
    return false;
  }), []);
  return useChatStore((s) => {
    const session = key ? s.bySession[key] : undefined;
    return session?.streaming ? actionablePlan(session.messages) : false;
  });
}

type DockNotice = { kind: "conflict" } | { kind: "error"; message: string } | null;

function PlanReviewDockBody({
  message,
  onHold,
}: {
  message: Message;
  /** Conflict hold: the store record went terminal mid-submit, so the dock
   *  keeps a read-only panel with the backend's current state instead of
   *  vanishing before the user sees why. */
  onHold: (message: Message) => void;
}) {
  const { t } = useTranslation();
  const record = message.planReview!;
  const respondToPlanReview = useChatStore((s) => s.respondToPlanReview);
  // 本栏的会话：分屏后非聚焦格子里的审批面板也不能串到全局 active 上。
  const scopedSession = useScopedSession();
  const key = useScopedSessionKey();
  const rootRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<DockNotice>(null);

  // Default focus lands on the inert container, never on the approve
  // button: keyboard users tab to the dangerous action deliberately.
  useEffect(() => {
    rootRef.current?.focus();
  }, [record.planId, record.revision]);

  const open = record.status === "awaiting_review" || record.status === "deferred";
  const canDecide = open && !busy;
  const canApprove = canDecide && record.complete;

  const submit = async (decision: PlanReviewDecision, text?: string) => {
    if (!key || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await respondToPlanReview(
      key,
      record.planId,
      record.revision,
      decision,
      text,
    );
    setBusy(false);
    if (result.kind === "conflict") {
      // The store record already flipped to the backend's current state; if
      // that state is terminal the pending hook now yields null, so hand a
      // snapshot to the dock's hold panel — the user still sees the notice
      // and the refreshed status instead of the dock just vanishing.
      onHold({ ...message, planReview: result.record });
      setNotice({ kind: "conflict" });
    } else if (result.kind === "error") {
      setNotice({ kind: "error", message: result.error });
    } else if (decision === "request_changes") {
      setEditing(false);
      setFeedback("");
    }
  };

  const btn =
    "inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-caption-1-medium transition-colors disabled:cursor-not-allowed";
  const secondary = `${btn} border border-border-secondary bg-background-secondary-default text-text-secondary hover:bg-background-tertiary-hover`;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="group"
      aria-label={t("chat.planReviewGroupLabel")}
      className="flex w-full flex-col gap-2.5 text-left outline-none"
    >
      <PlanCardHeader record={record} />
      {record.content.trim() && (
        <div className="text-caption-1-regular text-text-secondary [overflow-wrap:anywhere]">
          {planSummary(record.content)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PlanViewFullButton
          record={record}
          workspacePath={record.workspacePath || scopedSession?.workspacePath || ""}
        />
        <CopyPlanButton content={record.content} />
        {open && record.execPermission && (
          <span className="text-caption-1-regular text-text-tertiary">
            {t("chat.planReviewExecPermission", {
              permission: execPermissionLabel(t, record.execPermission),
            })}
          </span>
        )}
      </div>
      {editing && (
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            // Plain Enter is a newline — it must never approve or submit;
            // only Cmd/Ctrl+Enter sends the feedback.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canDecide && feedback.trim()) void submit("request_changes", feedback);
            }
          }}
          rows={3}
          autoFocus
          placeholder={t("chat.planReviewFeedbackPlaceholder")}
          aria-label={t("chat.planReviewFeedbackLabel")}
          className="w-full resize-y rounded-md border border-border-secondary bg-background-tertiary-default px-2.5 py-1.5 text-caption-1-regular text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-1 focus-visible:ring-button-primary"
        />
      )}
      {notice?.kind === "conflict" && (
        <div role="status" className="text-caption-1-regular text-text-secondary">
          {t("chat.planReviewConflict")}
        </div>
      )}
      {notice?.kind === "error" && (
        <div role="alert" className="text-caption-1-regular text-text-secondary">
          {t("chat.planReviewError", { message: notice.message })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption-1-regular text-text-tertiary">
          {busy || record.status === "submitting"
            ? t("chat.planReviewSubmitting")
            : !record.complete
              ? t("chat.planReviewIncomplete")
              : null}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setFeedback("");
                }}
                className={secondary}
              >
                {t("chat.planReviewCancel")}
              </button>
              <button
                type="button"
                disabled={!canDecide || !feedback.trim()}
                onClick={() => void submit("request_changes", feedback)}
                className={`${btn} bg-button-primary text-text-white disabled:text-button-primary-disabled-foreground`}
              >
                {t("chat.planReviewFeedbackSubmit")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!canDecide}
                onClick={() => void submit("defer")}
                className={secondary}
              >
                {t("chat.planReviewDefer")}
              </button>
              <button
                type="button"
                disabled={!canDecide}
                onClick={() => setEditing(true)}
                className={secondary}
              >
                {t("chat.planReviewRequestChanges")}
              </button>
              <button
                type="button"
                disabled={!canApprove}
                title={record.complete ? undefined : t("chat.planReviewIncomplete")}
                onClick={() => void submit("approve")}
                className={`${btn} bg-button-primary text-text-white disabled:text-button-primary-disabled-foreground`}
              >
                {t("chat.planReviewApprove")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Read-only panel for a conflicted submit: the backend's current record,
 * the supersession notice, view/copy, and a dismiss — no decision actions. */
function PlanReviewHoldPanel({
  message,
  onDismiss,
}: {
  message: Message;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const record = message.planReview!;
  return (
    <div
      role="group"
      aria-label={t("chat.planReviewGroupLabel")}
      className="flex w-full flex-col gap-2.5 text-left"
    >
      <PlanCardHeader record={record} />
      <div role="status" className="text-caption-1-regular text-text-secondary">
        {t("chat.planReviewConflict")}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PlanViewFullButton record={record} workspacePath={record.workspacePath} />
        <CopyPlanButton content={record.content} />
        <div className="ml-auto">
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border-secondary bg-background-secondary-default px-2.5 py-1 text-caption-1-medium text-text-secondary transition-colors hover:bg-background-tertiary-hover"
          >
            {t("chat.planReviewDismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Plan-approval dock covering the composer while a revision awaits the
 *  user's decision (same container pattern as QuestionDock). After a
 *  conflicted submit that settled the record it holds a read-only snapshot
 *  so the notice is not lost with the pending card. */
export function PlanReviewDock() {
  const pending = usePendingPlanReview();
  const key = useScopedSessionKey();
  const [hold, setHold] = useState<Message | null>(null);
  // The hold belongs to the session that produced it.
  useEffect(() => setHold(null), [key]);
  // A different actionable plan supersedes the held snapshot.
  useEffect(() => {
    if (!pending?.planReview || !hold?.planReview) return;
    const a = pending.planReview;
    const b = hold.planReview;
    if (a.planId !== b.planId || a.revision !== b.revision) setHold(null);
  }, [pending, hold]);
  const message = pending ?? hold;
  if (!message?.planReview) return null;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-xl border border-border-secondary bg-background-secondary-default px-3.5 py-3 shadow-lg">
        {pending ? (
          <PlanReviewDockBody message={pending} onHold={setHold} />
        ) : (
          <PlanReviewHoldPanel message={message} onDismiss={() => setHold(null)} />
        )}
      </div>
    </div>
  );
}
