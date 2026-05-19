import type { PricingFixture } from "../pricingTypes";

const OPENAI_PRICING_URL = "https://openai.com/api/pricing/";
const OPENAI_UPDATED_AT = "2026-05-19T00:00:00.000Z";

export const codexPricingFixture: PricingFixture = {
  engine: "codex",
  sources: [
    {
      engine: "codex",
      model: "gpt-5.4",
      source: "fixture",
      sourceUrl: OPENAI_PRICING_URL,
      lastUpdatedAt: OPENAI_UPDATED_AT,
      ratesUsdPerMillion: {
        input: 2.5,
        cachedInput: 0.25,
        output: 15,
        reasoningOutput: 15,
      },
    },
  ],
};
