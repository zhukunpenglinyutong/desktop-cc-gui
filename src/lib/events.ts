import { listen } from "./transport";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { performanceRecorder } from "./performance-diagnostics";

export interface EngineEventPayload {
  runId: string;
  sessionId: string | null;
  engine: string;
  seq: number;
  kind:
    | "delta"
    | "thinking"
    | "message"
    | "session"
    | "usage"
    | "error"
    | "warn"
    | "retry"
    | "compaction"
    | "permission_denied"
    | "question"
    | "question_settled"
    | "done"
    | "model"
    | "effort"
    | "task_started"
    | "task_progress"
    | "task_notification"
    | "tasks";
  data: unknown;
  /** Emit-side timestamp (Unix ms), stamped in TurnState::push. Absent from
   *  payloads produced before SDK 0.3.8. */
  ts?: number;
  /** Host-measured generation window (ms) for `usage`/`done` reports: the
   *  model's actual stream span (first delta / message_start → message_stop
   *  / usage), with tool execution and idle time excluded. Absent when the
   *  report could not be timed; consumers fall back to report-to-report
   *  timing. Since SDK 0.3.15. */
  genMs?: number;
}

/** Batched engine events arrive as an array under a single event name. */
export function listenEngineEvents(
  cb: (events: EngineEventPayload[]) => void,
): Promise<UnlistenFn> {
  return listen<EngineEventPayload[]>("engine://event", (event) => {
    if (!performanceRecorder.isEnabled()) { cb(event.payload); return; }
    const startedAt = performance.now();
    performanceRecorder.count("engineEvents", event.payload.length);
    for (const item of event.payload) {
      if (item.kind === "delta" || item.kind === "thinking") performanceRecorder.count("textEvents", 1);
      if (item.kind === "message" && item.data && typeof item.data === "object" && "role" in item.data &&
        (item.data.role === "tool" || item.data.role === "tool_result")) performanceRecorder.count("toolEvents", 1);
    }
    try { cb(event.payload); }
    finally { performanceRecorder.duration("engineBatch", performance.now() - startedAt); }
  });
}

/** 任务工作台 agent 节点的事件流（mission::mission_agent_start）：
 *  与聊天/插件流隔离，前端 mission runtime 按 run id 路由。 */
export function listenMissionAgentEvents(
  cb: (events: EngineEventPayload[]) => void,
): Promise<UnlistenFn> {
  return listen<EngineEventPayload[]>("mission-agent://event", (e) => cb(e.payload));
}

export function listenSessionsChanged(cb: () => void): Promise<UnlistenFn> {
  return listen("sessions://changed", () => cb());
}

/** Fired after a turn lands in the usage ledger; the page re-reads on it. */
export function listenUsageChanged(cb: () => void): Promise<UnlistenFn> {
  return listen("usage://changed", () => cb());
}
export interface ScanProgress {
  done: number;
  total: number;
  /** True on the last event of a scan run. */
  finished: boolean;
}

/** App settings were persisted (any page, any surface, any rotation). */
export function listenSettingsChanged(cb: () => void): Promise<UnlistenFn> {
  return listen("settings://changed", () => cb());
}

/**
 * The outbound relay's state changed. The switch itself never disappears, so
 * this is a "re-read the status" signal — the reason for a failed dial rides
 * `RelayInfo.error`, not the event.
 */
export function listenRelay(cb: () => void): Promise<UnlistenFn> {
  return listen("web://relay", () => cb());
}

/**
 * A remote (relayed) browser started or stopped driving this machine. Fired
 * with the current state, so the badge is right even if the socket opened
 * before the window did.
 */
export function listenRemoteControl(cb: (active: boolean) => void): Promise<UnlistenFn> {
  return listen<{ active?: boolean } | null>("web://remote", (event) =>
    cb(Boolean(event.payload?.active)),
  );
}

/** The LAN bridge's device list changed (new pending device, approve, revoke). */
export function listenWebDevices(cb: () => void): Promise<UnlistenFn> {
  return listen("web://devices", () => cb());
}
/** History-scan progress, throttled by the scanner (~50 updates per run). */
export function listenScanProgress(cb: (p: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan://progress", (e) => cb(e.payload));
}
export interface PluginInstallProgress {
  done: number;
  total: number;
  /** True on the last event of an install run. */
  finished: boolean;
}

/** Plugin-install copy progress, throttled by the backend (~50 updates per run). */
export function listenPluginInstallProgress(
  cb: (p: PluginInstallProgress) => void,
): Promise<UnlistenFn> {
  return listen<PluginInstallProgress>("plugin://install-progress", (e) => cb(e.payload));
}
export interface TerminalOutputPayload {
  id: string;
  data: string;
}

/** Batched PTY output: arrays of chunks flushed at 32ms / 64KB by the sink. */
export function listenTerminalOutput(
  cb: (chunks: TerminalOutputPayload[]) => void,
): Promise<UnlistenFn> {
  return listen<TerminalOutputPayload[]>("terminal://output", (e) => cb(e.payload));
}
export interface CliUpdateProgress {
  /** Scopes events to one confirmed run; other runs are ignored. */
  runId: string;
  engine: string;
  phase: "started" | "stdout" | "stderr" | "finished";
  /** Output line for stdout/stderr phases (clipped to 1000 chars). */
  line: string | null;
  /** Exit status on the finished phase. */
  exitOk: boolean | null;
}

/** One-click CLI install/update progress: batched arrays, 32ms / 64KB. */
export function listenCliUpdateProgress(
  cb: (events: CliUpdateProgress[]) => void,
): Promise<UnlistenFn> {
  return listen<CliUpdateProgress[]>("cli://update-progress", (e) => cb(e.payload));
}

/**
 * The global Esc fired while a computer-use run was armed (the backend
 * registers that hotkey for the duration of a run only, see
 * computer_use::computer_use_set_active). The payload is empty: the
 * frontend's job is to stop the run it is driving.
 */
export function listenComputerUseEscape(cb: () => void): Promise<UnlistenFn> {
  return listen<null>("computeruse://escape", () => cb());
}
