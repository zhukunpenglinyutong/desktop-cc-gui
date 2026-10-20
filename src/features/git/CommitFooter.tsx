import { useState } from "react";
import { useTranslation } from "react-i18next";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { ipc } from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { useGitStore } from "./store";

interface CommitFooterProps {
  workspacePath: string;
  stagedCount: number;
  /** A commit is already in flight. */
  busy: boolean;
  commitMsg: string;
  onCommitMsgChange: (msg: string) => void;
  run: (key: string, action: () => Promise<unknown>) => void;
  /** Total files currently selected for commit */
  selectedCount?: number;
  /** Custom handler when committing selected files (auto-stages selected before commit) */
  onCommitSelected?: () => Promise<void>;
}

/** Commit message box + commit button pinned to the bottom of the panel. */
export function CommitFooter({
  workspacePath,
  stagedCount,
  busy,
  commitMsg,
  onCommitMsgChange,
  run,
  selectedCount,
  onCommitSelected,
}: CommitFooterProps) {
  const { t, i18n } = useTranslation();
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 border-t border-separator-border p-3">
      <textarea
        value={commitMsg}
        onChange={(e) => onCommitMsgChange(e.target.value)}
        placeholder={t("git.commitMessage")}
        rows={2}
        className={cx(
          "w-full resize-none rounded-lg border border-border-button-default px-2 py-1.5",
          "text-body-medium text-text-primary placeholder:text-text-placeholder",
          "outline-none focus:border-border-focus-ring",
        )}
      />
      {draftError && (
        <p role="alert" className="break-words text-xs text-text-error-primary">
          {draftError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="small"
          className="shrink-0"
          disabled={stagedCount === 0 || busy || drafting}
          onClick={() => {
            setDrafting(true);
            setDraftError(null);
            void ipc
              .gitGenerateCommitMessage(workspacePath, null, i18n.language)
              .then((message) => {
                if (message.trim()) onCommitMsgChange(message.trim());
              })
              .catch((err: unknown) => setDraftError(errorText(err)))
              .finally(() => setDrafting(false));
          }}
        >
          <Sparkles aria-hidden className="size-4" />
          {drafting ? t("git.generatingCommitMessage") : t("git.generateCommitMessage")}
        </Button>
        <Button
          className="flex-1"
          disabled={
            (selectedCount !== undefined ? selectedCount === 0 : stagedCount === 0) ||
            commitMsg.trim().length === 0 ||
            busy
          }
          onClick={() => {
            if (onCommitSelected) {
              void onCommitSelected();
            } else {
              const message = commitMsg.trim();
              run("commit", async () => {
                await useGitStore.getState().commit(workspacePath, message);
                onCommitMsgChange("");
              });
            }
          }}
        >
          {selectedCount !== undefined && selectedCount > 0
            ? t("git.commitWithCount", { count: selectedCount })
            : t("git.commit")}
        </Button>
      </div>
    </div>
  );
}
