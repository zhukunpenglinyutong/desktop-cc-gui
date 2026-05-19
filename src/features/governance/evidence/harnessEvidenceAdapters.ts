import type { BudgetThresholdSignal } from "../../context-ledger/budget/budgetTypes";
import type { CostRecord } from "../../context-ledger/cost/costTypes";
import type { EngineCapabilityRuntimeStatus } from "../../engine/engineCapabilityMatrix";
import { normalizeGovernanceEvidenceId } from "./governanceEvidence";
import { createHarnessGovernanceEvidence } from "./governanceEvidenceBridge";
import type { GovernanceEvidence, GovernanceEvidenceStatus } from "./types";

export type GateEvidenceInput = {
  readonly id: string;
  readonly source:
    | "large-file"
    | "heavy-test-noise"
    | "realtime-harness"
    | "engine-runtime-contract";
  readonly status: GovernanceEvidenceStatus;
  readonly title: string;
  readonly summary: string;
  readonly sourcePath?: string;
  readonly updatedAt?: string;
  readonly degraded?: boolean;
  readonly degradationReason?: string;
  readonly payload?: GovernanceEvidence["payload"];
};

export type ConsolidatedHarnessGateDecision = {
  readonly id: string;
  readonly status: GovernanceEvidenceStatus;
  readonly contributions: readonly {
    readonly gateId: string;
    readonly source: GovernanceEvidence["source"];
    readonly status: GovernanceEvidenceStatus;
    readonly degradationReason?: string;
  }[];
};

type GateEvidencePayloadSource = GateEvidenceInput["source"];

const GATE_STATUS_ORDER: Record<GovernanceEvidenceStatus, number> = {
  pass: 0,
  unknown: 1,
  warn: 2,
  fail: 3,
};

function normalizeGateStatus(input: GateEvidenceInput): GovernanceEvidenceStatus {
  if (input.source === "heavy-test-noise" && input.status === "fail") {
    return "warn";
  }
  return input.status;
}

function createDefaultGatePayload(
  input: GateEvidenceInput,
): Extract<GovernanceEvidence["payload"], { kind: GateEvidencePayloadSource }> {
  const sourcePath = input.sourcePath
    ? normalizeGovernanceEvidenceId(input.sourcePath)
    : undefined;
  if (input.source === "large-file") {
    return {
      kind: "large-file",
      scope: input.status === "fail" ? "fail" : "warn",
      sourcePath,
    };
  }
  if (input.source === "heavy-test-noise") {
    return {
      kind: "heavy-test-noise",
      breachCount: input.status === "pass" ? 0 : 1,
      sourcePath,
    };
  }
  if (input.source === "realtime-harness") {
    return {
      kind: "realtime-harness",
      sourcePath,
    };
  }
  return {
    kind: "engine-runtime-contract",
    contractId: normalizeGovernanceEvidenceId(input.id),
    sourcePath,
  };
}

export function createGateGovernanceEvidence(input: GateEvidenceInput): GovernanceEvidence {
  const status = normalizeGateStatus(input);
  return createHarnessGovernanceEvidence({
    id: normalizeGovernanceEvidenceId(input.id),
    source: input.source,
    status,
    title: input.title,
    summary: input.summary,
    updatedAt: input.updatedAt,
    degraded: input.degraded ?? false,
    degradationReason: input.degradationReason,
    payload: input.payload ?? createDefaultGatePayload(input),
  });
}

export function createCostBudgetGovernanceEvidence(input: {
  sessionId: string;
  threshold: BudgetThresholdSignal;
  cost: CostRecord;
  updatedAt?: string;
}): GovernanceEvidence {
  const status = input.threshold.tier === "info" ? "pass" : "warn";
  return createHarnessGovernanceEvidence({
    id: `cost-budget:${normalizeGovernanceEvidenceId(input.sessionId)}`,
    source: "cost-budget",
    status,
    title: "Cost budget",
    summary: `${input.threshold.tier} budget tier crossed at ${input.threshold.amountUsd}/${input.threshold.thresholdUsd} USD.`,
    updatedAt: input.updatedAt,
    degraded: input.cost.degraded,
    degradationReason: input.cost.degradationReason ?? undefined,
    payload: {
      kind: "cost-budget",
      tier: input.threshold.tier,
      severity: input.threshold.severity,
      amountUsd: input.threshold.amountUsd,
      thresholdUsd: input.threshold.thresholdUsd,
      currency: "USD",
      pricingSource: input.cost.pricingSource?.source,
      shouldInterruptRuntime: false,
    },
  });
}

export function createCapabilityGovernanceEvidence(input: {
  status: EngineCapabilityRuntimeStatus;
  updatedAt?: string;
}): GovernanceEvidence {
  const isMismatch =
    input.status.specState === "supported" && input.status.runtimeState === "unsupported";
  const status: GovernanceEvidenceStatus =
    input.status.specState === "unknown" ? "unknown" : isMismatch ? "warn" : "pass";
  return createHarnessGovernanceEvidence({
    id: `engine-capability-matrix:${input.status.engine}:${input.status.capability}`,
    source: "engine-capability-matrix",
    status,
    title: "Engine capability matrix",
    summary: `${input.status.engine}.${input.status.capability} spec=${input.status.specState} runtime=${input.status.runtimeState}.`,
    updatedAt: input.updatedAt,
    degraded: status !== "pass",
    degradationReason: status === "pass" ? undefined : "capability-mismatch",
    payload: {
      kind: "engine-capability-matrix",
      engine: input.status.engine,
      capability: input.status.capability,
      specState: input.status.specState,
      runtimeState: input.status.runtimeState,
      available: input.status.available,
    },
  });
}

export function consolidateHarnessGateEvidence(
  evidence: readonly GovernanceEvidence[],
): ConsolidatedHarnessGateDecision {
  const gateEvidence = evidence.filter((entry) =>
    [
      "large-file",
      "heavy-test-noise",
      "realtime-harness",
      "engine-runtime-contract",
      "engine-capability-matrix",
    ].includes(entry.source),
  );
  const status = gateEvidence.reduce<GovernanceEvidenceStatus>((current, entry) => {
    return GATE_STATUS_ORDER[entry.status] > GATE_STATUS_ORDER[current] ? entry.status : current;
  }, "pass");

  return {
    id: "harness-governance-gate",
    status,
    contributions: gateEvidence.map((entry) => ({
      gateId: entry.id,
      source: entry.source,
      status: entry.status,
      degradationReason: entry.degradationReason,
    })),
  };
}
