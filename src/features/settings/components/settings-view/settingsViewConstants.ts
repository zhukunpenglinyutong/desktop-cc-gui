import type { TFunction } from "i18next";

// Feature flags to show/hide settings sidebar entries
export const SHOW_DICTATION_ENTRY = false;
export const SHOW_GIT_ENTRY = false;
export const SHOW_CODEX_ENTRY = true;
export const SHOW_EXPERIMENTAL_ENTRY = false;
export const SHOW_COMMIT_ENTRY = false;
export const SHOW_COMPOSER_ENTRY = false;
export const SHOW_SHORTCUTS_ENTRY = true;

export const DICTATION_MODELS = (t: TFunction) => [
  { id: "tiny", label: t("settings.dictationModelTiny"), size: "75 MB", note: t("settings.dictationModelFastest") },
  { id: "base", label: t("settings.dictationModelBase"), size: "142 MB", note: t("settings.dictationModelBalanced") },
  { id: "small", label: t("settings.dictationModelSmall"), size: "466 MB", note: t("settings.dictationModelBetter") },
  { id: "medium", label: t("settings.dictationModelMedium"), size: "1.5 GB", note: t("settings.dictationModelHigh") },
  { id: "large-v3", label: t("settings.dictationModelLargeV3"), size: "3.0 GB", note: t("settings.dictationModelBest") },
];

export const TEMPORARILY_DISABLED_SIDEBAR_SECTIONS = new Set([
  "permissions",
] as const);
