import { useCallback, useRef } from "react";
import { useUpdater } from "../../update/hooks/useUpdater";
import { useAgentSoundNotifications } from "../../notifications/hooks/useAgentSoundNotifications";
import { useTauriEvent } from "./useTauriEvent";
import { playNotificationSoundBySelection } from "../../../utils/notificationSounds";
import { subscribeUpdaterCheck } from "../../../services/events";
import type { DebugEntry } from "../../../types";

type Params = {
  notificationSoundsEnabled: boolean;
  notificationSoundId?: string;
  notificationSoundCustomPath?: string;
  onDebug: (entry: DebugEntry) => void;
};

export function useUpdaterController({
  notificationSoundsEnabled,
  notificationSoundId,
  notificationSoundCustomPath,
  onDebug,
}: Params) {
  const { state: updaterState, startUpdate, checkForUpdates, dismiss } = useUpdater({
    onDebug,
  });
  const lastTestPlayedAtRef = useRef(0);

  const subscribeUpdaterCheckEvent = useCallback(
    (handler: () => void) =>
      subscribeUpdaterCheck(handler, {
        onError: (error) => {
          onDebug({
            id: `${Date.now()}-client-updater-menu-error`,
            timestamp: Date.now(),
            source: "error",
            label: "updater/menu-error",
            payload: error instanceof Error ? error.message : String(error),
          });
        },
      }),
    [onDebug],
  );

  useTauriEvent(subscribeUpdaterCheckEvent, () => {
    void checkForUpdates({ announceNoUpdate: true, interactive: true });
  });

  useAgentSoundNotifications({
    enabled: notificationSoundsEnabled,
    soundId: notificationSoundId,
    customSoundPath: notificationSoundCustomPath,
    onDebug,
  });

  const handleTestNotificationSound = useCallback(
    (overrideSoundId?: string, overrideCustomPath?: string) => {
      if (Date.now() - lastTestPlayedAtRef.current < 160) {
        return;
      }
      lastTestPlayedAtRef.current = Date.now();
      playNotificationSoundBySelection({
        soundId: overrideSoundId ?? notificationSoundId,
        customSoundPath: overrideCustomPath ?? notificationSoundCustomPath,
        label: "test",
        onDebug,
      });
    },
    [notificationSoundCustomPath, notificationSoundId, onDebug],
  );

  return {
    updaterState,
    startUpdate,
    checkForUpdates,
    dismissUpdate: dismiss,
    handleTestNotificationSound,
  };
}
