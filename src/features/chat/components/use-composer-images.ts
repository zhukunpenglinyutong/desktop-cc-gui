import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { fileName } from "@/features/files/store";
import { dataUrlBytes, imageDimensions } from "@/utils/image-meta";
import { useChatStore } from "../store";
import {
  EMPTY_ATTACHMENTS,
  isEmptyAttachments,
  resolveAttachmentKey,
  type AttachmentPreview,
  type ComposerAttachments,
} from "../store/attachments";

/** Extensions routed through the path-based image pipeline; anything else a
 *  user picks becomes an @mention instead of an attachment. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

export type { AttachmentPreview };

/** Composer image attachments: the attached image paths, their chip
 *  thumbnails, and clipboard-paste handling.
 *
 * The state lives in the chat store, keyed by sessionKey — NOT in local
 * useState. One ChatConversation instance serves every session the tab strip
 * and the split panes show (switching tabs only swaps its `active` prop), so
 * instance state would hand session A's pictures to session B. Text drafts
 * are per-key for the same reason; attachments must match. With no tab open
 * the key is "" (the unbound key, like the unbound draft): the composer stays
 * editable, and startNewChat hands that slice to the chat it opens.
 *
 * Thumbnail URLs are data URLs from the backend's readFile — the asset
 * protocol scope denies ~/.ccgui-next (app home holds secrets), so asset://
 * thumbnails of pasted images would be blocked. Same pipeline MessageImages
 * uses.
 *
 * Clipboard images are blobs without a path: persist them via the backend
 * so they flow through the same path-based pipeline every engine consumes
 * (codex -i, kimi path injection, pi/omp @file, claude/grok base64). */
export interface ComposerImages {
  images: string[];
  /** path → { preview-url, display name } for attachment chip thumbnails. */
  previews: Record<string, AttachmentPreview>;
  imageError: string | null;
  removeImage: (path: string) => void;
  clearImages: () => void;
  pasteImages: (files: File[]) => void;
  importImageFiles: (paths: string[], supported: boolean) => void;
  dismissImageError: () => void;
}

/** An attachment dropped in from a file dialog or the OS is only a path until
 *  its thumbnail lands; the reader fills these in afterwards. */
function withImages(
  current: ComposerAttachments,
  paths: string[],
): ComposerAttachments {
  if (paths.length === 0) return current;
  const seen = new Set(current.images);
  const added = paths.filter((path) => !seen.has(path));
  if (added.length === 0) return current;
  return { ...current, images: [...current.images, ...added], error: null };
}

export function useComposerImages(sessionKey: string): ComposerImages {
  const { t } = useTranslation();
  const attachments = useChatStore(
    (s) => s.composerAttachments[sessionKey] ?? EMPTY_ATTACHMENTS,
  );
  const setComposerAttachments = useChatStore((s) => s.setComposerAttachments);
  /** Move-log position read in the same render as `sessionKey`: the pair says
   *  "this key, as of this move". Uploads replay only later moves. Reading
   *  the position at call time instead would skip a move made between the
   *  render and the call — "Add → Files" awaits the native dialog, and a
   *  clipboard paste awaits the file snapshot, with the click-time callbacks.
   *  Moves are rare, so re-creating the callbacks on each one is cheap. */
  const keySeq = useChatStore((s) => s.composerAttachmentMoves.seq);

  /** Read-modify-write of THIS session's slice. The key is captured per
   *  call: an async paste/import that resolves after the user switched tabs
   *  still lands on the conversation it was started for. Async writes pass
   *  the move-log position they started at (`since`), so a conversation that
   *  changed key meanwhile (pending tab → native id) is followed to its new
   *  key instead of leaving the picture under the old one. */
  const update = useCallback(
    (fn: (current: ComposerAttachments) => ComposerAttachments, since?: number) => {
      const state = useChatStore.getState();
      const key =
        since === undefined
          ? sessionKey
          : resolveAttachmentKey(state.composerAttachmentMoves, sessionKey, since);
      const current = state.composerAttachments[key] ?? EMPTY_ATTACHMENTS;
      const next = fn(current);
      if (next !== current) setComposerAttachments(key, next);
    },
    [sessionKey, setComposerAttachments],
  );

  /** Drop one attachment and its preview. */
  const removeImage = useCallback((path: string) => {
    update((current) => {
      if (!current.images.includes(path) && !(path in current.previews)) {
        return current;
      }
      const previews = { ...current.previews };
      delete previews[path];
      return {
        ...current,
        images: current.images.filter((p) => p !== path),
        previews,
      };
    });
  }, [update]);

  /** Clear all attachments (on submit). */
  const clearImages = useCallback(() => {
    update((current) => (isEmptyAttachments(current) ? current : EMPTY_ATTACHMENTS));
  }, [update]);

  /** Dismiss the paste-error banner without clearing attachments. */
  const dismissImageError = useCallback(() => {
    update((current) => (current.error === null ? current : { ...current, error: null }));
  }, [update]);

  /** Resolve one attachment's chip thumbnail through readFile (data URL),
   * then fill in size (from the data URL payload) and pixel dimensions (from
   * decoding the image). Unreadable/oversized files simply get no thumbnail —
   * the chip falls back to a plain filename. */
  const loadPreview = useCallback((path: string, name: string, since: number) => {
    ipc
      .readFile(path)
      .then(async (content) => {
        if (content.kind !== "image" || !content.dataUrl) return;
        const url = content.dataUrl;
        const dims = (await imageDimensions(url)) ?? undefined;
        update(
          (current) =>
            // The attachment may have been removed (or the session cleared)
            // while the read was in flight: a preview for a gone path would
            // resurrect it in the map and keep the chip alive in the lightbox.
            current.images.includes(path)
              ? {
                  ...current,
                  previews: {
                    ...current.previews,
                    [path]: {
                      url,
                      name,
                      width: dims?.width,
                      height: dims?.height,
                      size: dataUrlBytes(url) ?? undefined,
                    },
                  },
                }
              : current,
          since,
        );
      })
      .catch(() => {});
  }, [update]);

  const pasteImages = useCallback(
    (files: File[]) => {
      const since = keySeq;
      update((current) => (current.error === null ? current : { ...current, error: null }));
      for (const file of files) {
        const ext = file.type.split("/")[1]?.toLowerCase() ?? "png";
        if (!IMAGE_EXTENSIONS.includes(ext)) continue;
        const name = file.name || `pasted-image.${ext}`;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          if (!base64) return;
          ipc
            .savePastedImage(base64, ext)
            .then((path) => {
              update((current) => withImages(current, [path]), since);
              loadPreview(path, name, since);
            })
            .catch((err) =>
              update(
                (current) => ({
                  ...current,
                  error: t("chat.imagePasteFailed", { message: String(err) }),
                }),
                since,
              ),
            );
        };
        reader.readAsDataURL(file);
      }
    },
    [keySeq, t, update, loadPreview],
  );

  /** Import user-picked image files: copy them into the app sandbox (picked
   * paths live outside it, so the engines' path-based pipeline cannot read
   * them in place), then attach with chip previews. `supported` gates engines
   * without image input. */
  const importImageFiles = useCallback(
    (paths: string[], supported: boolean) => {
      if (!supported) {
        update((current) => ({
          ...current,
          error: t("chat.imagesUnsupported"),
        }));
        return;
      }
      const since = keySeq;
      ipc
        .importAttachments(paths)
        .then((imported) => {
          update((current) => withImages({ ...current, error: null }, imported), since);
          for (const path of imported) {
            loadPreview(path, fileName(path), since);
          }
        })
        .catch((err) =>
          update(
            (current) => ({
              ...current,
              error: t("chat.imageImportFailed", { message: String(err) }),
            }),
            since,
          ),
        );
    },
    [keySeq, t, update, loadPreview],
  );

  return useMemo(
    () => ({
      images: attachments.images,
      previews: attachments.previews,
      imageError: attachments.error,
      removeImage,
      clearImages,
      pasteImages,
      importImageFiles,
      dismissImageError,
    }),
    [
      attachments,
      removeImage,
      clearImages,
      pasteImages,
      importImageFiles,
      dismissImageError,
    ],
  );
}
