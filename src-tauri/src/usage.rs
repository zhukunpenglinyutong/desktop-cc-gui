//! Token-usage ledger for the settings usage page.
//!
//! Turns are recorded as they finish (the same `done` payload that stamps the
//! settled row), so the page counts what actually ran after the ledger was
//! switched on — no history is reconstructed, nothing leaves the machine, and
//! the numbers are the engines' own reports rather than estimates.

use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEntry {
    /// Epoch ms when the turn settled.
    pub ts: i64,
    pub engine: String,
    pub model: Option<String>,
    pub session_id: Option<String>,
    pub workspace_path: Option<String>,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub duration_ms: Option<i64>,
    /// Model responses this turn reported (>= 1): the request count.
    #[serde(default)]
    pub reports: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRow {
    /// Local day ("YYYY-MM-DD"); computed with the caller's UTC offset.
    pub day: String,
    pub engine: String,
    pub model: String,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    /// Model responses folded into this bucket (one prompt's tool loop counts
    /// each response), i.e. the request total.
    pub requests: i64,
}

/// Append one finished turn. A turn with no tokens (interrupted before the
/// engine reported) is not a ledger row — it would only add noise.
#[tauri::command]
pub fn usage_record(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    entry: UsageEntry,
) -> Result<(), String> {
    if entry.input + entry.output + entry.cache_read + entry.cache_write == 0 {
        return Ok(());
    }
    {
        let conn = state.db.0.lock();
        conn.execute(
            "INSERT INTO usage_ledger
               (ts, engine, model, session_id, workspace_path,
                input_tokens, output_tokens, cache_read, cache_write, duration_ms, reports)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                entry.ts,
                entry.engine,
                entry.model.unwrap_or_default(),
                entry.session_id,
                entry.workspace_path,
                entry.input,
                entry.output,
                entry.cache_read,
                entry.cache_write,
                entry.duration_ms,
                entry.reports.max(1),
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    // The page re-reads on this; the ledger is the only writer.
    let _ = app.emit("usage://changed", ());
    Ok(())
}

/// Per-(day, engine, model) totals. `days` is the local-day window; `0` means
/// the whole ledger (the 总和 range), and any other value keeps the last
/// `days` calendar days. `tz_offset_minutes` is the caller's UTC offset so
/// buckets match the calendar the user is looking at.
#[tauri::command]
pub fn usage_summary(
    state: tauri::State<'_, crate::AppState>,
    days: u32,
    tz_offset_minutes: i32,
) -> Result<Vec<UsageRow>, String> {
    let conn = state.db.0.lock();
    summarize(&conn, days, tz_offset_minutes).map_err(|e| e.to_string())
}

/// The ledger read behind `usage_summary`, split out so the day-window logic
/// (including the unbounded 总和 case) is unit-testable without a live app.
fn summarize(
    conn: &rusqlite::Connection,
    days: u32,
    tz_offset_minutes: i32,
) -> rusqlite::Result<Vec<UsageRow>> {
    let shift_ms = i64::from(tz_offset_minutes) * 60_000;
    // Bucketing happens in SQL so the whole ledger never crosses into Rust
    // for a daily view. The offset must be bound as a NUMBER: `date(x, …)`
    // yields NULL when x arrives as text. `days == 0` drops the lower bound
    // so 总和 spans every recorded turn; a finite window keeps the last
    // `days` calendar days (upper cap only guards against absurd inputs).
    let select = "SELECT date((ts + ?1) / 1000, 'unixepoch') AS day,
                    engine,
                    model,
                    SUM(input_tokens),
                    SUM(output_tokens),
                    SUM(cache_read),
                    SUM(cache_write),
                    SUM(reports)
             FROM usage_ledger";
    let tail = " GROUP BY day, engine, model
             ORDER BY day, engine, model";
    let map_row = |r: &rusqlite::Row| {
        Ok(UsageRow {
            day: r.get(0)?,
            engine: r.get(1)?,
            model: r.get::<_, String>(2).unwrap_or_default(),
            input: r.get(3)?,
            output: r.get(4)?,
            cache_read: r.get(5)?,
            cache_write: r.get(6)?,
            requests: r.get(7)?,
        })
    };
    if days == 0 {
        let mut stmt = conn.prepare(&format!("{select}{tail}"))?;
        let rows = stmt
            .query_map(rusqlite::params![shift_ms], map_row)?
            .collect();
        return rows;
    }
    let days = days.min(36_500) as i64;
    let mut stmt = conn.prepare(&format!("{select} WHERE day >= date('now', ?2){tail}"))?;
    let range_param = format!("-{} days", days - 1);
    let rows = stmt
        .query_map(rusqlite::params![shift_ms, range_param], map_row)?
        .collect();
    rows
}

/// Drop the whole ledger. The page offers this as an explicit reset; nothing
/// else reads the table.
#[tauri::command]
pub fn usage_clear(state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    let conn = state.db.0.lock();
    conn.execute("DELETE FROM usage_ledger", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// A ledger with the columns `summarize` reads; timestamps are supplied
    /// per row so the day-window boundary can be exercised deterministically.
    fn ledger() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE usage_ledger(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                engine TEXT NOT NULL,
                model TEXT NOT NULL DEFAULT '',
                session_id TEXT,
                workspace_path TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cache_read INTEGER NOT NULL DEFAULT 0,
                cache_write INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER,
                reports INTEGER NOT NULL DEFAULT 1
            );",
        )
        .unwrap();
        conn
    }

    fn insert(conn: &Connection, ts_ms: i64, input: i64) {
        conn.execute(
            "INSERT INTO usage_ledger(ts, engine, model, input_tokens, reports)
             VALUES(?1, 'omp', 'm', ?2, 1)",
            rusqlite::params![ts_ms, input],
        )
        .unwrap();
    }

    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    }

    const DAY_MS: i64 = 86_400_000;

    #[test]
    fn all_history_includes_rows_a_finite_window_drops() {
        let conn = ledger();
        let now = now_ms();
        // Today, and a turn from ~two years ago.
        insert(&conn, now, 100);
        insert(&conn, now - 730 * DAY_MS, 50);

        // A 30-day window sees only the recent turn.
        let recent = summarize(&conn, 30, 0).unwrap();
        assert_eq!(recent.len(), 1, "old turn is outside the 30-day window");
        assert_eq!(recent[0].input, 100);

        // days == 0 is 总和: every recorded turn, oldest included.
        let all = summarize(&conn, 0, 0).unwrap();
        let total: i64 = all.iter().map(|r| r.input).sum();
        assert_eq!(total, 150, "总和 spans the whole ledger");
    }

    #[test]
    fn a_year_window_reaches_past_the_old_365_day_cap() {
        let conn = ledger();
        let now = now_ms();
        // A turn 400 days back: excluded by 365, kept by a full-year request.
        insert(&conn, now - 400 * DAY_MS, 7);
        insert(&conn, now, 3);

        assert_eq!(
            summarize(&conn, 365, 0).unwrap().iter().map(|r| r.input).sum::<i64>(),
            3,
            "the 400-day-old turn is past a 365-day window",
        );
        assert_eq!(
            summarize(&conn, 500, 0).unwrap().iter().map(|r| r.input).sum::<i64>(),
            10,
            "a wider window is no longer clamped to 365 days",
        );
    }
}
