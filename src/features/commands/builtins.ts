import i18n from "@/lib/i18n";
import { commandRegistry } from "@ccgui/plugin-sdk";

/**
 * Builtin palette commands, registered through the same commandRegistry the
 * plugins use (plan §4.2 #9 dogfood). Module-scope side effect, imported once
 * by CommandPalette; the registry's upsert semantics make HMR re-runs
 * harmless.
 *
 * Keywords are comma-separated i18n strings so aliases translate with the UI
 * language (e.g. an English UI still matches "shezhi" for 打开设置).
 */

/** Comma-separated i18n keyword list → lazy matcher array. Shared by the
 * builtin registrations below and ChatPage's layout-toggle commands. */
export const keywords = (key: string) => () =>
  i18n
    .t(key)
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);

commandRegistry.register({
  id: "builtin:openSettings",
  title: () => i18n.t("commands.openSettings"),
  keywords: keywords("commands.openSettingsKeywords"),
  run: () => {
    window.location.hash = "#/settings";
  },
});

commandRegistry.register({
  id: "builtin:openPlugins",
  title: () => i18n.t("commands.openPlugins"),
  keywords: keywords("commands.openPluginsKeywords"),
  // The settings page reads the section key from ?page=; "plugins" is the
  // 插件管理 section registered by startPluginSystem.
  run: () => {
    window.location.hash = "#/settings?page=plugins";
  },
});
commandRegistry.register({
  id: "builtin:openMarketplace",
  title: () => i18n.t("commands.openMarketplace"),
  keywords: keywords("commands.openMarketplaceKeywords"),
  run: () => {
    window.location.hash = "#/settings?page=marketplace";
  },
});
