//! 手动运行的真实 CLI 烟测：隔离 HOME、临时 .zshrc、仅回环假服务和虚构密钥。
//! 验证生产缓存注入 → 真实 CLI 配置解析 → 实际 HTTP Authorization，不调用真实模型。

use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
#[ignore = "requires locally installed pi, omp and /bin/zsh; run explicitly with --ignored --nocapture"]
async fn real_clis_send_shell_credential_to_loopback_server() {
    let root = std::env::temp_dir().join(format!(
        "ccgui-env-smoke-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let _fixture = Fixture(root.clone());
    let key = "CCGUI_ENV_SMOKE_KEY";
    assert!(std::env::var_os(key).is_none());
    std::fs::write(
        root.join(".zshrc"),
        format!("export {key}=ccgui-fake-shell-secret\n"),
    )
    .unwrap();

    for engine in ["pi", "omp"] {
        let agent = root.join(engine);
        std::fs::create_dir_all(&agent).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let api_key = if engine == "pi" {
            format!("${key}")
        } else {
            key.to_string()
        };
        let config = serde_json::json!({"providers": {"ccgui-probe": {
            "baseUrl": format!("http://{address}/v1"), "api": "openai-completions",
            "apiKey": api_key,
            "models": [{"id": "ccgui-probe", "name": "Probe", "reasoning": false,
                "input": ["text"], "contextWindow": 4096, "maxTokens": 16,
                "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}}]
        }}})
        .to_string();
        // JSON 也是合法 YAML；两份文件仍分别走生产 PI/OMP 解析器。
        std::fs::write(
            agent.join(if engine == "pi" {
                "models.json"
            } else {
                "models.yml"
            }),
            &config,
        )
        .unwrap();
        let server = tokio::spawn(async move {
            tokio::time::timeout(Duration::from_secs(30), async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut headers = Vec::new();
                while !headers.windows(4).any(|part| part == b"\r\n\r\n") {
                    let mut buffer = [0u8; 4096];
                    let count = stream.read(&mut buffer).await.unwrap();
                    assert!(count > 0 && headers.len() < 65536, "invalid HTTP headers");
                    headers.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8_lossy(&headers);
                let authorization = request.lines().find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("authorization").then(|| value.trim().to_owned())
                });
                // 认证头足以判定；立即结束请求，不执行模型或工具。
                stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                authorization
            }).await.expect("CLI did not reach the loopback server")
        });
        let program = std::env::var(format!("CCGUI_SMOKE_{}_BIN", engine.to_uppercase()))
            .unwrap_or_else(|_| engine.to_string());
        let mut command = Command::new(program);
        command
            .env_clear()
            .env("HOME", &root)
            .env("PI_CODING_AGENT_DIR", &agent)
            .env("PATH", std::env::var_os("PATH").unwrap())
            .env("PI_OFFLINE", "1")
            .current_dir(&root)
            .kill_on_drop(true)
            .args([
                "--print",
                "--no-session",
                "--no-tools",
                "--no-extensions",
                "--no-skills",
                "--provider",
                "ccgui-probe",
                "--model",
                "ccgui-probe",
                "Reply OK",
            ]);
        let probe = Probe {
            program: PathBuf::from("/bin/zsh"),
            login: true,
            extra_env: vec![
                ("ZDOTDIR".into(), root.to_string_lossy().into_owned()),
                ("HOME".into(), root.to_string_lossy().into_owned()),
            ],
        };
        inject_from_probe_cached(
            &mut command,
            engine,
            &config,
            &probe,
            &Mutex::new(SessionCache::default()),
        )
        .await;
        let output = tokio::time::timeout(Duration::from_secs(40), command.output())
            .await
            .unwrap()
            .unwrap();
        let authorization = server.await.unwrap();
        assert_eq!(
            authorization.as_deref(),
            Some("Bearer ccgui-fake-shell-secret"),
            "{engine} failed to send the injected credential; CLI exit={}",
            output.status
        );
        println!("{engine}: login .zshrc -> production injection -> real CLI -> loopback Authorization: PASS (fake credential)");
    }
}
