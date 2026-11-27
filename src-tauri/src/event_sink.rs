use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

const FLUSH_INTERVAL: Duration = Duration::from_millis(32);
// Chat already coalesces updates per animation frame and budgets Markdown
// parsing separately. Keep IPC batching, but don't add two frames of waiting.
const CHAT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const FLUSH_BYTES: usize = 64 * 1024;

pub const ENGINE_EVENT_NAME: &str = "engine://event";

/// 插件 agent 轮次的事件流名（plugin_caps::plugin_agent_start）：独立于
/// 聊天引擎流，前端插件运行时监听此名并路由回属主插件。
pub const PLUGIN_AGENT_EVENT_NAME: &str = "plugin-agent://event";
/// 任务工作台 agent 节点的事件流名（mission::mission_agent_start）：与
/// 聊天和插件流隔离，前端 mission runtime 按 run id 路由回对应节点。
pub const MISSION_AGENT_EVENT_NAME: &str = "mission-agent://event";
pub const SESSIONS_CHANGED_EVENT: &str = "sessions://changed";
pub const SCAN_PROGRESS_EVENT: &str = "scan://progress";
pub const INSTALL_PROGRESS_EVENT: &str = "plugin://install-progress";
pub const CLI_UPDATE_PROGRESS_EVENT: &str = "cli://update-progress";

/// History-scan progress for the status bar; `finished` marks the last event
/// of a scan run.
#[derive(serde::Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub done: usize,
    pub total: usize,
    pub finished: bool,
}

/// Local plugin-install copy progress for the manager UI; `finished` marks
/// the last event of an install run. done/total are bytes.
#[derive(serde::Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub done: u64,
    pub total: u64,
    pub finished: bool,
}

/// Events are serialized once at push time; flush then only joins the cached
/// byte strings into a JSON array (previously every event serialized twice).
struct Pending {
    events: Vec<String>,
    bytes: usize,
    scheduled: bool,
}

/// Runtime-agnostic event emitter so tests can drive the mock runtime.
/// Payloads arrive as pre-serialized JSON text.
pub trait Emit: Send + Sync {
    fn emit_json(&self, name: &str, raw_json: &str);
}

impl<R: tauri::Runtime> Emit for tauri::AppHandle<R> {
    fn emit_json(&self, name: &str, raw_json: &str) {
        // RawValue re-emits the exact bytes — no parse/re-serialize roundtrip.
        if let Ok(raw) = serde_json::value::RawValue::from_string(raw_json.to_string()) {
            let _ = self.emit(name, raw);
        }
    }
}
/// Fan-out emitter: the webview plus any attached web-access WS broadcaster
/// (web.rs). Targets are Arc-cloned out of the lock before emitting so a slow
/// target never holds the registry lock.
pub struct BroadcastEmit {
    targets: Mutex<Vec<(u64, Arc<dyn Emit>)>>,
    next_id: AtomicU64,
}

impl BroadcastEmit {
    pub fn new(target: Arc<dyn Emit>) -> Arc<Self> {
        Arc::new(Self {
            targets: Mutex::new(vec![(0, target)]),
            next_id: AtomicU64::new(1),
        })
    }

    /// Register an additional target; the returned id removes it again.
    pub fn add(&self, target: Arc<dyn Emit>) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let mut targets = self.targets.lock().unwrap_or_else(|e| e.into_inner());
        targets.push((id, target));
        id
    }

    pub fn remove(&self, id: u64) {
        let mut targets = self.targets.lock().unwrap_or_else(|e| e.into_inner());
        targets.retain(|(target_id, _)| *target_id != id);
    }
}

impl Emit for BroadcastEmit {
    fn emit_json(&self, name: &str, raw_json: &str) {
        let targets: Vec<Arc<dyn Emit>> = {
            let guard = self.targets.lock().unwrap_or_else(|e| e.into_inner());
            guard.iter().map(|(_, t)| Arc::clone(t)).collect()
        };
        for target in targets {
            target.emit_json(name, raw_json);
        }
    }
}

pub struct EventSink {
    emitter: Arc<dyn Emit>,
    name: &'static str,
    inner: Mutex<Pending>,
    flush_interval: Duration,
}

impl EventSink {
    pub fn new(emitter: Arc<dyn Emit>) -> Arc<Self> {
        Self::with_interval(emitter, ENGINE_EVENT_NAME, CHAT_FLUSH_INTERVAL)
    }

    /// Batched sink emitting under a custom event name (e.g. terminal output).
    pub fn with_name(emitter: Arc<dyn Emit>, name: &'static str) -> Arc<Self> {
        Self::with_interval(emitter, name, FLUSH_INTERVAL)
    }

    fn with_interval(
        emitter: Arc<dyn Emit>,
        name: &'static str,
        flush_interval: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            emitter,
            name,
            flush_interval,
            inner: Mutex::new(Pending {
                events: Vec::new(),
                bytes: 0,
                scheduled: false,
            }),
        })
    }

    pub(crate) fn is_chat(&self) -> bool {
        self.name == ENGINE_EVENT_NAME
    }

    pub fn push(self: &Arc<Self>, event: Value) {
        let Ok(json) = serde_json::to_string(&event) else {
            return;
        };
        let mut flush_now = false;
        {
            let mut pending = match self.inner.lock() {
                Ok(p) => p,
                Err(poisoned) => poisoned.into_inner(),
            };
            pending.bytes += json.len();
            pending.events.push(json);
            if pending.bytes >= FLUSH_BYTES {
                flush_now = true;
            } else if !pending.scheduled {
                pending.scheduled = true;
                let this = Arc::clone(self);
                tokio::spawn(async move {
                    tokio::time::sleep(this.flush_interval).await;
                    this.flush();
                });
            }
        }
        if flush_now {
            self.flush();
        }
    }

    pub fn flush(&self) {
        let events: Vec<String> = {
            let mut pending = match self.inner.lock() {
                Ok(p) => p,
                Err(poisoned) => poisoned.into_inner(),
            };
            if pending.events.is_empty() {
                pending.scheduled = false;
                return;
            }
            pending.bytes = 0;
            pending.scheduled = false;
            std::mem::take(&mut pending.events)
        };
        let payload = format!("[{}]", events.join(","));
        self.emitter.emit_json(self.name, &payload);
    }

    /// Non-batched immediate emit for low-frequency signals.
    pub fn emit_sessions_changed(&self) {
        self.emitter.emit_json(SESSIONS_CHANGED_EVENT, "null");
    }
    /// Non-batched immediate emit; the scan loop self-throttles.
    pub fn emit_scan_progress(&self, progress: ScanProgress) {
        if let Ok(json) = serde_json::to_string(&progress) {
            self.emitter.emit_json(SCAN_PROGRESS_EVENT, &json);
        }
    }
    /// Non-batched immediate emit; the install copy self-throttles.
    pub fn emit_install_progress(&self, progress: InstallProgress) {
        if let Ok(json) = serde_json::to_string(&progress) {
            self.emitter.emit_json(INSTALL_PROGRESS_EVENT, &json);
        }
    }
}
