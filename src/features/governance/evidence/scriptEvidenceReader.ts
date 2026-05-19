import { createDegradedGovernanceEvidence, createGovernanceEvidence } from "./governanceEvidence";
import type { GovernanceEvidence, WorkspaceGovernanceSnapshot } from "./types";

const KNOWN_HARNESS_SCRIPTS = [
  "check:engine-capability-matrix",
  "check:capability-aware-policy-router",
  "check:context-ledger-cost-budget",
  "check:checkpoint-policy-chain",
  "check:agent-domain-event-schema",
  "check:heavy-test-noise",
  "check:large-files:near-threshold",
  "check:large-files:gate",
] as const;

type PackageJsonWithScripts = {
  scripts?: Record<string, unknown>;
};

function parsePackageScripts(packageJson: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(packageJson) as PackageJsonWithScripts;
    if (!parsed.scripts || typeof parsed.scripts !== "object") {
      return null;
    }
    const scripts: Record<string, string> = {};
    for (const [name, command] of Object.entries(parsed.scripts)) {
      if (typeof command === "string") {
        scripts[name] = command;
      }
    }
    return scripts;
  } catch {
    return null;
  }
}

export async function readScriptEvidence(
  snapshot: WorkspaceGovernanceSnapshot,
): Promise<GovernanceEvidence[]> {
  const packageJson = await snapshot.readFile("package.json");
  if (!packageJson) {
    return [
      createDegradedGovernanceEvidence(
        "script:harness",
        "script",
        "Harness check scripts",
        "package.json is missing or unreadable.",
      ),
    ];
  }

  const scripts = parsePackageScripts(packageJson);
  if (!scripts) {
    return [
      createDegradedGovernanceEvidence(
        "script:harness",
        "script",
        "Harness check scripts",
        "package.json scripts could not be parsed.",
      ),
    ];
  }

  const present = KNOWN_HARNESS_SCRIPTS.filter((scriptName) => Boolean(scripts[scriptName]));
  const missing = KNOWN_HARNESS_SCRIPTS.length - present.length;

  return [
    createGovernanceEvidence({
      id: "script:harness",
      source: "script",
      status: missing === 0 ? "pass" : "warn",
      title: "Harness check scripts",
      summary: `${present.length}/${KNOWN_HARNESS_SCRIPTS.length} known governance script(s) configured.`,
    }),
  ];
}

export const scriptEvidenceReaderInternals = {
  KNOWN_HARNESS_SCRIPTS,
  parsePackageScripts,
};

