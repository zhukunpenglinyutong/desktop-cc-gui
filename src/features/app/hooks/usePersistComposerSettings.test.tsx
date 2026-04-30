// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../../types";
import { usePersistComposerSettings } from "./usePersistComposerSettings";

describe("usePersistComposerSettings", () => {
  it("persists the composer defaults when global persistence is enabled", async () => {
    const queueSaveSettings = vi.fn(async (next: AppSettings) => next);
    const setAppSettings = vi.fn((updater: (current: AppSettings) => AppSettings) =>
      updater({
        lastComposerModelId: null,
        lastComposerReasoningEffort: null,
      } as AppSettings),
    );

    renderHook(() =>
      usePersistComposerSettings({
        enabled: true,
        appSettingsLoading: false,
        selectedModelId: "gpt-5.5",
        selectedEffort: "high",
        setAppSettings,
        queueSaveSettings,
      }),
    );

    await waitFor(() => {
      expect(setAppSettings).toHaveBeenCalledTimes(1);
      expect(queueSaveSettings).toHaveBeenCalledWith({
        lastComposerModelId: "gpt-5.5",
        lastComposerReasoningEffort: "high",
      });
    });
  });

  it("skips persistence while a thread-scoped selection is active", async () => {
    const queueSaveSettings = vi.fn(async (next: AppSettings) => next);
    const setAppSettings = vi.fn();

    renderHook(() =>
      usePersistComposerSettings({
        enabled: false,
        appSettingsLoading: false,
        selectedModelId: "gpt-5.5",
        selectedEffort: "high",
        setAppSettings,
        queueSaveSettings,
      }),
    );

    await waitFor(() => {
      expect(setAppSettings).not.toHaveBeenCalled();
      expect(queueSaveSettings).not.toHaveBeenCalled();
    });
  });

  it("clears previously persisted composer defaults when the global selection becomes empty", async () => {
    const queueSaveSettings = vi.fn(async (next: AppSettings) => next);
    const setAppSettings = vi.fn((updater: (current: AppSettings) => AppSettings) =>
      updater({
        lastComposerModelId: "gpt-5.5",
        lastComposerReasoningEffort: "high",
      } as AppSettings),
    );

    renderHook(() =>
      usePersistComposerSettings({
        enabled: true,
        appSettingsLoading: false,
        selectedModelId: null,
        selectedEffort: null,
        setAppSettings,
        queueSaveSettings,
      }),
    );

    await waitFor(() => {
      expect(queueSaveSettings).toHaveBeenCalledWith({
        lastComposerModelId: null,
        lastComposerReasoningEffort: null,
      });
    });
  });
});
