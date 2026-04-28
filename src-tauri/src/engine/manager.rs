//! Engine manager
//!
//! Unified management of multiple engine types, handling engine switching,
//! session management, and configuration.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use super::claude::{ClaudeSession, ClaudeSessionManager};
use super::gemini::GeminiSession;
use super::opencode::OpenCodeSession;
use super::status::{
    detect_all_engines, detect_claude_status, detect_codex_status, detect_gemini_status,
    detect_opencode_status,
};
use super::{EngineConfig, EngineStatus, EngineType};

/// Unified engine manager
pub struct EngineManager {
    /// Currently active engine type (global default)
    active_engine: RwLock<EngineType>,

    /// Cached engine statuses
    engine_statuses: RwLock<HashMap<EngineType, EngineStatus>>,

    /// Claude session manager
    pub claude_manager: ClaudeSessionManager,

    /// OpenCode sessions per workspace
    opencode_sessions: Mutex<HashMap<String, Arc<OpenCodeSession>>>,

    /// Gemini sessions per workspace
    gemini_sessions: Mutex<HashMap<String, Arc<GeminiSession>>>,

    /// Engine configurations
    engine_configs: RwLock<HashMap<EngineType, EngineConfig>>,
}

impl EngineManager {
    /// Create a new engine manager
    pub fn new() -> Self {
        Self {
            active_engine: RwLock::new(EngineType::default()),
            engine_statuses: RwLock::new(HashMap::new()),
            claude_manager: ClaudeSessionManager::new(),
            opencode_sessions: Mutex::new(HashMap::new()),
            gemini_sessions: Mutex::new(HashMap::new()),
            engine_configs: RwLock::new(HashMap::new()),
        }
    }

    /// Get the currently active engine type
    pub async fn get_active_engine(&self) -> EngineType {
        *self.active_engine.read().await
    }

    /// Set the active engine type
    pub async fn set_active_engine(&self, engine_type: EngineType) -> Result<(), String> {
        // Verify engine is installed
        let statuses = self.engine_statuses.read().await;
        if let Some(status) = statuses.get(&engine_type) {
            if !status.installed {
                return Err(format!(
                    "{} is not installed. Please install it first.",
                    engine_type.display_name()
                ));
            }
        } else {
            // Status not cached, check now
            drop(statuses);
            let status = self.detect_single_engine(engine_type).await;
            if !status.installed {
                return Err(format!(
                    "{} is not installed. Please install it first.",
                    engine_type.display_name()
                ));
            }
        }

        *self.active_engine.write().await = engine_type;
        Ok(())
    }

    /// Detect a single engine's status
    async fn detect_single_engine(&self, engine_type: EngineType) -> EngineStatus {
        let configs = self.engine_configs.read().await;
        let config = configs.get(&engine_type);
        let bin = config.and_then(|c| c.bin_path.as_deref());

        let status = match engine_type {
            EngineType::Claude => detect_claude_status(bin).await,
            EngineType::Codex => detect_codex_status(bin).await,
            EngineType::Gemini => detect_gemini_status(bin).await,
            EngineType::OpenCode => detect_opencode_status(bin).await,
        };

        // Cache the result
        let mut statuses = self.engine_statuses.write().await;
        statuses.insert(engine_type, status.clone());

        status
    }

    /// Force-refresh a single engine status and update the cached snapshot.
    pub async fn refresh_engine_status(&self, engine_type: EngineType) -> EngineStatus {
        self.detect_single_engine(engine_type).await
    }

    /// Detect all supported engines
    pub async fn detect_engines(&self) -> Vec<EngineStatus> {
        let (claude_bin, codex_bin, gemini_bin, opencode_bin) = {
            let configs = self.engine_configs.read().await;
            (
                configs
                    .get(&EngineType::Claude)
                    .and_then(|c| c.bin_path.clone()),
                configs
                    .get(&EngineType::Codex)
                    .and_then(|c| c.bin_path.clone()),
                configs
                    .get(&EngineType::Gemini)
                    .and_then(|c| c.bin_path.clone()),
                configs
                    .get(&EngineType::OpenCode)
                    .and_then(|c| c.bin_path.clone()),
            )
        };

        let statuses = detect_all_engines(
            claude_bin.as_deref(),
            codex_bin.as_deref(),
            gemini_bin.as_deref(),
            opencode_bin.as_deref(),
        )
        .await;

        // Cache results
        let mut cached = self.engine_statuses.write().await;
        for status in &statuses {
            cached.insert(status.engine_type, status.clone());
        }

        statuses
    }

    /// Get cached engine status
    pub async fn get_engine_status(&self, engine_type: EngineType) -> Option<EngineStatus> {
        let statuses = self.engine_statuses.read().await;
        statuses.get(&engine_type).cloned()
    }

    /// Get all cached engine statuses
    pub async fn get_all_statuses(&self) -> Vec<EngineStatus> {
        let statuses = self.engine_statuses.read().await;
        statuses.values().cloned().collect()
    }

    /// Set engine configuration
    pub async fn set_engine_config(&self, engine_type: EngineType, config: EngineConfig) {
        let mut configs = self.engine_configs.write().await;
        configs.insert(engine_type, config.clone());

        // Update Claude manager if it's Claude config
        if engine_type == EngineType::Claude {
            self.claude_manager.set_config(config).await;
        }
    }

    /// Get engine configuration
    pub async fn get_engine_config(&self, engine_type: EngineType) -> Option<EngineConfig> {
        let configs = self.engine_configs.read().await;
        configs.get(&engine_type).cloned()
    }

    // ==================== Claude Session Management ====================

    /// Get or create a Claude session for a workspace
    pub async fn get_claude_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Arc<ClaudeSession> {
        self.claude_manager
            .get_or_create_session(workspace_id, workspace_path)
            .await
    }

    /// Remove a Claude session
    pub async fn remove_claude_session(&self, workspace_id: &str) {
        if let Some(session) = self.claude_manager.remove_session(workspace_id).await {
            session.mark_disposed();
            if let Err(error) = session.interrupt().await {
                log::warn!(
                    "[engine_manager] failed to interrupt claude session during remove (workspace={}): {}",
                    workspace_id,
                    error
                );
            }
        }
    }

    /// The GUI runtime no longer tracks Codex adapters locally. Keep cleanup callers stable.
    pub async fn remove_codex_adapter(&self, _workspace_id: &str) {}

    // ==================== OpenCode Session Management ====================

    /// Get or create an OpenCode session for a workspace
    pub async fn get_or_create_opencode_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Arc<OpenCodeSession> {
        {
            let sessions = self.opencode_sessions.lock().await;
            if let Some(session) = sessions.get(workspace_id) {
                return session.clone();
            }
        }

        let config = self.get_engine_config(EngineType::OpenCode).await;
        let session = Arc::new(OpenCodeSession::new(
            workspace_id.to_string(),
            workspace_path.to_path_buf(),
            config,
        ));
        let mut sessions = self.opencode_sessions.lock().await;
        sessions.insert(workspace_id.to_string(), session.clone());
        session
    }

    /// Get OpenCode session by workspace
    pub async fn get_opencode_session(&self, workspace_id: &str) -> Option<Arc<OpenCodeSession>> {
        let sessions = self.opencode_sessions.lock().await;
        sessions.get(workspace_id).cloned()
    }

    /// Remove an OpenCode session
    pub async fn remove_opencode_session(&self, workspace_id: &str) {
        let mut sessions = self.opencode_sessions.lock().await;
        sessions.remove(workspace_id);
    }

    // ==================== Gemini Session Management ====================

    /// Get or create a Gemini session for a workspace
    pub async fn get_or_create_gemini_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Arc<GeminiSession> {
        {
            let sessions = self.gemini_sessions.lock().await;
            if let Some(session) = sessions.get(workspace_id) {
                return session.clone();
            }
        }

        let config = self.get_engine_config(EngineType::Gemini).await;
        let session = Arc::new(GeminiSession::new(
            workspace_id.to_string(),
            workspace_path.to_path_buf(),
            config,
        ));
        let mut sessions = self.gemini_sessions.lock().await;
        sessions.insert(workspace_id.to_string(), session.clone());
        session
    }

    /// Get Gemini session by workspace
    pub async fn get_gemini_session(&self, workspace_id: &str) -> Option<Arc<GeminiSession>> {
        let sessions = self.gemini_sessions.lock().await;
        sessions.get(workspace_id).cloned()
    }

    /// Remove a Gemini session
    pub async fn remove_gemini_session(&self, workspace_id: &str) {
        let mut sessions = self.gemini_sessions.lock().await;
        sessions.remove(workspace_id);
    }

    // ==================== Utility Methods ====================

    /// Check if an engine is available (installed and ready)
    pub async fn is_engine_available(&self, engine_type: EngineType) -> bool {
        if let Some(status) = self.get_engine_status(engine_type).await {
            status.installed
        } else {
            let status = self.detect_single_engine(engine_type).await;
            status.installed
        }
    }

    /// Get list of available (installed) engines
    pub async fn get_available_engines(&self) -> Vec<EngineType> {
        let statuses = self.engine_statuses.read().await;
        statuses
            .iter()
            .filter(|(_, status)| status.installed)
            .map(|(engine_type, _)| *engine_type)
            .collect()
    }
}

impl Default for EngineManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn default_engine_is_claude() {
        let manager = EngineManager::new();
        assert_eq!(manager.get_active_engine().await, EngineType::Claude);
    }

    #[tokio::test]
    async fn engine_config_storage() {
        let manager = EngineManager::new();

        let config = EngineConfig {
            bin_path: Some("/custom/claude".to_string()),
            ..Default::default()
        };

        manager
            .set_engine_config(EngineType::Claude, config.clone())
            .await;

        let retrieved = manager.get_engine_config(EngineType::Claude).await;
        assert!(retrieved.is_some());
        assert_eq!(
            retrieved.unwrap().bin_path,
            Some("/custom/claude".to_string())
        );
    }
}
