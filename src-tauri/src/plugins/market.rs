//! Marketplace channel (plan §6 / Phase 3): the GitHub central index is
//! fetched over raw.githubusercontent.com with a 1h cache; install downloads
//! the release assets the index pins, verifies each SHA-256, and feeds the
//! verified tree to the same staging/backup transaction local installs use
//! (fs::install_from). reqwest picks the process proxy env up by default
//! (proxy.rs), so market traffic honors the configured system proxy like
//! every other outbound call.
//!
//! Trust chain (plan §4.4): the index repository pins every file's SHA-256;
//! a tampered release asset or a poisoned redirect fails the digest check
//! before anything touches the plugins directory. minisign signatures stay
//! an optional "verified" badge, not a gate.

use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock};

use futures_util::StreamExt;
use parking_lot::Mutex;

use super::fs::MAX_FILE_BYTES;
use super::manifest::semver_triple;
use super::state::{PluginInfo, PluginRecord};

/// The central index repository (plan ADR-4, Obsidian-style). Plain raw
/// file reads: no API rate limits, no self-hosted server.
const INDEX_RAW_BASE: &str =
    "https://raw.githubusercontent.com/zhukunpenglinyutong/ccgui-plugins/main";
const INDEX_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(3600);
/// community-plugins.json caps: the index is a small registry, not a data
/// dump — a runaway response means something is wrong upstream.
const MAX_INDEX_BYTES: u64 = 1024 * 1024;
const MAX_DETAIL_BYTES: u64 = 256 * 1024;

const INDEX_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// Assets run to the 16MB bundle cap; slow links need real headroom.
const ASSET_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// One shared client: a pool per request would waste connections (same
/// rationale as plugin_caps::HTTP_CLIENT).
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .expect("HTTP client builds from static config")
});

/// Row of community-plugins.json.
#[derive(Debug, Clone, Deserialize)]
struct IndexEntry {
    id: String,
    repo: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    author: String,
}

/// plugins/<id>.json: the pinned release, its hashes, and the compat gates.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexDetail {
    id: String,
    #[serde(default)]
    tier: String,
    version: String,
    #[serde(default)]
    min_app_version: Option<String>,
    #[serde(default)]
    sdk_version: Option<String>,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    sha256: HashMap<String, String>,
}

/// Marketplace listing as the frontend sees it (index entry + detail merge).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketPlugin {
    pub id: String,
    pub repo: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub tier: String,
    pub version: String,
    pub min_app_version: Option<String>,
    pub sdk_version: Option<String>,
    pub permissions: Vec<String>,
}

/// Cache row: the public listing plus the install-only fields (hashes).
struct CachedEntry {
    info: MarketPlugin,
    sha256: HashMap<String, String>,
}

struct IndexCache {
    fetched_at: std::time::Instant,
    entries: Arc<Vec<CachedEntry>>,
}

static INDEX_CACHE: LazyLock<Mutex<Option<IndexCache>>> = LazyLock::new(|| Mutex::new(None));

/// repo slugs become URL path segments — keep them strictly `owner/name`.
fn is_valid_repo_slug(repo: &str) -> bool {
    fn part(s: &str) -> bool {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    }
    let mut parts = repo.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(owner), Some(name), None) => part(owner) && part(name),
        _ => false,
    }
}

/// Asset file names land flat in the staging tree — no subdirectories, no
/// traversal.
fn is_valid_asset_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

async fn get_capped(url: &str, cap: u64, timeout: std::time::Duration) -> Result<Vec<u8>, String> {
    let response = HTTP_CLIENT
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("GET {url}: HTTP {status}"));
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("GET {url}: {e}"))?;
        if body.len() as u64 + chunk.len() as u64 > cap {
            return Err(format!("GET {url}: exceeds the {} byte cap", cap));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Fetch + merge the whole index. community-plugins.json failing is fatal;
/// a single plugin's detail failing only drops that row — the rest of the
/// market stays browsable and the install attempt will name the real error.
async fn fetch_index_entries() -> Result<Vec<CachedEntry>, String> {
    let raw = get_capped(
        &format!("{INDEX_RAW_BASE}/community-plugins.json"),
        MAX_INDEX_BYTES,
        INDEX_REQUEST_TIMEOUT,
    )
    .await?;
    let entries: Vec<IndexEntry> = serde_json::from_slice(&raw)
        .map_err(|e| format!("parse community-plugins.json: {e}"))?;

    let details = futures_util::future::join_all(entries.iter().map(|entry| async move {
        let url = format!("{INDEX_RAW_BASE}/plugins/{}.json", entry.id);
        let result: Result<IndexDetail, String> = async {
            let raw = get_capped(&url, MAX_DETAIL_BYTES, INDEX_REQUEST_TIMEOUT).await?;
            serde_json::from_slice(&raw).map_err(|e| format!("parse {url}: {e}"))
        }
        .await;
        (entry, result)
    }))
    .await;

    let mut merged = Vec::new();
    for (entry, detail) in details {
        if let Err(error) = super::manifest::require_valid_id(&entry.id) {
            eprintln!("[market] skipping index row: {error}");
            continue;
        }
        let detail = match detail {
            Ok(detail) => detail,
            Err(error) => {
                eprintln!("[market] skipping {}: {error}", entry.id);
                continue;
            }
        };
        if detail.id != entry.id {
            eprintln!(
                "[market] skipping {}: detail id {:?} disagrees",
                entry.id, detail.id
        );
            continue;
        }
        merged.push(CachedEntry {
            info: MarketPlugin {
                id: entry.id.clone(),
                repo: entry.repo.clone(),
                name: if entry.name.is_empty() {
                    entry.id.clone()
                } else {
                    entry.name.clone()
                },
                description: entry.description.clone(),
                author: entry.author.clone(),
                tier: detail.tier,
                version: detail.version,
                min_app_version: detail.min_app_version,
                sdk_version: detail.sdk_version,
                permissions: detail.permissions,
            },
            sha256: detail.sha256,
        });
    }
    Ok(merged)
}

/// 1h in-memory cache (plan ADR-4). `force` bypasses it (手动刷新).
async fn index_entries(force: bool) -> Result<Arc<Vec<CachedEntry>>, String> {
    if !force {
        if let Some(cache) = &*INDEX_CACHE.lock() {
            if cache.fetched_at.elapsed() < INDEX_CACHE_TTL {
                return Ok(Arc::clone(&cache.entries));
            }
        }
    }
    let entries = Arc::new(fetch_index_entries().await?);
    *INDEX_CACHE.lock() = Some(IndexCache {
        fetched_at: std::time::Instant::now(),
        entries: Arc::clone(&entries),
    });
    Ok(entries)
}

#[tauri::command]
pub async fn plugin_fetch_index(force: bool) -> Result<Vec<MarketPlugin>, String> {
    Ok(index_entries(force)
        .await?
        .iter()
        .map(|entry| entry.info.clone())
        .collect())
}

/// Update row for one installed marketplace plugin (semver compare only —
/// the index never sees prereleases, manifests pin plain x.y.z).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUpdate {
    pub id: String,
    pub current_version: String,
    pub latest_version: String,
}

/// Pure semver comparison: which `installed` (id → current version) rows
/// have a newer version in the index. Unparseable versions never update.
pub(crate) fn compute_updates<'a>(
    entries: impl Iterator<Item = (&'a str, &'a str)>,
    installed: impl Iterator<Item = (String, String)>,
) -> Vec<PluginUpdate> {
    let latest: HashMap<&str, &str> = entries.collect();
    let mut updates = Vec::new();
    for (id, current) in installed {
        let Some(&latest_version) = latest.get(id.as_str()) else {
            continue;
        };
        let (Some(current_triple), Some(latest_triple)) =
            (semver_triple(&current), semver_triple(latest_version))
        else {
            continue;
        };
        if latest_triple > current_triple {
            updates.push(PluginUpdate {
                id,
                current_version: current,
                latest_version: latest_version.to_string(),
            });
        }
    }
    updates.sort_by(|a, b| a.id.cmp(&b.id));
    updates
}

/// Installed plugins eligible for update hints, with their *on-disk*
/// manifest versions (the record version lags until the first list merge —
/// info_for is the honest read). Local installs join marketplace ones: a
/// plugin cloned and side-loaded under an indexed id should still hear about
/// updates, and accepting one replaces the bits through the same verified
/// transaction. builtin/ai sources never join — they have no upstream.
fn installed_updatable_versions(
    plugins_dir: &Path,
    records: &HashMap<String, PluginRecord>,
) -> Vec<(String, String)> {
    let mut versions: Vec<(String, String)> = records
        .iter()
        .filter(|(_, record)| record.source == "marketplace" || record.source == "local")
        .map(|(id, record)| {
            let info = super::fs::info_for(plugins_dir, id, record);
            (id.clone(), info.version)
        })
        .collect();
    versions.sort();
    versions
}

#[tauri::command]
pub async fn plugin_check_updates() -> Result<Vec<PluginUpdate>, String> {
    let entries = index_entries(false).await?;
    let state = super::state::read_state(&super::state::state_path())?;
    Ok(compute_updates(
        entries
            .iter()
            .map(|entry| (entry.info.id.as_str(), entry.info.version.as_str())),
        installed_updatable_versions(&super::state::plugins_dir(), &state.plugins).into_iter(),
    ))
}

/// Download one release asset and verify it against the index-pinned hash.
/// The bytes never touch disk before the digest matches.
async fn download_asset_verified(
    repo: &str,
    version: &str,
    name: &str,
    expected_sha256: &str,
) -> Result<Vec<u8>, String> {
    let url = format!("https://github.com/{repo}/releases/download/{version}/{name}");
    let body = get_capped(&url, MAX_FILE_BYTES, ASSET_REQUEST_TIMEOUT).await?;
    let digest = format!("{:x}", sha2::Sha256::digest(&body));
    if !digest.eq_ignore_ascii_case(expected_sha256) {
        return Err(format!(
            "{name}: SHA-256 mismatch (index pins {expected_sha256}, got {digest}) — \
             refusing to install"
        ));
    }
    Ok(body)
}

/// Core of plugin_install_from_marketplace, split from the Tauri command so
/// tests and the (desktop-only) bridge ruling stay simple: download every
/// pinned asset into a temp tree, cross-check the manifest against the
/// index, then hand the verified tree to the install transaction.
pub(crate) async fn install_from_marketplace(
    sink: &Arc<crate::event_sink::EventSink>,
    id: &str,
) -> Result<PluginInfo, String> {
    install_from_marketplace_at(
        &super::state::plugins_dir(),
        &super::state::state_path(),
        sink,
        id,
    )
    .await
}

/// install_from_marketplace with the plugins dir / state file injected, so
/// the live smoke runs the full pipeline in a throwaway directory.
async fn install_from_marketplace_at(
    plugins_dir: &Path,
    state_path: &Path,
    sink: &Arc<crate::event_sink::EventSink>,
    id: &str,
) -> Result<PluginInfo, String> {
    super::manifest::require_valid_id(id)?;
    let entries = index_entries(false).await?;
    let entry = entries
        .iter()
        .find(|entry| entry.info.id == id)
        .ok_or_else(|| format!("{id}: not in the marketplace index"))?;
    let info = &entry.info;
    if !is_valid_repo_slug(&info.repo) {
        return Err(format!("{id}: invalid repo slug {:?}", info.repo));
    }
    if semver_triple(&info.version).is_none() {
        return Err(format!("{id}: index version {:?} is not x.y.z", info.version));
    }
    if !entry.sha256.contains_key("manifest.json") {
        return Err(format!("{id}: index pins no manifest.json hash"));
    }
    for name in entry.sha256.keys() {
        if !is_valid_asset_name(name) {
            return Err(format!("{id}: invalid asset name {name:?} in index"));
        }
    }

    // Download + verify into a private temp tree. install_from re-walks and
    // re-validates (manifest schema, permissions, minAppVersion, size caps),
    // so a verified-but-broken bundle still fails safely there.
    let temp = std::env::temp_dir().join(format!("ccgui-market-{id}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp).map_err(|e| format!("mkdir {}: {e}", temp.display()))?;
    let result = async {
        let mut names: Vec<&String> = entry.sha256.keys().collect();
        names.sort();
        for name in names {
            let bytes =
                download_asset_verified(&info.repo, &info.version, name, &entry.sha256[name])
                    .await?;
            std::fs::write(temp.join(name), bytes)
                .map_err(|e| format!("write {}: {e}", temp.join(name).display()))?;
        }

        // Cross-check: the index's id/version claims must match the manifest
        // the hash actually pins, or the market UI would show one version
        // while installing another.
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(temp.join("manifest.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("{id}: downloaded manifest.json does not parse: {e}"))?;
        if manifest["id"].as_str() != Some(id) {
            return Err(format!(
                "{id}: downloaded manifest id {:?} disagrees with the index",
                manifest["id"]
            ));
        }
        if manifest["version"].as_str() != Some(info.version.as_str()) {
            return Err(format!(
                "{id}: downloaded manifest version {:?} != index version {:?}",
                manifest["version"], info.version
            ));
        }

        let temp_clone = temp.clone();
        let sink = Arc::clone(sink);
        let plugins_dir = plugins_dir.to_path_buf();
        let state_path = state_path.to_path_buf();
        tauri::async_runtime::spawn_blocking(move || {
            super::fs::install_from(&plugins_dir, &state_path, &temp_clone, "marketplace", |p| {
                sink.emit_install_progress(p)
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    .await;
    let _ = super::fs::remove_dir_if_exists(&temp);
    result
}

#[tauri::command]
pub async fn plugin_install_from_marketplace(
    state: tauri::State<'_, crate::AppState>,
    id: String,
) -> Result<PluginInfo, String> {
    let sink = Arc::clone(&state.sink);
    install_from_marketplace(&sink, &id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_slug_shape_is_strict() {
        assert!(is_valid_repo_slug("owner/repo"));
        assert!(is_valid_repo_slug("zhukunpenglinyutong/ccgui-plugin-react-doctor"));
        assert!(is_valid_repo_slug("a.b/c_d-e"));
        assert!(!is_valid_repo_slug("owner"));
        assert!(!is_valid_repo_slug("owner/repo/extra"));
        assert!(!is_valid_repo_slug("/repo"));
        assert!(!is_valid_repo_slug("owner/"));
        assert!(!is_valid_repo_slug("owner/../evil"));
        assert!(!is_valid_repo_slug("evil.com/owner/repo"));
        assert!(!is_valid_repo_slug("owner/re po"));
    }

    #[test]
    fn asset_name_rejects_traversal() {
        assert!(is_valid_asset_name("main.js"));
        assert!(is_valid_asset_name("styles.css"));
        assert!(!is_valid_asset_name("../evil"));
        assert!(!is_valid_asset_name("assets/logo.png"));
        assert!(!is_valid_asset_name(".."));
        assert!(!is_valid_asset_name(""));
    }

    #[test]
    fn compute_updates_compares_semver_triples() {
        let entries = [("a", "1.3.0"), ("b", "1.2.0"), ("c", "1.2.0")];
        let installed = [
            ("a".to_string(), "1.2.3".to_string()),
            ("b".to_string(), "1.2.0".to_string()),
            // Uninstalled index rows and unparseable versions never update.
            ("d".to_string(), "9.9.9".to_string()),
            ("c".to_string(), "not-semver".to_string()),
        ];
        let updates = compute_updates(
            entries.iter().map(|(id, v)| (*id, *v)),
            installed.into_iter(),
        );
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].id, "a");
        assert_eq!(updates[0].current_version, "1.2.3");
        assert_eq!(updates[0].latest_version, "1.3.0");
    }

    #[test]
    fn installed_updatable_versions_filters_by_source() {
        let scratch = crate::plugins::test_support::Scratch::new();
        let plugins_dir = scratch.path("plugins");
        crate::plugins::test_support::write_plugin(
            &plugins_dir.join("mkt-plugin"),
            &crate::plugins::test_support::valid_manifest("mkt-plugin"),
        );
        let mut records = HashMap::new();
        let mut marketplace = PluginRecord::fresh("marketplace", 0);
        marketplace.version = "0.0.1".to_string(); // stale record: disk wins
        records.insert("mkt-plugin".to_string(), marketplace);
        records.insert(
            "local-plugin".to_string(),
            PluginRecord::fresh("local", 0),
        );
        let versions = installed_updatable_versions(&plugins_dir, &records);
        // local joins marketplace; the on-disk manifest version (1.2.3)
        // wins over the stale record, and the directory-less local row
        // falls back to its empty record version. builtin/ai are out.
        assert_eq!(
            versions,
            vec![
                ("local-plugin".to_string(), String::new()),
                ("mkt-plugin".to_string(), "1.2.3".to_string()),
            ]
        );
    }

    /// Live end-to-end smoke against the real index and release: fetch the
    /// index, download react-doctor's pinned assets, verify the digests, and
    /// run the full install transaction into a throwaway HOME. Network-dependent
    /// and excluded from the default suite; run explicitly with
    /// `cargo test plugins::market -- --ignored`.
    #[tokio::test]
    #[ignore = "hits the live GitHub index"]
    async fn live_index_install_smoke() {
        struct NoopEmit;
        impl crate::event_sink::Emit for NoopEmit {
            fn emit_json(&self, _name: &str, _raw_json: &str) {}
        }
        let sink = crate::event_sink::EventSink::new(Arc::new(NoopEmit));

        let entries = fetch_index_entries().await.expect("index fetch");
        assert!(
            !entries.is_empty(),
            "the live index should list at least one plugin"
        );
        let id = entries[0].info.id.clone();

        // Full pipeline: index lookup → asset download → SHA-256 verify →
        // manifest cross-check → staging/backup transaction → state record.
        let scratch = crate::plugins::test_support::Scratch::new();
        let plugins_dir = scratch.path("plugins");
        let state_path = scratch.path("plugins.json");
        let info = install_from_marketplace_at(&plugins_dir, &state_path, &sink, &id)
            .await
            .expect("live marketplace install");
        assert_eq!(info.id, id);
        assert_eq!(info.source, "marketplace");
        assert!(info.enabled);
        assert!(plugins_dir.join(&id).join("manifest.json").is_file());

        // The record carries the manifest version and permissions.
        let state = crate::plugins::state::read_state(&state_path).unwrap();
        let record = &state.plugins[&id];
        assert_eq!(record.source, "marketplace");
        assert_eq!(record.version, info.version);

        // Update check against the same install: no update row right after
        // installing the latest indexed version.
        let updates = compute_updates(
            entries
                .iter()
                .map(|entry| (entry.info.id.as_str(), entry.info.version.as_str())),
            installed_updatable_versions(&plugins_dir, &state.plugins).into_iter(),
        );
        assert!(updates.is_empty(), "fresh install is up to date: {updates:?}");
    }
}
