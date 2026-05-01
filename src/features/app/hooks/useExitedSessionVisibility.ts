import { useCallback, useState } from "react";

import {
  isExitedSessionsHiddenForWorkspacePath,
  loadHiddenExitedSessionsByWorkspacePath,
  persistHiddenExitedSessionsByWorkspacePath,
  updateHiddenExitedSessionsByWorkspacePath,
} from "../utils/exitedSessionVisibility";

export function useExitedSessionVisibility() {
  const [hiddenByWorkspacePath, setHiddenByWorkspacePath] = useState(() =>
    loadHiddenExitedSessionsByWorkspacePath(),
  );

  const isExitedSessionsHidden = useCallback(
    (workspacePath: string) =>
      isExitedSessionsHiddenForWorkspacePath(hiddenByWorkspacePath, workspacePath),
    [hiddenByWorkspacePath],
  );

  const setExitedSessionsHidden = useCallback(
    (workspacePath: string, hidden: boolean) => {
      setHiddenByWorkspacePath((previous) => {
        const next = updateHiddenExitedSessionsByWorkspacePath(
          previous,
          workspacePath,
          hidden,
        );
        if (next !== previous) {
          persistHiddenExitedSessionsByWorkspacePath(next);
        }
        return next;
      });
    },
    [],
  );

  const toggleExitedSessionsHidden = useCallback(
    (workspacePath: string) => {
      setHiddenByWorkspacePath((previous) => {
        const nextHidden = !isExitedSessionsHiddenForWorkspacePath(
          previous,
          workspacePath,
        );
        const next = updateHiddenExitedSessionsByWorkspacePath(
          previous,
          workspacePath,
          nextHidden,
        );
        if (next !== previous) {
          persistHiddenExitedSessionsByWorkspacePath(next);
        }
        return next;
      });
    },
    [],
  );

  return {
    isExitedSessionsHidden,
    setExitedSessionsHidden,
    toggleExitedSessionsHidden,
  };
}
