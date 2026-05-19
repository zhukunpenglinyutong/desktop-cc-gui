import { createGovernanceEvidence } from "./governanceEvidence";
import { hasGovernancePath } from "./pathUtils";
import type { GovernanceEvidence, WorkspaceGovernanceSnapshot } from "./types";

const GOVERNANCE_WORKFLOWS = [
  ".github/workflows/large-file-governance.yml",
  ".github/workflows/heavy-test-noise-sentry.yml",
] as const;

export function readWorkflowEvidence(
  snapshot: Pick<WorkspaceGovernanceSnapshot, "files">,
): GovernanceEvidence[] {
  const present = GOVERNANCE_WORKFLOWS.filter((workflowPath) =>
    hasGovernancePath(snapshot.files, workflowPath),
  );

  return [
    createGovernanceEvidence({
      id: "workflow:governance",
      source: "workflow",
      status: present.length === GOVERNANCE_WORKFLOWS.length ? "pass" : "fail",
      title: "Governance workflows",
      summary: `${present.length}/${GOVERNANCE_WORKFLOWS.length} required workflow(s) present.`,
    }),
  ];
}

export const workflowEvidenceReaderInternals = {
  GOVERNANCE_WORKFLOWS,
};

