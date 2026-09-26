import { describe, expect, it } from "vitest";
import { missionId } from "./ids";

describe("missionId", () => {
  it("generates id with given prefix and 12-char hex suffix", () => {
    const id = missionId("task");
    expect(id).toMatch(/^task-[0-9a-f]{12}$/i);
  });

  it("generates distinct ids on consecutive calls", () => {
    const id1 = missionId("run");
    const id2 = missionId("run");
    expect(id1).not.toBe(id2);
  });
});
