import { useRuntimeLogSession } from "../../runtime-log/hooks/useRuntimeLogSession";
import type {
  RuntimeConsoleStatus,
  RuntimeLogSessionState,
} from "../../runtime-log/hooks/useRuntimeLogSession";
import type { WorkspaceInfo } from "../../../types";

type UseWorkspaceRuntimeRunOptions = {
  activeWorkspace: WorkspaceInfo | null;
};

export type { RuntimeConsoleStatus };

export type WorkspaceRuntimeRunState = RuntimeLogSessionState;

export function useWorkspaceRuntimeRun({
  activeWorkspace,
}: UseWorkspaceRuntimeRunOptions): WorkspaceRuntimeRunState {
  return useRuntimeLogSession({ activeWorkspace });
}
