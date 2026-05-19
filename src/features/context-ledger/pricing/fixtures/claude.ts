import type { PricingFixture } from "../pricingTypes";

const ANTHROPIC_PRICING_URL = "https://docs.anthropic.com/en/docs/about-claude/pricing";
const ANTHROPIC_UPDATED_AT = "2026-05-19T00:00:00.000Z";

export const claudePricingFixture: PricingFixture = {
  engine: "claude",
  sources: [
    {
      engine: "claude",
      model: "claude-sonnet-4.5",
      source: "fixture",
      sourceUrl: ANTHROPIC_PRICING_URL,
      lastUpdatedAt: ANTHROPIC_UPDATED_AT,
      ratesUsdPerMillion: {
        input: 3,
        cachedInput: 0.3,
        output: 15,
        reasoningOutput: 15,
      },
    },
    {
      engine: "claude",
      model: "claude-opus-4.5",
      source: "fixture",
      sourceUrl: ANTHROPIC_PRICING_URL,
      lastUpdatedAt: ANTHROPIC_UPDATED_AT,
      ratesUsdPerMillion: {
        input: 5,
        cachedInput: 0.5,
        output: 25,
        reasoningOutput: 25,
      },
    },
  ],
};
