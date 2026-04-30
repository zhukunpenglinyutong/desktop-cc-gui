import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Attachment,
  ChatInputBoxHandle,
  ChatInputBoxProps,
  CommandItem,
  FileItem,
  ManualMemoryItem,
  NoteCardItem,
  PermissionMode,
  PromptItem,
  SkillItem,
} from './types.js';
import { ChatInputBoxHeader } from './ChatInputBoxHeader.js';
import { ChatInputBoxFooter } from './ChatInputBoxFooter.js';
import { ContextBar } from './ContextBar.js';
import { ResizeHandles } from './ResizeHandles.js';
import {
  useCompletionDropdown,
  useCompletionTriggerDetection,
  useTextContent,
  useFileTags,
  useTooltip,
  useKeyboardNavigation,
  useIMEComposition,
  usePasteAndDrop,
  usePromptEnhancer,
  useGlobalCallbacks,
  useInputHistory,
  useSubmitHandler,
  useKeyboardHandler,
  useNativeEventCapture,
  useControlledValueSync,
  useAttachmentHandlers,
  useChatInputImperativeHandle,
  useSpaceKeyListener,
  useResizableChatInputBox,
  useInlineHistoryCompletion,
  useUndoRedoHistory,
} from './hooks/index.js';
import {
  commandToDropdownItem,
  fileReferenceProvider,
  fileToDropdownItem,
  slashCommandProvider,
  agentProvider,
  agentToDropdownItem,
  promptProvider,
  promptToDropdownItem,
  preloadSlashCommands,
  type AgentItem,
} from './providers/index.js';
import { debounce } from './utils/debounce.js';
import { insertTextAtCursor, setCursorOffset } from './utils/selectionUtils.js';
import { getVirtualSelectionRange, setVirtualSelectionRange } from './utils/virtualCursorUtils.js';
import {
  resolveShortcutPlatform,
  resolveUndoRedoShortcutAction,
} from './utils/undoRedoShortcut.js';
import {
  isCompositionRecentlySettled,
  isLinuxImeCompatibilityPlatform,
  shouldTriggerFileTagRenderOnSpaceKey,
} from './utils/imeCompatibility.js';
import type { CommitSnapshotOptions, UndoRedoSnapshot } from './hooks/useUndoRedoHistory.js';
import { perfTimer } from '../../utils/debug.js';
import { DEBOUNCE_TIMING } from '../../constants/performance.js';
import { requestPromptCreation } from '../../../prompts/promptEvents';
import { recordPromptUsage } from '../../../prompts/promptUsage';
import './styles.css';

const INCREMENTAL_UNDO_REDO_ENABLED = true;
const INCREMENTAL_UNDO_REDO_MAX_TRANSACTIONS = 100;
const INCREMENTAL_UNDO_REDO_MERGE_WINDOW_MS = 400;

function manualMemoryToDropdownItem(memory: ManualMemoryItem) {
  const label = memory.title?.trim() || memory.summary?.trim() || memory.id;
  const summary = memory.summary?.trim() || '';
  const meta = [memory.kind || 'note', memory.importance || 'normal'].join(' · ');
  const description = summary ? `${summary}\n${meta}` : meta;
  return {
    id: `memory:${memory.id}`,
    label,
    description,
    type: 'info' as const,
    data: {
      id: memory.id,
      title: memory.title,
      summary: memory.summary,
      detail: memory.detail,
      kind: memory.kind,
      importance: memory.importance,
      updatedAt: memory.updatedAt,
      tags: memory.tags,
    },
  };
}

function noteCardToDropdownItem(noteCard: NoteCardItem) {
  const label = noteCard.title?.trim() || noteCard.plainTextExcerpt?.trim() || noteCard.id;
  const summary = noteCard.plainTextExcerpt?.trim() || '';
  const metaParts = [];
  if (noteCard.archived) {
    metaParts.push('archived');
  }
  if (noteCard.imageCount > 0) {
    metaParts.push(`${noteCard.imageCount} image${noteCard.imageCount === 1 ? '' : 's'}`);
  }
  const meta = metaParts.join(' · ');
  const description = summary ? (meta ? `${summary}\n${meta}` : summary) : meta;
  return {
    id: `note-card:${noteCard.id}`,
    label,
    description,
    type: 'info' as const,
    data: {
      id: noteCard.id,
      title: noteCard.title,
      plainTextExcerpt: noteCard.plainTextExcerpt,
      bodyMarkdown: noteCard.bodyMarkdown,
      updatedAt: noteCard.updatedAt,
      archived: noteCard.archived,
      imageCount: noteCard.imageCount,
      previewAttachments: noteCard.previewAttachments,
    },
  };
}

function skillToDropdownItem(skill: SkillItem) {
  const label = (skill.name || '').trim();
  const source = (skill.source || '').trim();
  return {
    id: `skill:${source || 'project'}:${label}`,
    label,
    description: undefined,
    icon: 'codicon-tools',
    type: 'command' as const,
    data: {
      source: skill.source,
      path: skill.path,
      scopeLabel: skill.scopeLabel,
    },
  };
}

/**
 * ChatInputBox - Chat input component
 * Uses contenteditable div with auto height adjustment, IME handling, @ file references, / slash commands
 *
 * Performance optimizations:
 * - Uses uncontrolled mode with useImperativeHandle for minimal re-renders
 * - Debounced onInput callback to reduce parent component updates
 * - Cached getTextContent to avoid repeated DOM traversal
 */
export const ChatInputBox = memo(forwardRef<ChatInputBoxHandle, ChatInputBoxProps>(
  (
    {
      showHeader = true,
      isLoading = false,
      streamActivityPhase = 'idle',
      selectedModel = '',
      models,
      permissionMode = 'bypassPermissions',
      currentProvider = 'claude',
      providerAvailability,
      providerVersions,
      providerStatusLabels,
      providerDisabledMessages,
      usagePercentage = 0,
      usageUsedTokens,
      usageMaxTokens,
      showUsage = true,
      contextDualViewEnabled = false,
      dualContextUsage = null,
      onRequestContextCompaction,
      codexAutoCompactionEnabled = true,
      codexAutoCompactionThresholdPercent = 92,
      onCodexAutoCompactionSettingsChange,
      accountRateLimits,
      usageShowRemaining = false,
      onRefreshAccountRateLimits,
      selectedCollaborationModeId,
      onSelectCollaborationMode,
      codexSpeedMode = 'unknown',
      onCodexSpeedModeChange,
      onCodexReviewQuickStart,
      attachments: externalAttachments,
      placeholder = '', // Will be passed from parent via t('chat.inputPlaceholder')
      disabled = false,
      value,
      onSubmit,
      onStop,
      onInput,
      onAddAttachment,
      onRemoveAttachment,
      onModeSelect,
      onModelSelect,
      onProviderSelect,
      reasoningEffort = 'medium',
      onReasoningChange,
      activeFile,
      selectedLines,
      onClearContext,
      alwaysThinkingEnabled,
      onToggleThinking,
      streamingEnabled,
      onStreamingEnabledChange,
      sendShortcut = 'enter',
      selectedAgent,
      selectedContextChips,
      selectedManualMemoryIds = [],
      selectedNoteCardIds = [],
      onRemoveContextChip,
      onAgentSelect,
      onOpenAgentSettings,
      onOpenPromptSettings,
      onOpenModelSettings,
      onRefreshModelConfig,
      isModelConfigRefreshing,
      hasMessages = false,
      onRewind,
      showRewindEntry = true,
      statusPanelExpanded = true,
      showStatusPanelToggle = true,
      onToggleStatusPanel,
      completionEmailSelected,
      completionEmailDisabled,
      onToggleCompletionEmail,
      workspaceId,
      sdkInstalled = true, // Default to true to avoid disabling input box on initial state
      sdkStatusLoading = false, // SDK status loading state
      onInstallSdk,
      addToast,
      messageQueue,
      onRemoveFromQueue,
      onFuseFromQueue,
      canFuseFromQueue,
      fusingQueueMessageId,
      fileCompletionProvider,
      commandCompletionProvider,
      skillCompletionProvider,
      promptCompletionProvider,
      manualMemoryCompletionProvider,
      noteCardCompletionProvider,
      onSelectManualMemory,
      onSelectNoteCard,
      onSelectSkill,
    }: ChatInputBoxProps,
    ref: React.ForwardedRef<ChatInputBoxHandle>
  ) => {
    const { t } = useTranslation();

    // Open source banner state (show once, dismiss permanently)
    const BANNER_DISMISSED_KEY = 'openSourceBannerDismissed';
    const [showOpenSourceBanner, setShowOpenSourceBanner] = useState(
      () => !localStorage.getItem(BANNER_DISMISSED_KEY)
    );
    const handleDismissOpenSourceBanner = useCallback(() => {
      localStorage.setItem(BANNER_DISMISSED_KEY, 'true');
      setShowOpenSourceBanner(false);
    }, []);

    // Internal attachments state (if not provided externally)
    const [internalAttachments, setInternalAttachments] = useState<Attachment[]>([]);
    const attachments = externalAttachments ?? internalAttachments;

    // Input element refs and state
    const containerRef = useRef<HTMLDivElement>(null);
    const editableRef = useRef<HTMLDivElement>(null);
    const editableWrapperRef = useRef<HTMLDivElement>(null);
    const submittedOnEnterRef = useRef(false);
    const completionSelectedRef = useRef(false);
    const shiftEnterRef = useRef(false);
    const [hasContent, setHasContent] = useState(false);

    // Flag to track if we're updating from external value
    const isExternalUpdateRef = useRef(false);

    // Shared composing state ref - created early so it can be used by detectAndTriggerCompletion
    // This ref is synced with useIMEComposition's isComposingRef
    const sharedComposingRef = useRef(false);
    const activeComposingStateRef = useRef(false);
    const cancelPendingFallbackRef = useRef<() => void>(() => {});
    const isApplyingUndoRedoRef = useRef(false);
    const hasInitializedUndoRedoRef = useRef(false);
    const pendingCommitOptionsRef = useRef<CommitSnapshotOptions | null>(null);
    const lastBeforeInputTypeRef = useRef<string | undefined>(undefined);
    const lastBeforeInputSelectionReplaceRef = useRef(false);

    const shortcutPlatform = useMemo(() => resolveShortcutPlatform(), []);
    const linuxImeCompatibilityMode = useMemo(
      () => isLinuxImeCompatibilityPlatform(shortcutPlatform),
      [shortcutPlatform],
    );
    const undoRedoHistory = useUndoRedoHistory({
      maxTransactions: INCREMENTAL_UNDO_REDO_MAX_TRANSACTIONS,
      mergeWindowMs: INCREMENTAL_UNDO_REDO_MERGE_WINDOW_MS,
    });

    // Text content hook
    const { getTextContent, invalidateCache } = useTextContent({ editableRef });

    // Close all completions helper (ref-based to avoid forward-reference dependency issues)
    const closeAllCompletionsRef = useRef<() => void>(() => {});

    // File tags hook
    const { renderFileTags, pathMappingRef, justRenderedTagRef, extractFileTags, setCursorAfterPath } = useFileTags({
      editableRef,
      getTextContent,
      onCloseCompletions: useCallback(() => closeAllCompletionsRef.current(), []),
    });

    const captureUndoRedoSnapshot = useCallback((): UndoRedoSnapshot => {
      const text = getTextContent();
      const editableElement = editableRef.current;
      if (!editableElement) {
        const fallbackOffset = text.length;
        return {
          text,
          selectionStart: fallbackOffset,
          selectionEnd: fallbackOffset,
        };
      }

      const selectionRange = getVirtualSelectionRange(editableElement);
      if (selectionRange) {
        return {
          text,
          selectionStart: selectionRange.start,
          selectionEnd: selectionRange.end,
        };
      }

      const fallbackOffset = text.length;
      return {
        text,
        selectionStart: fallbackOffset,
        selectionEnd: fallbackOffset,
      };
    }, [editableRef, getTextContent]);

    const stageNextCommitOptions = useCallback((options: CommitSnapshotOptions) => {
      pendingCommitOptionsRef.current = options;
    }, []);


    // File reference completion hook
    const fileCompletion = useCompletionDropdown<FileItem>({
      trigger: '@',
      provider: fileCompletionProvider ?? fileReferenceProvider,
      toDropdownItem: fileToDropdownItem,
      onSelect: (file, query) => {
        if (!editableRef.current || !query) return;

        const text = getTextContent();
        // Prefer absolute path, fallback to relative path
        const path = file.absolutePath || file.path;
        // Directories don't add space (to continue path input), files add space
        const replacement = file.type === 'directory' ? `@${path}` : `@${path} `;
        const newText = fileCompletion.replaceText(text, replacement, query);

        // Record path mapping: filename -> full path, for tooltip display
        if (file.absolutePath) {
          // Record multiple possible keys: filename, relative path, absolute path
          pathMappingRef.current.set(file.name, file.absolutePath);
          pathMappingRef.current.set(file.path, file.absolutePath);
          pathMappingRef.current.set(file.absolutePath, file.absolutePath);
        }

        // Update input box content
        editableRef.current.innerText = newText;

        // Set cursor to correct position after the replacement text
        const cursorPos = query.start + replacement.length;
        setCursorOffset(editableRef.current, cursorPos);

        stageNextCommitOptions({
          source: 'programmatic',
          forceNewTransaction: true,
          inputType: 'completion:file',
        });
        handleInput();

        // Tell renderFileTags to place cursor after this file tag
        setCursorAfterPath(path);

        // Immediately try to render file tags (no need for user to manually input space)
        // Use setTimeout to ensure DOM update and cursor position are ready
        setTimeout(() => {
          renderFileTagsWithHistory();
        }, 0);
      },
    });

    // Manual memory completion hook (@@ trigger)
    const memoryCompletion = useCompletionDropdown<ManualMemoryItem>({
      trigger: '@@',
      provider:
        manualMemoryCompletionProvider ??
        (async () => []),
      toDropdownItem: manualMemoryToDropdownItem,
      onSelect: (memory, query) => {
        if (!editableRef.current || !query) return;

        const text = getTextContent();
        const newText = memoryCompletion.replaceText(text, '', query);
        editableRef.current.innerText = newText;
        setCursorOffset(editableRef.current, query.start);

        stageNextCommitOptions({
          source: 'programmatic',
          forceNewTransaction: true,
          inputType: 'completion:memory',
        });
        handleInput();
        onSelectManualMemory?.(memory);
      },
    });

    const noteCardCompletion = useCompletionDropdown<NoteCardItem>({
      trigger: '@#',
      provider:
        noteCardCompletionProvider ??
        (async () => []),
      toDropdownItem: noteCardToDropdownItem,
      onSelect: (noteCard, query) => {
        if (!editableRef.current || !query) return;

        const text = getTextContent();
        const newText = noteCardCompletion.replaceText(text, '', query);
        editableRef.current.innerText = newText;
        setCursorOffset(editableRef.current, query.start);

        stageNextCommitOptions({
          source: 'programmatic',
          forceNewTransaction: true,
          inputType: 'completion:note-card',
        });
        handleInput();
        onSelectNoteCard?.(noteCard);
      },
    });

    // Slash command completion hook
    const commandCompletion = useCompletionDropdown<CommandItem>({
      trigger: '/',
      provider: commandCompletionProvider ?? slashCommandProvider,
      toDropdownItem: commandToDropdownItem,
      onSelect: (command, query) => {
        if (!editableRef.current || !query) return;

        const text = getTextContent();
        const replacement = `${command.label} `;
        const newText = commandCompletion.replaceText(text, replacement, query);

        // Update input box content
        editableRef.current.innerText = newText;

        // Set cursor to correct position after the replacement text
        const cursorPos = query.start + replacement.length;
        setCursorOffset(editableRef.current, cursorPos);

        stageNextCommitOptions({
          source: 'programmatic',
          forceNewTransaction: true,
          inputType: 'completion:command',
        });
        handleInput();
      },
    });

    // Skill completion hook ($ trigger)
    const skillCompletion = useCompletionDropdown<SkillItem>({
      trigger: '$',
      provider: skillCompletionProvider ?? (async () => []),
      toDropdownItem: skillToDropdownItem,
      onSelect: (skill, query) => {
        if (!editableRef.current || !query) return;

        const text = getTextContent();
        const skillName = (skill.name || '').trim();
        if (!skillName) return;
        const replacement = '';
        const newText = skillCompletion.replaceText(text, replacement, query);

        editableRef.current.innerText = newText;

        const cursorPos = query.start + replacement.length;
        setCursorOffset(editableRef.current, cursorPos);

        stageNextCommitOptions({
          source: 'programmatic',
          forceNewTransaction: true,
          inputType: 'completion:skill',
        });
        handleInput();
        onSelectSkill?.(skillName);
      },
    });

    // Agent selection completion hook (# trigger at line start)
    const agentCompletion = useCompletionDropdown<AgentItem>({
      trigger: '#',
      provider: agentProvider,
      toDropdownItem: agentToDropdownItem,
      onSelect: (agent, query) => {
        // Skip loading and empty state special items
        if (
          agent.id === '__loading__' ||
          agent.id === '__empty__' ||
          agent.id === '__empty_state__'
        )
          return;

        // Handle create agent
        if (agent.id === '__create_new__') {
          onOpenAgentSettings?.();
          // Clear # trigger text from input box
          if (editableRef.current && query) {
            const text = getTextContent();
            const newText = agentCompletion.replaceText(text, '', query);
            editableRef.current.innerText = newText;

            // Set cursor to the position where trigger was removed
            setCursorOffset(editableRef.current, query.start);

            stageNextCommitOptions({
              source: 'programmatic',
              forceNewTransaction: true,
              inputType: 'completion:agent-create',
            });
            handleInput();
          }
          return;
        }

        // Select agent: don't insert text, call onAgentSelect callback
        onAgentSelect?.({ id: agent.id, name: agent.name, prompt: agent.prompt, icon: agent.icon });

        // Clear # trigger text from input box
        if (editableRef.current && query) {
          const text = getTextContent();
          const newText = agentCompletion.replaceText(text, '', query);
          editableRef.current.innerText = newText;

          // Set cursor to the position where trigger was removed
          setCursorOffset(editableRef.current, query.start);

          stageNextCommitOptions({
            source: 'programmatic',
            forceNewTransaction: true,
            inputType: 'completion:agent-select',
          });
          handleInput();
        }
      },
    });

    // Prompt completion hook (! trigger)
    const promptCompletion = useCompletionDropdown<PromptItem>({
      trigger: '!',
      provider: promptCompletionProvider ?? promptProvider,
      toDropdownItem: promptToDropdownItem,
      onSelect: (prompt, query) => {
        // Skip loading and empty state special items
        if (
          prompt.id === '__loading__' ||
          prompt.id === '__empty__' ||
          prompt.id === '__empty_state__'
        )
          return;

        // Handle create prompt
        if (prompt.id === '__create_new__') {
          requestPromptCreation({ scope: 'workspace' });
          onOpenPromptSettings?.();
          // Clear ! trigger text from input box
          if (editableRef.current && query) {
            const text = getTextContent();
            const newText = promptCompletion.replaceText(text, '', query);
            editableRef.current.innerText = newText;

            // Set cursor to the position where trigger was removed
            setCursorOffset(editableRef.current, query.start);

            stageNextCommitOptions({
              source: 'programmatic',
              forceNewTransaction: true,
              inputType: 'completion:prompt-create',
            });
            handleInput();
          }
          return;
        }

        recordPromptUsage(prompt.id);

        // Insert prompt content at cursor position
        if (editableRef.current && query) {
          const text = getTextContent();
          // Replace trigger and query with the prompt content
          const newText = promptCompletion.replaceText(text, prompt.content, query);
          editableRef.current.innerText = newText;

          // Set cursor to end of inserted prompt content
          const cursorPos = query.start + prompt.content.length;
          setCursorOffset(editableRef.current, cursorPos);

          stageNextCommitOptions({
            source: 'programmatic',
            forceNewTransaction: true,
            inputType: 'completion:prompt',
          });
          handleInput();
        }
      },
    });

    // Sync closeAllCompletionsRef after all completion hooks are defined
    closeAllCompletionsRef.current = () => {
      fileCompletion.close();
      memoryCompletion.close();
      noteCardCompletion.close();
      commandCompletion.close();
      skillCompletion.close();
      agentCompletion.close();
      promptCompletion.close();
    };

    // Inline history completion hook (simple tab-complete style)
    const inlineCompletion = useInlineHistoryCompletion({
      debounceMs: 100,
      minQueryLength: 2,
    });

    // Tooltip hook
    const { tooltip, handleMouseOver, handleMouseLeave } = useTooltip();

    /**
     * Clear input box
     */
    const clearInput = useCallback(() => {
      if (editableRef.current) {
        editableRef.current.innerHTML = '';
        editableRef.current.style.height = 'auto';
        setHasContent(false);
        undoRedoHistory.reset({
          text: '',
          selectionStart: 0,
          selectionEnd: 0,
        });
        pendingCommitOptionsRef.current = null;
        lastBeforeInputTypeRef.current = undefined;
        lastBeforeInputSelectionReplaceRef.current = false;
        // Notify parent component that input is cleared
        onInput?.('');
      }
    }, [onInput, undoRedoHistory]);

    /**
     * Adjust input box height
     * Let contenteditable element expand naturally (height: auto),
     * outer container (.input-editable-wrapper) controls scrolling via max-height and overflow-y.
     * This avoids double scrollbar issue from outer + inner element scrolling.
     */
    const adjustHeight = useCallback(() => {
      const el = editableRef.current;
      if (!el) return;

      // Ensure height is auto, expanded by content
      el.style.height = 'auto';
      // Hide inner scrollbar, completely rely on outer container scrolling
      el.style.overflowY = 'hidden';
    }, []);

    const renderFileTagsWithHistory = useCallback(() => {
      if (!INCREMENTAL_UNDO_REDO_ENABLED) {
        renderFileTags();
        return;
      }

      const before = captureUndoRedoSnapshot();
      renderFileTags();
      const after = captureUndoRedoSnapshot();
      if (
        before.text !== after.text ||
        before.selectionStart !== after.selectionStart ||
        before.selectionEnd !== after.selectionEnd
      ) {
        undoRedoHistory.commitSnapshot(after, {
          source: 'programmatic',
          forceNewTransaction: true,
          inputType: 'render:file-tags',
          timestamp: Date.now(),
        });
      }
    }, [captureUndoRedoSnapshot, renderFileTags, undoRedoHistory]);

    // Create debounced version of renderFileTags
    const debouncedRenderFileTags = useMemo(
      () => debounce(renderFileTagsWithHistory, DEBOUNCE_TIMING.FILE_TAG_RENDERING_MS),
      [renderFileTagsWithHistory]
    );

    // Completion trigger detection hook
    const { debouncedDetectCompletion } = useCompletionTriggerDetection({
      editableRef,
      sharedComposingRef,
      justRenderedTagRef,
      getTextContent,
      fileCompletion,
      memoryCompletion,
      noteCardCompletion,
      commandCompletion,
      skillCompletion,
      agentCompletion,
      promptCompletion,
    });

    // Performance optimization: Debounced onInput callback
    // Reduces parent component re-renders during rapid typing
    // Also skips during IME composition to prevent parent re-renders that cause JCEF stutter
    const debouncedOnInput = useMemo(
      () =>
        debounce((text: string) => {
          // Skip if this is an external value update to avoid loops
          if (isExternalUpdateRef.current) {
            isExternalUpdateRef.current = false;
            return;
          }
          // Skip during active IME composition to prevent parent re-renders
          // that can disrupt Korean/CJK input in JCEF environments.
          // The update will be triggered after compositionEnd via handleInput.
          if (sharedComposingRef.current) {
            return;
          }
          onInput?.(text);
        }, DEBOUNCE_TIMING.ON_INPUT_CALLBACK_MS),
      [onInput]
    );

    /**
     * Handle input event (optimized: use debounce to reduce performance overhead)
     */
    const handleInput = useCallback(
      () => {
        const timer = perfTimer('handleInput');

        // Only trust our own isComposingRef for IME state detection.
        // JCEF's InputEvent.isComposing is unreliable (can be false during active
        // composition, or true after compositionEnd). Our ref is set synchronously
        // by compositionStart/End and keyCode 229 detection, making it the sole
        // reliable source of truth.
        if (activeComposingStateRef.current) {
          return;
        }

        // Cancel any pending compositionEnd fallback timeout.
        // The normal input event path handles state sync, so the fallback
        // (which would redundantly call handleInput again) is no longer needed.
        // This prevents: 1) double handleInput calls, 2) debouncedOnInput timer
        // reset that delays parent notification by an extra 100ms.
        cancelPendingFallbackRef.current();

        // Invalidate cache since content changed
        invalidateCache();
        timer.mark('invalidateCache');

        const text = getTextContent();
        timer.mark('getTextContent');

        // Remove zero-width and other invisible characters before checking if empty, ensure placeholder shows when only zero-width characters remain
        const cleanText = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
        const isEmpty = !cleanText.trim();

        // If content is empty, clear innerHTML to ensure :empty pseudo-class works (show placeholder)
        if (isEmpty && editableRef.current) {
          editableRef.current.innerHTML = '';
        }

        // Adjust height
        adjustHeight();
        timer.mark('adjustHeight');

        // Trigger completion detection and state update
        debouncedDetectCompletion();
        setHasContent(!isEmpty);

        // Update inline history completion
        // Only if no other completion menu is open
        // Note: Access isOpen directly from the completion objects at call time
        // to avoid unnecessary re-renders when isOpen changes
        const isOtherCompletionOpen =
          fileCompletion.isOpen ||
          memoryCompletion.isOpen ||
          noteCardCompletion.isOpen ||
          commandCompletion.isOpen ||
          skillCompletion.isOpen ||
          agentCompletion.isOpen ||
          promptCompletion.isOpen;
        if (!isOtherCompletionOpen) {
          inlineCompletion.updateQuery(text);
        } else {
          inlineCompletion.clear();
        }

        if (INCREMENTAL_UNDO_REDO_ENABLED && !isApplyingUndoRedoRef.current) {
          const stagedOptions = pendingCommitOptionsRef.current;
          const commitOptions: CommitSnapshotOptions = {
            source: stagedOptions?.source ?? 'input',
            inputType: stagedOptions?.inputType ?? lastBeforeInputTypeRef.current,
            forceNewTransaction: stagedOptions?.forceNewTransaction,
            selectionReplaced:
              stagedOptions?.selectionReplaced ??
              lastBeforeInputSelectionReplaceRef.current,
            timestamp: stagedOptions?.timestamp ?? Date.now(),
            isComposing: stagedOptions?.isComposing ?? activeComposingStateRef.current,
          };

          const snapshot = captureUndoRedoSnapshot();
          undoRedoHistory.commitSnapshot(
            {
              text: isEmpty ? '' : snapshot.text,
              selectionStart: snapshot.selectionStart,
              selectionEnd: snapshot.selectionEnd,
            },
            commitOptions
          );
        }

        pendingCommitOptionsRef.current = null;
        lastBeforeInputTypeRef.current = undefined;
        lastBeforeInputSelectionReplaceRef.current = false;

        // Notify parent component (use debounced version to reduce re-renders)
        // If determined empty (only zero-width characters), pass empty string to parent
        debouncedOnInput(isEmpty ? '' : text);

        timer.end();
      },
      // Note: completion controller objects are stable references
      // We access .isOpen at call time, so we don't need .isOpen in deps
      [
        getTextContent,
        adjustHeight,
        debouncedDetectCompletion,
        debouncedOnInput,
        invalidateCache,
        fileCompletion,
        memoryCompletion,
        noteCardCompletion,
        commandCompletion,
        skillCompletion,
        agentCompletion,
        promptCompletion,
        inlineCompletion,
        captureUndoRedoSnapshot,
        undoRedoHistory,
      ]
    );

    const applyUndoRedoSnapshot = useCallback(
      (snapshot: UndoRedoSnapshot) => {
        const editableElement = editableRef.current;
        if (!editableElement) return;

        isApplyingUndoRedoRef.current = true;
        editableElement.innerText = snapshot.text;
        invalidateCache();
        renderFileTags();
        setVirtualSelectionRange(
          editableElement,
          snapshot.selectionStart,
          snapshot.selectionEnd
        );
        handleInput();
        window.setTimeout(() => {
          isApplyingUndoRedoRef.current = false;
        }, 0);
      },
      [editableRef, handleInput, invalidateCache, renderFileTags]
    );

    /**
     * Apply inline history completion (Tab key)
     */
    const applyInlineCompletion = useCallback(() => {
      const fullText = inlineCompletion.applySuggestion();
      if (!fullText || !editableRef.current) return false;

      // Fill the input with the complete text
      editableRef.current.innerText = fullText;

      // Set cursor to end
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(editableRef.current);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);

      // Update state
      stageNextCommitOptions({
        source: 'programmatic',
        forceNewTransaction: true,
        inputType: 'completion:inline-history',
      });
      handleInput();
      return true;
    }, [inlineCompletion, handleInput, stageNextCommitOptions]);

    // IME composition hook (ref-only, no React state to avoid re-renders during composition)
    const {
      isComposingRef,
      lastCompositionEndTimeRef,
      handleCompositionStart: rawHandleCompositionStart,
      handleCompositionEnd: rawHandleCompositionEnd,
      cancelPendingFallback,
    } = useIMEComposition({
      handleInput,
    });
    activeComposingStateRef.current = isComposingRef.current;
    cancelPendingFallbackRef.current = cancelPendingFallback;

    // Wrap composition handlers to sync sharedComposingRef (used by completion detection)
    // Both refs are now set synchronously — no RAF, no race conditions.
    const handleCompositionStart = useCallback(() => {
      rawHandleCompositionStart();
      sharedComposingRef.current = true;
      activeComposingStateRef.current = true;
      // Cancel pending space-triggered file tag render to avoid DOM rewrites
      // during active IME composition (can break candidate confirmation).
      debouncedRenderFileTags.cancel();
    }, [rawHandleCompositionStart, debouncedRenderFileTags]);

    const handleCompositionEnd = useCallback(() => {
      rawHandleCompositionEnd();
      sharedComposingRef.current = false;
      activeComposingStateRef.current = false;
    }, [rawHandleCompositionEnd]);

    const { record: recordInputHistory, handleKeyDown: handleHistoryKeyDown } = useInputHistory({
      editableRef,
      getTextContent,
      handleInput,
    });

    // Keyboard navigation hook
    const { handleMacCursorMovement } = useKeyboardNavigation({
      editableRef,
      handleInput,
    });

    /**
     * Handle keyboard down event (for detecting space to trigger file tag rendering)
     * Optimized: use debounce for delayed rendering
     */
    const handleKeyDownForTagRendering = useCallback(
      (e: KeyboardEvent) => {
        if (
          !shouldTriggerFileTagRenderOnSpaceKey(e, {
            isComposing: sharedComposingRef.current,
            lastCompositionEndTime: lastCompositionEndTimeRef.current,
            platform: shortcutPlatform,
          })
        ) {
          debouncedRenderFileTags.cancel();
          return;
        }

        // If space key pressed outside IME composition, use debounce for delayed rendering.
        debouncedRenderFileTags();
      },
      [debouncedRenderFileTags, lastCompositionEndTimeRef, sharedComposingRef, shortcutPlatform]
    );

    const handleSubmit = useSubmitHandler({
      getTextContent,
      invalidateCache,
      attachments,
      sdkStatusLoading,
      sdkInstalled,
      currentProvider,
      clearInput,
      cancelPendingInput: () => {
        debouncedOnInput.cancel();
      },
      externalAttachments,
      setInternalAttachments,
      fileCompletion,
      memoryCompletion,
      noteCardCompletion,
      commandCompletion,
      skillCompletion,
      agentCompletion,
      promptCompletion,
      recordInputHistory,
      onSubmit,
      onInstallSdk,
      addToast,
      t,
    });

    const handleUndoRedoAction = useCallback(
      (action: 'undo' | 'redo') => {
        if (!INCREMENTAL_UNDO_REDO_ENABLED) {
          return;
        }
        const snapshot = action === 'undo' ? undoRedoHistory.undo() : undoRedoHistory.redo();
        if (!snapshot) {
          return;
        }
        applyUndoRedoSnapshot(snapshot);
      },
      [applyUndoRedoSnapshot, undoRedoHistory]
    );

    const resolveUndoRedoAction = useCallback(
      (event: KeyboardEvent) => {
        if (!INCREMENTAL_UNDO_REDO_ENABLED) {
          return null;
        }
        return resolveUndoRedoShortcutAction(event, shortcutPlatform);
      },
      [shortcutPlatform]
    );

    // Prompt enhancer hook
    const {
      isEnhancing,
      enhancingEngine,
      showEnhancerDialog,
      originalPrompt,
      enhancedPrompt,
      canUseEnhancedPrompt,
      handleEnhancePrompt,
      handleUseEnhancedPrompt,
      handleKeepOriginalPrompt,
      handleCloseEnhancerDialog,
    } = usePromptEnhancer({
      workspaceId,
      editableRef,
      getTextContent,
      currentProvider,
      selectedModel,
      setHasContent,
      handleInput,
      stageNextCommitOptions,
    });

    const { onKeyDown: handleKeyDown, onKeyUp: handleKeyUp } = useKeyboardHandler({
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
      isIncrementalUndoRedoEnabled: INCREMENTAL_UNDO_REDO_ENABLED,
      resolveUndoRedoAction,
      handleUndoRedoAction,
      handleMacCursorMovement,
      handleHistoryKeyDown,
      // Inline completion: Tab key applies suggestion
      inlineCompletion: inlineCompletion.hasSuggestion ? {
        applySuggestion: applyInlineCompletion,
      } : undefined,
      completionSelectedRef,
      submittedOnEnterRef,
      handleSubmit,
      handleEnhancePrompt,
      shortcutPlatform,
      linuxImeCompatibilityMode,
    });

    useControlledValueSync({
      value,
      editableRef,
      isComposingRef,
      isExternalUpdateRef,
      getTextContent,
      setHasContent,
      adjustHeight,
      invalidateCache,
    });

    useEffect(() => {
      if (!INCREMENTAL_UNDO_REDO_ENABLED || hasInitializedUndoRedoRef.current) {
        return;
      }
      hasInitializedUndoRedoRef.current = true;
      undoRedoHistory.reset(captureUndoRedoSnapshot());
    }, [captureUndoRedoSnapshot, undoRedoHistory]);

    useNativeEventCapture({
      editableRef,
      isComposingRef,
      lastCompositionEndTimeRef,
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
      linuxImeCompatibilityMode,
    });

    // Paste and drop hook
    const {
      handlePaste,
      handleDragOver,
      handleDragEnter,
      handleDragLeave,
      handleDrop,
      isDragOver,
      dragPreviewNames,
      handleDroppedPaths,
    } = usePasteAndDrop({
      disabled,
      editableRef,
      dropZoneRef: containerRef,
      pathMappingRef,
      getTextContent,
      adjustHeight,
      renderFileTags: renderFileTagsWithHistory,
      setHasContent,
      setInternalAttachments,
      onInput,
      fileCompletion,
      commandCompletion,
      handleInput,
      stageNextCommitOptions,
      flushInput: () => {
        debouncedOnInput.flush();
      },
    });
    const dragPreviewText = useMemo(() => {
      if (dragPreviewNames.length === 0) {
        return "";
      }
      const first = dragPreviewNames[0];
      if (dragPreviewNames.length === 1) {
        return first;
      }
      return `${first} ${t("chat.dragDropMore", { count: dragPreviewNames.length - 1 })}`;
    }, [dragPreviewNames, t]);

    const { handleAddAttachment, handleRemoveAttachment } = useAttachmentHandlers({
      externalAttachments,
      onAddAttachment,
      onRemoveAttachment,
      onAttachPaths: handleDroppedPaths,
      setInternalAttachments,
    });

    /**
     * Handle mode select
     */
    const handleModeSelect = useCallback(
      (mode: PermissionMode) => {
        onModeSelect?.(mode);
      },
      [onModeSelect]
    );

    /**
     * Handle model select
     */
    const handleModelSelect = useCallback(
      (modelId: string) => {
        onModelSelect?.(modelId);
      },
      [onModelSelect]
    );

    /**
     * Focus input box
     */
    const focusInput = useCallback(() => {
      editableRef.current?.focus();
    }, []);

    useChatInputImperativeHandle({
      ref,
      editableRef,
      getTextContent,
      invalidateCache,
      isExternalUpdateRef,
      setHasContent,
      adjustHeight,
      focusInput,
      clearInput,
      hasContent,
      extractFileTags,
    });

    // Global callbacks hook
    useGlobalCallbacks({
      editableRef,
      pathMappingRef,
      getTextContent,
      adjustHeight,
      renderFileTags: renderFileTagsWithHistory,
      setHasContent,
      onInput,
      handleInput,
      stageNextCommitOptions,
      fileCompletion,
      commandCompletion,
      focusInput,
    });

    // Preload slash commands on mount to improve perceived performance
    // Load command data before user types "/" so it's immediately available
    useEffect(() => {
      if (!commandCompletionProvider) {
        preloadSlashCommands();
      }
    }, [commandCompletionProvider]);

    useSpaceKeyListener({ editableRef, onKeyDown: handleKeyDownForTagRendering });

    const {
      isResizing: isResizingInputBox,
      isCollapsed: isInputBoxCollapsed,
      containerStyle,
      editableWrapperStyle,
      getHandleProps,
      nudge,
    } = useResizableChatInputBox({
      containerRef,
      editableWrapperRef,
    });

    const handleExpandCollapsedInputBox = useCallback(() => {
      nudge({ wrapperHeightPx: 24 });
      window.requestAnimationFrame(() => {
        focusInput();
      });
    }, [focusInput, nudge]);

    const handleShortcutChipClick = useCallback((trigger: '@' | '@@' | '/' | '$' | '#' | '!') => {
      const editableElement = editableRef.current;
      if (!editableElement || disabled) {
        return;
      }

      editableElement.focus();
      const inserted = insertTextAtCursor(trigger, editableElement);
      if (!inserted) {
        const currentText = getTextContent();
        const nextText = `${currentText}${trigger}`;
        editableElement.innerText = nextText;
        setCursorOffset(editableElement, nextText.length);
      }

      stageNextCommitOptions({
        source: 'programmatic',
        forceNewTransaction: true,
        inputType: 'shortcut:chip',
      });
      handleInput();
    }, [disabled, getTextContent, handleInput, stageNextCommitOptions]);

    const settingsShortcutActions = useMemo(
      () => ([
        {
          key: 'file',
          trigger: '@' as const,
          label: t('chat.shortcutActionFile'),
          onClick: () => handleShortcutChipClick('@'),
        },
        {
          key: 'memory',
          trigger: '@@' as const,
          label: t('chat.shortcutActionMemory'),
          onClick: () => handleShortcutChipClick('@@'),
        },
        {
          key: 'command',
          trigger: '/' as const,
          label: t('chat.shortcutActionCommand'),
          onClick: () => handleShortcutChipClick('/'),
        },
        {
          key: 'skill',
          trigger: '$' as const,
          label: t('chat.shortcutActionSkill'),
          onClick: () => handleShortcutChipClick('$'),
        },
        {
          key: 'agent',
          trigger: '#' as const,
          label: t('chat.shortcutActionAgent'),
          onClick: () => handleShortcutChipClick('#'),
        },
        {
          key: 'prompt',
          trigger: '!' as const,
          label: t('chat.shortcutActionPrompt'),
          onClick: () => handleShortcutChipClick('!'),
        },
        {
          key: 'enhance',
          trigger: '⌘/Ctrl+/' as const,
          label: t('chat.shortcutActionEnhance'),
          onClick: handleEnhancePrompt,
        },
      ]),
      [handleEnhancePrompt, handleShortcutChipClick, t],
    );

    return (
      <div className="chat-input-box-wrapper">
        <div
          className={`chat-input-box ${isResizingInputBox ? 'is-resizing' : ''}${isInputBoxCollapsed ? ' is-collapsed' : ''}${isDragOver ? " is-drag-over" : ""}`}
          onClick={() => {
            if (isInputBoxCollapsed) return;
            focusInput();
          }}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          ref={containerRef}
          style={containerStyle}
        >
          {showHeader && (
            <ResizeHandles
              getHandleProps={getHandleProps}
              nudge={nudge}
              isCollapsed={isInputBoxCollapsed}
              onExpandCollapsed={handleExpandCollapsedInputBox}
            />
          )}

          {!isInputBoxCollapsed && showHeader && (
            <ChatInputBoxHeader
              sdkStatusLoading={sdkStatusLoading}
              sdkInstalled={sdkInstalled}
              currentProvider={currentProvider}
              onInstallSdk={onInstallSdk}
              t={t}
              attachments={attachments}
              onRemoveAttachment={handleRemoveAttachment}
              messageQueue={messageQueue}
              onRemoveFromQueue={onRemoveFromQueue}
              onFuseFromQueue={onFuseFromQueue}
              canFuseFromQueue={canFuseFromQueue}
              fusingQueueMessageId={fusingQueueMessageId}
              showOpenSourceBanner={showOpenSourceBanner}
              onDismissOpenSourceBanner={handleDismissOpenSourceBanner}
            />
          )}

          {/* Input area */}
          {!isInputBoxCollapsed && (
            <div
              ref={editableWrapperRef}
              className={`input-editable-wrapper${isDragOver ? " is-drag-over" : ""}`}
              onMouseOver={handleMouseOver}
              onMouseLeave={handleMouseLeave}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={editableWrapperStyle}
            >
              {isDragOver ? (
                <div className="input-drag-overlay" aria-hidden>
                  <span className="input-drag-overlay-label">{t("chat.dragDropHint")}</span>
                  {dragPreviewText ? (
                    <span className="input-drag-overlay-chip">{dragPreviewText}</span>
                  ) : null}
                </div>
              ) : null}

              <div
                ref={editableRef}
                className="input-editable"
                contentEditable={!disabled}
                spellCheck={false}
                data-placeholder={placeholder}
                data-completion-suffix={inlineCompletion.suffix || ''}
                onInput={() => {
                  // Don't pass browser's isComposing — it's unreliable in JCEF.
                  // isComposingRef (set by compositionStart/End + keyCode 229) is the
                  // sole source of truth for IME state.
                  handleInput();
                }}
                onKeyDown={(e) => {
                  const isEnterKey =
                    e.key === 'Enter' || e.nativeEvent.keyCode === 13;
                  shiftEnterRef.current = isEnterKey && e.shiftKey;
                  handleKeyDown(e);
                }}
                onKeyUp={(e) => {
                  const isEnterKey =
                    e.key === 'Enter' || e.nativeEvent.keyCode === 13;
                  if (isEnterKey) {
                    shiftEnterRef.current = false;
                  }
                  handleKeyUp(e);
                }}
                onBeforeInput={(e) => {
                  const inputType =
                    'inputType' in e.nativeEvent
                      ? (e.nativeEvent as InputEvent).inputType
                      : undefined;
                  lastBeforeInputTypeRef.current = inputType;
                  const selectionRange = editableRef.current
                    ? getVirtualSelectionRange(editableRef.current)
                    : null;
                  lastBeforeInputSelectionReplaceRef.current = !!selectionRange &&
                    selectionRange.start !== selectionRange.end;
                  if (inputType === 'insertParagraph') {
                    if (linuxImeCompatibilityMode) {
                      return;
                    }
                    if (shiftEnterRef.current) {
                      return;
                    }
                    if (sendShortcut === 'cmdEnter') {
                      return;
                    }

                    // IME confirm may also emit insertParagraph; do not hijack it.
                    const isRecentlyComposing = isCompositionRecentlySettled(
                      lastCompositionEndTimeRef.current,
                    );
                    if (isComposingRef.current || isRecentlyComposing) {
                      return;
                    }

                    e.preventDefault();
                    // If item was just selected in completion menu with enter, don't send message
                    if (completionSelectedRef.current) {
                      completionSelectedRef.current = false;
                      return;
                    }
                    // Don't send message when completion menu is open
                    if (
                      fileCompletion.isOpen ||
                      memoryCompletion.isOpen ||
                      noteCardCompletion.isOpen ||
                      commandCompletion.isOpen ||
                      skillCompletion.isOpen ||
                      agentCompletion.isOpen ||
                      promptCompletion.isOpen
                    ) {
                      return;
                    }
                    // Only allow submit when not loading and not in IME composition
                    if (!isLoading && !isComposingRef.current) {
                      handleSubmit();
                    }
                  }
                  // Fix: Remove delete key special handling during IME
                  // Let browser naturally handle delete operations, sync state uniformly after compositionend
                }}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onPaste={handlePaste}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                suppressContentEditableWarning
              />
            </div>
          )}

          {!isInputBoxCollapsed && (
            <ChatInputBoxFooter
              disabled={disabled}
              hasInputContent={hasContent || attachments.length > 0}
              isLoading={isLoading}
              streamActivityPhase={streamActivityPhase}
              isEnhancing={isEnhancing}
              selectedModel={selectedModel}
              models={models}
              permissionMode={permissionMode}
              currentProvider={currentProvider}
              workspaceId={workspaceId}
              providerAvailability={providerAvailability}
              providerVersions={providerVersions}
              providerStatusLabels={providerStatusLabels}
              providerDisabledMessages={providerDisabledMessages}
              reasoningEffort={reasoningEffort}
              accountRateLimits={accountRateLimits}
              usageShowRemaining={usageShowRemaining}
              onRefreshAccountRateLimits={onRefreshAccountRateLimits}
              selectedCollaborationModeId={selectedCollaborationModeId}
              onSelectCollaborationMode={onSelectCollaborationMode}
              codexSpeedMode={codexSpeedMode}
              onCodexSpeedModeChange={onCodexSpeedModeChange}
              onCodexReviewQuickStart={onCodexReviewQuickStart}
              onSubmit={handleSubmit}
              onStop={onStop}
              onModeSelect={handleModeSelect}
              onModelSelect={handleModelSelect}
              onProviderSelect={onProviderSelect}
              onReasoningChange={onReasoningChange}
              onEnhancePrompt={handleEnhancePrompt}
              alwaysThinkingEnabled={alwaysThinkingEnabled}
              onToggleThinking={onToggleThinking}
              streamingEnabled={streamingEnabled}
              onStreamingEnabledChange={onStreamingEnabledChange}
              sendShortcut={sendShortcut}
              selectedAgent={selectedAgent}
              onAgentSelect={(agent) => onAgentSelect?.(agent)}
              onOpenAgentSettings={onOpenAgentSettings}
              onAddModel={onOpenModelSettings}
              onRefreshModelConfig={onRefreshModelConfig}
              isModelConfigRefreshing={isModelConfigRefreshing}
              onClearAgent={() => onAgentSelect?.(null)}
              fileCompletion={fileCompletion}
              memoryCompletion={memoryCompletion}
              noteCardCompletion={noteCardCompletion}
              commandCompletion={commandCompletion}
              skillCompletion={skillCompletion}
              agentCompletion={agentCompletion}
              promptCompletion={promptCompletion}
              selectedManualMemoryIds={selectedManualMemoryIds}
              selectedNoteCardIds={selectedNoteCardIds}
              shortcutActions={settingsShortcutActions}
              tooltip={tooltip}
              promptEnhancer={{
                isOpen: showEnhancerDialog,
                isLoading: isEnhancing,
                loadingEngine: enhancingEngine,
                originalPrompt,
                enhancedPrompt,
                canUseEnhanced: canUseEnhancedPrompt,
                onUseEnhanced: handleUseEnhancedPrompt,
                onKeepOriginal: handleKeepOriginalPrompt,
                onClose: handleCloseEnhancerDialog,
              }}
              t={t}
            />
          )}
        </div>

        {/* Context tools bar - rendered outside the input box border */}
        {showHeader && !isInputBoxCollapsed && (
          <ContextBar
            activeFile={activeFile}
            selectedLines={selectedLines}
            percentage={usagePercentage}
            usedTokens={usageUsedTokens}
            maxTokens={usageMaxTokens}
            showUsage={showUsage}
            contextDualViewEnabled={contextDualViewEnabled}
            dualContextUsage={dualContextUsage}
            onRequestContextCompaction={onRequestContextCompaction}
            codexAutoCompactionEnabled={codexAutoCompactionEnabled}
            codexAutoCompactionThresholdPercent={codexAutoCompactionThresholdPercent}
            onCodexAutoCompactionSettingsChange={onCodexAutoCompactionSettingsChange}
            isLoading={isLoading}
            onClearFile={onClearContext}
            onAddAttachment={handleAddAttachment}
            selectedAgent={selectedAgent}
            selectedContextChips={selectedContextChips}
            onRemoveContextChip={onRemoveContextChip}
            onClearAgent={() => onAgentSelect?.(null)}
            currentProvider={currentProvider}
            hasMessages={hasMessages}
            onRewind={onRewind}
            showRewindEntry={showRewindEntry}
            statusPanelExpanded={statusPanelExpanded}
            showStatusPanelToggle={showStatusPanelToggle}
            onToggleStatusPanel={onToggleStatusPanel}
            completionEmailSelected={completionEmailSelected}
            completionEmailDisabled={completionEmailDisabled}
            onToggleCompletionEmail={onToggleCompletionEmail}
          />
        )}
      </div>
    );
  }
));

// Display name for React DevTools
ChatInputBox.displayName = 'ChatInputBox';

export default ChatInputBox;
