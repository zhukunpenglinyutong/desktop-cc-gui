import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Transport layer: identical invoke/listen surface as the Tauri IPC API, but
 * routed over the web-access WebSocket bridge when the app runs in a plain
 * browser (no __TAURI_INTERNALS__). See src-tauri/src/web.rs for the protocol.
 */
export const isWeb =
  typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

/** Token issued by the desktop on web-access start, carried in the URL. */
export const webToken: string | null = isWeb
  ? new URLSearchParams(window.location.search).get("token")
  : null;

type Listener = (payload: unknown) => void;

interface PendingReq {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const RETRY_MAX_MS = 10_000;

class WebBridge {
  private ws: WebSocket | null = null;
  private openGate: Promise<void> | null = null;
  private openResolve: (() => void) | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingReq>();
  private listeners = new Map<string, Set<Listener>>();
  private retryMs = 1000;
  private versionValue: string | null = null;
  private versionWaiters: ((v: string | null) => void)[] = [];

  /** Connect if needed; resolves once the socket is open. */
  private ensure(): Promise<void> {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return this.openGate!;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/ws?token=${encodeURIComponent(webToken ?? "")}`,
    );
    this.ws = ws;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.openGate = promise;
    this.openResolve = resolve;
    ws.onopen = () => {
      this.retryMs = 1000;
      resolve();
    };
    ws.onmessage = (e) => this.onMessage(String(e.data));
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => {
      // onclose follows and handles the retry.
    };
    return promise;
  }

  private onMessage(text: string) {
    let msg: {
      type?: string;
      version?: string;
      id?: unknown;
      ok?: boolean;
      payload?: unknown;
      error?: unknown;
      name?: string;
    };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === "hello") {
      this.versionValue = typeof msg.version === "string" ? msg.version : null;
      for (const w of this.versionWaiters.splice(0)) w(this.versionValue);
      return;
    }
    if (msg.type === "response") {
      const id = Number(msg.id);
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (msg.ok) entry.resolve(msg.payload);
      else entry.reject(new Error(String(msg.error ?? "unknown error")));
      return;
    }
    if (msg.type === "event" && typeof msg.name === "string") {
      const subs = this.listeners.get(msg.name);
      if (subs) for (const cb of subs) cb(msg.payload);
    }
  }

  private onClose(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.openGate = null;
    // Release waiters parked in ensure(); invoke re-checks readyState and
    // throws instead of hanging when the socket never opened.
    this.openResolve?.();
    this.openResolve = null;
    const error = new Error("web bridge disconnected");
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    // If no hello ever arrived (e.g. wrong token → 403), release version
    // waiters so the About/status bar UI does not hang on "…".
    if (this.versionValue === null) {
      for (const w of this.versionWaiters.splice(0)) w(null);
    }
    // Keep retrying: the desktop may have restarted the bridge.
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    setTimeout(() => void this.ensure(), delay);
  }

  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    await this.ensure();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("web bridge disconnected");
    }
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    this.pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    this.ws.send(JSON.stringify({ type: "invoke", id, cmd, args: args ?? {} }));
    return promise;
  }

  async listen(name: string, cb: Listener): Promise<UnlistenFn> {
    void this.ensure();
    let subs = this.listeners.get(name);
    if (!subs) {
      subs = new Set();
      this.listeners.set(name, subs);
    }
    subs.add(cb);
    return () => {
      const set = this.listeners.get(name);
      if (!set) return;
      set.delete(cb);
      if (set.size === 0) this.listeners.delete(name);
    };
  }

  serverVersion(): Promise<string | null> {
    if (this.versionValue !== null) return Promise.resolve(this.versionValue);
    const { promise, resolve } = Promise.withResolvers<string | null>();
    this.versionWaiters.push(resolve);
    void this.ensure();
    return promise;
  }
}

let bridge: WebBridge | null = null;

/** Drop-in for @tauri-apps/api/core invoke. */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isWeb) return tauriInvoke<T>(cmd, args);
  return (bridge ??= new WebBridge()).invoke<T>(cmd, args);
}

/** Drop-in for @tauri-apps/api/event listen (same payload-wrapped shape). */
export function listen<T>(
  name: string,
  cb: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!isWeb) return tauriListen<T>(name, cb);
  return (bridge ??= new WebBridge()).listen(name, (payload) => cb({ payload: payload as T }));
}

/** Version reported by the bridge hello frame; null when unavailable. */
export function serverVersion(): Promise<string | null> {
  if (!isWeb) return Promise.resolve(null);
  return (bridge ??= new WebBridge()).serverVersion();
}
