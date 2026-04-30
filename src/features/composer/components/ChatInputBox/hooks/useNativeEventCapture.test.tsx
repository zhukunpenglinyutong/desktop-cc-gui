// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNativeEventCapture } from './useNativeEventCapture';
import type { ShortcutPlatform } from '../utils/undoRedoShortcut.js';

function createBeforeInputEvent(inputType: string): Event {
  const event = new Event('beforeinput', {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'inputType', {
    value: inputType,
    configurable: true,
  });
  return event;
}

function createComposingBeforeInputEvent(inputType: string): Event {
  const event = createBeforeInputEvent(inputType);
  Object.defineProperty(event, 'isComposing', {
    value: true,
    configurable: true,
  });
  return event;
}

function Harness({
  sendShortcut,
  onSubmit,
  onEnhancePrompt = () => {},
  platform = 'windows',
  linuxImeCompatibilityMode = platform === 'linux',
  isComposing = false,
  compositionEndedMsAgo,
}: {
  sendShortcut: 'enter' | 'cmdEnter';
  onSubmit: () => void;
  onEnhancePrompt?: () => void;
  platform?: ShortcutPlatform;
  linuxImeCompatibilityMode?: boolean;
  isComposing?: boolean;
  compositionEndedMsAgo?: number;
}) {
  const editableRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(isComposing);
  const lastCompositionEndTimeRef = useRef(
    compositionEndedMsAgo === undefined ? 0 : Date.now() - compositionEndedMsAgo
  );
  const completionSelectedRef = useRef(false);
  const submittedOnEnterRef = useRef(false);
  const closedCompletion = { isOpen: false };

  useNativeEventCapture({
    editableRef,
    isComposingRef,
    lastCompositionEndTimeRef,
    linuxImeCompatibilityMode,
    sendShortcut,
    fileCompletion: closedCompletion,
    memoryCompletion: closedCompletion,
    noteCardCompletion: closedCompletion,
    commandCompletion: closedCompletion,
    skillCompletion: closedCompletion,
    agentCompletion: closedCompletion,
    promptCompletion: closedCompletion,
    completionSelectedRef,
    submittedOnEnterRef,
    handleSubmit: onSubmit,
    handleEnhancePrompt: onEnhancePrompt,
    shortcutPlatform: platform,
  });

  return <div ref={editableRef} data-testid="editable" tabIndex={0} />;
}

describe('useNativeEventCapture', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not submit when Shift+Enter triggers beforeinput in enter mode', () => {
    const onSubmit = vi.fn();
    render(<Harness sendShortcut="enter" onSubmit={onSubmit} />);
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 13,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    editable.dispatchEvent(createBeforeInputEvent('insertParagraph'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps beforeinput fallback submit for plain enter mode', () => {
    const onSubmit = vi.fn();
    render(<Harness sendShortcut="enter" onSubmit={onSubmit} />);
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(createBeforeInputEvent('insertParagraph'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit beforeinput fallback during active IME composition', () => {
    const onSubmit = vi.fn();
    render(<Harness sendShortcut="enter" onSubmit={onSubmit} isComposing />);
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(createBeforeInputEvent('insertParagraph'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit beforeinput fallback immediately after composition end', () => {
    const onSubmit = vi.fn();
    render(<Harness sendShortcut="enter" onSubmit={onSubmit} compositionEndedMsAgo={20} />);
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(createBeforeInputEvent('insertParagraph'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables native enter submit interception for linux compatibility mode', () => {
    const onSubmit = vi.fn();
    render(<Harness sendShortcut="enter" onSubmit={onSubmit} platform="linux" />);
    const editable = screen.getByTestId('editable');
    const keydown = new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    });

    editable.dispatchEvent(keydown);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(keydown.defaultPrevented).toBe(false);
  });

  it('disables beforeinput fallback submit for linux compatibility mode', () => {
    const onSubmit = vi.fn();
    render(<Harness sendShortcut="enter" onSubmit={onSubmit} platform="linux" />);
    const editable = screen.getByTestId('editable');
    const beforeInput = createBeforeInputEvent('insertParagraph');

    editable.dispatchEvent(beforeInput);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(beforeInput.defaultPrevented).toBe(false);
  });

  it('does not submit beforeinput fallback when InputEvent reports composing', () => {
    const onSubmit = vi.fn();
    render(<Harness sendShortcut="enter" onSubmit={onSubmit} />);
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(createComposingBeforeInputEvent('insertParagraph'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('triggers enhancer on Cmd+/ for macOS', () => {
    const onEnhancePrompt = vi.fn();
    render(
      <Harness
        sendShortcut="enter"
        onSubmit={vi.fn()}
        onEnhancePrompt={onEnhancePrompt}
        platform="mac"
      />
    );
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        code: 'Slash',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onEnhancePrompt).toHaveBeenCalledTimes(1);
  });

  it('triggers enhancer on Ctrl+/ for Windows', () => {
    const onEnhancePrompt = vi.fn();
    render(
      <Harness
        sendShortcut="enter"
        onSubmit={vi.fn()}
        onEnhancePrompt={onEnhancePrompt}
        platform="windows"
      />
    );
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        code: 'Slash',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onEnhancePrompt).toHaveBeenCalledTimes(1);
  });

  it('does not trigger enhancer on Ctrl+/ for macOS', () => {
    const onEnhancePrompt = vi.fn();
    render(
      <Harness
        sendShortcut="enter"
        onSubmit={vi.fn()}
        onEnhancePrompt={onEnhancePrompt}
        platform="mac"
      />
    );
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        code: 'Slash',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onEnhancePrompt).not.toHaveBeenCalled();
  });
});
