use super::{
    build_runtime_lifecycle_transition, RuntimeAcquireDisposition, RuntimeAcquireGate,
    RuntimeEndedRecord, RuntimeLifecycleState, RuntimeManager, RuntimeStartupState,
    RUNTIME_RECOVERY_MAX_CONSECUTIVE_FAILURES,
};
use crate::types::{AppSettings, WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
use std::sync::Arc;
use std::time::Duration;

fn workspace_entry(id: &str) -> WorkspaceEntry {
    let mut settings = WorkspaceSettings::default();
    settings.engine_type = Some("codex".to_string());
    WorkspaceEntry {
        id: id.to_string(),
        name: format!("Workspace {id}"),
        path: format!("/tmp/{id}"),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    }
}

#[test]
fn lifecycle_transition_contract_rejects_unsafe_shortcuts() {
    let allowed = build_runtime_lifecycle_transition(
        RuntimeLifecycleState::Active,
        RuntimeLifecycleState::Replacing,
        "replacement",
        None,
    );
    assert!(allowed.allowed);

    let explicit_retry = build_runtime_lifecycle_transition(
        RuntimeLifecycleState::Ended,
        RuntimeLifecycleState::Acquiring,
        "manual-reconnect",
        Some("runtime-ended".to_string()),
    );
    assert!(explicit_retry.allowed);

    let unsafe_shortcut = build_runtime_lifecycle_transition(
        RuntimeLifecycleState::Quarantined,
        RuntimeLifecycleState::Active,
        "automatic-send-retry",
        Some("recovery-quarantined".to_string()),
    );
    assert!(!unsafe_shortcut.allowed);
}

#[tokio::test]
async fn recovery_guard_quarantines_after_repeated_failures() {
    let manager = RuntimeManager::new(&std::env::temp_dir());

    for attempt in 1..RUNTIME_RECOVERY_MAX_CONSECUTIVE_FAILURES {
        let quarantined = manager
            .record_recovery_failure(
                "codex",
                "ws-1",
                "thread-list-live",
                &format!("boom-{attempt}"),
            )
            .await;
        assert!(quarantined.is_none());
    }

    let quarantined = manager
        .record_recovery_failure("codex", "ws-1", "thread-list-live", "boom-final")
        .await;
    let message = quarantined.expect("should enter quarantine");
    assert!(message.contains("[RUNTIME_RECOVERY_QUARANTINED]"));
    assert!(message.contains("boom-final"));

    let blocked = manager
        .recovery_quarantine_error("codex", "ws-1")
        .await
        .expect("quarantine should block immediate retry");
    assert!(blocked.contains("Retry after"));
}

#[tokio::test]
async fn recovery_guard_resets_after_success() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let _ = manager
        .record_recovery_failure("codex", "ws-1", "thread-list-live", "boom")
        .await;

    manager.record_recovery_success("codex", "ws-1").await;

    assert!(manager
        .recovery_quarantine_error("codex", "ws-1")
        .await
        .is_none());
    let next = manager
        .record_recovery_failure("codex", "ws-1", "thread-list-live", "boom-again")
        .await;
    assert!(next.is_none());
}

#[tokio::test]
async fn late_runtime_end_records_generation_guard_without_ending_active_row() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("ws-late-generation");
    manager
        .record_starting(&entry, "codex", "initial-create")
        .await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::ws-late-generation")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.pid = Some(2002);
        runtime.started_at_ms = Some(20);
        runtime.starting = false;
        runtime.startup_state = Some(RuntimeStartupState::Ready);
    }

    let recorded = manager
        .record_runtime_ended_for_session(
            "codex",
            "ws-late-generation",
            Some(1001),
            Some(10),
            RuntimeEndedRecord {
                reason_code: "runtime-ended".to_string(),
                message: Some("old runtime ended".to_string()),
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
        .find(|item| item.workspace_id == "ws-late-generation")
        .expect("runtime row should exist");
    assert_eq!(row.lifecycle_state, RuntimeLifecycleState::Active);
    assert_eq!(
        row.last_guard_state.as_deref(),
        Some("replacement-late-event")
    );
    assert_eq!(row.reason_code.as_deref(), Some("probe-failed"));
    assert_eq!(
        row.recovery_source.as_deref(),
        Some("replacement-late-event")
    );
}

#[tokio::test]
async fn stale_session_rejection_records_pre_probe_diagnostics() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("ws-pre-probe");
    manager
        .record_starting(&entry, "codex", "ensure-runtime-ready")
        .await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::ws-pre-probe")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
        runtime.startup_state = Some(RuntimeStartupState::Ready);
    }

    manager
        .note_stale_session_rejection(
            "codex",
            "ws-pre-probe",
            "ensure-runtime-ready",
            "manual-shutdown-requested",
        )
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "ws-pre-probe")
        .expect("runtime row should exist");

    assert_eq!(row.startup_state, Some(RuntimeStartupState::SuspectStale));
    assert_eq!(row.lifecycle_state, RuntimeLifecycleState::Active);
    assert_eq!(row.last_guard_state.as_deref(), Some("pre-probe-rejected"));
    assert_eq!(
        row.last_probe_failure.as_deref(),
        Some("manual-shutdown-requested"),
    );
    assert_eq!(
        row.last_probe_failure_source.as_deref(),
        Some("ensure-runtime-ready"),
    );
    assert_eq!(row.reason_code.as_deref(), Some("manual-shutdown"));
    assert_eq!(row.recovery_source.as_deref(), Some("ensure-runtime-ready"));
    assert!(!row.retryable);
    assert!(row.user_action.is_none());
}

#[tokio::test]
async fn explicit_acquire_resets_quarantine_for_fresh_retry_cycle() {
    let manager = RuntimeManager::new(&std::env::temp_dir());

    for attempt in 1..=RUNTIME_RECOVERY_MAX_CONSECUTIVE_FAILURES {
        let _ = manager
            .record_recovery_failure(
                "codex",
                "ws-explicit",
                "thread-list-live",
                &format!("boom-{attempt}"),
            )
            .await;
    }

    assert!(manager
        .recovery_quarantine_error("codex", "ws-explicit")
        .await
        .is_some());

    let acquire = manager
        .begin_runtime_acquire_or_retry_with_timeout(
            "codex",
            "ws-explicit",
            "explicit-connect",
            false,
            Duration::from_millis(10),
            "timed out waiting for concurrent runtime acquire",
        )
        .await
        .expect("explicit retry should bypass automatic quarantine");
    let token = match acquire {
        RuntimeAcquireDisposition::Leader(token) => token,
        RuntimeAcquireDisposition::Retry => panic!("explicit retry should take the leader slot"),
    };
    manager.finish_runtime_acquire(&token).await;
    assert!(manager
        .recovery_quarantine_error("codex", "ws-explicit")
        .await
        .is_none());
}

#[tokio::test]
async fn snapshot_surfaces_recovery_churn_context() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("snapshot");
    manager
        .record_starting(&entry, "codex", "workspace-restore")
        .await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::snapshot")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.pid = Some(4242);
        runtime.starting = false;
        runtime.startup_state = Some(RuntimeStartupState::Ready);
        runtime.last_replace_reason = Some("thread-list-live".to_string());
        runtime.has_stopping_predecessor = true;
        runtime.record_replace_event();
    }
    manager
        .note_guard_event("codex", "snapshot", "focus-refresh", "waiter")
        .await;
    manager
        .note_probe_failure("codex", "snapshot", "ensure-runtime-ready", "probe timeout")
        .await;
    manager
        .note_force_kill_for_runtime("codex", "snapshot")
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "snapshot")
        .expect("runtime row should exist");
    assert_eq!(row.startup_state, Some(RuntimeStartupState::SuspectStale));
    assert_eq!(row.lifecycle_state, RuntimeLifecycleState::Replacing);
    assert_eq!(
        row.last_recovery_source.as_deref(),
        Some("ensure-runtime-ready"),
    );
    assert_eq!(row.last_guard_state.as_deref(), Some("probe-failed"));
    assert_eq!(row.last_replace_reason.as_deref(), Some("thread-list-live"));
    assert_eq!(row.last_probe_failure.as_deref(), Some("probe timeout"));
    assert_eq!(
        row.last_probe_failure_source.as_deref(),
        Some("ensure-runtime-ready"),
    );
    assert_eq!(row.reason_code.as_deref(), Some("probe-failed"));
    assert_eq!(row.recovery_source.as_deref(), Some("ensure-runtime-ready"));
    assert_eq!(row.user_action.as_deref(), Some("wait"));
    assert!(row.has_stopping_predecessor);
    assert!(row.recent_spawn_count >= 1);
    assert!(row.recent_replace_count >= 1);
    assert!(row.recent_force_kill_count >= 1);
}

#[tokio::test]
async fn recovery_quarantine_projects_retryable_reconnect_action() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("ws-quarantine-projection");
    manager.record_starting(&entry, "codex", "startup").await;

    for attempt in 1..=RUNTIME_RECOVERY_MAX_CONSECUTIVE_FAILURES {
        let _ = manager
            .record_recovery_failure(
                "codex",
                "ws-quarantine-projection",
                "automatic-send-retry",
                &format!("boom-{attempt}"),
            )
            .await;
    }

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "ws-quarantine-projection")
        .expect("runtime row should exist");

    assert_eq!(row.lifecycle_state, RuntimeLifecycleState::Quarantined);
    assert_eq!(row.reason_code.as_deref(), Some("probe-failed"));
    assert_eq!(row.recovery_source.as_deref(), Some("automatic-send-retry"));
    assert!(row.retryable);
    assert_eq!(row.user_action.as_deref(), Some("reconnect"));
}

#[tokio::test]
async fn web_service_reconnect_refresh_is_exposed_as_recovery_source() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("ws-reconnect-source");
    manager.record_starting(&entry, "codex", "startup").await;
    {
        let mut entries = manager.entries.lock().await;
        let runtime = entries
            .get_mut("codex::ws-reconnect-source")
            .expect("runtime entry should exist");
        runtime.session_exists = true;
        runtime.starting = false;
        runtime.startup_state = Some(RuntimeStartupState::Ready);
    }

    manager
        .note_reconnect_refresh("codex", "ws-reconnect-source", "web-service-reconnected")
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "ws-reconnect-source")
        .expect("runtime row should exist");
    assert_eq!(row.lifecycle_state, RuntimeLifecycleState::Active);
    assert_eq!(row.last_guard_state.as_deref(), Some("reconnect-refresh"));
    assert_eq!(
        row.recovery_source.as_deref(),
        Some("web-service-reconnected")
    );
}

#[tokio::test]
async fn startup_probe_failure_stays_distinct_from_post_ready_stale() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let entry = workspace_entry("startup-pending");
    manager
        .record_starting(&entry, "codex", "workspace-restore")
        .await;
    manager
        .note_probe_failure(
            "codex",
            "startup-pending",
            "thread-list-live",
            "startup probe timeout",
        )
        .await;

    let snapshot = manager.snapshot(&AppSettings::default()).await;
    let row = snapshot
        .rows
        .iter()
        .find(|item| item.workspace_id == "startup-pending")
        .expect("runtime row should exist");

    assert_eq!(row.startup_state, Some(RuntimeStartupState::Starting));
    assert_eq!(row.last_guard_state.as_deref(), Some("probe-failed"));
    assert_eq!(
        row.last_probe_failure.as_deref(),
        Some("startup probe timeout")
    );
    assert_eq!(
        row.last_probe_failure_source.as_deref(),
        Some("thread-list-live"),
    );
}

#[tokio::test]
async fn begin_runtime_acquire_or_retry_retries_after_leader_finishes() {
    let manager = Arc::new(RuntimeManager::new(&std::env::temp_dir()));
    let leader = manager.begin_runtime_acquire("codex", "ws-1").await;
    let leader_token = match leader {
        RuntimeAcquireGate::Leader(token) => token,
        RuntimeAcquireGate::Waiter(_) => panic!("first acquire should become leader"),
    };

    let manager_for_finish = Arc::clone(&manager);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(10)).await;
        manager_for_finish
            .finish_runtime_acquire(&leader_token)
            .await;
    });

    let result = manager
        .begin_runtime_acquire_or_retry_with_timeout(
            "codex",
            "ws-1",
            "thread-list-live",
            true,
            Duration::from_millis(50),
            "timed out waiting for concurrent runtime acquire",
        )
        .await
        .expect("waiter should retry after leader finishes");
    assert_eq!(result, RuntimeAcquireDisposition::Retry);
    assert!(manager
        .recovery_quarantine_error("codex", "ws-1")
        .await
        .is_none());
}

#[tokio::test]
async fn lifecycle_coordinator_blocks_quarantined_automatic_acquire() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let coordinator = manager.lifecycle_coordinator();

    for attempt in 1..=RUNTIME_RECOVERY_MAX_CONSECUTIVE_FAILURES {
        let result = coordinator
            .record_recovering_failure(
                "codex",
                "ws-coordinator-quarantine",
                "automatic-send-retry",
                &format!("spawn failed {attempt}"),
            )
            .await;
        if attempt < RUNTIME_RECOVERY_MAX_CONSECUTIVE_FAILURES {
            assert!(result.is_ok());
        } else {
            assert!(result
                .expect_err("last failure should quarantine")
                .contains("[RUNTIME_RECOVERY_QUARANTINED]"));
        }
    }

    let blocked = coordinator
        .acquire_or_retry(
            "codex",
            "ws-coordinator-quarantine",
            "automatic-send-retry",
            true,
            "timed out waiting for concurrent runtime acquire",
        )
        .await
        .expect_err("automatic acquire should honor quarantine");

    assert!(blocked.contains("[RUNTIME_RECOVERY_QUARANTINED]"));
}

#[tokio::test]
async fn begin_runtime_acquire_or_retry_quarantines_after_repeated_waiter_timeouts() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let leader = manager.begin_runtime_acquire("codex", "ws-1").await;
    assert!(matches!(leader, RuntimeAcquireGate::Leader(_)));

    for _ in 1..=RUNTIME_RECOVERY_MAX_CONSECUTIVE_FAILURES {
        let result = manager
            .begin_runtime_acquire_or_retry_with_timeout(
                "codex",
                "ws-1",
                "thread-list-live",
                true,
                Duration::from_millis(200),
                "timed out waiting for concurrent runtime acquire",
            )
            .await;
        match result {
            Err(_) => break,
            Ok(RuntimeAcquireDisposition::Retry | RuntimeAcquireDisposition::Leader(_)) => {}
        }
        let mut startup_gates = manager.startup_gates.lock().await;
        let entry = startup_gates
            .get_mut("codex::ws-1")
            .expect("gate entry should remain present");
        entry.started_at_ms = super::now_millis();
    }

    let blocked = manager
        .ensure_recovery_ready("codex", "ws-1")
        .await
        .expect_err("repeated waiter timeouts should enter quarantine");
    assert!(blocked.contains("[RUNTIME_RECOVERY_QUARANTINED]"));
}

#[tokio::test]
async fn stale_runtime_acquire_can_be_taken_over_without_losing_new_gate() {
    let manager = RuntimeManager::new(&std::env::temp_dir());
    let leader = manager.begin_runtime_acquire("codex", "ws-1").await;
    let leader_token = match leader {
        RuntimeAcquireGate::Leader(token) => token,
        RuntimeAcquireGate::Waiter(_) => panic!("first acquire should become leader"),
    };

    {
        let mut startup_gates = manager.startup_gates.lock().await;
        let entry = startup_gates
            .get_mut("codex::ws-1")
            .expect("gate entry should exist");
        entry.started_at_ms = entry.started_at_ms.saturating_sub(100);
    }

    let takeover = manager
        .begin_runtime_acquire_or_retry_with_timeout(
            "codex",
            "ws-1",
            "thread-list-live",
            true,
            Duration::from_millis(5),
            "timed out waiting for concurrent runtime acquire",
        )
        .await
        .expect("stale waiter should take over");
    let takeover_token = match takeover {
        RuntimeAcquireDisposition::Leader(token) => token,
        RuntimeAcquireDisposition::Retry => panic!("stale waiter should become leader"),
    };

    manager.finish_runtime_acquire(&leader_token).await;
    assert!(manager.has_pending_acquire_for_engine("codex").await);

    manager.finish_runtime_acquire(&takeover_token).await;
    assert!(!manager.has_pending_acquire_for_engine("codex").await);
}
