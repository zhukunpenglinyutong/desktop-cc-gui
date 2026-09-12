//! Manifest parsing and the install-time permission whitelist.

use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use super::fs::MAX_FILE_BYTES;

/// Base permissions every plugin may declare, parsed from the shared spec —
/// packages/plugin-sdk/spec/permissions.json is the single source of truth
/// (the SDK, this host's spec-vector tests, and the template's
/// validate-manifest.mjs all consume it; drift fails CI, and marketplace
/// review audits these grants). Capability egress grants —
/// `network:<host>[:port|range]` and `exec:<bin>` — are shape-validated by
/// plugin_caps against the same spec.
static KNOWN_PERMISSIONS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    let spec: serde_json::Value = serde_json::from_str(include_str!(
        "../../../packages/plugin-sdk/spec/permissions.json"
    ))
    .expect("permissions spec JSON is valid");
    spec["knownPermissions"]
        .as_array()
        .expect("permissions spec has a knownPermissions array")
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .expect("knownPermissions entries are strings")
                .to_string()
        })
        .collect()
});

/// The manifest fields Phase 1 cares about; `contributes`/`configSchema` and
/// anything else pass through unread.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginManifest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) tier: String,
    #[serde(default)]
    pub(crate) description: String,
    #[serde(default)]
    pub(crate) author: String,
    #[serde(default)]
    pub(crate) permissions: Vec<String>,
    pub(crate) min_app_version: Option<String>,
    /// SDK contract range the plugin was built against (e.g. "^0.2"). The
    /// handshake itself runs in the frontend loader (satisfiesSdkRange);
    /// declared here so the field is schema-known and future UI can show it.
    #[allow(dead_code)] // schema-known only; read by no host code yet
    pub(crate) sdk_version: Option<String>,
}

/// ids double as directory names, so the manifest charset whitelist is also
/// the path-traversal guard for plugin_read_file/uninstall.
fn is_valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.len() < 2 || bytes.len() > 64 {
        return false;
    }
    (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes[1..]
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

pub(crate) fn require_valid_id(id: &str) -> Result<(), String> {
    if is_valid_id(id) {
        Ok(())
    } else {
        Err(format!(
            "{id}: invalid plugin id (want ^[a-z0-9][a-z0-9-]{{1,63}}$)"
        ))
    }
}

/// Numeric semver triple; anything fancier (prerelease, build metadata) is
/// rejected — manifests pin plain `x.y.z`.
pub(crate) fn semver_triple(v: &str) -> Option<(u64, u64, u64)> {
    let mut parts = v.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

pub(crate) fn manifest_path(dir: &Path) -> Option<PathBuf> {
    let primary = dir.join("manifest.json");
    if primary.is_file() {
        return Some(primary);
    }
    let alt = dir.join("ccgui.plugin.json");
    if alt.is_file() {
        return Some(alt);
    }
    None
}

/// Parse and validate `<dir>/manifest.json` (fallback `ccgui.plugin.json`).
/// Checks every install-time rule: id/name/version/tier shape, js-tier
/// entrypoint, per-file size cap, permission whitelist, minAppVersion floor.
/// `files` is the caller's single collect_files walk of the source tree —
/// the per-file size cap reads sizes from it instead of recursing again.
pub(crate) fn validate_manifest(
    dir: &Path,
    files: &[(PathBuf, u64)],
) -> Result<PluginManifest, String> {
    let path = manifest_path(dir)
        .ok_or_else(|| format!("{}: missing manifest.json", dir.display()))?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let manifest: PluginManifest =
        serde_json::from_str(&content).map_err(|e| format!("parse {}: {e}", path.display()))?;

    require_valid_id(&manifest.id)?;
    if manifest.name.trim().is_empty() {
        return Err(format!("{}: manifest name must not be empty", manifest.id));
    }
    if semver_triple(&manifest.version).is_none() {
        return Err(format!(
            "{}: invalid version {:?} (want ^\\d+\\.\\d+\\.\\d+)",
            manifest.id, manifest.version
        ));
    }
    if manifest.tier != "declarative" && manifest.tier != "js" {
        return Err(format!(
            "{}: invalid tier {:?} (want declarative|js)",
            manifest.id, manifest.tier
        ));
    }
    if manifest.tier == "js" && !dir.join("main.js").is_file() {
        return Err(format!("{}: tier \"js\" requires main.js", manifest.id));
    }
    for permission in &manifest.permissions {
        let granted = KNOWN_PERMISSIONS.contains(permission.as_str())
            || crate::plugin_caps::is_valid_network_grant(permission)
            || crate::plugin_caps::is_valid_exec_grant(permission);
        if !granted {
            return Err(format!(
                "{}: unknown permission {permission:?}",
                manifest.id
            ));
        }
    }
    if let Some(min) = &manifest.min_app_version {
        let min = min.trim();
        let required = semver_triple(min).ok_or_else(|| {
            format!(
                "{}: invalid minAppVersion {min:?} (want ^\\d+\\.\\d+\\.\\d+)",
                manifest.id
            )
        })?;
        let current = semver_triple(env!("CARGO_PKG_VERSION"))
            .ok_or_else(|| format!("unparseable app version {}", env!("CARGO_PKG_VERSION")))?;
        if required > current {
            return Err(format!(
                "{}: requires app >= {min}, this is {}",
                manifest.id,
                env!("CARGO_PKG_VERSION")
            ));
        }
    }

    // Per-file hard cap across the whole bundle (CI warns at 512KB, the host
    // refuses past 16MB locally — plan §6.1), read from the caller's walk.
    for (rel, size) in files {
        if *size > MAX_FILE_BYTES {
            return Err(format!(
                "{}: file exceeds the 16MB limit ({size} bytes)",
                rel.display()
            ));
        }
    }
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::fs::MAX_FILE_BYTES;
    use crate::plugins::test_support::{validate, valid_manifest, write_plugin, Scratch};

    #[test]
    fn id_charset_matches_contract() {
        assert!(is_valid_id("usage-stats"));
        assert!(is_valid_id("a1"));
        assert!(!is_valid_id("a")); // too short
        assert!(!is_valid_id("Abc")); // uppercase
        assert!(!is_valid_id("-ab")); // leading dash
        assert!(!is_valid_id("a_b")); // underscore not allowed
        assert!(!is_valid_id("../evil")); // traversal
        assert!(!is_valid_id(&"a".repeat(65))); // too long
    }

    #[test]
    fn semver_triple_parses_plain_versions_only() {
        assert_eq!(semver_triple("1.2.3"), Some((1, 2, 3)));
        assert_eq!(semver_triple("10.20.30"), Some((10, 20, 30)));
        assert_eq!(semver_triple("1.2"), None);
        assert_eq!(semver_triple("1.2.3.4"), None);
        assert_eq!(semver_triple("1.2.3-beta"), None);
    }

    #[test]
    fn known_permissions_come_from_the_shared_spec() {
        // The spec is the single source of truth; spot-check both ends.
        assert!(KNOWN_PERMISSIONS.contains("storage"));
        assert!(KNOWN_PERMISSIONS.contains("network:none"));
        assert!(!KNOWN_PERMISSIONS.contains("fs:read"));
        assert!(!KNOWN_PERMISSIONS.contains("network:example.com"));
    }

    #[test]
    fn manifest_validation_accepts_declarative_and_js() {
        let scratch = Scratch::new();
        let dir = scratch.path("ok");
        write_plugin(&dir, &valid_manifest("my-plugin"));
        let manifest = validate(&dir).unwrap();
        assert_eq!(manifest.id, "my-plugin");

        let js_dir = scratch.path("js");
        write_plugin(
            &js_dir,
            r#"{"id":"js-plugin","name":"JS","version":"0.1.0","tier":"js"}"#,
        );
        std::fs::write(js_dir.join("main.js"), "// entry").unwrap();
        let manifest = validate(&js_dir).unwrap();
        assert_eq!(manifest.tier, "js");
    }

    #[test]
    fn manifest_validation_rejects_each_bad_field() {
        let scratch = Scratch::new();
        let cases: Vec<(&str, &str)> = vec![
            // (manifest body, expected error fragment)
            (
                r#"{"id":"Bad_Id","name":"T","version":"1.0.0","tier":"declarative"}"#,
                "invalid plugin id",
            ),
            (
                r#"{"id":"ok-id","name":" ","version":"1.0.0","tier":"declarative"}"#,
                "name must not be empty",
            ),
            (
                r#"{"id":"ok-id","name":"T","version":"1.0","tier":"declarative"}"#,
                "invalid version",
            ),
            (
                r#"{"id":"ok-id","name":"T","version":"1.0.0","tier":"native"}"#,
                "invalid tier",
            ),
            (
                r#"{"id":"ok-id","name":"T","version":"1.0.0","tier":"declarative",
                    "permissions":["fs:read"]}"#,
                "unknown permission",
            ),
            (
                r#"{"id":"ok-id","name":"T","version":"1.0.0","tier":"declarative",
                    "minAppVersion":"999.0.0"}"#,
                "requires app >=",
            ),
            (
                r#"{"id":"ok-id","name":"T","version":"1.0.0","tier":"declarative",
                    "minAppVersion":"soon"}"#,
                "invalid minAppVersion",
            ),
        ];
        for (i, (body, fragment)) in cases.iter().enumerate() {
            let dir = scratch.path(&format!("bad-{i}"));
            write_plugin(&dir, body);
            let error = validate(&dir).unwrap_err();
            assert!(
                error.contains(fragment),
                "case {i}: expected {fragment:?} in {error:?}"
            );
        }

        // js tier without its entrypoint.
        let dir = scratch.path("no-main");
        write_plugin(
            &dir,
            r#"{"id":"js-plugin","name":"JS","version":"0.1.0","tier":"js"}"#,
        );
        assert!(validate(&dir).unwrap_err().contains("main.js"));

        // Missing manifest entirely.
        let dir = scratch.path("empty");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(validate(&dir).unwrap_err().contains("missing manifest"));

        // Alternate manifest name is honored.
        let dir = scratch.path("alt-name");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("ccgui.plugin.json"), valid_manifest("alt-id")).unwrap();
        assert_eq!(validate(&dir).unwrap().id, "alt-id");

        // A file past the 16MB cap refuses the whole bundle.
        let dir = scratch.path("oversized");
        write_plugin(&dir, &valid_manifest("big-plugin"));
        std::fs::write(dir.join("blob.bin"), vec![0u8; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        assert!(validate(&dir).unwrap_err().contains("16MB limit"));
    }

    #[test]
    fn manifest_validation_accepts_network_and_exec_grants() {
        let scratch = Scratch::new();
        let dir = scratch.path("grants-ok");
        write_plugin(
            &dir,
            r#"{"id":"net-plugin","name":"T","version":"1.0.0","tier":"declarative",
                "permissions":["storage","network:none","network:127.0.0.1:7680-7690",
                "network:api.example.com","exec:npm","exec:tokentracker-cli"]}"#,
        );
        let manifest = validate(&dir).unwrap();
        assert_eq!(manifest.permissions.len(), 6);
    }

    #[test]
    fn manifest_validation_rejects_bad_grant_shapes() {
        let scratch = Scratch::new();
        let cases: Vec<&str> = vec![
            r#""cmd:tt_proxy""#,         // cmd: mechanism removed
            r#""cmd:plugin_http_request""#, // even the new commands are not grantable
            r#""exec:../evil""#,        // path separators
            r#""exec:/bin/sh""#,
            r#""exec:""#,               // empty bin
            r#""network:bad host""#,    // space in host
            r#""network:host:abc""#,    // non-numeric port
            r#""network:host:90-80""#,  // inverted range
            r#""network:*.example.com""#, // wildcard
        ];
        for (i, permission) in cases.iter().enumerate() {
            let dir = scratch.path(&format!("bad-grant-{i}"));
            write_plugin(
                &dir,
                &format!(
                    r#"{{"id":"ok-id","name":"T","version":"1.0.0","tier":"declarative",
                        "permissions":[{permission}]}}"#
                ),
            );
            let error = validate(&dir).unwrap_err();
            assert!(
                error.contains("unknown permission"),
                "case {i} ({permission}): {error}"
            );
        }
    }
}
