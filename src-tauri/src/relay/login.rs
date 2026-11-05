//! Desktop-only, one-shot Cloudflare login deployment. OAuth stays in Rust;
//! the UI receives only authorized account names and the final relay address.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{watch, Mutex as AsyncMutex};

use super::wrangler::{self, WranglerAuth};
use super::{cf_json, cf_upload_relay, cf_worker_exists, complete_relay_deploy, RelayDeployResult, API_BASE, SCRIPT_NAME};

const PROGRESS_EVENT: &str = "relay://login-progress";
const SESSION_LIFETIME: Duration = Duration::from_secs(15 * 60);
static ACTIVE: Mutex<Option<Arc<LoginRun>>> = Mutex::new(None);
// Async IPC commands can start out of order. Remember recent cancelled IDs
// so closing the dialog before start is scheduled cannot open a browser later.
static CANCELLED_IDS: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

struct LoginRun {
    id: String,
    cancel: watch::Sender<bool>,
    finished: watch::Sender<bool>,
    deploying: AtomicBool,
    authorized: AsyncMutex<Option<Authorized>>,
}

struct Authorized {
    credentials: WranglerAuth,
    accounts: Vec<RelayLoginAccount>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayLoginAccount {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayLoginInspection {
    pub account_id: String,
    pub account_name: String,
    pub subdomain: Option<String>,
    pub worker_exists: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    run_id: &'a str,
    stage: &'static str,
}

fn progress(app: &tauri::AppHandle, run: &LoginRun, stage: &'static str) {
    let _ = app.emit(PROGRESS_EVENT, Progress { run_id: &run.id, stage });
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())
}

fn current(run_id: &str) -> Result<Arc<LoginRun>, String> {
    ACTIVE.lock().as_ref()
        .filter(|run| run.id == run_id && !*run.cancel.borrow())
        .cloned()
        .ok_or_else(|| "Cloudflare 登录已结束或过期，请重新登录".to_string())
}

fn finish(run: &LoginRun) {
    run.cancel.send_replace(true);
    let mut active = ACTIVE.lock();
    if active.as_ref().is_some_and(|active| active.id == run.id) {
        active.take();
    }
    run.finished.send_replace(true);
}

async fn cancel_run(run_id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(run_id).map_err(|_| "无效的登录任务标识".to_string())?;
    let run = {
        let active = ACTIVE.lock();
        let Some(run) = active.as_ref().filter(|run| run.id == run_id) else {
            let mut cancelled = CANCELLED_IDS.lock();
            if !cancelled.iter().any(|id| id == run_id) {
                if cancelled.len() == 32 { cancelled.pop_front(); }
                cancelled.push_back(run_id.to_string());
            }
            return Ok(());
        };
        // Check and signal under the same registry lock used by deployment.
        // Once cloud writes begin, let them finish and persist the new key.
        if run.deploying.load(Ordering::Acquire) {
            return Err("部署正在写入 Cloudflare，请等待结果".to_string());
        }
        run.cancel.send_replace(true);
        Arc::clone(run)
    };
    let authorized = run.authorized.lock().await.take();
    if let Some(authorized) = authorized {
        authorized.credentials.cleanup().await;
        finish(&run);
    }
    // Keep the cancelling dialog until the owned process and credentials are
    // gone, so an immediate retry cannot collide with the old callback server.
    let mut finished = run.finished.subscribe();
    if !*finished.borrow() {
        let _ = finished.changed().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn relay_login_cancel(run_id: String) -> Result<(), String> {
    cancel_run(&run_id).await
}

#[tauri::command]
pub async fn relay_login_start(
    app: tauri::AppHandle,
    run_id: String,
) -> Result<Vec<RelayLoginAccount>, String> {
    uuid::Uuid::parse_str(&run_id).map_err(|_| "无效的登录任务标识".to_string())?;
    let (cancel, mut cancelled) = watch::channel(false);
    let (finished, _) = watch::channel(false);
    let run = Arc::new(LoginRun {
        id: run_id,
        cancel,
        finished,
        deploying: AtomicBool::new(false),
        authorized: AsyncMutex::new(None),
    });
    {
        let mut active = ACTIVE.lock();
        let mut cancelled_ids = CANCELLED_IDS.lock();
        if let Some(index) = cancelled_ids.iter().position(|id| id == &run.id) {
            cancelled_ids.remove(index);
            return Err("Cloudflare 登录已取消".to_string());
        }
        if active.is_some() {
            return Err("另一个 Cloudflare 登录部署任务尚未结束".to_string());
        }
        *active = Some(Arc::clone(&run));
    }
    let expiry_id = run.id.clone();
    let mut expiry_cancel = run.cancel.subscribe();
    tokio::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(SESSION_LIFETIME) => { let _ = cancel_run(&expiry_id).await; }
            _ = expiry_cancel.changed() => {}
        }
    });
    let auth = wrangler::login(
        run.cancel.subscribe(),
        |stage| progress(&app, &run, stage),
        |url| {
            if *run.cancel.borrow() {
                return Err("Cloudflare 登录已取消".to_string());
            }
            let parsed = reqwest::Url::parse(url).map_err(|_| "无效的 Cloudflare 授权地址".to_string())?;
            if parsed.scheme() != "https" || parsed.host_str() != Some("dash.cloudflare.com")
                || parsed.path() != "/oauth2/auth" || !parsed.username().is_empty() || parsed.password().is_some()
            {
                return Err("Wrangler 返回了非 Cloudflare 授权地址".to_string());
            }
            app.opener().open_url(url, None::<&str>)
                .map_err(|_| "无法打开系统浏览器，请检查默认浏览器设置".to_string())
        },
    ).await;
    let auth = match auth {
        Ok(auth) => auth,
        Err(error) => { finish(&run); return Err(error); }
    };
    let accounts = tokio::select! {
        _ = cancelled.changed() => Err("Cloudflare 登录已取消".to_string()),
        result = list_accounts(&auth.token) => result,
    };
    match accounts {
        Ok(accounts) => {
            let mut slot = run.authorized.lock().await;
            if *run.cancel.borrow() {
                drop(slot);
                auth.cleanup().await;
                finish(&run);
                return Err("Cloudflare 登录已取消".to_string());
            }
            *slot = Some(Authorized { credentials: auth, accounts: accounts.clone() });
            Ok(accounts)
        }
        Err(error) => {
            let error = error.replace(&auth.token, "[redacted]");
            auth.cleanup().await;
            finish(&run);
            Err(error)
        }
    }
}

async fn list_accounts(token: &str) -> Result<Vec<RelayLoginAccount>, String> {
    let client = client()?;
    let mut accounts = Vec::new();
    let mut page = 1u64;
    loop {
        let response = client.get(format!("{API_BASE}/accounts"))
            .query(&[("page", page), ("per_page", 50)])
            .bearer_auth(token).send().await
            .map_err(|error| format!("读取授权账户失败：{error}"))?;
        let value = cf_json(response, "读取授权账户").await?;
        let rows = value.get("result").and_then(|result| result.as_array())
            .ok_or_else(|| "Cloudflare 未返回账户列表".to_string())?;
        for row in rows {
            let id = row.get("id").and_then(|id| id.as_str()).unwrap_or_default();
            if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("Cloudflare 返回了无效的账户标识".to_string());
            }
            let name = row.get("name").and_then(|name| name.as_str()).filter(|name| !name.is_empty()).unwrap_or(id);
            accounts.push(RelayLoginAccount { id: id.to_string(), name: name.to_string() });
        }
        let total_pages = value.pointer("/result_info/total_pages").and_then(|n| n.as_u64());
        if rows.len() < 50 || total_pages.is_some_and(|total| page >= total) { break; }
        page += 1;
    }
    if accounts.is_empty() {
        return Err("没有获得可部署的 Cloudflare 账户，请确认账户权限并重新授权".to_string());
    }
    Ok(accounts)
}

fn authorized_account<'a>(accounts: &'a [RelayLoginAccount], id: &str) -> Result<&'a RelayLoginAccount, String> {
    accounts.iter().find(|account| account.id == id)
        .ok_or_else(|| "只能部署到本次登录授权的账户".to_string())
}

fn valid_subdomain(subdomain: &str) -> bool {
    !subdomain.is_empty() && subdomain.len() <= 63
        && subdomain.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !subdomain.starts_with('-') && !subdomain.ends_with('-')
}

async fn read_subdomain(client: &reqwest::Client, token: &str, account_id: &str) -> Result<Option<String>, String> {
    let response = client.get(format!("{API_BASE}/accounts/{account_id}/workers/subdomain"))
        .bearer_auth(token).send().await
        .map_err(|error| format!("读取 workers.dev 子域失败：{error}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(None); }
    let value = cf_json(response, "读取 workers.dev 子域").await?;
    match value.pointer("/result/subdomain").and_then(|s| s.as_str()).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(subdomain) if valid_subdomain(subdomain) => Ok(Some(subdomain.to_string())),
        Some(_) => Err("Cloudflare 返回了无效的 workers.dev 子域".to_string()),
    }
}

#[tauri::command]
pub async fn relay_login_inspect(run_id: String, account_id: String) -> Result<RelayLoginInspection, String> {
    let run = current(&run_id)?;
    let guard = run.authorized.lock().await;
    let authorized = guard.as_ref().ok_or_else(|| "Cloudflare 登录尚未完成".to_string())?;
    let account = authorized_account(&authorized.accounts, &account_id)?;
    let token = &authorized.credentials.token;
    let mut cancelled = run.cancel.subscribe();
    if *cancelled.borrow() { return Err("Cloudflare 登录已取消".to_string()); }
    let result = tokio::select! {
        _ = cancelled.changed() => Err("Cloudflare 登录已取消".to_string()),
        result = async {
            let client = client()?;
            let subdomain = read_subdomain(&client, token, &account_id).await?;
            let worker_exists = cf_worker_exists(&client, token, &account_id).await?;
            Ok(RelayLoginInspection {
                account_id: account.id.clone(), account_name: account.name.clone(), subdomain, worker_exists,
            })
        } => result,
    };
    result.map_err(|error: String| error.replace(token, "[redacted]"))
}

#[tauri::command]
pub async fn relay_login_deploy(
    app: tauri::AppHandle,
    run_id: String,
    account_id: String,
    subdomain: Option<String>,
    overwrite: bool,
) -> Result<RelayDeployResult, String> {
    let run = {
        let active = ACTIVE.lock();
        let run = active.as_ref().filter(|run| run.id == run_id && !*run.cancel.borrow())
            .ok_or_else(|| "Cloudflare 登录已结束或过期，请重新登录".to_string())?;
        if run.deploying.swap(true, Ordering::AcqRel) {
            return Err("中转部署正在进行，请勿重复提交".to_string());
        }
        Arc::clone(run)
    };
    let authorized = run.authorized.lock().await.take();
    let Some(authorized) = authorized else {
        run.deploying.store(false, Ordering::Release);
        return Err("Cloudflare 登录尚未完成".to_string());
    };
    progress(&app, &run, "deploying");
    let result = deploy_authorized(&app, &authorized, &account_id, subdomain.as_deref(), overwrite).await
        .map_err(|error| error.replace(&authorized.credentials.token, "[redacted]"));
    authorized.credentials.cleanup().await;
    finish(&run);
    result
}

async fn deploy_authorized(
    app: &tauri::AppHandle,
    authorized: &Authorized,
    account_id: &str,
    requested_subdomain: Option<&str>,
    overwrite: bool,
) -> Result<RelayDeployResult, String> {
    let account = authorized_account(&authorized.accounts, account_id)?;
    let client = client()?;
    let token = &authorized.credentials.token;
    let exists = cf_worker_exists(&client, token, account_id).await?;
    if exists && !overwrite {
        return Err("此账户已有 ccgui-relay；请确认覆盖部署和更换密钥后再试".to_string());
    }
    let subdomain = match read_subdomain(&client, token, account_id).await? {
        Some(existing) => existing, // Never change an account-wide existing subdomain.
        None => {
            let requested = requested_subdomain.unwrap_or_default().trim().to_ascii_lowercase();
            if !valid_subdomain(&requested) {
                return Err("请填写有效的 workers.dev 子域：1–63 位小写字母、数字或中间连字符".to_string());
            }
            let response = client.put(format!("{API_BASE}/accounts/{account_id}/workers/subdomain"))
                .bearer_auth(token).json(&serde_json::json!({ "subdomain": requested })).send().await
                .map_err(|error| format!("创建 workers.dev 子域失败：{error}"))?;
            cf_json(response, "创建 workers.dev 子域").await?;
            read_subdomain(&client, token, account_id).await?
                .ok_or_else(|| "Cloudflare 尚未确认 workers.dev 子域，请检查账户设置".to_string())?
        }
    };
    let key = super::new_relay_key();
    cf_upload_relay(&client, token, account_id, &key, exists).await?;
    let result = RelayDeployResult {
        url: format!("https://{SCRIPT_NAME}.{subdomain}.workers.dev"),
        key,
        account_id: account.id.clone(),
        account_name: account.name.clone(),
        error: None,
    };
    Ok(complete_relay_deploy(app, &client, token, result).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_selection_cannot_escape_the_authorized_set() {
        let accounts = vec![RelayLoginAccount { id: "a".repeat(32), name: "personal".into() }];
        assert_eq!(authorized_account(&accounts, &"a".repeat(32)).unwrap().name, "personal");
        assert!(authorized_account(&accounts, &"b".repeat(32)).is_err());
        assert!(authorized_account(&accounts, "../workers").is_err());
    }

    #[test]
    fn subdomain_is_one_dns_label_not_a_url_or_path() {
        for accepted in ["relay", "my-relay-2", "0", &"a".repeat(63)] {
            assert!(valid_subdomain(accepted), "{accepted}");
        }
        for rejected in ["", "-relay", "relay-", "a.b", "https://relay", "../relay", "a b", "Relay", "中转", &"a".repeat(64)] {
            assert!(!valid_subdomain(rejected), "{rejected}");
        }
    }
}
