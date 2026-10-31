//! 启动方式：每个 MCP 条目可选「随会话启动」（默认）或「按需启动」。
//!
//! 设置存在 ccgui 自己的 `AppSettings.mcp_launch_modes`，不写进 CLI 的配置；
//! 只影响本应用拉起的那次引擎进程。发送时 [`on_demand_servers`] 按引擎自己
//! 的作用域优先级找出每个名字真正生效的条目，筛出启用中、stdio、标了按需
//! 的那些，交给各引擎适配器用逐次覆盖通道改成经 `--mcp-lazy` 代理启动。

use super::probe::ProbeTarget;
use super::{McpConfigEntry, McpConfigSection, McpError};

pub(crate) const ON_DEMAND: &str = "onDemand";
pub(crate) const EAGER: &str = "eager";

/// 有逐次覆盖通道的引擎（claude/codebuddy `--mcp-config`、codex `-c`、
/// omp 工作区 `.omp/mcp.json`）。
pub(crate) fn engine_supports(engine: &str) -> bool {
    matches!(engine, "claude" | "codebuddy" | "codex" | "omp")
}

/// 不能按需启动的原因码（UI 按 `mcp.launch.unsupported.<code>` 本地化）。
pub(crate) fn unsupported_reason(entry: &McpConfigEntry) -> Option<&'static str> {
    if !engine_supports(&entry.engine) {
        return Some("engine");
    }
    if !is_stdio(entry.transport.as_deref(), entry.command.is_some()) {
        return Some("transport");
    }
    // omp 的覆盖写在工作区 `.omp/mcp.json`；条目本身就在那份文件里时没法
    // 「同名覆盖 + 回合结束原样恢复」。
    if entry.source == "omp_project" {
        return Some("workspace_file");
    }
    None
}

fn is_stdio(transport: Option<&str>, has_command: bool) -> bool {
    match transport {
        Some(kind) => matches!(kind, "stdio" | "local"),
        None => has_command,
    }
}

/// 设置键：用户作用域 = 条目 id；项目作用域另加规范化后的工作区前缀，
/// 同名项目条目在不同工作区互不影响。
pub(crate) fn mode_key(entry_id: &str, scope: &str, workspace: Option<&str>) -> Option<String> {
    if scope != "project" {
        return Some(entry_id.to_string());
    }
    let workspace = workspace?;
    let canonical = dunce::canonicalize(workspace)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| workspace.to_string());
    Some(format!("{canonical}|{entry_id}"))
}

/// 清单回填：每个条目带上当前启动方式与不可用原因。
pub(crate) fn annotate(section: &mut McpConfigSection, workspace: Option<&str>) {
    let modes = crate::settings::read_settings()
        .map(|settings| settings.mcp_launch_modes)
        .unwrap_or_default();
    for entry in &mut section.entries {
        entry.launch_mode_unsupported = unsupported_reason(entry).map(str::to_string);
        let on_demand = mode_key(&entry.id, &entry.scope, workspace)
            .and_then(|key| modes.get(&key))
            .is_some_and(|mode| mode == ON_DEMAND);
        entry.launch_mode = if on_demand { ON_DEMAND } else { EAGER }.to_string();
    }
}

/// 写一条启动方式。`eager` 删除键（缺省即随会话启动）。
pub(crate) fn write_mode(
    entry: &McpConfigEntry,
    mode: &str,
    workspace: Option<&str>,
) -> Result<(), McpError> {
    if mode != ON_DEMAND && mode != EAGER {
        return Err(McpError::invalid(format!("unknown launch mode: {mode}")));
    }
    if mode == ON_DEMAND {
        if let Some(code) = unsupported_reason(entry) {
            return Err(McpError::new("unsupported", format!("launch mode unsupported: {code}")));
        }
    }
    let key = mode_key(&entry.id, &entry.scope, workspace)
        .ok_or_else(|| McpError::invalid("project MCP entries need a workspace"))?;
    let _guard = crate::settings::settings_write_lock();
    let mut settings = crate::settings::read_settings().map_err(McpError::internal)?;
    if mode == ON_DEMAND {
        settings.mcp_launch_modes.insert(key, ON_DEMAND.to_string());
    } else {
        settings.mcp_launch_modes.remove(&key);
    }
    crate::settings::persist_settings_committed(&mut settings)
        .map(|_| ())
        .map_err(McpError::internal)
}

/// 作用域优先级（数字小的赢）。同名条目只有生效的那条会被引擎拉起。
fn rank(engine: &str, source: &str) -> u8 {
    let scope = source.rsplit('_').next().unwrap_or_default();
    match (engine, scope) {
        // Claude Code：local > project > user（code.claude.com/docs/en/mcp
        // 「Scope hierarchy and precedence」）；CodeBuddy 沿用同一套文件布局。
        ("claude" | "codebuddy", "local") => 0,
        ("claude" | "codebuddy", "project") => 1,
        (_, "project") => 1,
        _ => 2,
    }
}

/// 一个要改成经代理启动的服务：名字 + 原始（未展开）定义。和 `BuiltCommand`
/// 一样出现在公开的 `Engine` trait 签名里，所以类型是 `pub`、字段只在 crate 内可见。
#[derive(Debug, Clone)]
pub struct OnDemandServer {
    pub(crate) name: String,
    pub(crate) target: ProbeTarget,
}

/// 发送时调用：本引擎在该工作区里标了按需、启用中、stdio 的生效条目。
/// 没有任何按需设置时直接返回空，不读 CLI 配置。
pub(crate) fn on_demand_servers(engine: &str, workspace: &std::path::Path) -> Vec<OnDemandServer> {
    if !engine_supports(engine) {
        return Vec::new();
    }
    let modes = match crate::settings::read_settings() {
        Ok(settings) if !settings.mcp_launch_modes.is_empty() => settings.mcp_launch_modes,
        _ => return Vec::new(),
    };
    let workspace = workspace.to_string_lossy().into_owned();
    let mut section = super::config::read_config_entries(Some(&workspace));
    super::sources::append_entries(&mut section, Some(&workspace));
    let mut winners: std::collections::BTreeMap<String, &McpConfigEntry> = Default::default();
    for entry in section.entries.iter().filter(|entry| entry.engine == engine) {
        let slot = winners.entry(entry.name.clone()).or_insert(entry);
        if rank(engine, &entry.source) < rank(engine, &slot.source) {
            *slot = entry;
        }
    }
    winners
        .into_values()
        .filter(|entry| entry.enabled && unsupported_reason(entry).is_none())
        .filter(|entry| {
            mode_key(&entry.id, &entry.scope, Some(&workspace))
                .and_then(|key| modes.get(&key))
                .is_some_and(|mode| mode == ON_DEMAND)
        })
        .filter_map(|entry| {
            let target = super::probe_target(&entry.id, Some(&workspace)).ok()?;
            target.command.is_some().then(|| OnDemandServer {
                name: entry.name.clone(),
                target,
            })
        })
        .collect()
}

impl OnDemandServer {
    fn wrapped(&self) -> Result<(String, Vec<String>), String> {
        let command = self.target.command.as_deref().ok_or("stdio entry without command")?;
        super::lazy::wrap(command, &self.target.args)
    }

    /// claude / codebuddy `--mcp-config` 条目：同名覆盖整条，env/cwd 原样带上
    /// （值不展开，交给 CLI 自己按原规则展开）。
    pub(crate) fn claude_json(&self) -> Result<serde_json::Value, String> {
        let (command, args) = self.wrapped()?;
        let mut server = serde_json::json!({ "type": "stdio", "command": command, "args": args });
        if !self.target.env.is_empty() {
            let env: serde_json::Map<String, serde_json::Value> = self
                .target
                .env
                .iter()
                .map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone())))
                .collect();
            server["env"] = serde_json::Value::Object(env);
        }
        if let Some(cwd) = &self.target.cwd {
            server["cwd"] = serde_json::Value::String(cwd.clone());
        }
        Ok(server)
    }

    /// codex `-c` 覆盖：按键合并，只改 command/args，其余字段继续继承。
    /// 名字里带 `.`、引号等会破坏点路径的条目跳过（保持随会话启动）。
    pub(crate) fn codex_overrides(&self, quote: impl Fn(&str) -> String) -> Option<Vec<String>> {
        let plain = self
            .name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-');
        if !plain {
            return None;
        }
        let (command, args) = self.wrapped().ok()?;
        let args = args.iter().map(|arg| quote(arg)).collect::<Vec<_>>().join(",");
        Some(vec![
            format!("mcp_servers.{}.command={}", self.name, quote(&command)),
            format!("mcp_servers.{}.args=[{args}]", self.name),
        ])
    }

    /// omp 工作区 `.omp/mcp.json` 注入用：工作区条目优先于用户条目。
    pub(crate) fn omp_spec(&self) -> Result<crate::computer_use::McpServerSpec, String> {
        let (command, args) = self.wrapped()?;
        Ok(crate::computer_use::McpServerSpec {
            name: self.name.clone(),
            command,
            args,
            env: self.target.env.clone(),
        })
    }
}

/// claude / codebuddy：把按需条目写进私有 0600 文件交给 `--mcp-config`。
/// 条目带着用户的 env（可能含密钥），不能放进 argv。目录在启动清扫名单里
/// （engine/reader.rs `sweep_staging_dirs`），崩溃残留下次启动会删。
pub(crate) fn stage_claude_config(
    servers: &[OnDemandServer],
    staging_dir: &str,
) -> Result<std::path::PathBuf, String> {
    let mut map = serde_json::Map::new();
    for server in servers {
        map.insert(server.name.clone(), server.claude_json()?);
    }
    let content = serde_json::to_vec(&serde_json::json!({ "mcpServers": map }))
        .map_err(|e| format!("serialize on-demand MCP config: {e}"))?;
    let directory = crate::paths::app_home().join(staging_dir);
    std::fs::create_dir_all(&directory).map_err(|e| format!("create {staging_dir}: {e}"))?;
    let path = directory.join(format!("mcp-on-demand-{}.json", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|e| format!("create {}: {e}", path.display()))?;
    if let Err(error) = std::io::Write::write_all(&mut file, &content) {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(format!("write on-demand MCP config: {error}"));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_keys_are_workspace_scoped_and_user_keys_are_not() {
        assert_eq!(mode_key("claude_user:a", "user", Some("/ws")).unwrap(), "claude_user:a");
        let key = mode_key("claude_project:a", "project", Some("/no/such/ws")).unwrap();
        assert_eq!(key, "/no/such/ws|claude_project:a");
        assert!(mode_key("claude_project:a", "project", None).is_none());
    }

    #[test]
    fn claude_local_beats_project_beats_user() {
        assert!(rank("claude", "claude_local") < rank("claude", "claude_project"));
        assert!(rank("claude", "claude_project") < rank("claude", "claude_user"));
        assert!(rank("codex", "codex_project") < rank("codex", "codex_user"));
    }
}
