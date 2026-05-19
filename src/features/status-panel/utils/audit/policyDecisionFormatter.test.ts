import { describe, expect, it } from "vitest";
import type { PolicyDecision } from "../policies";
import { formatPolicyDecision } from "./policyDecisionFormatter";

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

function decision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    policyId: "customPolicy",
    verdictContribution: "needs_review",
    reasonKey: "statusPanel.policy.customPolicy.needsReview",
    sourceId: "validation:typecheck",
    ...overrides,
  };
}

describe("formatPolicyDecision", () => {
  it("formats the current policy decision fields", () => {
    const result = formatPolicyDecision(decision(), t);

    expect(result).toEqual({
      policyLabel: "customPolicy",
      verdictLabel: "statusPanel.policy.verdict.needs_review",
      reasonLabel: "statusPanel.policy.customPolicy.needsReview",
      sourceLabel: "validation:typecheck",
      evidenceSnapshotLabel: null,
      degradationLabel: null,
      staleLabel: null,
      hasSource: true,
    });
  });

  it("falls back when reason is missing", () => {
    const result = formatPolicyDecision(decision({ reasonKey: null }), t);

    expect(result.reasonLabel).toBe(
      'statusPanel.audit.reasonUnavailable:{"policy":"customPolicy"}',
    );
  });

  it("falls back when source id is missing or blank", () => {
    expect(formatPolicyDecision(decision({ sourceId: null }), t).sourceLabel).toBe(
      "statusPanel.audit.sourceUnavailable",
    );
    expect(formatPolicyDecision(decision({ sourceId: "   " }), t).hasSource).toBe(false);
  });

  it("handles no_contribution without inventing evidence", () => {
    const result = formatPolicyDecision(
      decision({ verdictContribution: "no_contribution", reasonKey: null, sourceId: null }),
      t,
    );

    expect(result.verdictLabel).toBe("statusPanel.policy.verdict.no_contribution");
    expect(result.reasonLabel).toContain("statusPanel.audit.reasonUnavailable");
    expect(result.hasSource).toBe(false);
  });

  it("keeps unknown policy ids as labels", () => {
    const result = formatPolicyDecision(decision({ policyId: "unknownPolicy" }), t);

    expect(result.policyLabel).toBe("unknownPolicy");
  });

  it("formats bridge-fed audit metadata defensively", () => {
    const result = formatPolicyDecision(
      decision({
        evidenceSnapshotId: "snapshot-1",
        degradationReason: "pricing-unavailable",
        staleAt: "2026-05-20T00:00:00.000Z",
      }),
      t,
    );

    expect(result.evidenceSnapshotLabel).toBe("snapshot-1");
    expect(result.degradationLabel).toBe("pricing-unavailable");
    expect(result.staleLabel).toBe("2026-05-20T00:00:00.000Z");
  });
});
