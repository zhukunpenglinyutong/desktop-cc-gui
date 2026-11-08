import { useTranslation } from "react-i18next";
import type { QuestionSpec } from "@/lib/ipc";

type Approval = NonNullable<QuestionSpec["approval"]>;

export function approvalTitle(approval: Approval) {
  return `chat.codexApproval.${approval.kind}` as const;
}

export function approvalChoice(approval: Approval, label: string) {
  if (label === "Allow once") {
    return approval.kind === "permissions"
      ? "chat.codexApproval.allowTurn"
      : "chat.codexApproval.allow";
  }
  if (label === "Reject") return "chat.codexApproval.reject";
}

export function CodexApprovalDetails({ approval }: { approval: Approval }) {
  const { t } = useTranslation();
  const rows: { label: string; value: string; command: boolean }[] = [];
  const walk = (value: unknown, keys: string[]) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, keys));
    } else if (typeof value === "object" && Object.keys(value).length) {
      Object.entries(value).forEach(([key, child]) => walk(child, [...keys, key]));
    } else {
      rows.push({
        label: keys.map((key) => t(`chat.codexApproval.fields.${key}`, { defaultValue: key })).join(" / "),
        value: typeof value === "boolean"
          ? t(value ? "chat.codexApproval.yes" : "chat.codexApproval.no")
          : typeof value === "object" ? t("chat.codexApproval.none") : String(value),
        command: keys[0] === "command",
      });
    }
  };
  walk(approval.details, []);
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-border-component-detail-container bg-background-secondary-default p-3">
      <dl className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={index} className="min-w-0">
            <dt className="text-caption-1-regular text-text-tertiary">{row.label}</dt>
            <dd className={`mt-1 whitespace-pre-wrap break-words text-caption-1-regular text-text-primary ${row.command ? "font-mono" : ""}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {approval.kind === "permissions" && (
        <p className="mt-3 text-caption-1-regular text-text-secondary">{t("chat.codexApproval.turnScope")}</p>
      )}
    </div>
  );
}
