import { readOpenSpecEvidence } from "./openspecEvidenceReader";
import { readScriptEvidence } from "./scriptEvidenceReader";
import { readTrellisEvidence } from "./trellisEvidenceReader";
import type { GovernanceEvidence, WorkspaceGovernanceSnapshot } from "./types";
import { readWorkflowEvidence } from "./workflowEvidenceReader";

export async function collectGovernanceEvidence(
  snapshot: WorkspaceGovernanceSnapshot,
): Promise<GovernanceEvidence[]> {
  const [openspecEvidence, scriptEvidence, trellisEvidence] = await Promise.all([
    readOpenSpecEvidence(snapshot),
    readScriptEvidence(snapshot),
    readTrellisEvidence(snapshot),
  ]);

  return [
    ...openspecEvidence,
    ...scriptEvidence,
    ...readWorkflowEvidence(snapshot),
    ...trellisEvidence,
  ];
}

