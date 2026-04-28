use super::*;
use crate::types::{WorkspaceKind, WorkspaceSettings};
use chrono::NaiveDateTime;
use std::io::Write;
use std::path::Path;
use std::{fs, path::PathBuf};
use uuid::Uuid;

fn write_temp_jsonl(lines: &[&str]) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("ccgui-local-usage-test-{}.jsonl", Uuid::new_v4()));
    let mut file = File::create(&path).expect("create temp jsonl");
    for line in lines {
        writeln!(file, "{line}").expect("write jsonl line");
    }
    path
}

fn make_temp_sessions_root() -> PathBuf {
    let mut root = std::env::temp_dir();
    root.push(format!("ccgui-local-usage-root-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).expect("create temp root");
    root
}

fn write_session_file(root: &Path, day_key: &str, lines: &[String]) -> PathBuf {
    let day_dir = day_dir_for_key(root, day_key);
    fs::create_dir_all(&day_dir).expect("create day dir");
    let path = day_dir.join(format!("usage-{}.jsonl", Uuid::new_v4()));
    let mut file = File::create(&path).expect("create session jsonl");
    for line in lines {
        writeln!(file, "{line}").expect("write jsonl line");
    }
    path
}

fn write_named_session_file(
    root: &Path,
    day_key: &str,
    session_id: &str,
    lines: &[String],
) -> PathBuf {
    let day_dir = day_dir_for_key(root, day_key);
    fs::create_dir_all(&day_dir).expect("create day dir");
    let path = day_dir.join(format!("{session_id}.jsonl"));
    let mut file = File::create(&path).expect("create session jsonl");
    for line in lines {
        writeln!(file, "{line}").expect("write jsonl line");
    }
    path
}

fn make_temp_gemini_home() -> PathBuf {
    let mut root = std::env::temp_dir();
    root.push(format!("ccgui-local-usage-gemini-{}", Uuid::new_v4()));
    fs::create_dir_all(root.join("tmp")).expect("create gemini tmp");
    fs::create_dir_all(root.join("history")).expect("create gemini history");
    root
}

fn write_gemini_project_root(base_dir: &Path, bucket: &str, alias: &str, project_root: &str) {
    let project_dir = base_dir.join(bucket).join(alias);
    fs::create_dir_all(&project_dir).expect("create gemini project dir");
    fs::write(project_dir.join(".project_root"), project_root).expect("write project root");
}

fn write_gemini_chat_file(
    base_dir: &Path,
    bucket: &str,
    alias: &str,
    file_name: &str,
    content: &str,
) -> PathBuf {
    let chat_dir = base_dir.join(bucket).join(alias).join("chats");
    fs::create_dir_all(&chat_dir).expect("create gemini chat dir");
    let path = chat_dir.join(file_name);
    fs::write(&path, content).expect("write gemini chat file");
    path
}

#[test]
fn scan_file_does_not_double_count_last_and_total_usage() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.input, 10);
    assert_eq!(totals.output, 5);
}

#[test]
fn scan_file_counts_last_deltas_before_total_snapshot_once() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":20,"cached_input_tokens":0,"output_tokens":10}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.input, 20);
    assert_eq!(totals.output, 10);
}

#[test]
fn scan_file_does_not_double_count_last_between_total_snapshots() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":2,"cached_input_tokens":0,"output_tokens":1}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:02.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":6}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.input, 12);
    assert_eq!(totals.output, 6);
}

#[test]
fn scan_file_tracks_agent_time_from_activity() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}}}"#,
        r#"{"timestamp":"2026-01-19T12:00:05.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2,"cached_input_tokens":0,"output_tokens":2}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.agent_ms, 5_000);
}

#[test]
fn scan_file_counts_runs_from_assistant_messages() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"a"}]}}"#,
        r#"{"timestamp":"2026-01-19T12:00:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"b"}]}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.agent_runs, 2);
}

#[test]
fn scan_file_ignores_large_gaps_between_activity() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}}}"#,
        r#"{"timestamp":"2026-01-19T12:10:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2,"cached_input_tokens":0,"output_tokens":2}}}}"#,
        r#"{"timestamp":"2026-01-19T12:10:10.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":3,"cached_input_tokens":0,"output_tokens":3}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.agent_ms, 10_000);
}

#[test]
fn scan_file_skips_workspace_mismatch() {
    let day_key = "2026-01-19";
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha"}}"#,
        r#"{"timestamp":"2026-01-19T12:00:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}}"#,
        r#"{"timestamp":"2026-01-19T12:00:12.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
    ]);

    let mut daily: HashMap<String, DailyTotals> = HashMap::new();
    daily.insert(day_key.to_string(), DailyTotals::default());
    let mut model_totals: HashMap<String, i64> = HashMap::new();
    scan_file(
        &path,
        &mut daily,
        &mut model_totals,
        Some(Path::new("/tmp/other-project")),
    )
    .expect("scan file");

    let totals = daily.get(day_key).copied().unwrap_or_default();
    assert_eq!(totals.agent_ms, 0);
    assert_eq!(totals.input, 0);
}

#[test]
fn scan_local_usage_aggregates_multiple_session_roots() {
    let day_keys = make_day_keys(2);
    let day_key = day_keys
        .last()
        .cloned()
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    let naive = NaiveDateTime::parse_from_str(&format!("{day_key} 12:00:00"), "%Y-%m-%d %H:%M:%S")
        .expect("timestamp");
    let timestamp_ms = Local
        .from_local_datetime(&naive)
        .single()
        .expect("timestamp")
        .timestamp_millis();

    let root_a = make_temp_sessions_root();
    let root_b = make_temp_sessions_root();

    let line_a = format!(
        r#"{{"timestamp":{timestamp_ms},"payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":5,"cached_input_tokens":0,"output_tokens":2}}}}}}}}"#
    );
    let line_b = format!(
        r#"{{"timestamp":{timestamp_ms},"payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":3,"cached_input_tokens":0,"output_tokens":1}}}}}}}}"#
    );

    write_session_file(&root_a, &day_key, &[line_a]);
    write_session_file(&root_b, &day_key, &[line_b]);

    let snapshot = scan_local_usage_core(2, None, &[root_a, root_b], false).expect("scan usage");
    let day = snapshot
        .days
        .iter()
        .find(|entry| entry.day == day_key)
        .expect("day entry");

    assert_eq!(day.input_tokens, 8);
    assert_eq!(day.output_tokens, 3);
    assert_eq!(snapshot.totals.last30_days_tokens, 11);
}

#[test]
fn resolve_sessions_roots_includes_workspace_overrides() {
    let mut workspaces = HashMap::new();
    let mut settings_a = WorkspaceSettings::default();
    settings_a.codex_home = Some(
        std::env::temp_dir()
            .join(format!("codex-home-a-{}", Uuid::new_v4()))
            .to_string_lossy()
            .to_string(),
    );
    let entry_a = WorkspaceEntry {
        id: "a".to_string(),
        name: "A".to_string(),
        path: "/tmp/project-a".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings: settings_a,
    };
    let mut settings_b = WorkspaceSettings::default();
    settings_b.codex_home = Some(
        std::env::temp_dir()
            .join(format!("codex-home-b-{}", Uuid::new_v4()))
            .to_string_lossy()
            .to_string(),
    );
    let entry_b = WorkspaceEntry {
        id: "b".to_string(),
        name: "B".to_string(),
        path: "/tmp/project-b".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings: settings_b,
    };
    workspaces.insert(entry_a.id.clone(), entry_a.clone());
    workspaces.insert(entry_b.id.clone(), entry_b.clone());

    let roots = resolve_sessions_roots(&workspaces, None);
    let codex_home_a = entry_a.settings.codex_home.clone().expect("codex home a");
    let codex_home_b = entry_b.settings.codex_home.clone().expect("codex home b");
    let expected_a = PathBuf::from(&codex_home_a).join("sessions");
    let expected_a_archived = PathBuf::from(&codex_home_a).join("archived_sessions");
    let expected_b = PathBuf::from(&codex_home_b).join("sessions");
    let expected_b_archived = PathBuf::from(&codex_home_b).join("archived_sessions");

    assert!(roots.iter().any(|root| root == &expected_a));
    assert!(roots.iter().any(|root| root == &expected_a_archived));
    assert!(roots.iter().any(|root| root == &expected_b));
    assert!(roots.iter().any(|root| root == &expected_b_archived));
}

#[test]
fn merge_codex_session_roots_keeps_override_and_default_roots() {
    let override_home = PathBuf::from("/tmp/codex-override");
    let default_home = PathBuf::from("/tmp/codex-default");

    let roots = merge_codex_session_roots(Some(override_home.clone()), Some(default_home.clone()));

    assert!(roots.contains(&override_home.join("sessions")));
    assert!(roots.contains(&override_home.join("archived_sessions")));
    assert!(roots.contains(&default_home.join("sessions")));
    assert!(roots.contains(&default_home.join("archived_sessions")));
}

#[cfg(windows)]
#[test]
fn merge_codex_session_roots_dedupes_case_and_separator_variants() {
    let override_home = PathBuf::from(r"C:\Users\Chen\.codex");
    let default_home = PathBuf::from(r"c:/users/chen/.codex");

    let roots = merge_codex_session_roots(Some(override_home.clone()), Some(default_home));

    assert_eq!(roots.len(), 2);
    assert!(roots.contains(&override_home.join("sessions")));
    assert!(roots.contains(&override_home.join("archived_sessions")));
}

#[cfg(not(windows))]
#[test]
fn resolve_workspace_codex_home_for_path_matches_private_prefix_variant() {
    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some("/tmp/codex-home-private".to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspaces = HashMap::new();
    workspaces.insert(entry.id.clone(), entry);

    let resolved = resolve_workspace_codex_home_for_path(
        &workspaces,
        Some(Path::new("/private/tmp/project-alpha/src")),
    );

    assert_eq!(resolved, Some(PathBuf::from("/tmp/codex-home-private")));
}

#[cfg(windows)]
#[test]
fn resolve_workspace_codex_home_for_path_matches_unc_extended_variant() {
    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(r"C:\codex-home-unc".to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: r"\\SERVER\Share\project".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspaces = HashMap::new();
    workspaces.insert(entry.id.clone(), entry);

    let resolved = resolve_workspace_codex_home_for_path(
        &workspaces,
        Some(Path::new(r"\\?\UNC\server\share\project\src")),
    );

    assert_eq!(resolved, Some(PathBuf::from(r"C:\codex-home-unc")));
}

#[tokio::test]
async fn list_codex_session_summaries_for_workspace_does_not_clamp_to_200() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    for index in 0..230 {
        let session_id = format!("session-{index:03}");
        write_named_session_file(
            &sessions_root,
            day_key,
            &session_id,
            &[format!(
                r#"{{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{{"id":"{session_id}","cwd":"/tmp/project-alpha"}}}}"#
            )],
        );
    }

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let (_, sessions) =
        list_codex_session_summaries_for_workspace(&workspaces, "workspace-id", 230)
            .await
            .expect("list codex summaries");

    assert_eq!(sessions.len(), 230);
}

#[test]
fn load_codex_session_entries_reads_matching_workspace_session() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    write_named_session_file(
            &root,
            day_key,
            "session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"reasoning","id":"reason-1","summary":"Inspect","content":"Inspect workspace"}}"#
                    .to_string(),
            ],
        );

    let entries = load_codex_session_entries("session-alpha", workspace_path, &[root])
        .expect("load session entries");

    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries[0]["type"],
        Value::String("session_meta".to_string())
    );
    assert_eq!(
        entries[1]["payload"]["type"],
        Value::String("reasoning".to_string())
    );
}

#[test]
fn load_codex_session_entries_matches_rollout_filename_by_session_meta_id() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"reasoning","id":"reason-1","summary":"Inspect","content":"Inspect workspace"}}"#
                    .to_string(),
            ],
        );

    let entries = load_codex_session_entries("session-alpha", workspace_path, &[root])
        .expect("load session entries");

    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries[0]["payload"]["id"],
        Value::String("session-alpha".to_string())
    );
    assert_eq!(
        entries[1]["payload"]["type"],
        Value::String("reasoning".to_string())
    );
}

#[test]
fn load_codex_session_entries_reads_nested_session_meta_cwd() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    write_named_session_file(
            &root,
            day_key,
            "session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"sessionMeta":{"cwd":"/tmp/project-alpha"}}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"reasoning","id":"reason-1","summary":"Inspect","content":"Inspect workspace"}}"#
                    .to_string(),
            ],
        );

    let entries = load_codex_session_entries("session-alpha", workspace_path, &[root])
        .expect("load session entries");

    assert_eq!(entries.len(), 2);
}

#[test]
fn load_codex_session_entries_rejects_ambiguous_unknown_candidates() {
    let sessions_root = make_temp_sessions_root();
    let archived_root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    write_named_session_file(
            &sessions_root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha"}}"#
                .to_string()],
        );
    write_named_session_file(
            &archived_root,
            day_key,
            "rollout-2026-01-19T12-05-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:05:00.000Z","type":"session_meta","payload":{"id":"session-alpha"}}"#
                .to_string()],
        );

    let error = load_codex_session_entries(
        "session-alpha",
        workspace_path,
        &[sessions_root, archived_root],
    )
    .expect_err("ambiguous unknown candidates should fail");

    assert!(error.contains("ambiguous codex session file"));
}

#[tokio::test]
async fn delete_codex_session_for_workspace_physically_removes_matching_file() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let session_path = write_named_session_file(
            &sessions_root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                    .to_string(),
            ],
        );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let deleted_count =
        delete_codex_session_for_workspace(&workspaces, "workspace-id", "session-alpha")
            .await
            .expect("delete codex session");

    assert_eq!(deleted_count, 1);
    assert!(!session_path.exists());
}

#[tokio::test]
async fn delete_codex_sessions_for_workspace_reuses_single_scan_for_multiple_targets() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let session_path_a = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
            .to_string()],
    );
    let session_path_b = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-05-00-session-beta",
        &[r#"{"timestamp":"2026-01-19T12:05:00.000Z","type":"session_meta","payload":{"id":"session-beta","cwd":"/tmp/project-alpha"}}"#
            .to_string()],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let deleted = delete_codex_sessions_for_workspace(
        &workspaces,
        "workspace-id",
        &["session-alpha".to_string(), "session-beta".to_string()],
    )
    .await
    .expect("batch delete codex sessions");

    assert_eq!(deleted.len(), 2);
    assert!(deleted.iter().all(|result| result.deleted));
    assert!(!session_path_a.exists());
    assert!(!session_path_b.exists());
}

#[tokio::test]
async fn delete_codex_session_for_workspace_rejects_ambiguous_unknown_candidates() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let archived_root = codex_home.join("archived_sessions");
    let day_key = "2026-01-19";
    let session_path_a = write_named_session_file(
            &sessions_root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha"}}"#
                .to_string()],
        );
    let session_path_b = write_named_session_file(
            &archived_root,
            day_key,
            "rollout-2026-01-19T12-05-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:05:00.000Z","type":"session_meta","payload":{"id":"session-alpha"}}"#
                .to_string()],
        );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let error = delete_codex_session_for_workspace(&workspaces, "workspace-id", "session-alpha")
        .await
        .expect_err("ambiguous unknown candidates should fail");

    assert!(error.contains("ambiguous codex session files"));
    assert!(session_path_a.exists());
    assert!(session_path_b.exists());
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_truncates_source_session_before_target_user_turn() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains(r#""id":"session-beta""#));
    assert!(content.contains("first user"));
    assert!(content.contains("first reply"));
    assert!(!content.contains("second user"));
    assert!(!content.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_reopen_reads_only_truncated_target_session() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");

    let reopened_entries = load_codex_session_entries(
        "session-beta",
        Path::new("/tmp/project-alpha"),
        &[sessions_root],
    )
    .expect("reopen rewound session");

    let reopened_payload = reopened_entries
        .iter()
        .map(|entry| serde_json::to_string(entry).expect("serialize rewound entry"))
        .collect::<Vec<_>>()
        .join("\n");

    assert!(reopened_payload.contains(r#""id":"session-beta""#));
    assert!(reopened_payload.contains("first user"));
    assert!(reopened_payload.contains("first reply"));
    assert!(!reopened_payload.contains("second user"));
    assert!(!reopened_payload.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_keeps_source_when_target_turn_is_missing() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let error = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        2,
        None,
        None,
    )
    .await
    .expect_err("missing target user turn should fail");

    assert!(error.contains("target user turn"));
    assert!(source_path.exists());
    assert!(!sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl")
        .exists());
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_drops_response_item_user_when_mirrored_by_event_msg() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"first user"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"second user"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:06.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains("first user"));
    assert!(content.contains("first reply"));
    assert!(!content.contains("second user"));
    assert!(!content.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_supports_response_item_user_without_event_msg() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"first user only response"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"first reply only response"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"second user only response"}]}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"second reply only response"}]}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains("first user only response"));
    assert!(content.contains("first reply only response"));
    assert!(!content.contains("second user only response"));
    assert!(!content.contains("second reply only response"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_aligns_target_index_when_source_has_hidden_injected_user(
) {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r##"{"timestamp":"2026-01-19T12:00:00.100Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# injected prompt"}]}}"##
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        Some(2),
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains("# injected prompt"));
    assert!(content.contains("first user"));
    assert!(content.contains("first reply"));
    assert!(!content.contains("second user"));
    assert!(!content.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_does_not_shift_index_when_source_has_fewer_user_turns_than_local(
) {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session-beta",
        1,
        None,
        Some(3),
    )
    .await
    .expect("commit codex rewind");

    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let target_path = sessions_root
        .join("2026")
        .join("01")
        .join("19")
        .join("rewind-session-beta.jsonl");
    assert!(target_path.exists());

    let content = fs::read_to_string(&target_path).expect("read rewind target");
    assert!(content.contains("first user"));
    assert!(content.contains("first reply"));
    assert!(!content.contains("second user"));
    assert!(!content.contains("second reply"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_rejects_invalid_session_id_segments() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let source_error = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "../session-alpha",
        "session-beta",
        1,
        None,
        None,
    )
    .await
    .expect_err("invalid source id should fail");
    assert!(source_error.contains("invalid source_session_id"));

    let target_error = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session/child",
        1,
        None,
        None,
    )
    .await
    .expect_err("invalid target id should fail");
    assert!(target_error.contains("invalid target_session_id"));
}

#[tokio::test]
async fn commit_codex_rewind_for_workspace_writes_cross_platform_safe_rewind_filename() {
    let codex_home = std::env::temp_dir().join(format!("codex-home-{}", Uuid::new_v4()));
    let sessions_root = codex_home.join("sessions");
    let day_key = "2026-01-19";
    let source_path = write_named_session_file(
        &sessions_root,
        day_key,
        "rollout-2026-01-19T12-00-00-session-alpha",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"first user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:03.000Z","type":"event_msg","payload":{"type":"user_message","message":"second user"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:04.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}"#
                .to_string(),
        ],
    );

    let mut settings = WorkspaceSettings::default();
    settings.codex_home = Some(codex_home.to_string_lossy().to_string());
    let entry = WorkspaceEntry {
        id: "workspace-id".to_string(),
        name: "workspace".to_string(),
        path: "/tmp/project-alpha".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let mut workspace_map = HashMap::new();
    workspace_map.insert(entry.id.clone(), entry);
    let workspaces = Mutex::new(workspace_map);

    let result = commit_codex_rewind_for_workspace(
        &workspaces,
        "workspace-id",
        "session-alpha",
        "session:beta?1",
        1,
        None,
        None,
    )
    .await
    .expect("commit codex rewind");
    assert_eq!(result.deleted_count, 1);
    assert!(!source_path.exists());

    let day_dir = sessions_root.join("2026").join("01").join("19");
    let rewind_paths: Vec<PathBuf> = fs::read_dir(&day_dir)
        .expect("read day directory")
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("rewind-") && name.ends_with(".jsonl"))
                .unwrap_or(false)
        })
        .collect();
    assert_eq!(rewind_paths.len(), 1);

    let rewind_name = rewind_paths[0]
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    assert!(!rewind_name.contains(':'));
    assert!(!rewind_name.contains('?'));

    let content = fs::read_to_string(&rewind_paths[0]).expect("read rewind target");
    assert!(content.contains(r#""id":"session:beta?1""#));
}

#[test]
fn parse_codex_session_summary_extracts_source_provider_metadata() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "session-source-meta",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("custom"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
}

#[test]
fn parse_codex_session_summary_reads_nested_session_meta_cwd() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "session-nested-cwd",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"sessionMeta":{"cwd":"/tmp/project-alpha"},"source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("custom"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
}

#[test]
fn parse_codex_session_summary_reads_root_session_meta_cwd() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "session-root-meta-cwd",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","sessionMeta":{"cwd":"/tmp/project-alpha"},"payload":{"source":"custom","provider":"openai"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("custom"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
}

#[test]
fn parse_codex_session_summary_uses_latest_activity_timestamp() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "session-latest-timestamp",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:05:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    let expected_timestamp = DateTime::parse_from_rfc3339("2026-01-19T12:05:00.000Z")
        .expect("latest timestamp")
        .timestamp_millis();
    assert_eq!(summary.timestamp, expected_timestamp);
}

#[test]
fn parse_codex_session_summary_prefers_session_meta_id_over_rollout_filename() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-alpha");
    assert_eq!(
        summary.session_id_aliases,
        vec!["rollout-2026-01-19T12-00-00-session-alpha".to_string()]
    );
}

#[test]
fn parse_codex_session_summary_falls_back_to_filename_when_session_meta_id_missing() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(
        summary.session_id,
        "rollout-2026-01-19T12-00-00-session-alpha"
    );
}

#[test]
fn parse_codex_session_summary_prefers_originator_over_vscode_source() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "session-originator-meta",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha","source":"vscode","originator":"ccgui","model_provider":"openai"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":4}}}}"#
                    .to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("ccgui"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
}

#[test]
fn parse_codex_session_summary_keeps_metadata_only_sessions_for_size_enrichment() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha","source":"custom","provider":"openai"}}"#
                .to_string()],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-alpha");
    assert_eq!(summary.source.as_deref(), Some("custom"));
    assert_eq!(summary.provider.as_deref(), Some("openai"));
    assert_eq!(summary.usage.total_tokens, 0);
    assert!(summary.file_size_bytes.unwrap_or(0) > 0);
}

#[test]
fn parse_codex_session_summary_extracts_response_item_user_summary() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-01-19T12-00-00-memory-helper",
        &[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-memory-helper","cwd":"/tmp/project-alpha","source":"cli","provider":"openai"}}"#
                .to_string(),
            r###"{"timestamp":"2026-01-19T12:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"## Memory Writing Agent: Phase 2 (Consolidation)\n\nConsolidate raw memories."}]}}"###
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-memory-helper");
    assert!(summary
        .summary
        .as_deref()
        .unwrap_or_default()
        .starts_with("## Memory Writing Agent: Phase 2"));
}

#[test]
fn parse_codex_session_summary_extracts_string_content_user_summary() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let workspace_path = Path::new("/tmp/project-alpha");
    let session_path = write_named_session_file(
        &root,
        day_key,
        "rollout-2026-01-19T12-05-00-string-content",
        &[
            r#"{"timestamp":"2026-01-19T12:05:00.000Z","type":"session_meta","payload":{"id":"session-string-content","cwd":"/tmp/project-alpha","source":"cli","provider":"openai"}}"#
                .to_string(),
            r#"{"timestamp":"2026-01-19T12:05:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":"string content user prompt"}}"#
                .to_string(),
        ],
    );

    let summary = parse_codex_session_summary(session_path.as_path(), Some(workspace_path))
        .expect("parse summary")
        .expect("summary exists");

    assert_eq!(summary.session_id, "session-string-content");
    assert_eq!(
        summary.summary.as_deref(),
        Some("string content user prompt")
    );
}

#[test]
fn count_apply_patch_changed_lines_counts_additions_and_deletions() {
    let patch = r#"*** Begin Patch
*** Update File: /tmp/demo.ts
@@
-oldLine
+newLine
+addedLine
*** End Patch
"#;

    assert_eq!(count_apply_patch_changed_lines(patch), 3);
}

#[test]
fn count_apply_patch_changed_lines_keeps_content_starting_with_triple_markers() {
    let patch = r#"*** Begin Patch
*** Update File: /tmp/demo.ts
@@
----removedLeadingDashes
-removedLine
++++addedLeadingPluses
+addedLine
*** End Patch
"#;

    assert_eq!(count_apply_patch_changed_lines(patch), 4);
}

#[test]
fn parse_changed_lines_from_git_diff_stat_output_extracts_insertions_and_deletions() {
    let output = r#"Command: /bin/zsh -lc 'git diff --stat'
Output:
 src/main.ts  | 7 +++++--
 src/app.tsx  | 3 ++-
 2 files changed, 8 insertions(+), 2 deletions(-)
"#;

    assert_eq!(
        parse_changed_lines_from_git_diff_stat_output(output),
        Some(10)
    );
}

#[test]
fn parse_changed_lines_from_git_diff_stat_output_falls_back_to_stat_columns_without_english_summary(
) {
    let output = r#"输出:
 src/main.ts  | 7 +++++--
 src/app.tsx  | 3 ++-
 2 个文件已更改，8 处插入(+)，2 处删除(-)
"#;

    assert_eq!(
        parse_changed_lines_from_git_diff_stat_output(output),
        Some(10)
    );
}

#[test]
fn is_successful_apply_patch_output_accepts_camel_case_exit_code_and_rejects_case_insensitive_failures(
) {
    let success = r#"{"metadata":{"exitCode":0},"output":"noop"}"#;
    let failed = "Verification Failed: context mismatch";

    assert!(is_successful_apply_patch_output(success));
    assert!(!is_successful_apply_patch_output(failed));
}

#[test]
fn is_successful_apply_patch_output_accepts_string_exit_code_and_nested_output_object() {
    let success = r#"{"metadata":{"exit_code":"0"},"output":{"summary":"ok"}}"#;
    assert!(is_successful_apply_patch_output(success));
}

#[test]
fn parse_codex_session_summary_counts_modified_lines_from_object_output() {
    let root = make_temp_sessions_root();
    let day_key = "2026-01-19";
    let session_path = write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-apply",
            &[
                r#"{"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","call_id":"call-1","input":"*** Begin Patch\n*** Update File: /tmp/demo.ts\n@@\n-old\n+new\n*** End Patch\n"}}"#.to_string(),
                r#"{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"call-1","output":{"metadata":{"exit_code":"0"},"output":"ok"}}}"#.to_string(),
            ],
        );

    let summary = parse_codex_session_summary(session_path.as_path(), None)
        .expect("parse codex summary")
        .expect("summary exists");
    assert_eq!(summary.modified_lines, 2);
}

#[test]
fn infer_engine_label_prefers_session_signals_over_requested_provider() {
    let claude_session = LocalUsageSessionSummary {
        model: "claude-3-7-sonnet-20250219".to_string(),
        ..LocalUsageSessionSummary::default()
    };
    let codex_hint_session = LocalUsageSessionSummary {
        provider: Some("openai".to_string()),
        ..LocalUsageSessionSummary::default()
    };

    assert_eq!(infer_engine_label("codex", &claude_session), "Claude Code");
    assert_eq!(
        infer_engine_label("claude", &codex_hint_session),
        "Codex CLI"
    );
}

#[test]
fn infer_engine_label_uses_requested_provider_as_fallback() {
    let unknown_session = LocalUsageSessionSummary {
        model: "unknown".to_string(),
        ..LocalUsageSessionSummary::default()
    };

    assert_eq!(infer_engine_label("gemini", &unknown_session), "Gemini CLI");
}

#[test]
fn parse_claude_session_summary_sets_claude_source_and_provider() {
    let path = write_temp_jsonl(&[
        r#"{"timestamp":"2026-04-10T12:00:00.000Z","type":"assistant","message":{"model":"claude-3-7-sonnet-20250219","usage":{"input_tokens":12,"output_tokens":4,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}"#,
    ]);

    let summary = parse_claude_session_summary(&path)
        .expect("parse claude summary")
        .expect("summary exists");

    assert_eq!(summary.source.as_deref(), Some("claude"));
    assert_eq!(summary.provider.as_deref(), Some("anthropic"));

    let _ = fs::remove_file(path);
}

#[test]
fn scan_gemini_session_summaries_reads_sessions_for_current_workspace() {
    let gemini_home = make_temp_gemini_home();
    let workspace = "/tmp/project-gemini";
    let alias = "tmp-project-gemini";
    write_gemini_project_root(&gemini_home, "tmp", alias, workspace);
    write_gemini_chat_file(
        &gemini_home,
        "tmp",
        alias,
        "session-1.json",
        r#"{
  "sessionId": "gemini-session-1",
  "startTime": "2026-04-11T10:00:00.000Z",
  "lastUpdated": "2026-04-11T10:05:00.000Z",
  "messages": [
    {
      "type": "user",
      "displayContent": "请帮我重构这段逻辑"
    },
    {
      "type": "gemini",
      "model": "gemini-2.5-pro",
      "tokens": {
        "input": 40,
        "output": 25,
        "cached": 5
      }
    }
  ]
}"#,
    );

    let sessions =
        scan_gemini_session_summaries_from_base(Some(Path::new(workspace)), &gemini_home)
            .expect("scan gemini sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "gemini-session-1");
    assert_eq!(sessions[0].model, "gemini-2.5-pro");
    assert_eq!(sessions[0].usage.total_tokens, 70);
    assert_eq!(sessions[0].source.as_deref(), Some("gemini"));
    assert_eq!(sessions[0].provider.as_deref(), Some("google"));
    assert_eq!(infer_engine_label("all", &sessions[0]), "Gemini CLI");

    let _ = fs::remove_dir_all(gemini_home);
}

#[test]
fn scan_gemini_session_summaries_skips_workspace_mismatch() {
    let gemini_home = make_temp_gemini_home();
    let alias = "tmp-project-gemini";
    write_gemini_project_root(&gemini_home, "history", alias, "/tmp/project-gemini");
    write_gemini_chat_file(
        &gemini_home,
        "history",
        alias,
        "session-2.json",
        r#"{
  "sessionId": "gemini-session-2",
  "lastUpdated": "2026-04-11T10:05:00.000Z",
  "messages": [
    {"type": "user", "displayContent": "hello"},
    {"type": "gemini", "model": "gemini-2.5-flash"}
  ]
}"#,
    );

    let sessions = scan_gemini_session_summaries_from_base(
        Some(Path::new("/tmp/another-workspace")),
        &gemini_home,
    )
    .expect("scan gemini sessions");
    assert!(sessions.is_empty());

    let _ = fs::remove_dir_all(gemini_home);
}

#[cfg(unix)]
#[test]
fn scan_gemini_session_summaries_does_not_follow_symlink_directories() {
    use std::os::unix::fs::symlink;

    let gemini_home = make_temp_gemini_home();
    let outside_home = make_temp_gemini_home();
    let alias = "linked-project";
    write_gemini_chat_file(
        &outside_home,
        "tmp",
        alias,
        "session-linked.json",
        r#"{
  "sessionId": "gemini-session-linked",
  "lastUpdated": "2026-04-11T10:05:00.000Z",
  "messages": [
    {"type": "user", "displayContent": "outside"},
    {"type": "gemini", "model": "gemini-2.5-flash"}
  ]
}"#,
    );
    symlink(
        outside_home.join("tmp").join(alias),
        gemini_home.join("tmp").join(alias),
    )
    .expect("create symlinked gemini project");

    let sessions =
        scan_gemini_session_summaries_from_base(None, &gemini_home).expect("scan gemini sessions");

    assert!(sessions.is_empty());
    let _ = fs::remove_dir_all(gemini_home);
    let _ = fs::remove_dir_all(outside_home);
}

#[test]
fn gemini_project_matches_workspace_accepts_parent_project_root() {
    let root = std::env::temp_dir().join(format!("ccgui-gemini-root-{}", Uuid::new_v4()));
    let nested_workspace = root.join("packages").join("desktop");
    fs::create_dir_all(&nested_workspace).expect("create nested workspace");

    let project_root = root.to_string_lossy().to_string();
    assert!(gemini_project_matches_workspace(
        project_root.as_str(),
        nested_workspace.as_path()
    ));

    let _ = fs::remove_dir_all(root);
}

#[cfg(not(windows))]
#[test]
fn gemini_project_matches_workspace_expands_home_prefix() {
    let Some(home_dir) = dirs::home_dir() else {
        return;
    };
    let workspace = home_dir.join(format!("ccgui-gemini-home-{}", Uuid::new_v4()));
    fs::create_dir_all(&workspace).expect("create workspace under home");

    let relative = workspace
        .strip_prefix(&home_dir)
        .expect("workspace under home")
        .to_string_lossy()
        .to_string();
    let project_root_with_home_prefix = format!("~/{}", relative);
    assert!(gemini_project_matches_workspace(
        project_root_with_home_prefix.as_str(),
        workspace.as_path()
    ));

    let _ = fs::remove_dir_all(workspace);
}

#[test]
fn read_i64_accepts_numeric_string_values() {
    let value = serde_json::json!({
        "input_tokens": "42",
        "output_tokens": 7
    });
    let map = value.as_object().expect("object");

    assert_eq!(read_i64(map, &["input_tokens"]), 42);
    assert_eq!(read_i64(map, &["output_tokens"]), 7);
}

#[cfg(not(windows))]
#[test]
fn path_matches_workspace_handles_private_prefix_variants_on_macos() {
    let workspace_private = Path::new("/private/tmp/project-alpha");
    let workspace_plain = Path::new("/tmp/project-alpha");

    assert!(path_matches_workspace(
        "/tmp/project-alpha/src",
        workspace_private
    ));
    assert!(path_matches_workspace(
        "/private/tmp/project-alpha/src",
        workspace_plain
    ));
    assert!(!path_matches_workspace(
        "/tmp/project-alpha-other",
        workspace_private
    ));
}

#[cfg(not(windows))]
#[test]
fn path_matches_workspace_handles_root_workspace_path() {
    let workspace = Path::new("/");
    assert!(path_matches_workspace("/Users/chen/project", workspace));
    assert!(!path_matches_workspace("relative/path", workspace));
}

#[cfg(windows)]
#[test]
fn path_matches_workspace_handles_drive_case_and_separator_variants() {
    let workspace = Path::new("C:\\Users\\Chen\\project");
    assert!(path_matches_workspace("c:/users/chen/project", workspace));
    assert!(path_matches_workspace(
        "c:\\users\\chen\\project\\src",
        workspace
    ));
    assert!(path_matches_workspace(
        "\\\\?\\C:\\Users\\Chen\\project\\src",
        workspace
    ));
    assert!(!path_matches_workspace(
        "c:\\users\\chen\\project-other",
        workspace
    ));
}

#[cfg(windows)]
#[test]
fn path_matches_workspace_handles_unc_extended_prefix() {
    let workspace = Path::new("\\\\SERVER\\Share\\project");
    assert!(path_matches_workspace(
        "\\\\?\\UNC\\server\\share\\project\\src",
        workspace
    ));
    assert!(!path_matches_workspace(
        "\\\\?\\UNC\\server\\share\\project-other",
        workspace
    ));
}
