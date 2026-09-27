//! Permissioned byte resources. Caller-supplied plugin ids follow the existing
//! same-origin plugin trust model; they are not an identity sandbox.

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

use axum::http::StatusCode;
use reqwest::Url;
use serde::{Deserialize, Serialize};

use super::{state, storage};

/// Remote proxy cap: applies only to `remote` sources, mirroring
/// `plugin_http_request` (documented in the SDK guide as the network-request
/// limit). Never used for on-disk reads.
pub(super) const MAX_ASSET_BYTES: usize = 8 * 1024 * 1024;
/// Local cap: applies to `bundle`, `doc` and granted-directory reads, which
/// stream from disk instead of the network, so it only guards against absurd
/// files. Large texture atlases routinely exceed the remote cap (a 10 MB PNG
/// is ordinary), and rejecting them surfaced as an unloadable resource rather
/// than a size complaint. Deliberately a separate constant from
/// `MAX_ASSET_BYTES`: the two limits must never be shared.
const MAX_LOCAL_ASSET_BYTES: usize = 64 * 1024 * 1024;
const MAX_DIRECTORIES: usize = 16;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .referer(false)
        .build()
        .expect("asset HTTP client builds from static config")
});

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDirectoryGrant {
    pub grant_id: String,
    pub path: String,
}

#[derive(Debug, Clone)]
pub(super) enum AssetSource {
    Bundle(String),
    Document(String),
    Directory { grant_id: String, relative: String },
    Remote(Url),
}

#[derive(Debug)]
pub(super) struct AssetBytes {
    pub body: Vec<u8>,
    pub mime: String,
    pub bundle: bool,
}

#[derive(Debug)]
pub(super) enum AssetContent {
    Bytes(AssetBytes),
    Redirect(Url),
}

#[derive(Debug)]
pub(super) enum AssetError {
    BadRequest,
    Forbidden,
    NotFound,
    TooLarge,
    BadGateway,
    Timeout,
    Internal,
}

impl AssetError {
    pub(super) fn status(&self) -> StatusCode {
        match self {
            Self::BadRequest => StatusCode::BAD_REQUEST,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::BadGateway => StatusCode::BAD_GATEWAY,
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

fn authorized_state(path: &Path, id: &str) -> Result<state::PluginsState, String> {
    super::manifest::require_valid_id(id)?;
    let state = state::read_state(path)?;
    let record = state
        .plugins
        .get(id)
        .ok_or_else(|| format!("{id}: plugin is not installed"))?;
    if !record.enabled || record.quarantined {
        return Err(format!("{id}: plugin is disabled or quarantined"));
    }
    Ok(state)
}

fn require_permission(
    state: &state::PluginsState,
    id: &str,
    permission: &str,
) -> Result<(), String> {
    if state
        .plugins
        .get(id)
        .is_some_and(|record| record.permissions.iter().any(|p| p == permission))
    {
        Ok(())
    } else {
        Err(format!("{id}: missing {permission} permission"))
    }
}

fn check_absolute_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("an absolute existing path is required".into());
    }
    for component in path.components() {
        match component {
            Component::ParentDir => return Err("parent traversal is forbidden".into()),
            Component::Normal(name) => {
                storage::safe_relative_path(name.to_str().ok_or("path must be UTF-8")?)?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn grant_directory_at(
    state_path: &Path,
    id: &str,
    path: &Path,
) -> Result<AssetDirectoryGrant, String> {
    let initial = authorized_state(state_path, id)?;
    require_permission(&initial, id, "assets:directory")?;
    check_absolute_path(path)?;
    storage::confine_to_root(path, path)?;
    if !path.is_dir() {
        return Err("asset directory must be an existing directory".into());
    }
    let canonical = dunce::canonicalize(path).map_err(|e| e.to_string())?;
    let _guard = state::lock_state(state_path)?;
    let mut state = authorized_state(state_path, id)?;
    require_permission(&state, id, "assets:directory")?;
    let entries = state.asset_directories.entry(id.into()).or_default();
    if let Some(entry) = entries
        .iter()
        .find(|entry| Path::new(&entry.path) == canonical)
    {
        return Ok(entry.clone());
    }
    if entries.len() >= MAX_DIRECTORIES {
        return Err(format!(
            "{id}: at most {MAX_DIRECTORIES} asset directories may be granted"
        ));
    }
    let grant = AssetDirectoryGrant {
        grant_id: uuid::Uuid::new_v4().to_string(),
        path: canonical.to_str().ok_or("path must be UTF-8")?.into(),
    };
    entries.push(grant.clone());
    state::write_state(state_path, &state)?;
    Ok(grant)
}

fn list_directories_at(state_path: &Path, id: &str) -> Result<Vec<AssetDirectoryGrant>, String> {
    let mut state = authorized_state(state_path, id)?;
    require_permission(&state, id, "assets:directory")?;
    Ok(state.asset_directories.remove(id).unwrap_or_default())
}

fn revoke_directory_at(state_path: &Path, id: &str, grant_id: &str) -> Result<(), String> {
    let _guard = state::lock_state(state_path)?;
    let mut state = authorized_state(state_path, id)?;
    require_permission(&state, id, "assets:directory")?;
    if let Some(entries) = state.asset_directories.get_mut(id) {
        entries.retain(|entry| entry.grant_id != grant_id);
        if entries.is_empty() {
            state.asset_directories.remove(id);
        }
    }
    state::write_state(state_path, &state)
}

#[tauri::command]
pub async fn plugin_asset_grant_directory(
    plugin_id: String,
    path: String,
) -> Result<AssetDirectoryGrant, String> {
    tokio::task::spawn_blocking(move || {
        grant_directory_at(&state::state_path(), &plugin_id, Path::new(&path))
    })
    .await
    .map_err(|error| format!("asset directory validation failed: {error}"))?
}

#[tauri::command]
pub fn plugin_asset_list_directories(
    plugin_id: String,
) -> Result<Vec<AssetDirectoryGrant>, String> {
    list_directories_at(&state::state_path(), &plugin_id)
}

#[tauri::command]
pub fn plugin_asset_revoke_directory(plugin_id: String, grant_id: String) -> Result<(), String> {
    revoke_directory_at(&state::state_path(), &plugin_id, &grant_id)
}

// Pure preflight: resolving an ungranted UNC path can itself cause network
// authentication. Only local aliases in an already-authorized namespace may
// reach filesystem checks; device namespaces are never accepted here.
fn reveal_prefix_matches(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::Prefix;
        let (Some(Component::Prefix(path)), Some(Component::Prefix(root))) =
            (path.components().next(), root.components().next())
        else {
            return false;
        };
        match (path.kind(), root.kind()) {
            (
                Prefix::Disk(a) | Prefix::VerbatimDisk(a),
                Prefix::Disk(b) | Prefix::VerbatimDisk(b),
            ) => a.eq_ignore_ascii_case(&b),
            (
                Prefix::UNC(a_host, a_share) | Prefix::VerbatimUNC(a_host, a_share),
                Prefix::UNC(b_host, b_share) | Prefix::VerbatimUNC(b_host, b_share),
            ) => {
                a_host
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&b_host.to_string_lossy())
                    && a_share
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&b_share.to_string_lossy())
            }
            _ => false,
        }
    }
    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
}

fn reveal_target_at(
    state_path: &Path,
    roots: Option<&storage::StorageRoots>,
    id: &str,
    path: &Path,
) -> Result<PathBuf, String> {
    let state = authorized_state(state_path, id)?;
    check_absolute_path(path)?;
    let mut allowed_roots = Vec::new();
    if require_permission(&state, id, "plugin.storage").is_ok() {
        allowed_roots.push(storage::document_root_at(state_path, id, roots)?);
    }
    if require_permission(&state, id, "assets:directory").is_ok() {
        if let Some(entries) = state.asset_directories.get(id) {
            allowed_roots.extend(entries.iter().map(|entry| PathBuf::from(&entry.path)));
        }
    }
    let denied = || format!("{id}: path is outside plugin.storage and granted asset directories");
    allowed_roots.retain(|root| reveal_prefix_matches(path, root));
    if allowed_roots.is_empty() {
        return Err(denied());
    }
    // Inspect the supplied path and all its ancestors before resolving aliases.
    // Canonicalization alone would hide a symlink back into an allowed root.
    storage::confine_to_root(path, path).map_err(|_| denied())?;
    let canonical = dunce::canonicalize(path).map_err(|_| denied())?;
    for root in allowed_roots {
        if storage::confine_to_root(&root, &root).is_err() {
            continue;
        }
        let canonical_root = match dunce::canonicalize(&root) {
            Ok(root) => root,
            Err(_) => continue,
        };
        // Windows short names, case variants and verbatim paths can name the
        // same file without sharing a lexical prefix with the stored root.
        if canonical.starts_with(&canonical_root) {
            storage::confine_to_root(&canonical_root, &canonical).map_err(|_| denied())?;
            return Ok(canonical);
        }
    }
    Err(denied())
}

#[tauri::command]
pub async fn plugin_reveal_path(plugin_id: String, path: String) -> Result<(), String> {
    let target = tokio::task::spawn_blocking(move || {
        reveal_target_at(&state::state_path(), None, &plugin_id, Path::new(&path))
    })
    .await
    .map_err(|error| format!("asset reveal validation failed: {error}"))??;
    crate::open_app::reveal_in_file_manager(target.to_string_lossy().into_owned()).await
}

fn local_root(
    state_path: &Path,
    plugins_dir: &Path,
    roots: Option<&storage::StorageRoots>,
    id: &str,
    source: &AssetSource,
) -> Result<PathBuf, AssetError> {
    let state = authorized_state(state_path, id).map_err(|_| AssetError::Forbidden)?;
    let permission = match source {
        AssetSource::Bundle(_) => "assets:bundle",
        AssetSource::Document(_) => "plugin.storage",
        AssetSource::Directory { .. } => "assets:directory",
        AssetSource::Remote(_) => return Err(AssetError::BadRequest),
    };
    require_permission(&state, id, permission).map_err(|_| AssetError::Forbidden)?;
    match source {
        AssetSource::Bundle(_) => Ok(plugins_dir.join(id)),
        AssetSource::Document(_) => {
            storage::document_root_at(state_path, id, roots).map_err(|_| AssetError::Internal)
        }
        AssetSource::Directory { grant_id, .. } => state
            .asset_directories
            .get(id)
            .and_then(|entries| entries.iter().find(|entry| entry.grant_id == *grant_id))
            .map(|entry| PathBuf::from(&entry.path))
            .ok_or(AssetError::Forbidden),
        AssetSource::Remote(_) => Err(AssetError::BadRequest),
    }
}

fn file_error(error: std::io::Error) -> AssetError {
    match error.kind() {
        std::io::ErrorKind::NotFound => AssetError::NotFound,
        std::io::ErrorKind::PermissionDenied => AssetError::Forbidden,
        _ => AssetError::Internal,
    }
}

fn read_local_at(
    state_path: &Path,
    plugins_dir: &Path,
    roots: Option<&storage::StorageRoots>,
    id: &str,
    source: &AssetSource,
) -> Result<AssetBytes, AssetError> {
    let relative = match source {
        AssetSource::Bundle(path) | AssetSource::Document(path) => path,
        AssetSource::Directory { relative, .. } => relative,
        AssetSource::Remote(_) => return Err(AssetError::BadRequest),
    };
    let safe = storage::safe_relative_path(relative).map_err(|_| AssetError::BadRequest)?;
    let root = local_root(state_path, plugins_dir, roots, id, source)?;
    if !root.exists() {
        return Err(AssetError::NotFound);
    }
    let target = root.join(safe);
    storage::confine_to_root(&root, &target).map_err(|_| AssetError::Forbidden)?;
    let metadata = fs::metadata(&target).map_err(file_error)?;
    if !metadata.is_file() {
        return Err(AssetError::NotFound);
    }
    if metadata.len() > MAX_LOCAL_ASSET_BYTES as u64 {
        return Err(AssetError::TooLarge);
    }
    storage::confine_to_root(&root, &target).map_err(|_| AssetError::Forbidden)?;
    let file = fs::File::open(&target).map_err(file_error)?;
    if !file.metadata().map_err(file_error)?.is_file() {
        return Err(AssetError::NotFound);
    }
    let mut body = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_LOCAL_ASSET_BYTES as u64 + 1)
        .read_to_end(&mut body)
        .map_err(file_error)?;
    if body.len() > MAX_LOCAL_ASSET_BYTES {
        return Err(AssetError::TooLarge);
    }
    // A disable/revoke/storage-root switch during the read must not publish
    // bytes under an obsolete capability.
    if local_root(state_path, plugins_dir, roots, id, source)? != root {
        return Err(AssetError::Forbidden);
    }
    Ok(AssetBytes {
        body,
        mime: crate::web::content_type(relative).into(),
        bundle: matches!(source, AssetSource::Bundle(_)),
    })
}

pub(super) fn authorize_remote(state_path: &Path, id: &str, url: &Url) -> Result<(), AssetError> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(AssetError::BadRequest);
    }
    let state = authorized_state(state_path, id).map_err(|_| AssetError::Forbidden)?;
    let host = url.host_str().ok_or(AssetError::BadRequest)?;
    if !crate::plugin_caps::network_grant_allows(
        &state.plugins[id].permissions,
        host,
        url.port_or_known_default(),
    ) {
        return Err(AssetError::Forbidden);
    }
    Ok(())
}

fn network_error(error: reqwest::Error) -> AssetError {
    if error.is_timeout() {
        AssetError::Timeout
    } else {
        AssetError::BadGateway
    }
}

async fn read_remote_at(
    state_path: &Path,
    id: &str,
    url: &Url,
    client: &reqwest::Client,
) -> Result<AssetContent, AssetError> {
    authorize_remote(state_path, id, url)?;
    let mut response = client
        .get(url.clone())
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(network_error)?;
    let status = response.status();
    if matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or(AssetError::BadGateway)?;
        let target = url.join(location).map_err(|_| AssetError::BadGateway)?;
        authorize_remote(state_path, id, &target)?;
        // The protocol layer rewrites Location back through this proxy. Letting
        // the browser follow that URL also fixes the base for relative
        // dependencies of the redirected resource.
        return Ok(AssetContent::Redirect(target));
    }
    if status == StatusCode::NOT_FOUND {
        return Err(AssetError::NotFound);
    }
    if !status.is_success() {
        return Err(AssetError::BadGateway);
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_ASSET_BYTES as u64)
    {
        return Err(AssetError::TooLarge);
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or(0)
            .min(MAX_ASSET_BYTES as u64) as usize,
    );
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if chunk.len() > MAX_ASSET_BYTES - body.len() {
            return Err(AssetError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    authorize_remote(state_path, id, url)?;
    Ok(AssetContent::Bytes(AssetBytes {
        body,
        mime,
        bundle: false,
    }))
}

pub(super) async fn read_asset(
    id: String,
    source: AssetSource,
) -> Result<AssetContent, AssetError> {
    if let AssetSource::Remote(url) = &source {
        return tokio::time::timeout(
            REQUEST_TIMEOUT,
            read_remote_at(&state::state_path(), &id, url, &HTTP_CLIENT),
        )
        .await
        .map_err(|_| AssetError::Timeout)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        read_local_at(
            &state::state_path(),
            &state::plugins_dir(),
            None,
            &id,
            &source,
        )
        .map(AssetContent::Bytes)
    })
    .await
    .map_err(|_| AssetError::Internal)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::test_support::{create_dir_link, Scratch};

    fn fixture(scratch: &Scratch) -> PathBuf {
        let path = scratch.path("plugins.json");
        let mut state = state::PluginsState::default();
        for id in ["vendor.one", "vendor.two"] {
            let mut record = state::PluginRecord::fresh("test", 1);
            record.permissions = vec![
                "assets:bundle".into(),
                "assets:directory".into(),
                "plugin.storage".into(),
            ];
            state.plugins.insert(id.into(), record);
        }
        state::write_state(&path, &state).unwrap();
        path
    }

    #[test]
    fn directory_capabilities_are_isolated_revocable_and_canonical_idempotent() {
        let scratch = Scratch::new();
        let state_path = fixture(&scratch);
        let root = scratch.path("models");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("binary.bin"), [0, 255, 128, 13, 10]).unwrap();
        let grant = grant_directory_at(&state_path, "vendor.one", &root).unwrap();
        assert_eq!(
            grant_directory_at(&state_path, "vendor.one", &root.join("."))
                .unwrap()
                .grant_id,
            grant.grant_id
        );
        let source = AssetSource::Directory {
            grant_id: grant.grant_id.clone(),
            relative: "binary.bin".into(),
        };
        assert_eq!(
            read_local_at(
                &state_path,
                &scratch.path("plugins"),
                None,
                "vendor.one",
                &source
            )
            .unwrap()
            .body,
            [0, 255, 128, 13, 10]
        );
        assert_eq!(
            read_local_at(
                &state_path,
                &scratch.path("plugins"),
                None,
                "vendor.two",
                &source
            )
            .unwrap_err()
            .status(),
            StatusCode::FORBIDDEN
        );
        revoke_directory_at(&state_path, "vendor.one", &grant.grant_id).unwrap();
        assert_eq!(
            read_local_at(
                &state_path,
                &scratch.path("plugins"),
                None,
                "vendor.one",
                &source
            )
            .unwrap_err()
            .status(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn bundle_and_selected_documents_preserve_binary_and_recheck_access() {
        let scratch = Scratch::new();
        let state_path = fixture(&scratch);
        let plugins = scratch.path("plugins");
        fs::create_dir_all(plugins.join("vendor.one")).unwrap();
        let bytes = [0, 255, 254, 128];
        fs::write(plugins.join("vendor.one/model.bin"), bytes).unwrap();
        let bundle = AssetSource::Bundle("model.bin".into());
        assert_eq!(
            read_local_at(&state_path, &plugins, None, "vendor.one", &bundle)
                .unwrap()
                .body,
            bytes
        );
        let roots = storage::StorageRoots {
            data: scratch.path("data"),
            program: scratch.path("program"),
        };
        let selected = scratch.path("selected");
        let doc_root = selected.join("plugin-data/vendor.one");
        fs::create_dir_all(&doc_root).unwrap();
        fs::write(doc_root.join("model.bin"), bytes).unwrap();
        let mut state = state::read_state(&state_path).unwrap();
        state.document_storage.insert(
            "vendor.one".into(),
            state::DocumentStorageSelection {
                kind: "custom".into(),
                custom_path: Some(selected.to_string_lossy().into_owned()),
            },
        );
        state::write_state(&state_path, &state).unwrap();
        let doc = AssetSource::Document("model.bin".into());
        assert_eq!(
            read_local_at(&state_path, &plugins, Some(&roots), "vendor.one", &doc)
                .unwrap()
                .body,
            bytes
        );
        assert!(read_local_at(&state_path, &plugins, Some(&roots), "vendor.two", &doc).is_err());
        for (enabled, quarantined) in [(false, false), (true, true)] {
            let record = state.plugins.get_mut("vendor.one").unwrap();
            record.enabled = enabled;
            record.quarantined = quarantined;
            state::write_state(&state_path, &state).unwrap();
            assert_eq!(
                read_local_at(&state_path, &plugins, None, "vendor.one", &bundle)
                    .unwrap_err()
                    .status(),
                StatusCode::FORBIDDEN
            );
        }
        state.plugins.remove("vendor.one");
        state::write_state(&state_path, &state).unwrap();
        assert_eq!(
            read_local_at(&state_path, &plugins, None, "vendor.one", &bundle)
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn directory_grants_require_directories_and_have_a_hard_limit() {
        let scratch = Scratch::new();
        let path = fixture(&scratch);
        let file = scratch.path("file");
        fs::write(&file, "not a directory").unwrap();
        assert!(grant_directory_at(&path, "vendor.one", &file).is_err());
        assert!(grant_directory_at(&path, "vendor.one", &scratch.path("missing")).is_err());
        for n in 0..MAX_DIRECTORIES {
            let root = scratch.path(&format!("root-{n}"));
            fs::create_dir_all(&root).unwrap();
            grant_directory_at(&path, "vendor.one", &root).unwrap();
        }
        let extra = scratch.path("extra");
        fs::create_dir_all(&extra).unwrap();
        assert!(grant_directory_at(&path, "vendor.one", &extra).is_err());
        assert!(grant_directory_at(&path, "vendor.two", &extra).is_ok());
        let mut state = state::read_state(&path).unwrap();
        state
            .plugins
            .get_mut("vendor.one")
            .unwrap()
            .permissions
            .clear();
        state::write_state(&path, &state).unwrap();
        assert!(list_directories_at(&path, "vendor.one").is_err());
        assert!(revoke_directory_at(&path, "vendor.one", "anything").is_err());
    }

    #[test]
    fn reparse_points_and_reveal_cannot_escape_the_grant() {
        let scratch = Scratch::new();
        let path = fixture(&scratch);
        let root = scratch.path("root");
        let outside = scratch.path("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret"), "secret").unwrap();
        fs::write(root.join("ok"), "ok").unwrap();
        let grant = grant_directory_at(&path, "vendor.one", &root).unwrap();
        assert!(create_dir_link(&root.join("link"), &outside));
        let source = AssetSource::Directory {
            grant_id: grant.grant_id,
            relative: "link/secret".into(),
        };
        assert_eq!(
            read_local_at(&path, &scratch.path("plugins"), None, "vendor.one", &source)
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert!(grant_directory_at(&path, "vendor.two", &root.join("link")).is_err());
        let expected = dunce::canonicalize(root.join("ok")).unwrap();
        assert_eq!(
            reveal_target_at(&path, None, "vendor.one", &root.join("ok")).unwrap(),
            expected
        );
        #[cfg(windows)]
        {
            let case_alias = PathBuf::from(root.join("ok").to_string_lossy().to_uppercase());
            assert_eq!(
                reveal_target_at(&path, None, "vendor.one", &case_alias).unwrap(),
                expected
            );
            let verbatim_alias = fs::canonicalize(root.join("ok")).unwrap();
            assert_eq!(
                reveal_target_at(&path, None, "vendor.one", &verbatim_alias).unwrap(),
                expected
            );
        }
        let inward_link = root.join("inside-link");
        assert!(create_dir_link(&inward_link, &root));
        assert!(reveal_target_at(&path, None, "vendor.one", &inward_link.join("ok")).is_err());
        fs::remove_dir(&inward_link)
            .or_else(|_| fs::remove_file(&inward_link))
            .unwrap();
        assert!(reveal_target_at(&path, None, "vendor.two", &root.join("ok")).is_err());
        assert!(reveal_target_at(&path, None, "vendor.one", &outside.join("secret")).is_err());
        assert!(reveal_target_at(&path, None, "vendor.one", &root.join("link/secret")).is_err());
        assert!(
            reveal_target_at(&path, None, "vendor.one", &root.join("../outside/secret")).is_err()
        );
        // Replacing the granted root itself must also invalidate access.
        fs::remove_dir(&root.join("link"))
            .or_else(|_| fs::remove_file(root.join("link")))
            .unwrap();
        fs::remove_file(root.join("ok")).unwrap();
        fs::remove_dir(&root).unwrap();
        assert!(create_dir_link(&root, &outside));
        let source = AssetSource::Directory {
            grant_id: list_directories_at(&path, "vendor.one").unwrap()[0]
                .grant_id
                .clone(),
            relative: "secret".into(),
        };
        assert_eq!(
            read_local_at(&path, &scratch.path("plugins"), None, "vendor.one", &source)
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN
        );
    }

    #[cfg(windows)]
    #[test]
    fn reveal_preflight_separates_volumes_shares_and_device_namespaces() {
        let local = Path::new(r"C:\Users\owner\models");
        assert!(reveal_prefix_matches(
            Path::new(r"c:\Users\OWNER~1\models\ok"),
            local
        ));
        assert!(reveal_prefix_matches(
            Path::new(r"\\?\C:\Users\owner\models\ok"),
            local
        ));
        assert!(!reveal_prefix_matches(Path::new(r"D:\models\ok"), local));
        assert!(!reveal_prefix_matches(
            Path::new(r"\\ungranted.invalid\share\ok"),
            local
        ));
        assert!(!reveal_prefix_matches(
            Path::new(r"\\?\UNC\ungranted.invalid\share\ok"),
            local
        ));
        assert!(!reveal_prefix_matches(
            Path::new(r"\\.\C:\models\ok"),
            local
        ));
        let share = Path::new(r"\\files.invalid\models\allowed");
        assert!(reveal_prefix_matches(
            Path::new(r"\\?\UNC\FILES.INVALID\MODELS\allowed\ok"),
            share
        ));
        assert!(!reveal_prefix_matches(
            Path::new(r"\\files.invalid\other-share\ok"),
            share
        ));
        assert!(!reveal_prefix_matches(
            Path::new(r"\\other.invalid\models\ok"),
            share
        ));
    }

    #[test]
    fn local_reads_enforce_the_limit_without_reading_an_unbounded_file() {
        let scratch = Scratch::new();
        let path = fixture(&scratch);
        let plugins = scratch.path("plugins");
        fs::create_dir_all(plugins.join("vendor.one")).unwrap();
        let file = fs::File::create(plugins.join("vendor.one/large.bin")).unwrap();
        file.set_len(MAX_LOCAL_ASSET_BYTES as u64 + 1).unwrap();
        assert_eq!(
            read_local_at(
                &path,
                &plugins,
                None,
                "vendor.one",
                &AssetSource::Bundle("large.bin".into())
            )
            .unwrap_err()
            .status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[test]
    fn local_reads_serve_files_above_the_remote_limit() {
        // The local and remote caps are separate on purpose: large texture
        // atlases routinely exceed the 8 MB network cap, and local reads must
        // still serve them.
        let scratch = Scratch::new();
        let path = fixture(&scratch);
        let plugins = scratch.path("plugins");
        fs::create_dir_all(plugins.join("vendor.one")).unwrap();
        let file = fs::File::create(plugins.join("vendor.one/texture.bin")).unwrap();
        file.set_len(MAX_ASSET_BYTES as u64 + 2).unwrap();
        let bytes = read_local_at(
            &path,
            &plugins,
            None,
            "vendor.one",
            &AssetSource::Bundle("texture.bin".into()),
        )
        .unwrap();
        assert_eq!(bytes.body.len(), MAX_ASSET_BYTES + 2);
    }

    fn network_permission(path: &Path, grants: &[String]) {
        let mut state = state::read_state(path).unwrap();
        state.plugins.get_mut("vendor.one").unwrap().permissions = grants.to_vec();
        state::write_state(path, &state).unwrap();
    }

    #[test]
    fn remote_grants_match_exact_domains_ports_and_reject_credentials() {
        let scratch = Scratch::new();
        let path = fixture(&scratch);
        network_permission(&path, &["network:Example.COM:8443".into()]);
        assert!(authorize_remote(
            &path,
            "vendor.one",
            &Url::parse("https://example.com:8443/a").unwrap()
        )
        .is_ok());
        for target in [
            "https://sub.example.com:8443/a",
            "https://example.com/a",
            "https://example.com.evil:8443/a",
            "https://user:pass@example.com:8443/a",
            "file:///tmp/a",
        ] {
            assert!(
                authorize_remote(&path, "vendor.one", &Url::parse(target).unwrap()).is_err(),
                "accepted {target}"
            );
        }
    }

    async fn serve_once(reply: Vec<u8>) -> (Url, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = Url::parse(&format!(
            "http://{}/model.json",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).await.unwrap();
                assert!(read > 0 && request.len() < 8192);
                request.extend_from_slice(&buffer[..read]);
            }
            // A cap rejection may close before all bytes have been written.
            let _ = stream.write_all(&reply).await;
        });
        (url, task)
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn remote_binary_is_lossless_and_chunked_response_has_a_hard_cap() {
        let scratch = Scratch::new();
        let path = fixture(&scratch);
        let mut reply = b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n".to_vec();
        reply.extend_from_slice(&[0, 255, 254, 128]);
        let (url, server) = serve_once(reply).await;
        network_permission(
            &path,
            &[format!("network:127.0.0.1:{}", url.port().unwrap())],
        );
        let AssetContent::Bytes(bytes) = read_remote_at(&path, "vendor.one", &url, &test_client())
            .await
            .unwrap()
        else {
            panic!("expected bytes")
        };
        assert_eq!(bytes.body, [0, 255, 254, 128]);
        server.await.unwrap();

        let mut reply = format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n",
            MAX_ASSET_BYTES + 1
        )
        .into_bytes();
        reply.resize(reply.len() + MAX_ASSET_BYTES + 1, 0xff);
        reply.extend_from_slice(b"\r\n0\r\n\r\n");
        let (url, server) = serve_once(reply).await;
        network_permission(
            &path,
            &[format!("network:127.0.0.1:{}", url.port().unwrap())],
        );
        assert_eq!(
            read_remote_at(&path, "vendor.one", &url, &test_client())
                .await
                .unwrap_err()
                .status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn redirects_cannot_contact_an_ungranted_port_or_hide_the_final_base() {
        let scratch = Scratch::new();
        let path = fixture(&scratch);
        let target_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = Url::parse(&format!(
            "http://{}/moved/model.json",
            target_listener.local_addr().unwrap()
        ))
        .unwrap();
        let redirect = || {
            format!("HTTP/1.1 302 Found\r\nLocation: {target}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes()
        };
        let (url, server) = serve_once(redirect()).await;
        network_permission(
            &path,
            &[format!("network:127.0.0.1:{}", url.port().unwrap())],
        );
        assert_eq!(
            read_remote_at(&path, "vendor.one", &url, &test_client())
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN
        );
        server.await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), target_listener.accept())
                .await
                .is_err()
        );

        let (url, server) = serve_once(redirect()).await;
        network_permission(&path, &["network:127.0.0.1".into()]);
        let AssetContent::Redirect(actual) =
            read_remote_at(&path, "vendor.one", &url, &test_client())
                .await
                .unwrap()
        else {
            panic!("expected proxy redirect")
        };
        assert_eq!(actual, target);
        server.await.unwrap();
        // Following is deliberately left to the browser via the rewritten
        // proxy URL; otherwise relative dependencies would use /model.json.
        assert!(
            tokio::time::timeout(Duration::from_millis(50), target_listener.accept())
                .await
                .is_err()
        );
    }
}
