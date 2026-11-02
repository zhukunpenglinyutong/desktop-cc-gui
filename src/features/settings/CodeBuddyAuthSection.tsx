import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import LogIn from "lucide-react/dist/esm/icons/log-in";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { Button } from "@/components/base/buttons/button";
import { launchCodeBuddyLogin } from "./codebuddyLogin";

/**
 * CodeBuddy keeps its login in the OS credential store under undocumented
 * names. Telling "logged in" apart would mean enumerating that store
 * (`cmdkey /list`, `security find-generic-password`, `secret-tool search`),
 * which endpoint security flags as credential discovery — so the app never
 * probes it. The CLI owns the login state; this section only launches
 * `/login` in the built-in terminal.
 */
export function CodeBuddyAuthSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The CLI owns the interactive login flow: close the settings overlay so
  // the user sees the terminal the login runs in.
  const handleLaunchLogin = useCallback(async () => {
    if (launching) return;
    setLaunching(true);
    setNotice(null);
    try {
      const result = await launchCodeBuddyLogin();
      if (result.ok) {
        navigate("/");
      } else {
        setNotice(
          t(
            result.reason === "no-workspace"
              ? "settings.codebuddyLoginNoWorkspace"
              : "settings.codebuddyLoginFailed",
          ),
        );
      }
    } catch {
      setNotice(t("settings.codebuddyLoginFailed"));
    } finally {
      setLaunching(false);
    }
  }, [launching, navigate, t]);

  return (
    <div className="flex w-full flex-col gap-2">
      {notice && (
        <p role="status" className="text-body-regular text-text-secondary">
          {notice}
        </p>
      )}
      <SettingsSectionLabel anchor="codebuddyAuth">
        {t("settings.codebuddyAccountTitle")}
        <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
          {t("settings.codebuddyAccountHint")}
        </span>
      </SettingsSectionLabel>

      <SettingsCard>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-secondary-default text-foreground-icon-primary">
            <LogIn className="size-5 text-text-tertiary" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body-medium text-text-primary">
              {t("settings.codebuddyAccountCliOwned")}
            </span>
            <p className="text-body-2-regular text-text-secondary">
              {t("settings.codebuddyAccountCliOwnedDesc")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="primary"
              size="small"
              disabled={launching}
              onClick={() => void handleLaunchLogin()}
            >
              {t("settings.codebuddyAccountLogin")}
            </Button>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
