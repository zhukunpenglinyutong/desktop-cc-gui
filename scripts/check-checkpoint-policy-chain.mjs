import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const POLICY_DIR = path.join(ROOT, "src/features/status-panel/utils/policies");
const ZH_LOCALE_FILE = path.join(ROOT, "src/i18n/locales/zh.part2.ts");
const EN_LOCALE_FILE = path.join(ROOT, "src/i18n/locales/en.part2.ts");

const requiredFiles = [
  "policyTypes.ts",
  "corePolicy.ts",
  "policyRegistry.ts",
  "validationPolicies.ts",
  "bridgeGovernancePolicies.ts",
  "policyRegistry.test.ts",
  "validationPolicies.test.ts",
  "bridgeGovernancePolicies.test.ts",
].map((fileName) => path.join(POLICY_DIR, fileName));

function fail(message) {
  console.error(`[checkpoint-policy-chain] ${message}`);
  process.exitCode = 1;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertLocaleTokens(localeFile, tokens) {
  const localeSource = readText(localeFile);
  for (const token of tokens) {
    if (!localeSource.includes(token)) {
      fail(`${path.relative(ROOT, localeFile)} missing i18n token "${token}"`);
    }
  }
}

for (const filePath of requiredFiles) {
  if (!fs.existsSync(filePath)) {
    fail(`missing required file: ${path.relative(ROOT, filePath)}`);
  }
}

const typeSource = readText(path.join(POLICY_DIR, "policyTypes.ts"));
for (const token of ["appliesTo", "evaluate", "PolicyDecision", "no_contribution"]) {
  if (!typeSource.includes(token)) {
    fail(`policyTypes missing token "${token}"`);
  }
}

const registrySource = readText(path.join(POLICY_DIR, "policyRegistry.ts"));
for (const token of ["corePolicy", "VERDICT_SEVERITY", "DEFAULT_AUDIT_LIMIT = 50"]) {
  if (!registrySource.includes(token)) {
    fail(`policyRegistry missing invariant token "${token}"`);
  }
}

const validationSource = readText(path.join(POLICY_DIR, "validationPolicies.ts"));
if (validationSource.includes("verdictContribution: \"blocked\"")) {
  fail("optional validation policies must not contribute blocked");
}

const bridgePolicySource = readText(path.join(POLICY_DIR, "bridgeGovernancePolicies.ts"));
for (const token of [
  "governanceSnapshot",
  "evidenceSnapshotId",
  "costBudgetGovernancePolicy",
  "largeFileGovernancePolicy",
  "heavyTestNoiseGovernancePolicy",
]) {
  if (!bridgePolicySource.includes(token)) {
    fail(`bridgeGovernancePolicies missing invariant token "${token}"`);
  }
}
if (bridgePolicySource.includes("verdictContribution: \"blocked\"")) {
  fail("bridge-fed governance policies must not contribute blocked");
}

const policyLocaleTokens = [
  "policy: {",
  "title:",
  "count:",
  "corePolicy:",
  "lintValidationPolicy:",
  "typecheckValidationPolicy:",
  "testsValidationPolicy:",
  "verdict: {",
  "needs_review:",
  "no_contribution:",
];
assertLocaleTokens(ZH_LOCALE_FILE, policyLocaleTokens);
assertLocaleTokens(EN_LOCALE_FILE, policyLocaleTokens);

if (process.exitCode) {
  process.exit();
}

console.log("[checkpoint-policy-chain] ok");
