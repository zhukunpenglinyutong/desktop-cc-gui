import { useEffect } from "react";
import type { AppSettings } from "../../../types";

type Params = {
  appSettingsLoading: boolean;
  selectedModelId: string | null;
  selectedEffort: string | null;
  setAppSettings: (updater: (current: AppSettings) => AppSettings) => void;
  queueSaveSettings: (next: AppSettings) => Promise<AppSettings>;
};

export function usePersistComposerSettings({
  appSettingsLoading,
  selectedModelId,
  selectedEffort,
  setAppSettings,
  queueSaveSettings,
}: Params) {
  useEffect(() => {
    void appSettingsLoading;
    void selectedModelId;
    void selectedEffort;
    void setAppSettings;
    void queueSaveSettings;
  }, [
    appSettingsLoading,
    queueSaveSettings,
    selectedEffort,
    selectedModelId,
    setAppSettings,
  ]);
}
