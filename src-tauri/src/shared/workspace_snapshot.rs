use std::collections::HashMap;

use tokio::sync::Mutex;

use crate::types::{AppSettings, WorkspaceEntry};

pub(crate) async fn resolve_workspace_and_parent(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<(WorkspaceEntry, Option<WorkspaceEntry>), String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    let parent_entry = entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id))
        .cloned();
    Ok((entry, parent_entry))
}

pub(crate) async fn resolve_workspace_parent_and_settings(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    app_settings: &Mutex<AppSettings>,
    workspace_id: &str,
) -> Result<(WorkspaceEntry, Option<WorkspaceEntry>, AppSettings), String> {
    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, workspace_id).await?;
    let settings = app_settings.lock().await.clone();
    Ok((entry, parent_entry, settings))
}

#[cfg(test)]
mod tests {
    use super::{resolve_workspace_and_parent, resolve_workspace_parent_and_settings};
    use crate::types::{AppSettings, WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use tokio::sync::Mutex;

    fn workspace_entry(id: &str, parent_id: Option<&str>) -> WorkspaceEntry {
        let path = PathBuf::from("workspace-fixtures")
            .join(id)
            .to_string_lossy()
            .into_owned();
        WorkspaceEntry {
            id: id.to_string(),
            name: format!("workspace-{id}"),
            path,
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: parent_id.map(ToString::to_string),
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    #[tokio::test]
    async fn resolves_workspace_and_parent_snapshot() {
        let mut workspace_map = HashMap::new();
        workspace_map.insert("parent".to_string(), workspace_entry("parent", None));
        workspace_map.insert(
            "child".to_string(),
            workspace_entry("child", Some("parent")),
        );

        let workspaces = Mutex::new(workspace_map);
        let (entry, parent_entry) = resolve_workspace_and_parent(&workspaces, "child")
            .await
            .expect("workspace snapshot should resolve");

        assert_eq!(entry.id, "child");
        assert_eq!(parent_entry.as_ref().map(|value| value.id.as_str()), Some("parent"));
    }

    #[tokio::test]
    async fn returns_error_for_missing_workspace() {
        let workspaces = Mutex::new(HashMap::new());

        let error = resolve_workspace_and_parent(&workspaces, "missing")
            .await
            .expect_err("missing workspace should fail");

        assert_eq!(error, "workspace not found");
    }

    #[tokio::test]
    async fn resolves_workspace_parent_and_settings_snapshot() {
        let mut workspace_map = HashMap::new();
        workspace_map.insert("parent".to_string(), workspace_entry("parent", None));
        workspace_map.insert(
            "child".to_string(),
            workspace_entry("child", Some("parent")),
        );
        let workspaces = Mutex::new(workspace_map);

        let mut settings = AppSettings::default();
        settings.codex_bin = Some("codex-fixture".to_string());
        let app_settings = Mutex::new(settings);

        let (entry, parent_entry, settings_snapshot) =
            resolve_workspace_parent_and_settings(&workspaces, &app_settings, "child")
                .await
                .expect("workspace + settings snapshot should resolve");

        assert_eq!(entry.id, "child");
        assert_eq!(parent_entry.as_ref().map(|value| value.id.as_str()), Some("parent"));
        assert_eq!(settings_snapshot.codex_bin.as_deref(), Some("codex-fixture"));
    }
}
