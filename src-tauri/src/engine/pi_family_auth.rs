//! pi/omp provider auth + custom-provider config (供应商认证).
//!
//! Ported from the reference desktop-cc-gui's pi_auth.rs / pi_models_config.rs,
//! generalized over the pi family:
//! - pi  keeps credentials in `<agent>/auth.json` and custom providers in
//!   `<agent>/models.json` (JSONC).
//! - omp (a pi fork) keeps credentials in the SQLite `auth_credentials` table
//!   of `<agent>/agent.db` and custom providers in `<agent>/models.yml` (YAML).
//!   Writes are plain INSERT/DELETE: omp's own triggers bump
//!   `auth_change_revision`, so running omp instances pick changes up.
//!
//! Shared contract:
//! - The CLI's store is the single source of truth; unknown entries and
//!   `oauth` credentials MUST survive writes untouched.
//! - File writes are atomic (same-dir tmp + rename) with `0600` on Unix.
//! - A corrupted store fails closed: errors are returned, never overwritten.
//! - Full API keys never leave this module: list output only carries a masked
//!   display string (head(6) + tail(4); short keys fully masked; `!` command /
//!   `$` env-interpolation keys are returned verbatim — they are not secrets).

use serde::Serialize;
use serde_json::{Map, Value};
use std::path::PathBuf;

use super::engine_home;

struct ProviderDef {
    id: &'static str,
    /// env var the CLI falls back to when no credential is stored;
    /// `None` marks OAuth-only providers (GitHub Copilot).
    env_var: Option<&'static str>,
}

/// Provider catalog aligned with pi v0.84.3's env map (omp forked the same
/// provider registry). `google-vertex` uses ADC/service accounts (no paste-able
/// key) and is deliberately excluded.
const PROVIDER_CATALOG: &[ProviderDef] = &[
    ProviderDef {
        id: "anthropic",
        env_var: Some("ANTHROPIC_API_KEY"),
    },
    ProviderDef {
        id: "ant-ling",
        env_var: Some("ANT_LING_API_KEY"),
    },
    ProviderDef {
        id: "azure-openai-responses",
        env_var: Some("AZURE_OPENAI_API_KEY"),
    },
    ProviderDef {
        id: "openai",
        env_var: Some("OPENAI_API_KEY"),
    },
    ProviderDef {
        id: "deepseek",
        env_var: Some("DEEPSEEK_API_KEY"),
    },
    ProviderDef {
        id: "nvidia",
        env_var: Some("NVIDIA_API_KEY"),
    },
    ProviderDef {
        id: "google",
        env_var: Some("GEMINI_API_KEY"),
    },
    ProviderDef {
        id: "amazon-bedrock",
        env_var: Some("AWS_BEARER_TOKEN_BEDROCK"),
    },
    ProviderDef {
        id: "mistral",
        env_var: Some("MISTRAL_API_KEY"),
    },
    ProviderDef {
        id: "groq",
        env_var: Some("GROQ_API_KEY"),
    },
    ProviderDef {
        id: "cerebras",
        env_var: Some("CEREBRAS_API_KEY"),
    },
    ProviderDef {
        id: "cloudflare-ai-gateway",
        env_var: Some("CLOUDFLARE_API_KEY"),
    },
    ProviderDef {
        id: "cloudflare-workers-ai",
        env_var: Some("CLOUDFLARE_API_KEY"),
    },
    ProviderDef {
        id: "xai",
        env_var: Some("XAI_API_KEY"),
    },
    ProviderDef {
        id: "openrouter",
        env_var: Some("OPENROUTER_API_KEY"),
    },
    ProviderDef {
        id: "vercel-ai-gateway",
        env_var: Some("AI_GATEWAY_API_KEY"),
    },
    ProviderDef {
        id: "zai",
        env_var: Some("ZAI_API_KEY"),
    },
    ProviderDef {
        id: "zai-coding-cn",
        env_var: Some("ZAI_CODING_CN_API_KEY"),
    },
    ProviderDef {
        id: "opencode",
        env_var: Some("OPENCODE_API_KEY"),
    },
    ProviderDef {
        id: "opencode-go",
        env_var: Some("OPENCODE_API_KEY"),
    },
    ProviderDef {
        id: "radius",
        env_var: Some("RADIUS_API_KEY"),
    },
    ProviderDef {
        id: "huggingface",
        env_var: Some("HF_TOKEN"),
    },
    ProviderDef {
        id: "fireworks",
        env_var: Some("FIREWORKS_API_KEY"),
    },
    ProviderDef {
        id: "together",
        env_var: Some("TOGETHER_API_KEY"),
    },
    ProviderDef {
        id: "baseten",
        env_var: Some("BASETEN_API_KEY"),
    },
    ProviderDef {
        id: "kimi-coding",
        env_var: Some("KIMI_API_KEY"),
    },
    ProviderDef {
        id: "moonshotai",
        env_var: Some("MOONSHOT_API_KEY"),
    },
    ProviderDef {
        id: "moonshotai-cn",
        env_var: Some("MOONSHOT_API_KEY"),
    },
    ProviderDef {
        id: "minimax",
        env_var: Some("MINIMAX_API_KEY"),
    },
    ProviderDef {
        id: "minimax-cn",
        env_var: Some("MINIMAX_CN_API_KEY"),
    },
    ProviderDef {
        id: "qwen-token-plan",
        env_var: Some("QWEN_TOKEN_PLAN_API_KEY"),
    },
    ProviderDef {
        id: "qwen-token-plan-individual",
        env_var: Some("QWEN_TOKEN_PLAN_API_KEY"),
    },
    ProviderDef {
        id: "qwen-token-plan-cn",
        env_var: Some("QWEN_TOKEN_PLAN_CN_API_KEY"),
    },
    ProviderDef {
        id: "xiaomi",
        env_var: Some("XIAOMI_API_KEY"),
    },
    ProviderDef {
        id: "xiaomi-token-plan-cn",
        env_var: Some("XIAOMI_TOKEN_PLAN_CN_API_KEY"),
    },
    ProviderDef {
        id: "xiaomi-token-plan-ams",
        env_var: Some("XIAOMI_TOKEN_PLAN_AMS_API_KEY"),
    },
    ProviderDef {
        id: "xiaomi-token-plan-sgp",
        env_var: Some("XIAOMI_TOKEN_PLAN_SGP_API_KEY"),
    },
    // OAuth-only (no env var / api_key path).
    ProviderDef {
        id: "github-copilot",
        env_var: None,
    },
];

fn catalog_entry(provider_id: &str) -> Option<&'static ProviderDef> {
    PROVIDER_CATALOG.iter().find(|item| item.id == provider_id)
}

fn home_dir_name(engine: &str) -> Result<&'static str, String> {
    match engine {
        "pi" => Ok(".pi"),
        "omp" => Ok(".omp"),
        _ => Err(format!(
            "[PI_FAMILY_AUTH_ENGINE] unsupported engine: {engine}"
        )),
    }
}

/// `<agent>` dir: `$PI_CODING_AGENT_DIR` when set (both CLIs honor it; omp kept
/// it from the pi fork), else `~/.pi/agent` / `~/.omp/agent`. Also the root of
/// the CLI's blob store, which history resolves `blob:sha256:` image refs
/// against (see `history::extract::pi_image_part`).
pub(crate) fn agent_dir(engine: &str) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("PI_CODING_AGENT_DIR").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    Ok(engine_home(None, home_dir_name(engine)?).join("agent"))
}

// ── shared output shapes ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProviderSnapshot {
    pub id: String,
    pub env_var: Option<String>,
    /// configured | none
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub masked_key: Option<String>,
    /// literal | command | envRef — how the CLI will resolve the stored key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthListResult {
    pub store: AuthStoreInfo,
    pub providers: Vec<AuthProviderSnapshot>,
    /// Provider ids holding an active OAuth credential (raw store ids — e.g.
    /// pi lands ChatGPT subscription logins under `openai-codex`).
    pub oauth_providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStoreInfo {
    pub path: String,
    /// authJson | sqlite
    pub kind: String,
    pub exists: bool,
}

/// Mask a stored key for display. Never exposes more than head(6) + tail(4).
fn mask_key(key: &str) -> String {
    if key.starts_with('!') || key.starts_with('$') {
        // Command execution / env interpolation: not a secret literal.
        return key.to_string();
    }
    if key.chars().count() > 10 {
        let head: String = key.chars().take(6).collect();
        let tail: String = key
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{head}········{tail}")
    } else {
        "········".to_string()
    }
}

fn key_source(key: &str) -> &'static str {
    if key.starts_with('!') {
        "command"
    } else if key.starts_with('$') {
        "envRef"
    } else {
        "literal"
    }
}

fn validate_new_key(provider_id: &str, key: &str) -> Result<String, String> {
    let def = catalog_entry(provider_id).ok_or_else(|| {
        format!("[PI_FAMILY_AUTH_UNKNOWN_PROVIDER] unknown provider: {provider_id}")
    })?;
    if def.env_var.is_none() {
        return Err(format!(
            "[PI_FAMILY_AUTH_OAUTH_ONLY] {provider_id} is OAuth-only; log in from the CLI instead"
        ));
    }
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("[PI_FAMILY_AUTH_EMPTY_KEY] API key must not be empty".to_string());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("[PI_FAMILY_AUTH_INVALID_KEY] API key must not contain newlines".to_string());
    }
    Ok(trimmed.to_string())
}

/// Snapshots for every catalog entry, given a lookup that yields the stored
/// literal key for an id.
fn snapshots_for(get_key: impl Fn(&str) -> Option<String>) -> Vec<AuthProviderSnapshot> {
    PROVIDER_CATALOG
        .iter()
        .map(|def| {
            // Deliberately auth-store only: the app process env ≠ the login
            // shell env the CLI actually inherits, so reporting "env active"
            // here would be unreliable.
            let (state, masked_key, src) = match get_key(def.id) {
                Some(key) => (
                    "configured".to_string(),
                    Some(mask_key(&key)),
                    Some(key_source(&key).to_string()),
                ),
                None => ("none".to_string(), None, None),
            };
            AuthProviderSnapshot {
                id: def.id.to_string(),
                env_var: def.env_var.map(str::to_string),
                state,
                masked_key,
                key_source: src,
            }
        })
        .collect()
}

// ── pi: auth.json ───────────────────────────────────────────────────────────

/// Read auth.json into a JSON object map.
/// - Missing file → `Ok(None)`.
/// - Corrupted JSON / non-object root → `Err` (fail-closed; never overwritten).
fn read_auth_map(path: &std::path::Path) -> Result<Option<Map<String, Value>>, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => {
            let value: Value = serde_json::from_str(&content).map_err(|error| {
                format!(
                    "[PI_FAMILY_AUTH_CORRUPTED] {} is not valid JSON: {error}",
                    path.display()
                )
            })?;
            match value {
                Value::Object(map) => Ok(Some(map)),
                _ => Err(format!(
                    "[PI_FAMILY_AUTH_CORRUPTED] {} root must be a JSON object",
                    path.display()
                )),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "[PI_FAMILY_AUTH_READ] read {}: {error}",
            path.display()
        )),
    }
}

/// Atomically write text: same-dir tmp file + rename, `0600` on Unix.
fn atomic_write_private(path: &std::path::Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "[PI_FAMILY_AUTH_WRITE] path has no parent dir".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "[PI_FAMILY_AUTH_WRITE] create {}: {error}",
            parent.display()
        )
    })?;

    let tmp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("auth"),
        std::process::id()
    ));
    let write_result = (|| {
        std::fs::write(&tmp, content)
            .map_err(|error| format!("[PI_FAMILY_AUTH_WRITE] write tmp: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("[PI_FAMILY_AUTH_WRITE] chmod 0600: {error}"))?;
        }
        std::fs::rename(&tmp, path).map_err(|error| {
            format!(
                "[PI_FAMILY_AUTH_WRITE] rename over {}: {error}",
                path.display()
            )
        })?;
        Ok::<(), String>(())
    })();

    if write_result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    write_result
}

fn write_auth_map(path: &std::path::Path, map: &Map<String, Value>) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|error| format!("[PI_FAMILY_AUTH_WRITE] serialize: {error}"))?;
    atomic_write_private(path, &format!("{content}\n"))
}

fn pi_list(agent: &std::path::Path) -> Result<AuthListResult, String> {
    let path = agent.join("auth.json");
    let map = read_auth_map(&path)?;
    let exists = map.is_some();
    let map = map.unwrap_or_default();

    let oauth_providers = map
        .iter()
        .filter(|(_, item)| item.get("type").and_then(Value::as_str) == Some("oauth"))
        .map(|(id, _)| id.clone())
        .collect();

    Ok(AuthListResult {
        store: AuthStoreInfo {
            path: path.to_string_lossy().to_string(),
            kind: "authJson".to_string(),
            exists,
        },
        providers: snapshots_for(|id| {
            map.get(id)
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("api_key"))
                .and_then(|item| item.get("key"))
                .and_then(Value::as_str)
                .map(str::to_string)
        }),
        oauth_providers,
    })
}

fn pi_set_api_key(agent: &std::path::Path, provider_id: &str, key: &str) -> Result<(), String> {
    let key = validate_new_key(provider_id, key)?;
    let path = agent.join("auth.json");
    let mut map = read_auth_map(&path)?.unwrap_or_default();
    let mut credential = Map::new();
    credential.insert("type".to_string(), Value::String("api_key".to_string()));
    credential.insert("key".to_string(), Value::String(key));
    map.insert(provider_id.to_string(), Value::Object(credential));
    write_auth_map(&path, &map)
}

fn pi_delete_credential(agent: &std::path::Path, provider_id: &str) -> Result<(), String> {
    catalog_entry(provider_id).ok_or_else(|| {
        format!("[PI_FAMILY_AUTH_UNKNOWN_PROVIDER] unknown provider: {provider_id}")
    })?;
    let path = agent.join("auth.json");
    let mut map = match read_auth_map(&path)? {
        Some(map) => map,
        None => return Ok(()), // nothing to delete
    };
    if let Some(entry) = map.get(provider_id) {
        let entry_type = entry.get("type").and_then(Value::as_str).unwrap_or("");
        if entry_type == "oauth" {
            return Err(format!(
                "[PI_FAMILY_AUTH_OAUTH_MANAGED] {provider_id} is an OAuth credential managed by pi itself; run `pi /logout` in a terminal"
            ));
        }
    }
    map.remove(provider_id);
    write_auth_map(&path, &map)
}

// ── omp: agent.db auth_credentials ──────────────────────────────────────────
//
// omp's credential store: rows (provider, credential_type, data JSON,
// identity_key, disabled_cause, …); api_key data is `{"key":"…"}`. Triggers
// installed by omp bump `auth_change_revision` on every INSERT/UPDATE/DELETE,
// and live omp instances watch `PRAGMA data_version`, so direct writes are
// picked up without a restart. WAL mode permits the concurrent access.

fn omp_connect(
    agent: &std::path::Path,
    read_only: bool,
) -> Result<(rusqlite::Connection, PathBuf), String> {
    let path = agent.join("agent.db");
    if read_only && !path.exists() {
        return Err("[PI_FAMILY_AUTH_DB_MISSING] agent.db does not exist yet".to_string());
    }
    let conn = if read_only {
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    } else {
        rusqlite::Connection::open(&path)
    }
    .map_err(|error| format!("[PI_FAMILY_AUTH_DB] open {}: {error}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("[PI_FAMILY_AUTH_DB] busy_timeout: {error}"))?;
    let has_table: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'auth_credentials'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .map_err(|error| format!("[PI_FAMILY_AUTH_DB] schema probe: {error}"))?;
    if !has_table {
        return Err(
            "[PI_FAMILY_AUTH_DB_SCHEMA] auth_credentials table missing — run omp once to initialize its store"
                .to_string(),
        );
    }
    Ok((conn, path))
}

fn omp_list(agent: &std::path::Path) -> Result<AuthListResult, String> {
    let path = agent.join("agent.db");
    let exists = path.exists();
    if !exists {
        return Ok(AuthListResult {
            store: AuthStoreInfo {
                path: path.to_string_lossy().to_string(),
                kind: "sqlite".to_string(),
                exists: false,
            },
            providers: snapshots_for(|_| None),
            oauth_providers: Vec::new(),
        });
    }
    let (conn, path) = omp_connect(agent, true)?;
    let mut stmt = conn
        .prepare("SELECT provider, credential_type, data FROM auth_credentials WHERE disabled_cause IS NULL")
        .map_err(|error| format!("[PI_FAMILY_AUTH_DB] query: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("[PI_FAMILY_AUTH_DB] read credentials: {error}"))?;

    let mut keys: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut oauth_providers = Vec::new();
    for row in rows {
        let (provider, credential_type, data) =
            row.map_err(|error| format!("[PI_FAMILY_AUTH_DB] row: {error}"))?;
        match credential_type.as_str() {
            "api_key" => {
                if let Some(key) = serde_json::from_str::<Value>(&data)
                    .ok()
                    .and_then(|v| v.get("key").and_then(Value::as_str).map(str::to_string))
                {
                    keys.entry(provider).or_insert(key);
                }
            }
            "oauth" => {
                if !oauth_providers.contains(&provider) {
                    oauth_providers.push(provider);
                }
            }
            _ => {}
        }
    }

    Ok(AuthListResult {
        store: AuthStoreInfo {
            path: path.to_string_lossy().to_string(),
            kind: "sqlite".to_string(),
            exists: true,
        },
        providers: snapshots_for(|id| keys.get(id).cloned()),
        oauth_providers,
    })
}

fn omp_set_api_key(agent: &std::path::Path, provider_id: &str, key: &str) -> Result<(), String> {
    let key = validate_new_key(provider_id, key)?;
    let (conn, _) = omp_connect(agent, false)?;
    let data = serde_json::json!({ "key": key }).to_string();
    conn.execute(
        "DELETE FROM auth_credentials WHERE provider = ?1 AND credential_type = 'api_key'",
        [provider_id],
    )
    .map_err(|error| format!("[PI_FAMILY_AUTH_DB] replace key: {error}"))?;
    conn.execute(
        "INSERT INTO auth_credentials (provider, credential_type, data, identity_key) VALUES (?1, 'api_key', ?2, NULL)",
        rusqlite::params![provider_id, data],
    )
    .map_err(|error| format!("[PI_FAMILY_AUTH_DB] insert key: {error}"))?;
    Ok(())
}

fn omp_delete_credential(agent: &std::path::Path, provider_id: &str) -> Result<(), String> {
    catalog_entry(provider_id).ok_or_else(|| {
        format!("[PI_FAMILY_AUTH_UNKNOWN_PROVIDER] unknown provider: {provider_id}")
    })?;
    let path = agent.join("agent.db");
    if !path.exists() {
        return Ok(()); // nothing to delete
    }
    let (conn, _) = omp_connect(agent, false)?;
    let api_keys: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM auth_credentials WHERE provider = ?1 AND credential_type = 'api_key'",
            [provider_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("[PI_FAMILY_AUTH_DB] count: {error}"))?;
    if api_keys == 0 {
        let oauth: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM auth_credentials WHERE provider = ?1 AND credential_type = 'oauth'",
                [provider_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("[PI_FAMILY_AUTH_DB] count: {error}"))?;
        if oauth > 0 {
            return Err(format!(
                "[PI_FAMILY_AUTH_OAUTH_MANAGED] {provider_id} is an OAuth credential managed by omp itself; run `omp auth-broker logout {provider_id}` in a terminal"
            ));
        }
        return Ok(());
    }
    conn.execute(
        "DELETE FROM auth_credentials WHERE provider = ?1 AND credential_type = 'api_key'",
        [provider_id],
    )
    .map_err(|error| format!("[PI_FAMILY_AUTH_DB] delete: {error}"))?;
    Ok(())
}

// ── custom providers: models.json (pi) / models.yml (omp) ──────────────────
//
// Deliberately different secrecy boundary from the credential stores above:
// `apiKey` values here are the user's own config text (literal / `$ENV` /
// `!command`), so the raw file text IS returned for editing.

/// pi template (JSON with comments); omp gets the YAML equivalent below.
const MODELS_TEMPLATE_JSON: &str = r#"{
  "providers": {
    "my-relay": {
      "baseUrl": "https://your-relay.com/v1",
      // api type: openai-completions | openai-responses | anthropic-messages | google-generative-ai
      "api": "openai-responses",
      // prefer an env var reference; literal keys and !command (e.g. !op read 'op://vault/item') also work
      "apiKey": "$MY_RELAY_API_KEY",
      "models": [
        {
          "id": "grok-4.6",
          "name": "Grok 4.6 (relay)",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 500000,
          "maxTokens": 500000
        }
      ]
    }
  }
}
"#;

const MODELS_TEMPLATE_YAML: &str = r#"providers:
  my-relay:
    baseUrl: https://your-relay.com/v1
    # api type: openai-completions | openai-responses | anthropic-messages | google-generative-ai
    api: openai-completions
    # prefer an env var reference; literal keys also work
    apiKey: $MY_RELAY_API_KEY
    models:
      - id: grok-4.6
        name: Grok 4.6 (relay)
        reasoning: true
        input: [text, image]
        contextWindow: 500000
        maxTokens: 500000
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderSummary {
    pub id: String,
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub api: Option<String>,
    pub model_count: usize,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsConfigReadResult {
    pub file: ModelsFileInfo,
    /// Raw file text (comments included); `None` when the file does not exist.
    pub text: Option<String>,
    /// Default example for the editor when `text` is missing/blank.
    pub template: String,
    pub providers: Vec<CustomProviderSummary>,
    /// Human-readable parse error when the file is corrupted; summaries stay empty.
    pub parse_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsFileInfo {
    pub path: String,
    /// json | yaml
    pub format: String,
    pub exists: bool,
}

fn models_config_path(agent: &std::path::Path, engine: &str) -> Result<PathBuf, String> {
    let file = match engine {
        "pi" => "models.json",
        "omp" => "models.yml",
        _ => {
            return Err(format!(
                "[PI_FAMILY_AUTH_ENGINE] unsupported engine: {engine}"
            ))
        }
    };
    Ok(agent.join(file))
}

/// Strip `//` and `/* */` comments outside string literals (JSONC → JSON).
/// Kept deliberately small; sufficient for hand-written config files.
fn strip_jsonc_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => {
                in_string = true;
                out.push(ch);
            }
            '/' if chars.peek() == Some(&'/') => {
                for c in chars.by_ref() {
                    if c == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next(); // consume '*'
                let mut prev = '\0';
                for c in chars.by_ref() {
                    if prev == '*' && c == '/' {
                        break;
                    }
                    prev = c;
                }
            }
            _ => out.push(ch),
        }
    }
    out
}

/// Loose structural validation: parseable, `providers` is a map, each
/// provider's `models` items carry a string `id`. Unknown fields are accepted
/// and preserved (the raw user text is stored verbatim).
pub(crate) fn validate_models_config_text(engine: &str, text: &str) -> Result<Value, String> {
    let value: Value = if engine == "omp" {
        serde_yaml::from_str(text).map_err(|error| {
            format!("[PI_FAMILY_MODELS_INVALID] models.yml is not valid YAML: {error}")
        })?
    } else {
        let stripped = strip_jsonc_comments(text);
        serde_json::from_str(&stripped).map_err(|error| {
            format!("[PI_FAMILY_MODELS_INVALID] models.json is not valid JSON: {error}")
        })?
    };
    let root = value
        .as_object()
        .ok_or_else(|| "[PI_FAMILY_MODELS_SHAPE] root must be a mapping".to_string())?;
    if let Some(providers) = root.get("providers") {
        let providers = providers.as_object().ok_or_else(|| {
            "[PI_FAMILY_MODELS_SHAPE] providers must be a mapping (providerId → config)".to_string()
        })?;
        for (provider_id, provider) in providers {
            if !provider.is_object() {
                return Err(format!(
                    "[PI_FAMILY_MODELS_SHAPE] providers.{provider_id} must be a mapping"
                ));
            }
            if let Some(models) = provider.get("models") {
                let models = models.as_array().ok_or_else(|| {
                    format!(
                        "[PI_FAMILY_MODELS_SHAPE] providers.{provider_id}.models must be a list"
                    )
                })?;
                for (index, model) in models.iter().enumerate() {
                    let has_id = model.get("id").and_then(Value::as_str).is_some();
                    if !has_id {
                        return Err(format!(
                            "[PI_FAMILY_MODELS_SHAPE] providers.{provider_id}.models[{index}] needs a string id"
                        ));
                    }
                }
            }
        }
    }
    Ok(value)
}

fn summarize_providers(value: &Value) -> Vec<CustomProviderSummary> {
    let mut out = Vec::new();
    let Some(providers) = value.get("providers").and_then(Value::as_object) else {
        return out;
    };
    for (id, provider) in providers {
        let model_count = provider
            .get("models")
            .and_then(Value::as_array)
            .map(|models| models.len())
            .unwrap_or(0);
        let has_api_key = provider
            .get("apiKey")
            .and_then(Value::as_str)
            .map(|key| !key.trim().is_empty())
            .unwrap_or(false);
        out.push(CustomProviderSummary {
            id: id.clone(),
            name: provider
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string),
            base_url: provider
                .get("baseUrl")
                .and_then(Value::as_str)
                .map(str::to_string),
            api: provider
                .get("api")
                .and_then(Value::as_str)
                .map(str::to_string),
            model_count,
            has_api_key,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn read_models_config(
    agent: &std::path::Path,
    engine: &str,
) -> Result<ModelsConfigReadResult, String> {
    let path = models_config_path(agent, engine)?;
    let (format, template) = if engine == "omp" {
        ("yaml", MODELS_TEMPLATE_YAML)
    } else {
        ("json", MODELS_TEMPLATE_JSON)
    };
    let file_info = |exists: bool| ModelsFileInfo {
        path: path.to_string_lossy().to_string(),
        format: format.to_string(),
        exists,
    };

    let text = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ModelsConfigReadResult {
                file: file_info(false),
                text: None,
                template: template.to_string(),
                providers: Vec::new(),
                parse_error: None,
            });
        }
        Err(error) => {
            return Err(format!(
                "[PI_FAMILY_MODELS_READ] read {}: {error}",
                path.display()
            ));
        }
    };

    if text.trim().is_empty() {
        return Ok(ModelsConfigReadResult {
            file: file_info(true),
            text: Some(text),
            template: template.to_string(),
            providers: Vec::new(),
            parse_error: None,
        });
    }

    match validate_models_config_text(engine, &text) {
        Ok(value) => Ok(ModelsConfigReadResult {
            file: file_info(true),
            text: Some(text),
            template: template.to_string(),
            providers: summarize_providers(&value),
            parse_error: None,
        }),
        Err(error) => Ok(ModelsConfigReadResult {
            file: file_info(true),
            text: Some(text),
            template: template.to_string(),
            providers: Vec::new(),
            parse_error: Some(error),
        }),
    }
}

fn write_models_config(agent: &std::path::Path, engine: &str, text: &str) -> Result<(), String> {
    // Fail-closed: any validation error leaves the existing file untouched.
    validate_models_config_text(engine, text)?;
    let path = models_config_path(agent, engine)?;
    atomic_write_private(&path, text)
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// List the pi-family provider catalog with credential states (keys masked).
#[tauri::command]
pub fn pi_family_auth_list(engine: String) -> Result<AuthListResult, String> {
    let agent = agent_dir(&engine)?;
    match engine.as_str() {
        "pi" => pi_list(&agent),
        "omp" => omp_list(&agent),
        _ => unreachable!(),
    }
}

/// Set (create/replace) an API key credential.
#[tauri::command]
pub fn pi_family_auth_set_api_key(
    engine: String,
    provider_id: String,
    key: String,
) -> Result<(), String> {
    let agent = agent_dir(&engine)?;
    match engine.as_str() {
        "pi" => pi_set_api_key(&agent, &provider_id, &key),
        "omp" => omp_set_api_key(&agent, &provider_id, &key),
        _ => unreachable!(),
    }
}

/// Delete an api_key credential (OAuth entries are refused).
#[tauri::command]
pub fn pi_family_auth_delete_credential(engine: String, provider_id: String) -> Result<(), String> {
    let agent = agent_dir(&engine)?;
    match engine.as_str() {
        "pi" => pi_delete_credential(&agent, &provider_id),
        "omp" => omp_delete_credential(&agent, &provider_id),
        _ => unreachable!(),
    }
}

/// Read models.json / models.yml: raw text + provider summaries + parse error.
#[tauri::command]
pub fn pi_family_models_config_read(engine: String) -> Result<ModelsConfigReadResult, String> {
    read_models_config(&agent_dir(&engine)?, &engine)
}

/// Write models.json / models.yml after loose validation. Raw text is stored
/// verbatim (comments and field order survive).
#[tauri::command]
pub fn pi_family_models_config_write(engine: String, text: String) -> Result<(), String> {
    write_models_config(&agent_dir(&engine)?, &engine, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-pi-family-auth-test-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn mask_key_boundaries() {
        assert_eq!(mask_key("!op read x"), "!op read x");
        assert_eq!(mask_key("$ENV"), "$ENV");
        assert_eq!(mask_key("short"), "········");
        let masked = mask_key("sk-ant-1234567890abcd");
        assert!(masked.starts_with("sk-ant"));
        assert!(masked.ends_with("abcd"));
        assert!(masked.contains("········"));
        assert!(!masked.contains("123456"));
    }

    #[test]
    fn strips_jsonc_comments() {
        let input = "{\n  // line\n  \"a\": \"http://x\", /* block */ \"b\": 1\n}";
        let value: Value = serde_json::from_str(&strip_jsonc_comments(input)).unwrap();
        assert_eq!(value["a"], "http://x");
        assert_eq!(value["b"], 1);
    }

    #[test]
    fn pi_set_list_delete_roundtrip_preserves_oauth_and_unknown() {
        let dir = temp_dir("pi-roundtrip");
        // Pre-existing oauth + unknown entries must survive writes.
        std::fs::write(
            dir.join("auth.json"),
            r#"{"openai-codex": {"type": "oauth", "refresh": "r"}, "custom-x": {"type": "api_key", "key": "keepme", "env": {"A": "B"}}}"#,
        )
        .unwrap();

        pi_set_api_key(&dir, "anthropic", "sk-ant-test-123456").unwrap();
        let list = pi_list(&dir).unwrap();
        assert!(list.store.exists);
        let anthropic = list.providers.iter().find(|p| p.id == "anthropic").unwrap();
        assert_eq!(anthropic.state, "configured");
        assert!(anthropic
            .masked_key
            .as_deref()
            .unwrap()
            .contains("········"));
        assert_eq!(list.oauth_providers, vec!["openai-codex".to_string()]);

        // Raw file still carries the preserved entries.
        let raw: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("auth.json")).unwrap()).unwrap();
        assert_eq!(raw["openai-codex"]["type"], "oauth");
        assert_eq!(raw["custom-x"]["key"], "keepme");
        assert_eq!(raw["anthropic"]["key"], "sk-ant-test-123456");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join("auth.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        pi_delete_credential(&dir, "anthropic").unwrap();
        let list = pi_list(&dir).unwrap();
        assert_eq!(
            list.providers
                .iter()
                .find(|p| p.id == "anthropic")
                .unwrap()
                .state,
            "none"
        );

        // OAuth-only catalog entries refuse API-key writes.
        let err = pi_set_api_key(&dir, "github-copilot", "x").unwrap_err();
        assert!(err.contains("OAUTH_ONLY"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pi_corrupted_auth_fails_closed() {
        let dir = temp_dir("pi-corrupt");
        std::fs::write(dir.join("auth.json"), "{not json").unwrap();
        assert!(pi_list(&dir).unwrap_err().contains("CORRUPTED"));
        assert!(pi_set_api_key(&dir, "anthropic", "sk-test-value-1").is_err());
        // Never overwritten.
        assert_eq!(
            std::fs::read_to_string(dir.join("auth.json")).unwrap(),
            "{not json"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Mirror of omp's schema + revision triggers (from omp's auth
    /// migrations), so tests exercise the same write path live omp uses.
    fn create_omp_db(dir: &std::path::Path) {
        let conn = rusqlite::Connection::open(dir.join("agent.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE auth_credentials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                credential_type TEXT NOT NULL,
                data TEXT NOT NULL,
                disabled_cause TEXT DEFAULT NULL,
                identity_key TEXT DEFAULT NULL,
                created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
                updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
            );
            CREATE TABLE auth_change_revision (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
            INSERT INTO auth_change_revision (id, revision) VALUES (1, 0);
            CREATE TRIGGER auth_change_revision_auth_credentials_insert AFTER INSERT ON auth_credentials
                BEGIN UPDATE auth_change_revision SET revision = revision + 1 WHERE id = 1; END;
            CREATE TRIGGER auth_change_revision_auth_credentials_delete AFTER DELETE ON auth_credentials
                BEGIN UPDATE auth_change_revision SET revision = revision + 1 WHERE id = 1; END;",
        )
        .unwrap();
    }

    fn omp_revision(dir: &std::path::Path) -> i64 {
        let conn = rusqlite::Connection::open(dir.join("agent.db")).unwrap();
        conn.query_row(
            "SELECT revision FROM auth_change_revision WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn omp_missing_db_lists_all_none_without_creating() {
        let dir = temp_dir("omp-missing");
        let list = omp_list(&dir).unwrap();
        assert!(!list.store.exists);
        assert!(list.providers.iter().all(|p| p.state == "none"));
        assert!(!dir.join("agent.db").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn omp_set_list_delete_roundtrip() {
        let dir = temp_dir("omp-roundtrip");
        create_omp_db(&dir);

        omp_set_api_key(&dir, "openai", "sk-test-openai-123").unwrap();
        assert!(omp_revision(&dir) > 0); // omp's triggers fired
        let list = omp_list(&dir).unwrap();
        assert!(list.store.exists);
        let openai = list.providers.iter().find(|p| p.id == "openai").unwrap();
        assert_eq!(openai.state, "configured");
        assert_eq!(openai.key_source.as_deref(), Some("literal"));

        // Replace: the masked key tracks the new value.
        omp_set_api_key(&dir, "openai", "sk-test-openai-456").unwrap();
        let list = omp_list(&dir).unwrap();
        let openai = list.providers.iter().find(|p| p.id == "openai").unwrap();
        assert!(openai.masked_key.as_deref().unwrap().ends_with("-456"));

        // OAuth rows survive api_key writes and are listed separately.
        let (conn, _) = omp_connect(&dir, false).unwrap();
        conn.execute(
            "INSERT INTO auth_credentials (provider, credential_type, data, identity_key) VALUES ('openai-codex', 'oauth', '{\"access\":\"a\"}', 'k')",
            [],
        )
        .unwrap();
        drop(conn);
        omp_set_api_key(&dir, "openai", "sk-test-openai-789").unwrap();
        let list = omp_list(&dir).unwrap();
        assert_eq!(list.oauth_providers, vec!["openai-codex".to_string()]);

        // Delete removes only api_key rows; oauth-only providers refuse.
        omp_delete_credential(&dir, "openai").unwrap();
        let list = omp_list(&dir).unwrap();
        assert_eq!(
            list.providers
                .iter()
                .find(|p| p.id == "openai")
                .unwrap()
                .state,
            "none"
        );
        assert_eq!(list.oauth_providers, vec!["openai-codex".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn models_config_validate_and_summarize() {
        // pi: JSONC with comments.
        let json = "{\n  // relay\n  \"providers\": {\"r\": {\"baseUrl\": \"https://x/v1\", \"apiKey\": \"$K\", \"models\": [{\"id\": \"m1\"}]}}\n}";
        let value = validate_models_config_text("pi", json).unwrap();
        let summaries = summarize_providers(&value);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "r");
        assert_eq!(summaries[0].model_count, 1);
        assert!(summaries[0].has_api_key);
        assert!(
            validate_models_config_text("pi", "{\"providers\": {\"r\": {\"models\": [{}]}}}")
                .is_err()
        );

        // omp: YAML.
        let yaml = "providers:\n  r:\n    baseUrl: https://x/v1\n    api: openai-completions\n    models:\n      - id: m1\n      - id: m2\n";
        let value = validate_models_config_text("omp", yaml).unwrap();
        let summaries = summarize_providers(&value);
        assert_eq!(summaries[0].model_count, 2);
        assert!(!summaries[0].has_api_key);
        assert!(validate_models_config_text("omp", "providers: [not-a-map]").is_err());
    }

    #[test]
    fn models_config_read_write_roundtrip() {
        let dir = temp_dir("models");
        // Missing file: no text, template offered, nothing written.
        let read = read_models_config(&dir, "pi").unwrap();
        assert!(!read.file.exists);
        assert!(read.text.is_none());
        assert!(read.template.contains("providers"));

        write_models_config(&dir, "pi", "{\n  \"providers\": {}\n}\n").unwrap();
        let read = read_models_config(&dir, "pi").unwrap();
        assert!(read.file.exists);
        assert_eq!(read.file.format, "json");
        assert!(read.parse_error.is_none());

        // Corrupted file: read reports parse_error; invalid writes leave the
        // file untouched.
        std::fs::write(dir.join("models.json"), "{bad").unwrap();
        let read = read_models_config(&dir, "pi").unwrap();
        assert!(read.parse_error.is_some());
        assert!(write_models_config(&dir, "pi", "{also bad").is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("models.json")).unwrap(),
            "{bad"
        );

        // omp lands on models.yml.
        write_models_config(&dir, "omp", MODELS_TEMPLATE_YAML).unwrap();
        let read = read_models_config(&dir, "omp").unwrap();
        assert!(read.file.path.ends_with("models.yml"));
        assert_eq!(read.file.format, "yaml");
        assert_eq!(read.providers.len(), 1);
        assert_eq!(read.providers[0].id, "my-relay");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
