// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeClientStoreValue } from "../../../services/clientStorage";
import {
  CLIENT_UI_VISIBILITY_CHANGED_EVENT,
  CLIENT_UI_VISIBILITY_KEY,
  CLIENT_UI_VISIBILITY_STORE,
} from "../utils/clientUiVisibility";
import { useClientUiVisibility } from "./useClientUiVisibility";

const clientStore = new Map<string, unknown>();

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn((store: string, key: string) =>
    clientStore.get(`${store}:${key}`),
  ),
  writeClientStoreValue: vi.fn(
    (store: string, key: string, value: unknown) => {
      clientStore.set(`${store}:${key}`, value);
    },
  ),
}));

describe("useClientUiVisibility", () => {
  beforeEach(() => {
    clientStore.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("uses a visible default before a stored preference exists", () => {
    const { result } = renderHook(() => useClientUiVisibility());

    expect(result.current.isPanelVisible("topSessionTabs")).toBe(true);
    expect(result.current.isControlVisible("topTool.terminal")).toBe(true);
  });

  it("persists control changes through the app client store", () => {
    const { result } = renderHook(() => useClientUiVisibility());

    act(() => {
      result.current.setControlVisible("topTool.terminal", false);
    });

    expect(writeClientStoreValue).toHaveBeenCalledWith(
      CLIENT_UI_VISIBILITY_STORE,
      CLIENT_UI_VISIBILITY_KEY,
      expect.objectContaining({
        controls: expect.objectContaining({ "topTool.terminal": false }),
      }),
      { immediate: true },
    );
    expect(result.current.isControlVisible("topTool.terminal")).toBe(false);
  });

  it("syncs preferences across hook instances through the visibility event", () => {
    const { result } = renderHook(() => useClientUiVisibility());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(CLIENT_UI_VISIBILITY_CHANGED_EVENT, {
          detail: {
            panels: { bottomActivityPanel: false },
            controls: {},
          },
        }),
      );
    });

    expect(result.current.isPanelVisible("bottomActivityPanel")).toBe(false);
  });

  it("resets every supported entry to default visible", () => {
    clientStore.set(`${CLIENT_UI_VISIBILITY_STORE}:${CLIENT_UI_VISIBILITY_KEY}`, {
      panels: { topSessionTabs: false },
      controls: { "rightToolbar.search": false },
    });
    const { result } = renderHook(() => useClientUiVisibility());

    act(() => {
      result.current.resetVisibility();
    });

    expect(result.current.isPanelVisible("topSessionTabs")).toBe(true);
    expect(result.current.isControlVisible("rightToolbar.search")).toBe(true);
    expect(writeClientStoreValue).toHaveBeenLastCalledWith(
      CLIENT_UI_VISIBILITY_STORE,
      CLIENT_UI_VISIBILITY_KEY,
      { panels: {}, controls: {} },
      { immediate: true },
    );
  });
});
