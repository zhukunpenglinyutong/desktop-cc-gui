//! The user's go-ahead before CC GUI reads local CLI logins (Claude Code's
//! OAuth token, Codex's `auth.json`) for the limits lookup.
//!
//! A GUI app opening another program's credential store is exactly what
//! endpoint security reports as credential access, and users deserve to know
//! it happens. So `usage_limits::get` refuses with [`CONSENT_REQUIRED`] until
//! the desktop user has seen which stores are read ([`sources`]) and agreed.
//! The answer lives in `<app home>/cli-credential-consent.json`, outside
//! settings.json, so a full-object settings write cannot drop it.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Error prefix the frontend matches (src/lib/credential-consent.ts) — the IPC
/// error channel carries plain strings, so detection is textual.
pub(crate) const CONSENT_REQUIRED: &str = "CredentialConsentRequired: ";
const CONSENT_FILE: &str = "cli-credential-consent.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    granted: bool,
    /// Epoch ms of the grant, for support/debugging.
    at: i64,
}

/// One credential store the limits lookup reads, as shown to the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSourceInfo {
    /// "claude" | "codex".
    pub provider: &'static str,
    /// "keychain" (macOS Keychain generic password, by service name) | "file".
    pub kind: &'static str,
    pub location: String,
    /// The only host the credential is sent to.
    pub host: &'static str,
}

fn consent_path() -> PathBuf {
    crate::paths::app_home().join(CONSENT_FILE)
}

fn granted_at(path: &Path) -> bool {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Record>(&raw).ok())
        .is_some_and(|record| record.granted)
}

fn set_at(path: &Path, granted: bool, now_ms: i64) -> Result<(), String> {
    if !granted {
        return match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("revoke credential consent: {error}")),
        };
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    let record = serde_json::to_string(&Record { granted: true, at: now_ms })
        .map_err(|error| error.to_string())?;
    crate::settings::atomic_write(path, &record)
}

fn require_at(path: &Path) -> Result<(), String> {
    if granted_at(path) {
        Ok(())
    } else {
        Err(format!(
            "{CONSENT_REQUIRED}CC GUI has not been allowed to read local CLI logins"
        ))
    }
}

/// Gate for every credential read: Err([`CONSENT_REQUIRED`]…) until granted.
pub(crate) fn require() -> Result<(), String> {
    require_at(&consent_path())
}

/// The stores the lookup reads on this machine, in read order.
pub(crate) fn sources() -> Vec<CredentialSourceInfo> {
    let mut sources = Vec::new();
    if let Some(service) = super::credentials::claude_keychain_service_default() {
        sources.push(CredentialSourceInfo {
            provider: "claude",
            kind: "keychain",
            location: service,
            host: super::claude::HOST,
        });
    }
    sources.push(CredentialSourceInfo {
        provider: "claude",
        kind: "file",
        location: super::credentials::claude_credentials_path()
            .display()
            .to_string(),
        host: super::claude::HOST,
    });
    sources.push(CredentialSourceInfo {
        provider: "codex",
        kind: "file",
        location: super::credentials::codex_auth_path().display().to_string(),
        host: super::codex::HOST,
    });
    sources
}

#[tauri::command]
pub fn cli_credential_consent_get() -> bool {
    granted_at(&consent_path())
}

/// Desktop-only on purpose: the web bridge has no route for it, so a remote
/// client cannot widen what the host reads (same rule as `grant_root`).
///
/// Not an isolation boundary: the plugin IPC guard (plugins/runtime/
/// hardening.ts) cannot wrap Tauri >= 2.11's non-writable `invoke`, so any
/// same-origin plugin code can call this — or `official_config_read`, which
/// returns raw CLI auth files — directly. Consent is the disclosure step for
/// the host's own lookup path; real plugin isolation is tracked in
/// docs/security-incidents/2026-11-security-audit.zh-CN.md. A native OS
/// confirm here was rejected: it would focus "Allow" by default, re-opening
/// the stray-Enter grant the in-app dialog avoids.
#[tauri::command]
pub fn cli_credential_consent_set(granted: bool) -> Result<(), String> {
    set_at(&consent_path(), granted, super::system_now_ms())
}

#[tauri::command]
pub fn cli_credential_sources() -> Vec<CredentialSourceInfo> {
    sources()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-consent-{}", uuid::Uuid::new_v4()));
        dir.join("nested").join(CONSENT_FILE)
    }

    #[test]
    fn refuses_with_the_frontend_prefix_until_granted() {
        let path = scratch();
        let error = require_at(&path).unwrap_err();
        assert!(error.starts_with(CONSENT_REQUIRED), "{error}");

        set_at(&path, true, 42).unwrap();
        assert!(require_at(&path).is_ok());
        assert!(granted_at(&path));

        set_at(&path, false, 43).unwrap();
        assert!(require_at(&path).is_err());
        // Revoking twice is not an error.
        set_at(&path, false, 44).unwrap();
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn a_corrupt_or_negative_record_is_not_consent() {
        let path = scratch();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{not json").unwrap();
        assert!(!granted_at(&path));
        std::fs::write(&path, r#"{"granted":false,"at":1}"#).unwrap();
        assert!(!granted_at(&path));
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn sources_name_every_store_and_its_only_host() {
        let sources = sources();
        let files: Vec<_> = sources.iter().filter(|s| s.kind == "file").collect();
        assert_eq!(files.len(), 2);
        assert!(files[0].location.ends_with(".credentials.json"));
        assert_eq!(files[0].host, "api.anthropic.com");
        assert!(files[1].location.ends_with("auth.json"));
        assert_eq!(files[1].host, "chatgpt.com");
        let keychain = sources.iter().filter(|s| s.kind == "keychain").count();
        assert_eq!(keychain, usize::from(cfg!(target_os = "macos")));
    }
}
