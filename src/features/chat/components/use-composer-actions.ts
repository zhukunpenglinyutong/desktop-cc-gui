import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import { mentionToken } from "@/components/application/ai-chat/file-tags";
import { pickFiles } from "@/lib/platform";
import { useChatStore, sessionKey as toSessionKey, type ActiveSession } from "../store";
import { parseAppCommand } from "@/components/application/ai-chat/app-commands";
import {
  COMPUTER_USE_SETTINGS_HASH,
  engineSupportsComputerUse,
} from "../computer-use";
import { useMcpPanel } from "@/features/mcp/panel";
import { recordPrompt } from "../prompt-history";
import { IMAGE_EXTENSIONS } from "./use-composer-images";

/** Composer submit/draft/attach/stop handlers plus the pending-@mention
 * bridge, so ChatConversation stays a composition layer. */
export function useComposerActions({
  active,
  sessionKey,
  streaming,
  images,
  clearImages,
  importImageFiles,
  supportsImages,
  composerInputRef,
}: {  active: ActiveSession | null;
  sessionKey: string;
  streaming: boolean;
  images: string[];
  clearImages: () => void;
  importImageFiles: (paths: string[], supported: boolean) => void;
  supportsImages: boolean;
  composerInputRef: React.RefObject<ComposerInputHandle | null>;
}) {
  const { t } = useTranslation();
  const pendingMention = useChatStore((s) => s.pendingMention);
  const engines = useChatStore((s) => s.engines);
  const {
    setDraft,
    clearPendingMention,
    send,
    queueMessage,
    interrupt,
    startNewChat,
    compactContext,
    setSessionError,
  } = useChatStore(
    useShallow((s) => ({
      setDraft: s.setDraft,
      clearPendingMention: s.clearPendingMention,
      send: s.send,
      queueMessage: s.queueMessage,
      interrupt: s.interrupt,
      startNewChat: s.startNewChat,
      compactContext: s.compactContext,
      setSessionError: s.setSessionError,
    })),
  );

  const submit = useCallback(
    (value: string) => {
      if (!active || (!value.trim() && images.length === 0)) return;
      // App commands resolve BEFORE the draft is cleared: a computer-use
      // send this session cannot honor leaves the user's text and
      // attachments in place to fix.
      const appCommand =
        images.length === 0
          ? parseAppCommand(value, active.workspacePath)
          : null;
      if (appCommand?.command === "cua") {
        // Bare form opens the setup door: permission status and the grant
        // flow live in Settings → 电脑操控.
        if (!appCommand.arg) {
          window.location.hash = COMPUTER_USE_SETTINGS_HASH;
          return;
        }
        if (!engineSupportsComputerUse(engines, active.engine)) {
          setSessionError(sessionKey, t("chat.cuaUnsupportedEngine"));
          return;
        }
        recordPrompt(value);
        setDraft(sessionKey, "");
        clearImages();
        // The task rides the queue with its flag, so a drained turn still
        // drives the machine instead of silently running text-only.
        if (streaming) {
          queueMessage(appCommand.arg, images, { computerUse: true }, active);
          return;
        }
        void send(appCommand.arg, images, { computerUse: true }, active);
        return;
      }
      recordPrompt(value);
      setDraft(sessionKey, "");
      clearImages();
      // App-level commands ("/new", "/compact", "/mcp") never reach the
      // engine — headless/protocol launches can't interpret them. A
      // user-defined catalog command of the same name takes precedence
      // (parseAppCommand).
      if (appCommand?.command === "new") {
        startNewChat(active.workspacePath);
        return;
      }
      if (appCommand?.command === "compact" && active.sessionId && !streaming) {
        void compactContext(sessionKey);
        return;
      }
      if (appCommand?.command === "mcp") {
        useMcpPanel.getState().openPanel();
        return;
      }
      // A turn is in flight: park the message in the session's queue; the
      // store drains it FIFO when the turn ends.
      if (streaming) {
        queueMessage(value, images, undefined, active);
        return;
      }
      void send(value, images, undefined, active);
    },
    [active, images, streaming, sessionKey, setDraft, clearImages, send, queueMessage, startNewChat, compactContext, engines, setSessionError, t],
  );

  // 文件树「+」的 pendingMention 是全局信号：分屏时只有当前聚焦那一栏（就是
  // 全局 active 所在的格子）能消费它，否则每个格子的输入框都会插一份。
  const activeSessionKey = useChatStore((s) =>
    s.active ? toSessionKey(s.active.engine, s.active.sessionId, s.active.workspacePath) : "",
  );

  // File-tree "+" asks the composer to insert an @path mention at the caret.
  useEffect(() => {
    if (!pendingMention) return;
    if (activeSessionKey !== sessionKey) return;
    clearPendingMention();
    const input = composerInputRef.current;
    if (!input) return;
    input.focus();
    input.insertText(`${mentionToken(pendingMention.path)} `);
  }, [
    pendingMention,
    activeSessionKey,
    sessionKey,
    clearPendingMention,
    composerInputRef,
  ]);

  const handleDraftChange = useCallback(
    (v: string) => setDraft(sessionKey, v),
    [sessionKey, setDraft],
  );

  // Shared partition for the file picker, OS drops, and clipboard file
  // pastes: images flow through the sandboxed image pipeline (chips); every
  // other file becomes an @mention at the caret — same as the file tree's
  // "+" — so its content stays live instead of a frozen sandbox copy.
  const routeIncomingPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const imagePaths: string[] = [];
      const mentionPaths: string[] = [];
      for (const path of paths) {
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        (IMAGE_EXTENSIONS.includes(ext) ? imagePaths : mentionPaths).push(path);
      }
      if (mentionPaths.length > 0) {
        const input = composerInputRef.current;
        if (input) {
          input.focus();
          input.insertText(`${mentionPaths.map(mentionToken).join(" ")} `);
        }
      }
      if (imagePaths.length > 0) importImageFiles(imagePaths, supportsImages);
    },
    [composerInputRef, importImageFiles, supportsImages],
  );

  // "Add → Files and folders": native multi-picker.
  const handleAddAttachments = useCallback(() => {
    void (async () => {
      const picked = await pickFiles(t("chat.addFilesFolders"));
      routeIncomingPaths(picked);
    })();
  }, [t, routeIncomingPaths]);

  const handleStop = useCallback(() => void interrupt(active), [interrupt, active]);
  const handlePickSkills = useCallback(
    () => composerInputRef.current?.openSlashPicker(),
    [composerInputRef],
  );

  return {
    submit,
    handleDraftChange,
    handleAddAttachments,
    /** OS file drop onto the composer (absolute native paths). */
    handleDroppedPaths: routeIncomingPaths,
    handleStop,
    handlePickSkills,
  };
}
