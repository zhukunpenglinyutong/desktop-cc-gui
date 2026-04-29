// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent } from "../../../types";
import { subscribeAppServerEvents } from "../../../services/events";
import { useAppServerEvents } from "./useAppServerEvents";

vi.mock("../../../services/events", () => ({
  subscribeAppServerEvents: vi.fn(),
}));

type Handlers = Parameters<typeof useAppServerEvents>[0];

function TestHarness({ handlers }: { handlers: Handlers }) {
  useAppServerEvents(handlers);
  return null;
}

let listener: ((event: AppServerEvent) => void) | null = null;
const unlisten = vi.fn();

beforeEach(() => {
  listener = null;
  unlisten.mockReset();
  vi.mocked(subscribeAppServerEvents).mockImplementation((cb) => {
    listener = cb;
    return unlisten;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function mount(handlers: Handlers) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<TestHarness handlers={handlers} />);
  });
  return { root };
}

describe("useAppServerEvents compaction events", () => {
  it("routes compaction source flags for manual lifecycle events", async () => {
    const handlers: Handlers = {
      onContextCompacting: vi.fn(),
      onContextCompacted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-2",
        message: {
          method: "thread/compacting",
          params: {
            threadId: "thread-2",
            auto: false,
            manual: true,
          },
        },
      });
    });

    expect(handlers.onContextCompacting).toHaveBeenCalledWith(
      "ws-2",
      "thread-2",
      {
        usagePercent: null,
        thresholdPercent: null,
        targetPercent: null,
        auto: false,
        manual: true,
      },
    );

    act(() => {
      listener?.({
        workspace_id: "ws-2",
        message: {
          method: "thread/compacted",
          params: {
            threadId: "thread-2",
            turnId: "turn-2",
            manual: true,
          },
        },
      });
    });

    expect(handlers.onContextCompacted).toHaveBeenCalledWith(
      "ws-2",
      "thread-2",
      "turn-2",
      { auto: null, manual: true },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("extracts compaction thread ids from nested params when top-level threadId is absent", async () => {
    const handlers: Handlers = {
      onContextCompacting: vi.fn(),
      onContextCompacted: vi.fn(),
      onContextCompactionFailed: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-nested",
        message: {
          method: "thread/compacting",
          params: {
            thread: { id: "codex-thread-nested" },
            auto: true,
          },
        },
      });
    });

    expect(handlers.onContextCompacting).toHaveBeenCalledWith(
      "ws-nested",
      "codex-thread-nested",
      {
        usagePercent: null,
        thresholdPercent: null,
        targetPercent: null,
        auto: true,
      },
    );

    act(() => {
      listener?.({
        workspace_id: "ws-nested",
        message: {
          method: "thread/compacted",
          params: {
            thread: { id: "codex-thread-nested" },
            turn: { id: "turn-nested" },
          },
        },
      });
    });

    expect(handlers.onContextCompacted).toHaveBeenCalledWith(
      "ws-nested",
      "codex-thread-nested",
      "turn-nested",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-nested",
        message: {
          method: "thread/compactionFailed",
          params: {
            thread: { id: "codex-thread-nested" },
            reason: "nested failed",
          },
        },
      });
    });

    expect(handlers.onContextCompactionFailed).toHaveBeenCalledWith(
      "ws-nested",
      "codex-thread-nested",
      "nested failed",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("accepts numeric compaction source flags and nested thread.threadId payloads", async () => {
    const handlers: Handlers = {
      onContextCompacting: vi.fn(),
      onContextCompacted: vi.fn(),
      onContextCompactionFailed: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-numeric",
        message: {
          method: "thread/compacting",
          params: {
            thread: { threadId: "codex-thread-threadId" },
            auto: 1,
            manual: 0,
          },
        },
      });
    });

    expect(handlers.onContextCompacting).toHaveBeenCalledWith(
      "ws-numeric",
      "codex-thread-threadId",
      {
        usagePercent: null,
        thresholdPercent: null,
        targetPercent: null,
        auto: true,
        manual: false,
      },
    );

    await act(async () => {
      root.unmount();
    });
  });
});
