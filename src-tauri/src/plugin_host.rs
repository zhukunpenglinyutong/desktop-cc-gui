//! Narrow host capabilities exposed to plugins through `PluginContext`.
//! Every command reloads the installed plugin record and enforces its base
//! permission before touching the host. The returned structs are explicit
//! allowlists: engine credentials and full provider configuration never cross
//! this boundary.

use serde::{Deserialize, Serialize};
use tauri::Manager;

const MIN_WINDOW_WIDTH: u32 = 640;
const MIN_WINDOW_HEIGHT: u32 = 480;
const MAX_WINDOW_DIMENSION: u32 = 32_768;
const MIN_VISIBLE_EDGE: i32 = 64;

fn require_permission(
    plugin_id: &str,
    permission: &str,
    enabled: bool,
    permissions: &[String],
) -> Result<(), String> {
    if !enabled {
        return Err(format!("{plugin_id}: plugin is disabled"));
    }
    if permissions.iter().any(|value| value == permission) {
        Ok(())
    } else {
        Err(format!("{plugin_id}: missing permission {permission}"))
    }
}

fn require_grant(plugin_id: &str, permission: &str) -> Result<(), String> {
    let (enabled, permissions) = crate::plugins::plugin_enabled_permissions(plugin_id)?;
    require_permission(plugin_id, permission, enabled, &permissions)
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginWindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginWindowSnapshot {
    pub bounds: PluginWindowBounds,
    pub state: &'static str,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginWechatWindow {
    pub bounds: PluginWindowBounds,
    pub executable: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginModelSource {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub authoritative: bool,
    pub remote: bool,
    pub models: Vec<crate::engine::models::EngineModel>,
    pub refreshed_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginModelCatalogEngine {
    pub engine: crate::engine::EngineInfo,
    pub sources: Vec<PluginModelSource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginModelCatalogError {
    pub engine: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub message: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginModelCatalogResult {
    pub engines: Vec<PluginModelCatalogEngine>,
    pub errors: Vec<PluginModelCatalogError>,
    pub refreshed_at: u64,
}

fn validate_window_bounds_against_rects(
    bounds: PluginWindowBounds,
    monitors: &[(i32, i32, u32, u32)],
) -> Result<(), String> {
    if bounds.width < MIN_WINDOW_WIDTH || bounds.height < MIN_WINDOW_HEIGHT {
        return Err(format!(
            "invalid bounds: minimum window size is {MIN_WINDOW_WIDTH}x{MIN_WINDOW_HEIGHT}"
        ));
    }
    if bounds.width > MAX_WINDOW_DIMENSION || bounds.height > MAX_WINDOW_DIMENSION {
        return Err(format!(
            "invalid bounds: window dimensions may not exceed {MAX_WINDOW_DIMENSION}"
        ));
    }
    let right = i64::from(bounds.x) + i64::from(bounds.width);
    let bottom = i64::from(bounds.y) + i64::from(bounds.height);
    let visible = monitors
        .iter()
        .any(|&(monitor_x, monitor_y, monitor_width, monitor_height)| {
            let monitor_right = i64::from(monitor_x) + i64::from(monitor_width);
            let monitor_bottom = i64::from(monitor_y) + i64::from(monitor_height);
            let overlap_width =
                (right.min(monitor_right) - i64::from(bounds.x).max(i64::from(monitor_x))).max(0);
            let overlap_height =
                (bottom.min(monitor_bottom) - i64::from(bounds.y).max(i64::from(monitor_y))).max(0);
            overlap_width >= i64::from(MIN_VISIBLE_EDGE)
                && overlap_height >= i64::from(MIN_VISIBLE_EDGE)
        });
    if !visible {
        return Err(format!(
            "invalid bounds: at least {MIN_VISIBLE_EDGE}x{MIN_VISIBLE_EDGE} physical pixels must remain visible on a connected monitor"
        ));
    }
    Ok(())
}

fn validate_window_bounds(
    bounds: PluginWindowBounds,
    monitors: &[tauri::Monitor],
) -> Result<(), String> {
    let rects = monitors
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            (position.x, position.y, size.width, size.height)
        })
        .collect::<Vec<_>>();
    validate_window_bounds_against_rects(bounds, &rects)
}

fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())
}

#[tauri::command]
pub async fn plugin_window_state(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<PluginWindowSnapshot, String> {
    require_grant(&plugin_id, "host:window")?;
    let window = main_window(&app)?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let state = if window.is_fullscreen().map_err(|error| error.to_string())? {
        "fullscreen"
    } else if window.is_minimized().map_err(|error| error.to_string())? {
        "minimized"
    } else if window.is_maximized().map_err(|error| error.to_string())? {
        "maximized"
    } else {
        "normal"
    };
    Ok(PluginWindowSnapshot {
        bounds: PluginWindowBounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        state,
        scale_factor: window.scale_factor().map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
pub async fn plugin_window_set_normal_bounds(
    app: tauri::AppHandle,
    plugin_id: String,
    bounds: PluginWindowBounds,
) -> Result<PluginWindowSnapshot, String> {
    require_grant(&plugin_id, "host:window")?;
    let window = main_window(&app)?;
    if window.is_fullscreen().map_err(|error| error.to_string())?
        || window.is_minimized().map_err(|error| error.to_string())?
        || window.is_maximized().map_err(|error| error.to_string())?
    {
        return Err("main window must be in normal state before changing bounds".to_string());
    }
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    if monitors.is_empty() {
        return Err("no connected monitor is available".to_string());
    }
    validate_window_bounds(bounds, &monitors)?;
    // On Windows, WebView window geometry is exposed in logical pixels even
    // when the plugin contract is physical pixels. Convert the requested
    // physical geometry through the window's current scale factor so the
    // observable outer bounds remain stable at 125%/150% DPI.
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let physical_i32 = |value: i32| -> i32 { ((value as f64) * scale).round() as i32 };
    let physical_u32 = |value: u32| -> u32 { ((value as f64) * scale).round() as u32 };
    // Physical coordinates avoid silently applying the primary monitor's DPI
    // to a position intended for a differently scaled secondary monitor.
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            physical_u32(bounds.width),
            physical_u32(bounds.height),
        )))
        .map_err(|error| error.to_string())?;
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            physical_i32(bounds.x),
            physical_i32(bounds.y),
        )))
        .map_err(|error| error.to_string())?;
    // Re-center using the actual outer frame after DPI conversion. This keeps
    // the complete window (title bar included) centered across monitor scales.
    let outer = window.outer_size().map_err(|error| error.to_string())?;
    let monitor = monitors
        .iter()
        .find(|monitor| {
            let p = monitor.position();
            let s = monitor.size();
            let x = physical_i32(bounds.x);
            let y = physical_i32(bounds.y);
            x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
        })
        .or_else(|| monitors.first())
        .ok_or_else(|| "no connected monitor is available".to_string())?;
    let mp = monitor.position();
    let ms = monitor.size();
    let centered = tauri::PhysicalPosition::new(
        mp.x + ((ms.width as i32 - outer.width as i32) / 2).max(0),
        mp.y + ((ms.height as i32 - outer.height as i32) / 2).max(0),
    );
    window
        .set_position(tauri::Position::Physical(centered))
        .map_err(|error| error.to_string())?;
    plugin_window_state(app, plugin_id).await
}

#[cfg(any(test, not(windows)))]
fn unsupported_platform_error() -> String {
    "Unsupported: WeChat window sampling is available only on Windows".to_string()
}

#[cfg(any(test, windows))]
fn select_wechat_candidate(
    candidates: impl IntoIterator<Item = (String, PluginWindowBounds)>,
) -> Result<PluginWechatWindow, String> {
    candidates
        .into_iter()
        .filter_map(|(executable, bounds)| {
            let name = std::path::Path::new(&executable)
                .file_name()
                .and_then(|value| value.to_str())?;
            if (name.eq_ignore_ascii_case("Weixin.exe") || name.eq_ignore_ascii_case("WeChat.exe"))
                && bounds.width >= 480
                && bounds.height >= 360
            {
                Some(PluginWechatWindow {
                    bounds,
                    executable: name.to_string(),
                })
            } else {
                None
            }
        })
        // Weixin can expose hidden helper/tool windows under the same process.
        // The largest reasonable visible top-level rectangle is the main UI.
        .max_by_key(|candidate| {
            u64::from(candidate.bounds.width) * u64::from(candidate.bounds.height)
        })
        .ok_or_else(|| {
            "NotFound: no visible Weixin.exe or WeChat.exe main window was found".to_string()
        })
}

#[cfg(windows)]
fn sample_wechat_window_native() -> Result<PluginWechatWindow, String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
    };

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() {
                return true.into();
            }
            let candidates = &mut *(lparam.0 as *mut Vec<(String, PluginWindowBounds)>);
            let mut process_id = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut process_id));
            if process_id == 0 {
                return true.into();
            }
            let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id)
            else {
                return true.into();
            };
            let mut buffer = vec![0u16; 32_768];
            let mut length = buffer.len() as u32;
            let image = if QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
            .is_ok()
            {
                Some(String::from_utf16_lossy(&buffer[..length as usize]))
            } else {
                None
            };
            let _ = CloseHandle(process);
            let Some(image) = image else {
                return true.into();
            };
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_ok()
                && rect.right > rect.left
                && rect.bottom > rect.top
            {
                candidates.push((
                    image,
                    PluginWindowBounds {
                        x: rect.left,
                        y: rect.top,
                        width: (rect.right - rect.left) as u32,
                        height: (rect.bottom - rect.top) as u32,
                    },
                ));
            }
            true.into()
        }
    }

    let mut candidates = Vec::new();
    unsafe {
        EnumWindows(
            Some(collect),
            LPARAM((&mut candidates as *mut Vec<(String, PluginWindowBounds)>) as isize),
        )
        .map_err(|error| format!("failed to enumerate desktop windows: {error}"))?;
    }
    select_wechat_candidate(candidates)
}

#[tauri::command]
pub async fn plugin_window_sample_wechat(plugin_id: String) -> Result<PluginWechatWindow, String> {
    require_grant(&plugin_id, "host:window")?;
    #[cfg(windows)]
    {
        sample_wechat_window_native()
    }
    #[cfg(not(windows))]
    {
        Err(unsupported_platform_error())
    }
}

#[tauri::command]
pub async fn plugin_list_engines(
    plugin_id: String,
) -> Result<Vec<crate::engine::EngineInfo>, String> {
    require_grant(&plugin_id, "host:models")?;
    crate::engine::list_engines().await
}

#[tauri::command]
pub async fn plugin_list_engine_models(
    state: tauri::State<'_, crate::AppState>,
    plugin_id: String,
    engine: String,
    workspace: Option<String>,
) -> Result<crate::engine::models::EngineCatalog, String> {
    require_grant(&plugin_id, "host:models")?;
    let engines = crate::engine::list_engines().await?;
    if !engines.iter().any(|entry| entry.id == engine) {
        return Err(format!("unknown engine: {engine}"));
    }
    crate::engine::models::list_engine_models(state, engine, workspace).await
}

fn configured_model(id: String, provider: String) -> crate::engine::models::EngineModel {
    let provider = if provider.is_empty() {
        id.split_once('/')
            .map(|(prefix, _)| prefix.to_string())
            .unwrap_or_default()
    } else {
        provider
    };
    crate::engine::models::EngineModel {
        id,
        name: None,
        description: None,
        provider,
        context_window: None,
    }
}

fn dedupe_models(
    models: impl IntoIterator<Item = crate::engine::models::EngineModel>,
) -> Vec<crate::engine::models::EngineModel> {
    let mut result = Vec::new();
    for model in models {
        if !model.id.trim().is_empty()
            && !result
                .iter()
                .any(|known: &crate::engine::models::EngineModel| known.id == model.id)
        {
            result.push(model);
        }
    }
    result
}

fn refreshed_at() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn model_source(
    id: String,
    name: String,
    kind: &'static str,
    models: Vec<crate::engine::models::EngineModel>,
    authoritative: bool,
    remote: bool,
    refreshed_at: u64,
    detail: Option<String>,
) -> PluginModelSource {
    PluginModelSource {
        id,
        name,
        kind,
        authoritative,
        remote,
        models: dedupe_models(models),
        refreshed_at,
        detail,
    }
}

#[tauri::command]
pub async fn plugin_model_catalog(
    state: tauri::State<'_, crate::AppState>,
    plugin_id: String,
    workspace: Option<String>,
    refresh_providers: Option<bool>,
) -> Result<PluginModelCatalogResult, String> {
    require_grant(&plugin_id, "host:models")?;
    let engines = crate::engine::list_engines().await?;
    let config = crate::config::read_config().unwrap_or_default();
    let settings = crate::settings::read_settings().unwrap_or_default();
    let refresh_providers = refresh_providers.unwrap_or(false);
    let refreshed_at = refreshed_at();
    let mut result = PluginModelCatalogResult {
        engines: Vec::with_capacity(engines.len()),
        errors: Vec::new(),
        refreshed_at,
    };

    for engine in engines {
        let engine_id = engine.id.clone();
        let catalog = match crate::engine::models::list_engine_models(
            state.clone(),
            engine_id.clone(),
            workspace.clone(),
        )
        .await
        {
            Ok(catalog) => catalog,
            Err(_) => {
                result.errors.push(PluginModelCatalogError {
                    engine: engine_id.clone(),
                    source_id: None,
                    message: "model catalog unavailable",
                });
                crate::engine::models::EngineCatalog {
                    models: Vec::new(),
                    authoritative: false,
                    remote: false,
                }
            }
        };
        let remote = catalog.remote;
        let mut sources = vec![model_source(
            format!("{engine_id}:cli"),
            "CLI".to_string(),
            "cli",
            catalog.models,
            catalog.authoritative,
            remote,
            refreshed_at,
            None,
        )];

        if !remote {
            if let Some(model) = settings.default_models.get(&engine_id) {
                sources.push(model_source(
                    format!("{engine_id}:configured"),
                    "Configured default".to_string(),
                    "configured",
                    vec![configured_model(model.clone(), String::new())],
                    false,
                    false,
                    refreshed_at,
                    None,
                ));
            }
            if let Some(models) = settings.custom_models.get(&engine_id) {
                sources.push(model_source(
                    format!("{engine_id}:custom"),
                    "Custom models".to_string(),
                    "custom",
                    models
                        .iter()
                        .cloned()
                        .map(|id| configured_model(id, String::new()))
                        .collect(),
                    false,
                    false,
                    refreshed_at,
                    None,
                ));
            }
            if let Some(section) = config.section(&engine_id) {
                for (provider_id, provider) in &section.providers {
                    if provider_id == crate::config::LOCAL_PROVIDER_ID
                        || provider_id == crate::config::DISABLED_PROVIDER_ID
                    {
                        continue;
                    }
                    let probe =
                        crate::provider_files::safe_provider_probe_config(&engine_id, provider);
                    let mut provider_models = probe
                        .configured_model
                        .into_iter()
                        .map(|id| configured_model(id, provider_id.clone()))
                        .collect::<Vec<_>>();
                    let mut detail = None;
                    if refresh_providers {
                        if let Some(base_url) =
                            probe.base_url.filter(|value| !value.trim().is_empty())
                        {
                            match crate::provider_models::fetch_provider_models_inner(
                                base_url,
                                probe.api_key.unwrap_or_default(),
                            )
                            .await
                            {
                                Ok(list) => {
                                    provider_models = list
                                        .models
                                        .into_iter()
                                        .map(|id| configured_model(id, provider_id.clone()))
                                        .collect();
                                }
                                Err(_) => {
                                    detail = Some("实时刷新失败，返回已配置模型".to_string());
                                    result.errors.push(PluginModelCatalogError {
                                        engine: engine_id.clone(),
                                        source_id: Some(provider_id.clone()),
                                        message: "provider model refresh failed",
                                    });
                                }
                            }
                        } else {
                            detail = Some("未配置可用刷新地址，返回已配置模型".to_string());
                        }
                    }
                    sources.push(model_source(
                        provider_id.clone(),
                        probe.name,
                        "provider",
                        provider_models,
                        false,
                        false,
                        refreshed_at,
                        detail,
                    ));
                }
            }
        }
        result
            .engines
            .push(PluginModelCatalogEngine { engine, sources });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(width: u32, height: u32) -> PluginWindowBounds {
        PluginWindowBounds {
            x: 0,
            y: 0,
            width,
            height,
        }
    }

    #[test]
    fn wechat_sampler_matches_executable_name_not_title_or_substring() {
        let selected = select_wechat_candidate([
            ("C:/Other/WeChatHelper.exe".to_string(), bounds(1400, 1000)),
            (
                "C:/Program Files/Tencent/Weixin.exe".to_string(),
                bounds(470, 350),
            ),
            (
                "C:/Program Files/Tencent/Weixin.exe".to_string(),
                bounds(1000, 800),
            ),
        ])
        .unwrap();
        assert_eq!(selected.executable, "Weixin.exe");
        assert_eq!(selected.bounds, bounds(1000, 800));
    }

    #[test]
    fn wechat_sampler_reports_not_found_for_no_usable_process_window() {
        let error = select_wechat_candidate([
            ("C:/Other/WeChat.exe".to_string(), bounds(200, 120)),
            ("C:/Other/not-wechat.exe".to_string(), bounds(1000, 800)),
        ])
        .unwrap_err();
        assert!(error.starts_with("NotFound:"), "{error}");
    }

    #[test]
    fn window_bounds_validate_minimum_and_multi_monitor_visibility() {
        let monitors = [(-1920, 0, 1920, 1080), (0, 0, 2560, 1440)];
        assert!(validate_window_bounds_against_rects(
            PluginWindowBounds {
                x: -1800,
                y: 50,
                width: 800,
                height: 600
            },
            &monitors,
        )
        .is_ok());
        assert!(validate_window_bounds_against_rects(
            PluginWindowBounds {
                x: 10,
                y: 10,
                width: 639,
                height: 480
            },
            &monitors,
        )
        .is_err());
        assert!(validate_window_bounds_against_rects(
            PluginWindowBounds {
                x: 5000,
                y: 5000,
                width: 800,
                height: 600
            },
            &monitors,
        )
        .is_err());
    }

    #[test]
    fn unsupported_error_is_explicit() {
        assert!(unsupported_platform_error().starts_with("Unsupported:"));
    }

    #[test]
    fn source_models_are_deduplicated_by_id() {
        let models = dedupe_models([
            configured_model("known/model".to_string(), "relay".to_string()),
            configured_model("known/model".to_string(), "relay".to_string()),
            configured_model("fresh/model".to_string(), "relay".to_string()),
        ]);
        assert_eq!(models.len(), 2);
        assert_eq!(models[1].provider, "relay");
    }

    #[test]
    fn provider_refresh_errors_never_echo_credentials_or_endpoints() {
        let message = "provider model refresh failed";
        assert!(!message.contains("sk-"));
        assert!(!message.contains("http"));
        assert!(!message.contains("response"));
    }

    #[test]
    fn model_catalog_wire_shape_keeps_authoritative_metadata_without_secrets() {
        let result = PluginModelCatalogResult {
            engines: vec![PluginModelCatalogEngine {
                engine: crate::engine::EngineInfo {
                    id: "codex".to_string(),
                    available: true,
                    enabled: true,
                    supports_images: true,
                    supports_computer_use: false,
                    supports_effort: true,
                    supports_tool_constraints: false,
                    permissions: vec!["default".to_string()],
                },
                sources: vec![model_source(
                    "codex:cli".to_string(),
                    "CLI".to_string(),
                    "cli",
                    vec![crate::engine::models::EngineModel {
                        id: "provider/model".to_string(),
                        name: Some("Model".to_string()),
                        description: None,
                        provider: "provider".to_string(),
                        context_window: Some(128_000),
                    }],
                    true,
                    false,
                    1,
                    None,
                )],
            }],
            errors: Vec::new(),
            refreshed_at: 1,
        };
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["engines"][0]["sources"][0]["authoritative"], true);
        assert_eq!(
            value["engines"][0]["sources"][0]["models"][0]["provider"],
            "provider"
        );
        assert_eq!(
            value["engines"][0]["sources"][0]["models"][0]["contextWindow"],
            128_000
        );
        assert_eq!(value["refreshedAt"], 1);
        assert_no_forbidden_keys(&value);
    }

    /// 敏感字段泄漏守卫：递归检查 wire JSON 的键名精确黑名单（子串匹配会
    /// 误伤 authoritative 这类合法字段），并检查字符串值不含凭证/端点特征。
    fn assert_no_forbidden_keys(value: &serde_json::Value) {
        const FORBIDDEN_KEYS: [&str; 11] = [
            "apikey",
            "api_key",
            "token",
            "auth",
            "authorization",
            "credentials",
            "env",
            "settingsconfig",
            "baseurl",
            "base_url",
            "endpoint",
        ];
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    let lowered = key.to_ascii_lowercase();
                    assert!(
                        !FORBIDDEN_KEYS.contains(&lowered.as_str()),
                        "leaked forbidden field {key}"
                    );
                    assert_no_forbidden_keys(child);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    assert_no_forbidden_keys(item);
                }
            }
            serde_json::Value::String(text) => {
                let lowered = text.to_ascii_lowercase();
                assert!(
                    !lowered.contains("sk-"),
                    "leaked credential-looking value: {text}"
                );
                assert!(
                    !lowered.contains("http"),
                    "leaked endpoint-looking value: {text}"
                );
            }
            _ => {}
        }
    }

    #[test]
    fn host_grant_gate_rejects_missing_permission_and_disabled_plugins() {
        let empty = Vec::<String>::new();
        let error =
            require_permission("window-assistant", "host:models", true, &empty).unwrap_err();
        assert!(error.contains("host:models"), "{error}");
        let granted = vec!["host:models".to_string()];
        assert!(require_permission("window-assistant", "host:models", true, &granted).is_ok());
        let error =
            require_permission("window-assistant", "host:models", false, &granted).unwrap_err();
        assert!(error.contains("disabled"), "{error}");
    }
}
