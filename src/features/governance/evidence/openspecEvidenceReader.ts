import { createDegradedGovernanceEvidence, createGovernanceEvidence } from "./governanceEvidence";
import { normalizeGovernancePath } from "./pathUtils";
import type { GovernanceEvidence, WorkspaceGovernanceSnapshot } from "./types";

const OPENSPEC_TASKS_PATTERN = /^openspec\/changes\/([^/]+)\/tasks\.md$/;

type TaskProgress = {
  total: number;
  complete: number;
};

function parseTaskProgress(markdown: string): TaskProgress | null {
  const taskLines = markdown.split(/\r?\n/).filter((line) => /^\s*-\s+\[[ xX]\]\s+/.test(line));
  if (taskLines.length === 0) {
    return null;
  }
  const complete = taskLines.filter((line) => /^\s*-\s+\[[xX]\]\s+/.test(line)).length;
  return {
    total: taskLines.length,
    complete,
  };
}

function statusForProgress(progress: TaskProgress): GovernanceEvidence["status"] {
  if (progress.total === 0) {
    return "unknown";
  }
  if (progress.complete === progress.total) {
    return "pass";
  }
  if (progress.complete > 0) {
    return "warn";
  }
  return "unknown";
}

export async function readOpenSpecEvidence(
  snapshot: WorkspaceGovernanceSnapshot,
): Promise<GovernanceEvidence[]> {
  const taskPaths = snapshot.files
    .map(normalizeGovernancePath)
    .filter((path) => OPENSPEC_TASKS_PATTERN.test(path))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (taskPaths.length === 0) {
    return [
      createDegradedGovernanceEvidence(
        "openspec:tasks",
        "openspec",
        "OpenSpec tasks",
        "No OpenSpec task files were found.",
      ),
    ];
  }

  const progressEntries: TaskProgress[] = [];
  let malformedCount = 0;

  for (const taskPath of taskPaths) {
    const content = await snapshot.readFile(taskPath);
    const progress = content ? parseTaskProgress(content) : null;
    if (!progress) {
      malformedCount += 1;
      continue;
    }
    progressEntries.push(progress);
  }

  if (progressEntries.length === 0) {
    return [
      createDegradedGovernanceEvidence(
        "openspec:tasks",
        "openspec",
        "OpenSpec tasks",
        `${taskPaths.length} task file(s) found, but none had parseable checkbox progress.`,
      ),
    ];
  }

  const total = progressEntries.reduce((sum, entry) => sum + entry.total, 0);
  const complete = progressEntries.reduce((sum, entry) => sum + entry.complete, 0);
  const status = malformedCount > 0 ? "warn" : statusForProgress({ total, complete });
  const malformedSummary =
    malformedCount > 0 ? `; ${malformedCount} malformed task file(s)` : "";

  return [
    createGovernanceEvidence({
      id: "openspec:tasks",
      source: "openspec",
      status,
      title: "OpenSpec tasks",
      summary: `${complete}/${total} task(s) complete across ${progressEntries.length} change(s)${malformedSummary}.`,
    }),
  ];
}

export const openspecEvidenceReaderInternals = {
  parseTaskProgress,
  statusForProgress,
};

