import { useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react';
import {
  resolveShortcutPlatform,
  type ShortcutPlatform,
  type UndoRedoShortcutAction,
} from '../utils/undoRedoShortcut.js';
import {
  isCompositionRecentlySettled,
  isImeKeydownStillComposing,
  isLinuxImeCompatibilityPlatform,
} from '../utils/imeCompatibility.js';

interface CompletionWithKeyDown {
  isOpen: boolean;
  handleKeyDown: (ev: KeyboardEvent) => boolean;
}

interface InlineCompletionHandler {
  applySuggestion: () => boolean;
}

function isPromptEnhancerShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>,
  platform: ShortcutPlatform = resolveShortcutPlatform(),
): boolean {
  if (event.altKey) {
    return false;
  }

  const isSlashKey =
    event.code === 'Slash' ||
    event.code === 'NumpadDivide' ||
    event.key === '/' ||
    event.key === '?';
  if (!isSlashKey) {
    return false;
  }

  if (platform === 'mac') {
    return !!event.metaKey && !event.ctrlKey;
  }
  if (platform === 'windows' || platform === 'linux') {
    return !!event.ctrlKey && !event.metaKey;
  }

  // Unknown platform fallback: allow either primary modifier.
  return !!event.metaKey || !!event.ctrlKey;
}

export interface UseKeyboardHandlerOptions {
  editableRef: MutableRefObject<HTMLDivElement | null>;
  isComposingRef: MutableRefObject<boolean>;
  lastCompositionEndTimeRef: MutableRefObject<number>;
  sendShortcut: 'enter' | 'cmdEnter';
  sdkStatusLoading: boolean;
  sdkInstalled: boolean;
  fileCompletion: CompletionWithKeyDown;
  memoryCompletion: CompletionWithKeyDown;
  noteCardCompletion: CompletionWithKeyDown;
  commandCompletion: CompletionWithKeyDown;
  skillCompletion: CompletionWithKeyDown;
  agentCompletion: CompletionWithKeyDown;
  promptCompletion: CompletionWithKeyDown;
  isIncrementalUndoRedoEnabled: boolean;
  resolveUndoRedoAction: (event: KeyboardEvent) => UndoRedoShortcutAction;
  handleUndoRedoAction: (action: Exclude<UndoRedoShortcutAction, null>) => void;
  handleMacCursorMovement: (e: ReactKeyboardEvent<HTMLDivElement>) => boolean;
  handleHistoryKeyDown: (e: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => boolean;
  /** Inline history completion (Tab to apply) */
  inlineCompletion?: InlineCompletionHandler;
  completionSelectedRef: MutableRefObject<boolean>;
  submittedOnEnterRef: MutableRefObject<boolean>;
  handleSubmit: () => void;
  handleEnhancePrompt?: () => void;
  shortcutPlatform?: ShortcutPlatform;
  linuxImeCompatibilityMode?: boolean;
}

/**
 * useKeyboardHandler - React keyboard event handling for the chat input box
 *
 * Handles:
 * - Completion dropdown navigation
 * - History navigation (when input empty)
 * - Send shortcut (Enter / Cmd+Enter)
 * - Preventing IME "confirm enter" false send
 */
export function useKeyboardHandler({
  editableRef,
  isComposingRef,
  lastCompositionEndTimeRef,
  sendShortcut,
  sdkStatusLoading,
  sdkInstalled,
  fileCompletion,
  memoryCompletion,
  noteCardCompletion,
  commandCompletion,
  skillCompletion,
  agentCompletion,
  promptCompletion,
  isIncrementalUndoRedoEnabled,
  resolveUndoRedoAction,
  handleUndoRedoAction,
  handleMacCursorMovement,
  handleHistoryKeyDown,
  inlineCompletion,
  completionSelectedRef,
  submittedOnEnterRef,
  handleSubmit,
  handleEnhancePrompt,
  shortcutPlatform,
  linuxImeCompatibilityMode = false,
}: UseKeyboardHandlerOptions) {
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const platform = shortcutPlatform ?? resolveShortcutPlatform();
      const isIMEComposing = isImeKeydownStillComposing(
        e.nativeEvent,
        isComposingRef.current,
        platform,
      );

      const isEnterKey =
        e.key === 'Enter' || e.nativeEvent.keyCode === 13;

      if (handleMacCursorMovement(e)) return;

      if (handleEnhancePrompt && isPromptEnhancerShortcut(e.nativeEvent, shortcutPlatform)) {
        e.preventDefault();
        e.stopPropagation();
        handleEnhancePrompt();
        return;
      }

      const isCursorMovementKey =
        e.key === 'Home' ||
        e.key === 'End' ||
        ((e.key === 'a' || e.key === 'A') && e.ctrlKey && !e.metaKey) ||
        ((e.key === 'e' || e.key === 'E') && e.ctrlKey && !e.metaKey);
      if (isCursorMovementKey) return;

      const undoRedoAction = resolveUndoRedoAction(e.nativeEvent);
      if (undoRedoAction) {
        const activeEditable = editableRef.current;
        const isFocusedEditable =
          !!activeEditable &&
          document.activeElement === activeEditable &&
          activeEditable.isContentEditable;

        if (isIncrementalUndoRedoEnabled && isFocusedEditable) {
          e.preventDefault();
          e.stopPropagation();
          handleUndoRedoAction(undoRedoAction);
          return;
        }
      }

      if (fileCompletion.isOpen) {
        const handled = fileCompletion.handleKeyDown(e.nativeEvent);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter') completionSelectedRef.current = true;
          return;
        }
      }

      if (memoryCompletion.isOpen) {
        const handled = memoryCompletion.handleKeyDown(e.nativeEvent);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter') completionSelectedRef.current = true;
          return;
        }
      }

      if (noteCardCompletion.isOpen) {
        const handled = noteCardCompletion.handleKeyDown(e.nativeEvent);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter') completionSelectedRef.current = true;
          return;
        }
      }

      if (commandCompletion.isOpen) {
        const handled = commandCompletion.handleKeyDown(e.nativeEvent);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter') completionSelectedRef.current = true;
          return;
        }
      }

      if (skillCompletion.isOpen) {
        const handled = skillCompletion.handleKeyDown(e.nativeEvent);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter') completionSelectedRef.current = true;
          return;
        }
      }

      if (agentCompletion.isOpen) {
        const handled = agentCompletion.handleKeyDown(e.nativeEvent);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter') completionSelectedRef.current = true;
          return;
        }
      }

      if (promptCompletion.isOpen) {
        const handled = promptCompletion.handleKeyDown(e.nativeEvent);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter') completionSelectedRef.current = true;
          return;
        }
      }

      // Handle inline history completion (Tab key)
      if (e.key === 'Tab' && inlineCompletion) {
        const applied = inlineCompletion.applySuggestion();
        if (applied) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      if (handleHistoryKeyDown(e)) return;

      const isRecentlyComposing = isCompositionRecentlySettled(
        lastCompositionEndTimeRef.current,
      );
      const isSendKey =
        sendShortcut === 'cmdEnter'
          ? isEnterKey && (e.metaKey || e.ctrlKey) && !isIMEComposing
          : isEnterKey && !e.shiftKey && !isIMEComposing && !isRecentlyComposing;

      if (!isSendKey) return;

      e.preventDefault();
      if (sdkStatusLoading || !sdkInstalled) return;

      submittedOnEnterRef.current = true;
      handleSubmit();
    },
    [
      editableRef,
      isComposingRef,
      handleMacCursorMovement,
      fileCompletion,
      memoryCompletion,
      noteCardCompletion,
      commandCompletion,
      skillCompletion,
      agentCompletion,
      promptCompletion,
      isIncrementalUndoRedoEnabled,
      resolveUndoRedoAction,
      handleUndoRedoAction,
      handleHistoryKeyDown,
      inlineCompletion,
      lastCompositionEndTimeRef,
      sendShortcut,
      sdkStatusLoading,
      sdkInstalled,
      submittedOnEnterRef,
      completionSelectedRef,
      handleSubmit,
      handleEnhancePrompt,
      shortcutPlatform,
    ]
  );

    const onKeyUp = useCallback(
      (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const platform = shortcutPlatform ?? resolveShortcutPlatform();
      const isEnterKey =
        e.key === 'Enter' || e.nativeEvent.keyCode === 13;

      const isSendKey =
        sendShortcut === 'cmdEnter'
          ? isEnterKey && (e.metaKey || e.ctrlKey)
          : isEnterKey && !e.shiftKey;

      if (!isSendKey) return;

      if (
        (linuxImeCompatibilityMode || isLinuxImeCompatibilityPlatform(platform)) &&
        !completionSelectedRef.current &&
        !submittedOnEnterRef.current
      ) {
        return;
      }
      e.preventDefault();

      if (completionSelectedRef.current) {
        completionSelectedRef.current = false;
        return;
      }
      if (submittedOnEnterRef.current) {
        submittedOnEnterRef.current = false;
      }
    },
    [
      shortcutPlatform,
      sendShortcut,
      linuxImeCompatibilityMode,
      completionSelectedRef,
      submittedOnEnterRef,
    ]
  );

  return { onKeyDown, onKeyUp };
}
