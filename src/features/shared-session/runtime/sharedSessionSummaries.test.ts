import { describe, expect, it } from "vitest";
import { normalizeSharedSessionSummary } from "./sharedSessionSummaries";

describe("sharedSessionSummaries", () => {
  it("keeps shared native thread ids limited to claude and codex bindings", () => {
    const summary = normalizeSharedSessionSummary({
      id: "shared-session-1",
      threadId: "shared:shared-session-1",
      title: "Shared Session",
      updatedAt: 1_730_000_000_000,
      selectedEngine: "claude",
      nativeThreadIds: [
        "claude:session-1",
        "claude-pending-shared-2",
        "019d767b-5541-7010-a30d-a454864bccd8",
        "gemini:session-3",
        "gemini-pending-4",
        "opencode:session-5",
        "opencode-pending-6",
      ],
    });

    expect(summary).toMatchObject({
      id: "shared-session-1",
      threadId: "shared:shared-session-1",
      selectedEngine: "claude",
    });
    expect(summary?.nativeThreadIds).toEqual([
      "claude:session-1",
      "claude-pending-shared-2",
      "019d767b-5541-7010-a30d-a454864bccd8",
    ]);
  });

  it("rejects malformed non-shared thread ids from shared summaries", () => {
    expect(
      normalizeSharedSessionSummary({
        id: "not-shared",
        threadId: "gemini:session-1",
        selectedEngine: "claude",
      }),
    ).toBeNull();
  });
});
