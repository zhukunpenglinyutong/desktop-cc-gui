//! 探针单元测试：用假 MCP 服务验证 stdio / HTTP 两条握手指令链、跳过日志行、
//! 超时与错误路径，以及条目 → 探测目标的字段映射（不在测试里碰真实配置）。

use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;

/// 可执行的假 stdio 服务脚本（unix：/bin/sh 在 CI 与本地都有）。
#[cfg(unix)]
fn fake_stdio_script(tag: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = std::env::temp_dir().join(format!(
        "ccgui-mcp-probe-{}-{tag}.sh",
        std::process::id()
    ));
    std::fs::write(&path, body).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

#[cfg(unix)]
fn stdio_target(script: &PathBuf) -> ProbeTarget {
    ProbeTarget {
        command: Some("/bin/sh".to_string()),
        args: vec![script.to_string_lossy().into_owned()],
        ..ProbeTarget::default()
    }
}

#[test]
fn expand_env_resolves_variables_with_defaults() {
    std::env::set_var("CCGUI_PROBE_TEST_TOKEN", "secret");
    assert_eq!(expand_env("Bearer ${CCGUI_PROBE_TEST_TOKEN}"), "Bearer secret");
    assert_eq!(expand_env("${CCGUI_PROBE_MISSING:-fallback}"), "fallback");
    assert_eq!(expand_env("${CCGUI_PROBE_MISSING}"), "");
    assert_eq!(expand_env("plain text"), "plain text");
    std::env::remove_var("CCGUI_PROBE_TEST_TOKEN");
}

#[test]
fn target_kind_follows_declared_transport_then_fields() {
    let stdio = ProbeTarget {
        command: Some("npx".to_string()),
        ..ProbeTarget::default()
    };
    assert_eq!(stdio.kind(), "stdio");
    let remote = ProbeTarget {
        url: Some("https://x/mcp".to_string()),
        ..ProbeTarget::default()
    };
    assert_eq!(remote.kind(), "http");
    // opencode 的 local/remote 也是同一条归一化路径。
    let local = ProbeTarget {
        transport: Some("local".to_string()),
        command: Some("npx".to_string()),
        ..ProbeTarget::default()
    };
    assert_eq!(local.kind(), "stdio");
    assert_eq!(ProbeTarget::default().kind(), "unknown");
}

#[test]
fn payload_parses_plain_json_and_sse() {
    let json = r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"a"}]}}"#;
    assert!(response_payload(json, 2).is_some());
    let sse = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n";
    assert!(response_payload(sse, 1).is_some());
    // 其他 id 的帧不算命中。
    assert!(response_payload(sse, 2).is_none());
    assert!(response_payload("not json", 1).is_none());
}

/// 界面上的数量必须是服务声明的实际工具数：详情只列前 `MAX_TOOLS` 个名字，
/// 但计数不能被截断（rea 声明 139 个，早先界面只显示 40）。
#[test]
fn assemble_reports_the_declared_tool_count_not_the_truncated_list() {
    let tools = json!({
        "tools": (0..MAX_TOOLS + 99)
            .map(|index| json!({ "name": format!("tool-{index}") }))
            .collect::<Vec<_>>()
    });
    let result = assemble(json!({}), tools);
    assert_eq!(result.tools.len(), MAX_TOOLS);
    assert_eq!(result.tool_count, MAX_TOOLS + 99);
}

#[cfg(unix)]
#[tokio::test]
async fn stdio_probe_completes_the_handshake_and_reports_tools() {
    let script = fake_stdio_script(
        "ok",
        r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"fake"}}}' ;;
    *'"id":2'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"alpha"},{"name":"beta"}]}}' ;;
  esac
done
"#,
    );
    let result = probe_stdio_within(&stdio_target(&script), Duration::from_secs(10)).await;
    assert_eq!(result.status, "connected", "{:?}", result.message);
    assert_eq!(result.server_name.as_deref(), Some("fake"));
    assert_eq!(result.protocol_version.as_deref(), Some("2025-06-18"));
    assert_eq!(result.tools, vec!["alpha", "beta"]);
    assert_eq!(result.tool_count, 2);
    let _ = std::fs::remove_file(script);
}

#[cfg(unix)]
#[tokio::test]
async fn stdio_probe_skips_log_lines_before_the_json() {
    let script = fake_stdio_script(
        "logs",
        r#"#!/bin/sh
echo "starting up"
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\n' 'not json yet'; printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"noisy"}}}' ;;
    *'"id":2'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}' ;;
  esac
done
"#,
    );
    let result = probe_stdio_within(&stdio_target(&script), Duration::from_secs(10)).await;
    assert_eq!(result.status, "connected", "{:?}", result.message);
    assert_eq!(result.server_name.as_deref(), Some("noisy"));
    assert!(result.tools.is_empty());
    assert_eq!(result.tool_count, 0);
    let _ = std::fs::remove_file(script);
}

#[cfg(unix)]
#[tokio::test]
async fn stdio_probe_reports_exit_before_handshake_and_timeout() {
    let exited = fake_stdio_script("exit", "#!/bin/sh\nexit 0\n");
    let result = probe_stdio_within(&stdio_target(&exited), Duration::from_secs(5)).await;
    assert_eq!(result.status, "failed");
    assert!(
        result.message.as_deref().unwrap().contains("结束"),
        "{:?}",
        result.message
    );
    let _ = std::fs::remove_file(exited);

    let hanging = fake_stdio_script("hang", "#!/bin/sh\nsleep 30\n");
    let result = probe_stdio_within(&stdio_target(&hanging), Duration::from_secs(1)).await;
    assert_eq!(result.status, "failed");
    assert!(
        result.message.as_deref().unwrap().contains("超时"),
        "{:?}",
        result.message
    );
    let _ = std::fs::remove_file(hanging);
}

/// 单行上限与引擎同源（16 MiB）：合法的大响应不能被丢掉。
/// 真实回归——rea 的 `tools/list` 是 ≈1.9 MB 的单行 JSON，旧的 1 MiB
/// 上限会把整行丢进 `dropping`，界面上表现为「连接失败」。
#[tokio::test]
async fn line_reader_keeps_a_response_larger_than_one_megabyte() {
    let body = format!(
        "{{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{{\"tools\":[{}]}}}}",
        "\"x\",".repeat(400_000)
    );
    assert!(body.len() > (1 << 20), "夹具必须大于旧的 1 MiB 上限");
    let mut wire = body.clone();
    wire.push('\n');
    let mut reader = LineReader::new(wire.as_bytes());
    let mut out = Vec::new();
    let read = reader.next_line(&mut out).await.unwrap();
    assert_eq!(read, wire.len());
    assert_eq!(out, body.as_bytes());
    assert_eq!(reader.dropped, 0);
}

/// 超限行仍要丢弃（内存保护），但不能吃掉紧跟其后的正常响应，
/// 也不能把原因说成「服务没有返回可识别的响应」。
#[tokio::test]
async fn overlong_lines_are_dropped_without_eating_the_next_line() {
    let wire = format!(
        "{}\n{}\n",
        "x".repeat(20_000),
        r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"ok"}]}}"#
    );
    let mut reader = LineReader::with_limit(wire.as_bytes(), 64);
    let result = read_result(&mut reader, 2).await.unwrap();
    assert_eq!(result["tools"][0]["name"], "ok");
    assert_eq!(reader.dropped, 1);
}

/// 丢弃发生在握手响应上时，失败原因必须点明超限，而不是让用户
/// 看到与事实不符的「服务没有返回可识别的响应」。
#[tokio::test]
async fn a_dropped_handshake_response_reports_the_real_cause() {
    let wire = format!("{}\n", "x".repeat(1_200_000));
    let mut reader = LineReader::with_limit(wire.as_bytes(), 1 << 20);
    let error = read_result(&mut reader, 2).await.unwrap_err();
    assert!(error.contains("已被丢弃"), "{error}");
    assert!(error.contains("1 MiB"), "{error}");
    assert_eq!(reader.dropped, 1);
}

/// 按请求内容回应的假 HTTP MCP 服务（initialize / tools/login 各一份）。
fn spawn_fake_http(initialize: String, tools: String, unauthorized: bool) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 2048];
            loop {
                let read = match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => read,
                };
                buffer.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&buffer);
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let length = text
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if buffer.len() >= head_end + 4 + length {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&buffer).to_string();
            let (status, body) = if unauthorized {
                (
                    "401 Unauthorized",
                    "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32001,\"message\":\"auth required\"}}"
                        .to_string(),
                )
            } else if request.contains("\"method\":\"initialize\"") {
                ("200 OK", initialize.clone())
            } else if request.contains("\"method\":\"tools/list\"") {
                ("200 OK", tools.clone())
            } else {
                ("202 Accepted", String::new())
            };
            let extra = if unauthorized {
                "WWW-Authenticate: Bearer\r\n".to_string()
            } else {
                "mcp-session-id: fake-session\r\n".to_string()
            };
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    format!("http://{addr}/mcp")
}

#[tokio::test]
async fn http_probe_parses_json_and_sse_responses() {
    let url = spawn_fake_http(
        r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"remote"}}}"#
            .to_string(),
        "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"search\"}]}}\n\n"
            .to_string(),
        false,
    );
    let target = ProbeTarget {
        url: Some(url),
        ..ProbeTarget::default()
    };
    let result = probe_http(&target).await;
    assert_eq!(result.status, "connected", "{:?}", result.message);
    assert_eq!(result.server_name.as_deref(), Some("remote"));
    assert_eq!(result.tools, vec!["search"]);
    assert_eq!(result.tool_count, 1);
}

#[tokio::test]
async fn http_probe_maps_auth_and_unreachable_to_distinct_states() {
    let unauthorized = spawn_fake_http(String::new(), String::new(), true);
    let target = ProbeTarget {
        url: Some(unauthorized),
        ..ProbeTarget::default()
    };
    let result = probe_http(&target).await;
    assert_eq!(result.status, "needs_auth");
    assert!(result.message.unwrap().contains("认证"));

    // 未监听的端口：连接失败，不是「未配置」。
    let target = ProbeTarget {
        url: Some("http://127.0.0.1:9/mcp".to_string()),
        ..ProbeTarget::default()
    };
    let result = probe_http(&target).await;
    let message = result.message.unwrap_or_default();
    assert_eq!(result.status, "failed");
    assert!(message.contains("无法连接"), "message={message}");
}

/// A server that records the first request it receives and answers 401, so
/// the probe stops after the `initialize` request.
fn spawn_recording_http() -> (String, std::sync::Arc<std::sync::Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let seen = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let sink = std::sync::Arc::clone(&seen);
    std::thread::spawn(move || {
        if let Some(Ok(mut stream)) = listener.incoming().next() {
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 2048];
            while let Ok(read) = stream.read(&mut chunk) {
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
                if String::from_utf8_lossy(&buffer).contains("\r\n\r\n") {
                    break;
                }
            }
            *sink.lock().unwrap() = String::from_utf8_lossy(&buffer).into_owned();
            let _ = stream.write_all(
                b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
        }
    });
    (format!("http://{addr}/mcp"), seen)
}

#[tokio::test]
async fn workspace_targets_send_env_placeholders_verbatim() {
    std::env::set_var("CCGUI_PROBE_LEAK_TEST", "leak-value-7731");
    for (from_workspace, should_leak) in [(true, false), (false, true)] {
        let (url, seen) = spawn_recording_http();
        let target = ProbeTarget {
            url: Some(format!("{url}?k=${{CCGUI_PROBE_LEAK_TEST}}")),
            headers: vec![(
                "Authorization".to_string(),
                "Bearer ${CCGUI_PROBE_LEAK_TEST}".to_string(),
            )],
            from_workspace,
            ..ProbeTarget::default()
        };
        let result = probe_http(&target).await;
        assert_eq!(result.status, "needs_auth", "{:?}", result.message);
        let request = seen.lock().unwrap().clone();
        assert_eq!(
            request.contains("leak-value-7731"),
            should_leak,
            "from_workspace={from_workspace} request={request}"
        );
    }
    std::env::remove_var("CCGUI_PROBE_LEAK_TEST");
}

#[test]
fn probe_plan_shows_the_command_and_only_key_names() {
    let target = ProbeTarget {
        command: Some("powershell".to_string()),
        args: vec!["-enc".to_string(), "AAAA".to_string()],
        cwd: Some("/ws".to_string()),
        env: vec![("API_KEY".to_string(), "env-secret-1".to_string())],
        headers: vec![("Authorization".to_string(), "Bearer header-secret-2".to_string())],
        url: Some("https://user:pw-secret-3@host.example/mcp?token=query-secret-4&x=1".to_string()),
        from_workspace: true,
        ..ProbeTarget::default()
    };
    let plan = plan_for(&target);
    assert_eq!(plan.command.as_deref(), Some("powershell"));
    assert_eq!(plan.args, vec!["-enc", "AAAA"]);
    assert_eq!(plan.cwd.as_deref(), Some("/ws"));
    assert_eq!(plan.env_keys, vec!["API_KEY"]);
    assert_eq!(plan.header_keys, vec!["Authorization"]);
    let shown = serde_json::to_string(&plan).unwrap();
    for secret in ["env-secret-1", "header-secret-2", "pw-secret-3", "query-secret-4"] {
        assert!(!shown.contains(secret), "{secret} leaked into {shown}");
    }
    assert!(shown.contains("host.example"));
}

#[test]
fn declarative_targets_map_engine_specific_fields() {
    let scratch = std::env::temp_dir().join(format!("ccgui-mcp-probe-map-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(&scratch).unwrap();

    // opencode：`command` 是数组，环境变量叫 environment。
    let opencode = scratch.join("opencode.json");
    std::fs::write(
        &opencode,
        r#"{"mcp":{"local":{"type":"local","command":["npx","-y","pkg"],"environment":{"TOKEN":"${CCGUI_PROBE_MAP_TOKEN:-x}"}}}}"#,
    )
    .unwrap();
    let json = std::fs::read_to_string(&opencode).unwrap();
    let root: Value = serde_json::from_str(&json).unwrap();
    let object = root["mcp"]["local"].as_object().unwrap();
    let target = super::super::sources::probe_target_from_json(
        object,
        true,
        super::super::sources::OPENCODE_FIELDS,
    );
    assert_eq!(target.command.as_deref(), Some("npx"));
    assert_eq!(target.args, vec!["-y", "pkg"]);
    assert_eq!(target.env, vec![("TOKEN".to_string(), "${CCGUI_PROBE_MAP_TOKEN:-x}".to_string())]);
    assert_eq!(target.kind(), "stdio");

    // agy：远程地址在 serverUrl。
    let agy = scratch.join("mcp_config.json");
    std::fs::write(
        &agy,
        r#"{"mcpServers":{"remote":{"serverUrl":"https://x/mcp","headers":{"Authorization":"Bearer ${CCGUI_PROBE_MAP_TOKEN:-x}"}}}}"#,
    )
    .unwrap();
    let json = std::fs::read_to_string(&agy).unwrap();
    let root: Value = serde_json::from_str(&json).unwrap();
    let object = root["mcpServers"]["remote"].as_object().unwrap();
    let target = super::super::sources::probe_target_from_json(
        object,
        false,
        super::super::sources::AGY_FIELDS,
    );
    assert_eq!(target.url.as_deref(), Some("https://x/mcp"));
    assert_eq!(target.kind(), "http");
    assert_eq!(
        target.headers,
        vec![("Authorization".to_string(), "Bearer ${CCGUI_PROBE_MAP_TOKEN:-x}".to_string())]
    );

    let _ = std::fs::remove_dir_all(&scratch);
}

/// What runs must be what the user confirmed: a workspace target is only
/// probed with the fingerprint of the exact plan shown, and any change to
/// the command, its args, env values or URL yields a new fingerprint.
#[test]
fn workspace_probe_requires_the_confirmed_plan_fingerprint() {
    let target = ProbeTarget {
        command: Some("node".to_string()),
        args: vec!["server.js".to_string()],
        env: vec![("API_KEY".to_string(), "one".to_string())],
        from_workspace: true,
        ..ProbeTarget::default()
    };
    let shown = plan_for(&target).fingerprint;
    assert!(require_confirmed(&target, Some(&shown)).is_ok());
    assert!(require_confirmed(&target, None).is_err());
    assert!(require_confirmed(&target, Some("stale")).is_err());

    let mut changed = target.clone();
    changed.args.push("--evil".to_string());
    assert!(require_confirmed(&changed, Some(&shown)).is_err());
    let mut env_changed = target.clone();
    env_changed.env[0].1 = "two".to_string();
    assert_ne!(plan_for(&env_changed).fingerprint, shown);

    // The user's own servers never needed a confirmation.
    let user = ProbeTarget { from_workspace: false, ..target };
    assert!(require_confirmed(&user, None).is_ok());
}
