import i18n from "i18next";

/** Git 打开仓库失败的分类前缀 → i18n key。后端按错误类型分流
 * （`map_open_repo_error`），所有权问题与「不是仓库」不再混报。 */
const GIT_ERROR_PREFIXES: [prefix: string, key: string][] = [
  ["GIT_UNSAFE_REPO:", "git.unsafeRepo"],
  ["GIT_OPEN_FAILED:", "git.openFailed"],
];

function gitErrorText(text: string): string | null {
  for (const [prefix, key] of GIT_ERROR_PREFIXES) {
    if (!text.startsWith(prefix)) continue;
    const detail = text.slice(prefix.length).trim();
    const localized = i18n.t(key, { message: detail });
    return localized && localized !== key ? localized : null;
  }
  return null;
}

/**
 * Normalize an unknown thrown value to displayable text. Tauri command
 * errors arrive as plain strings or serialized objects, so Error.message
 * alone is not enough; unstringifiable values degrade to String().
 */
export function errorText(err: unknown): string {
  const text = typeof err === "string" ? err : err instanceof Error ? err.message : null;
  if (text !== null) {
    if (text === "CCGUI_SESSION_NOT_FOUND") {
      return i18n.t("chat.renameSessionMissing") || text;
    }
    const git = gitErrorText(text);
    if (git !== null) return git;
    const prefix = "CCGUI_PROVIDER_MIGRATION_CONFLICT:";
    if (text.startsWith(prefix)) {
      try {
        const detail = JSON.parse(text.slice(prefix.length));
        if (typeof detail.path === "string" && typeof detail.backup === "string") {
          return i18n.t("settings.cliMigrationConflict", { path: detail.path, backup: detail.backup }) || text;
        }
      } catch { /* Preserve malformed/unknown backend errors verbatim. */ }
    }
    if (text === "Invalid Codex channel config.toml") {
      return i18n.t("settings.cliCodexConfigInvalid") || text;
    }
    return text;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
