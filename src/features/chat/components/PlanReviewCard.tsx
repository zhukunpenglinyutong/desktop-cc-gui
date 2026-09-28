import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import ClipboardList from "lucide-react/dist/esm/icons/clipboard-list";
import Copy from "lucide-react/dist/esm/icons/copy";
import X from "lucide-react/dist/esm/icons/x";
import type { Message, PlanReview, PlanReviewStatus } from "@/lib/ipc";
import { useCopied } from "@/hooks/use-copied";
import { useChatStore } from "../store";
import { useScopedSessionKey } from "../split/session-scope";
import Markdown from "./Markdown";

/**
 * Plan preview card (timeline form): the typed plan_review event produced a
 * persisted, revisioned record; the decision itself lives in the dock above
 * the composer. Every status keeps view + copy; only the dock's actionable
 * record offers approve / request-changes / defer.
 */

const STATUS_KEYS: Record<PlanReviewStatus, string> = {
  draft: "chat.planStatusDraft",
  awaiting_review: "chat.planStatusAwaitingReview",
  submitting: "chat.planStatusSubmitting",
  approved: "chat.planStatusApproved",
  changes_requested: "chat.planStatusChangesRequested",
  deferred: "chat.planStatusDeferred",
  cancelled: "chat.planStatusCancelled",
  expired: "chat.planStatusExpired",
  superseded: "chat.planStatusSuperseded",
};

/** Localized execution-permission label; unknown values pass through raw. */
export function execPermissionLabel(
  t: (key: string) => string,
  permission: string,
): string {
  const keys: Record<string, string> = {
    auto: "chat.permissionAuto",
    manual: "chat.permissionManual",
    plan: "chat.permissionPlan",
    bypass: "chat.permissionBypass",
  };
  const key = keys[permission];
  return key ? t(key) : permission;
}

/** Status badge with an accessible text label for every lifecycle state. */
export function PlanStatusBadge({ status }: { status: PlanReviewStatus }) {
  const { t } = useTranslation();
  const tone =
    status === "awaiting_review" || status === "submitting"
      ? "border-button-primary/40 text-text-primary"
      : status === "approved"
        ? "border-button-primary/40 text-text-primary"
        : "border-border-secondary text-text-tertiary";
  return (
    <span
      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-caption-1-regular ${tone}`}
    >
      {t(STATUS_KEYS[status])}
    </span>
  );
}

/** Whitespace-collapsed excerpt for the card body. */
export function planSummary(content: string, max = 240): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Copy the plan's raw markdown (verbatim — what the user approved). */
export function CopyPlanButton({ content }: { content: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  return (
    <button
      type="button"
      onClick={() => copy(content)}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border-secondary bg-background-secondary-default px-2.5 py-1 text-caption-1-medium text-text-secondary transition-colors hover:bg-background-tertiary-hover"
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {copied ? t("chat.planReviewCopied") : t("chat.planReviewCopy")}
    </button>
  );
}

export function PlanCardHeader({ record }: { record: PlanReview }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <ClipboardList
        className="size-3.5 shrink-0 text-foreground-icon-secondary"
        aria-hidden
      />
      <span className="text-caption-1-medium text-text-primary">
        {record.title.trim() || t("chat.planReviewDefaultTitle")}
      </span>
      <span className="rounded-md bg-background-tertiary-default px-1.5 py-0.5 text-caption-1-regular text-text-secondary">
        {record.engine}
      </span>
      <span className="text-caption-1-regular text-text-tertiary">
        {t("chat.planReviewRevision", { revision: record.revision })}
      </span>
      <PlanStatusBadge status={record.status} />
    </div>
  );
}

/**
 * Full-plan preview: a right-side panel on wide screens, near-fullscreen on
 * narrow ones. Renders through the existing Markdown pipeline (same
 * sanitization as chat). Closing (Esc, backdrop, button) never sends IPC.
 */
export function PlanPreviewOverlay({
  record,
  workspacePath,
  onClose,
}: {
  record: PlanReview;
  workspacePath: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.planReviewFullTitle")}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col bg-background-primary-default sm:max-w-[720px] sm:border-l sm:border-border-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-primary px-4 py-3">
          <PlanCardHeader record={record} />
          <div className="ml-auto flex items-center gap-2">
            <CopyPlanButton content={record.content} />
            <button
              type="button"
              onClick={onClose}
              aria-label={t("chat.closePreview")}
              className="cursor-pointer rounded-md p-1 text-text-tertiary transition-colors hover:bg-background-tertiary-hover hover:text-text-primary"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <Markdown text={record.content} workspacePath={workspacePath} />
        </div>
      </div>
    </div>
  );
}

/** "View full plan" button + its overlay, shared by the card and the dock. */
export function PlanViewFullButton({
  record,
  workspacePath,
}: {
  record: PlanReview;
  workspacePath: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border-secondary bg-background-secondary-default px-2.5 py-1 text-caption-1-medium text-text-secondary transition-colors hover:bg-background-tertiary-hover"
      >
        {t("chat.planReviewViewFull")}
      </button>
      {open && (
        <PlanPreviewOverlay
          record={record}
          workspacePath={workspacePath}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Timeline card: title, engine, revision, status, summary, view/copy. A
 *  deferred plan keeps its native wait parked, so the card offers
 *  「继续审批」 to reopen the dock — defer itself already closed it. */
export function PlanReviewCard({
  message,
  workspacePath = "",
}: {
  message: Message;
  workspacePath?: string;
}) {
  const { t } = useTranslation();
  const record = message.planReview;
  const resumePlanReview = useChatStore((s) => s.resumePlanReview);
  // 所属栏位的会话 key（分屏后不能再用全局 active）。
  const key = useScopedSessionKey() || null;
  if (!record) return null;
  return (
    <div className="flex max-w-[85%] flex-col gap-1.5 rounded-xl border border-border-secondary bg-background-secondary-default px-3.5 py-2.5 text-left">
      <PlanCardHeader record={record} />
      {record.content.trim() && (
        <div className="text-caption-1-regular text-text-secondary [overflow-wrap:anywhere]">
          {planSummary(record.content)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PlanViewFullButton
          record={record}
          workspacePath={record.workspacePath || workspacePath}
        />
        <CopyPlanButton content={record.content} />
        {record.status === "deferred" && record.complete && key && (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border-secondary bg-background-secondary-default px-2.5 py-1 text-caption-1-medium text-text-secondary transition-colors hover:bg-background-tertiary-hover"
            onClick={() =>
              resumePlanReview(key, `${record.planId}:${record.revision}`)
            }
          >
            {t("chat.planReviewResume")}
          </button>
        )}
        <span className="text-caption-1-regular text-text-tertiary">
          {record.status === "draft"
            ? t("chat.planReviewDraftHint")
            : record.status === "deferred"
              ? t("chat.planReviewDeferredHint")
              : record.status === "awaiting_review" || record.status === "submitting"
                ? t("chat.planReviewAwaitingHint")
                : null}
        </span>
      </div>
    </div>
  );
}
