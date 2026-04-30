import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import {
  resolveShortcutPlatform,
  type ShortcutPlatform,
} from '../utils/undoRedoShortcut.js';
import { isCompositionRecentlySettled } from '../utils/imeCompatibility.js';

interface CompletionOpenLike {
  isOpen: boolean;
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

export interface UseNativeEventCaptureOptions {
  editableRef: React.RefObject<HTMLDivElement | null>;
  isComposingRef: MutableRefObject<boolean>;
  lastCompositionEndTimeRef: MutableRefObject<number>;
  linuxImeCompatibilityMode?: boolean;
  sendShortcut: 'enter' | 'cmdEnter';
  fileCompletion: CompletionOpenLike;
  memoryCompletion: CompletionOpenLike;
  noteCardCompletion: CompletionOpenLike;
  commandCompletion: CompletionOpenLike;
  skillCompletion: CompletionOpenLike;
  agentCompletion: CompletionOpenLike;
  promptCompletion: CompletionOpenLike;
  completionSelectedRef: MutableRefObject<boolean>;
  submittedOnEnterRef: MutableRefObject<boolean>;
  handleSubmit: () => void;
  handleEnhancePrompt: () => void;
  shortcutPlatform?: ShortcutPlatform;
}

/**
 * useNativeEventCapture - Native event capture for JCEF/IME edge cases
 *
 * Uses capturing listeners to handle:
 * - IME confirm enter false trigger
 * - beforeinput insertParagraph handling (Enter-to-send mode)
 * - prompt enhancer shortcut (Cmd+/)
 */
export function useNativeEventCapture({
  editableRef,
  isComposingRef,
  lastCompositionEndTimeRef,
  linuxImeCompatibilityMode = false,
  sendShortcut,
  fileCompletion,
  memoryCompletion,
  noteCardCompletion,
  commandCompletion,
  skillCompletion,
  agentCompletion,
  promptCompletion,
  completionSelectedRef,
  submittedOnEnterRef,
  handleSubmit,
  handleEnhancePrompt,
  shortcutPlatform,
}: UseNativeEventCaptureOptions): void {
  const sawShiftEnterRef = useRef(false);

  // Keep latest values without re-subscribing native listeners on every render.
  const latestRef = useRef<UseNativeEventCaptureOptions>({
    editableRef,
    isComposingRef,
    lastCompositionEndTimeRef,
    linuxImeCompatibilityMode,
    sendShortcut,
    fileCompletion,
    memoryCompletion,
    noteCardCompletion,
    commandCompletion,
    skillCompletion,
    agentCompletion,
    promptCompletion,
    completionSelectedRef,
    submittedOnEnterRef,
    handleSubmit,
    handleEnhancePrompt,
    shortcutPlatform,
  });
  latestRef.current = {
    editableRef,
    isComposingRef,
    lastCompositionEndTimeRef,
    linuxImeCompatibilityMode,
    sendShortcut,
    fileCompletion,
    memoryCompletion,
    noteCardCompletion,
    commandCompletion,
    skillCompletion,
    agentCompletion,
    promptCompletion,
    completionSelectedRef,
    submittedOnEnterRef,
    handleSubmit,
    handleEnhancePrompt,
    shortcutPlatform,
  };

  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;

    const nativeKeyDown = (ev: KeyboardEvent) => {
      const latest = latestRef.current;

      // NOTE: We intentionally do NOT set isComposingRef here based on keyCode 229.
      // IME composing state is managed exclusively by compositionStart/End events.
      // In JCEF, keyCode 229 is reported for ALL keys while the Korean IME is active,
      // including space, which is not an actual composition. Setting isComposingRef=true
      // here without a corresponding compositionEnd to clear it causes the ref to get
      // stuck, blocking handleInput and causing cursor jumping on space key.

      const isEnterKey = ev.key === 'Enter' || ev.keyCode === 13;
      const shift = (ev as KeyboardEvent).shiftKey === true;
      sawShiftEnterRef.current = isEnterKey && shift;

      if (isPromptEnhancerShortcut(ev, latest.shortcutPlatform)) {
        ev.preventDefault();
        ev.stopPropagation();
        latest.handleEnhancePrompt();
        return;
      }

      const isMacCursorMovementOrDelete =
        (ev.key === 'ArrowLeft' && ev.metaKey) ||
        (ev.key === 'ArrowRight' && ev.metaKey) ||
        (ev.key === 'ArrowUp' && ev.metaKey) ||
        (ev.key === 'ArrowDown' && ev.metaKey) ||
        (ev.key === 'Backspace' && ev.metaKey);
      if (isMacCursorMovementOrDelete) return;

      const isCursorMovementKey =
        ev.key === 'Home' ||
        ev.key === 'End' ||
        ((ev.key === 'a' || ev.key === 'A') && ev.ctrlKey && !ev.metaKey) ||
        ((ev.key === 'e' || ev.key === 'E') && ev.ctrlKey && !ev.metaKey);
      if (isCursorMovementKey) return;

      if (
        latest.fileCompletion.isOpen ||
        latest.memoryCompletion.isOpen ||
        latest.noteCardCompletion.isOpen ||
        latest.commandCompletion.isOpen ||
        latest.skillCompletion.isOpen ||
        latest.agentCompletion.isOpen ||
        latest.promptCompletion.isOpen
      ) {
        return;
      }

      if (latest.linuxImeCompatibilityMode) {
        return;
      }

      const isRecentlyComposing = isCompositionRecentlySettled(
        latest.lastCompositionEndTimeRef.current,
      );
      const metaOrCtrl = ev.metaKey || ev.ctrlKey;
      const isSendKey =
        latest.sendShortcut === 'cmdEnter'
          ? isEnterKey && metaOrCtrl && !latest.isComposingRef.current
          : isEnterKey &&
            !shift &&
            !latest.isComposingRef.current &&
            !isRecentlyComposing;

      if (!isSendKey) return;

      ev.preventDefault();
      latest.submittedOnEnterRef.current = true;
      latest.handleSubmit();
    };

    const nativeKeyUp = (ev: KeyboardEvent) => {
      const latest = latestRef.current;
      if (latest.linuxImeCompatibilityMode) {
        return;
      }
      const isEnterKey = ev.key === 'Enter' || ev.keyCode === 13;
      if (isEnterKey) {
        sawShiftEnterRef.current = false;
      }
      const shift = (ev as KeyboardEvent).shiftKey === true;
      const metaOrCtrl = ev.metaKey || ev.ctrlKey;

      const isSendKey =
        latest.sendShortcut === 'cmdEnter' ? isEnterKey && metaOrCtrl : isEnterKey && !shift;
      if (!isSendKey) return;

      ev.preventDefault();
      if (latest.completionSelectedRef.current) {
        latest.completionSelectedRef.current = false;
        return;
      }
      if (latest.submittedOnEnterRef.current) {
        latest.submittedOnEnterRef.current = false;
      }
    };

    const nativeBeforeInput = (ev: InputEvent) => {
      const latest = latestRef.current;
      if (latest.linuxImeCompatibilityMode) {
        return;
      }
      const type = (ev as InputEvent).inputType;
      if (type !== 'insertParagraph') return;

      if (sawShiftEnterRef.current) {
        sawShiftEnterRef.current = false;
        return;
      }

      if (latest.sendShortcut === 'cmdEnter') return;

      // IME may emit insertParagraph when confirming candidates with Enter.
      // In that case, never hijack this event for submit fallback.
      const isInputComposing = (ev as InputEvent).isComposing === true;
      const isRecentlyComposing = isCompositionRecentlySettled(
        latest.lastCompositionEndTimeRef.current,
      );
      if (latest.isComposingRef.current || isInputComposing || isRecentlyComposing) {
        return;
      }

      ev.preventDefault();
      if (latest.completionSelectedRef.current) {
        latest.completionSelectedRef.current = false;
        return;
      }
      if (
        latest.fileCompletion.isOpen ||
        latest.memoryCompletion.isOpen ||
        latest.noteCardCompletion.isOpen ||
        latest.commandCompletion.isOpen ||
        latest.skillCompletion.isOpen ||
        latest.agentCompletion.isOpen ||
        latest.promptCompletion.isOpen
      ) {
        return;
      }
      latest.handleSubmit();
    };

    el.addEventListener('keydown', nativeKeyDown, { capture: true });
    el.addEventListener('keyup', nativeKeyUp, { capture: true });
    el.addEventListener('beforeinput', nativeBeforeInput as EventListener, { capture: true });

    return () => {
      el.removeEventListener('keydown', nativeKeyDown, { capture: true });
      el.removeEventListener('keyup', nativeKeyUp, { capture: true });
      el.removeEventListener('beforeinput', nativeBeforeInput as EventListener, { capture: true });
    };
  }, [
    editableRef,
  ]);
}
