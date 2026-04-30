use super::process_diagnostics::{
    cached_process_rows_with_loader, is_engine_root_process, parse_process_rows_unix_output,
    parse_process_rows_windows_payload, reset_process_rows_cache_for_tests, ProcessRowsLoadResult,
    ProcessSnapshotRow,
};
use super::{
    build_engine_observability, replace_workspace_session_with_source,
    replace_workspace_session_with_terminator, terminate_replaced_workspace_session,
    write_json_atomically, RuntimeEndedRecord, RuntimeEngineObservability, RuntimeManager,
    RuntimeProcessDiagnostics, RuntimeState,
};
use crate::backend::app_server::{
    dispose_test_workspace_session, make_test_workspace_session, RuntimeShutdownSource,
    WorkspaceSession,
};
use crate::types::{AppSettings, WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Notify};
use uuid::Uuid;

fn workspace_entry(id: &str) -> WorkspaceEntry {
    let mut settings = WorkspaceSettings::default();
    settings.engine_type = Some("codex".to_string());
    WorkspaceEntry {
        id: id.to_string(),
        name: format!("Workspace {id}"),
        path: std::env::temp_dir().join(id).display().to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    }
}

#[tokio::test]
async fn reconcile_never_marks_leased_runtime_evictable() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("leased");
    manager.record_starting(&entry, "codex", "test").await;
    manager.acquire_turn_lease(&entry, "codex", "turn:a").await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::leased")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
        runtime.last_used_at_ms = 0;
    }
    let mut settings = AppSettings::default();
    settings.codex_warm_ttl_seconds = 1;
    let candidates = manager.reconcile_pool(&settings).await;
    assert!(candidates.is_empty());
    let snapshot = manager.snapshot(&settings).await;
    assert!(matches!(snapshot.rows[0].state, RuntimeState::Acquired));
    assert!(snapshot.rows[0].active_work_protected);
}

#[tokio::test]
async fn reconcile_never_marks_thread_create_pending_runtime_evictable() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("thread-create-pending");
    manager.record_starting(&entry, "codex", "test").await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::thread-create-pending")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
        runtime.last_used_at_ms = 0;
    }
    manager
        .note_foreground_thread_create_pending(&entry, "codex", 30_000)
        .await;
    let mut settings = AppSettings::default();
    settings.codex_warm_ttl_seconds = 1;
    let candidates = manager.reconcile_pool(&settings).await;
    assert!(candidates.is_empty());
    let snapshot = manager.snapshot(&settings).await;
    assert!(matches!(
        snapshot.rows[0].state,
        RuntimeState::StartupPending
    ));
    assert!(snapshot.rows[0].active_work_protected);
}

#[tokio::test]
async fn manual_release_waits_for_active_work_protection() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("manual-release");
    manager.record_starting(&entry, "codex", "test").await;
    manager.acquire_turn_lease(&entry, "codex", "turn:a").await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::manual-release")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
    }

    manager
        .request_release_to_cold("codex", "manual-release")
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "manual-release")
        .expect("runtime row should exist");
    assert!(row.active_work_protected);
    assert_eq!(row.active_work_reason.as_deref(), Some("turn"));
    assert!(!row.evict_candidate);
    assert_eq!(
        row.eviction_reason.as_deref(),
        Some("manual-release-waiting-for-active-work"),
    );
    assert_eq!(snapshot.summary.active_work_protected_runtimes, 1);
}

#[tokio::test]
async fn abandoned_codex_turn_release_downgrades_active_work_protection() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("abandoned-turn-release");
    manager.record_starting(&entry, "codex", "test").await;
    manager
        .acquire_turn_lease(&entry, "codex", "turn:abandoned")
        .await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::abandoned-turn-release")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
    }

    manager
        .release_turn_lease("codex", "abandoned-turn-release", "turn:abandoned")
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "abandoned-turn-release")
        .expect("runtime row should exist");
    assert!(!row.active_work_protected);
    assert_eq!(row.turn_lease_count, 0);
    assert!(row.active_work_reason.is_none());

    manager
        .request_release_to_cold("codex", "abandoned-turn-release")
        .await;
    let release_snapshot = manager.snapshot(&AppSettings::default()).await;
    let release_row = release_snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "abandoned-turn-release")
        .expect("runtime row should exist after release request");
    assert!(release_row.evict_candidate);
    assert_eq!(
        release_row.eviction_reason.as_deref(),
        Some("manual-release")
    );
}

#[tokio::test]
async fn pin_intent_survives_runtime_row_removal_and_recreation() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("pin-recreate");

    manager.record_starting(&entry, "codex", "test").await;
    manager.pin_runtime("codex", "pin-recreate", true).await;
    manager.record_removed("codex", "pin-recreate").await;
    manager.record_starting(&entry, "codex", "recreate").await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "pin-recreate")
        .expect("recreated runtime row should exist");
    assert!(row.pinned);

    manager.pin_runtime("codex", "pin-recreate", false).await;
    manager.record_removed("codex", "pin-recreate").await;
    manager
        .record_starting(&entry, "codex", "after-unpin")
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "pin-recreate")
        .expect("recreated runtime row should exist after unpin");
    assert!(!row.pinned);
}

#[tokio::test]
async fn record_runtime_ended_clears_leases_and_persists_exit_diagnostics() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("ended");
    manager.record_starting(&entry, "codex", "test").await;
    manager.acquire_turn_lease(&entry, "codex", "turn:a").await;
    manager
        .acquire_stream_lease(&entry, "codex", "stream:a")
        .await;
    manager
        .note_foreground_resume_pending(
            &entry,
            "codex",
            "thread-1",
            Some("turn-1"),
            "queue-fusion-cutover",
            48_000,
        )
        .await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::ended")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
        runtime.pid = Some(4242);
    }

    manager
        .record_runtime_ended(
            "codex",
            "ended",
            RuntimeEndedRecord {
                reason_code: "process_exit".to_string(),
                message: Some(
                    "[RUNTIME_ENDED] Managed runtime process exited unexpectedly.".to_string(),
                ),
                exit_code: Some(9),
                exit_signal: Some("15".to_string()),
                pending_request_count: 2,
            },
        )
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "ended")
        .expect("runtime row should exist");
    assert!(!row.active_work_protected);
    assert_eq!(row.turn_lease_count, 0);
    assert_eq!(row.stream_lease_count, 0);
    assert!(row.foreground_work_state.is_none());
    assert!(row.foreground_work_source.is_none());
    assert_eq!(row.last_exit_reason_code.as_deref(), Some("process_exit"));
    assert_eq!(
        row.last_exit_message.as_deref(),
        Some("[RUNTIME_ENDED] Managed runtime process exited unexpectedly.")
    );
    assert_eq!(row.last_exit_code, Some(9));
    assert_eq!(row.last_exit_signal.as_deref(), Some("15"));
    assert_eq!(row.last_exit_pending_request_count, 2);
    assert_eq!(
        row.error.as_deref(),
        Some("[RUNTIME_ENDED] Managed runtime process exited unexpectedly."),
    );
    assert_eq!(row.pid, None);
}

#[tokio::test]
async fn record_runtime_ended_for_session_does_not_overwrite_successor_row() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let original_session = make_test_workspace_session("ended-successor").await;
    let successor_session = make_test_workspace_session("ended-successor").await;
    manager.record_ready(&original_session, "original").await;
    manager.record_ready(&successor_session, "successor").await;

    let recorded = manager
        .record_runtime_ended_for_session(
            "codex",
            "ended-successor",
            original_session.process_id,
            Some(original_session.started_at_ms),
            RuntimeEndedRecord {
                reason_code: "manual_shutdown".to_string(),
                message: Some("[RUNTIME_ENDED] old predecessor stopped".to_string()),
                exit_code: None,
                exit_signal: None,
                pending_request_count: 0,
            },
        )
        .await;

    assert!(!recorded);
    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "ended-successor")
        .expect("successor runtime row should exist");
    assert_eq!(row.pid, successor_session.process_id);
    assert!(row.last_exit_reason_code.is_none());
    assert!(row.error.is_none());

    dispose_test_workspace_session(&original_session).await;
    dispose_test_workspace_session(&successor_session).await;
}

#[tokio::test]
async fn same_pid_different_started_at_does_not_overwrite_or_borrow_successor_row() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let original_session = make_test_workspace_session("ended-same-pid-new-generation").await;
    let successor_session = make_test_workspace_session("ended-same-pid-new-generation").await;
    manager.record_ready(&original_session, "original").await;
    manager.record_ready(&successor_session, "successor").await;
    manager
        .acquire_turn_lease(
            &successor_session.entry,
            "codex",
            "turn:successor-generation",
        )
        .await;

    let successor_started_at_ms = successor_session.started_at_ms.saturating_add(10);
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::ended-same-pid-new-generation")
            .expect("successor runtime row should exist");
        runtime.pid = original_session.process_id;
        runtime.started_at_ms = Some(successor_started_at_ms);
    }

    assert!(
        !manager
            .has_active_work_protection_for_session(
                "codex",
                "ended-same-pid-new-generation",
                original_session.process_id,
                Some(original_session.started_at_ms),
            )
            .await
    );

    let recorded = manager
        .record_runtime_ended_for_session(
            "codex",
            "ended-same-pid-new-generation",
            original_session.process_id,
            Some(original_session.started_at_ms),
            RuntimeEndedRecord {
                reason_code: "manual_shutdown".to_string(),
                message: Some("[RUNTIME_ENDED] old generation stopped".to_string()),
                exit_code: None,
                exit_signal: None,
                pending_request_count: 0,
            },
        )
        .await;

    assert!(!recorded);
    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "ended-same-pid-new-generation")
        .expect("successor runtime row should exist");
    assert_eq!(row.pid, original_session.process_id);
    assert_eq!(row.started_at_ms, Some(successor_started_at_ms));
    let expected_generation = match original_session.process_id {
        Some(pid) => format!("pid:{pid}:startedAt:{successor_started_at_ms}"),
        None => format!("pid:unknown:startedAt:{successor_started_at_ms}"),
    };
    assert_eq!(
        row.runtime_generation.as_deref(),
        Some(expected_generation.as_str())
    );
    assert!(row.active_work_protected);
    assert!(row.last_exit_reason_code.is_none());
    assert!(row.error.is_none());

    dispose_test_workspace_session(&original_session).await;
    dispose_test_workspace_session(&successor_session).await;
}

#[tokio::test]
async fn unknown_session_pid_does_not_overwrite_or_borrow_successor_row() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let successor_session = make_test_workspace_session("ended-unknown-pid").await;
    manager.record_ready(&successor_session, "successor").await;
    manager
        .acquire_turn_lease(&successor_session.entry, "codex", "turn:successor")
        .await;

    assert!(
        !manager
            .has_active_work_protection_for_session("codex", "ended-unknown-pid", None, None)
            .await
    );

    let recorded = manager
        .record_runtime_ended_for_session(
            "codex",
            "ended-unknown-pid",
            None,
            None,
            RuntimeEndedRecord {
                reason_code: "manual_shutdown".to_string(),
                message: Some("[RUNTIME_ENDED] unknown predecessor stopped".to_string()),
                exit_code: None,
                exit_signal: None,
                pending_request_count: 0,
            },
        )
        .await;

    assert!(!recorded);
    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "ended-unknown-pid")
        .expect("successor runtime row should exist");
    assert_eq!(row.pid, successor_session.process_id);
    assert!(row.active_work_protected);
    assert!(row.last_exit_reason_code.is_none());
    assert!(row.error.is_none());
    assert_eq!(snapshot.diagnostics.runtime_end_diagnostics_recorded, 1);

    dispose_test_workspace_session(&successor_session).await;
}

#[tokio::test]
async fn runtime_end_diagnostics_survive_runtime_row_removal() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("ended-removed");
    manager.record_starting(&entry, "codex", "test").await;
    manager
        .record_runtime_ended(
            "codex",
            "ended-removed",
            RuntimeEndedRecord {
                reason_code: "manual_shutdown".to_string(),
                message: Some("[RUNTIME_ENDED] expected cleanup".to_string()),
                exit_code: None,
                exit_signal: None,
                pending_request_count: 0,
            },
        )
        .await;
    manager.record_removed("codex", "ended-removed").await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    assert!(snapshot.rows.is_empty());
    assert_eq!(snapshot.diagnostics.runtime_end_diagnostics_recorded, 1);
    assert_eq!(
        snapshot.diagnostics.last_runtime_end_reason_code.as_deref(),
        Some("manual_shutdown")
    );
    assert_eq!(
        snapshot.diagnostics.last_runtime_end_message.as_deref(),
        Some("[RUNTIME_ENDED] expected cleanup")
    );
    assert_eq!(
        snapshot
            .diagnostics
            .last_runtime_end_workspace_id
            .as_deref(),
        Some("ended-removed")
    );
    assert_eq!(
        snapshot.diagnostics.last_runtime_end_engine.as_deref(),
        Some("codex")
    );
}

#[tokio::test]
async fn claude_stream_activity_touch_protects_runtime_without_ledger_persist() {
    let temp_dir = std::env::temp_dir().join(format!("ccgui-runtime-touch-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("create temp dir");
    let manager = RuntimeManager::new(&temp_dir);
    let entry = workspace_entry("claude-touch");

    manager
        .touch_claude_turn_activity(&entry, "turn:claude-1")
        .await;
    manager
        .touch_claude_stream_activity(&entry, "stream:claude-1")
        .await;
    manager
        .touch_claude_stream_activity(&entry, "stream:claude-1")
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "claude-touch")
        .expect("claude runtime row should exist");
    assert!(row.active_work_protected);
    assert_eq!(row.turn_lease_count, 1);
    assert_eq!(row.stream_lease_count, 1);
    assert_eq!(row.wrapper_kind.as_deref(), Some("claude-cli"));
    assert!(
        !temp_dir.join("runtime-pool-ledger.json").exists(),
        "activity touch must not durably persist each stream delta"
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn delayed_claude_runtime_sync_does_not_resurrect_released_turn() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("claude-stale-sync");
    manager
        .touch_claude_turn_activity(&entry, "turn:stale")
        .await;
    manager.record_removed("claude", "claude-stale-sync").await;

    manager
        .sync_claude_runtime_if_source_active(&entry, &[4242], "turn:stale")
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    assert!(
        snapshot
            .rows
            .iter()
            .all(|row| row.workspace_id != "claude-stale-sync"),
        "stale background sync must not recreate a removed Claude runtime"
    );
}

#[tokio::test]
async fn claude_terminal_release_preserves_newer_active_turn_leases() {
    let temp_dir = std::env::temp_dir().join(format!("ccgui-runtime-release-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("create temp dir");
    let manager = RuntimeManager::new(&temp_dir);
    let entry = workspace_entry("claude-release-race");

    manager.touch_claude_turn_activity(&entry, "turn:old").await;
    manager
        .touch_claude_stream_activity(&entry, "stream:old")
        .await;
    manager.touch_claude_turn_activity(&entry, "turn:new").await;
    manager
        .touch_claude_stream_activity(&entry, "stream:new")
        .await;

    manager
        .release_claude_terminal_activity("claude-release-race", "turn:old", "stream:old")
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "claude-release-race")
        .expect("newer active Claude runtime row should survive old terminal release");
    assert!(row.active_work_protected);
    assert_eq!(row.turn_lease_count, 1);
    assert_eq!(row.stream_lease_count, 1);
    assert_eq!(row.lease_sources, vec!["turn:new", "stream:new"]);

    manager
        .release_claude_terminal_activity("claude-release-race", "turn:new", "stream:new")
        .await;
    let settled = manager.snapshot(&AppSettings::default()).await;
    assert!(
        settled
            .rows
            .iter()
            .all(|row| row.workspace_id != "claude-release-race"),
        "last terminal release should remove the idle Claude runtime row"
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn process_rows_cache_reuses_fresh_snapshot_and_preserves_stale_on_degrade() {
    reset_process_rows_cache_for_tests();
    let calls = AtomicU64::new(0);
    let first_row = ProcessSnapshotRow {
        pid: 100,
        ppid: 1,
        command: "node.exe".to_string(),
        args: "node claude".to_string(),
    };

    let (first, first_reason) = cached_process_rows_with_loader(Duration::from_secs(60), || {
        calls.fetch_add(1, Ordering::SeqCst);
        ProcessRowsLoadResult::Fresh(vec![first_row.clone()])
    });
    let (second, second_reason) = cached_process_rows_with_loader(Duration::from_secs(60), || {
        calls.fetch_add(1, Ordering::SeqCst);
        ProcessRowsLoadResult::Fresh(Vec::new())
    });

    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(first_reason.is_none());
    assert!(second_reason.is_none());
    assert_eq!(first.expect("first rows")[0].pid, 100);
    assert_eq!(second.expect("second rows")[0].pid, 100);

    let (stale, stale_reason) = cached_process_rows_with_loader(Duration::ZERO, || {
        calls.fetch_add(1, Ordering::SeqCst);
        ProcessRowsLoadResult::Degraded("snapshot-timeout")
    });
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(stale_reason, Some("snapshot-timeout"));
    assert_eq!(stale.expect("stale rows")[0].pid, 100);

    reset_process_rows_cache_for_tests();
    let concurrent_calls = Arc::new(AtomicU64::new(0));
    let mut workers = Vec::new();
    let started_at = Instant::now();

    for _ in 0..2 {
        let concurrent_calls = Arc::clone(&concurrent_calls);
        workers.push(std::thread::spawn(move || {
            cached_process_rows_with_loader(Duration::from_secs(60), || {
                concurrent_calls.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(40));
                ProcessRowsLoadResult::Fresh(vec![ProcessSnapshotRow {
                    pid: 200,
                    ppid: 1,
                    command: "powershell.exe".to_string(),
                    args: "Get-CimInstance".to_string(),
                }])
            })
            .0
            .expect("rows should resolve")
        }));
    }

    let results = workers
        .into_iter()
        .map(|worker| worker.join().expect("worker join"))
        .collect::<Vec<_>>();

    assert_eq!(concurrent_calls.load(Ordering::SeqCst), 1);
    assert!(started_at.elapsed() >= Duration::from_millis(40));
    assert_eq!(results[0][0].pid, 200);
    assert_eq!(results[1][0].pid, 200);
}

#[tokio::test]
async fn terminal_turn_events_clear_foreground_resume_pending_continuity() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("resume-pending-terminal");
    manager.record_starting(&entry, "codex", "test").await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::resume-pending-terminal")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
    }

    manager
        .note_foreground_resume_pending(
            &entry,
            "codex",
            "thread-1",
            Some("turn-1"),
            "queue-fusion-cutover",
            48_000,
        )
        .await;
    manager
        .handle_codex_runtime_event(
            &entry,
            &json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1"
                }
            }),
        )
        .await;

    let completed_snapshot = manager.snapshot(&AppSettings::default()).await;
    let completed_row = completed_snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "resume-pending-terminal")
        .expect("runtime row should exist");
    assert!(completed_row.foreground_work_state.is_none());
    assert!(completed_row.foreground_work_source.is_none());

    manager
        .note_foreground_resume_pending(
            &entry,
            "codex",
            "thread-1",
            Some("turn-1"),
            "queue-fusion-cutover",
            48_000,
        )
        .await;
    manager
        .handle_codex_runtime_event(
            &entry,
            &json!({
                "method": "turn/error",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1"
                }
            }),
        )
        .await;

    let errored_snapshot = manager.snapshot(&AppSettings::default()).await;
    let errored_row = errored_snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "resume-pending-terminal")
        .expect("runtime row should exist");
    assert!(errored_row.foreground_work_state.is_none());
    assert!(errored_row.foreground_work_source.is_none());
}

#[tokio::test]
async fn settle_foreground_work_timeout_releases_resume_pending_protection_but_keeps_recent_diagnostics(
) {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("resume-pending-timeout");
    manager.record_starting(&entry, "codex", "test").await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::resume-pending-timeout")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
    }

    manager
        .note_foreground_resume_pending(
            &entry,
            "codex",
            "thread-1",
            Some("turn-1"),
            "user-input-resume",
            48_000,
        )
        .await;
    manager
        .settle_foreground_work_timeout(
            "codex",
            "resume-pending-timeout",
            Some("thread-1"),
            Some("turn-1"),
            "user-input-resume",
            "resume-pending-timeout",
        )
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "resume-pending-timeout")
        .expect("runtime row should exist");
    assert!(!row.active_work_protected);
    assert_eq!(row.state, RuntimeState::GracefulIdle);
    assert!(row.foreground_work_state.is_none());
    assert!(row.foreground_work_source.is_none());
    assert_eq!(
        row.last_recovery_source.as_deref(),
        Some("user-input-resume")
    );
    assert_eq!(
        row.last_guard_state.as_deref(),
        Some("resume-pending-timeout")
    );
}

#[tokio::test]
async fn settle_foreground_work_timeout_ignores_mismatched_turn_identity() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("resume-pending-timeout-mismatch");
    manager.record_starting(&entry, "codex", "test").await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::resume-pending-timeout-mismatch")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
    }

    manager
        .note_foreground_resume_pending(
            &entry,
            "codex",
            "thread-1",
            Some("turn-1"),
            "queue-fusion-cutover",
            48_000,
        )
        .await;
    manager
        .settle_foreground_work_timeout(
            "codex",
            "resume-pending-timeout-mismatch",
            Some("thread-1"),
            Some("turn-2"),
            "queue-fusion-cutover",
            "fusion-resume-pending-timeout",
        )
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "resume-pending-timeout-mismatch")
        .expect("runtime row should exist");
    assert!(row.active_work_protected);
    assert_eq!(row.state, RuntimeState::ResumePending);
    assert_eq!(
        row.foreground_work_source.as_deref(),
        Some("queue-fusion-cutover")
    );
    assert_ne!(
        row.last_guard_state.as_deref(),
        Some("fusion-resume-pending-timeout")
    );
}

#[tokio::test]
async fn reconcile_marks_old_idle_runtime_evictable() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("idle");
    manager.record_starting(&entry, "codex", "test").await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::idle")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
        runtime.last_used_at_ms = 0;
    }
    let mut settings = AppSettings::default();
    settings.codex_warm_ttl_seconds = 1;
    let candidates = manager.reconcile_pool(&settings).await;
    assert_eq!(candidates.len(), 1);
    let snapshot = manager.snapshot(&settings).await;
    assert!(matches!(snapshot.rows[0].state, RuntimeState::Evictable));
}

#[tokio::test]
async fn replacement_waiter_does_not_swap_in_a_third_runtime() {
    let runtime_manager = Arc::new(RuntimeManager::new(&std::env::temp_dir()));
    let sessions: Arc<Mutex<HashMap<String, Arc<WorkspaceSession>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let workspace_id = "replacement-serial".to_string();

    let original_session = make_test_workspace_session(&workspace_id).await;
    original_session.attach_runtime_manager(Arc::clone(&runtime_manager));
    runtime_manager
        .record_ready(&original_session, "initial-runtime")
        .await;
    sessions
        .lock()
        .await
        .insert(workspace_id.clone(), Arc::clone(&original_session));

    let first_successor = make_test_workspace_session(&workspace_id).await;
    first_successor.attach_runtime_manager(Arc::clone(&runtime_manager));
    let suppressed_successor = make_test_workspace_session(&workspace_id).await;
    suppressed_successor.attach_runtime_manager(Arc::clone(&runtime_manager));

    let replacement_started = Arc::new(Notify::new());
    let allow_replacement_to_finish = Arc::new(Notify::new());
    let suppressed_terminator_calls = Arc::new(AtomicU64::new(0));

    let first_task = {
        let replacement_started = Arc::clone(&replacement_started);
        let allow_replacement_to_finish = Arc::clone(&allow_replacement_to_finish);
        let workspace_id = workspace_id.clone();
        let first_successor = Arc::clone(&first_successor);
        let runtime_manager = Arc::clone(&runtime_manager);
        let sessions = Arc::clone(&sessions);
        tokio::spawn(async move {
            replace_workspace_session_with_terminator(
                sessions.as_ref(),
                Some(runtime_manager.as_ref()),
                workspace_id,
                first_successor,
                "ensure-runtime-ready",
                move |old_session, runtime_manager| {
                    let replacement_started = Arc::clone(&replacement_started);
                    let allow_replacement_to_finish = Arc::clone(&allow_replacement_to_finish);
                    Box::pin(async move {
                        replacement_started.notify_one();
                        allow_replacement_to_finish.notified().await;
                        terminate_replaced_workspace_session(old_session, runtime_manager).await
                    })
                },
                RuntimeShutdownSource::InternalReplacement,
            )
            .await
        })
    };

    replacement_started.notified().await;

    let snapshot_during_replacement = runtime_manager.snapshot(&AppSettings::default()).await;
    let row_during_replacement = snapshot_during_replacement
        .rows
        .iter()
        .find(|item| item.workspace_id == workspace_id)
        .expect("replacement row should exist");
    assert!(row_during_replacement.has_stopping_predecessor);
    assert_eq!(
        row_during_replacement.last_replace_reason.as_deref(),
        Some("ensure-runtime-ready"),
    );

    let second_task = {
        let workspace_id = workspace_id.clone();
        let suppressed_successor = Arc::clone(&suppressed_successor);
        let runtime_manager = Arc::clone(&runtime_manager);
        let suppressed_terminator_calls = Arc::clone(&suppressed_terminator_calls);
        let sessions = Arc::clone(&sessions);
        tokio::spawn(async move {
            replace_workspace_session_with_terminator(
                sessions.as_ref(),
                Some(runtime_manager.as_ref()),
                workspace_id,
                suppressed_successor,
                "focus-refresh",
                move |old_session, runtime_manager| {
                    suppressed_terminator_calls.fetch_add(1, Ordering::SeqCst);
                    Box::pin(async move {
                        terminate_replaced_workspace_session(old_session, runtime_manager).await
                    })
                },
                RuntimeShutdownSource::InternalReplacement,
            )
            .await
        })
    };

    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(suppressed_terminator_calls.load(Ordering::SeqCst), 0);
    let current_during_replacement = sessions
        .lock()
        .await
        .get(&workspace_id)
        .cloned()
        .expect("successor should stay active during replacement");
    assert!(Arc::ptr_eq(&current_during_replacement, &first_successor));

    allow_replacement_to_finish.notify_one();

    first_task
        .await
        .expect("first replacement join should succeed")
        .expect("first replacement should succeed");
    second_task
        .await
        .expect("second replacement join should succeed")
        .expect("waiter replacement should settle without swapping");

    assert_eq!(suppressed_terminator_calls.load(Ordering::SeqCst), 0);
    let current_after_replacement = sessions
        .lock()
        .await
        .get(&workspace_id)
        .cloned()
        .expect("successor should remain registered");
    assert!(Arc::ptr_eq(&current_after_replacement, &first_successor));

    let suppressed_exit = {
        let mut child = suppressed_successor.child.lock().await;
        child
            .try_wait()
            .expect("suppressed successor should be inspectable")
    };
    assert!(
        suppressed_exit.is_some(),
        "suppressed successor should be disposed instead of becoming a third runtime",
    );

    let settled_snapshot = runtime_manager.snapshot(&AppSettings::default()).await;
    let settled_row = settled_snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == workspace_id)
        .expect("settled row should exist");
    assert!(!settled_row.has_stopping_predecessor);

    dispose_test_workspace_session(&current_after_replacement).await;
}

#[tokio::test]
async fn replace_workspace_session_with_source_marks_old_session_shutdown_source() {
    let sessions: Arc<Mutex<HashMap<String, Arc<WorkspaceSession>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let workspace_id = "replacement-settings-source".to_string();

    let original_session = make_test_workspace_session(&workspace_id).await;
    let replacement_session = make_test_workspace_session(&workspace_id).await;
    sessions
        .lock()
        .await
        .insert(workspace_id.clone(), Arc::clone(&original_session));

    replace_workspace_session_with_source(
        sessions.as_ref(),
        None,
        workspace_id.clone(),
        Arc::clone(&replacement_session),
        "settings-restart",
        RuntimeShutdownSource::SettingsRestart,
    )
    .await
    .expect("settings replacement should succeed");

    assert_eq!(
        original_session.shutdown_source(),
        Some(RuntimeShutdownSource::SettingsRestart)
    );

    dispose_test_workspace_session(&original_session).await;
    dispose_test_workspace_session(&replacement_session).await;
}

#[test]
fn engine_observability_uses_tracked_snapshot_fields() {
    let rows = vec![super::RuntimePoolRow {
        workspace_id: "workspace-a".to_string(),
        workspace_name: "Workspace A".to_string(),
        workspace_path: std::env::temp_dir()
            .join("workspace-a")
            .display()
            .to_string(),
        engine: "codex".to_string(),
        state: RuntimeState::Acquired,
        pid: Some(4242),
        runtime_generation: Some("pid:4242:startedAt:1".to_string()),
        wrapper_kind: Some("node".to_string()),
        resolved_bin: Some("/opt/homebrew/bin/codex".to_string()),
        started_at_ms: Some(1),
        last_used_at_ms: 2,
        pinned: false,
        turn_lease_count: 1,
        stream_lease_count: 0,
        lease_sources: vec!["turn:test".to_string()],
        active_work_protected: true,
        active_work_reason: Some("turn".to_string()),
        active_work_since_ms: Some(1),
        active_work_last_renewed_at_ms: Some(2),
        foreground_work_state: None,
        foreground_work_source: None,
        foreground_work_thread_id: None,
        foreground_work_turn_id: None,
        foreground_work_since_ms: None,
        foreground_work_timeout_at_ms: None,
        foreground_work_last_event_at_ms: None,
        foreground_work_timed_out: false,
        evict_candidate: false,
        eviction_reason: None,
        error: None,
        last_exit_reason_code: None,
        last_exit_message: None,
        last_exit_at_ms: None,
        last_exit_code: None,
        last_exit_signal: None,
        last_exit_pending_request_count: 0,
        process_diagnostics: Some(RuntimeProcessDiagnostics {
            root_processes: 1,
            total_processes: 2,
            node_processes: 1,
            root_command: Some("node".to_string()),
            managed_runtime_processes: 1,
            resume_helper_processes: 0,
            orphan_residue_processes: 0,
        }),
        startup_state: Some(super::RuntimeStartupState::Ready),
        last_recovery_source: Some("thread-list-live".to_string()),
        last_guard_state: Some("ready".to_string()),
        last_replace_reason: None,
        last_probe_failure: None,
        last_probe_failure_source: None,
        has_stopping_predecessor: false,
        recent_spawn_count: 1,
        recent_replace_count: 0,
        recent_force_kill_count: 0,
    }];

    let observability = build_engine_observability(&rows);
    let codex = observability
        .into_iter()
        .find(|item| item.engine == "codex")
        .unwrap_or(RuntimeEngineObservability {
            engine: "codex".to_string(),
            session_count: 0,
            tracked_root_processes: 0,
            tracked_total_processes: 0,
            tracked_node_processes: 0,
            host_managed_root_processes: 0,
            host_unmanaged_root_processes: 0,
            external_root_processes: 0,
            host_unmanaged_total_processes: 0,
            external_total_processes: 0,
        });

    assert_eq!(codex.session_count, 1);
    assert_eq!(codex.tracked_root_processes, 1);
    assert_eq!(codex.tracked_total_processes, 2);
    assert_eq!(codex.tracked_node_processes, 1);
}

#[test]
fn codex_root_detector_ignores_vendor_child() {
    let root = ProcessSnapshotRow {
        pid: 100,
        ppid: 1,
        command: "node".to_string(),
        args: "node /opt/homebrew/bin/codex app-server".to_string(),
    };
    let vendor_child = ProcessSnapshotRow {
        pid: 101,
        ppid: 100,
        command: "codex".to_string(),
        args: "/vendor/codex app-server".to_string(),
    };
    let rows_by_pid = [(100, &root), (101, &vendor_child)]
        .into_iter()
        .collect::<std::collections::HashMap<_, _>>();

    assert!(is_engine_root_process("codex", &root, &rows_by_pid));
    assert!(!is_engine_root_process(
        "codex",
        &vendor_child,
        &rows_by_pid
    ));
}

#[test]
fn parse_process_rows_unix_output_skips_malformed_rows() {
    let rows = parse_process_rows_unix_output(
        "100 1 node node /opt/homebrew/bin/codex app-server\ninvalid row\n101 100 codex /vendor/codex app-server\n",
    );

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].pid, 100);
    assert_eq!(rows[0].ppid, 1);
    assert_eq!(rows[0].command, "node");
    assert!(rows[0].args.contains("codex app-server"));
}

#[test]
fn parse_process_rows_windows_payload_reads_command_line() {
    let rows = parse_process_rows_windows_payload(&json!([
        {
            "ProcessId": 200,
            "ParentProcessId": 50,
            "Name": "node.exe",
            "CommandLine": "\"C:\\\\Program Files\\\\node.exe\" C:\\\\Users\\\\demo\\\\codex app-server"
        },
        {
            "ProcessId": 201,
            "ParentProcessId": 200,
            "Name": "codex.exe",
            "CommandLine": null
        }
    ]));

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].pid, 200);
    assert_eq!(rows[0].command, "node.exe");
    assert!(rows[0].args.contains("codex app-server"));
    assert_eq!(rows[1].args, "codex.exe");
}

#[test]
fn write_json_atomically_replaces_existing_file() {
    let temp_dir = std::env::temp_dir().join(format!("ccgui-runtime-ledger-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("create temp dir");
    let path = temp_dir.join("runtime-pool-ledger.json");

    fs::write(&path, "{\"old\":true}").expect("seed existing file");
    write_json_atomically(&path, "{\"new\":true}").expect("replace existing file");

    let persisted = fs::read_to_string(&path).expect("read persisted file");
    assert_eq!(persisted, "{\"new\":true}");

    let _ = fs::remove_dir_all(&temp_dir);
}
