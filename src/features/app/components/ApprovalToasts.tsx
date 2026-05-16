import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ApprovalRequest, WorkspaceInfo } from "../../../types";
import { getApprovalCommandInfo } from "../../../utils/approvalRules";

type ApprovalToastsProps = {
  approvals: ApprovalRequest[];
  workspaces: WorkspaceInfo[];
  onDecision: (request: ApprovalRequest, decision: "accept" | "decline" | "dismiss") => void;
  onApproveBatch?: (requests: ApprovalRequest[]) => void;
  onRemember?: (request: ApprovalRequest, command: string[]) => void;
  variant?: "overlay" | "inline";
};

const HIDDEN_APPROVAL_PARAM_KEYS = new Set([
  "threadId",
  "thread_id",
  "turnId",
  "turn_id",
  "toolName",
  "tool_name",
  "itemId",
  "item_id",
  "input",
  "message",
]);

const HIDDEN_APPROVAL_BODY_KEYS = new Set([
  "content",
  "text",
  "old_string",
  "oldString",
  "new_string",
  "newString",
  "diff",
  "patch",
  "unified_diff",
  "unifiedDiff",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getApprovalCandidateRecords(params: Record<string, unknown>): Record<string, unknown>[] {
  const nestedInput = asRecord(params.input);
  const nestedArguments = asRecord(params.arguments);
  return [params, nestedInput, nestedArguments].filter((record, index, records) => {
    if (Object.keys(record).length === 0) {
      return false;
    }
    return records.findIndex((candidate) => candidate === record) === index;
  });
}

function shouldHideApprovalParamEntry(key: string, value: unknown): boolean {
  if (HIDDEN_APPROVAL_PARAM_KEYS.has(key)) {
    return true;
  }
  if (HIDDEN_APPROVAL_BODY_KEYS.has(key)) {
    return true;
  }
  if (typeof value === "string" && value.length > 500) {
    return true;
  }
  return false;
}

function getToolLabel(method: string, t: (key: string) => string): string {
  if (method.includes("fileChange")) {
    return t("approval.fileChanges");
  }
  if (method.includes("commandExecution")) {
    return t("approval.commandExecution");
  }
  return t("approval.genericApproval");
}

function getApprovalPath(params: Record<string, unknown>): string | null {
  for (const record of getApprovalCandidateRecords(params)) {
    for (const key of [
      "file_path",
      "filePath",
      "filepath",
      "path",
      "target_file",
      "targetFile",
      "filename",
      "file",
      "notebook_path",
      "notebookPath",
    ]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function getApprovalMessage(params: Record<string, unknown>): string | null {
  for (const record of getApprovalCandidateRecords(params)) {
    const raw = typeof record.message === "string" ? record.message.trim() : "";
    if (!raw) {
      continue;
    }
    if (raw.includes("acknowledges the blocked request")) {
      return "Claude 需要你的授权才能继续这一步。当前预览阶段授权后可能仍需重试一次。";
    }
    return raw;
  }
  return null;
}

function getApprovalToolName(params: Record<string, unknown>): string | null {
  for (const record of getApprovalCandidateRecords(params)) {
    for (const key of ["toolName", "tool_name"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function getApprovalKindIcon(method: string): string {
  if (method.includes("fileChange")) {
    return "codicon codicon-files";
  }
  if (method.includes("commandExecution")) {
    return "codicon codicon-terminal";
  }
  return "codicon codicon-shield";
}

export function ApprovalToasts({
  approvals,
  workspaces,
  onDecision,
  onApproveBatch,
  onRemember,
  variant = "overlay",
}: ApprovalToastsProps) {
  const { t } = useTranslation();
  const workspaceLabels = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  const primaryRequest = approvals[approvals.length - 1];
  const batchEligibleApprovals = useMemo(
    () =>
      primaryRequest?.method.includes("fileChange")
        ? approvals.filter((approval) => approval.method.includes("fileChange"))
        : [],
    [approvals, primaryRequest],
  );
  const batchCount = batchEligibleApprovals.length;

  useEffect(() => {
    if (!primaryRequest) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Enter") {
        return;
      }
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT")
      ) {
        return;
      }
      event.preventDefault();
      onDecision(primaryRequest, "accept");
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDecision, primaryRequest]);

  if (!approvals.length) {
    return null;
  }

  const remainingCount = Math.max(0, approvals.length - 1);

  const formatLabel = (value: string) =>
    value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .trim();

  const renderParamValue = (value: unknown) => {
    if (value === null || value === undefined) {
      return { text: t("approval.none"), isCode: false };
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return { text: String(value), isCode: false };
    }
    if (Array.isArray(value)) {
      if (value.every((entry) => ["string", "number", "boolean"].includes(typeof entry))) {
        return { text: value.map(String).join(", "), isCode: false };
      }
      return { text: JSON.stringify(value, null, 2), isCode: true };
    }
    return { text: JSON.stringify(value, null, 2), isCode: true };
  };

  const isInline = variant === "inline";

  return (
    <div
      className={`approval-toasts grid gap-3 overflow-auto pointer-events-auto [-webkit-app-region:no-drag] ${
        isInline
          ? "approval-toasts-inline relative w-[min(920px,100%)] max-w-none max-h-none z-auto"
          : "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(460px,calc(100vw-48px))] max-h-[min(520px,calc(100vh-140px))] z-[5]"
      }`}
      role="region"
      aria-live="assertive"
    >
      {[primaryRequest].map((request) => {
        const workspaceName = workspaceLabels.get(request.workspace_id);
        const params = request.params ?? {};
        const commandInfo = getApprovalCommandInfo(params);
        const approvalPath = getApprovalPath(params);
        const approvalMessage = getApprovalMessage(params);
        const approvalToolName = getApprovalToolName(params);
        const entries = Object.entries(params).filter(([key, value]) => {
          if (shouldHideApprovalParamEntry(key, value)) {
            return false;
          }
          if (approvalPath && value === approvalPath) {
            return false;
          }
          if (commandInfo && (key === "command" || key === "cmd")) {
            return false;
          }
          return value !== undefined && value !== null && value !== "";
        });
        return (
          <div
            key={`${request.workspace_id}-${request.request_id}`}
            className={`approval-toast relative overflow-hidden max-w-full bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-context-core)_94%,white_6%)_0%,var(--surface-context-core)_100%)] border border-[color:color-mix(in_srgb,var(--accent-primary,#2563eb)_24%,var(--border-subtle))] pointer-events-auto animate-[approval-toast-in_0.2s_ease-out] pt-3.5 px-3.5 pb-3 before:content-[''] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[linear-gradient(180deg,#f59e0b_0%,#f97316_100%)] ${
              isInline
                ? "w-full box-border rounded-[18px] shadow-[0_16px_40px_rgba(0,0,0,0.24)] [backdrop-filter:none]"
                : "rounded-2xl shadow-[0_16px_32px_rgba(0,0,0,0.25)]"
            }`}
            role="alert"
          >
            {remainingCount > 0 ? (
              <div className="approval-toast-queue-summary mb-2.5 text-xs text-[color:color-mix(in_srgb,var(--text)_68%,var(--text-muted))] font-semibold">
                {t("approval.remainingRequests", { count: remainingCount })}
              </div>
            ) : null}
            <div className="approval-toast-header flex justify-between items-start gap-4 mb-3">
              <div className="approval-toast-header-main flex items-start gap-3 min-w-0">
                <div className="approval-toast-icon-wrap w-[34px] h-[34px] rounded-[10px] inline-flex items-center justify-center bg-[color:color-mix(in_srgb,#f59e0b_18%,transparent)] border border-[color:color-mix(in_srgb,#f59e0b_34%,transparent)] text-[#fbbf24] shrink-0" aria-hidden>
                  <span className="codicon codicon-shield approval-toast-icon text-lg" />
                </div>
                <div className="approval-toast-header-copy grid gap-1 min-w-0">
                  <div className="approval-toast-title-row flex items-center gap-2 flex-wrap">
                    <div className="approval-toast-title text-lg leading-tight tracking-[0.01em] text-[color:var(--text)] font-bold">{t("approval.approvalNeeded")}</div>
                    <div className="approval-toast-badge inline-flex items-center min-h-[22px] px-2 rounded-full bg-[color:color-mix(in_srgb,#f59e0b_18%,transparent)] border border-[color:color-mix(in_srgb,#f59e0b_30%,transparent)] text-[#fbbf24] text-[11px] font-bold tracking-[0.04em] uppercase">{t("approval.pendingBadge")}</div>
                  </div>
                  <div className="approval-toast-subtitle text-xs leading-[1.45] text-[color:var(--text-muted)]">
                    {t("approval.reviewBeforeApply")}
                  </div>
                </div>
              </div>
              <div className="approval-toast-header-side inline-flex items-start justify-end gap-2 shrink-0">
                {workspaceName ? (
                  <div className="approval-toast-workspace text-xs text-[color:var(--text-faint)] rounded-full py-1.5 px-2.5 border border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-card-muted)_78%,transparent)] max-w-[min(280px,40%)] overflow-hidden text-ellipsis whitespace-nowrap">{workspaceName}</div>
                ) : null}
                <button
                  type="button"
                  className="ghost approval-toast-close w-8 h-8 rounded-[10px] p-0 inline-flex items-center justify-center"
                  onClick={() => onDecision(request, "dismiss")}
                  aria-label={t("approval.close")}
                  title={t("approval.close")}
                >
                  <span className="codicon codicon-close" aria-hidden />
                </button>
              </div>
            </div>
            <div className="approval-toast-summary-band flex justify-between items-center gap-3 flex-wrap mb-3 py-2.5 px-3 rounded-xl bg-[color:color-mix(in_srgb,var(--surface-card-muted)_84%,transparent)] border border-[color:color-mix(in_srgb,var(--border-subtle)_82%,transparent)]">
              <div className="approval-toast-kind inline-flex items-center gap-2 text-[13px] font-bold text-[color:var(--text)]">
                <span className={getApprovalKindIcon(request.method)} aria-hidden />
                <span>{getToolLabel(request.method, t)}</span>
              </div>
              {approvalToolName ? (
                <div className="approval-toast-summary-meta inline-flex items-center gap-2 min-w-0">
                  <span className="approval-toast-summary-label text-[11px] text-[color:var(--text-faint)] uppercase tracking-[0.06em]">{t("approval.toolLabel")}</span>
                  <span className="approval-toast-summary-value text-[13px] text-[color:var(--text)] font-semibold">{approvalToolName}</span>
                </div>
              ) : null}
            </div>
            <div className="approval-toast-details grid gap-2.5 mb-3">
              {approvalPath ? (
                <div className="approval-toast-detail approval-toast-detail-spotlight grid gap-1.5 py-2.5 px-3 rounded-xl border border-[color:color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-card-muted)_70%,var(--surface-context-core))]">
                  <div className="approval-toast-detail-label text-[11px] text-[color:var(--text-faint)] uppercase tracking-[0.06em]">
                    {t("approval.filePathLabel")}
                  </div>
                  <div className="approval-toast-detail-value approval-toast-path-value flex items-start gap-2 text-[13px] leading-normal text-[color:var(--text)] [overflow-wrap:break-word] break-words">
                    <span className="codicon codicon-file approval-toast-inline-icon mt-0.5 text-[color:var(--text-muted)] shrink-0" aria-hidden />
                    <span>{approvalPath}</span>
                  </div>
                </div>
              ) : null}
              {commandInfo ? (
                <div className="approval-toast-detail approval-toast-detail-spotlight grid gap-1.5 py-2.5 px-3 rounded-xl border border-[color:color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-card-muted)_70%,var(--surface-context-core))]">
                  <div className="approval-toast-detail-label text-[11px] text-[color:var(--text-faint)] uppercase tracking-[0.06em]">
                    {t("approval.commandLabel")}
                  </div>
                  <div className="approval-toast-detail-value approval-toast-command-value flex items-start gap-2 text-[13px] leading-normal text-[color:var(--text)] [overflow-wrap:break-word] break-words">
                    <span className="codicon codicon-terminal approval-toast-inline-icon mt-0.5 text-[color:var(--text-muted)] shrink-0" aria-hidden />
                    <span>{commandInfo.preview}</span>
                  </div>
                </div>
              ) : null}
              {approvalMessage ? (
                <div className="approval-toast-detail approval-toast-note-block grid gap-1.5 py-2.5 px-3 rounded-xl border border-dashed border-[color:color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-card-muted)_62%,transparent)]">
                  <div className="approval-toast-detail-label text-[11px] text-[color:var(--text-faint)] uppercase tracking-[0.06em]">{t("approval.noteLabel")}</div>
                  <div className="approval-toast-detail-value text-[13px] leading-normal text-[color:var(--text)] [overflow-wrap:break-word] break-words">{approvalMessage}</div>
                </div>
              ) : null}
              {entries.length ? (
                entries.map(([key, value]) => {
                  const rendered = renderParamValue(value);
                  return (
                    <div key={key} className="approval-toast-detail grid gap-1.5 py-2.5 px-3 rounded-xl border border-[color:color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-card-muted)_62%,transparent)]">
                      <div className="approval-toast-detail-label text-[11px] text-[color:var(--text-faint)] uppercase tracking-[0.06em]">
                        {formatLabel(key)}
                      </div>
                      {rendered.isCode ? (
                        <pre className="approval-toast-detail-code font-mono text-[11px] text-[color:var(--text-muted)] whitespace-pre-wrap max-h-40 overflow-auto rounded-lg bg-[color:var(--surface-card-muted)] p-2 m-0 [overflow-wrap:break-word] break-words">
                          {rendered.text}
                        </pre>
                      ) : (
                        <div className="approval-toast-detail-value text-[13px] leading-normal text-[color:var(--text)] [overflow-wrap:break-word] break-words">
                          {rendered.text}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : !approvalPath && !commandInfo && !approvalMessage ? (
                <div className="approval-toast-detail approval-toast-detail-empty grid gap-1.5 py-2.5 px-3 rounded-xl border border-[color:color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-card-muted)_62%,transparent)] text-xs text-[color:var(--text-muted)]">
                  {t("approval.noExtraDetails")}
                </div>
              ) : null}
            </div>
            <div className="approval-toast-actions flex gap-2 justify-end flex-wrap pt-0.5">
              <button
                type="button"
                className="secondary"
                onClick={() => onDecision(request, "decline")}
              >
                {t("approval.decline")}
              </button>
              {batchCount > 1 && onApproveBatch ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onApproveBatch(batchEligibleApprovals)}
                >
                  {t("approval.approveTurnBatch", { count: batchCount })}
                </button>
              ) : null}
              {commandInfo && onRemember ? (
                <button
                  type="button"
                  className="ghost approval-toast-remember whitespace-nowrap"
                  onClick={() => onRemember(request, commandInfo.tokens)}
                  title={t("approval.allowCommandsStartWith", { prefix: commandInfo.preview })}
                >
                  {t("approval.alwaysAllow")}
                </button>
              ) : null}
              <button
                type="button"
                className="primary"
                onClick={() => onDecision(request, "accept")}
              >
                {t("approval.approveEnter")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
