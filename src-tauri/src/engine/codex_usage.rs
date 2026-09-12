//! Live token usage for `codex exec` runs.
//!
//! The exec JSON stream (thread.started / turn.* / item.*) carries no usage
//! while a turn runs: the only usage in it arrives with `turn.completed`, so
//! a codex turn that chats for an hour used to show up only once it ended.
//! The CLI does report usage as it goes — into its own session log under
//! `$CODEX_HOME/sessions/<y>/<m>/<d>/rollout-<ts>-<thread_id>.jsonl` — so the
//! stdout reader tails that file and injects `usage` events into the run.
//!
//! The log also carries `token_count` snapshots, which repeat the same
//! numbers until the next response and therefore only feed the context
//! window; `token_usage_record` is the once-per-response report this tail
//! emits, so a turn's usage is the sum of its records.
//!
//! The tail starts at the file's end: `codex exec resume` appends to the
//! rollout the thread wrote the first time, so byte 0 is the thread's whole
//! history — reading from there ledgers every past response again on every
//! launch.

use serde_json::Value;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// One run's rollout tail: the byte offset already read plus the newest
/// context window seen (records do not carry one themselves).
#[derive(Debug)]
pub struct UsageTail {
    file: File,
    offset: u64,
    context_window: Option<i64>,
}

impl UsageTail {
    /// Open the rollout backing `thread_id`, reporting only what the CLI
    /// appends from here on. None until the CLI has created the file, so
    /// callers retry while the run streams.
    pub fn open(thread_id: &str) -> Option<Self> {
        let home = crate::engine::codex_home();
        Self::open_in(&home, thread_id)
    }

    fn open_in(home: &Path, thread_id: &str) -> Option<Self> {
        let mut file = File::open(rollout_path(home, thread_id)?).ok()?;
        // Anything already in the file belongs to earlier turns — a resumed
        // thread's rollout carries the entire thread. Start where the CLI
        // will write next; a half-written trailing line fails to parse and is
        // skipped, so starting mid-line costs nothing.
        let offset = file.seek(SeekFrom::End(0)).ok()?;
        Some(Self {
            file,
            offset,
            context_window: None,
        })
    }

    /// Usage reports appended since the previous call, oldest first. A partial
    /// trailing line stays unread until the CLI finishes writing it.
    pub fn poll(&mut self) -> Vec<Value> {
        let mut out = Vec::new();
        if self.file.seek(SeekFrom::Start(self.offset)).is_err() {
            return out;
        }
        let mut text = String::new();
        if self.file.read_to_string(&mut text).is_err() {
            return out;
        }
        let Some(last_newline) = text.rfind('\n') else {
            return out;
        };
        self.offset += last_newline as u64 + 1;
        for line in text[..last_newline].lines() {
            if let Some(usage) = self.line_usage(line) {
                out.push(usage);
            }
        }
        out
    }

    /// Usage one rollout line reported, if any.
    fn line_usage(&mut self, line: &str) -> Option<Value> {
        let value: Value = serde_json::from_str(line).ok()?;
        match value.get("type").and_then(Value::as_str)? {
            // One per model response: the response's own tokens, so a turn's
            // usage is the sum of its records.
            "token_usage_record" => {
                let usage = value.get("payload")?.get("usage")?;
                Some(self.with_window(usage))
            }
            // A context-only snapshot: its `last_token_usage` repeats until
            // the next response, so it updates the window and reports nothing.
            "event_msg" => {
                let payload = value.get("payload")?;
                if payload.get("type").and_then(Value::as_str) != Some("token_count") {
                    return None;
                }
                self.context_window = payload
                    .get("info")
                    .and_then(|info| info.get("model_context_window"))
                    .and_then(Value::as_i64)
                    .or(self.context_window);
                None
            }
            _ => None,
        }
    }

    /// Stamp the newest reported window onto a report: records carry none,
    /// and the context meter needs the denominator.
    fn with_window(&self, usage: &Value) -> Value {
        let mut usage = usage.clone();
        if let (Some(window), Some(object)) = (self.context_window, usage.as_object_mut()) {
            object
                .entry("model_context_window")
                .or_insert(Value::from(window));
        }
        usage
    }
}

/// Rollout file of `thread_id` under a codex home: `sessions/**` first, then
/// the archived tree (`codex exec resume` keeps the original file where it
/// was written, whatever day that was).
fn rollout_path(home: &Path, thread_id: &str) -> Option<PathBuf> {
    let suffix = format!("{thread_id}.jsonl");
    for root in [home.join("sessions"), home.join("archived_sessions")] {
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    stack.push(path);
                } else if path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(&suffix))
                {
                    return Some(path);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-codex-usage-{tag}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn record_line(input: i64, output: i64, total: i64) -> String {
        format!(
            "{}\n",
            serde_json::json!({
                "timestamp": "2026-09-11T01:00:00Z",
                "type": "token_usage_record",
                "payload": {
                    "thread_id": "t-1",
                    "usage": {
                        "input_tokens": input,
                        "cached_input_tokens": 400,
                        "cache_write_input_tokens": 500,
                        "output_tokens": output,
                        "total_tokens": total,
                    },
                    "turn_token_usage": { "input_tokens": input, "output_tokens": output },
                },
            })
        )
    }

    fn token_count_line(input: i64, output: i64, total: i64, window: i64) -> String {
        format!(
            "{}\n",
            serde_json::json!({
                "timestamp": "2026-09-11T01:00:00Z",
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "total_token_usage": { "input_tokens": 900, "output_tokens": 900 },
                        "last_token_usage": {
                            "input_tokens": input,
                            "output_tokens": output,
                            "total_tokens": total,
                        },
                        "model_context_window": window,
                    },
                },
            })
        )
    }

    /// A tail over a rollout file the test appends to, like the CLI does.
    fn tail_over(dir: &Path, thread_id: &str) -> (UsageTail, PathBuf) {
        let day = dir.join("sessions").join("2026").join("09").join("11");
        std::fs::create_dir_all(&day).unwrap();
        let path = day.join(format!("rollout-2026-09-11T01-00-00-{thread_id}.jsonl"));
        std::fs::File::create(&path).unwrap();
        let tail = UsageTail::open_in(dir, thread_id).expect("tail opens");
        (tail, path)
    }

    fn append(path: &Path, text: &str) {
        let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        file.write_all(text.as_bytes()).unwrap();
        file.flush().unwrap();
    }

    #[test]
    fn each_response_record_is_reported_once() {
        let dir = scratch("records");
        let (mut tail, path) = tail_over(&dir, "t-1");
        assert!(tail.poll().is_empty(), "nothing yet");

        append(&path, &record_line(1000, 40, 1040));
        append(&path, &record_line(2000, 60, 2060));
        let polled = tail.poll();
        assert_eq!(polled.len(), 2, "one report per response");
        assert_eq!(polled[0]["input_tokens"], 1000);
        assert_eq!(polled[0]["cached_input_tokens"], 400);
        assert_eq!(polled[0]["cache_write_input_tokens"], 500);
        assert_eq!(polled[1]["output_tokens"], 60);
        assert!(tail.poll().is_empty(), "already read");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// `codex exec resume` appends to the rollout the thread wrote the first
    /// time, so the file already holds every past response. One real thread's
    /// 47 MB rollout carried 771 records summing to 102M tokens; reading from
    /// byte 0 ledgered all of them again on every launch.
    #[test]
    fn history_already_in_the_rollout_is_not_reported() {
        let dir = scratch("resume");
        let day = dir.join("sessions").join("2026").join("09").join("11");
        std::fs::create_dir_all(&day).unwrap();
        let path = day.join("rollout-2026-09-11T01-00-00-t-4.jsonl");
        std::fs::write(
            &path,
            format!(
                "{}{}",
                record_line(9_000, 500, 9_500),
                record_line(8_000, 400, 8_400)
            ),
        )
        .unwrap();

        let mut tail = UsageTail::open_in(&dir, "t-4").expect("tail opens");
        assert!(
            tail.poll().is_empty(),
            "earlier turns are not this run's usage"
        );

        append(&path, &record_line(1_000, 40, 1_040));
        let polled = tail.poll();
        assert_eq!(polled.len(), 1, "only what was appended after open");
        assert_eq!(polled[0]["input_tokens"], 1_000);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn repeated_token_counts_do_not_become_reports() {
        let dir = scratch("counts");
        let (mut tail, path) = tail_over(&dir, "t-2");
        append(&path, &token_count_line(500, 10, 510, 258_400));
        append(&path, &token_count_line(500, 10, 510, 258_400));
        assert!(
            tail.poll().is_empty(),
            "token_count is a window update, not a report"
        );
        assert_eq!(tail.context_window, Some(258_400));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_record_carries_the_window_and_a_half_written_line_waits() {
        let dir = scratch("window");
        let (mut tail, path) = tail_over(&dir, "t-3");
        append(&path, &token_count_line(1, 1, 2, 258_400));
        let line = record_line(700, 30, 730);
        append(&path, &line[..line.len() - 6]);
        assert!(tail.poll().is_empty(), "partial line is not a report");

        append(&path, &line[line.len() - 6..]);
        let polled = tail.poll();
        assert_eq!(polled.len(), 1);
        assert_eq!(polled[0]["total_tokens"], 730);
        assert_eq!(polled[0]["model_context_window"], 258_400);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_rollout_is_found_by_thread_id_in_any_day() {
        let dir = scratch("lookup");
        let day = dir.join("sessions").join("2026").join("01").join("02");
        std::fs::create_dir_all(&day).unwrap();
        let wanted = day.join("rollout-2026-01-02T03-04-05-thread-abc.jsonl");
        std::fs::write(&wanted, "").unwrap();
        std::fs::write(day.join("rollout-2026-01-02T03-04-05-other.jsonl"), "").unwrap();
        assert_eq!(rollout_path(&dir, "thread-abc"), Some(wanted));
        assert_eq!(rollout_path(&dir, "missing"), None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
