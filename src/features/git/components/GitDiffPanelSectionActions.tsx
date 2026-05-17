import { useTranslation } from "react-i18next";
import Minus from "lucide-react/dist/esm/icons/minus";
import Plus from "lucide-react/dist/esm/icons/plus";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import {
  InclusionToggle,
  runSequentialPathAction,
  type InclusionState,
} from "./GitDiffPanelInclusion";

type GitDiffPanelSectionActionsProps = {
  title: string;
  section: "staged" | "unstaged";
  sectionInclusionState: InclusionState;
  toggleableFilePaths: string[];
  filePaths: string[];
  onSetCommitSelection?: (paths: string[], selected: boolean) => void;
  onStageAllChanges?: () => Promise<void> | void;
  onStageFile?: (path: string) => Promise<void> | void;
  onUnstageFile?: (path: string) => Promise<void> | void;
  onDiscardFiles?: (paths: string[]) => Promise<void> | void;
};

export function GitDiffPanelSectionActions({
  title,
  section,
  sectionInclusionState,
  toggleableFilePaths,
  filePaths,
  onSetCommitSelection,
  onStageAllChanges,
  onStageFile,
  onUnstageFile,
  onDiscardFiles,
}: GitDiffPanelSectionActionsProps) {
  const { t } = useTranslation();
  const canToggleSection =
    Boolean(onSetCommitSelection) && toggleableFilePaths.length > 0;
  const canStageAll = section === "unstaged" && filePaths.length > 0;
  const canUnstageAll =
    section === "staged" && Boolean(onUnstageFile) && filePaths.length > 0;
  const canDiscardAll =
    section === "unstaged" && Boolean(onDiscardFiles) && filePaths.length > 0;

  if (!canToggleSection && !canStageAll && !canUnstageAll && !canDiscardAll) {
    return null;
  }

  return (
    <div
      className="diff-section-actions git-filetree-section-actions inline-flex items-center gap-1 ml-1.5"
      role="group"
      aria-label={t("git.sectionActions", { title })}
    >
      {canToggleSection ? (
        <InclusionToggle
          state={sectionInclusionState}
          label={t("git.commitSelectionToggleScope", { path: title })}
          className="git-commit-scope-toggle--section"
          onToggle={() =>
            onSetCommitSelection?.(
              toggleableFilePaths,
              sectionInclusionState !== "all",
            )
          }
        />
      ) : null}
      {canStageAll ? (
        <button
          type="button"
          className="diff-row-action diff-row-action--stage"
          onClick={() => {
            if (onStageAllChanges) {
              void onStageAllChanges();
              return;
            }
            void runSequentialPathAction(filePaths, onStageFile);
          }}
          data-tooltip={t("git.stageAllChanges")}
          aria-label={t("git.stageAllChangesAction")}
        >
          <Plus size={12} aria-hidden />
        </button>
      ) : null}
      {canUnstageAll ? (
        <button
          type="button"
          className="diff-row-action diff-row-action--unstage"
          onClick={() => {
            void runSequentialPathAction(filePaths, onUnstageFile);
          }}
          data-tooltip={t("git.unstageAllChanges")}
          aria-label={t("git.unstageAllChangesAction")}
        >
          <Minus size={12} aria-hidden />
        </button>
      ) : null}
      {canDiscardAll ? (
        <button
          type="button"
          className="diff-row-action diff-row-action--discard"
          onClick={() => {
            void onDiscardFiles?.(filePaths);
          }}
          data-tooltip={t("git.discardAllChanges")}
          aria-label={t("git.discardAllChangesAction")}
        >
          <Undo2 size={12} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
