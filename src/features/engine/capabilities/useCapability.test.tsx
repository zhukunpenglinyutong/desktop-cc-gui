// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveEngine, getEngineStatus } from "../../../services/tauri";
import type { EngineStatus } from "../../../types";
import type { EngineCapabilityKey } from "../engineCapabilityMatrix";
import { useCapability } from "./useCapability";

vi.mock("../../../services/tauri", () => ({
  getActiveEngine: vi.fn(),
  getEngineStatus: vi.fn(),
}));

const getActiveEngineMock = vi.mocked(getActiveEngine);
const getEngineStatusMock = vi.mocked(getEngineStatus);

function createEngineStatus(
  engineType: EngineStatus["engineType"],
  features: Partial<EngineStatus["features"]> = {},
): EngineStatus {
  return {
    engineType,
    installed: true,
    version: "test",
    binPath: null,
    features: {
      streaming: true,
      reasoning: true,
      toolUse: true,
      imageInput: true,
      sessionContinuation: true,
      ...features,
    },
    models: [],
    error: null,
  };
}

describe("useCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries the active engine by default and delegates runtime status to the matrix helper", async () => {
    getActiveEngineMock.mockResolvedValue("codex");
    getEngineStatusMock.mockResolvedValue(createEngineStatus("codex", { reasoning: true }));

    const { result } = renderHook(() => useCapability("reasoning.effort"));

    expect(result.current).toMatchObject({
      engine: null,
      capability: "reasoning.effort",
      isLoading: true,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getActiveEngineMock).toHaveBeenCalledTimes(1);
    expect(getEngineStatusMock).toHaveBeenCalledWith("codex");
    expect(result.current).toMatchObject({
      engine: "codex",
      capability: "reasoning.effort",
      specState: "supported",
      runtimeState: "unknown",
      supported: true,
      available: true,
      error: null,
    });
  });

  it("uses the override engine without reading the active engine", async () => {
    getEngineStatusMock.mockResolvedValue(createEngineStatus("claude"));

    const { result } = renderHook(() => useCapability("reasoning.effort", "claude"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getActiveEngineMock).not.toHaveBeenCalled();
    expect(getEngineStatusMock).toHaveBeenCalledWith("claude");
    expect(result.current).toMatchObject({
      engine: "claude",
      specState: "unsupported",
      supported: false,
      available: false,
    });
  });

  it("falls back to spec-only state when runtime status is unavailable", async () => {
    getActiveEngineMock.mockResolvedValue("codex");
    getEngineStatusMock.mockResolvedValue(null);

    const { result } = renderHook(() => useCapability("tool.use"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current).toMatchObject({
      engine: "codex",
      specState: "supported",
      runtimeState: "unknown",
      supported: true,
      available: true,
      error: null,
    });
  });

  it("returns an explicit error state when active engine lookup fails", async () => {
    getActiveEngineMock.mockRejectedValue(new Error("bridge down"));

    const { result } = renderHook(() => useCapability("tool.use"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current).toMatchObject({
      engine: null,
      capability: "tool.use",
      supported: false,
      available: false,
      error: "bridge down",
    });
  });

  it("keeps unknown capability names rejected at typecheck time", () => {
    const knownCapability: EngineCapabilityKey = "tool.use";
    expect(knownCapability).toBe("tool.use");
    // @ts-expect-error unknown capability keys must not compile.
    const rejectedCapability: EngineCapabilityKey = "runtime.telepathy";
    expect(rejectedCapability).toBe("runtime.telepathy");
  });
});
