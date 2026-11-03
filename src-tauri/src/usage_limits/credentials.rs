//! Read-only access to the CLIs' own logins. Nothing here refreshes, rotates
//! or writes a credential; tokens live in `Secret` (redacted `Debug`, no
//! `Serialize`) and never leave the Rust process.

use std::path::PathBuf;

use base64::Engine as _;
use futures_util::future::BoxFuture;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Claude Code's macOS Keychain generic-password service (base name).
const CLAUDE_KEYCHAIN_SERVICE: &str = "Claude Code-credentials";
const CLAUDE_CREDENTIALS_FILE: &str = ".credentials.json";
const CODEX_AUTH_FILE: &str = "auth.json";
const OPENAI_AUTH_CLAIM: &str = "https://api.openai.com/auth";
#[cfg(target_os = "macos")]
const SECURITY_BIN: &str = "/usr/bin/security";
/// A locked keychain can make `security` wait on a GUI prompt; give up
/// rather than hold the lookup.
#[cfg(target_os = "macos")]
const KEYCHAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// A credential value (token or account id). Redacted in `Debug`, not
/// serializable, so it cannot leak through logs or IPC by accident.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Secret(String);

impl Secret {
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(***)")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CredRead<T> {
    /// No login on this machine (no keychain item / file / OAuth section).
    Missing,
    /// A credential store exists but could not be parsed.
    Unreadable,
    Found(T),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ClaudeOauth {
    /// `None` when Claude Code blanked the token in place (its logged-out /
    /// expired state) while keeping the entry.
    pub access_token: Option<Secret>,
    pub expires_at_ms: Option<i64>,
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct CodexAuth {
    pub access_token: Option<Secret>,
    pub account_id: Option<Secret>,
    /// `chatgpt_plan_type` from the token claims; the usage response's own
    /// `plan_type` wins when present.
    pub plan_hint: Option<String>,
    /// Access-token JWT `exp`, in epoch ms.
    pub expires_at_ms: Option<i64>,
}

pub(crate) trait CredentialSource: Send + Sync {
    fn claude(&self) -> BoxFuture<'_, CredRead<ClaudeOauth>>;
    fn codex(&self) -> BoxFuture<'_, CredRead<CodexAuth>>;
}

/// The real machine: Keychain (macOS) then `<claude home>/.credentials.json`
/// for Claude; `<codex home>/auth.json` for Codex.
pub(crate) struct SystemCredentials;

impl CredentialSource for SystemCredentials {
    fn claude(&self) -> BoxFuture<'_, CredRead<ClaudeOauth>> {
        Box::pin(read_claude_system())
    }

    fn codex(&self) -> BoxFuture<'_, CredRead<CodexAuth>> {
        Box::pin(async {
            match read_optional_file(&codex_auth_path()) {
                CredRead::Found(raw) => parse_codex_auth(&raw),
                CredRead::Missing => CredRead::Missing,
                CredRead::Unreadable => CredRead::Unreadable,
            }
        })
    }
}

async fn read_claude_system() -> CredRead<ClaudeOauth> {
    let keychain = read_claude_keychain_default().await;
    if matches!(keychain, CredRead::Found(_)) {
        return keychain;
    }
    let saw_unreadable = keychain == CredRead::Unreadable;
    let from_file = match read_optional_file(&claude_credentials_path()) {
        CredRead::Found(raw) => parse_claude_payload(&raw),
        CredRead::Missing => CredRead::Missing,
        CredRead::Unreadable => CredRead::Unreadable,
    };
    match from_file {
        CredRead::Missing if saw_unreadable => CredRead::Unreadable,
        other => other,
    }
}

#[cfg(target_os = "macos")]
async fn read_claude_keychain_default() -> CredRead<ClaudeOauth> {
    let Some(service) = claude_keychain_service_default() else {
        return CredRead::Missing;
    };
    read_claude_keychain(&service).await
}

/// The Keychain service the Claude lookup reads; None off macOS, where
/// Claude Code keeps its login only in `.credentials.json`.
pub(super) fn claude_keychain_service_default() -> Option<String> {
    cfg!(target_os = "macos").then(|| {
        claude_keychain_service(
            std::env::var("CLAUDE_SECURESTORAGE_CONFIG_DIR")
                .ok()
                .as_deref(),
            std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref(),
        )
    })
}

#[cfg(not(target_os = "macos"))]
async fn read_claude_keychain_default() -> CredRead<ClaudeOauth> {
    CredRead::Missing
}

pub(super) fn codex_auth_path() -> PathBuf {
    crate::engine::codex_home().join(CODEX_AUTH_FILE)
}

pub(super) fn claude_credentials_path() -> PathBuf {
    crate::engine::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join(CLAUDE_CREDENTIALS_FILE)
}

fn read_optional_file(path: &std::path::Path) -> CredRead<String> {
    match std::fs::read_to_string(path) {
        Ok(raw) if raw.trim().is_empty() => CredRead::Missing,
        Ok(raw) => CredRead::Found(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => CredRead::Missing,
        Err(_) => CredRead::Unreadable,
    }
}

/// Claude Code (2.1.x) suffixes its Keychain service with the first 8 hex
/// chars of sha256(config dir) when `CLAUDE_CONFIG_DIR` is set, and
/// `CLAUDE_SECURESTORAGE_CONFIG_DIR` (when defined) overrides that input —
/// an empty override means "no suffix". Reading the unsuffixed item for a
/// custom config dir would show another login's limits.
/// (Claude Code also NFC-normalizes the path; ASCII paths are unaffected.)
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn claude_keychain_service(
    securestorage_dir: Option<&str>,
    config_dir: Option<&str>,
) -> String {
    let hashed_input = match securestorage_dir {
        Some(dir) => (!dir.is_empty()).then_some(dir),
        None => config_dir.filter(|dir| !dir.is_empty()),
    };
    match hashed_input {
        Some(dir) => {
            let digest = Sha256::digest(dir.as_bytes());
            let suffix: String = digest[..4].iter().map(|b| format!("{b:02x}")).collect();
            format!("{CLAUDE_KEYCHAIN_SERVICE}-{suffix}")
        }
        None => CLAUDE_KEYCHAIN_SERVICE.to_string(),
    }
}

/// Keychain account Claude Code writes under: `$USER` when it is a plain
/// name, else its fixed fallback.
// Mirrors TokenTracker (MIT): account-scoped lookup first, because a
// service-only lookup may pick an older installation's item.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn claude_keychain_account() -> String {
    let user = std::env::var("USER").unwrap_or_default();
    let plain = !user.is_empty()
        && user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if plain {
        user
    } else {
        "claude-code-user".to_string()
    }
}

#[cfg(target_os = "macos")]
async fn read_claude_keychain(service: &str) -> CredRead<ClaudeOauth> {
    let account = claude_keychain_account();
    let mut result = CredRead::Missing;
    for account in [Some(account.as_str()), None] {
        let Some(raw) = security_find_password(service, account).await else {
            continue;
        };
        match parse_claude_payload(raw.expose()) {
            CredRead::Found(oauth) => return CredRead::Found(oauth),
            CredRead::Unreadable => result = CredRead::Unreadable,
            CredRead::Missing => {}
        }
    }
    result
}

/// `security find-generic-password -s <service> [-a <account>] -w`. Any
/// failure (not found, locked, denied, timeout) reads as "no item".
#[cfg(target_os = "macos")]
async fn security_find_password(service: &str, account: Option<&str>) -> Option<Secret> {
    let mut command = tokio::process::Command::new(SECURITY_BIN);
    command.args(["find-generic-password", "-s", service]);
    if let Some(account) = account {
        command.args(["-a", account]);
    }
    command
        .arg("-w")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(KEYCHAIN_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| Secret::new(trimmed))
}

/// Parse Claude Code's credential JSON (Keychain password or
/// `.credentials.json`): `{ claudeAiOauth: { accessToken, expiresAt, … } }`.
pub(crate) fn parse_claude_payload(raw: &str) -> CredRead<ClaudeOauth> {
    let Some(payload) = parse_json_or_hex(raw) else {
        return CredRead::Unreadable;
    };
    let Some(oauth) = payload.get("claudeAiOauth").filter(|v| v.is_object()) else {
        return CredRead::Missing;
    };
    CredRead::Found(ClaudeOauth {
        access_token: non_empty_str(oauth.get("accessToken")).map(Secret::new),
        expires_at_ms: oauth.get("expiresAt").and_then(timestamp_ms),
        subscription_type: scalar_string(oauth.get("subscriptionType")),
        rate_limit_tier: scalar_string(oauth.get("rateLimitTier")),
    })
}

/// Claude Code stores the Keychain password via `security -X <hex>`; the
/// `-w` read normally prints it decoded, but accept the hex form too.
fn parse_json_or_hex(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return value.is_object().then_some(value);
    }
    let decoded = decode_hex(trimmed)?;
    let value = serde_json::from_slice::<Value>(&decoded).ok()?;
    value.is_object().then_some(value)
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if text.is_empty() || text.len() % 2 != 0 {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

/// Parse `<codex home>/auth.json`: `tokens.access_token` / `account_id`,
/// with the account id and plan falling back to the JWT claims.
// Mirrors TokenTracker (MIT): account id and plan type fall back to the
// `https://api.openai.com/auth` claim of the access / id token.
pub(crate) fn parse_codex_auth(raw: &str) -> CredRead<CodexAuth> {
    let Ok(auth) = serde_json::from_str::<Value>(raw.trim()) else {
        return CredRead::Unreadable;
    };
    let tokens = auth.get("tokens");
    let access = non_empty_str(tokens.and_then(|t| t.get("access_token")));
    let Some(access) = access else {
        return CredRead::Missing;
    };
    let access_claims = jwt_claims(&access);
    let id_claims =
        non_empty_str(tokens.and_then(|t| t.get("id_token"))).and_then(|token| jwt_claims(&token));
    let openai_claim = |claims: &Option<Value>, key: &str| {
        claims
            .as_ref()
            .and_then(|c| c.get(OPENAI_AUTH_CLAIM))
            .and_then(|ns| non_empty_str(ns.get(key)))
    };
    let account_id = non_empty_str(tokens.and_then(|t| t.get("account_id")))
        .or_else(|| openai_claim(&access_claims, "chatgpt_account_id"))
        .or_else(|| openai_claim(&id_claims, "chatgpt_account_id"));
    let plan_hint = openai_claim(&access_claims, "chatgpt_plan_type")
        .or_else(|| openai_claim(&id_claims, "chatgpt_plan_type"));
    let expires_at_ms = access_claims
        .as_ref()
        .and_then(|c| c.get("exp"))
        .and_then(timestamp_ms);
    CredRead::Found(CodexAuth {
        access_token: Some(Secret::new(access)),
        account_id: account_id.map(Secret::new),
        plan_hint,
        expires_at_ms,
    })
}

/// Decode a JWT payload without verifying it — only used to read the plan,
/// account id and expiry the CLI itself stored.
fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice::<Value>(&bytes)
        .ok()
        .filter(Value::is_object)
}

fn non_empty_str(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn scalar_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(_) => non_empty_str(value),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// Epoch seconds or ms (number or numeric string), or an RFC 3339 string.
// Mirrors TokenTracker (MIT): numbers below 1e12 are seconds.
pub(crate) fn timestamp_ms(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => {
            let raw = n.as_f64().filter(|v| v.is_finite() && *v > 0.0)?;
            let ms = if raw < 1e12 { raw * 1000.0 } else { raw };
            Some(ms as i64)
        }
        Value::String(text) => crate::history::parse_ts_ms_str(text),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn jwt(claims: Value) -> String {
        let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        format!(
            "{}.{}.sig",
            engine.encode(br#"{"alg":"none"}"#),
            engine.encode(claims.to_string().as_bytes())
        )
    }

    #[test]
    fn claude_payload_reads_oauth_fields() {
        let raw = json!({
            "claudeAiOauth": {
                "accessToken": "sk-ant-oat-test",
                "refreshToken": "sk-ant-ort-test",
                "expiresAt": 1_900_000_000_000_i64,
                "subscriptionType": "max",
                "rateLimitTier": "default_claude_max_20x"
            }
        })
        .to_string();
        let CredRead::Found(oauth) = parse_claude_payload(&raw) else {
            panic!("expected credentials");
        };
        assert_eq!(oauth.access_token, Some(Secret::new("sk-ant-oat-test")));
        assert_eq!(oauth.expires_at_ms, Some(1_900_000_000_000));
        assert_eq!(oauth.subscription_type.as_deref(), Some("max"));
        assert_eq!(
            oauth.rate_limit_tier.as_deref(),
            Some("default_claude_max_20x")
        );
    }

    #[test]
    fn claude_payload_accepts_hex_seconds_and_blank_token() {
        let body = json!({ "claudeAiOauth": { "accessToken": "  ", "expiresAt": 1_900_000_000 } })
            .to_string();
        let hex: String = body.bytes().map(|b| format!("{b:02x}")).collect();
        let CredRead::Found(oauth) = parse_claude_payload(&hex) else {
            panic!("hex payload should parse");
        };
        assert_eq!(oauth.access_token, None);
        assert_eq!(oauth.expires_at_ms, Some(1_900_000_000_000));
    }

    #[test]
    fn claude_payload_missing_and_unreadable() {
        assert_eq!(
            parse_claude_payload(r#"{"mcpOAuth":{}}"#),
            CredRead::Missing
        );
        assert_eq!(parse_claude_payload("not json"), CredRead::Unreadable);
    }

    #[test]
    fn keychain_service_follows_claude_code_suffix_rule() {
        assert_eq!(
            claude_keychain_service(None, None),
            "Claude Code-credentials"
        );
        assert_eq!(
            claude_keychain_service(None, Some("")),
            "Claude Code-credentials"
        );
        // sha256("/tmp/claude-work")[..8] == "bfc1769a"
        assert_eq!(
            claude_keychain_service(None, Some("/tmp/claude-work")),
            "Claude Code-credentials-bfc1769a"
        );
        assert_eq!(
            claude_keychain_service(Some("/tmp/claude-work"), Some("/elsewhere")),
            "Claude Code-credentials-bfc1769a"
        );
        assert_eq!(
            claude_keychain_service(Some(""), Some("/tmp/claude-work")),
            "Claude Code-credentials"
        );
    }

    #[test]
    fn codex_auth_reads_tokens_and_claim_fallbacks() {
        let access = jwt(json!({
            "exp": 1_900_000_000,
            OPENAI_AUTH_CLAIM: { "chatgpt_account_id": "acct-from-jwt", "chatgpt_plan_type": "plus" }
        }));
        let raw =
            json!({ "OPENAI_API_KEY": null, "tokens": { "access_token": access } }).to_string();
        let CredRead::Found(auth) = parse_codex_auth(&raw) else {
            panic!("expected codex auth");
        };
        assert_eq!(auth.account_id, Some(Secret::new("acct-from-jwt")));
        assert_eq!(auth.plan_hint.as_deref(), Some("plus"));
        assert_eq!(auth.expires_at_ms, Some(1_900_000_000_000));

        let explicit =
            json!({ "tokens": { "access_token": "opaque", "account_id": "acct-1" } }).to_string();
        let CredRead::Found(auth) = parse_codex_auth(&explicit) else {
            panic!("expected codex auth");
        };
        assert_eq!(auth.account_id, Some(Secret::new("acct-1")));
        assert_eq!(auth.expires_at_ms, None);
    }

    #[test]
    fn codex_auth_without_chatgpt_tokens_is_missing() {
        let api_key_only = json!({ "OPENAI_API_KEY": "sk-test", "tokens": null }).to_string();
        assert_eq!(parse_codex_auth(&api_key_only), CredRead::Missing);
        assert_eq!(parse_codex_auth("{oops"), CredRead::Unreadable);
    }

    #[test]
    fn secret_debug_is_redacted() {
        let printed = format!(
            "{:?}",
            ClaudeOauth {
                access_token: Some(Secret::new("sk-ant-oat-visible")),
                ..ClaudeOauth::default()
            }
        );
        assert!(!printed.contains("sk-ant-oat-visible"));
    }
}
