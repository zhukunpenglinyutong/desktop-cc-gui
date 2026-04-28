import { describe, expect, it, vi } from "vitest";

import { refreshCodexModelConfig } from "./refreshCodexModelConfig";

describe("refreshCodexModelConfig", () => {
  it("reloads Codex runtime config before refreshing model list", async () => {
    const calls: string[] = [];
    const reloadRuntimeConfig = vi.fn(async () => {
      calls.push("reload-runtime-config");
      return {
        status: "applied",
        stage: "swapped",
        restartedSessions: 1,
        message: null,
      };
    });
    const refreshModels = vi.fn(async () => {
      calls.push("refresh-models");
    });

    await refreshCodexModelConfig({ reloadRuntimeConfig, refreshModels });

    expect(reloadRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(refreshModels).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["reload-runtime-config", "refresh-models"]);
  });

  it("does not refresh model list when runtime config reload fails", async () => {
    const reloadError = new Error("reload failed");
    const reloadRuntimeConfig = vi.fn(async () => {
      throw reloadError;
    });
    const refreshModels = vi.fn();

    await expect(
      refreshCodexModelConfig({ reloadRuntimeConfig, refreshModels }),
    ).rejects.toThrow(reloadError);

    expect(refreshModels).not.toHaveBeenCalled();
  });
});
