//! Antigravity (`agy`) conversations are sqlite + protobuf, not NDJSON.
//!
//! User text is taken from `~/.gemini/antigravity-cli/history.jsonl` (the
//! CLI's own prompt log). Assistant / tool text is pulled out of
//! length-delimited UTF-8 strings in each `steps.step_payload` blob.

use super::{Message, ParsedSession, ScanSummary};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::Path;

/// `steps.step_type` values observed on agy 1.2.x.
const STEP_USER: i64 = 14;
const STEP_ASSISTANT: i64 = 15;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryLine {
    display: Option<String>,
    timestamp: Option<i64>,
    conversation_id: Option<String>,
}

struct UserTurn {
    text: String,
    ts_ms: Option<i64>,
}

pub(super) fn parse_agy_session(
    path: &Path,
    accepted_internal_frames: &HashSet<String>,
) -> ParsedSession {
    let id = conversation_id(path);
    let mut users = load_user_turns(id.as_deref());
    let mut user_iter = users.drain(..);
    let mut messages = Vec::new();
    let mut seq = 0i64;

    if let Some(steps) = load_steps(path) {
        for (step_type, payload) in steps {
            match step_type {
                STEP_USER => {
                    if let Some(turn) = user_iter.next() {
                        seq += 1;
                        messages.push(plain_message(seq, "user", turn.text, turn.ts_ms));
                    }
                }
                STEP_ASSISTANT => {
                    // Tool payloads live in the same sqlite blobs as replies;
                    // reconstructing them yields protobuf/JSON fragments
                    // ("ommandLine", "WaitMsBeforeAsync"). History only keeps
                    // the visible assistant reply.
                    let mut texts = proto_strings(&payload);
                    if !accepted_internal_frames.is_empty() {
                        for candidate in &mut texts {
                            if candidate.depth == 1 && candidate.field == 1 {
                                // Strip before the prose filter: the frame's JSON
                                // would otherwise discard the surrounding reply.
                                candidate.text = super::extract::strip_recorded_internal_frames(
                                    std::mem::take(&mut candidate.text),
                                    accepted_internal_frames,
                                );
                            }
                        }
                    }
                    if let Some(text) = pick_assistant(&texts) {
                        seq += 1;
                        messages.push(plain_message(seq, "assistant", text, None));
                    }
                }
                _ => {}
            }
        }
    }

    // Conversation db unreadable / older than the prompt log: still show users.
    for turn in user_iter {
        seq += 1;
        messages.push(plain_message(seq, "user", turn.text, turn.ts_ms));
    }

    ParsedSession { messages }
}

pub(super) fn scan_agy_summary(
    path: &Path,
    accepted_internal_frames: &HashSet<String>,
) -> ScanSummary {
    let parsed = parse_agy_session(path, accepted_internal_frames);
    let mut first_ts = None;
    let mut last_ts = None;
    let mut title = String::new();
    let mut preview = String::new();
    for msg in &parsed.messages {
        let ts = msg.ts.as_deref().and_then(super::parse_ts_ms_str);
        if first_ts.is_none() {
            first_ts = ts;
        }
        if ts.is_some() {
            last_ts = ts;
        }
        if title.is_empty() && msg.role == "user" && !msg.text.trim().is_empty() {
            title = msg.text.chars().take(80).collect();
        }
        if !msg.text.trim().is_empty() && (msg.role == "assistant" || msg.role == "user") {
            preview = msg.text.chars().take(160).collect();
        }
    }

    if title.is_empty() {
        if let Some((stored, stored_preview, _)) = summary_row(path) {
            title = stored;
            if preview.is_empty() {
                preview = stored_preview;
            }
        }
    }
    if title.trim().is_empty() {
        title = "Antigravity".to_string();
    }

    let message_count = parsed
        .messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .count() as i64;

    ScanSummary {
        title,
        preview,
        first_ts,
        last_ts,
        message_count,
    }
}

fn conversation_id(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn load_user_turns(conversation_id: Option<&str>) -> Vec<UserTurn> {
    let Some(id) = conversation_id else {
        return Vec::new();
    };
    let path = crate::engine::agy::agy_home().join("history.jsonl");
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in text.lines() {
        let Ok(row) = serde_json::from_str::<HistoryLine>(line) else {
            continue;
        };
        if row.conversation_id.as_deref() != Some(id) {
            continue;
        }
        let Some(display) = row
            .display
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
        else {
            continue;
        };
        out.push(UserTurn {
            text: display,
            ts_ms: row.timestamp,
        });
    }
    out
}

fn summary_row(path: &Path) -> Option<(String, String, i64)> {
    let id = conversation_id(path)?;
    let db = crate::engine::agy::agy_home().join("conversation_summaries.db");
    let conn =
        rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    conn.query_row(
        "SELECT title, preview, step_count FROM conversation_summaries WHERE conversation_id = ?1",
        rusqlite::params![id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        },
    )
    .ok()
}

fn load_steps(path: &Path) -> Option<Vec<(i64, Vec<u8>)>> {
    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    let mut stmt = conn
        .prepare("SELECT step_type, step_payload FROM steps ORDER BY idx")
        .ok()?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)))
        .ok()?;
    Some(rows.flatten().collect())
}

fn plain_message(seq: i64, role: &str, text: String, ts_ms: Option<i64>) -> Message {
    Message {
        seq,
        role: role.to_string(),
        text,
        ts: ts_ms.map(|n| n.to_string()),
        path: None,
        args: None,
        result: None,
        todos: None,
        usage: None,
        model: None,
        effort: None,
        duration_ms: None,
        images: Vec::new(),
    }
}

struct ProtoText {
    depth: u8,
    field: u64,
    text: String,
}

fn pick_assistant(texts: &[ProtoText]) -> Option<String> {
    // Visible reply is depth 1 / field 1 (field 8 is a copy).
    // Field 3 is hidden thinking ("The user wants…", "Investigating…").
    let primary: Vec<&str> = texts
        .iter()
        .filter(|t| t.depth == 1 && t.field == 1)
        .map(|t| t.text.as_str())
        .filter(|t| looks_like_assistant(t))
        .collect();
    longest_prose(&primary).map(|s| sanitize_assistant(&s))
}

fn longest_prose(texts: &[&str]) -> Option<String> {
    let mut best: Option<&str> = None;
    for text in texts {
        best = Some(match best {
            None => text,
            Some(prev) => {
                let t_cjk = has_cjk(text);
                let p_cjk = has_cjk(prev);
                if t_cjk && !p_cjk {
                    text
                } else if t_cjk == p_cjk && text.len() > prev.len() {
                    text
                } else {
                    prev
                }
            }
        });
    }
    best.map(str::to_string)
}

fn looks_like_assistant(text: &str) -> bool {
    let t = text.trim();
    if t.len() < 20 || t.starts_with('{') || t.starts_with("bot-") || t.starts_with("file://") {
        return false;
    }
    if looks_like_tool_fragment(t) || looks_like_status_ping(t) {
        return false;
    }
    if looks_like_uuid(t) || !is_clean_text(t) || !starts_like_prose(t) {
        return false;
    }
    has_cjk(t) || (t.contains(' ') && t.len() > 40)
}

fn looks_like_tool_fragment(text: &str) -> bool {
    const MARKERS: &[&str] = &[
        "CommandLine",
        "ommandLine",
        "toolAction",
        "toolSummary",
        "WaitMsBeforeAsync",
        "DirectoryPath",
        "user_information",
        "command(*)",
        "sessionID",
        "\":\"",
        "\",\"",
    ];
    MARKERS.iter().any(|m| text.contains(m)) || text.matches('|').count() >= 3
}

fn looks_like_status_ping(text: &str) -> bool {
    let t = text.trim();
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("waiting for") || lower.starts_with("i will wait") {
        return true;
    }
    t.starts_with("正在") && (t.contains("请稍候") || t.ends_with("...") || t.ends_with('…'))
}

/// WeCom webhook markdown (`<font color="info">`, `<@Name>`) is what agy
/// pastes back after a group push. History should show the words, not the tags.
fn sanitize_assistant(text: &str) -> String {
    normalize_wecom_mentions(&strip_named_tags(text, "font"))
}

fn strip_named_tags(text: &str, name: &str) -> String {
    let open = format!("<{name}");
    let close = format!("</{name}>");
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while !rest.is_empty() {
        if starts_ignore_ascii(rest, &open) {
            match rest.find('>') {
                Some(i) => rest = &rest[i + 1..],
                None => break,
            }
            continue;
        }
        if starts_ignore_ascii(rest, &close) {
            rest = &rest[close.len()..];
            continue;
        }
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    out
}

fn starts_ignore_ascii(text: &str, prefix: &str) -> bool {
    text.as_bytes()
        .get(..prefix.len())
        .is_some_and(|b| b.eq_ignore_ascii_case(prefix.as_bytes()))
}

fn normalize_wecom_mentions(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<@") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        if let Some(end) = after.find('>') {
            let name = after[..end].trim();
            if !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
            {
                out.push('@');
                out.push_str(name);
                rest = &after[end + 1..];
                continue;
            }
        }
        out.push_str("<@");
        rest = after;
    }
    out.push_str(rest);
    out
}

fn starts_like_prose(text: &str) -> bool {
    text.trim().chars().next().is_some_and(|c| {
        c.is_alphanumeric()
            || has_cjk_char(c)
            || matches!(c, '#' | '*' | '`' | '-' | '>' | '(' | '「' | '【')
    })
}

fn looks_like_uuid(text: &str) -> bool {
    let t = text.trim();
    t.len() == 36
        && t.as_bytes().get(8) == Some(&b'-')
        && t.bytes().filter(|b| *b == b'-').count() == 4
}

fn has_cjk(text: &str) -> bool {
    text.chars().any(has_cjk_char)
}

fn has_cjk_char(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c)
}

fn is_clean_text(text: &str) -> bool {
    text.chars()
        .all(|c| c == '\n' || c == '\r' || c == '\t' || !c.is_control())
}

fn proto_strings(buf: &[u8]) -> Vec<ProtoText> {
    let mut out = Vec::new();
    walk_proto(buf, 0, &mut out);
    out
}

fn walk_proto(buf: &[u8], depth: u8, out: &mut Vec<ProtoText>) {
    if depth > 8 {
        return;
    }
    let mut i = 0;
    while i < buf.len() {
        let Some((tag, i2)) = read_varint(buf, i) else {
            break;
        };
        let field = tag >> 3;
        match (tag & 7) as u32 {
            0 => match read_varint(buf, i2) {
                Some((_, n)) => i = n,
                None => break,
            },
            1 if i2 + 8 <= buf.len() => i = i2 + 8,
            5 if i2 + 4 <= buf.len() => i = i2 + 4,
            2 => {
                let Some((len, i3)) = read_varint(buf, i2) else {
                    break;
                };
                let end = i3.saturating_add(len as usize);
                if end > buf.len() {
                    i += 1;
                    continue;
                }
                let chunk = &buf[i3..end];
                if let Ok(s) = std::str::from_utf8(chunk) {
                    if is_clean_text(s) && !s.trim().is_empty() {
                        out.push(ProtoText {
                            depth,
                            field,
                            text: s.to_string(),
                        });
                    }
                }
                if chunk.len() > 8 {
                    walk_proto(chunk, depth + 1, out);
                }
                i = end;
            }
            _ => i += 1,
        }
    }
}

fn read_varint(buf: &[u8], mut i: usize) -> Option<(u64, usize)> {
    let mut x = 0u64;
    let mut shift = 0;
    while i < buf.len() {
        let b = buf[i];
        i += 1;
        x |= u64::from(b & 0x7f) << shift;
        if b < 0x80 {
            return Some((x, i));
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_string_field(field: u64, text: &str) -> Vec<u8> {
        let mut out = Vec::new();
        let tag = (field << 3) | 2;
        write_varint(&mut out, tag);
        write_varint(&mut out, text.len() as u64);
        out.extend_from_slice(text.as_bytes());
        out
    }

    fn write_varint(out: &mut Vec<u8>, mut value: u64) {
        loop {
            let mut b = (value & 0x7f) as u8;
            value >>= 7;
            if value != 0 {
                b |= 0x80;
            }
            out.push(b);
            if value == 0 {
                break;
            }
        }
    }

    #[test]
    fn proto_walk_finds_nested_utf8() {
        // field 20 { field 1 = "你好世界 assistant reply here" }
        let inner = encode_string_field(1, "你好世界 assistant reply here");
        let outer = {
            let mut out = Vec::new();
            write_varint(&mut out, (20 << 3) | 2);
            write_varint(&mut out, inner.len() as u64);
            out.extend(inner);
            out
        };
        let texts = proto_strings(&outer);
        assert!(
            texts.iter().any(|t| t.text.contains("你好世界")),
            "{:?}",
            texts.iter().map(|t| &t.text).collect::<Vec<_>>()
        );
        assert_eq!(
            pick_assistant(&texts).as_deref(),
            Some("你好世界 assistant reply here")
        );
    }

    fn proto(depth: u8, field: u64, text: &str) -> ProtoText {
        ProtoText {
            depth,
            field,
            text: text.to_string(),
        }
    }

    #[test]
    fn assistant_prefers_depth1_field1_and_cjk() {
        let texts = vec![
            proto(1, 3, "The user asked about storage plans in general terms."),
            proto(1, 1, "拥有 5TB 空间说明您使用的是高阶方案。"),
            proto(3, 1, r#"ommandLine":"for f in /tmp/feishu_*.json; do jq"#),
        ];
        assert_eq!(
            pick_assistant(&texts).as_deref(),
            Some("拥有 5TB 空间说明您使用的是高阶方案。")
        );
    }

    #[test]
    fn strips_wecom_font_and_mentions() {
        assert_eq!(
            sanitize_assistant("[<font color=\"info\">完成</font>] 九思 <@Yyming>"),
            "[完成] 九思 @Yyming"
        );
        assert_eq!(
            sanitize_assistant("<font color=\"warning\">逾期</font>"),
            "逾期"
        );
    }

    #[test]
    fn rejects_progress_status() {
        assert!(looks_like_status_ping(
            "正在拉取相关仓库的最新提交记录以查找对应成员在周五（2026-09-11）的代码与 PR 记录，请稍候..."
        ));
        assert!(looks_like_status_ping(
            "I will wait for the background fetch to complete and analyze the commits."
        ));
        assert!(looks_like_status_ping("Waiting for notification."));
        assert!(!looks_like_status_ping(
            "已按照您的要求全部调整完毕，并已推送到企微群。"
        ));
    }

    #[test]
    fn ignores_thinking_field3() {
        let texts = vec![proto(
            1,
            3,
            "Investigating Enterprise WeChat webhook markdown support for @mentions.",
        )];
        assert!(pick_assistant(&texts).is_none());
    }

    #[test]
    fn rejects_tool_json_fragments() {
        assert!(looks_like_tool_fragment(
            r#"ommandLine":"curl -s -X POST https://project.feishu.cn/mcp"#
        ));
        assert!(looks_like_tool_fragment(
            r#"jects/fx/fx-data-server","WaitMsBeforeAsync":30000,"toolAction":"Search""#
        ));
        assert!(!looks_like_assistant(
            r#"ommandLine":"for f in /tmp/feishu_*.json; do jq -r '.try'"#
        ));
    }

    #[test]
    fn parses_live_agy_conversation_if_present() {
        let path = crate::engine::agy::agy_home()
            .join("conversations")
            .join("55541c2b-d633-420a-b1ff-39cbaf07a231.db");
        if !path.is_file() {
            return;
        }
        let parsed = parse_agy_session(&path, &HashSet::new());
        assert!(
            parsed
                .messages
                .iter()
                .any(|m| m.role == "user" && m.text.contains("飞书")),
            "users: {:?}",
            parsed
                .messages
                .iter()
                .filter(|m| m.role == "user")
                .map(|m| &m.text)
                .collect::<Vec<_>>()
        );
        assert!(
            parsed.messages.iter().all(|m| m.role != "tool"),
            "history must not dump reconstructed tool rows"
        );
        assert!(
            parsed
                .messages
                .iter()
                .all(|m| !m.text.contains("ommandLine") && !m.text.contains("WaitMsBeforeAsync")),
            "junk: {:?}",
            parsed
                .messages
                .iter()
                .map(|m| m.text.chars().take(60).collect::<String>())
                .collect::<Vec<_>>()
        );
        assert!(
            parsed
                .messages
                .iter()
                .any(|m| m.role == "assistant" && m.text.contains("飞书")),
            "roles: {:?}",
            parsed
                .messages
                .iter()
                .map(|m| (&m.role, m.text.chars().take(40).collect::<String>()))
                .collect::<Vec<_>>()
        );
        assert!(
            parsed
                .messages
                .iter()
                .all(|m| !m.text.contains("<font") && !m.text.contains("</font>")),
            "wecom tags leaked"
        );
        assert!(
            parsed.messages.iter().all(|m| {
                let t = m.text.as_str();
                !t.starts_with("The user")
                    && !t.starts_with("Initial assessment")
                    && !t.starts_with("Investigating ")
                    && !t.starts_with("The request involves")
                    && !t.starts_with("正在")
                    && !t.starts_with("Waiting for")
                    && !t.starts_with("I will wait")
            }),
            "thinking leaked: {:?}",
            parsed
                .messages
                .iter()
                .filter(|m| m.role == "assistant")
                .map(|m| m.text.chars().take(50).collect::<String>())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn recorded_frames_preserve_agy_replies_and_summary() {
        let path = std::env::temp_dir().join(format!("ccgui-agy-{}.db", uuid::Uuid::new_v4()));
        let recorded = r#"<CCGUI_INTERNAL_accepted>{"plugin":"bridge","patch":{"goal":"done"}}</CCGUI_INTERNAL_accepted>"#;
        let unrecorded = r#"<CCGUI_INTERNAL_example>{"v":1}</CCGUI_INTERNAL_example>"#;
        let visible = format!("已完成桥接验证，未记录的示例仍保留。\n{unrecorded}");
        let text = format!("{visible}\n{recorded}");
        let inner = encode_string_field(1, &text);
        let mut payload = Vec::new();
        write_varint(&mut payload, (20 << 3) | 2);
        write_varint(&mut payload, inner.len() as u64);
        payload.extend(inner);
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE steps(idx INTEGER, step_type INTEGER, step_payload BLOB);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO steps VALUES(0, ?1, ?2)",
                rusqlite::params![STEP_ASSISTANT, payload],
            )
            .unwrap();
        }
        let accepted = HashSet::from([
            crate::history::recordable_internal_frame_hash(recorded).unwrap(),
        ]);

        let parsed = crate::history::parse_session_file("agy", &path, &accepted).unwrap();
        let summary = crate::history::scan_summary_file("agy", &path, &accepted).unwrap();
        std::fs::remove_file(&path).unwrap();

        let replies: Vec<_> = parsed
            .messages
            .iter()
            .filter(|message| message.role == "assistant")
            .map(|message| message.text.as_str())
            .collect();
        assert_eq!(replies, [visible.as_str()]);
        assert_eq!(summary.preview, visible);
        assert_eq!(summary.message_count, 1);
    }

    #[test]
    fn tool_json_is_not_treated_as_assistant() {
        let json =
            r#"{"DirectoryPath":"/tmp","toolAction":"Checking","toolSummary":"Check config"}"#;
        assert!(pick_assistant(&[proto(1, 1, json)]).is_none());
    }
}
