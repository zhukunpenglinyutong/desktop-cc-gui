export type ExitedSessionThreadRow<TThread extends { id: string }> = {
  thread: TThread;
  depth: number;
};

export type ExitedSessionRowVisibility<TThread extends { id: string }> = {
  visibleRows: ExitedSessionThreadRow<TThread>[];
  hiddenExitedCount: number;
  hasExitedSessions: boolean;
};

type GetExitedSessionRowVisibilityOptions<TThread extends { id: string }> = {
  hideExitedSessions: boolean;
  isExitedThread: (thread: TThread) => boolean;
};

export function getExitedSessionRowVisibility<TThread extends { id: string }>(
  rows: ExitedSessionThreadRow<TThread>[],
  options: GetExitedSessionRowVisibilityOptions<TThread>,
): ExitedSessionRowVisibility<TThread> {
  const { hideExitedSessions, isExitedThread } = options;
  const exitedRowIndexes = new Set<number>();

  rows.forEach((row, index) => {
    if (isExitedThread(row.thread)) {
      exitedRowIndexes.add(index);
    }
  });

  const hasExitedSessions = exitedRowIndexes.size > 0;
  if (!hideExitedSessions || !hasExitedSessions) {
    return {
      visibleRows: rows,
      hiddenExitedCount: 0,
      hasExitedSessions,
    };
  }

  const visibleRowIndexes = new Set<number>();
  const ancestorIndexesByDepth: number[] = [];

  rows.forEach((row, index) => {
    const normalizedDepth = Math.max(row.depth, 0);
    ancestorIndexesByDepth.length = normalizedDepth;

    if (!exitedRowIndexes.has(index)) {
      ancestorIndexesByDepth.forEach((ancestorIndex) => visibleRowIndexes.add(ancestorIndex));
      visibleRowIndexes.add(index);
    }

    ancestorIndexesByDepth[normalizedDepth] = index;
  });

  return {
    visibleRows: rows.filter((_, index) => visibleRowIndexes.has(index)),
    hiddenExitedCount: Array.from(exitedRowIndexes).filter(
      (index) => !visibleRowIndexes.has(index),
    ).length,
    hasExitedSessions,
  };
}
