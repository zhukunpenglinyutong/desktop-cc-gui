//! 内置 skill 的落盘器：把随应用分发的「插件开发」skill 同步进各 CLI 的
//! skills 根，让用户在任意引擎里都能用自然语言（或 `/ccgui-plugin-creator`）
//! 触发插件生成。
//!
//! 为什么必须落到 CLI 自己的根：skill 是 CLI 的原生能力——composer 的 `/`
//! 选择器只是把磁盘上的 skill 显示出来，真正加载并触发它的仍是 CLI
//! （`$CLAUDE_CONFIG_DIR/skills`、`$CODEX_HOME/skills`、`~/.agents/skills`，
//! 见 slash_commands.rs 的扫描根）。宿主自己在别处塞一份，引擎看不到，等于
//! 假成功。
//!
//! 只在用户点插件中心的「创建插件」时写入（`creator_skill_install`），不在
//! 启动时写：每次启动都改动其他 CLI 的配置目录，正是安全审查关注的「篡改
//! 他人配置」特征（docs/security-incidents/2026-11-security-audit.zh-CN.md M5）。
//!
//! 幂等与不越权：
//!
//! - 目标目录不存在 → 写入全部文件 + `.ccgui-managed.json` 标记；
//! - 标记是本应用写的、且内容哈希与随包分发的一致 → 一个字节都不写；
//! - 标记存在但哈希变了（应用升级换代 skill 内容）→ 覆盖我们写的文件，
//!   并删掉上一版托管、这一版不再有的文件；
//! - 目录存在但没有我们的标记（用户或别的工具的同名 skill）→ 完全不动，
//!   报 conflict（用户自有内容优先）。
//!
//! 目标根只在对应引擎的 home 已存在时写入：不替用户创建 `~/.claude`
//! 之类的目录，避免在没装该 CLI 的机器上留垃圾。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};

/// 随包分发的 skill 目录名（= SKILL.md frontmatter 的 name）。
pub const SKILL_ID: &str = "ccgui-plugin-creator";

/// 资源目录内的父目录（与 tauri.conf.json 的 resources 映射一致）。
const SKILLS_DIR: &str = "skills";
/// 托管标记：没有它就认为目标目录不是本应用写的。
const META_FILE: &str = ".ccgui-managed.json";
const MANAGED_BY: &str = "ccgui";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillAction {
    /// 新装或刷新（应用升级后内容变化）。
    Written,
    /// 已是最新，本次没有写入。
    Current,
    /// 目标目录被非本应用的内容占用，刻意不动。
    Conflict,
    /// 读写失败（权限、磁盘）；错误在 `error` 字段。
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillTargetReport {
    /// 目标 skills 根（`<engine home>/skills`）。
    pub root: String,
    /// 本次操作的 skill 目录绝对路径。
    pub path: String,
    pub action: SkillAction,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallReport {
    /// 随包资源里 skill 的目录；None = 打包缺资源（打包 bug，不是用户问题）。
    pub source: Option<String>,
    pub targets: Vec<SkillTargetReport>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedMeta {
    managed_by: String,
    skill: String,
    /// 写入时源树的哈希：与当前源一致则整次安装零写入。
    source_hash: String,
    /// 本应用写进该目录的文件（相对路径），刷新时用于清理上一版多出的文件。
    files: Vec<String>,
}

fn meta_path(skill_dir: &Path) -> PathBuf {
    skill_dir.join(META_FILE)
}

/// 读取整个源树（相对路径 + 字节）。跳过托管标记本身；拒绝含 `..` 的路径
/// ——资源树来自安装包，这个判断是纵深防御，不靠它挡攻击。
fn collect_tree(root: &Path) -> Result<Vec<(PathBuf, Vec<u8>)>, String> {
    let mut out: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries =
            std::fs::read_dir(&dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                // 符号链接等特殊文件不随包分发，跳过而不是跟随。
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_path_buf();
            if rel.file_name().is_some_and(|name| name == META_FILE) {
                continue;
            }
            if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
                continue;
            }
            let bytes =
                std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
            out.push((rel, bytes));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

/// 源树内容哈希（含相对路径，避免改名后哈希不变）。
fn tree_hash(files: &[(PathBuf, Vec<u8>)]) -> String {
    let mut hasher = Sha256::new();
    for (rel, bytes) in files {
        hasher.update(rel.to_string_lossy().as_bytes());
        hasher.update([0u8]);
        hasher.update(bytes);
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())
}

fn read_meta(skill_dir: &Path) -> Option<ManagedMeta> {
    let content = std::fs::read_to_string(meta_path(skill_dir)).ok()?;
    let meta: ManagedMeta = serde_json::from_str(&content).ok()?;
    (meta.managed_by == MANAGED_BY && meta.skill == SKILL_ID).then_some(meta)
}

fn write_tree(skill_dir: &Path, files: &[(PathBuf, Vec<u8>)], hash: &str) -> Result<(), String> {
    for (rel, bytes) in files {
        let target = skill_dir.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, bytes).map_err(|e| format!("write {}: {e}", target.display()))?;
    }
    let meta = ManagedMeta {
        managed_by: MANAGED_BY.to_string(),
        skill: SKILL_ID.to_string(),
        source_hash: hash.to_string(),
        files: files
            .iter()
            .map(|(rel, _)| rel.to_string_lossy().to_string())
            .collect(),
    };
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    // 标记最后写：中途失败时残留的旧标记会让下次启动重写，而不是误判为最新。
    std::fs::write(meta_path(skill_dir), json)
        .map_err(|e| format!("write {}: {e}", meta_path(skill_dir).display()))?;
    Ok(())
}

/// 把 `source` 同步到 `skill_dir`。判定规则见模块头注释。
pub(crate) fn install_skill_into(skill_dir: &Path, source: &Path) -> Result<SkillAction, String> {
    let files = collect_tree(source)?;
    if files.is_empty() {
        return Err(format!("bundled skill {} is empty", source.display()));
    }
    let hash = tree_hash(&files);

    match std::fs::symlink_metadata(skill_dir) {
        Ok(meta) if !meta.is_dir() => {
            // 同名路径是文件：不是我们的东西，不碰。
            return Ok(SkillAction::Conflict);
        }
        Ok(_) => {}
        Err(_) => {
            std::fs::create_dir_all(skill_dir)
                .map_err(|e| format!("create {}: {e}", skill_dir.display()))?;
            write_tree(skill_dir, &files, &hash)?;
            return Ok(SkillAction::Written);
        }
    }

    let Some(meta) = read_meta(skill_dir) else {
        return Ok(SkillAction::Conflict);
    };
    if meta.source_hash == hash {
        return Ok(SkillAction::Current);
    }
    write_tree(skill_dir, &files, &hash)?;
    // 清理上一版托管、这一版不再分发的文件（只删标记里列过的路径）。
    let shipped: Vec<String> = files
        .iter()
        .map(|(rel, _)| rel.to_string_lossy().to_string())
        .collect();
    for stale in meta.files.iter().filter(|f| !shipped.contains(f)) {
        let path = skill_dir.join(stale);
        if path.starts_with(skill_dir) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(SkillAction::Written)
}

/// 随包 skill 的源目录：resource dir 优先，开发/测试回落到 CARGO_MANIFEST_DIR。
pub(crate) fn skill_source_root(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(root) = resource_dir {
        candidates.push(root.join(SKILLS_DIR).join(SKILL_ID));
        candidates.push(root.join("resources").join(SKILLS_DIR).join(SKILL_ID));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(dir) = executable.parent() {
            if cfg!(target_os = "macos") {
                if let Some(contents) = dir.parent() {
                    candidates.push(contents.join("Resources").join(SKILLS_DIR).join(SKILL_ID));
                }
            }
            candidates.push(dir.join(SKILLS_DIR).join(SKILL_ID));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(SKILLS_DIR)
            .join(SKILL_ID),
    );
    candidates
        .into_iter()
        .find(|c| c.join("SKILL.md").is_file())
}

/// 要同步的 skills 根：引擎 home 已存在才写（不替用户创建引擎目录）。
///
/// 根列表来自 skills hub 的目标表——那里定义“哪些 CLI 读哪个目录”。两处
/// 共用同一份解析，内置 skill 才真能在每个已安装的 CLI 里被 `/` 触发；
/// 在别处塞一份引擎看不到的副本等于假成功。
pub(crate) fn engine_skill_roots() -> Vec<PathBuf> {
    crate::skills_hub::installed_engine_skill_roots()
}

/// 同步到全部引擎根；单个目标失败不影响其它目标（启动路径不抛错）。
pub fn install(resource_dir: Option<&Path>) -> SkillInstallReport {
    let source = skill_source_root(resource_dir);
    let Some(source) = source else {
        return SkillInstallReport {
            source: None,
            targets: Vec::new(),
        };
    };
    let mut targets = Vec::new();
    for root in engine_skill_roots() {
        let skill_dir = root.join(SKILL_ID);
        let (action, error) = match install_skill_into(&skill_dir, &source) {
            Ok(action) => (action, None),
            Err(message) => (SkillAction::Failed, Some(message)),
        };
        targets.push(SkillTargetReport {
            root: root.to_string_lossy().to_string(),
            path: skill_dir.to_string_lossy().to_string(),
            action,
            error,
        });
    }
    SkillInstallReport {
        source: Some(source.to_string_lossy().to_string()),
        targets,
    }
}

/// 前端入口（插件中心的「创建插件」按钮在开新会话前调用）：返回每个目标的
/// 结果，让 UI 能如实说明"装了/已是最新/被占用"。
#[tauri::command]
pub fn creator_skill_install(app: tauri::AppHandle) -> SkillInstallReport {
    use tauri::Manager;
    let resource_dir = app.path().resource_dir().ok();
    install(resource_dir.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch {
        dir: PathBuf,
    }

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("ccgui-creator-skill-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self { dir }
        }

        fn source(&self) -> PathBuf {
            let source = self.dir.join("source");
            std::fs::write(self.dir.join("placeholder"), b"").unwrap();
            std::fs::create_dir_all(source.join("references")).unwrap();
            std::fs::write(
                source.join("SKILL.md"),
                b"---\nname: ccgui-plugin-creator\n---\n",
            )
            .unwrap();
            std::fs::write(source.join("references/sdk-api.md"), b"# sdk\n").unwrap();
            source
        }

        fn target(&self) -> PathBuf {
            self.dir.join("home/skills").join(SKILL_ID)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// 环境变量转向：设置 HOME/CLAUDE_CONFIG_DIR/CODEX_HOME 并在 drop 时恢复，
    /// 避免测试碰到开发机真实的引擎配置目录。调用方必须持有 HOME_ENV_LOCK。
    struct EnvSteer {
        previous: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }

    impl EnvSteer {
        fn apply(vars: &[(&'static str, &Path)]) -> Self {
            // 引擎 home 的全部 env 变量参与 `engine_skill_roots` 解析：开发机上
            // 真实设置的 GROK_HOME 等不能把测试的写入引到 scratch 之外。
            const KEYS: [&str; 13] = [
                "HOME",
                "USERPROFILE",
                "CLAUDE_CONFIG_DIR",
                "CODEX_HOME",
                "KIMI_CODE_HOME",
                "GROK_HOME",
                "PI_CODING_AGENT_DIR",
                "OMP_CODING_AGENT_DIR",
                "DSH_HOME",
                "ANTIGRAVITY_HOME",
                "GEMINI_DIR",
                "XDG_CONFIG_HOME",
                "HERMES_HOME",
            ];
            let previous = KEYS
                .into_iter()
                .map(|key| (key, std::env::var_os(key)))
                .collect();
            for key in KEYS {
                std::env::remove_var(key);
            }
            for (key, value) in vars {
                std::env::set_var(key, value);
            }
            Self { previous }
        }
    }

    impl Drop for EnvSteer {
        fn drop(&mut self) {
            for (key, value) in &self.previous {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[test]
    fn installs_when_target_is_missing_then_stays_current() {
        let scratch = Scratch::new("install");
        let source = scratch.source();
        let target = scratch.target();

        assert_eq!(
            install_skill_into(&target, &source).unwrap(),
            SkillAction::Written
        );
        assert_eq!(
            std::fs::read_to_string(target.join("SKILL.md")).unwrap(),
            std::fs::read_to_string(source.join("SKILL.md")).unwrap()
        );
        assert!(read_meta(&target).is_some(), "marker must be written");

        // 第二次：内容一致 → 不重写（用 mtime 证明确实没动文件）。
        let before = std::fs::metadata(target.join("SKILL.md"))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(
            install_skill_into(&target, &source).unwrap(),
            SkillAction::Current
        );
        let after = std::fs::metadata(target.join("SKILL.md"))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(before, after, "current install must not touch files");
    }

    #[test]
    fn refreshes_managed_copy_and_drops_files_no_longer_shipped() {
        let scratch = Scratch::new("refresh");
        let source = scratch.source();
        let target = scratch.target();
        assert_eq!(
            install_skill_into(&target, &source).unwrap(),
            SkillAction::Written
        );

        // 源换代：改内容、删一个文件、加一个文件。
        std::fs::write(
            source.join("SKILL.md"),
            b"---\nname: ccgui-plugin-creator\n---\nv2\n",
        )
        .unwrap();
        std::fs::remove_file(source.join("references/sdk-api.md")).unwrap();
        std::fs::write(source.join("references/permissions.md"), b"# perms\n").unwrap();
        // 用户自己在目录里放的文件必须留下（不在我们标记的清单里）。
        std::fs::write(target.join("user-notes.md"), b"mine\n").unwrap();

        assert_eq!(
            install_skill_into(&target, &source).unwrap(),
            SkillAction::Written
        );
        assert!(std::fs::read_to_string(target.join("SKILL.md"))
            .unwrap()
            .contains("v2"));
        assert!(
            !target.join("references/sdk-api.md").exists(),
            "stale managed file must go"
        );
        assert!(target.join("references/permissions.md").exists());
        assert!(
            target.join("user-notes.md").exists(),
            "unmanaged file must survive"
        );
        assert_eq!(read_meta(&target).unwrap().files.len(), 2);
    }

    #[test]
    fn leaves_foreign_directory_untouched() {
        let scratch = Scratch::new("conflict");
        let source = scratch.source();
        let target = scratch.target();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("SKILL.md"), b"user's own skill\n").unwrap();

        assert_eq!(
            install_skill_into(&target, &source).unwrap(),
            SkillAction::Conflict
        );
        assert_eq!(
            std::fs::read_to_string(target.join("SKILL.md")).unwrap(),
            "user's own skill\n"
        );
        assert!(!meta_path(&target).exists());

        // 同名路径是个文件时同样不动它。
        let file_target = scratch.dir.join("as-file");
        std::fs::write(&file_target, b"x").unwrap();
        assert_eq!(
            install_skill_into(&file_target, &source).unwrap(),
            SkillAction::Conflict
        );
    }

    #[test]
    fn engine_roots_follow_configured_homes_and_skip_missing_ones() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        let scratch = Scratch::new("roots");
        let claude = scratch.dir.join("claude-home");
        let codex = scratch.dir.join("codex-home");
        let agents = scratch.dir.join("agents-home");

        // 三个 home 都不存在 → 一个目标都不写（不替用户创建引擎目录）。
        std::fs::create_dir_all(&agents).unwrap();
        let steer = EnvSteer::apply(&[
            ("CLAUDE_CONFIG_DIR", &claude),
            ("CODEX_HOME", &codex),
            ("HOME", &agents),
        ]);
        let roots = engine_skill_roots();
        assert!(
            roots.is_empty(),
            "no engine home exists → no targets: {roots:?}"
        );
        drop(steer);

        // 建好三个 home → 三个目标，各取自己的 skills 根。
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::create_dir_all(&codex).unwrap();
        std::fs::create_dir_all(agents.join(".agents")).unwrap();
        let _steer = EnvSteer::apply(&[
            ("CLAUDE_CONFIG_DIR", &claude),
            ("CODEX_HOME", &codex),
            ("HOME", &agents),
        ]);
        let roots = engine_skill_roots();
        assert!(roots.contains(&claude.join("skills")), "{roots:?}");
        assert!(roots.contains(&codex.join("skills")), "{roots:?}");
        assert!(
            roots.contains(&agents.join(".agents").join("skills")),
            "{roots:?}"
        );
    }

    #[test]
    fn install_writes_every_engine_root_then_reports_current() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        let scratch = Scratch::new("install-all");
        let claude = scratch.dir.join("claude");
        let codex = scratch.dir.join("codex");
        let home = scratch.dir.join("home");
        for dir in [&claude, &codex] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::create_dir_all(home.join(".agents")).unwrap();
        let _steer = EnvSteer::apply(&[
            ("CLAUDE_CONFIG_DIR", &claude),
            ("CODEX_HOME", &codex),
            ("HOME", &home),
        ]);

        // 打包资源目录形状：<resource_dir>/skills/<id>/…
        let resource_dir = scratch.dir.join("resource_dir");
        let bundled = resource_dir.join(SKILLS_DIR).join(SKILL_ID);
        std::fs::create_dir_all(bundled.join("references")).unwrap();
        std::fs::write(
            bundled.join("SKILL.md"),
            b"---\nname: ccgui-plugin-creator\n---\n",
        )
        .unwrap();
        std::fs::write(bundled.join("references/sdk-api.md"), b"# sdk\n").unwrap();

        let report = install(Some(&resource_dir));
        assert_eq!(
            report.source.as_deref(),
            Some(bundled.to_string_lossy().as_ref())
        );
        assert_eq!(report.targets.len(), 3, "{:?}", report.targets);
        for target in &report.targets {
            assert!(target.action == SkillAction::Written, "{:?}", target);
            let dir = Path::new(&target.path);
            assert!(dir.join("SKILL.md").is_file(), "{}", target.path);
            assert!(
                dir.join("references/sdk-api.md").is_file(),
                "{}",
                target.path
            );
            assert!(dir.join(META_FILE).is_file(), "{}", target.path);
        }

        // 第二次启动：三个根都报 current（内容哈希一致，零写入）。
        let again = install(Some(&resource_dir));
        assert!(again
            .targets
            .iter()
            .all(|t| t.action == SkillAction::Current));
    }

    #[test]
    fn prefers_packaged_resource_dir_over_dev_fallback() {
        let scratch = Scratch::new("source");
        let resource = scratch.dir.join("resource_dir");
        let bundled = resource.join("skills").join(SKILL_ID);
        std::fs::create_dir_all(&bundled).unwrap();
        std::fs::write(bundled.join("SKILL.md"), b"---\nname: packaged\n---\n").unwrap();
        assert_eq!(skill_source_root(Some(&resource)).unwrap(), bundled);

        // 资源目录里没有 skill（开发模式 / 打包缺资源）：回落到本仓的开发树。
        let empty = scratch.dir.join("no-skills");
        std::fs::create_dir_all(&empty).unwrap();
        let fallback = skill_source_root(Some(&empty)).expect("dev fallback must resolve");
        assert!(fallback.ends_with(Path::new("resources").join(SKILLS_DIR).join(SKILL_ID)));
        assert!(fallback.join("SKILL.md").is_file());
    }

    #[test]
    fn bundled_skill_resource_exists_in_repo() {
        // 打包资源缺失只会在运行时暴露，这里先在本仓把门（含 SKILL.md 与
        // 生成的 SDK 参考；生成物是否最新由前端 vitest 断言）。
        let root =
            skill_source_root(None).expect("bundled skill must resolve from CARGO_MANIFEST_DIR");
        assert!(root.join("SKILL.md").is_file());
        assert!(root.join("references/sdk-api.md").is_file());
    }
}
