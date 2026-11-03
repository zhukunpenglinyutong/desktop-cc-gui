//! MCP 连接检测：按配置真的连一次，做 `initialize` + `tools/list` 握手。
//! stdio 服务会被拉起来，`npx` 可能顺带下载包。结果只说明「本应用此刻能连上
//! 并握手成功」，与某个 CLI 会话里报告的连接状态分开表达。
//!
//! 何时执行（前端 `src/features/mcp/probe-store.ts`）：
//! - 用户级来源（`~/.claude.json`、`~/.codex/config.toml` 等用户自己的文件）：
//!   打开 MCP 页面 / `/mcp` 面板时会自动检测一次（结果缓存 3 分钟），也可手动检测；
//! - 工作区来源（`workspace_file`，配置文件在仓库目录里，可随仓库下载）：
//!   从不自动检测；手动检测前先用 `mcp_probe_plan` 把完整命令 / 地址给用户
//!   确认，检测时 URL 与请求头里的 `${ENV}` 也不展开。
//!
//! 安全边界：目标命令、参数、环境变量与请求头一律从配置文件重新解析
//! （`probe_target`），不接受前端传入的命令；返回值只带工具名与错误摘要，
//! 不带任何凭据。

use super::McpError;
use serde::Serialize;
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, BufReader};

/// stdio 冷启动（npx 首次下载）比 HTTP 慢得多。
const STDIO_TIMEOUT: Duration = Duration::from_secs(25);
const HTTP_TIMEOUT: Duration = Duration::from_secs(12);
/// 单行协议消息上限：服务把日志或大对象写到 stdout 时不至于撑爆内存。
/// 与引擎读 CLI stdout 用同一个上限（`engine::MAX_LINE_BYTES`）——合法的
/// `tools/list` 也可能很大（rea 的 139 个工具实测 ≈1.9 MB），旧值 1 MiB
/// 会把整条响应丢掉，界面上看起来像「连不上」。
const MAX_LINE: usize = crate::engine::MAX_LINE_BYTES;
/// tools/list 详情里最多列出的工具名数量（`tool_count` 计数不受它影响）。
const MAX_TOOLS: usize = 40;
const CLIENT_NAME: &str = "ccgui";
const PROTOCOL_VERSION: &str = "2025-06-18";

/// 从配置解析出的连接目标（未脱敏，只在后端使用）。
#[derive(Debug, Clone, Default)]
pub(crate) struct ProbeTarget {
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    pub headers: Vec<(String, String)>,
    /// 配置里的传输类型原样（stdio / http / sse / local / remote / …）。
    pub transport: Option<String>,
    /// 来自工作区里的配置文件（`super::source_in_workspace`）：URL 与请求头里的
    /// `${ENV}` 原样发送，不用本进程的环境变量展开。
    pub from_workspace: bool,
}

impl ProbeTarget {
    /// 归一化成探测方式：stdio / http / unknown。
    pub(crate) fn kind(&self) -> &'static str {
        match self.transport.as_deref().map(str::trim) {
            Some("stdio") | Some("local") => "stdio",
            Some("http") | Some("streamable-http") | Some("sse") | Some("remote") => "http",
            _ if self.command.is_some() => "stdio",
            _ if self.url.is_some() => "http",
            _ => "unknown",
        }
    }

    /// URL / 请求头里的值：用户自己的配置照 CLI 的规则展开 `${VAR}`；仓库带来
    /// 的配置不展开，否则一个 `"url": "https://x/?k=${OPENAI_API_KEY}"` 就能借
    /// 检测把密钥发出去。
    fn outbound_value(&self, value: &str) -> String {
        if self.from_workspace {
            value.to_string()
        } else {
            expand_env(value)
        }
    }
}

/// 手动检测工作区来源前给用户确认的内容：完整命令与地址，环境变量与请求头
/// 只给键名（值可能是密钥）。URL 已脱敏，且不展开 `${ENV}`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpProbePlan {
    /// stdio | http | unknown
    pub kind: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env_keys: Vec<String>,
    pub url: Option<String>,
    pub header_keys: Vec<String>,
    /// Hash of the full target (values included): `mcp_probe` runs a
    /// workspace target only when handed this exact fingerprint, so what
    /// executes is what the user confirmed — not whatever the file says by
    /// the time the click lands (a `git pull` or an agent may rewrite it).
    pub fingerprint: String,
}

fn plan_for(target: &ProbeTarget) -> McpProbePlan {
    McpProbePlan {
        kind: target.kind().to_string(),
        command: target.command.clone(),
        args: target.args.clone(),
        cwd: target.cwd.clone(),
        env_keys: target.env.iter().map(|(key, _)| key.clone()).collect(),
        url: target.url.as_deref().map(super::redact_url),
        header_keys: target.headers.iter().map(|(key, _)| key.clone()).collect(),
        fingerprint: fingerprint(target),
    }
}

fn fingerprint(target: &ProbeTarget) -> String {
    use sha2::{Digest, Sha256};
    let canonical = json!([
        target.kind(),
        target.transport,
        target.command,
        target.args,
        target.cwd,
        target.env,
        target.url,
        target.headers,
    ]);
    let digest = Sha256::digest(canonical.to_string().as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Workspace targets need the fingerprint of the plan the user confirmed;
/// the user's own servers never asked for confirmation.
fn require_confirmed(target: &ProbeTarget, confirmed: Option<&str>) -> Result<(), McpError> {
    if !target.from_workspace || confirmed == Some(fingerprint(target).as_str()) {
        return Ok(());
    }
    Err(McpError::conflict(
        "workspace MCP config changed since it was confirmed; confirm it again",
    ))
}

/// 检测前的确认信息（不执行任何东西）。
#[tauri::command]
pub(crate) async fn mcp_probe_plan(
    db: tauri::State<'_, std::sync::Arc<crate::db::Db>>,
    request: McpProbeRequest,
) -> Result<McpProbePlan, McpError> {
    let workspace = super::validate_workspace(request.workspace.as_deref(), &db)?;
    let target = super::probe_target(&request.entry_id, workspace.as_deref())?;
    Ok(plan_for(&target))
}

/// 前端提交的检测请求；条目标识由后端解析成配置里的真实命令。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpProbeRequest {
    pub entry_id: String,
    #[serde(default)]
    pub workspace: Option<String>,
    /// `McpProbePlan.fingerprint` of the plan the user confirmed; required
    /// for workspace sources (see `require_confirmed`).
    #[serde(default)]
    pub plan_fingerprint: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpProbeResult {
    /// connected | needs_auth | failed | unsupported
    pub status: String,
    pub message: Option<String>,
    /// 工具名，最多 `MAX_TOOLS` 个（详情列表用）。
    pub tools: Vec<String>,
    /// `tools/list` 声明的工具总数：不受 `MAX_TOOLS` 截断影响，界面上的
    /// 数量必须用它（rea 这类服务声明 139 个，列表里只列前 40 个）。
    pub tool_count: usize,
    pub server_name: Option<String>,
    pub protocol_version: Option<String>,
    pub elapsed_ms: u64,
}

impl McpProbeResult {
    fn failed(message: impl Into<String>) -> Self {
        Self {
            status: "failed".to_string(),
            message: Some(message.into()),
            ..Self::default()
        }
    }
    fn connected() -> Self {
        Self {
            status: "connected".to_string(),
            ..Self::default()
        }
    }
}

impl Default for McpProbeResult {
    fn default() -> Self {
        Self {
            status: "failed".to_string(),
            message: None,
            tools: Vec::new(),
            tool_count: 0,
            server_name: None,
            protocol_version: None,
            elapsed_ms: 0,
        }
    }
}

/// 检测一台 MCP 服务：显式动作，不缓存结果（UI 自己保存展示状态）。
#[tauri::command]
pub(crate) async fn mcp_probe(
    db: tauri::State<'_, std::sync::Arc<crate::db::Db>>,
    request: McpProbeRequest,
) -> Result<McpProbeResult, McpError> {
    let workspace = super::validate_workspace(request.workspace.as_deref(), &db)?;
    let target = super::probe_target(&request.entry_id, workspace.as_deref())?;
    require_confirmed(&target, request.plan_fingerprint.as_deref())?;
    Ok(run_probe(&target).await)
}

async fn run_probe(target: &ProbeTarget) -> McpProbeResult {
    let started = Instant::now();
    let mut result = match target.kind() {
        "stdio" => probe_stdio(target).await,
        "http" => probe_http(target).await,
        _ => McpProbeResult::failed("配置里既没有命令也没有地址，无法连接"),
    };
    result.elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    result
}

// ===== stdio =====

async fn probe_stdio(target: &ProbeTarget) -> McpProbeResult {
    probe_stdio_within(target, STDIO_TIMEOUT).await
}

async fn probe_stdio_within(target: &ProbeTarget, timeout: Duration) -> McpProbeResult {
    let Some(command) = target.command.as_deref() else {
        return McpProbeResult::failed("配置里没有可执行的命令");
    };
    let mut cmd = tokio::process::Command::new(command);
    cmd.args(&target.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if let Some(cwd) = target.cwd.as_deref() {
        cmd.current_dir(cwd);
    }
    for (key, value) in &target.env {
        cmd.env(key, expand_env(value));
    }
    // 自己的进程组：npx / uvx 还会再拉子进程，收尾时要整组杀掉。
    #[cfg(unix)]
    cmd.process_group(0);
    // Windows：GUI 进程 spawn 控制台子进程会弹一个可见控制台窗口（uv.exe /
    // node.exe / cmd.exe 都是控制台程序）。stdio 已重定向，窗口纯属噪音——
    // 页面「打开即检测」会同时拉起所有 stdio 服务，不压制就满屏窗口。
    #[cfg(windows)]
    crate::engine::hide_console(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => return McpProbeResult::failed(format!("启动失败：{error}")),
    };
    let pid = child.id().unwrap_or(0);
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        finish_process(pid, &mut child).await;
        return McpProbeResult::failed("无法建立 stdio 通道");
    };
    let mut reader = LineReader::new(stdout);
    let handshake = tokio::time::timeout(timeout, stdio_handshake(&mut stdin, &mut reader)).await;
    drop(stdin);
    finish_process(pid, &mut child).await;
    match handshake {
        Ok(Ok(result)) => result,
        Ok(Err(message)) => McpProbeResult::failed(message),
        Err(_) => McpProbeResult::failed(format!(
            "连接超时（{}s 内没完成握手）{}",
            timeout.as_secs(),
            overlong_note(&reader)
        )),
    }
}

/// 收尾：先杀整个进程组（孙进程持有管道），再回收直接子进程。
async fn finish_process(pid: u32, child: &mut tokio::process::Child) {
    if pid != 0 {
        crate::engine::kill_process_group(pid);
    }
    let _ = child.start_kill();
    let _ = child.wait().await;
}

async fn stdio_handshake(
    stdin: &mut tokio::process::ChildStdin,
    reader: &mut LineReader<tokio::process::ChildStdout>,
) -> Result<McpProbeResult, String> {
    write_message(stdin, &initialize_request()).await?;
    let initialized = read_result(reader, 1).await?;
    write_message(stdin, &notification("notifications/initialized")).await?;
    write_message(
        stdin,
        &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}),
    )
    .await?;
    let tools = read_result(reader, 2).await?;
    Ok(assemble(initialized, tools))
}

async fn write_message(
    stdin: &mut tokio::process::ChildStdin,
    message: &Value,
) -> Result<(), String> {
    let mut text = serde_json::to_string(message).map_err(|error| error.to_string())?;
    text.push('\n');
    use tokio::io::AsyncWriteExt;
    stdin
        .write_all(text.as_bytes())
        .await
        .map_err(|error| format!("写入服务失败：{error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("写入服务失败：{error}"))
}

/// 逐行读子进程 stdout。一次 read 可能带回多行（日志 + 响应挤在同一个
/// chunk）：剩余字节留在缓冲区，不能随行丢弃。
struct LineReader<R> {
    inner: BufReader<R>,
    buffer: Vec<u8>,
    /// 单行字节上限（不含换行符）。
    limit: usize,
    /// 当前行超长：丢弃到下一个换行。
    dropping: bool,
    /// 超限被整行丢弃的行数：握手失败时用它给出真实原因，而不是
    /// 「服务没有返回可识别的响应」这种与事实不符的描述。
    dropped: usize,
}

impl<R: tokio::io::AsyncRead + Unpin> LineReader<R> {
    fn new(inner: R) -> Self {
        Self::with_limit(inner, MAX_LINE)
    }

    fn with_limit(inner: R, limit: usize) -> Self {
        Self {
            inner: BufReader::new(inner),
            buffer: Vec::new(),
            limit,
            dropping: false,
            dropped: 0,
        }
    }

    /// 读下一行到 `out`；返回消费的字节数，0 表示 EOF。
    async fn next_line(&mut self, out: &mut Vec<u8>) -> std::io::Result<usize> {
        loop {
            if let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
                if self.dropping {
                    self.buffer.drain(..=index);
                    self.dropping = false;
                    return Ok(1);
                }
                out.extend_from_slice(&self.buffer[..index]);
                let consumed = index + 1;
                self.buffer.drain(..consumed);
                return Ok(consumed);
            }
            if self.dropping {
                self.buffer.clear();
            } else if self.buffer.len() > self.limit {
                self.dropping = true;
                self.dropped += 1;
                self.buffer.clear();
            }
            let mut chunk = [0u8; 8192];
            let read = self.inner.read(&mut chunk).await?;
            if read == 0 {
                if self.buffer.is_empty() {
                    return Ok(0);
                }
                out.extend_from_slice(&self.buffer);
                let total = self.buffer.len();
                self.buffer.clear();
                return Ok(total);
            }
            self.buffer.extend_from_slice(&chunk[..read]);
        }
    }
}

/// 读到 id 匹配的 JSON-RPC 响应；跳过服务打在 stdout 的日志/横幅与
/// 无关通知。
async fn read_result<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut LineReader<R>,
    id: i64,
) -> Result<Value, String> {
    let mut line = Vec::new();
    for _ in 0..200 {
        line.clear();
        let read = reader
            .next_line(&mut line)
            .await
            .map_err(|error| format!("读取服务输出失败：{error}"))?;
        if read == 0 {
            return Err(format!("服务在握手完成前结束了{}", overlong_note(reader)));
        }
        let Ok(text) = std::str::from_utf8(&line) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(text.trim()) else {
            continue;
        };
        if value.get("id").and_then(Value::as_i64) != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(rpc_error_message(error));
        }
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
    Err(format!("服务没有返回可识别的响应{}", overlong_note(reader)))
}

/// 超限被丢弃行的说明：附加在失败原因上，避免把「响应太大被丢弃」写成
/// 「服务没有返回可识别的响应」这种误导性描述。
fn overlong_note<R: tokio::io::AsyncRead + Unpin>(reader: &LineReader<R>) -> String {
    if reader.dropped == 0 {
        return String::new();
    }
    format!(
        "（有 {} 行输出超过 {} MiB 上限，已被丢弃）",
        reader.dropped,
        reader.limit / (1024 * 1024)
    )
}

// ===== HTTP / SSE =====

async fn probe_http(target: &ProbeTarget) -> McpProbeResult {
    let Some(url) = target.url.as_deref().map(|url| target.outbound_value(url)) else {
        return McpProbeResult::failed("配置里没有服务器地址");
    };
    let mut builder = reqwest::Client::builder().timeout(HTTP_TIMEOUT);
    if is_loopback_url(&url) {
        // 本机服务（Figma、IDE 内置 MCP 等）必须直连：环境里的 HTTP_PROXY
        // 会把 127.0.0.1 请求转到代理，得到 502 这种与真实状态无关的结果。
        builder = builder.no_proxy();
    }
    let client = match builder.build() {
        Ok(client) => client,
        Err(error) => return McpProbeResult::failed(format!("HTTP 客户端不可用：{error}")),
    };
    let send = |session: Option<String>, body: Value| {
        let mut request = client
            .post(&url)
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/event-stream",
            )
            .json(&body);
        for (key, value) in &target.headers {
            request = request.header(key, target.outbound_value(value));
        }
        if let Some(session) = session {
            request = request.header("mcp-session-id", session);
        }
        request.send()
    };

    let response = match send(None, initialize_request()).await {
        Ok(response) => response,
        Err(error) => return McpProbeResult::failed(format!("无法连接：{}", error_message(&error))),
    };
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return McpProbeResult {
            status: "needs_auth".to_string(),
            message: Some(format!("服务要求认证（HTTP {}）", status.as_u16())),
            ..McpProbeResult::default()
        };
    }
    if !status.is_success() {
        return McpProbeResult::failed(format!("HTTP {}", status.as_u16()));
    }
    let session = response
        .headers()
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = match response.text().await {
        Ok(body) => body,
        Err(error) => return McpProbeResult::failed(format!("读取响应失败：{error}")),
    };
    let initialized = match response_payload(&body, 1) {
        Some(value) => match payload_result(&value) {
            Ok(result) => result,
            Err(message) => return McpProbeResult::failed(message),
        },
        None => return McpProbeResult::failed("服务没有返回可识别的 initialize 响应"),
    };
    let _ = send(
        session.clone(),
        notification("notifications/initialized"),
    )
    .await;
    let tools = match send(
        session,
        json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}),
    )
    .await
    {
        Ok(response) if response.status().is_success() => match response.text().await {
            Ok(body) => response_payload(&body, 2)
                .map(|value| payload_result(&value).unwrap_or(Value::Null))
                .unwrap_or(Value::Null),
            Err(error) => return McpProbeResult::failed(format!("读取响应失败：{error}")),
        },
        Ok(response) => {
            let code = response.status();
            if code == reqwest::StatusCode::UNAUTHORIZED || code == reqwest::StatusCode::FORBIDDEN
            {
                return McpProbeResult {
                    status: "needs_auth".to_string(),
                    message: Some(format!("服务要求认证（HTTP {}）", code.as_u16())),
                    ..McpProbeResult::default()
                };
            }
            return McpProbeResult::failed(format!("tools/list 返回 HTTP {}", code.as_u16()));
        }
        Err(error) => {
            return McpProbeResult::failed(format!("tools/list 失败：{}", error_message(&error)))
        }
    };
    if initialized.get("error").is_some() {
        return McpProbeResult::failed(rpc_error_message(&initialized["error"]));
    }
    assemble(initialized, tools)
}

/// 取出 JSON-RPC 响应里的 `result`；带 `error` 的一律报错。
fn payload_result(value: &Value) -> Result<Value, String> {
    if let Some(error) = value.get("error") {
        return Err(rpc_error_message(error));
    }
    Ok(value.get("result").cloned().unwrap_or(Value::Null))
}

fn is_loopback_url(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return true;
    }
    host.parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

/// 响应体可能是 JSON，也可能是 SSE（`data: {...}`）；取 id 匹配的那条。
fn response_payload(body: &str, id: i64) -> Option<Value> {
    let trimmed = body.trim();
    if trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if value.get("id").and_then(Value::as_i64) == Some(id) {
                return Some(value);
            }
        }
    }
    for line in body.lines() {
        let line = line.trim();
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(data.trim()) else {
            continue;
        };
        if value.get("id").and_then(Value::as_i64) == Some(id) {
            return Some(value);
        }
    }
    None
}

// ===== 公共部分 =====

fn initialize_request() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": CLIENT_NAME, "version": env!("CARGO_PKG_VERSION") },
        },
    })
}

fn notification(method: &str) -> Value {
    json!({ "jsonrpc": "2.0", "method": method })
}

fn assemble(initialized: Value, tools: Value) -> McpProbeResult {
    let mut result = McpProbeResult::connected();
    result.protocol_version = initialized
        .get("protocolVersion")
        .and_then(Value::as_str)
        .map(str::to_string);
    result.server_name = initialized
        .get("serverInfo")
        .and_then(|info| info.get("name"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let items = tools.get("tools").and_then(Value::as_array);
    result.tool_count = items.map_or(0, Vec::len);
    result.tools = items
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .take(MAX_TOOLS)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    result
}

fn rpc_error_message(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("服务返回了错误");
    match error.get("code").and_then(Value::as_i64) {
        Some(code) => format!("{message}（code {code}）"),
        None => message.to_string(),
    }
}

fn error_message(error: &reqwest::Error) -> String {
    let detail = error.to_string();
    if error.is_timeout() {
        return "连接超时".to_string();
    }
    // reqwest 把 TCP 连接错误包在 Request kind 里，`is_connect()` 不一定为真。
    if error.is_connect() || detail.contains("connect") {
        return "无法建立连接（服务未启动或地址不可达）".to_string();
    }
    detail
}

/// 配置里的 `${VAR}` / `${VAR:-default}` 展开（与 CLI 一致）；未定义的变量
/// 展开成空串，不把字面量发出去。
pub(crate) fn expand_env(value: &str) -> String {
    if !value.contains("${") {
        return value.to_string();
    }
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let token = &rest[start + 2..start + end];
        let (name, default) = match token.split_once(":-") {
            Some((name, default)) => (name, Some(default)),
            None => (token, None),
        };
        match std::env::var(name) {
            Ok(resolved) if !resolved.is_empty() => out.push_str(&resolved),
            _ => out.push_str(default.unwrap_or("")),
        }
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests;
