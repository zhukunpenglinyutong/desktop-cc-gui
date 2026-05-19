import { describe, expect, it } from "vitest";
import type { CheckpointPolicyEvidence } from "./policyTypes";
import {
  lintValidationPolicy,
  testsValidationPolicy,
  typecheckValidationPolicy,
} from "./validationPolicies";

function evidenceFor(
  kind: "lint" | "typecheck" | "tests",
  status: "pass" | "fail" | "running" | "not_run" | "not_observed",
): CheckpointPolicyEvidence {
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
    validations: [{ kind, status, sourceId: `${kind}-1` }],
  };
}

describe("validation policies", () => {
  it("maps pass, fail, running, not_run, and not_observed without blocked contribution", () => {
    for (const status of ["pass", "fail", "running", "not_run", "not_observed"] as const) {
      const decision = lintValidationPolicy.evaluate(evidenceFor("lint", status));
      expect(decision.verdictContribution).not.toBe("blocked");
    }

    expect(lintValidationPolicy.evaluate(evidenceFor("lint", "pass")).verdictContribution).toBe(
      "ready",
    );
    expect(lintValidationPolicy.evaluate(evidenceFor("lint", "fail")).verdictContribution).toBe(
      "needs_review",
    );
    expect(lintValidationPolicy.evaluate(evidenceFor("lint", "running")).verdictContribution).toBe(
      "running",
    );
    expect(lintValidationPolicy.evaluate(evidenceFor("lint", "not_run")).verdictContribution).toBe(
      "needs_review",
    );
    expect(
      lintValidationPolicy.evaluate(evidenceFor("lint", "not_observed")).verdictContribution,
    ).toBe("no_contribution");
  });

  it("targets lint, typecheck, and tests independently", () => {
    expect(lintValidationPolicy.appliesTo(evidenceFor("lint", "pass"))).toBe(true);
    expect(typecheckValidationPolicy.appliesTo(evidenceFor("typecheck", "pass"))).toBe(true);
    expect(testsValidationPolicy.appliesTo(evidenceFor("tests", "pass"))).toBe(true);
    expect(testsValidationPolicy.appliesTo(evidenceFor("lint", "pass"))).toBe(false);
  });

  it("does not downgrade an in-flight checkpoint with missing validation evidence", () => {
    const decision = lintValidationPolicy.evaluate({
      ...evidenceFor("lint", "not_run"),
      hasRunningCommand: true,
    });

    expect(decision.verdictContribution).toBe("no_contribution");
  });
});
