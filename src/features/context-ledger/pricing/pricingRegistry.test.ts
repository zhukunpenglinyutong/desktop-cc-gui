import { describe, expect, it } from "vitest";
import { lookupPricingSource } from "./pricingRegistry";

describe("pricingRegistry", () => {
  it("looks up traceable fixture pricing by engine and model", () => {
    const pricing = lookupPricingSource({
      engine: "gemini",
      model: "gemini-2.5-flash",
    });

    expect(pricing?.source).toMatchObject({
      engine: "gemini",
      model: "gemini-2.5-flash",
      source: "fixture",
      sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    });
    expect(pricing?.stale).toBe(false);
  });

  it("returns null instead of silently pricing unknown models as zero", () => {
    expect(
      lookupPricingSource({
        engine: "opencode",
        model: "unknown/provider-model",
      }),
    ).toBeNull();
  });

  it("marks fixture sources stale when the configured threshold is exceeded", () => {
    const pricing = lookupPricingSource(
      {
        engine: "codex",
        model: "gpt-5.4",
      },
      {
        now: new Date("2026-09-01T00:00:00.000Z"),
        staleAfterDays: 30,
      },
    );

    expect(pricing?.stale).toBe(true);
  });
});
