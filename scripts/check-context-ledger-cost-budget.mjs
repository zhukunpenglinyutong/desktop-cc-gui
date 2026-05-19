import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PRICING_DIR = path.join(ROOT, "src/features/context-ledger/pricing");
const COST_DIR = path.join(ROOT, "src/features/context-ledger/cost");
const BUDGET_DIR = path.join(ROOT, "src/features/context-ledger/budget");
const ZH_LOCALE_FILE = path.join(ROOT, "src/i18n/locales/zh.part2.ts");
const EN_LOCALE_FILE = path.join(ROOT, "src/i18n/locales/en.part2.ts");

const requiredFiles = [
  "pricing/pricingTypes.ts",
  "pricing/pricingRegistry.ts",
  "pricing/fixtures/claude.ts",
  "pricing/fixtures/codex.ts",
  "pricing/fixtures/gemini.ts",
  "pricing/fixtures/opencode.ts",
  "cost/projectCost.ts",
  "cost/costAggregate.ts",
  "budget/budgetStore.ts",
  "budget/budgetThresholds.ts",
].map((relativePath) => path.join(ROOT, "src/features/context-ledger", relativePath));

function fail(message) {
  console.error(`[context-ledger-cost-budget] ${message}`);
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

const pricingSource = readText(path.join(PRICING_DIR, "pricingTypes.ts"));
for (const token of ["fixture", "config", "remote", "lastUpdatedAt", "ratesUsdPerMillion"]) {
  if (!pricingSource.includes(token)) {
    fail(`pricingTypes missing token "${token}"`);
  }
}

const costSource = readText(path.join(COST_DIR, "projectCost.ts"));
for (const token of [
  "ThreadTokenUsage",
  "pricing-unavailable",
  "block-level-cost-unsupported",
  "amountUsd: null",
]) {
  if (!costSource.includes(token)) {
    fail(`projectCost missing invariant token "${token}"`);
  }
}

const budgetSource = readText(path.join(BUDGET_DIR, "budgetThresholds.ts"));
for (const token of ["info", "warn", "block", "shouldInterruptRuntime: false"]) {
  if (!budgetSource.includes(token)) {
    fail(`budgetThresholds missing invariant token "${token}"`);
  }
}

const bridgeAdapterSource = readText(
  path.join(ROOT, "src/features/governance/evidence/harnessEvidenceAdapters.ts"),
);
for (const token of [
  "createCostBudgetGovernanceEvidence",
  "BudgetThresholdSignal",
  "shouldInterruptRuntime: false",
  "source: \"cost-budget\"",
]) {
  if (!bridgeAdapterSource.includes(token)) {
    fail(`harnessEvidenceAdapters missing cost-budget token "${token}"`);
  }
}

const costBudgetLocaleTokens = [
  "cost: {",
  "budget: {",
  "session:",
  "workspace:",
  "degraded:",
  "threshold: {",
  "info:",
  "warn:",
  "block:",
];
assertLocaleTokens(ZH_LOCALE_FILE, costBudgetLocaleTokens);
assertLocaleTokens(EN_LOCALE_FILE, costBudgetLocaleTokens);

if (process.exitCode) {
  process.exit();
}

console.log("[context-ledger-cost-budget] ok");
