//! Multi-engine abstraction layer for CLI tools (Claude Code, Codex, Gemini, etc.)
//!
//! This module provides a unified interface for different AI coding assistants,
//! allowing the application to seamlessly switch between engines while maintaining
//! a consistent API.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod claude;
pub mod claude_history;
pub(crate) mod claude_message_content;
pub mod codex_adapter;
pub(crate) mod codex_prompt_service;
pub mod commands;
pub(crate) mod error_mapper;
pub mod events;
pub mod gemini;
pub mod gemini_history;
pub(crate) mod gemini_proxy_guard;
pub mod manager;
pub mod opencode;
pub mod rewind_commands;
pub mod status;

// Re-exports for convenience
pub use commands::*;
pub use manager::EngineManager;
pub use rewind_commands::*;
pub use status::resolve_engine_type;

/// Supported engine types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineType {
    /// Claude Code by Anthropic
    Claude,
    /// Codex CLI
    Codex,
    /// Google Gemini CLI
    Gemini,
    /// OpenCode CLI
    OpenCode,
}

impl Default for EngineType {
    fn default() -> Self {
        EngineType::Claude // Default to Claude Code as per user requirement
    }
}

impl EngineType {
    /// Get display name for UI
    pub fn display_name(&self) -> &'static str {
        match self {
            EngineType::Claude => "Claude Code",
            EngineType::Codex => "Codex",
            EngineType::Gemini => "Gemini",
            EngineType::OpenCode => "OpenCode",
        }
    }

    /// Get icon identifier for UI
    pub fn icon(&self) -> &'static str {
        match self {
            EngineType::Claude => "claude",
            EngineType::Codex => "codex",
            EngineType::Gemini => "gemini",
            EngineType::OpenCode => "opencode",
        }
    }

    /// Check if this engine is currently supported
    pub fn is_supported(&self) -> bool {
        matches!(
            self,
            EngineType::Claude | EngineType::Codex | EngineType::Gemini | EngineType::OpenCode
        )
    }
}

impl std::fmt::Display for EngineType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

/// Engine installation and capability status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// Engine type identifier
    pub engine_type: EngineType,
    /// Whether the CLI is installed and accessible
    pub installed: bool,
    /// CLI version string if available
    pub version: Option<String>,
    /// Path to the CLI binary
    pub bin_path: Option<String>,
    /// Home/config directory for the engine
    pub home_dir: Option<String>,
    /// Available models for this engine
    pub models: Vec<ModelInfo>,
    /// Default model ID
    pub default_model: Option<String>,
    /// Feature capabilities
    pub features: EngineFeatures,
    /// Error message if detection failed
    pub error: Option<String>,
}

impl EngineStatus {
    /// Create a status for an uninstalled engine
    pub fn not_installed(engine_type: EngineType) -> Self {
        Self {
            engine_type,
            installed: false,
            version: None,
            bin_path: None,
            home_dir: None,
            models: Vec::new(),
            default_model: None,
            features: EngineFeatures::default(),
            error: None,
        }
    }

    /// Create a status with an error
    pub fn with_error(engine_type: EngineType, error: String) -> Self {
        Self {
            engine_type,
            installed: false,
            version: None,
            bin_path: None,
            home_dir: None,
            models: Vec::new(),
            default_model: None,
            features: EngineFeatures::default(),
            error: Some(error),
        }
    }
}

/// Model information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// Unique model identifier (e.g., "claude-sonnet-4-5-20250929")
    pub id: String,
    /// Human-readable name (e.g., "Claude Sonnet 4.5")
    #[serde(rename = "displayName")]
    pub name: String,
    /// Short alias for CLI usage (e.g., "sonnet")
    #[serde(skip_serializing)]
    pub alias: Option<String>,
    /// Whether this is the default model
    #[serde(rename = "isDefault")]
    pub default: bool,
    /// Model description
    #[serde(default)]
    pub description: String,
    /// Provider name (e.g., "anthropic", "openai")
    #[serde(skip_serializing)]
    pub provider: Option<String>,
    /// Model capabilities/tags
    #[serde(skip_serializing)]
    pub tags: Vec<String>,
}

impl ModelInfo {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            alias: None,
            default: false,
            description: String::new(),
            provider: None,
            tags: Vec::new(),
        }
    }

    pub fn with_alias(mut self, alias: impl Into<String>) -> Self {
        self.alias = Some(alias.into());
        self
    }

    pub fn as_default(mut self) -> Self {
        self.default = true;
        self
    }

    pub fn with_provider(mut self, provider: impl Into<String>) -> Self {
        self.provider = Some(provider.into());
        self
    }

    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }
}

/// Engine feature capabilities
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineFeatures {
    /// Supports reasoning effort levels (low/medium/high)
    pub reasoning_effort: bool,
    /// Supports collaboration modes
    pub collaboration_mode: bool,
    /// Supports image input
    pub image_input: bool,
    /// Supports session resume/continue
    pub session_resume: bool,
    /// Supports tool/permission control
    pub tools_control: bool,
    /// Supports streaming output
    pub streaming: bool,
    /// Supports MCP (Model Context Protocol)
    pub mcp: bool,
}

impl EngineFeatures {
    /// Features for Claude Code
    pub fn claude() -> Self {
        Self {
            reasoning_effort: false, // Claude doesn't have reasoning effort levels
            collaboration_mode: false,
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: true,
        }
    }

    /// Features for Codex
    pub fn codex() -> Self {
        Self {
            reasoning_effort: true,
            collaboration_mode: true,
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: true,
        }
    }

    /// Features for OpenCode
    pub fn opencode() -> Self {
        Self {
            reasoning_effort: false,
            collaboration_mode: false,
            image_input: false,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: false,
        }
    }

    /// Features for Gemini
    pub fn gemini() -> Self {
        Self {
            reasoning_effort: false,
            collaboration_mode: false,
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: true,
        }
    }
}

/// Parameters for sending a message to an engine
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageParams {
    /// The message text/prompt
    pub text: String,
    /// Model to use (optional, uses default if not specified)
    pub model: Option<String>,
    /// Reasoning effort level (for engines that support it)
    pub effort: Option<String>,
    /// Access/permission mode
    pub access_mode: Option<String>,
    /// Image paths to include
    pub images: Option<Vec<String>>,
    /// Whether to continue from previous session
    pub continue_session: bool,
    /// Session ID to resume (for Claude)
    pub session_id: Option<String>,
    /// Agent id/name (for OpenCode)
    pub agent: Option<String>,
    /// Variant/reasoning mode (for OpenCode)
    pub variant: Option<String>,
    /// Collaboration mode settings (for Codex)
    pub collaboration_mode: Option<Value>,
    /// Optional external OpenSpec root to expose for the session.
    pub custom_spec_root: Option<String>,
}

impl Default for SendMessageParams {
    fn default() -> Self {
        Self {
            text: String::new(),
            model: None,
            effort: None,
            access_mode: None,
            images: None,
            continue_session: false,
            session_id: None,
            agent: None,
            variant: None,
            collaboration_mode: None,
            custom_spec_root: None,
        }
    }
}

/// Unified message role
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
    Tool,
}

/// Unified message format across all engines
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedMessage {
    /// Unique message ID
    pub id: String,
    /// Message role
    pub role: MessageRole,
    /// Message content (text)
    pub content: String,
    /// Which engine produced this message
    pub engine: EngineType,
    /// Unix timestamp (milliseconds)
    pub timestamp: i64,
    /// Tool use information if applicable
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use: Option<Value>,
    /// Engine-specific metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

impl UnifiedMessage {
    pub fn new(role: MessageRole, content: impl Into<String>, engine: EngineType) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role,
            content: content.into(),
            engine,
            timestamp: chrono::Utc::now().timestamp_millis(),
            tool_use: None,
            metadata: None,
        }
    }

    pub fn with_metadata(mut self, metadata: Value) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

/// Engine configuration stored in app settings
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    /// Custom binary path (overrides default)
    pub bin_path: Option<String>,
    /// Custom home/config directory
    pub home_dir: Option<String>,
    /// Additional CLI arguments
    pub custom_args: Option<String>,
    /// Default model for this engine
    pub default_model: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_type_default_is_claude() {
        assert_eq!(EngineType::default(), EngineType::Claude);
    }

    #[test]
    fn engine_type_display_names() {
        assert_eq!(EngineType::Claude.display_name(), "Claude Code");
        assert_eq!(EngineType::Codex.display_name(), "Codex");
    }

    #[test]
    fn engine_type_serialization() {
        let claude = EngineType::Claude;
        let json = serde_json::to_string(&claude).unwrap();
        assert_eq!(json, "\"claude\"");

        let parsed: EngineType = serde_json::from_str("\"codex\"").unwrap();
        assert_eq!(parsed, EngineType::Codex);
    }

    #[test]
    fn model_info_builder() {
        let model = ModelInfo::new("test-model", "Test Model")
            .with_alias("test")
            .as_default()
            .with_provider("test-provider");

        assert_eq!(model.id, "test-model");
        assert_eq!(model.alias, Some("test".to_string()));
        assert!(model.default);
        assert_eq!(model.provider, Some("test-provider".to_string()));
    }

    #[test]
    fn engine_features_defaults() {
        let claude = EngineFeatures::claude();
        assert!(!claude.reasoning_effort);
        assert!(claude.image_input);
        assert!(claude.session_resume);

        let codex = EngineFeatures::codex();
        assert!(codex.reasoning_effort);
        assert!(codex.collaboration_mode);
    }
}
