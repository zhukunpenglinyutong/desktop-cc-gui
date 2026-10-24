/** 订阅授权 group — OAuth status rows plus CLI-owned login/logout actions in
 *  the built-in terminal (extracted from
 *  PiFamilyAuthSection). */
import { useTranslation } from "react-i18next";
import LogIn from "lucide-react/dist/esm/icons/log-in";
import LogOut from "lucide-react/dist/esm/icons/log-out";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { cx } from "@/utils/cx";
import type { PiFamilyOauthProvider } from "./piFamilyAuthCatalog";
import { BrandIcon, ROW, StatusDot } from "./PiFamilyAuthShared";

export function PiFamilyOauthSection({
  engine,
  providers,
  oauthActive,
  onLaunchLogin,
  onLaunchLogout,
}: {
  engine: "pi" | "omp";
  providers: readonly PiFamilyOauthProvider[];
  oauthActive: ReadonlySet<string>;
  onLaunchLogin: (provider: PiFamilyOauthProvider) => void;
  onLaunchLogout: (provider: PiFamilyOauthProvider) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col gap-2">
      <SettingsSectionLabel anchor="piAuthOauth">
        {t("settings.piAuthOauthTitle")}
        <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
          {t("settings.piAuthOauthHint")}
        </span>
      </SettingsSectionLabel>
      <SettingsCard>
        {providers.map((provider) => {
          const subscribed = provider.statusIds.some((id) => oauthActive.has(id));
          return (
            <div className={ROW} key={provider.id}>
              <BrandIcon iconSrc={provider.iconSrc} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-body-regular text-text-primary">{provider.name}</p>
                <p className="truncate text-body-2-regular text-text-secondary">
                  {t(`settings.piAuthOauthDesc${provider.descKey.charAt(0).toUpperCase()}${provider.descKey.slice(1)}`)}
                </p>
              </div>
              <span
                className={cx(
                  "flex shrink-0 items-center gap-1.5 text-body-2-regular",
                  subscribed ? "text-text-secondary" : "text-text-tertiary",
                )}
              >
                <StatusDot on={subscribed} />
                {subscribed ? t("settings.piAuthSubscribed") : t("settings.piAuthNotSubscribed")}
              </span>
              <button
                type="button"
                onClick={() => onLaunchLogin(provider)}
                title={
                  engine === "pi"
                    ? `pi /login ${provider.loginArg}`
                    : `omp auth-broker login ${provider.loginArg}`
                }
                className="flex shrink-0 items-center gap-1 rounded-lg border border-border-button-default px-2.5 py-1 text-body-2-medium text-text-primary hover:bg-background-secondary-hover"
              >
                <LogIn className="size-3.5" aria-hidden />
                {t("settings.piAuthLogin")}
              </button>
              {subscribed && (
                <button
                  type="button"
                  onClick={() => onLaunchLogout(provider)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-border-button-default px-2.5 py-1 text-body-2-medium text-text-primary hover:bg-background-secondary-hover"
                >
                  <LogOut className="size-3.5" aria-hidden />
                  {t(engine === "pi" ? "settings.piAuthGoToLogout" : "settings.piAuthLogout")}
                </button>
              )}
            </div>
          );
        })}
      </SettingsCard>
    </div>
  );
}
