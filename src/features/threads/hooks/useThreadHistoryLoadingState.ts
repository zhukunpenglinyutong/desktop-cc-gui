import { useCallback, useState } from "react";

export function useThreadHistoryLoadingState() {
  const [historyLoadingByThreadId, setHistoryLoadingByThreadId] = useState<
    Record<string, boolean>
  >({});

  const setThreadHistoryLoading = useCallback(
    (threadId: string, isLoading: boolean) => {
      if (!threadId) {
        return;
      }
      setHistoryLoadingByThreadId((current) => {
        const alreadyLoading = current[threadId] === true;
        if (isLoading) {
          if (alreadyLoading) {
            return current;
          }
          return { ...current, [threadId]: true };
        }
        if (!alreadyLoading) {
          return current;
        }
        const { [threadId]: _removed, ...rest } = current;
        return rest;
      });
    },
    [],
  );

  return {
    historyLoadingByThreadId,
    setThreadHistoryLoading,
  };
}
