import type { EngineType, ThreadTokenUsage, TokenUsageBreakdown } from "../../../types";
import { lookupPricingSource } from "../pricing/pricingRegistry";
import type { PricingLookupOptions } from "../pricing/pricingTypes";
import type { CostRecord, CostProjectionScope } from "./costTypes";

const TOKENS_PER_MILLION = 1_000_000;

function clampTokenCount(value: number) {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function resolvePaidInputTokens(usage: TokenUsageBreakdown) {
  return Math.max(clampTokenCount(usage.inputTokens) - clampTokenCount(usage.cachedInputTokens), 0);
}

function calculateUsdAmount(
  usage: TokenUsageBreakdown,
  rates: NonNullable<ReturnType<typeof lookupPricingSource>>["source"]["ratesUsdPerMillion"],
) {
  const paidInputTokens = resolvePaidInputTokens(usage);
  const cachedInputTokens = clampTokenCount(usage.cachedInputTokens);
  const outputTokens = clampTokenCount(usage.outputTokens);
  const reasoningTokens = clampTokenCount(usage.reasoningOutputTokens);
  const visibleOutputTokens = Math.max(outputTokens - reasoningTokens, 0);

  const inputCost = paidInputTokens * rates.input;
  const cachedInputCost = cachedInputTokens * (rates.cachedInput ?? rates.input);
  const outputCost = visibleOutputTokens * rates.output;
  const reasoningCost = reasoningTokens * (rates.reasoningOutput ?? rates.output);

  return (inputCost + cachedInputCost + outputCost + reasoningCost) / TOKENS_PER_MILLION;
}

export function buildUnsupportedBlockLevelCostRecord(input: {
  engine: EngineType;
  model?: string | null;
  scope?: CostProjectionScope;
}): CostRecord {
  return {
    engine: input.engine,
    model: input.model ?? null,
    scope: input.scope ?? "turn",
    usage: {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    amountUsd: null,
    currency: "USD",
    pricingSource: null,
    degraded: true,
    degradationReason: "block-level-cost-unsupported",
  };
}

export function projectCostRecord(input: {
  engine: EngineType;
  model?: string | null;
  usage: ThreadTokenUsage | null | undefined;
  scope: CostProjectionScope;
  pricingOptions?: PricingLookupOptions;
}): CostRecord {
  const usageBreakdown = input.usage?.[input.scope === "turn" ? "last" : "total"];
  if (!usageBreakdown) {
    return {
      engine: input.engine,
      model: input.model ?? null,
      scope: input.scope,
      usage: {
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      amountUsd: null,
      currency: "USD",
      pricingSource: null,
      degraded: true,
      degradationReason: "usage-unavailable",
    };
  }

  const pricing = lookupPricingSource(
    {
      engine: input.engine,
      model: input.model,
    },
    input.pricingOptions,
  );
  if (!pricing) {
    return {
      engine: input.engine,
      model: input.model ?? null,
      scope: input.scope,
      usage: usageBreakdown,
      amountUsd: null,
      currency: "USD",
      pricingSource: null,
      degraded: true,
      degradationReason: "pricing-unavailable",
    };
  }

  return {
    engine: input.engine,
    model: input.model ?? null,
    scope: input.scope,
    usage: usageBreakdown,
    amountUsd: calculateUsdAmount(usageBreakdown, pricing.source.ratesUsdPerMillion),
    currency: "USD",
    pricingSource: pricing.source,
    degraded: pricing.stale,
    degradationReason: pricing.stale ? "pricing-stale" : null,
  };
}
