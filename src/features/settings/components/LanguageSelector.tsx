import { useTranslation } from "react-i18next";
import Languages from "lucide-react/dist/esm/icons/languages";
import LetterText from "lucide-react/dist/esm/icons/letter-text";
import { saveLanguage } from "../../../i18n";

type LanguageSelectorProps = {
  rowClassName?: string;
};

export function LanguageSelector({ rowClassName }: LanguageSelectorProps = {}) {
  const { t, i18n } = useTranslation();
  const normalizedLanguage = (i18n.language || "").toLowerCase();
  const currentLanguage = normalizedLanguage.startsWith("en") ? "en" : "zh";

  const handleLanguageChange = (newLang: "zh" | "en") => {
    if (newLang === currentLanguage) {
      return;
    }
    void i18n.changeLanguage(newLang);
    saveLanguage(newLang);
  };

  return (
    <div className={`settings-row mb-3 ${rowClassName ?? ""}`.trim()}>
      <div className="settings-label settings-basic-field-header flex items-center gap-2">
        <Languages className="settings-basic-field-icon w-4 h-4 text-(--text-strong)" aria-hidden />
        <span className="settings-basic-field-label text-sm font-semibold text-(--text-strong)">{t("settings.language")}</span>
      </div>
      <div className="settings-control">
        <div
          className="settings-basic-language-selector"
          role="radiogroup"
          aria-label={t("settings.language")}
        >
          <button
            type="button"
            role="radio"
            aria-checked={currentLanguage === "zh"}
            className={`settings-basic-language-option ${
              currentLanguage === "zh" ? "active" : ""
            }`}
            onClick={() => handleLanguageChange("zh")}
          >
            <span className="settings-basic-language-icon settings-basic-language-icon-zh">
              <Languages size={14} />
            </span>
            <span>{t("settings.languageZh")}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={currentLanguage === "en"}
            className={`settings-basic-language-option ${
              currentLanguage === "en" ? "active" : ""
            }`}
            onClick={() => handleLanguageChange("en")}
          >
            <span className="settings-basic-language-icon settings-basic-language-icon-en">
              <LetterText size={14} />
            </span>
            <span>{t("settings.languageEn")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
