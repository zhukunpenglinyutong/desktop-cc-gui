import { useEffect, useState } from "react";
import { getWorkspaceFiles, readWorkspaceFile } from "../../../services/tauri";
import { collectGovernanceEvidence } from "./collectGovernanceEvidence";
import { createDegradedGovernanceEvidence } from "./governanceEvidence";
import type { GovernanceEvidence } from "./types";

export type GovernanceEvidenceState = {
  readonly evidence: readonly GovernanceEvidence[];
  readonly isLoading: boolean;
  readonly error: string | null;
};

const INITIAL_EVIDENCE_STATE: GovernanceEvidenceState = {
  evidence: [],
  isLoading: false,
  error: null,
};

function normalizeGovernanceReadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useGovernanceEvidence(
  workspaceId: string | null,
  enabled: boolean,
): GovernanceEvidenceState {
  const [state, setState] = useState<GovernanceEvidenceState>(INITIAL_EVIDENCE_STATE);

  useEffect(() => {
    if (!enabled || !workspaceId) {
      setState(INITIAL_EVIDENCE_STATE);
      return;
    }

    const targetWorkspaceId = workspaceId;
    let cancelled = false;
    setState((current) => ({
      evidence: current.evidence,
      isLoading: true,
      error: null,
    }));

    async function loadEvidence() {
      try {
        const workspaceFiles = await getWorkspaceFiles(targetWorkspaceId);
        const evidence = await collectGovernanceEvidence({
          files: workspaceFiles.files,
          readFile: async (path) => {
            try {
              const response = await readWorkspaceFile(targetWorkspaceId, path);
              return response.content;
            } catch {
              return null;
            }
          },
        });

        if (!cancelled) {
          setState({
            evidence,
            isLoading: false,
            error: null,
          });
        }
      } catch (error) {
        const message = normalizeGovernanceReadError(error);
        if (!cancelled) {
          setState({
            evidence: [
              createDegradedGovernanceEvidence(
                "governance:workspace-read",
                "workflow",
                "Governance evidence",
                `Governance files could not be read: ${message}`,
              ),
            ],
            isLoading: false,
            error: message,
          });
        }
      }
    }

    void loadEvidence();

    return () => {
      cancelled = true;
    };
  }, [enabled, workspaceId]);

  return state;
}
