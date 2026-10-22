import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import LogIn from "lucide-react/dist/esm/icons/log-in";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import UserCheck from "lucide-react/dist/esm/icons/user-check";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "./CliChannelRow";
import { ipc, type CodeBuddyAccountStatus } from "@/lib/ipc";
import { launchCodeBuddyLogin } from "./codebuddyLogin";

export function CodeBuddyAuthSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CodeBuddyAccountStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await ipc.codebuddyAccountStatus();
      setStatus(res);
    } catch {
      setStatus(null);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    window.addEventListener("focus", fetchStatus);
    return () => window.removeEventListener("focus", fetchStatus);
  }, [fetchStatus]);

  const handleLaunchLogin = useCallback(async () => {
    const launched = await launchCodeBuddyLogin();
    if (launched) {
      navigate("/");
    }
  }, [navigate]);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <SettingsSectionLabel anchor="codebuddyAuth">
          {t("settings.codebuddyAccountTitle")}
          <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
            {t("settings.codebuddyAccountHint")}
          </span>
        </SettingsSectionLabel>
        <Button
          variant="secondary"
          size="small"
          leadingIcon={RefreshCw}
          disabled={refreshing}
          onClick={() => void fetchStatus()}
        >
          {t("settings.codebuddyAccountRefresh")}
        </Button>
      </div>

      <SettingsCard>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-secondary-default text-foreground-icon-primary">
            {status?.loggedIn ? (
              <UserCheck className="size-5 text-text-brand" />
            ) : (
              <LogIn className="size-5 text-text-tertiary" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2">
              <span className="truncate text-body-medium text-text-primary">
                {status?.loggedIn
                  ? status.displayName || status.enterpriseName || t("settings.codebuddyAccountLoggedIn")
                  : t("settings.codebuddyAccountNotLoggedIn")}
              </span>
              {status?.loggedIn ? (
                <Badge tone="default">{status.enterpriseName || t("settings.codebuddyAccountLoggedIn")}</Badge>
              ) : (
                <Badge tone="default">{t("settings.codebuddyAccountNotLoggedIn")}</Badge>
              )}
            </div>
            <p className="truncate text-body-2-regular text-text-secondary">
              {status?.loggedIn
                ? `${status.enterpriseName ? `${status.enterpriseName} · ` : ""}${status.uid ? `UID: ${status.uid}` : t("settings.codebuddyAccountReady")}`
                : t("settings.codebuddyAccountDesc")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant={status?.loggedIn ? "secondary" : "primary"}
              size="small"
              onClick={() => void handleLaunchLogin()}
            >
              {status?.loggedIn
                ? t("settings.codebuddyAccountRelogin")
                : t("settings.codebuddyAccountLogin")}
            </Button>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
