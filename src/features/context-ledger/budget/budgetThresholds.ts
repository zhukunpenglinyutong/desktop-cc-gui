import type {
  BudgetThresholdSignal,
  BudgetThresholdTier,
  SessionBudgetConfig,
} from "./budgetTypes";

const TIER_ORDER: readonly BudgetThresholdTier[] = ["block", "warn", "info"];

function severityForTier(tier: BudgetThresholdTier): BudgetThresholdSignal["severity"] {
  if (tier === "block") {
    return "critical";
  }
  if (tier === "warn") {
    return "warning";
  }
  return "info";
}

function isUsableBudgetThreshold(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export function resolveBudgetThresholdSignal(input: {
  sessionId: string;
  amountUsd: number | null;
  budget: SessionBudgetConfig | null;
}): BudgetThresholdSignal | null {
  if (!input.budget || input.amountUsd == null || !Number.isFinite(input.amountUsd)) {
    return null;
  }

  for (const tier of TIER_ORDER) {
    const thresholdUsd = input.budget.thresholdsUsd[tier];
    if (!isUsableBudgetThreshold(thresholdUsd)) {
      continue;
    }
    if (input.amountUsd >= thresholdUsd) {
      return {
        sessionId: input.sessionId,
        tier,
        severity: severityForTier(tier),
        amountUsd: input.amountUsd,
        thresholdUsd,
        shouldInterruptRuntime: false,
      };
    }
  }

  return null;
}
