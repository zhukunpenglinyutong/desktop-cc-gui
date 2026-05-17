import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeGitPath } from "../utils/commitScope";

type GitCommitSelectionFile = {
  path: string;
};

type UseGitCommitSelectionOptions = {
  stagedFiles: GitCommitSelectionFile[];
  unstagedFiles: GitCommitSelectionFile[];
};

type CommitSelectionState = {
  overrides: Record<string, boolean>;
  hasExplicitCommitSelection: boolean;
  topologyKey: string;
};

type CommitPathTopology = {
  orderedCommitPaths: string[];
  rawCommitPathByNormalizedPath: Map<string, string>;
  stagedPathSet: Set<string>;
  lockedHybridPathSet: Set<string>;
  selectionTopologyKey: string;
};

type DerivedCommitSelection = {
  selectedCommitPaths: string[];
  includedCommitPaths: string[];
  excludedCommitPaths: string[];
  partialCommitPaths: string[];
};

function buildCommitPathTopology(
  stagedFiles: GitCommitSelectionFile[],
  unstagedFiles: GitCommitSelectionFile[],
): CommitPathTopology {
  const orderedCommitPaths: string[] = [];
  const rawCommitPathByNormalizedPath = new Map<string, string>();
  const stagedPathSet = new Set<string>();
  const unstagedPathSet = new Set<string>();
  const seenPaths = new Set<string>();

  const recordPath = (rawPath: string) => {
    const normalizedPath = normalizeGitPath(rawPath);
    if (!rawCommitPathByNormalizedPath.has(normalizedPath)) {
      rawCommitPathByNormalizedPath.set(normalizedPath, rawPath);
    }
    if (!seenPaths.has(normalizedPath)) {
      seenPaths.add(normalizedPath);
      orderedCommitPaths.push(normalizedPath);
    }
    return normalizedPath;
  };

  for (const file of stagedFiles) {
    stagedPathSet.add(recordPath(file.path));
  }

  for (const file of unstagedFiles) {
    unstagedPathSet.add(recordPath(file.path));
  }

  const lockedHybridPathSet = new Set<string>();
  for (const path of stagedPathSet) {
    if (unstagedPathSet.has(path)) {
      lockedHybridPathSet.add(path);
    }
  }

  return {
    orderedCommitPaths,
    rawCommitPathByNormalizedPath,
    stagedPathSet,
    lockedHybridPathSet,
    selectionTopologyKey: JSON.stringify({
      orderedCommitPaths,
      stagedPaths: Array.from(stagedPathSet).sort(),
      lockedHybridPaths: Array.from(lockedHybridPathSet).sort(),
    }),
  };
}

function isCommitPathSelectedByState(
  normalizedPath: string,
  overrides: Record<string, boolean>,
  stagedPathSet: Set<string>,
  lockedHybridPathSet: Set<string>,
) {
  if (lockedHybridPathSet.has(normalizedPath)) {
    return true;
  }
  const override = overrides[normalizedPath];
  if (typeof override === "boolean") {
    return override;
  }
  return stagedPathSet.has(normalizedPath);
}

function countSelectedCommitPathsForState(
  orderedCommitPaths: string[],
  overrides: Record<string, boolean>,
  stagedPathSet: Set<string>,
  lockedHybridPathSet: Set<string>,
) {
  let selectedCount = 0;
  for (const path of orderedCommitPaths) {
    if (
      isCommitPathSelectedByState(
        path,
        overrides,
        stagedPathSet,
        lockedHybridPathSet,
      )
    ) {
      selectedCount += 1;
    }
  }
  return selectedCount;
}

function deriveCommitSelectionState(
  orderedCommitPaths: string[],
  overrides: Record<string, boolean>,
  stagedPathSet: Set<string>,
  lockedHybridPathSet: Set<string>,
  rawCommitPathByNormalizedPath: Map<string, string>,
): DerivedCommitSelection {
  const selectedCommitPaths: string[] = [];
  const includedCommitPaths: string[] = [];
  const excludedCommitPaths: string[] = [];

  for (const path of orderedCommitPaths) {
    if (
      isCommitPathSelectedByState(
        path,
        overrides,
        stagedPathSet,
        lockedHybridPathSet,
      )
    ) {
      includedCommitPaths.push(path);
      selectedCommitPaths.push(rawCommitPathByNormalizedPath.get(path) ?? path);
      continue;
    }
    excludedCommitPaths.push(path);
  }

  return {
    selectedCommitPaths,
    includedCommitPaths,
    excludedCommitPaths,
    partialCommitPaths: Array.from(lockedHybridPathSet),
  };
}

export type CommitButtonProps = {
  commitMessage: string;
  selectedCount: number;
  hasAnyChanges: boolean;
  commitLoading: boolean;
  onCommit?: (selectedPaths?: string[]) => void | Promise<void>;
  selectedPaths: string[];
};

export function CommitButton({
  commitMessage,
  selectedCount,
  hasAnyChanges,
  commitLoading,
  onCommit,
  selectedPaths,
}: CommitButtonProps) {
  const { t } = useTranslation();
  const hasMessage = commitMessage.trim().length > 0;
  const canCommit = hasMessage && selectedCount > 0 && !commitLoading;

  return (
    <div className="commit-button-container mt-1">
      <button
        type="button"
        className="commit-button"
        onClick={() => {
          if (canCommit) {
            void onCommit?.(selectedPaths);
          }
        }}
        disabled={!canCommit}
        title={
          !hasMessage
            ? t("git.enterCommitMessage")
            : selectedCount === 0 && hasAnyChanges
              ? t("git.selectFilesToCommit")
              : !hasAnyChanges
                ? t("git.noChangesToCommit")
                : t("git.commitSelectedChanges")
        }
      >
        {commitLoading ? (
          <span className="commit-button-spinner" aria-hidden />
        ) : (
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        <span>{commitLoading ? t("git.committing") : t("git.commit")}</span>
      </button>
    </div>
  );
}

export function useGitCommitSelection({
  stagedFiles,
  unstagedFiles,
}: UseGitCommitSelectionOptions) {
  const {
    orderedCommitPaths,
    rawCommitPathByNormalizedPath,
    stagedPathSet,
    lockedHybridPathSet,
    selectionTopologyKey,
  } = useMemo(
    () => buildCommitPathTopology(stagedFiles, unstagedFiles),
    [stagedFiles, unstagedFiles],
  );

  const [commitSelectionState, setCommitSelectionState] =
    useState<CommitSelectionState>(() => ({
      overrides: {},
      hasExplicitCommitSelection: false,
      topologyKey: selectionTopologyKey,
    }));

  const commitSelectionOverrides = commitSelectionState.overrides;

  const countSelectedCommitPaths = useCallback(
    (overrides: Record<string, boolean>) =>
      countSelectedCommitPathsForState(
        orderedCommitPaths,
        overrides,
        stagedPathSet,
        lockedHybridPathSet,
      ),
    [lockedHybridPathSet, orderedCommitPaths, stagedPathSet],
  );

  const isCommitPathLocked = useCallback(
    (path: string) => lockedHybridPathSet.has(normalizeGitPath(path)),
    [lockedHybridPathSet],
  );

  const setCommitSelection = useCallback(
    (paths: string[], selected: boolean) => {
      const normalizedPaths = Array.from(
        new Set(paths.map((path) => normalizeGitPath(path))),
      ).filter((path) => !lockedHybridPathSet.has(path));
      if (normalizedPaths.length === 0) {
        return;
      }
      setCommitSelectionState((previous) => {
        const nextOverrides = { ...previous.overrides };
        for (const normalizedPath of normalizedPaths) {
          const defaultSelected = stagedPathSet.has(normalizedPath);
          if (selected === defaultSelected) {
            delete nextOverrides[normalizedPath];
            continue;
          }
          nextOverrides[normalizedPath] = selected;
        }
        const nextSelectedCount = countSelectedCommitPaths(nextOverrides);
        return {
          overrides: nextOverrides,
          hasExplicitCommitSelection:
            nextSelectedCount === 0
              ? true
              : Object.keys(nextOverrides).length > 0,
          topologyKey: selectionTopologyKey,
        };
      });
    },
    [
      countSelectedCommitPaths,
      lockedHybridPathSet,
      selectionTopologyKey,
      stagedPathSet,
    ],
  );

  const {
    selectedCommitPaths,
    includedCommitPaths,
    excludedCommitPaths,
    partialCommitPaths,
  } = useMemo(
    () =>
      deriveCommitSelectionState(
        orderedCommitPaths,
        commitSelectionOverrides,
        stagedPathSet,
        lockedHybridPathSet,
        rawCommitPathByNormalizedPath,
      ),
    [
      commitSelectionOverrides,
      lockedHybridPathSet,
      orderedCommitPaths,
      rawCommitPathByNormalizedPath,
      stagedPathSet,
    ],
  );

  useEffect(() => {
    setCommitSelectionState((previous) => {
      const validPaths = new Set(
        orderedCommitPaths.filter((path) => !lockedHybridPathSet.has(path)),
      );
      const nextOverrides: Record<string, boolean> = {};
      let didChange = false;
      for (const [path, value] of Object.entries(previous.overrides)) {
        if (validPaths.has(path)) {
          nextOverrides[path] = value;
          continue;
        }
        didChange = true;
      }
      const topologyChanged = previous.topologyKey !== selectionTopologyKey;
      const nextSelectedCount = countSelectedCommitPaths(nextOverrides);
      const nextHasExplicitCommitSelection =
        nextSelectedCount === 0
          ? !topologyChanged && !didChange && previous.hasExplicitCommitSelection
          : Object.keys(nextOverrides).length > 0;
      if (
        !didChange &&
        !topologyChanged &&
        previous.hasExplicitCommitSelection === nextHasExplicitCommitSelection
      ) {
        return previous;
      }
      return {
        overrides: nextOverrides,
        hasExplicitCommitSelection: nextHasExplicitCommitSelection,
        topologyKey: selectionTopologyKey,
      };
    });
  }, [countSelectedCommitPaths, lockedHybridPathSet, orderedCommitPaths, selectionTopologyKey]);

  return {
    selectedCommitPaths,
    selectedCommitCount: selectedCommitPaths.length,
    hasExplicitCommitSelection: commitSelectionState.hasExplicitCommitSelection,
    includedCommitPaths,
    excludedCommitPaths,
    partialCommitPaths,
    isCommitPathLocked,
    setCommitSelection,
  };
}
