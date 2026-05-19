import type {
  GovernanceEvidence,
  GovernanceEvidenceSnapshot,
  GovernanceEvidenceStatus,
} from "./types";

const DEFAULT_UPDATED_AT = "1970-01-01T00:00:00.000Z";
const REPO_PATH_ANCHORS = [
  ".github/",
  ".trellis/",
  "docs/",
  "openspec/",
  "package.json",
  "scripts/",
  "src/",
  "src-tauri/",
] as const;

export function normalizeGovernanceEvidenceStatus(
  status: string | null | undefined,
): GovernanceEvidenceStatus {
  if (status === "pass" || status === "warn" || status === "fail" || status === "unknown") {
    return status;
  }
  return "unknown";
}

function normalizeIsoTimestamp(value: string | null | undefined): string {
  if (!value) {
    return DEFAULT_UPDATED_AT;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : DEFAULT_UPDATED_AT;
}

function normalizeGovernanceEvidencePath(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\r?\n/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "");
  const withoutDrive = normalized.replace(/^[A-Za-z]:\//, "");
  const anchorIndex = REPO_PATH_ANCHORS.reduce<number | null>((current, anchor) => {
    const index = withoutDrive.indexOf(anchor);
    if (index < 0) {
      return current;
    }
    return current == null || index < current ? index : current;
  }, null);
  if (anchorIndex != null) {
    return withoutDrive.slice(anchorIndex);
  }
  return withoutDrive.replace(/^\/+/, "");
}

function isPathLikeEvidenceToken(value: string): boolean {
  return /[\\/]/.test(value) || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizePayload(
  payload: GovernanceEvidence["payload"],
): GovernanceEvidence["payload"] {
  if (!payload) {
    return undefined;
  }
  if ("sourcePath" in payload && typeof payload.sourcePath === "string") {
    return {
      ...payload,
      sourcePath: normalizeGovernanceEvidencePath(payload.sourcePath),
    };
  }
  return { ...payload };
}

function cloneEvidence(evidence: GovernanceEvidence): GovernanceEvidence {
  const payload = normalizePayload(evidence.payload);
  return {
    ...evidence,
    id: normalizeGovernanceEvidenceId(evidence.id),
    status: normalizeGovernanceEvidenceStatus(evidence.status),
    degraded: evidence.degraded,
    updatedAt: normalizeIsoTimestamp(evidence.updatedAt),
    staleAt: evidence.staleAt ? normalizeIsoTimestamp(evidence.staleAt) : undefined,
    payload: payload ? Object.freeze(payload) : undefined,
  };
}

export function createGovernanceEvidence(
  evidence: Omit<GovernanceEvidence, "degraded" | "updatedAt"> &
    Partial<Pick<GovernanceEvidence, "degraded" | "updatedAt">>,
): GovernanceEvidence {
  return cloneEvidence({
    ...evidence,
    degraded: evidence.degraded ?? false,
    updatedAt: evidence.updatedAt ?? DEFAULT_UPDATED_AT,
  });
}

export function createDegradedGovernanceEvidence(
  id: string,
  source: GovernanceEvidence["source"],
  title: string,
  summary: string,
): GovernanceEvidence {
  return createGovernanceEvidence({
    id,
    source,
    status: "unknown",
    degraded: true,
    degradationReason: "governance-evidence-unavailable",
    title,
    summary,
    payload: {
      kind: "legacy-workspace-evidence",
    },
  });
}

export function normalizeGovernanceEvidenceId(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\r?\n/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "");
  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex < 0) {
    return isPathLikeEvidenceToken(normalized)
      ? normalizeGovernanceEvidencePath(normalized)
      : normalized;
  }
  const prefix = normalized.slice(0, separatorIndex);
  const suffix = normalized.slice(separatorIndex + 1);
  return `${prefix}:${
    isPathLikeEvidenceToken(suffix) ? normalizeGovernanceEvidencePath(suffix) : suffix
  }`;
}

export function createGovernanceEvidenceSnapshot(input: {
  evidence: readonly GovernanceEvidence[];
  createdAt?: string;
  id?: string;
}): GovernanceEvidenceSnapshot {
  const createdAt = normalizeIsoTimestamp(input.createdAt ?? DEFAULT_UPDATED_AT);
  const evidence = input.evidence
    .map(cloneEvidence)
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  const id =
    input.id ??
    evidence
      .map((entry) =>
        [
          entry.id,
          entry.source,
          entry.status,
          String(entry.degraded),
          entry.degradationReason ?? "",
          entry.staleAt ?? "",
          entry.updatedAt,
          entry.payload ? JSON.stringify(entry.payload) : "",
        ].join(":"),
      )
      .join("|");

  return Object.freeze({
    id,
    evidence: Object.freeze(evidence.map((entry) => Object.freeze(entry))),
    createdAt,
  });
}

export const governanceEvidenceInternals = {
  DEFAULT_UPDATED_AT,
  normalizeGovernanceEvidencePath,
  normalizeIsoTimestamp,
};
