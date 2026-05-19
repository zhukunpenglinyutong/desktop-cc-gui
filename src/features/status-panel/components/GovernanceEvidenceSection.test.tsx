// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GovernanceEvidenceSection } from "./GovernanceEvidenceSection";

describe("GovernanceEvidenceSection", () => {
  it("renders degraded empty state without mutation actions", () => {
    render(<GovernanceEvidenceSection evidence={[]} />);

    expect(screen.getByText("statusPanel.governance.title")).toBeTruthy();
    expect(screen.getByText("statusPanel.governance.empty")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders normalized evidence summaries read-only", () => {
    render(
      <GovernanceEvidenceSection
        evidence={[
          {
            id: "openspec:tasks",
            source: "openspec",
            status: "warn",
            degraded: false,
            updatedAt: "1970-01-01T00:00:00.000Z",
            title: "OpenSpec tasks",
            summary: "1/2 task(s) complete.",
          },
          {
            id: "workflow:governance",
            source: "workflow",
            status: "pass",
            degraded: false,
            updatedAt: "1970-01-01T00:00:00.000Z",
            title: "Governance workflows",
            summary: "2/2 required workflow(s) present.",
          },
        ]}
      />,
    );

    expect(screen.getByText("OpenSpec tasks")).toBeTruthy();
    expect(screen.getByText("1/2 task(s) complete.")).toBeTruthy();
    expect(screen.getByText("Governance workflows")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
