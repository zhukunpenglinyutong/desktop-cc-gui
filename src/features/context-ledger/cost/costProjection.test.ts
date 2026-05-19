import { describe, expect, it } from "vitest";
import type { ThreadTokenUsage } from "../../../types";
import { resolveBudgetThresholdSignal } from "../budget/budgetThresholds";
import type { SessionBudgetConfig } from "../budget/budgetTypes";
import { aggregateWorkspaceCost } from "./costAggregate";
import { buildUnsupportedBlockLevelCostRecord, projectCostRecord } from "./projectCost";

const usage: ThreadTokenUsage = {
  total: {
    totalTokens: 10_000,
    inputTokens: 6_000,
    cachedInputTokens: 1_000,
    outputTokens: 4_000,
    reasoningOutputTokens: 500,
  },
  last: {
    totalTokens: 2_000,
    inputTokens: 1_200,
    cachedInputTokens: 200,
    outputTokens: 800,
    reasoningOutputTokens: 100,
  },
  modelContextWindow: 200_000,
};

describe("context ledger cost projection", () => {
  it("projects turn cost from ThreadTokenUsage and embeds pricing source metadata", () => {
    const record = projectCostRecord({
      engine: "codex",
      model: "gpt-5.4",
      usage,
      scope: "turn",
    });

    expect(record.amountUsd).toBeCloseTo(0.01455, 6);
    expect(record.pricingSource).toMatchObject({
      engine: "codex",
      model: "gpt-5.4",
      source: "fixture",
      lastUpdatedAt: "2026-05-19T00:00:00.000Z",
    });
    expect(record.degraded).toBe(false);
  });

  it("produces degraded cost when pricing is unavailable", () => {
    const record = projectCostRecord({
      engine: "opencode",
      model: "unknown/provider-model",
      usage,
      scope: "session",
    });

    expect(record.amountUsd).toBeNull();
    expect(record.degraded).toBe(true);
    expect(record.degradationReason).toBe("pricing-unavailable");
  });

  it("marks workspace aggregates partial when any record is degraded", () => {
    const aggregate = aggregateWorkspaceCost([
      projectCostRecord({
        engine: "gemini",
        model: "gemini-2.5-flash",
        usage,
        scope: "turn",
      }),
      projectCostRecord({
        engine: "opencode",
        model: "unknown/provider-model",
        usage,
        scope: "turn",
      }),
    ]);

    expect(aggregate.partial).toBe(true);
    expect(aggregate.amountUsd).not.toBeNull();
    expect(aggregate.byEngine.map((entry) => [entry.engine, entry.partial])).toEqual([
      ["gemini", false],
      ["opencode", true],
    ]);
  });

  it("keeps block-level cost explicitly unsupported", () => {
    const record = buildUnsupportedBlockLevelCostRecord({
      engine: "claude",
      model: "claude-sonnet-4.5",
    });

    expect(record.degraded).toBe(true);
    expect(record.degradationReason).toBe("block-level-cost-unsupported");
    expect(record.amountUsd).toBeNull();
  });
});

describe("context ledger budget thresholds", () => {
  const budget: SessionBudgetConfig = {
    sessionId: "session-1",
    currency: "USD",
    thresholdsUsd: {
      info: 0.01,
      warn: 0.05,
      block: 0.1,
    },
  };

  it("emits info, warn, and block tiers without runtime interruption", () => {
    expect(
      resolveBudgetThresholdSignal({
        sessionId: "session-1",
        amountUsd: 0.02,
        budget,
      })?.tier,
    ).toBe("info");
    expect(
      resolveBudgetThresholdSignal({
        sessionId: "session-1",
        amountUsd: 0.07,
        budget,
      })?.tier,
    ).toBe("warn");
    expect(
      resolveBudgetThresholdSignal({
        sessionId: "session-1",
        amountUsd: 0.12,
        budget,
      }),
    ).toMatchObject({
      tier: "block",
      severity: "critical",
      shouldInterruptRuntime: false,
    });
  });

  it("does not emit a signal when no session budget exists", () => {
    expect(
      resolveBudgetThresholdSignal({
        sessionId: "session-1",
        amountUsd: 1,
        budget: null,
      }),
    ).toBeNull();
  });

  it("ignores invalid budget thresholds without false-positive escalation", () => {
    const invalidBudget: SessionBudgetConfig = {
      sessionId: "session-1",
      currency: "USD",
      thresholdsUsd: {
        info: 0.01,
        warn: Number.POSITIVE_INFINITY,
        block: -1,
      },
    };

    expect(
      resolveBudgetThresholdSignal({
        sessionId: "session-1",
        amountUsd: 0,
        budget: invalidBudget,
      }),
    ).toBeNull();
    expect(
      resolveBudgetThresholdSignal({
        sessionId: "session-1",
        amountUsd: 0.02,
        budget: invalidBudget,
      })?.tier,
    ).toBe("info");
  });
});
