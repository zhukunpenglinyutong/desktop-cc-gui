import type { CheckpointValidationEvidence, CheckpointValidationKind } from "../../types";
import type { Policy, PolicyDecision } from "./policyTypes";

function findValidation(
  validations: readonly CheckpointValidationEvidence[],
  kind: CheckpointValidationKind,
) {
  return validations.find((entry) => entry.kind === kind) ?? null;
}

function contributionForValidation(
  policyId: string,
  validation: CheckpointValidationEvidence | null,
): PolicyDecision {
  if (!validation || validation.status === "not_observed") {
    return {
      policyId,
      verdictContribution: "no_contribution",
      reasonKey: null,
      sourceId: null,
    };
  }
  if (validation.status === "pass") {
    return {
      policyId,
      verdictContribution: "ready",
      reasonKey: `statusPanel.policy.${policyId}.pass`,
      sourceId: validation.sourceId,
    };
  }
  if (validation.status === "running") {
    return {
      policyId,
      verdictContribution: "running",
      reasonKey: `statusPanel.policy.${policyId}.running`,
      sourceId: validation.sourceId,
    };
  }
  return {
    policyId,
    verdictContribution: "needs_review",
    reasonKey: `statusPanel.policy.${policyId}.${validation.status === "fail" ? "fail" : "notRun"}`,
    sourceId: validation.sourceId,
  };
}

function createValidationPolicy(
  id: string,
  kind: Extract<CheckpointValidationKind, "lint" | "typecheck" | "tests">,
): Policy {
  return {
    id,
    appliesTo(evidence) {
      return findValidation(evidence.validations, kind) != null;
    },
    evaluate(evidence) {
      if (
        evidence.isProcessing ||
        evidence.hasRunningCommand ||
        evidence.hasRunningSubagent ||
        evidence.hasInProgressTodo
      ) {
        return {
          policyId: id,
          verdictContribution: "no_contribution",
          reasonKey: null,
          sourceId: null,
        };
      }
      return contributionForValidation(id, findValidation(evidence.validations, kind));
    },
  };
}

export const lintValidationPolicy = createValidationPolicy("lintValidationPolicy", "lint");
export const typecheckValidationPolicy = createValidationPolicy(
  "typecheckValidationPolicy",
  "typecheck",
);
export const testsValidationPolicy = createValidationPolicy("testsValidationPolicy", "tests");
