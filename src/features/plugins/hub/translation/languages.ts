/**
 * 插件介绍可翻译成的目标语言。`name` 是该语言的自称（菜单里按母语显示，
 * 不随界面语言变化），`english` 写进提示词——模型对英文语言名最稳定。
 */
export interface TranslationLanguage {
  code: string;
  name: string;
  english: string;
}

export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = [
  { code: "en", name: "English", english: "English" },
  { code: "ru", name: "Русский", english: "Russian" },
  { code: "zh", name: "简体中文", english: "Simplified Chinese" },
  { code: "zh-TW", name: "繁體中文", english: "Traditional Chinese" },
  { code: "ko", name: "한국어", english: "Korean" },
  { code: "ja", name: "日本語", english: "Japanese" },
  { code: "de", name: "Deutsch", english: "German" },
  { code: "fr", name: "Français", english: "French" },
  { code: "es", name: "Español", english: "Spanish" },
  { code: "pt", name: "Português", english: "Portuguese" },
  { code: "it", name: "Italiano", english: "Italian" },
  { code: "uk", name: "Українська", english: "Ukrainian" },
  { code: "kk", name: "Қазақша", english: "Kazakh" },
  { code: "tr", name: "Türkçe", english: "Turkish" },
];

export function findTranslationLanguage(code: string | null | undefined): TranslationLanguage | null {
  if (!code) return null;
  return TRANSLATION_LANGUAGES.find((language) => language.code === code) ?? null;
}

/** 首次使用时的默认目标语言：跟随界面语言，认不出时用英文。 */
export function defaultTranslationLanguage(uiLanguage: string | undefined): string {
  const base = (uiLanguage ?? "").toLowerCase();
  const exact = TRANSLATION_LANGUAGES.find((language) => language.code.toLowerCase() === base);
  if (exact) return exact.code;
  const prefix = base.split("-")[0];
  return TRANSLATION_LANGUAGES.find((language) => language.code === prefix)?.code ?? "en";
}
