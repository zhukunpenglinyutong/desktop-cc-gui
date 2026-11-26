//! MCP 配置的增删改（create / update / delete）。
//!
//! 与 `write_enabled`（启停）同一套不变量：全局 `WRITE_LOCK` 串行化、写前
//! 内容哈希比对、只动目标节点、原子替换后回读。启停是每个 CLI 一种语义
//! （disabled 名单、双写、审批列表），已经逐来源验证过；增删改只是在服务
//! 器表里插 / 改 / 删节点，形状与 CLI 自己 `mcp add` 写出来的一致，因此按
//! 格式族（JSON / TOML）一条路径覆盖全部来源，不需要逐 CLI 排期。
//!
//! 风险档：
//! - 第一批（放行）：普通 JSON 与 TOML 来源的 create / update / delete；
//!   Claude / Codex 在 `config.rs`，声明表来源在 `sources/`。
//! - 第二批（拒绝）：JSONC（写回丢注释）、Grok user（启停双写联动）、dsh
//!   （一个 MCP = 一个插件实例，文件里不该手写）。
//! - 条目级只读规则仍然生效：`writable == false`（JSONC 按文件降级、OMP
//!   名单命中、Claude 无工作区）时 update / delete 一律拒绝。

use super::probe::ProbeTarget;
use super::sources;
use super::{
    McpConfigEntry, McpError, McpServerInput, McpServerKeyValue, WRITE_LOCK,
};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use toml_edit::{value as toml_value, Array, DocumentMut};

// ===== 能力位 =====

/// 条目级能力位：能否编辑 / 删除。所有读取点共用这一份，保证清单、详情与
/// 表单看到的可写性一致。
pub(crate) fn entry_crud(source_id: &str, is_jsonc: bool) -> McpConfigEntry {
    let (updatable, deletable, reason) = crud_caps(source_id, is_jsonc);
    McpConfigEntry {
        id: String::new(),
        engine: String::new(),
        name: String::new(),
        source: String::new(),
        scope: String::new(),
        workspace_file: false,
        path: String::new(),
        format: String::new(),
        enabled: false,
        transport: None,
        command: None,
        args_count: 0,
        url: None,
        env_keys: Vec::new(),
        header_keys: Vec::new(),
        writable: false,
        readonly_reason: None,
        readonly_reason_code: None,
        version: String::new(),
        launch_mode: super::launch::EAGER.to_string(),
        launch_mode_unsupported: None,
        updatable,
        deletable,
        crud_reason_code: reason.map(str::to_string),
    }
}

/// 来源级能力位：能否新增。`McpSourceInfo` 用它标注「本页看的哪些文件支持
/// 通过本应用加服务」。
pub(crate) fn source_creatable(source_id: &str) -> (bool, Option<&'static str>) {
    match source_id {
        // 一个 MCP = 一个 dsh-mcp-client 插件实例，文件里不该手写。
        "dsh_profile" => (false, Some("dsh_plugin")),
        // 其余来源都能新建；文件还不存在时 create 会自己建（create_dir_all）。
        _ => (true, None),
    }
}

/// update / delete 的能力判定。`is_jsonc` 只在声明表来源里有意义（文件级
/// 降级）；Claude / Codex 来源按来源 id 判。
fn crud_caps(source_id: &str, is_jsonc: bool) -> (bool, bool, Option<&'static str>) {
    if is_jsonc {
        return (false, false, Some("jsonc_readonly"));
    }
    match source_id {
        "dsh_profile" => (false, false, Some("dsh_plugin")),
        // Grok user 的启停是 `enabled` 字段 + `disabled_mcp_servers` 名单双写；
        // update 若只改 command/env 没问题，但任何会动到启停联动的编辑都要
        // 同时维护双名单——首版拒绝 update，create / delete 放行（新建默认
        // 启用、删除连带清名单，无双写问题）。
        "grok_user" => (false, true, Some("grok_user_update")),
        _ => (true, true, None),
    }
}

// ===== 路径与形态判定 =====

/// 一个来源的「生效文件」。Claude / Codex 按作用域规则算；声明表来源用
/// `path_for`（第一个已存在的候选，否则第一个预期位置）。
fn path_for_source(source_id: &str, workspace: Option<&str>) -> Result<PathBuf, McpError> {
    match source_id {
        "claude_user" | "claude_local" => Ok(super::config::claude_user_config_path()),
        "claude_project" => {
            let workspace = require_workspace(workspace)?;
            Ok(super::config::claude_project_config_path(Path::new(workspace)))
        }
        "codex_user" => Ok(super::config::codex_user_config_path()),
        "codex_project" => {
            let workspace = require_workspace(workspace)?;
            Ok(super::config::codex_project_config_path(Path::new(workspace)))
        }
        _ => {
            let spec = sources::source_spec(source_id)
                .ok_or_else(|| McpError::invalid("unknown MCP source"))?;
            if spec.scope == "project" {
                require_workspace(workspace)?;
            }
            sources::path_for(source_id, workspace)
                .ok_or_else(|| McpError::invalid("unknown MCP source"))
        }
    }
}

fn require_workspace(workspace: Option<&str>) -> Result<&str, McpError> {
    workspace
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| McpError::invalid("a workspace is required for project-scoped MCP config"))
}

/// 该来源在磁盘上的格式族。声明表来源按文件扩展名；Claude / Codex 固定。
fn format_of(source_id: &str, path: &Path) -> &'static str {
    if path
        .extension()
        .map(|ext| ext.eq_ignore_ascii_case("toml"))
        .unwrap_or(false)
    {
        "toml"
    } else if sources::read::is_jsonc(path) {
        "jsonc"
    } else {
        match source_id {
            "claude_user" | "claude_local" | "claude_project" => "json",
            "codex_user" | "codex_project" => "toml",
            _ => "json",
        }
    }
}

/// 声明表来源的服务器表键名 / 字段名映射 / command 是否数组。Claude /
/// Codex 用它们的常量；声明表来源查 `SOURCES`。
struct DeclSpec {
    servers_key: &'static str,
    fields: sources::Fields,
    command_is_array: bool,
    /// 新建时写入的默认服务器表（缺失时 create 会补）。
    default_doc: &'static str,
}

fn decl_spec(source_id: &str) -> Result<DeclSpec, McpError> {
    match source_id {
        "claude_user" | "claude_local" | "claude_project" => Ok(DeclSpec {
            servers_key: "mcpServers",
            fields: sources::CLAUDE_FIELDS,
            command_is_array: false,
            default_doc: "{}",
        }),
        "codex_user" | "codex_project" => Ok(DeclSpec {
            servers_key: "mcp_servers",
            fields: sources::CODEX_FIELDS,
            command_is_array: false,
            default_doc: "",
        }),
        _ => {
            let source = sources::SOURCES
                .iter()
                .find(|source| source.id == source_id)
                .ok_or_else(|| McpError::invalid("unknown MCP source"))?;
            Ok(DeclSpec {
                servers_key: source.servers_key,
                fields: source.fields,
                command_is_array: source.command_is_array,
                default_doc: "{}",
            })
        }
    }
}

// ===== 输入校验 =====

/// 编辑表单原始值的校验。名称不允许为空、不允许含 `:`（条目标识的分隔符）
/// 或 `.` / `"`（TOML 表名与命令行覆盖无法表示的字符，与 launch 的
/// `plain_name` 同一收紧口径）。
fn validate_input(input: &McpServerInput, is_create: bool) -> Result<(), McpError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(McpError::invalid("MCP 服务名不能为空"));
    }
    if is_create && (name.contains(':') || name.contains('.') || name.contains('"')) {
        return Err(McpError::invalid(
            "MCP 服务名不能包含 : . \" 字符（会与条目标识或 TOML 表名冲突）",
        ));
    }
    if input.command.trim().is_empty() && input.url.trim().is_empty() {
        return Err(McpError::invalid(
            "命令（stdio）或地址（http/sse）至少填一项",
        ));
    }
    if !input.command.trim().is_empty() && !input.url.trim().is_empty() {
        return Err(McpError::invalid("命令与地址只能填一种：stdio 用命令，远程用地址"));
    }
    Ok(())
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// 键值对数组 → 去重后保留最后一次出现的顺序。前端表单允许同名键（覆盖），
/// 与 `claude mcp add` 的语义一致。
fn dedup_kvs(kvs: &[McpServerKeyValue]) -> Vec<(String, String)> {
    let mut seen = Vec::new();
    for item in kvs {
        let key = item.key.trim();
        if key.is_empty() {
            continue;
        }
        if let Some((_, value)) = seen.iter_mut().find(|(k, _)| *k == key) {
            *value = item.value.clone();
        } else {
            seen.push((key.to_string(), item.value.clone()));
        }
    }
    seen
}

// ===== 原始值读取（编辑表单回显） =====

/// 从 `ProbeTarget` 还原成编辑表单的输入。两者都是「未脱敏的真实定义」，
/// 差一个 shape：ProbeTarget 是探针视角（kind 归一化），表单要的是用户
/// 当初填的 transport / command / url 字段。
fn input_from_target(name: &str, target: ProbeTarget) -> McpServerInput {
    McpServerInput {
        name: name.to_string(),
        transport: target
            .transport
            .clone()
            .filter(|value| !value.trim().is_empty())
            // 没写 `type` 的来源（Codex 等）按命令/地址推断，表单据此判断远程还是本地。
            .unwrap_or_else(|| match target.kind() {
                "unknown" => String::new(),
                kind => kind.to_string(),
            }),
        command: target.command.unwrap_or_default(),
        args: target.args,
        cwd: target.cwd.unwrap_or_default(),
        env: target
            .env
            .into_iter()
            .map(|(key, value)| McpServerKeyValue { key, value })
            .collect(),
        url: target.url.unwrap_or_default(),
        headers: target
            .headers
            .into_iter()
            .map(|(key, value)| McpServerKeyValue { key, value })
            .collect(),
        enabled: true,
    }
}

pub(crate) fn read_raw(entry_id: &str, workspace: Option<&str>) -> Result<McpServerInput, McpError> {
    let (_, name) = entry_id
        .split_once(':')
        .ok_or_else(|| McpError::invalid("invalid MCP entry id"))?;
    let name = name.trim();
    if name.is_empty() {
        return Err(McpError::invalid("MCP server name must not be empty"));
    }
    let target = super::probe_target(entry_id, workspace)?;
    Ok(input_from_target(name, target))
}

// ===== 写原语：JSON 族 =====

fn read_json_doc(path: &Path) -> Result<(String, Value, String), McpError> {
    let raw = super::config::read_text(path)?;
    let version = super::config::file_hash(raw.as_bytes());
    let root = super::parse_json(&raw, &path.to_string_lossy())?;
    Ok((raw, root, version))
}

fn write_json_doc(path: &Path, root: &Value) -> Result<(), McpError> {
    let mut text = serde_json::to_string_pretty(root)
        .map_err(|error| McpError::internal(error.to_string()))?;
    text.push('\n');
    crate::settings::atomic_write(path, &text).map_err(McpError::internal)
}

/// JSON 来源的 create。文件不存在时从 `default_doc`（`{}`）起步；服务器表
/// 不存在时补。同名条目拒绝。
fn json_create(
    path: &Path,
    spec: &DeclSpec,
    input: &McpServerInput,
) -> Result<(), McpError> {
    let name = input.name.trim().to_string();
    let mut root = if path.is_file() {
        let (_, root, _) = read_json_doc(path)?;
        root
    } else {
        super::parse_json(spec.default_doc, "new")?
    };
    let servers = root
        .as_object_mut()
        .ok_or_else(|| McpError::format(format!("{}: root is not an object", path.display())))?
        .entry(spec.servers_key.to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| {
            McpError::format(format!(
                "{}: {} is not an object",
                path.display(),
                spec.servers_key
            ))
        })?;
    if servers.contains_key(&name) {
        return Err(McpError::new(
            "conflict",
            format!("MCP 服务「{name}」已存在，请换一个名字"),
        ));
    }
    servers.insert(name, json_server_value(spec, input));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| McpError::from_io(error, parent))?;
    }
    write_json_doc(path, &root)
}

/// 把表单输入转成要写进 JSON 服务器表的那个对象。只写有值的字段；
/// env / headers 用对象表示（键保序由 `preserve_order` 提供）。
fn json_server_value(spec: &DeclSpec, input: &McpServerInput) -> Value {
    let mut object = Map::new();
    let transport = input.transport.trim();
    if !transport.is_empty() && !spec.fields.transport.is_empty() {
        object.insert(
            spec.fields.transport.to_string(),
            Value::String(transport.to_string()),
        );
    }
    if let Some(command) = non_empty(&input.command) {
        if spec.command_is_array {
            let mut items = vec![Value::String(command)];
            items.extend(input.args.iter().map(|arg| Value::String(arg.clone())));
            object.insert(spec.fields.command.to_string(), Value::Array(items));
        } else {
            object.insert(spec.fields.command.to_string(), Value::String(command));
            if !input.args.is_empty() {
                object.insert(
                    spec.fields.args.to_string(),
                    Value::Array(input.args.iter().map(|arg| Value::String(arg.clone())).collect()),
                );
            }
        }
    }
    if let Some(cwd) = non_empty(&input.cwd) {
        object.insert(spec.fields.cwd.to_string(), Value::String(cwd));
    }
    let env = dedup_kvs(&input.env);
    if !env.is_empty() {
        let mut map = Map::new();
        for (key, value) in env {
            map.insert(key, Value::String(value));
        }
        object.insert(spec.fields.env.to_string(), Value::Object(map));
    }
    if let Some(url) = non_empty(&input.url) {
        object.insert(spec.fields.url.to_string(), Value::String(url));
    }
    let headers = dedup_kvs(&input.headers);
    if !headers.is_empty() {
        let mut map = Map::new();
        for (key, value) in headers {
            map.insert(key, Value::String(value));
        }
        object.insert(spec.fields.headers.to_string(), Value::Object(map));
    }
    // `enabled` 只在该来源用 `enabled` 字段做开关时写入；其他来源（Claude
    // 的 disabled 名单、Grok 的双写）不在 create 时碰，保持 CLI 默认启用。
    if !input.enabled {
        if let Some(source) = sources::SOURCES.iter().find(|s| {
            s.servers_key == spec.servers_key && matches!(s.toggle, Some(sources::Toggle::Enabled))
        }) {
            object.insert(
                source_toggle_key(source).to_string(),
                Value::Bool(input.enabled),
            );
        }
    }
    Value::Object(object)
}

fn source_toggle_key(source: &sources::Source) -> &'static str {
    match source.toggle {
        Some(sources::Toggle::Enabled) => "enabled",
        Some(sources::Toggle::Disabled) => "disabled",
        None => "enabled",
    }
}

/// JSON 来源的 update：只改服务器表里那一个节点，不动其他键与键序。
/// `enabled` 的写入只发生在该来源用 `enabled` 字段做开关时；否则忽略
/// （启停走 `mcp_set_enabled`，不在编辑里做）。
fn json_update(
    path: &Path,
    spec: &DeclSpec,
    name: &str,
    input: &McpServerInput,
    expected_version: &str,
) -> Result<(), McpError> {
    if !path.is_file() {
        return Err(McpError::not_found("配置文件不存在，未做修改"));
    }
    let (raw, mut root, _) = read_json_doc(path)?;
    sources::write::verify_version(&raw, expected_version)?;
    let servers = root
        .as_object_mut()
        .and_then(|root| root.get_mut(spec.servers_key))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            McpError::not_found(format!("配置文件中没有 {} 表", spec.servers_key))
        })?;
    if !servers.contains_key(name) {
        return Err(McpError::not_found(format!(
            "配置文件中不存在 MCP 服务「{name}」"
        )));
    }
    let mut fresh = json_server_value(spec, input);
    // 启停不回写：编辑表单不负责启停（那是 `mcp_set_enabled` 的职责），
    // 避免一次「改个参数」把停用状态重置。update 时 `input.enabled` 被忽略。
    if let Value::Object(map) = &mut fresh {
        map.remove("enabled");
        map.remove("disabled");
    }
    // 只替换表单管理的字段，其余（oauth、超时、工具白名单等）原样保留。
    let merged = match (servers.get(name), fresh) {
        (Some(Value::Object(existing)), Value::Object(fresh)) => {
            let mut merged = existing.clone();
            for key in managed_keys(spec) {
                merged.shift_remove(key);
            }
            for (key, value) in fresh {
                merged.insert(key, value);
            }
            Value::Object(merged)
        }
        (_, fresh) => fresh,
    };
    servers.insert(name.to_string(), merged);
    write_json_doc(path, &root)
}

/// 表单管理的字段名。update 只动这些键，其余字段（Codex 的超时、工具白名单、
/// `env_http_headers` / `bearer_token_env_var` 等）原样保留。
fn managed_keys(spec: &DeclSpec) -> Vec<&'static str> {
    let fields = &spec.fields;
    [
        fields.transport,
        fields.transport_alt,
        fields.command,
        fields.args,
        fields.env,
        fields.cwd,
        fields.url,
        fields.url_alt,
        fields.headers,
    ]
    .into_iter()
    .filter(|key| !key.is_empty())
    .collect()
}

/// JSON 来源的 delete：只删服务器表里那一个节点。
fn json_delete(path: &Path, spec: &DeclSpec, name: &str, expected_version: &str) -> Result<(), McpError> {
    if !path.is_file() {
        return Err(McpError::not_found("配置文件不存在，未做修改"));
    }
    let (raw, mut root, _) = read_json_doc(path)?;
    sources::write::verify_version(&raw, expected_version)?;
    let servers = root
        .as_object_mut()
        .and_then(|root| root.get_mut(spec.servers_key))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            McpError::not_found(format!("配置文件中没有 {} 表", spec.servers_key))
        })?;
    if servers.remove(name).is_none() {
        return Err(McpError::not_found(format!(
            "配置文件中不存在 MCP 服务「{name}」"
        )));
    }
    write_json_doc(path, &root)
}

// ===== 写原语：TOML 族 =====

fn read_toml_doc(path: &Path) -> Result<(String, DocumentMut, String), McpError> {
    let raw = super::config::read_text(path)?;
    let version = super::config::file_hash(raw.as_bytes());
    let document = raw
        .parse::<DocumentMut>()
        .map_err(|error| McpError::format(format!("{}: invalid TOML: {error}", path.display())))?;
    Ok((raw, document, version))
}

fn write_toml_doc(path: &Path, document: &DocumentMut) -> Result<(), McpError> {
    crate::settings::atomic_write(path, &document.to_string()).map_err(McpError::internal)
}

/// 把表单输入转成要写进 TOML 服务器表的那个表。只写有值的字段。
fn toml_server_table(spec: &DeclSpec, input: &McpServerInput) -> toml_edit::Item {
    let mut table = toml_edit::Table::new();
    let transport = input.transport.trim();
    if !transport.is_empty() && !spec.fields.transport.is_empty() {
        table[spec.fields.transport] = toml_value(transport);
    }
    if let Some(command) = non_empty(&input.command) {
        table[spec.fields.command] = toml_value(command);
        if !input.args.is_empty() {
            let mut array = Array::new();
            for arg in &input.args {
                array.push(arg);
            }
            table[spec.fields.args] = toml_value(array);
        }
    }
    if let Some(cwd) = non_empty(&input.cwd) {
        table[spec.fields.cwd] = toml_value(cwd);
    }
    let env = dedup_kvs(&input.env);
    if !env.is_empty() {
        let mut env_table = toml_edit::Table::new();
        for (key, value) in env {
            env_table[&key] = toml_value(value);
        }
        table[spec.fields.env] = toml_edit::Item::Table(env_table);
    }
    if let Some(url) = non_empty(&input.url) {
        table[spec.fields.url] = toml_value(url);
    }
    let headers = dedup_kvs(&input.headers);
    if !headers.is_empty() {
        let mut header_table = toml_edit::Table::new();
        for (key, value) in headers {
            header_table[&key] = toml_value(value);
        }
        table[spec.fields.headers] = toml_edit::Item::Table(header_table);
    }
    // Codex 的开关就是条目自身的 `enabled` 字段；create 时显式写入（与
    // `codex mcp add` 的形状一致）。其他 TOML 来源（Grok）不在 create 时碰
    // 启停（双写联动由 `mcp_set_enabled` 管）。
    if spec.servers_key == "mcp_servers" {
        table["enabled"] = toml_value(input.enabled);
    }
    toml_edit::Item::Table(table)
}

/// TOML 来源的 create。文件不存在时从空文档起步；服务器表不存在时补
/// （`[mcp_servers]` 顶层表）。
fn toml_create(path: &Path, spec: &DeclSpec, input: &McpServerInput) -> Result<(), McpError> {
    let name = input.name.trim().to_string();
    let mut document = if path.is_file() {
        let (_, document, _) = read_toml_doc(path)?;
        document
    } else {
        spec.default_doc
            .parse::<DocumentMut>()
            .map_err(|error| McpError::format(format!("new: invalid TOML: {error}")))?
    };
    let servers = document
        .as_table_mut()
        .entry(spec.servers_key)
        .or_insert_with(|| toml_edit::Item::Table(toml_edit::Table::new()))
        .as_table_like_mut()
        .ok_or_else(|| {
            McpError::format(format!(
                "{}: {} is not a table",
                path.display(),
                spec.servers_key
            ))
        })?;
    if servers.get(&name).is_some() {
        return Err(McpError::new(
            "conflict",
            format!("MCP 服务「{name}」已存在，请换一个名字"),
        ));
    }
    servers.insert(&name, toml_server_table(spec, input));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| McpError::from_io(error, parent))?;
    }
    write_toml_doc(path, &document)
}

/// TOML 来源的 update：只替换服务器表里那一个节点。`enabled` 不回写
/// （同 JSON：编辑不管启停）。
fn toml_update(
    path: &Path,
    spec: &DeclSpec,
    name: &str,
    input: &McpServerInput,
    expected_version: &str,
) -> Result<(), McpError> {
    if !path.is_file() {
        return Err(McpError::not_found("配置文件不存在，未做修改"));
    }
    let (raw, mut document, _) = read_toml_doc(path)?;
    sources::write::verify_version(&raw, expected_version)?;
    let servers = document
        .get_mut(spec.servers_key)
        .and_then(|item| item.as_table_like_mut())
        .ok_or_else(|| {
            McpError::not_found(format!("配置文件中没有 {} 表", spec.servers_key))
        })?;
    if servers.get(name).is_none() {
        return Err(McpError::not_found(format!(
            "配置文件中不存在 MCP 服务「{name}」"
        )));
    }
    let fresh = toml_server_table(spec, input);
    // 只替换表单管理的字段，其余（超时、工具白名单、env_http_headers 等）原样保留；
    // 编辑不管启停，`enabled` 沿用文件里原有的值。
    let merged_in_place = if let Some(existing) = servers
        .get_mut(name)
        .and_then(|item| item.as_table_like_mut())
    {
        for key in managed_keys(spec) {
            existing.remove(key);
        }
        if let Some(fresh) = fresh.as_table_like() {
            for (key, item) in fresh.iter() {
                if key != "enabled" {
                    existing.insert(key, item.clone());
                }
            }
        }
        true
    } else {
        false
    };
    if !merged_in_place {
        servers.insert(name, fresh);
    }
    write_toml_doc(path, &document)
}

/// TOML 来源的 delete：只删服务器表里那一个节点。
fn toml_delete(path: &Path, spec: &DeclSpec, name: &str, expected_version: &str) -> Result<(), McpError> {
    if !path.is_file() {
        return Err(McpError::not_found("配置文件不存在，未做修改"));
    }
    let (raw, mut document, _) = read_toml_doc(path)?;
    sources::write::verify_version(&raw, expected_version)?;
    let servers = document
        .get_mut(spec.servers_key)
        .and_then(|item| item.as_table_like_mut())
        .ok_or_else(|| {
            McpError::not_found(format!("配置文件中没有 {} 表", spec.servers_key))
        })?;
    if servers.remove(name).is_none() {
        return Err(McpError::not_found(format!(
            "配置文件中不存在 MCP 服务「{name}」"
        )));
    }
    write_toml_doc(path, &document)
}

// ===== 对外入口 =====

pub(crate) fn create(
    source_id: &str,
    input: &McpServerInput,
    workspace: Option<&str>,
) -> Result<McpConfigEntry, McpError> {
    let (creatable, reason) = source_creatable(source_id);
    if !creatable {
        return Err(McpError::new(
            "readonly",
            reason.unwrap_or("this MCP source does not support create"),
        ));
    }
    validate_input(input, true)?;
    let path = path_for_source(source_id, workspace)?;
    let format = format_of(source_id, &path);
    if format == "jsonc" {
        return Err(McpError::new(
            "readonly",
            "JSONC 文件带注释，写入会丢注释；请在编辑器里改，或改用同目录的纯 JSON 配置",
        ));
    }
    let spec = decl_spec(source_id)?;
    let _guard = WRITE_LOCK.lock();
    match format {
        "toml" => toml_create(&path, &spec, input)?,
        _ => json_create(&path, &spec, input)?,
    }
    reread(source_id, input.name.trim(), &path, workspace)
}

pub(crate) fn update(
    entry_id: &str,
    input: &McpServerInput,
    expected_version: &str,
    workspace: Option<&str>,
) -> Result<McpConfigEntry, McpError> {
    let (source, name) = entry_id
        .split_once(':')
        .ok_or_else(|| McpError::invalid("invalid MCP entry id"))?;
    let name = name.trim();
    if name.is_empty() {
        return Err(McpError::invalid("MCP server name must not be empty"));
    }
    let (updatable, _, reason) = crud_caps(source, false);
    if !updatable {
        return Err(McpError::new(
            "readonly",
            reason.unwrap_or("this MCP entry does not support update"),
        ));
    }
    // 条目级只读规则仍生效：JSONC 按文件降级、OMP 名单命中、Claude 无
    // 工作区时 `writable == false`，编辑同样拒绝。
    let current = current_entry(entry_id, workspace)?;
    if !current.writable {
        return Err(McpError::new(
            "readonly",
            current
                .readonly_reason
                .or(current.readonly_reason_code)
                .unwrap_or_else(|| "this MCP entry is read-only".to_string()),
        ));
    }
    validate_input(input, false)?;
    let path = path_for_source(source, workspace)?;
    let format = format_of(source, &path);
    if format == "jsonc" {
        return Err(McpError::new(
            "readonly",
            "JSONC 文件带注释，写入会丢注释，未做修改",
        ));
    }
    let spec = decl_spec(source)?;
    let _guard = WRITE_LOCK.lock();
    match format {
        "toml" => toml_update(&path, &spec, name, input, expected_version)?,
        _ => json_update(&path, &spec, name, input, expected_version)?,
    }
    reread(source, name, &path, workspace)
}

pub(crate) fn delete(
    entry_id: &str,
    expected_version: &str,
    workspace: Option<&str>,
) -> Result<(), McpError> {
    let (source, name) = entry_id
        .split_once(':')
        .ok_or_else(|| McpError::invalid("invalid MCP entry id"))?;
    let name = name.trim();
    if name.is_empty() {
        return Err(McpError::invalid("MCP server name must not be empty"));
    }
    let (_, deletable, reason) = crud_caps(source, false);
    if !deletable {
        return Err(McpError::new(
            "readonly",
            reason.unwrap_or("this MCP entry does not support delete"),
        ));
    }
    let current = current_entry(entry_id, workspace)?;
    if !current.writable {
        return Err(McpError::new(
            "readonly",
            current
                .readonly_reason
                .or(current.readonly_reason_code)
                .unwrap_or_else(|| "this MCP entry is read-only".to_string()),
        ));
    }
    let path = path_for_source(source, workspace)?;
    let format = format_of(source, &path);
    if format == "jsonc" {
        return Err(McpError::new(
            "readonly",
            "JSONC 文件带注释，写入会丢注释，未做修改",
        ));
    }
    let spec = decl_spec(source)?;
    let _guard = WRITE_LOCK.lock();
    match format {
        "toml" => toml_delete(&path, &spec, name, expected_version),
        _ => json_delete(&path, &spec, name, expected_version),
    }
}

/// 取当前清单里的一个条目（用于 update / delete 前的 `writable` 检查）。
fn current_entry(entry_id: &str, workspace: Option<&str>) -> Result<McpConfigEntry, McpError> {
    let mut section = super::config::read_config_entries(workspace);
    sources::append_entries(&mut section, workspace);
    section
        .entries
        .into_iter()
        .find(|entry| entry.id == entry_id)
        .ok_or_else(|| McpError::not_found("MCP entry not found"))
}

/// 写后回读：返回文件里的真实状态（脱敏后的 `McpConfigEntry`）。
fn reread(
    source_id: &str,
    name: &str,
    path: &Path,
    workspace: Option<&str>,
) -> Result<McpConfigEntry, McpError> {
    let format = format_of(source_id, path);
    let entries = match format {
        "toml" => {
            let source = sources::SOURCES
                .iter()
                .find(|source| source.id == source_id);
            match source {
                Some(source) => sources::read::read_toml_source(source, path)?,
                None => super::config::read_codex_toml(path, source_id)?,
            }
        }
        _ => {
            let source = sources::SOURCES
                .iter()
                .find(|source| source.id == source_id);
            match source {
                Some(source) => sources::read::read_json_source(source, path)?,
                None => {
                    // Claude / Codex 的 JSON 来源（claude_project）与 TOML
                    // 来源（codex_*）都走 config.rs 的专用读取，保证作用域
                    // 语义（审批列表、停用名单）正确。
                    reread_via_config(source_id, path, workspace)?
                }
            }
        }
    };
    let mut entry = entries
        .into_iter()
        .find(|entry| entry.name == name)
        .ok_or_else(|| McpError::not_found(format!("写入后未找到 MCP 服务「{name}」")))?;
    let mut section = super::McpConfigSection {
        entries: vec![entry.clone()],
        errors: vec![],
    };
    super::launch::annotate(&mut section, workspace);
    if let Some(annotated) = section.entries.pop() {
        entry = annotated;
    }
    Ok(entry)
}

/// Claude project / Codex 来源的回读：`config.rs` 的读取知道作用域规则
/// （Claude project 的审批列表、Codex 的 TOML 形状），不在这里重复。
fn reread_via_config(
    source_id: &str,
    path: &Path,
    workspace: Option<&str>,
) -> Result<Vec<McpConfigEntry>, McpError> {
    match source_id {
        "claude_user" | "claude_local" => {
            let workspace = require_workspace(workspace)?;
            super::config::read_claude_json(path, source_id, Some(workspace))
        }
        "claude_project" => {
            let workspace = require_workspace(workspace)?;
            super::config::read_claude_project(Path::new(workspace))
        }
        "codex_user" | "codex_project" => super::config::read_codex_toml(path, source_id),
        _ => Err(McpError::internal("unknown source for reread")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::HOME_ENV_LOCK;
    use std::sync::Mutex as StdMutex;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("ccgui-mcp-crud-{}-{tag}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn input(name: &str) -> McpServerInput {
        McpServerInput {
            name: name.to_string(),
            transport: "stdio".to_string(),
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "pkg".to_string()],
            cwd: String::new(),
            env: vec![McpServerKeyValue {
                key: "API_KEY".to_string(),
                value: "secret".to_string(),
            }],
            url: String::new(),
            headers: vec![],
            enabled: true,
        }
    }

    // ---- 能力位 ----

    #[test]
    fn source_creatable_marks_dsh_readonly_and_others_open() {
        assert_eq!(source_creatable("dsh_profile"), (false, Some("dsh_plugin")));
        assert_eq!(source_creatable("claude_user"), (true, None));
        assert_eq!(source_creatable("codex_project"), (true, None));
        assert_eq!(source_creatable("kimi_user"), (true, None));
    }

    #[test]
    fn entry_crud_blocks_jsonc_dsh_and_grok_user_update() {
        let entry = entry_crud("opencode_user", true);
        assert!(!entry.updatable && !entry.deletable);
        assert_eq!(entry.crud_reason_code.as_deref(), Some("jsonc_readonly"));

        let entry = entry_crud("dsh_profile", false);
        assert!(!entry.updatable && !entry.deletable);

        let entry = entry_crud("grok_user", false);
        assert!(!entry.updatable && entry.deletable);
        assert_eq!(entry.crud_reason_code.as_deref(), Some("grok_user_update"));

        let entry = entry_crud("claude_user", false);
        assert!(entry.updatable && entry.deletable);
    }

    // ---- JSON：Claude project ----

    #[test]
    fn claude_project_create_update_delete_roundtrip_preserves_siblings() {
        let dir = TempDir::new("claude-project-crud");
        let mcp = dir.path().join(".mcp.json");
        std::fs::write(
            &mcp,
            r#"{"mcpServers":{"alpha":{"command":"npx","args":["-y","a"]},"beta":{"url":"https://x/mcp"}},"otherKey":1}"#,
        )
        .unwrap();
        let workspace = dir.path().to_string_lossy().into_owned();

        // create：新增 gamma，alpha/beta/otherKey 不动。
        let created = create("claude_project", &input("gamma"), Some(&workspace)).unwrap();
        assert_eq!(created.name, "gamma");
        assert_eq!(created.command.as_deref(), Some("npx"));
        let raw = std::fs::read_to_string(&mcp).unwrap();
        let root: Value = serde_json::from_str(&raw).unwrap();
        assert!(root["mcpServers"].get("alpha").is_some());
        assert!(root["mcpServers"].get("beta").is_some());
        assert!(root["mcpServers"].get("gamma").is_some());
        assert_eq!(root["otherKey"], serde_json::json!(1));

        // create 同名：拒绝。
        let error = create("claude_project", &input("gamma"), Some(&workspace)).unwrap_err();
        assert_eq!(error.code, "conflict");

        // update：改 gamma 的 command，加 env；alpha/beta 不动。
        let mut edit = input("gamma");
        edit.command = "node".to_string();
        edit.env = vec![
            McpServerKeyValue { key: "A".to_string(), value: "1".to_string() },
            McpServerKeyValue { key: "B".to_string(), value: "2".to_string() },
        ];
        let version = file_hash_of(&mcp);
        let updated = update("claude_project:gamma", &edit, &version, Some(&workspace)).unwrap();
        assert_eq!(updated.command.as_deref(), Some("node"));
        let root: Value = serde_json::from_str(&std::fs::read_to_string(&mcp).unwrap()).unwrap();
        assert_eq!(root["mcpServers"]["gamma"]["command"], serde_json::json!("node"));
        assert_eq!(root["mcpServers"]["gamma"]["env"]["A"], serde_json::json!("1"));
        assert!(root["mcpServers"].get("alpha").is_some());

        // update 版本冲突：拒绝，文件不动。
        let before = std::fs::read_to_string(&mcp).unwrap();
        let error = update("claude_project:gamma", &edit, "stale", Some(&workspace)).unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(std::fs::read_to_string(&mcp).unwrap(), before);

        // delete：删 gamma，alpha/beta/otherKey 逐字节不动。
        let version = file_hash_of(&mcp);
        delete("claude_project:gamma", &version, Some(&workspace)).unwrap();
        let root: Value = serde_json::from_str(&std::fs::read_to_string(&mcp).unwrap()).unwrap();
        assert!(root["mcpServers"].get("gamma").is_none());
        assert!(root["mcpServers"].get("alpha").is_some());
        assert!(root["mcpServers"].get("beta").is_some());
        assert_eq!(root["otherKey"], serde_json::json!(1));

        // delete 不存在：拒绝。
        let version = file_hash_of(&mcp);
        let error = delete("claude_project:gamma", &version, Some(&workspace)).unwrap_err();
        assert_eq!(error.code, "not_found");
    }

    #[test]
    fn claude_project_create_builds_missing_file_and_parent() {
        let dir = TempDir::new("claude-project-new-file");
        let workspace = dir.path().join("new-ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let workspace_key = workspace.to_string_lossy().into_owned();
        // .mcp.json 不存在：create 自己建。
        let created = create("claude_project", &input("first"), Some(&workspace_key)).unwrap();
        assert_eq!(created.name, "first");
        let mcp = workspace.join(".mcp.json");
        assert!(mcp.is_file());
        let root: Value = serde_json::from_str(&std::fs::read_to_string(&mcp).unwrap()).unwrap();
        assert_eq!(
            root["mcpServers"]["first"]["command"],
            serde_json::json!("npx")
        );
    }

    // ---- TOML：Codex user ----

    #[test]
    fn codex_user_create_preserves_comments_and_unrelated_tables() {
        let _guard = HOME_ENV_LOCK.lock();
        let dir = TempDir::new("codex-crud");
        let codex_dir = dir.path().join(".codex");
        std::fs::create_dir_all(&codex_dir).unwrap();
        let config = codex_dir.join("config.toml");
        std::fs::write(
            &config,
            "# top comment\nmodel = \"gpt-5\"\n\n[mcp_servers.alpha]\ncommand = \"npx\"\n# server note\nargs = [\"-y\", \"a\"]\n\n[other]\nvalue = true\n",
        )
        .unwrap();
        std::env::set_var("CODEX_HOME", &codex_dir);

        let created = create("codex_user", &input("beta"), None).unwrap();
        assert_eq!(created.name, "beta");
        let raw = std::fs::read_to_string(&config).unwrap();
        assert!(raw.contains("# top comment"), "comment preserved: {raw}");
        assert!(raw.contains("# server note"));
        assert!(raw.contains("model = \"gpt-5\""));
        assert!(raw.contains("[other]"));
        assert!(raw.contains("[mcp_servers.beta]"));

        std::env::remove_var("CODEX_HOME");
    }

    #[test]
    fn codex_user_update_keeps_enabled_and_preserves_comments() {
        let _guard = HOME_ENV_LOCK.lock();
        let dir = TempDir::new("codex-update");
        let codex_dir = dir.path().join(".codex");
        std::fs::create_dir_all(&codex_dir).unwrap();
        let config = codex_dir.join("config.toml");
        std::fs::write(
            &config,
            "[mcp_servers.alpha]\ncommand = \"npx\"\nenabled = false\n\n[mcp_servers.beta]\ncommand = \"node\"\n",
        )
        .unwrap();
        std::env::set_var("CODEX_HOME", &codex_dir);

        // update alpha：改 command，不动 enabled（编辑不管启停）。
        let mut edit = input("alpha");
        edit.command = "uvx".to_string();
        let version = file_hash_of(&config);
        let updated = update("codex_user:alpha", &edit, &version, None).unwrap();
        assert_eq!(updated.command.as_deref(), Some("uvx"));
        assert!(!updated.enabled, "edit must not reset the disabled state");
        let raw = std::fs::read_to_string(&config).unwrap();
        assert!(raw.contains("enabled = false"), "enabled preserved: {raw}");
        assert!(raw.contains("[mcp_servers.beta]"));

        std::env::remove_var("CODEX_HOME");
    }

    #[test]
    fn codex_http_server_edit_keeps_codex_only_keys() {
        let _guard = HOME_ENV_LOCK.lock();
        let dir = TempDir::new("codex-http");
        let codex_dir = dir.path().join(".codex");
        std::fs::create_dir_all(&codex_dir).unwrap();
        let config = codex_dir.join("config.toml");
        std::fs::write(
            &config,
            "[mcp_servers.api]\nurl = \"https://example.test/mcp\"\nbearer_token_env_var = \"API_TOKEN\"\nstartup_timeout_sec = 30\nenabled_tools = [\"a\", \"b\"]\n\n[mcp_servers.api.http_headers]\nX-Team = \"core\"\n\n[mcp_servers.api.env_http_headers]\nX-Trace = \"TRACE_ID\"\n",
        )
        .unwrap();
        std::env::set_var("CODEX_HOME", &codex_dir);

        // 表单回显：没有 `type` 键也要识别成远程；只给可编辑的静态请求头。
        let raw = read_raw("codex_user:api", None).unwrap();
        assert_eq!(raw.transport, "http");
        assert_eq!(raw.url, "https://example.test/mcp");
        let keys: Vec<&str> = raw.headers.iter().map(|h| h.key.as_str()).collect();
        assert_eq!(keys, ["X-Team"]);

        let mut edit = raw;
        edit.url = "https://example.test/v2".to_string();
        edit.headers.push(McpServerKeyValue {
            key: "X-New".to_string(),
            value: "1".to_string(),
        });
        let version = file_hash_of(&config);
        update("codex_user:api", &edit, &version, None).unwrap();

        let text = std::fs::read_to_string(&config).unwrap();
        let doc: toml_edit::DocumentMut = text.parse().unwrap();
        let table = doc["mcp_servers"]["api"].as_table_like().unwrap();
        assert_eq!(table.get("url").and_then(|v| v.as_str()), Some("https://example.test/v2"));
        assert_eq!(
            table.get("bearer_token_env_var").and_then(|v| v.as_str()),
            Some("API_TOKEN")
        );
        assert_eq!(
            table.get("startup_timeout_sec").and_then(|v| v.as_integer()),
            Some(30)
        );
        assert!(table.get("enabled_tools").is_some(), "{text}");
        let env_headers = table
            .get("env_http_headers")
            .and_then(|v| v.as_table_like())
            .unwrap();
        assert_eq!(env_headers.get("X-Trace").and_then(|v| v.as_str()), Some("TRACE_ID"));
        let headers = table.get("http_headers").and_then(|v| v.as_table_like()).unwrap();
        assert_eq!(headers.get("X-Team").and_then(|v| v.as_str()), Some("core"));
        assert_eq!(headers.get("X-New").and_then(|v| v.as_str()), Some("1"));
        assert!(
            table.get("type").is_none() && table.get("headers").is_none(),
            "codex has no `type` / `headers` keys: {text}"
        );

        std::env::remove_var("CODEX_HOME");
    }

    #[test]
    fn codex_create_remote_uses_http_headers_and_no_type() {
        let _guard = HOME_ENV_LOCK.lock();
        let dir = TempDir::new("codex-create-remote");
        let codex_dir = dir.path().join(".codex");
        std::fs::create_dir_all(&codex_dir).unwrap();
        std::env::set_var("CODEX_HOME", &codex_dir);

        let mut remote = input("remote");
        remote.transport = "http".to_string();
        remote.command = String::new();
        remote.args = vec![];
        remote.env = vec![];
        remote.url = "https://example.test/mcp".to_string();
        remote.headers = vec![McpServerKeyValue {
            key: "Authorization".to_string(),
            value: "Bearer abc".to_string(),
        }];
        create("codex_user", &remote, None).unwrap();

        let text = std::fs::read_to_string(codex_dir.join("config.toml")).unwrap();
        let doc: toml_edit::DocumentMut = text.parse().unwrap();
        let table = doc["mcp_servers"]["remote"].as_table_like().unwrap();
        assert!(table.get("type").is_none() && table.get("headers").is_none(), "{text}");
        assert_eq!(
            table
                .get("http_headers")
                .and_then(|v| v.as_table_like())
                .and_then(|t| t.get("Authorization"))
                .and_then(|v| v.as_str()),
            Some("Bearer abc")
        );

        std::env::remove_var("CODEX_HOME");
    }

    #[test]
    fn codex_probe_headers_cover_static_env_and_bearer() {
        let doc: toml_edit::DocumentMut = "[s]\nbearer_token_env_var = \"TOK\"\n[s.http_headers]\nX-A = \"1\"\n[s.env_http_headers]\nX-B = \"VAR_B\"\n"
            .parse()
            .unwrap();
        let table = doc["s"].as_table_like().unwrap();
        assert_eq!(
            super::super::config::codex_http_headers(table),
            vec![
                ("Authorization".to_string(), "Bearer ${TOK}".to_string()),
                ("X-A".to_string(), "1".to_string()),
                ("X-B".to_string(), "${VAR_B}".to_string()),
            ]
        );
    }

    #[test]
    fn codex_user_delete_removes_only_target() {
        let _guard = HOME_ENV_LOCK.lock();
        let dir = TempDir::new("codex-delete");
        let codex_dir = dir.path().join(".codex");
        std::fs::create_dir_all(&codex_dir).unwrap();
        let config = codex_dir.join("config.toml");
        let original = "[mcp_servers.alpha]\ncommand = \"npx\"\n\n[mcp_servers.beta]\ncommand = \"node\"\n";
        std::fs::write(&config, original).unwrap();
        std::env::set_var("CODEX_HOME", &codex_dir);

        let version = file_hash_of(&config);
        delete("codex_user:alpha", &version, None).unwrap();
        let raw = std::fs::read_to_string(&config).unwrap();
        assert!(!raw.contains("mcp_servers.alpha"));
        assert!(raw.contains("mcp_servers.beta"));

        std::env::remove_var("CODEX_HOME");
    }

    // ---- JSON：OMP（声明表来源，Toggle::Enabled）----

    #[test]
    fn omp_user_create_writes_enabled_field() {
        let _guard = HOME_ENV_LOCK.lock();
        let dir = TempDir::new("omp-create");
        std::env::set_var("OMP_CODING_AGENT_DIR", dir.path());

        let mut disabled = input("off");
        disabled.enabled = false;
        let created = create("omp_user", &disabled, None).unwrap();
        assert!(!created.enabled);
        let mcp = dir.path().join("mcp.json");
        let root: Value = serde_json::from_str(&std::fs::read_to_string(&mcp).unwrap()).unwrap();
        assert_eq!(
            root["mcpServers"]["off"]["enabled"],
            serde_json::json!(false)
        );

        std::env::remove_var("OMP_CODING_AGENT_DIR");
    }

    // ---- read_raw ----

    #[test]
    fn read_raw_roundtrips_unmasked_env_and_headers() {
        let dir = TempDir::new("read-raw");
        let mcp = dir.path().join(".mcp.json");
        std::fs::write(
            &mcp,
            r#"{"mcpServers":{"alpha":{"command":"npx","args":["-y","pkg"],"env":{"API_KEY":"real-secret","PLAIN":"x"}}}}"#,
        )
        .unwrap();
        let workspace = dir.path().to_string_lossy().into_owned();
        let raw = read_raw("claude_project:alpha", Some(&workspace)).unwrap();
        assert_eq!(raw.name, "alpha");
        assert_eq!(raw.command, "npx");
        assert_eq!(raw.args, vec!["-y", "pkg"]);
        let api_key = raw.env.iter().find(|kv| kv.key == "API_KEY").unwrap();
        assert_eq!(api_key.value, "real-secret", "unmasked for edit form");
    }

    // ---- 输入校验 ----

    #[test]
    fn validate_rejects_empty_name_and_dual_transport() {
        let mut bad = input("x");
        bad.name = "  ".to_string();
        assert!(validate_input(&bad, true).is_err());

        let mut bad = input("x");
        bad.url = "https://x/mcp".to_string();
        assert!(validate_input(&bad, true).is_err(), "command + url together");

        let bad = input("bad:name");
        assert!(validate_input(&bad, true).is_err());
        let bad = input("bad.name");
        assert!(validate_input(&bad, true).is_err());
        // update（is_create=false）允许带点的存量名字。
        let ok = input("existing.name");
        assert!(validate_input(&ok, false).is_ok());
    }

    // ---- 风险档拒绝 ----

    #[test]
    fn jsonc_source_is_rejected_for_create_update_delete() {
        let dir = TempDir::new("jsonc-reject");
        let jsonc = dir.path().join("opencode.jsonc");
        std::fs::write(&jsonc, "{\n  // note\n  \"mcp\": {}\n}\n").unwrap();
        let workspace = dir.path().to_string_lossy().into_owned();

        let error = create("opencode_project", &input("x"), Some(&workspace)).unwrap_err();
        assert_eq!(error.code, "readonly");
    }

    #[test]
    fn dsh_create_is_rejected() {
        let error = create("dsh_profile", &input("x"), None).unwrap_err();
        assert_eq!(error.code, "readonly");
    }

    #[test]
    fn grok_user_update_is_rejected_but_delete_allowed() {
        let _guard = HOME_ENV_LOCK.lock();
        let dir = TempDir::new("grok-update");
        let grok_dir = dir.path().join(".grok");
        std::fs::create_dir_all(&grok_dir).unwrap();
        let config = grok_dir.join("config.toml");
        std::fs::write(&config, "[mcp_servers.alpha]\ncommand = \"npx\"\n").unwrap();
        std::env::set_var("GROK_HOME", &grok_dir);

        let version = file_hash_of(&config);
        let error = update("grok_user:alpha", &input("alpha"), &version, None).unwrap_err();
        assert_eq!(error.code, "readonly");

        let version = file_hash_of(&config);
        delete("grok_user:alpha", &version, None).unwrap();
        assert!(!std::fs::read_to_string(&config).unwrap().contains("alpha"));

        std::env::remove_var("GROK_HOME");
    }

    // ---- 辅助 ----

    fn file_hash_of(path: &Path) -> String {
        super::super::config::file_hash(&std::fs::read(path).unwrap())
    }

    // 串行化 HOME/USERPROFILE 相关 env 的测试（HOME_ENV_LOCK 在 paths.rs）。
    #[allow(dead_code)]
    static ENV_LOCK: StdMutex<()> = StdMutex::new(());
}
