import { describe, expect, it } from "vitest";
import { compareVersions, satisfiesSdkRange } from "@ccgui/plugin-sdk";

describe("satisfiesSdkRange", () => {
  it("absent or * accepts anything", () => {
    expect(satisfiesSdkRange(undefined, "0.2.0")).toBe(true);
    expect(satisfiesSdkRange("*", "9.9.9")).toBe(true);
  });

  it("exact match", () => {
    expect(satisfiesSdkRange("0.2.0", "0.2.0")).toBe(true);
    expect(satisfiesSdkRange("0.2.0", "0.2.1")).toBe(false);
  });

  it("caret on 0.x left-anchors the minor (semver rule)", () => {
    expect(satisfiesSdkRange("^0.2", "0.2.0")).toBe(true);
    expect(satisfiesSdkRange("^0.2.1", "0.2.5")).toBe(true);
    expect(satisfiesSdkRange("^0.2.1", "0.2.0")).toBe(false);
    expect(satisfiesSdkRange("^0.2.0", "0.3.0")).toBe(false);
    expect(satisfiesSdkRange("^0.2.0", "1.0.0")).toBe(false);
  });

  it("caret on 0.0: omitted patch means any 0.0.x (mirrors ^0.2)", () => {
    expect(satisfiesSdkRange("^0.0", "0.0.0")).toBe(true);
    expect(satisfiesSdkRange("^0.0", "0.0.7")).toBe(true);
    expect(satisfiesSdkRange("^0.0", "0.1.0")).toBe(false);
    expect(satisfiesSdkRange("^0.0", "1.0.0")).toBe(false);
    // 带 patch 时精确锚定该 patch（0.0.x 里 patch 即破坏性位）
    expect(satisfiesSdkRange("^0.0.3", "0.0.3")).toBe(true);
    expect(satisfiesSdkRange("^0.0.3", "0.0.4")).toBe(false);
  });

  it("caret on ≥1 anchors the major", () => {
    expect(satisfiesSdkRange("^1.2.0", "1.9.3")).toBe(true);
    expect(satisfiesSdkRange("^1.2.0", "2.0.0")).toBe(false);
  });

  it("tilde anchors major+minor", () => {
    expect(satisfiesSdkRange("~1.2.3", "1.2.9")).toBe(true);
    expect(satisfiesSdkRange("~1.2.3", "1.3.0")).toBe(false);
  });

  it(">= floor", () => {
    expect(satisfiesSdkRange(">=0.2.0", "1.0.0")).toBe(true);
    expect(satisfiesSdkRange(">=0.2.0", "0.1.9")).toBe(false);
  });

  it("garbage ranges reject rather than silently pass", () => {
    expect(satisfiesSdkRange("latest", "0.2.0")).toBe(false);
    expect(satisfiesSdkRange("0.2", "0.2.0")).toBe(false);
  });
});

describe("compareVersions", () => {
  it("compares dotted versions; missing segments count as 0", () => {
    expect(compareVersions("0.3.1", "0.3.0")).toBeGreaterThan(0);
    expect(compareVersions("0.3", "0.3.0")).toBe(0);
    expect(compareVersions("0.2.9", "0.10.0")).toBeLessThan(0);
  });

  it("throws a clear Error on non-numeric segments instead of returning NaN", () => {
    expect(() => compareVersions("0.a.1", "0.1.0")).toThrow(/non-numeric segment/);
    expect(() => compareVersions("0.1.0", "latest")).toThrow(/non-numeric segment/);
    expect(() => compareVersions("0..1", "0.1.0")).toThrow(/non-numeric segment/);
    expect(() => compareVersions("-1.0.0", "0.1.0")).toThrow(/non-numeric segment/);
  });
});
