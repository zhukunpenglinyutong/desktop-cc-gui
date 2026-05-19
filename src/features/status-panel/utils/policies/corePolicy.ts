import type { CheckpointVerdict } from "../../types";
import type { CheckpointPolicyEvidence, Policy, PolicyDecision } from "./policyTypes";

function decision(
  verdictContribution: PolicyDecision["verdictContribution"],
  reasonKey: string | null,
  sourceId: string | null,
): PolicyDecision {
  return {
    policyId: corePolicy.id,
    verdictContribution,
    reasonKey,
    sourceId,
  };
}

export function resolveCoreCheckpointVerdict(input: CheckpointPolicyEvidence): CheckpointVerdict {
  if (input.failedSubagent) {
    return "blocked";
  }
  if (
    input.failedValidation &&
    input.requiredKinds.includes(input.failedValidation.kind)
  ) {
    return "blocked";
  }
  if (
    input.failedCommand &&
    input.failedCommandKind &&
    input.failedCommandKind !== "custom" &&
    input.requiredKinds.includes(input.failedCommandKind)
  ) {
    return "blocked";
  }

  if (
    input.isProcessing ||
    input.hasRunningCommand ||
    input.hasRunningSubagent ||
    input.hasInProgressTodo
  ) {
    return "running";
  }

  if (!input.hasEvidence) {
    return "needs_review";
  }

  if (
    (input.fileChanges.length > 0 && input.hasReadyValidations) ||
    (input.fileChanges.length === 0 &&
      (input.hasSuccessfulCommand || input.hasCompletedTodoSet || input.hasCompletedSubagentSet))
  ) {
    return "ready";
  }

  return "needs_review";
}

export const corePolicy: Policy = {
  id: "corePolicy",
  appliesTo() {
    return true;
  },
  evaluate(evidence) {
    const verdict = resolveCoreCheckpointVerdict(evidence);
    if (verdict === "blocked") {
      return decision("blocked", "statusPanel.policy.corePolicy.blocked", null);
    }
    if (verdict === "running") {
      return decision("running", "statusPanel.policy.corePolicy.running", null);
    }
    if (verdict === "ready") {
      return decision("ready", "statusPanel.policy.corePolicy.ready", null);
    }
    return decision("needs_review", "statusPanel.policy.corePolicy.needsReview", null);
  },
};
