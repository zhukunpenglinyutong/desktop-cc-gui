// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent } from "../../../types";
import { subscribeAppServerEvents } from "../../../services/events";
import { CONVERSATION_ASSEMBLY_MIGRATION_GATES } from "../../threads/assembly/conversationMigrationGates";
import { useAppServerEvents } from "./useAppServerEvents";

vi.mock("../../../services/events", () => ({
  subscribeAppServerEvents: vi.fn(),
}));

type Handlers = Parameters<typeof useAppServerEvents>[0];
type HookOptions = Parameters<typeof useAppServerEvents>[1];

function TestHarness({
  handlers,
  options,
}: {
  handlers: Handlers;
  options?: HookOptions;
}) {
  useAppServerEvents(handlers, options);
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

async function mount(handlers: Handlers, options?: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<TestHarness handlers={handlers} options={options} />);
  });
  return { root };
}

describe("useAppServerEvents migration gates", () => {
  it("uses the Claude migration gate to fall back from normalized routing to legacy item updates", async () => {
    const previousClaudeGate = { ...CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude };
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    try {
      CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude.assemblerEnabled = false;
      const { root } = await mount(handlers, {
        useNormalizedRealtimeAdapters: true,
      });

      act(() => {
        listener?.({
          workspace_id: "ws-claude",
          message: {
            method: "item/updated",
            params: {
              threadId: "claude:session-gate-disabled",
              item: {
                id: "assistant-gate-disabled",
                type: "agentMessage",
                text: "legacy fallback text",
              },
            },
          },
        });
      });

      expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();
      expect(handlers.onItemUpdated).toHaveBeenCalledWith(
        "ws-claude",
        "claude:session-gate-disabled",
        expect.objectContaining({
          id: "assistant-gate-disabled",
          type: "agentMessage",
          text: "legacy fallback text",
        }),
      );

      await act(async () => {
        root.unmount();
      });
    } finally {
      CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude.assemblerEnabled =
        previousClaudeGate.assemblerEnabled;
    }
  });
});
