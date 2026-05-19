import { describe, expect, it } from "vitest";
import {
  createGovernanceEvidence,
  createGovernanceEvidenceSnapshot,
  governanceEvidenceInternals,
  normalizeGovernanceEvidenceId,
  normalizeGovernanceEvidenceStatus,
} from "./governanceEvidence";

describe("governanceEvidence", () => {
  it("normalizes unknown status values to unknown", () => {
    expect(normalizeGovernanceEvidenceStatus("pass")).toBe("pass");
    expect(normalizeGovernanceEvidenceStatus("warn")).toBe("warn");
    expect(normalizeGovernanceEvidenceStatus("broken")).toBe("unknown");
    expect(normalizeGovernanceEvidenceStatus(null)).toBe("unknown");
  });

  it("sanitizes DTO status while preserving evidence content", () => {
    expect(
      createGovernanceEvidence({
        id: "script:test",
        source: "script",
        status: "fail",
        title: "Script",
        summary: "Failed",
      }),
    ).toEqual({
      id: "script:test",
      source: "script",
      status: "fail",
      degraded: false,
      updatedAt: "1970-01-01T00:00:00.000Z",
      title: "Script",
      summary: "Failed",
    });
  });

  it("creates frozen deterministic snapshots without React or Tauri dependencies", () => {
    const snapshot = createGovernanceEvidenceSnapshot({
      id: "snapshot-1",
      createdAt: "2026-05-20T00:00:00.000Z",
      evidence: [
        createGovernanceEvidence({
          id: "workflow:governance",
          source: "workflow",
          status: "pass",
          title: "Workflow",
          summary: "ok",
        }),
        createGovernanceEvidence({
          id: "openspec:tasks",
          source: "openspec",
          status: "warn",
          title: "Tasks",
          summary: "partial",
        }),
      ],
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.evidence)).toBe(true);
    expect(snapshot).toEqual({
      id: "snapshot-1",
      createdAt: "2026-05-20T00:00:00.000Z",
      evidence: [
        {
          id: "openspec:tasks",
          source: "openspec",
          status: "warn",
          degraded: false,
          updatedAt: "1970-01-01T00:00:00.000Z",
          title: "Tasks",
          summary: "partial",
        },
        {
          id: "workflow:governance",
          source: "workflow",
          status: "pass",
          degraded: false,
          updatedAt: "1970-01-01T00:00:00.000Z",
          title: "Workflow",
          summary: "ok",
        },
      ],
    });
  });

  it("freezes payloads and derives snapshot identity from quality metadata", () => {
    const healthySnapshot = createGovernanceEvidenceSnapshot({
      evidence: [
        createGovernanceEvidence({
          id: "cost-budget:session-1",
          source: "cost-budget",
          status: "warn",
          degraded: false,
          title: "Cost budget",
          summary: "warn",
          payload: {
            kind: "cost-budget",
            tier: "warn",
            severity: "warning",
            amountUsd: 5,
            thresholdUsd: 10,
            currency: "USD",
            shouldInterruptRuntime: false,
          },
        }),
      ],
    });
    const degradedSnapshot = createGovernanceEvidenceSnapshot({
      evidence: [
        createGovernanceEvidence({
          id: "cost-budget:session-1",
          source: "cost-budget",
          status: "warn",
          degraded: true,
          degradationReason: "pricing-unavailable",
          title: "Cost budget",
          summary: "warn",
          payload: {
            kind: "cost-budget",
            tier: "warn",
            severity: "warning",
            amountUsd: 5,
            thresholdUsd: 10,
            currency: "USD",
            shouldInterruptRuntime: false,
          },
        }),
      ],
    });

    expect(Object.isFrozen(healthySnapshot.evidence[0]?.payload)).toBe(true);
    expect(healthySnapshot.id).not.toBe(degradedSnapshot.id);
  });

  it("normalizes audit-facing ids and source paths across Windows and macOS paths", () => {
    expect(
      normalizeGovernanceEvidenceId(
        "large-file:C:\\Users\\dev\\repo\\src\\features\\status-panel\\Panel.tsx",
      ),
    ).toBe("large-file:src/features/status-panel/Panel.tsx");
    expect(
      governanceEvidenceInternals.normalizeGovernanceEvidencePath(
        "/Users/dev/repo/.github/workflows/large-file-governance.yml",
      ),
    ).toBe(".github/workflows/large-file-governance.yml");
    expect(
      createGovernanceEvidence({
        id: "engine-runtime-contract:/Users/dev/repo/src\\features\\threads\\replay.json\r\n",
        source: "engine-runtime-contract",
        status: "fail",
        title: "Replay",
        summary: "Diverged",
        payload: {
          kind: "engine-runtime-contract",
          contractId: "replay",
          sourcePath: "C:\\work\\mossx\\scripts\\realtime-report.json",
        },
      }),
    ).toMatchObject({
      id: "engine-runtime-contract:src/features/threads/replay.json",
      payload: {
        sourcePath: "scripts/realtime-report.json",
      },
    });
  });
});
