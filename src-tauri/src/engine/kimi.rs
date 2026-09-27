use super::{
    command_for_binary, images, push_session_id, safe_prompt_arg, BuiltCommand, Engine,
    EngineEvent, SendRequest, Transport,
};
use serde_json::Value;
use std::collections::HashMap;

pub struct KimiEngine;

/// 提取并规范化上下文窗口字段
fn attach_context_window(mut usage: Value) -> Value {
    if usage.get("model_context_window").is_some() {
        return usage;
    }

    let window = usage
        .get("context_window")
        .or_else(|| usage.get("contextWindow"))
        .or_else(|| usage.get("model_context_window"))
        .and_then(|v| match v {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
        .filter(|&w| w > 0);

    if let Some(w) = window {
        if let Some(obj) = usage.as_object_mut() {
            obj.insert("model_context_window".to_string(), Value::Number(w.into()));
        }
    }

    usage
}

pub(super) fn apply_channel(
    command: &mut tokio::process::Command,
    env: &HashMap<String, String>,
    req: &SendRequest,
) -> Result<(), String> {
    let value = |key: &str| {
        env.get(key)
            .map(String::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    let model = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| value("KIMI_MODEL_NAME"))
        .ok_or("Select a model for the Kimi channel before sending")?;
    let api_key = value("KIMI_MODEL_API_KEY")
        .or_else(|| value("KIMI_API_KEY"))
        .ok_or("The selected Kimi channel has no API key")?;
    let provider_type = value("KIMI_MODEL_PROVIDER_TYPE").unwrap_or("openai");
    if !matches!(provider_type, "openai" | "anthropic" | "kimi") {
        return Err("Unsupported Kimi channel provider type".into());
    }
    command.env("KIMI_MODEL_NAME", model);
    command.env("KIMI_MODEL_API_KEY", api_key);
    command.env("KIMI_MODEL_PROVIDER_TYPE", provider_type);
    if let Some(base_url) = value("KIMI_MODEL_BASE_URL").or_else(|| value("KIMI_BASE_URL")) {
        command.env("KIMI_MODEL_BASE_URL", base_url);
    } else {
        command.env_remove("KIMI_MODEL_BASE_URL");
    }
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        command.env("KIMI_MODEL_THINKING_EFFORT", effort);
    }
    Ok(())
}

/// Kimi's KIMI_MODEL_* variables create an ephemeral default model. Passing
/// --model would select a native alias again and restore its endpoint/key.
pub(super) fn build_channel_command(req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
    build_command(req, bin, false)
}

fn build_command(req: &SendRequest, bin: &str, native_model: bool) -> Result<BuiltCommand, String> {
    let mut cmd = command_for_binary(bin);
    cmd.arg("--output-format");
    cmd.arg("stream-json");
    if KimiEngine.resolve_permission(req.permission.as_deref()) == "plan" {
        return Err(
            "Kimi plan mode requires the local ACP transport; prompt mode cannot enforce it".into(),
        );
    }
    if native_model {
        if let Some(model) = req.model.as_deref() {
            cmd.arg("--model");
            cmd.arg(model);
        }
    }
    if let Some(session_id) = req.session_id.as_deref() {
        cmd.arg("--session");
        cmd.arg(session_id);
    }
    let prompt_text = images::kimi_prompt_with_images(&req.prompt, &req.images, &req.workspace);
    cmd.arg("--prompt");
    cmd.arg(safe_prompt_arg(&prompt_text));
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        cmd.env("KIMI_MODEL_THINKING_EFFORT", effort);
    }
    Ok(BuiltCommand {
        command: cmd,
        stdin_payload: None,
        keep_stdin_open: false,
        cleanup_files: Vec::new(),
        mcp_restore: None,
        preassigned_session_id: None,
    })
}

impl Engine for KimiEngine {
    fn id(&self) -> &'static str {
        "kimi"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    fn transport_for(&self, wsl: bool) -> Transport {
        if wsl {
            Transport::Child
        } else {
            Transport::Own
        }
    }

    fn host_command(&self, _req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut command = command_for_binary(bin);
        command.arg("acp");
        Ok(BuiltCommand {
            command,
            stdin_payload: None,
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        })
    }

    fn supports_images(&self) -> bool {
        // build_command injects absolute image paths + a ReadMediaFile
        // instruction into the prompt; that IS the kimi image transport.
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "plan", "bypass"]
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        build_command(req, bin, true)
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let role = value.get("role").and_then(Value::as_str).unwrap_or("");
        match role {
            "assistant" => {
                if let Some(content) = value.get("content") {
                    let text = crate::history::content_text(Some(content));
                    if !text.is_empty() {
                        out.push(super::assistant_message(text));
                    }
                }
                if let Some(tool_calls) = value.get("tool_calls").and_then(Value::as_array) {
                    for call in tool_calls {
                        let function = call.get("function");
                        let name = function
                            .and_then(|f| f.get("name"))
                            .or_else(|| call.get("name"))
                            .and_then(Value::as_str)
                            .unwrap_or("tool");
                        let args = function
                            .and_then(|f| f.get("arguments"))
                            .or_else(|| call.get("arguments"))
                            .or_else(|| call.get("input"));
                        out.push(super::tool_call_message(name, args));
                    }
                }
                if let Some(usage) = value.get("usage") {
                    out.push(EngineEvent::Usage(attach_context_window(usage.clone())));
                }
            }
            "tool" => {
                if let Some(content) = value.get("content").and_then(Value::as_str) {
                    if !content.trim().is_empty() {
                        out.push(super::tool_call_message(
                            content.trim().chars().take(200).collect::<String>(),
                            None,
                        ));
                    }
                }
            }
            "meta" => {
                if value.get("type").and_then(Value::as_str) == Some("session.resume_hint") {
                    push_session_id(&value, "session_id", out);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod channel_tests {
    use super::*;

    #[test]
    fn kimi_uses_interactive_transport_locally_and_preserves_remote_fallback() {
        assert!(KimiEngine.transport_for(false) == super::super::Transport::Own);
        assert!(KimiEngine.transport_for(true) == super::super::Transport::Child);
        let req = SendRequest {
            session_id: None,
            workspace: std::env::temp_dir(),
            prompt: "ask".into(),
            prompt_contributions: vec![],
            images: vec![],
            model: Some("native-model".into()),
            effort: Some("medium".into()),
            service_tier: None,
            permission: Some("auto".into()),
            additional_dirs: vec![],
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
        };
        let built = KimiEngine.host_command(&req, "kimi").unwrap();
        let args: Vec<_> = built.command.as_std().get_args().collect();
        assert_eq!(args, ["acp"]);
        assert!(built.keep_stdin_open);
    }

    #[test]
    fn independent_channel_uses_ephemeral_model_instead_of_native_alias() {
        let mut req = SendRequest {
            session_id: Some("existing-session".into()),
            workspace: std::env::temp_dir(),
            prompt: "routing probe".into(),
            prompt_contributions: vec![],
            images: vec![],
            model: Some("selected-model".into()),
            effort: None,
            service_tier: None,
            permission: Some("auto".into()),
            additional_dirs: vec![],
            provider_id: Some("plugin_model-switcher_probe".into()),
            computer_use: None,
            allowed_tools: None,
        };
        let mut env = HashMap::from([
            ("KIMI_BASE_URL".into(), "https://selected.invalid/v1".into()),
            ("KIMI_API_KEY".into(), "test-selected".into()),
            ("KIMI_MODEL_NAME".into(), "channel-default".into()),
        ]);
        let mut built = build_channel_command(&req, "kimi").unwrap();
        built.command.envs(&env);
        apply_channel(&mut built.command, &env, &req).unwrap();
        let args: Vec<_> = built
            .command
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(!args.iter().any(|s| s == "--model" || s == "test-selected"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--session", "existing-session"]));
        assert!(!args
            .iter()
            .any(|s| matches!(s.as_str(), "--plan" | "--yolo" | "--auto")));
        let injected: HashMap<_, _> = built
            .command
            .as_std()
            .get_envs()
            .map(|(k, v)| (k.to_str().unwrap(), v.and_then(|s| s.to_str())))
            .collect();
        assert_eq!(injected["KIMI_MODEL_NAME"], Some("selected-model"));
        assert_eq!(injected["KIMI_MODEL_API_KEY"], Some("test-selected"));
        assert_eq!(
            injected["KIMI_MODEL_BASE_URL"],
            Some("https://selected.invalid/v1")
        );
        assert_eq!(injected["KIMI_MODEL_PROVIDER_TYPE"], Some("openai"));
        let native = KimiEngine.build_command(&req, "kimi").unwrap();
        assert!(native.command.as_std().get_args().any(|s| s == "--model"));
        assert!(!native
            .command
            .as_std()
            .get_envs()
            .any(|(k, _)| k == "KIMI_MODEL_API_KEY"));
        assert!(apply_channel(&mut built.command, &HashMap::new(), &req).is_err());
        env.insert("KIMI_MODEL_PROVIDER_TYPE".into(), "invalid-provider".into());
        assert!(apply_channel(&mut built.command, &env, &req).is_err());
        env.insert("KIMI_MODEL_PROVIDER_TYPE".into(), "anthropic".into());
        env.insert("KIMI_MODEL_API_KEY".into(), "test-modern".into());
        env.insert(
            "KIMI_MODEL_BASE_URL".into(),
            "https://modern.invalid".into(),
        );
        req.model = None;
        apply_channel(&mut built.command, &env, &req).unwrap();
        let injected: HashMap<_, _> = built
            .command
            .as_std()
            .get_envs()
            .map(|(k, v)| (k.to_str().unwrap(), v.and_then(|s| s.to_str())))
            .collect();
        assert_eq!(injected["KIMI_MODEL_NAME"], Some("channel-default"));
        assert_eq!(injected["KIMI_MODEL_API_KEY"], Some("test-modern"));
        assert_eq!(
            injected["KIMI_MODEL_BASE_URL"],
            Some("https://modern.invalid")
        );
        assert_eq!(injected["KIMI_MODEL_PROVIDER_TYPE"], Some("anthropic"));
        env.remove("KIMI_BASE_URL");
        env.remove("KIMI_MODEL_BASE_URL");
        apply_channel(&mut built.command, &env, &req).unwrap();
        assert!(built
            .command
            .as_std()
            .get_envs()
            .any(|(k, v)| k == "KIMI_MODEL_BASE_URL" && v.is_none()));
        let mut missing_model = env.clone();
        missing_model.remove("KIMI_MODEL_NAME");
        assert!(apply_channel(&mut built.command, &missing_model, &req).is_err());
    }
}
