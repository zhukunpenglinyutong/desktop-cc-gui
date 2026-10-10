import { describe, expect, it } from "vitest";
import {
  bareOneM,
  hasOneM,
  matchCatalogRow,
  showsOneMContext,
  withOneM,
} from "./one-m-context";

describe("one-m context suffix", () => {
  it("recognizes only a trailing [1m]", () => {
    expect(hasOneM("deepseek-v4-pro[1m]")).toBe(true);
    expect(hasOneM("deepseek-v4-pro")).toBe(false);
    expect(hasOneM("[1m]")).toBe(true);
    expect(hasOneM("")).toBe(false);
    // Mid-string occurrences are not the suffix.
    expect(hasOneM("a[1m]b")).toBe(false);
  });

  it("strips the suffix and leaves bare ids untouched", () => {
    expect(bareOneM("deepseek-v4-pro[1m]")).toBe("deepseek-v4-pro");
    expect(bareOneM("deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(bareOneM("[1m]")).toBe("");
  });

  it("adds and removes the suffix idempotently", () => {
    expect(withOneM("k3", true)).toBe("k3[1m]");
    expect(withOneM("k3", false)).toBe("k3");
    expect(withOneM("k3[1m]", true)).toBe("k3[1m]");
    expect(withOneM("k3[1m]", false)).toBe("k3");
    // An empty selection has nothing to tag.
    expect(withOneM("", true)).toBe("");
    expect(withOneM("", false)).toBe("");
  });

  it("shows the toggle only for a Claude custom/channel model", () => {
    expect(showsOneMContext("claude", "deepseek-v4-pro")).toBe(true);
    // Already tagged still shows it, so the switch can be turned back off.
    expect(showsOneMContext("claude", "deepseek-v4-pro[1m]")).toBe(true);
    // CLI alias rows belong to the CLI's own mapping — no toggle.
    for (const alias of ["default", "opus", "fable", "sonnet", "haiku"]) {
      expect(showsOneMContext("claude", alias)).toBe(false);
    }
    // Other engines have no [1m] semantics.
    expect(showsOneMContext("codex", "gpt-6")).toBe(false);
    expect(showsOneMContext("omp", "openai/gpt-5")).toBe(false);
    // Nothing selected.
    expect(showsOneMContext("claude", "")).toBe(false);
  });
});

describe("matchCatalogRow", () => {
  const rows = [{ id: "dp" }, { id: "k3" }];

  it("maps a tagged pick onto its bare catalog row (same row, no extra entry)", () => {
    // The session runs dp[1m]; the row that represents it is `dp`, marked 1M.
    expect(matchCatalogRow(rows, "dp[1m]")).toEqual({ id: "dp", tagged: true });
  });

  it("exact-hits an untagged or already-tagged catalog id", () => {
    expect(matchCatalogRow(rows, "dp")).toEqual({ id: "dp", tagged: false });
    const tagged = [...rows, { id: "dp[1m]" }];
    expect(matchCatalogRow(tagged, "dp[1m]")).toEqual({ id: "dp[1m]", tagged: false });
  });

  it("falls back to the selection when no catalog row matches", () => {
    expect(matchCatalogRow(rows, "missing[1m]")).toEqual({
      id: "missing[1m]",
      tagged: false,
    });
    expect(matchCatalogRow(rows, "")).toEqual({ id: "", tagged: false });
  });
});
