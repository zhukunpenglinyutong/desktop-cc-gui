use super::{content_text, parse_ts_ms_str, Message};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::collections::HashSet;
use std::io::BufRead;
use std::path::{Path, PathBuf};

pub struct ParsedSession {
    pub messages: Vec<Message>,
}

/// Parse a native session file into the minimal message list. Bad lines are
/// skipped individually.
pub fn parse_session_file(
    engine: &str,
    path: &Path,
    accepted_internal_frames: &HashSet<String>,
) -> Result<ParsedSession, String> {
    if engine == "agy" {
        return Ok(super::agy::parse_agy_session(path, accepted_internal_frames));
    }
    if engine == "opencode" {
        return Ok(parse_opencode_session(path, accepted_internal_frames));
    }
    let reader = open_line_reader(engine, path)?;
    Ok(collect_session(
        reader,
        &extractor_for(engine, ImageMode::Collect),
        accepted_internal_frames,
    ))
}

/// Everything the sidebar needs from a scan: title/preview/timestamps/count.
/// Derived in one streaming pass without materializing the message list or
/// any image data URLs.
pub struct ScanSummary {
    pub title: String,
    pub preview: String,
    pub first_ts: Option<i64>,
    pub last_ts: Option<i64>,
    pub message_count: i64,
}

/// The scan-time parse: same line walk as `parse_session_file`, but folds
/// each row into a bounded accumulator instead of a Vec<Message>. Image-only
/// user turns (whose data URLs are skipped here) fall out of the count —
/// the sidebar counts text, and the reader path stays authoritative.
pub fn scan_summary_file(
    engine: &str,
    path: &Path,
    accepted_internal_frames: &HashSet<String>,
) -> Result<ScanSummary, String> {
    if engine == "agy" {
        return Ok(super::agy::scan_agy_summary(path, accepted_internal_frames));
    }
    if engine == "opencode" {
        return Ok(scan_opencode_summary(path, accepted_internal_frames));
    }
    let reader = open_line_reader(engine, path)?;
    let mut acc = ScanAcc::default();
    walk_lines(
        reader,
        &extractor_for(engine, ImageMode::SkipDataUrls),
        accepted_internal_frames,
        |row| {
            acc.accept(row);
        },
    );
    Ok(acc.finish())
}

/// dsh session files are zstd-compressed NDJSON; everything else is plain.
fn open_line_reader(engine: &str, path: &Path) -> Result<Box<dyn BufRead>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    if engine == "dsh" {
        let decoder = zstd::stream::read::Decoder::new(std::io::BufReader::new(file))
            .map_err(|e| format!("zstd {}: {e}", path.display()))?;
        Ok(Box::new(std::io::BufReader::new(decoder)))
    } else {
        Ok(Box::new(std::io::BufReader::new(file)))
    }
}

/// Image payloads: the reader renders them, the scanner must not build them.
#[derive(Clone, Copy, PartialEq)]
enum ImageMode {
    Collect,
    SkipDataUrls,
}

type LineExtractor<'a> = Box<dyn Fn(&Value) -> LineRows + 'a>;

fn extractor_for(engine: &str, images: ImageMode) -> LineExtractor<'static> {
    if engine == "dsh" {
        Box::new(extract_dsh_line)
    } else {
        let engine = engine.to_string();
        Box::new(move |value| extract_line_messages(&engine, value, images))
    }
}

/// Line-loop skeleton shared by the full parse and the scan summary: decode
/// one NDJSON line, extract rows, normalize, hand each to `consume`.
fn walk_lines(
    reader: impl BufRead,
    extract: &LineExtractor<'_>,
    accepted_internal_frames: &HashSet<String>,
    mut consume: impl FnMut(LineRow),
) {
    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.contains("\"type\"") {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        for row in extract(&value) {
            let Some(row) = normalize_extracted_row(row, accepted_internal_frames) else {
                continue;
            };
            consume(row);
        }
    }
}

fn collect_session(
    reader: impl BufRead,
    extract: &LineExtractor<'_>,
    accepted_internal_frames: &HashSet<String>,
) -> ParsedSession {
    let mut rows = Vec::new();
    walk_lines(reader, extract, accepted_internal_frames, |row| {
        rows.push(row)
    });
    fold_rows(rows)
}

/// Shared fold over extracted rows (usage markers, tool-result pairing,
/// durations, seq numbering) — opencode feeds it from its storage-tree walk
/// instead of an NDJSON line reader.
fn fold_rows(rows: Vec<LineRow>) -> ParsedSession {
    let mut messages = Vec::<Message>::new();
    let mut seq = 0i64;
    let mut last_user_ts: Option<i64> = None;
    // tool call id -> index in `messages`. Results arrive in completion order,
    // so pairing them back up by the latest row still missing one mislabels
    // parallel calls; the id is what actually names the call.
    let mut call_rows: HashMap<String, usize> = HashMap::new();
    for row in rows {
        // Usage-only marker (codex token_count or claude compact_boundary): fold
        // onto the last assistant message instead of creating an empty row.
        if row.role == "__usage__" {
            if let Some(last) = messages.iter_mut().rev().find(|m| m.role == "assistant") {
                let mut new_usage = row.usage;
                if let (Some(prev), Some(next)) = (last.usage.as_ref(), new_usage.as_mut()) {
                    if let (Some(mcw), Some(obj)) =
                        (prev.get("model_context_window"), next.as_object_mut())
                    {
                        if !obj.contains_key("model_context_window") {
                            obj.insert("model_context_window".to_string(), mcw.clone());
                        }
                    }
                }
                last.usage = new_usage;
            }
            continue;
        }
        // Tool result marker: fold onto its named call when the transcript
        // carries toolCallId, else retain the legacy latest-unresolved
        // fallback used by Claude transcripts.
        if row.role == "__tool_result__" {
            if let Some(res) = row.result {
                let index = match row.tool_call_id.as_deref() {
                    Some(id) => call_rows
                        .get(id)
                        .copied()
                        .filter(|index| messages[*index].result.is_none()),
                    None => messages
                        .iter()
                        .rposition(|m| m.role == "tool" && m.result.is_none()),
                };
                if let Some(index) = index {
                    if let Some(todos) = crate::engine::parse_todo_result(&res) {
                        messages[index].todos = Some(todos);
                    }
                    messages[index].result = Some(res);
                }
            }
            continue;
        }
        if row.text.trim().is_empty() && row.images.is_empty() {
            continue;
        }
        let parsed_ts = row.ts.as_deref().and_then(super::parse_ts_ms_str);
        if row.role == "user" {
            last_user_ts = parsed_ts;
        }
        let duration_ms = row.duration_ms.or_else(|| {
            if row.role == "assistant" {
                if let (Some(u_ts), Some(a_ts)) = (last_user_ts, parsed_ts) {
                    if a_ts >= u_ts && a_ts - u_ts < 24 * 3600 * 1000 {
                        return Some(a_ts - u_ts);
                    }
                }
            }
            None
        });
        seq += 1;
        let call_id = row.tool_call_id;
        messages.push(Message {
            seq,
            role: row.role,
            text: row.text,
            ts: row.ts,
            path: row.path,
            args: row.args,
            result: row.result,
            todos: row.todos,
            usage: row.usage,
            model: row.model,
            effort: row.effort,
            duration_ms,
            images: row.images,
        });
        if let Some(id) = call_id {
            call_rows.insert(id, messages.len() - 1);
        }
    }
    ParsedSession { messages }
}

/// Bounded scan accumulator: keeps only what the sessions table stores.
#[derive(Default)]
struct ScanAcc {
    count: i64,
    first_ts: Option<String>,
    last_ts: Option<String>,
    title: Option<String>,
    first_user_text: Option<String>,
    last_assistant_text: Option<String>,
}

impl ScanAcc {
    fn accept(&mut self, row: LineRow) {
        if row.role == "__usage__" {
            return;
        }
        if row.text.trim().is_empty() && row.images.is_empty() {
            return;
        }
        if self.count == 0 {
            self.first_ts = row.ts.clone();
        }
        self.count += 1;
        self.last_ts = row.ts.clone();
        match row.role.as_str() {
            "user" => {
                // Mirrors strip_title_noise: first non-noise user body wins, the
                // first user row (even noise) is the fallback.
                if self.title.is_none() {
                    let body = super::strip_title_noise(&row.text);
                    if !body.is_empty() {
                        self.title = Some(super::truncate_chars(&body, 80));
                    }
                }
                if self.first_user_text.is_none() {
                    self.first_user_text = Some(row.text);
                }
            }
            "assistant" => self.last_assistant_text = Some(row.text),
            _ => {}
        }
    }

    fn finish(self) -> ScanSummary {
        let title = self
            .title
            .or_else(|| self.first_user_text.map(|t| super::truncate_chars(&t, 80)))
            .unwrap_or_default();
        ScanSummary {
            title,
            preview: self
                .last_assistant_text
                .map(|t| super::truncate_chars(&t, 120))
                .unwrap_or_default(),
            first_ts: self.first_ts.as_deref().and_then(parse_ts_ms_str),
            last_ts: self.last_ts.as_deref().and_then(parse_ts_ms_str),
            message_count: self.count,
        }
    }
}

fn extract_dsh_line(value: &Value) -> LineRows {
    let line_type = type_str(value);
    let ts = value
        .get("time")
        .and_then(Value::as_i64)
        .map(|ms| ms.to_string());
    match line_type {
        "user/message" => {
            let text = content_text(value.get("data").and_then(|d| d.get("content")));
            // Skip injected runtime context / system reminders — not user text.
            let trimmed = text.trim();
            if trimmed.starts_with("<system-reminder>")
                || trimmed.starts_with("Current runtime context")
            {
                return Vec::new();
            }
            if trimmed.is_empty() {
                Vec::new()
            } else {
                vec![LineRow::new("user", text, ts)]
            }
        }
        "assistant/message" => {
            let content = value
                .get("data")
                .and_then(|d| d.get("message"))
                .and_then(|m| m.get("content"));
            let text = match content {
                Some(Value::Array(parts)) => text_of_parts(parts, true, ""),
                other => content_text(other),
            };
            if text.trim().is_empty() {
                Vec::new()
            } else {
                vec![LineRow::new("assistant", text, ts)]
            }
        }
        _ => Vec::new(),
    }
}

/// Paths embedded by `kimi_prompt_with_images` after the marker block, one
/// `<image path="...">` tag per attachment.
fn kimi_image_paths(block: &str) -> Vec<String> {
    const TAG: &str = "<image path=\"";
    let mut out = Vec::new();
    let mut rest = block;
    while let Some(start) = rest.find(TAG) {
        rest = &rest[start + TAG.len()..];
        match rest.find('"') {
            Some(end) => {
                out.push(rest[..end].to_string());
                rest = &rest[end..];
            }
            None => break,
        }
    }
    out
}

/// Claude image content block -> data URL for direct WebView rendering.
fn claude_image_data_url(block: &Value) -> Option<String> {
    let source = block.get("source")?;
    let data = source.get("data").and_then(Value::as_str)?;
    if data.is_empty() {
        return None;
    }
    let mime = source
        .get("media_type")
        .and_then(Value::as_str)
        .unwrap_or("image/png");
    Some(format!("data:{mime};base64,{data}"))
}

/// pi/omp image content part (`{type:"image", data, mimeType}`) -> data URL.
fn pi_image_part(part: &Value) -> Option<String> {
    if part.get("type").and_then(Value::as_str) != Some("image") {
        return None;
    }
    let data = part.get("data").and_then(Value::as_str)?;
    if data.is_empty() {
        return None;
    }
    let mime = part
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or("image/png");
    Some(format!("data:{mime};base64,{data}"))
}

/// Codex token_count `info` → occupancy + the window the CLI actually used.
/// last_token_usage is this request; total_token_usage is session-billed
/// cumulative and must not fill the context bar.
fn usage_from_codex_token_info(info: Option<&Value>) -> Option<Value> {
    let info = info?;
    let mut usage = info
        .get("last_token_usage")
        .or_else(|| info.get("total_token_usage"))?
        .clone();
    if let Some(window) = info.get("model_context_window") {
        if let Some(obj) = usage.as_object_mut() {
            obj.insert("model_context_window".to_string(), window.clone());
        }
    }
    Some(usage)
}

/// Codex `input_image` content part -> its `image_url` (data URL or path).
fn codex_image_part(part: &Value) -> Option<String> {
    if part.get("type").and_then(Value::as_str) != Some("input_image") {
        return None;
    }
    let url = part.get("image_url").and_then(Value::as_str)?;
    if url.is_empty() {
        None
    } else {
        Some(url.to_string())
    }
}

/// `value["type"]` as a string slice, empty when absent.
fn type_str(value: &Value) -> &str {
    value.get("type").and_then(Value::as_str).unwrap_or("")
}

/// First string-valued timestamp among `keys` (engines disagree on the
/// field name; grok alone has used three).
fn ts_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|k| value.get(k).and_then(Value::as_str))
        .map(str::to_string)
}

/// Join the `text` payloads of content parts; `typed_only` keeps only
/// `type == "text"` parts.
fn text_of_parts(parts: &[Value], typed_only: bool, sep: &str) -> String {
    parts
        .iter()
        .filter(|p| !typed_only || type_str(p) == "text")
        .filter_map(|p| p.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(sep)
}

/// One extracted row from a native session line.
struct LineRow {
    role: String,
    text: String,
    ts: Option<String>,
    path: Option<String>,
    args: Option<Value>,
    tool_call_id: Option<String>,
    result: Option<Value>,
    todos: Option<crate::engine::TodosPayload>,
    usage: Option<Value>,
    model: Option<String>,
    effort: Option<String>,
    duration_ms: Option<i64>,
    images: Vec<String>,
}

impl LineRow {
    /// A plain row without usage/model metadata.
    fn new(role: &str, text: String, ts: Option<String>) -> Self {
        Self {
            role: role.to_string(),
            text,
            ts,
            path: None,
            args: None,
            tool_call_id: None,
            result: None,
            todos: None,
            usage: None,
            model: None,
            effort: None,
            duration_ms: None,
            images: Vec::new(),
        }
    }
}

type LineRows = Vec<LineRow>;
const INTERNAL_PROMPT_MARKERS: [&str; 2] = [
    "\n\n[CCGUI internal system-tail]\n",
    "\n\n[CCGUI internal request-tail]\n",
];

fn strip_internal_prompt_tail(text: &str) -> &str {
    INTERNAL_PROMPT_MARKERS
        .iter()
        .filter_map(|marker| text.find(marker))
        .min()
        .map_or(text, |index| &text[..index])
}

fn valid_internal_nonce(nonce: &str) -> bool {
    (1..=128).contains(&nonce.len())
        && nonce
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// Opening marker of an internal frame. Shared by the recorder (which derives
/// an identity from one complete frame) and the parser (which hides only the
/// frames whose identities were recorded), so both agree on what a frame is.
const INTERNAL_FRAME_OPEN: &str = "<CCGUI_INTERNAL_";

/// Identity of one internal frame: the exact bytes the engine wrote.
pub fn internal_frame_hash(frame: &str) -> String {
    format!("{:x}", Sha256::digest(frame.as_bytes()))
}

/// Largest frame the host will ever record an identity for. A capture may
/// declare a smaller `maxBytes`; this is the absolute ceiling that keeps a
/// hostile/buggy caller from filling the table with arbitrary text.
pub const MAX_RECORDED_FRAME_BYTES: usize = 64 * 1024;

/// Accept `frame` only when it is exactly one complete internal frame with a
/// JSON payload, and return its identity. The IPC command is reachable by any
/// enabled plugin, so the host re-derives this instead of trusting the caller.
pub fn recordable_internal_frame_hash(frame: &str) -> Option<String> {
    if frame.len() > MAX_RECORDED_FRAME_BYTES {
        return None;
    }
    let rest = frame.strip_prefix(INTERNAL_FRAME_OPEN)?;
    let open_end = rest.find('>')?;
    let nonce = &rest[..open_end];
    if !valid_internal_nonce(nonce) {
        return None;
    }
    let close = format!("</CCGUI_INTERNAL_{nonce}>");
    let payload = rest[open_end + 1..].strip_suffix(&close)?;
    // A second close tag inside the payload would make the recorded identity
    // cover more than the frame the parser will later find.
    if payload.contains(&close) {
        return None;
    }
    serde_json::from_str::<Value>(payload).ok()?;
    Some(internal_frame_hash(frame))
}

/// Hide only those internal frames whose exact identities a live capture
/// validator accepted. `text` comes back untouched, without allocating, when
/// no identity is recorded or the row carries no frame marker at all — the
/// case for every ordinary assistant row the scanner walks.
pub(super) fn strip_recorded_internal_frames(
    text: String,
    accepted_internal_frames: &HashSet<String>,
) -> String {
    if accepted_internal_frames.is_empty() || !text.contains(INTERNAL_FRAME_OPEN) {
        return text;
    }
    let mut out = String::with_capacity(text.len());
    let mut removed = false;
    let mut rest = text.as_str();
    while let Some(start) = rest.find(INTERNAL_FRAME_OPEN) {
        out.push_str(&rest[..start]);
        let candidate = &rest[start..];
        let Some(open_end) = candidate.find('>') else {
            out.push_str(candidate);
            rest = "";
            break;
        };
        let nonce = &candidate[INTERNAL_FRAME_OPEN.len()..open_end];
        if !valid_internal_nonce(nonce) {
            out.push_str(&candidate[..open_end + 1]);
            rest = &candidate[open_end + 1..];
            continue;
        }
        let close = format!("</CCGUI_INTERNAL_{nonce}>");
        let payload_start = open_end + 1;
        let Some(close_offset) = candidate[payload_start..].find(&close) else {
            out.push_str(candidate);
            rest = "";
            break;
        };
        let frame_end = payload_start + close_offset + close.len();
        let frame = &candidate[..frame_end];
        if accepted_internal_frames.contains(&internal_frame_hash(frame)) {
            removed = true;
        } else {
            out.push_str(frame);
        }
        rest = &candidate[frame_end..];
    }
    out.push_str(rest);
    // Only a removed frame can leave the surrounding text padded; a row that
    // kept everything it had must keep its own spacing too.
    if !removed {
        return text;
    }
    out.trim().to_string()
}
/// Remove host-only prompt tails and only those internal frames whose exact
/// identities were accepted by a live capture validator.
fn normalize_extracted_row(
    mut row: LineRow,
    accepted_internal_frames: &HashSet<String>,
) -> Option<LineRow> {
    if row.role == "assistant" {
        // Nothing recorded, or no marker in the row: the row stands exactly as
        // the engine wrote it. Only a row that lost a hidden frame can end up
        // empty here, and only that row may be dropped — an assistant row the
        // engine itself left blank is the history's business, not ours.
        if accepted_internal_frames.is_empty() || !row.text.contains(INTERNAL_FRAME_OPEN) {
            return Some(row);
        }
        row.text = strip_recorded_internal_frames(row.text, accepted_internal_frames);
        return (!row.text.trim().is_empty() || !row.images.is_empty()).then_some(row);
    }
    if row.role != "user" {
        return Some(row);
    }
    let visible = strip_internal_prompt_tail(&row.text);
    let text = super::clean_user_turn(visible);
    if super::is_injected_user_context(&text) {
        return None;
    }
    if text.trim().is_empty() && row.images.is_empty() {
        return None;
    }
    row.text = text;
    Some(row)
}

/// Per-engine NDJSON line -> zero or more (role, text, ts, usage, model) tuples.
fn extract_line_messages(engine: &str, value: &Value, images: ImageMode) -> LineRows {
    match engine {
        "claude" => extract_claude_line(value, images),
        "kimi" => extract_kimi_line(value),
        "grok" => extract_grok_line(value),
        "codex" => extract_codex_line(value, images),
        "pi" | "omp" => extract_pi_family_line(value, images),
        "qoder" | "qoder-cn" => extract_qoder_line(value, images),
        _ => Vec::new(),
    }
}

/// Codex rollout lines: {timestamp, type, payload}. Messages are
/// response_item payloads of type "message".
fn extract_codex_line(value: &Value, images: ImageMode) -> LineRows {
    let line_type = type_str(value);
    let ts = ts_string(value, &["timestamp"]);
    match line_type {
        "response_item" => {
            let Some(payload) = value.get("payload") else {
                return Vec::new();
            };
            // Reasoning items persist the visible summary; encrypted
            // content is skipped.
            if payload.get("type").and_then(Value::as_str) == Some("reasoning") {
                let text = match payload.get("summary") {
                    Some(Value::Array(parts)) => text_of_parts(parts, false, "\n"),
                    _ => String::new(),
                };
                return if text.trim().is_empty() {
                    Vec::new()
                } else {
                    vec![LineRow::new("thinking", text, ts)]
                };
            }
            if payload.get("type").and_then(Value::as_str) != Some("message") {
                return Vec::new();
            }
            let role = payload
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if role != "user" && role != "assistant" {
                return Vec::new();
            }
            // content blocks: input_text / output_text
            let content = payload.get("content");
            let text = match content {
                Some(Value::Array(parts)) => text_of_parts(parts, false, ""),
                other => content_text(other),
            };
            let collected = match (images, content) {
                (ImageMode::Collect, Some(Value::Array(parts))) => {
                    parts.iter().filter_map(codex_image_part).collect()
                }
                _ => Vec::new(),
            };
            if text.trim().is_empty() && collected.is_empty() {
                Vec::new()
            } else {
                vec![LineRow {
                    images: collected,
                    ..LineRow::new(&role, text, ts)
                }]
            }
        }
        "event_msg" => {
            let Some(payload) = value.get("payload") else {
                return Vec::new();
            };
            if payload.get("type").and_then(Value::as_str) == Some("token_count") {
                if let Some(usage) = usage_from_codex_token_info(payload.get("info")) {
                    return vec![LineRow {
                        usage: Some(usage),
                        ..LineRow::new("__usage__", String::new(), ts)
                    }];
                }
            }
            Vec::new()
        }
        _ => Vec::new(),
    }
}

/// Flush buffered assistant text ahead of a toolCall/thinking part so the
/// timeline keeps calls where they actually happened.
fn pi_flush_text(out: &mut LineRows, text: &mut String, ts: &Option<String>, role: &str) {
    if !text.trim().is_empty() {
        out.push(LineRow::new(role, std::mem::take(text), ts.clone()));
    }
}

/// One pi/omp assistant content part -> rows appended to `out`, with plain
/// text accumulating into `text`.
fn pi_assistant_part(part: &Value, out: &mut LineRows, text: &mut String, ts: &Option<String>) {
    match part.get("type").and_then(Value::as_str) {
        Some("text") => {
            if let Some(t) = part.get("text").and_then(Value::as_str) {
                text.push_str(t);
            }
        }
        Some("toolCall") => {
            pi_flush_text(out, text, ts, "assistant");
            let name = part.get("name").and_then(Value::as_str).unwrap_or("tool");
            let intent = part.get("intent").and_then(Value::as_str);
            let arguments = part.get("arguments");
            out.push(LineRow {
                path: arguments.and_then(crate::engine::tool_path_arg),
                args: arguments.and_then(crate::engine::parse_tool_args_value),
                tool_call_id: part.get("id").and_then(Value::as_str).map(str::to_string),
                // Session files store `arguments` as an already-parsed object.
                todos: arguments.and_then(crate::engine::parse_todo_args),
                ..LineRow::new(
                    "tool",
                    crate::engine::pi_family::tool_label(name, intent),
                    ts.clone(),
                )
            });
        }
        Some("thinking") => {
            pi_flush_text(out, text, ts, "assistant");
            if let Some(t) = part.get("thinking").and_then(Value::as_str) {
                out.push(LineRow::new("thinking", t.to_string(), ts.clone()));
            }
        }
        _ => {}
    }
}

/// pi/omp session lines: {type:"message", timestamp, message:{role, content, usage?}}
fn extract_pi_family_line(value: &Value, images: ImageMode) -> LineRows {
    if value.get("type").and_then(Value::as_str) != Some("message") {
        return Vec::new();
    }
    let ts = ts_string(value, &["timestamp"]);
    let Some(message) = value.get("message") else {
        return Vec::new();
    };
    let role = message.get("role").and_then(Value::as_str).unwrap_or("");
    let usage = message.get("usage").cloned();
    let model = message
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string);
    let effort = value
        .get("effort")
        .or_else(|| message.get("effort"))
        .or_else(|| message.get("thinking_effort"))
        .and_then(Value::as_str)
        .map(str::to_string);
    match role {
        "user" => {
            let content = message.get("content");
            let text = match content {
                Some(Value::Array(parts)) => text_of_parts(parts, true, ""),
                other => content_text(other),
            };
            let collected = match (images, content) {
                (ImageMode::Collect, Some(Value::Array(parts))) => {
                    parts.iter().filter_map(pi_image_part).collect()
                }
                _ => Vec::new(),
            };
            if text.trim().is_empty() && collected.is_empty() {
                Vec::new()
            } else {
                vec![LineRow {
                    usage,
                    images: collected,
                    ..LineRow::new("user", text, ts)
                }]
            }
        }
        // Assistant content interleaves text and toolCall parts; walk it in
        // order so the timeline shows tool calls where they actually happened.
        "assistant" => match message.get("content") {
            Some(Value::Array(parts)) => {
                let mut out: LineRows = Vec::new();
                let mut text = String::new();
                for part in parts {
                    pi_assistant_part(part, &mut out, &mut text, &ts);
                }
                if !text.trim().is_empty() {
                    out.push(LineRow {
                        usage,
                        model,
                        effort,
                        ..LineRow::new("assistant", text, ts)
                    });
                }
                out
            }
            other => {
                let text = content_text(other);
                if text.trim().is_empty() {
                    Vec::new()
                } else {
                    vec![LineRow {
                        usage,
                        model,
                        effort,
                        ..LineRow::new("assistant", text, ts)
                    }]
                }
            }
        },
        "toolResult" => {
            let content = message.get("content").cloned();
            let text = match content.as_ref() {
                Some(Value::Array(parts)) => text_of_parts(parts, false, "\n"),
                other => content_text(other),
            };
            let details = message.get("details").cloned();
            let result = match details {
                Some(details) if !details.is_null() => Some(serde_json::json!({
                    "text": text,
                    "details": details,
                })),
                _ => Some(Value::String(text)),
            };
            vec![LineRow {
                tool_call_id: message
                    .get("toolCallId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                result,
                ..LineRow::new("__tool_result__", String::new(), ts)
            }]
        }
        _ => Vec::new(),
    }
}

/// Flush buffered claude text as a row carrying the line's usage/model/effort.
fn claude_flush_text(
    out: &mut LineRows,
    text: &mut String,
    role: &str,
    ts: &Option<String>,
    usage: &Option<Value>,
    model: &Option<String>,
    effort: &Option<String>,
) {
    if !text.trim().is_empty() {
        out.push(LineRow {
            usage: usage.clone(),
            model: model.clone(),
            effort: effort.clone(),
            ..LineRow::new(role, std::mem::take(text), ts.clone())
        });
    }
}

/// One claude content block; text accumulates, thinking/tool_use flush it.
fn claude_block_rows(
    block: &Value,
    images: ImageMode,
    out: &mut LineRows,
    text: &mut String,
    collected_images: &mut Vec<String>,
    role: &str,
    ts: &Option<String>,
    usage: &Option<Value>,
    model: &Option<String>,
    effort: &Option<String>,
) {
    match block.get("type").and_then(Value::as_str) {
        Some("thinking") => {
            claude_flush_text(out, text, role, ts, usage, model, effort);
            if let Some(t) = block.get("thinking").and_then(Value::as_str) {
                out.push(LineRow::new("thinking", t.to_string(), ts.clone()));
            }
        }
        Some("tool_use") => {
            claude_flush_text(out, text, role, ts, usage, model, effort);
            let name = block
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let input = block.get("input");
            out.push(LineRow {
                path: input.and_then(crate::engine::tool_path_arg),
                args: input.and_then(crate::engine::parse_tool_args_value),
                todos: input.and_then(crate::engine::parse_todo_args),
                ..LineRow::new("tool", name, ts.clone())
            });
        }
        Some("tool_result") => {
            let res = block.get("content").cloned();
            out.push(LineRow {
                result: res,
                ..LineRow::new("__tool_result__", String::new(), ts.clone())
            });
        }
        Some("image") => {
            if images == ImageMode::Collect {
                if let Some(url) = claude_image_data_url(block) {
                    collected_images.push(url);
                }
            }
        }
        _ => {
            if let Some(t) = block.get("text").and_then(Value::as_str) {
                text.push_str(t);
            }
        }
    }
}

fn extract_claude_line(value: &Value, images: ImageMode) -> LineRows {
    let line_type = type_str(value);
    if line_type == "system" {
        if value.get("subtype").and_then(Value::as_str) == Some("compact_boundary") {
            let post_tokens = value
                .get("compactMetadata")
                .and_then(|m| m.get("postTokens").or_else(|| m.get("post_tokens")))
                .and_then(Value::as_i64);
            if let Some(tokens) = post_tokens {
                let ts = ts_string(value, &["timestamp"]);
                let usage = serde_json::json!({
                    "input_tokens": tokens,
                    "total_tokens": tokens,
                });
                return vec![LineRow {
                    usage: Some(usage),
                    ..LineRow::new("__usage__", String::new(), ts)
                }];
            }
        }
        return Vec::new();
    }
    if line_type != "user" && line_type != "assistant" {
        return Vec::new();
    }
    // Slash-command expansions and other CLI-internal turns are logged with
    // `isMeta`; Claude Code itself never renders them in the transcript.
    if value.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return Vec::new();
    }
    let Some(message) = value.get("message") else {
        return Vec::new();
    };
    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or(line_type)
        .to_string();
    let ts = ts_string(value, &["timestamp"]);
    let usage = message.get("usage").cloned();
    let model = message
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string);
    let effort = value
        .get("effort")
        .or_else(|| message.get("effort"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let content = message.get("content");
    let mut out = Vec::new();
    match content {
        Some(Value::Array(blocks)) => {
            // Walk content blocks in order so thinking and tool calls land
            // where they actually happened relative to the text.
            let mut text = String::new();
            let mut collected: Vec<String> = Vec::new();
            for block in blocks {
                claude_block_rows(
                    block,
                    images,
                    &mut out,
                    &mut text,
                    &mut collected,
                    &role,
                    &ts,
                    &usage,
                    &model,
                    &effort,
                );
            }
            if !text.trim().is_empty() {
                out.push(LineRow {
                    usage,
                    model,
                    effort,
                    images: collected,
                    ..LineRow::new(&role, text, ts)
                });
            } else if !collected.is_empty() {
                out.push(LineRow {
                    images: collected,
                    ..LineRow::new(&role, String::new(), ts)
                });
            }
        }
        _ => {
            let text = content_text(content);
            if !text.trim().is_empty() {
                out.push(LineRow {
                    usage,
                    model,
                    effort,
                    ..LineRow::new(&role, text, ts)
                });
            }
        }
    }
    out
}

fn extract_kimi_line(value: &Value) -> LineRows {
    let line_type = type_str(value);
    let ts = value
        .get("time")
        .and_then(Value::as_i64)
        .map(|ms| ms.to_string());
    match line_type {
        "turn.prompt" => {
            let text = content_text(value.get("input"));
            // Strip our image-injection marker block.
            let (display, images) = match text.find(crate::engine::images::KIMI_IMAGE_MARKER) {
                Some(idx) => (
                    text[..idx].trim_end().to_string(),
                    kimi_image_paths(&text[idx..]),
                ),
                None => (text, Vec::new()),
            };
            if display.trim().is_empty() && images.is_empty() {
                Vec::new()
            } else {
                vec![LineRow {
                    images,
                    ..LineRow::new("user", display, ts)
                }]
            }
        }
        "context.append_loop_event" => {
            let Some(event) = value.get("event") else {
                return Vec::new();
            };
            if event.get("type").and_then(Value::as_str) != Some("content.part") {
                return Vec::new();
            }
            let Some(part) = event.get("part") else {
                return Vec::new();
            };
            match part.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let text = part
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if text.trim().is_empty() {
                        Vec::new()
                    } else {
                        vec![LineRow::new("assistant", text, ts)]
                    }
                }
                Some("tool_call") => {
                    let name = part
                        .get("name")
                        .or_else(|| part.get("tool_name"))
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string();
                    let args = part
                        .get("arguments")
                        .or_else(|| part.get("input"))
                        .or_else(|| part.get("args"));
                    vec![LineRow {
                        path: args.and_then(crate::engine::tool_path_arg),
                        args: args.and_then(crate::engine::parse_tool_args_value),
                        todos: args.and_then(crate::engine::parse_todo_args),
                        ..LineRow::new("tool", name, ts)
                    }]
                }
                _ => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

fn extract_grok_line(value: &Value) -> LineRows {
    let line_type = type_str(value);
    let ts = ts_string(value, &["timestamp", "created_at", "createdAt"]);
    match line_type {
        "user" => {
            // Envelope stripping (`<user_info>` / `<user_query>`) lives in
            // `normalize_extracted_row` so it is shared across engines.
            if value.get("synthetic_reason").is_some() {
                return Vec::new();
            }
            let text = content_text(value.get("content"));
            if text.trim().is_empty() {
                Vec::new()
            } else {
                vec![LineRow::new("user", text, ts)]
            }
        }
        "reasoning" => {
            let text = match value.get("summary") {
                Some(Value::Array(parts)) => text_of_parts(parts, false, "\n"),
                Some(Value::String(s)) => s.clone(),
                _ => String::new(),
            };
            if text.trim().is_empty() {
                Vec::new()
            } else {
                vec![LineRow::new("thinking", text, ts)]
            }
        }
        "assistant" => {
            let mut out = Vec::new();
            let text = content_text(value.get("content"));
            if !text.trim().is_empty() {
                let usage = value.get("usage").cloned();
                out.push(LineRow {
                    usage,
                    ..LineRow::new("assistant", text, ts.clone())
                });
            }
            if let Some(calls) = value.get("tool_calls").and_then(Value::as_array) {
                for call in calls {
                    let function = call.get("function");
                    let name = function
                        .and_then(|f| f.get("name"))
                        .or_else(|| call.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string();
                    let args = function
                        .and_then(|f| f.get("arguments"))
                        .or_else(|| call.get("arguments"))
                        .or_else(|| call.get("input"));
                    out.push(LineRow {
                        path: args.and_then(crate::engine::tool_path_arg),
                        args: args.and_then(crate::engine::parse_tool_args_value),
                        todos: args.and_then(crate::engine::parse_todo_args),
                        ..LineRow::new("tool", name, ts.clone())
                    });
                }
            }
            out
        }
        _ => Vec::new(),
    }
}

// ==================== Qoder ====================

/// Qoder jsonl records are Claude-shaped (`type`, `message.content`, `uuid`,
/// `timestamp`) with three extras (reference engine/qoder_history.rs):
/// `isSidechain` marks subagent transcripts, `toolUseResult` envelopes carry
/// tool output, and the typed prompt is mirrored under `humanInput.text`.
fn qoder_is_sidechain(value: &Value) -> bool {
    match value.get("isSidechain") {
        Some(Value::Bool(true)) => true,
        Some(Value::String(s)) => s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

/// A `toolUseResult` user record: forward its tool_result blocks, keeping the
/// call id so results pair with their call instead of arrival order.
fn qoder_tool_result_rows(value: &Value, ts: &Option<String>) -> LineRows {
    let mut out = Vec::new();
    let Some(blocks) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return out;
    };
    for block in blocks {
        if block.get("type").and_then(Value::as_str) != Some("tool_result") {
            continue;
        }
        out.push(LineRow {
            tool_call_id: block
                .get("tool_use_id")
                .or_else(|| block.get("toolUseId"))
                .and_then(Value::as_str)
                .map(str::to_string),
            result: block.get("content").cloned(),
            ..LineRow::new("__tool_result__", String::new(), ts.clone())
        });
    }
    out
}

fn extract_qoder_line(value: &Value, images: ImageMode) -> LineRows {
    if qoder_is_sidechain(value) {
        return Vec::new();
    }
    let line_type = type_str(value);
    if line_type != "user" && line_type != "assistant" {
        return Vec::new();
    }
    let ts = ts_string(value, &["timestamp"]);
    if line_type == "user" && value.get("toolUseResult").is_some() {
        return qoder_tool_result_rows(value, &ts);
    }
    let mut rows = extract_claude_line(value, images);
    if line_type == "assistant" {
        // Stamp tool rows with their tool_use block ids (emitted in block
        // order by the claude walk) so qoder's id-keyed toolUseResult
        // envelopes pair by id, not arrival order.
        let mut call_ids = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
            .filter_map(|b| b.get("id").and_then(Value::as_str));
        for row in rows.iter_mut() {
            if row.role == "tool" {
                row.tool_call_id = call_ids.next().map(str::to_string);
            }
        }
    }
    if !rows.is_empty() || line_type != "user" {
        return rows;
    }
    // The typed prompt also lives under humanInput.text; use it when the
    // claude-shaped message.content carried nothing.
    match value
        .get("humanInput")
        .and_then(|input| input.get("text"))
        .and_then(Value::as_str)
        .map(str::trim)
    {
        Some(text) if !text.is_empty() => vec![LineRow::new("user", text.to_string(), ts)],
        _ => Vec::new(),
    }
}

// ==================== OpenCode ====================

/// OpenCode stores one session as a JSON tree under `<data>/storage/`:
/// `session/<projectId>/<sessionId>.json` (metadata: id, directory, title,
/// time), `message/<sessionId>/<messageId>.json` (role, time, model), and
/// `part/<messageId>/<partId>.json` (text / reasoning / tool / step-finish).
/// Shapes verified against ~/.local/share/opencode/storage (opencode 1.1.16)
/// and the reference delete path (commands_opencode_catalog.rs removes
/// `storage/<parent>/<id>[.json]`). The db row points at the session
/// metadata file; everything else hangs off it.
fn opencode_storage_root(session_meta: &Path) -> Option<PathBuf> {
    let project_dir = session_meta.parent()?;
    let session_dir = project_dir.parent()?;
    if session_dir.file_name()?.to_str()? != "session" {
        return None;
    }
    Some(session_dir.parent()?.to_path_buf())
}

// Tree-walk budgets: a real session is tens of messages; the caps keep a
// corrupt/huge tree from turning one sidebar refresh into a disk crawl.
const MAX_OPENCODE_MESSAGES: usize = 4096;
const MAX_OPENCODE_PARTS_PER_MESSAGE: usize = 512;
/// Scan-mode cap on one part file — tool outputs run to MB and the scanner
/// only keeps title/preview/count.
const SCAN_OPENCODE_PART_BYTES: u64 = 256 * 1024;

/// Read one small JSON file; `byte_cap` bounds the read (truncated JSON
/// fails to parse and is skipped).
fn read_json_file(path: &Path, byte_cap: Option<u64>) -> Option<Value> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut buf = String::new();
    match byte_cap {
        Some(cap) => {
            file.take(cap).read_to_string(&mut buf).ok()?;
        }
        None => {
            file.read_to_string(&mut buf).ok()?;
        }
    }
    serde_json::from_str(&buf).ok()
}

/// Sorted `.json` entries of `dir`, capped.
fn opencode_list_json(dir: &Path, cap: usize) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                paths.push(path);
            }
        }
    }
    // msg_/prt_ ids are timestamp-prefixed, so name order is chronological.
    paths.sort();
    paths.truncate(cap);
    paths
}

/// Epoch-millis field as the string form `LineRow.ts` carries.
fn opencode_ts(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|k| value.get(k).and_then(Value::as_i64))
        .map(|ms| ms.to_string())
}

/// `step-finish` tokens → the claude-shaped usage object the context bar reads.
fn opencode_usage(part: &Value) -> Option<Value> {
    let tokens = part.get("tokens")?;
    let input = tokens.get("input").and_then(Value::as_i64).unwrap_or(0);
    let output = tokens.get("output").and_then(Value::as_i64).unwrap_or(0);
    let reasoning = tokens.get("reasoning").and_then(Value::as_i64).unwrap_or(0);
    let cache_read = tokens
        .get("cache")
        .and_then(|c| c.get("read"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_write = tokens
        .get("cache")
        .and_then(|c| c.get("write"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    Some(serde_json::json!({
        "input_tokens": input,
        "output_tokens": output,
        "cache_read_input_tokens": cache_read,
        "cache_creation_input_tokens": cache_write,
        "total_tokens": input + output + reasoning,
    }))
}

/// Walk the storage tree behind one session-metadata file into extracted
/// rows. `part_byte_cap` bounds per-part reads (scan mode); None reads fully
/// (reader mode).
fn opencode_rows(
    session_meta: &Path,
    images: ImageMode,
    part_byte_cap: Option<u64>,
    accepted_internal_frames: &HashSet<String>,
) -> LineRows {
    let mut out = Vec::new();
    let Some(storage) = opencode_storage_root(session_meta) else {
        return out;
    };
    let Some(session_id) = session_meta.file_stem().and_then(|s| s.to_str()) else {
        return out;
    };
    let message_dir = storage.join("message").join(session_id);
    // Sort by time.created (name order only works while ids stay
    // timestamp-prefixed); stable fallback is the filename.
    let mut messages: Vec<(i64, PathBuf, Value)> =
        opencode_list_json(&message_dir, MAX_OPENCODE_MESSAGES)
            .into_iter()
            .filter_map(|path| {
                let value = read_json_file(&path, None)?;
                let created = value
                    .get("time")
                    .and_then(|t| t.get("created"))
                    .and_then(Value::as_i64)
                    .unwrap_or(i64::MAX);
                Some((created, path, value))
            })
            .collect();
    messages.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    for (_, _, message) in messages {
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        if role != "user" && role != "assistant" {
            continue;
        }
        let Some(message_id) = message.get("id").and_then(Value::as_str) else {
            continue;
        };
        let time = message.get("time");
        let created_ms = time.and_then(|t| t.get("created")).and_then(Value::as_i64);
        let created = created_ms.map(|ms| ms.to_string());
        let duration_ms = time
            .and_then(|t| t.get("completed"))
            .and_then(Value::as_i64)
            .zip(created_ms)
            .and_then(|(completed, created)| (completed >= created).then_some(completed - created));
        let model = message
            .get("model")
            .and_then(|m| m.get("modelID"))
            .and_then(Value::as_str)
            .map(str::to_string);
        // Parts carry the content. Text accumulates per message so several
        // text parts land as one row; reasoning/tool parts flush it first,
        // keeping calls where they happened.
        let mut text = String::new();
        let mut collected_images: Vec<String> = Vec::new();
        let mut message_rows: Vec<LineRow> = Vec::new();
        // step-finish usage lands after the message's own text row exists;
        // buffered here and attached below (a mid-loop __usage__ row would
        // fold onto the *previous* message's assistant row).
        let mut pending_usage: Option<Value> = None;
        let part_dir = storage.join("part").join(message_id);
        for part_path in opencode_list_json(&part_dir, MAX_OPENCODE_PARTS_PER_MESSAGE) {
            let Some(part) = read_json_file(&part_path, part_byte_cap) else {
                continue;
            };
            let part_ts = part
                .get("time")
                .and_then(|t| opencode_ts(t, &["start"]))
                .or_else(|| created.clone());
            match part.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(t) = part.get("text").and_then(Value::as_str) {
                        text.push_str(t);
                    }
                }
                Some("reasoning") => {
                    pi_flush_text(&mut message_rows, &mut text, &part_ts, role);
                    if let Some(t) = part.get("text").and_then(Value::as_str) {
                        if !t.trim().is_empty() {
                            message_rows.push(LineRow::new("thinking", t.to_string(), part_ts));
                        }
                    }
                }
                Some("tool") => {
                    pi_flush_text(&mut message_rows, &mut text, &part_ts, role);
                    let name = part
                        .get("tool")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string();
                    let state = part.get("state");
                    let input = state.and_then(|s| s.get("input"));
                    let output = state
                        .and_then(|s| s.get("output"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    message_rows.push(LineRow {
                        path: input.and_then(crate::engine::tool_path_arg),
                        args: input.and_then(crate::engine::parse_tool_args_value),
                        todos: input.and_then(crate::engine::parse_todo_args),
                        tool_call_id: part
                            .get("callID")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        result: if output.trim().is_empty() {
                            None
                        } else {
                            Some(Value::String(output.to_string()))
                        },
                        ..LineRow::new("tool", name, part_ts)
                    });
                }
                Some("step-finish") => {
                    if let Some(usage) = opencode_usage(&part) {
                        pending_usage = Some(usage);
                    }
                }
                // [INFERENCE] shape from upstream opencode: image attachments
                // arrive as `{type:"file", mime, url}` with a data URL.
                Some("file") if images == ImageMode::Collect => {
                    let is_image = part
                        .get("mime")
                        .and_then(Value::as_str)
                        .is_some_and(|mime| mime.starts_with("image/"));
                    if is_image {
                        if let Some(url) = part.get("url").and_then(Value::as_str) {
                            collected_images.push(url.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
        if !text.trim().is_empty() || !collected_images.is_empty() {
            message_rows.push(LineRow {
                model,
                duration_ms,
                images: collected_images,
                ..LineRow::new(role, text, created)
            });
        }
        if let Some(usage) = pending_usage {
            // Attach to this message's own last content row (the flushed text
            // when present); fall back to the shared __usage__ fold.
            match message_rows
                .iter_mut()
                .rev()
                .find(|row| row.role == role || row.role == "thinking")
            {
                Some(row) => row.usage = Some(usage),
                None => message_rows.push(LineRow {
                    usage: Some(usage),
                    ..LineRow::new("__usage__", String::new(), None)
                }),
            }
        }
        for row in message_rows {
            let Some(row) = normalize_extracted_row(row, accepted_internal_frames) else {
                continue;
            };
            out.push(row);
        }
    }
    out
}

fn parse_opencode_session(
    path: &Path,
    accepted_internal_frames: &HashSet<String>,
) -> ParsedSession {
    fold_rows(opencode_rows(
        path,
        ImageMode::Collect,
        None,
        accepted_internal_frames,
    ))
}

fn scan_opencode_summary(
    path: &Path,
    accepted_internal_frames: &HashSet<String>,
) -> ScanSummary {
    let mut acc = ScanAcc::default();
    for row in opencode_rows(
        path,
        ImageMode::SkipDataUrls,
        Some(SCAN_OPENCODE_PART_BYTES),
        accepted_internal_frames,
    ) {
        acc.accept(row);
    }
    acc.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_hides_internal_prompt_contributions_from_user_history() {
        let row = LineRow::new(
            "user",
            "visible request\n\n[CCGUI internal request-tail]\nsecret handoff\n\n[CCGUI internal request-tail]\nsemantic protocol".into(),
            None,
        );

        let normalized = normalize_extracted_row(row, &HashSet::new()).expect("visible user row");
        assert_eq!(normalized.text, "visible request");
    }

    #[test]
    fn normalization_hides_only_recorded_internal_frames_from_assistant_history() {
        let accepted = "<CCGUI_INTERNAL_n-1>{\"ok\":true}</CCGUI_INTERNAL_n-1>";
        let unrecorded = "<CCGUI_INTERNAL_n-2>{\"ok\":true}</CCGUI_INTERNAL_n-2>";
        let row = LineRow::new(
            "assistant",
            format!("visible {accepted} keep {unrecorded}"),
            None,
        );
        let accepted_frames = HashSet::from([internal_frame_hash(accepted)]);

        assert_eq!(
            normalize_extracted_row(row, &accepted_frames)
                .expect("visible assistant row")
                .text,
            format!("visible  keep {unrecorded}")
        );

        let malformed = LineRow::new(
            "assistant",
            "keep <CCGUI_INTERNAL_n-1>{bad}</CCGUI_INTERNAL_n-1>".into(),
            None,
        );
        assert_eq!(
            normalize_extracted_row(malformed, &accepted_frames)
                .expect("unrecorded malformed frame remains visible")
                .text,
            "keep <CCGUI_INTERNAL_n-1>{bad}</CCGUI_INTERNAL_n-1>"
        );
    }

    /// The overwhelmingly common case: nothing recorded. The frame filter must
    /// then be invisible — an assistant row keeps its own bytes, spacing
    /// included, and is never dropped for looking empty. Both are observable
    /// as sidebar message counts and rendered text, and both regressed when
    /// the filter trimmed and dropped rows unconditionally.
    #[test]
    fn assistant_rows_are_untouched_when_no_frame_identity_is_recorded() {
        let padded = LineRow::new("assistant", "  spaced reply\n".into(), None);
        assert_eq!(
            normalize_extracted_row(padded, &HashSet::new())
                .expect("assistant row survives")
                .text,
            "  spaced reply\n"
        );

        // A frame present but unrecorded is still ordinary text: keeping it is
        // what leaves the row non-empty.
        let only_frame = LineRow::new(
            "assistant",
            "<CCGUI_INTERNAL_n-1>{\"ok\":true}</CCGUI_INTERNAL_n-1>".into(),
            None,
        );
        assert_eq!(
            normalize_extracted_row(only_frame, &HashSet::new())
                .expect("unrecorded frame keeps the row")
                .text,
            "<CCGUI_INTERNAL_n-1>{\"ok\":true}</CCGUI_INTERNAL_n-1>"
        );
    }

    #[test]
    fn pi_family_line_extracts_thinking_in_order() {
        let line: Value = serde_json::json!({
            "type": "message",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "first thought", "thinkingSignature": "sig"},
                    {"type": "text", "text": "answer one"},
                    {"type": "toolCall", "name": "read", "intent": "Listing root", "arguments": {"path": "src/main.rs"}},
                    {"type": "text", "text": "answer two"}
                ]
            }
        });
        let rows = extract_pi_family_line(&line, ImageMode::Collect);
        let roles: Vec<&str> = rows.iter().map(|r| r.role.as_str()).collect();
        assert_eq!(roles, ["thinking", "assistant", "tool", "assistant"]);
        assert_eq!(rows[0].text, "first thought");
        assert_eq!(rows[1].text, "answer one");
        assert_eq!(rows[2].text, "read · Listing root");
        assert_eq!(rows[2].path.as_deref(), Some("src/main.rs"));
        assert_eq!(
            rows[2].args,
            Some(serde_json::json!({"path": "src/main.rs"}))
        );
        assert_eq!(rows[3].text, "answer two");
        assert_eq!(rows[3].path, None);
    }

    /// Results pair with their call by id, not by arrival order: parallel tool
    /// calls finish in whatever order they finish, and the fallback (attach to
    /// the latest row still without a result) mislabels them when they do.
    /// The `details` payload is what the subagent panel reads for job status.
    #[test]
    fn pi_tool_results_pair_with_their_call_ids() {
        let call = |id: &str| {
            serde_json::json!({
                "type": "message",
                "message": {"role": "assistant", "content": [{
                    "type": "toolCall",
                    "id": id,
                    "name": "hub",
                    "intent": "Waiting for workers",
                    "arguments": {"op": "wait"}
                }]}
            })
        };
        let result = |id: &str, text: &str, status: &str| {
            serde_json::json!({
                "type": "message",
                "message": {
                    "role": "toolResult",
                    "toolCallId": id,
                    "content": [{"type": "text", "text": text}],
                    "details": {"jobs": [{"id": id, "status": status}]}
                }
            })
        };
        let lines = vec![
            call("call_a"),
            call("call_b"),
            // Out of order: `a` answers first even though `b` was called later.
            result("call_a", "## Still Running (1)", "running"),
            // Replayed or unmatched results must not consume another call.
            result("call_a", "duplicate", "failed"),
            result("unknown_call", "unmatched", "failed"),
            result("call_b", "done", "completed"),
        ];
        let input = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let extractor: LineExtractor<'_> =
            Box::new(|value: &Value| extract_pi_family_line(value, ImageMode::Collect));
        let parsed = collect_session(std::io::Cursor::new(input), &extractor, &HashSet::new());

        let (first, second) = (&parsed.messages[0], &parsed.messages[1]);
        assert_eq!(
            first.result.as_ref().unwrap()["details"]["jobs"][0]["status"],
            "running"
        );
        assert_eq!(
            second.result.as_ref().unwrap()["details"]["jobs"][0]["status"],
            "completed"
        );
    }

    #[test]
    fn pi_tool_results_populate_todos_from_details_phases() {
        let call = serde_json::json!({
            "type": "message",
            "message": {"role": "assistant", "content": [{
                "type": "toolCall",
                "id": "todo_call_1",
                "name": "todo",
                "intent": "Initialize todos",
                "arguments": {"op": "init", "list": [{"phase": "P1", "items": ["Task 1"]}]}
            }]}
        });
        let result = serde_json::json!({
            "type": "message",
            "message": {
                "role": "toolResult",
                "toolCallId": "todo_call_1",
                "content": [{"type": "text", "text": "Done"}],
                "details": {
                    "phases": [
                        {
                            "name": "P1",
                            "tasks": [{"content": "Task 1", "status": "completed"}]
                        }
                    ]
                }
            }
        });
        let input = format!("{}\n{}", call, result);
        let extractor: LineExtractor<'_> =
            Box::new(|value: &Value| extract_pi_family_line(value, ImageMode::Collect));
        let parsed = collect_session(std::io::Cursor::new(input), &extractor, &HashSet::new());
        assert_eq!(parsed.messages.len(), 1);
        let todos = parsed.messages[0].todos.as_ref().expect("todos must be populated");
        assert_eq!(todos.items.len(), 1);
        assert_eq!(todos.items[0].content, "Task 1");
        assert_eq!(todos.items[0].status, "complete");
    }

    #[test]
    fn claude_line_extracts_thinking_and_tool_in_order() {
        let line: Value = serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "ponder", "signature": "sig"},
                    {"type": "text", "text": "reply"},
                    {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}
                ]
            }
        });
        let rows = extract_claude_line(&line, ImageMode::Collect);
        let roles: Vec<&str> = rows.iter().map(|r| r.role.as_str()).collect();
        assert_eq!(roles, ["thinking", "assistant", "tool"]);
        assert_eq!(rows[0].text, "ponder");
        assert_eq!(rows[1].text, "reply");
        assert_eq!(rows[2].text, "Bash");
        assert_eq!(rows[2].args, Some(serde_json::json!({"command": "ls"})));
    }

    #[test]
    fn pi_toolcall_row_carries_todo_patch() {
        let line: Value = serde_json::json!({
            "type": "message",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "toolCall", "name": "todo", "arguments": {"op": "done", "task": "scan files"}}
                ]
            }
        });
        let rows = extract_pi_family_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "tool");
        let todos = rows[0].todos.as_ref().expect("todos payload");
        assert!(!todos.replace);
        assert_eq!(todos.items.len(), 1);
        assert_eq!(todos.items[0].content, "scan files");
        assert_eq!(todos.items[0].status, "complete");
    }

    #[test]
    fn claude_tool_use_row_carries_todowrite_snapshot() {
        let line: Value = serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "name": "TodoWrite", "input": {"todos": [
                        {"content": "scan files", "status": "completed"},
                        {"content": "write code", "status": "in_progress"},
                        {"content": "run tests", "status": "pending"},
                        {"content": "deploy", "status": "blocked"}
                    ]}}
                ]
            }
        });
        let rows = extract_claude_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "tool");
        let todos = rows[0].todos.as_ref().expect("todos payload");
        assert!(todos.replace);
        let statuses: Vec<&str> = todos.items.iter().map(|i| i.status.as_str()).collect();
        assert_eq!(statuses, ["complete", "active", "pending", "blocked"]);
        assert_eq!(todos.items[1].content, "write code");
    }

    #[test]
    fn claude_line_drops_is_meta_command_expansion() {
        let expansion: Value = serde_json::json!({
            "type": "user",
            "isMeta": true,
            "timestamp": "2026-09-08T10:00:00.000Z",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": "# 代码审查\n对未提交更改进行全面的安全和质量审查"}]
            }
        });
        assert!(extract_claude_line(&expansion, ImageMode::Collect).is_empty());
    }

    #[test]
    fn codex_reasoning_item_becomes_thinking_row() {
        let line: Value = serde_json::json!({
            "type": "response_item",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "payload": {
                "type": "reasoning",
                "summary": [
                    {"type": "summary_text", "text": "plan step one"},
                    {"type": "summary_text", "text": "plan step two"}
                ]
            }
        });
        let rows = extract_codex_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "thinking");
        assert_eq!(rows[0].text, "plan step one\nplan step two");

        // Encrypted reasoning carries no visible summary -> no row.
        let encrypted: Value = serde_json::json!({
            "type": "response_item",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "payload": {"type": "reasoning", "summary": [], "content": [{"type": "reasoning_text", "text": "hidden"}]}
        });
        assert!(extract_codex_line(&encrypted, ImageMode::Collect).is_empty());
    }
    #[test]
    fn kimi_prompt_row_recovers_image_paths() {
        let prompt = crate::engine::images::kimi_prompt_with_images(
            "what is this",
            &["/tmp/a.png".to_string(), "b.jpg".to_string()],
            Path::new("/tmp"),
        );
        let line: Value = serde_json::json!({
            "type": "turn.prompt",
            "time": 1757493136000i64,
            "input": prompt,
        });
        let rows = extract_kimi_line(&line);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "user");
        assert_eq!(rows[0].text, "what is this");
        // `PathBuf::join` normalizes "/"-rooted refs per platform ("/tmp/a.png"
        // stays verbatim, "b.jpg" joins with the platform separator), so
        // compare Path equality instead of string equality.
        let got: Vec<std::path::PathBuf> = rows[0]
            .images
            .iter()
            .map(std::path::PathBuf::from)
            .collect();
        assert_eq!(
            got,
            vec![
                std::path::PathBuf::from("/tmp/a.png"),
                std::path::Path::new("/tmp").join("b.jpg"),
            ]
        );
    }

    #[test]
    fn claude_user_image_block_becomes_data_url() {
        let line: Value = serde_json::json!({
            "type": "user",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "message": {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "aGk="}},
                    {"type": "text", "text": "这是什么?"}
                ]
            }
        });
        let rows = extract_claude_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "这是什么?");
        assert_eq!(rows[0].images, ["data:image/png;base64,aGk="]);

        // Image-only message still yields a row.
        let image_only: Value = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "eGk="}}
                ]
            }
        });
        let rows = extract_claude_line(&image_only, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].images, ["data:image/jpeg;base64,eGk="]);
    }

    #[test]
    fn pi_user_image_part_becomes_data_url() {
        let line: Value = serde_json::json!({
            "type": "message",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "message": {
                "role": "user",
                "content": [
                    {"type": "image", "data": "aGk=", "mimeType": "image/webp"},
                    {"type": "text", "text": "look"}
                ]
            }
        });
        let rows = extract_pi_family_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "look");
        assert_eq!(rows[0].images, ["data:image/webp;base64,aGk="]);
    }

    #[test]
    fn codex_input_image_part_is_collected() {
        let line: Value = serde_json::json!({
            "type": "response_item",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_image", "image_url": "data:image/png;base64,aGk="},
                    {"type": "input_text", "text": "see this"}
                ]
            }
        });
        let rows = extract_codex_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "see this");
        assert_eq!(rows[0].images, ["data:image/png;base64,aGk="]);
    }

    #[test]
    fn codex_token_count_uses_last_turn_not_session_total() {
        let line: Value = serde_json::json!({
            "type": "event_msg",
            "timestamp": "2026-09-10T04:54:08.090Z",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 2741100,
                        "output_tokens": 11900,
                        "total_tokens": 2753000
                    },
                    "last_token_usage": {
                        "input_tokens": 34660,
                        "cached_input_tokens": 27520,
                        "output_tokens": 85,
                        "total_tokens": 34745
                    },
                    "model_context_window": 475000
                }
            }
        });
        let rows = extract_codex_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "__usage__");
        assert_eq!(rows[0].usage.as_ref().unwrap()["input_tokens"], 34660);
        assert_eq!(rows[0].usage.as_ref().unwrap()["total_tokens"], 34745);
        assert_eq!(
            rows[0].usage.as_ref().unwrap()["model_context_window"],
            475000
        );
    }

    #[test]
    fn grok_skips_synthetic_reason_and_leaves_envelope_to_normalize() {
        let reminder: Value = serde_json::json!({
            "type": "user",
            "synthetic_reason": "system_reminder",
            "content": [{"type": "text", "text": "<system-reminder>skills</system-reminder>"}]
        });
        assert!(extract_grok_line(&reminder).is_empty());

        let context: Value = serde_json::json!({
            "type": "user",
            "content": [{"type": "text", "text": "<user_info>\nOS Version: macos\n</user_info>"}]
        });
        let context_rows = extract_grok_line(&context);
        assert_eq!(context_rows.len(), 1);
        assert!(normalize_extracted_row(context_rows.into_iter().next().unwrap(), &HashSet::new()).is_none());

        let query: Value = serde_json::json!({
            "type": "user",
            "prompt_index": 0,
            "content": [{
                "type": "text",
                "text": "<image_files>\n1. /tmp/a.png\n</image_files>\n\n<user_query>Grok CLI 的历史记录怎么没出现？</user_query>"
            }]
        });
        let rows = extract_grok_line(&query);
        assert_eq!(rows.len(), 1);
        let normalized = normalize_extracted_row(rows.into_iter().next().unwrap(), &HashSet::new()).unwrap();
        assert_eq!(normalized.role, "user");
        assert_eq!(normalized.text, "Grok CLI 的历史记录怎么没出现？");

        let mentioned = LineRow::new(
            "user",
            "please look at <user_info> in grok logs, not the typed <user_query>".into(),
            None,
        );
        let kept = normalize_extracted_row(mentioned, &HashSet::new()).unwrap();
        assert_eq!(
            kept.text,
            "please look at <user_info> in grok logs, not the typed <user_query>"
        );
    }

    #[test]
    fn grok_reasoning_summary_becomes_thinking() {
        let line: Value = serde_json::json!({
            "type": "reasoning",
            "summary": [
                {"type": "summary_text", "text": "first thought"},
                {"type": "summary_text", "text": "second thought"}
            ]
        });
        let rows = extract_grok_line(&line);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "thinking");
        assert_eq!(rows[0].text, "first thought\nsecond thought");
    }

    #[test]
    fn codex_token_count_prefers_last_usage_and_attaches_context_window() {
        let line: Value = serde_json::json!({
            "type": "event_msg",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 200000,
                        "output_tokens": 5000,
                        "total_tokens": 205000
                    },
                    "last_token_usage": {
                        "input_tokens": 30000,
                        "cached_input_tokens": 15000,
                        "output_tokens": 500,
                        "total_tokens": 30500
                    },
                    "model_context_window": 1000000
                }
            }
        });
        let rows = extract_codex_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "__usage__");
        let usage = rows[0].usage.as_ref().expect("usage object");
        assert_eq!(
            usage.get("input_tokens").and_then(Value::as_i64),
            Some(30000)
        );
        assert_eq!(
            usage.get("cached_input_tokens").and_then(Value::as_i64),
            Some(15000)
        );
        assert_eq!(
            usage.get("total_tokens").and_then(Value::as_i64),
            Some(30500)
        );
        assert_eq!(
            usage.get("model_context_window").and_then(Value::as_i64),
            Some(1000000)
        );
    }

    #[test]
    fn claude_compact_boundary_extracts_post_tokens_into_usage() {
        let line: Value = serde_json::json!({
            "type": "system",
            "subtype": "compact_boundary",
            "timestamp": "2026-09-10T05:55:55.956Z",
            "compactMetadata": {
                "preTokens": 30190,
                "postTokens": 8038,
                "durationMs": 4207
            }
        });
        let rows = extract_claude_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "__usage__");
        let usage = rows[0].usage.as_ref().expect("usage object");
        assert_eq!(
            usage.get("input_tokens").and_then(Value::as_i64),
            Some(8038)
        );
        assert_eq!(
            usage.get("total_tokens").and_then(Value::as_i64),
            Some(8038)
        );
    }

    #[test]
    fn qoder_line_skips_sidechains_and_reads_user_prompt() {
        let sidechain = serde_json::json!({
            "type": "user", "uuid": "hidden", "isSidechain": true,
            "humanInput": {"text": "hidden prompt"},
            "message": {"content": "hidden prompt"}
        });
        assert!(extract_qoder_line(&sidechain, ImageMode::Collect).is_empty());
        let sidechain_str = serde_json::json!({
            "type": "assistant", "isSidechain": "true",
            "message": {"content": "hidden answer"}
        });
        assert!(extract_qoder_line(&sidechain_str, ImageMode::Collect).is_empty());

        let user = serde_json::json!({
            "type": "user", "uuid": "user-1", "timestamp": "2026-08-22T00:00:00Z",
            "humanInput": {"text": "first prompt"},
            "message": {"content": "first prompt"}
        });
        let rows = extract_qoder_line(&user, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "user");
        assert_eq!(rows[0].text, "first prompt");
    }

    #[test]
    fn qoder_human_input_is_user_text_fallback() {
        let line = serde_json::json!({
            "type": "user", "uuid": "u1", "timestamp": "2026-08-22T00:00:00Z",
            "humanInput": {"text": "typed body"}
        });
        let rows = extract_qoder_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "user");
        assert_eq!(rows[0].text, "typed body");
    }

    /// qoder's toolUseResult envelope pairs with its tool_use call by id —
    /// parallel calls finishing out of order must not cross-label.
    #[test]
    fn qoder_tool_result_pairs_with_call_id() {
        let call = |id: &str| {
            serde_json::json!({
                "type": "assistant", "uuid": id, "timestamp": "2026-08-22T00:00:01Z",
                "message": {"content": [
                    {"type": "tool_use", "id": id, "name": "Read", "input": {"path": "README.md"}}
                ]}
            })
        };
        let result = |id: &str, body: &str| {
            serde_json::json!({
                "type": "user", "timestamp": "2026-08-22T00:00:02Z",
                "toolUseResult": {"ok": true},
                "message": {"content": [
                    {"type": "tool_result", "tool_use_id": id, "content": body}
                ]}
            })
        };
        let lines = vec![
            call("tool-a"),
            call("tool-b"),
            result("tool-b", "body b"),
            result("tool-a", "body a"),
        ];
        let input = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let extractor: LineExtractor<'_> =
            Box::new(|value: &Value| extract_qoder_line(value, ImageMode::Collect));
        let parsed = collect_session(std::io::Cursor::new(input), &extractor, &HashSet::new());
        assert_eq!(parsed.messages.len(), 2);
        assert_eq!(parsed.messages[0].result, Some(serde_json::json!("body a")));
        assert_eq!(parsed.messages[1].result, Some(serde_json::json!("body b")));
    }

    /// OpenCode fixture tree: storage/session + message + part jsons, shaped
    /// like opencode 1.1.16 on disk.
    fn opencode_fixture() -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("ccgui-extract-{}", uuid::Uuid::new_v4()));
        let storage = dir.join("storage");
        let meta = storage.join("session").join("proj1").join("ses_x.json");
        std::fs::create_dir_all(meta.parent().unwrap()).unwrap();
        std::fs::write(
            &meta,
            serde_json::json!({
                "id": "ses_x", "projectID": "proj1", "directory": "/ws",
                "title": "t", "time": {"created": 1_700_000_000_000i64, "updated": 1_700_000_004_000i64}
            })
            .to_string(),
        )
        .unwrap();
        let write = |path: PathBuf, value: Value| {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, value.to_string()).unwrap();
        };
        write(
            storage.join("message/ses_x/msg_1000.json"),
            serde_json::json!({"id": "msg_1000", "sessionID": "ses_x", "role": "user",
                "time": {"created": 1_700_000_000_000i64}}),
        );
        write(
            storage.join("part/msg_1000/prt_01.json"),
            serde_json::json!({"id": "prt_01", "sessionID": "ses_x", "messageID": "msg_1000",
                "type": "text", "text": "hello opencode"}),
        );
        write(
            storage.join("message/ses_x/msg_2000.json"),
            serde_json::json!({"id": "msg_2000", "sessionID": "ses_x", "role": "assistant",
                "time": {"created": 1_700_000_001_000i64, "completed": 1_700_000_002_000i64},
                "model": {"providerID": "anthropic", "modelID": "claude-sonnet-4-5"}}),
        );
        write(
            storage.join("part/msg_2000/prt_01.json"),
            serde_json::json!({"id": "prt_01", "sessionID": "ses_x", "messageID": "msg_2000",
                "type": "reasoning", "text": "ponder"}),
        );
        write(
            storage.join("part/msg_2000/prt_02.json"),
            serde_json::json!({"id": "prt_02", "sessionID": "ses_x", "messageID": "msg_2000",
                "type": "tool", "callID": "c1", "tool": "read",
                "state": {"status": "completed", "input": {"path": "src/main.rs"}, "output": "file body"}}),
        );
        write(
            storage.join("part/msg_2000/prt_03.json"),
            serde_json::json!({"id": "prt_03", "sessionID": "ses_x", "messageID": "msg_2000",
                "type": "text", "text": "done", "time": {"start": 1_700_000_001_900i64}}),
        );
        write(
            storage.join("part/msg_2000/prt_04.json"),
            serde_json::json!({"id": "prt_04", "sessionID": "ses_x", "messageID": "msg_2000",
                "type": "step-finish",
                "tokens": {"input": 10, "output": 5, "reasoning": 0, "cache": {"read": 1, "write": 2}}}),
        );
        (dir, meta)
    }

    #[test]
    fn opencode_parse_reads_storage_tree() {
        let (dir, meta) = opencode_fixture();
        let parsed = parse_session_file("opencode", &meta, &HashSet::new()).unwrap();
        let roles: Vec<&str> = parsed.messages.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, ["user", "thinking", "tool", "assistant"]);
        assert_eq!(parsed.messages[0].text, "hello opencode");
        assert_eq!(parsed.messages[2].text, "read");
        assert_eq!(parsed.messages[2].path.as_deref(), Some("src/main.rs"));
        assert_eq!(
            parsed.messages[2].result,
            Some(serde_json::json!("file body"))
        );
        let answer = &parsed.messages[3];
        assert_eq!(answer.text, "done");
        assert_eq!(answer.model.as_deref(), Some("claude-sonnet-4-5"));
        assert_eq!(answer.duration_ms, Some(1000));
        // step-finish tokens fold onto the last assistant message.
        let usage = answer.usage.as_ref().expect("usage folded");
        assert_eq!(usage.get("input_tokens").and_then(Value::as_i64), Some(10));
        assert_eq!(
            usage.get("cache_read_input_tokens").and_then(Value::as_i64),
            Some(1)
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn opencode_scan_summary_from_storage_tree() {
        let (dir, meta) = opencode_fixture();
        let summary = scan_summary_file("opencode", &meta, &HashSet::new()).unwrap();
        assert_eq!(summary.title, "hello opencode");
        assert_eq!(summary.preview, "done");
        assert_eq!(summary.first_ts, Some(1_700_000_000_000));
        assert_eq!(summary.last_ts, Some(1_700_000_001_000));
        assert_eq!(summary.message_count, 4);
        std::fs::remove_dir_all(&dir).ok();
    }
}
