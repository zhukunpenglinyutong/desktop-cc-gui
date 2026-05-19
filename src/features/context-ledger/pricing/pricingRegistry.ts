import { claudePricingFixture } from "./fixtures/claude";
import { codexPricingFixture } from "./fixtures/codex";
import { geminiPricingFixture } from "./fixtures/gemini";
import { opencodePricingFixture } from "./fixtures/opencode";
import type {
  PricingFixture,
  PricingLookupInput,
  PricingLookupOptions,
  PricingLookupResult,
  PricingSource,
} from "./pricingTypes";
import { DEFAULT_PRICING_STALE_AFTER_DAYS } from "./pricingTypes";

export const PRICING_FIXTURES: readonly PricingFixture[] = [
  claudePricingFixture,
  codexPricingFixture,
  geminiPricingFixture,
  opencodePricingFixture,
];

const MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4.5",
  opus: "claude-opus-4.5",
};

function normalizeModelId(model: string) {
  return model.trim().toLowerCase();
}

function resolveModelCandidates(model: string | null | undefined) {
  const normalized = normalizeModelId(model ?? "");
  if (!normalized) {
    return [];
  }
  return [normalized, MODEL_ALIASES[normalized]].filter(Boolean);
}

function isPricingStale(
  source: PricingSource,
  options: PricingLookupOptions,
) {
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_PRICING_STALE_AFTER_DAYS;
  const sourceTime = Date.parse(source.lastUpdatedAt);
  if (!Number.isFinite(sourceTime)) {
    return true;
  }
  const nowTime = (options.now ?? new Date()).getTime();
  const ageMs = Math.max(nowTime - sourceTime, 0);
  return ageMs > staleAfterDays * 24 * 60 * 60 * 1000;
}

export function listPricingSources() {
  return PRICING_FIXTURES.flatMap((fixture) => fixture.sources);
}

export function lookupPricingSource(
  input: PricingLookupInput,
  options: PricingLookupOptions = {},
): PricingLookupResult {
  const fixture = PRICING_FIXTURES.find((entry) => entry.engine === input.engine);
  if (!fixture) {
    return null;
  }

  const candidates = new Set(resolveModelCandidates(input.model));
  const source = fixture.sources.find((entry) => candidates.has(normalizeModelId(entry.model)));
  if (!source) {
    return null;
  }

  return {
    source,
    stale: source.source === "fixture" && isPricingStale(source, options),
  };
}
