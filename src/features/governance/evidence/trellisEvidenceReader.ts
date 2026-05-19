import { createDegradedGovernanceEvidence, createGovernanceEvidence } from "./governanceEvidence";
import { normalizeGovernancePath } from "./pathUtils";
import type { GovernanceEvidence, WorkspaceGovernanceSnapshot } from "./types";

const TRELLIS_WORKSPACE_INDEX_PATTERN = /^\.trellis\/workspace\/[^/]+\/index\.md$/;

function parseTotalSessions(indexMarkdown: string): number | null {
  const match = indexMarkdown.match(/Total Sessions\s*:\s*(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

export async function readTrellisEvidence(
  snapshot: WorkspaceGovernanceSnapshot,
): Promise<GovernanceEvidence[]> {
  const indexPaths = snapshot.files
    .map(normalizeGovernancePath)
    .filter((path) => TRELLIS_WORKSPACE_INDEX_PATTERN.test(path))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (indexPaths.length === 0) {
    return [
      createDegradedGovernanceEvidence(
        "trellis:session-record",
        "trellis",
        "Trellis session record",
        "No Trellis workspace index was found; OpenSpec/script/workflow evidence is still available.",
      ),
    ];
  }

  const sessionCounts: number[] = [];
  for (const indexPath of indexPaths) {
    const content = await snapshot.readFile(indexPath);
    const totalSessions = content ? parseTotalSessions(content) : null;
    if (typeof totalSessions === "number" && Number.isFinite(totalSessions)) {
      sessionCounts.push(totalSessions);
    }
  }

  if (sessionCounts.length === 0) {
    return [
      createDegradedGovernanceEvidence(
        "trellis:session-record",
        "trellis",
        "Trellis session record",
        "Trellis workspace indexes were found but did not expose parseable session counts.",
      ),
    ];
  }

  return [
    createGovernanceEvidence({
      id: "trellis:session-record",
      source: "trellis",
      status: "pass",
      title: "Trellis session record",
      summary: `${sessionCounts.reduce((sum, count) => sum + count, 0)} recorded session(s) across ${sessionCounts.length} developer workspace(s).`,
    }),
  ];
}

export const trellisEvidenceReaderInternals = {
  parseTotalSessions,
};

