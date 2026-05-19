import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";

import {
  scanEngineNameBranches,
  scanEngineNameBranchesInternals,
} from "./scan-engine-name-branches.mjs";

async function withTempDir(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-branch-scan-"));
  try {
    await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

test("reports engine-name branches with stable normalized paths", async () => {
  await withTempDir(async (root) => {
    await writeFile(
      path.join(root, "src", "zeta.ts"),
      "export const z = activeEngine === 'codex';\r\n",
    );
    await writeFile(
      path.join(root, "src", "alpha.tsx"),
      "export const a = engineType !== \"claude\";\n",
    );

    const firstReport = await scanEngineNameBranches({ root });
    const secondReport = await scanEngineNameBranches({ root });

    assert.deepEqual(firstReport, secondReport);
    assert.deepEqual(
      firstReport.findings.map((finding) => finding.path),
      ["src/alpha.tsx", "src/zeta.ts"],
    );
    assert.equal(firstReport.findings[0]?.expression, 'engineType !== "claude"');
    assert.equal(firstReport.findings[1]?.expression, "activeEngine === 'codex'");
  });
});

test("marks allowlisted engine branches without hiding them", () => {
  const findings = scanEngineNameBranchesInternals.scanEngineNameBranchesInText(
    "if (engine === 'opencode') { return true; } // capability-router-allow-engine-branch\n",
    "src/example.ts",
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.allowed, true);
});

test("normalizes Windows-style input paths for scanning", async () => {
  await withTempDir(async (root) => {
    await writeFile(
      path.join(root, "src", "nested", "engine.ts"),
      "export const isGemini = selectedEngine === 'gemini';\n",
    );

    const report = await scanEngineNameBranches({
      root,
      paths: ["src\\nested"],
    });

    assert.deepEqual(report.findings.map((finding) => finding.path), [
      "src/nested/engine.ts",
    ]);
  });
});

test("dedupes overlapping scan paths", async () => {
  await withTempDir(async (root) => {
    await writeFile(
      path.join(root, "src", "nested", "engine.ts"),
      "export const isGemini = selectedEngine === 'gemini';\n",
    );

    const report = await scanEngineNameBranches({
      root,
      paths: ["src", "src/nested"],
    });

    assert.equal(report.scannedFiles, 1);
    assert.equal(report.findingCount, 1);
  });
});

test("cli emits deterministic JSON", async () => {
  await withTempDir(async (root) => {
    await writeFile(
      path.join(root, "src", "engine.ts"),
      "export const isCodex = engine === 'codex';\n",
    );

    const result = spawnSync(
      process.execPath,
      [
        path.resolve("scripts/scan-engine-name-branches.mjs"),
        "--root",
        root,
        "--path",
        "src",
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      version: 1,
      root: ".",
      scannedFiles: 1,
      findingCount: 1,
      findings: [
        {
          path: "src/engine.ts",
          line: 1,
          column: 24,
          expression: "engine === 'codex'",
          allowed: false,
        },
      ],
    });
  });
});

test("cli rejects missing argument values", () => {
  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts/scan-engine-name-branches.mjs"), "--root"],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Missing value for --root/);
});
