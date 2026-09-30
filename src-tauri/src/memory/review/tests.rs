//! 复盘的解析与执行回归：模型回复的 JSON 容错、渠道字段解析、逐条执行时
//! 单条失败不中断其余条目。真实 HTTP 不在这里打——请求形状由 URL/正文构造
//! 的纯函数覆盖。

use super::*;
use crate::memory::store;
use serde_json::json;

struct Scratch(std::path::PathBuf);

impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-next-memory-review-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn scratch_db() -> (Scratch, Db) {
    let scratch = Scratch::new();
    let db = Db::open_at(&scratch.0.join("app.db")).unwrap();
    (scratch, db)
}

#[test]
fn parse_ops_reads_a_plain_object() {
    let parsed = parse_ops(
        r#"{"memory_ops":[
            {"action":"add","target":"user","content":"用户喜欢先给结论","reason":"偏好"},
            {"action":"replace","target":"memory","content":"项目用 pnpm","old_text":"npm"},
            {"action":"remove","target":"memory","old_text":"过时"}
        ]}"#,
    )
    .unwrap();
    assert_eq!(parsed.invalid, 0);
    assert_eq!(
        parsed.ops,
        vec![
            MemoryOp::Add {
                target: Target::User,
                content: "用户喜欢先给结论".into()
            },
            MemoryOp::Replace {
                target: Target::Memory,
                content: "项目用 pnpm".into(),
                old_text: "npm".into()
            },
            MemoryOp::Remove {
                target: Target::Memory,
                old_text: "过时".into()
            },
        ]
    );
}

#[test]
fn parse_ops_tolerates_fences_and_prose_around_the_json() {
    let reply = "好的，整理结果如下：\n```json\n{\"memory_ops\":[{\"action\":\"add\",\"target\":\"memory\",\"content\":\"macOS 上要用 pnpm\"}]}\n```\n以上。";
    let parsed = parse_ops(reply).unwrap();
    assert_eq!(parsed.ops.len(), 1);
    // 没有值得记的内容：空数组不是错误。
    let empty = parse_ops("{\"memory_ops\":[]}").unwrap();
    assert!(empty.ops.is_empty());
    let missing = parse_ops("{}").unwrap();
    assert!(missing.ops.is_empty());
}

#[test]
fn parse_ops_fails_only_when_there_is_no_json_at_all() {
    assert!(parse_ops("这次没有输出 JSON").is_err());
    assert!(parse_ops("{not json}").is_err());
    assert!(parse_ops("{\"memory_ops\":\"nope\"}").is_err());
}

#[test]
fn parse_ops_skips_broken_entries_instead_of_dropping_the_whole_review() {
    let parsed = parse_ops(
        r#"{"memory_ops":[
            {"action":"add","target":"memory","content":"留下这条"},
            {"action":"add","target":"memory"},
            {"action":"replace","target":"memory","content":"缺 old_text"},
            {"action":"add","target":"nowhere","content":"未知 target"},
            {"action":"nonsense","target":"memory","content":"未知 action"},
            {"action":"add","target":"user","content":"   "}
        ]}"#,
    )
    .unwrap();
    assert_eq!(parsed.ops.len(), 1);
    assert_eq!(parsed.invalid, 5, "坏条目计数，不中断整次复盘");
}

#[test]
fn parse_ops_caps_the_number_of_actions() {
    let mut ops = Vec::new();
    for index in 0..20 {
        ops.push(json!({
            "action": "add",
            "target": "memory",
            "content": format!("条目 {index}")
        }));
    }
    let parsed = parse_ops(&json!({ "memory_ops": ops }).to_string()).unwrap();
    assert_eq!(parsed.ops.len(), MAX_OPS);
    assert_eq!(parsed.invalid, 20 - MAX_OPS);
}

#[test]
fn clip_transcript_keeps_the_most_recent_tail() {
    let short = "短对话";
    assert_eq!(clip_transcript(short), short);
    let long: String = std::iter::repeat('长').take(MAX_TRANSCRIPT_CHARS + 100).collect();
    let clipped = clip_transcript(&long);
    assert!(clipped.starts_with("……（更早的对话已省略）"));
    // 截断按字符（不是字节）：中文结尾不会被劈成半个。
    assert_eq!(clipped.chars().count(), MAX_TRANSCRIPT_CHARS + 13);
}

#[test]
fn resolve_wire_uses_the_channel_fields_per_engine() {
    let claude = json!({
        "settingsConfig": { "env": {
            "ANTHROPIC_BASE_URL": "https://relay.example/anthropic",
            "ANTHROPIC_AUTH_TOKEN": "sk-claude",
            "ANTHROPIC_MODEL": "claude-sonnet-4-6",
            "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-relay"
        } }
    });
    let wire = resolve_wire("claude", &claude, Some("claude-opus")).unwrap();
    assert_eq!(wire.kind, "anthropic");
    assert_eq!(wire.base_url, "https://relay.example/anthropic");
    assert_eq!(wire.api_key, "sk-claude");
    // 具体模型名原样用。
    assert_eq!(wire.model, "claude-opus");
    // 会话里的槽位别名要走 spawn 同一套映射（不然渠道认不出来）。
    assert_eq!(
        resolve_wire("claude", &claude, Some("opus")).unwrap().model,
        "claude-opus-4-relay"
    );
    // CLI 的 1m beta 后缀不是模型 id，发 HTTP 前去掉。
    assert_eq!(
        resolve_wire("claude", &claude, Some("claude-opus[1m]"))
            .unwrap()
            .model,
        "claude-opus"
    );

    let codex_chat = json!({
        "baseUrl": "https://relay.example/v1",
        "apiKey": "sk-codex",
        "model": "gpt-5.1-codex",
        "configToml": "model_provider = \"relay\"\n[model_providers.relay]\nwire_api = \"chat\"\n"
    });
    let wire = resolve_wire("codex", &codex_chat, None).unwrap();
    assert_eq!(wire.kind, "openai");
    assert_eq!(wire.model, "gpt-5.1-codex");

    let codex_responses = json!({
        "baseUrl": "https://relay.example/v1",
        "apiKey": "sk-codex",
        "model": "gpt-5.1-codex",
        "configToml": "wire_api = \"responses\"\n"
    });
    assert_eq!(
        resolve_wire("codex", &codex_responses, None).unwrap().kind,
        "openai-responses"
    );

    let kimi = json!({
        "baseUrl": "https://api.moonshot.cn/v1",
        "apiKey": "sk-kimi",
        "model": "kimi-k3"
    });
    let wire = resolve_wire("kimi", &kimi, None).unwrap();
    assert_eq!(wire.kind, "openai");
    assert_eq!(wire.base_url, "https://api.moonshot.cn/v1");
    assert_eq!(wire.api_key, "sk-kimi");
}

#[test]
fn resolve_wire_reports_what_the_channel_is_missing() {
    let no_key = json!({ "baseUrl": "https://relay.example/v1", "model": "m" });
    assert!(resolve_wire("codex", &no_key, None)
        .unwrap_err()
        .contains("API key"));
    let no_model = json!({ "baseUrl": "https://relay.example/v1", "apiKey": "k" });
    assert!(resolve_wire("codex", &no_model, None)
        .unwrap_err()
        .contains("model"));
    let empty = json!({});
    assert!(resolve_wire("codex", &empty, None).is_err());
}

#[test]
fn request_urls_and_bodies_follow_the_wire() {
    let anthropic = Wire {
        kind: "anthropic",
        base_url: "https://relay.example/anthropic/".into(),
        api_key: "k".into(),
        model: "claude-sonnet-4-6".into(),
    };
    assert_eq!(
        request_urls(&anthropic),
        vec![
            "https://relay.example/anthropic/v1/messages",
            "https://relay.example/anthropic/messages",
        ]
    );
    let body = request_body(&anthropic, "整理对话");
    assert_eq!(body["model"], "claude-sonnet-4-6");
    assert_eq!(body["messages"][0]["content"], "整理对话");

    let openai = Wire {
        kind: "openai",
        base_url: "https://api.moonshot.cn/v1".into(),
        api_key: "k".into(),
        model: "kimi-k3".into(),
    };
    assert_eq!(
        request_urls(&openai),
        vec![
            "https://api.moonshot.cn/v1/chat/completions",
        ]
    );
    assert_eq!(request_body(&openai, "x")["temperature"], 0);
}

#[test]
fn reply_text_understands_all_three_shapes() {
    let anthropic = Wire {
        kind: "anthropic",
        base_url: String::new(),
        api_key: String::new(),
        model: String::new(),
    };
    let openai = Wire {
        kind: "openai",
        base_url: String::new(),
        api_key: String::new(),
        model: String::new(),
    };
    let responses = Wire {
        kind: "openai-responses",
        base_url: String::new(),
        api_key: String::new(),
        model: String::new(),
    };
    assert_eq!(
        reply_text(
            &anthropic,
            &json!({"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]})
        )
        .as_deref(),
        Some("ab")
    );
    assert_eq!(
        reply_text(
            &openai,
            &json!({"choices":[{"message":{"content":"{\"memory_ops\":[]}"}}]})
        )
        .as_deref(),
        Some("{\"memory_ops\":[]}")
    );
    assert_eq!(
        reply_text(
            &responses,
            &json!({"output":[{"content":[{"type":"output_text","text":"ok"}]}]})
        )
        .as_deref(),
        Some("ok")
    );
    assert!(reply_text(&openai, &json!({"choices":[]})).is_none());
}

#[test]
fn apply_ops_runs_every_valid_action_and_counts_the_failures() {
    let (_scratch, db) = scratch_db();
    store::add(
        &db,
        Target::Memory,
        Some("bot-review-test"),
        "项目用 npm",
        "user",
    )
    .unwrap();
    let ops = vec![
        MemoryOp::Add {
            target: Target::Memory,
            content: "项目跑在 macOS".into(),
        },
        MemoryOp::Replace {
            target: Target::Memory,
            content: "项目用 pnpm".into(),
            old_text: "npm".into(),
        },
        MemoryOp::Remove {
            target: Target::Memory,
            old_text: "并不存在的条目".into(),
        },
    ];
    // 测试环境读不到 bot.json，写入闸按「不审批」处理，直接落盘。
    let (applied, staged, failed, first_error) =
        apply_ops(&db, "bot-review-test", &ops).unwrap();
    assert_eq!((applied, staged, failed), (2, 0, 1));
    assert!(first_error.unwrap().contains("no entry contains"));
    let mut contents: Vec<String> = store::list(&db, Target::Memory, "bot-review-test")
        .unwrap()
        .into_iter()
        .map(|entry| entry.content)
        .collect();
    // 同一次复盘的两条可能落在同一毫秒里，排序只用来抹掉存储层的靠 id 兜底。
    contents.sort();
    assert_eq!(contents, vec!["项目用 pnpm", "项目跑在 macOS"]);
}

#[test]
fn review_prompt_carries_both_ledgers_and_the_transcript() {
    let prompt = review_prompt(
        "- 项目用 pnpm",
        "（空）",
        (12, 2200),
        (0, 1375),
        "用户：不对，应该用 pnpm",
    );
    assert!(prompt.contains("MEMORY，12/2200 字"));
    assert!(prompt.contains("- 项目用 pnpm"));
    assert!(prompt.contains("USER，0/1375 字"));
    assert!(prompt.contains("用户：不对，应该用 pnpm"));
    assert!(prompt.contains("\"memory_ops\""));
}
