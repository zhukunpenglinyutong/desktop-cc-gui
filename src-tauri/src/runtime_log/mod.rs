use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::remote_backend;
use crate::state::AppState;

const RUNTIME_TERMINAL_ID: &str = "runtime-console";
const DEFAULT_TERMINAL_COLS: u16 = 120;
const DEFAULT_TERMINAL_ROWS: u16 = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RuntimeSessionStatus {
    Idle,
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum RuntimeLauncherKind {
    MavenWrapper,
    MavenSystem,
    GradleWrapper,
    GradleSystem,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeLaunchCommand {
    pub(crate) kind: RuntimeLauncherKind,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct RuntimeSessionRecord {
    pub(crate) workspace_id: String,
    pub(crate) terminal_id: String,
    pub(crate) status: RuntimeSessionStatus,
    pub(crate) command_preview: Option<String>,
    pub(crate) started_at_ms: Option<u64>,
    pub(crate) stopped_at_ms: Option<u64>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeSessionSnapshot {
    pub(crate) workspace_id: String,
    pub(crate) terminal_id: String,
    pub(crate) status: RuntimeSessionStatus,
    pub(crate) command_preview: Option<String>,
    pub(crate) started_at_ms: Option<u64>,
    pub(crate) stopped_at_ms: Option<u64>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) error: Option<String>,
}

impl RuntimeSessionRecord {
    fn to_snapshot(&self) -> RuntimeSessionSnapshot {
        RuntimeSessionSnapshot {
            workspace_id: self.workspace_id.clone(),
            terminal_id: self.terminal_id.clone(),
            status: self.status.clone(),
            command_preview: self.command_preview.clone(),
            started_at_ms: self.started_at_ms,
            stopped_at_ms: self.stopped_at_ms,
            exit_code: self.exit_code,
            error: self.error.clone(),
        }
    }
}

fn has(entries: &HashSet<&str>, name: &str) -> bool {
    entries.contains(name)
}

pub(crate) fn detect_java_launcher(entries: &[String]) -> Option<RuntimeLaunchCommand> {
    let by_name: HashSet<&str> = entries
        .iter()
        .filter_map(|item| item.rsplit(['/', '\\']).next())
        .collect();

    #[cfg(windows)]
    if has(&by_name, "mvnw.cmd") && has(&by_name, "pom.xml") {
        return Some(RuntimeLaunchCommand {
            kind: RuntimeLauncherKind::MavenWrapper,
            program: "mvnw.cmd".to_string(),
            args: vec!["spring-boot:run".to_string()],
        });
    }

    #[cfg(not(windows))]
    if has(&by_name, "mvnw") && has(&by_name, "pom.xml") {
        return Some(RuntimeLaunchCommand {
            kind: RuntimeLauncherKind::MavenWrapper,
            program: "./mvnw".to_string(),
            args: vec!["spring-boot:run".to_string()],
        });
    }
    if has(&by_name, "pom.xml") {
        return Some(RuntimeLaunchCommand {
            kind: RuntimeLauncherKind::MavenSystem,
            program: "mvn".to_string(),
            args: vec!["spring-boot:run".to_string()],
        });
    }
    #[cfg(windows)]
    if has(&by_name, "gradlew.bat")
        && (has(&by_name, "build.gradle") || has(&by_name, "build.gradle.kts"))
    {
        return Some(RuntimeLaunchCommand {
            kind: RuntimeLauncherKind::GradleWrapper,
            program: "gradlew.bat".to_string(),
            args: vec!["bootRun".to_string()],
        });
    }
    #[cfg(not(windows))]
    if has(&by_name, "gradlew")
        && (has(&by_name, "build.gradle") || has(&by_name, "build.gradle.kts"))
    {
        return Some(RuntimeLaunchCommand {
            kind: RuntimeLauncherKind::GradleWrapper,
            program: "./gradlew".to_string(),
            args: vec!["bootRun".to_string()],
        });
    }
    if has(&by_name, "build.gradle") || has(&by_name, "build.gradle.kts") {
        return Some(RuntimeLaunchCommand {
            kind: RuntimeLauncherKind::GradleSystem,
            program: "gradle".to_string(),
            args: vec!["bootRun".to_string()],
        });
    }
    None
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

async fn get_workspace_root(
    state: &State<'_, AppState>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
    Ok(PathBuf::from(&entry.path))
}

fn list_workspace_root_entries(workspace_root: &Path) -> Result<Vec<String>, String> {
    let mut entries = Vec::new();
    let reader = std::fs::read_dir(workspace_root)
        .map_err(|error| format!("Failed to read workspace root: {error}"))?;
    for entry in reader.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            entries.push(name.to_string());
        }
    }
    Ok(entries)
}

#[cfg(not(windows))]
fn build_detected_run_script(launcher: &RuntimeLaunchCommand) -> String {
    let joined = if launcher.args.is_empty() {
        launcher.program.clone()
    } else {
        format!("{} {}", launcher.program, launcher.args.join(" "))
    };
    let mut lines = vec![
        "CODEMOSS_RUN_EXIT_CODE=0".to_string(),
        "if ! command -v java >/dev/null 2>&1; then".to_string(),
        "  echo \"[CodeMoss Run] Java not found. Install JDK and ensure java is on PATH.\""
            .to_string(),
        "  CODEMOSS_RUN_EXIT_CODE=127".to_string(),
        "else".to_string(),
    ];

    match launcher.kind {
        RuntimeLauncherKind::MavenWrapper => {
            lines.push("  if [ ! -x \"./mvnw\" ]; then".to_string());
            lines.push("    echo \"[CodeMoss Run] ./mvnw is missing execute permission. Run: chmod +x ./mvnw\"".to_string());
            lines.push("    CODEMOSS_RUN_EXIT_CODE=126".to_string());
            lines.push("  else".to_string());
            lines.push(format!("    echo \"[CodeMoss Run] Using: {joined}\""));
            lines.push(format!("    {joined}"));
            lines.push("    CODEMOSS_RUN_EXIT_CODE=$?".to_string());
            lines.push("  fi".to_string());
        }
        RuntimeLauncherKind::MavenSystem => {
            lines.push("  if ! command -v mvn >/dev/null 2>&1; then".to_string());
            lines.push("    echo \"[CodeMoss Run] Maven not found. Install Maven or add ./mvnw to project root.\"".to_string());
            lines.push("    CODEMOSS_RUN_EXIT_CODE=127".to_string());
            lines.push("  else".to_string());
            lines.push(format!("    echo \"[CodeMoss Run] Using: {joined}\""));
            lines.push(format!("    {joined}"));
            lines.push("    CODEMOSS_RUN_EXIT_CODE=$?".to_string());
            lines.push("  fi".to_string());
        }
        RuntimeLauncherKind::GradleWrapper => {
            lines.push("  if [ ! -x \"./gradlew\" ]; then".to_string());
            lines.push("    echo \"[CodeMoss Run] ./gradlew is missing execute permission. Run: chmod +x ./gradlew\"".to_string());
            lines.push("    CODEMOSS_RUN_EXIT_CODE=126".to_string());
            lines.push("  else".to_string());
            lines.push(format!("    echo \"[CodeMoss Run] Using: {joined}\""));
            lines.push(format!("    {joined}"));
            lines.push("    CODEMOSS_RUN_EXIT_CODE=$?".to_string());
            lines.push("  fi".to_string());
        }
        RuntimeLauncherKind::GradleSystem => {
            lines.push("  if ! command -v gradle >/dev/null 2>&1; then".to_string());
            lines.push("    echo \"[CodeMoss Run] Gradle not found. Install Gradle or add ./gradlew to project root.\"".to_string());
            lines.push("    CODEMOSS_RUN_EXIT_CODE=127".to_string());
            lines.push("  else".to_string());
            lines.push(format!("    echo \"[CodeMoss Run] Using: {joined}\""));
            lines.push(format!("    {joined}"));
            lines.push("    CODEMOSS_RUN_EXIT_CODE=$?".to_string());
            lines.push("  fi".to_string());
        }
    }
    lines.push("fi".to_string());
    lines.push("echo \"[CodeMoss Run] __EXIT__:${CODEMOSS_RUN_EXIT_CODE}\"".to_string());

    lines.join("\n")
}

#[cfg(windows)]
fn build_detected_run_script(launcher: &RuntimeLaunchCommand) -> String {
    let joined = if launcher.args.is_empty() {
        launcher.program.clone()
    } else {
        format!("{} {}", launcher.program, launcher.args.join(" "))
    };
    let mut lines = vec![
        "@echo off".to_string(),
        "setlocal EnableExtensions EnableDelayedExpansion".to_string(),
        "set \"CODEMOSS_RUN_EXIT_CODE=0\"".to_string(),
        "where java >nul 2>&1".to_string(),
        "if errorlevel 1 (".to_string(),
        "  echo [CodeMoss Run] Java not found. Install JDK and ensure java is on PATH."
            .to_string(),
        "  set \"CODEMOSS_RUN_EXIT_CODE=127\"".to_string(),
        ") else (".to_string(),
    ];

    match launcher.kind {
        RuntimeLauncherKind::MavenWrapper => {
            lines.push(format!("  if not exist \"{}\" (", launcher.program));
            lines.push(format!(
                "    echo [CodeMoss Run] {} not found in project root.",
                launcher.program
            ));
            lines.push("    set \"CODEMOSS_RUN_EXIT_CODE=126\"".to_string());
            lines.push("  ) else (".to_string());
            lines.push(format!("    echo [CodeMoss Run] Using: {joined}"));
            lines.push(format!("    call {joined}"));
            lines.push("    set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"".to_string());
            lines.push("  )".to_string());
        }
        RuntimeLauncherKind::MavenSystem => {
            lines.push("  where mvn >nul 2>&1".to_string());
            lines.push("  if errorlevel 1 (".to_string());
            lines.push("    echo [CodeMoss Run] Maven not found. Install Maven or add mvnw.cmd to project root.".to_string());
            lines.push("    set \"CODEMOSS_RUN_EXIT_CODE=127\"".to_string());
            lines.push("  ) else (".to_string());
            lines.push(format!("    echo [CodeMoss Run] Using: {joined}"));
            lines.push(format!("    call {joined}"));
            lines.push("    set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"".to_string());
            lines.push("  )".to_string());
        }
        RuntimeLauncherKind::GradleWrapper => {
            lines.push(format!("  if not exist \"{}\" (", launcher.program));
            lines.push(format!(
                "    echo [CodeMoss Run] {} not found in project root.",
                launcher.program
            ));
            lines.push("    set \"CODEMOSS_RUN_EXIT_CODE=126\"".to_string());
            lines.push("  ) else (".to_string());
            lines.push(format!("    echo [CodeMoss Run] Using: {joined}"));
            lines.push(format!("    call {joined}"));
            lines.push("    set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"".to_string());
            lines.push("  )".to_string());
        }
        RuntimeLauncherKind::GradleSystem => {
            lines.push("  where gradle >nul 2>&1".to_string());
            lines.push("  if errorlevel 1 (".to_string());
            lines.push("    echo [CodeMoss Run] Gradle not found. Install Gradle or add gradlew.bat to project root.".to_string());
            lines.push("    set \"CODEMOSS_RUN_EXIT_CODE=127\"".to_string());
            lines.push("  ) else (".to_string());
            lines.push(format!("    echo [CodeMoss Run] Using: {joined}"));
            lines.push(format!("    call {joined}"));
            lines.push("    set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"".to_string());
            lines.push("  )".to_string());
        }
    }
    lines.push(")".to_string());
    lines.push("echo [CodeMoss Run] __EXIT__:!CODEMOSS_RUN_EXIT_CODE!".to_string());
    lines.join("\r\n")
}

#[cfg(not(windows))]
fn build_custom_run_script(command: &str) -> String {
    let mut lines = vec![
        "CODEMOSS_RUN_EXIT_CODE=0".to_string(),
        "if ! command -v java >/dev/null 2>&1; then".to_string(),
        "  echo \"[CodeMoss Run] Java not found. Install JDK and ensure java is on PATH.\""
            .to_string(),
        "  CODEMOSS_RUN_EXIT_CODE=127".to_string(),
        "else".to_string(),
        "  echo \"[CodeMoss Run] Using custom run command from console.\"".to_string(),
        format!("  {command}"),
        "  CODEMOSS_RUN_EXIT_CODE=$?".to_string(),
        "fi".to_string(),
        "echo \"[CodeMoss Run] __EXIT__:${CODEMOSS_RUN_EXIT_CODE}\"".to_string(),
    ];
    lines.join("\n")
}

#[cfg(windows)]
fn build_custom_run_script(command: &str) -> String {
    let mut lines = vec![
        "@echo off".to_string(),
        "setlocal EnableExtensions EnableDelayedExpansion".to_string(),
        "set \"CODEMOSS_RUN_EXIT_CODE=0\"".to_string(),
        "where java >nul 2>&1".to_string(),
        "if errorlevel 1 (".to_string(),
        "  echo [CodeMoss Run] Java not found. Install JDK and ensure java is on PATH."
            .to_string(),
        "  set \"CODEMOSS_RUN_EXIT_CODE=127\"".to_string(),
        ") else (".to_string(),
        "  echo [CodeMoss Run] Using custom run command from console.".to_string(),
        format!("  {command}"),
        "  set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"".to_string(),
        ")".to_string(),
        "echo [CodeMoss Run] __EXIT__:!CODEMOSS_RUN_EXIT_CODE!".to_string(),
    ];
    lines.join("\r\n")
}

async fn update_runtime_session(
    state: &State<'_, AppState>,
    workspace_id: &str,
    updater: impl FnOnce(Option<RuntimeSessionRecord>) -> RuntimeSessionRecord,
) -> RuntimeSessionSnapshot {
    let mut sessions = state.runtime_log_sessions.lock().await;
    let current = sessions.get(workspace_id).cloned();
    let next = updater(current);
    sessions.insert(workspace_id.to_string(), next.clone());
    next.to_snapshot()
}

fn emit_runtime_status(app: &AppHandle, snapshot: &RuntimeSessionSnapshot) {
    let _ = app.emit("runtime-log:status-changed", snapshot);
}

fn emit_runtime_exited(app: &AppHandle, snapshot: &RuntimeSessionSnapshot) {
    let _ = app.emit("runtime-log:session-exited", snapshot);
}

#[tauri::command]
pub(crate) async fn runtime_log_start(
    workspace_id: String,
    command_override: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<RuntimeSessionSnapshot, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("runtime_log_start is not supported in remote mode yet.".to_string());
    }

    let normalized_command_override = command_override.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    let launcher = if normalized_command_override.is_none() {
        let workspace_root = get_workspace_root(&state, &workspace_id).await?;
        let root_entries = list_workspace_root_entries(&workspace_root)?;
        Some(detect_java_launcher(&root_entries).ok_or_else(|| {
            "No Java launcher detected. Expected one of: pom.xml, build.gradle, build.gradle.kts."
                .to_string()
        })?)
    } else {
        None
    };
    let command_preview = if let Some(override_command) = normalized_command_override.as_ref() {
        override_command.clone()
    } else if let Some(launcher) = launcher.as_ref() {
        if launcher.args.is_empty() {
            launcher.program.clone()
        } else {
            format!("{} {}", launcher.program, launcher.args.join(" "))
        }
    } else {
        return Err("Runtime launcher resolution failed.".to_string());
    };
    let run_script = if let Some(override_command) = normalized_command_override.as_deref() {
        build_custom_run_script(override_command)
    } else if let Some(launcher) = launcher.as_ref() {
        build_detected_run_script(launcher)
    } else {
        return Err("Runtime launcher resolution failed.".to_string());
    };
    let started_at_ms = now_ms();

    let starting_snapshot = update_runtime_session(&state, &workspace_id, |_| RuntimeSessionRecord {
        workspace_id: workspace_id.clone(),
        terminal_id: RUNTIME_TERMINAL_ID.to_string(),
        status: RuntimeSessionStatus::Starting,
        command_preview: Some(command_preview.clone()),
        started_at_ms: Some(started_at_ms),
        stopped_at_ms: None,
        exit_code: None,
        error: None,
    })
    .await;
    emit_runtime_status(&app, &starting_snapshot);

    let runtime_terminal_id = RUNTIME_TERMINAL_ID.to_string();
    let _ = crate::terminal::terminal_close(
        workspace_id.clone(),
        runtime_terminal_id.clone(),
        app.state::<AppState>(),
    )
    .await;

    let start_result = async {
        crate::terminal::terminal_open(
            workspace_id.clone(),
            runtime_terminal_id.clone(),
            DEFAULT_TERMINAL_COLS,
            DEFAULT_TERMINAL_ROWS,
            app.state::<AppState>(),
            app.clone(),
        )
        .await?;
        crate::terminal::terminal_write(
            workspace_id.clone(),
            runtime_terminal_id.clone(),
            format!("{}\n", run_script),
            app.state::<AppState>(),
        )
        .await?;
        Ok::<(), String>(())
    }
    .await;

    match start_result {
        Ok(()) => {
            let running_snapshot =
                update_runtime_session(&state, &workspace_id, |current| {
                    let previous_started = current.and_then(|value| value.started_at_ms);
                    RuntimeSessionRecord {
                        workspace_id: workspace_id.clone(),
                        terminal_id: RUNTIME_TERMINAL_ID.to_string(),
                        status: RuntimeSessionStatus::Running,
                        command_preview: Some(command_preview),
                        started_at_ms: previous_started.or(Some(started_at_ms)),
                        stopped_at_ms: None,
                        exit_code: None,
                        error: None,
                    }
                })
                .await;
            emit_runtime_status(&app, &running_snapshot);
            Ok(running_snapshot)
        }
        Err(error) => {
            let failed_snapshot =
                update_runtime_session(&state, &workspace_id, |current| {
                    let (previous_command, previous_started) = match current {
                        Some(value) => (value.command_preview, value.started_at_ms),
                        None => (None, None),
                    };
                    RuntimeSessionRecord {
                        workspace_id: workspace_id.clone(),
                        terminal_id: RUNTIME_TERMINAL_ID.to_string(),
                        status: RuntimeSessionStatus::Failed,
                        command_preview: previous_command.or(Some(command_preview)),
                        started_at_ms: previous_started.or(Some(started_at_ms)),
                        stopped_at_ms: Some(now_ms()),
                        exit_code: None,
                        error: Some(error.clone()),
                    }
                })
                .await;
            emit_runtime_status(&app, &failed_snapshot);
            emit_runtime_exited(&app, &failed_snapshot);
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn runtime_log_stop(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<RuntimeSessionSnapshot, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("runtime_log_stop is not supported in remote mode yet.".to_string());
    }

    let stopping_snapshot = update_runtime_session(&state, &workspace_id, |current| {
        let now = now_ms();
        match current {
            Some(value) => RuntimeSessionRecord {
                status: RuntimeSessionStatus::Stopping,
                ..value
            },
            None => RuntimeSessionRecord {
                workspace_id: workspace_id.clone(),
                terminal_id: RUNTIME_TERMINAL_ID.to_string(),
                status: RuntimeSessionStatus::Stopping,
                command_preview: None,
                started_at_ms: Some(now),
                stopped_at_ms: None,
                exit_code: None,
                error: None,
            },
        }
    })
    .await;
    emit_runtime_status(&app, &stopping_snapshot);

    let close_result = crate::terminal::terminal_close(
        workspace_id.clone(),
        RUNTIME_TERMINAL_ID.to_string(),
        app.state::<AppState>(),
    )
    .await;

    match close_result {
        Ok(()) => {
            let stopped_snapshot =
                update_runtime_session(&state, &workspace_id, |current| {
                    let now = now_ms();
                    let base = current.unwrap_or(RuntimeSessionRecord {
                        workspace_id: workspace_id.clone(),
                        terminal_id: RUNTIME_TERMINAL_ID.to_string(),
                        status: RuntimeSessionStatus::Stopped,
                        command_preview: None,
                        started_at_ms: Some(now),
                        stopped_at_ms: None,
                        exit_code: None,
                        error: None,
                    });
                    RuntimeSessionRecord {
                        status: RuntimeSessionStatus::Stopped,
                        stopped_at_ms: Some(now),
                        exit_code: base.exit_code.or(Some(130)),
                        ..base
                    }
                })
                .await;
            emit_runtime_status(&app, &stopped_snapshot);
            emit_runtime_exited(&app, &stopped_snapshot);
            Ok(stopped_snapshot)
        }
        Err(error) if error.contains("Terminal session not found") => {
            let stopped_snapshot =
                update_runtime_session(&state, &workspace_id, |current| {
                    let now = now_ms();
                    let base = current.unwrap_or(RuntimeSessionRecord {
                        workspace_id: workspace_id.clone(),
                        terminal_id: RUNTIME_TERMINAL_ID.to_string(),
                        status: RuntimeSessionStatus::Stopped,
                        command_preview: None,
                        started_at_ms: Some(now),
                        stopped_at_ms: None,
                        exit_code: None,
                        error: None,
                    });
                    RuntimeSessionRecord {
                        status: RuntimeSessionStatus::Stopped,
                        stopped_at_ms: Some(now),
                        exit_code: base.exit_code.or(Some(130)),
                        error: None,
                        ..base
                    }
                })
                .await;
            emit_runtime_status(&app, &stopped_snapshot);
            emit_runtime_exited(&app, &stopped_snapshot);
            Ok(stopped_snapshot)
        }
        Err(error) => {
            let failed_snapshot =
                update_runtime_session(&state, &workspace_id, |current| {
                    let now = now_ms();
                    let base = current.unwrap_or(RuntimeSessionRecord {
                        workspace_id: workspace_id.clone(),
                        terminal_id: RUNTIME_TERMINAL_ID.to_string(),
                        status: RuntimeSessionStatus::Failed,
                        command_preview: None,
                        started_at_ms: Some(now),
                        stopped_at_ms: None,
                        exit_code: None,
                        error: None,
                    });
                    RuntimeSessionRecord {
                        status: RuntimeSessionStatus::Failed,
                        stopped_at_ms: Some(now),
                        error: Some(error.clone()),
                        ..base
                    }
                })
                .await;
            emit_runtime_status(&app, &failed_snapshot);
            emit_runtime_exited(&app, &failed_snapshot);
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn runtime_log_get_session(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Option<RuntimeSessionSnapshot>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("runtime_log_get_session is not supported in remote mode yet.".to_string());
    }

    let sessions = state.runtime_log_sessions.lock().await;
    Ok(sessions.get(&workspace_id).map(|record| record.to_snapshot()))
}

#[tauri::command]
pub(crate) async fn runtime_log_mark_exit(
    workspace_id: String,
    exit_code: i32,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<RuntimeSessionSnapshot, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("runtime_log_mark_exit is not supported in remote mode yet.".to_string());
    }

    let _ = crate::terminal::terminal_close(
        workspace_id.clone(),
        RUNTIME_TERMINAL_ID.to_string(),
        app.state::<AppState>(),
    )
    .await;

    let snapshot = update_runtime_session(&state, &workspace_id, |current| {
        let now = now_ms();
        let base = current.unwrap_or(RuntimeSessionRecord {
            workspace_id: workspace_id.clone(),
            terminal_id: RUNTIME_TERMINAL_ID.to_string(),
            status: RuntimeSessionStatus::Stopped,
            command_preview: None,
            started_at_ms: Some(now),
            stopped_at_ms: None,
            exit_code: None,
            error: None,
        });
        RuntimeSessionRecord {
            status: if exit_code == 0 {
                RuntimeSessionStatus::Stopped
            } else {
                RuntimeSessionStatus::Failed
            },
            stopped_at_ms: Some(now),
            exit_code: Some(exit_code),
            error: if exit_code == 0 {
                None
            } else {
                Some(format!("Process exited with code {exit_code}."))
            },
            ..base
        }
    })
    .await;

    emit_runtime_status(&app, &snapshot);
    emit_runtime_exited(&app, &snapshot);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::{build_custom_run_script, detect_java_launcher, RuntimeLauncherKind};

    fn entries(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    fn maven_wrapper_file() -> &'static str {
        #[cfg(windows)]
        {
            "mvnw.cmd"
        }
        #[cfg(not(windows))]
        {
            "mvnw"
        }
    }

    fn maven_wrapper_program() -> &'static str {
        #[cfg(windows)]
        {
            "mvnw.cmd"
        }
        #[cfg(not(windows))]
        {
            "./mvnw"
        }
    }

    fn gradle_wrapper_file() -> &'static str {
        #[cfg(windows)]
        {
            "gradlew.bat"
        }
        #[cfg(not(windows))]
        {
            "gradlew"
        }
    }

    fn gradle_wrapper_program() -> &'static str {
        #[cfg(windows)]
        {
            "gradlew.bat"
        }
        #[cfg(not(windows))]
        {
            "./gradlew"
        }
    }

    #[test]
    fn prefers_maven_wrapper_over_other_launchers() {
        let launcher = detect_java_launcher(&entries(&[
            "pom.xml",
            maven_wrapper_file(),
            "build.gradle",
            gradle_wrapper_file(),
        ]))
        .expect("launcher should exist");

        assert_eq!(launcher.kind, RuntimeLauncherKind::MavenWrapper);
        assert_eq!(launcher.program, maven_wrapper_program());
        assert_eq!(launcher.args, vec!["spring-boot:run"]);
    }

    #[test]
    fn chooses_maven_system_when_only_pom_exists() {
        let launcher = detect_java_launcher(&entries(&["pom.xml"]))
            .expect("launcher should exist");

        assert_eq!(launcher.kind, RuntimeLauncherKind::MavenSystem);
        assert_eq!(launcher.program, "mvn");
    }

    #[test]
    fn chooses_gradle_wrapper_when_build_script_and_wrapper_exist() {
        let launcher = detect_java_launcher(&entries(&[gradle_wrapper_file(), "build.gradle.kts"]))
            .expect("launcher should exist");

        assert_eq!(launcher.kind, RuntimeLauncherKind::GradleWrapper);
        assert_eq!(launcher.program, gradle_wrapper_program());
    }

    #[test]
    fn returns_none_when_no_java_build_files_exist() {
        let launcher = detect_java_launcher(&entries(&["README.md", "package.json"]));
        assert!(launcher.is_none());
    }

    #[test]
    fn custom_script_embeds_override_and_exit_marker() {
        let script = build_custom_run_script("mvn spring-boot:run -DskipTests");
        assert!(script.contains("Using custom run command from console."));
        assert!(script.contains("mvn spring-boot:run -DskipTests"));
        assert!(script.contains("__EXIT__"));
        #[cfg(windows)]
        assert!(script.contains("where java >nul 2>&1"));
        #[cfg(not(windows))]
        assert!(script.contains("command -v java >/dev/null 2>&1"));
    }
}
