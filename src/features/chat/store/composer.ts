import { patchSession } from "./stream";
import { isEmptyAttachments } from "./attachments";
import type { ChatStore } from "./types";
import type { StoreSet } from "./context";

/**
 * Composer and error-banner state: per-key drafts, per-key image attachments,
 * @path mention requests, and dismissing the page/session error banners.
 */

export interface ComposerDeps {
  set: StoreSet;
}

export function createComposerActions(
  deps: ComposerDeps,
): Pick<
  ChatStore,
  | "setDraft"
  | "setComposerAttachments"
  | "requestMention"
  | "clearPendingMention"
  | "dismissActionError"
  | "dismissSessionError"
  | "setSessionError"
> {
  const { set } = deps;

  return {
    setDraft: (key, text) => {
      set((s) => ({ drafts: { ...s.drafts, [key]: text } }));
    },
    setComposerAttachments: (key, next) => {
      set((s) => {
        const current = s.composerAttachments[key];
        // A slice with nothing in it is stored as ABSENT: readers fall back to
        // EMPTY_ATTACHMENTS, so keeping the empty key would only force every
        // selector to skip it. Clearing a session that has nothing attached
        // is then a true no-op — no record swap, hence no re-render of the
        // other panes' composers.
        const stored = next && !isEmptyAttachments(next) ? next : null;
        if (stored === null && current === undefined) return {};
        if (stored !== null && current === stored) return {};
        const composerAttachments = { ...s.composerAttachments };
        if (stored === null) delete composerAttachments[key];
        else composerAttachments[key] = stored;
        return { composerAttachments };
      });
    },
    requestMention: (path) => {
      set((s) => ({
        pendingMention: { path, nonce: (s.pendingMention?.nonce ?? 0) + 1 },
      }));
    },

    clearPendingMention: () => {
      set({ pendingMention: null });
    },

    dismissActionError: () => {
      set({ actionError: null });
    },
    dismissSessionError: (key) => {
      patchSession(set, key, { error: null });
    },
    setSessionError: (key, message) => {
      patchSession(set, key, { error: message });
    },
  };
}
