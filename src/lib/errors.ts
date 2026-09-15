import i18n from "i18next";

/**
 * Normalize an unknown thrown value to displayable text. Tauri command
 * errors arrive as plain strings or serialized objects, so Error.message
 * alone is not enough; unstringifiable values degrade to String().
 */
export function errorText(err: unknown): string {
  const text = typeof err === "string" ? err : err instanceof Error ? err.message : null;
  if (text !== null) {
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
