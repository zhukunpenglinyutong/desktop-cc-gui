// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSelectedComposerSession } from "./useSelectedComposerSession";

type Store = Record<string, unknown>;

const { composerStore, getClientStoreSync, writeClientStoreValue } = vi.hoisted(() => {
  const composerStore: Store = {};
  return {
    composerStore,
    getClientStoreSync: vi.fn((store: string, key: string) => {
      if (store !== "composer") {
        return undefined;
      }
      return composerStore[key];
    }),
    writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
      if (store === "composer") {
        composerStore[key] = value;
      }
    }),
  };
});

vi.mock("../services/clientStorage", () => ({
  getClientStoreSync,
  writeClientStoreValue,
}));

describe("useSelectedComposerSession", () => {
  beforeEach(() => {
    Object.keys(composerStore).forEach((key) => delete composerStore[key]);
    getClientStoreSync.mockClear();
    writeClientStoreValue.mockClear();
  });

  it("applies a draft selection to a pending thread and migrates it to the finalized thread", async () => {
    type HookProps = {
      activeWorkspaceId: string | null;
      activeThreadId: string | null;
      resolveCanonicalThreadId: (threadId: string) => string;
    };

    const initialProps: HookProps = {
      activeWorkspaceId: "ws-a",
      activeThreadId: null,
      resolveCanonicalThreadId: (threadId: string) => threadId,
    };

    const { result, rerender } = renderHook(
      ({ activeWorkspaceId, activeThreadId, resolveCanonicalThreadId }: HookProps) =>
        useSelectedComposerSession({
          activeWorkspaceId,
          activeThreadId,
          resolveCanonicalThreadId,
        }),
      {
        initialProps,
      },
    );

    act(() => {
      result.current.handleSelectComposerSelection({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });

    expect(result.current.selectedComposerSelection).toEqual({
      modelId: "gpt-5.4",
      effort: "high",
    });
    expect(writeClientStoreValue).not.toHaveBeenCalled();

    rerender({
      activeWorkspaceId: "ws-a",
      activeThreadId: "codex-pending-1",
      resolveCanonicalThreadId: (threadId: string) => threadId,
    });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "composer",
      "selectedModelByThread.ws-a:codex-pending-1",
      { modelId: "gpt-5.4", effort: "high" },
    );

    rerender({
      activeWorkspaceId: "ws-a",
      activeThreadId: "codex:session-1",
      resolveCanonicalThreadId: (threadId: string) =>
        threadId === "codex-pending-1" ? "codex:session-1" : threadId,
    });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "composer",
      "selectedModelByThread.ws-a:codex:session-1",
      { modelId: "gpt-5.4", effort: "high" },
    );
  });

  it("keeps identical thread ids isolated across workspaces", async () => {
    composerStore["selectedModelByThread.ws-a:codex:session-1"] = {
      modelId: "gpt-5.4",
      effort: "high",
    };
    composerStore["selectedModelByThread.ws-b:codex:session-1"] = {
      modelId: "gpt-5.5",
      effort: "medium",
    };

    const { result, rerender } = renderHook(
      ({ activeWorkspaceId }: { activeWorkspaceId: string | null }) =>
        useSelectedComposerSession({
          activeWorkspaceId,
          activeThreadId: "codex:session-1",
          resolveCanonicalThreadId: (threadId: string) => threadId,
        }),
      {
        initialProps: { activeWorkspaceId: "ws-a" },
      },
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });

    rerender({ activeWorkspaceId: "ws-b" });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.5",
        effort: "medium",
      });
    });
  });
});
