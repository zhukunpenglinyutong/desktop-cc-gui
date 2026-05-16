import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

const GITHUB_URL = "https://github.com/zhukunpenglinyutong/desktop-cc-gui";

export function AboutView() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);

  const handleOpenGitHub = () => {
    void openUrl(GITHUB_URL);
  };

  useEffect(() => {
    let active = true;
    const fetchVersion = async () => {
      try {
        const value = await getVersion();
        if (active) {
          setVersion(value);
        }
      } catch {
        if (active) {
          setVersion(null);
        }
      }
    };

    void fetchVersion();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="about h-screen w-screen flex items-center justify-center pt-2 box-border bg-(--surface-topbar) text-(--text-emphasis) [--webkit-app-region:no-drag]">
      <div className="about-card flex flex-col items-center gap-2 px-7 pt-7 pb-4 text-center">
        <div className="about-header flex items-center gap-2.5">
          <img
            className="about-icon w-11 h-11 rounded-lg shadow-none bg-transparent max-h-720:w-10 max-h-720:h-10 max-h-720:rounded-[7px]"
            src="/app-icon.png"
            alt="ccgui icon"
          />
          <div className="about-title text-[22px] font-bold tracking-wide">{t("about.name") ?? "ccgui"}</div>
        </div>
        <div className="about-version text-xs text-(--text-faint)">
          {version ? `${t("about.version")} ${version}` : `${t("about.version")} —`}
        </div>
        <div className="about-tagline text-[13px] text-(--text-muted) max-w-[260px]">
          {t("about.tagline")}
        </div>
        <div className="about-divider w-40 h-px bg-(--border-subtle) my-1.5" />
        <div className="about-links inline-flex items-center gap-2 text-xs">
          <button
            type="button"
            className="about-link border-none bg-transparent text-(--text-emphasis) cursor-pointer text-xs p-0 hover:underline"
            onClick={handleOpenGitHub}
          >
            {t("about.github")}
          </button>
        </div>
      </div>
    </div>
  );
}
