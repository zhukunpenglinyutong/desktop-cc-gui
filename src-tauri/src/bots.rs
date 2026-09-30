use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Bots (智能体 v2): a long-lived assistant = identity + SOUL + AGENTS +
/// capabilities + runtime + memory config. Storage is one directory per bot
/// under `~/.ccgui-next/bots/<id>/`:
///
///   bot.json    everything except the two prose fields
///   SOUL.md     人格 (migrated from the v1 agent prompt)
///   AGENTS.md   工作规则
///
/// Files, not one blob, so a user can read and edit a bot with an editor of
/// their choice — the product promise is "Bot 只是一组配置，没有魔法".
///
/// Migration is two-step and idempotent: the v1 app's `~/.ccgui/agent.json`
/// is imported into the v1 store (`agents.json`) by `import_legacy_agents_once`
/// exactly as before, then `migrate_agents_once` turns every entry of that
/// store into a bot directory, keeps a `.bak` of the original, and records a
/// flag in the app db so a bot deleted in v2 is never resurrected.

// ---------------------------------------------------------------- model ---

/// Bot avatar. The generated ("paper") look is a BoardUI agent-avatar config:
/// one of nine fold shapes, one of sixteen expressions, and an HSL colour.
/// Only the fields a user can pick are stored — the engine fills the rest from
/// its own defaults, so adding engine fields later does not force a migration.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotAvatar {
    /// "generated" (paper avatar), "emoji", or "image".
    #[serde(rename = "type")]
    pub kind: String,
    /// emoji glyph (type=emoji) or image file name inside the bot dir.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// One of the nine paper silhouettes (slender, pocket, petal, flower,
    /// star, heart, cloud, diamond, shield).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold_shape: Option<String>,
    /// One of the sixteen expressions of the emotion wheel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eyes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hue: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saturation: Option<f64>,
    /// Custom lightness; presets leave it unset (the engine's paper default).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lightness: Option<f64>,
    // ---- legacy, read-only ----------------------------------------------
    // The first pass at this feature stored `shape` / `color` / `face`. They
    // are read so an avatar picked then still resolves (the frontend folds
    // them into the fields above) and never written back.
    #[serde(default, skip_serializing)]
    pub shape: Option<String>,
    #[serde(default, skip_serializing)]
    pub color: Option<String>,
    #[serde(default, skip_serializing)]
    pub face: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotCapabilities {
    /// Skill names enabled for this bot; `["*"]` means "every skill".
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub mcp_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotRuntime {
    /// "direct" | "claude-code" | "codex".
    pub kind: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// "ask" | "auto-safe" | "full".
    pub permission_mode: String,
}

impl Default for BotRuntime {
    fn default() -> Self {
        Self {
            kind: "direct".to_string(),
            model: None,
            cwd: None,
            extra_args: Vec::new(),
            permission_mode: "ask".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotMemoryConfig {
    pub enabled: bool,
    pub write_approval: bool,
    pub memory_char_limit: u32,
    pub review_enabled: bool,
    pub review_every_n_turns: u32,
}

impl Default for BotMemoryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            write_approval: false,
            memory_char_limit: 2200,
            review_enabled: true,
            review_every_n_turns: 5,
        }
    }
}

/// Everything except `soul` / `instructions`, which live in their own files.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BotMeta {
    id: String,
    slug: String,
    name: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    avatar: BotAvatar,
    #[serde(default)]
    capabilities: BotCapabilities,
    #[serde(default)]
    runtime: BotRuntime,
    #[serde(default)]
    memory: BotMemoryConfig,
    /// "custom" | "builtin".
    source: String,
    #[serde(default)]
    builtin_id: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    hidden: bool,
    schema_version: u32,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bot {
    pub id: String,
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub avatar: BotAvatar,
    pub soul: String,
    pub instructions: String,
    pub capabilities: BotCapabilities,
    pub runtime: BotRuntime,
    pub memory: BotMemoryConfig,
    pub source: String,
    #[serde(default)]
    pub builtin_id: Option<String>,
    pub pinned: bool,
    pub hidden: bool,
    pub schema_version: u32,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Bot {
    /// The fields a user may write. Identity (`id`), provenance and the
    /// timestamps stay under the backend's control.
    fn meta(&self) -> BotMeta {
        BotMeta {
            id: self.id.clone(),
            slug: self.slug.clone(),
            name: self.name.clone(),
            title: self.title.clone(),
            description: self.description.clone(),
            avatar: self.avatar.clone(),
            capabilities: self.capabilities.clone(),
            runtime: self.runtime.clone(),
            memory: self.memory.clone(),
            source: self.source.clone(),
            builtin_id: self.builtin_id.clone(),
            pinned: self.pinned,
            hidden: self.hidden,
            schema_version: self.schema_version,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

/// Patch payload for `bot_update`: every field optional, absent = unchanged.
/// Strings use `Some("")` to clear (normalized to `None`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub avatar: Option<BotAvatar>,
    #[serde(default)]
    pub soul: Option<String>,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub capabilities: Option<BotCapabilities>,
    #[serde(default)]
    pub runtime: Option<BotRuntime>,
    #[serde(default)]
    pub memory: Option<BotMemoryConfig>,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub hidden: Option<bool>,
}

/// Row written by `bot_create` / the migration, before prose is attached.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotCreate {
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub avatar: Option<BotAvatar>,
    #[serde(default)]
    pub soul: Option<String>,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub builtin_id: Option<String>,
}

const SCHEMA_VERSION: u32 = 1;
const MAX_NAME_CHARS: usize = 64;
const MAX_TITLE_CHARS: usize = 48;
const MAX_DESCRIPTION_CHARS: usize = 200;
const MAX_PROSE_CHARS: usize = 100_000;
const SLUG_MAX_CHARS: usize = 48;

const SOUL_FILE: &str = "SOUL.md";
const INSTRUCTIONS_FILE: &str = "AGENTS.md";
const META_FILE: &str = "bot.json";

// ----------------------------------------------------------------- paths ---

fn bots_dir() -> PathBuf {
    crate::paths::app_home().join("bots")
}

fn bot_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

/// v1 store: one JSON file holding every agent.
fn agents_file() -> PathBuf {
    crate::paths::app_home().join("agents.json")
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ------------------------------------------------------------ validation ---

fn validate_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len == 0 {
        return Err("Bot name is required".to_string());
    }
    if len > MAX_NAME_CHARS {
        return Err("Bot name must be 1-64 characters".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_optional(value: Option<String>, max: usize, what: &str) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > max {
        return Err(format!("Bot {what} must be at most {max} characters"));
    }
    Ok(Some(trimmed))
}

fn validate_prose(value: Option<String>) -> Result<String, String> {
    let Some(value) = value else {
        return Ok(String::new());
    };
    if value.chars().count() > MAX_PROSE_CHARS {
        return Err("Bot text must be less than 100,000 characters".to_string());
    }
    Ok(value)
}

/// Slug: ASCII letters/digits kept, everything else collapsed to `-`. A name
/// with no ASCII at all (e.g. pure Chinese) has no slug source here — the
/// frontend supplies a pinyin/user-edited one, and this falls back to a short
/// random suffix so the value is always usable and unique.
fn slug_base(name: &str, id: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        return format!("bot-{}", id.chars().take(6).collect::<String>());
    }
    out.chars().take(SLUG_MAX_CHARS).collect()
}

/// Slug validation for values that come from the frontend (user-edited).
fn validate_slug(slug: &str) -> Result<String, String> {
    let trimmed = slug.trim().trim_start_matches('@').to_lowercase();
    if trimmed.is_empty() {
        return Err("Bot slug is required".to_string());
    }
    if trimmed.chars().count() > SLUG_MAX_CHARS {
        return Err("Bot slug must be at most 48 characters".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Bot slug may only contain a-z, 0-9, '-' and '_'".to_string());
    }
    Ok(trimmed)
}

/// The nine paper silhouettes and sixteen expressions the engine ships. An
/// unknown value is dropped rather than rejected: a stale config from a newer
/// version degrades to the default look instead of breaking the whole bot.
const FOLD_SHAPES: [&str; 9] = [
    "slender", "pocket", "petal", "flower", "star", "heart", "cloud", "diamond", "shield",
];
const EYES: [&str; 16] = [
    "neutral", "happy", "angry", "thinking", "shook", "curious", "wink", "sleepy", "sad",
    "worried", "skeptical", "focused", "excited", "calm", "shy", "confused",
];

fn known(value: &Option<String>, allowed: &[&str]) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| allowed.contains(v))
        .map(str::to_string)
}

fn clamp_range(value: Option<f64>, min: f64, max: f64) -> Option<f64> {
    value
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(min, max))
}

fn validate_avatar(avatar: &BotAvatar) -> Result<BotAvatar, String> {
    let kind = match avatar.kind.as_str() {
        "" => "generated",
        other @ ("generated" | "emoji" | "image") => other,
        other => return Err(format!("Unknown avatar type: {other}")),
    };
    let mut out = avatar.clone();
    out.kind = kind.to_string();
    out.value = out.value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    out.fold_shape = known(&out.fold_shape, &FOLD_SHAPES);
    out.eyes = known(&out.eyes, &EYES);
    out.hue = clamp_range(out.hue, 0.0, 360.0);
    out.saturation = clamp_range(out.saturation, 0.0, 100.0);
    out.lightness = clamp_range(out.lightness, 5.0, 95.0);
    // Legacy fields are read-only: never persist them again.
    out.shape = None;
    out.color = None;
    out.face = None;
    if kind == "emoji" && out.value.is_none() {
        // An emoji avatar without a glyph would render as nothing; keep the
        // row valid by falling back to the generated look.
        out.kind = "generated".to_string();
    }
    if kind == "image" && out.value.is_none() {
        out.kind = "generated".to_string();
    }
    Ok(out)
}

fn validate_runtime(runtime: &BotRuntime) -> Result<BotRuntime, String> {
    let kind = match runtime.kind.as_str() {
        "" => "direct".to_string(),
        other @ ("direct" | "claude-code" | "codex") => other.to_string(),
        other => return Err(format!("Unknown runtime: {other}")),
    };
    let permission = match runtime.permission_mode.as_str() {
        "" => "ask".to_string(),
        other @ ("ask" | "auto-safe" | "full") => other.to_string(),
        other => return Err(format!("Unknown permission mode: {other}")),
    };
    Ok(BotRuntime {
        kind,
        model: runtime
            .model
            .clone()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        cwd: runtime
            .cwd
            .clone()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        extra_args: runtime
            .extra_args
            .iter()
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty())
            .collect(),
        permission_mode: permission,
    })
}

fn sanitize_capabilities(caps: &BotCapabilities) -> BotCapabilities {
    let clean = |values: &Vec<String>| -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for value in values {
            let trimmed = value.trim();
            if trimmed.is_empty() || out.iter().any(|v| v == trimmed) {
                continue;
            }
            out.push(trimmed.to_string());
        }
        out
    };
    BotCapabilities {
        skills: clean(&caps.skills),
        tools: clean(&caps.tools),
        mcp_servers: clean(&caps.mcp_servers),
    }
}

// ------------------------------------------------------------------ I/O ---

fn read_meta(path: &Path) -> Result<Option<BotMeta>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(None);
    }
    match serde_json::from_str::<BotMeta>(&content) {
        Ok(meta) => Ok(Some(meta)),
        Err(e) => {
            eprintln!("[bots] corrupt {}, skipping: {e}", path.display());
            Ok(None)
        }
    }
}

fn read_text(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

fn load_bot(dir: &Path) -> Result<Option<Bot>, String> {
    let Some(meta) = read_meta(&dir.join(META_FILE))? else {
        return Ok(None);
    };
    Ok(Some(Bot {
        id: meta.id,
        slug: meta.slug,
        name: meta.name,
        title: meta.title,
        description: meta.description,
        avatar: meta.avatar,
        soul: read_text(&dir.join(SOUL_FILE)),
        instructions: read_text(&dir.join(INSTRUCTIONS_FILE)),
        capabilities: meta.capabilities,
        runtime: meta.runtime,
        memory: meta.memory,
        source: meta.source,
        builtin_id: meta.builtin_id,
        pinned: meta.pinned,
        hidden: meta.hidden,
        schema_version: meta.schema_version,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
    }))
}

fn write_bot(root: &Path, bot: &Bot) -> Result<(), String> {
    let dir = bot_dir(root, &bot.id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let meta = serde_json::to_string_pretty(&bot.meta())
        .map_err(|e| format!("Failed to serialize bot: {e}"))?;
    std::fs::write(dir.join(META_FILE), format!("{meta}\n"))
        .map_err(|e| format!("Failed to write {META_FILE}: {e}"))?;
    // Prose files are always written, even when empty: an empty SOUL.md is a
    // legible "nothing here yet" for someone browsing the folder.
    std::fs::write(dir.join(SOUL_FILE), &bot.soul)
        .map_err(|e| format!("Failed to write {SOUL_FILE}: {e}"))?;
    std::fs::write(dir.join(INSTRUCTIONS_FILE), &bot.instructions)
        .map_err(|e| format!("Failed to write {INSTRUCTIONS_FILE}: {e}"))?;
    Ok(())
}

fn list_bots_in(root: &Path) -> Result<Vec<Bot>, String> {
    let mut bots = Vec::new();
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(bots),
        Err(e) => return Err(format!("Failed to read {}: {e}", root.display())),
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        match load_bot(&dir) {
            Ok(Some(bot)) => bots.push(bot),
            // A half-written directory (crash mid-create) is skipped rather
            // than failing the whole list: the picker degrades, it doesn't die.
            Ok(None) => {}
            Err(e) => eprintln!("[bots] {}: {e}", dir.display()),
        }
    }
    // Pinned first, then most recently updated — the order the list and the
    // `#` picker both show.
    bots.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(b.updated_at.cmp(&a.updated_at))
            .then(a.name.cmp(&b.name))
    });
    Ok(bots)
}

fn unique_slug(root: &Path, wanted: &str, ignore_id: Option<&str>) -> Result<String, String> {
    let taken: Vec<String> = list_bots_in(root)?
        .into_iter()
        .filter(|b| Some(b.id.as_str()) != ignore_id)
        .map(|b| b.slug)
        .collect();
    if !taken.iter().any(|s| s == wanted) {
        return Ok(wanted.to_string());
    }
    for n in 2..10_000 {
        let candidate = format!("{wanted}-{n}");
        if !taken.iter().any(|s| s == &candidate) {
            return Ok(candidate);
        }
    }
    Err("Could not find a free bot slug".to_string())
}

// ------------------------------------------------------------------ CRUD ---

fn new_bot(id: String, slug: String, input: BotCreate) -> Result<Bot, String> {
    let name = validate_name(&input.name)?;
    let now = now_millis();
    Ok(Bot {
        id,
        slug,
        name,
        title: validate_optional(input.title, MAX_TITLE_CHARS, "title")?,
        description: validate_optional(input.description, MAX_DESCRIPTION_CHARS, "description")?,
        avatar: validate_avatar(&input.avatar.unwrap_or_default())?,
        soul: validate_prose(input.soul)?,
        instructions: validate_prose(input.instructions)?,
        capabilities: BotCapabilities::default(),
        runtime: BotRuntime::default(),
        memory: BotMemoryConfig::default(),
        source: match input.source.as_deref() {
            Some("builtin") => "builtin".to_string(),
            _ => "custom".to_string(),
        },
        builtin_id: input.builtin_id,
        pinned: false,
        hidden: false,
        schema_version: SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
    })
}

fn bot_list_blocking() -> Result<Vec<Bot>, String> {
    list_bots_in(&bots_dir())
}

fn bot_create_blocking(input: BotCreate) -> Result<Bot, String> {
    let root = bots_dir();
    let id = uuid::Uuid::new_v4().to_string();
    let base = match input.slug.as_deref() {
        Some(slug) if !slug.trim().is_empty() => validate_slug(slug)?,
        _ => slug_base(&input.name, &id),
    };
    let slug = unique_slug(&root, &base, None)?;
    let bot = new_bot(id, slug, input)?;
    write_bot(&root, &bot)?;
    Ok(bot)
}

fn bot_update_blocking(id: String, patch: BotPatch) -> Result<Option<Bot>, String> {
    let root = bots_dir();
    let dir = bot_dir(&root, &id);
    let Some(mut bot) = load_bot(&dir)? else {
        return Ok(None);
    };
    if let Some(name) = patch.name {
        bot.name = validate_name(&name)?;
    }
    if let Some(slug) = patch.slug {
        let wanted = validate_slug(&slug)?;
        bot.slug = unique_slug(&root, &wanted, Some(&id))?;
    }
    if let Some(title) = patch.title {
        bot.title = validate_optional(Some(title), MAX_TITLE_CHARS, "title")?;
    }
    if let Some(description) = patch.description {
        bot.description =
            validate_optional(Some(description), MAX_DESCRIPTION_CHARS, "description")?;
    }
    if let Some(avatar) = patch.avatar {
        bot.avatar = validate_avatar(&avatar)?;
    }
    if let Some(soul) = patch.soul {
        bot.soul = validate_prose(Some(soul))?;
    }
    if let Some(instructions) = patch.instructions {
        bot.instructions = validate_prose(Some(instructions))?;
    }
    if let Some(capabilities) = patch.capabilities {
        bot.capabilities = sanitize_capabilities(&capabilities);
    }
    if let Some(runtime) = patch.runtime {
        bot.runtime = validate_runtime(&runtime)?;
    }
    if let Some(memory) = patch.memory {
        bot.memory = BotMemoryConfig {
            enabled: memory.enabled,
            write_approval: memory.write_approval,
            memory_char_limit: memory.memory_char_limit.clamp(200, 20_000),
            review_enabled: memory.review_enabled,
            review_every_n_turns: memory.review_every_n_turns.clamp(1, 100),
        };
    }
    if let Some(pinned) = patch.pinned {
        bot.pinned = pinned;
    }
    if let Some(hidden) = patch.hidden {
        bot.hidden = hidden;
    }
    bot.updated_at = now_millis();
    write_bot(&root, &bot)?;
    Ok(Some(bot))
}

/// 一个 Bot 的 MEMORY 字数上限（memory.rs 的写入闸与注入用量共用）。Bot 已删
/// 或配置损坏时返回 None，调用方退回默认值——在跑的会话不该因为用户删了
/// Bot 而让记忆工具突然失效。
pub(crate) fn memory_char_limit(id: &str) -> Option<usize> {
    let bot = load_bot(&bot_dir(&bots_dir(), id)).ok().flatten()?;
    Some(bot.memory.memory_char_limit as usize).filter(|limit| *limit > 0)
}

/// 这个 Bot 是否要求记忆写入先审批（memory/pending.rs 的写入闸）。Bot 已删
/// 或配置读不到时按默认（不审批）处理：会话还在跑，工具不该因为主人删了 Bot
/// 变得不可用；面板手动写入本来就不走审批。
pub(crate) fn memory_write_approval(id: &str) -> bool {
    load_bot(&bot_dir(&bots_dir(), id))
        .ok()
        .flatten()
        .is_some_and(|bot| bot.memory.write_approval)
}

/// 这个 Bot 是否参与后台复盘（记忆开着、复盘也开着）。前端按它决定要不要
/// 发起 `memory_review`，命令层再查一次（界面可能拿着过期配置）。Bot 已删时
/// false。
pub(crate) fn memory_review_enabled(id: &str) -> bool {
    load_bot(&bot_dir(&bots_dir(), id))
        .ok()
        .flatten()
        .is_some_and(|bot| bot.memory.enabled && bot.memory.review_enabled)
}

fn bot_delete_blocking(id: String) -> Result<bool, String> {
    let root = bots_dir();
    let dir = bot_dir(&root, &id);
    if !dir.is_dir() {
        return Ok(false);
    }
    // The folder holds user prose; move it to the OS trash instead of
    // unlinking so a mis-click is recoverable.
    match trash::delete(&dir) {
        Ok(()) => Ok(true),
        Err(e) => {
            eprintln!("[bots] trash {} failed ({e}); removing permanently", dir.display());
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("Failed to delete {}: {e}", dir.display()))?;
            Ok(true)
        }
    }
}

/// Copy a bot (custom or built-in) into a new custom row. Skills / runtime /
/// memory come along; provenance does not (the copy is the user's).
fn bot_duplicate_blocking(id: String) -> Result<Option<Bot>, String> {
    let root = bots_dir();
    let Some(source) = load_bot(&bot_dir(&root, &id))? else {
        return Ok(None);
    };
    let new_id = uuid::Uuid::new_v4().to_string();
    let name = format!("{} 副本", source.name);
    let name = name.chars().take(MAX_NAME_CHARS).collect::<String>();
    let slug = unique_slug(&root, &slug_base(&name, &new_id), None)?;
    let now = now_millis();
    let bot = Bot {
        id: new_id,
        slug,
        name,
        title: source.title.clone(),
        description: source.description.clone(),
        avatar: source.avatar.clone(),
        soul: source.soul.clone(),
        instructions: source.instructions.clone(),
        capabilities: source.capabilities.clone(),
        runtime: source.runtime.clone(),
        memory: source.memory.clone(),
        source: "custom".to_string(),
        builtin_id: None,
        pinned: false,
        hidden: false,
        schema_version: SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
    };
    write_bot(&root, &bot)?;
    Ok(Some(bot))
}

// -------------------------------------------------------------- migration ---

/// v1 store shape (`agents.json`): a flat list of {id, name, prompt, icon}.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LegacyAgent {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    created_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentStoreV1 {
    #[serde(default)]
    agents: Vec<LegacyAgent>,
}

/// v1 icon → avatar. Emoji glyphs become an emoji avatar; the legacy ASCII
/// preset ids (`agent-robot-06`) belong to a set this app never had, so they
/// fall back to a generated avatar with a deterministic shape/color derived
/// from the id — every migrated bot still looks distinct.
fn avatar_from_icon(icon: Option<String>, seed: &str) -> BotAvatar {
    let icon = icon
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(value) = icon {
        if !value.is_ascii() {
            return BotAvatar {
                kind: "emoji".to_string(),
                value: Some(value),
                ..Default::default()
            };
        }
    }
    // Legacy ASCII preset id: a deterministic paper avatar, so a migrated
    // catalog still looks like a set of distinct characters. Shape, hue and
    // expression all come from the id — same id, same look, every launch.
    const HUES: [f64; 9] = [220.0, 181.0, 259.0, 321.0, 0.0, 31.0, 193.0, 78.0, 145.0];
    const SATS: [f64; 9] = [85.0, 49.0, 75.0, 74.0, 78.0, 89.0, 78.0, 72.0, 51.0];
    let eyes = ["neutral", "happy", "curious", "focused", "calm", "thinking"];
    let hash = seed.bytes().fold(7u64, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u64));
    let pick = (hash % 9) as usize;
    BotAvatar {
        kind: "generated".to_string(),
        value: None,
        fold_shape: Some(FOLD_SHAPES[pick].to_string()),
        eyes: Some(eyes[((hash / 13) % eyes.len() as u64) as usize].to_string()),
        hue: Some(HUES[pick]),
        saturation: Some(SATS[pick]),
        lightness: None,
        ..Default::default()
    }
}

/// Turn the v1 `agents.json` into bot directories. Idempotent in three ways:
/// a db flag (never re-run), a per-id "already exists" check, and a rename of
/// the source file to `.bak` so a second run has nothing to read. Returns the
/// number of bots created.
fn migrate_agents_from(db: &crate::db::Db, source: &Path, root: &Path) -> Result<usize, String> {
    const FLAG: &str = "agents_to_bots_migration_v1";
    {
        let conn = db.0.lock();
        let done = conn
            .query_row("SELECT value FROM meta WHERE key=?1", [FLAG], |r| {
                r.get::<_, String>(0)
            })
            .ok();
        if done.is_some() {
            return Ok(0);
        }
    }

    let mut created = 0usize;
    if source.is_file() {
        // Keep the original bytes: the migration must never be the reason a
        // user loses data, even if the new store turns out to be unreadable.
        let backup = source.with_extension("json.migrated.bak");
        if !backup.exists() {
            std::fs::copy(source, &backup)
                .map_err(|e| format!("Failed to back up {}: {e}", source.display()))?;
        }
        let content = std::fs::read_to_string(source)
            .map_err(|e| format!("Failed to read {}: {e}", source.display()))?;
        match serde_json::from_str::<AgentStoreV1>(&content) {
            Ok(store) => {
                for agent in store.agents {
                    let Ok(name) = validate_name(&agent.name) else {
                        eprintln!("[bots] skipping migration of blank-named agent {}", agent.id);
                        continue;
                    };
                    // Legacy ids are uuids; a blank id still gets a row (the
                    // name is the part the user recognizes).
                    let id = if agent.id.trim().is_empty() {
                        uuid::Uuid::new_v4().to_string()
                    } else {
                        agent.id.trim().to_string()
                    };
                    if bot_dir(root, &id).is_dir() {
                        continue;
                    }
                    let slug = unique_slug(root, &slug_base(&name, &id), None)?;
                    let created_at = agent.created_at.unwrap_or_else(now_millis);
                    let avatar = avatar_from_icon(agent.icon, &id);
                    let bot = Bot {
                        id,
                        slug,
                        name,
                        title: None,
                        description: None,
                        avatar,
                        // v1's single prompt is the bot's 人格 (default
                        // decision in the plan: prompt → SOUL).
                        soul: agent.prompt.unwrap_or_default().trim().to_string(),
                        instructions: String::new(),
                        capabilities: BotCapabilities::default(),
                        runtime: BotRuntime::default(),
                        memory: BotMemoryConfig::default(),
                        source: "custom".to_string(),
                        builtin_id: None,
                        pinned: false,
                        hidden: false,
                        schema_version: SCHEMA_VERSION,
                        created_at,
                        updated_at: created_at,
                    };
                    write_bot(root, &bot)?;
                    created += 1;
                }
            }
            Err(e) => {
                // A corrupt v1 store must not block startup; the backup is
                // already on disk for hand repair.
                eprintln!("[bots] cannot parse {}: {e}", source.display());
            }
        }
        // Retire the v1 file so nothing re-reads it, flag or no flag.
        let retired = source.with_extension("json.v1");
        if let Err(e) = std::fs::rename(source, &retired) {
            eprintln!("[bots] could not retire {}: {e}", source.display());
        }
    }

    let conn = db.0.lock();
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?1, '1')",
        [FLAG],
    )
    .map_err(|e| e.to_string())?;
    Ok(created)
}

pub fn migrate_agents_once(db: &crate::db::Db) -> Result<usize, String> {
    migrate_agents_from(db, &agents_file(), &bots_dir())
}

// -------------------------------------------------- legacy app import ---

/// Legacy desktop-cc-gui agent file (`~/.ccgui/agent.json`): a HashMap keyed
/// by id plus a `selectedAgentId` this app keeps frontend-side.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAppAgent {
    #[serde(default)]
    id: String,
    name: String,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    created_at: Option<i64>,
}

#[derive(Deserialize)]
struct LegacyAppAgentFile {
    #[serde(default)]
    agents: std::collections::HashMap<String, LegacyAppAgent>,
}

/// One-time import of the *old app's* catalog straight into bots (merge
/// semantics: an id already present is never overwritten, a deleted bot is
/// never resurrected because the flag is set on the first run).
pub fn import_legacy_app_agents_once(db: &crate::db::Db) -> Result<(), String> {
    import_legacy_app_agents_from(db, &crate::paths::legacy_agents_path(), &bots_dir())
}

fn import_legacy_app_agents_from(
    db: &crate::db::Db,
    legacy_path: &Path,
    root: &Path,
) -> Result<(), String> {
    const FLAG: &str = "legacy_agents_import_v1";
    {
        let conn = db.0.lock();
        let done = conn
            .query_row("SELECT value FROM meta WHERE key=?1", [FLAG], |r| {
                r.get::<_, String>(0)
            })
            .ok();
        if done.is_some() {
            return Ok(());
        }
    }

    if legacy_path.is_file() {
        let content = std::fs::read_to_string(legacy_path)
            .map_err(|e| format!("read {}: {e}", legacy_path.display()))?;
        let legacy: LegacyAppAgentFile = serde_json::from_str(&content)
            .map_err(|e| format!("parse {}: {e}", legacy_path.display()))?;
        for (key, agent) in legacy.agents {
            let id = if agent.id.trim().is_empty() {
                key
            } else {
                agent.id.trim().to_string()
            };
            let Ok(name) = validate_name(&agent.name) else {
                eprintln!("[bots] skipping invalid legacy agent {id}");
                continue;
            };
            if bot_dir(root, &id).is_dir() {
                continue;
            }
            let slug = unique_slug(root, &slug_base(&name, &id), None)?;
            let created_at = agent
                .created_at
                .and_then(|v| u64::try_from(v).ok())
                .unwrap_or_else(now_millis);
            let bot = Bot {
                id,
                slug,
                name,
                title: None,
                description: None,
                avatar: avatar_from_icon(agent.icon, "legacy"),
                soul: agent.prompt.unwrap_or_default().trim().to_string(),
                instructions: String::new(),
                capabilities: BotCapabilities::default(),
                runtime: BotRuntime::default(),
                memory: BotMemoryConfig::default(),
                source: "custom".to_string(),
                builtin_id: None,
                pinned: false,
                hidden: false,
                schema_version: SCHEMA_VERSION,
                created_at,
                updated_at: created_at,
            };
            write_bot(root, &bot)?;
        }
    }

    let conn = db.0.lock();
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?1, '1')",
        [FLAG],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// -------------------------------------------------------------- commands ---

#[tauri::command]
pub async fn bot_list() -> Result<Vec<Bot>, String> {
    tauri::async_runtime::spawn_blocking(bot_list_blocking)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn bot_create(input: BotCreate) -> Result<Bot, String> {
    tauri::async_runtime::spawn_blocking(move || bot_create_blocking(input))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn bot_update(id: String, patch: BotPatch) -> Result<Option<Bot>, String> {
    tauri::async_runtime::spawn_blocking(move || bot_update_blocking(id, patch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn bot_delete(
    db: tauri::State<'_, std::sync::Arc<crate::db::Db>>,
    id: String,
) -> Result<bool, String> {
    let deleted = tauri::async_runtime::spawn_blocking({
        let id = id.clone();
        move || bot_delete_blocking(id)
    })
    .await
    .map_err(|e| e.to_string())??;
    // The folder is already in the trash; a failed cleanup must not turn that
    // into an error. Without this the bot's MEMORY rows would outlive every
    // entry point that could show or delete them (USER is global, untouched).
    if deleted {
        if let Err(error) = crate::memory::forget_bot(&db, &id) {
            eprintln!("[memory] forget_bot({id}) failed: {}", error.message);
        }
    }
    Ok(deleted)
}

#[tauri::command]
pub async fn bot_duplicate(id: String) -> Result<Option<Bot>, String> {
    tauri::async_runtime::spawn_blocking(move || bot_duplicate_blocking(id))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // Tests steer paths::home_dir through HOME (its cfg(test) branch), which
    // is process-global — every HOME-mutating test shares the crate-wide lock.
    struct ScratchHome {
        dir: PathBuf,
        previous: Option<std::ffi::OsString>,
        _guard: parking_lot::MutexGuard<'static, ()>,
    }

    impl ScratchHome {
        fn new(name: &str) -> Self {
            let guard = crate::paths::HOME_ENV_LOCK.lock();
            let dir =
                std::env::temp_dir().join(format!("ccgui-bots-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            let previous = std::env::var_os("HOME");
            std::env::set_var("HOME", &dir);
            Self {
                dir,
                previous,
                _guard: guard,
            }
        }
    }

    impl Drop for ScratchHome {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    /// Scratch dir for migration tests (explicit paths — no HOME steering).
    struct ScratchDir(PathBuf);
    impl ScratchDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("ccgui-bots-migrate-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn create(name: &str) -> Bot {
        bot_create_blocking(BotCreate {
            name: name.to_string(),
            ..Default::default()
        })
        .unwrap()
    }

    #[test]
    fn empty_store_lists_nothing() {
        let _home = ScratchHome::new("empty");
        assert!(bot_list_blocking().unwrap().is_empty());
    }

    #[test]
    fn create_writes_three_files_and_round_trips() {
        let _home = ScratchHome::new("roundtrip");
        let bot = bot_create_blocking(BotCreate {
            name: "  太奶  ".to_string(),
            title: Some("耐心的讲解员".to_string()),
            description: Some("先讲结论".to_string()),
            avatar: Some(BotAvatar {
                kind: "emoji".to_string(),
                value: Some("🦊".to_string()),
                ..Default::default()
            }),
            soul: Some("你是太奶。".to_string()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(bot.name, "太奶");
        assert_eq!(bot.soul, "你是太奶。");
        assert_eq!(bot.instructions, "");
        assert_eq!(bot.schema_version, 1);
        assert_eq!(bot.source, "custom");

        let dir = bot_dir(&bots_dir(), &bot.id);
        assert!(dir.join("bot.json").is_file());
        assert!(dir.join("SOUL.md").is_file());
        assert!(dir.join("AGENTS.md").is_file());
        assert_eq!(fs::read_to_string(dir.join("SOUL.md")).unwrap(), "你是太奶。");

        let list = bot_list_blocking().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, bot.id);
        assert_eq!(list[0].title.as_deref(), Some("耐心的讲解员"));
        assert_eq!(list[0].avatar.kind, "emoji");
        assert_eq!(list[0].avatar.value.as_deref(), Some("🦊"));
    }

    #[test]
    fn update_is_partial_and_timestamped() {
        let _home = ScratchHome::new("update");
        let bot = create("太奶");
        let updated = bot_update_blocking(
            bot.id.clone(),
            BotPatch {
                title: Some("讲解员".to_string()),
                soul: Some("新的人格".to_string()),
                pinned: Some(true),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.title.as_deref(), Some("讲解员"));
        assert_eq!(updated.soul, "新的人格");
        assert_eq!(updated.name, "太奶", "absent fields stay untouched");
        assert!(updated.pinned);
        assert!(updated.updated_at >= bot.updated_at);

        // Some("") clears an optional field.
        let cleared = bot_update_blocking(
            bot.id.clone(),
            BotPatch {
                title: Some("".to_string()),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(cleared.title, None);

        // Unknown id: None, not an error.
        assert!(bot_update_blocking("missing".to_string(), BotPatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn delete_removes_the_row() {
        let _home = ScratchHome::new("delete");
        let bot = create("临时");
        assert!(bot_delete_blocking(bot.id.clone()).unwrap());
        assert!(bot_list_blocking().unwrap().is_empty());
        assert!(!bot_delete_blocking(bot.id.clone()).unwrap());
    }

    #[test]
    fn duplicate_copies_content_but_not_provenance() {
        let _home = ScratchHome::new("duplicate");
        let bot = bot_create_blocking(BotCreate {
            name: "内置架构师".to_string(),
            soul: Some("从边界条件开始".to_string()),
            source: Some("builtin".to_string()),
            builtin_id: Some("architect".to_string()),
            ..Default::default()
        })
        .unwrap();
        let copy = bot_duplicate_blocking(bot.id.clone()).unwrap().unwrap();
        assert_ne!(copy.id, bot.id);
        assert_eq!(copy.name, "内置架构师 副本");
        assert_eq!(copy.soul, "从边界条件开始");
        assert_eq!(copy.source, "custom");
        assert_eq!(copy.builtin_id, None);
        assert_eq!(bot_list_blocking().unwrap().len(), 2);
        assert!(bot_duplicate_blocking("missing".to_string()).unwrap().is_none());
    }

    #[test]
    fn slugs_are_unique_and_survive_non_ascii_names() {
        let _home = ScratchHome::new("slug");
        let first = create("Code Reviewer");
        let second = create("Code Reviewer");
        assert_eq!(first.slug, "code-reviewer");
        assert_eq!(second.slug, "code-reviewer-2");

        // A pure-Chinese name has no ASCII source: the slug falls back to an
        // id-derived placeholder rather than being empty.
        let third = create("太奶");
        assert!(third.slug.starts_with("bot-"), "got {}", third.slug);

        // An explicit slug wins, and stays unique.
        let fourth = bot_create_blocking(BotCreate {
            name: "数据侦探".to_string(),
            slug: Some("Tan-Tai".to_string()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(fourth.slug, "tan-tai");
        let fifth = bot_create_blocking(BotCreate {
            name: "数据侦探".to_string(),
            slug: Some("tan-tai".to_string()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(fifth.slug, "tan-tai-2");

        assert!(bot_create_blocking(BotCreate {
            name: "bad slug".to_string(),
            slug: Some("有中文".to_string()),
            ..Default::default()
        })
        .is_err());
    }

    #[test]
    fn validation_limits() {
        let _home = ScratchHome::new("validate");
        assert!(bot_create_blocking(BotCreate::default()).is_err());
        assert!(bot_create_blocking(BotCreate {
            name: "a".repeat(MAX_NAME_CHARS + 1),
            ..Default::default()
        })
        .is_err());
        assert!(bot_create_blocking(BotCreate {
            name: "ok".to_string(),
            soul: Some("p".repeat(MAX_PROSE_CHARS + 1)),
            ..Default::default()
        })
        .is_err());
        // Over-long optionals are errors, not silent truncation.
        let bot = create("ok");
        assert!(bot_update_blocking(
            bot.id.clone(),
            BotPatch {
                description: Some("d".repeat(MAX_DESCRIPTION_CHARS + 1)),
                ..Default::default()
            }
        )
        .is_err());
    }

    #[test]
    fn avatar_and_runtime_normalize() {
        let _home = ScratchHome::new("normalize");
        // An emoji avatar with no glyph degrades to generated instead of
        // producing a row the UI cannot render.
        let bot = bot_create_blocking(BotCreate {
            name: "无图".to_string(),
            avatar: Some(BotAvatar {
                kind: "emoji".to_string(),
                value: Some("   ".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(bot.avatar.kind, "generated");

        // Unknown enum values are rejected loudly.
        assert!(bot_create_blocking(BotCreate {
            name: "坏运行时".to_string(),
            ..Default::default()
        })
        .is_ok());
        let bad = bot_update_blocking(
            bot.id.clone(),
            BotPatch {
                runtime: Some(BotRuntime {
                    kind: "magic".to_string(),
                    permission_mode: "ask".to_string(),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );
        assert!(bad.is_err());

        // Capability lists are deduped and trimmed.
        let caps = sanitize_capabilities(&BotCapabilities {
            skills: vec![" a ".to_string(), "a".to_string(), "".to_string(), "b".to_string()],
            tools: vec![],
            mcp_servers: vec![],
        });
        assert_eq!(caps.skills, vec!["a".to_string(), "b".to_string()]);

        // Memory limits are clamped to a usable window.
        let clamped = bot_update_blocking(
            bot.id.clone(),
            BotPatch {
                memory: Some(BotMemoryConfig {
                    enabled: true,
                    write_approval: false,
                    memory_char_limit: 1,
                    review_enabled: true,
                    review_every_n_turns: 0,
                }),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(clamped.memory.memory_char_limit, 200);
        assert_eq!(clamped.memory.review_every_n_turns, 1);
    }

    #[test]
    fn generated_avatar_keeps_the_paper_fields_and_drops_junk() {
        let _home = ScratchHome::new("avatar-fields");
        let bot = bot_create_blocking(BotCreate {
            name: "纸片".to_string(),
            avatar: Some(BotAvatar {
                kind: "generated".to_string(),
                fold_shape: Some("star".to_string()),
                eyes: Some("curious".to_string()),
                hue: Some(321.0),
                saturation: Some(74.0),
                ..Default::default()
            }),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(bot.avatar.fold_shape.as_deref(), Some("star"));
        assert_eq!(bot.avatar.eyes.as_deref(), Some("curious"));
        assert_eq!(bot.avatar.hue, Some(321.0));

        // A shape / expression this build does not know is dropped, and the
        // colour is clamped — a stale config degrades, it never fails.
        let patched = bot_update_blocking(
            bot.id.clone(),
            BotPatch {
                avatar: Some(BotAvatar {
                    kind: "generated".to_string(),
                    fold_shape: Some("hexagon".to_string()),
                    eyes: Some("smug".to_string()),
                    hue: Some(900.0),
                    saturation: Some(-20.0),
                    lightness: Some(2.0),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(patched.avatar.fold_shape, None);
        assert_eq!(patched.avatar.eyes, None);
        assert_eq!(patched.avatar.hue, Some(360.0));
        assert_eq!(patched.avatar.saturation, Some(0.0));
        assert_eq!(patched.avatar.lightness, Some(5.0));
    }

    #[test]
    fn legacy_avatar_fields_are_read_but_never_rewritten() {
        let _home = ScratchHome::new("avatar-legacy");
        let root = bots_dir();
        std::fs::create_dir_all(bot_dir(&root, "old")).unwrap();
        std::fs::write(
            bot_dir(&root, "old").join("bot.json"),
            r##"{"id":"old","slug":"old","name":"旧的","avatar":{"type":"generated","shape":"heart","color":"#ff0000","face":"smile"},"source":"custom","schemaVersion":1,"createdAt":1,"updatedAt":1}"##,
        )
        .unwrap();
        let bot = load_bot(&bot_dir(&root, "old")).unwrap().unwrap();
        assert_eq!(bot.avatar.shape.as_deref(), Some("heart"));
        assert_eq!(bot.avatar.color.as_deref(), Some("#ff0000"));

        // Touching anything else rewrites the file without the legacy keys,
        // and the frontend has folded them into the new fields by then.
        let updated = bot_update_blocking(
            "old".to_string(),
            BotPatch {
                avatar: Some(BotAvatar {
                    kind: "generated".to_string(),
                    fold_shape: Some("heart".to_string()),
                    eyes: Some("happy".to_string()),
                    hue: Some(0.0),
                    saturation: Some(100.0),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.avatar.shape, None);
        let raw = std::fs::read_to_string(bot_dir(&root, "old").join("bot.json")).unwrap();
        assert!(!raw.contains("\"shape\""), "legacy keys must not be written: {raw}");
        assert!(raw.contains("foldShape"));
    }

    #[test]
    fn corrupt_meta_is_skipped_not_fatal() {
        let _home = ScratchHome::new("corrupt");
        let bot = create("好的");
        let broken = bot_dir(&bots_dir(), "broken");
        fs::create_dir_all(&broken).unwrap();
        fs::write(broken.join("bot.json"), "{not json").unwrap();
        let list = bot_list_blocking().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, bot.id);
    }

    #[test]
    fn pinned_sorts_first() {
        let _home = ScratchHome::new("order");
        let first = create("甲");
        let second = create("乙");
        // Same-millisecond timestamps would make the fallback order (name)
        // decide; pinning is what we are asserting.
        bot_update_blocking(
            second.id.clone(),
            BotPatch {
                pinned: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let list = bot_list_blocking().unwrap();
        assert_eq!(list[0].id, second.id);
        assert_eq!(list[1].id, first.id);
    }

    // ---- migration ----

    #[test]
    fn migration_turns_v1_agents_into_bots_and_keeps_a_backup() {
        let scratch = ScratchDir::new("basic");
        let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        let source = scratch.path("agents.json");
        fs::write(
            &source,
            r#"{"agents":[
                {"id":"a1","name":"代码审查","prompt":"审查 diff","icon":"🤖","createdAt":1789652018569},
                {"id":"a2","name":"旧图标","icon":"agent-robot-06","createdAt":2},
                {"id":"","name":"无名 id","prompt":null},
                {"id":"a4","name":"   "}
            ]}"#,
        )
        .unwrap();
        let root = scratch.path("bots");

        let created = migrate_agents_from(&db, &source, &root).unwrap();
        assert_eq!(created, 3, "the blank-name entry is skipped");
        let bots = list_bots_in(&root).unwrap();
        assert_eq!(bots.len(), 3);

        let a1 = bots.iter().find(|b| b.id == "a1").unwrap();
        assert_eq!(a1.name, "代码审查");
        assert_eq!(a1.soul, "审查 diff", "the v1 prompt becomes SOUL");
        assert_eq!(a1.instructions, "");
        assert_eq!(a1.created_at, 1789652018569);
        assert_eq!(a1.avatar.kind, "emoji");
        assert_eq!(a1.avatar.value.as_deref(), Some("🤖"));

        // A legacy preset icon id is NOT inlined into the avatar: it becomes
        // a deterministic generated avatar instead.
        let a2 = bots.iter().find(|b| b.id == "a2").unwrap();
        assert_eq!(a2.avatar.kind, "generated");
        assert!(a2.avatar.fold_shape.is_some() && a2.avatar.hue.is_some());
        assert_eq!(a2.avatar.color, None, "legacy fields are never written back");

        // The original file is retired and a byte-identical backup remains.
        assert!(!source.is_file());
        assert!(scratch.path("agents.json.v1").is_file());
        assert_eq!(
            fs::read_to_string(scratch.path("agents.json.migrated.bak")).unwrap(),
            r#"{"agents":[
                {"id":"a1","name":"代码审查","prompt":"审查 diff","icon":"🤖","createdAt":1789652018569},
                {"id":"a2","name":"旧图标","icon":"agent-robot-06","createdAt":2},
                {"id":"","name":"无名 id","prompt":null},
                {"id":"a4","name":"   "}
            ]}"#
        );
    }

    #[test]
    fn migration_is_idempotent_and_never_resurrects_deleted_bots() {
        let scratch = ScratchDir::new("idempotent");
        let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        let source = scratch.path("agents.json");
        fs::write(
            &source,
            r#"{"agents":[{"id":"a1","name":"一","prompt":"p1"}]}"#,
        )
        .unwrap();
        let root = scratch.path("bots");
        assert_eq!(migrate_agents_from(&db, &source, &root).unwrap(), 1);

        // Second run: flag is set, nothing happens.
        assert_eq!(migrate_agents_from(&db, &source, &root).unwrap(), 0);
        assert_eq!(list_bots_in(&root).unwrap().len(), 1);

        // Even if the v1 file comes back, a bot the user deleted stays gone.
        fs::remove_dir_all(bot_dir(&root, "a1")).unwrap();
        fs::write(&source, r#"{"agents":[{"id":"a1","name":"一"}]}"#).unwrap();
        let db2 = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        assert_eq!(migrate_agents_from(&db2, &source, &root).unwrap(), 0);
        assert!(list_bots_in(&root).unwrap().is_empty());
    }

    #[test]
    fn migration_without_v1_file_only_sets_the_flag() {
        let scratch = ScratchDir::new("nov1");
        let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        let root = scratch.path("bots");
        assert_eq!(
            migrate_agents_from(&db, &scratch.path("missing.json"), &root).unwrap(),
            0
        );
        assert!(!root.exists());
        let conn = db.0.lock();
        let flag: String = conn
            .query_row(
                "SELECT value FROM meta WHERE key='agents_to_bots_migration_v1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(flag, "1");
    }

    #[test]
    fn legacy_app_import_merges_and_never_overwrites() {
        let scratch = ScratchDir::new("legacy");
        let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        let legacy = scratch.path("agent.json");
        fs::write(
            &legacy,
            r#"{
                "selectedAgentId": "a1",
                "agents": {
                    "a0": {"id": "a0", "name": "旧名字"},
                    "a1": {"id": "a1", "name": "审查", "prompt": "看 diff", "createdAt": 1789652018569, "icon": "agent-robot-06"},
                    "a2": {"id": "", "name": "emoji", "icon": "🤖", "createdAt": 2},
                    "a3": {"id": "a3", "name": "   "}
                }
            }"#,
        )
        .unwrap();
        let root = scratch.path("bots");
        // A bot already created in the new app keeps its own data.
        let existing = Bot {
            id: "a0".to_string(),
            slug: "existing".to_string(),
            name: "已有".to_string(),
            title: None,
            description: None,
            avatar: BotAvatar::default(),
            soul: "保留".to_string(),
            instructions: String::new(),
            capabilities: BotCapabilities::default(),
            runtime: BotRuntime::default(),
            memory: BotMemoryConfig::default(),
            source: "custom".to_string(),
            builtin_id: None,
            pinned: false,
            hidden: false,
            schema_version: 1,
            created_at: 9,
            updated_at: 9,
        };
        write_bot(&root, &existing).unwrap();

        import_legacy_app_agents_from(&db, &legacy, &root).unwrap();
        let bots = list_bots_in(&root).unwrap();
        assert_eq!(bots.len(), 3, "a0 kept, a1/a2 imported, blank-name a3 skipped");

        let a0 = bots.iter().find(|b| b.id == "a0").unwrap();
        assert_eq!(a0.name, "已有", "an existing id is never overwritten");
        assert_eq!(a0.soul, "保留");

        let a1 = bots.iter().find(|b| b.id == "a1").unwrap();
        assert_eq!(a1.soul, "看 diff");
        assert_eq!(a1.created_at, 1789652018569);

        let a2 = bots.iter().find(|b| b.id == "a2").unwrap();
        assert_eq!(a2.avatar.kind, "emoji");
        assert_eq!(a2.avatar.value.as_deref(), Some("🤖"));

        // Flag set: a later deletion is not resurrected. (The delete goes
        // through the filesystem directly: the test drives explicit paths,
        // while bot_delete_blocking resolves the process-global bots dir.)
        fs::remove_dir_all(bot_dir(&root, &a2.id)).unwrap();
        fs::write(&legacy, r#"{"agents": {"a9": {"id": "a9", "name": "九"}}}"#).unwrap();
        import_legacy_app_agents_from(&db, &legacy, &root).unwrap();
        assert_eq!(list_bots_in(&root).unwrap().len(), 2);
    }
}
