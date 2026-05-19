// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PolicyDecision } from "../../utils/policies";
import { PolicyDecisionAuditPanel } from "./PolicyDecisionAuditPanel";

const auditEntries: PolicyDecision[] = [
  {
    policyId: "corePolicy",
    verdictContribution: "needs_review",
    reasonKey: "statusPanel.policy.corePolicy.needsReview",
    sourceId: "core",
  },
  {
    policyId: "customPolicy",
    verdictContribution: "no_contribution",
    reasonKey: null,
    sourceId: null,
  },
];

describe("PolicyDecisionAuditPanel", () => {
  afterEach(() => cleanup());

  it("renders collapsed policy audit entries without side effects", () => {
    const { container } = render(<PolicyDecisionAuditPanel policyAudit={auditEntries} />);

    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(screen.getByText("statusPanel.audit.title")).toBeTruthy();
    expect(screen.getByText("statusPanel.audit.expandLabel")).toBeTruthy();
  });

  it("renders policy id, contribution, reason, and source id when expanded", () => {
    render(<PolicyDecisionAuditPanel policyAudit={auditEntries} />);

    fireEvent.click(screen.getByText("statusPanel.audit.title"));

    expect(screen.getByText("corePolicy")).toBeTruthy();
    expect(screen.getByText("statusPanel.policy.verdict.needs_review")).toBeTruthy();
    expect(screen.getByText("statusPanel.policy.corePolicy.needsReview")).toBeTruthy();
    expect(screen.getByText("core")).toBeTruthy();
  });

  it("renders safe fallbacks for incomplete policy decisions", () => {
    render(<PolicyDecisionAuditPanel policyAudit={auditEntries} />);

    fireEvent.click(screen.getByText("statusPanel.audit.title"));

    expect(screen.getByText("customPolicy")).toBeTruthy();
    expect(screen.getByText("statusPanel.policy.verdict.no_contribution")).toBeTruthy();
    expect(screen.getByText("statusPanel.audit.reasonUnavailable")).toBeTruthy();
    expect(screen.getByText("statusPanel.audit.sourceUnavailable")).toBeTruthy();
  });

  it("does not render an empty audit surface", () => {
    const { container } = render(<PolicyDecisionAuditPanel policyAudit={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders bridge snapshot metadata when present", () => {
    render(
      <PolicyDecisionAuditPanel
        policyAudit={[
          {
            policyId: "costBudgetGovernancePolicy",
            verdictContribution: "needs_review",
            reasonKey: "statusPanel.policy.costBudgetGovernancePolicy.fail",
            sourceId: "cost-budget",
            evidenceSnapshotId: "snapshot-1",
            degradationReason: "pricing-unavailable",
            staleAt: "2026-05-20T00:00:00.000Z",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.audit.title"));

    expect(screen.getByText("snapshot-1")).toBeTruthy();
    expect(screen.getByText("pricing-unavailable")).toBeTruthy();
    expect(screen.getByText("2026-05-20T00:00:00.000Z")).toBeTruthy();
  });
});
