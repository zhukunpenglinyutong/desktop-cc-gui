import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/base/switch/switch";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { ipc } from "@/lib/ipc";
import { isWeb } from "@/lib/platform";

/**
 * 使用统计 switch for the launch page-view beacon (src-tauri/src/baidu_tongji.rs).
 * Desktop only: the backend sends the beacon and the bridge has no route for
 * the switch, so web-access clients see nothing here.
 */
export function AnalyticsSetting() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (isWeb) return;
    let alive = true;
    ipc
      .analyticsEnabledGet()
      .then((value) => {
        if (alive) setEnabled(value);
      })
      .catch(() => {
        if (alive) setEnabled(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (isWeb) return null;

  const change = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setSaveFailed(false);
    try {
      await ipc.analyticsEnabledSet(next);
    } catch {
      setEnabled(previous);
      setSaveFailed(true);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <SettingsSectionLabel anchor="analytics">{t("settings.analyticsTitle")}</SettingsSectionLabel>
      <SettingsCard>
        <SettingsRow
          label={t("settings.analyticsToggle")}
          description={t("settings.analyticsDesc")}
        >
          <Switch
            size="sm"
            aria-label={t("settings.analyticsToggle")}
            isSelected={enabled ?? true}
            isDisabled={enabled === null}
            onChange={(next) => void change(next)}
          />
        </SettingsRow>
      </SettingsCard>
      {saveFailed && (
        <p role="alert" className="px-3 text-body-2-regular text-text-error-primary">
          {t("settings.analyticsSaveFailed")}
        </p>
      )}
    </div>
  );
}
