import type { GovernanceEvidence } from "../../../governance/evidence";
import type {
  CheckpointPolicyEvidence,
  Policy,
  PolicyDecision,
  PolicyVerdictContribution,
} from "./policyTypes";

type BridgePolicyConfig = {
  id: string;
  source: GovernanceEvidence["source"];
  maxFailContribution?: Extract<PolicyVerdictContribution, "needs_review" | "running" | "ready">;
};

function contributionForEvidence(
  evidence: GovernanceEvidence,
  maxFailContribution: Extract<PolicyVerdictContribution, "needs_review" | "running" | "ready">,
): PolicyVerdictContribution {
  if (evidence.status === "pass") {
    return "ready";
  }
  if (evidence.status === "fail" || evidence.status === "warn" || evidence.status === "unknown") {
    return maxFailContribution;
  }
  return "no_contribution";
}

function findEvidenceBySource(
  evidence: CheckpointPolicyEvidence,
  source: GovernanceEvidence["source"],
): GovernanceEvidence | null {
  return evidence.governanceSnapshot?.evidence.find((entry) => entry.source === source) ?? null;
}

function decisionFromEvidence(
  policyId: string,
  snapshotId: string,
  evidence: GovernanceEvidence,
  maxFailContribution: Extract<PolicyVerdictContribution, "needs_review" | "running" | "ready">,
): PolicyDecision {
  return {
    policyId,
    verdictContribution: contributionForEvidence(evidence, maxFailContribution),
    reasonKey: `statusPanel.policy.${policyId}.${evidence.status}`,
    sourceId: evidence.source,
    evidenceSnapshotId: snapshotId,
    degradationReason: evidence.degradationReason,
    staleAt: evidence.staleAt,
  };
}

function createBridgeGovernancePolicy(config: BridgePolicyConfig): Policy {
  const maxFailContribution = config.maxFailContribution ?? "needs_review";
  return {
    id: config.id,
    appliesTo(evidence) {
      return findEvidenceBySource(evidence, config.source) != null;
    },
    evaluate(evidence) {
      const snapshot = evidence.governanceSnapshot;
      const sourceEvidence = findEvidenceBySource(evidence, config.source);
      if (!snapshot || !sourceEvidence) {
        return {
          policyId: config.id,
          verdictContribution: "no_contribution",
          reasonKey: null,
          sourceId: null,
        };
      }
      return decisionFromEvidence(config.id, snapshot.id, sourceEvidence, maxFailContribution);
    },
  };
}

export const openspecGovernancePolicy = createBridgeGovernancePolicy({
  id: "openspecGovernancePolicy",
  source: "openspec",
});

export const largeFileGovernancePolicy = createBridgeGovernancePolicy({
  id: "largeFileGovernancePolicy",
  source: "large-file",
});

export const heavyTestNoiseGovernancePolicy = createBridgeGovernancePolicy({
  id: "heavyTestNoiseGovernancePolicy",
  source: "heavy-test-noise",
});

export const realtimeHarnessGovernancePolicy = createBridgeGovernancePolicy({
  id: "realtimeHarnessGovernancePolicy",
  source: "realtime-harness",
});

export const capabilityMismatchGovernancePolicy = createBridgeGovernancePolicy({
  id: "capabilityMismatchGovernancePolicy",
  source: "engine-capability-matrix",
});

export const costBudgetGovernancePolicy = createBridgeGovernancePolicy({
  id: "costBudgetGovernancePolicy",
  source: "cost-budget",
});

export const bridgeGovernancePolicies = [
  openspecGovernancePolicy,
  largeFileGovernancePolicy,
  heavyTestNoiseGovernancePolicy,
  realtimeHarnessGovernancePolicy,
  capabilityMismatchGovernancePolicy,
  costBudgetGovernancePolicy,
] as const;
