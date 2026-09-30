//! 后台复盘（「会话结束后后台复盘」开关）：会话结束时（或每 N 轮）用该引擎
//! 已配置的 API 渠道跑一次轻量模型调用，读一遍对话，把值得长期保存的内容按
//! 固定 JSON 交回来，再逐条走与记忆工具相同的写入闸（扫描 / 容量 / 审批）。
//!
//! 只走渠道 HTTP：没有自定义渠道（官方登录、本地配置）时明确跳过并说明原因，
//! 不偷偷换成别的方式调用模型。渠道字段的解析复用 provider_files 的 env 映射，
//! 模型默认沿用当前会话的模型，渠道里配了更便宜的模型也不会被这里改掉。
//!
//! 复盘自身不落库：结果要么写进记忆，要么留给用户在待审批队列里处理。运行中
//! 的复盘用进程内集合去重，同一个 Bot 同时只跑一个。

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use super::pending::{gated, WriteOp, WriteOutcome};
use super::{ledger, render, MemoryError, Target};
use crate::db::Db;

/// 送给模型的对话片段上限（保留最近的：越靠后的上下文越相关）。
const MAX_TRANSCRIPT_CHARS: usize = 12_000;
/// 一次复盘最多执行几条（模型偶尔会把同一件事拆成多条写回来）。
const MAX_OPS: usize = 8;
/// 复盘回复的生成上限；整理任务不该写长文。
const MAX_REPLY_TOKENS: u32 = 2_048;

/// 复盘结果。`status` 是给界面看的粗粒度状态：
/// - `applied`：至少写进了一条；
/// - `staged`：至少转成了一条待审批（开关开着）；
/// - `empty`：读完认为没有值得保存的内容；
/// - `skipped`：没跑（开关关了 / 没有可用渠道 / 同一 Bot 已有复盘在跑）；
/// - `failed`：跑了但失败（HTTP、解析、渠道返回错误）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewOutcome {
    pub status: String,
    pub applied: usize,
    pub staged: usize,
    pub failed: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub at: i64,
}

impl ReviewOutcome {
    fn new(status: &str, message: Option<String>) -> Self {
        Self {
            status: status.to_string(),
            applied: 0,
            staged: 0,
            failed: 0,
            message,
            at: now_ms(),
        }
    }

    fn skipped(reason: &str) -> Self {
        Self::new("skipped", Some(reason.to_string()))
    }

    fn failed(message: impl Into<String>) -> Self {
        Self::new("failed", Some(message.into()))
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 一条模型交回的整理动作（已通过结构校验）。
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MemoryOp {
    Add {
        target: Target,
        content: String,
    },
    Replace {
        target: Target,
        content: String,
        old_text: String,
    },
    Remove {
        target: Target,
        old_text: String,
    },
}

/// 解析结果：能执行的动作 + 被跳过的坏条目数（模型返回非法 JSON 整次失败；
/// 单条结构不完整只跳过该条，不让一条坏数据带崩整次复盘）。
#[derive(Debug, Default)]
pub(crate) struct ParsedOps {
    pub ops: Vec<MemoryOp>,
    pub invalid: usize,
}

fn target_of(value: Option<&Value>) -> Option<Target> {
    match value.and_then(Value::as_str).map(str::trim) {
        Some("memory") => Some(Target::Memory),
        Some("user") => Some(Target::User),
        _ => None,
    }
}

fn text_of(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// 把模型回复里的一段文本当 JSON 读：容忍 ```json 围栏和前后解释文字，
/// 只取第一个 `{` 到最后一个 `}` 之间的对象。
fn json_slice(reply: &str) -> Option<&str> {
    let start = reply.find('{')?;
    let end = reply.rfind('}')?;
    (end > start).then(|| &reply[start..=end])
}

/// 校验 `memory_ops`：action/target 未知、add/replace 缺 content、replace/remove
/// 缺 old_text 的条目计为 invalid 跳过；超出 [`MAX_OPS`] 的也计入。
pub(crate) fn parse_ops(reply: &str) -> Result<ParsedOps, String> {
    let slice = json_slice(reply).ok_or_else(|| "reply contained no JSON object".to_string())?;
    let value: Value = serde_json::from_str(slice).map_err(|e| format!("invalid JSON: {e}"))?;
    let raw_ops = match value.get("memory_ops") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items.clone(),
        Some(_) => return Err("memory_ops is not an array".to_string()),
    };
    let mut parsed = ParsedOps::default();
    for item in raw_ops {
        let action = item.get("action").and_then(Value::as_str).map(str::trim);
        let target = target_of(item.get("target"));
        let content = text_of(item.get("content"));
        let old_text = text_of(item.get("old_text"));
        let op = match (action, target) {
            (Some("add"), Some(target)) => content.map(|content| MemoryOp::Add { target, content }),
            (Some("replace"), Some(target)) => match (content, old_text) {
                (Some(content), Some(old_text)) => Some(MemoryOp::Replace {
                    target,
                    content,
                    old_text,
                }),
                _ => None,
            },
            (Some("remove"), Some(target)) => {
                old_text.map(|old_text| MemoryOp::Remove { target, old_text })
            }
            _ => None,
        };
        match op {
            Some(op) if parsed.ops.len() < MAX_OPS => parsed.ops.push(op),
            _ => parsed.invalid += 1,
        }
    }
    Ok(parsed)
}

/// 复盘提示词（计划 §8.5 的收敛版：学习建议留给后续阶段，这里只要记忆动作）。
pub(crate) fn review_prompt(
    memory: &str,
    user: &str,
    memory_usage: (usize, usize),
    user_usage: (usize, usize),
    transcript: &str,
) -> String {
    let (memory_used, memory_limit) = memory_usage;
    let (user_used, user_limit) = user_usage;
    let memory = if memory.trim().is_empty() {
        "（空）"
    } else {
        memory
    };
    let user = if user.trim().is_empty() {
        "（空）"
    } else {
        user
    };
    format!(
        "你是记忆整理员。阅读下面的对话片段，判断有没有值得长期保存的信息。\n\n\
         当前 Bot 笔记（MEMORY，{memory_used}/{memory_limit} 字）：\n{memory}\n\n\
         当前用户画像（USER，{user_used}/{user_limit} 字）：\n{user}\n\n\
         对话片段：\n{transcript}\n\n\
         判断标准：\n\
         - 只保存以后的对话里还会用到的信息：用户偏好、纠正、踩坑经验、环境事实、重要结果\n\
         - 宁缺毋滥：没有值得保存的内容就返回空数组\n\
         - 优先用 replace 合并已有条目，不要新增相似条目\n\
         - 用户的偏好和习惯写 target=user；项目与环境事实、纠正、踩坑写 target=memory\n\
         - 严禁保存密钥、密码、token 或敏感个人信息\n\
         - 不保存琐碎信息、公共知识、大段代码或日志、只跟本次会话有关的临时信息\n\n\
         只输出一个 JSON 对象，不要解释，不要 Markdown 代码块：\n\
         {{\"memory_ops\":[{{\"action\":\"add|replace|remove\",\"target\":\"memory|user\",\
         \"content\":\"完整的新条目（replace 时是整条新内容）\",\
         \"old_text\":\"replace/remove 时用来唯一定位旧条目的子串\",\"reason\":\"一句话原因\"}}]}}"
    )
}

/// 对话片段只保留最近的一段：复盘看的是刚结束的会话，越靠后越相关。
pub(crate) fn clip_transcript(transcript: &str) -> String {
    let count = transcript.chars().count();
    if count <= MAX_TRANSCRIPT_CHARS {
        return transcript.to_string();
    }
    let mut clipped: String = transcript
        .chars()
        .skip(count - MAX_TRANSCRIPT_CHARS)
        .collect();
    clipped.insert_str(0, "……（更早的对话已省略）\n");
    clipped
}

/// 逐条执行整理动作，走与记忆工具相同的写入闸。单条失败不中断其余条目：
/// 计数后继续，并把第一条失败原因带回去。返回 (applied, staged, failed, first error)。
pub(crate) fn apply_ops(
    db: &Db,
    bot_id: &str,
    ops: &[MemoryOp],
) -> Result<(usize, usize, usize, Option<String>), MemoryError> {
    let mut applied = 0;
    let mut staged = 0;
    let mut failed = 0;
    let mut first_error: Option<String> = None;
    // USER 的写入不属于任何 Bot，但审批开关取发起写入的这个 Bot；
    // 一次复盘内读一次，所有动作共享同一个开关状态。
    let bot = Some(bot_id);
    let approval = crate::bots::memory_write_approval(bot_id);
    for op in ops {
        let write = match op {
            MemoryOp::Add { target, content } => {
                (*target, WriteOp::Add { content: content.as_str() })
            }
            MemoryOp::Replace {
                target,
                content,
                old_text,
            } => (
                *target,
                WriteOp::Replace {
                    old_text: old_text.as_str(),
                    content: content.as_str(),
                },
            ),
            MemoryOp::Remove { target, old_text } => (
                *target,
                WriteOp::Remove {
                    old_text: old_text.as_str(),
                },
            ),
        };
        let outcome = gated(db, write.0, bot, approval, write.1, "review");
        match outcome {
            Ok(WriteOutcome::Applied { .. }) => applied += 1,
            Ok(WriteOutcome::Staged { .. }) => staged += 1,
            Err(error) => {
                failed += 1;
                first_error.get_or_insert(error.message);
            }
        }
    }
    Ok((applied, staged, failed, first_error))
}

/// 同一个 Bot 同时只跑一个复盘（前端有 in-flight 守卫，后端再兜一层：
/// 两次触发竞态时不该付两份模型调用）。
static IN_FLIGHT: Mutex<Option<HashSet<String>>> = Mutex::new(None);

struct InFlight(String);

impl InFlight {
    fn begin(bot_id: &str) -> Option<Self> {
        let mut guard = IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
        let set = guard.get_or_insert_with(HashSet::new);
        if set.contains(bot_id) {
            return None;
        }
        set.insert(bot_id.to_string());
        Some(Self(bot_id.to_string()))
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        // 中毒也要清（into_inner）：不然一次 panic 会让这个 Bot 永远 busy。
        let mut guard = IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(set) = guard.as_mut() {
            set.remove(&self.0);
        }
    }
}

/// 一次渠道调用需要的全部字段（已从 provider JSON / env 映射解析出来）。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Wire {
    /// `anthropic` | `openai` | `openai-responses`
    pub kind: &'static str,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// 从渠道配置解析调用参数。`model` 是当前会话的模型（优先），渠道里配置的
/// 模型兜底；两者都拿不到就无法调用，报错误原因给界面。
pub(crate) fn resolve_wire(
    engine: &str,
    provider: &Value,
    session_model: Option<&str>,
) -> Result<Wire, String> {
    let env = crate::provider_files::channel_env(engine, provider)
        .map_err(|e| format!("channel env: {e}"))?;
    let from_env = |key: &str| non_empty(env.get(key).map(String::as_str));
    let from_json = |key: &str| non_empty(provider.get(key).and_then(Value::as_str));
    let pick = |keys: &[&str]| keys.iter().find_map(|key| from_env(key).or_else(|| from_json(key)));

    // codex 的渠道把 wire_api 写进 configToml；responses 走 /responses，
    // 其余（relay 预设默认）走 chat/completions。
    let responses = engine == "codex"
        && provider
            .get("configToml")
            .and_then(Value::as_str)
            .is_some_and(|toml| toml.replace(' ', "").contains("wire_api=\"responses\""));

    let kind = if engine == "claude" {
        "anthropic"
    } else if responses {
        "openai-responses"
    } else {
        "openai"
    };
    let base_url = pick(&[
        "ANTHROPIC_BASE_URL",
        "OPENAI_BASE_URL",
        "KIMI_BASE_URL",
        "XAI_API_BASE_URL",
        "baseUrl",
    ])
    .ok_or_else(|| "channel has no base URL".to_string())?;
    let api_key = pick(&[
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "KIMI_API_KEY",
        "XAI_API_KEY",
        "apiKey",
    ])
    .ok_or_else(|| "channel has no API key".to_string())?;
    // Claude 渠道的会话模型常是别名（opus/sonnet/…），直接拿它发 HTTP 会被
    // 渠道当成未知模型；复用 spawn 的解析（槽位映射 + `[1m]` 去掉——那是 CLI
    // 的 beta 约定，不是模型 id）。
    // "default" 是界面上的「渠道默认」，不是模型 id。
    let session_model = non_empty(session_model).filter(|model| model != "default");
    let model = if engine == "claude" {
        crate::engine::resolve_claude_channel_model(
            session_model.as_deref(),
            provider,
            &env,
        )
        .or_else(|| from_env("ANTHROPIC_DEFAULT_SONNET_MODEL"))
        .or_else(|| from_env("ANTHROPIC_DEFAULT_HAIKU_MODEL"))
        .or_else(|| from_json("model"))
    } else {
        session_model
            .or_else(|| from_json("model"))
            .or_else(|| from_env("ANTHROPIC_MODEL"))
            .or_else(|| from_env("KIMI_MODEL_NAME"))
    }
    .map(|model| model.strip_suffix("[1m]").unwrap_or(&model).to_string())
    .ok_or_else(|| "channel has no model".to_string())?;
    Ok(Wire {
        kind,
        base_url,
        api_key,
        model,
    })
}

/// POST 的候选 URL：渠道的 base 可能是 origin、带 `/v1`，或厂商自定义前缀。
/// base 已经带版本段时不再拼 `/v1`（`…/v1/v1/chat/completions` 只会浪费一次
/// 请求）；没带版本段的两种拼法都试。
fn request_urls(wire: &Wire) -> Vec<String> {
    let base = wire.base_url.trim().trim_end_matches('/').to_string();
    let versioned = base
        .rsplit('/')
        .next()
        .is_some_and(|segment| {
            segment.len() > 1
                && segment.starts_with('v')
                && segment[1..].chars().all(|c| c.is_ascii_digit())
        });
    fn push_unique(urls: &mut Vec<String>, url: String) {
        if !urls.contains(&url) {
            urls.push(url);
        }
    }
    let suffix = match wire.kind {
        "anthropic" => "/messages",
        "openai-responses" => "/responses",
        _ => "/chat/completions",
    };
    let mut urls: Vec<String> = Vec::new();
    if versioned {
        push_unique(&mut urls, format!("{base}{suffix}"));
    } else if wire.kind == "anthropic" {
        // Anthropic 路由惯例是 /v1/messages；没带版本段的 base 先试它。
        push_unique(&mut urls, format!("{base}/v1{suffix}"));
        push_unique(&mut urls, format!("{base}{suffix}"));
    } else {
        push_unique(&mut urls, format!("{base}{suffix}"));
        push_unique(&mut urls, format!("{base}/v1{suffix}"));
    }
    urls
}

fn request_body(wire: &Wire, prompt: &str) -> Value {
    match wire.kind {
        "anthropic" => json!({
            "model": wire.model,
            "max_tokens": MAX_REPLY_TOKENS,
            "temperature": 0,
            "messages": [{ "role": "user", "content": prompt }],
        }),
        "openai-responses" => json!({
            "model": wire.model,
            "max_output_tokens": MAX_REPLY_TOKENS,
            "input": prompt,
        }),
        _ => json!({
            "model": wire.model,
            "max_tokens": MAX_REPLY_TOKENS,
            "temperature": 0,
            "stream": false,
            "messages": [{ "role": "user", "content": prompt }],
        }),
    }
}

/// 从响应体里取出模型的文本回复。Anthropic 是 `content[].text`，OpenAI chat
/// 是 `choices[0].message.content`（个别渠道给数组），Responses 是
/// `output[].content[].text`。
fn reply_text(wire: &Wire, body: &Value) -> Option<String> {
    match wire.kind {
        "anthropic" => {
            let mut out = String::new();
            for block in body.get("content")?.as_array()? {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        out.push_str(text);
                    }
                }
            }
            (!out.trim().is_empty()).then_some(out)
        }
        "openai-responses" => {
            let mut out = String::new();
            for item in body.get("output")?.as_array()? {
                let Some(content) = item.get("content").and_then(Value::as_array) else {
                    continue;
                };
                for block in content {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        out.push_str(text);
                    }
                }
            }
            (!out.trim().is_empty()).then_some(out)
        }
        _ => match body.pointer("/choices/0/message/content") {
            Some(Value::String(text)) => (!text.trim().is_empty()).then(|| text.clone()),
            Some(Value::Array(blocks)) => {
                let mut out = String::new();
                for block in blocks {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        out.push_str(text);
                    }
                }
                (!out.trim().is_empty()).then_some(out)
            }
            _ => None,
        },
    }
}

/// 出错时截取渠道返回的正文首段，让界面能说清为什么失败（401、模型不存在…）。
fn error_excerpt(status: u16, body: &str) -> String {
    let excerpt: String = body.trim().chars().take(300).collect();
    if excerpt.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {excerpt}")
    }
}

async fn call_channel(wire: &Wire, prompt: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("build http client: {e}"))?;
    let mut last_error: Option<String> = None;
    for url in request_urls(wire) {
        let mut request = client.post(&url).json(&request_body(wire, prompt));
        if wire.kind == "anthropic" {
            request = request
                .header("x-api-key", wire.api_key.as_str())
                .header("anthropic-version", "2023-06-01")
                .header("authorization", format!("Bearer {}", wire.api_key));
        } else {
            request = request.header("authorization", format!("Bearer {}", wire.api_key));
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(e) => {
                last_error = Some(format!("{url}: {e}"));
                continue;
            }
        };
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            last_error = Some(format!("{url}: {}", error_excerpt(status.as_u16(), &body)));
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&body) else {
            last_error = Some(format!("{url}: reply was not JSON"));
            continue;
        };
        match reply_text(wire, &value) {
            Some(text) => return Ok(text),
            None => last_error = Some(format!("{url}: reply carried no text")),
        }
    }
    Err(last_error.unwrap_or_else(|| "no candidate endpoint succeeded".to_string()))
}

/// 跑一次复盘。`engine`/`provider_id` 决定用哪个渠道，`model` 是当前会话的
/// 模型（None 时用渠道默认）。整个过程不阻塞对话：调用方 await 这个 future
/// 即可（Tauri 命令在自己的异步任务里等它）。
pub async fn review(
    db: &Db,
    bot_id: &str,
    engine: &str,
    provider_id: Option<&str>,
    model: Option<&str>,
    transcript: &str,
) -> ReviewOutcome {
    if !crate::bots::memory_review_enabled(bot_id) {
        return ReviewOutcome::skipped("disabled");
    }
    let Some(_guard) = InFlight::begin(bot_id) else {
        return ReviewOutcome::skipped("busy");
    };
    let provider = match crate::config::resolve_provider(engine, provider_id) {
        Ok(Some(provider)) => provider,
        Ok(None) => return ReviewOutcome::skipped("no_channel"),
        Err(error) => return ReviewOutcome::failed(error),
    };
    let wire = match resolve_wire(engine, &provider, model) {
        Ok(wire) => wire,
        Err(error) => return ReviewOutcome::skipped(&format!("channel_incomplete: {error}")),
    };
    // 提示词先拼账本快照，再交给渠道。
    let (memory, user) = match (ledger(db, Target::Memory, bot_id), ledger(db, Target::User, "")) {
        (Ok(memory), Ok(user)) => (memory, user),
        (Err(error), _) | (_, Err(error)) => return ReviewOutcome::failed(error.message),
    };
    let prompt = review_prompt(
        &render(&memory.entries),
        &render(&user.entries),
        (memory.used, memory.limit),
        (user.used, user.limit),
        &clip_transcript(transcript),
    );
    let reply = match call_channel(&wire, &prompt).await {
        Ok(reply) => reply,
        Err(error) => return ReviewOutcome::failed(error),
    };
    // 模型调用期间用户可能关掉了复盘或删了这个 Bot：写回之前先复查一遍，
    // 不给已经删除的 Bot 留下没人能看到的条目。
    if !crate::bots::memory_review_enabled(bot_id) {
        return ReviewOutcome::skipped("disabled");
    }
    let parsed = match parse_ops(&reply) {
        Ok(parsed) => parsed,
        Err(error) => return ReviewOutcome::failed(format!("review reply: {error}")),
    };
    if parsed.ops.is_empty() {
        return ReviewOutcome::new(
            "empty",
            (parsed.invalid > 0).then(|| format!("{} invalid ops ignored", parsed.invalid)),
        );
    }
    let (applied, staged, failed, first_error) = match apply_ops(db, bot_id, &parsed.ops) {
        Ok(counts) => counts,
        Err(error) => return ReviewOutcome::failed(error.message),
    };
    let status = if applied > 0 {
        "applied"
    } else if staged > 0 {
        "staged"
    } else {
        "failed"
    };
    let mut outcome = ReviewOutcome::new(status, first_error);
    outcome.applied = applied;
    outcome.staged = staged;
    outcome.failed = failed + parsed.invalid;
    outcome
}

#[cfg(test)]
mod tests;
