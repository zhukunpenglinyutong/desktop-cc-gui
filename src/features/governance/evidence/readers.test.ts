import { describe, expect, it } from "vitest";
import { collectGovernanceEvidence } from "./collectGovernanceEvidence";
import { openspecEvidenceReaderInternals, readOpenSpecEvidence } from "./openspecEvidenceReader";
import { readScriptEvidence } from "./scriptEvidenceReader";
import { readTrellisEvidence } from "./trellisEvidenceReader";
import type { WorkspaceGovernanceSnapshot } from "./types";
import { readWorkflowEvidence } from "./workflowEvidenceReader";

function createSnapshot(files: Record<string, string>): WorkspaceGovernanceSnapshot {
  const normalizedFiles = Object.keys(files);
  return {
    files: normalizedFiles,
    readFile: async (path) => files[path.replace(/\\/g, "/")] ?? null,
  };
}

describe("governance evidence readers", () => {
  it("parses OpenSpec task progress across LF and CRLF markdown", async () => {
    const snapshot = createSnapshot({
      "openspec/changes/a/tasks.md": "- [x] done\r\n- [ ] todo\r\n",
      "openspec/changes/b/tasks.md": "- [X] done\n- [x] done\n",
    });

    await expect(readOpenSpecEvidence(snapshot)).resolves.toEqual([
      {
        id: "openspec:tasks",
        source: "openspec",
        status: "warn",
        degraded: false,
        updatedAt: "1970-01-01T00:00:00.000Z",
        title: "OpenSpec tasks",
        summary: "3/4 task(s) complete across 2 change(s).",
      },
    ]);
  });

  it("degrades OpenSpec evidence when task markdown is missing or malformed", async () => {
    const snapshot = createSnapshot({
      "openspec/changes/a/tasks.md": "## no checkboxes\n",
    });

    await expect(readOpenSpecEvidence(snapshot)).resolves.toEqual([
      {
        id: "openspec:tasks",
        source: "openspec",
        status: "unknown",
        degraded: true,
        degradationReason: "governance-evidence-unavailable",
        updatedAt: "1970-01-01T00:00:00.000Z",
        title: "OpenSpec tasks",
        summary: "1 task file(s) found, but none had parseable checkbox progress.",
        payload: {
          kind: "legacy-workspace-evidence",
        },
      },
    ]);
  });

  it("keeps OpenSpec task parsing local and deterministic", () => {
    expect(openspecEvidenceReaderInternals.parseTaskProgress("- [x] a\n- [ ] b\n")).toEqual({
      complete: 1,
      total: 2,
    });
  });

  it("normalizes package script evidence for known harness scripts", async () => {
    const snapshot = createSnapshot({
      "package.json": JSON.stringify({
        scripts: {
          "check:engine-capability-matrix": "node a.mjs",
          "check:capability-aware-policy-router": "node b.mjs",
          "check:context-ledger-cost-budget": "node c.mjs",
          "check:checkpoint-policy-chain": "node d.mjs",
          "check:agent-domain-event-schema": "node e.mjs",
          "check:heavy-test-noise": "node f.mjs",
          "check:large-files:near-threshold": "node g.mjs",
          "check:large-files:gate": "node h.mjs",
        },
      }),
    });

    await expect(readScriptEvidence(snapshot)).resolves.toEqual([
      {
        id: "script:harness",
        source: "script",
        status: "pass",
        degraded: false,
        updatedAt: "1970-01-01T00:00:00.000Z",
        title: "Harness check scripts",
        summary: "8/8 known governance script(s) configured.",
      },
    ]);
  });

  it("degrades script evidence for malformed package json", async () => {
    const snapshot = createSnapshot({
      "package.json": "{not-json",
    });

    await expect(readScriptEvidence(snapshot)).resolves.toEqual([
      {
        id: "script:harness",
        source: "script",
        status: "unknown",
        degraded: true,
        degradationReason: "governance-evidence-unavailable",
        updatedAt: "1970-01-01T00:00:00.000Z",
        title: "Harness check scripts",
        summary: "package.json scripts could not be parsed.",
        payload: {
          kind: "legacy-workspace-evidence",
        },
      },
    ]);
  });

  it("normalizes workflow paths across Windows and POSIX separators", () => {
    expect(
      readWorkflowEvidence({
        files: [
          ".github\\workflows\\large-file-governance.yml",
          ".github/workflows/heavy-test-noise-sentry.yml",
        ],
      }),
    ).toEqual([
      {
        id: "workflow:governance",
        source: "workflow",
        status: "pass",
        degraded: false,
        updatedAt: "1970-01-01T00:00:00.000Z",
        title: "Governance workflows",
        summary: "2/2 required workflow(s) present.",
      },
    ]);
  });

  it("marks missing required workflows as fail evidence", () => {
    expect(readWorkflowEvidence({ files: [".github/workflows/large-file-governance.yml"] })).toEqual([
      {
        id: "workflow:governance",
        source: "workflow",
        status: "fail",
        degraded: false,
        updatedAt: "1970-01-01T00:00:00.000Z",
        title: "Governance workflows",
        summary: "1/2 required workflow(s) present.",
      },
    ]);
  });

  it("parses stable Trellis session records but keeps Trellis optional", async () => {
    const snapshot = createSnapshot({
      ".trellis/workspace/dev/index.md": "Total Sessions: 12\n",
    });

    await expect(readTrellisEvidence(snapshot)).resolves.toEqual([
      {
        id: "trellis:session-record",
        source: "trellis",
        status: "pass",
        degraded: false,
        updatedAt: "1970-01-01T00:00:00.000Z",
        title: "Trellis session record",
        summary: "12 recorded session(s) across 1 developer workspace(s).",
      },
    ]);
  });

  it("degrades Trellis evidence when the schema is absent", async () => {
    await expect(readTrellisEvidence(createSnapshot({}))).resolves.toEqual([
      {
        id: "trellis:session-record",
        source: "trellis",
        status: "unknown",
        degraded: true,
        degradationReason: "governance-evidence-unavailable",
        updatedAt: "1970-01-01T00:00:00.000Z",
        title: "Trellis session record",
        summary: "No Trellis workspace index was found; OpenSpec/script/workflow evidence is still available.",
        payload: {
          kind: "legacy-workspace-evidence",
        },
      },
    ]);
  });

  it("collects evidence without writing through the snapshot reader", async () => {
    const readPaths: string[] = [];
    const snapshot: WorkspaceGovernanceSnapshot = {
      files: [
        "openspec/changes/a/tasks.md",
        "package.json",
        ".github/workflows/large-file-governance.yml",
        ".github/workflows/heavy-test-noise-sentry.yml",
      ],
      readFile: async (path) => {
        readPaths.push(path);
        if (path === "openspec/changes/a/tasks.md") {
          return "- [x] done\n";
        }
        if (path === "package.json") {
          return JSON.stringify({ scripts: {} });
        }
        return null;
      },
    };

    const evidence = await collectGovernanceEvidence(snapshot);

    expect(evidence.map((entry) => entry.id)).toEqual([
      "openspec:tasks",
      "script:harness",
      "workflow:governance",
      "trellis:session-record",
    ]);
    expect(readPaths).toEqual(["openspec/changes/a/tasks.md", "package.json"]);
  });
});
