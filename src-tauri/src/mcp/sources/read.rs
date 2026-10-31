//! 服务器表读取：JSON / JSONC / TOML 与 dsh 的 profile YAML。
//!
//! 解析一律只读文件；条目字段按 `Source.fields` 映射，启停按 `Source.toggle`
//! 解读（字符串 "false"/"0" 也按停用处理）。

use crate::mcp::probe::ProbeTarget;
use super::{
    candidate_paths, first_existing, grok_home, source_spec, Fields, Source, Toggle,
    DSH_MCP_PLUGIN, REASON_JSONC_READONLY,
};
use crate::mcp::config::{file_hash, object_keys, read_text, redact_url};
use crate::mcp::{parse_json, McpConfigEntry, McpError};
use serde_json::{Map, Value};
use std::path::Path;
use toml_edit::DocumentMut;

/// JSONC（opencode 的 `opencode.jsonc`）允许注释与尾逗号；写入会丢注释，
/// 所以这类文件只读。解析先做字符串感知的注释/尾逗号清理，再走 serde_json。
pub(super) fn parse_jsonc(text: &str, path: &str) -> Result<Value, McpError> {
    let stripped = strip_jsonc(text)
        .ok_or_else(|| McpError::format(format!("{path}: unterminated string in JSONC")))?;
    serde_json::from_str::<Value>(&stripped)
        .map_err(|error| McpError::format(format!("{path}: invalid JSON: {error}")))
}

pub(super) fn strip_jsonc(text: &str) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if ch == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
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
                for next in chars.by_ref() {
                    if next == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = ' ';
                for next in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
            }
            _ => out.push(ch),
        }
    }
    if in_string {
        return None;
    }
    // 尾逗号：在对象/数组闭合前删掉逗号（字符串外已经安全）。
    let mut trimmed = String::with_capacity(out.len());
    let mut pending_comma: Option<usize> = None;
    for ch in out.chars() {
        match ch {
            ',' => {
                pending_comma = Some(trimmed.len());
                trimmed.push(ch);
            }
            ']' | '}' => {
                if let Some(index) = pending_comma.take() {
                    trimmed.remove(index);
                }
                trimmed.push(ch);
            }
            ch if ch.is_whitespace() => trimmed.push(ch),
            ch => {
                pending_comma = None;
                trimmed.push(ch);
            }
        }
    }
    Some(trimmed)
}

pub(super) fn read_json_source(source: &Source, path: &Path) -> Result<Vec<McpConfigEntry>, McpError> {
    let raw = read_text(path)?;
    let version = file_hash(raw.as_bytes());
    let is_jsonc = is_jsonc(path);
    let root = if is_jsonc {
        parse_jsonc(&raw, &path.to_string_lossy())?
    } else {
        parse_json(&raw, &path.to_string_lossy())?
    };
    let mut entries = Vec::new();
    let Some(servers) = root.get(source.servers_key).and_then(Value::as_object) else {
        return Ok(entries);
    };
    for (name, raw_spec) in servers {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let Some(spec_object) = raw_spec.as_object() else {
            continue;
        };
        entries.push(build_entry(source, name, path, &version, spec_object, is_jsonc));
    }
    Ok(entries)
}

pub(super) fn is_jsonc(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.to_string_lossy().eq_ignore_ascii_case("jsonc"))
        .unwrap_or(false)
}

pub(super) fn build_entry(
    source: &Source,
    name: &str,
    path: &Path,
    version: &str,
    spec_object: &Map<String, Value>,
    is_jsonc: bool,
) -> McpConfigEntry {
    let spec = source_spec(source.id).expect("registered source");
    // JSONC 写入会丢注释：按文件降级为只读，不按来源降级。
    let writable = spec.writable && !is_jsonc;
    let readonly_reason_code = if is_jsonc {
        Some(REASON_JSONC_READONLY.to_string())
    } else {
        spec.readonly_reason_code.map(str::to_string)
    };
    let (command, args_count) = command_and_args(source, spec_object);
    let url = string_field(spec_object, source.fields.url)
        .or_else(|| string_field(spec_object, source.fields.url_alt))
        .map(|url| redact_url(&url));
    let transport = string_field(spec_object, source.fields.transport)
        .or_else(|| string_field(spec_object, source.fields.transport_alt));
    let env_keys = object_keys(spec_object.get(source.fields.env));
    let header_keys = object_keys(spec_object.get(source.fields.headers));
    McpConfigEntry {
        id: format!("{}:{name}", source.id),
        engine: source.engine.to_string(),
        name: name.to_string(),
        source: source.id.to_string(),
        scope: source.scope.to_string(),
        path: path.to_string_lossy().into_owned(),
        format: source.format.to_string(),
        enabled: entry_enabled(source, spec_object),
        transport,
        command,
        args_count,
        url,
        env_keys,
        header_keys,
        writable,
        readonly_reason: spec.readonly_reason.map(str::to_string),
        readonly_reason_code,
        version: version.to_string(),
        launch_mode: crate::mcp::launch::EAGER.to_string(),
        launch_mode_unsupported: None,
    }
}

/// 取一个非空字符串字段（空字符串视为未声明）。
pub(super) fn string_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    if key.is_empty() {
        return None;
    }
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn command_and_args(source: &Source, spec_object: &Map<String, Value>) -> (Option<String>, usize) {
    let args_field = spec_object
        .get(source.fields.args)
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    match spec_object.get(source.fields.command) {
        // opencode 的 local server：`command: ["npx","-y","pkg"]`。
        Some(Value::Array(items)) if source.command_is_array => {
            let command = items
                .first()
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            (command, items.len().saturating_sub(1) + args_field)
        }
        Some(Value::String(text)) => {
            let command = text.trim();
            let command = (!command.is_empty()).then(|| command.to_string());
            (command, args_field)
        }
        _ => (None, args_field),
    }
}

/// 启停字段：`enabled`（缺省 true）/ `disabled`（缺省 false）；字符串
/// `"false"` / `"0"` 也按停用处理（OMP 的宽容解析）。
fn bool_field(object: &Map<String, Value>, key: &str) -> Option<bool> {
    match object.get(key) {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::String(text)) => match text.trim().to_ascii_lowercase().as_str() {
            "false" | "0" => Some(false),
            "true" | "1" => Some(true),
            _ => None,
        },
        _ => None,
    }
}

fn entry_enabled(source: &Source, spec_object: &Map<String, Value>) -> bool {
    match source.toggle {
        Some(Toggle::Enabled) => bool_field(spec_object, "enabled").unwrap_or(true),
        Some(Toggle::Disabled) => !bool_field(spec_object, "disabled").unwrap_or(false),
        None => true,
    }
}

/// Grok：`[mcp_servers.<name>]`；用户级的 `disabled_mcp_servers` 列表按名称
/// 停用（对项目级条目同样生效，所以项目来源也要读用户列表）。
pub(super) fn read_toml_source(source: &Source, path: &Path) -> Result<Vec<McpConfigEntry>, McpError> {
    let raw = read_text(path)?;
    let version = file_hash(raw.as_bytes());
    let document = raw
        .parse::<DocumentMut>()
        .map_err(|error| McpError::format(format!("{}: invalid TOML: {error}", path.display())))?;
    let mut disabled = string_array(&document, "disabled_mcp_servers")?;
    if source.id == "grok_project" {
        let user_path = grok_home().join("config.toml");
        if user_path.is_file() {
            if let Ok(user_raw) = read_text(&user_path) {
                if let Ok(user_document) = user_raw.parse::<DocumentMut>() {
                    if let Ok(names) = string_array(&user_document, "disabled_mcp_servers") {
                        disabled.extend(names);
                    }
                }
            }
        }
    }
    let mut entries = Vec::new();
    let Some(servers) = document.get("mcp_servers").and_then(|item| item.as_table_like()) else {
        return Ok(entries);
    };
    for (name, item) in servers.iter() {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let Some(table) = item.as_table_like() else {
            continue;
        };
        let spec = source_spec(source.id).expect("registered source");
        let enabled = table
            .get("enabled")
            .and_then(|item| item.as_bool())
            .unwrap_or(true)
            && !disabled.iter().any(|item| item == name);
        let command = table
            .get("command")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let url = table
            .get("url")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(redact_url);
        let transport = table
            .get("type")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let args_count = table
            .get("args")
            .and_then(|item| item.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        let mut env_keys: Vec<String> = table
            .get("env")
            .and_then(|item| item.as_table_like())
            .map(|table| table.iter().map(|(key, _)| key.to_string()).collect())
            .unwrap_or_default();
        env_keys.sort();
        let mut header_keys: Vec<String> = table
            .get("headers")
            .and_then(|item| item.as_table_like())
            .map(|table| table.iter().map(|(key, _)| key.to_string()).collect())
            .unwrap_or_default();
        header_keys.sort();
        entries.push(McpConfigEntry {
            id: format!("{}:{name}", source.id),
            engine: source.engine.to_string(),
            name: name.to_string(),
            source: source.id.to_string(),
            scope: source.scope.to_string(),
            path: path.to_string_lossy().into_owned(),
            format: "toml".to_string(),
            enabled,
            transport,
            command,
            args_count,
            url,
            env_keys,
            header_keys,
            writable: spec.writable,
            readonly_reason: spec.readonly_reason.map(str::to_string),
            readonly_reason_code: spec.readonly_reason_code.map(str::to_string),
            version: version.clone(),
            launch_mode: crate::mcp::launch::EAGER.to_string(),
            launch_mode_unsupported: None,
        });
    }
    Ok(entries)
}

pub(super) fn string_array(document: &DocumentMut, key: &str) -> Result<Vec<String>, McpError> {
    match document.get(key) {
        None => Ok(Vec::new()),
        Some(item) => item
            .as_array()
            .map(|array| array.iter().filter_map(|item| item.as_str()).map(str::to_string).collect())
            .ok_or_else(|| McpError::format(format!("{key} 不是数组，未解析该字段"))),
    }
}

/// dsh：profile 的 cordis 配置里每个 `dsh-mcp-client` 插件实例就是一台 MCP
/// 服务；loader 条目的 `disabled` 就是启停开关。
/// 一个 dsh 的 MCP 插件实例（原始 config，未脱敏）。
pub(super) struct DshPluginEntry {
    pub name: String,
    pub disabled: bool,
    pub config: Option<serde_yaml::Value>,
}

/// 扫 profile 的 cordis 配置，收集 `dsh-mcp-client` 插件实例（含 `insert`
/// 这类嵌套插入列表）。
pub(super) fn dsh_plugin_entries(path: &Path) -> Result<Vec<DshPluginEntry>, McpError> {
    let raw = read_text(path)?;
    let root: serde_yaml::Value = serde_yaml::from_str(&raw)
        .map_err(|error| McpError::format(format!("{}: invalid YAML: {error}", path.display())))?;
    let mut entries: Vec<DshPluginEntry> = Vec::new();
    let mut stack: Vec<(&serde_yaml::Value, usize)> = vec![(&root, 0)];
    while let Some((node, depth)) = stack.pop() {
        if depth > 4 {
            continue;
        }
        match node {
            serde_yaml::Value::Sequence(items) => {
                stack.extend(items.iter().map(|item| (item, depth + 1)));
            }
            serde_yaml::Value::Mapping(map) => {
                for key in ["insert", "before", "after"] {
                    if let Some(nested) = map.get(serde_yaml::Value::String(key.to_string())) {
                        stack.push((nested, depth + 1));
                    }
                }
                if map
                    .get(serde_yaml::Value::String("name".to_string()))
                    .and_then(serde_yaml::Value::as_str)
                    != Some(DSH_MCP_PLUGIN)
                {
                    continue;
                }
                let config = map
                    .get(serde_yaml::Value::String("config".to_string()))
                    .cloned();
                let name = dsh_text(config.as_ref(), "serverName").or_else(|| {
                    map.get(serde_yaml::Value::String("id".to_string()))
                        .and_then(serde_yaml::Value::as_str)
                        .map(str::to_string)
                });
                let Some(name) = name else { continue };
                if entries.iter().any(|entry| entry.name == name) {
                    continue;
                }
                let disabled = map
                    .get(serde_yaml::Value::String("disabled".to_string()))
                    .and_then(serde_yaml::Value::as_bool)
                    .unwrap_or(false);
                entries.push(DshPluginEntry {
                    name,
                    disabled,
                    config,
                });
            }
            _ => {}
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn dsh_text(config: Option<&serde_yaml::Value>, key: &str) -> Option<String> {
    config
        .and_then(|config| config.get(serde_yaml::Value::String(key.to_string())))
        .and_then(serde_yaml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn dsh_string_map(config: Option<&serde_yaml::Value>, key: &str) -> Vec<(String, String)> {
    config
        .and_then(|config| config.get(serde_yaml::Value::String(key.to_string())))
        .and_then(serde_yaml::Value::as_mapping)
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| {
                    Some((key.as_str()?.to_string(), value.as_str()?.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn dsh_probe_target(entry: &DshPluginEntry) -> ProbeTarget {
    let config = entry.config.as_ref();
    ProbeTarget {
        command: dsh_text(config, "command"),
        args: config
            .and_then(|config| config.get(serde_yaml::Value::String("args".to_string())))
            .and_then(serde_yaml::Value::as_sequence)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        env: dsh_string_map(config, "env"),
        cwd: dsh_text(config, "cwd"),
        url: dsh_text(config, "url"),
        headers: dsh_string_map(config, "headers"),
        transport: dsh_text(config, "transport"),
    }
}

pub(super) fn read_dsh_profile(path: &Path) -> Result<Vec<McpConfigEntry>, McpError> {
    let raw = read_text(path)?;
    let version = file_hash(raw.as_bytes());
    let spec = source_spec("dsh_profile").expect("registered source");
    let mut entries = Vec::new();
    for plugin in dsh_plugin_entries(path)? {
        let config = plugin.config.as_ref();
        let args_count = config
            .and_then(|config| config.get(serde_yaml::Value::String("args".to_string())))
            .and_then(serde_yaml::Value::as_sequence)
            .map(Vec::len)
            .unwrap_or(0);
        entries.push(McpConfigEntry {
            id: format!("dsh_profile:{}", plugin.name),
            engine: "dsh".to_string(),
            name: plugin.name,
            source: "dsh_profile".to_string(),
            scope: "user".to_string(),
            path: path.to_string_lossy().into_owned(),
            format: "yaml".to_string(),
            enabled: !plugin.disabled,
            transport: dsh_text(config, "transport"),
            command: dsh_text(config, "command"),
            args_count,
            url: dsh_text(config, "url").map(|url| redact_url(&url)),
            env_keys: yaml_keys(config, "env"),
            header_keys: yaml_keys(config, "headers"),
            writable: spec.writable,
            readonly_reason: spec.readonly_reason.map(str::to_string),
            readonly_reason_code: spec.readonly_reason_code.map(str::to_string),
            version: version.clone(),
            launch_mode: crate::mcp::launch::EAGER.to_string(),
            launch_mode_unsupported: None,
        });
    }
    Ok(entries)
}

fn yaml_keys(config: Option<&serde_yaml::Value>, key: &str) -> Vec<String> {
    let mut keys: Vec<String> = config
        .and_then(|config| config.get(serde_yaml::Value::String(key.to_string())))
        .and_then(serde_yaml::Value::as_mapping)
        .map(|map| {
            map.iter()
                .filter_map(|(key, _)| key.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    keys.sort();
    keys
}

// ===== 连接检测的目标解析 =====

/// 从 JSON 服务器表条目构造探针目标（未脱敏，只在后端使用）。
pub(crate) fn probe_target_from_json(
    object: &Map<String, Value>,
    command_is_array: bool,
    fields: Fields,
) -> ProbeTarget {
    let (command, args) = command_and_args_raw(object, command_is_array, fields);
    ProbeTarget {
        command,
        args,
        env: string_map(object.get(fields.env)),
        cwd: string_field(object, fields.cwd),
        url: string_field(object, fields.url).or_else(|| string_field(object, fields.url_alt)),
        headers: string_map(object.get(fields.headers)),
        transport: string_field(object, fields.transport)
            .or_else(|| string_field(object, fields.transport_alt)),
    }
}

/// 从 TOML 服务器表构造探针目标（Codex / Grok）。
pub(crate) fn probe_target_from_toml(
    table: &dyn toml_edit::TableLike,
    fields: Fields,
) -> ProbeTarget {
    let toml_string = |key: &str| -> Option<String> {
        if key.is_empty() {
            return None;
        }
        table
            .get(key)
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let toml_map = |key: &str| -> Vec<(String, String)> {
        if key.is_empty() {
            return Vec::new();
        }
        table
            .get(key)
            .and_then(|item| item.as_table_like())
            .map(|table| {
                table
                    .iter()
                    .filter_map(|(key, item)| {
                        item.as_str().map(|value| (key.to_string(), value.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    ProbeTarget {
        command: toml_string(fields.command),
        args: table
            .get(fields.args)
            .and_then(|item| item.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        env: toml_map(fields.env),
        cwd: toml_string(fields.cwd),
        url: toml_string(fields.url).or_else(|| toml_string(fields.url_alt)),
        headers: toml_map(fields.headers),
        transport: toml_string(fields.transport).or_else(|| toml_string(fields.transport_alt)),
    }
}

fn string_map(value: Option<&Value>) -> Vec<(String, String)> {
    value
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 命令行与参数（opencode 的 `command` 是数组）。
fn command_and_args_raw(
    object: &Map<String, Value>,
    command_is_array: bool,
    fields: Fields,
) -> (Option<String>, Vec<String>) {
    let args: Vec<String> = object
        .get(fields.args)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    match object.get(fields.command) {
        Some(Value::Array(items)) if command_is_array => {
            let mut values: Vec<String> = items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect();
            if values.is_empty() {
                return (None, args);
            }
            let command = values.remove(0);
            values.extend(args);
            (Some(command), values)
        }
        Some(Value::String(text)) => {
            let command = text.trim();
            let command = (!command.is_empty()).then(|| command.to_string());
            (command, args)
        }
        _ => (None, args),
    }
}

/// 声明式来源的探针目标：重新读文件并取原始条目（不经过脱敏）。
pub(crate) fn probe_target_for_source(
    source: &Source,
    name: &str,
    workspace: Option<&str>,
) -> Result<ProbeTarget, McpError> {
    let path = first_existing(candidate_paths(source.id, workspace))
        .ok_or_else(|| McpError::not_found("配置文件不存在，无法连接"))?;
    let missing = || McpError::not_found(format!("配置文件中不存在 MCP 服务「{name}」"));
    match source.format {
        "toml" => {
            let raw = read_text(&path)?;
            let document = raw.parse::<DocumentMut>().map_err(|error| {
                McpError::format(format!("{}: invalid TOML: {error}", path.display()))
            })?;
            let table = document
                .get(source.servers_key)
                .and_then(|item| item.as_table_like())
                .and_then(|servers| servers.get(name))
                .and_then(|item| item.as_table_like())
                .ok_or_else(missing)?;
            Ok(probe_target_from_toml(table, source.fields))
        }
        "yaml" => {
            let entry = dsh_plugin_entries(&path)?
                .into_iter()
                .find(|entry| entry.name == name)
                .ok_or_else(missing)?;
            Ok(dsh_probe_target(&entry))
        }
        _ => {
            let raw = read_text(&path)?;
            let root = if is_jsonc(&path) {
                parse_jsonc(&raw, &path.to_string_lossy())?
            } else {
                parse_json(&raw, &path.to_string_lossy())?
            };
            let object = root
                .get(source.servers_key)
                .and_then(Value::as_object)
                .and_then(|servers| servers.get(name))
                .and_then(Value::as_object)
                .ok_or_else(missing)?;
            Ok(probe_target_from_json(
                object,
                source.command_is_array,
                source.fields,
            ))
        }
    }
}

