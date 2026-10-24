//! Lossless, session-scoped Antigravity editing. Only `texts[].text` and
//! `prompts[].row.display` are writable; the remaining fields are snapshots.

use base64::Engine as _;
use rusqlite::{types::ValueRef, Connection, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};

const CAP: usize = 64 * 1024 * 1024;
const MAX_FIELDS: usize = 262_144;
const MAX_DEPTH: usize = 32;
const FORMAT: &str = "agy-native-text-v1";

// Every local Antigravity conversation shares the same prompt log. Hold this
// through both sources' snapshots, commit, replacement and any rollback.
static HISTORY_EDIT_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    format: String,
    session_id: String,
    steps: Vec<Step>,
    prompts: Vec<Prompt>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Step {
    idx: String,
    step_type: i64,
    columns: BTreeMap<String, SqlValue>,
    payload_base64: String,
    texts: Vec<TextField>,
}

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", content = "value", rename_all = "camelCase", deny_unknown_fields)]
enum SqlValue {
    Null,
    Integer(String),
    Real(String),
    Text(String),
    Blob(String),
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(deny_unknown_fields)]
struct FieldPath {
    field: u64,
    occurrence: usize,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TextField {
    path: Vec<FieldPath>,
    text: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Prompt {
    original_line: String,
    row: Value,
}

pub(super) fn read(path: &Path, session_id: &str) -> Result<String, String> {
    read_with_home(path, session_id, &crate::engine::agy::agy_home())
}

pub(super) fn write(path: &Path, session_id: &str, content: &str) -> Result<String, String> {
    write_with_home(path, session_id, content, &crate::engine::agy::agy_home())
}

fn source_path(path: &Path, session_id: &str, home: &Path) -> Result<PathBuf, String> {
    if session_id.is_empty()
        || path.file_stem().and_then(|v| v.to_str()) != Some(session_id)
        || path.extension().and_then(|v| v.to_str()) != Some("db")
    {
        return Err("Antigravity session ID does not match its native database".into());
    }
    let path = dunce::canonicalize(path).map_err(|e| format!("Open Antigravity database: {e}"))?;
    let directory = dunce::canonicalize(home.join("conversations"))
        .map_err(|e| format!("Open Antigravity conversations directory: {e}"))?;
    if path.parent() != Some(directory.as_path())
        || path.file_stem().and_then(|v| v.to_str()) != Some(session_id)
        || !path.is_file()
    {
        return Err("Antigravity database is outside its native session directory".into());
    }
    Ok(path)
}

fn open_db(path: &Path, writable: bool) -> Result<Connection, String> {
    let flags = if writable { OpenFlags::SQLITE_OPEN_READ_WRITE } else { OpenFlags::SQLITE_OPEN_READ_ONLY };
    Connection::open_with_flags(path, flags).map_err(|e| format!("Open Antigravity database: {e}"))
}

struct Budget(usize);

impl Budget {
    fn add(&mut self, bytes: usize) -> Result<(), String> {
        self.0 = self.0.checked_add(bytes).filter(|v| *v <= CAP)
            .ok_or_else(|| "Antigravity editable document exceeds 64 MiB".to_string())?;
        Ok(())
    }
}

struct JsonOutput(Vec<u8>);

impl std::io::Write for JsonOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > CAP.saturating_sub(self.0.len()) {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "Antigravity editable document exceeds 64 MiB"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}
// Bound structural amplification before serde builds vectors/maps from tiny
// JSON tokens. The byte limit alone does not bound decoded allocation.
fn check_json_shape(bytes: &[u8]) -> Result<(), String> {
    let mut quoted = false;
    let mut escaped = false;
    let mut tokens = 0usize;
    for byte in bytes {
        if quoted {
            if escaped { escaped = false; }
            else if *byte == b'\\' { escaped = true; }
            else if *byte == b'"' { quoted = false; }
        } else if *byte == b'"' {
            quoted = true;
            tokens += 1;
        } else if matches!(*byte, b'[' | b'{' | b':' | b',') {
            tokens += 1;
        }
        if tokens > MAX_FIELDS { return Err("Antigravity JSON contains too many fields".into()); }
    }
    Ok(())
}

fn parse_prompt(line: &str) -> Result<Value, String> {
    check_json_shape(line.as_bytes())?;
    serde_json::from_str(line).map_err(|e| format!("Corrupt Antigravity prompt history: {e}"))
}

fn read_with_home(path: &Path, session_id: &str, home: &Path) -> Result<String, String> {
    let path = source_path(path, session_id, home)?;
    let _history = HISTORY_EDIT_LOCK.lock();
    let conn = open_db(&path, false)?;
    let tx = conn.unchecked_transaction().map_err(|e| format!("Read Antigravity snapshot: {e}"))?;
    let history = read_history(&home.join("history.jsonl"))?;
    snapshot_document(&tx, session_id, &history)
}

fn snapshot_document(conn: &Connection, session_id: &str, history: &str) -> Result<String, String> {
    let mut budget = Budget(0);
    let steps = load_steps(conn, &mut budget)?;
    let prompts = prompt_view(history, session_id, &mut budget)?;
    let document = Document { format: FORMAT.into(), session_id: session_id.into(), steps, prompts };
    let mut output = JsonOutput(Vec::new());
    serde_json::to_writer_pretty(&mut output, &document).map_err(|e| format!("Encode Antigravity editable document: {e}"))?;
    check_json_shape(&output.0)?;
    String::from_utf8(output.0).map_err(|e| format!("Encode Antigravity JSON: {e}"))
}

fn load_steps(conn: &Connection, budget: &mut Budget) -> Result<Vec<Step>, String> {
    let mut statement = conn.prepare("SELECT * FROM steps ORDER BY idx")
        .map_err(|e| format!("Read Antigravity steps: {e}"))?;
    let names: Vec<String> = statement.column_names().into_iter().map(str::to_owned).collect();
    let index = names.iter().position(|v| v == "idx").ok_or("Antigravity steps lack idx")?;
    let kind = names.iter().position(|v| v == "step_type").ok_or("Antigravity steps lack step_type")?;
    let blob = names.iter().position(|v| v == "step_payload").ok_or("Antigravity steps lack step_payload")?;
    let mut rows = statement.query([]).map_err(|e| format!("Read Antigravity steps: {e}"))?;
    let mut steps = Vec::new();
    let mut indices = HashSet::new();
    while let Some(row) = rows.next().map_err(|e| format!("Read Antigravity step: {e}"))? {
        budget.add(128 + names.iter().map(|n| n.len()).sum::<usize>())?;
        let idx: i64 = row.get(index).map_err(|e| format!("Read Antigravity step idx: {e}"))?;
        if !indices.insert(idx) { return Err("Antigravity steps contain duplicate indices".into()); }
        let step_type: i64 = row.get(kind).map_err(|e| format!("Read Antigravity step type: {e}"))?;
        let payload = match row.get_ref(blob).map_err(|e| format!("Read Antigravity protobuf: {e}"))? {
            ValueRef::Blob(bytes) => bytes,
            _ => return Err("Antigravity step_payload is not a native protobuf blob".into()),
        };
        budget.add(payload.len().checked_mul(4).and_then(|v| v.checked_add(2)).map(|v| v / 3).ok_or("Antigravity payload exceeds 64 MiB")?)?;
        let texts = decode_texts(payload, budget).map_err(|e| format!("Antigravity step {idx}: {e}"))?;
        let payload_base64 = base64::engine::general_purpose::STANDARD.encode(payload);
        let mut columns = BTreeMap::new();
        for (position, name) in names.iter().enumerate() {
            if matches!(name.as_str(), "idx" | "step_type" | "step_payload") { continue; }
            let value = row.get_ref(position).map_err(|e| format!("Read Antigravity column {name}: {e}"))?;
            let value = match value {
                ValueRef::Null => SqlValue::Null,
                ValueRef::Integer(v) => { budget.add(24)?; SqlValue::Integer(v.to_string()) }
                ValueRef::Real(v) => { budget.add(32)?; SqlValue::Real(v.to_string()) }
                ValueRef::Text(v) => {
                    budget.add(v.len())?;
                    SqlValue::Text(std::str::from_utf8(v).map_err(|e| format!("Invalid UTF-8 in Antigravity column {name}: {e}"))?.into())
                }
                ValueRef::Blob(v) => {
                    budget.add(v.len().checked_mul(4).and_then(|n| n.checked_add(2)).map(|n| n / 3).ok_or("Antigravity column exceeds 64 MiB")?)?;
                    SqlValue::Blob(base64::engine::general_purpose::STANDARD.encode(v))
                }
            };
            columns.insert(name.clone(), value);
        }
        steps.push(Step { idx: idx.to_string(), step_type, columns, payload_base64, texts });
    }
    Ok(steps)
}

fn read_history(path: &Path) -> Result<String, String> {
    if !std::fs::symlink_metadata(path).map_err(|e| format!("Read native Antigravity prompt source: {e}"))?.file_type().is_file() {
        return Err("Antigravity prompt history must be a regular native file, not a symlink".into());
    }
    let file = std::fs::File::open(path).map_err(|e| format!("Read Antigravity prompt history: {e}"))?;
    if file.metadata().map_err(|e| format!("Read Antigravity prompt metadata: {e}"))?.len() > CAP as u64 {
        return Err("Antigravity prompt history exceeds 64 MiB".into());
    }
    let mut bytes = Vec::new();
    file.take(CAP as u64 + 1).read_to_end(&mut bytes).map_err(|e| format!("Read Antigravity prompt history: {e}"))?;
    if bytes.len() > CAP { return Err("Antigravity prompt history exceeds 64 MiB".into()); }
    String::from_utf8(bytes).map_err(|e| format!("Antigravity prompt history is not UTF-8: {e}"))
}

fn prompt_view(history: &str, session_id: &str, budget: &mut Budget) -> Result<Vec<Prompt>, String> {
    let mut prompts = Vec::new();
    for line in history.split_inclusive('\n') {
        if line.trim().is_empty() { continue; }
        let row = parse_prompt(line)?;
        let object = row.as_object().ok_or("Antigravity prompt history contains a non-object row")?;
        if object.get("conversationId").and_then(Value::as_str) != Some(session_id) { continue; }
        if object.get("display").is_some_and(|v| !v.is_null() && !v.is_string()) {
            return Err("Antigravity prompt display is not text".into());
        }
        budget.add(line.len().checked_mul(2).and_then(|n| n.checked_add(128)).ok_or("Antigravity prompt view exceeds 64 MiB")?)?;
        prompts.push(Prompt { original_line: line.into(), row });
    }
    Ok(prompts)
}

struct WireField {
    field: u64,
    occurrence: usize,
    start: usize,
    tag_end: usize,
    body_start: usize,
    end: usize,
    wire: u8,
}

fn varint(bytes: &[u8], start: usize) -> Result<(u64, usize), String> {
    let mut value = 0u64;
    for shift in 0..10 {
        let position = start.checked_add(shift).ok_or("Protobuf varint offset overflow")?;
        let byte = *bytes.get(position).ok_or("Truncated protobuf varint")?;
        if shift == 9 && byte > 1 { return Err("Overflowing protobuf varint".into()); }
        value |= u64::from(byte & 0x7f) << (shift * 7);
        if byte & 0x80 == 0 { return Ok((value, position + 1)); }
    }
    Err("Overflowing protobuf varint".into())
}

fn encode_varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 128 {
        out.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn field_end(bytes: &[u8], tag_end: usize, field: u64, wire: u8, depth: usize) -> Result<(usize, usize), String> {
    match wire {
        0 => Ok((tag_end, varint(bytes, tag_end)?.1)),
        1 | 5 => {
            let end = tag_end.checked_add(if wire == 1 { 8 } else { 4 }).filter(|n| *n <= bytes.len()).ok_or("Truncated protobuf fixed field")?;
            Ok((tag_end, end))
        }
        2 => {
            let (length, start) = varint(bytes, tag_end)?;
            let end = usize::try_from(length).ok().and_then(|n| start.checked_add(n)).filter(|n| *n <= bytes.len()).ok_or("Truncated protobuf string field")?;
            Ok((start, end))
        }
        3 => {
            if depth >= MAX_DEPTH { return Err("Protobuf group nesting exceeds safe depth".into()); }
            let mut position = tag_end;
            while position < bytes.len() {
                let (tag, next) = varint(bytes, position)?;
                validate_tag(tag)?;
                if tag & 7 == 4 {
                    if tag >> 3 != field { return Err("Mismatched protobuf end-group".into()); }
                    return Ok((tag_end, next));
                }
                position = field_end(bytes, next, tag >> 3, (tag & 7) as u8, depth + 1)?.1;
            }
            Err("Unterminated protobuf group".into())
        }
        _ => Err("Invalid protobuf wire type".into()),
    }
}

fn validate_tag(tag: u64) -> Result<(), String> {
    if tag >> 3 == 0 || tag >> 3 > 0x1fff_ffff || tag & 7 > 5 {
        return Err("Invalid protobuf field tag".into());
    }
    Ok(())
}

fn wire_fields(bytes: &[u8]) -> Result<Vec<WireField>, String> {
    let mut fields = Vec::new();
    let mut occurrences = HashMap::<u64, usize>::new();
    let mut position = 0;
    while position < bytes.len() {
        if fields.len() >= MAX_FIELDS { return Err("Protobuf contains too many fields".into()); }
        let (tag, tag_end) = varint(bytes, position)?;
        validate_tag(tag)?;
        let field = tag >> 3;
        let wire = (tag & 7) as u8;
        let (body_start, end) = field_end(bytes, tag_end, field, wire, 0)?;
        let occurrence = occurrences.entry(field).or_default();
        fields.push(WireField { field, occurrence: *occurrence, start: position, tag_end, body_start, end, wire });
        *occurrence += 1;
        position = end;
    }
    Ok(fields)
}

fn decode_texts(bytes: &[u8], budget: &mut Budget) -> Result<Vec<TextField>, String> {
    let fields = wire_fields(bytes)?;
    let mut texts = Vec::new();
    let mut path = Vec::new();
    collect_texts(bytes, fields, &mut path, &mut texts, budget)?;
    Ok(texts)
}

fn collect_texts(bytes: &[u8], fields: Vec<WireField>, path: &mut Vec<FieldPath>, texts: &mut Vec<TextField>, budget: &mut Budget) -> Result<(), String> {
    budget.add(fields.len() * std::mem::size_of::<WireField>())?;
    for field in fields {
        if field.wire != 2 { continue; }
        path.push(FieldPath { field: field.field, occurrence: field.occurrence });
        let chunk = &bytes[field.body_start..field.end];
        let text = std::str::from_utf8(chunk).ok().filter(|text| {
            text.chars().all(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
        });
        let nested = if chunk.is_empty() { None } else { wire_fields(chunk).ok() };
        // Protobuf has no wire-level distinction between bytes, text and
        // submessages. Prefer the native visible reply slot, including short
        // strings which happen to be valid varints, and otherwise traverse
        // structurally complete submessages with length-delimited fields.
        let reply_slot = path.len() == 2 && field.field == 1;
        let traverse = nested.as_ref().is_some_and(|fields| fields.iter().any(|f| f.wire == 2))
            && !(reply_slot && text.is_some());
        if traverse {
            if path.len() >= MAX_DEPTH { return Err("Protobuf message nesting exceeds safe depth".into()); }
            collect_texts(chunk, nested.unwrap(), path, texts, budget)?;
        } else if let Some(text) = text {
            if texts.len() >= MAX_FIELDS { return Err("Protobuf contains too many text fields".into()); }
            budget.add(text.len() + path.len() * 64 + 64)?;
            texts.push(TextField { path: path.clone(), text: text.into() });
        } else if let Some(nested) = nested {
            if path.len() >= MAX_DEPTH { return Err("Protobuf message nesting exceeds safe depth".into()); }
            collect_texts(chunk, nested, path, texts, budget)?;
        }
        path.pop();
    }
    Ok(())
}

fn rewrite_message(bytes: &[u8], path: &mut Vec<FieldPath>, edits: &HashMap<Vec<FieldPath>, &str>, ancestors: &HashSet<Vec<FieldPath>>, applied: &mut usize) -> Result<Vec<u8>, String> {
    if path.len() >= MAX_DEPTH { return Err("Protobuf message nesting exceeds safe depth".into()); }
    let fields = wire_fields(bytes)?;
    let mut output = Vec::with_capacity(bytes.len());
    for field in fields {
        path.push(FieldPath { field: field.field, occurrence: field.occurrence });
        let replacement = if field.wire == 2 {
            if let Some(text) = edits.get(path) {
                *applied += 1;
                Some(Cow::Borrowed(text.as_bytes()))
            } else if ancestors.contains(path.as_slice()) {
                Some(Cow::Owned(rewrite_message(&bytes[field.body_start..field.end], path, edits, ancestors, applied)?))
            } else { None }
        } else { None };
        if let Some(replacement) = replacement {
            let size = output.len().checked_add(field.tag_end - field.start).and_then(|n| n.checked_add(10)).and_then(|n| n.checked_add(replacement.len())).ok_or("Edited Antigravity payload exceeds 64 MiB")?;
            if size > CAP { return Err("Edited Antigravity payload exceeds 64 MiB".into()); }
            output.extend_from_slice(&bytes[field.start..field.tag_end]);
            encode_varint(&mut output, replacement.len() as u64);
            output.extend_from_slice(&replacement);
        } else {
            if field.end - field.start > CAP.saturating_sub(output.len()) { return Err("Edited Antigravity payload exceeds 64 MiB".into()); }
            output.extend_from_slice(&bytes[field.start..field.end]);
        }
        path.pop();
    }
    Ok(output)
}

struct BlobEdit {
    idx: i64,
    before: Vec<u8>,
    after: Vec<u8>,
}

fn step_edits(original: &[Step], edited: &[Step], budget: &mut Budget) -> Result<Vec<BlobEdit>, String> {
    if original.len() != edited.len() { return Err("Antigravity steps cannot be added or removed".into()); }
    let mut changes = Vec::new();
    for (before, after) in original.iter().zip(edited) {
        if before.idx != after.idx || before.step_type != after.step_type || before.columns != after.columns || before.payload_base64 != after.payload_base64 {
            return Err("Antigravity step identity, columns or original payload changed; reopen the session editor".into());
        }
        if before.texts.len() != after.texts.len() { return Err("Antigravity protobuf text fields cannot be added or removed".into()); }
        let mut edits = HashMap::new();
        let mut ancestors = HashSet::new();
        for (source, target) in before.texts.iter().zip(&after.texts) {
            if source.path != target.path { return Err("Antigravity protobuf text field path changed".into()); }
            if source.text != target.text {
                budget.add(target.path.len() * 32 + 64)?;
                edits.insert(target.path.clone(), target.text.as_str());
                for depth in 1..target.path.len() {
                    if !ancestors.contains(&target.path[..depth]) {
                        budget.add(depth * 32 + 64)?;
                        ancestors.insert(target.path[..depth].to_vec());
                    }
                }
            }
        }
        if edits.is_empty() { continue; }
        budget.add(before.payload_base64.len() / 4 * 3)?;
        let payload = base64::engine::general_purpose::STANDARD.decode(&before.payload_base64).map_err(|e| format!("Decode native Antigravity payload: {e}"))?;
        let mut applied = 0;
        let updated = rewrite_message(&payload, &mut Vec::new(), &edits, &ancestors, &mut applied)?;
        if applied != edits.len() { return Err("Antigravity protobuf edit did not identify every target".into()); }
        budget.add(updated.len())?;
        changes.push(BlobEdit { idx: before.idx.parse().map_err(|e| format!("Invalid Antigravity idx: {e}"))?, before: payload, after: updated });
    }
    Ok(changes)
}

fn prompt_changes(original: &[Prompt], edited: &[Prompt], session_id: &str) -> Result<Vec<Option<String>>, String> {
    if original.len() != edited.len() { return Err("Antigravity prompt rows cannot be added or removed".into()); }
    let mut replacements = Vec::new();
    for (before, after) in original.iter().zip(edited) {
        if before.original_line != after.original_line { return Err("Antigravity prompt snapshot changed; reopen the session editor".into()); }
        let source = before.row.as_object().ok_or("Invalid native Antigravity prompt row")?;
        let target = after.row.as_object().ok_or("Edited Antigravity prompt must be an object")?;
        if target.get("conversationId").and_then(Value::as_str) != Some(session_id)
            || source.len() != target.len()
            || source.iter().any(|(key, value)| key != "display" && target.get(key) != Some(value))
            || source.contains_key("display") != target.contains_key("display")
        {
            return Err("Only Antigravity prompt display text may be edited".into());
        }
        if source.get("display") == target.get("display") { replacements.push(None); continue; }
        let display = target.get("display").and_then(Value::as_str).ok_or("Edited Antigravity prompt display must be text")?;
        replacements.push(Some(replace_display(&before.original_line, display)?));
    }
    Ok(replacements)
}

/// Keep every native JSON token (including future large numeric literals) and
/// replace just the top-level display value, never reserialize the whole row.
fn replace_display(line: &str, display: &str) -> Result<String, String> {
    let bytes = line.as_bytes();
    let mut position = 0;
    skip_space(bytes, &mut position);
    if bytes.get(position) != Some(&b'{') { return Err("Invalid native prompt object".into()); }
    position += 1;
    let mut span = None;
    loop {
        skip_space(bytes, &mut position);
        if bytes.get(position) == Some(&b'}') { break; }
        let mut keys = serde_json::Deserializer::from_slice(&bytes[position..]).into_iter::<String>();
        let key = keys.next().ok_or("Missing native prompt key")?.map_err(|e| format!("Read native prompt key: {e}"))?;
        position += keys.byte_offset();
        skip_space(bytes, &mut position);
        if bytes.get(position) != Some(&b':') { return Err("Invalid native prompt separator".into()); }
        position += 1;
        skip_space(bytes, &mut position);
        let start = position;
        let mut values = serde_json::Deserializer::from_slice(&bytes[position..]).into_iter::<Box<serde_json::value::RawValue>>();
        values.next().ok_or("Missing native prompt value")?.map_err(|e| format!("Read native prompt value: {e}"))?;
        position += values.byte_offset();
        if key == "display" {
            if span.replace((start, position)).is_some() { return Err("Native prompt has duplicate display fields".into()); }
        }
        skip_space(bytes, &mut position);
        match bytes.get(position) {
            Some(b',') => position += 1,
            Some(b'}') => break,
            _ => return Err("Invalid native prompt object ending".into()),
        }
    }
    let (start, end) = span.ok_or("Native Antigravity prompt has no display field")?;
    let value = serde_json::to_string(display).map_err(|e| format!("Encode prompt display: {e}"))?;
    let size = line.len().checked_sub(end - start).and_then(|n| n.checked_add(value.len())).filter(|n| *n <= CAP).ok_or("Edited Antigravity prompt exceeds 64 MiB")?;
    let mut output = String::with_capacity(size);
    output.push_str(&line[..start]);
    output.push_str(&value);
    output.push_str(&line[end..]);
    Ok(output)
}

fn skip_space(bytes: &[u8], position: &mut usize) {
    while bytes.get(*position).is_some_and(u8::is_ascii_whitespace) { *position += 1; }
}

fn merge_prompts(history: &str, originals: &[Prompt], replacements: &[Option<String>], session_id: &str) -> Result<String, String> {
    let mut output = String::with_capacity(history.len());
    let mut index = 0;
    for line in history.split_inclusive('\n') {
        let scoped = if line.trim().is_empty() { false } else {
            let row = parse_prompt(line)?;
            row.get("conversationId").and_then(Value::as_str) == Some(session_id)
        };
        let next = if scoped {
            if originals.get(index).map(|p| p.original_line.as_str()) != Some(line) { return Err("Antigravity prompts changed externally; reopen the session editor".into()); }
            let replacement = replacements[index].as_deref().unwrap_or(line);
            index += 1;
            replacement
        } else { line };
        if next.len() > CAP.saturating_sub(output.len()) { return Err("Edited Antigravity prompt history exceeds 64 MiB".into()); }
        output.push_str(next);
    }
    if index != originals.len() { return Err("Antigravity prompts changed externally; reopen the session editor".into()); }
    Ok(output)
}

struct StagedHistory { temp: PathBuf }

impl StagedHistory {
    fn new(path: &Path, content: &str) -> Result<Self, String> {
        let metadata = super::regular_source(path)?;
        if metadata.permissions().readonly() { return Err("Native Antigravity prompt history is read-only".into()); }
        let source = std::fs::File::open(path).map_err(|e| format!("Read native prompt permissions: {e}"))?;
        if !super::same_source(&metadata, &source.metadata().map_err(|e| format!("Inspect native prompt source: {e}"))?) {
            return Err("Antigravity prompt source changed before staging".into());
        }
        let temp = path.with_file_name(format!(".history.jsonl.edit-{}.tmp", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|e| format!("Stage native Antigravity prompt history: {e}"))?;
        let staged = Self { temp };
        file.write_all(content.as_bytes()).map_err(|e| format!("Write staged Antigravity prompts: {e}"))?;
        super::preserve_source_permissions(&source, &file)?;
        file.sync_all().map_err(|e| format!("Sync staged Antigravity prompts: {e}"))?;
        Ok(staged)
    }
}

impl Drop for StagedHistory {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.temp); }
}

fn write_with_home(path: &Path, session_id: &str, content: &str, home: &Path) -> Result<String, String> {
    #[cfg(test)]
    { write_with_home_impl(path, session_id, content, home, None) }
    #[cfg(not(test))]
    { write_with_home_impl(path, session_id, content, home) }
}

fn write_with_home_impl(path: &Path, session_id: &str, content: &str, home: &Path,
    #[cfg(test)] before_replace: Option<&dyn Fn()>) -> Result<String, String> {
    if content.len() > CAP { return Err("Antigravity editable document exceeds 64 MiB".into()); }
    check_json_shape(content.as_bytes())?;
    let document: Document = serde_json::from_str(content).map_err(|e| format!("Invalid Antigravity editable JSON: {e}"))?;
    if document.format != FORMAT || document.session_id != session_id { return Err("Antigravity editable document has the wrong session identity or format".into()); }
    let _history = HISTORY_EDIT_LOCK.lock();
    let path = source_path(path, session_id, home)?;
    let prompt_path = home.join("history.jsonl");
    let mut conn = open_db(&path, true)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| format!("Lock native Antigravity session: {e}"))?;
    let mut budget = Budget(0);
    let steps = load_steps(&tx, &mut budget)?;
    let history = read_history(&prompt_path)?;
    let prompts = prompt_view(&history, session_id, &mut budget)?;
    let changes = step_edits(&steps, &document.steps, &mut budget)?;
    let replacements = prompt_changes(&prompts, &document.prompts, session_id)?;
    let updated_history = if replacements.iter().any(Option::is_some) {
        Some(merge_prompts(&history, &prompts, &replacements, session_id)?)
    } else { None };
    drop(document);
    drop(steps);
    drop(prompts);
    drop(replacements);
    let staged = updated_history.as_deref().map(|text| StagedHistory::new(&prompt_path, text)).transpose()?;
    for change in &changes {
        let count = tx.execute("UPDATE steps SET step_payload=?1 WHERE idx=?2 AND step_payload=?3", rusqlite::params![change.after, change.idx, change.before])
            .map_err(|e| format!("Update native Antigravity step: {e}"))?;
        if count != 1 { return Err("Native Antigravity step changed during save".into()); }
    }
    // Validate the exact post-update projection while SQLite can still roll
    // back. A text edit can amplify into both base64 and decoded text fields.
    let canonical = snapshot_document(&tx, session_id, updated_history.as_deref().unwrap_or(&history))?;
    // Recheck after staging, before committing either native source. Unrelated
    // prompts appended before this save were merged; new races are rejected.
    if read_history(&prompt_path)? != history { return Err("Antigravity prompt history changed during save; retry after reopening".into()); }
    tx.commit().map_err(|e| format!("Commit native Antigravity edits: {e}"))?;
    if let Some(staged) = staged {
        let replace = (|| {
            if read_history(&prompt_path)? != history { return Err("Antigravity prompt history changed during save".to_string()); }
            #[cfg(test)]
            if let Some(checkpoint) = before_replace { checkpoint(); }
            super::replace_existing(&staged.temp, &prompt_path).map_err(|e| format!("Replace native Antigravity prompt history: {e}"))
        })();
        if let Err(error) = replace {
            // SQLite and a separate JSONL cannot share a transaction. On a
            // replace failure undo our blobs, but never overwrite a new turn.
            let restore = restore_blobs(&mut conn, &changes);
            return match restore {
                Ok(()) => Err(error),
                Err(restore) => Err(format!("{error}; database rollback failed: {restore}")),
            };
        }
    }
    Ok(canonical)
}

fn restore_blobs(conn: &mut Connection, changes: &[BlobEdit]) -> Result<(), String> {
    if changes.is_empty() { return Ok(()); }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    for change in changes {
        let count = tx.execute("UPDATE steps SET step_payload=?1 WHERE idx=?2 AND step_payload=?3", rusqlite::params![change.before, change.idx, change.after]).map_err(|e| e.to_string())?;
        if count != 1 { return Err("a concurrent native edit prevents safe rollback".into()); }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    struct Fixture {
        home: std::path::PathBuf,
        db: std::path::PathBuf,
    }

    impl Fixture {
        fn new(payload: &[u8], prompts: &str) -> Self {
            let home = std::env::temp_dir().join(format!("ccgui-agy-edit-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(home.join("conversations")).unwrap();
            let db = home.join("conversations/edit-fixture.db");
            let conn = rusqlite::Connection::open(&db).unwrap();
            conn.execute_batch(
                "CREATE TABLE steps(idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB, extra BLOB, note TEXT);
                 CREATE TABLE unrelated(id TEXT PRIMARY KEY, value BLOB);
                 INSERT INTO unrelated VALUES('other', x'0001ff');",
            ).unwrap();
            conn.execute(
                "INSERT INTO steps VALUES(0, 15, ?1, x'00feff', 'keep me')",
                rusqlite::params![payload],
            ).unwrap();
            conn.execute(
                "INSERT INTO steps VALUES(1, 9, x'0801', x'abcd', 'other step')", [],
            ).unwrap();
            std::fs::write(home.join("history.jsonl"), prompts).unwrap();
            Self { home, db }
        }

        fn view(&self) -> Value {
            serde_json::from_str(&read_with_home(&self.db, "edit-fixture", &self.home).unwrap()).unwrap()
        }

        fn save(&self, view: &Value) -> Result<(), String> {
            write_with_home(&self.db, "edit-fixture", &view.to_string(), &self.home).map(|_| ())
        }

        fn payload(&self) -> Vec<u8> {
            rusqlite::Connection::open(&self.db).unwrap().query_row(
                "SELECT step_payload FROM steps WHERE idx=0", [], |r| r.get(0),
            ).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.home);
        }
    }

    fn string_field(field: u64, value: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        encode_varint(&mut out, (field << 3) | 2);
        encode_varint(&mut out, value.len() as u64);
        out.extend_from_slice(value);
        out
    }

    fn assistant_payload(text: &str) -> Vec<u8> {
        let mut inner = string_field(1, text.as_bytes());
        inner.extend_from_slice(&[0x48, 0x81, 0x00]); // Unknown noncanonical varint.
        inner.extend(string_field(8, b"an unrelated copied reply must stay unchanged"));
        let mut out = string_field(20, &inner);
        out.extend_from_slice(&[0xad, 0x01, 0xde, 0xad, 0xbe, 0xef]); // Unknown fixed32.
        out.extend(string_field(23, &[0xff, 0x00, 0xfe])); // Opaque unknown bytes.
        out
    }

    #[test]
    fn agy_edit_assistant_text_is_native_and_unknown_bytes_survive() {
        let before = "This is the original native assistant response for the fixture.";
        let after = format!("This is the changed native assistant response with Unicode 你好 🙂 {}", "more prose ".repeat(30));
        let fixture = Fixture::new(&assistant_payload(before), "");
        let mut view = fixture.view();
        let fields = view["steps"][0]["texts"].as_array_mut().unwrap();
        let field = fields.iter_mut().find(|item| item["text"] == before).unwrap();
        assert_eq!(field["path"], json!([{"field":20,"occurrence":0},{"field":1,"occurrence":0}]));
        field["text"] = json!(after);
        fixture.save(&view).unwrap();
        assert_eq!(fixture.payload(), assistant_payload(&after));
        let parsed = crate::history::parse_session_file("agy", &fixture.db, &HashSet::new()).unwrap();
        assert!(parsed.messages.iter().any(|message| message.role == "assistant" && message.text == after));
        let conn = rusqlite::Connection::open(&fixture.db).unwrap();
        let preserved: (Vec<u8>, String) = conn.query_row(
            "SELECT extra,note FROM steps WHERE idx=0", [], |r| Ok((r.get(0)?,r.get(1)?)),
        ).unwrap();
        assert_eq!(preserved, (vec![0, 0xfe, 0xff], "keep me".to_string()));
        assert_eq!(conn.query_row("SELECT step_payload FROM steps WHERE idx=1", [], |r| r.get::<_, Vec<u8>>(0)).unwrap(), vec![8,1]);
        assert_eq!(conn.query_row("SELECT value FROM unrelated", [], |r| r.get::<_, Vec<u8>>(0)).unwrap(), vec![0,1,255]);
    }

    #[test]
    fn agy_edit_prompt_preserves_other_conversations_and_unknown_literals_verbatim() {
        let other = " {\"conversationId\":\"other\",\"display\":\"leave me\",\"future\":1.234567890123456789e20}\r\n";
        let target = "{ \"conversationId\":\"edit-fixture\", \"display\" : \"old prompt\", \"unknown\":123456789012345678901234567890 }\n";
        let fixture = Fixture::new(&assistant_payload("A native assistant response long enough to remain visible."), &format!("{other}\n{target}"));
        let original_payload = fixture.payload();
        let mut view = fixture.view();
        assert_eq!(view["prompts"].as_array().unwrap().len(), 1);
        view["prompts"][0]["row"]["display"] = json!("new prompt\n你好 🙂");
        fixture.save(&view).unwrap();
        let history = std::fs::read_to_string(fixture.home.join("history.jsonl")).unwrap();
        let replaced = target.replace("\"old prompt\"", &serde_json::to_string("new prompt\n你好 🙂").unwrap());
        assert_eq!(history, format!("{other}\n{replaced}"));
        let row: Value = serde_json::from_str(history.lines().last().unwrap()).unwrap();
        assert_eq!(row["display"], "new prompt\n你好 🙂");
        assert_eq!(fixture.view()["prompts"][0]["row"]["display"], row["display"]);
        assert_eq!(fixture.payload(), original_payload);
    }

    #[test]
    fn agy_edit_invalid_views_never_write_native_sources() {
        let fixture = Fixture::new(&assistant_payload("A real native assistant response is retained for all invalid edits."), "{\"conversationId\":\"edit-fixture\",\"display\":\"old prompt\"}\n");
        let original = fixture.view();
        let payload = fixture.payload();
        let history = std::fs::read(fixture.home.join("history.jsonl")).unwrap();
        let mut cases = Vec::new();
        let mut edited = original.clone();
        edited["sessionId"] = json!("another-session");
        cases.push(edited);
        let mut edited = original.clone();
        edited["steps"][0]["payloadBase64"] = json!("AA==");
        cases.push(edited);
        let mut edited = original.clone();
        edited["steps"][0]["texts"][0]["path"][0]["field"] = json!(999);
        cases.push(edited);
        let mut edited = original.clone();
        edited["prompts"][0]["row"]["conversationId"] = json!("another-session");
        cases.push(edited);
        let mut edited = original.clone();
        edited["prompts"][0]["row"]["unknown"] = json!(true);
        cases.push(edited);
        let mut edited = original.clone();
        edited["steps"].as_array_mut().unwrap().remove(1);
        cases.push(edited);
        for edited in cases {
            assert!(fixture.save(&edited).is_err());
            assert_eq!(fixture.payload(), payload);
            assert_eq!(std::fs::read(fixture.home.join("history.jsonl")).unwrap(), history);
        }
        assert!(write_with_home(&fixture.db, "edit-fixture", "{not json", &fixture.home).is_err());
        assert!(read_with_home(&fixture.db, "wrong-id", &fixture.home).is_err());
    }

    #[test]
    fn agy_edit_repeated_fields_have_stable_paths_and_group_bytes_survive() {
        let mut inner = string_field(1, b"first editable assistant response is not the selected occurrence");
        inner.extend(string_field(1, b"second editable assistant response is the selected occurrence"));
        inner.extend_from_slice(&[0x33, 0x08, 0x81, 0x00, 0x34]); // Unknown group.
        let payload = string_field(20, &inner);
        let fixture = Fixture::new(&payload, "");
        let mut view = fixture.view();
        let texts = view["steps"][0]["texts"].as_array_mut().unwrap();
        let second = texts.iter_mut().find(|item| item["text"].as_str().unwrap().starts_with("second")).unwrap();
        assert_eq!(second["path"][1]["occurrence"], 1);
        second["text"] = json!("A substantially longer replacement of the repeated native assistant field, with intact unrelated bytes.");
        let replacement = second["text"].as_str().unwrap().to_string();
        fixture.save(&view).unwrap();
        let mut expected = string_field(1, b"first editable assistant response is not the selected occurrence");
        expected.extend(string_field(1, replacement.as_bytes()));
        expected.extend_from_slice(&[0x33, 0x08, 0x81, 0x00, 0x34]);
        assert_eq!(fixture.payload(), string_field(20, &expected));
    }

    #[test]
    fn agy_edit_rejects_stale_target_but_keeps_new_other_prompt_lines() {
        let fixture = Fixture::new(&assistant_payload("A native assistant response long enough to be visible in this test."), "{\"conversationId\":\"edit-fixture\",\"display\":\"old\"}\n");
        let mut view = fixture.view();
        view["prompts"][0]["row"]["display"] = json!("edited");
        let other = "{\"conversationId\":\"other\",\"display\":\"concurrently appended\"}\n";
        let path = fixture.home.join("history.jsonl");
        std::fs::write(&path, format!("{{\"conversationId\":\"edit-fixture\",\"display\":\"old\"}}\n{other}")).unwrap();
        fixture.save(&view).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().ends_with(other));
        assert!(fixture.save(&view).is_err());
        let mut stale_db = fixture.view();
        stale_db["steps"][0]["texts"][0]["text"] = json!("A replacement assistant message that must never overwrite concurrent native updates.");
        let external = assistant_payload("The external native assistant edit must stay intact and visible.");
        rusqlite::Connection::open(&fixture.db).unwrap().execute("UPDATE steps SET step_payload=?1 WHERE idx=0", rusqlite::params![external]).unwrap();
        assert!(fixture.save(&stale_db).is_err());
        assert_eq!(fixture.payload(), external);
    }

    #[test]
    fn agy_edit_corrupt_protobuf_and_prompt_sources_are_explicit_errors() {
        let fixture = Fixture::new(&[0x0a, 0x80], "");
        assert!(read_with_home(&fixture.db, "edit-fixture", &fixture.home).is_err());
        rusqlite::Connection::open(&fixture.db).unwrap().execute("UPDATE steps SET step_payload=x'0801' WHERE idx=0", []).unwrap();
        std::fs::write(fixture.home.join("history.jsonl"), "{broken json}\n").unwrap();
        assert!(read_with_home(&fixture.db, "edit-fixture", &fixture.home).is_err());
        std::fs::remove_file(fixture.home.join("history.jsonl")).unwrap();
        assert!(read_with_home(&fixture.db, "edit-fixture", &fixture.home).is_err());
    }

    #[test]
    fn agy_edit_noop_keeps_noncanonical_lengths_and_native_files_exact() {
        let text = b"A native assistant text that is long enough for the prose filter.";
        let mut inner = vec![0x0a, text.len() as u8 | 0x80, 0x00];
        inner.extend(text);
        let payload = string_field(20, &inner);
        let history = " {\"conversationId\":\"edit-fixture\",\"display\":\"keep exact\"}\r\n";
        let fixture = Fixture::new(&payload, history);
        fixture.save(&fixture.view()).unwrap();
        assert_eq!(fixture.payload(), payload);
        assert_eq!(std::fs::read_to_string(fixture.home.join("history.jsonl")).unwrap(), history);
    }

    #[test]
    fn agy_edit_rejects_oversized_sources_and_json_amplification() {
        let fixture = Fixture::new(&assistant_payload("A real native assistant response used to test input bounds."), "");
        std::fs::OpenOptions::new().write(true).open(fixture.home.join("history.jsonl")).unwrap().set_len(CAP as u64 + 1).unwrap();
        assert!(read_with_home(&fixture.db, "edit-fixture", &fixture.home).unwrap_err().contains("64 MiB"));
        let tiny_tokens = format!("[{}null]", "null,".repeat(MAX_FIELDS + 1));
        assert!(check_json_shape(tiny_tokens.as_bytes()).unwrap_err().contains("too many fields"));
    }

    #[test]
    fn agy_edit_rejects_cross_home_database_identity() {
        let first = Fixture::new(&assistant_payload("A real native assistant response in the first home."), "");
        let second = Fixture::new(&assistant_payload("A real native assistant response in the second home."), "");
        assert!(read_with_home(&first.db, "edit-fixture", &second.home).is_err());
        assert!(write_with_home(&first.db, "edit-fixture", &second.view().to_string(), &second.home).is_err());
    }

    #[test]
    fn agy_edit_short_text_is_not_lost_to_protobuf_ambiguity() {
        let fixture = Fixture::new(&assistant_payload("OK"), "");
        let mut view = fixture.view();
        let text = view["steps"][0]["texts"].as_array_mut().unwrap().iter_mut().find(|field| field["text"] == "OK").unwrap();
        text["text"] = json!("A real assistant reply replacing a short but editable native protobuf string.");
        fixture.save(&view).unwrap();
        let parsed = crate::history::parse_session_file("agy", &fixture.db, &HashSet::new()).unwrap();
        assert!(parsed.messages.iter().any(|message| message.text == "A real assistant reply replacing a short but editable native protobuf string."));
    }

    #[test]
    fn agy_edit_consecutive_saves_use_canonical_native_snapshot() {
        let fixture = Fixture::new(&assistant_payload("A real native assistant reply used for consecutive saves."), "{\"conversationId\":\"edit-fixture\",\"display\":\"original prompt\"}\n");
        let mut first = fixture.view();
        first["steps"][0]["texts"][0]["text"] = json!("The first native assistant edit remains visible before the second save.");
        first["prompts"][0]["row"]["display"] = json!("first prompt edit");
        let canonical = write_with_home(&fixture.db, "edit-fixture", &first.to_string(), &fixture.home).unwrap();

        let mut fresh: Value = serde_json::from_str(&canonical).unwrap();
        assert_ne!(fresh["steps"][0]["payloadBase64"], first["steps"][0]["payloadBase64"]);
        assert_ne!(fresh["prompts"][0]["originalLine"], first["prompts"][0]["originalLine"]);
        fresh["steps"][0]["texts"][0]["text"] = json!("The second native assistant edit is saved from the refreshed native snapshot.");
        fresh["prompts"][0]["row"]["display"] = json!("second prompt edit");
        write_with_home(&fixture.db, "edit-fixture", &fresh.to_string(), &fixture.home).unwrap();
        let latest = fixture.view();
        assert_eq!(latest["steps"][0]["texts"][0]["text"], fresh["steps"][0]["texts"][0]["text"]);
        assert_eq!(latest["prompts"][0]["row"]["display"], "second prompt edit");
        let payload = fixture.payload();
        let prompts = std::fs::read(fixture.home.join("history.jsonl")).unwrap();
        assert!(fixture.save(&first).is_err());
        assert_eq!(fixture.payload(), payload);
        assert_eq!(std::fs::read(fixture.home.join("history.jsonl")).unwrap(), prompts);
    }

    #[cfg(windows)]
    #[test]
    fn agy_edit_failed_prompt_replace_rolls_back_committed_assistant_blob() {
        use std::os::windows::fs::OpenOptionsExt;
        let fixture = Fixture::new(&assistant_payload("The original native assistant response survives a prompt replacement failure."), "{\"conversationId\":\"edit-fixture\",\"display\":\"original prompt\"}\n");
        let payload = fixture.payload();
        let prompt_path = fixture.home.join("history.jsonl");
        let history = std::fs::read(&prompt_path).unwrap();
        let mut edited = fixture.view();
        edited["steps"][0]["texts"][0]["text"] = json!("The native assistant edit must be rolled back if its prompt cannot be saved.");
        edited["prompts"][0]["row"]["display"] = json!("unsaved prompt edit");
        let held = std::cell::RefCell::new(None);
        let checkpoint = || {
            held.replace(Some(std::fs::OpenOptions::new().read(true).share_mode(1).open(&prompt_path).unwrap()));
        };
        let error = write_with_home_impl(&fixture.db, "edit-fixture", &edited.to_string(), &fixture.home, Some(&checkpoint)).unwrap_err();
        drop(held.into_inner());
        assert!(error.contains("Replace native Antigravity prompt history"), "{error}");
        assert_eq!(fixture.payload(), payload);
        assert_eq!(std::fs::read(&prompt_path).unwrap(), history);
        assert_eq!(fixture.view()["prompts"][0]["row"]["display"], "original prompt");
    }

    #[test]
    fn agy_edit_rejects_unreopenable_canonical_view_before_persisting() {
        let fixture = Fixture::new(&assistant_payload("A native assistant response retained when a large edit is rejected."), "{\"conversationId\":\"edit-fixture\",\"display\":\"original prompt\"}\n");
        let original = fixture.view();
        let payload = fixture.payload();
        let history = std::fs::read(fixture.home.join("history.jsonl")).unwrap();
        for (pointer, size) in [("/steps/0/texts/0/text", 30), ("/prompts/0/row/display", 33)] {
            let mut edited = original.clone();
            *edited.pointer_mut(pointer).unwrap() = json!("x".repeat(size * 1024 * 1024));
            let content = edited.to_string();
            assert!(content.len() < CAP);
            let error = write_with_home(&fixture.db, "edit-fixture", &content, &fixture.home).unwrap_err();
            assert!(error.contains("64 MiB"), "{error}");
            assert_eq!(fixture.payload(), payload);
            assert_eq!(std::fs::read(fixture.home.join("history.jsonl")).unwrap(), history);
            assert_eq!(fixture.view(), original);
        }
    }

    #[test]
    fn agy_edit_concurrent_conversations_keep_both_prompt_updates() {
        use std::sync::mpsc;
        use std::time::Duration;

        let fixture = Fixture::new(&assistant_payload("An original native assistant response shared by the test databases."), "{\"conversationId\":\"edit-fixture\",\"display\":\"first original\"}\n{\"conversationId\":\"second\",\"display\":\"second original\"}\n");
        let second_db = fixture.home.join("conversations/second.db");
        std::fs::copy(&fixture.db, &second_db).unwrap();
        let mut first = fixture.view();
        let mut second: Value = serde_json::from_str(&read_with_home(&second_db, "second", &fixture.home).unwrap()).unwrap();
        first["steps"][0]["texts"][0]["text"] = json!("The first conversation's edited native assistant response.");
        second["steps"][0]["texts"][0]["text"] = json!("The second conversation's edited native assistant response.");
        first["prompts"][0]["row"]["display"] = json!("first edited");
        second["prompts"][0]["row"]["display"] = json!("second edited");
        let (first_ready_tx, first_ready_rx) = mpsc::channel();
        let (first_release_tx, first_release_rx) = mpsc::channel();
        let (second_started_tx, second_started_rx) = mpsc::channel();
        let (second_ready_tx, second_ready_rx) = mpsc::channel();
        let (second_release_tx, second_release_rx) = mpsc::channel();
        let first_writer = {
            let db = fixture.db.clone();
            let home = fixture.home.clone();
            std::thread::spawn(move || {
                let checkpoint = || {
                    first_ready_tx.send(()).unwrap();
                    first_release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                };
                write_with_home_impl(&db, "edit-fixture", &first.to_string(), &home, Some(&checkpoint))
            })
        };
        first_ready_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let second_writer = {
            let db = second_db.clone();
            let home = fixture.home.clone();
            std::thread::spawn(move || {
                second_started_tx.send(()).unwrap();
                let checkpoint = || {
                    second_ready_tx.send(()).unwrap();
                    second_release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                };
                write_with_home_impl(&db, "second", &second.to_string(), &home, Some(&checkpoint))
            })
        };
        second_started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let interleaved = second_ready_rx.recv_timeout(Duration::from_millis(500)).is_ok();
        first_release_tx.send(()).unwrap();
        first_writer.join().unwrap().unwrap();
        second_release_tx.send(()).unwrap();
        second_writer.join().unwrap().unwrap();
        let first = fixture.view();
        let second: Value = serde_json::from_str(&read_with_home(&second_db, "second", &fixture.home).unwrap()).unwrap();
        assert_eq!(first["prompts"][0]["row"]["display"], "first edited");
        assert_eq!(second["prompts"][0]["row"]["display"], "second edited");
        assert_eq!(first["steps"][0]["texts"][0]["text"], "The first conversation's edited native assistant response.");
        assert_eq!(second["steps"][0]["texts"][0]["text"], "The second conversation's edited native assistant response.");
        assert!(!interleaved, "both writers passed the final prompt snapshot check before replacing the same source");
    }
}
