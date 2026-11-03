import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { ModalShell } from "@/components/dialogs";
import type { CliUpdatePlan } from "@/lib/ipc";
import type { EngineId } from "./providers";
import type { CliUpdateFlow, CliUpdateFlowState } from "./useCliUpdateFlow";

/**
 * One-click CLI install/update dialog (CLI 一键安装): shows the exact
 * execution plan (将执行 + 手动命令) for confirmation, then streams the
 * installer output live while the run is active. All state lives in
 * useCliUpdateFlow; this component is pure rendering.
 *
 * While a run is active the dialog can't be dismissed (no X, Escape and
 * outside-press are swallowed by flow.close) — closing mid-run would
 * suggest the install stopped when it didn't.
 *
 * Official installer scripts (`plan.terminalCommand`) are not run by the
 * app: confirming types the line into the built-in terminal, after which the
 * dialog can close freely — the installer keeps running, visibly, in its tab.
 */
export function CliUpdateDialog({ engine, flow }: { engine: EngineId; flow: CliUpdateFlow }) {
  const { t } = useTranslation();
  const { state } = flow;

  if (state.status === "idle") return null;

  return (
    <ModalShell
      onClose={flow.close}
      className="max-h-[calc(100vh-48px)] w-[560px] max-w-[calc(100vw-32px)] overflow-y-auto p-6"
    >
      <DialogHeader running={state.status === "running"} onClose={flow.close} />
      <p className="mt-1.5 text-body-2-regular text-text-secondary">
        {t("settings.cliUpdateDialogDesc")}
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {state.status === "planning" && (
          <p className="text-body-2-regular text-text-secondary">
            {t("settings.cliUpdatePlanning")}
          </p>
        )}
        {state.plan && <PlanSummary engine={engine} plan={state.plan} />}
        <LiveLog state={state} />
        <StatusNotice state={state} />
      </div>

      <DialogFooter state={state} flow={flow} />
    </ModalShell>
  );
}

function DialogHeader({ running, onClose }: { running: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-4">
      <p className="text-title-3-medium text-text-primary">{t("settings.cliUpdateTitle")}</p>
      {!running && (
        <button
          type="button"
          aria-label={t("common.cancel")}
          onClick={onClose}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Engine/action/kind/platform pills plus blockers and the exact commands. */
function PlanSummary({ engine, plan }: { engine: EngineId; plan: CliUpdatePlan }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <PlanPill label={t("settings.cliUpdateEngine", { engine: t(`settings.engines.${engine}`) })} />
        <PlanPill
          label={
            plan.action === "update"
              ? t("settings.cliUpdateActionUpdate")
              : t("settings.cliUpdateActionInstall")
          }
        />
        <PlanPill label={t("settings.cliUpdateKind", { kind: plan.kind })} />
        <PlanPill label={t("settings.cliUpdatePlatform", { platform: plan.platform })} />
      </div>

      {plan.blockers.length > 0 && (
        <div className="flex flex-col gap-1">
          {plan.blockers.map((blocker) => (
            <p key={blocker} className="text-body-2-regular text-text-error-primary">
              {blocker}
            </p>
          ))}
        </div>
      )}

      {plan.terminalCommand ? (
        <>
          <p className="text-body-2-regular text-text-secondary">
            {t("settings.cliUpdateTerminalHint")}
          </p>
          <PlanCommand
            label={t("settings.cliUpdateTerminalCommand")}
            command={plan.terminalCommand}
          />
        </>
      ) : (
        plan.command.length > 0 && (
          <PlanCommand
            label={t("settings.cliUpdatePlanCommand")}
            command={plan.command.join(" ")}
          />
        )
      )}
      {plan.manualCommand && (
        <PlanCommand
          label={t("settings.cliUpdateManualCommand")}
          command={plan.manualCommand}
        />
      )}
    </>
  );
}

/** Live installer output, pinned to the newest line while it streams. */
function LiveLog({ state }: { state: CliUpdateFlowState }) {
  const { t } = useTranslation();
  const logRef = useRef<HTMLPreElement>(null);

  // Keep the log pinned to the newest line.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.logs]);

  // Terminal installs print in their terminal tab, not here.
  const showLog =
    !state.plan?.terminalCommand &&
    (state.status === "running" ||
      state.status === "done" ||
      (state.status === "error" && state.plan));
  if (!showLog) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-body-2-medium text-text-secondary">
        {t("settings.cliUpdateLiveLog")}
      </p>
      <pre
        ref={logRef}
        className="max-h-56 overflow-y-auto rounded-lg bg-background-secondary-default p-2 font-mono text-xs whitespace-pre-wrap break-all text-text-primary"
      >
        {state.logs.length > 0
          ? state.logs.map((line) => `[${line.stream}] ${line.text}`).join("\n")
          : t("settings.cliUpdateWaitingOutput")}
      </pre>
    </div>
  );
}

/** Terminal-state notice under the log: success line or the error message. */
function StatusNotice({ state }: { state: CliUpdateFlowState }) {
  const { t } = useTranslation();
  if (state.status === "done") {
    return (
      <p className="text-body-2-medium text-state-success-text">
        {t("settings.cliUpdateSucceeded")}
      </p>
    );
  }
  if (state.status === "terminal") {
    return (
      <p role="status" className="text-body-2-medium text-text-primary">
        {t("settings.cliUpdateInTerminal")}
      </p>
    );
  }
  if (state.status === "error" && state.notice) {
    return (
      <p role="alert" className="text-body-2-regular text-text-error-primary">
        {t(
          state.notice === "no-workspace"
            ? "settings.cliUpdateNoWorkspace"
            : "settings.cliUpdateTerminalUnavailable",
        )}
      </p>
    );
  }
  if (state.status === "error" && state.error) {
    return (
      <p role="alert" className="text-body-2-regular text-text-error-primary">
        {state.error}
      </p>
    );
  }
  return null;
}

function DialogFooter({ state, flow }: { state: CliUpdateFlowState; flow: CliUpdateFlow }) {
  const { t } = useTranslation();
  if (state.status === "running") {
    return (
      <div className="mt-5 flex justify-end gap-2">
        <Button size="small" disabled>
          {t("settings.cliUpdateRunning")}
        </Button>
      </div>
    );
  }
  if (state.status === "done") {
    return (
      <div className="mt-5 flex justify-end gap-2">
        <Button size="small" autoFocus onClick={flow.close}>
          {t("settings.cliUpdateClose")}
        </Button>
      </div>
    );
  }
  if (state.status === "terminal") {
    return (
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="small" onClick={flow.close}>
          {t("settings.cliUpdateClose")}
        </Button>
        <GoToTerminalButton onDone={flow.close} />
      </div>
    );
  }
  return (
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="secondary" size="small" onClick={flow.close}>
        {t("common.cancel")}
      </Button>
      <FooterPrimaryButton state={state} flow={flow} />
    </div>
  );
}

/** Retry after a failed run; otherwise confirm the planned command. */
function FooterPrimaryButton({
  state,
  flow,
}: {
  state: CliUpdateFlowState;
  flow: CliUpdateFlow;
}) {
  const { t } = useTranslation();
  const plan = state.plan;
  if (state.status === "error") {
    return (
      <Button
        size="small"
        autoFocus
        onClick={() => void (plan ? flow.confirm() : flow.begin())}
      >
        {t("settings.cliUpdateRetry")}
      </Button>
    );
  }
  return (
    <Button
      size="small"
      autoFocus
      disabled={state.status !== "ready" || !plan?.canRun}
      onClick={() => void flow.confirm()}
    >
      {plan?.terminalCommand
        ? t("settings.cliUpdateRunInTerminal")
        : t("settings.cliUpdateConfirm")}
    </Button>
  );
}

/** Leave Settings for the chat view, where the terminal dock running the
 * installer is visible. Its own component so the router hook is only used
 * once a terminal run exists. */
function GoToTerminalButton({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Button
      size="small"
      autoFocus
      onClick={() => {
        onDone();
        navigate("/");
      }}
    >
      {t("settings.cliUpdateGoToTerminal")}
    </Button>
  );
}

function PlanPill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-1-medium text-text-secondary">
      {label}
    </span>
  );
}

function PlanCommand({ label, command }: { label: string; command: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body-2-medium text-text-secondary">{label}</p>
      <pre className="rounded-lg bg-background-secondary-default p-2 font-mono text-xs whitespace-pre-wrap break-all text-text-primary">
        {command}
      </pre>
    </div>
  );
}
