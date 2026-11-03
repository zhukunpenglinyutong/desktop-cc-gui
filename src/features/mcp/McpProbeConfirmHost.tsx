import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/dialogs";
import {
  answerProbeConfirm,
  currentProbeConfirm,
  subscribeProbeConfirm,
} from "./probe-confirm";
import type { McpProbePlan } from "./types";

/** Show an argument the way a shell would need it: quoted when it has
 *  whitespace or quotes, so the line reads as one unambiguous command. */
function displayArg(arg: string): string {
  return /[\s"'\\]/.test(arg) || arg === "" ? JSON.stringify(arg) : arg;
}

function PlanDetails({ plan }: { plan: McpProbePlan }) {
  const { t } = useTranslation();
  const rows: Array<[string, string]> = [];
  if (plan.command) {
    rows.push([
      t("mcp.probe.confirmCommand"),
      [plan.command, ...plan.args].map(displayArg).join(" "),
    ]);
  }
  if (plan.cwd) rows.push([t("mcp.probe.confirmCwd"), plan.cwd]);
  if (plan.envKeys.length > 0) rows.push([t("mcp.probe.confirmEnv"), plan.envKeys.join(", ")]);
  if (plan.url) rows.push([t("mcp.probe.confirmUrl"), plan.url]);
  if (plan.headerKeys.length > 0) {
    rows.push([t("mcp.probe.confirmHeaders"), plan.headerKeys.join(", ")]);
  }
  return (
    <dl className="mt-1 flex flex-col gap-0.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="shrink-0 text-text-tertiary">{label}</dt>
          <dd className="min-w-0 break-all font-mono text-text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Confirmation before probing MCP servers whose config came with the
 * workspace (probe-confirm.ts). Lists the exact command / address of each so
 * the user sees what would run. Mounted once at the app root. Opens without
 * focusing "运行检测": running repo-supplied commands takes a deliberate click.
 */
export function McpProbeConfirmHost() {
  const { t } = useTranslation();
  const request = useSyncExternalStore(subscribeProbeConfirm, currentProbeConfirm);
  if (!request) return null;
  return (
    <ConfirmDialog
      message={t("mcp.probe.confirmTitle")}
      confirmLabel={t("mcp.probe.confirmRun")}
      initialFocus="none"
      onConfirm={() => answerProbeConfirm(true)}
      onCancel={() => answerProbeConfirm(false)}
    >
      <p className="mt-2 text-body-2-regular text-text-secondary">
        {t("mcp.probe.confirmDetail")}
      </p>
      <ul className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
        {request.items.map(({ entry, plan }) => (
          <li
            key={entry.id}
            className="rounded-lg bg-background-secondary-default px-3 py-2 text-body-2-regular"
          >
            <span className="font-medium text-text-primary">{entry.name}</span>
            <span className="block break-all text-text-tertiary">{entry.path}</span>
            {plan ? (
              <PlanDetails plan={plan} />
            ) : (
              <p className="mt-1 text-text-secondary">{t("mcp.probe.confirmUnavailable")}</p>
            )}
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}
