import { describe, expect, it } from "vitest";
import {
  createFrozenGovernanceEvidenceSnapshot,
  createHarnessGovernanceEvidence,
} from "../../../governance/evidence";
import {
  bridgeGovernancePolicies,
  costBudgetGovernancePolicy,
} from "./bridgeGovernancePolicies";
import type { CheckpointPolicyEvidence } from "./policyTypes";

function baseEvidence(overrides: Partial<CheckpointPolicyEvidence> = {}): CheckpointPolicyEvidence {
  return {
    failedCommand: null,
    failedCommandKind: null,
    failedSubagent: null,
    failedValidation: null,
    fileChanges: [],
    governanceSnapshot: null,
    hasCompletedSubagentSet: false,
    hasCompletedTodoSet: false,
    hasEvidence: true,
    hasReadyValidations: false,
    hasRunningCommand: false,
    hasRunningSubagent: false,
    hasSuccessfulCommand: false,
    hasInProgressTodo: false,
    isProcessing: false,
    requiredKinds: ["lint", "typecheck", "tests"],
    validations: [],
    ...overrides,
  };
}

describe("bridge governance policies", () => {
  it("consume injected frozen snapshots without blocked contribution", () => {
    const snapshot = createFrozenGovernanceEvidenceSnapshot({
      id: "snapshot-1",
      evidence: [
        createHarnessGovernanceEvidence({
          id: "cost-budget:session-1",
          source: "cost-budget",
          status: "fail",
          title: "Cost budget",
          summary: "Block tier crossed",
          payload: {
            kind: "cost-budget",
            tier: "block",
            severity: "critical",
            amountUsd: 12,
            thresholdUsd: 10,
            currency: "USD",
            pricingSource: "fixture",
            shouldInterruptRuntime: false,
          },
        }),
      ],
    });

    const decision = costBudgetGovernancePolicy.evaluate(
      baseEvidence({ governanceSnapshot: snapshot }),
    );

    expect(decision).toMatchObject({
      policyId: "costBudgetGovernancePolicy",
      verdictContribution: "needs_review",
      reasonKey: "statusPanel.policy.costBudgetGovernancePolicy.fail",
      sourceId: "cost-budget",
      evidenceSnapshotId: "snapshot-1",
    });
    expect(decision.verdictContribution).not.toBe("blocked");
  });

  it("registers the expected second-batch bridge-fed policies", () => {
    expect(bridgeGovernancePolicies.map((policy) => policy.id)).toEqual([
      "openspecGovernancePolicy",
      "largeFileGovernancePolicy",
      "heavyTestNoiseGovernancePolicy",
      "realtimeHarnessGovernancePolicy",
      "capabilityMismatchGovernancePolicy",
      "costBudgetGovernancePolicy",
    ]);
  });
});
