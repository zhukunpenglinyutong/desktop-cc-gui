use serde_json::{json, Value};

/// Fork a Claude Code session from a target user message (inclusive).
#[tauri::command]
pub async fn fork_claude_session_from_message(
    workspace_path: String,
    session_id: String,
    message_id: String,
) -> Result<Value, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    let forked_session_id =
        super::claude_history::fork_claude_session_from_message(&path, &session_id, &message_id)
            .await?;
    Ok(json!({
        "thread": {
            "id": format!("claude:{}", forked_session_id)
        },
        "sessionId": forked_session_id
    }))
}
