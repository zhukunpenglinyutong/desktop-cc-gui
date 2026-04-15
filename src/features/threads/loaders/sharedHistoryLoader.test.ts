import { describe, expect, it, vi } from "vitest";
import { createSharedHistoryLoader } from "./sharedHistoryLoader";

describe("sharedHistoryLoader", () => {
  it("restores snapshot items from shared session payload", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        id: "shared-session-1",
        threadId: "shared:shared-session-1",
        selectedEngine: "claude",
        items: [
          {
            id: "user-1",
            kind: "message",
            role: "user",
            text: "Explain this repository",
          },
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "Here is the summary",
            engineSource: "claude",
          },
        ],
      }),
    });

    const snapshot = await loader.load("shared:shared-session-1");

    expect(snapshot.threadId).toBe("shared:shared-session-1");
    expect(snapshot.engine).toBe("claude");
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[1]).toMatchObject({
      kind: "message",
      role: "assistant",
      engineSource: "claude",
    });
  });

  it("normalizes legacy unsupported shared-session engines back to claude", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        id: "shared-session-2",
        threadId: "shared:shared-session-2",
        selectedEngine: "gemini",
        items: [],
      }),
    });

    const snapshot = await loader.load("shared:shared-session-2");

    expect(snapshot.engine).toBe("claude");
    expect(snapshot.meta.engine).toBe("claude");
  });
});
