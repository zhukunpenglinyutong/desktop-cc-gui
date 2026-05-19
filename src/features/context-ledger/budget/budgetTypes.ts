export type BudgetThresholdTier = "info" | "warn" | "block";

export type SessionBudgetConfig = {
  sessionId: string;
  currency: "USD";
  thresholdsUsd: {
    info: number;
    warn: number;
    block: number;
  };
};

export type BudgetThresholdSignal = {
  sessionId: string;
  tier: BudgetThresholdTier;
  severity: "info" | "warning" | "critical";
  amountUsd: number;
  thresholdUsd: number;
  shouldInterruptRuntime: false;
};
