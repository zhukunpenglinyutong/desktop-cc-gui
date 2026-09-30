//! IPC-level plan-approval tests for the P1 typed backbone (external-crate
//! scope): explicit plan requests fail closed for every engine; unknown or
//! stale plan submissions error instead of silently succeeding; a respond
//! whose native request is no longer parked reverts to pending without
//! reporting success; list_plan_reviews round-trips camelCase records.
//!
//! The delivered-frame paths (approve/changes write + conflict) live in
//! src/engine/mod.rs::plan_respond_tests because parking a native context
//! needs the pub(crate) registry insert. Seeding mirrors
//! engine::plan_review::REVIEW_COLUMNS (kept pub(crate) intentionally).

use ccgui_next_lib::config::ConfigStore;
use ccgui_next_lib::db::Db;
use ccgui_next_lib::engine::plan_review::PlanDecision;
use ccgui_next_lib::engine::{self, ProcessRegistry};
use ccgui_next_lib::event_sink::{EventSink, ENGINE_EVENT_NAME};
use ccgui_next_lib::AppState;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::{Listener, Manager};

/// Tests mutate process-global HOME; serialize them (same rationale as
/// send_path.rs — the std guard is held across awaits on purpose; a
/// parking_lot guard is not Send and cannot do that).
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn temp_home(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ccgui-plan-test-{}-{}", tag, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn build_app(home: &std::path::Path) -> tauri::App<tauri::test::MockRuntime> {
    std::env::set_var("HOME", home);
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let state = AppState {
        db: Arc::new(Db::open_at(&home.join("app.db")).unwrap()),
        sink: EventSink::new(Arc::new(app.handle().clone())),
        terminal_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::terminal::TERMINAL_OUTPUT_EVENT,
        ),
        plugin_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::event_sink::PLUGIN_AGENT_EVENT_NAME,
        ),
        mission_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::event_sink::MISSION_AGENT_EVENT_NAME,
        ),
        terminals: ccgui_next_lib::terminal::TerminalRegistry::default(),
        processes: Arc::new(ProcessRegistry::default()),
        emitters: ccgui_next_lib::event_sink::BroadcastEmit::new(Arc::new(app.handle().clone())),
        web: ccgui_next_lib::web::WebAccessState::default(),
        relay: ccgui_next_lib::relay::RelayState::default(),
        dsh_host: Arc::new(ccgui_next_lib::dsh_host::DshHostState::default()),
        opencode_server: std::sync::Arc::new(
            ccgui_next_lib::engine::opencode_server::OpencodeServerState::default(),
        ),
        worktree_creations: ccgui_next_lib::git_worktree::CreationRegistry::default(),
    };
    app.manage(state);
    app.manage(ConfigStore::default());
    // Drain engine events so the batched emitter never blocks a test.
    let handle = app.handle().clone();
    handle.listen_any(ENGINE_EVENT_NAME, |_event: tauri::Event| {});
    app
}

/// Insert an awaiting_review native_request record straight into the table.
/// Column list mirrors engine::plan_review::REVIEW_COLUMNS.
fn seed_review(db: &Db, plan_id: &str, engine_id: &str, session_id: &str, run_id: Option<&str>) {
    let conn = db.0.lock();
    conn.execute(
        "INSERT INTO plan_reviews (
             plan_id, engine, session_id, workspace_path, run_id,
             revision, title, content, content_hash, complete, review_kind,
             native_plan_id, exec_permission, status, execution, decision,
             decision_intent_at, applied_at, created_at, updated_at, superseded_by
         ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, 1, 'native_request',
                   ?9, 'auto', 'awaiting_review', 'not_started', NULL,
                   NULL, NULL, 1000, 1000, NULL)",
        rusqlite::params![
            plan_id,
            engine_id,
            session_id,
            "/tmp/ccgui-plan-ws",
            run_id,
            "Test plan",
            "# Plan\n\ndo the thing",
            "hash-of-plan",
            format!("native-{plan_id}"),
        ],
    )
    .unwrap();
}

fn review_status(db: &Db, plan_id: &str) -> (String, String, Option<String>) {
    let conn = db.0.lock();
    conn.query_row(
        "SELECT status, execution, decision FROM plan_reviews WHERE plan_id=?1 AND revision=1",
        rusqlite::params![plan_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        },
    )
    .unwrap()
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn plan_requests_fail_closed_for_unproven_engines() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let home = temp_home("fail-closed");
    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();
    let app = build_app(&home);

    // 未接通适配器的引擎(pi/grok/qoder 两发行版):显式 plan 请求在 spawn
    // 之前受控拒绝,错误说明真实原因,绝不降级 auto/bypass。
    for engine_id in ["pi", "grok", "qoder", "qoder-cn"] {
        let result = engine::send_message(
            app.state::<AppState>(),
            engine_id.to_string(),
            workspace.to_string_lossy().to_string(),
            None,
            "make a plan".to_string(),
            None,
            None,
            None,
            Some("plan".to_string()),
            None,
            None,
            None,
            None,
        )
        .await;
        let Err(message) = result else {
            panic!("{engine_id}: plan request must be refused before spawn");
        };
        assert!(
            message.contains("cannot run a human-approved plan"),
            "{engine_id}: {message}"
        );
    }

    // 已接通的引擎(omp=ACP native_request、codex=next_turn、dsh=host
    // plan-review)在 EngineInfo.plan 上声明 Typed 与对应生命周期;
    // 实际启动路径由各自适配器测试覆盖(这里不 spawn 真实 CLI)。
    let engines = engine::list_engines().await.expect("list_engines");
    for (id, kind) in [("omp", "native_request"), ("codex", "next_turn"), ("dsh", "native_request")] {
        let info = engines.iter().find(|e| e.id == id).expect(id);
        let engine::PlanApproval::Typed { review_kind, .. } = &info.plan else {
            panic!("{id} must declare a typed plan approval: {:?}", info.plan);
        };
        assert_eq!(review_kind.as_str(), kind, "{id}");
    }
    for id in ["pi", "grok", "qoder", "qoder-cn"] {
        let info = engines.iter().find(|e| e.id == id).expect(id);
        assert!(
            matches!(info.plan, engine::PlanApproval::Unavailable { .. }),
            "{id}: {:?}",
            info.plan
        );
    }
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn unknown_or_stale_plan_ids_are_errors_not_silent_success() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let home = temp_home("stale");
    let app = build_app(&home);
    let db = Arc::clone(&app.state::<AppState>().db);

    let missing = engine::respond_plan_review(
        app.state::<AppState>(),
        "no-such-plan".to_string(),
        1,
        PlanDecision::Approve,
        None,
    )
    .await;
    assert!(missing.is_err(), "unknown plan id must error");

    seed_review(&db, "plan-e", "codex", "sess-e", None);
    let stale = engine::respond_plan_review(
        app.state::<AppState>(),
        "plan-e".to_string(),
        99,
        PlanDecision::Approve,
        None,
    )
    .await;
    assert!(stale.is_err(), "a stale revision must error");
    let (status, _, _) = review_status(&db, "plan-e");
    assert_eq!(status, "awaiting_review");
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn a_missing_parked_request_reverts_without_reporting_success() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let home = temp_home("revert");
    let app = build_app(&home);
    let state = app.state::<AppState>();
    let db = Arc::clone(&state.db);

    // 记录存在但会话已不在运行(进程崩溃/重启):批准绝不显示成功,
    // 状态退回待审,决策意图留存待恢复。
    seed_review(&db, "plan-c", "dsh", "sess-c", None);
    let result = engine::respond_plan_review(
        state,
        "plan-c".to_string(),
        1,
        PlanDecision::Approve,
        None,
    )
    .await;
    let Err(message) = result else {
        panic!("a respond with no parked native request must fail");
    };
    assert!(
        message.contains("no running session holds this plan"),
        "{message}"
    );
    let (status, execution, decision) = review_status(&db, "plan-c");
    assert_eq!(status, "awaiting_review");
    assert_eq!(execution, "not_started");
    let decision = decision.expect("the decision intent stays recorded");
    assert!(decision.contains("approve"), "{decision}");
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn defer_applies_without_any_native_write() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let home = temp_home("defer");
    let app = build_app(&home);
    let state = app.state::<AppState>();
    let db = Arc::clone(&state.db);

    // 没有任何注册表条目:defer 是纯本地状态变化,原生等待点保持停着。
    seed_review(&db, "plan-d", "omp", "sess-d", Some("run-d"));
    let outcome = engine::respond_plan_review(
        state,
        "plan-d".to_string(),
        1,
        PlanDecision::Defer,
        None,
    )
    .await
    .expect("defer must apply");
    let engine::PlanRespondOutcome::Applied { review } = outcome else {
        panic!("defer must apply, got {outcome:?}");
    };
    assert_eq!(review.status, engine::plan_review::PlanStatus::Deferred);
    let (status, _, _) = review_status(&db, "plan-d");
    assert_eq!(status, "deferred");
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn list_plan_reviews_round_trips_camel_case_records() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let home = temp_home("list");
    let app = build_app(&home);
    let state = app.state::<AppState>();
    let db = Arc::clone(&state.db);
    seed_review(&db, "plan-f", "grok", "sess-f", None);

    let reviews = engine::list_plan_reviews(state, "grok".to_string(), "sess-f".to_string())
        .await
        .unwrap();
    assert_eq!(reviews.len(), 1);
    let review = &reviews[0];
    assert_eq!(review.plan_id, "plan-f");
    assert_eq!(
        review.review_kind,
        engine::plan_review::PlanReviewKind::NativeRequest
    );
    assert_eq!(review.exec_permission, "auto");
    assert!(review.complete);

    // IPC 边界形状:camelCase 字段名与前端 PlanReview 接口一一对应。
    let json: Value = serde_json::to_value(review).unwrap();
    for key in [
        "planId",
        "sessionId",
        "workspacePath",
        "contentHash",
        "reviewKind",
        "nativePlanId",
        "execPermission",
        "createdAt",
        "updatedAt",
        "supersededBy",
        "decisionIntentAt",
        "appliedAt",
    ] {
        assert!(
            json.get(key).is_some(),
            "missing camelCase key {key}: {json}"
        );
    }
    assert!(json.get("plan_id").is_none(), "{json}");
    assert_eq!(json["reviewKind"], "native_request");
    assert_eq!(json["status"], "awaiting_review");
}
