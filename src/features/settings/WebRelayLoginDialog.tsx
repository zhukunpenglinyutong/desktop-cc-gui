import { useState } from "react";
import { useTranslation } from "react-i18next";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { ModalShell } from "@/components/dialogs";
import type { WebRelayLoginFlow } from "./useWebRelayLogin";

const PROGRESS_KEYS = {
  preparing: "settings.webRelayLoginPreparing",
  authorizing: "settings.webRelayLoginAuthorizing",
  inspecting: "settings.webRelayLoginInspecting",
  deploying: "settings.webRelayLoginDeploying",
  cancelling: "settings.webRelayLoginCancelling",
} as const;

export function WebRelayLoginDialog({ flow }: { flow: WebRelayLoginFlow }) {
  const { t } = useTranslation();
  const [subdomain, setSubdomain] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const { state } = flow;
  if (state.status === "idle") return null;

  const cannotClose = state.status === "deploying" || state.status === "cancelling";
  const progressKey = state.status === "accounts" || state.status === "choices" || state.status === "error"
    ? null
    : PROGRESS_KEYS[state.status];
  const canDeploy = state.status === "choices"
    && Boolean(state.inspection.subdomain || subdomain.trim())
    && (!state.inspection.workerExists || overwrite);

  return (
    <ModalShell
      onClose={() => void flow.cancel()}
      label={t("settings.webRelayLoginDeploy")}
      className="max-h-[calc(100vh-48px)] w-[560px] max-w-[calc(100vw-32px)] overflow-y-auto p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-title-3-medium text-text-primary">{t("settings.webRelayLoginDeploy")}</h2>
        {!cannotClose && (
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => void flow.cancel()}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-line text-body-2-regular text-text-secondary">
        {t("settings.webRelayLoginHint")}
      </p>

      <div className="mt-5 flex flex-col gap-4">
        {progressKey && (
          <div role="status" className="flex items-center gap-2 text-body-2-regular text-text-primary">
            <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            {t(progressKey)}
          </div>
        )}
        {state.status === "deploying" && (
          <p className="text-body-2-regular text-text-secondary">{t("settings.webRelayLoginDeployingHint")}</p>
        )}
        {state.status === "accounts" && (
          <>
            <p className="text-body-2-medium text-text-primary">{t("settings.webRelayLoginChooseAccount")}</p>
            <div className="flex flex-col gap-2">
              {state.accounts.map((account) => (
                <Button
                  key={account.id}
                  size="small"
                  variant="secondary"
                  className="h-auto w-full justify-start py-2 text-left"
                  onClick={() => flow.chooseAccount(account.id)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="break-words">{account.name || account.id}</span>
                    <span className="break-all font-mono text-caption-1-regular text-text-tertiary">{account.id}</span>
                  </span>
                </Button>
              ))}
            </div>
          </>
        )}
        {state.status === "choices" && (
          <>
            <p className="break-words text-body-2-medium text-text-primary">
              {t("settings.webRelayLoginAccount", { account: state.inspection.accountName || state.inspection.accountId })}
            </p>
            {!state.inspection.subdomain && (
              <Input
                label={t("settings.webRelayLoginSubdomain")}
                hint={t("settings.webRelayLoginSubdomainHint")}
                placeholder={t("settings.webRelayLoginSubdomainPlaceholder")}
                size="small"
                value={subdomain}
                onChange={setSubdomain}
                isRequired
                autoComplete="off"
                autoFocus
              />
            )}
            {state.inspection.workerExists && (
              <div className="flex flex-col gap-3">
                <p className="text-body-2-regular text-text-error-primary">{t("settings.webRelayLoginExistingWorker")}</p>
                <Checkbox size="sm" isSelected={overwrite} onChange={setOverwrite}>
                  {t("settings.webRelayLoginOverwriteAck")}
                </Checkbox>
              </div>
            )}
          </>
        )}
        {state.status === "error" && (
          <p role="alert" className="whitespace-pre-wrap break-words text-body-2-regular text-text-error-primary">{state.error}</p>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button size="small" variant="secondary" disabled={cannotClose} onClick={() => void flow.cancel()}>
          {t(state.status === "error" ? "common.close" : "common.cancel")}
        </Button>
        {state.status === "choices" && (
          <Button size="small" disabled={!canDeploy} onClick={() => flow.confirm(subdomain, overwrite)}>
            {t("settings.webRelayLoginConfirm")}
          </Button>
        )}
      </div>
    </ModalShell>
  );
}
