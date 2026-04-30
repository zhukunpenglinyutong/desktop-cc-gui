// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRef } from 'react';
import { useKeyboardHandler } from './useKeyboardHandler.js';
import { resolveUndoRedoShortcutAction, type ShortcutPlatform } from '../utils/undoRedoShortcut.js';

function Harness({
  isIncrementalUndoRedoEnabled = true,
  onUndoRedoAction = vi.fn(),
  onSubmit = vi.fn(),
  onEnhancePrompt = vi.fn(),
  platform = 'windows',
  compositionEndedMsAgo,
}: {
  isIncrementalUndoRedoEnabled?: boolean;
  onUndoRedoAction?: (action: 'undo' | 'redo') => void;
  onSubmit?: () => void;
  onEnhancePrompt?: () => void;
  platform?: ShortcutPlatform;
  compositionEndedMsAgo?: number;
}) {
  const editableRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndTimeRef = useRef(
    compositionEndedMsAgo === undefined ? 0 : Date.now() - compositionEndedMsAgo
  );
  const completionSelectedRef = useRef(false);
  const submittedOnEnterRef = useRef(false);

  const closedCompletion = {
    isOpen: false,
    handleKeyDown: () => false,
  };

  const { onKeyDown, onKeyUp } = useKeyboardHandler({
    editableRef,
    isComposingRef,
    lastCompositionEndTimeRef,
    sendShortcut: 'enter',
    sdkStatusLoading: false,
    sdkInstalled: true,
    fileCompletion: closedCompletion,
    memoryCompletion: closedCompletion,
    noteCardCompletion: closedCompletion,
    commandCompletion: closedCompletion,
    skillCompletion: closedCompletion,
    agentCompletion: closedCompletion,
    promptCompletion: closedCompletion,
    isIncrementalUndoRedoEnabled,
    resolveUndoRedoAction: (event) => resolveUndoRedoShortcutAction(event, platform),
    handleUndoRedoAction: onUndoRedoAction,
    handleMacCursorMovement: (_event: ReactKeyboardEvent<HTMLDivElement>) => false,
    handleHistoryKeyDown: () => false,
    completionSelectedRef,
    submittedOnEnterRef,
    handleSubmit: onSubmit,
    handleEnhancePrompt: onEnhancePrompt,
    shortcutPlatform: platform,
    linuxImeCompatibilityMode: platform === 'linux',
  });

  return (
    <div>
      <input data-testid="other-input" />
      <div
        ref={editableRef}
        data-testid="editable"
        tabIndex={0}
        contentEditable
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        suppressContentEditableWarning
      />
    </div>
  );
}

describe('useKeyboardHandler undo/redo integration', () => {
  afterEach(() => {
    cleanup();
  });

  it('intercepts ctrl+z and delegates to custom undo handler', () => {
    const onUndoRedoAction = vi.fn();
    const onSubmit = vi.fn();
    render(<Harness onUndoRedoAction={onUndoRedoAction} onSubmit={onSubmit} />);

    const editable = screen.getByTestId('editable');
    Object.defineProperty(editable, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    (editable as HTMLDivElement).focus();

    fireEvent.keyDown(editable, { key: 'z', ctrlKey: true });

    expect(onUndoRedoAction).toHaveBeenCalledWith('undo');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not intercept when editable is not focused', () => {
    const onUndoRedoAction = vi.fn();
    render(<Harness onUndoRedoAction={onUndoRedoAction} />);

    const editable = screen.getByTestId('editable');
    Object.defineProperty(editable, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    const otherInput = screen.getByTestId('other-input');
    (otherInput as HTMLInputElement).focus();

    fireEvent.keyDown(editable, { key: 'z', ctrlKey: true });
    expect(onUndoRedoAction).not.toHaveBeenCalled();
  });

  it('keeps existing enter-submit behavior', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const editable = screen.getByTestId('editable');
    Object.defineProperty(editable, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    (editable as HTMLDivElement).focus();

    fireEvent.keyDown(editable, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('falls back when incremental undo/redo feature is disabled', () => {
    const onUndoRedoAction = vi.fn();
    render(
      <Harness
        isIncrementalUndoRedoEnabled={false}
        onUndoRedoAction={onUndoRedoAction}
      />
    );

    const editable = screen.getByTestId('editable');
    Object.defineProperty(editable, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    (editable as HTMLDivElement).focus();

    fireEvent.keyDown(editable, { key: 'z', ctrlKey: true });
    expect(onUndoRedoAction).not.toHaveBeenCalled();
  });

  it('keeps undo/redo mapping consistent across mac/windows/linux', () => {
    const scenarios: Array<{
      platform: ShortcutPlatform;
      event: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
      expected: 'undo' | 'redo';
    }> = [
      { platform: 'mac', event: { key: 'z', metaKey: true }, expected: 'undo' },
      { platform: 'mac', event: { key: 'z', metaKey: true, shiftKey: true }, expected: 'redo' },
      { platform: 'windows', event: { key: 'z', ctrlKey: true }, expected: 'undo' },
      { platform: 'windows', event: { key: 'y', ctrlKey: true }, expected: 'redo' },
      { platform: 'windows', event: { key: 'z', ctrlKey: true, shiftKey: true }, expected: 'redo' },
      { platform: 'linux', event: { key: 'z', ctrlKey: true }, expected: 'undo' },
      { platform: 'linux', event: { key: 'z', ctrlKey: true, shiftKey: true }, expected: 'redo' },
    ];

    for (const scenario of scenarios) {
      const onUndoRedoAction = vi.fn();
      render(
        <Harness
          platform={scenario.platform}
          onUndoRedoAction={onUndoRedoAction}
        />
      );
      const editable = screen.getByTestId('editable');
      Object.defineProperty(editable, 'isContentEditable', {
        value: true,
        configurable: true,
      });
      (editable as HTMLDivElement).focus();
      fireEvent.keyDown(editable, scenario.event);
      expect(onUndoRedoAction).toHaveBeenCalledWith(scenario.expected);
      cleanup();
    }
  });

  it('triggers enhancer on Ctrl+/ in Windows React keydown path', () => {
    const onEnhancePrompt = vi.fn();
    render(<Harness onEnhancePrompt={onEnhancePrompt} platform="windows" />);
    const editable = screen.getByTestId('editable');
    (editable as HTMLDivElement).focus();

    fireEvent.keyDown(editable, { key: '/', code: 'Slash', ctrlKey: true });

    expect(onEnhancePrompt).toHaveBeenCalledTimes(1);
  });

  it('triggers enhancer on Cmd+/ in macOS React keydown path', () => {
    const onEnhancePrompt = vi.fn();
    render(<Harness onEnhancePrompt={onEnhancePrompt} platform="mac" />);
    const editable = screen.getByTestId('editable');
    (editable as HTMLDivElement).focus();

    fireEvent.keyDown(editable, { key: '/', code: 'Slash', metaKey: true });

    expect(onEnhancePrompt).toHaveBeenCalledTimes(1);
  });

  it('treats linux keyCode 229 enter as active composition and does not submit', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} platform="linux" />);
    const editable = screen.getByTestId('editable');
    (editable as HTMLDivElement).focus();

    const keyDown = createEvent.keyDown(editable, {
      key: 'Enter',
      keyCode: 229,
    });
    fireEvent(editable, keyDown);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still submits on plain linux enter after composition has fully settled', () => {
    const onSubmit = vi.fn();
    render(
      <Harness
        onSubmit={onSubmit}
        platform="linux"
        compositionEndedMsAgo={150}
      />
    );
    const editable = screen.getByTestId('editable');
    (editable as HTMLDivElement).focus();

    const keyDown = createEvent.keyDown(editable, {
      key: 'Enter',
      keyCode: 13,
    });
    fireEvent(editable, keyDown);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(keyDown.defaultPrevented).toBe(true);
  });

  it('does not consume linux enter keyup when recent composition blocked submit', () => {
    const onSubmit = vi.fn();
    render(
      <Harness
        onSubmit={onSubmit}
        platform="linux"
        compositionEndedMsAgo={20}
      />
    );
    const editable = screen.getByTestId('editable');
    (editable as HTMLDivElement).focus();

    fireEvent.keyDown(editable, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    const keyUp = createEvent.keyUp(editable, { key: 'Enter' });
    fireEvent(editable, keyUp);

    expect(keyUp.defaultPrevented).toBe(false);
  });

  it('does not trigger enhancer on Ctrl+/ in macOS path', () => {
    const onEnhancePrompt = vi.fn();
    render(<Harness onEnhancePrompt={onEnhancePrompt} platform="mac" />);
    const editable = screen.getByTestId('editable');
    (editable as HTMLDivElement).focus();

    fireEvent.keyDown(editable, { key: '/', code: 'Slash', ctrlKey: true });

    expect(onEnhancePrompt).not.toHaveBeenCalled();
  });
});
