import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ApprovalRequest, WorkspaceInfo } from "../../../types";
import { getApprovalCommandInfo } from "../../../utils/approvalRules";

type ApprovalToastsProps = {
  approvals: ApprovalRequest[];
  workspaces: WorkspaceInfo[];
  onDecision: (request: ApprovalRequest, decision: "accept" | "decline") => void;
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

  return (
    <div
      className={`approval-toasts${variant === "inline" ? " approval-toasts-inline" : ""}`}
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
            className="approval-toast"
            role="alert"
          >
            {remainingCount > 0 ? (
              <div className="approval-toast-queue-summary">
                {t("approval.remainingRequests", { count: remainingCount })}
              </div>
            ) : null}
            <div className="approval-toast-header">
              <div className="approval-toast-header-main">
                <div className="approval-toast-icon-wrap" aria-hidden>
                  <span className="codicon codicon-shield approval-toast-icon" />
                </div>
                <div className="approval-toast-header-copy">
                  <div className="approval-toast-title-row">
                    <div className="approval-toast-title">{t("approval.approvalNeeded")}</div>
                    <div className="approval-toast-badge">{t("approval.pendingBadge")}</div>
                  </div>
                  <div className="approval-toast-subtitle">
                    {t("approval.reviewBeforeApply")}
                  </div>
                </div>
              </div>
              {workspaceName ? (
                <div className="approval-toast-workspace">{workspaceName}</div>
              ) : null}
            </div>
            <div className="approval-toast-summary-band">
              <div className="approval-toast-kind">
                <span className={getApprovalKindIcon(request.method)} aria-hidden />
                <span>{getToolLabel(request.method, t)}</span>
              </div>
              {approvalToolName ? (
                <div className="approval-toast-summary-meta">
                  <span className="approval-toast-summary-label">{t("approval.toolLabel")}</span>
                  <span className="approval-toast-summary-value">{approvalToolName}</span>
                </div>
              ) : null}
            </div>
            <div className="approval-toast-details">
              {approvalPath ? (
                <div className="approval-toast-detail approval-toast-detail-spotlight">
                  <div className="approval-toast-detail-label">
                    {t("approval.filePathLabel")}
                  </div>
                  <div className="approval-toast-detail-value approval-toast-path-value">
                    <span className="codicon codicon-file approval-toast-inline-icon" aria-hidden />
                    <span>{approvalPath}</span>
                  </div>
                </div>
              ) : null}
              {commandInfo ? (
                <div className="approval-toast-detail approval-toast-detail-spotlight">
                  <div className="approval-toast-detail-label">
                    {t("approval.commandLabel")}
                  </div>
                  <div className="approval-toast-detail-value approval-toast-command-value">
                    <span className="codicon codicon-terminal approval-toast-inline-icon" aria-hidden />
                    <span>{commandInfo.preview}</span>
                  </div>
                </div>
              ) : null}
              {approvalMessage ? (
                <div className="approval-toast-detail approval-toast-note-block">
                  <div className="approval-toast-detail-label">{t("approval.noteLabel")}</div>
                  <div className="approval-toast-detail-value">{approvalMessage}</div>
                </div>
              ) : null}
              {entries.length ? (
                entries.map(([key, value]) => {
                  const rendered = renderParamValue(value);
                  return (
                    <div key={key} className="approval-toast-detail">
                      <div className="approval-toast-detail-label">
                        {formatLabel(key)}
                      </div>
                      {rendered.isCode ? (
                        <pre className="approval-toast-detail-code">
                          {rendered.text}
                        </pre>
                      ) : (
                        <div className="approval-toast-detail-value">
                          {rendered.text}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : !approvalPath && !commandInfo && !approvalMessage ? (
                <div className="approval-toast-detail approval-toast-detail-empty">
                  {t("approval.noExtraDetails")}
                </div>
              ) : null}
            </div>
            <div className="approval-toast-actions">
              <button
                className="secondary"
                onClick={() => onDecision(request, "decline")}
              >
                {t("approval.decline")}
              </button>
              {batchCount > 1 && onApproveBatch ? (
                <button
                  className="secondary"
                  onClick={() => onApproveBatch(batchEligibleApprovals)}
                >
                  {t("approval.approveTurnBatch", { count: batchCount })}
                </button>
              ) : null}
              {commandInfo && onRemember ? (
                <button
                  className="ghost approval-toast-remember"
                  onClick={() => onRemember(request, commandInfo.tokens)}
                  title={t("approval.allowCommandsStartWith", { prefix: commandInfo.preview })}
                >
                  {t("approval.alwaysAllow")}
                </button>
              ) : null}
              <button
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
