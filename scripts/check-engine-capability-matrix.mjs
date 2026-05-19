import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const FIXTURE_PATH = path.join(
  ROOT,
  "openspec/specs/engine-capability-matrix/fixtures/matrix.json",
);
const TS_PATH = path.join(ROOT, "src/features/engine/engineCapabilityMatrix.ts");
const RUST_PATH = path.join(ROOT, "src-tauri/src/engine/capability_matrix.rs");

const VALID_STATE = new Set(["supported", "compat-input", "unsupported", "unknown"]);
const VALID_DOMAIN = new Set([
  "streaming",
  "tool",
  "hook",
  "memory",
  "subagent",
  "cost",
  "session",
  "image",
  "compaction",
  "reasoning",
  "collaboration",
]);

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(message) {
  console.error(`[engine-capability-matrix] ${message}`);
  process.exitCode = 1;
}

function assertCapabilityName(capability) {
  if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/.test(capability)) {
    fail(`invalid capability key "${capability}"`);
  }
  const domain = capability.split(".")[0];
  if (!VALID_DOMAIN.has(domain)) {
    fail(`invalid capability domain "${domain}" in "${capability}"`);
  }
}

const fixture = JSON.parse(readText(FIXTURE_PATH));
const capabilities = fixture.capabilities ?? [];
const engines = fixture.engines ?? {};
const tsSource = readText(TS_PATH);
const rustSource = readText(RUST_PATH);
const bridgeAdapterSource = readText(
  path.join(ROOT, "src/features/governance/evidence/harnessEvidenceAdapters.ts"),
);

if (!Array.isArray(capabilities) || capabilities.length === 0) {
  fail("fixture must define non-empty capabilities");
}

for (const capability of capabilities) {
  assertCapabilityName(capability);
  if (!tsSource.includes(`"${capability}"`)) {
    fail(`TS matrix source missing capability "${capability}"`);
  }
  if (!rustSource.includes(`"${capability}"`)) {
    fail(`Rust matrix source missing capability "${capability}"`);
  }
}

for (const [engine, table] of Object.entries(engines)) {
  for (const capability of capabilities) {
    const state = table?.[capability];
    if (!VALID_STATE.has(state)) {
      fail(`invalid state for ${engine}.${capability}: ${state}`);
    }
  }
}

for (const engine of ["claude", "codex", "gemini", "opencode"]) {
  if (!engines[engine]) {
    fail(`fixture missing engine "${engine}"`);
  }
}

for (const token of [
  "createCapabilityGovernanceEvidence",
  "EngineCapabilityRuntimeStatus",
  "source: \"engine-capability-matrix\"",
  "specState",
  "runtimeState",
  "available",
]) {
  if (!bridgeAdapterSource.includes(token)) {
    fail(`harnessEvidenceAdapters missing capability evidence token "${token}"`);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log("[engine-capability-matrix] ok");
