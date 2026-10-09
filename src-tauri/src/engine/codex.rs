use super::{
    command_for_binary, images, push_session_id, BuiltCommand, Engine, EngineEvent, SendRequest,
    Transport,
};
use serde_json::Value;

/// Codex child transport: `codex exec --json` (verified against codex CLI
/// live). A local workspace sends through the app-server instead — only that
/// protocol carries the model's question tool (`item/tool/requestUserInput`);
/// `codex exec` answers every question itself.
pub struct CodexEngine;

/// TOML basic-string literal for a `-c key=<value>` override. codex parses
/// the value as TOML, so a Windows path's backslashes would otherwise read
/// as escape sequences.
fn toml_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Mount the app's computer-use driver on this one launch. codex discovers
/// MCP servers from `config.toml`, but `-c key=value` overrides (dotted path,
/// TOML-parsed value) apply to this process only: no file is written, so a
/// crash cannot strand our driver inside the user's config and there is
/// nothing to restore afterwards.
///
/// `-c` is a top-level option, so every caller has to add these BEFORE the
/// subcommand.
fn apply_computer_use(
    cmd: &mut tokio::process::Command,
    req: &SendRequest,
) -> Result<(), String> {
    if req.computer_use != Some(true) {
        return Ok(());
    }
    let exe = std::env::current_exe()
        .map_err(|e| format!("resolve own exe for computer use: {e}"))?;
    let name = crate::computer_use::MCP_SERVER_NAME;
    let mut overrides = vec![
        format!(
            "mcp_servers.{name}.command={}",
            toml_string(&exe.to_string_lossy())
        ),
        format!(
            "mcp_servers.{name}.args=[{}]",
            toml_string("--computer-use-mcp")
        ),
    ];
    // Overlay control channel: the child reports action targets so the main
    // app's virtual cursor can follow (absent in tests).
    if let (Some(base), Some(token)) = (
        crate::cu_overlay::control_base(),
        crate::cu_overlay::control_token(),
    ) {
        overrides.push(format!(
            "mcp_servers.{name}.env.CCGUI_CU_CONTROL={}",
            toml_string(&base)
        ));
        overrides.push(format!(
            "mcp_servers.{name}.env.CCGUI_CU_TOKEN={}",
            toml_string(&token)
        ));
    }
    for value in overrides {
        cmd.arg("-c").arg(value);
    }
    Ok(())
}

/// Mount the per-bot memory tool on this one launch. Same `-c` override
/// mechanism as the computer-use driver above: no file is written, and the
/// Bot id rides in argv so concurrent sessions cannot cross ledgers.
fn apply_memory(cmd: &mut tokio::process::Command, req: &SendRequest) -> Result<(), String> {
    let Some(bot_id) = req.memory_bot.as_deref() else {
        return Ok(());
    };
    let spec = crate::memory::mcp::bound_spec(bot_id)?;
    let name = spec.name;
    let args = spec
        .args
        .iter()
        .map(|arg| toml_string(arg))
        .collect::<Vec<_>>()
        .join(", ");
    let mut overrides = vec![
        format!("mcp_servers.{name}.command={}", toml_string(&spec.command)),
        format!("mcp_servers.{name}.args=[{args}]"),
    ];
    for (key, value) in &spec.env {
        overrides.push(format!(
            "mcp_servers.{name}.env.{key}={}",
            toml_string(value)
        ));
    }
    for value in overrides {
        cmd.arg("-c").arg(value);
    }
    Ok(())
}

/// Process-scoped equivalents of the provider keys formerly written into
/// config.toml/auth.json. Explicit model/effort picks still win.
pub(super) fn apply_channel(
    command: &mut tokio::process::Command,
    provider: &Value,
    env: &std::collections::HashMap<String, String>,
    req: &SendRequest,
) -> Result<(), String> {
    use toml::Value as Toml;
    let text = provider
        .pointer("/settingsConfig/config")
        .and_then(Value::as_str)
        .unwrap_or("");
    // Do not put parser diagnostics here: they can contain credentials from TOML.
    let mut config: toml::Table =
        toml::from_str(text).map_err(|_| "Invalid Codex channel config.toml".to_string())?;
    let api_key = env.get("OPENAI_API_KEY");
    let base_url = env.get("OPENAI_BASE_URL");
    if text.trim().is_empty() {
        if let Some(model) = provider
            .get("model")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            config.insert("model".into(), Toml::String(model.into()));
        }
    }
    // A flat channel must select its own provider, even when the native file
    // selects a different relay. Credentials travel in env, never in argv.
    if !config.contains_key("model_provider") && (base_url.is_some() || api_key.is_some()) {
        config.insert("model_provider".into(), Toml::String("ccgui".into()));
        let table = toml::Table::from_iter([
            ("name".into(), Toml::String("CC GUI".into())),
            (
                "base_url".into(),
                Toml::String(
                    base_url
                        .cloned()
                        .unwrap_or_else(|| "https://api.openai.com/v1".into()),
                ),
            ),
            ("wire_api".into(), Toml::String("responses".into())),
        ]);
        config.insert(
            "model_providers".into(),
            Toml::Table(toml::Table::from_iter([(
                "ccgui".into(),
                Toml::Table(table),
            )])),
        );
    }
    if let Some(key) = api_key {
        let selected = config
            .get("model_provider")
            .and_then(Toml::as_str)
            .unwrap_or("openai")
            .to_string();
        let providers = config
            .entry("model_providers")
            .or_insert_with(|| Toml::Table(Default::default()))
            .as_table_mut()
            .ok_or("Codex channel model_providers must be a table")?;
        let table = providers
            .entry(selected.clone())
            .or_insert_with(|| Toml::Table(Default::default()))
            .as_table_mut()
            .ok_or("Codex channel provider must be a table")?;
        table
            .entry("name")
            .or_insert_with(|| Toml::String(selected));
        table.insert("env_key".into(), Toml::String("CCGUI_CODEX_API_KEY".into()));
        table.insert("requires_openai_auth".into(), Toml::Boolean(false));
        table.remove("experimental_bearer_token");
        command.env("CCGUI_CODEX_API_KEY", key);
    }
    // Provider documents may authenticate via literal headers or a bearer
    // token. Move those to env too, so process listings do not reveal them.
    if let Some(providers) = config
        .get_mut("model_providers")
        .and_then(Toml::as_table_mut)
    {
        for (provider_index, (_, table)) in providers.iter_mut().enumerate() {
            let table = table
                .as_table_mut()
                .ok_or("Codex channel provider must be a table")?;
            if let Some(token) = table.remove("experimental_bearer_token") {
                let token = token
                    .as_str()
                    .ok_or("Codex channel bearer token must be a string")?;
                let key = format!("CCGUI_CODEX_BEARER_{provider_index}");
                command.env(&key, token);
                table.insert("env_key".into(), Toml::String(key));
                table.insert("requires_openai_auth".into(), Toml::Boolean(false));
            }
            if let Some(headers) = table.remove("http_headers") {
                let headers = headers
                    .as_table()
                    .ok_or("Codex channel headers must be a table")?;
                let env_headers = table
                    .entry("env_http_headers")
                    .or_insert_with(|| Toml::Table(Default::default()))
                    .as_table_mut()
                    .ok_or("Codex channel env headers must be a table")?;
                for (header_index, (header, value)) in headers.iter().enumerate() {
                    let value = value
                        .as_str()
                        .ok_or("Codex channel header must be a string")?;
                    let key = env_headers
                        .entry(header.clone())
                        .or_insert_with(|| {
                            Toml::String(format!(
                                "CCGUI_CODEX_HEADER_{provider_index}_{header_index}"
                            ))
                        })
                        .as_str()
                        .ok_or("Codex channel header env key must be a string")?;
                    // Preserve the CLI's env-header-over-literal-header precedence.
                    if !env.contains_key(key) && std::env::var_os(key).is_none() {
                        command.env(key, value);
                    }
                }
            }
        }
    }
    // Keep the existing provider contract: unrelated native hooks, trust and
    // MCP settings are inherited, not replaced by a channel's document.
    // `disable_response_storage` is retired by current Codex versions: they
    // log it as an ignored session flag, so saved legacy channels must not
    // keep injecting it as a process override.
    for key in [
        "model",
        "model_provider",
        "model_reasoning_effort",
        "model_context_window",
        "model_auto_compact_token_limit",
        "preferred_auth_method",
        "model_providers",
    ] {
        if (key == "model" && req.model.is_some())
            || (key == "model_reasoning_effort" && req.effort.is_some())
            || (key == "model_auto_compact_token_limit"
                && req.auto_compact_threshold_tokens.is_some())
        {
            continue;
        }
        if let Some(value) = config.get(key) {
            command.arg("-c").arg(format!("{key}={value}"));
        }
    }
    Ok(())
}

impl Engine for CodexEngine {
    fn id(&self) -> &'static str {
        "codex"
    }

    /// Codex's app-server is the only transport that can hand the user a
    /// question: `codex exec` declares `request_user_input is not supported in
    /// exec mode` and picks the answers itself.
    fn drives_own_transport(&self) -> bool {
        true
    }

    /// A remote workspace keeps the CLI child path: the app-server driver
    /// spawns the CLI locally and has no ssh path into the distro.
    fn transport_for(&self, wsl: bool) -> Transport {
        if wsl {
            Transport::Child
        } else {
            Transport::Own
        }
    }

    /// The command the driver spawns. Model/effort/provider flags land on it
    /// from [`apply_channel`] like any child; only the switch that enables the
    /// question tool has to be here.
    fn host_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        apply_computer_use(&mut cmd, req)?;
        apply_memory(&mut cmd, req)?;
        cmd.arg("app-server");
        // Without this the model never asks: it emits a plain agent message
        // (plus a sleep item) instead of a client request.
        cmd.arg("--enable");
        cmd.arg("default_mode_request_user_input");
        // Fast mode is Codex's service_tier=priority; the driver's thread/start
        // carries model and sandbox, but not the tier.
        if let Some(tier) = req.service_tier.as_deref() {
            if !matches!(tier, "default" | "priority") {
                return Err("Invalid Codex service tier".to_string());
            }
            cmd.arg("-c");
            cmd.arg(format!("service_tier=\"{tier}\""));
        }
        if let Some(effort) = req.effort.as_deref() {
            cmd.arg("-c");
            cmd.arg(format!("model_reasoning_effort=\"{effort}\""));
        }
        if let Some(tokens) = req.auto_compact_threshold_tokens {
            cmd.arg("-c");
            cmd.arg(format!("model_auto_compact_token_limit={tokens}"));
        }
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            // The driver answers parked questions on this pipe.
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            // The app-server assigns the thread id; a resume passes
            // thread/resume with the id the conversation already holds.
            preassigned_session_id: None,
        })
    }

    fn supports_images(&self) -> bool {
        true // -i/--image FILE
    }
    /// The driver mounts through `-c mcp_servers.…`, which both the
    /// app-server and the exec subcommand accept (see apply_computer_use).
    fn supports_computer_use(&self) -> bool {
        true
    }
    fn supports_memory(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "manual", "bypass", "plan"]
    }

    /// 人工计划审批走 next_turn 生命周期(turn/start collaborationMode.plan
    /// → 完整 plan item → 批准后原子创建一次 default 执行 turn),由本机
    /// app-server 传输兑现(见 codex_app.rs);exec/WSL fallback 没有这条
    /// 协议,在 build_command 里继续受控拒绝。
    fn plan_approval(&self) -> super::plan_review::PlanApproval {
        super::plan_review::PlanApproval::Typed {
            review_kind: super::plan_review::PlanReviewKind::NextTurn,
            evidence: "0.154.0 experimental schema TurnStartParams.collaborationMode + item/completed plan item",
            limitations: "全部相关字段 EXPERIMENTAL；审批点=客户端仲裁；跨重启恢复需重取 plan item 比对",
        }
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        if super::codex_read_only::requested(req) {
            return Err("Codex read-only planning requires the local app-server; exec/WSL fallback is forbidden".into());
        }
        // Human plan approval exists only on the app-server transport
        // (collaborationMode turns); the exec/WSL fallback has no such
        // protocol, so an explicit plan request fails closed here instead of
        // silently degrading to an auto run.
        if req.permission.as_deref() == Some("plan") {
            return Err("Codex plan approval runs on the local app-server transport; the exec/WSL fallback cannot honor it".into());
        }
        // This path only serves a remote (WSL) workspace, and the injected
        // driver is the local app's own binary: the distro cannot run it.
        // Refuse before spawning instead of mounting a server that dies.
        if req.computer_use == Some(true) {
            return Err("操作电脑不支持远程工作区(WSL):注入的是本机驱动".into());
        }
        // Same reason: the memory server is this app's own binary.
        if req.memory_bot.is_some() {
            return Err("记忆工具不支持远程工作区(WSL):注入的是本机程序".into());
        }
        let mut cmd = command_for_binary(bin);
        cmd.arg("exec");
        let mut preassigned = None;
        if let Some(session_id) = req.session_id.as_deref() {
            // `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`
            cmd.arg("resume");
            cmd.arg("--json");
            cmd.arg(session_id);
            preassigned = Some(session_id.to_string());
        } else {
            cmd.arg("--json");
        }
        cmd.arg("--skip-git-repo-check");
        // exec auto-declines approval prompts, so "manual" is enforced by the
        // sandbox instead: read-only means nothing can change without the
        // user re-sending in a writable mode. codex exec has no plan mode.
        // Sandbox goes through -c sandbox_mode (not --sandbox): `exec resume`
        // dropped the --sandbox flag, while -c works on both subcommands.
        match self.resolve_permission(req.permission.as_deref()) {
            "bypass" => {
                cmd.arg("--dangerously-bypass-approvals-and-sandbox");
            }
            "manual" => {
                cmd.arg("-c");
                cmd.arg("sandbox_mode=\"read-only\"");
            }
            _ => {
                cmd.arg("-c");
                cmd.arg("sandbox_mode=\"workspace-write\"");
            }
        }
        if let Some(model) = req.model.as_deref() {
            cmd.arg("-m");
            cmd.arg(model);
        }
        // Reasoning effort maps onto codex's config key (TOML value, so the
        // string needs quotes). Pass the level through as-is: current models
        // accept low…ultra (catalog-ordered), including max.
        if let Some(effort) = req.effort.as_deref() {
            cmd.arg("-c");
            cmd.arg(format!("model_reasoning_effort=\"{effort}\""));
        }
        // Each exec/resume is a fresh process, so the per-session threshold
        // applies on this send without rewriting the user's native config.
        if let Some(tokens) = req.auto_compact_threshold_tokens {
            cmd.arg("-c");
            cmd.arg(format!("model_auto_compact_token_limit={tokens}"));
        }
        // Fast mode is Codex's service_tier=priority (same id the desktop app
        // uses). Explicit default opts out; None leaves the CLI's config alone.
        if let Some(tier) = req.service_tier.as_deref() {
            if !matches!(tier, "default" | "priority") {
                return Err("Invalid Codex service tier".to_string());
            }
            cmd.arg("-c");
            cmd.arg(format!("service_tier=\"{tier}\""));
        }
        for raw in &req.images {
            if let Some(path) = images::absolutize_image_path(raw, &req.workspace) {
                cmd.arg("-i");
                cmd.arg(path);
            }
        }
        // Prompt travels through stdin (`-`), never argv: on Windows the codex
        // shim is a `.cmd` batch file and cmd.exe cuts a multiline argument at
        // the first newline — every line after the first was dropped (or worse,
        // executed as a command). stdin also dodges cmd's `%VAR%` expansion of
        // quoted args. `codex exec [resume] -` reads the prompt from stdin.
        cmd.arg("-");
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: Some(req.prompt.clone()),
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: preassigned,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        match event_type {
            "thread.started" => {
                push_session_id(&value, "thread_id", out);
            }
            "item.completed" => {
                let Some(item) = value.get("item") else {
                    return;
                };
                match item.get("type").and_then(Value::as_str) {
                    Some("agent_message") => {
                        if let Some(text) = item.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                out.push(super::assistant_message(text.to_string()));
                            }
                        }
                    }
                    Some("reasoning") => {
                        if let Some(text) = item.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                out.push(EngineEvent::Thinking(text.to_string()));
                            }
                        }
                    }
                    // codex exec has no delta events; tool calls surface as
                    // command_execution items.
                    Some("command_execution") => {
                        let name = item
                            .get("command")
                            .and_then(Value::as_str)
                            .unwrap_or("tool");
                        // The command string itself is the payload; wrap it so
                        // the timeline can expand a dedicated args panel.
                        let command = name.to_string();
                        out.push(super::tool_call_message(
                            name.chars().take(120).collect::<String>(),
                            Some(&Value::String(command)),
                        ));
                    }
                    _ => {}
                }
            }
            "turn.completed" => {
                let usage = value
                    .get("usage")
                    .cloned()
                    .map(|usage| attach_context_window(usage, &value));
                out.push(EngineEvent::Done {
                    session_id: None,
                    usage,
                });
            }
            "turn.failed" => {
                out.push(EngineEvent::Error(error_message(&value)));
            }
            // Non-terminal: codex emits `error` for every retry it is about
            // to make ("Reconnecting... 1/5 (...)") and once more with the
            // final message just before `turn.failed`. Verified against a
            // live run: both a retryable stream drop and a terminal 401
            // produce retries, one bare error line, then turn.failed. Only
            // turn.failed ends the turn — treating `error` as terminal
            // settled the UI and killed the CLI on the first reconnect, so
            // the turn died at 1/5 instead of continuing.
            "error" => {
                // codex announces every retry as `Reconnecting... N/M (...)`:
                // that line is live progress for the run status strip, not an
                // error. The bare error right before `turn.failed` (or any
                // other line) stays a non-terminal notice — only turn.failed
                // ends the turn.
                match parse_reconnect_notice(&value) {
                    Some((attempt, max, message)) => out.push(EngineEvent::Retry {
                        attempt,
                        max,
                        message,
                    }),
                    None => out.push(EngineEvent::Warn(error_message(&value))),
                }
            }
            _ => {}
        }
    }
}

fn attach_context_window(mut usage: Value, source: &Value) -> Value {
    if usage.get("model_context_window").is_none() {
        if let Some(window) = source.get("model_context_window").or_else(|| {
            source
                .get("info")
                .and_then(|i| i.get("model_context_window"))
        }) {
            if let Some(obj) = usage.as_object_mut() {
                obj.insert("model_context_window".to_string(), window.clone());
            }
        }
    }
    usage
}

/// codex's reconnect notice: `Reconnecting... 3/5 (stream disconnected …)`.
/// Returns `(attempt, max, reason)` so the run status line can show
/// "重试中 3/5"; `None` for every other error line.
fn parse_reconnect_notice(value: &Value) -> Option<(u64, u64, String)> {
    let text = error_message(value);
    let rest = text.strip_prefix("Reconnecting...")?.trim_start();
    let (counts, reason) = match rest.split_once('(') {
        Some((counts, reason)) => (counts.trim(), reason.trim_end_matches(')').trim()),
        None => (rest.trim(), ""),
    };
    let (attempt, max) = counts.split_once('/')?;
    Some((
        attempt.trim().parse().ok()?,
        max.trim().parse().ok()?,
        reason.to_string(),
    ))
}

/// Message text of a codex error payload: `error.message` when nested,
/// `error` or `message` when flat, with a generic fallback.
fn error_message(value: &Value) -> String {
    value
        .get("error")
        .and_then(|e| e.get("message").or(Some(e)).and_then(Value::as_str))
        .or_else(|| value.get("message").and_then(Value::as_str))
        .unwrap_or("codex turn failed")
        .to_string()
}

const UNSUPPORTED_EXEC_MESSAGE: &str = "当前 codex CLI 版本过旧，不支持 codex exec --json 调用方式（v1.0.0 起本应用改用此方式调用 codex）。请升级后重试：npm i -g @openai/codex@latest";

/// Probe outcomes cached per (bin, resuming) pair: re-probing every send
/// would add a full CLI startup (hundreds of ms through a Windows .cmd
/// shim) to each message. Only successes are cached — a cached failure
/// would keep blocking a user who already upgraded until an app restart.
static PREFLIGHT_CACHE: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, ()>>,
> = std::sync::LazyLock::new(Default::default);

/// Fail fast when the resolved codex binary predates the exec transport
/// (`codex exec --json`, plus `exec resume` for continuing sessions): such
/// CLIs exit 1 before emitting any event, which surfaced as a bare
/// "codex exited with status exit code: 1" banner. Probe flakes (spawn
/// failure, timeout, non-zero help exit) never block the send — the real
/// spawn surfaces its own error then.
pub(crate) async fn check_exec_support(bin: &str, resuming: bool) -> Result<(), String> {
    let key = format!("{bin}\u{0}{resuming}");
    if let Ok(cache) = PREFLIGHT_CACHE.lock() {
        if cache.contains_key(&key) {
            return Ok(());
        }
    }
    let result = match run_help_probe(bin).await {
        Some(help) if !exec_help_supported(&help, resuming) => {
            Err(UNSUPPORTED_EXEC_MESSAGE.to_string())
        }
        _ => Ok(()),
    };
    if result.is_ok() {
        if let Ok(mut cache) = PREFLIGHT_CACHE.lock() {
            cache.insert(key, ());
        }
    }
    result
}

/// `exec --help` output (stdout+stderr), or None on spawn failure/timeout/
/// non-zero exit. Verified live: current CLIs render `--json` under Options
/// and `resume` under Commands.
async fn run_help_probe(bin: &str) -> Option<String> {
    let mut cmd = command_for_binary(bin);
    cmd.args(["exec", "--help"]);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    super::hide_console(&mut cmd);
    let output = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Some(text)
}

/// `--json` is the hard requirement of the exec transport; continuing a
/// session additionally needs the `resume` subcommand.
fn exec_help_supported(help: &str, resuming: bool) -> bool {
    help.contains("--json") && (!resuming || help.contains("resume"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{Engine, EngineEvent};

    fn argv(req: &SendRequest) -> Vec<String> {
        CodexEngine
            .build_command(req, "fake-bin")
            .unwrap()
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect()
    }

    fn base_req() -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: std::path::PathBuf::from("/tmp"),
            prompt: "hi".into(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: Some("gpt-6-astra".into()),
            effort: None,
            service_tier: None,
            permission: Some("auto".into()),
            additional_dirs: Vec::new(),
            provider_id: None,
            computer_use: None,
            memory_bot: None,
            allowed_tools: None,
            auto_compact_threshold_tokens: None,
        }
    }

    fn channel_command(provider: &Value, req: &SendRequest) -> tokio::process::Command {
        let mut built = CodexEngine.build_command(req, "fake-bin").unwrap();
        let env = crate::provider_files::channel_env("codex", provider).unwrap();
        built.command.envs(&env);
        apply_channel(&mut built.command, provider, &env, req).unwrap();
        built.command
    }

    fn overrides(command: &tokio::process::Command) -> toml::Table {
        let args: Vec<_> = command
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy())
            .collect();
        let mut result = toml::Table::new();
        for pair in args.windows(2) {
            if pair[0] == "-c" {
                result.extend(toml::from_str::<toml::Table>(&pair[1]).unwrap());
            }
        }
        result
    }

    #[test]
    fn computer_use_mounts_the_local_driver_through_config_overrides() {
        let mut req = base_req();
        req.computer_use = Some(true);
        let built = CodexEngine.host_command(&req, "fake-bin").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        // Each `-c` value is parsed as TOML here, which is also the contract
        // codex itself enforces: an unparsable override is not a literal.
        // They are read one by one because every one of them roots at
        // `mcp_servers` — merging them into a single table would overwrite.
        let tables: Vec<toml::Table> = args
            .windows(2)
            .filter(|pair| pair[0] == "-c")
            .map(|pair| {
                toml::from_str::<toml::Table>(&pair[1])
                    .unwrap_or_else(|e| panic!("{}: {e}", pair[1]))
            })
            .collect();
        let mounted = |key: &str| -> Option<&toml::Value> {
            tables.iter().find_map(|table| {
                table
                    .get("mcp_servers")?
                    .get(crate::computer_use::MCP_SERVER_NAME)?
                    .get(key)
            })
        };
        let command = mounted("command")
            .and_then(toml::Value::as_str)
            .unwrap_or_else(|| panic!("driver not mounted: {args:?}"));
        assert!(!command.is_empty());
        assert_eq!(
            mounted("args").and_then(toml::Value::as_array),
            Some(&vec![toml::Value::from("--computer-use-mcp")])
        );
        // `-c` is a top-level option: the app-server subcommand has to come
        // after every override.
        let subcommand = args
            .iter()
            .position(|a| a == "app-server")
            .unwrap_or_else(|| panic!("{args:?}"));
        let last_override = args
            .iter()
            .rposition(|a| a.starts_with("mcp_servers."))
            .unwrap_or_else(|| panic!("{args:?}"));
        assert!(last_override < subcommand, "{args:?}");
        // Off by default: no driver on an ordinary turn.
        let off = CodexEngine.host_command(&base_req(), "fake-bin").unwrap();
        assert!(overrides(&off.command).get("mcp_servers").is_none());
    }

    /// Codex 的人工计划审批能力声明:类型化 next_turn,且 plan 重新出现在
    /// 支持列表里(resolve_permission 不再静默回退 auto)。
    #[test]
    fn plan_approval_is_typed_next_turn_and_advertised() {
        assert!(CodexEngine.supported_permissions().contains(&"plan"));
        match CodexEngine.plan_approval() {
            crate::engine::plan_review::PlanApproval::Typed {
                review_kind,
                evidence,
                limitations,
            } => {
                assert_eq!(
                    review_kind,
                    crate::engine::plan_review::PlanReviewKind::NextTurn
                );
                assert!(evidence.contains("collaborationMode"), "{evidence}");
                assert!(!limitations.is_empty());
            }
            other => panic!("codex must declare typed next_turn plan approval, got {other:?}"),
        }
    }

    /// exec/WSL fallback 没有 collaborationMode 协议:显式 plan 请求必须
    /// fail-closed,不能随 resolve_permission 静默降级为 workspace-write。
    #[test]
    fn exec_path_refuses_plan_permission() {
        let mut req = base_req();
        req.permission = Some("plan".into());
        let error = match CodexEngine.build_command(&req, "fake-bin") {
            Err(error) => error,
            Ok(_) => panic!("the exec/WSL path must refuse an explicit plan request"),
        };
        assert!(error.contains("app-server"), "{error}");
    }

    #[test]
    fn computer_use_is_refused_on_the_remote_exec_path() {
        // This path only serves a WSL workspace, and the injected driver is
        // the local app's own binary: the distro cannot run it. Refusing up
        // front beats mounting a server that dies on first use.
        let mut req = base_req();
        req.computer_use = Some(true);
        let error = match CodexEngine.build_command(&req, "fake-bin") {
            Err(error) => error,
            Ok(_) => panic!("a remote computer-use launch must be refused"),
        };
        assert!(error.contains("操作电脑"), "{error}");
    }

    #[test]
    fn toml_string_escapes_paths_that_would_read_as_escapes() {
        // codex parses the value as TOML: a bare quoted Windows path would
        // turn \t into a tab and \U into an escape.
        assert_eq!(toml_string(r"C:\tmp\x"), r#""C:\\tmp\\x""#);
        assert_eq!(toml_string("a\"b"), r#""a\"b""#);
    }

    #[test]
    fn channel_toml_is_applied_for_new_and_resumed_sessions_without_auth_in_argv() {
        let provider = serde_json::json!({"settingsConfig": {
            "auth": {"OPENAI_API_KEY":"test-channel-secret"},
            "config": "disable_response_storage = true\nmodel_provider = \"relay\"\nmodel = \"channel-model\"\nmodel_reasoning_effort = \"low\"\n[model_providers.relay]\nname = \"Relay\"\nbase_url = \"https://relay.example/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n[model_providers.relay.http_headers]\nX-Route = \"channel\"\n"
        }});
        for session_id in [None, Some("existing-session".into())] {
            let mut req = base_req();
            req.session_id = session_id;
            req.effort = Some("high".into());
            let command = channel_command(&provider, &req);
            let config = overrides(&command);
            assert_eq!(config["model_provider"].as_str(), Some("relay"));
            assert_eq!(config["model_reasoning_effort"].as_str(), Some("high"));
            assert!(!config.contains_key("model"), "explicit -m wins");
            assert!(!config.contains_key("disable_response_storage"));
            let relay = &config["model_providers"]["relay"];
            assert_eq!(relay["base_url"].as_str(), Some("https://relay.example/v1"));
            assert!(relay.get("http_headers").is_none());
            let header_key = relay["env_http_headers"]["X-Route"].as_str().unwrap();
            assert!(command
                .as_std()
                .get_envs()
                .any(|(key, value)| key == header_key
                    && value == Some(std::ffi::OsStr::new("channel"))));
            assert_eq!(relay["requires_openai_auth"].as_bool(), Some(false));
            assert_eq!(relay["env_key"].as_str(), Some("CCGUI_CODEX_API_KEY"));
            assert!(command
                .as_std()
                .get_envs()
                .any(|(k, v)| k == "CCGUI_CODEX_API_KEY"
                    && v == Some(std::ffi::OsStr::new("test-channel-secret"))));
            assert!(!command
                .as_std()
                .get_args()
                .any(|s| s.to_string_lossy().contains("test-channel-secret")));
        }
    }

    #[test]
    fn flat_channels_select_independent_providers_and_models() {
        let mut req = base_req();
        req.model = None;
        let a = channel_command(
            &serde_json::json!({"baseUrl":"https://a.example", "apiKey":"key-a", "model":"model-a"}),
            &req,
        );
        let b = channel_command(
            &serde_json::json!({"baseUrl":"https://b.example", "apiKey":"key-b", "model":"model-b"}),
            &req,
        );
        for (command, base, model) in [
            (&a, "https://a.example", "model-a"),
            (&b, "https://b.example", "model-b"),
        ] {
            let config = overrides(command);
            assert_eq!(config["model_provider"].as_str(), Some("ccgui"));
            assert_eq!(
                config["model_providers"]["ccgui"]["base_url"].as_str(),
                Some(base)
            );
            assert_eq!(config["model"].as_str(), Some(model));
        }
    }

    #[test]
    fn channel_context_limits_are_process_overrides() {
        let provider = serde_json::json!({"settingsConfig": {"config":
            "model_context_window = 1000000\nmodel_auto_compact_token_limit = 900000"}});
        let command = channel_command(&provider, &base_req());
        let config = overrides(&command);
        assert_eq!(config["model_context_window"].as_integer(), Some(1_000_000));
        assert_eq!(
            config["model_auto_compact_token_limit"].as_integer(),
            Some(900_000)
        );
    }

    #[test]
    fn session_compaction_threshold_overrides_channel_on_each_launch() {
        let provider = serde_json::json!({"settingsConfig": {"config":
            "model_context_window = 1000000\nmodel_auto_compact_token_limit = 900000"}});
        let mut req = base_req();
        for session_id in [None, Some("existing-session".to_string())] {
            req.session_id = session_id;
            for tokens in [Some(160_000), Some(320_000), None] {
                req.auto_compact_threshold_tokens = tokens;
                for host in [true, false] {
                    let mut built = if host {
                        CodexEngine.host_command(&req, "fake-bin")
                    } else {
                        CodexEngine.build_command(&req, "fake-bin")
                    }
                    .unwrap();
                    if tokens.is_none() {
                        assert!(!overrides(&built.command)
                            .contains_key("model_auto_compact_token_limit"));
                    }
                    // Channel overrides are appended after command creation.
                    // An explicit session choice must still win; Off must
                    // restore inheritance instead of retaining the last send.
                    apply_channel(&mut built.command, &provider, &Default::default(), &req)
                        .unwrap();
                    let config = overrides(&built.command);
                    assert_eq!(
                        config["model_auto_compact_token_limit"].as_integer(),
                        Some(tokens.unwrap_or(900_000) as i64)
                    );
                    assert_eq!(config["model_context_window"].as_integer(), Some(1_000_000));
                }
            }
        }
    }

    #[test]
    fn malformed_channel_toml_fails_without_exposing_source() {
        let mut command = tokio::process::Command::new("codex");
        let provider =
            serde_json::json!({"settingsConfig":{"config":"key = super-secret-invalid-toml"}});
        let error =
            apply_channel(&mut command, &provider, &Default::default(), &base_req()).unwrap_err();
        assert_eq!(error, "Invalid Codex channel config.toml");
    }

    #[test]
    fn effort_and_fast_tier_pass_through() {
        let mut req = base_req();
        req.effort = Some("ultra".into());
        req.service_tier = Some("priority".into());
        let args = argv(&req);
        assert!(args.iter().any(|a| a == "model_reasoning_effort=\"ultra\""));
        assert!(args.iter().any(|a| a == "service_tier=\"priority\""));
    }

    #[test]
    fn max_effort_is_not_clamped_to_xhigh() {
        let mut req = base_req();
        req.effort = Some("max".into());
        let args = argv(&req);
        assert!(args.iter().any(|a| a == "model_reasoning_effort=\"max\""));
        assert!(!args.iter().any(|a| a.contains("xhigh")));
    }

    #[test]
    fn host_command_carries_effort_override() {
        let mut req = base_req();
        req.effort = Some("high".into());
        let built = CodexEngine.host_command(&req, "fake-bin").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.iter().any(|a| a == "model_reasoning_effort=\"high\""));
    }

    fn parse(line: &str) -> Vec<EngineEvent> {
        let mut out = Vec::new();
        CodexEngine.parse_line(line, &mut out);
        out
    }

    /// Captured live from `codex exec --json` against a mock endpoint that
    /// drops the SSE stream: codex announces every retry as an `error` event
    /// and only `turn.failed` ends the turn. Handling these as terminal
    /// settled the UI — and killed the CLI — on the first reconnect, so the
    /// turn died at 1/5 instead of continuing to completion.
    #[test]
    fn reconnect_notice_is_live_retry_progress() {
        let line = r#"{"type":"error","message":"Reconnecting... 1/5 (stream disconnected before completion: stream closed before response.completed)"}"#;
        match &parse(line)[..] {
            [EngineEvent::Retry {
                attempt,
                max,
                message,
            }] => {
                assert_eq!((*attempt, *max), (1, 5));
                assert!(message.contains("stream disconnected"));
            }
            other => panic!("expected live retry progress, got {other:?}"),
        }
    }

    /// The bare error line codex emits right before `turn.failed` repeats the
    /// final message; the terminal signal is the `turn.failed` event itself.
    #[test]
    fn turn_failed_is_the_terminal_error() {
        // A non-reconnect error line is a notice, not retry progress.
        match &parse(
            r#"{"type":"error","message":"unexpected status 401 Unauthorized: Incorrect API key provided: x."}"#,
        )[..]
        {
            [EngineEvent::Warn(_)] => {}
            other => panic!("expected warn for the retry notice, got {other:?}"),
        }
        // turn.failed carries the terminal error text to the banner.
        match &parse(
            r#"{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Incorrect API key provided: x."}}"#,
        )[..]
        {
            [EngineEvent::Error(message)] => assert!(message.contains("401 Unauthorized")),
            other => panic!("expected terminal error, got {other:?}"),
        }
    }

    /// A successful turn after retries must still complete normally.
    #[test]
    fn turn_completed_after_retries_still_dones() {
        let mut out = Vec::new();
        CodexEngine.parse_line(
            r#"{"type":"error","message":"Reconnecting... 2/5 (stream disconnected before completion: x)"}"#,
            &mut out,
        );
        CodexEngine.parse_line(r#"{"type":"turn.completed","usage":null}"#, &mut out);
        assert!(matches!(out[0], EngineEvent::Retry { .. }));
        assert!(matches!(out[1], EngineEvent::Done { .. }));
    }

    /// Help shape verified live against codex-cli 0.153.0: `--json` under
    /// Options, `resume` under Commands.
    #[test]
    fn exec_help_gate_requires_json_flag_and_resume() {
        let current =
            "Usage: codex exec [OPTIONS] [PROMPT]\n\nCommands:\n  resume  Resume a previous session\n\nOptions:\n      --json";
        assert!(exec_help_supported(current, false));
        assert!(exec_help_supported(current, true));

        // Pre-exec-transport CLIs render no --json flag on exec.
        let legacy = "Usage: codex exec [OPTIONS] [PROMPT]\n\nOptions:\n  --full-auto";
        assert!(!exec_help_supported(legacy, false));

        // --json without the resume subcommand: new sessions fine,
        // continuing one must be refused with the upgrade message.
        let no_resume = "Usage: codex exec [OPTIONS] [PROMPT]\n\nOptions:\n      --json";
        assert!(exec_help_supported(no_resume, false));
        assert!(!exec_help_supported(no_resume, true));
    }

    /// A binary that cannot even be spawned must not be blocked by the
    /// preflight: the real spawn's own error is clearer than a probe flake.
    #[tokio::test]
    async fn preflight_never_blocks_on_probe_flake() {
        assert!(check_exec_support("/nonexistent/codex-bin-xyz", true)
            .await
            .is_ok());
    }
}
