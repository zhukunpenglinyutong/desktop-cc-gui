    use super::*;
    use crate::types::{WorkspaceKind, WorkspaceSettings, WorktreeInfo};
    use std::io::Write;
    use uuid::Uuid;

    fn workspace_entry(
        id: &str,
        name: &str,
        path: &str,
        kind: WorkspaceKind,
        parent_id: Option<&str>,
    ) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            codex_bin: None,
            kind: kind.clone(),
            parent_id: parent_id.map(ToString::to_string),
            worktree: if kind.is_worktree() {
                Some(WorktreeInfo {
                    branch: "feature/test".to_string(),
                    base_ref: None,
                    base_commit: None,
                    tracking: None,
                    publish_error: None,
                    publish_retry_command: None,
                })
            } else {
                None
            },
            settings: WorkspaceSettings::default(),
        }
    }

    fn catalog_entry(
        session_id: &str,
        workspace_id: &str,
        workspace_label: Option<&str>,
        cwd: Option<&str>,
    ) -> WorkspaceSessionCatalogEntry {
        WorkspaceSessionCatalogEntry {
            session_id: session_id.to_string(),
            canonical_session_id: Some(session_id.to_string()),
            parent_session_id: None,
            workspace_id: workspace_id.to_string(),
            workspace_label: workspace_label.map(ToString::to_string),
            engine: "codex".to_string(),
            title: "Example session".to_string(),
            updated_at: 1,
            archived_at: None,
            thread_kind: "native".to_string(),
            source: Some("cli".to_string()),
            source_label: Some("cli/codex".to_string()),
            size_bytes: None,
            cwd: cwd.map(ToString::to_string),
            attribution_status: None,
            attribution_reason: None,
            attribution_confidence: None,
            matched_workspace_id: None,
            matched_workspace_label: None,
            folder_id: None,
        }
    }

    fn write_codex_session_fixture(codex_home: &Path, session_id: &str, cwd: &str) {
        write_codex_session_fixture_with_message(
            codex_home,
            session_id,
            cwd,
            "2026-01-19T12:00:00.000Z",
            "2026-01-19T12:00:05.000Z",
            "Fixture session",
        );
    }

    fn write_codex_session_fixture_with_message(
        codex_home: &Path,
        session_id: &str,
        cwd: &str,
        metadata_timestamp: &str,
        message_timestamp: &str,
        message: &str,
    ) {
        let day_dir = codex_home.join("sessions").join("2026").join("01").join("19");
        std::fs::create_dir_all(&day_dir).expect("create codex fixture day dir");
        let path = day_dir.join(format!("{session_id}.jsonl"));
        let mut file = std::fs::File::create(path).expect("create codex fixture");
        writeln!(
            file,
            r#"{{"timestamp":"{metadata_timestamp}","type":"session_meta","payload":{{"id":"{session_id}","cwd":"{cwd}"}}}}"#
        )
        .expect("write codex fixture metadata");
        writeln!(
            file,
            r#"{{"timestamp":"{message_timestamp}","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"{message}"}}]}}}}"#
        )
        .expect("write codex fixture message");
    }

    fn create_claude_project_dir(
        base_dir: &Path,
        workspace_path: &Path,
    ) -> std::path::PathBuf {
        let encoded = workspace_path
            .to_string_lossy()
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>();
        let project_dir = base_dir.join(encoded);
        std::fs::create_dir_all(&project_dir).expect("create claude project dir");
        project_dir
    }

    fn write_claude_session_fixture(
        claude_projects_dir: &Path,
        workspace_path: &Path,
        session_id: &str,
        cwd: &Path,
        message: &str,
    ) {
        let project_dir = create_claude_project_dir(claude_projects_dir, workspace_path);
        let session_path = project_dir.join(format!("{session_id}.jsonl"));
        let mut file = std::fs::File::create(session_path).expect("create claude fixture");
        writeln!(
            file,
            r#"{{"uuid":"user-1","timestamp":"2026-01-19T12:00:00.000Z","session_id":"{session_id}","cwd":"{}","message":{{"role":"user","content":"{message}"}}}}"#,
            cwd.to_string_lossy()
        )
        .expect("write claude fixture");
    }

    fn codex_fixture_timestamp(minutes_before_latest: usize) -> String {
        let latest_total_minutes: usize = 20 * 60;
        let total_minutes = latest_total_minutes.saturating_sub(minutes_before_latest);
        format!(
            "2026-01-19T{:02}:{:02}:00.000Z",
            total_minutes / 60,
            total_minutes % 60
        )
    }

    fn workspace_with_codex_home(
        id: &str,
        name: &str,
        path: &str,
        codex_home: &Path,
    ) -> WorkspaceEntry {
        let mut workspace = workspace_entry(id, name, path, WorkspaceKind::Main, None);
        workspace.settings.codex_home = Some(codex_home.to_string_lossy().to_string());
        workspace
    }

    #[test]
    fn parses_prefixed_cursor() {
        assert_eq!(parse_catalog_cursor(Some("offset:25")), 25);
        assert_eq!(parse_catalog_cursor(Some("bad")), 0);
    }

    #[test]
    fn catalog_scan_limit_uses_requested_page_window_plus_lookahead() {
        assert_eq!(build_catalog_scan_limit(None, Some(25)), 26);
        assert_eq!(build_catalog_scan_limit(Some("offset:50"), Some(25)), 76);
        assert_eq!(build_catalog_scan_limit(Some("offset:50"), None), 101);
        assert_eq!(
            build_catalog_scan_limit(Some("offset:50"), Some(10_000)),
            251
        );
    }

    #[test]
    fn catalog_page_preserves_next_cursor_from_scan_lookahead_entry() {
        let entries = (0..26)
            .map(|index| {
                let mut entry =
                    catalog_entry(&format!("codex:session-{index:02}"), "ws-1", Some("Project"), None);
                entry.updated_at = 1_000 - i64::from(index);
                entry
            })
            .collect();

        let page = build_catalog_page(
            entries,
            WorkspaceSessionCatalogQuery::default(),
            None,
            Some(25),
            Some(SESSION_CATALOG_PARTIAL_CODEX.to_string()),
        );

        assert_eq!(page.data.len(), 25);
        assert_eq!(page.next_cursor, Some("offset:25".to_string()));
        assert_eq!(
            page.partial_source,
            Some(SESSION_CATALOG_PARTIAL_CODEX.to_string())
        );
    }

    #[test]
    fn active_keyword_and_archived_queries_require_exhaustive_scan() {
        assert!(query_requires_exhaustive_scan(
            &WorkspaceSessionCatalogQuery::default()
        ));
        assert!(query_requires_exhaustive_scan(
            &WorkspaceSessionCatalogQuery {
                keyword: Some("needle".to_string()),
                engine: None,
                status: Some("all".to_string()),
            }
        ));
        assert!(query_requires_exhaustive_scan(
            &WorkspaceSessionCatalogQuery {
                keyword: None,
                engine: None,
                status: Some("archived".to_string()),
            }
        ));
        assert!(!query_requires_exhaustive_scan(
            &WorkspaceSessionCatalogQuery {
                keyword: None,
                engine: None,
                status: Some("all".to_string()),
            }
        ));
    }

    #[test]
    fn normalize_session_ids_rejects_invalid_path_like_values() {
        let error = normalize_session_ids(vec!["../escape".to_string()])
            .expect_err("path traversal session ids must be rejected");
        assert_eq!(error, "invalid session_id");

        let error = normalize_session_ids(vec!["claude:folder/session".to_string()])
            .expect_err("slash-containing session ids must be rejected");
        assert_eq!(error, "invalid session_id");

        let error = normalize_session_ids(vec![".".to_string()])
            .expect_err("current-directory session ids must be rejected");
        assert_eq!(error, "invalid session_id");
    }

    #[test]
    fn parses_catalog_identity_by_engine_prefix() {
        assert_eq!(
            parse_catalog_identity("claude:abc"),
            SessionCatalogIdentity::Claude {
                session_id: "abc".to_string()
            }
        );
        assert_eq!(
            parse_catalog_identity("plain-codex-id"),
            SessionCatalogIdentity::Codex {
                session_id: "plain-codex-id".to_string()
            }
        );
    }

    #[test]
    fn writes_and_reads_catalog_metadata_roundtrip() {
        let base = std::env::temp_dir().join(format!("session-catalog-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let metadata = WorkspaceSessionCatalogMetadata {
            archived_at_by_session_id: HashMap::from([("claude:1".to_string(), 42_i64)]),
            ..Default::default()
        };

        with_catalog_metadata_mutation(&storage_path, "ws-1", |stored| {
            *stored = metadata;
            Ok(())
        })
        .expect("write metadata");
        let loaded = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert_eq!(
            loaded.archived_at_by_session_id.get("claude:1").copied(),
            Some(42)
        );

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn workspace_session_folder_tree_starts_empty_and_persists_nested_folders() {
        let base = std::env::temp_dir().join(format!("session-folders-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let workspace =
            workspace_entry("ws-1", "Workspace", "/tmp/ws-1", WorkspaceKind::Main, None);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));

        let empty =
            list_workspace_session_folders_core(&workspaces, &storage_path, "ws-1".to_string())
                .await
                .expect("list empty tree");
        assert_eq!(empty.folders, Vec::<WorkspaceSessionFolder>::new());

        let parent = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Bugs".to_string(),
            None,
        )
        .await
        .expect("create parent folder")
        .folder;
        let child = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Regression".to_string(),
            Some(parent.id.clone()),
        )
        .await
        .expect("create child folder")
        .folder;

        let tree =
            list_workspace_session_folders_core(&workspaces, &storage_path, "ws-1".to_string())
                .await
                .expect("list populated tree");
        assert_eq!(tree.folders.len(), 2);
        assert!(tree.folders.iter().any(|folder| folder.id == parent.id));
        assert!(tree.folders.iter().any(|folder| folder.id == child.id
            && folder.parent_id.as_deref() == Some(parent.id.as_str())));

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn workspace_session_folder_crud_rejects_cycles_and_non_empty_delete() {
        let base = std::env::temp_dir().join(format!("session-folder-crud-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let workspace =
            workspace_entry("ws-1", "Workspace", "/tmp/ws-1", WorkspaceKind::Main, None);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));

        let parent = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Parent".to_string(),
            None,
        )
        .await
        .expect("create parent")
        .folder;
        let child = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Child".to_string(),
            Some(parent.id.clone()),
        )
        .await
        .expect("create child")
        .folder;

        let cycle_error = move_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            parent.id.clone(),
            Some(child.id.clone()),
        )
        .await
        .expect_err("cycle move must fail");
        assert_eq!(cycle_error, "folder tree cannot contain cycles");

        let delete_error = delete_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            parent.id.clone(),
        )
        .await
        .expect_err("non-empty delete must fail");
        assert_eq!(
            delete_error,
            "folder is not empty; move or clear its contents first"
        );

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn session_folder_assignment_supports_same_workspace_and_root_fallback() {
        let base = std::env::temp_dir().join(format!("session-folder-assign-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        write_codex_session_fixture(&codex_home, "codex-1", "/tmp/ws-1");
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let engine_manager = engine::EngineManager::new();

        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Bugs".to_string(),
            None,
        )
        .await
        .expect("create folder")
        .folder;

        let assigned = assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-1".to_string(),
            Some(folder.id.clone()),
        )
        .await
        .expect("assign session");
        assert_eq!(assigned.folder_id.as_deref(), Some(folder.id.as_str()));

        let metadata = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert_eq!(
            metadata.folder_id_by_session_id.get("codex-1"),
            Some(&folder.id)
        );

        let root = assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-1".to_string(),
            Some(SESSION_FOLDER_ROOT_ID.to_string()),
        )
        .await
        .expect("move to root");
        assert_eq!(root.folder_id, None);
        let metadata = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert!(!metadata.folder_id_by_session_id.contains_key("codex-1"));

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn session_folder_assignment_accepts_session_beyond_first_owner_lookup_page() {
        let base =
            std::env::temp_dir().join(format!("session-folder-deep-owner-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        for index in 0..=205 {
            let timestamp = codex_fixture_timestamp(index);
            write_codex_session_fixture_with_message(
                &codex_home,
                &format!("codex-{index:03}"),
                "/tmp/ws-1",
                &timestamp,
                &timestamp,
                "Fixture session",
            );
        }
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let engine_manager = engine::EngineManager::new();
        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Deep".to_string(),
            None,
        )
        .await
        .expect("create folder")
        .folder;

        let assigned = assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-205".to_string(),
            Some(folder.id.clone()),
        )
        .await
        .expect("deep session still belongs to workspace");

        assert_eq!(assigned.folder_id.as_deref(), Some(folder.id.as_str()));
        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn folder_assignment_is_applied_to_catalog_entries_by_owner_workspace() {
        let mut entry = catalog_entry("claude:1", "ws-1", Some("Workspace"), None);
        let metadata_by_workspace_id = HashMap::from([(
            "ws-1".to_string(),
            WorkspaceSessionCatalogMetadata {
                folder_id_by_session_id: HashMap::from([(
                    "claude:1".to_string(),
                    "folder-1".to_string(),
                )]),
                ..Default::default()
            },
        )]);

        apply_folder_assignment(&mut entry, &metadata_by_workspace_id);

        assert_eq!(entry.folder_id.as_deref(), Some("folder-1"));
    }

    #[test]
    fn codex_folder_assignment_accepts_raw_and_prefixed_session_keys() {
        let mut raw_entry = catalog_entry("codex-1", "ws-1", Some("Workspace"), None);
        raw_entry.engine = "codex".to_string();
        let mut prefixed_entry = catalog_entry("codex:codex-2", "ws-1", Some("Workspace"), None);
        prefixed_entry.engine = "codex".to_string();
        let metadata_by_workspace_id = HashMap::from([(
            "ws-1".to_string(),
            WorkspaceSessionCatalogMetadata {
                folder_id_by_session_id: HashMap::from([
                    ("codex:codex-1".to_string(), "folder-1".to_string()),
                    ("codex-2".to_string(), "folder-2".to_string()),
                ]),
                ..Default::default()
            },
        )]);

        apply_folder_assignment(&mut raw_entry, &metadata_by_workspace_id);
        apply_folder_assignment(&mut prefixed_entry, &metadata_by_workspace_id);

        assert_eq!(raw_entry.folder_id.as_deref(), Some("folder-1"));
        assert_eq!(prefixed_entry.folder_id.as_deref(), Some("folder-2"));
    }

    #[test]
    fn codex_folder_assignment_cleanup_removes_raw_and_prefixed_keys() {
        let mut metadata = WorkspaceSessionCatalogMetadata {
            folder_id_by_session_id: HashMap::from([
                ("codex-1".to_string(), "folder-raw".to_string()),
                ("codex:codex-1".to_string(), "folder-prefixed".to_string()),
                ("claude:1".to_string(), "folder-claude".to_string()),
            ]),
            ..Default::default()
        };

        remove_folder_assignment_for_session(&mut metadata, "codex-1", "codex");

        assert!(!metadata.folder_id_by_session_id.contains_key("codex-1"));
        assert!(!metadata
            .folder_id_by_session_id
            .contains_key("codex:codex-1"));
        assert!(metadata.folder_id_by_session_id.contains_key("claude:1"));
    }

    #[test]
    fn folder_sorting_is_deterministic_by_name_created_at_and_id() {
        let mut folders = vec![
            WorkspaceSessionFolder {
                id: "b".to_string(),
                workspace_id: "ws-1".to_string(),
                parent_id: None,
                name: "Zeta".to_string(),
                created_at: 1,
                updated_at: 1,
            },
            WorkspaceSessionFolder {
                id: "c".to_string(),
                workspace_id: "ws-1".to_string(),
                parent_id: None,
                name: "Alpha".to_string(),
                created_at: 2,
                updated_at: 2,
            },
            WorkspaceSessionFolder {
                id: "a".to_string(),
                workspace_id: "ws-1".to_string(),
                parent_id: None,
                name: "Alpha".to_string(),
                created_at: 1,
                updated_at: 1,
            },
        ];

        sort_workspace_session_folders(&mut folders);

        let ids: Vec<_> = folders.into_iter().map(|folder| folder.id).collect();
        assert_eq!(ids, vec!["a", "c", "b"]);
    }

    #[tokio::test]
    async fn session_folder_assignment_rejects_missing_target_without_rewriting_previous_assignment(
    ) {
        let base = std::env::temp_dir().join(format!("session-folder-missing-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        write_codex_session_fixture(&codex_home, "codex-1", "/tmp/ws-1");
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let engine_manager = engine::EngineManager::new();
        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Bugs".to_string(),
            None,
        )
        .await
        .expect("create folder")
        .folder;
        assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-1".to_string(),
            Some(folder.id.clone()),
        )
        .await
        .expect("assign session");

        let error = assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-1".to_string(),
            Some("missing-folder".to_string()),
        )
        .await
        .expect_err("missing folder must fail");
        assert_eq!(error, "target folder not found");

        let metadata = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert_eq!(
            metadata.folder_id_by_session_id.get("codex-1"),
            Some(&folder.id)
        );

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn session_folder_assignment_rejects_folder_from_other_workspace() {
        let base = std::env::temp_dir().join(format!("session-folder-cross-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home_1 = base.join("codex-home-1");
        let codex_home_2 = base.join("codex-home-2");
        write_codex_session_fixture(&codex_home_1, "codex-1", "/tmp/ws-1");
        let ws_1 = workspace_with_codex_home("ws-1", "Workspace 1", "/tmp/ws-1", &codex_home_1);
        let ws_2 = workspace_with_codex_home("ws-2", "Workspace 2", "/tmp/ws-2", &codex_home_2);
        let workspaces = Mutex::new(HashMap::from([
            (ws_1.id.clone(), ws_1),
            (ws_2.id.clone(), ws_2),
        ]));
        let engine_manager = engine::EngineManager::new();
        let other_folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-2".to_string(),
            "Other".to_string(),
            None,
        )
        .await
        .expect("create other workspace folder")
        .folder;

        let error = assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-1".to_string(),
            Some(other_folder.id),
        )
        .await
        .expect_err("cross-workspace folder assignment must fail");

        assert_eq!(error, "target folder not found");
        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn session_folder_assignment_rejects_wrong_project_and_preserves_metadata() {
        let base = std::env::temp_dir().join(format!("session-folder-owner-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home_1 = base.join("codex-home-1");
        let codex_home_2 = base.join("codex-home-2");
        write_codex_session_fixture(&codex_home_2, "codex-other", "/tmp/ws-2");
        let ws_1 = workspace_with_codex_home("ws-1", "Workspace 1", "/tmp/ws-1", &codex_home_1);
        let ws_2 = workspace_with_codex_home("ws-2", "Workspace 2", "/tmp/ws-2", &codex_home_2);
        let workspaces = Mutex::new(HashMap::from([
            (ws_1.id.clone(), ws_1),
            (ws_2.id.clone(), ws_2),
        ]));
        let engine_manager = engine::EngineManager::new();
        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Target".to_string(),
            None,
        )
        .await
        .expect("create target folder")
        .folder;
        let preserved = WorkspaceSessionCatalogMetadata {
            archived_at_by_session_id: HashMap::from([("codex-keep".to_string(), 42)]),
            ..Default::default()
        };
        with_catalog_metadata_mutation(&storage_path, "ws-1", |metadata| {
            *metadata = preserved;
            Ok(())
        })
        .expect("seed metadata");

        let error = assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-other".to_string(),
            Some(folder.id),
        )
        .await
        .expect_err("wrong-project session must fail");

        assert_eq!(error, "session does not belong to target workspace");
        let metadata = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert_eq!(
            metadata.archived_at_by_session_id.get("codex-keep").copied(),
            Some(42)
        );
        assert!(!metadata
            .folder_id_by_session_id
            .contains_key("codex-other"));

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn session_folder_assignment_rejects_unresolved_session_owner_without_writing() {
        let base =
            std::env::temp_dir().join(format!("session-folder-unresolved-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let engine_manager = engine::EngineManager::new();
        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Target".to_string(),
            None,
        )
        .await
        .expect("create target folder")
        .folder;

        let error = assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-missing".to_string(),
            Some(folder.id),
        )
        .await
        .expect_err("unresolved session must fail");

        assert_eq!(error, "session does not belong to target workspace");
        let metadata = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert!(!metadata
            .folder_id_by_session_id
            .contains_key("codex-missing"));

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn archive_preserves_folder_assignment_and_active_filter_hides_session() {
        let base = std::env::temp_dir().join(format!("session-archive-folder-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        write_codex_session_fixture(&codex_home, "codex-keep", "/tmp/ws-1");
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();
        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Keep".to_string(),
            None,
        )
        .await
        .expect("create folder")
        .folder;
        assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-keep".to_string(),
            Some(folder.id.clone()),
        )
        .await
        .expect("assign session");

        archive_workspace_sessions_core(
            &workspaces,
            &sessions,
            &storage_path,
            "ws-1".to_string(),
            vec!["codex-keep".to_string()],
        )
        .await
        .expect("archive session");
        let metadata = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert_eq!(
            metadata.folder_id_by_session_id.get("codex-keep"),
            Some(&folder.id)
        );

        let entry = WorkspaceSessionCatalogEntry {
            archived_at: metadata
                .archived_at_by_session_id
                .get("codex-keep")
                .copied(),
            ..catalog_entry("codex-keep", "ws-1", Some("Workspace"), None)
        };
        assert!(!entry_matches_status(
            &entry,
            SessionCatalogStatusFilter::Active
        ));
        assert!(entry_matches_status(
            &entry,
            SessionCatalogStatusFilter::Archived
        ));

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn workspace_session_list_keyword_finds_match_beyond_first_scan_window() {
        let base =
            std::env::temp_dir().join(format!("session-keyword-deep-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        for index in 0..60 {
            let timestamp = codex_fixture_timestamp(index);
            let message = if index == 55 {
                "Needle regression"
            } else {
                "Ordinary session"
            };
            write_codex_session_fixture_with_message(
                &codex_home,
                &format!("codex-{index:03}"),
                "/tmp/ws-1",
                &timestamp,
                &timestamp,
                message,
            );
        }
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();

        let page = list_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            Some(WorkspaceSessionCatalogQuery {
                keyword: Some("needle".to_string()),
                engine: None,
                status: Some("all".to_string()),
            }),
            None,
            Some(10),
        )
        .await
        .expect("list sessions");

        assert_eq!(page.data.len(), 1);
        assert_eq!(page.data[0].session_id, "codex-055");
        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn projection_summary_counts_full_history_beyond_default_scan_window() {
        let base =
            std::env::temp_dir().join(format!("session-summary-full-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        for index in 0..60 {
            let timestamp = codex_fixture_timestamp(index);
            write_codex_session_fixture_with_message(
                &codex_home,
                &format!("codex-{index:03}"),
                "/tmp/ws-1",
                &timestamp,
                &timestamp,
                "Fixture session",
            );
        }
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let engine_manager = engine::EngineManager::new();

        let summary = get_workspace_session_projection_summary_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            Some(WorkspaceSessionCatalogQuery {
                keyword: None,
                engine: None,
                status: Some("all".to_string()),
            }),
        )
        .await
        .expect("summary");

        assert_eq!(summary.all_total, 60);
        assert_eq!(summary.filtered_total, 60);
        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn delete_success_metadata_cleanup_removes_global_and_folder_state() {
        let mut metadata = WorkspaceSessionCatalogMetadata {
            archived_at_by_session_id: HashMap::from([("claude:gone".to_string(), 42_i64)]),
            folder_id_by_session_id: HashMap::from([(
                "claude:gone".to_string(),
                "folder-a".to_string(),
            )]),
            ..Default::default()
        };

        metadata.archived_at_by_session_id.remove("claude:gone");
        metadata.folder_id_by_session_id.remove("claude:gone");

        assert!(!metadata
            .archived_at_by_session_id
            .contains_key("claude:gone"));
        assert!(!metadata.folder_id_by_session_id.contains_key("claude:gone"));
    }

    #[test]
    fn keyword_match_includes_source_fields() {
        let entry = catalog_entry("codex:abc", "ws-1", None, None);

        assert!(entry_matches_keyword(&entry, "example"));
        assert!(entry_matches_keyword(&entry, "codex"));
        assert!(entry_matches_keyword(&entry, "cli/codex"));
    }

    #[test]
    fn missing_delete_errors_are_treated_as_settled_success() {
        assert!(should_settle_delete_as_success(
            "[SESSION_NOT_FOUND] Session file not found: stale-session"
        ));
        assert!(should_settle_delete_as_success(
            "thread not found: stale-thread"
        ));
        assert!(!should_settle_delete_as_success(
            "[SESSION_NOT_FOUND] Invalid OpenCode session id"
        ));
        assert!(!should_settle_delete_as_success("permission denied"));
        assert!(!should_settle_delete_as_success("workspace not connected"));
    }

    #[tokio::test]
    async fn catalog_workspace_scope_includes_child_worktrees_for_main_workspace() {
        let main = workspace_entry("main", "Main", "/tmp/main", WorkspaceKind::Main, None);
        let worktree_b = workspace_entry(
            "worktree-b",
            "B",
            "/tmp/worktree-b",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let worktree_a = workspace_entry(
            "worktree-a",
            "A",
            "/tmp/worktree-a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let unrelated = workspace_entry("other", "Other", "/tmp/other", WorkspaceKind::Main, None);
        let workspaces = Mutex::new(HashMap::from([
            (main.id.clone(), main),
            (worktree_b.id.clone(), worktree_b),
            (worktree_a.id.clone(), worktree_a),
            (unrelated.id.clone(), unrelated),
        ]));

        let scope = catalog_workspace_scope(&workspaces, "main")
            .await
            .expect("resolve scope");

        let ids: Vec<_> = scope.into_iter().map(|entry| entry.id).collect();
        assert_eq!(ids, vec!["main", "worktree-a", "worktree-b"]);
    }

    #[tokio::test]
    async fn catalog_workspace_scope_keeps_worktree_selection_isolated() {
        let main = workspace_entry("main", "Main", "/tmp/main", WorkspaceKind::Main, None);
        let worktree = workspace_entry(
            "worktree-a",
            "A",
            "/tmp/worktree-a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let sibling = workspace_entry(
            "worktree-b",
            "B",
            "/tmp/worktree-b",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let workspaces = Mutex::new(HashMap::from([
            (main.id.clone(), main),
            (worktree.id.clone(), worktree),
            (sibling.id.clone(), sibling),
        ]));

        let scope = catalog_workspace_scope(&workspaces, "worktree-a")
            .await
            .expect("resolve isolated scope");

        let ids: Vec<_> = scope.into_iter().map(|entry| entry.id).collect();
        assert_eq!(ids, vec!["worktree-a"]);
    }

    #[tokio::test]
    async fn claude_child_workspace_session_is_not_claimed_by_parent_projection() {
        let base = std::env::temp_dir().join(format!("claude-child-owner-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let repo_path = base.join("repo");
        let child_path = repo_path.join("sub");
        std::fs::create_dir_all(&child_path).expect("create child workspace path");

        let claude_home = base.join("claude-home");
        let claude_projects_dir = claude_home.join("projects");
        let session_id = "child-claude-session";
        write_claude_session_fixture(
            &claude_projects_dir,
            &repo_path,
            session_id,
            &child_path,
            "child workspace task",
        );

        let parent = workspace_entry(
            "parent",
            "Parent",
            &repo_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let child = workspace_entry(
            "child",
            "Child",
            &child_path.to_string_lossy(),
            WorkspaceKind::Worktree,
            Some("parent"),
        );
        let workspaces = Mutex::new(HashMap::from([
            (parent.id.clone(), parent),
            (child.id.clone(), child),
        ]));
        let engine_manager = engine::EngineManager::new();
        engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    home_dir: Some(claude_home.to_string_lossy().to_string()),
                    ..engine::EngineConfig::default()
                },
            )
            .await;

        let parent_data = build_workspace_scope_catalog_data(
            &workspaces,
            &engine_manager,
            &storage_path,
            "parent",
            SessionCatalogScanMode::Bounded(20),
        )
        .await
        .expect("build parent catalog data");
        let child_data = build_workspace_scope_catalog_data(
            &workspaces,
            &engine_manager,
            &storage_path,
            "child",
            SessionCatalogScanMode::Bounded(20),
        )
        .await
        .expect("build child catalog data");

        let parent_claude_entries = parent_data
            .entries
            .iter()
            .filter(|entry| entry.session_id == format!("claude:{session_id}"))
            .collect::<Vec<_>>();
        assert_eq!(parent_claude_entries.len(), 1);
        assert_eq!(parent_claude_entries[0].workspace_id, "child");
        assert_eq!(
            parent_claude_entries[0].matched_workspace_id.as_deref(),
            Some("child")
        );

        let child_claude_entries = child_data
            .entries
            .iter()
            .filter(|entry| entry.session_id == format!("claude:{session_id}"))
            .collect::<Vec<_>>();
        assert_eq!(child_claude_entries.len(), 1);
        assert_eq!(child_claude_entries[0].workspace_id, "child");
        assert_eq!(
            child_claude_entries[0].matched_workspace_id.as_deref(),
            Some("child")
        );

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn claude_independent_nested_workspace_session_is_not_claimed_by_parent_projection() {
        let base = std::env::temp_dir().join(format!("claude-nested-owner-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let repo_path = base.join("repo");
        let child_path = repo_path.join("sub");
        std::fs::create_dir_all(&child_path).expect("create child workspace path");

        let claude_home = base.join("claude-home");
        let claude_projects_dir = claude_home.join("projects");
        let session_id = "nested-claude-session";
        write_claude_session_fixture(
            &claude_projects_dir,
            &repo_path,
            session_id,
            &child_path,
            "nested workspace task",
        );

        let parent = workspace_entry(
            "parent",
            "Parent",
            &repo_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let child = workspace_entry(
            "child",
            "Child",
            &child_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let workspaces = Mutex::new(HashMap::from([
            (parent.id.clone(), parent),
            (child.id.clone(), child),
        ]));
        let engine_manager = engine::EngineManager::new();
        engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    home_dir: Some(claude_home.to_string_lossy().to_string()),
                    ..engine::EngineConfig::default()
                },
            )
            .await;

        let parent_data = build_workspace_scope_catalog_data(
            &workspaces,
            &engine_manager,
            &storage_path,
            "parent",
            SessionCatalogScanMode::Bounded(20),
        )
        .await
        .expect("build parent catalog data");
        let child_data = build_workspace_scope_catalog_data(
            &workspaces,
            &engine_manager,
            &storage_path,
            "child",
            SessionCatalogScanMode::Bounded(20),
        )
        .await
        .expect("build child catalog data");

        assert!(!parent_data
            .entries
            .iter()
            .any(|entry| entry.session_id == format!("claude:{session_id}")));

        let child_claude_entry = child_data
            .entries
            .iter()
            .find(|entry| entry.session_id == format!("claude:{session_id}"))
            .expect("child projection should include nested claude session");
        assert_eq!(child_claude_entry.workspace_id, "child");
        assert_eq!(
            child_claude_entry.matched_workspace_id.as_deref(),
            Some("child")
        );

        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn catalog_entry_dedupe_key_includes_workspace_identity() {
        let left = catalog_entry("shared-session", "main", None, None);
        let right = WorkspaceSessionCatalogEntry {
            workspace_id: "worktree-a".to_string(),
            ..left.clone()
        };

        assert_ne!(
            build_catalog_entry_dedupe_key(&left),
            build_catalog_entry_dedupe_key(&right)
        );
    }

    #[test]
    fn catalog_entry_dedupe_key_collapses_same_workspace_identity() {
        let left = catalog_entry("shared-session", "main", None, None);
        let right = WorkspaceSessionCatalogEntry {
            source: Some("override".to_string()),
            source_label: Some("override/codex".to_string()),
            updated_at: 2,
            ..left.clone()
        };

        assert_eq!(
            build_catalog_entry_dedupe_key(&left),
            build_catalog_entry_dedupe_key(&right)
        );
    }

    #[test]
    fn partial_source_join_dedupes_scope_failures_without_dropping_signal() {
        let partial_source = join_partial_sources(vec![
            SESSION_CATALOG_PARTIAL_CODEX.to_string(),
            SESSION_CATALOG_PARTIAL_GEMINI.to_string(),
            SESSION_CATALOG_PARTIAL_CODEX.to_string(),
        ]);

        assert_eq!(
            partial_source,
            Some("codex-history-unavailable,gemini-history-unavailable".to_string())
        );
    }

    #[test]
    fn projection_summary_counts_filtered_total_separately_from_status_buckets() {
        let mut active = catalog_entry("codex:active", "main", Some("Main"), None);
        active.engine = "codex".to_string();
        active.title = "Bugfix discussion".to_string();

        let mut archived = catalog_entry("claude:archived", "worktree-a", Some("Worktree"), None);
        archived.engine = "claude".to_string();
        archived.title = "Bugfix archive".to_string();
        archived.archived_at = Some(42);

        let mut other = catalog_entry("gemini:other", "main", Some("Main"), None);
        other.engine = "gemini".to_string();
        other.title = "Other topic".to_string();

        let counts = build_catalog_count_summary(
            &[active, archived, other],
            &WorkspaceSessionCatalogQuery {
                keyword: Some("bugfix".to_string()),
                engine: None,
                status: Some("active".to_string()),
            },
        );

        assert_eq!(
            counts,
            SessionCatalogCountSummary {
                active_total: 1,
                archived_total: 1,
                all_total: 2,
                filtered_total: 1,
            }
        );
    }

    #[test]
    fn normalize_partial_sources_preserves_first_seen_order() {
        let partial_sources = normalize_partial_sources(vec![
            SESSION_CATALOG_PARTIAL_GEMINI.to_string(),
            SESSION_CATALOG_PARTIAL_CODEX.to_string(),
            SESSION_CATALOG_PARTIAL_GEMINI.to_string(),
        ]);

        assert_eq!(
            partial_sources,
            vec![
                SESSION_CATALOG_PARTIAL_GEMINI.to_string(),
                SESSION_CATALOG_PARTIAL_CODEX.to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn catalog_workspace_scope_supports_windows_style_paths_without_changing_scope_ids() {
        let main = workspace_entry("main", "Main", r"C:\repo\main", WorkspaceKind::Main, None);
        let worktree = workspace_entry(
            "worktree-a",
            "Worktree A",
            r"C:\repo\main\.worktrees\a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let unrelated = workspace_entry(
            "other",
            "Other",
            r"D:\repo\other",
            WorkspaceKind::Main,
            None,
        );
        let workspaces = Mutex::new(HashMap::from([
            (main.id.clone(), main),
            (worktree.id.clone(), worktree),
            (unrelated.id.clone(), unrelated),
        ]));

        let scope = catalog_workspace_scope(&workspaces, "main")
            .await
            .expect("resolve windows scope");

        let ids: Vec<_> = scope.into_iter().map(|entry| entry.id).collect();
        assert_eq!(ids, vec!["main", "worktree-a"]);
    }

    #[test]
    fn inferred_related_attribution_marks_same_worktree_family_as_high_confidence() {
        let main = workspace_entry("main", "Main", "/repo/main", WorkspaceKind::Main, None);
        let mut worktree_a = workspace_entry(
            "worktree-a",
            "A",
            "/repo/worktree-a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let worktree_b = workspace_entry(
            "worktree-b",
            "B",
            "/repo/worktree-b",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        worktree_a.settings.git_root = Some("/repo".to_string());

        let workspaces = HashMap::from([
            (main.id.clone(), main),
            (worktree_a.id.clone(), worktree_a.clone()),
            (worktree_b.id.clone(), worktree_b.clone()),
        ]);
        let entry = catalog_entry("codex:1", "worktree-b", Some("B"), Some("/repo/worktree-b"));

        let attribution = infer_related_attribution_for_workspace(&workspaces, &worktree_a, &entry)
            .expect("related attribution");

        assert_eq!(
            attribution.status,
            SessionCatalogAttributionStatus::InferredRelated
        );
        assert_eq!(
            attribution.reason,
            Some(SessionCatalogAttributionReason::SharedWorktreeFamily)
        );
        assert_eq!(
            attribution.confidence,
            Some(SessionCatalogAttributionConfidence::High)
        );
    }

    #[test]
    fn inferred_related_attribution_uses_unique_git_root_match() {
        let mut main = workspace_entry("main", "Main", "/repo/main", WorkspaceKind::Main, None);
        main.settings.git_root = Some("/repo".to_string());
        let unrelated = workspace_entry("other", "Other", "/elsewhere", WorkspaceKind::Main, None);
        let workspaces = HashMap::from([
            (main.id.clone(), main.clone()),
            (unrelated.id.clone(), unrelated),
        ]);
        let entry = catalog_entry(
            "codex:2",
            SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID,
            None,
            Some("/repo/tools"),
        );

        let attribution = infer_related_attribution_for_workspace(&workspaces, &main, &entry)
            .expect("git root attribution");

        assert_eq!(
            attribution.reason,
            Some(SessionCatalogAttributionReason::SharedGitRoot)
        );
        assert_eq!(
            attribution.confidence,
            Some(SessionCatalogAttributionConfidence::Medium)
        );
    }

    #[test]
    fn inferred_related_attribution_keeps_ambiguous_git_root_unassigned() {
        let mut main_a = workspace_entry("main-a", "Main A", "/repo-a", WorkspaceKind::Main, None);
        main_a.settings.git_root = Some("/shared".to_string());
        let mut main_b = workspace_entry("main-b", "Main B", "/repo-b", WorkspaceKind::Main, None);
        main_b.settings.git_root = Some("/shared".to_string());
        let workspaces = HashMap::from([
            (main_a.id.clone(), main_a.clone()),
            (main_b.id.clone(), main_b),
        ]);
        let entry = catalog_entry(
            "codex:3",
            SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID,
            None,
            Some("/shared/tools"),
        );

        let attribution = infer_related_attribution_for_workspace(&workspaces, &main_a, &entry);

        assert!(attribution.is_none());
    }

    #[test]
    fn shared_attribution_resolver_uses_cwd_strict_match_for_any_engine() {
        let main = workspace_entry("main", "Main", "/repo/main", WorkspaceKind::Main, None);
        let workspaces = HashMap::from([(main.id.clone(), main.clone())]);
        let mut entry = catalog_entry("claude:cwd", SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID, None, Some("/repo/main/src"));
        entry.engine = "claude".to_string();

        let attribution = resolve_catalog_entry_attribution(&workspaces, &entry);

        assert_eq!(
            attribution.status,
            SessionCatalogAttributionStatus::StrictMatch
        );
        assert_eq!(
            attribution.reason,
            Some(SessionCatalogAttributionReason::DirectWorkspacePath)
        );
        assert_eq!(attribution.matched_workspace_id.as_deref(), Some("main"));
    }

    #[test]
    fn shared_attribution_resolver_uses_git_root_strict_match() {
        let mut main = workspace_entry("main", "Main", "/repo/main/app", WorkspaceKind::Main, None);
        main.settings.git_root = Some("/repo/main".to_string());
        let other = workspace_entry("other", "Other", "/elsewhere", WorkspaceKind::Main, None);
        let workspaces = HashMap::from([
            (main.id.clone(), main.clone()),
            (other.id.clone(), other),
        ]);
        let mut entry = catalog_entry("claude:git", SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID, None, Some("/repo/main/tools"));
        entry.engine = "claude".to_string();

        let attribution = resolve_catalog_entry_attribution(&workspaces, &entry);

        assert_eq!(
            attribution.status,
            SessionCatalogAttributionStatus::StrictMatch
        );
        assert_eq!(
            attribution.reason,
            Some(SessionCatalogAttributionReason::DirectGitRoot)
        );
        assert_eq!(attribution.matched_workspace_id.as_deref(), Some("main"));
    }

    #[test]
    fn shared_attribution_resolver_keeps_ambiguous_workspace_match_unassigned() {
        let main_a = workspace_entry("main-a", "Main A", "/repo/main", WorkspaceKind::Main, None);
        let main_b = workspace_entry("main-b", "Main B", "/repo/main", WorkspaceKind::Main, None);
        let workspaces = HashMap::from([
            (main_a.id.clone(), main_a),
            (main_b.id.clone(), main_b),
        ]);
        let mut entry = catalog_entry("claude:ambiguous", SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID, None, Some("/repo/main/src"));
        entry.engine = "claude".to_string();

        let attribution = resolve_catalog_entry_attribution(&workspaces, &entry);

        assert_eq!(
            attribution.status,
            SessionCatalogAttributionStatus::Unassigned
        );
        assert_eq!(
            attribution.reason,
            Some(SessionCatalogAttributionReason::UnassignedAmbiguous)
        );
        assert_eq!(attribution.matched_workspace_id, None);
    }

    #[test]
    fn catalog_dedupe_key_preserves_same_title_across_engines() {
        let mut codex = catalog_entry("shared-id", "main", Some("Main"), Some("/repo/main"));
        codex.engine = "codex".to_string();
        codex.title = "Same title".to_string();
        let mut claude = catalog_entry("shared-id", "main", Some("Main"), Some("/repo/main"));
        claude.engine = "claude".to_string();
        claude.title = "Same title".to_string();

        assert_ne!(
            build_catalog_entry_dedupe_key(&codex),
            build_catalog_entry_dedupe_key(&claude)
        );
    }

    #[test]
    fn claude_attribution_scopes_include_git_root_without_duplication() {
        let mut main = workspace_entry("main", "Main", "/repo/main", WorkspaceKind::Main, None);
        main.settings.git_root = Some("/repo/main".to_string());

        let scopes = build_claude_attribution_scopes(&main);

        assert_eq!(scopes.len(), 1);
        assert_eq!(scopes[0].path, PathBuf::from("/repo/main"));
    }
