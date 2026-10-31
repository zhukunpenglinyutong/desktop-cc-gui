//! 启停写入：只对在本机真实 CLI 上验证过语义的来源开放（grok / opencode / omp）。
//!
//! 三个不变量：写入前比对文件哈希（外部改动即拒绝）、只改目标条目那一个
//! 字段、原子替换后回读文件作为返回状态。

use super::read::{is_jsonc, read_dsh_profile, read_json_source, read_toml_source, string_array};
use super::{candidate_paths, first_existing, source_spec, Source, Toggle, SOURCES};
use crate::mcp::config::{file_hash, read_text};
use crate::mcp::{parse_json, McpConfigEntry, McpError, WRITE_LOCK};
use serde_json::Value;
use std::path::Path;
use toml_edit::{value as toml_value, Array, DocumentMut};

pub(crate) fn write_enabled(
    source_id: &str,
    name: &str,
    enabled: bool,
    expected_version: &str,
    workspace: Option<&str>,
) -> Result<McpConfigEntry, McpError> {
    let spec = source_spec(source_id).ok_or_else(|| McpError::invalid("unknown MCP source"))?;
    if !spec.writable {
        return Err(McpError::new(
            "readonly",
            spec.readonly_reason
                .or(spec.readonly_reason_code)
                .unwrap_or("this MCP source is read-only"),
        ));
    }
    let source = SOURCES
        .iter()
        .find(|source| source.id == source_id)
        .ok_or_else(|| McpError::invalid("unknown MCP source"))?;
    let path = first_existing(candidate_paths(source_id, workspace)).ok_or_else(|| {
        McpError::not_found("配置文件不存在，未做修改".to_string())
    })?;
    let _guard = WRITE_LOCK.lock();
    match source_id {
        "grok_user" => set_grok_user_enabled(&path, name, enabled, expected_version)?,
        "opencode_user" | "opencode_project" | "omp_user" | "omp_project" => {
            set_json_enabled(source, &path, name, enabled, expected_version)?
        }
        _ => {
            return Err(McpError::new(
                "readonly",
                "this MCP source is read-only in the current build",
            ))
        }
    }
    reread_entry(source, &path, name)
}

fn reread_entry(source: &Source, path: &Path, name: &str) -> Result<McpConfigEntry, McpError> {
    let entries = match source.format {
        "toml" => read_toml_source(source, path)?,
        "yaml" => read_dsh_profile(path)?,
        _ => read_json_source(source, path)?,
    };
    entries
        .into_iter()
        .find(|entry| entry.name == name)
        .ok_or_else(|| McpError::not_found(format!("写入后未找到 MCP 服务「{name}」")))
}

pub(super) fn verify_version(raw: &str, expected_version: &str) -> Result<(), McpError> {
    let current = file_hash(raw.as_bytes());
    if !expected_version.is_empty() && current != expected_version {
        return Err(McpError::conflict("配置文件已被外部修改，请刷新后重试"));
    }
    Ok(())
}

/// JSON 来源：只改服务表里那一个条目的启停字段，不动其他键与键序。
pub(super) fn set_json_enabled(
    source: &Source,
    path: &Path,
    name: &str,
    enabled: bool,
    expected_version: &str,
) -> Result<(), McpError> {
    if is_jsonc(path) {
        return Err(McpError::new(
            "readonly",
            "JSONC 文件带注释，写入会丢注释，未做修改",
        ));
    }
    let raw = read_text(path)?;
    verify_version(&raw, expected_version)?;
    let mut root = parse_json(&raw, &path.to_string_lossy())?;
    let servers = root
        .get_mut(source.servers_key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| McpError::not_found(format!("配置文件中没有 {} 表", source.servers_key)))?;
    let entry = servers
        .get_mut(name)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| McpError::not_found(format!("配置文件中不存在 MCP 服务「{name}」")))?;
    match source.toggle {
        Some(Toggle::Enabled) => {
            entry.insert("enabled".to_string(), Value::Bool(enabled));
        }
        Some(Toggle::Disabled) => {
            entry.insert("disabled".to_string(), Value::Bool(!enabled));
        }
        None => return Err(McpError::new("readonly", "该来源没有原生启停开关")),
    }
    let mut text = serde_json::to_string_pretty(&root)
        .map_err(|error| McpError::internal(error.to_string()))?;
    text.push('\n');
    crate::settings::atomic_write(path, &text).map_err(McpError::internal)
}

/// Grok 用户级：`[mcp_servers.<name>] enabled` + `disabled_mcp_servers` 列表
/// （两者都是 CLI 自己写入的形态，缺一不可 —— 只改其一会留下假状态）。
fn set_grok_user_enabled(
    path: &Path,
    name: &str,
    enabled: bool,
    expected_version: &str,
) -> Result<(), McpError> {
    let raw = read_text(path)?;
    verify_version(&raw, expected_version)?;
    let mut document = raw
        .parse::<DocumentMut>()
        .map_err(|error| McpError::format(format!("{}: invalid TOML: {error}", path.display())))?;
    {
        let servers = document
            .get_mut("mcp_servers")
            .and_then(|item| item.as_table_like_mut())
            .ok_or_else(|| McpError::not_found("配置文件中没有 mcp_servers 表"))?;
        let server = servers
            .get_mut(name)
            .and_then(|item| item.as_table_like_mut())
            .ok_or_else(|| McpError::not_found(format!("配置文件中不存在 MCP 服务「{name}」")))?;
        server.insert("enabled", toml_value(enabled));
    }
    let mut disabled = string_array(&document, "disabled_mcp_servers")?;
    disabled.retain(|item| item != name);
    if !enabled {
        disabled.push(name.to_string());
    }
    if disabled.is_empty() {
        document.remove("disabled_mcp_servers");
    } else {
        let mut array = Array::new();
        for item in disabled {
            array.push(item);
        }
        document.insert("disabled_mcp_servers", toml_value(array));
    }
    crate::settings::atomic_write(path, &document.to_string()).map_err(McpError::internal)
}
