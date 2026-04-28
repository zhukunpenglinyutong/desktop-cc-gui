import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import {
  CLIENT_UI_VISIBILITY_CHANGED_EVENT,
  CLIENT_UI_VISIBILITY_KEY,
  CLIENT_UI_VISIBILITY_STORE,
  DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE,
  type ClientUiControlId,
  type ClientUiPanelId,
  type ClientUiVisibilityPreference,
  createClientUiVisibilityQueries,
  normalizeClientUiVisibilityPreference,
  setClientUiControlVisibility,
  setClientUiPanelVisibility,
} from "../utils/clientUiVisibility";

function readClientUiVisibilityPreference(): ClientUiVisibilityPreference {
  return normalizeClientUiVisibilityPreference(
    getClientStoreSync(
      CLIENT_UI_VISIBILITY_STORE,
      CLIENT_UI_VISIBILITY_KEY,
    ),
  );
}

function emitClientUiVisibilityChange(preference: ClientUiVisibilityPreference) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ClientUiVisibilityPreference>(
      CLIENT_UI_VISIBILITY_CHANGED_EVENT,
      { detail: preference },
    ),
  );
}

export function useClientUiVisibility() {
  const [preference, setPreference] = useState<ClientUiVisibilityPreference>(
    readClientUiVisibilityPreference,
  );

  useEffect(() => {
    const handlePreferenceChange = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setPreference(normalizeClientUiVisibilityPreference(detail));
    };
    window.addEventListener(
      CLIENT_UI_VISIBILITY_CHANGED_EVENT,
      handlePreferenceChange,
    );
    return () => {
      window.removeEventListener(
        CLIENT_UI_VISIBILITY_CHANGED_EVENT,
        handlePreferenceChange,
      );
    };
  }, []);

  const persistPreference = useCallback(
    (nextPreference: ClientUiVisibilityPreference) => {
      const normalizedPreference =
        normalizeClientUiVisibilityPreference(nextPreference);
      setPreference(normalizedPreference);
      writeClientStoreValue(
        CLIENT_UI_VISIBILITY_STORE,
        CLIENT_UI_VISIBILITY_KEY,
        normalizedPreference,
        { immediate: true },
      );
      emitClientUiVisibilityChange(normalizedPreference);
    },
    [],
  );

  const setPanelVisible = useCallback(
    (panelId: ClientUiPanelId, visible: boolean) => {
      persistPreference(
        setClientUiPanelVisibility(preference, panelId, visible),
      );
    },
    [persistPreference, preference],
  );

  const setControlVisible = useCallback(
    (controlId: ClientUiControlId, visible: boolean) => {
      persistPreference(
        setClientUiControlVisibility(preference, controlId, visible),
      );
    },
    [persistPreference, preference],
  );

  const resetVisibility = useCallback(() => {
    persistPreference(DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE);
  }, [persistPreference]);

  const queries = useMemo(
    () => createClientUiVisibilityQueries(preference),
    [preference],
  );

  return {
    preference: queries.preference,
    isPanelVisible: queries.isPanelVisible,
    isControlVisible: queries.isControlVisible,
    isControlPreferenceVisible: queries.isControlPreferenceVisible,
    setPanelVisible,
    setControlVisible,
    resetVisibility,
  };
}
