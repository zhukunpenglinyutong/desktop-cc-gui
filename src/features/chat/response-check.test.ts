import { describe, expect, it } from "vitest";
import {
  checkResponseSelection,
  compareEffort,
  compareModel,
} from "./response-check";

describe("compareModel", () => {
  it("reads a provider-qualified id as the same model", () => {
    expect(compareModel("百倍baibei/claude-opus-5-5", "claude-opus-5-5")).toBe(
      "match",
    );
    expect(compareModel("claude-opus-5-5[1m]", "claude-opus-5-5")).toBe(
      "match",
    );
  });

  it("reads a dated snapshot as a variant of the requested family", () => {
    expect(compareModel("claude-opus-4-5", "claude-opus-4-5-20251101")).toBe(
      "variant",
    );
    expect(compareModel("claude-opus-4-5-latest", "claude-opus-4-5")).toBe(
      "variant",
    );
  });

  it("flags a different model", () => {
    expect(compareModel("gpt-6-astra", "gpt-5.6-luna")).toBe("mismatch");
    // A longer id that merely starts the same is not the same model.
    expect(compareModel("gpt-5", "gpt-5.6-luna")).toBe("mismatch");
  });

  it("stays unknown while either side has not reported", () => {
    expect(compareModel("gpt-6-astra", null)).toBe("unknown");
    expect(compareModel(null, "gpt-5.6-luna")).toBe("unknown");
    expect(compareModel(null, null)).toBe("unknown");
  });
});

describe("compareEffort", () => {
  it("ignores case and separators", () => {
    expect(compareEffort("xhigh", "XHigh")).toBe("match");
    expect(compareEffort("extra-high", "xhigh")).toBe("match");
    expect(compareEffort("high", "high")).toBe("match");
  });

  it("flags a downgraded or raised level", () => {
    expect(compareEffort("max", "low")).toBe("mismatch");
    expect(compareEffort("xhigh", "high")).toBe("mismatch");
    expect(compareEffort("high", null)).toBe("unknown");
  });
});

describe("checkResponseSelection", () => {
  it("compares an adapter-resolved alias without losing the selector", () => {
    const requested = {
      model: "opus",
      comparisonModel: "claude-opus-5-5",
      effort: "high",
    };
    expect(
      checkResponseSelection({
        requested,
        served: { model: "claude-opus-5-5", effort: null },
      }).verdict,
    ).toBe("match");
    expect(
      checkResponseSelection({
        requested,
        served: { model: "claude-opus-4-5", effort: null },
      }).verdict,
    ).toBe("mismatch");
    expect(
      checkResponseSelection({
        requested: { ...requested, comparisonModel: "custom-model" },
        served: { model: "custom-model", effort: null },
      }).verdict,
    ).toBe("match");
  });

  it("shows an unresolved alias as unknown, never a mismatch or pass", () => {
    const requested = { model: "opus", comparisonModel: null, effort: "high" };
    expect(
      checkResponseSelection({
        requested,
        served: { model: "claude-opus-5-5", effort: null },
      }),
    ).toEqual({
      model: "unknown",
      effort: "unknown",
      verdict: "unknown",
      visible: true,
    });
    expect(
      checkResponseSelection({
        requested,
        served: { model: "claude-opus-5-5", effort: "high" },
      }).verdict,
    ).toBe("unknown");
    expect(
      checkResponseSelection({
        requested,
        served: { model: null, effort: null },
      }).visible,
    ).toBe(false);
    expect(
      checkResponseSelection({
        requested,
        served: { model: "claude-opus-5-5", effort: "low" },
      }).verdict,
    ).toBe("mismatch");
  });

  it("reports a match when every reported side agrees", () => {
    const view = checkResponseSelection({
      requested: { model: "claude-opus-5-5", effort: "xhigh" },
      served: { model: "claude-opus-5-5", effort: "xhigh" },
    });
    expect(view).toEqual({
      model: "match",
      effort: "match",
      verdict: "match",
      visible: true,
    });
  });

  it("flags any reported disagreement", () => {
    const view = checkResponseSelection({
      requested: { model: "gpt-6-astra", effort: "max" },
      served: { model: "gpt-5.6-luna", effort: "max" },
    });
    expect(view.verdict).toBe("mismatch");
    expect(view.model).toBe("mismatch");
    expect(view.effort).toBe("match");
    expect(view.visible).toBe(true);
  });

  it("stays hidden when nothing was reported to compare", () => {
    expect(
      checkResponseSelection({
        requested: { model: "claude-opus-5-5", effort: "xhigh" },
        served: { model: null, effort: null },
      }).visible,
    ).toBe(false);
    expect(checkResponseSelection(null).visible).toBe(false);
  });

  it("never reads an unreported side as a match", () => {
    // The model matched, but the level was never echoed: the level row is
    // unknown, and the verdict rests on what was actually reported.
    const view = checkResponseSelection({
      requested: { model: "claude-opus-5-5", effort: "xhigh" },
      served: { model: "claude-opus-5-5", effort: null },
    });
    expect(view.effort).toBe("unknown");
    expect(view.verdict).toBe("match");
  });
});
