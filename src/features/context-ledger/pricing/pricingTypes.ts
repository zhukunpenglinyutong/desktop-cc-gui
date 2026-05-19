import type { EngineType } from "../../../types";

export type PricingSourceKind = "fixture" | "config" | "remote";

export type TokenPricingRatesUsdPerMillion = {
  input: number;
  cachedInput: number | null;
  output: number;
  reasoningOutput: number | null;
};

export type PricingSource = {
  engine: EngineType;
  model: string;
  source: PricingSourceKind;
  sourceUrl: string | null;
  lastUpdatedAt: string;
  ratesUsdPerMillion: TokenPricingRatesUsdPerMillion;
};

export type PricingFixture = {
  engine: EngineType;
  sources: readonly PricingSource[];
};

export type PricingLookupInput = {
  engine: EngineType;
  model: string | null | undefined;
};

export type PricingLookupOptions = {
  now?: Date;
  staleAfterDays?: number;
};

export type PricingLookupResult =
  | {
      source: PricingSource;
      stale: boolean;
    }
  | null;

export const DEFAULT_PRICING_STALE_AFTER_DAYS = 90;
