//! MCP 配置与运行时清单（设置 → 能力扩展 → MCP）。
//!
//! 设计约束（对应迁移计划 §3.3 / §4.4）：
//! - 「配置已启用」与「运行时已连接」是两个独立分区，分别带自己的
//!   来源、采集时间与失败原因；
//! - 条目标识由后端生成，写入接口不接受前端指定文件路径；项目级来源的
//!   workspace 必须落在已注册工作区内（`files::ensure_allowed`）；
//! - 只对已验证写入语义的来源开放启停：Codex user/project 的
//!   `config.toml` `enabled` 字段、Claude 项目级 `.mcp.json` 的
//!   enabled/disabled 列表。Claude 用户级 `~/.claude.json` 没有可验证的
//!   原生停用开关，只读展示并说明原因；
//! - 写入同路径串行化 + 版本（内容哈希）冲突检测 + 原子替换；解析失败
//!   不写入、不重置；
//! - 列表/详情默认脱敏 URL 查询凭据、认证头与环境变量值。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

mod config;
pub mod launch;
pub(crate) mod lazy;
pub(crate) mod probe;
mod runtime;
mod sources;

use config::*;
use sources::{engine_of_source, engine_support};


/// 连接检测的目标解析：条目 id → 真实命令/地址（未脱敏，仅供探针使用）。
pub(crate) fn probe_target(
    entry_id: &str,
    workspace: Option<&str>,
) -> Result<probe::ProbeTarget, McpError> {
    let (source, name) = entry_id
        .split_once(':')
        .ok_or_else(|| McpError::invalid("invalid MCP entry id"))?;
    let name = name.trim();
    if name.is_empty() {
        return Err(McpError::invalid("MCP server name must not be empty"));
    }
    config::probe_target(source, name, workspace)
}

/// 写入同一路径的串行化锁：写入前回读 + 原子替换，配合这把锁避免本应用
/// 内部并发写互相覆盖。Claude/Codex（config）与新引擎（sources）共用一把。
pub(super) static WRITE_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
// `runtime` is called from the engine event pipeline (register/record/end),
// so its (pub(crate)) items must stay re-exported at crate scope.
pub(crate) use runtime::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpError {
    code: &'static str,
    message: String,
}

impl McpError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message)
    }
    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }
    pub(crate) fn format(message: impl Into<String>) -> Self {
        Self::new("format", message)
    }
    pub(crate) fn conflict(message: impl Into<String>) -> Self {
        Self::new("conflict", message)
    }
    pub(crate) fn from_io(error: std::io::Error, path: &std::path::Path) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => "not_found",
            std::io::ErrorKind::PermissionDenied => "permission",
            _ => "internal",
        };
        Self::new(code, format!("{}: {error}", path.display()))
    }
}

/// 一个配置来源里的服务条目（URL / env / header 已脱敏）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpConfigEntry {
    /// 后端生成的条目标识：`"{source}:{name}"`，前端只回传，不解析。
    pub(crate) id: String,
    pub(crate) engine: String,
    pub(crate) name: String,
    /// claude_user | claude_project | codex_user | codex_project
    pub(crate) source: String,
    /// user | project
    pub(crate) scope: String,
    /// 展示用文件路径（项目级显示 workspace 相对路径）。
    pub(crate) path: String,
    pub(crate) format: String,
    pub(crate) enabled: bool,
    pub(crate) transport: Option<String>,
    pub(crate) command: Option<String>,
    pub(crate) args_count: usize,
    pub(crate) url: Option<String>,
    pub(crate) env_keys: Vec<String>,
    pub(crate) header_keys: Vec<String>,
    pub(crate) writable: bool,
    pub(crate) readonly_reason: Option<String>,
    /// 只读原因码（UI 按 `mcp.readonlyReason.<code>` 本地化）；旧来源为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) readonly_reason_code: Option<String>,
    /// 读取时的文件内容哈希；写入时回读比对，不一致即冲突。
    pub(crate) version: String,
    /// 启动方式（launch.rs）：`eager` 随会话启动 / `onDemand` 首次调用时启动。
    pub(crate) launch_mode: String,
    /// 不能按需启动的原因码（engine | transport | workspace_file）；None = 可选。
    pub(crate) launch_mode_unsupported: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpSourceError {
    pub(crate) source: String,
    pub(crate) path: String,
    pub(crate) message: String,
}

/// 一个被读取的来源文件：即使尚未创建也会列出，让空状态能说明本页看了
/// 哪些位置。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpSourceInfo {
    pub(crate) source: String,
    pub(crate) path: String,
    pub(crate) exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpConfigSection {
    pub(crate) entries: Vec<McpConfigEntry>,
    pub(crate) errors: Vec<McpSourceError>,
}

/// 运行时条目：来自实际会话（Claude init 事件），带采集时间与所属会话。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpRuntimeEntry {
    pub(crate) name: String,
    pub(crate) status: Option<String>,
    pub(crate) builtin: bool,
    pub(crate) tool_names: Vec<String>,
    pub(crate) resources_count: usize,
    pub(crate) templates_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpRuntimeSection {
    /// ready | no_session | session_ended | unsupported | unavailable
    pub(crate) status: String,
    pub(crate) reason: Option<String>,
    pub(crate) workspace: Option<String>,
    pub(crate) session_id: Option<String>,
    pub(crate) collected_at: Option<i64>,
    pub(crate) entries: Vec<McpRuntimeEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpEngineInventory {
    pub(crate) id: String,
    pub(crate) available: bool,
    /// native（原生支持）/ plugin（由插件提供）/ none（不内置 MCP）。
    pub(crate) support: String,
    /// 该引擎会被读取的来源文件（未创建的也列出）。
    pub(crate) sources: Vec<McpSourceInfo>,
    pub(crate) config: McpConfigSection,
    pub(crate) runtime: McpRuntimeSection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpInventory {
    pub(crate) engines: Vec<McpEngineInventory>,
    pub(crate) collected_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpSetEnabledRequest {
    pub(crate) entry_id: String,
    pub(crate) enabled: bool,
    pub(crate) version: String,
    #[serde(default)]
    pub(crate) workspace: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpSetLaunchModeRequest {
    pub(crate) entry_id: String,
    /// `eager` | `onDemand`
    pub(crate) mode: String,
    #[serde(default)]
    pub(crate) workspace: Option<String>,
}

/// 配置清单：每个引擎都有独立分区；运行时可查询的引擎给快照，其余显式
/// 标注「当前构建无法查询」，不假装没有服务。
#[tauri::command]
pub(crate) async fn mcp_inventory(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    workspace: Option<String>,
) -> Result<McpInventory, McpError> {
    let workspace = validate_workspace(workspace.as_deref(), &db)?;
    let engines = crate::engine::list_engines()
        .await
        .map_err(McpError::internal)?;
    let available = |id: &str| {
        engines
            .iter()
            .find(|engine| engine.id == id)
            .map(|engine| engine.available)
            .unwrap_or(false)
    };
    let mut config = read_config_entries(workspace.as_deref());
    // 其余引擎的声明式来源（Kimi / Grok / OMP / OpenCode / Antigravity /
    // Qoder / dsh）追加到同一份清单，按 engine 过滤后分给各自的 tab。
    sources::append_entries(&mut config, workspace.as_deref());
    launch::annotate(&mut config, workspace.as_deref());
    let collected_at = now_ms();

    let by_engine = |engine: &str, runtime: McpRuntimeSection| {
        let mut section = McpConfigSection {
            entries: config
                .entries
                .iter()
                .filter(|entry| entry.engine == engine)
                .cloned()
                .collect(),
            errors: config
                .errors
                .iter()
                .filter(|error| engine_of_source(&error.source) == Some(engine))
                .cloned()
                .collect(),
        };
        // 稳定排序：来源 → 名称，保证列表顺序不随文件里的键序变化。
        section.entries.sort_by(|a, b| {
            a.source
                .cmp(&b.source)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        let mut sources = crate::mcp::config::engine_source_infos(engine, workspace.as_deref());
        sources.extend(sources::engine_source_infos(engine, workspace.as_deref()));
        McpEngineInventory {
            id: engine.to_string(),
            available: available(engine),
            support: engine_support(engine).to_string(),
            sources,
            config: section,
            runtime,
        }
    };

    let engines = crate::config::ENGINES
        .iter()
        .map(|engine| {
            // 目前只有 Claude 的会话会广播 MCP 快照；其余引擎保留
            // 「不支持查询」的显式状态。
            let runtime = if *engine == "claude" {
                runtime::claude_section(workspace.as_deref())
            } else {
                McpRuntimeSection {
                    // Localized by the UI; `unsupported` means "this build cannot
                    // query it", and no CLI/MCP process is ever started just to
                    // list servers.
                    status: "unsupported".to_string(),
                    reason: None,
                    workspace: None,
                    session_id: None,
                    collected_at: None,
                    entries: Vec::new(),
                }
            };
            by_engine(engine, runtime)
        })
        .collect();

    Ok(McpInventory {
        engines,
        collected_at,
    })
}

/// 切换一个配置条目的启用状态：版本比对 → 原子替换 → 回读实际状态。
#[tauri::command]
pub(crate) async fn mcp_set_enabled(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    request: McpSetEnabledRequest,
) -> Result<McpConfigEntry, McpError> {
    let workspace = validate_workspace(request.workspace.as_deref(), &db)?;
    write_enabled(
        &request.entry_id,
        request.enabled,
        &request.version,
        workspace.as_deref(),
    )
}

/// 切换一个条目的启动方式（只写 ccgui 自己的设置，不碰 CLI 配置）。
#[tauri::command]
pub(crate) async fn mcp_set_launch_mode(
    app: tauri::AppHandle,
    db: tauri::State<'_, Arc<crate::db::Db>>,
    request: McpSetLaunchModeRequest,
) -> Result<McpConfigEntry, McpError> {
    let workspace = validate_workspace(request.workspace.as_deref(), &db)?;
    let mut section = read_config_entries(workspace.as_deref());
    sources::append_entries(&mut section, workspace.as_deref());
    let entry = section
        .entries
        .iter()
        .find(|entry| entry.id == request.entry_id)
        .cloned()
        .ok_or_else(|| McpError::not_found("MCP entry not found"))?;
    launch::write_mode(&entry, &request.mode, workspace.as_deref())?;
    crate::settings::announce_settings(&app);
    launch::annotate(&mut section, workspace.as_deref());
    section
        .entries
        .into_iter()
        .find(|entry| entry.id == request.entry_id)
        .ok_or_else(|| McpError::not_found("MCP entry not found"))
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 项目级来源必须落在已注册工作区内；未注册路径直接拒绝，不读取其上的文件。
fn validate_workspace(
    workspace: Option<&str>,
    db: &crate::db::Db,
) -> Result<Option<String>, McpError> {
    let Some(raw) = workspace.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let resolved = crate::files::ensure_allowed(raw, db).map_err(McpError::invalid)?;
    Ok(Some(resolved.to_string_lossy().into_owned()))
}

/// 解析 JSON 文本（保留键序由 serde_json 的 preserve_order 特性提供）。
pub(crate) fn parse_json(text: &str, path: &str) -> Result<Value, McpError> {
    serde_json::from_str::<Value>(text)
        .map_err(|error| McpError::format(format!("{path}: invalid JSON: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_snapshot_is_workspace_scoped_and_marks_session_end() {
        runtime::register_run("run-mcp-test", "/tmp/ws-mcp-test");
        runtime::record_from_run(
            "run-mcp-test",
            Some("session-1"),
            vec![
                ("alpha".to_string(), Some("connected".to_string())),
                (crate::computer_use::MCP_SERVER_NAME.to_string(), None),
            ],
            vec![
                "mcp__alpha__search".to_string(),
                "mcp__alpha__fetch".to_string(),
                "Bash".to_string(),
            ],
        );
        let section = runtime::claude_section(Some("/tmp/ws-mcp-test"));
        assert_eq!(section.status, "ready");
        assert_eq!(section.session_id.as_deref(), Some("session-1"));
        let alpha = section.entries.iter().find(|e| e.name == "alpha").unwrap();
        assert_eq!(alpha.tool_names, vec!["fetch", "search"]);
        assert!(!alpha.builtin);
        let builtin = section
            .entries
            .iter()
            .find(|e| e.name == crate::computer_use::MCP_SERVER_NAME)
            .unwrap();
        assert!(builtin.builtin);

        runtime::mark_run_ended("run-mcp-test");
        let ended = runtime::claude_section(Some("/tmp/ws-mcp-test"));
        assert_eq!(ended.status, "session_ended");
        assert_eq!(ended.entries.len(), 2);

        // 未注册的 run 不写快照。
        runtime::record_from_run("unknown-run", None, vec![("x".to_string(), None)], vec![]);
        let other = runtime::claude_section(Some("/tmp/ws-mcp-other"));
        assert_eq!(other.status, "no_session");
        assert!(other.entries.is_empty());
        assert_eq!(runtime::claude_section(None).status, "no_session");
    }
}
