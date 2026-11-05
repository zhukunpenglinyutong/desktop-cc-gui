import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  ipc,
  type RelayDeployResult,
  type RelayLoginAccount,
  type RelayLoginInspection,
  type RelayLoginProgress,
} from "@/lib/ipc";
import { listen } from "@/lib/transport";

export type WebRelayLoginState =
  | { status: "idle" | "preparing" | "authorizing" | "inspecting" | "deploying" | "cancelling" }
  | { status: "accounts"; accounts: RelayLoginAccount[] }
  | { status: "choices"; inspection: RelayLoginInspection }
  | { status: "error"; error: string };

export interface WebRelayLoginFlow {
  state: WebRelayLoginState;
  begin: () => Promise<void>;
  chooseAccount: (accountId: string) => void;
  confirm: (subdomain: string, overwrite: boolean) => void;
  cancel: () => Promise<void>;
}

interface LoginRun {
  id: string;
  phase: Exclude<WebRelayLoginState["status"], "idle">;
  started: boolean;
  unlisten: UnlistenFn | null;
  cancellation: Promise<void> | null;
}

function stopListening(run: LoginRun) {
  run.unlisten?.();
  run.unlisten = null;
}

function cancelBackend(run: LoginRun): Promise<void> {
  if (!run.started) return Promise.resolve();
  run.cancellation ??= ipc.relayLoginCancel(run.id).finally(() => {
    run.cancellation = null;
  });
  return run.cancellation;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Only metadata and progress enter React; the isolated login stays in Rust. */
export function useWebRelayLogin(onDeployed: (result: RelayDeployResult) => void): WebRelayLoginFlow {
  const { t } = useTranslation();
  const [state, setState] = useState<WebRelayLoginState>({ status: "idle" });
  const runRef = useRef<LoginRun | null>(null);
  const mountedRef = useRef(true);
  const onDeployedRef = useRef(onDeployed);

  useEffect(() => {
    onDeployedRef.current = onDeployed;
  }, [onDeployed]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const run = runRef.current;
      runRef.current = null;
      if (!run) return;
      stopListening(run);
      // Deployment owns persistence and cleanup once it starts. Leaving the
      // page must not interrupt a Worker upload or lose its newly generated key.
      if (run.phase !== "deploying") void cancelBackend(run).catch(() => {});
    };
  }, []);

  const isCurrent = useCallback((run: LoginRun) =>
    mountedRef.current && runRef.current === run, []);
  const isActive = useCallback((run: LoginRun) =>
    isCurrent(run) && run.phase !== "cancelling" && run.phase !== "error", [isCurrent]);

  const fail = useCallback(async (run: LoginRun, error: unknown) => {
    if (!isActive(run)) return;
    run.phase = "cancelling";
    stopListening(run);
    setState({ status: "cancelling" });
    let message = errorMessage(error);
    let cleaned = false;
    try {
      await cancelBackend(run);
      cleaned = true;
    } catch (cleanupError) {
      message += `\n${errorMessage(cleanupError)}`;
    }
    if (!isCurrent(run)) return;
    run.phase = "error";
    if (cleaned) runRef.current = null;
    setState({ status: "error", error: message });
  }, [isActive, isCurrent]);

  const deploy = useCallback(async (
    run: LoginRun,
    inspection: RelayLoginInspection,
    subdomain: string | null,
    overwrite: boolean,
  ) => {
    if (!isActive(run)) return;
    // Guard synchronously, before IPC or React commits, against double clicks.
    run.phase = "deploying";
    setState({ status: "deploying" });
    try {
      const result = await ipc.relayLoginDeploy(run.id, inspection.accountId, subdomain, overwrite);
      if (!isActive(run)) return;
      stopListening(run);
      runRef.current = null;
      // A partial failure still carries the uploaded key. Reconcile the fields
      // before showing the error, never leave an obsolete key ready to reconnect.
      onDeployedRef.current(result);
      setState(result.error ? { status: "error", error: result.error } : { status: "idle" });
    } catch (error) {
      await fail(run, error);
    }
  }, [fail, isActive]);

  const inspectAccount = useCallback(async (run: LoginRun, accountId: string) => {
    if (!isActive(run)) return;
    run.phase = "inspecting";
    setState({ status: "inspecting" });
    try {
      const inspection = await ipc.relayLoginInspect(run.id, accountId);
      if (!isActive(run)) return;
      if (!inspection.subdomain || inspection.workerExists) {
        run.phase = "choices";
        setState({ status: "choices", inspection });
      } else {
        await deploy(run, inspection, null, false);
      }
    } catch (error) {
      await fail(run, error);
    }
  }, [deploy, fail, isActive]);

  const begin = useCallback(async () => {
    if (runRef.current || !mountedRef.current) return;
    const run: LoginRun = {
      id: crypto.randomUUID(),
      phase: "preparing",
      started: false,
      unlisten: null,
      cancellation: null,
    };
    runRef.current = run;
    setState({ status: "preparing" });
    try {
      // Await registration: even the first preparation event belongs to this run.
      const unlisten = await listen<RelayLoginProgress>("relay://login-progress", ({ payload }) => {
        if (!isActive(run) || payload.runId !== run.id) return;
        if (run.phase !== "preparing" && run.phase !== "authorizing") return;
        if (payload.stage === "deploying") return;
        if (run.phase === "authorizing" && payload.stage === "preparing") return;
        run.phase = payload.stage;
        setState({ status: payload.stage });
      });
      if (!isActive(run)) {
        unlisten();
        return;
      }
      run.unlisten = unlisten;
      run.started = true;
      const accounts = await ipc.relayLoginStart(run.id);
      if (!isActive(run)) return;
      if (accounts.length === 0) throw new Error(t("settings.webRelayLoginNoAccounts"));
      if (accounts.length === 1) {
        await inspectAccount(run, accounts[0].id);
      } else {
        run.phase = "accounts";
        setState({ status: "accounts", accounts });
      }
    } catch (error) {
      await fail(run, error);
    }
  }, [fail, inspectAccount, isActive, t]);

  const chooseAccount = useCallback((accountId: string) => {
    const run = runRef.current;
    if (!run || run.phase !== "accounts" || state.status !== "accounts") return;
    if (!state.accounts.some((account) => account.id === accountId)) return;
    void inspectAccount(run, accountId);
  }, [inspectAccount, state]);

  const confirm = useCallback((subdomain: string, overwrite: boolean) => {
    const run = runRef.current;
    if (!run || run.phase !== "choices" || state.status !== "choices") return;
    const { inspection } = state;
    if (!inspection.subdomain && !subdomain.trim()) return;
    if (inspection.workerExists && !overwrite) return;
    void deploy(run, inspection, inspection.subdomain ? null : subdomain.trim(), inspection.workerExists && overwrite);
  }, [deploy, state]);

  const cancel = useCallback(async () => {
    const run = runRef.current;
    if (!run) {
      if (mountedRef.current) setState({ status: "idle" });
      return;
    }
    if (run.phase === "deploying" || run.phase === "cancelling") return;
    run.phase = "cancelling";
    stopListening(run);
    setState({ status: "cancelling" });
    try {
      await cancelBackend(run);
      if (!isCurrent(run)) return;
      runRef.current = null;
      setState({ status: "idle" });
    } catch (error) {
      if (!isCurrent(run)) return;
      run.phase = "error";
      setState({ status: "error", error: errorMessage(error) });
    }
  }, [isCurrent]);

  return { state, begin, chooseAccount, confirm, cancel };
}
