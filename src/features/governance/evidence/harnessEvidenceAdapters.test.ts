import { describe, expect, it } from "vitest";
import { resolveBudgetThresholdSignal } from "../../context-ledger/budget/budgetThresholds";
import type { CostRecord } from "../../context-ledger/cost/costTypes";
import type { EngineCapabilityRuntimeStatus } from "../../engine/engineCapabilityMatrix";
import {
  consolidateHarnessGateEvidence,
  createCapabilityGovernanceEvidence,
  createCostBudgetGovernanceEvidence,
  createGateGovernanceEvidence,
} from "./harnessEvidenceAdapters";

const costRecord: CostRecord = {
  engine: "codex",
  model: "gpt-5",
  scope: "session",
  usage: {
    totalTokens: 1000,
    inputTokens: 500,
    cachedInputTokens: 0,
    outputTokens: 500,
    reasoningOutputTokens: 0,
  },
  amountUsd: 12,
  currency: "USD",
  pricingSource: {
    engine: "codex",
    model: "gpt-5",
    source: "fixture",
    sourceUrl: null,
    lastUpdatedAt: "2026-05-20T00:00:00.000Z",
    ratesUsdPerMillion: {
      input: 1,
      cachedInput: null,
      output: 1,
      reasoningOutput: null,
    },
  },
  degraded: false,
  degradationReason: null,
};

describe("harness evidence adapters", () => {
  it("emits cost-budget evidence from existing threshold signal without runtime interruption", () => {
    const threshold = resolveBudgetThresholdSignal({
      sessionId: "session-1",
      amountUsd: 12,
      budget: {
        sessionId: "session-1",
        currency: "USD",
        thresholdsUsd: {
          info: 1,
          warn: 5,
          block: 10,
        },
      },
    });

    expect(threshold?.shouldInterruptRuntime).toBe(false);
    expect(
      createCostBudgetGovernanceEvidence({
        sessionId: "session-1",
        threshold: threshold!,
        cost: costRecord,
      }),
    ).toMatchObject({
      id: "cost-budget:session-1",
      source: "cost-budget",
      status: "warn",
      payload: {
        kind: "cost-budget",
        tier: "block",
        shouldInterruptRuntime: false,
      },
    });
  });

  it("reuses capability runtime status semantics for matrix evidence", () => {
    const status: EngineCapabilityRuntimeStatus = {
      engine: "codex",
      capability: "collaboration.mode",
      specState: "supported",
      runtimeState: "unsupported",
      available: false,
    };

    expect(createCapabilityGovernanceEvidence({ status })).toMatchObject({
      source: "engine-capability-matrix",
      status: "warn",
      degraded: true,
      payload: {
        specState: "supported",
        runtimeState: "unsupported",
        available: false,
      },
    });
  });

  it("normalizes paths and preserves severity for consolidated harness gates", () => {
    const largeFile = createGateGovernanceEvidence({
      id: "large-file:C:\\Users\\dev\\repo\\src\\features\\x.ts",
      source: "large-file",
      status: "warn",
      title: "Large file",
      summary: "Near threshold",
      sourcePath: "C:\\Users\\dev\\repo\\src\\features\\x.ts",
    });
    const realtime = createGateGovernanceEvidence({
      id: "engine-runtime-contract:replay",
      source: "engine-runtime-contract",
      status: "fail",
      title: "Replay",
      summary: "Diverged",
    });

    expect(largeFile.id).toBe("large-file:src/features/x.ts");
    expect(largeFile.payload).toMatchObject({
      kind: "large-file",
      scope: "warn",
      sourcePath: "src/features/x.ts",
    });
    expect(consolidateHarnessGateEvidence([largeFile, realtime])).toMatchObject({
      id: "harness-governance-gate",
      status: "fail",
      contributions: [
        {
          gateId: "large-file:src/features/x.ts",
          source: "large-file",
          status: "warn",
        },
        {
          gateId: "engine-runtime-contract:replay",
          source: "engine-runtime-contract",
          status: "fail",
        },
      ],
    });
  });

  it("keeps heavy-test-noise advisory even when raw sentry status is fail", () => {
    expect(
      createGateGovernanceEvidence({
        id: "heavy-test-noise:.artifacts\\heavy-test-noise.log",
        source: "heavy-test-noise",
        status: "fail",
        title: "Heavy test noise",
        summary: "Noise breach",
        sourcePath: ".artifacts\\heavy-test-noise.log",
      }),
    ).toMatchObject({
      id: "heavy-test-noise:.artifacts/heavy-test-noise.log",
      source: "heavy-test-noise",
      status: "warn",
      payload: {
        kind: "heavy-test-noise",
        breachCount: 1,
        sourcePath: ".artifacts/heavy-test-noise.log",
      },
    });
  });

  it("fills required default payload fields for every gate source", () => {
    expect(
      createGateGovernanceEvidence({
        id: "engine-runtime-contract:replay",
        source: "engine-runtime-contract",
        status: "fail",
        title: "Replay",
        summary: "Diverged",
      }).payload,
    ).toMatchObject({
      kind: "engine-runtime-contract",
      contractId: "engine-runtime-contract:replay",
    });
    expect(
      createGateGovernanceEvidence({
        id: "realtime-harness:default",
        source: "realtime-harness",
        status: "pass",
        title: "Realtime",
        summary: "ok",
      }).payload,
    ).toEqual({
      kind: "realtime-harness",
      sourcePath: undefined,
    });
  });
});
