import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, "src/features/governance/evidence");
const POLICY_DIR = path.join(ROOT, "src/features/status-panel/utils/policies");

const requiredFiles = [
  path.join(EVIDENCE_DIR, "types.ts"),
  path.join(EVIDENCE_DIR, "governanceEvidence.ts"),
  path.join(EVIDENCE_DIR, "governanceEvidenceBridge.ts"),
  path.join(EVIDENCE_DIR, "harnessEvidenceAdapters.ts"),
  path.join(EVIDENCE_DIR, "collectGovernanceEvidence.ts"),
  path.join(POLICY_DIR, "bridgeGovernancePolicies.ts"),
  path.join(POLICY_DIR, "policyTypes.ts"),
].map((filePath) => path.normalize(filePath));

function fail(message) {
  console.error(`[governance-evidence-bridge] ${message}`);
  process.exitCode = 1;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

for (const filePath of requiredFiles) {
  if (!fs.existsSync(filePath)) {
    fail(`missing required file: ${path.relative(ROOT, filePath)}`);
  }
}

const typeSource = readText(path.join(EVIDENCE_DIR, "types.ts"));
for (const token of [
  "GovernanceEvidenceSnapshot",
  "LegacyGovernanceEvidenceSource",
  "HarnessGovernanceEvidenceSource",
  "degraded",
  "staleAt",
  "payload",
]) {
  if (!typeSource.includes(token)) {
    fail(`types.ts missing bridge token "${token}"`);
  }
}

const bridgeSource = readText(path.join(EVIDENCE_DIR, "governanceEvidenceBridge.ts"));
for (const token of [
  "createHarnessGovernanceEvidence",
  "createFrozenGovernanceEvidenceSnapshot",
  "findGovernanceEvidenceBySource",
]) {
  if (!bridgeSource.includes(token)) {
    fail(`governanceEvidenceBridge.ts missing "${token}"`);
  }
}

const adapterSource = readText(path.join(EVIDENCE_DIR, "harnessEvidenceAdapters.ts"));
for (const token of [
  "createCostBudgetGovernanceEvidence",
  "createCapabilityGovernanceEvidence",
  "createGateGovernanceEvidence",
  "consolidateHarnessGateEvidence",
  "shouldInterruptRuntime: false",
]) {
  if (!adapterSource.includes(token)) {
    fail(`harnessEvidenceAdapters.ts missing "${token}"`);
  }
}

const policyTypeSource = readText(path.join(POLICY_DIR, "policyTypes.ts"));
if (!policyTypeSource.includes("governanceSnapshot: GovernanceEvidenceSnapshot | null")) {
  fail("CheckpointPolicyEvidence must carry the injected governance snapshot");
}

const bridgePolicySource = readText(path.join(POLICY_DIR, "bridgeGovernancePolicies.ts"));
for (const forbidden of [
  "useGovernanceEvidence",
  "getWorkspaceFiles",
  "readWorkspaceFile",
  "child_process",
  "exec(",
  "spawn(",
  "localStorage",
  "indexedDB",
]) {
  if (bridgePolicySource.includes(forbidden)) {
    fail(`bridge-fed policies must not depend on "${forbidden}"`);
  }
}

if (bridgePolicySource.includes("verdictContribution: \"blocked\"")) {
  fail("bridge-fed policies must not contribute blocked");
}

const packageJson = JSON.parse(readText(path.join(ROOT, "package.json")));
if (packageJson.scripts?.["check:governance-evidence-bridge"] !== "node scripts/check-governance-evidence-bridge.mjs") {
  fail("package.json must expose check:governance-evidence-bridge through a Node entrypoint");
}

if (process.exitCode) {
  process.exit();
}

console.log("[governance-evidence-bridge] ok");
