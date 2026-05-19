import type { EngineType, TokenUsageBreakdown } from "../../../types";
import type { PricingSource } from "../pricing/pricingTypes";

export type CostProjectionScope = "turn" | "session";

export type CostDegradationReason =
  | "pricing-unavailable"
  | "pricing-stale"
  | "usage-unavailable"
  | "block-level-cost-unsupported";

export type CostRecord = {
  engine: EngineType;
  model: string | null;
  scope: CostProjectionScope;
  usage: TokenUsageBreakdown;
  amountUsd: number | null;
  currency: "USD";
  pricingSource: PricingSource | null;
  degraded: boolean;
  degradationReason: CostDegradationReason | null;
};

export type EngineCostAggregate = {
  engine: EngineType;
  amountUsd: number | null;
  partial: boolean;
  records: readonly CostRecord[];
};

export type WorkspaceCostAggregate = {
  amountUsd: number | null;
  currency: "USD";
  partial: boolean;
  records: readonly CostRecord[];
  byEngine: readonly EngineCostAggregate[];
};
