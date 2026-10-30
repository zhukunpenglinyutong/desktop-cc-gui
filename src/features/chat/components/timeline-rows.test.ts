import { describe, expect, it } from "vitest";
import { zh } from "@/i18n/zh";
import { AGENT_STATUS_ROLE, type Message } from "@/lib/ipc";
import { buildRows, collectToolKeys, rowKey } from "./timeline-rows";

describe("buildRows hidden agent status deliveries", () => {
  const delivery: Message = {
    seq: 2,
    role: AGENT_STATUS_ROLE,
    text: "Worker completed",
    ts: null,
    result: { details: { jobs: [{ jobId: "Worker", status: "completed" }] } },
  };

  it("does not render a hidden delivery on its own", () => {
    expect(buildRows([delivery])).toEqual([]);
  });

  it("keeps two tools separated by a hidden delivery in one process row", () => {
    const first: Message = { seq: 1, role: "tool", text: "read · First file", ts: null };
    const second: Message = { seq: 3, role: "tool", text: "edit · Second file", ts: null };

    const rows = buildRows([first, delivery, second]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "process",
      firstSeq: 1,
      items: [
        { type: "tool", text: "read · First file" },
        { type: "tool", text: "edit · Second file" },
      ],
    });
    expect(rowKey(rows[0])).toBe("process-1");
    expect(collectToolKeys(rows)).toEqual(["1:0", "1:1"]);
  });

  it("skips leading and trailing deliveries without changing process identity", () => {
    const tool: Message = { seq: 3, role: "tool", text: "read", ts: null };
    const trailing: Message = { ...delivery, seq: 4 };
    const original = buildRows([tool]);

    const rows = buildRows([delivery, tool, trailing]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(original[0]);
    expect(rows[0]).toMatchObject({ kind: "process", firstSeq: 3, items: [{ type: "tool", text: "read" }] });
  });

  it("keeps tools and thinking together across status, placeholder, and resume-nudge rows", () => {
    const messages: Message[] = [
      { seq: 1, role: "tool", text: "read", ts: null },
      delivery,
      { seq: 3, role: "user", text: zh.chat.autoCompactResume, ts: null },
      { seq: 4, role: "assistant", text: "·", ts: null },
      { seq: 5, role: "thinking", text: "Inspecting the result", ts: null },
      { seq: 6, role: "tool", text: "edit", ts: null },
    ];

    const rows = buildRows(messages);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "process",
      firstSeq: 1,
      items: [
        { type: "tool", text: "read" },
        { type: "thinking", text: "Inspecting the result" },
        { type: "tool", text: "edit" },
      ],
    });
  });

  it("preserves visible assistant boundaries around hidden deliveries", () => {
    const first: Message = { seq: 1, role: "tool", text: "read", ts: null };
    const assistant: Message = { seq: 3, role: "assistant", text: "The file needs an edit.", ts: null };
    const second: Message = { seq: 4, role: "tool", text: "edit", ts: null };

    const rows = buildRows([first, delivery, assistant, second]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "process", firstSeq: 1, items: [{ text: "read" }] });
    expect(rows[1]).toEqual({ kind: "msg", message: assistant, turnFinal: true });
    expect(rows[2]).toMatchObject({ kind: "process", firstSeq: 4, items: [{ text: "edit" }] });
  });

  it("does not let hidden deliveries consume assistant footer slots or create turn boundaries", () => {
    const first: Message = { seq: 1, role: "assistant", text: "First segment", ts: null };
    const final: Message = { seq: 3, role: "assistant", text: "Final segment", ts: null };

    expect(buildRows([first, delivery, final, { ...delivery, seq: 4 }])).toEqual([
      { kind: "msg", message: first, turnFinal: false },
      { kind: "msg", message: final, turnFinal: true },
    ]);
  });

  it("preserves visible compaction curtains between process groups", () => {
    const messages: Message[] = [
      { seq: 1, role: "tool", text: "read", ts: null },
      delivery,
      { seq: 3, role: "user", text: "/compact", ts: null },
      { seq: 4, role: "tool", text: "edit", ts: null },
    ];

    const rows = buildRows(messages);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "process", firstSeq: 1 });
    expect(rows[1]).toEqual({ kind: "curtain", seq: 3 });
    expect(rows[2]).toMatchObject({ kind: "process", firstSeq: 4 });
  });
});
