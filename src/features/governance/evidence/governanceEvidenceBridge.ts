import {
  createGovernanceEvidence,
  createGovernanceEvidenceSnapshot,
  normalizeGovernanceEvidenceId,
} from "./governanceEvidence";
import type {
  GovernanceEvidence,
  GovernanceEvidenceSnapshot,
  GovernanceEvidenceStatus,
  HarnessGovernanceEvidenceSource,
} from "./types";

export type GovernanceEvidenceAdapterInput = {
  readonly id: string;
  readonly source: HarnessGovernanceEvidenceSource;
  readonly status: GovernanceEvidenceStatus;
  readonly title: string;
  readonly summary: string;
  readonly updatedAt?: string;
  readonly staleAt?: string;
  readonly degraded?: boolean;
  readonly degradationReason?: string;
  readonly payload?: GovernanceEvidence["payload"];
};

export function createHarnessGovernanceEvidence(
  input: GovernanceEvidenceAdapterInput,
): GovernanceEvidence {
  return createGovernanceEvidence({
    ...input,
    id: normalizeGovernanceEvidenceId(input.id),
    degraded: input.degraded ?? false,
  });
}

export function createFrozenGovernanceEvidenceSnapshot(input: {
  evidence: readonly GovernanceEvidence[];
  createdAt?: string;
  id?: string;
}): GovernanceEvidenceSnapshot {
  return createGovernanceEvidenceSnapshot(input);
}

export function findGovernanceEvidenceBySource(
  snapshot: GovernanceEvidenceSnapshot | null | undefined,
  source: GovernanceEvidence["source"],
): readonly GovernanceEvidence[] {
  return snapshot?.evidence.filter((entry) => entry.source === source) ?? [];
}
