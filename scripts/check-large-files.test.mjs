import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { determineHardDebtStatus, loadPolicyConfig, resolvePolicy, scanLargeFiles } from "./check-large-files.mjs";

async function withTempDir(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "large-file-governance-"));
  try {
    await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeLines(filePath, lineCount) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = Array.from({ length: lineCount }, (_, index) => `line-${index + 1}`).join("\n");
  await fs.writeFile(filePath, `${content}\n`, "utf8");
}

test("determineHardDebtStatus distinguishes baseline growth states", () => {
  assert.equal(determineHardDebtStatus(2601, null, false), "captured");
  assert.equal(determineHardDebtStatus(2601, null, true), "new");
  assert.equal(determineHardDebtStatus(2602, { lines: 2601 }, true), "regressed");
  assert.equal(determineHardDebtStatus(2601, { lines: 2601 }, true), "retained");
  assert.equal(determineHardDebtStatus(2600, { lines: 2601 }, true), "reduced");
});

test("resolvePolicy prefers exact and prefix matches before default fallback", async () => {
  const root = process.cwd();
  const policy = await loadPolicyConfig(root, "scripts/check-large-files.policy.json");
  assert.ok(policy);
  assert.equal(resolvePolicy("src/services/tauri.ts", policy)?.id, "bridge-runtime-critical");
  assert.equal(resolvePolicy("src/features/messages/components/Messages.tsx", policy)?.id, "feature-hotpath");
  assert.equal(resolvePolicy("src/other/random.ts", policy)?.id, "default-source");
});

test("scanLargeFiles reports baseline-aware regressions for policy fail scope", async () => {
  await withTempDir(async (root) => {
    const policyPath = path.join(root, "policy.json");
    const baselinePath = path.join(root, "baseline.json");
    await fs.writeFile(
      policyPath,
      JSON.stringify(
        {
          version: "test-policy",
          policies: [
            {
              id: "critical",
              priority: "P0",
              warnThreshold: 5,
              failThreshold: 8,
              match: {
                exactPaths: ["src/services/tauri.ts"],
              },
            },
          ],
          defaultPolicy: {
            id: "default-source",
            priority: "P1",
            warnThreshold: 10,
            failThreshold: 12,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      baselinePath,
      JSON.stringify(
        {
          generatedAt: "2026-04-22T00:00:00.000Z",
          scope: "fail",
          policyVersion: "test-policy",
          entries: [
            {
              path: "src/services/tauri.ts",
              lines: 9,
              policyId: "critical",
              priority: "P0",
              warnThreshold: 5,
              failThreshold: 8,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 10);
    await writeLines(path.join(root, "src/features/messages/components/Messages.tsx"), 7);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.path, "src/services/tauri.ts");
    assert.equal(scan.results[0]?.status, "regressed");
    assert.equal(scan.results[0]?.delta, 1);
  });
});

test("scanLargeFiles includes mjs scripts and yaml workflows in governance", async () => {
  await withTempDir(async (root) => {
    const policyPath = path.join(root, "policy.json");
    await fs.writeFile(
      policyPath,
      JSON.stringify(
        {
          version: "test-policy",
          policies: [],
          defaultPolicy: {
            id: "default-source",
            priority: "P1",
            warnThreshold: 8,
            failThreshold: 12,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeLines(path.join(root, "scripts", "check-heavy-test-noise.mjs"), 13);
    await writeLines(
      path.join(root, ".github", "workflows", "large-file-governance.yml"),
      9,
    );

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: null,
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "warn",
    });

    expectPaths(scan.results.map((item) => item.path));
  });
});

function expectPaths(paths) {
  assert.deepEqual(paths.sort(), [
    ".github/workflows/large-file-governance.yml",
    "scripts/check-heavy-test-noise.mjs",
  ]);
}
