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

describe("normalizeEngineEvent file-change preview", () => {
  function toolMessage(data: Record<string, unknown>) {
    return event("message", { role: "tool", ...data });
  }

  it("attaches a display preview from same-message write args", () => {
    const normalized = normalizeEngineEvent(
      toolMessage({
        text: "Write · create notes",
        args: { file_path: "S:/work/project/notes.md", content: "one\ntwo" },
        result: { ok: true },
        toolCallId: "call-write",
      }),
      context,
    );
    expect(normalized).toMatchObject({
      kind: "file-changed",
      path: "notes.md",
      preview: "+one\n+two",
    });
  });

  it("correlates a split call row with its result by toolCallId", () => {
    expect(
      normalizeEngineEvent(
        toolMessage({
          text: "Edit · change greeting",
          args: { file_path: "S:/work/project/a.ts", old_string: "one", new_string: "two" },
          toolCallId: "call-edit",
        }),
        context,
      ),
    ).toBeNull();

    const settled = normalizeEngineEvent(
      toolMessage({
        text: "Edit · change greeting",
        result: { details: { path: "S:/work/project/a.ts" } },
        toolCallId: "call-edit",
      }),
      context,
    );
    expect(settled).toMatchObject({
      kind: "file-changed",
      path: "a.ts",
      preview: "-one\n+two",
    });
  });

  it("omits the preview when only a result path is available", () => {
    const normalized = normalizeEngineEvent(
      toolMessage({
        text: "Edit · change greeting",
        result: { details: { path: "S:/work/project/a.ts" } },
        toolCallId: "call-without-args",
      }),
      context,
    );
    expect(normalized).toMatchObject({ kind: "file-changed", path: "a.ts" });
    expect(normalized).not.toHaveProperty("preview");
  });

  it("caps large previews instead of copying a whole file into the event", () => {
    const content = "x".repeat(9_000);
    const normalized = normalizeEngineEvent(
      toolMessage({
        text: "Write · huge file",
        args: { file_path: "S:/work/project/huge.txt", content },
        result: {},
        toolCallId: "call-huge",
      }),
      context,
    );
    const preview = (normalized as { preview?: string } | null)?.preview;
    expect(typeof preview).toBe("string");
    expect(preview).toContain("预览已截断");
    expect(preview!.length).toBeLessThan(8_300);
  });

  it("reads OMP hashline paths and previews from the input patch", () => {
    const normalized = normalizeEngineEvent(
      toolMessage({
        text: "edit",
        args: {
          input:
            "[privateDoc/jar/eam-custom-biz/restart.sh#4055]\nPUT 37.=45:\n+# Stop the old process\n+nsystemctl stop x",
        },
        result: {},
        toolCallId: "call-hashline",
      }),
      context,
    );
    expect(normalized).toMatchObject({
      kind: "file-changed",
      path: "privateDoc/jar/eam-custom-biz/restart.sh",
    });
    expect((normalized as { preview?: string }).preview).toContain("PUT 37.=45:");
  });

  it("falls back to the call row's input paths when the result carries none", () => {
    expect(
      normalizeEngineEvent(
        toolMessage({
          text: "edit",
          args: { input: "[src/a.ts#1A2B]\nPUT 1.=1:\n+x" },
          toolCallId: "call-hashline-split",
        }),
        context,
      ),
    ).toBeNull();
    const settled = normalizeEngineEvent(
      toolMessage({ text: "edit", result: {}, toolCallId: "call-hashline-split" }),
      context,
    );
    expect(settled).toMatchObject({ kind: "file-changed", path: "src/a.ts" });
  });

  it("returns one file-changed event per hashline section", () => {
    const normalized = normalizeEngineEvent(
      toolMessage({
        text: "edit",
        args: {
          input:
            "[src/a.ts#1A2B]\nPUT 1.=1:\n+x\n[src/b.ts#3C4D]\nPUT 2.=2:\n+y",
        },
        result: {},
        toolCallId: "call-hashline-multi",
      }),
      context,
    );
    expect(Array.isArray(normalized)).toBe(true);
    const events = normalized as Array<{ eventId: string; path?: string }>;
    expect(events.map((item) => item.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(new Set(events.map((item) => item.eventId)).size).toBe(2);
  });

  it("recognizes apply_patch file headers inside input", () => {
    const normalized = normalizeEngineEvent(
      toolMessage({
        text: "apply_patch",
        args: {
          input: "*** Begin Patch\n*** Update File: src/x.ts\n@@\n-a\n+b\n*** End Patch",
        },
        result: {},
        toolCallId: "call-apply",
      }),
      context,
    );
    expect(normalized).toMatchObject({ kind: "file-changed", path: "src/x.ts" });
    expect((normalized as { preview?: string }).preview).toContain("*** Update File: src/x.ts");
  });

  it("recognizes OMP write results that only report details.resolvedPath", () => {
    expect(
      normalizeEngineEvent(
        toolMessage({
          text: "write",
          args: {
            path: "privateDoc/jar/start-all-apps.sh",
            content: "#!/bin/bash\necho ok",
          },
          toolCallId: "call-write-omp",
        }),
        context,
      ),
    ).toBeNull();

    const settled = normalizeEngineEvent(
      toolMessage({
        text: "write",
        result: {
          details: { resolvedPath: "S:/work/project/privateDoc/jar/start-all-apps.sh" },
        },
        toolCallId: "call-write-omp",
      }),
      context,
    );
    expect(settled).toMatchObject({
      kind: "file-changed",
      path: "privateDoc/jar/start-all-apps.sh",
      preview: "+#!/bin/bash\n+echo ok",
    });
  });

  it("prefers the engine post-edit diff and dedupes relative/absolute paths", () => {
    const normalized = normalizeEngineEvent(
      toolMessage({
        text: "edit",
        args: { input: "[src/a.ts#1A2B]\nPUT 1.=1:\n+x" },
        result: {
          details: {
            path: "S:/work/project/src/a.ts",
            diff: " 1| keep\n-2| old\n+2| new",
          },
        },
        toolCallId: "call-edit-diff",
      }),
      context,
    );
    expect(Array.isArray(normalized)).toBe(false);
    expect(normalized).toMatchObject({ kind: "file-changed", path: "src/a.ts" });
    expect((normalized as { preview?: string }).preview).toContain("-2| old\n+2| new");
  });

  it("does not attach previews to non-mutating tools", () => {
    const normalized = normalizeEngineEvent(
      toolMessage({
        text: "Read · open file",
        args: { file_path: "S:/work/project/a.ts" },
        result: { content: "private" },
        toolCallId: "call-read",
      }),
      context,
    );
    expect(normalized).toMatchObject({ kind: "tool-finished" });
    expect(normalized).not.toHaveProperty("preview");
  });
});
