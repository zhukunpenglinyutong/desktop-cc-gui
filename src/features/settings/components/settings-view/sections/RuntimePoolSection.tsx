import { useCallback, useEffect, useMemo, useState } from "react";
import Activity from "lucide-react/dist/esm/icons/activity";
import BadgeCheck from "lucide-react/dist/esm/icons/badge-check";
import Clock3 from "lucide-react/dist/esm/icons/clock-3";
import Flame from "lucide-react/dist/esm/icons/flame";
import Pin from "lucide-react/dist/esm/icons/pin";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Snowflake from "lucide-react/dist/esm/icons/snowflake";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import type { AppSettings, RuntimePoolSnapshot, WorkspaceInfo } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  connectWorkspace,
  getRuntimePoolSnapshot,
  mutateRuntimePool,
} from "../../../../../services/tauri";
import { normalizeBoundedIntegerInput } from "./runtimePoolSection.utils";

const RUNTIME_PANEL_BOOTSTRAP_SOURCE = "runtime-panel-bootstrap";
const RUNTIME_POOL_FALLBACK_REFRESH_DELAY_MS = 400;
const RUNTIME_POOL_FALLBACK_REFRESH_ATTEMPTS = 5;
const EMPTY_RUNTIME_WORKSPACES: WorkspaceInfo[] = [];

type RuntimeLoadPhase =
  | "idle"
  | "snapshot-loading"
  | "bootstrapping"
  | "fallback-refreshing"
  | "ready"
  | "error";

type RuntimeBootstrapWorkspace = {
  id: string;
};

type RuntimePoolSectionProps = {
  t: (key: string, options?: Record<string, unknown>) => string;
  appSettings: AppSettings;
  workspaces?: WorkspaceInfo[];
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

function formatTimestamp(value?: number | null) {
  if (!value) {
    return "—";
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

function getRuntimeTone(state: string) {
  switch (state.toLowerCase()) {
    case "streaming":
      return {
        icon: Activity,
        chip:
          "border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/12 dark:text-emerald-200",
      };
    case "startup-pending":
    case "resume-pending":
      return {
        icon: Sparkles,
        chip:
          "border-blue-300/60 bg-blue-500/10 text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/12 dark:text-blue-200",
      };
    case "acquired":
      return {
        icon: Flame,
        chip:
          "border-orange-300/60 bg-orange-500/10 text-orange-700 dark:border-orange-400/20 dark:bg-orange-500/12 dark:text-orange-200",
      };
    case "graceful-idle":
      return {
        icon: Snowflake,
        chip:
          "border-sky-300/60 bg-sky-500/10 text-sky-700 dark:border-sky-400/20 dark:bg-sky-500/12 dark:text-sky-200",
      };
    case "evictable":
      return {
        icon: Clock3,
        chip:
          "border-amber-300/60 bg-amber-500/10 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/12 dark:text-amber-200",
      };
    case "failed":
    case "zombie-suspected":
    case "zombiesuspected":
      return {
        icon: TriangleAlert,
        chip:
          "border-red-300/60 bg-red-500/10 text-red-700 dark:border-red-400/20 dark:bg-red-500/12 dark:text-red-200",
      };
    default:
      return {
        icon: SquareTerminal,
        chip:
          "border-slate-300/60 bg-slate-500/10 text-slate-700 dark:border-slate-400/20 dark:bg-slate-500/12 dark:text-slate-200",
      };
  }
}

function getRuntimeStateLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  state: string,
) {
  switch (state.toLowerCase()) {
    case "starting":
      return t("settings.runtimeStateStarting");
    case "startup-pending":
      return t("settings.runtimeStateStartupPending");
    case "resume-pending":
      return t("settings.runtimeStateResumePending");
    case "acquired":
      return t("settings.runtimeStateAcquired");
    case "streaming":
      return t("settings.runtimeStateStreaming");
    case "graceful-idle":
      return t("settings.runtimeStateGracefulIdle");
    case "evictable":
      return t("settings.runtimeStateEvictable");
    case "stopping":
      return t("settings.runtimeStateStopping");
    case "failed":
      return t("settings.runtimeStateFailed");
    case "zombie-suspected":
      return t("settings.runtimeStateZombieSuspected");
    default:
      return state;
  }
}

function getActiveWorkLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  reason?: string | null,
) {
  switch ((reason ?? "").toLowerCase()) {
    case "silent-busy":
      return t("settings.runtimeProtectionSilentBusy");
    case "startup-pending":
      return t("settings.runtimeProtectionStartupPending");
    case "resume-pending":
      return t("settings.runtimeProtectionResumePending");
    case "turn":
      return t("settings.runtimeProtectionTurn");
    case "stream":
      return t("settings.runtimeProtectionStream");
    case "turn+stream":
      return t("settings.runtimeProtectionTurnStream");
    default:
      return t("settings.runtimeActiveWorkProtected");
  }
}

function getRuntimeStartupStateLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  state?: string | null,
) {
  switch ((state ?? "").toLowerCase()) {
    case "starting":
      return t("settings.runtimeStateStarting");
    case "ready":
      return t("settings.runtimeStartupStateReady");
    case "suspect-stale":
      return t("settings.runtimeStartupStateSuspectStale");
    case "cooldown":
      return t("settings.runtimeStartupStateCooldown");
    case "quarantined":
      return t("settings.runtimeStartupStateQuarantined");
    default:
      return state ?? "—";
  }
}

function buildRuntimeBootstrapWorkspaces(
  workspaces: WorkspaceInfo[],
): RuntimeBootstrapWorkspace[] {
  const seenWorkspaceIds = new Set<string>();
  const eligibleWorkspaces: RuntimeBootstrapWorkspace[] = [];
  for (const workspace of workspaces) {
    const workspaceId = workspace.id.trim();
    if (!workspace.connected || workspaceId.length === 0 || seenWorkspaceIds.has(workspaceId)) {
      continue;
    }
    seenWorkspaceIds.add(workspaceId);
    eligibleWorkspaces.push({ id: workspaceId });
  }
  return eligibleWorkspaces;
}

export function RuntimePoolSection({
  t,
  appSettings,
  workspaces = EMPTY_RUNTIME_WORKSPACES,
  onUpdateAppSettings,
}: RuntimePoolSectionProps) {
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<RuntimePoolSnapshot | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeLoadPhase, setRuntimeLoadPhase] = useState<RuntimeLoadPhase>("idle");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [hotDraft, setHotDraft] = useState(String(appSettings.codexMaxHotRuntimes ?? 1));
  const [warmDraft, setWarmDraft] = useState(String(appSettings.codexMaxWarmRuntimes ?? 1));
  const [ttlDraft, setTtlDraft] = useState(String(appSettings.codexWarmTtlSeconds ?? 7200));

  const bootstrapEligibleWorkspaces = useMemo(
    () => buildRuntimeBootstrapWorkspaces(workspaces),
    [workspaces],
  );

  useEffect(() => {
    setHotDraft(String(appSettings.codexMaxHotRuntimes ?? 1));
    setWarmDraft(String(appSettings.codexMaxWarmRuntimes ?? 1));
    setTtlDraft(String(appSettings.codexWarmTtlSeconds ?? 7200));
  }, [
    appSettings.codexMaxHotRuntimes,
    appSettings.codexMaxWarmRuntimes,
    appSettings.codexWarmTtlSeconds,
  ]);

  const loadSnapshot = useCallback(async () => {
    setRuntimeLoading(true);
    setRuntimeLoadPhase("snapshot-loading");
    setRuntimeError(null);
    try {
      setRuntimeSnapshot(await getRuntimePoolSnapshot());
      setRuntimeLoadPhase("ready");
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
      setRuntimeLoadPhase("error");
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pendingTimers: Array<ReturnType<typeof setTimeout>> = [];

    const waitForFallbackRefresh = () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          const timerIndex = pendingTimers.indexOf(timer);
          if (timerIndex >= 0) {
            pendingTimers.splice(timerIndex, 1);
          }
          resolve();
        }, RUNTIME_POOL_FALLBACK_REFRESH_DELAY_MS);
        pendingTimers.push(timer);
      });

    const setSnapshotIfCurrent = (snapshot: RuntimePoolSnapshot) => {
      if (!cancelled) {
        setRuntimeSnapshot(snapshot);
      }
    };

    void (async () => {
      setRuntimeLoading(true);
      setRuntimeLoadPhase("snapshot-loading");
      setRuntimeError(null);
      try {
        const initialSnapshot = await getRuntimePoolSnapshot();
        if (cancelled) {
          return;
        }
        setSnapshotIfCurrent(initialSnapshot);
        if (initialSnapshot.rows.length > 0) {
          setRuntimeLoadPhase("ready");
          return;
        }

        if (bootstrapEligibleWorkspaces.length === 0) {
          setRuntimeLoadPhase("ready");
          return;
        }

        setRuntimeLoadPhase("bootstrapping");
        let bootstrapError: string | null = null;
        for (const workspace of bootstrapEligibleWorkspaces) {
          if (cancelled) {
            return;
          }
          try {
            await connectWorkspace(workspace.id, RUNTIME_PANEL_BOOTSTRAP_SOURCE);
          } catch (error) {
            bootstrapError ??= error instanceof Error ? error.message : String(error);
          }
        }
        if (cancelled) {
          return;
        }
        if (bootstrapError) {
          setRuntimeError(bootstrapError);
        }

        setRuntimeLoadPhase("snapshot-loading");
        const bootstrappedSnapshot = await getRuntimePoolSnapshot();
        if (cancelled) {
          return;
        }
        setSnapshotIfCurrent(bootstrappedSnapshot);
        if (bootstrappedSnapshot.rows.length > 0) {
          setRuntimeLoadPhase("ready");
          return;
        }

        setRuntimeLoadPhase("fallback-refreshing");
        for (let attempt = 0; attempt < RUNTIME_POOL_FALLBACK_REFRESH_ATTEMPTS; attempt += 1) {
          await waitForFallbackRefresh();
          if (cancelled) {
            return;
          }
          const fallbackSnapshot = await getRuntimePoolSnapshot();
          if (cancelled) {
            return;
          }
          setSnapshotIfCurrent(fallbackSnapshot);
          if (fallbackSnapshot.rows.length > 0) {
            break;
          }
        }
        setRuntimeLoadPhase("ready");
      } catch (error) {
        if (!cancelled) {
          setRuntimeError(error instanceof Error ? error.message : String(error));
          setRuntimeLoadPhase("error");
        }
      } finally {
        if (!cancelled) {
          setRuntimeLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      pendingTimers.forEach((timer) => clearTimeout(timer));
      pendingTimers.length = 0;
    };
  }, [bootstrapEligibleWorkspaces]);

  const isRuntimeTransientEmpty =
    runtimeLoading &&
    runtimeLoadPhase !== "ready" &&
    (runtimeSnapshot?.rows.length ?? 0) === 0;

  const summaryCards = useMemo(() => {
    const summary = isRuntimeTransientEmpty ? null : runtimeSnapshot?.summary;
    const emptyValue = isRuntimeTransientEmpty ? "—" : 0;
    return [
      {
        key: "total",
        icon: SquareTerminal,
        value: summary?.totalRuntimes ?? emptyValue,
        label: t("settings.runtimeMetricTotal"),
        accent: "from-slate-500/15 to-slate-400/5",
      },
      {
        key: "acquired",
        icon: Flame,
        value: summary?.acquiredRuntimes ?? emptyValue,
        label: t("settings.runtimeMetricAcquired"),
        accent: "from-orange-500/15 to-orange-400/5",
      },
      {
        key: "streaming",
        icon: Activity,
        value: summary?.streamingRuntimes ?? emptyValue,
        label: t("settings.runtimeMetricStreaming"),
        accent: "from-emerald-500/15 to-emerald-400/5",
      },
      {
        key: "activeProtected",
        icon: BadgeCheck,
        value: summary?.activeWorkProtectedRuntimes ?? emptyValue,
        label: t("settings.runtimeMetricActiveProtected"),
        accent: "from-blue-500/15 to-blue-400/5",
      },
      {
        key: "idle",
        icon: Snowflake,
        value: summary?.gracefulIdleRuntimes ?? emptyValue,
        label: t("settings.runtimeMetricIdle"),
        accent: "from-sky-500/15 to-sky-400/5",
      },
      {
        key: "evictable",
        icon: Clock3,
        value: summary?.evictableRuntimes ?? emptyValue,
        label: t("settings.runtimeMetricEvictable"),
        accent: "from-amber-500/15 to-amber-400/5",
      },
      {
        key: "pinned",
        icon: Pin,
        value: summary?.pinnedRuntimes ?? emptyValue,
        label: t("settings.runtimeMetricPinned"),
        accent: "from-violet-500/15 to-violet-400/5",
      },
    ];
  }, [isRuntimeTransientEmpty, runtimeSnapshot?.summary, t]);

  const engineObservabilityCards = useMemo(() => {
    const backendCards = runtimeSnapshot?.engineObservability;
    if (backendCards?.length) {
      return backendCards.map((item) => ({
        ...item,
        label:
          item.engine.trim().toLowerCase() === "claude"
            ? t("settings.runtimeEngineClaude")
            : t("settings.runtimeEngineCodex"),
      }));
    }
    const rows = runtimeSnapshot?.rows ?? [];
    return [
      { engine: "codex", label: t("settings.runtimeEngineCodex") },
      { engine: "claude", label: t("settings.runtimeEngineClaude") },
    ].map((item) => {
      const engineRows = rows.filter(
        (row) => row.engine.trim().toLowerCase() === item.engine,
      );
      const sessionCount = engineRows.length;
      const rootProcessCount = engineRows.reduce(
        (sum, row) =>
          sum +
          (row.processDiagnostics?.rootProcesses ??
            (row.pid !== null ? 1 : 0)),
        0,
      );
      const totalProcessCount = engineRows.reduce((sum, row) => {
        if (row.processDiagnostics?.totalProcesses) {
          return sum + row.processDiagnostics.totalProcesses;
        }
        return sum + (row.pid ? 1 : 0);
      }, 0);
      const nodeProcessCount = engineRows.reduce(
        (sum, row) => sum + (row.processDiagnostics?.nodeProcesses ?? 0),
        0,
      );
      return {
        ...item,
        sessionCount,
        trackedRootProcesses: rootProcessCount,
        trackedTotalProcesses: totalProcessCount,
        trackedNodeProcesses: nodeProcessCount,
        hostManagedRootProcesses: rootProcessCount,
        hostUnmanagedRootProcesses: 0,
        externalRootProcesses: 0,
        hostUnmanagedTotalProcesses: 0,
        externalTotalProcesses: 0,
      };
    });
  }, [runtimeSnapshot?.engineObservability, runtimeSnapshot?.rows, t]);

  const handleRuntimeMutation = async (
    action: "close" | "releaseToCold" | "pin",
    workspaceId: string,
    engine?: string,
    pinned?: boolean,
  ) => {
    setRuntimeSaving(true);
    setRuntimeError(null);
    try {
      const snapshot = await mutateRuntimePool({ action, workspaceId, engine, pinned });
      setRuntimeSnapshot(snapshot);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeSaving(false);
    }
  };

  const handleSaveRuntimeSettings = async () => {
    const nextHot = normalizeBoundedIntegerInput(hotDraft, 1, 0, 8);
    const nextWarm = normalizeBoundedIntegerInput(warmDraft, 1, 0, 16);
    const nextTtl = normalizeBoundedIntegerInput(ttlDraft, 7200, 15, 14400);
    setRuntimeSaving(true);
    setRuntimeError(null);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        codexMaxHotRuntimes: nextHot,
        codexMaxWarmRuntimes: nextWarm,
        codexWarmTtlSeconds: nextTtl,
      });
      setHotDraft(String(nextHot));
      setWarmDraft(String(nextWarm));
      setTtlDraft(String(nextTtl));
      await loadSnapshot();
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeSaving(false);
    }
  };

  return (
    <section className="settings-section w-full max-w-[980px]">
      <div className="settings-section-title text-[15px] font-semibold text-(--text-strong) mb-1">{t("settings.runtimePanelTitle")}</div>
      <div className="settings-section-subtitle text-xs text-(--text-subtle) mb-4">
        {t("settings.runtimePanelDescription")}
      </div>

      <Card className="border-slate-200/80 bg-white/95 shadow-sm dark:border-slate-800/90 dark:bg-slate-950/95 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <CardHeader className="gap-3 px-4 py-4 md:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-100">
                  <SquareTerminal size={16} />
                </div>
                <CardTitle className="text-[1rem] leading-none text-slate-900 dark:text-slate-50">
                  {t("settings.runtimePoolTitle")}
                </CardTitle>
              </div>
              <CardDescription className="max-w-3xl pl-11 text-[12px] leading-5 text-slate-500 dark:text-slate-400/90">
                {t("settings.runtimePoolDescription")}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void loadSnapshot();
              }}
              disabled={runtimeLoading}
              className="h-7.5 shrink-0 rounded-full px-3 text-[12px] dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 md:px-5">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
            {summaryCards.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.key}
                  className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/85 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.035]"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {item.label}
                    </div>
                    <div className="mt-1 text-[1.15rem] font-semibold leading-none text-slate-900 dark:text-slate-50">
                      {item.value}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-slate-200/80 bg-white/95 shadow-sm dark:border-slate-800/90 dark:bg-slate-950/95 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <CardHeader className="space-y-1 px-4 py-4 md:px-5">
            <CardTitle className="text-[15px] dark:text-slate-50">
              {t("settings.runtimeEngineObservationTitle")}
            </CardTitle>
            <CardDescription className="text-[12px] leading-5 dark:text-slate-400/90">
              {t("settings.runtimeEngineObservationDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 px-4 pb-4 pt-0 md:px-5">
            <div className="grid gap-2 md:grid-cols-2">
              {engineObservabilityCards.map((item) => (
                <div
                  key={item.engine}
                  className="rounded-2xl border border-slate-200/80 bg-slate-50/75 px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.035]"
                >
                  <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{item.label}</div>
                  <div className="mt-2 grid gap-x-3 gap-y-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300/88 sm:grid-cols-2">
                    <div>{t("settings.runtimeSessionCountLabel")} {item.sessionCount}</div>
                    <div>{t("settings.runtimeTrackedRootProcessCountLabel")} {item.trackedRootProcesses}</div>
                    <div>{t("settings.runtimeTrackedProcessTreeCountLabel")} {item.trackedTotalProcesses}</div>
                    <div>{t("settings.runtimeTrackedNodeProcessCountLabel")} {item.trackedNodeProcesses}</div>
                    <div>{t("settings.runtimeHostManagedRootProcessCountLabel")} {item.hostManagedRootProcesses}</div>
                    <div>
                      {t("settings.runtimeHostUnmanagedRootProcessCountLabel")} {item.hostUnmanagedRootProcesses}
                      {` · ${t("settings.runtimeProcessTreeCountLabel", {
                        count: item.hostUnmanagedTotalProcesses,
                      })}`}
                    </div>
                    <div className="sm:col-span-2">
                      {t("settings.runtimeExternalRootProcessCountLabel")} {item.externalRootProcesses}
                      {` · ${t("settings.runtimeProcessTreeCountLabel", {
                        count: item.externalTotalProcesses,
                      })}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/75 px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                <BadgeCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                {t("settings.runtimePolicyTitle")}
              </div>
              <div className="mt-1 text-[12px] leading-5 text-slate-500 dark:text-slate-400/90">
                {t("settings.runtimePolicyDescription")}
              </div>
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 dark:border-white/10 dark:bg-slate-900/80">
                <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
                      {t("settings.runtimeRestoreThreadsOnlyOnLaunch")}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400/90">
                      {t("settings.runtimeRestoreThreadsOnlyOnLaunchDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.runtimeRestoreThreadsOnlyOnLaunch !== false}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        runtimeRestoreThreadsOnlyOnLaunch: checked,
                      })
                    }
                  />
                </div>
                <div className="border-t border-slate-200/80 dark:border-white/10" />
                <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
                      {t("settings.runtimeForceCleanupOnExit")}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400/90">
                      {t("settings.runtimeForceCleanupOnExitDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.runtimeForceCleanupOnExit !== false}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        runtimeForceCleanupOnExit: checked,
                      })
                    }
                  />
                </div>
                <div className="border-t border-slate-200/80 dark:border-white/10" />
                <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
                      {t("settings.runtimeOrphanSweepOnLaunch")}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400/90">
                      {t("settings.runtimeOrphanSweepOnLaunchDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.runtimeOrphanSweepOnLaunch !== false}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        runtimeOrphanSweepOnLaunch: checked,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95 shadow-sm dark:border-slate-800/90 dark:bg-slate-950/95 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <CardHeader className="gap-2 px-4 py-4 md:px-5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-1">
                <CardTitle className="flex items-center gap-2 text-[15px] dark:text-slate-50">
                  <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  {t("settings.runtimeBudgetTitle")}
                </CardTitle>
                <CardDescription className="max-w-[34rem] text-[11px] leading-4.5 dark:text-slate-400/90">
                  {t("settings.runtimeBudgetDescription")}
                </CardDescription>
              </div>
              <div className="flex gap-2 lg:shrink-0">
                <Button
                  type="button"
                  onClick={() => {
                    void handleSaveRuntimeSettings();
                  }}
                  disabled={runtimeSaving}
                  className="h-7.5 rounded-full px-3 text-[11px]"
                >
                  {runtimeSaving ? t("settings.running") : t("common.save")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void loadSnapshot();
                  }}
                  disabled={runtimeLoading}
                  className="h-7.5 rounded-full px-3 text-[11px] dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {t("settings.refresh")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 md:px-5">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="min-w-0 space-y-0.5">
                <Label className="text-[11px] font-medium leading-4 text-slate-700 dark:text-slate-200" htmlFor="runtime-hot">
                  {t("settings.runtimeMaxHot")}
                </Label>
                <Input
                  id="runtime-hot"
                  value={hotDraft}
                  onChange={(event) => setHotDraft(event.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="h-7.5 rounded-xl border-slate-200 bg-slate-50/75 px-3 text-[12px] dark:border-slate-700 dark:bg-slate-900/80"
                />
                <div className="text-[10px] leading-4 text-slate-500 dark:text-slate-400/90">
                  {t("settings.runtimeMaxHotHelp")}
                </div>
              </div>
              <div className="min-w-0 space-y-0.5">
                <Label className="text-[11px] font-medium leading-4 text-slate-700 dark:text-slate-200" htmlFor="runtime-warm">
                  {t("settings.runtimeMaxWarm")}
                </Label>
                <Input
                  id="runtime-warm"
                  value={warmDraft}
                  onChange={(event) => setWarmDraft(event.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="h-7.5 rounded-xl border-slate-200 bg-slate-50/75 px-3 text-[12px] dark:border-slate-700 dark:bg-slate-900/80"
                />
                <div className="text-[10px] leading-4 text-slate-500 dark:text-slate-400/90">
                  {t("settings.runtimeMaxWarmHelp")}
                </div>
              </div>
              <div className="min-w-0 space-y-0.5">
                <Label className="text-[11px] font-medium leading-4 text-slate-700 dark:text-slate-200" htmlFor="runtime-ttl">
                  {t("settings.runtimeWarmTtl")}
                </Label>
                <Input
                  id="runtime-ttl"
                  value={ttlDraft}
                  onChange={(event) => setTtlDraft(event.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  max={14400}
                  className="h-7.5 rounded-xl border-slate-200 bg-slate-50/75 px-3 text-[12px] dark:border-slate-700 dark:bg-slate-900/80"
                />
                <div className="text-[10px] leading-4 text-slate-500 dark:text-slate-400/90">
                  {t("settings.runtimeWarmTtlHelp")}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {runtimeError ? (
        <Card className="mt-3 border-red-200/80 bg-red-50/80 shadow-sm dark:border-red-500/25 dark:bg-red-500/10">
          <CardContent className="flex items-start gap-2.5 px-4 py-3 text-red-700 dark:text-red-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-[12px] leading-5">{runtimeError}</div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-3 border-slate-200/80 bg-white/95 shadow-sm dark:border-slate-800/90 dark:bg-slate-950/95 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <CardHeader className="space-y-2 px-4 py-4 md:px-5">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-[15px] dark:text-slate-50">{t("settings.runtimeRowsTitle")}</CardTitle>
              <CardDescription className="text-[12px] leading-5 dark:text-slate-400/90">
                {t("settings.runtimeRowsDescription")}
              </CardDescription>
            </div>
            {runtimeSnapshot ? (
              <Badge className="max-w-full whitespace-normal rounded-full text-[11px] leading-4 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200" variant="secondary">
                {t("settings.runtimeDiagnosticsLine", {
                  cleaned: runtimeSnapshot.diagnostics.orphanEntriesCleaned,
                  failed: runtimeSnapshot.diagnostics.orphanEntriesFailed,
                  forced: runtimeSnapshot.diagnostics.forceKillCount,
                  blocked: runtimeSnapshot.diagnostics.leaseBlockedEvictionCount,
                  aborted: runtimeSnapshot.diagnostics.coordinatorAbortCount,
                })}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5 px-4 pb-4 pt-0 md:px-5">
          {runtimeSnapshot?.rows.length ? (
            runtimeSnapshot.rows.map((row) => {
              const tone = getRuntimeTone(row.state);
              const StatusIcon = tone.icon;
              return (
                <div
                  key={`${row.engine}:${row.workspaceId}`}
                  className="rounded-2xl border border-slate-200/80 bg-slate-50/75 px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.035]"
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-700 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100">
                          <StatusIcon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                            {row.workspaceName}
                          </div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            {row.engine}
                          </div>
                        </div>
                        <Badge className={`${tone.chip} h-5.5 rounded-full px-2 text-[10px]`}>
                          {getRuntimeStateLabel(t, row.state)}
                        </Badge>
                        {row.evictCandidate ? (
                          <Badge className="h-5.5 rounded-full px-2 text-[10px] dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-200" variant="outline">
                            {row.evictionReason ?? t("settings.runtimeStateEvictable")}
                          </Badge>
                        ) : null}
                        {row.activeWorkProtected ? (
                          <Badge className="h-5.5 rounded-full px-2 text-[10px] dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200" variant="secondary">
                            {getActiveWorkLabel(t, row.activeWorkReason)}
                          </Badge>
                        ) : null}
                        {row.pinned ? (
                          <Badge className="h-5.5 rounded-full px-2 text-[10px] dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-100" variant="secondary">
                            {t("settings.runtimePin")}
                          </Badge>
                        ) : null}
                        {row.hasStoppingPredecessor ? (
                          <Badge className="h-5.5 rounded-full px-2 text-[10px] dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" variant="secondary">
                            {t("settings.runtimeStoppingPredecessorLabel")}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="grid gap-x-4 gap-y-1.5 text-[12px] leading-5 text-slate-600 dark:text-slate-300/88 lg:grid-cols-2">
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{t("settings.runtimePathLabel")}</span>{" "}
                          <span className="break-all">{row.workspacePath}</span>
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{t("settings.runtimeLeaseSourcesLabel")}</span>{" "}
                          {row.leaseSources.join(" · ") || "—"}
                          {` · ${t("settings.runtimeTurnLeaseCountLabel", {
                            count: row.turnLeaseCount,
                          })} · ${t("settings.runtimeStreamLeaseCountLabel", {
                            count: row.streamLeaseCount,
                          })}`}
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{t("settings.runtimeProtectionLabel")}</span>{" "}
                          {row.activeWorkProtected
                            ? getActiveWorkLabel(t, row.activeWorkReason)
                            : row.pinned
                              ? t("settings.runtimeProtectionPinnedIdle")
                              : t("settings.runtimeProtectionIdle")}
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{t("settings.runtimeProcessLabel")}</span>{" "}
                          {row.pid
                            ? t("settings.runtimePidLabel", { pid: row.pid })
                            : "—"}
                          {row.runtimeGeneration
                            ? ` · ${t("settings.runtimeGenerationLabel")} ${row.runtimeGeneration}`
                            : ""}
                          {row.processDiagnostics?.rootCommand ? ` · ${row.processDiagnostics.rootCommand}` : ""}
                          {row.processDiagnostics
                            ? ` · ${t("settings.runtimeProcessTreeLabel", {
                                count: row.processDiagnostics.totalProcesses,
                              })}`
                            : ""}
                          {row.processDiagnostics
                            ? ` · ${t("settings.runtimeNodeProcessLabel", {
                                count: row.processDiagnostics.nodeProcesses,
                              })}`
                            : ""}
                          {row.processDiagnostics
                            ? ` · ${t("settings.runtimeManagedProcessCountLabel", {
                                count: row.processDiagnostics.managedRuntimeProcesses,
                              })}`
                            : ""}
                          {row.processDiagnostics
                            ? ` · ${t("settings.runtimeHelperProcessCountLabel", {
                                count: row.processDiagnostics.resumeHelperProcesses,
                              })}`
                            : ""}
                          {row.processDiagnostics
                            ? ` · ${t("settings.runtimeOrphanProcessCountLabel", {
                                count: row.processDiagnostics.orphanResidueProcesses,
                              })}`
                            : ""}
                          {row.wrapperKind ? ` · ${row.wrapperKind}` : ""}
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{t("settings.runtimeBinaryLabel")}</span>{" "}
                          <span className="break-all">{row.resolvedBin ?? "—"}</span>
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{t("settings.runtimeStartupStateLabel")}</span>{" "}
                          {getRuntimeStartupStateLabel(t, row.startupState)}
                          {row.lastRecoverySource ? ` · ${t("settings.runtimeRecoverySourceLabel")} ${row.lastRecoverySource}` : ""}
                          {row.foregroundWorkSource ? ` · ${t("settings.runtimeForegroundSourceLabel")} ${row.foregroundWorkSource}` : ""}
                          {row.lastGuardState ? ` · ${t("settings.runtimeGuardStateLabel")} ${row.lastGuardState}` : ""}
                          {row.foregroundWorkThreadId ? ` · ${t("settings.runtimeForegroundThreadLabel")} ${row.foregroundWorkThreadId}` : ""}
                          {row.foregroundWorkTurnId ? ` · ${t("settings.runtimeForegroundTurnLabel")} ${row.foregroundWorkTurnId}` : ""}
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{t("settings.runtimeRecentChurnLabel")}</span>{" "}
                          {t("settings.runtimeRecentSpawnCountLabel", {
                            count: row.recentSpawnCount ?? 0,
                          })}
                          {` · ${t("settings.runtimeRecentReplaceCountLabel", {
                            count: row.recentReplaceCount ?? 0,
                          })}`}
                          {` · ${t("settings.runtimeRecentForceKillCountLabel", {
                            count: row.recentForceKillCount ?? 0,
                          })}`}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400/90">
                        <div className="inline-flex items-center gap-1.5">
                          <Clock3 className="h-3.5 w-3.5" />
                          {t("settings.runtimeStartedAtLabel")} {formatTimestamp(row.startedAtMs)}
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <RefreshCw className="h-3.5 w-3.5" />
                          {t("settings.runtimeLastUsedLabel")} {formatTimestamp(row.lastUsedAtMs)}
                        </div>
                      </div>

                      {row.error
                      || row.evictionReason
                      || row.lastExitReasonCode
                      || row.lastReplaceReason
                      || row.lastProbeFailure
                      || row.foregroundWorkState ? (
                        <details className="group rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 dark:border-white/10 dark:bg-slate-900/70">
                          <summary className="cursor-pointer list-none text-[11px] font-medium text-slate-600 outline-none marker:content-none dark:text-slate-300">
                            <span className="inline-flex items-center gap-2">
                              <span>{t("settings.runtimeRowDetailsSummary")}</span>
                              <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90 dark:text-slate-500">
                                ›
                              </span>
                            </span>
                          </summary>
                          {row.error ? (
                            <div className="mt-2 rounded-xl border border-red-200/80 bg-red-50/85 px-3 py-2 text-[12px] leading-5 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200">
                              {row.error}
                            </div>
                          ) : null}
                          {row.evictionReason ? (
                            <div className="mt-2 rounded-xl border border-amber-200/80 bg-amber-50/85 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                              {t("settings.runtimeEvictionReasonLabel")} {row.evictionReason}
                            </div>
                          ) : null}
                          {row.lastExitReasonCode ? (
                            <div className="mt-2 rounded-xl border border-sky-200/80 bg-sky-50/85 px-3 py-2 text-[12px] leading-5 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200">
                              <div>
                                {t("settings.runtimeLastExitLabel")} {row.lastExitReasonCode}
                              </div>
                              {row.lastExitMessage ? (
                                <div className="mt-1">{row.lastExitMessage}</div>
                              ) : null}
                              <div className="mt-1">
                                {t("settings.runtimeExitPendingRequestCountLabel", {
                                  count: row.lastExitPendingRequestCount ?? 0,
                                })}
                                {row.lastExitCode != null
                                  ? ` · ${t("settings.runtimeExitCodeLabel", {
                                      code: row.lastExitCode,
                                    })}`
                                  : ""}
                                {row.lastExitSignal
                                  ? ` · ${t("settings.runtimeExitSignalLabel", {
                                      signal: row.lastExitSignal,
                                    })}`
                                  : ""}
                                {row.lastExitAtMs
                                  ? ` · ${t("settings.runtimeLastUsedLabel")} ${formatTimestamp(row.lastExitAtMs)}`
                                  : ""}
                              </div>
                            </div>
                          ) : null}
                          {row.foregroundWorkState ? (
                            <div className="mt-2 rounded-xl border border-blue-200/80 bg-blue-50/85 px-3 py-2 text-[12px] leading-5 text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-200">
                              <div>
                                {t("settings.runtimeForegroundStateLabel")} {getActiveWorkLabel(t, row.foregroundWorkState ?? row.activeWorkReason)}
                              </div>
                              <div className="mt-1">
                                {t("settings.runtimeForegroundSinceLabel")} {formatTimestamp(row.foregroundWorkSinceMs)}
                              </div>
                              {row.foregroundWorkSource ? (
                                <div className="mt-1">
                                  {t("settings.runtimeForegroundSourceLabel")} {row.foregroundWorkSource}
                                </div>
                              ) : null}
                              {row.foregroundWorkTimeoutAtMs ? (
                                <div className="mt-1">
                                  {t("settings.runtimeForegroundTimeoutLabel")} {formatTimestamp(row.foregroundWorkTimeoutAtMs)}
                                </div>
                              ) : null}
                              {row.foregroundWorkTimedOut ? (
                                <div className="mt-1">{t("settings.runtimeForegroundTimedOutLabel")}</div>
                              ) : null}
                            </div>
                          ) : null}
                          {row.lastReplaceReason ? (
                            <div className="mt-2 rounded-xl border border-violet-200/80 bg-violet-50/85 px-3 py-2 text-[12px] leading-5 text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-200">
                              {t("settings.runtimeReplaceReasonLabel")} {row.lastReplaceReason}
                            </div>
                          ) : null}
                          {row.lastProbeFailure ? (
                            <div className="mt-2 rounded-xl border border-amber-200/80 bg-amber-50/85 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                              <div>{t("settings.runtimeProbeFailureLabel")} {row.lastProbeFailure}</div>
                              {row.lastProbeFailureSource ? (
                                <div className="mt-1">
                                  {t("settings.runtimeRecoverySourceLabel")} {row.lastProbeFailureSource}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </details>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 xl:w-[260px] xl:items-end">
                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            void handleRuntimeMutation("pin", row.workspaceId, row.engine, !row.pinned);
                          }}
                          disabled={runtimeSaving}
                          title={row.pinned ? t("settings.runtimeUnpinHelp") : t("settings.runtimePinHelp")}
                          className="h-7.5 rounded-full px-3 text-[11px] dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Pin className="mr-1.5 h-3.5 w-3.5" />
                          {row.pinned ? t("settings.runtimeUnpin") : t("settings.runtimePin")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            void handleRuntimeMutation("releaseToCold", row.workspaceId, row.engine);
                          }}
                          disabled={runtimeSaving}
                          title={t("settings.runtimeReleaseHelp")}
                          className="h-7.5 rounded-full px-3 text-[11px] dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Snowflake className="mr-1.5 h-3.5 w-3.5" />
                          {t("settings.runtimeRelease")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            void handleRuntimeMutation("close", row.workspaceId, row.engine);
                          }}
                          disabled={runtimeSaving}
                          title={t("settings.runtimeCloseHelp")}
                          className="h-7.5 rounded-full px-3 text-[11px] dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          {t("settings.runtimeClose")}
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400/90 xl:items-end">
                        <span>{row.pinned ? t("settings.runtimeUnpinHelp") : t("settings.runtimePinHelp")}</span>
                        <span>{t("settings.runtimeReleaseHelp")}</span>
                        <span>{t("settings.runtimeCloseHelp")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : isRuntimeTransientEmpty ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-slate-900">
                <RefreshCw className="h-4.5 w-4.5 animate-spin text-slate-500 dark:text-slate-300" />
              </div>
              <div className="mt-3 text-[13px] font-medium text-slate-900 dark:text-slate-100">
                {t("settings.loading")}
              </div>
              <div className="mt-1.5 text-[12px] leading-5 text-slate-500 dark:text-slate-400/90">
                {t("settings.runtimeRowsDescription")}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-slate-900">
                <SquareTerminal className="h-4.5 w-4.5 text-slate-500 dark:text-slate-300" />
              </div>
              <div className="mt-3 text-[13px] font-medium text-slate-900 dark:text-slate-100">
                {t("settings.runtimePoolEmpty")}
              </div>
              <div className="mt-1.5 text-[12px] leading-5 text-slate-500 dark:text-slate-400/90">
                {t("settings.runtimeEmptyDescription")}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
