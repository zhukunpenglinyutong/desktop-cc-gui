import { Fragment, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { Button } from "@/components/base/buttons/button";
import type { DshHostStatus } from "@/lib/ipc";
import { openExternal } from "@/lib/platform";
import { cx } from "@/utils/cx";
import { CliUpdateDialog } from "./CliUpdateDialog";
import type { DshHostSectionState, HostState } from "./useDshHost";

const DOT_CLASS: Record<HostState, string> = {
  connected: "bg-notification-success-foreground",
  down: "bg-text-error-primary",
  checking: "bg-background-quaternary-default",
  starting: "bg-background-quaternary-default",
  missing: "bg-background-quaternary-default",
};

/** Provider/model/session facts, shown only while connected. */
function HostFacts({ describe, t }: { describe: DshHostStatus["describe"] | undefined; t: TFunction }) {
  const facts: ReactNode[] = [];
  if (describe?.provider) {
    facts.push(
      <Fragment key="provider">
        {t("settings.dshCurrentProvider")}{" "}
        <span className="text-text-primary">{describe.provider}</span>
      </Fragment>,
    );
  }
  if (describe?.model) {
    facts.push(
      <Fragment key="model">
        {t("settings.dshCurrentModel")}{" "}
        <span className="text-text-primary">{describe.model}</span>
      </Fragment>
    );
  }
  if (facts.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1 text-body-2-regular text-text-secondary">
      {facts.map((fact, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-text-tertiary">｜</span>}
          {fact}
        </Fragment>
      ))}
    </p>
  );
}

/** Action buttons per host state. */
function HostActions({
  dsh,
  statusTitle,
}: {
  dsh: DshHostSectionState;
  statusTitle: Record<HostState, string>;
}) {
  const { t, hostState, origin, actionBusy, updating, start, stop, refreshStatus, updateCli } = dsh;
  // 0.1.2 BrowserAuth gates the Web UI too: prefer the tokenized entry URL,
  // falling back to the bare origin when we hold no launch token.
  const uiUrl = dsh.status?.webUrl ?? origin;

  const openUi = (
    <Button size="small" variant="secondary" onClick={() => openExternal(uiUrl)}>
      {t("settings.dshOpenUi")}
    </Button>
  );
  const recheck = (
    <Button
      size="small"
      variant="secondary"
      disabled={actionBusy}
      onClick={() => void refreshStatus(true)}
    >
      {t("settings.dshRecheck")}
    </Button>
  );

  switch (hostState) {
    case "connected":
      return (
        <>
          <Button size="small" onClick={() => openExternal(uiUrl)}>
            {t("settings.dshOpenUi")}
          </Button>
          <Button size="small" variant="secondary" disabled={actionBusy} onClick={() => void stop()}>
            {t("settings.dshStopService")}
          </Button>
          {recheck}
        </>
      );
    case "down":
      return (
        <>
          <Button size="small" disabled={actionBusy} onClick={() => void start()}>
            {t("settings.dshStartNow")}
          </Button>
          {openUi}
          {recheck}
        </>
      );
    case "missing":
      return (
        <>
          <Button size="small" disabled={actionBusy} onClick={() => void updateCli()}>
            {updating ? t("settings.cliUpdating") : t("settings.cliInstall")}
          </Button>
          {recheck}
        </>
      );
    default:
      return (
        <Button size="small" disabled>
          {statusTitle[hostState]}
        </Button>
      );
  }
}

/**
 * Local host status card: state dot + title, connection facts when up,
 * hints when down/missing, and the per-state action buttons.
 */
export function DshHostStatusCard({ dsh }: { dsh: DshHostSectionState }) {
  const { t, status, hostState, origin } = dsh;
  const statusTitle: Record<HostState, string> = {
    checking: t("settings.dshChecking"),
    starting: t("settings.dshStarting"),
    missing: t("settings.dshNotInstalled"),
    connected: t("settings.dshHostConnected"),
    down: t("settings.dshHostDown"),
  };
  const describe = hostState === "connected" ? status?.describe : null;

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        aria-live="polite"
        className="flex w-full flex-col gap-3 rounded-2xl bg-background-secondary-default p-3"
      >
        <div className="flex items-center gap-2">
          <span aria-hidden className={cx("size-2 shrink-0 rounded-full", DOT_CLASS[hostState])} />
          <p className="text-body-medium text-text-primary">{statusTitle[hostState]}</p>
        </div>
        {hostState === "connected" && (
          <p className="text-body-2-regular text-text-secondary">
            {t("settings.dshConnectedOrigin", { origin })}
          </p>
        )}
        <HostFacts describe={describe} t={t} />
        {hostState === "down" && (
          <div className="flex flex-col gap-1">
            <p className="text-body-2-regular text-text-secondary">
              {t("settings.dshDownHint", { origin })}
            </p>
            {status?.error && (
              <p className="text-body-2-regular text-text-tertiary">{status.error}</p>
            )}
          </div>
        )}
        {hostState === "missing" && (
          <p className="text-body-2-regular text-text-secondary">{t("settings.dshMissingHint")}</p>
        )}
        <div className="flex items-center justify-end gap-2">
          <HostActions dsh={dsh} statusTitle={statusTitle} />
        </div>
      </div>
      <CliUpdateDialog engine="dsh" flow={dsh.updateFlow} />
    </div>
  );
}
