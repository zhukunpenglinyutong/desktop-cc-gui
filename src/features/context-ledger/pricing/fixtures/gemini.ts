import type { PricingFixture } from "../pricingTypes";

const GEMINI_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing";
const GEMINI_UPDATED_AT = "2026-05-19T00:00:00.000Z";

export const geminiPricingFixture: PricingFixture = {
  engine: "gemini",
  sources: [
    {
      engine: "gemini",
      model: "gemini-2.5-pro",
      source: "fixture",
      sourceUrl: GEMINI_PRICING_URL,
      lastUpdatedAt: GEMINI_UPDATED_AT,
      ratesUsdPerMillion: {
        input: 1.25,
        cachedInput: 0.31,
        output: 10,
        reasoningOutput: 10,
      },
    },
    {
      engine: "gemini",
      model: "gemini-2.5-flash",
      source: "fixture",
      sourceUrl: GEMINI_PRICING_URL,
      lastUpdatedAt: GEMINI_UPDATED_AT,
      ratesUsdPerMillion: {
        input: 0.3,
        cachedInput: 0.075,
        output: 2.5,
        reasoningOutput: 2.5,
      },
    },
  ],
};
