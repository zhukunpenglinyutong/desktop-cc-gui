import { useEffect, useRef, useState } from "react";
import Stethoscope from "lucide-react/dist/esm/icons/stethoscope";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import type {
  AppSettings,
  CliInstallAction,
  CliInstallEngine,
  CliInstallPlan,
  CliInstallProgressEvent,
  CliInstallResult,
  CodexDoctorResult,
} from "@/types";
import { getCliInstallPlan, runCliInstaller } from "@/services/tauri";
import { subscribeCliInstallerEvents } from "@/services/events";
import { ComputerUseStatusCard } from "@/features/computer-use/components/ComputerUseStatusCard";
import { ENABLE_COMPUTER_USE_BRIDGE } from "@/features/computer-use/constants";

type DoctorState = {
  status: "idle" | "running" | "done" | "error";
  result: CodexDoctorResult | null;
  error?: string | null;
};

type CodexSectionProps = {
  active: boolean;
  t: (key: string) => string;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  claudePathDraft: string;
  setClaudePathDraft: (value: string) => void;
  claudeDirty: boolean;
  handleBrowseClaude: () => Promise<void>;
  handleSaveClaudeSettings: () => Promise<void>;
  handleRunClaudeDoctor: () => Promise<void>;
  claudeDoctorState: DoctorState;
  codexPathDraft: string;
  setCodexPathDraft: (value: string) => void;
  codexArgsDraft: string;
  setCodexArgsDraft: (value: string) => void;
  codexDirty: boolean;
  handleBrowseCodex: () => Promise<void>;
  handleSaveCodexSettings: () => Promise<void>;
  isSavingSettings: boolean;
  handleRunDoctor: () => Promise<void>;
  doctorState: DoctorState;
  remoteHostDraft: string;
  setRemoteHostDraft: (value: string) => void;
  remoteTokenDraft: string;
  setRemoteTokenDraft: (value: string) => void;
  handleCommitRemoteHost: () => Promise<void>;
  handleCommitRemoteToken: () => Promise<void>;
  onInstallerDoctorResult: (
    engine: CliInstallEngine,
    result: CodexDoctorResult | null,
  ) => void;
};

type InstallerState = {
  status: "idle" | "planning" | "ready" | "running" | "done" | "error";
  engine: CliInstallEngine | null;
  action: CliInstallAction | null;
  plan: CliInstallPlan | null;
  result: CliInstallResult | null;
  error: string | null;
  progressRunId: string | null;
  logLines: InstallerLogLine[];
  startedAtMs: number | null;
  lastEventAtMs: number | null;
};

type InstallerLogLine = {
  id: string;
  phase: CliInstallProgressEvent["phase"];
  stream: CliInstallProgressEvent["stream"];
  message: string;
  receivedAtMs: number;
};

const MAX_INSTALLER_LOG_LINES = 120;

type DoctorResultCardProps = {
  t: (key: string) => string;
  state: DoctorState;
  successTitleKey: string;
  errorTitleKey: string;
  showAppServer: boolean;
};

function DoctorResultCard({
  t,
  state,
  successTitleKey,
  errorTitleKey,
  showAppServer,
}: DoctorResultCardProps) {
  if (!state.result) {
    return null;
  }

  const debugEnvVars = state.result.debug?.envVars ?? {};
  const debugExtraSearchPaths = state.result.debug?.extraSearchPaths ?? [];
  const debugProxySnapshot = state.result.debug?.proxyEnvSnapshot ?? null;

  return (
    <div className={`settings-doctor ${state.result.ok ? "ok" : "error"}`}>
      <div className="settings-doctor-title">
        {state.result.ok ? t(successTitleKey) : t(errorTitleKey)}
      </div>
      <div className="settings-doctor-body">
        <div>
          {t("settings.versionLabel")}{" "}
          {state.result.version ?? t("git.unknown")}
        </div>
        {showAppServer ? (
          <div>
            {t("settings.appServerLabel")}{" "}
            {state.result.appServerOk
              ? t("settings.statusOk")
              : t("settings.statusFailed")}
          </div>
        ) : null}
        {state.result.appServerProbeStatus && showAppServer ? (
          <div>
            <strong>{t("settings.doctorAppServerProbe")}:</strong>{" "}
            {state.result.appServerProbeStatus}
          </div>
        ) : null}
        {state.result.resolvedBinaryPath ? (
          <div>
            <strong>{t("settings.doctorResolvedBinary")}:</strong>{" "}
            {state.result.resolvedBinaryPath}
          </div>
        ) : null}
        {state.result.wrapperKind ? (
          <div>
            <strong>{t("settings.doctorWrapperKind")}:</strong>{" "}
            {state.result.wrapperKind}
          </div>
        ) : null}
        {state.result.fallbackRetried ? (
          <div>
            <strong>{t("settings.doctorWrapperFallbackRetry")}:</strong>{" "}
            {t("settings.doctorAttempted")}
          </div>
        ) : null}
        {state.result.proxyEnvSnapshot &&
        Object.keys(state.result.proxyEnvSnapshot).length > 0 ? (
          <div>
            <strong>{t("settings.doctorProxyEnvironment")}:</strong>{" "}
            {Object.entries(state.result.proxyEnvSnapshot)
              .map(([key, value]) => `${key}=${value ?? t("settings.notSet")}`)
              .join(" · ")}
          </div>
        ) : null}
        <div>
          {t("settings.nodeLabel")}{" "}
          {state.result.nodeOk
            ? `${t("settings.statusOk")} (${state.result.nodeVersion ?? t("git.unknown")})`
            : t("settings.statusMissing")}
        </div>
        {state.result.details ? <div>{state.result.details}</div> : null}
        {state.result.nodeDetails ? (
          <div>{state.result.nodeDetails}</div>
        ) : null}
        {state.result.path ? (
          <div className="settings-doctor-path">
            {t("settings.pathLabel")} {state.result.path}
          </div>
        ) : null}
        {state.result.debug ? (
          <details className="settings-doctor-debug">
            <summary
              style={{
                cursor: "pointer",
                marginTop: "8px",
                fontWeight: "bold",
              }}
            >
              {t("settings.doctorDebugInfo")} (
              {t("settings.doctorClickToExpand")})
            </summary>
            <div
              style={{
                marginTop: "8px",
                fontSize: "12px",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              <div>
                <strong>{t("settings.doctorPlatform")}:</strong>{" "}
                {state.result.debug.platform} ({state.result.debug.arch})
              </div>
              <div>
                <strong>{t("settings.doctorResolvedBinary")}:</strong>{" "}
                {state.result.debug.resolvedBinaryPath ??
                  t("settings.notFound")}
              </div>
              <div>
                <strong>{t("settings.doctorWrapperKind")}:</strong>{" "}
                {state.result.debug.wrapperKind ?? t("settings.statusUnknown")}
              </div>
              <div>
                <strong>{t("settings.doctorPathUsed")}:</strong>{" "}
                {state.result.debug.pathEnvUsed ?? t("settings.notSet")}
              </div>
              <div>
                <strong>{t("settings.doctorClaudeFound")}:</strong>{" "}
                {state.result.debug.claudeFound ?? t("settings.notFound")}
              </div>
              <div>
                <strong>{t("settings.doctorCodexFound")}:</strong>{" "}
                {state.result.debug.codexFound ?? t("settings.notFound")}
              </div>
              <div>
                <strong>{t("settings.doctorClaudeStandardWhich")}:</strong>{" "}
                {state.result.debug.claudeStandardWhich ??
                  t("settings.notFound")}
              </div>
              <div>
                <strong>{t("settings.doctorCodexStandardWhich")}:</strong>{" "}
                {state.result.debug.codexStandardWhich ??
                  t("settings.notFound")}
              </div>
              {debugProxySnapshot ? (
                <>
                  <div style={{ marginTop: "8px" }}>
                    <strong>{t("settings.doctorProxyEnvironment")}:</strong>
                  </div>
                  {Object.entries(debugProxySnapshot).map(([key, value]) => (
                    <div key={key} style={{ marginLeft: "12px" }}>
                      <strong>{key}:</strong> {value ?? t("settings.notSet")}
                    </div>
                  ))}
                </>
              ) : null}
              <div style={{ marginTop: "8px" }}>
                <strong>{t("settings.doctorEnvironmentVariables")}:</strong>
              </div>
              {Object.entries(debugEnvVars).map(([key, value]) => (
                <div key={key} style={{ marginLeft: "12px" }}>
                  <strong>{key}:</strong> {value ?? t("settings.notSet")}
                </div>
              ))}
              <div style={{ marginTop: "8px" }}>
                <strong>{t("settings.doctorExtraSearchPaths")}:</strong>
              </div>
              {debugExtraSearchPaths.map((pathEntry, index) => (
                <div key={index} style={{ marginLeft: "12px" }}>
                  {pathEntry.path}{" "}
                  {pathEntry.exists
                    ? pathEntry.isDir
                      ? "✓"
                      : "✓ (file)"
                    : "✗"}{" "}
                  {pathEntry.hasCodexCmd ? (
                    <span style={{ color: "green" }}>
                      [{t("settings.doctorBinaryMarkerCodexCmd")}]
                    </span>
                  ) : null}
                  {pathEntry.hasClaudeCmd ? (
                    <span style={{ color: "green" }}>
                      [{t("settings.doctorBinaryMarkerClaudeCmd")}]
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function resolveInstallerAction(
  doctorResult: CodexDoctorResult | null,
): CliInstallAction {
  return doctorResult?.ok ? "updateLatest" : "installLatest";
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createInstallerRunId(engine: CliInstallEngine): string {
  return `${engine}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null) {
    return "-";
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${Math.round(durationMs / 100) / 10}s`;
}

function appendInstallerLog(
  lines: InstallerLogLine[],
  event: CliInstallProgressEvent,
): InstallerLogLine[] {
  if (!event.message && event.phase !== "finished") {
    return lines;
  }
  const message = event.message ?? `exitCode=${event.exitCode ?? "unknown"}`;
  const nextLine: InstallerLogLine = {
    id: `${event.runId}-${event.phase}-${Date.now()}-${lines.length}`,
    phase: event.phase,
    stream: event.stream,
    message,
    receivedAtMs: Date.now(),
  };
  return [...lines, nextLine].slice(-MAX_INSTALLER_LOG_LINES);
}

export function CodexSection({
  active,
  t,
  appSettings,
  onUpdateAppSettings,
  claudePathDraft,
  setClaudePathDraft,
  claudeDirty,
  handleBrowseClaude,
  handleSaveClaudeSettings,
  handleRunClaudeDoctor,
  claudeDoctorState,
  codexPathDraft,
  setCodexPathDraft,
  codexArgsDraft,
  setCodexArgsDraft,
  codexDirty,
  handleBrowseCodex,
  handleSaveCodexSettings,
  isSavingSettings,
  handleRunDoctor,
  doctorState,
  remoteHostDraft,
  setRemoteHostDraft,
  remoteTokenDraft,
  setRemoteTokenDraft,
  handleCommitRemoteHost,
  handleCommitRemoteToken,
  onInstallerDoctorResult,
}: CodexSectionProps) {
  const [activeTab, setActiveTab] = useState<
    "codex" | "claude" | "gemini" | "opencode"
  >("codex");
  const [installerState, setInstallerState] = useState<InstallerState>({
    status: "idle",
    engine: null,
    action: null,
    plan: null,
    result: null,
    error: null,
    progressRunId: null,
    logLines: [],
    startedAtMs: null,
    lastEventAtMs: null,
  });
  const [installerNowMs, setInstallerNowMs] = useState(() => Date.now());
  const installPlanRequestSeqRef = useRef(0);

  useEffect(() => {
    return subscribeCliInstallerEvents((event) => {
      setInstallerState((current) => {
        if (current.progressRunId !== event.runId) {
          return current;
        }
        return {
          ...current,
          logLines: appendInstallerLog(current.logLines, event),
          lastEventAtMs: Date.now(),
        };
      });
    });
  }, []);

  useEffect(() => {
    if (installerState.status !== "running") {
      return;
    }
    const interval = window.setInterval(() => {
      setInstallerNowMs(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [installerState.status]);

  const requestInstallPlan = async (
    engine: CliInstallEngine,
    doctorResult: CodexDoctorResult | null,
  ) => {
    const action = resolveInstallerAction(doctorResult);
    const requestSeq = installPlanRequestSeqRef.current + 1;
    installPlanRequestSeqRef.current = requestSeq;
    setInstallerState({
      status: "planning",
      engine,
      action,
      plan: null,
      result: null,
      error: null,
      progressRunId: null,
      logLines: [],
      startedAtMs: null,
      lastEventAtMs: null,
    });
    try {
      const plan = await getCliInstallPlan(engine, action, "npmGlobal");
      if (installPlanRequestSeqRef.current !== requestSeq) {
        return;
      }
      setInstallerState({
        status: "ready",
        engine,
        action,
        plan,
        result: null,
        error: null,
        progressRunId: null,
        logLines: [],
        startedAtMs: null,
        lastEventAtMs: null,
      });
    } catch (error) {
      if (installPlanRequestSeqRef.current !== requestSeq) {
        return;
      }
      setInstallerState({
        status: "error",
        engine,
        action,
        plan: null,
        result: null,
        error: normalizeErrorMessage(error),
        progressRunId: null,
        logLines: [],
        startedAtMs: null,
        lastEventAtMs: null,
      });
    }
  };

  const confirmInstallRun = async () => {
    const { engine, action, plan } = installerState;
    if (!engine || !action || !plan || !plan.canRun) {
      return;
    }
    const runId = createInstallerRunId(engine);
    const startedAtMs = Date.now();
    setInstallerNowMs(startedAtMs);
    setInstallerState((current) => ({
      ...current,
      status: "running",
      error: null,
      result: null,
      progressRunId: runId,
      logLines: [],
      startedAtMs,
      lastEventAtMs: startedAtMs,
    }));
    try {
      const result = await runCliInstaller(
        engine,
        action,
        plan.strategy,
        runId,
      );
      onInstallerDoctorResult(engine, result.doctorResult);
      setInstallerState((current) => ({
        ...current,
        status: "done",
        result,
        error: null,
      }));
    } catch (error) {
      setInstallerState((current) => ({
        ...current,
        status: "error",
        error: normalizeErrorMessage(error),
      }));
    }
  };

  if (!active) {
    return null;
  }

  return (
    <section className="settings-section w-full max-w-[980px]">
      <div className="settings-section-title text-[15px] font-semibold text-(--text-strong) mb-1">
        {t("settings.cliValidationTitle")}
      </div>
      <div className="settings-section-subtitle text-xs text-(--text-subtle) mb-4">
        {t("settings.cliValidationDescription")}
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          {t("settings.cliExecutionBackendTitle")}
        </div>
        <div className="settings-help">
          {t("settings.cliExecutionBackendDescription")}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="backend-mode">
          {t("settings.backendMode")}
        </label>
        <select
          id="backend-mode"
          className="settings-select"
          value={appSettings.backendMode}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              backendMode: event.target.value as AppSettings["backendMode"],
            })
          }
        >
          <option value="local">{t("settings.backendLocal")}</option>
          <option value="remote">{t("settings.backendRemote")}</option>
        </select>
        <div className="settings-help">{t("settings.backendRemoteDesc")}</div>
      </div>

      {appSettings.backendMode === "remote" ? (
        <div className="settings-field">
          <div className="settings-field-label">
            {t("settings.remoteBackend")}
          </div>
          <div className="settings-field-row">
            <input
              className="settings-input settings-input--compact"
              value={remoteHostDraft}
              placeholder="127.0.0.1:4732"
              onChange={(event) => setRemoteHostDraft(event.target.value)}
              onBlur={() => {
                void handleCommitRemoteHost();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCommitRemoteHost();
                }
              }}
              aria-label={t("settings.remoteBackendHostAriaLabel")}
            />
            <input
              type="password"
              className="settings-input settings-input--compact"
              value={remoteTokenDraft}
              placeholder={t("settings.remoteBackendToken")}
              onChange={(event) => setRemoteTokenDraft(event.target.value)}
              onBlur={() => {
                void handleCommitRemoteToken();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCommitRemoteToken();
                }
              }}
              aria-label={t("settings.remoteBackendTokenAriaLabel")}
            />
          </div>
          <div className="settings-help">{t("settings.remoteBackendDesc")}</div>
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value as "codex" | "claude" | "gemini" | "opencode")
        }
      >
        <TabsList>
          <TabsTab value="codex">{t("settings.cliValidationTabCodex")}</TabsTab>
          <TabsTab value="claude">
            {t("settings.cliValidationTabClaudeCode")}
          </TabsTab>
          <TabsTab value="gemini">
            {t("settings.cliValidationTabGeminiCli")}
          </TabsTab>
          <TabsTab value="opencode">
            {t("settings.cliValidationTabOpenCodeCli")}
          </TabsTab>
        </TabsList>

        <TabsPanel value="codex">
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="codex-path">
              {t("settings.defaultCodexPath")}
            </label>
            <div className="settings-field-row">
              <input
                id="codex-path"
                className="settings-input"
                value={codexPathDraft}
                placeholder={t("settings.codexPlaceholder")}
                onChange={(event) => setCodexPathDraft(event.target.value)}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => void handleBrowseCodex()}
              >
                {t("settings.browse")}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setCodexPathDraft("")}
              >
                {t("settings.usePath")}
              </button>
            </div>
            <div className="settings-help">
              {t("settings.pathResolutionDesc")}
            </div>

            <label className="settings-field-label" htmlFor="codex-args">
              {t("settings.defaultCodexArgs")}
            </label>
            <div className="settings-field-row">
              <input
                id="codex-args"
                className="settings-input"
                value={codexArgsDraft}
                placeholder={t("settings.codexArgsPlaceholder")}
                onChange={(event) => setCodexArgsDraft(event.target.value)}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => setCodexArgsDraft("")}
              >
                {t("settings.clear")}
              </button>
            </div>
            <div className="settings-help">
              {t("settings.codexArgsDesc")}{" "}
              <code>{t("settings.appServer")}</code>
              {t("settings.codexArgsDescSuffix")}
            </div>
            <div className="settings-field-actions">
              {codexDirty ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    void handleSaveCodexSettings();
                  }}
                  disabled={isSavingSettings}
                >
                  {isSavingSettings ? t("settings.saving") : t("common.save")}
                </button>
              ) : null}
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void handleRunDoctor();
                }}
                disabled={doctorState.status === "running"}
              >
                <Stethoscope aria-hidden />
                {doctorState.status === "running"
                  ? t("settings.running")
                  : t("settings.runDoctor")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void requestInstallPlan("codex", doctorState.result);
                }}
                disabled={
                  installerState.status === "planning" ||
                  installerState.status === "running"
                }
              >
                {resolveInstallerAction(doctorState.result) === "installLatest"
                  ? t("settings.cliInstallLatest")
                  : t("settings.cliUpdateLatest")}
              </button>
            </div>

            <DoctorResultCard
              t={t}
              state={doctorState}
              successTitleKey="settings.codexLooksGood"
              errorTitleKey="settings.codexIssueDetected"
              showAppServer
            />
          </div>

          {ENABLE_COMPUTER_USE_BRIDGE ? <ComputerUseStatusCard /> : null}
        </TabsPanel>

        <TabsPanel value="claude">
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="claude-path">
              {t("settings.defaultClaudePath")}
            </label>
            <div className="settings-field-row">
              <input
                id="claude-path"
                className="settings-input"
                value={claudePathDraft}
                placeholder={t("settings.claudePlaceholder")}
                onChange={(event) => setClaudePathDraft(event.target.value)}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => void handleBrowseClaude()}
              >
                {t("settings.browse")}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setClaudePathDraft("")}
              >
                {t("settings.usePath")}
              </button>
            </div>
            <div className="settings-help">
              {t("settings.pathResolutionDesc")}
            </div>
            <div className="settings-field-actions">
              {claudeDirty ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    void handleSaveClaudeSettings();
                  }}
                  disabled={isSavingSettings}
                >
                  {isSavingSettings ? t("settings.saving") : t("common.save")}
                </button>
              ) : null}
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void handleRunClaudeDoctor();
                }}
                disabled={claudeDoctorState.status === "running"}
              >
                <Stethoscope aria-hidden />
                {claudeDoctorState.status === "running"
                  ? t("settings.running")
                  : t("settings.runClaudeDoctor")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  void requestInstallPlan("claude", claudeDoctorState.result);
                }}
                disabled={
                  installerState.status === "planning" ||
                  installerState.status === "running"
                }
              >
                {resolveInstallerAction(claudeDoctorState.result) ===
                "installLatest"
                  ? t("settings.cliInstallLatest")
                  : t("settings.cliUpdateLatest")}
              </button>
            </div>

            <DoctorResultCard
              t={t}
              state={claudeDoctorState}
              successTitleKey="settings.claudeLooksGood"
              errorTitleKey="settings.claudeIssueDetected"
              showAppServer={false}
            />
          </div>
        </TabsPanel>

        <TabsPanel value="gemini">
          <div className="settings-toggle-row settings-cli-engine-toggle-row">
            <div className="settings-cli-engine-toggle-copy">
              <div className="settings-toggle-title settings-cli-engine-toggle-title">
                <span>{t("settings.cliValidationTabGeminiCli")}</span>
                <span className="settings-cli-engine-toggle-badge">
                  {t("settings.cliEngineEnabledLabel")}
                </span>
              </div>
              <div className="settings-toggle-subtitle">
                {t("settings.geminiCliDisableDescription")}
              </div>
            </div>
            <Switch
              aria-label={t("settings.cliValidationTabGeminiCli")}
              checked={appSettings.geminiEnabled !== false}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  geminiEnabled: checked,
                })
              }
            />
          </div>
        </TabsPanel>

        <TabsPanel value="opencode">
          <div className="settings-toggle-row settings-cli-engine-toggle-row">
            <div className="settings-cli-engine-toggle-copy">
              <div className="settings-toggle-title settings-cli-engine-toggle-title">
                <span>{t("settings.cliValidationTabOpenCodeCli")}</span>
                <span className="settings-cli-engine-toggle-badge">
                  {t("settings.cliEngineEnabledLabel")}
                </span>
              </div>
              <div className="settings-toggle-subtitle">
                {t("settings.openCodeCliDisableDescription")}
              </div>
            </div>
            <Switch
              aria-label={t("settings.cliValidationTabOpenCodeCli")}
              checked={appSettings.opencodeEnabled !== false}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  opencodeEnabled: checked,
                })
              }
            />
          </div>
        </TabsPanel>
      </Tabs>

      {installerState.status !== "idle" ? (
        <div className="settings-doctor">
          <div className="settings-doctor-title">
            {t("settings.cliInstallerTitle")}
          </div>
          <div className="settings-doctor-body">
            {installerState.status === "planning" ? (
              <div>{t("settings.cliInstallerPlanning")}</div>
            ) : null}
            {installerState.plan ? (
              <>
                <div>
                  <strong>{t("settings.cliInstallerEngine")}:</strong>{" "}
                  {installerState.plan.engine}
                </div>
                <div>
                  <strong>{t("settings.cliInstallerAction")}:</strong>{" "}
                  {installerState.plan.action}
                </div>
                <div>
                  <strong>{t("settings.cliInstallerBackend")}:</strong>{" "}
                  {installerState.plan.backend}
                </div>
                <div>
                  <strong>{t("settings.cliInstallerPlatform")}:</strong>{" "}
                  {installerState.plan.platform}
                </div>
                <div>
                  <strong>{t("settings.cliInstallerCommand")}:</strong>{" "}
                  <code>{installerState.plan.commandPreview.join(" ")}</code>
                </div>
                {installerState.plan.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
                {installerState.plan.blockers.map((blocker) => (
                  <div key={blocker}>{blocker}</div>
                ))}
                {installerState.plan.manualFallback ? (
                  <div>
                    <strong>{t("settings.cliInstallerManualFallback")}:</strong>{" "}
                    <code>{installerState.plan.manualFallback}</code>
                  </div>
                ) : null}
                <div className="settings-field-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      !installerState.plan.canRun ||
                      installerState.status === "running"
                    }
                    onClick={() => {
                      void confirmInstallRun();
                    }}
                  >
                    {installerState.status === "running"
                      ? t("settings.cliInstallerRunning")
                      : t("settings.cliInstallerConfirm")}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={installerState.status === "running"}
                    onClick={() => {
                      installPlanRequestSeqRef.current += 1;
                      setInstallerState({
                        status: "idle",
                        engine: null,
                        action: null,
                        plan: null,
                        result: null,
                        error: null,
                        progressRunId: null,
                        logLines: [],
                        startedAtMs: null,
                        lastEventAtMs: null,
                      });
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            ) : null}
            {installerState.status === "running" ||
            installerState.logLines.length > 0 ? (
              <div className="settings-installer-log">
                <div className="settings-installer-log-meta">
                  <span>{t("settings.cliInstallerLiveLog")}</span>
                  <span>
                    {t("settings.cliInstallerElapsed")}{" "}
                    {formatDurationMs(
                      installerState.startedAtMs
                        ? (installerState.status === "running"
                            ? installerNowMs
                            : (installerState.lastEventAtMs ??
                              installerNowMs)) - installerState.startedAtMs
                        : null,
                    )}
                  </span>
                </div>
                {installerState.logLines.length > 0 ? (
                  <pre className="settings-installer-log-output">
                    {installerState.logLines
                      .map((line) => {
                        const stream = line.stream
                          ? `${line.stream}`
                          : line.phase;
                        return `[${stream}] ${line.message}`;
                      })
                      .join("\n")}
                  </pre>
                ) : (
                  <div>{t("settings.cliInstallerWaitingForOutput")}</div>
                )}
              </div>
            ) : null}
            {installerState.result ? (
              <div
                className={
                  installerState.result.ok
                    ? "settings-doctor ok"
                    : "settings-doctor error"
                }
              >
                <div className="settings-doctor-title">
                  {installerState.result.ok
                    ? t("settings.cliInstallerSucceeded")
                    : t("settings.cliInstallerFailed")}
                </div>
                <div>
                  {t("settings.cliInstallerExitCode")}{" "}
                  {installerState.result.exitCode ??
                    t("settings.statusUnknown")}
                </div>
                {installerState.result.details ? (
                  <div>{installerState.result.details}</div>
                ) : null}
                {installerState.result.stdoutSummary ? (
                  <pre className="settings-doctor-path">
                    {installerState.result.stdoutSummary}
                  </pre>
                ) : null}
                {installerState.result.stderrSummary ? (
                  <pre className="settings-doctor-path">
                    {installerState.result.stderrSummary}
                  </pre>
                ) : null}
              </div>
            ) : null}
            {installerState.error ? (
              <div className="settings-doctor error">
                {installerState.error}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
