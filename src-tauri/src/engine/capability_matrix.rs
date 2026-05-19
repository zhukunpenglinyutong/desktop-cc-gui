use super::{EngineFeatures, EngineType};

pub const CAPABILITY_KEYS: [&str; 9] = [
    "streaming.text",
    "streaming.reasoning",
    "streaming.tool-output",
    "tool.use",
    "tool.mcp",
    "reasoning.effort",
    "collaboration.mode",
    "session.continuation",
    "image.input",
];

pub fn capability_state(engine_type: EngineType, capability: &str) -> &'static str {
    let features = match engine_type {
        EngineType::Claude => EngineFeatures::claude(),
        EngineType::Codex => EngineFeatures::codex(),
        EngineType::Gemini => EngineFeatures::gemini(),
        EngineType::OpenCode => EngineFeatures::opencode(),
    };

    match capability {
        "streaming.text" => bool_state(features.streaming),
        "streaming.reasoning" => bool_state(features.streaming),
        "streaming.tool-output" => bool_state(features.streaming && features.tools_control),
        "tool.use" => bool_state(features.tools_control),
        "tool.mcp" => bool_state(features.mcp),
        "reasoning.effort" => bool_state(features.reasoning_effort),
        "collaboration.mode" => bool_state(features.collaboration_mode),
        "session.continuation" => bool_state(features.session_resume),
        "image.input" => bool_state(features.image_input),
        _ => "unknown",
    }
}

fn bool_state(value: bool) -> &'static str {
    if value {
        "supported"
    } else {
        "unsupported"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_key_set_is_stable() {
        assert_eq!(
            CAPABILITY_KEYS,
            [
                "streaming.text",
                "streaming.reasoning",
                "streaming.tool-output",
                "tool.use",
                "tool.mcp",
                "reasoning.effort",
                "collaboration.mode",
                "session.continuation",
                "image.input",
            ]
        );
    }

    #[test]
    fn codex_supports_reasoning_effort_and_mcp() {
        assert_eq!(
            capability_state(EngineType::Codex, "reasoning.effort"),
            "supported"
        );
        assert_eq!(capability_state(EngineType::Codex, "tool.mcp"), "supported");
    }

    #[test]
    fn opencode_does_not_support_mcp_or_image_input() {
        assert_eq!(
            capability_state(EngineType::OpenCode, "tool.mcp"),
            "unsupported"
        );
        assert_eq!(
            capability_state(EngineType::OpenCode, "image.input"),
            "unsupported"
        );
    }
}
