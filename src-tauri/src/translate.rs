//! 插件介绍翻译（插件中心列表、详情页与页头的「翻译」入口）。
//!
//! 用用户当前连接的引擎/模型跑一个**零工具**的纯文本轮次：插件名称、简介
//! 与 README 是市场上的第三方文本，必须当作不可信输入——模型手里没有任何
//! 工具、MCP 或扩展（`SendRequest::no_tools`），引擎不能兑现时启动直接
//! 失败，不降级为普通轮次。进程的工作目录是应用目录下一个空的沙盒目录，
//! 不落在用户的任何工作区里，避免加载工作区的 CLAUDE.md / hooks / MCP。
//!
//! 事件借用任务工作台的 `mission-agent://event` 流，前端按 run id 路由；
//! run id 前缀 `translate-` 与 mission 的 `mission-` 互不可中断。

use tauri::Manager;

use crate::engine;

const RUN_ID_PREFIX: &str = "translate-";
/// 单次提示词的上限（字符）。前端把 README 和列表分块后每块远小于此值，
/// 这里是防御性的硬上限：提示词走 stdin，但也不该无界。
const MAX_PROMPT_CHARS: usize = 200_000;

fn owns_run_id(run_id: &str) -> bool {
    run_id.starts_with(RUN_ID_PREFIX)
}

/// 空沙盒目录：每次启动前确保存在。目录里不放任何文件。
fn sandbox_dir() -> Result<std::path::PathBuf, String> {
    let dir = crate::paths::app_home().join("translate-sandbox");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create translate sandbox: {e}"))?;
    Ok(dir)
}

/// 启动一个翻译轮次。前端先注册事件监听再 invoke，runId 必须带
/// `translate-` 前缀。
#[tauri::command]
pub(crate) async fn translate_text_start(
    app: tauri::AppHandle,
    engine: String,
    prompt: String,
    model: Option<String>,
    effort: Option<String>,
    provider_id: Option<String>,
    run_id: String,
) -> Result<engine::SendResult, String> {
    if !owns_run_id(&run_id) {
        return Err(format!("run id {run_id:?} is not a translation run id"));
    }
    if prompt.trim().is_empty() {
        return Err("nothing to translate".into());
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err("text is too long to translate".into());
    }
    let workspace = sandbox_dir()?;
    let state = app.state::<crate::AppState>();
    engine::translate_text_send(
        state.inner(),
        engine,
        workspace.to_string_lossy().into_owned(),
        prompt,
        model,
        effort,
        provider_id,
        run_id,
    )
    .await
}

/// 中断一个翻译轮次；不接受聊天/插件/任务工作台的 run id。
#[tauri::command]
pub(crate) async fn translate_text_interrupt(
    app: tauri::AppHandle,
    run_id: String,
) -> Result<bool, String> {
    if !owns_run_id(&run_id) {
        return Err(format!("run id {run_id:?} is not a translation run id"));
    }
    let state = app.state::<crate::AppState>();
    let registry = std::sync::Arc::clone(&state.processes);
    tauri::async_runtime::spawn_blocking(move || registry.kill(&run_id))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::owns_run_id;

    #[test]
    fn only_translation_run_ids_are_owned() {
        assert!(owns_run_id("translate-abc"));
        assert!(!owns_run_id("mission-abc"));
        assert!(!owns_run_id("abc"));
        assert!(!owns_run_id(""));
    }
}
