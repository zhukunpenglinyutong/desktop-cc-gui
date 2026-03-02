import { useTranslation } from "react-i18next";
import { saveLanguage } from "../../../i18n";

export function LanguageSelector() {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.language;

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = event.target.value;
    i18n.changeLanguage(newLang);
    saveLanguage(newLang);
  };

  return (
    <div className="settings-row mb-3">
      <div className="settings-label">{t("settings.language")}</div>
      <div className="settings-control">
        <div className="settings-select-wrap">
          <select
            className="settings-select"
            value={currentLanguage}
            onChange={handleLanguageChange}
          >
            <option value="zh">{t("settings.languageZh")}</option>
            <option value="en">{t("settings.languageEn")}</option>
          </select>
        </div>
      </div>
    </div>
  );
}
