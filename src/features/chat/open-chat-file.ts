import { useFilesStore } from "@/features/files/store";
import { resolveChatFileLink } from "./file-link-resolution";

/**
 * Open a path the transcript names (a file chip, a markdown file link) in the
 * center editor. Async on purpose: a path that only exists nested below the
 * workspace root (outer folder opened as workspace) is found through the index
 * fallback instead of dead-ending in a not-found tab.
 *
 * Resolution can reject only by returning null, so an unresolvable path is a
 * silent no-op — the same contract the markdown links already rely on.
 */
export function openChatFilePath(rawPath: string, workspacePath: string): void {
  void resolveChatFileLink(rawPath, workspacePath).then((path) => {
    if (!path) return;
    void useFilesStore.getState().openFile(path);
  });
}

/** Bound variant for render paths that hand a callback down (tool chips).
 *  Returns null without a workspace root: a relative tool path has nothing to
 *  anchor on, and an affordance that always no-ops is worse than no
 *  affordance. */
export function useOpenChatFilePath(workspacePath: string) {
  const root = workspacePath.trim();
  return root ? (rawPath: string) => openChatFilePath(rawPath, root) : null;
}
