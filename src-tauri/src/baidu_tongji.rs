//! Baidu Tongji (百度统计) page-view beacon, sent by the backend only.
//!
//! The app used to run the official `hm.js` in the main window (on Linux:
//! fetch it natively, then `webview.eval`). That executed third-party remote
//! code in the one context that can call every app command, and on the
//! web-access page the beacon carried the token-bearing page URL. Rust now
//! builds the `hm.gif` page-view request itself from fixed fields that mirror
//! `hm.js` 1.3.2's page-view path (`Fb` / `Eb` / `pa`): no page URL, no
//! referrer, no title but the app name, and nothing downloaded is executed.
//! One beacon per launch, release builds only, re-checking the user's switch
//! (`AppSettings.analytics_enabled`, default on) right before sending.

use crate::paths;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, COOKIE, REFERER, SET_COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(crate) const SITE_ID: &str = "b18f7c7bbeab70682b0a359e6b7b058d";
/// The `hm.js` version whose page-view payload the beacon mirrors.
const HM_VERSION: &str = "1.3.2";
const BEACON_URL: &str = "https://hm.baidu.com/hm.gif";
/// Requested only to receive the server-issued `HMACCOUNT` visitor cookie on
/// the first launch; the body is dropped unread and never executed.
const VISITOR_URL_PREFIX: &str = "https://hm.baidu.com/hm.js?";
const REFERER_VALUE: &str = "https://tauri.localhost/";
const PAGE_TITLE: &str = "CC GUI";
const RECORD_FILENAME: &str = "baidu-tongji.json";
/// hm.js `vdur`: a gap longer than this starts a new visit.
const SESSION_GAP_SECS: i64 = 1_800;
/// hm.js keeps visit start times for 30 days, at most four of them.
const VISIT_WINDOW_SECS: i64 = 2_592_000;
const MAX_VISITS: usize = 4;
/// Off the cold-start path, like the old deferred script install.
const STARTUP_DELAY: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_HMAC_COUNT_BYTES: usize = 128;

/// Persisted visitor state (`<app home>/analytics/baidu-tongji.json`). The
/// file predates this module and held only `hmacCount`; the visit fields
/// default when absent.
#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VisitorRecord {
    /// Server-issued visitor id (`HMACCOUNT` cookie / `hca` parameter).
    #[serde(default)]
    hmac_count: Option<String>,
    /// hm.js `Hm_lvt_<site>`: visit start times (epoch s), oldest first.
    #[serde(default)]
    visits: Vec<i64>,
    /// hm.js `Hm_lpvt_<site>`: last page view (epoch s).
    #[serde(default)]
    last_pageview: Option<i64>,
}

/// One page view's visit counters, as hm.js `Eb` derives them.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Visit {
    /// `lt`: latest visit start; absent on the very first visit.
    last_visit: Option<i64>,
    /// `lv`: 1 first visit, 2 fewer than four recent visits, 3 otherwise.
    level: u8,
}

/// Device facts the page-view payload carries; never anything about content.
#[derive(Debug, Clone, Default)]
struct BeaconEnv {
    language: String,
    /// Logical screen size (`ds`).
    screen: Option<(u32, u32)>,
    /// Logical main-window size (`ww` / `vl`).
    window: Option<(u32, u32)>,
}

fn advance_visits(record: &mut VisitorRecord, now: i64) -> Visit {
    if record.visits.is_empty() {
        record.visits = vec![now];
        record.last_pageview = Some(now);
        return Visit {
            last_visit: None,
            level: 1,
        };
    }
    while record
        .visits
        .first()
        .is_some_and(|first| now - first > VISIT_WINDOW_SECS)
    {
        record.visits.remove(0);
    }
    let level = if record.visits.len() < MAX_VISITS { 2 } else { 3 };
    if now - record.last_pageview.unwrap_or(0) > SESSION_GAP_SECS {
        record.visits.push(now);
    }
    while record.visits.len() > MAX_VISITS {
        record.visits.remove(0);
    }
    record.last_pageview = Some(now);
    Visit {
        last_visit: record.visits.last().copied(),
        level,
    }
}

/// JavaScript `encodeURIComponent`: hm.js encodes every value this way, so a
/// space is `%20` (form encoding's `+` would reach the server as a plus).
fn encode_uri_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// The `hm.gif` page-view request: hm.js `pa` field order, empty fields
/// omitted. Built only from the visitor id, visit counters, device facts and
/// fixed constants — the signature leaves no way to pass a page URL in.
fn beacon_url(
    visitor: Option<&str>,
    visit: &Visit,
    env: &BeaconEnv,
    now: i64,
    rnd: u32,
) -> reqwest::Url {
    let mut fields: Vec<(&str, String)> = Vec::new();
    if let Some(hca) = visitor {
        fields.push(("hca", hca.to_string()));
    }
    fields.push(("cc", "1".to_string()));
    fields.push(("ck", "1".to_string()));
    fields.push(("cl", "24-bit".to_string()));
    if let Some((width, height)) = env.screen {
        fields.push(("ds", format!("{width}x{height}")));
    }
    if let Some((_, height)) = env.window {
        fields.push(("vl", height.to_string()));
    }
    fields.push(("et", "0".to_string()));
    fields.push(("ja", "0".to_string()));
    if !env.language.is_empty() {
        fields.push(("ln", env.language.clone()));
    }
    fields.push(("lo", "0".to_string()));
    if let Some(last_visit) = visit.last_visit {
        fields.push(("lt", last_visit.to_string()));
    }
    fields.push(("rnd", rnd.to_string()));
    fields.push(("si", SITE_ID.to_string()));
    fields.push(("v", HM_VERSION.to_string()));
    fields.push(("lv", visit.level.to_string()));
    fields.push(("sn", now.rem_euclid(65_535).to_string()));
    fields.push(("r", "0".to_string()));
    fields.push(("ww", env.window.map_or(0, |(width, _)| width).to_string()));
    fields.push(("tt", PAGE_TITLE.to_string()));

    let query = fields
        .iter()
        .map(|(key, value)| format!("{key}={}", encode_uri_component(value)))
        .collect::<Vec<_>>()
        .join("&");
    let mut url = reqwest::Url::parse(BEACON_URL).expect("fixed beacon URL parses");
    url.set_query(Some(&query));
    url
}

/// The app's UI language as the browser-style tag hm.js reported (`ln`).
fn beacon_language(setting: &str) -> String {
    match setting {
        "zh" => "zh-cn".to_string(),
        "en" => "en-us".to_string(),
        "ko" => "ko-kr".to_string(),
        other => {
            let valid = (2..=12).contains(&other.len())
                && other
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
            if valid {
                other.to_ascii_lowercase()
            } else {
                "zh-cn".to_string()
            }
        }
    }
}

/// A browser-shaped UA naming only the OS family (what the report breaks PV
/// down by) and the app version.
fn beacon_user_agent() -> String {
    let platform = if cfg!(target_os = "macos") {
        "Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"
    } else if cfg!(windows) {
        "Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    } else {
        "X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)"
    };
    format!("Mozilla/5.0 ({platform} CCGUI/{}", env!("CARGO_PKG_VERSION"))
}

pub(crate) fn analytics_enabled(settings: &crate::settings::AppSettings) -> bool {
    settings.analytics_enabled != Some(false)
}

fn valid_hmac_count(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_HMAC_COUNT_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn extract_hmac_count(headers: &HeaderMap) -> Option<String> {
    for header in headers.get_all(SET_COOKIE) {
        let Ok(raw_value) = header.to_str() else {
            continue;
        };
        for cookie_part in raw_value
            .split(';')
            .flat_map(|part| part.split(','))
            .map(str::trim)
        {
            let Some((name, value)) = cookie_part.split_once('=') else {
                continue;
            };
            if name.eq_ignore_ascii_case("HMACCOUNT") && valid_hmac_count(value) {
                return Some(value.to_string());
            }
        }
    }
    None
}

// ── Persistence ─────────────────────────────────────────────────────────────

fn record_path() -> PathBuf {
    paths::app_home().join("analytics").join(RECORD_FILENAME)
}

fn read_record(path: &Path) -> Result<VisitorRecord, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(VisitorRecord::default())
        }
        Err(error) => return Err(format!("read {}: {error}", path.display())),
    };
    let record: VisitorRecord = serde_json::from_str(&content)
        .map_err(|error| format!("parse {}: {error}", path.display()))?;
    if record
        .hmac_count
        .as_deref()
        .is_some_and(|value| !valid_hmac_count(value))
    {
        return Err("invalid analytics visitor id".to_string());
    }
    Ok(record)
}

/// A corrupt record is set aside (never deleted) and the visitor starts over.
fn load_record(path: &Path) -> VisitorRecord {
    match read_record(path) {
        Ok(record) => record,
        Err(error) => {
            let millis = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis())
                .unwrap_or(0);
            let backup = path.with_file_name(format!("{RECORD_FILENAME}.corrupted-{millis}"));
            let quarantined = std::fs::rename(path, &backup).is_ok();
            eprintln!("baidu_tongji: unreadable visitor record ({error}); quarantined={quarantined}");
            VisitorRecord::default()
        }
    }
}

fn write_record(path: &Path, record: &VisitorRecord) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    let content = serde_json::to_string(record).map_err(|error| error.to_string())?;
    crate::settings::atomic_write(path, &content)
}

// ── Network ─────────────────────────────────────────────────────────────────

fn redacted(action: &str, error: &reqwest::Error) -> String {
    let kind = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else {
        "transport"
    };
    format!("{action}: {kind}")
}

/// First launch only: the server issues the visitor id as a cookie on the
/// script response. The response body is dropped unread.
async fn fetch_visitor_id(client: &reqwest::Client, user_agent: &HeaderValue) -> Option<String> {
    let url = format!("{VISITOR_URL_PREFIX}{SITE_ID}");
    let response = client
        .get(url)
        .header(USER_AGENT, user_agent.clone())
        .header(REFERER, REFERER_VALUE)
        .header(ACCEPT, "*/*")
        .send()
        .await
        .map_err(|error| eprintln!("baidu_tongji: {}", redacted("visitor id request", &error)))
        .ok()?;
    extract_hmac_count(response.headers())
}

async fn send_pageview(env: BeaconEnv, path: PathBuf) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| redacted("build HTTP client", &error))?;
    let user_agent = HeaderValue::from_str(&beacon_user_agent())
        .map_err(|_| "invalid analytics user agent".to_string())?;

    let mut record = load_record(&path);
    if record.hmac_count.is_none() {
        record.hmac_count = fetch_visitor_id(&client, &user_agent).await;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    let visit = advance_visits(&mut record, now);
    let rnd = (uuid::Uuid::new_v4().as_u128() as u32) & 0x7FFF_FFFF;
    let url = beacon_url(record.hmac_count.as_deref(), &visit, &env, now, rnd);
    // Like hm.js writing Hm_lvt / Hm_lpvt before the image request goes out.
    if let Err(error) = write_record(&path, &record) {
        eprintln!("baidu_tongji: visitor record not saved: {error}");
    }

    let mut request = client
        .get(url)
        .header(USER_AGENT, user_agent)
        .header(REFERER, REFERER_VALUE)
        .header(ACCEPT, "image/*");
    if let Some(visitor) = record.hmac_count.as_deref() {
        request = request.header(COOKIE, format!("HMACCOUNT={visitor}"));
    }
    let response = request
        .send()
        .await
        .map_err(|error| redacted("page view request", &error))?;
    if let Some(issued) = extract_hmac_count(response.headers()) {
        if record.hmac_count.as_deref() != Some(issued.as_str()) {
            record.hmac_count = Some(issued);
            if let Err(error) = write_record(&path, &record) {
                eprintln!("baidu_tongji: visitor record not saved: {error}");
            }
        }
    }
    if !response.status().is_success() {
        return Err(format!("page view returned HTTP {}", response.status()));
    }
    Ok(())
}

fn logical_size(physical: tauri::PhysicalSize<u32>, scale: f64) -> Option<(u32, u32)> {
    if physical.width == 0 || physical.height == 0 || !(scale > 0.0) {
        return None;
    }
    let logical = physical.to_logical::<f64>(scale);
    Some((logical.width.round() as u32, logical.height.round() as u32))
}

/// One page view per launch, off the startup path. Release builds only (the
/// old hm.js install was production-only too); failures are logged once and
/// never retried. The web-access bridge cannot reach this: it is not a
/// command, and the switch below is desktop-only.
pub(crate) fn spawn_startup_pageview(app: &tauri::AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        let Ok(settings) = crate::settings::read_settings() else {
            return;
        };
        if !analytics_enabled(&settings) {
            return;
        }
        use tauri::Manager;
        let screen = app
            .primary_monitor()
            .ok()
            .flatten()
            .and_then(|monitor| logical_size(*monitor.size(), monitor.scale_factor()));
        let window = app.get_webview_window("main").and_then(|window| {
            let size = window.inner_size().ok()?;
            logical_size(size, window.scale_factor().ok()?)
        });
        let env = BeaconEnv {
            language: beacon_language(&settings.language),
            screen,
            window,
        };
        if let Err(error) = send_pageview(env, record_path()).await {
            eprintln!("baidu_tongji: page view not sent: {error}");
        }
    });
}

// ── Commands (desktop only: deliberately absent from web/dispatch.rs) ───────

#[tauri::command]
pub(crate) fn analytics_enabled_get() -> Result<bool, String> {
    crate::settings::read_settings().map(|settings| analytics_enabled(&settings))
}

#[tauri::command]
pub(crate) fn analytics_enabled_set(enabled: bool) -> Result<(), String> {
    let _guard = crate::settings::settings_write_lock();
    let mut settings = crate::settings::read_settings()?;
    settings.analytics_enabled = Some(enabled);
    match crate::settings::persist_settings_committed(&mut settings)? {
        Some(warning) => Err(warning),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::SET_COOKIE;

    const DAY: i64 = 86_400;

    fn env() -> BeaconEnv {
        BeaconEnv {
            language: "zh-cn".to_string(),
            screen: Some((1512, 982)),
            window: Some((1280, 800)),
        }
    }

    fn keys(url: &reqwest::Url) -> Vec<String> {
        url.query_pairs().map(|(key, _)| key.into_owned()).collect()
    }

    fn value(url: &reqwest::Url, key: &str) -> Option<String> {
        url.query_pairs()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.into_owned())
    }

    #[test]
    fn first_visit_is_level_one_without_a_last_visit() {
        let mut record = VisitorRecord::default();
        let visit = advance_visits(&mut record, 1_000_000);
        assert_eq!(visit, Visit { last_visit: None, level: 1 });
        assert_eq!(record.visits, vec![1_000_000]);
        assert_eq!(record.last_pageview, Some(1_000_000));
    }

    #[test]
    fn a_relaunch_inside_the_session_gap_is_the_same_visit() {
        let mut record = VisitorRecord {
            visits: vec![1_000_000],
            last_pageview: Some(1_000_000),
            ..Default::default()
        };
        let visit = advance_visits(&mut record, 1_000_000 + SESSION_GAP_SECS);
        assert_eq!(visit, Visit { last_visit: Some(1_000_000), level: 2 });
        assert_eq!(record.visits, vec![1_000_000]);
    }

    #[test]
    fn a_new_session_appends_and_keeps_at_most_four_visits() {
        let base = 10_000_000;
        let mut record = VisitorRecord {
            visits: vec![base, base + DAY, base + 2 * DAY, base + 3 * DAY],
            last_pageview: Some(base + 3 * DAY),
            ..Default::default()
        };
        let now = base + 4 * DAY;
        let visit = advance_visits(&mut record, now);
        // Four recent visits before this one → returning-visitor level 3.
        assert_eq!(visit, Visit { last_visit: Some(now), level: 3 });
        assert_eq!(record.visits, vec![base + DAY, base + 2 * DAY, base + 3 * DAY, now]);
        assert_eq!(record.last_pageview, Some(now));
    }

    #[test]
    fn visits_older_than_thirty_days_are_forgotten() {
        let now = 50_000_000;
        let mut record = VisitorRecord {
            visits: vec![now - 40 * DAY, now - 31 * DAY, now - 2 * DAY],
            last_pageview: Some(now - 2 * DAY),
            ..Default::default()
        };
        let visit = advance_visits(&mut record, now);
        assert_eq!(visit.level, 2);
        assert_eq!(record.visits, vec![now - 2 * DAY, now]);
    }

    #[test]
    fn beacon_mirrors_the_hm_js_pageview_fields_in_order() {
        let visit = Visit { last_visit: Some(1_700_000_000), level: 2 };
        let url = beacon_url(Some("DD3B46289B57EEA5"), &visit, &env(), 1_700_000_123, 42);
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("hm.baidu.com"));
        assert_eq!(url.path(), "/hm.gif");
        assert_eq!(
            keys(&url),
            [
                "hca", "cc", "ck", "cl", "ds", "vl", "et", "ja", "ln", "lo", "lt", "rnd", "si",
                "v", "lv", "sn", "r", "ww", "tt"
            ]
        );
        assert_eq!(value(&url, "hca").as_deref(), Some("DD3B46289B57EEA5"));
        assert_eq!(value(&url, "si").as_deref(), Some(SITE_ID));
        assert_eq!(value(&url, "v").as_deref(), Some(HM_VERSION));
        assert_eq!(value(&url, "et").as_deref(), Some("0"));
        assert_eq!(value(&url, "lv").as_deref(), Some("2"));
        assert_eq!(value(&url, "lt").as_deref(), Some("1700000000"));
        assert_eq!(value(&url, "sn").as_deref(), Some(&*(1_700_000_123 % 65_535).to_string()));
        assert_eq!(value(&url, "rnd").as_deref(), Some("42"));
        assert_eq!(value(&url, "ds").as_deref(), Some("1512x982"));
        assert_eq!(value(&url, "ww").as_deref(), Some("1280"));
        assert_eq!(value(&url, "vl").as_deref(), Some("800"));
        assert_eq!(value(&url, "ln").as_deref(), Some("zh-cn"));
        assert_eq!(value(&url, "tt").as_deref(), Some(PAGE_TITLE));
        // encodeURIComponent, not form encoding: a space is %20, never '+'.
        assert!(url.query().unwrap().contains("tt=CC%20GUI"), "{url}");
    }

    #[test]
    fn beacon_never_carries_a_page_url_referrer_or_token() {
        let first = Visit { last_visit: None, level: 1 };
        let url = beacon_url(None, &first, &BeaconEnv::default(), 1, 7);
        for forbidden in ["u", "su", "ep", "api", "p", "cv", "cf", "ci", "cm", "cp", "cu", "cw"] {
            assert!(value(&url, forbidden).is_none(), "{forbidden} must be omitted: {url}");
        }
        // Unknown facts are omitted like hm.js skips empty fields.
        for omitted in ["hca", "lt", "ds", "vl"] {
            assert!(value(&url, omitted).is_none(), "{omitted}: {url}");
        }
        assert_eq!(value(&url, "lv").as_deref(), Some("1"));
        let raw = url.as_str().to_ascii_lowercase();
        for leak in ["token", "localhost", "file", "http%3a", "https%3a"] {
            assert!(!raw.contains(leak), "{leak} leaked into {url}");
        }
    }

    #[test]
    fn encodes_like_encode_uri_component() {
        assert_eq!(encode_uri_component("CC GUI"), "CC%20GUI");
        assert_eq!(encode_uri_component("a-b_c.d!e~f*g'h(i)"), "a-b_c.d!e~f*g'h(i)");
        assert_eq!(encode_uri_component("x=1&y/z"), "x%3D1%26y%2Fz");
        assert_eq!(encode_uri_component("中"), "%E4%B8%AD");
    }

    #[test]
    fn maps_the_app_language_to_a_browser_style_tag() {
        assert_eq!(beacon_language("zh"), "zh-cn");
        assert_eq!(beacon_language("en"), "en-us");
        assert_eq!(beacon_language("ko"), "ko-kr");
        assert_eq!(beacon_language("ja-JP"), "ja-jp");
        assert_eq!(beacon_language("x; drop"), "zh-cn");
    }

    #[test]
    fn user_agent_names_the_os_and_app_version() {
        let ua = beacon_user_agent();
        assert!(ua.starts_with("Mozilla/5.0 ("), "{ua}");
        assert!(ua.ends_with(&format!("CCGUI/{}", env!("CARGO_PKG_VERSION"))), "{ua}");
        assert!(HeaderValue::from_str(&ua).is_ok());
    }

    /// The main window can call every app command; no remote origin may ever
    /// supply script to it again (hm.js used to run there).
    #[test]
    fn csp_allows_no_remote_script_origin() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"].as_str().unwrap();
        let script_src = csp
            .split(';')
            .map(str::trim)
            .find(|directive| directive.starts_with("script-src"))
            .unwrap();
        for source in script_src.split_whitespace().skip(1) {
            let remote = source.starts_with("https:") || source.starts_with("http:");
            assert!(
                !remote || source == "http://pluginasset.localhost",
                "remote script source {source} in {script_src}"
            );
        }
        assert!(!csp.contains("hm.baidu.com"), "{csp}");
    }

    #[test]
    fn analytics_is_on_unless_switched_off() {
        let mut settings = crate::settings::AppSettings::default();
        assert!(analytics_enabled(&settings));
        settings.analytics_enabled = Some(true);
        assert!(analytics_enabled(&settings));
        settings.analytics_enabled = Some(false);
        assert!(!analytics_enabled(&settings));
    }

    #[test]
    fn extracts_only_a_bounded_hmac_count_cookie() {
        let mut headers = HeaderMap::new();
        headers.append(SET_COOKIE, HeaderValue::from_static("OTHER=1; Path=/"));
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("HMACCOUNT=814DB93EB1B8C572; Path=/; Domain=hm.baidu.com"),
        );
        assert_eq!(extract_hmac_count(&headers).as_deref(), Some("814DB93EB1B8C572"));

        let mut hostile = HeaderMap::new();
        hostile.append(SET_COOKIE, HeaderValue::from_static("HMACCOUNT=a;b"));
        hostile.append(SET_COOKIE, HeaderValue::from_static("HMACCOUNT=<script>"));
        assert_eq!(extract_hmac_count(&hostile).as_deref(), Some("a"));
        assert!(!valid_hmac_count("<script>"));
        assert!(!valid_hmac_count(&"A".repeat(MAX_HMAC_COUNT_BYTES + 1)));
    }

    #[test]
    fn reads_the_previous_record_format_and_rejects_bad_ids() {
        let dir = std::env::temp_dir().join(format!("ccgui-tongji-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(RECORD_FILENAME);

        std::fs::write(&path, r#"{"hmacCount":"814DB93EB1B8C572"}"#).unwrap();
        let record = read_record(&path).unwrap();
        assert_eq!(record.hmac_count.as_deref(), Some("814DB93EB1B8C572"));
        assert!(record.visits.is_empty());

        std::fs::write(&path, r#"{"hmacCount":"<bad>"}"#).unwrap();
        assert!(read_record(&path).is_err());

        std::fs::remove_file(&path).unwrap();
        assert_eq!(read_record(&path).unwrap(), VisitorRecord::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
