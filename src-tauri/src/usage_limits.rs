//! Read-only subscription rate-limit lookup for Claude and Codex.
//!
//! Claude reads the Claude Code login (macOS Keychain, else
//! `<claude home>/.credentials.json`) and asks `api.anthropic.com`; Codex
//! reads `<codex home>/auth.json` and asks `chatgpt.com`. Credentials are
//! never refreshed, rotated or written, and never leave this module: callers
//! only see plan labels, window percentages, reset times and extra-usage
//! amounts. Each provider has a 60 s result cache, a 1 → 2 → 5 → 10 min
//! backoff after 429/503, and its last good result persisted (secret-free)
//! to `<app home>/usage-limits-cache.json`.
//!
//! Approach borrowed from TokenTracker (MIT, © 2026 xiufengsun); rules taken
//! from it are marked "Mirrors TokenTracker (MIT)".

mod claude;
mod codex;
pub(crate) mod consent;
mod credentials;
mod store;
#[cfg(test)]
mod tests;
mod transport;

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use credentials::{CredRead, CredentialSource, SystemCredentials};
use store::{GoodData, ProviderState, Store, CACHE_TTL_MS, REFRESH_MIN_INTERVAL_MS};
use transport::{HttpOutcome, HttpRequest, LimitsHttp, ReqwestHttp};

pub(crate) const KIND_SESSION: &str = "session";
pub(crate) const KIND_WEEKLY: &str = "weekly";
pub(crate) const KIND_OTHER: &str = "other";
pub(crate) const SESSION_WINDOW_SECONDS: i64 = 18_000;
pub(crate) const WEEKLY_WINDOW_SECONDS: i64 = 604_800;
const CACHE_FILE: &str = "usage-limits-cache.json";
const MAX_ECHOED_ID_CHARS: usize = 32;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    /// "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" |
    /// "scoped:<model>" (Claude); "session" | "weekly" | "other:<…>" (Codex).
    pub id: String,
    /// "session" | "weekly" | "other".
    pub kind: String,
    /// Model name for model-scoped windows ("Opus", "Fable", …).
    pub label: Option<String>,
    /// 0..=100.
    pub used_percent: f64,
    pub window_seconds: Option<i64>,
    /// Epoch ms.
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtraUsage {
    pub used_usd: f64,
    pub limit_usd: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLimits {
    /// "claude" | "codex".
    pub id: String,
    /// "ok" | "signedOut" | "expired" | "rateLimited" | "offline" | "error".
    pub status: String,
    pub plan: Option<String>,
    pub windows: Vec<LimitWindow>,
    pub extra: Option<ExtraUsage>,
    /// When `windows` / `extra` were fetched (epoch ms); older than now when
    /// a failed lookup serves the last good data.
    pub fetched_at: Option<i64>,
    /// While rate-limited: no request is made before this time (epoch ms).
    pub retry_at: Option<i64>,
    /// Short, secret-free reason for `error`.
    pub error: Option<String>,
    pub host: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitsResponse {
    pub providers: Vec<ProviderLimits>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProviderId {
    Claude,
    Codex,
}

impl ProviderId {
    const ALL: [ProviderId; 2] = [ProviderId::Claude, ProviderId::Codex];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            ProviderId::Claude => "claude",
            ProviderId::Codex => "codex",
        }
    }

    pub(crate) fn parse(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == id)
    }

    fn host(self) -> &'static str {
        match self {
            ProviderId::Claude => claude::HOST,
            ProviderId::Codex => codex::HOST,
        }
    }

    /// Answers meaning "the CLI login no longer works". Only 401: chatgpt.com
    /// also answers 403 for Cloudflare challenges, and telling the user to log
    /// in again would not fix those — they surface as `error` "HTTP 403".
    fn is_auth_failure(self, status: u16) -> bool {
        status == 401
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Status {
    Ok,
    SignedOut,
    Expired,
    RateLimited,
    Offline,
    Error,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Ok => "ok",
            Status::SignedOut => "signedOut",
            Status::Expired => "expired",
            Status::RateLimited => "rateLimited",
            Status::Offline => "offline",
            Status::Error => "error",
        }
    }
}

/// Injected dependencies; production wires reqwest, the real credential
/// stores and the wall clock.
pub(crate) struct Env<'a> {
    pub http: &'a dyn LimitsHttp,
    pub creds: &'a dyn CredentialSource,
    pub now: &'a (dyn Fn() -> i64 + Send + Sync),
}

static STORE: LazyLock<Store> =
    LazyLock::new(|| Store::new(Some(crate::paths::app_home().join(CACHE_FILE))));

/// Look up the requested providers (`None` = all) concurrently. Unknown ids
/// are rejected. `refresh` skips the 60 s cache but never an active 429
/// backoff.
pub async fn get(providers: Option<Vec<String>>, refresh: bool) -> Result<LimitsResponse, String> {
    let ids = resolve_ids(providers)?;
    // Nothing below may touch a credential store before the user agreed.
    consent::require()?;
    let http = ReqwestHttp::new();
    let env = Env {
        http: &http,
        creds: &SystemCredentials,
        now: &system_now_ms,
    };
    Ok(lookup(&env, &STORE, &ids, refresh).await)
}

fn resolve_ids(requested: Option<Vec<String>>) -> Result<Vec<ProviderId>, String> {
    let Some(requested) = requested else {
        return Ok(ProviderId::ALL.to_vec());
    };
    let mut ids: Vec<ProviderId> = Vec::new();
    for raw in &requested {
        let Some(id) = ProviderId::parse(raw.trim()) else {
            let shown: String = raw.chars().take(MAX_ECHOED_ID_CHARS).collect();
            return Err(format!("unknown limits provider: {shown:?}"));
        };
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

fn system_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

async fn lookup(env: &Env<'_>, store: &Store, ids: &[ProviderId], refresh: bool) -> LimitsResponse {
    let lookups = ids.iter().map(|id| resolve(env, store, *id, refresh));
    LimitsResponse {
        providers: futures_util::future::join_all(lookups).await,
    }
}

/// One provider: cache → backoff gate → network. The slot lock is held
/// across the request, so concurrent callers queue and reuse the result.
async fn resolve(
    env: &Env<'_>,
    store: &Store,
    provider: ProviderId,
    refresh: bool,
) -> ProviderLimits {
    let slot = store.slot(provider);
    let seen_generation = slot.generation();
    let mut state = slot.state.lock().await;
    store.seed(provider, &mut state);
    let now = (env.now)();
    if slot.generation() != seen_generation {
        if let Some((result, _)) = &state.last_result {
            return result.clone();
        }
    }
    if let Some(retry_at) = state.active_retry_at(now) {
        return rate_limited_result(provider, &state, retry_at);
    }
    // An explicit refresh still reuses a result younger than
    // REFRESH_MIN_INTERVAL_MS: a plugin calling refresh in a loop must not turn
    // into one OAuth-authenticated vendor request per call.
    let max_age = if refresh { REFRESH_MIN_INTERVAL_MS } else { CACHE_TTL_MS };
    if let Some(cached) = cached_result(provider, &state, now, max_age) {
        return cached;
    }
    let result = fetch(env, store, provider, &mut state).await;
    state.last_result = Some((result.clone(), (env.now)()));
    slot.bump();
    result
}

fn cached_result(
    provider: ProviderId,
    state: &ProviderState,
    now: i64,
    max_age_ms: i64,
) -> Option<ProviderLimits> {
    let fresh = |at: i64| now >= at && now - at < max_age_ms;
    match &state.last_result {
        Some((result, at)) => fresh(*at).then(|| result.clone()),
        // Right after a restart only the persisted copy exists.
        None => state
            .last_good
            .as_ref()
            .filter(|good| fresh(good.fetched_at))
            .map(|good| View::new(provider, Status::Ok).data(Some(good)).build()),
    }
}

fn rate_limited_result(
    provider: ProviderId,
    state: &ProviderState,
    retry_at: i64,
) -> ProviderLimits {
    let previous_plan = state.last_result.as_ref().and_then(|(r, _)| r.plan.clone());
    View::new(provider, Status::RateLimited)
        .data(state.last_good.as_ref())
        .plan(previous_plan)
        .retry_at(retry_at)
        .build()
}

/// A request ready to send, plus the plan label known from the credentials.
struct Prepared {
    request: HttpRequest,
    plan: Option<String>,
}

/// Credentials settle the outcome without a request.
struct Settled {
    status: Status,
    plan: Option<String>,
    error: Option<&'static str>,
}

impl Settled {
    fn new(status: Status, plan: Option<String>) -> Self {
        Self {
            status,
            plan,
            error: None,
        }
    }

    fn unreadable() -> Self {
        Self {
            status: Status::Error,
            plan: None,
            error: Some("credentials unreadable"),
        }
    }
}

async fn prepare(
    creds: &dyn CredentialSource,
    provider: ProviderId,
    now: i64,
) -> Result<Prepared, Settled> {
    match provider {
        ProviderId::Claude => prepare_claude(creds.claude().await, now),
        ProviderId::Codex => prepare_codex(creds.codex().await, now),
    }
}

fn prepare_claude(read: CredRead<credentials::ClaudeOauth>, now: i64) -> Result<Prepared, Settled> {
    let oauth = match read {
        CredRead::Found(oauth) => oauth,
        CredRead::Missing => return Err(Settled::new(Status::SignedOut, None)),
        CredRead::Unreadable => return Err(Settled::unreadable()),
    };
    let plan = claude::plan_label(
        oauth.subscription_type.as_deref(),
        oauth.rate_limit_tier.as_deref(),
    );
    // Mirrors TokenTracker (MIT): Claude Code blanks the token in place when
    // its login lapses, so an entry without a token means "expired".
    let Some(token) = oauth.access_token.as_ref() else {
        return Err(Settled::new(Status::Expired, plan));
    };
    if claude::token_expired(&oauth, now) {
        return Err(Settled::new(Status::Expired, plan));
    }
    Ok(Prepared {
        request: claude::request(token),
        plan,
    })
}

fn prepare_codex(read: CredRead<credentials::CodexAuth>, now: i64) -> Result<Prepared, Settled> {
    let auth = match read {
        CredRead::Found(auth) => auth,
        CredRead::Missing => return Err(Settled::new(Status::SignedOut, None)),
        CredRead::Unreadable => return Err(Settled::unreadable()),
    };
    let plan = codex::plan_label(auth.plan_hint.as_deref());
    let Some(token) = auth.access_token.as_ref() else {
        return Err(Settled::new(Status::SignedOut, None));
    };
    if codex::token_expired(&auth, now) {
        return Err(Settled::new(Status::Expired, plan));
    }
    Ok(Prepared {
        request: codex::request(token, auth.account_id.as_ref()),
        plan,
    })
}

struct Parsed {
    plan: Option<String>,
    windows: Vec<LimitWindow>,
    extra: Option<ExtraUsage>,
}

fn parse_body(provider: ProviderId, body: &str, now: i64) -> Option<Parsed> {
    match provider {
        ProviderId::Claude => claude::parse_usage(body).map(|usage| Parsed {
            plan: None,
            windows: usage.windows,
            extra: usage.extra,
        }),
        ProviderId::Codex => codex::parse_usage(body, now).map(|usage| Parsed {
            plan: codex::plan_label(usage.plan_type.as_deref()),
            windows: usage.windows,
            extra: None,
        }),
    }
}

async fn fetch(
    env: &Env<'_>,
    store: &Store,
    provider: ProviderId,
    state: &mut ProviderState,
) -> ProviderLimits {
    let prepared = match prepare(env.creds, provider, (env.now)()).await {
        Ok(prepared) => prepared,
        Err(settled) => {
            state.clear_backoff();
            let view = View::new(provider, settled.status).plan(settled.plan);
            return match settled.error {
                Some(reason) => view.data(state.last_good.as_ref()).error(reason).build(),
                None => view.build(),
            };
        }
    };
    let Prepared { request, plan } = prepared;
    let outcome = env.http.get(&request).await;
    drop(request);
    let now = (env.now)();
    let last_good = state.last_good.clone();
    let stale = View::new(provider, Status::Ok)
        .data(last_good.as_ref())
        .plan(plan.clone());
    let (status, body, retry_after_secs) = match outcome {
        HttpOutcome::Network => {
            state.retry_at = None;
            return stale.status(Status::Offline).build();
        }
        HttpOutcome::Response {
            status,
            body,
            retry_after_secs,
        } => (status, body, retry_after_secs),
    };
    if status == 429 || status == 503 {
        let retry_at = state.note_rate_limited(now, retry_after_secs);
        return stale.status(Status::RateLimited).retry_at(retry_at).build();
    }
    state.clear_backoff();
    if provider.is_auth_failure(status) {
        return View::new(provider, Status::Expired).plan(plan).build();
    }
    if !(200..300).contains(&status) {
        return stale
            .status(Status::Error)
            .error(&format!("HTTP {status}"))
            .build();
    }
    let Some(parsed) = parse_body(provider, &body, now) else {
        return stale
            .status(Status::Error)
            .error("unexpected response")
            .build();
    };
    let good = GoodData {
        plan: parsed.plan.or(plan),
        windows: parsed.windows,
        extra: parsed.extra,
        fetched_at: now,
    };
    store.persist(provider, &good);
    let result = View::new(provider, Status::Ok).data(Some(&good)).build();
    state.last_good = Some(good);
    result
}

/// Builds a `ProviderLimits`. `data` carries the last good windows; its plan
/// wins over the credential-derived fallback because it matches the windows
/// shown.
struct View<'a> {
    provider: ProviderId,
    status: Status,
    data: Option<&'a GoodData>,
    plan: Option<String>,
    retry_at: Option<i64>,
    error: Option<String>,
}

impl<'a> View<'a> {
    fn new(provider: ProviderId, status: Status) -> Self {
        Self {
            provider,
            status,
            data: None,
            plan: None,
            retry_at: None,
            error: None,
        }
    }

    fn status(self, status: Status) -> Self {
        Self { status, ..self }
    }

    fn data(self, data: Option<&'a GoodData>) -> Self {
        Self { data, ..self }
    }

    fn plan(self, plan: Option<String>) -> Self {
        Self { plan, ..self }
    }

    fn retry_at(self, retry_at: i64) -> Self {
        Self {
            retry_at: Some(retry_at),
            ..self
        }
    }

    fn error(self, reason: &str) -> Self {
        Self {
            error: Some(reason.to_string()),
            ..self
        }
    }

    fn build(self) -> ProviderLimits {
        let plan = self.data.and_then(|d| d.plan.clone()).or(self.plan);
        ProviderLimits {
            id: self.provider.as_str().to_string(),
            status: self.status.as_str().to_string(),
            plan,
            windows: self.data.map(|d| d.windows.clone()).unwrap_or_default(),
            extra: self.data.and_then(|d| d.extra.clone()),
            fetched_at: self.data.map(|d| d.fetched_at),
            retry_at: self.retry_at,
            error: self.error,
            host: self.provider.host().to_string(),
        }
    }
}

/// Percent from a JSON number (or numeric string), clamped to 0..=100.
// Mirrors TokenTracker (MIT): clampPercent.
pub(crate) fn clamp_percent(value: &Value) -> Option<f64> {
    let raw = match value {
        Value::Number(n) => n.as_f64()?,
        Value::String(text) => text.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    raw.is_finite().then(|| clamp_f64(raw))
}

pub(crate) fn clamp_f64(value: f64) -> f64 {
    if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 100.0)
    }
}

/// `plus` → "Plus", `pro_lite` → "Pro Lite"; placeholders → `None`.
// Mirrors TokenTracker (MIT): normalizePlanLabel drops "none"/"unknown"
// (but "free" is kept: the limits page labels free plans).
pub(crate) fn title_case(raw: &str) -> Option<String> {
    let words: Vec<String> = raw
        .split(|c: char| c == '_' || c == '-' || c.is_whitespace())
        .filter(|w| !w.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            let first = chars.next().map(|c| c.to_uppercase().collect::<String>());
            first.unwrap_or_default() + &chars.as_str().to_lowercase()
        })
        .collect();
    let label = words.join(" ");
    let lower = label.to_ascii_lowercase();
    if label.is_empty() || lower == "none" || lower == "unknown" {
        return None;
    }
    Some(label)
}
