import { useEffect } from "react";
import type { AppSettings } from "../../../types";

type Params = {
  enabled: boolean;
  appSettingsLoading: boolean;
  selectedModelId: string | null;
  selectedEffort: string | null;
  setAppSettings: (updater: (current: AppSettings) => AppSettings) => void;
  queueSaveSettings: (next: AppSettings) => Promise<AppSettings>;
};

export function usePersistComposerSettings({
  enabled,
  appSettingsLoading,
  selectedModelId,
  selectedEffort,
  setAppSettings,
  queueSaveSettings,
}: Params) {
  useEffect(() => {
    if (!enabled || appSettingsLoading) {
      return;
    }
    setAppSettings((current) => {
      if (
        current.lastComposerModelId === selectedModelId &&
        current.lastComposerReasoningEffort === selectedEffort
      ) {
        return current;
      }
      const nextSettings = {
        ...current,
        lastComposerModelId: selectedModelId,
        lastComposerReasoningEffort: selectedEffort,
      };
      void queueSaveSettings(nextSettings);
      return nextSettings;
    });
  }, [
    enabled,
    appSettingsLoading,
    queueSaveSettings,
    selectedEffort,
    selectedModelId,
    setAppSettings,
  ]);
}
