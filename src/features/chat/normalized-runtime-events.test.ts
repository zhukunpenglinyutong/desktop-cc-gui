import { describe, expect, it } from "vitest";
import type { EngineEventPayload } from "@/lib/events";
import { normalizeEngineEvent } from "./normalized-runtime-events";

const context = {
  turnId: "run-7",
  workspaceId: "workspace-1",
  workspacePath: "S:/work/project",
  occurredAt: "2026-09-12T08:30:00.000Z",
};

function event(kind: EngineEventPayload["kind"], data: unknown): EngineEventPayload {
  return {
    runId: "run-7",
    sessionId: "session-3",
    engine: "claude",
    seq: 12,
    kind,
    data,
  };
}

describe("normalizeEngineEvent permission projection", () => {
  it("reports structured permission requests without exposing the user-facing message", () => {
    const normalized = normalizeEngineEvent(
      event("permission_denied", {
        tool: "Read",
        path: "C:/outside/model.json",
        message: "private approval instructions",
      }),
      context,
    );
    expect(normalized).toMatchObject({
      kind: "permission-requested",
      turnId: "run-7",
      tool: "Read",
      path: "C:/outside/model.json",
    });
    expect(normalized).not.toHaveProperty("message");
  });

  it("leaves missing, blank and non-string permission fields unknown rather than parsing prose", () => {
    for (const data of [
      { message: "Read needs approval for C:/secret.txt" },
      { tool: "  ", path: "", message: "Read C:/secret.txt" },
      { tool: 42, path: { path: "C:/secret.txt" } },
    ]) {
      expect(normalizeEngineEvent(event("permission_denied", data), context)).toEqual({
        eventId: "run-7:12",
        runId: "run-7",
        turnId: "run-7",
        engine: "claude",
        sessionId: "session-3",
        workspaceId: "workspace-1",
        workspacePath: "S:/work/project",
        occurredAt: context.occurredAt,
        kind: "permission-requested",
        tool: null,
        path: null,
      });
    }
  });

  it("does not publish a permission fact from a payload that is not an object", () => {
    for (const data of [null, undefined, "Read C:/secret.txt", 42, true, []]) {
      expect(normalizeEngineEvent(event("permission_denied", data), context)).toBeNull();
    }
  });
});
