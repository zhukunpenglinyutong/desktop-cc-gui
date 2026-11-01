import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getAppVersion, isWeb } from "@/lib/platform";
import Activity from "lucide-react/dist/esm/icons/activity";
import Minus from "lucide-react/dist/esm/icons/minus";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { ActionFeedbackIcon, useRunningFeedback } from "@/components/base/action-feedback";
import { ipc, type AppMetrics } from "@/lib/ipc";
import { listenScanProgress, type ScanProgress } from "@/lib/events";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { cx } from "@/utils/cx";
import { compareByOrder, pluginIdFromRegistryKey, statusBarRegistry, useRegistry } from "@ccgui/plugin-sdk";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";
import { dismissCenterSurfaces } from "@/features/chat/center-surfaces";
import { useReleaseNotesTabStore } from "@/features/update/notes-tab";
import { registerShortcutHandler } from "@/features/shortcuts/runtime";
import { PerformanceDiagnosticsDialog } from "@/features/settings/PerformanceDiagnostics";
import { STATUS_BAR_BUILTIN_IDS, useStatusBarHidden } from "@/lib/status-bar-visibility";

import { applyZoom, changeZoom, onZoomChange, readZoomPct, ZOOM_STEP } from "@/lib/zoom";

const METRICS_POLL_MS = 3000;

function formatMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** One slot in the right-hand cluster: a stable id (what the visibility
 *  preference keys on) plus the node it renders. */
interface StatusBarSlot {
  id: string;
  node: ReactNode;
}

/**
 * App-wide bottom chrome: performance, zoom, history-sync status, plugin chips,
 * version.
 *
 * The builtin items stay hand-wired here and are intentionally NOT migrated
 * into statusBarRegistry: they are deeply coupled to ipc/listen hooks, so
 * registration would buy little. The registry is the plugin extension point
 * (plan §4.2 #8): entries registered via ctx.ui.registerStatusBarItem render
 * after the sync status, before the version, each inside a PluginBoundary.
 * zone:"start" entries (SDK 0.3.8) render left-aligned ahead of the cluster.
 *
 * Visibility (设置 → 插件 → 状态栏显示): every right-cluster slot carries a
 * stable id — builtins use `builtin:*`, plugin chips keep their registry id —
 * and the user can hide any of them. Hidden means *not rendered*: the plugin
 * keeps running (timers and IPC calls untouched), only the chip disappears.
 * Separators are joined from the surviving slots, so hiding a middle item
 * never leaves a dangling `·`.
 */
export function AppStatusBar() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<AppMetrics | null>(null);
  const [zoomPct, setZoomPct] = useState(readZoomPct);
  const [sync, setSync] = useState<ScanProgress | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const pluginItems = useRegistry(statusBarRegistry);
  const hidden = useStatusBarHidden();
  // zone (SDK 0.3.8): "start" chips render left-aligned ahead of the
  // builtin cluster; everything else keeps the legacy right-side slot.
  const startItems = pluginItems.filter((def) => def.zone === "start" && !hidden.has(def.id));
  const endItems = pluginItems.filter((def) => def.zone !== "start" && !hidden.has(def.id));

  // Re-apply the persisted zoom on startup; Tauri does not restore it.
  useEffect(() => applyZoom(readZoomPct()), []);

  // Follow zoom changes from every entry point (shortcuts below, Settings →
  // 通用 → 外观 → 界面缩放) so the percent label never goes stale.
  useEffect(() => onZoomChange(setZoomPct), []);
  // Zoom keys live in the shortcut runtime (defaults ⌘= / ⌘- / ⌘0,
  // configurable in Settings → Shortcuts). Web mode skips registration:
  // browsers own ⌘± natively. readZoomPct() keeps handlers stale-free.
  useEffect(() => {
    if (isWeb) return;
    const unIn = registerShortcutHandler("zoomIn", () => changeZoom(readZoomPct() + ZOOM_STEP));
    const unOut = registerShortcutHandler("zoomOut", () => changeZoom(readZoomPct() - ZOOM_STEP));
    const unReset = registerShortcutHandler("zoomReset", () => changeZoom(100));
    return () => {
      unIn();
      unOut();
      unReset();
    };
  }, []);

  useEffect(() => {
    void getAppVersion().then((v) => {
      if (v) setVersion(v);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let polling = false;
    const poll = () => {
      // Skip ticks while the window is hidden (background tab / minimized):
      // the numbers are invisible anyway, so polling then is pure waste.
      if (document.hidden || polling) return;
      polling = true;
      ipc
        .appMetrics()
        .then((m) => {
          if (!cancelled) setMetrics(m);
        })
        .catch(() => { if (!cancelled) setMetrics(null); })
        .finally(() => { polling = false; });
    };
    void poll();
    const timer = setInterval(poll, METRICS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useTauriEvent(() => listenScanProgress(setSync));

  const syncPct = sync && sync.total > 0 ? Math.round((sync.done / sync.total) * 100) : 0;
  const syncing = !!sync && !sync.finished;
  // Spin while the rescan runs, check when it reports finished (same feedback
  // as the git panel's refresh).
  const syncFeedback = useRunningFeedback(syncing);
  const triggerSync = useCallback(() => {
    void ipc.rescanSessions().catch(() => {});
  }, []);
  const iconButton =
    "flex size-5 cursor-pointer items-center justify-center rounded text-foreground-icon-tertiary transition-colors hover:bg-background-tertiary-hover hover:text-foreground-icon-secondary";

  // Assemble the right cluster in its original visual order. Everything runs
  // through one slot list so the separators can be derived from what actually
  // renders.
  const slots: StatusBarSlot[] = [];

  if (!hidden.has(STATUS_BAR_BUILTIN_IDS.performance)) {
    slots.push({
      id: STATUS_BAR_BUILTIN_IDS.performance,
      node: (
        <button
          type="button"
          onClick={() => setShowDiagnostics(true)}
          aria-label={t("diagnostics.open")}
          className="flex cursor-pointer items-center gap-1 rounded transition-colors hover:bg-background-tertiary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus-ring"
          title={
            metrics
              ? t("statusbar.perfDetail", {
                  mb: formatMb(metrics.memoryBytes),
                  cpu: metrics.cpuPercent.toFixed(1),
                })
              : undefined
          }
        >
          <Activity className="size-3.5 shrink-0 text-foreground-icon-tertiary" aria-hidden />
          <span className="whitespace-nowrap">
            {t("statusbar.performance")}
            {metrics ? ` ${formatMb(metrics.memoryBytes)} MB` : ""}
          </span>
        </button>
      ),
    });
  }

  // Zoom drives the native webview; browsers zoom natively.
  if (!isWeb && !hidden.has(STATUS_BAR_BUILTIN_IDS.zoom)) {
    slots.push({
      id: STATUS_BAR_BUILTIN_IDS.zoom,
      node: (
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("statusbar.zoomOut")}
            title={t("statusbar.zoomOut")}
            className={iconButton}
            onClick={() => changeZoom(zoomPct - ZOOM_STEP)}
          >
            <Minus className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t("statusbar.resetZoom")}
            title={t("statusbar.resetZoom")}
            className="min-w-9 cursor-pointer rounded text-center transition-colors hover:text-text-secondary"
            onClick={() => changeZoom(100)}
          >
            {zoomPct}%
          </button>
          <button
            type="button"
            aria-label={t("statusbar.zoomIn")}
            title={t("statusbar.zoomIn")}
            className={iconButton}
            onClick={() => changeZoom(zoomPct + ZOOM_STEP)}
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </span>
      ),
    });
  }

  if (!hidden.has(STATUS_BAR_BUILTIN_IDS.sync)) {
    slots.push({
      id: STATUS_BAR_BUILTIN_IDS.sync,
      // Button and progress label are one unit: the bar never puts a
      // separator between them, and hiding the entry hides both.
      node: (
        <>
          <button
            type="button"
            aria-label={t("statusbar.syncNow")}
            title={t("statusbar.syncNow")}
            disabled={syncing}
            className={cx(iconButton, syncing && "cursor-default opacity-60")}
            onClick={triggerSync}
          >
            <ActionFeedbackIcon
              icon={RefreshCw}
              feedback={syncFeedback}
              spin
              iconClassName="size-3.5"
            />
          </button>
          {sync && (
            <span
              className={cx(
                "whitespace-nowrap",
                sync.finished ? "text-text-tertiary" : "text-notification-success-foreground",
              )}
            >
              {sync.finished
                ? t("statusbar.synced")
                : t("statusbar.syncing", { pct: syncPct, done: sync.done, total: sync.total })}
            </span>
          )}
        </>
      ),
    });
  }

  // Plugin status-bar chips (plan §4.2 #8), placed after the sync status and
  // before the version. Each chip renders in its own PluginBoundary so a
  // render crash unmounts only that chip; the plugin owns the chip's look —
  // the host provides placement and the row gap only.
  for (const def of [...endItems].sort(compareByOrder)) {
    // Non-plugin ids (host/test registrations) pass through as their own
    // boundary id.
    const pluginId = pluginIdFromRegistryKey(def.id);
    const Chip = def.component;
    slots.push({
      id: def.id,
      node: (
        <PluginBoundary pluginId={pluginId}>
          <Chip />
        </PluginBoundary>
      ),
    });
  }

  if (version && !hidden.has(STATUS_BAR_BUILTIN_IDS.version)) {
    slots.push({
      id: STATUS_BAR_BUILTIN_IDS.version,
      node: (
        <button
          type="button"
          aria-label={t("changelog.title")}
          title={t("commands.openReleaseNotes")}
          className="shrink-0 cursor-pointer rounded px-1 transition-colors hover:bg-background-tertiary-hover hover:text-text-secondary"
          // 版本号打开版本更新页签：先清掉其他中心面（同插件入口），再打开/
          // 聚焦更新说明页签（版本历史翻页入口已随弹窗下线，见
          // ReleaseNotesPane）。
          onClick={() => {
            dismissCenterSurfaces();
            useReleaseNotesTabStore.getState().openTab();
          }}
        >
          v{version}
        </button>
      ),
    });
  }

  // Everything hidden (builtins, chips and version): drop the strip entirely
  // instead of leaving a 28px empty band with a top border.
  if (slots.length === 0 && startItems.length === 0) return null;

  return (
    <div
      // Stable anchor for plugins and automation that need to reach the bar
      // without depending on Tailwind class strings.
      data-ccgui-status-bar=""
      className="flex h-7 shrink-0 items-center justify-end border-t border-separator-border bg-background-primary-default px-3 text-caption-1-medium text-text-tertiary select-none max-md:hidden"
    >
      {startItems.length > 0 && (
        <div className="me-auto flex min-w-0 items-center gap-3">
          {[...startItems].sort(compareByOrder).map((def, i) => {
            const pluginId = pluginIdFromRegistryKey(def.id);
            const Chip = def.component;
            return (
              <Fragment key={def.id}>
                {i > 0 && <span className="text-text-disabled">·</span>}
                <PluginBoundary pluginId={pluginId}>
                  <Chip />
                </PluginBoundary>
              </Fragment>
            );
          })}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-3">
        {slots.map((slot, i) => (
          <Fragment key={slot.id}>
            {i > 0 && <span className="text-text-disabled">·</span>}
            {slot.node}
          </Fragment>
        ))}
      </div>
      {showDiagnostics && <PerformanceDiagnosticsDialog onClose={() => setShowDiagnostics(false)} />}
    </div>
  );
}
