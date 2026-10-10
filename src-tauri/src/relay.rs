//! Outbound relay client: the desktop dials a Cloudflare Worker (see
//! `deploy/worker`) and serves the LAN bridge's port through it, so a phone
//! can reach the app from anywhere without the desktop opening an inbound
//! port or configuring router port-forwarding.
//!
//! Wire protocol (one WebSocket to `<worker>/agent?key=<secret>`, JSON text
//! frames, base64 payloads):
//!
//! - worker → desktop: `{"t":"open","id":N,"path":"/…","method":"GET",
//!   "headers":{…}}` for HTTP (`"ws":true` for a socket), then `body` frames
//!   and an `end` for HTTP, or `data` frames for a socket.
//! - desktop → worker: `head` (HTTP status + headers), `data`, `close`, and
//!   `error` when the local hop fails.
//!
//! Every stream is served by a plain request against 127.0.0.1:<bridge port>,
//! so the bridge's token check and the per-device approval stay the only gate;
//! the Worker holds no policy beyond the shared key.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};

use tauri::Manager;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

/// Pause before redialing after a dropped socket: long enough for the Worker
/// to finish recycling the old connection, short enough that a phone reload
/// barely notices.
const REDIAL_DELAY_MS: u64 = 1_000;
/// Ceiling for the redial backoff. A dial that fails is retried for as long as
/// the switch is on — see `run_agent` — so the pause has to stay bounded.
const REDIAL_MAX_MS: u64 = 30_000;
/// Liveness probe period on a connected agent socket. A Cloudflare blip can
/// leave the socket open at this end with no Durable Object behind it, and the
/// switch keeps reading 已连接; a ping that stays unanswered for a whole period
/// drops the socket so the outer loop redials.
const HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15);
/// Deadline for one dial. `connect_async` has no built-in timeout, so a
/// half-open Worker would otherwise park the agent task in the handshake
/// forever and the stop watch would never be observed; a dial that outlives
/// this is just a failed attempt and falls into the normal backoff.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// Marks traffic that arrived through the relay: the bridge requires the
/// pairing key for those requests only, so the LAN keeps upstream's model.
pub const VIA_HEADER: &str = "x-ccgui-via";

/// Headers that must never survive the hop: hop-by-hop ones have no meaning
/// across the relay, and `VIA_HEADER` is ours — a phone that sent its own copy
/// would otherwise decide how the bridge classifies the request.
const HOP_HEADERS: [&str; 9] = [
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "accept-encoding",
    "sec-websocket-extensions",
    VIA_HEADER,
];

#[derive(Default)]
pub struct RelayState {
    inner: Mutex<Option<Running>>,
}

struct Running {
    info: RelayInfo,
    stop: watch::Sender<bool>,
    /// Identifies the agent task that owns this entry. A superseded task (the
    /// user disconnected and reconnected while it sat in a dial) must neither
    /// write into its successor's state nor tear it down.
    generation: u64,
}

/// Hands every session a distinct id; see `Running::generation`.
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RelayInfo {
    /// Address the phone opens, with the key already in the path.
    pub url: String,
    /// Worker base the desktop dials.
    pub agent_url: String,
    pub connected: bool,
    /// Last failure, for the settings card.
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum AgentFrame {
    Open {
        id: u64,
        #[serde(default)]
        ws: bool,
        #[serde(default)]
        method: String,
        #[serde(default)]
        path: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
    Body {
        id: u64,
        b64: String,
    },
    End {
        id: u64,
    },
    /// Socket payload: phone → desktop.
    Data {
        id: u64,
        b64: String,
        /// Lets the Worker hand the phone a text frame instead of bytes: the
        /// app's JS client reads JSON, and a Blob used to be dropped.
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<bool>,
    },
    Close {
        id: u64,
    },
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ClientFrame {
    Head {
        id: u64,
        status: u16,
        headers: HashMap<String, String>,
    },
    Data {
        id: u64,
        b64: String,
        /// Worker-side frame type. Absent from older Workers, which sent
        /// everything as bytes; the bridge's protocol is JSON text, so an
        /// absent flag is read as text.
        #[serde(default)]
        text: Option<bool>,
    },
    Close {
        id: u64,
    },
    Error {
        id: u64,
        message: String,
    },
}

/// An HTTP stream that has been announced but not yet fully received.
struct PendingHttp {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

/// A live socket stream, with the handle needed to drop it on `close`.
struct LiveSocket {
    /// Frame bytes plus whether they are a text frame (see `spawn_socket`).
    frames: mpsc::Sender<(Vec<u8>, bool)>,
    task: tokio::task::AbortHandle,
}

/// What the writer task puts on the wire: protocol replies, plus the liveness
/// ping the read loop schedules.
enum OutFrame {
    Text(String),
    Ping,
}

/// `https://host` → `wss://host/agent?key=…`, `http://host` → `ws://…`.
fn agent_url(base: &str, key: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("relay address is empty".into());
    }
    let ws = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if base.starts_with("ws://") || base.starts_with("wss://") {
        base.to_string()
    } else {
        format!("wss://{base}")
    };
    Ok(format!("{ws}/agent?key={}", urlencode(key)))
}

/// The address the phone opens. No token: through the relay the pairing key
/// is what authorizes a device, so the bare worker address is enough.
fn phone_url(base: &str) -> String {
    format!("{}/", base.trim().trim_end_matches('/'))
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// Relay url + key to dial at launch, when 无人值守 was left on. The tunnel is
/// what makes the machine reachable without anyone at the desk, so an app
/// relaunch (update, crash, reboot) brings it back — but only for a user who
/// asked for that: the plain relay switch is session-only, and this marker is
/// the one piece of it that persists.
pub fn autostart_target(settings: &crate::settings::AppSettings) -> Option<(String, String)> {
    if settings.web_relay_unattended != Some(true) {
        return None;
    }
    let url = settings.web_relay_url.as_deref()?.trim();
    let key = settings.web_relay_key.as_deref()?.trim();
    if url.is_empty() || key.is_empty() {
        return None;
    }
    Some((url.to_string(), key.to_string()))
}

/// Write the 无人值守 marker. Caller must hold
/// `crate::settings::settings_write_lock()`.
fn persist_relay_unattended(enabled: bool) -> Result<Option<String>, String> {
    let mut settings = crate::settings::read_settings()?;
    settings.web_relay_unattended = Some(enabled);
    crate::settings::persist_settings_committed(&mut settings)
}

/// Remember the relay address a start was pointed at, so the settings fields
/// come back filled next time. The on/off position itself is *not* stored: the
/// switch is session-only, and a relaunch starts with the tunnel off until the
/// user turns it on again.
///
/// Caller must hold `crate::settings::settings_write_lock()`: the read and the
/// persist are one atomic read-modify-write, and starts linearize through that
/// lock together with their state swap.
fn persist_relay_target(url: &str, key: &str) -> Result<Option<String>, String> {
    let mut settings = crate::settings::read_settings()?;
    settings.web_relay_url = Some(url.to_string());
    settings.web_relay_key = Some(key.to_string());
    crate::settings::persist_settings_committed(&mut settings)
}

#[tauri::command]
pub async fn web_relay_start(
    app: tauri::AppHandle,
    url: String,
    key: String,
) -> Result<RelayInfo, String> {
    let url = url.trim().to_string();
    let key = key.trim().to_string();
    let agent = agent_url(&url, &key)?;
    let state = app.state::<crate::AppState>();
    let bridge_transition = state.web.lock_transition().await;
    let (bridge, bridge_created) = bridge_transition.ensure(app.clone()).await?;
    let bridge_port = bridge.port;
    let bridge_token = bridge.token;

    let info = RelayInfo {
        url: phone_url(&url),
        agent_url: agent.clone(),
        connected: false,
        error: None,
    };
    let (stop_tx, stop_rx) = watch::channel(false);
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    // Remembering the address and publishing the relay are one settings-lock
    // section, so two starts cannot interleave their state swaps, while the
    // disk write stays out of the relay.inner critical section. On failure an
    // existing relay remains untouched.
    let persisted = {
        let _settings_guard = crate::settings::settings_write_lock();
        match persist_relay_target(&url, &key) {
            Ok(warning) => {
                let mut guard = state.relay.inner.lock();
                if let Some(previous) = guard.take() {
                    let _ = previous.stop.send(true);
                }
                *guard = Some(Running {
                    info: info.clone(),
                    stop: stop_tx,
                    generation,
                });
                Ok(warning)
            }
            Err(error) => Err(error),
        }
    };
    let warning = match persisted {
        Ok(warning) => warning,
        Err(error) => {
            if bridge_created {
                bridge_transition.stop_if_token(&app, &bridge_token);
            }
            return Err(error);
        }
    };
    if let Some(warning) = warning {
        eprintln!("[relay] settings committed with warning: {warning}");
    }

    let handle = app.clone();
    tokio::spawn(async move {
        run_agent(handle, agent, bridge_port, stop_rx, generation).await;
    });
    Ok(info)
}

/// 无人值守 switch (设置 → 远程访问 → 外网访问). On writes the autostart marker —
/// the card then dials the tunnel right away through `web_relay_start`, so this
/// command stays a settings write. Off only clears the marker: dropping the
/// current tunnel is the relay button's job, not this one's.
#[tauri::command]
pub fn web_relay_unattended_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let warning = {
        let _guard = crate::settings::settings_write_lock();
        persist_relay_unattended(enabled)?
    };
    if let Some(warning) = warning {
        eprintln!("[relay] settings committed with warning: {warning}");
    }
    crate::settings::announce_settings(&app);
    Ok(())
}

/// Stop half of the switch. The switch position is session-only, so stopping is
/// purely runtime — but 无人值守 is cleared first: the user asked for the tunnel
/// to stop, and leaving the marker set would dial it again on the next launch
/// (persisting first means a failed write keeps the tunnel running instead of
/// half-applying). The address stays on file for the next start.
#[tauri::command]
pub fn web_relay_stop(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AppState>();
    let warning = {
        let _guard = crate::settings::settings_write_lock();
        persist_relay_unattended(false)?
    };
    if let Some(running) = state.relay.inner.lock().take() {
        let _ = running.stop.send(true);
    }
    if let Some(warning) = warning {
        eprintln!("[relay] settings committed with warning: {warning}");
    }
    broadcast_relay(&app);
    Ok(())
}

#[tauri::command]
pub fn web_relay_status(app: tauri::AppHandle) -> Option<RelayInfo> {
    let state = app.state::<crate::AppState>();
    let guard = state.relay.inner.lock();
    guard.as_ref().map(|r| r.info.clone())
}

/// The Cloudflare Worker a user deploys on their own account, embedded at
/// build time so the settings page can hand it over without shipping the
/// repo next to the app (the deploy/ tree is not part of any bundle).
pub const WORKER_SOURCE: &str = include_str!("../../deploy/worker/src/index.js");

/// A fresh relay secret: 32 chars from an unambiguous alphabet. It travels in
/// the agent URL and seeds the Durable Object name, so it stays URL-safe and
/// free of look-alike characters.
fn new_relay_key() -> String {
    const ALPHABET: &[u8] = b"23456789BCDFGHJKLMNPQRSTVWXZ";
    const LEN: usize = 32;
    let mut out = String::with_capacity(LEN);
    while out.len() < LEN {
        for byte in uuid::Uuid::new_v4().as_bytes() {
            if out.len() == LEN {
                break;
            }
            out.push(ALPHABET[*byte as usize % ALPHABET.len()] as char);
        }
    }
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

/// Minimal STORE-only (uncompressed) zip writer. Deliberately not a dependency:
/// the pack is ~9 KB of text, and storing it verbatim means the bytes the user
/// unpacks are exactly the bytes they deploy — nothing hidden in a compressor.
fn zip_store(files: &[(&str, &[u8])]) -> Vec<u8> {
    // Fixed timestamp (2025-01-01 00:00) keeps the pack byte-reproducible.
    const DOS_DATE: u16 = (45 << 9) | (1 << 5) | 1;
    const DOS_TIME: u16 = 0;

    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let offset = out.len() as u32;
        let crc = crc32(data);
        let size = data.len() as u32;
        let name_len = name.len() as u16;

        push_u32(&mut out, 0x0403_4b50);
        push_u16(&mut out, 20); // version needed
        push_u16(&mut out, 0); // flags
        push_u16(&mut out, 0); // method: store
        push_u16(&mut out, DOS_TIME);
        push_u16(&mut out, DOS_DATE);
        push_u32(&mut out, crc);
        push_u32(&mut out, size);
        push_u32(&mut out, size);
        push_u16(&mut out, name_len);
        push_u16(&mut out, 0); // extra field length
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);

        push_u32(&mut central, 0x0201_4b50);
        push_u16(&mut central, 20); // version made by
        push_u16(&mut central, 20); // version needed
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, DOS_TIME);
        push_u16(&mut central, DOS_DATE);
        push_u32(&mut central, crc);
        push_u32(&mut central, size);
        push_u32(&mut central, size);
        push_u16(&mut central, name_len);
        push_u16(&mut central, 0); // extra
        push_u16(&mut central, 0); // comment
        push_u16(&mut central, 0); // disk number
        push_u16(&mut central, 0); // internal attributes
        push_u32(&mut central, 0); // external attributes
        push_u32(&mut central, offset);
        central.extend_from_slice(name.as_bytes());
    }

    let central_offset = out.len() as u32;
    let central_size = central.len() as u32;
    out.extend_from_slice(&central);
    push_u32(&mut out, 0x0605_4b50);
    push_u16(&mut out, 0); // this disk
    push_u16(&mut out, 0); // disk with central directory
    push_u16(&mut out, files.len() as u16);
    push_u16(&mut out, files.len() as u16);
    push_u32(&mut out, central_size);
    push_u32(&mut out, central_offset);
    push_u16(&mut out, 0); // comment length
    out
}

/// The deploy pack: Worker source + the wrangler project it belongs to, wired
/// to `key`. The user can read every byte before deploying it.
fn deploy_pack(key: &str) -> Vec<u8> {
    let wrangler = format!(
        r#"name = "ccgui-relay"
main = "src/index.js"
compatibility_date = "2025-01-01"

# Durable Object: one instance per relay key owns the desktop's socket.
[[durable_objects.bindings]]
name = "RELAY"
class_name = "Relay"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Relay"]

[vars]
# 与 CC GUI「中转密钥」保持一致 / must match the key field in CC GUI.
# 部署后也可在控制台 Variables 里修改，改完无需重新部署。
RELAY_KEY = "{key}"
"#
    );
    let readme = r#"CC GUI 外网穿透 · 中继部署包
CC GUI relay deploy pack

【部署步骤 / Steps】
1. 装 Node ≥ 16.17（只为拿 npx wrangler）。
   Install Node ≥ 16.17 (only to get npx wrangler).
2. npx wrangler login      # 浏览器授权一次 / authorize once in the browser
3. npx wrangler deploy     # 输出 https://ccgui-relay.<你的子域>.workers.dev
4. CC GUI → 设置 → 远程访问 → 外网访问：
   中转地址 = 上一步的 URL，中转密钥 = 本包 wrangler.toml 里的 RELAY_KEY。
   CC GUI → Settings → Remote access → Outbound: relay URL = the URL above,
   relay key = RELAY_KEY from this pack's wrangler.toml.
5. 点「连接中转」；手机打开该 URL → 授权页 → 输入 CC GUI 上的 8 位配对密钥。
   Click Connect relay; open that URL on the phone → authorization page →
   enter the 8-character pairing key shown in CC GUI.

【包里有什么 / What's inside】
- src/index.js    Worker 源码 / the Worker source
- wrangler.toml   部署配置：Durable Object 绑定与 RELAY_KEY
                  deploy config: the Durable Object binding and RELAY_KEY

【说明 / Notes】
- RELAY_KEY 是桌面端与 Worker 之间的共享密钥，请勿外传；它同时决定手机访问的
  路径分片，换 key 后手机需重新配对。
  RELAY_KEY is the shared secret between the desktop and the Worker — keep it
  private. It also namespaces the phone's path, so a new key needs re-pairing.
- 部分地区无法直连 *.workers.dev：给这个 Worker 绑定自定义域名
  （Settings → Domains & Routes → Add custom domain），再把该域名填进 CC GUI 的
  「中转地址」—— 地址栏始终可手改。
  If *.workers.dev is unreachable where you are, bind a custom domain to this
  Worker (Settings → Domains & Routes → Add custom domain) and use it as the
  relay URL in CC GUI; that field stays editable.
"#;
    zip_store(&[
        ("ccgui-relay/README.txt", readme.as_bytes()),
        ("ccgui-relay/wrangler.toml", wrangler.as_bytes()),
        ("ccgui-relay/src/index.js", WORKER_SOURCE.as_bytes()),
    ])
}

/// Write the deploy pack to `path`; returns the relay key baked into it (a
/// fresh one when the caller has none yet, so the pack and the GUI agree).
#[tauri::command]
pub fn relay_deploy_pack(path: String, key: Option<String>) -> Result<String, String> {
    let key = key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(new_relay_key);
    std::fs::write(&path, deploy_pack(&key))
        .map_err(|error| format!("failed to write {path}: {error}"))?;
    Ok(key)
}

const API_BASE: &str = "https://api.cloudflare.com/client/v4";
const SCRIPT_NAME: &str = "ccgui-relay";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayDeployResult {
    pub url: String,
    pub key: String,
    pub account_id: String,
    pub account_name: String,
}

/// Cloudflare answers every REST call with `{success, errors[], result}`; fold
/// a failure into one readable line instead of leaking a JSON blob.
async fn cf_json(response: reqwest::Response, what: &str) -> Result<serde_json::Value, String> {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let success = value
        .get("success")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(status.is_success());
    if success && status.is_success() {
        return Ok(value);
    }
    let detail = value
        .get("errors")
        .and_then(|errors| errors.as_array())
        .map(|errors| {
            errors
                .iter()
                .filter_map(|error| error.get("message").and_then(|m| m.as_str()))
                .collect::<Vec<_>>()
                .join("; ")
        })
        .filter(|joined| !joined.is_empty())
        .unwrap_or_else(|| text.chars().take(200).collect());
    Err(format!("{what}失败（HTTP {status}）：{detail}"))
}

/// Account-owned tokens (`cfat_…`) cannot call user-level endpoints at all, so
/// Cloudflare answers `GET /accounts` with "Invalid access token" — a message
/// that sends people chasing permissions they already granted. Name the real
/// problem instead.
const ACCOUNT_TOKEN_NEEDS_ID: &str =
    "这个 Token 是账户令牌（cfat_ 开头），Cloudflare 不允许它列出账户：请在下方填写 Account ID（在 Cloudflare 控制台右侧栏可复制），或改用用户令牌（My Profile → API Tokens 里创建）";

/// Resolve the account to deploy into. An id the caller typed wins outright:
/// account-owned tokens can only ever address `/accounts/{id}/…`, so there is
/// nothing to discover. Without one we ask Cloudflare which accounts the token
/// can see — the user-token path, one field and zero typing.
async fn cf_account(
    client: &reqwest::Client,
    token: &str,
    account_id: Option<&str>,
) -> Result<(String, String), String> {
    if let Some(id) = account_id.map(str::trim).filter(|id| !id.is_empty()) {
        return Ok((id.to_string(), cf_account_name(client, token, id).await));
    }
    if token.starts_with("cfat_") {
        return Err(ACCOUNT_TOKEN_NEEDS_ID.to_string());
    }
    let response = client
        .get(format!("{API_BASE}/accounts"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("读取账号失败：{error}"))?;
    let value = cf_json(response, "读取账号").await?;
    let account = value
        .get("result")
        .and_then(|result| result.as_array())
        .and_then(|list| list.first())
        .ok_or_else(|| "这个 Token 下没有可用的 Cloudflare 账号".to_string())?;
    let id = account
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() {
        return Err("账号缺少 id".to_string());
    }
    let name = account
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    Ok((id, name))
}

/// Name for the deploy result line. Purely cosmetic: a token scoped to Workers
/// and nothing else may not be allowed to read it, and that must never fail a
/// deploy that would otherwise work.
async fn cf_account_name(client: &reqwest::Client, token: &str, id: &str) -> String {
    let Ok(response) = client
        .get(format!("{API_BASE}/accounts/{id}"))
        .bearer_auth(token)
        .send()
        .await
    else {
        return id.to_string();
    };
    let Ok(value) = cf_json(response, "读取账号").await else {
        return id.to_string();
    };
    value
        .get("result")
        .and_then(|result| result.get("name"))
        .and_then(|v| v.as_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(id)
        .to_string()
}

async fn cf_subdomain(
    client: &reqwest::Client,
    token: &str,
    account_id: &str,
) -> Result<String, String> {
    let response = client
        .get(format!(
            "{API_BASE}/accounts/{account_id}/workers/subdomain"
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("读取 workers.dev 子域失败：{error}"))?;
    let value = cf_json(response, "读取 workers.dev 子域").await?;
    let subdomain = value
        .get("result")
        .and_then(|result| result.get("subdomain"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if subdomain.is_empty() {
        return Err(
            "这个账号还没有设置 workers.dev 子域：先到 Cloudflare 控制台 Workers & Pages 页面设置一次，再回来部署"
                .to_string(),
        );
    }
    Ok(subdomain)
}

/// Ship the Worker into the user's own account in one call: the Durable Object
/// class (via `migrations`), its binding, and the relay key all ride along in
/// the upload metadata, which is why nobody has to run wrangler. The relay URL
/// is only reported back — the settings page decides whether to fill it.
///
/// The key is always minted here: it is the only thing standing between the
/// `/agent` endpoint and whoever guesses it, so it must never be whatever the
/// settings field happened to hold (a leftover test value, a hand-typed
/// short string). The caller stores what comes back.
///
/// `account_id` is optional: user tokens can list their accounts, account-owned
/// ones (which Cloudflare now hands out as `cfat_…`) cannot, so for those the
/// page asks for the id instead.
#[tauri::command]
pub async fn relay_deploy(
    token: String,
    account_id: Option<String>,
) -> Result<RelayDeployResult, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("缺少 Cloudflare API Token".to_string());
    }
    let account_id = account_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let key = new_relay_key();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;

    let (account_id, account_name) = cf_account(&client, &token, account_id.as_deref()).await?;
    let subdomain = cf_subdomain(&client, &token, &account_id).await?;

    // A fresh script needs the Durable Object class declared in the upload's
    // migrations; an existing one already owns it, and Cloudflare rejects a
    // migration tag it has seen (old_tag verifies the live tag, and we do not
    // track it here). So: declare only when creating.
    let exists = client
        .get(format!(
            "{API_BASE}/accounts/{account_id}/workers/scripts/{SCRIPT_NAME}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false);

    let mut metadata = serde_json::json!({
        "main_module": "index.js",
        "compatibility_date": "2025-01-01",
        "bindings": [
            { "type": "durable_object_namespace", "name": "RELAY", "class_name": "Relay" },
            // secret_text: the dashboard never shows the value back.
            { "type": "secret_text", "name": "RELAY_KEY", "text": key.clone() },
        ],
    });
    if !exists {
        // An object, not the array wrangler.toml shows: the API unmarshals it
        // into ActorMigrations ({new_tag, old_tag?, steps[]}).
        metadata["migrations"] = serde_json::json!({
            "new_tag": "v1",
            "steps": [{ "new_sqlite_classes": ["Relay"] }],
        });
    }
    let form = reqwest::multipart::Form::new()
        .part(
            "metadata",
            reqwest::multipart::Part::text(metadata.to_string())
                .mime_str("application/json")
                .map_err(|error| error.to_string())?,
        )
        .part(
            "index.js",
            // Cloudflare matches the part by filename as well as field name;
            // a filename-less part reads as "No such module: index.js".
            reqwest::multipart::Part::text(WORKER_SOURCE)
                .file_name("index.js")
                .mime_str("application/javascript+module")
                .map_err(|error| error.to_string())?,
        );
    let response = client
        .put(format!(
            "{API_BASE}/accounts/{account_id}/workers/scripts/{SCRIPT_NAME}"
        ))
        .bearer_auth(&token)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("上传 Worker 失败：{error}"))?;
    cf_json(response, "上传 Worker").await?;

    // Make it reachable at <script>.<subdomain>.workers.dev. A failure here is
    // not fatal: an existing route may already be enabled, and the user can
    // always bind a custom domain instead.
    let _ = client
        .post(format!(
            "{API_BASE}/accounts/{account_id}/workers/scripts/{SCRIPT_NAME}/subdomain"
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "enabled": true }))
        .send()
        .await;

    Ok(RelayDeployResult {
        url: format!("https://{SCRIPT_NAME}.{subdomain}.workers.dev"),
        key,
        account_id,
        account_name,
    })
}

/// Backoff before the next dial: 1s, 2s, 4s … capped. Attempt 0 (the redial
/// right after a live socket died) waits the base delay, which is also what
/// keeps a Worker that accepts and immediately closes from being a hot loop.
fn redial_delay(attempt: u32) -> std::time::Duration {
    let shift = attempt.saturating_sub(1).min(5);
    std::time::Duration::from_millis((REDIAL_DELAY_MS << shift).min(REDIAL_MAX_MS))
}

/// Dial until a socket comes up or `stop` flips; `None` means stopped. A dial
/// that fails is reported — with its attempt count, so a switch that is being
/// retried unattended shows progress rather than looking stuck — and then
/// retried: the Worker is a service on the internet, so "not answering right
/// now" is what an outage looks like, and ending the session there turned a
/// Cloudflare blip into a manual repair. Only `stop` ends this loop.
async fn redial_until_connected<S, F, Fut>(
    stop: &mut watch::Receiver<bool>,
    mut dial: F,
    mut on_failure: impl FnMut(u32, String),
) -> Option<S>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<S, String>>,
{
    let mut attempt = 0u32;
    loop {
        if *stop.borrow() {
            return None;
        }
        // Race the dial against the stop watch and its deadline: the switch
        // ends the loop (biased so a socket won as the switch flips is never
        // served), a hung handshake ends as one failed attempt.
        let dialed = tokio::select! {
            biased;
            _ = stop.changed() => None,
            result = tokio::time::timeout(CONNECT_TIMEOUT, dial()) => {
                Some(match result {
                    Ok(outcome) => outcome,
                    Err(_) => Err(format!("连接超时（{} 秒）", CONNECT_TIMEOUT.as_secs())),
                })
            }
        };
        match dialed {
            None => return None,
            Some(Ok(socket)) => {
                // The switch may have flipped while the handshake finished.
                if *stop.borrow() {
                    return None;
                }
                return Some(socket);
            }
            Some(Err(error)) => {
                attempt = attempt.saturating_add(1);
                on_failure(attempt, error);
            }
        }
        if *stop.borrow() {
            return None;
        }
        tokio::select! {
            _ = tokio::time::sleep(redial_delay(attempt)) => {}
            _ = stop.changed() => return None,
        }
    }
}

/// Keeps the agent socket up. A socket that lived and then died is redialed —
/// a blip on the desktop's uplink should not cost the phone its link — and a
/// dial that never comes up is retried on a capped backoff. Nothing but
/// switching the relay off stops it: retries follow the running tunnel and are
/// **not** gated on 无人值守, which only decides whether a launch dials at all.
async fn run_agent(
    app: tauri::AppHandle,
    agent: String,
    port: u16,
    mut stop: watch::Receiver<bool>,
    generation: u64,
) {
    loop {
        if *stop.borrow() {
            return;
        }
        let connected = redial_until_connected(
            &mut stop,
            || {
                let agent = agent.clone();
                async move {
                    // A bad address used to end the session; it is a
                    // configuration error the user sees in the switch's tooltip,
                    // not a reason to stop watching for a fix.
                    let request = agent
                        .into_client_request()
                        .map_err(|e| format!("中继地址无效：{e}"))?;
                    tokio_tungstenite::connect_async(request)
                        .await
                        .map_err(|e| e.to_string())
                }
            },
            |attempt, error| {
                set_connected(&app, generation, false);
                set_error(
                    &app,
                    generation,
                    format!("连接中继失败，第 {attempt} 次重试：{error}"),
                );
            },
        )
        .await;
        let Some((socket, _)) = connected else {
            return;
        };
        set_error(&app, generation, String::new());
        set_connected(&app, generation, true);
        serve(socket, port, &mut stop).await;
        set_connected(&app, generation, false);
        if *stop.borrow() {
            return;
        }
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(REDIAL_DELAY_MS)) => {}
            _ = stop.changed() => return,
        }
    }
}

/// One connected agent socket: dispatch streams, pump frames until it dies.
/// Queue one liveness probe. A full queue already proves the writer has work;
/// only a Ping that actually entered the queue may arm the response timeout.
fn queue_heartbeat(
    out: &mpsc::Sender<OutFrame>,
    ping_sent_at: &mut Option<tokio::time::Instant>,
) -> bool {
    match out.try_send(OutFrame::Ping) {
        Ok(()) => {
            *ping_sent_at = Some(tokio::time::Instant::now());
            true
        }
        Err(mpsc::error::TrySendError::Full(_)) => true,
        Err(mpsc::error::TrySendError::Closed(_)) => false,
    }
}

async fn serve(
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    port: u16,
    stop: &mut watch::Receiver<bool>,
) {
    let (mut tx, mut rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<OutFrame>(256);
    let writer = tokio::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
            let message = match frame {
                OutFrame::Text(text) => Message::Text(text.into()),
                OutFrame::Ping => Message::Ping(Vec::new().into()),
            };
            if tx.send(message).await.is_err() {
                break;
            }
        }
    });

    let http: Arc<Mutex<HashMap<u64, PendingHttp>>> = Arc::new(Mutex::new(HashMap::new()));
    let sockets: Arc<Mutex<HashMap<u64, LiveSocket>>> = Arc::new(Mutex::new(HashMap::new()));
    // One client: keep-alive to the local bridge is worth reusing, and the
    // pool dies with the connection.
    let client = reqwest::Client::builder()
        // A pipe, not a browser: following a redirect would swallow the
        // status and any Set-Cookie the phone needs to see.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // Liveness probe. A Cloudflare blip can take the Durable Object out from
    // under an open socket: nothing arrives, nothing errors, and the switch
    // keeps reading 已连接 while every request answers 503. A ping that no
    // frame follows within one interval is the only signal that the far end is
    // gone, and dropping the socket here is what lets `run_agent` redial.
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // First tick fires immediately; the first probe belongs one interval in.
    heartbeat.tick().await;
    let mut ping_sent_at: Option<tokio::time::Instant> = None;

    loop {
        let frame = tokio::select! {
            _ = stop.changed() => break,
            _ = heartbeat.tick() => {
                if ping_sent_at.take().is_some() {
                    break;
                }
                if !queue_heartbeat(&out_tx, &mut ping_sent_at) {
                    break;
                }
                continue;
            }
            next = rx.next() => {
                // Any frame — a pong included — proves the far end is alive.
                ping_sent_at = None;
                match next {
                    Some(Ok(Message::Text(text))) => text.to_string(),
                    Some(Ok(Message::Binary(bytes))) => match String::from_utf8(bytes.to_vec()) {
                        Ok(text) => text,
                        Err(_) => continue,
                    },
                    Some(Ok(_)) => continue,
                    Some(Err(_)) | None => break,
                }
            }
        };
        let Ok(frame) = serde_json::from_str::<AgentFrame>(&frame) else {
            continue;
        };
        match frame {
            AgentFrame::Open {
                id,
                ws,
                method,
                path,
                headers,
            } => {
                if ws {
                    let live = spawn_socket(id, path, headers, port, out_tx.clone());
                    sockets.lock().insert(id, live);
                } else {
                    http.lock().insert(
                        id,
                        PendingHttp {
                            method,
                            path,
                            headers,
                            body: Vec::new(),
                        },
                    );
                }
            }
            AgentFrame::Body { id, b64 } => {
                if let Some(pending) = http.lock().get_mut(&id) {
                    pending.body.extend(b64_to_bytes(&b64));
                }
            }
            AgentFrame::End { id } => {
                let pending = http.lock().remove(&id);
                if let Some(pending) = pending {
                    spawn_http(id, pending, port, out_tx.clone(), client.clone());
                }
            }
            AgentFrame::Data { id, b64, text } => {
                let sender = sockets.lock().get(&id).map(|s| s.frames.clone());
                if let Some(sender) = sender {
                    // `try_send`, never `send().await`: awaiting a full channel
                    // stalls this loop, and this loop is the only reader for
                    // *every* stream on the connection — one wedged local socket
                    // would freeze the phone's whole session. A socket that
                    // cannot keep up loses its stream instead.
                    match sender.try_send((b64_to_bytes(&b64), text.unwrap_or(true))) {
                        Ok(()) => {}
                        Err(mpsc::error::TrySendError::Full(_)) => {
                            if let Some(live) = sockets.lock().remove(&id) {
                                live.task.abort();
                            }
                            let _ = send(
                                &out_tx,
                                &ClientFrame::Error {
                                    id,
                                    message: "本机 socket 积压过多，已断开该连接".into(),
                                },
                            )
                            .await;
                        }
                        // Receiver gone: the stream's task already ended.
                        Err(mpsc::error::TrySendError::Closed(_)) => {
                            sockets.lock().remove(&id);
                        }
                    }
                }
            }
            AgentFrame::Close { id } => {
                if let Some(live) = sockets.lock().remove(&id) {
                    live.task.abort();
                }
                http.lock().remove(&id);
            }
        }
    }

    for (_, live) in sockets.lock().drain() {
        live.task.abort();
    }
    http.lock().clear();
    drop(out_tx);
    let _ = writer.await;
}

/// Serve one HTTP stream against the local bridge and stream it back.
fn spawn_http(
    id: u64,
    pending: PendingHttp,
    port: u16,
    out: mpsc::Sender<OutFrame>,
    client: reqwest::Client,
) {
    tokio::spawn(async move {
        // The path comes from a remote Open frame; only a real path keeps the
        // 127.0.0.1 authority — `@host/…` would be parsed as userinfo and the
        // request would leave the machine for a host of the caller's choice.
        if !pending.path.starts_with('/') {
            let _ = send(
                &out,
                &ClientFrame::Error {
                    id,
                    message: format!("请求路径无效：{}", pending.path),
                },
            )
            .await;
            return;
        }
        let url = format!("http://127.0.0.1:{port}{}", pending.path);
        let method =
            reqwest::Method::from_bytes(pending.method.as_bytes()).unwrap_or(reqwest::Method::GET);
        let mut request = client.request(method, &url).header(VIA_HEADER, "relay");
        for (name, value) in &pending.headers {
            if HOP_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
                continue;
            }
            request = request.header(name, value);
        }
        let response = match request.body(pending.body).send().await {
            Ok(response) => response,
            Err(e) => {
                let _ = send(
                    &out,
                    &ClientFrame::Error {
                        id,
                        message: format!("本机请求失败：{e}"),
                    },
                )
                .await;
                return;
            }
        };

        let status = response.status().as_u16();
        let mut headers = HashMap::new();
        for (name, value) in response.headers() {
            let name = name.as_str().to_ascii_lowercase();
            if HOP_HEADERS.contains(&name.as_str()) {
                continue;
            }
            if let Ok(value) = value.to_str() {
                headers.insert(name, value.to_string());
            }
        }
        if send(
            &out,
            &ClientFrame::Head {
                id,
                status,
                headers,
            },
        )
        .await
        .is_err()
        {
            return;
        }

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    if send(
                        &out,
                        &ClientFrame::Data {
                            id,
                            b64: bytes_to_b64(&bytes),
                            text: None,
                        },
                    )
                    .await
                    .is_err()
                    {
                        return;
                    }
                }
                Err(e) => {
                    let _ = send(
                        &out,
                        &ClientFrame::Error {
                            id,
                            message: format!("读取响应失败：{e}"),
                        },
                    )
                    .await;
                    return;
                }
            }
        }
        let _ = send(&out, &ClientFrame::Close { id }).await;
    });
}

/// Dial the bridge's socket route and pipe payloads both ways.
fn spawn_socket(
    id: u64,
    path: String,
    headers: HashMap<String, String>,
    port: u16,
    out: mpsc::Sender<OutFrame>,
) -> LiveSocket {
    let (frames_tx, mut frames_rx) = mpsc::channel::<(Vec<u8>, bool)>(256);
    let handle = tokio::spawn(async move {
        let target = format!("ws://127.0.0.1:{port}{path}");
        let Ok(mut request) = target.into_client_request() else {
            let _ = send(
                &out,
                &ClientFrame::Error {
                    id,
                    message: "socket path is invalid".into(),
                },
            )
            .await;
            return;
        };
        request.headers_mut().insert(
            tokio_tungstenite::tungstenite::http::HeaderName::from_static(VIA_HEADER),
            tokio_tungstenite::tungstenite::http::HeaderValue::from_static("relay"),
        );
        for (name, value) in &headers {
            // HOP_HEADERS carries VIA_HEADER, so the tag set just above cannot
            // be overwritten by a phone that sent its own — `insert` below
            // would otherwise replace it and the bridge would stop seeing the
            // request as relayed. `origin` and the handshake's own
            // `sec-websocket-*` belong to this hop only.
            if HOP_HEADERS.contains(&name.to_ascii_lowercase().as_str())
                || name.to_ascii_lowercase().starts_with("sec-websocket")
                || name.eq_ignore_ascii_case("origin")
            {
                continue;
            }
            if let (Ok(name), Ok(value)) = (
                name.parse::<tokio_tungstenite::tungstenite::http::HeaderName>(),
                value.parse::<tokio_tungstenite::tungstenite::http::HeaderValue>(),
            ) {
                request.headers_mut().insert(name, value);
            }
        }

        let socket = match tokio_tungstenite::connect_async(request).await {
            Ok((socket, _)) => socket,
            Err(e) => {
                let _ = send(
                    &out,
                    &ClientFrame::Error {
                        id,
                        message: format!("本机 socket 连接失败：{e}"),
                    },
                )
                .await;
                return;
            }
        };
        let (mut ws_tx, mut ws_rx) = socket.split();

        loop {
            tokio::select! {
                frame = frames_rx.recv() => match frame {
                    Some((bytes, as_text)) => {
                        // The bridge speaks JSON text; sending the phone's
                        // frames as binary made its handler ignore every one of
                        // them, which is why the web UI stayed empty.
                        let message = if as_text {
                            Message::Text(String::from_utf8_lossy(&bytes).into_owned().into())
                        } else {
                            Message::Binary(bytes.into())
                        };
                        if ws_tx.send(message).await.is_err() {
                            break;
                        }
                    }
                    None => {
                        let _ = ws_tx.send(Message::Close(None)).await;
                        break;
                    }
                },
                message = ws_rx.next() => match message {
                    Some(Ok(Message::Binary(bytes))) => {
                        if send(
                            &out,
                            &ClientFrame::Data { id, b64: bytes_to_b64(&bytes), text: Some(false) },
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        if send(
                            &out,
                            &ClientFrame::Data { id, b64: bytes_to_b64(text.as_bytes()), text: Some(true) },
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                },
            }
        }
        let _ = send(&out, &ClientFrame::Close { id }).await;
    });
    LiveSocket {
        frames: frames_tx,
        task: handle.abort_handle(),
    }
}

async fn send(out: &mpsc::Sender<OutFrame>, frame: &ClientFrame) -> Result<(), ()> {
    let Ok(text) = serde_json::to_string(frame) else {
        return Err(());
    };
    out.send(OutFrame::Text(text)).await.map_err(|_| ())
}

fn b64_to_bytes(text: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap_or_default()
}

fn bytes_to_b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn set_connected(app: &tauri::AppHandle, generation: u64, connected: bool) {
    let state = app.state::<crate::AppState>();
    {
        let mut guard = state.relay.inner.lock();
        if let Some(running) = guard.as_mut().filter(|r| r.generation == generation) {
            running.info.connected = connected;
        }
    }
    broadcast_relay(app);
}

fn set_error(app: &tauri::AppHandle, generation: u64, message: String) {
    let state = app.state::<crate::AppState>();
    {
        let mut guard = state.relay.inner.lock();
        if let Some(running) = guard.as_mut().filter(|r| r.generation == generation) {
            running.info.error = (!message.is_empty()).then_some(message);
        }
    }
    broadcast_relay(app);
}

fn broadcast_relay(app: &tauri::AppHandle) {
    // Through the sink: the bridge forwards sink events to phones, plain
    // `app.emit` would stop at the webview.
    use crate::event_sink::Emit;
    app.state::<crate::AppState>()
        .emitters
        .emit_json("web://relay", "null");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pack must be a zip any unzipper accepts: correct per-entry CRC and
    /// sizes are exactly what a wrong hand-rolled header gets wrong, and the
    /// key has to be baked in or the deployed Worker rejects every agent.
    #[test]
    fn deploy_pack_is_a_valid_store_zip() {
        let key = "TESTKEY23456789BCDFGHJKLMNPQRST";
        let pack = deploy_pack(key);
        assert_eq!(&pack[0..4], b"PK\x03\x04", "local file header");
        let eocd = pack.len() - 22;
        assert_eq!(
            &pack[eocd..eocd + 4],
            b"PK\x05\x06",
            "end of central directory"
        );
        assert_eq!(
            u16::from_le_bytes([pack[eocd + 10], pack[eocd + 11]]),
            3,
            "entry count"
        );

        let mut offset = 0usize;
        let mut names = Vec::new();
        for _ in 0..3 {
            let crc = u32::from_le_bytes(pack[offset + 14..offset + 18].try_into().unwrap());
            let size =
                u32::from_le_bytes(pack[offset + 18..offset + 22].try_into().unwrap()) as usize;
            assert_eq!(
                u16::from_le_bytes(pack[offset + 8..offset + 10].try_into().unwrap()),
                0,
                "method must be store"
            );
            let name_len =
                u16::from_le_bytes(pack[offset + 26..offset + 28].try_into().unwrap()) as usize;
            let data_start = offset + 30 + name_len;
            let name = String::from_utf8_lossy(&pack[offset + 30..data_start]).to_string();
            let data = &pack[data_start..data_start + size];
            assert_eq!(crc32(data), crc, "crc mismatch for {name}");
            names.push(name);
            offset = data_start + size;
        }
        assert_eq!(
            names,
            [
                "ccgui-relay/README.txt",
                "ccgui-relay/wrangler.toml",
                "ccgui-relay/src/index.js",
            ]
        );
        assert!(String::from_utf8_lossy(&pack).contains(key), "key baked in");
    }

    /// A dial that fails must not end the session. It used to: the first
    /// connect error called `give_up`, dropped `RelayState`, and left the
    /// switch reading 连接中转 — a Cloudflare blip became a manual repair,
    /// because nothing brought the tunnel back until the user toggled it.
    #[tokio::test]
    async fn a_failed_dial_is_retried_instead_of_ending_the_session() {
        let (stop_tx, mut stop) = watch::channel(false);
        let attempts = Arc::new(AtomicU64::new(0));
        let counted = Arc::clone(&attempts);
        let failures = Arc::new(Mutex::new(Vec::<(u32, String)>::new()));
        let reported = Arc::clone(&failures);
        // The second failure flips the switch off. A give-up implementation
        // would have returned after the first, so two attempts prove the retry.
        let dial = move || {
            let n = counted.fetch_add(1, Ordering::SeqCst) + 1;
            let stop = stop_tx.clone();
            async move {
                if n >= 2 {
                    let _ = stop.send(true);
                }
                Err::<(), String>("cloudflare unavailable".into())
            }
        };

        let outcome = redial_until_connected(&mut stop, dial, |attempt, error| {
            reported.lock().push((attempt, error));
        })
        .await;

        assert!(outcome.is_none(), "only stop ends the loop");
        assert_eq!(
            attempts.load(Ordering::SeqCst),
            2,
            "the failed dial was retried"
        );
        assert_eq!(
            failures.lock().len(),
            2,
            "every failure reaches the settings card"
        );
    }

    /// Unattended machines are reachable by contract: with the switch on, a
    /// Worker that stays down is retried for as long as it takes, and only the
    /// switch itself ends the loop. Six consecutive failures used to be three
    /// more than the old code survived.
    #[tokio::test(start_paused = true)]
    async fn a_worker_that_stays_down_is_retried_indefinitely() {
        let (stop_tx, mut stop) = watch::channel(false);
        let dialed = Arc::new(AtomicU64::new(0));
        let counted = Arc::clone(&dialed);
        let dial = move || {
            let attempt = counted.fetch_add(1, Ordering::SeqCst) + 1;
            let stop = stop_tx.clone();
            async move {
                if attempt >= 6 {
                    let _ = stop.send(true);
                }
                Err::<(), String>(format!("cloudflare unavailable #{attempt}"))
            }
        };
        let reported = Arc::new(Mutex::new(Vec::<u32>::new()));
        let log = Arc::clone(&reported);

        let outcome = redial_until_connected(&mut stop, dial, move |attempt, error| {
            assert!(error.contains("cloudflare unavailable"));
            log.lock().push(attempt);
        })
        .await;

        assert!(outcome.is_none(), "only the switch ends the loop");
        assert_eq!(dialed.load(Ordering::SeqCst), 6, "every failure redialed");
        assert_eq!(
            reported.lock().as_slice(),
            &[1, 2, 3, 4, 5, 6],
            "the switch can show how many times it has tried"
        );
    }

    /// 无人值守 is what makes a relaunch dial: an address on file is not
    /// enough, and the marker needs both halves of the address to be usable.
    #[test]
    fn autostart_follows_the_unattended_marker() {
        let mut settings = crate::settings::AppSettings::default();
        assert!(autostart_target(&settings).is_none(), "off until asked for");
        settings.web_relay_url = Some("https://relay.example".into());
        settings.web_relay_key = Some("KEY".into());
        assert!(
            autostart_target(&settings).is_none(),
            "an address alone is not a request to reconnect"
        );
        settings.web_relay_unattended = Some(true);
        assert_eq!(
            autostart_target(&settings),
            Some(("https://relay.example".to_string(), "KEY".to_string()))
        );
        settings.web_relay_unattended = Some(false);
        assert!(autostart_target(&settings).is_none(), "off stays off");

        settings.web_relay_unattended = Some(true);
        settings.web_relay_key = Some("   ".into());
        assert!(
            autostart_target(&settings).is_none(),
            "a blank key cannot dial"
        );
    }

    /// A dial that never answers must not park the agent task: the deadline
    /// turns the hang into one reported failure and the loop redials.
    #[tokio::test(start_paused = true)]
    async fn a_hung_dial_times_out_and_is_retried() {
        let (stop_tx, mut stop) = watch::channel(false);
        let dialed = Arc::new(AtomicU64::new(0));
        let counted = Arc::clone(&dialed);
        let dial = move || {
            let attempt = counted.fetch_add(1, Ordering::SeqCst) + 1;
            let stop = stop_tx.clone();
            async move {
                if attempt >= 2 {
                    let _ = stop.send(true);
                }
                // A half-open Worker: the handshake never answers.
                std::future::pending::<Result<(), String>>().await
            }
        };
        let failures = Arc::new(Mutex::new(Vec::<String>::new()));
        let reported = Arc::clone(&failures);

        let outcome = redial_until_connected(&mut stop, dial, move |_, error| {
            reported.lock().push(error);
        })
        .await;

        assert!(outcome.is_none(), "only stop ends the loop");
        assert_eq!(
            dialed.load(Ordering::SeqCst),
            2,
            "the timed-out dial was retried"
        );
        assert!(
            failures.lock()[0].contains("超时"),
            "the hang is reported as a timeout"
        );
    }

    /// The stop watch must win over a dial that never answers — otherwise
    /// switching the relay off leaves the agent task parked in the handshake.
    #[tokio::test(start_paused = true)]
    async fn the_switch_cancels_a_hung_dial() {
        let (stop_tx, mut stop) = watch::channel(false);
        let dial = || std::future::pending::<Result<(), String>>();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let _ = stop_tx.send(true);
        });

        let started = tokio::time::Instant::now();
        let outcome = redial_until_connected(&mut stop, dial, |_, _| {}).await;

        assert!(outcome.is_none(), "a stopped dial never publishes a socket");
        assert!(
            started.elapsed() < CONNECT_TIMEOUT,
            "the switch ended the dial long before the deadline"
        );
    }

    /// A handshake that completes as the switch flips must not be served:
    /// the socket is dropped, not published.
    #[tokio::test]
    async fn a_socket_won_as_the_switch_flips_is_not_published() {
        let (stop_tx, mut stop) = watch::channel(false);
        let dial = move || {
            let stop = stop_tx.clone();
            async move {
                let _ = stop.send(true);
                tokio::task::yield_now().await;
                Ok::<u8, String>(7)
            }
        };

        let outcome = redial_until_connected(&mut stop, dial, |_, _| {}).await;

        assert!(outcome.is_none(), "stop beats a late success");
    }

    /// A path that is not a path must never leave 127.0.0.1: `@host/…` in an
    /// Open frame would otherwise be parsed as userinfo and the local request
    /// would go to a host of the remote's choosing.
    #[tokio::test]
    async fn a_remote_path_that_is_not_a_path_is_rejected() {
        let (out, mut rx) = mpsc::channel(1);
        spawn_http(
            7,
            PendingHttp {
                method: "GET".into(),
                path: "@169.254.169.254/latest/meta-data".into(),
                headers: HashMap::new(),
                body: Vec::new(),
            },
            9, // nothing listens; the request must never be attempted
            out,
            reqwest::Client::new(),
        );

        let Some(OutFrame::Text(text)) = rx.recv().await else {
            panic!("an invalid path answers with an error frame");
        };
        let frame: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(frame["t"], "error");
        assert_eq!(frame["id"], 7);
        assert!(frame["message"].as_str().unwrap().contains("路径"));
    }

    #[test]
    fn full_outbound_queue_does_not_arm_heartbeat_timeout() {
        let (out, _rx) = mpsc::channel(1);
        assert!(
            out.try_send(OutFrame::Ping).is_ok(),
            "fill the only queue slot"
        );
        let mut ping_sent_at = None;

        assert!(queue_heartbeat(&out, &mut ping_sent_at));
        assert!(
            ping_sent_at.is_none(),
            "a Ping that never entered the queue cannot be awaited"
        );
    }

    #[test]
    fn redial_backoff_grows_then_caps() {
        assert_eq!(redial_delay(0).as_millis(), 1_000);
        assert_eq!(redial_delay(1).as_millis(), 1_000);
        assert_eq!(redial_delay(2).as_millis(), 2_000);
        assert_eq!(redial_delay(6).as_millis(), 30_000);
        assert_eq!(redial_delay(99).as_millis(), 30_000);
    }

    #[test]
    fn relay_key_is_url_safe_and_long() {
        let key = new_relay_key();
        assert_eq!(key.len(), 32);
        assert!(key.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    /// Start a router on an ephemeral loopback port; returns the port. Stands
    /// in for whichever end the test needs: the local bridge, or the Worker
    /// holding the agent socket.
    async fn serve_local(router: axum::Router) -> u16 {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        port
    }

    /// Collect this stream's frames until it closes, folding them into
    /// (status, body). Panics on an `error` frame: the tests below all describe
    /// hops that must succeed.
    async fn drain_stream(
        frames: &mut mpsc::Receiver<OutFrame>,
        id: u64,
    ) -> (Option<u64>, Vec<u8>) {
        let mut status = None;
        let mut body = Vec::new();
        loop {
            let text = match tokio::time::timeout(std::time::Duration::from_secs(5), frames.recv())
                .await
                .expect("the stream produced no frame")
                .expect("the stream ended without closing")
            {
                OutFrame::Text(text) => text,
                OutFrame::Ping => continue,
            };
            let value: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert_eq!(value["id"], id, "every frame carries its stream id");
            match value["t"].as_str().unwrap() {
                "head" => status = value["status"].as_u64(),
                "data" => body.extend(b64_to_bytes(value["b64"].as_str().unwrap())),
                "close" => return (status, body),
                other => panic!("unexpected {other} frame: {text}"),
            }
        }
    }

    /// The HTTP hop end to end: the bridge sees the phone's method, path and
    /// body, the answer comes back as head → data → close, and the hop carries
    /// exactly one `VIA_HEADER` — ours. A phone that sends its own copy is
    /// telling the bridge how to classify itself, which is the gate's input.
    #[tokio::test]
    async fn http_stream_round_trips_and_owns_the_via_tag() {
        #[derive(Clone)]
        struct Seen(Arc<Mutex<Vec<String>>>);

        let seen = Seen(Arc::new(Mutex::new(Vec::new())));
        let bridge = axum::Router::new()
            .route(
                "/echo",
                axum::routing::post(
                    |axum::extract::State(seen): axum::extract::State<Seen>,
                     headers: axum::http::HeaderMap,
                     body: String| async move {
                        seen.0.lock().push(
                            headers
                                .get_all(VIA_HEADER)
                                .iter()
                                .map(|value| value.to_str().unwrap_or_default().to_string())
                                .collect::<Vec<_>>()
                                .join(","),
                        );
                        (axum::http::StatusCode::CREATED, body)
                    },
                ),
            )
            .with_state(seen.clone());
        let port = serve_local(bridge).await;

        let (out, mut frames) = mpsc::channel::<OutFrame>(32);
        let mut headers = HashMap::new();
        // The phone's own claim about the hop, and a hop-by-hop header that
        // would describe a body length reqwest is about to set itself.
        headers.insert(VIA_HEADER.to_string(), "lan".to_string());
        headers.insert("content-length".to_string(), "999".to_string());
        spawn_http(
            7,
            PendingHttp {
                method: "POST".into(),
                path: "/echo".into(),
                headers,
                body: b"hello relay".to_vec(),
            },
            port,
            out,
            reqwest::Client::new(),
        );

        let (status, body) = drain_stream(&mut frames, 7).await;
        assert_eq!(status, Some(201));
        assert_eq!(String::from_utf8(body).unwrap(), "hello relay");
        assert_eq!(
            seen.0.lock().as_slice(),
            ["relay"],
            "one via header, ours: the phone may neither add nor replace it"
        );
    }

    /// Socket payloads keep their frame type in both directions. The bridge
    /// speaks JSON text and the app's client parses text; when this regressed,
    /// every reply reached the browser as bytes and the web UI rendered empty.
    #[tokio::test]
    async fn socket_frames_keep_text_and_binary_apart() {
        let bridge = axum::Router::new().route(
            "/ws",
            axum::routing::get(|ws: axum::extract::WebSocketUpgrade| async move {
                ws.on_upgrade(|mut socket| async move {
                    use axum::extract::ws::Message as Axum;
                    // Echo each frame back in the kind it arrived in.
                    while let Some(Ok(message)) = socket.recv().await {
                        let echo = match message {
                            Axum::Text(text) => Axum::Text(text),
                            Axum::Binary(bytes) => Axum::Binary(bytes),
                            Axum::Close(_) => break,
                            _ => continue,
                        };
                        if socket.send(echo).await.is_err() {
                            break;
                        }
                    }
                })
            }),
        );
        let port = serve_local(bridge).await;

        let (out, mut frames) = mpsc::channel::<OutFrame>(32);
        let live = spawn_socket(11, "/ws".into(), HashMap::new(), port, out);
        let text_payload = br#"{"type":"hello"}"#.to_vec();
        // Deliberately not UTF-8: a binary frame decoded as text would corrupt.
        let binary_payload = vec![0xff, 0x00, 0x01];
        live.frames
            .send((text_payload.clone(), true))
            .await
            .unwrap();
        live.frames
            .send((binary_payload.clone(), false))
            .await
            .unwrap();

        let mut got = Vec::new();
        while got.len() < 2 {
            let text = match tokio::time::timeout(std::time::Duration::from_secs(5), frames.recv())
                .await
                .expect("the socket produced no frame")
                .expect("the socket closed before both echoes")
            {
                OutFrame::Text(text) => text,
                OutFrame::Ping => continue,
            };
            let value: serde_json::Value = serde_json::from_str(&text).unwrap();
            if value["t"] == "data" {
                got.push((
                    b64_to_bytes(value["b64"].as_str().unwrap()),
                    value["text"].as_bool(),
                ));
            }
        }
        assert_eq!(got[0], (text_payload, Some(true)), "text stays text");
        assert_eq!(got[1], (binary_payload, Some(false)), "bytes stay bytes");
        live.task.abort();
    }

    /// `serve` assembles `open` + every `body` + `end` into one request. The
    /// Worker splits bodies across frames as a matter of course, so dropping
    /// one would silently truncate an upload rather than fail it.
    #[tokio::test]
    async fn serve_assembles_a_split_body_before_dispatching() {
        let bridge = axum::Router::new().route(
            "/upload",
            axum::routing::post(|body: String| async move { body }),
        );
        let bridge_port = serve_local(bridge).await;

        let scripted = Arc::new(vec![
            serde_json::json!({"t":"open","id":3,"method":"POST","path":"/upload","headers":{}})
                .to_string(),
            serde_json::json!({"t":"body","id":3,"b64":bytes_to_b64(b"first ")}).to_string(),
            serde_json::json!({"t":"body","id":3,"b64":bytes_to_b64(b"second")}).to_string(),
            serde_json::json!({"t":"end","id":3}).to_string(),
        ]);
        let (got_tx, mut got_rx) = mpsc::channel::<OutFrame>(32);
        let worker = axum::Router::new()
            .route(
                "/agent",
                axum::routing::get(
                    |axum::extract::State((scripted, got)): axum::extract::State<(
                        Arc<Vec<String>>,
                        mpsc::Sender<OutFrame>,
                    )>,
                     ws: axum::extract::WebSocketUpgrade| async move {
                        ws.on_upgrade(move |mut socket| async move {
                            use axum::extract::ws::Message as Axum;
                            for frame in scripted.iter() {
                                if socket.send(Axum::Text(frame.clone().into())).await.is_err() {
                                    return;
                                }
                            }
                            while let Some(Ok(Axum::Text(text))) = socket.recv().await {
                                if got.send(OutFrame::Text(text.to_string())).await.is_err() {
                                    return;
                                }
                            }
                        })
                    },
                ),
            )
            .with_state((scripted, got_tx));
        let worker_port = serve_local(worker).await;

        let (socket, _) =
            tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{worker_port}/agent"))
                .await
                .unwrap();
        let (stop_tx, stop_rx) = watch::channel(false);
        let served = tokio::spawn(async move {
            let mut stop = stop_rx;
            serve(socket, bridge_port, &mut stop).await;
        });

        let (status, body) = drain_stream(&mut got_rx, 3).await;
        assert_eq!(status, Some(200));
        assert_eq!(
            String::from_utf8(body).unwrap(),
            "first second",
            "both body frames have to reach the bridge"
        );

        let _ = stop_tx.send(true);
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), served).await;
    }
}
