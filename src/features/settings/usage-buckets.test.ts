import { describe, expect, it } from "vitest";
import { dayBuckets, monthBuckets } from "./usage-buckets";

describe("monthBuckets", () => {
  it("covers every month the range spans, oldest first", () => {
    expect(monthBuckets("2026-01-01", "2026-09-19").map((b) => b.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("rolls across a year boundary", () => {
    expect(monthBuckets("2025-11-15", "2026-02-03").map((b) => b.key)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("labels the axis with the month and the tooltip with year and month", () => {
    expect(monthBuckets("2026-01-05", "2026-01-31")).toEqual([
      { key: "2026-01", axis: "01", title: "2026-01" },
    ]);
  });
});

describe("dayBuckets", () => {
  it("keeps the full date for the tooltip and MM-DD on the axis", () => {
    expect(dayBuckets(["2026-09-19"])).toEqual([
      { key: "2026-09-19", axis: "09-19", title: "2026-09-19" },
    ]);
  });
});
