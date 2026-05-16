import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  ComposerSendShortcut,
  ComposerEditorSettings,
  ConversationItem,
  CustomCommandOption,
  CustomPromptOption,
  DictationTranscript,
  EngineType,
  MessageSendOptions,
  OpenCodeAgentOption,
  QueuedMessage,
  RateLimitSnapshot,
  RequestUserInputRequest,
  RuntimeLifecycleState,
  ThreadTokenUsage,
  TurnPlan,
} from "../../../types";
import type {
  ReviewPromptState,
  ReviewPromptStep,
} from "../../threads/hooks/useReviewPrompt";
import type { EngineDisplayInfo } from "../../engine/hooks/useEngineController";
import { computeDictationInsertion } from "../../../utils/dictation";
import { useComposerAutocompleteState } from "../hooks/useComposerAutocompleteState";
import { usePromptHistory } from "../hooks/usePromptHistory";
import { useInlineHistoryCompletion } from "../hooks/useInlineHistoryCompletion";
import { recordHistory as recordInputHistory } from "../hooks/useInputHistoryStore";
import { ChatInputBoxAdapter } from "./ChatInputBox/ChatInputBoxAdapter";
import type { ChatInputBoxHandle } from "./ChatInputBox/ChatInputBoxAdapter";
import {
  accessModeToPermissionMode,
  permissionModeToAccessMode,
} from "./ChatInputBox/types";
import {
  ClaudeRewindConfirmDialog,
  type ClaudeRewindPreviewState,
} from "./ClaudeRewindConfirmDialog";
import { ReviewInlinePrompt } from "./ReviewInlinePrompt";
import type {
  ClaudeContextUsageViewModel,
  CodexCompactionSource,
  ContextSelectionChip,
  PermissionMode,
  SelectedAgent as ChatInputSelectedAgent,
} from "./ChatInputBox/types";
import { useStatusPanelData } from "../../status-panel/hooks/useStatusPanelData";
import {
  assembleSinglePrompt,
  shouldAssemblePrompt,
} from "../utils/promptAssembler";
import { buildComposerSendReadiness } from "../utils/composerSendReadiness";
import type {
  CodeAnnotationDraftInput,
  CodeAnnotationSelection,
} from "../../code-annotations/types";
import {
  appendCodeAnnotationsToPrompt,
  buildCodeAnnotationDedupeKey,
  formatCodeAnnotationLineRange,
} from "../../code-annotations/utils/codeAnnotations";
import {
  buildLatestRewindPreview,
  extractInlineFileReferenceTokens,
  normalizeInlineFileReferenceTokens,
  normalizeRewindExportPath,
  replaceVisibleFileReferenceLabels,
  resolvePreferredStatus,
  resolveRewindSupportedEngineFromThreadId,
  toRewindPathDedupeKey,
  type InlineFileReferenceSelection,
  type RewindFileChangeStatus,
} from "../utils/composerFileReferences";
import {
  resolveManualMemoryChipDetail,
  resolveManualMemoryChipTitle,
  resolveNoteCardChipDetail,
  resolveNoteCardChipTitle,
} from "../utils/contextSelectionChips";
import {
  extractInlineSelections,
  mergeUniqueNames,
} from "../utils/inlineSelections";
import { useStreamActivityPhase } from "../../threads/hooks/useStreamActivityPhase";
import {
  exportRewindFiles,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { getManualMemoryInjectionMode } from "../../project-memory/utils/manualInjectionMode";
import type { RewindMode } from "../../threads/utils/rewindMode";
import {
  buildRetainedContextChipKeys,
  filterRetainedChipNames,
  filterRetainedEntries,
} from "../../context-ledger/utils/contextLedgerGovernance";
import { useContextLedgerGovernance } from "../hooks/useContextLedgerGovernance";
import { ContextLedgerPanel } from "../../context-ledger/components/ContextLedgerPanel";
import {
  buildContextLedgerProjection,
  resolveDualContextUsageModel,
} from "../../context-ledger/utils/contextLedgerProjection";
import type {
  ContextLedgerSourceNavigationTarget,
  ContextLedgerProjection,
} from "../../context-ledger/types";

type RewindExecutionOptions = {
  mode?: RewindMode;
};

function keepArrayWhenEmpty<T>(current: T[]): T[] {
  return current.length === 0 ? current : [];
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(value, 0)
    : null;
}

function finitePositive(value: number | null | undefined): number | null {
  const normalizedValue = finiteNonNegative(value);
  return normalizedValue !== null && normalizedValue > 0 ? normalizedValue : null;
}

function resolveClaudeWindowUsedTokens(contextUsage: ThreadTokenUsage): number | null {
  const explicitContextUsedTokens = finiteNonNegative(contextUsage.contextUsedTokens);
  if (explicitContextUsedTokens !== null) {
    return explicitContextUsedTokens;
  }
  const inputTokens = finiteNonNegative(contextUsage.last.inputTokens) ?? 0;
  const cachedInputTokens = finiteNonNegative(contextUsage.last.cachedInputTokens) ?? 0;
  const hasWindowSnapshot = inputTokens > 0 || cachedInputTokens > 0;
  return hasWindowSnapshot ? inputTokens + cachedInputTokens : null;
}

type ComposerProps = {
  kanbanContextMode?: "new" | "inherit";
  onKanbanContextModeChange?: (mode: "new" | "inherit") => void;
  items?: ConversationItem[];
  onSend: (
    text: string,
    images: string[],
    options?: MessageSendOptions,
  ) => void | Promise<void>;
  onQueue: (
    text: string,
    images: string[],
    options?: MessageSendOptions,
  ) => void | Promise<void>;
  onRequestContextCompaction?: () => Promise<void> | void;
  onStop: () => void;
  canStop: boolean;
  disabled?: boolean;
  isProcessing: boolean;
  steerEnabled: boolean;
  collaborationModes: { id: string; label: string }[];
  collaborationModesEnabled: boolean;
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  isSharedSession?: boolean;
  // Engine props
  engines?: EngineDisplayInfo[];
  selectedEngine?: EngineType;
  onSelectEngine?: (engine: EngineType) => void;
  // Model props
  models: { id: string; displayName: string; model: string }[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string | null) => void;
  reasoningSupported: boolean;
  onResolvedAlwaysThinkingChange?: (enabled: boolean) => void;
  opencodeAgents?: OpenCodeAgentOption[];
  selectedOpenCodeAgent?: string | null;
  onSelectOpenCodeAgent?: (agentId: string | null) => void;
  selectedAgent?: ChatInputSelectedAgent | null;
  onAgentSelect?: (agent: ChatInputSelectedAgent | null) => void;
  onOpenAgentSettings?: () => void;
  onOpenPromptSettings?: () => void;
  onOpenModelSettings?: (providerId?: string) => void;
  onRefreshModelConfig?: (providerId?: string) => Promise<void> | void;
  isModelConfigRefreshing?: boolean;
  onForkQuickStart?: () => void;
  opencodeVariantOptions?: string[];
  selectedOpenCodeVariant?: string | null;
  onSelectOpenCodeVariant?: (variant: string | null) => void;
  accessMode: "default" | "read-only" | "current" | "full-access";
  onSelectAccessMode: (
    mode: "default" | "read-only" | "current" | "full-access",
  ) => void;
  skills: { name: string; path: string; description?: string; source?: string }[];
  customSkillDirectories?: string[];
  prompts: CustomPromptOption[];
  commands?: CustomCommandOption[];
  files: string[];
  directories?: string[];
  gitignoredFiles?: Set<string>;
  gitignoredDirectories?: Set<string>;
  contextUsage?: ThreadTokenUsage | null;
  contextDualViewEnabled?: boolean;
  isContextCompacting?: boolean;
  codexCompactionLifecycleState?: "idle" | "compacting" | "completed";
  codexCompactionSource?: CodexCompactionSource | null;
  codexCompactionCompletedAt?: number | null;
  lastTokenUsageUpdatedAt?: number | null;
  codexAutoCompactionEnabled?: boolean;
  codexAutoCompactionThresholdPercent?: number;
  onCodexAutoCompactionSettingsChange?: (patch: {
    enabled?: boolean;
    thresholdPercent?: number;
  }) => Promise<void> | void;
  accountRateLimits?: RateLimitSnapshot | null;
  usageShowRemaining?: boolean;
  onRefreshAccountRateLimits?: () => Promise<void> | void;
  queuedMessages?: QueuedMessage[];
  onEditQueued?: (item: QueuedMessage) => void;
  onDeleteQueued?: (id: string) => void;
  onFuseQueued?: (id: string) => void | Promise<void>;
  canFuseQueuedMessages?: boolean;
  fusingQueuedMessageId?: string | null;
  userInputRequests?: RequestUserInputRequest[];
  onJumpToUserInputRequest?: (request: RequestUserInputRequest) => void;
  runtimeLifecycleState?: RuntimeLifecycleState | null;
  sendLabel?: string;
  draftText?: string;
  onDraftChange?: (text: string) => void;
  historyKey?: string | null;
  attachedImages?: string[];
  onPickImages?: () => void;
  onAttachImages?: (paths: string[]) => void;
  onRemoveImage?: (path: string) => void;
  prefillDraft?: QueuedMessage | null;
  onPrefillHandled?: (id: string) => void;
  insertText?: QueuedMessage | null;
  onInsertHandled?: (id: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  editorSettings?: ComposerEditorSettings;
  sendShortcut?: ComposerSendShortcut;
  textareaHeight?: number;
  onTextareaHeightChange?: (height: number) => void;
  dictationEnabled?: boolean;
  dictationState?: "idle" | "listening" | "processing";
  dictationLevel?: number;
  onToggleDictation?: () => void;
  onOpenDictationSettings?: () => void;
  onOpenExperimentalSettings?: () => void;
  dictationTranscript?: DictationTranscript | null;
  onDictationTranscriptHandled?: (id: string) => void;
  dictationError?: string | null;
  onDismissDictationError?: () => void;
  dictationHint?: string | null;
  onDismissDictationHint?: () => void;
  reviewPrompt?: ReviewPromptState;
  onReviewPromptClose?: () => void;
  onReviewPromptShowPreset?: () => void;
  onReviewPromptChoosePreset?: (
    preset: Exclude<ReviewPromptStep, "preset"> | "uncommitted",
  ) => void;
  highlightedPresetIndex?: number;
  onReviewPromptHighlightPreset?: (index: number) => void;
  highlightedBranchIndex?: number;
  onReviewPromptHighlightBranch?: (index: number) => void;
  highlightedCommitIndex?: number;
  onReviewPromptHighlightCommit?: (index: number) => void;
  onReviewPromptKeyDown?: (event: {
    key: string;
    shiftKey?: boolean;
    preventDefault: () => void;
  }) => boolean;
  onReviewPromptSelectBranch?: (value: string) => void;
  onReviewPromptSelectBranchAtIndex?: (index: number) => void;
  onReviewPromptConfirmBranch?: () => Promise<void>;
  onReviewPromptSelectCommit?: (sha: string, title: string) => void;
  onReviewPromptSelectCommitAtIndex?: (index: number) => void;
  onReviewPromptConfirmCommit?: () => Promise<void>;
  onReviewPromptUpdateCustomInstructions?: (value: string) => void;
  onReviewPromptConfirmCustom?: () => Promise<void>;
  linkedKanbanPanels?: {
    id: string;
    name: string;
    workspaceId: string;
    createdAt?: number;
  }[];
  selectedLinkedKanbanPanelId?: string | null;
  onSelectLinkedKanbanPanel?: (panelId: string | null) => void;
  onOpenLinkedKanbanPanel?: (panelId: string) => void;
  onOpenContextLedgerMemory?: (memoryId: string) => void;
  onOpenContextLedgerNote?: (noteId: string) => void;
  activeFilePath?: string | null;
  activeFileLineRange?: { startLine: number; endLine: number } | null;
  fileReferenceMode?: "path" | "none";
  activeWorkspaceId?: string | null;
  activeWorkspaceName?: string | null;
  activeWorkspacePath?: string | null;
  rewindWorkspaceGitState?: {
    isGitRepository: boolean;
    hasDetectedChanges: boolean;
  } | null;
  activeThreadId?: string | null;
  threadItemsByThread?: Record<string, ConversationItem[]>;
  threadParentById?: Record<string, string>;
  threadStatusById?: Record<string, { isProcessing?: boolean } | undefined>;
  plan?: TurnPlan | null;
  isPlanMode?: boolean;
  onOpenDiffPath?: (path: string) => void;
  onRewind?: (
    userMessageId: string,
    options?: RewindExecutionOptions,
  ) => void | Promise<void>;
  showStatusPanelToggleOverride?: boolean;
  statusPanelExpandedOverride?: boolean;
  onToggleStatusPanelOverride?: () => void;
  completionEmailSelected?: boolean;
  completionEmailDisabled?: boolean;
  onToggleCompletionEmail?: () => void;
  pendingCodeAnnotation?: CodeAnnotationDraftInput | null;
  onCodeAnnotationConsumed?: (dedupeKey: string) => void;
  selectedCodeAnnotations?: CodeAnnotationSelection[];
  onRemoveCodeAnnotation?: (annotationId: string) => void;
  onClearCodeAnnotations?: () => void;
};

type ManualMemorySelection = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  kind: string;
  importance: string;
  updatedAt: number;
  tags: string[];
};

type NoteCardSelection = {
  id: string;
  title: string;
  plainTextExcerpt: string;
  bodyMarkdown: string;
  updatedAt: number;
  archived: boolean;
  imageCount: number;
  previewAttachments: Array<{
    id: string;
    fileName: string;
    contentType: string;
    absolutePath: string;
  }>;
};

const EMPTY_ITEMS: ConversationItem[] = [];
const COMPOSER_MIN_HEIGHT = 20;
const COMPOSER_EXPAND_HEIGHT = 80;
const COMPOSER_INPUT_INTERACTION_IDLE_MS = 320;

function resolveSelectedNamedItems<T extends { name: string }>(
  selectedNames: string[],
  items: T[],
): T[] {
  if (selectedNames.length === 0 || items.length === 0) {
    return [];
  }
  const firstByName = new Map<string, T>();
  for (const item of items) {
    const normalizedName = item.name.trim();
    if (!normalizedName || firstByName.has(normalizedName)) {
      continue;
    }
    firstByName.set(normalizedName, item);
  }
  const resolved: T[] = [];
  const seen = new Set<string>();
  for (const selectedName of selectedNames) {
    const normalizedName = selectedName.trim();
    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }
    const resolvedItem = firstByName.get(normalizedName);
    if (!resolvedItem) {
      continue;
    }
    seen.add(normalizedName);
    resolved.push(resolvedItem);
  }
  return resolved;
}

function toContextChipCarryOverKey(chip: ContextSelectionChip) {
  return `${chip.type}:${chip.name}`;
}

const OPENCODE_DIRECT_COMMANDS = new Set(["status", "mcp", "export", "share"]);

function normalizeCommandChipName(name: string) {
  const token = name.trim().replace(/^\/+/, "").split(/\s+/)[0];
  return token ? token.toLowerCase() : "";
}

export const Composer = memo(function Composer({
  kanbanContextMode: _kanbanContextMode = "new",
  onKanbanContextModeChange: _onKanbanContextModeChange,
  items = EMPTY_ITEMS,
  onSend,
  onQueue,
  onRequestContextCompaction,
  onStop,
  canStop,
  disabled = false,
  isProcessing,
  steerEnabled: _steerEnabled,
  collaborationModes: _collaborationModes,
  collaborationModesEnabled: _collaborationModesEnabled,
  selectedCollaborationModeId: _selectedCollaborationModeId,
  onSelectCollaborationMode: _onSelectCollaborationMode,
  isSharedSession = false,
  engines,
  selectedEngine,
  onSelectEngine,
  models,
  selectedModelId,
  onSelectModel,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  reasoningSupported,
  onResolvedAlwaysThinkingChange,
  opencodeAgents = [],
  selectedOpenCodeAgent = null,
  onSelectOpenCodeAgent,
  selectedAgent = null,
  onAgentSelect,
  onOpenAgentSettings,
  onOpenPromptSettings,
  onOpenModelSettings,
  onRefreshModelConfig,
  isModelConfigRefreshing,
  onForkQuickStart,
  opencodeVariantOptions: _opencodeVariantOptions = [],
  selectedOpenCodeVariant: _selectedOpenCodeVariant = null,
  onSelectOpenCodeVariant: _onSelectOpenCodeVariant,
  accessMode,
  onSelectAccessMode,
  skills,
  customSkillDirectories,
  prompts,
  commands = [],
  files,
  directories = [],
  gitignoredFiles,
  gitignoredDirectories,
  contextUsage = null,
  contextDualViewEnabled = false,
  isContextCompacting = false,
  codexCompactionLifecycleState = "idle",
  codexCompactionSource = null,
  codexCompactionCompletedAt = null,
  lastTokenUsageUpdatedAt = null,
  codexAutoCompactionEnabled = true,
  codexAutoCompactionThresholdPercent = 92,
  onCodexAutoCompactionSettingsChange,
  accountRateLimits = null,
  usageShowRemaining = false,
  onRefreshAccountRateLimits,
  queuedMessages = [],
  onDeleteQueued,
  onFuseQueued,
  canFuseQueuedMessages = false,
  fusingQueuedMessageId = null,
  userInputRequests = [],
  onJumpToUserInputRequest,
  runtimeLifecycleState = null,
  sendLabel: _sendLabel = "Send",
  draftText = "",
  onDraftChange,
  historyKey = null,
  attachedImages = [],
  onPickImages,
  onAttachImages,
  onRemoveImage,
  prefillDraft = null,
  onPrefillHandled,
  insertText = null,
  onInsertHandled,
  textareaRef: externalTextareaRef,
  editorSettings: _editorSettingsProp,
  sendShortcut = "enter",
  textareaHeight = 80,
  onTextareaHeightChange,
  dictationEnabled: _dictationEnabled = false,
  dictationState: _dictationState = "idle",
  dictationLevel: _dictationLevel = 0,
  onToggleDictation: _onToggleDictation,
  onOpenDictationSettings: _onOpenDictationSettings,
  onOpenExperimentalSettings: _onOpenExperimentalSettings,
  dictationTranscript = null,
  onDictationTranscriptHandled,
  dictationError: _dictationError = null,
  onDismissDictationError: _onDismissDictationError,
  dictationHint: _dictationHint = null,
  onDismissDictationHint: _onDismissDictationHint,
  reviewPrompt,
  onReviewPromptClose: _onReviewPromptClose,
  onReviewPromptShowPreset: _onReviewPromptShowPreset,
  onReviewPromptChoosePreset: _onReviewPromptChoosePreset,
  highlightedPresetIndex: _highlightedPresetIndex,
  onReviewPromptHighlightPreset: _onReviewPromptHighlightPreset,
  highlightedBranchIndex: _highlightedBranchIndex,
  onReviewPromptHighlightBranch: _onReviewPromptHighlightBranch,
  highlightedCommitIndex: _highlightedCommitIndex,
  onReviewPromptHighlightCommit: _onReviewPromptHighlightCommit,
  onReviewPromptKeyDown: _onReviewPromptKeyDown,
  onReviewPromptSelectBranch: _onReviewPromptSelectBranch,
  onReviewPromptSelectBranchAtIndex: _onReviewPromptSelectBranchAtIndex,
  onReviewPromptConfirmBranch: _onReviewPromptConfirmBranch,
  onReviewPromptSelectCommit: _onReviewPromptSelectCommit,
  onReviewPromptSelectCommitAtIndex: _onReviewPromptSelectCommitAtIndex,
  onReviewPromptConfirmCommit: _onReviewPromptConfirmCommit,
  onReviewPromptUpdateCustomInstructions:
    _onReviewPromptUpdateCustomInstructions,
  onReviewPromptConfirmCustom: _onReviewPromptConfirmCustom,
  linkedKanbanPanels: _linkedKanbanPanels = [],
  selectedLinkedKanbanPanelId: _selectedLinkedKanbanPanelId = null,
  onSelectLinkedKanbanPanel: _onSelectLinkedKanbanPanel,
  onOpenLinkedKanbanPanel: _onOpenLinkedKanbanPanel,
  onOpenContextLedgerMemory: _onOpenContextLedgerMemory,
  onOpenContextLedgerNote: _onOpenContextLedgerNote,
  activeFilePath = null,
  activeFileLineRange = null,
  fileReferenceMode = "path",
  activeWorkspaceId = null,
  activeWorkspaceName = null,
  activeWorkspacePath = null,
  rewindWorkspaceGitState = null,
  activeThreadId = null,
  threadItemsByThread,
  threadParentById,
  threadStatusById,
  plan = null,
  isPlanMode = false,
  onOpenDiffPath,
  onRewind,
  showStatusPanelToggleOverride,
  statusPanelExpandedOverride,
  onToggleStatusPanelOverride,
  completionEmailSelected,
  completionEmailDisabled,
  onToggleCompletionEmail,
  pendingCodeAnnotation = null,
  onCodeAnnotationConsumed,
  selectedCodeAnnotations = [],
  onRemoveCodeAnnotation,
  onClearCodeAnnotations,
}: ComposerProps) {
  const { t } = useTranslation();
  const isCodexEngine = selectedEngine === "codex";
  const deferredItems = useDeferredValue(items);
  const performanceScopedItems = isProcessing ? deferredItems : items;
  const supportsStreamActivityPhaseFx =
    selectedEngine === "codex" ||
    selectedEngine === "claude" ||
    selectedEngine === "gemini";
  const streamActivityPhase = useStreamActivityPhase({
    isProcessing: Boolean(isProcessing && supportsStreamActivityPhaseFx),
    items: performanceScopedItems,
  });
  const isReviewQuickActionEngine =
    selectedEngine === "codex" || selectedEngine === "claude";
  const showStatusPanel =
    selectedEngine === "claude" ||
    selectedEngine === "codex" ||
    selectedEngine === "gemini";
  const { todoTotal, subagentTotal, fileChanges, commandTotal } =
    useStatusPanelData(performanceScopedItems, {
      isCodexEngine,
      activeThreadId,
      itemsByThread: threadItemsByThread,
      threadParentById,
      threadStatusById,
    });
  const hasStatusPanelActivity = useMemo(() => {
    const hasLegacyActivity =
      todoTotal > 0 ||
      subagentTotal > 0 ||
      fileChanges.length > 0 ||
      isPlanMode ||
      Boolean(plan);
    if (isCodexEngine) {
      return hasLegacyActivity || commandTotal > 0;
    }
    return hasLegacyActivity;
  }, [
    commandTotal,
    fileChanges.length,
    isCodexEngine,
    isPlanMode,
    plan,
    subagentTotal,
    todoTotal,
  ]);
  const [text, setText] = useState(draftText);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectedSkillNames, setSelectedSkillNames] = useState<string[]>([]);
  const [selectedCommonsNames, setSelectedCommonsNames] = useState<string[]>([]);
  const [selectedManualMemories, setSelectedManualMemories] = useState<ManualMemorySelection[]>([]);
  const [selectedNoteCards, setSelectedNoteCards] = useState<NoteCardSelection[]>([]);
  const [memoryReferenceArmed, setMemoryReferenceArmed] = useState(false);
  const [carryOverManualMemoryIds, setCarryOverManualMemoryIds] = useState<string[]>([]);
  const [retainedManualMemoryIds, setRetainedManualMemoryIds] = useState<string[]>([]);
  const [carryOverNoteCardIds, setCarryOverNoteCardIds] = useState<string[]>([]);
  const [retainedNoteCardIds, setRetainedNoteCardIds] = useState<string[]>([]);
  const [carryOverContextChipKeys, setCarryOverContextChipKeys] = useState<string[]>([]);
  const [retainedContextChipKeys, setRetainedContextChipKeys] = useState<string[]>([]);
  const [selectedInlineFileReferences, setSelectedInlineFileReferences] = useState<InlineFileReferenceSelection[]>([]);
  const [contextLedgerExpanded, setContextLedgerExpanded] = useState(false);
  const currentContextLedgerProjectionRef = useRef<ContextLedgerProjection | null>(null);
  const previousContextLedgerSessionKeyRef = useRef("");
  const contextLedgerSessionKey = `${activeWorkspaceId ?? "__no_workspace__"}::${activeThreadId ?? "__no_thread__"}`;
  const onClearCodeAnnotationsRef = useRef(onClearCodeAnnotations);
  const [isComposerCollapsed, setIsComposerCollapsed] = useState(false);
  const [statusPanelExpanded, setStatusPanelExpanded] = useState(hasStatusPanelActivity);
  const previousStatusPanelActivityRef = useRef(hasStatusPanelActivity);
  const [dismissedActiveFileReference, setDismissedActiveFileReference] =
    useState<string | null>(null);
  const [openCodeProviderTone, _setOpenCodeProviderTone] = useState<"is-ok" | "is-runtime" | "is-fail">("is-fail");
  const [openCodeProviderToneReady, _setOpenCodeProviderToneReady] = useState(false);
  const [rewindInFlight, setRewindInFlight] = useState(false);
  const [rewindPreviewState, setRewindPreviewState] = useState<ClaudeRewindPreviewState | null>(null);
  const [rewindMode, setRewindMode] = useState<RewindMode>("messages-and-files");
  const rewindInFlightRef = useRef(false);
  const lastExpandedHeightRef = useRef(Math.max(textareaHeight, COMPOSER_EXPAND_HEIGHT));
  const composerInputInteractionTimerRef = useRef<number | null>(null);
  const [isComposerInputInteractionActive, setIsComposerInputInteractionActive] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = externalTextareaRef ?? internalRef;
  const chatInputRef = useRef<ChatInputBoxHandle>(null);
  const activeFileReferenceSignature = activeFilePath
    ? (activeFileLineRange
      ? `${activeFilePath}:${activeFileLineRange.startLine}-${activeFileLineRange.endLine}`
      : `${activeFilePath}:all`)
    : null;
  const rewindSupportedEngine = resolveRewindSupportedEngineFromThreadId(activeThreadId);
  const hasActiveFileReference = Boolean(
    activeFileReferenceSignature &&
    fileReferenceMode === "path" &&
    dismissedActiveFileReference !== activeFileReferenceSignature,
  );

  const selectedSkills = useMemo(
    () => resolveSelectedNamedItems(selectedSkillNames, skills),
    [selectedSkillNames, skills],
  );
  const selectedCommons = useMemo(
    () => resolveSelectedNamedItems(selectedCommonsNames, commands),
    [commands, selectedCommonsNames],
  );
  const selectedOpenCodeDirectCommand = useMemo(() => {
    if (selectedEngine !== "opencode") {
      return null;
    }
    for (const name of selectedCommonsNames) {
      const normalized = normalizeCommandChipName(name);
      if (OPENCODE_DIRECT_COMMANDS.has(normalized)) {
        return normalized;
      }
    }
    return null;
  }, [selectedCommonsNames, selectedEngine]);

  useEffect(() => {
    if (!dismissedActiveFileReference) {
      return;
    }
    if (
      !activeFileReferenceSignature ||
      activeFileReferenceSignature !== dismissedActiveFileReference
    ) {
      setDismissedActiveFileReference(null);
    }
  }, [activeFileReferenceSignature, dismissedActiveFileReference]);

  useEffect(
    () => () => {
      if (composerInputInteractionTimerRef.current !== null) {
        window.clearTimeout(composerInputInteractionTimerRef.current);
      }
    },
    [],
  );

  const markComposerInputInteraction = useCallback(() => {
    setIsComposerInputInteractionActive(true);
    if (composerInputInteractionTimerRef.current !== null) {
      window.clearTimeout(composerInputInteractionTimerRef.current);
    }
    composerInputInteractionTimerRef.current = window.setTimeout(() => {
      setIsComposerInputInteractionActive(false);
      composerInputInteractionTimerRef.current = null;
    }, COMPOSER_INPUT_INTERACTION_IDLE_MS);
  }, []);

  const activeFileLinesLabel = useMemo(() => {
    if (!activeFileLineRange) {
      return undefined;
    }
    if (activeFileLineRange.startLine === activeFileLineRange.endLine) {
      return `L${activeFileLineRange.startLine}`;
    }
    return `L${activeFileLineRange.startLine}-${activeFileLineRange.endLine}`;
  }, [activeFileLineRange]);

  const selectedChatInputAgent = useMemo<ChatInputSelectedAgent | null>(() => {
    if (selectedEngine === "opencode") {
      if (!selectedOpenCodeAgent) {
        return null;
      }
      const matchedAgent = opencodeAgents.find(
        (agent) => agent.id === selectedOpenCodeAgent,
      );
      return {
        id: selectedOpenCodeAgent,
        name: selectedOpenCodeAgent,
        prompt: matchedAgent?.description,
      };
    }
    return selectedAgent;
  }, [opencodeAgents, selectedAgent, selectedEngine, selectedOpenCodeAgent]);
  const opencodeDisconnected =
    selectedEngine === "opencode" &&
    openCodeProviderToneReady &&
    openCodeProviderTone === "is-fail";

  const contextSelectionChips = useMemo<ContextSelectionChip[]>(
    () => [
      ...selectedSkills.map((skill) => ({
        type: "skill" as const,
        name: skill.name,
        description: skill.description,
        path: skill.path,
        source: skill.source,
      })),
      ...selectedCommons.map((item) => ({
        type: "commons" as const,
        name: item.name,
        description: item.description,
        path: item.path,
        source: item.source,
      })),
    ],
    [selectedCommons, selectedSkills],
  );

  useEffect(() => {
    onClearCodeAnnotationsRef.current = onClearCodeAnnotations;
  }, [onClearCodeAnnotations]);

  const clearComposerContextSelections = useCallback(() => {
    setSelectedSkillNames(keepArrayWhenEmpty);
    setSelectedCommonsNames(keepArrayWhenEmpty);
    setSelectedManualMemories(keepArrayWhenEmpty);
    setSelectedNoteCards(keepArrayWhenEmpty);
    setSelectedInlineFileReferences(keepArrayWhenEmpty);
    onClearCodeAnnotationsRef.current?.();
    setCarryOverManualMemoryIds(keepArrayWhenEmpty);
    setRetainedManualMemoryIds(keepArrayWhenEmpty);
    setCarryOverNoteCardIds(keepArrayWhenEmpty);
    setRetainedNoteCardIds(keepArrayWhenEmpty);
    setCarryOverContextChipKeys(keepArrayWhenEmpty);
    setRetainedContextChipKeys(keepArrayWhenEmpty);
    setMemoryReferenceArmed(false);
  }, []);
  const resetContextLedgerSessionState = useCallback(() => {
    clearComposerContextSelections();
    setContextLedgerExpanded((current) => (current ? false : current));
    currentContextLedgerProjectionRef.current = null; previousContextLedgerSessionKeyRef.current = contextLedgerSessionKey;
  }, [clearComposerContextSelections, contextLedgerSessionKey]);

  useEffect(() => {
    if (textareaHeight > COMPOSER_MIN_HEIGHT) {
      lastExpandedHeightRef.current = textareaHeight;
    }
  }, [textareaHeight]);

  useEffect(() => {
    if (statusPanelExpandedOverride !== undefined) {
      return;
    }
    const hadActivity = previousStatusPanelActivityRef.current;
    if (!hasStatusPanelActivity) {
      setStatusPanelExpanded(false);
    } else if (!hadActivity) {
      setStatusPanelExpanded(true);
    }
    previousStatusPanelActivityRef.current = hasStatusPanelActivity;
  }, [hasStatusPanelActivity, statusPanelExpandedOverride]);

  useEffect(() => {
    resetContextLedgerSessionState();
  }, [activeThreadId, activeWorkspaceId, resetContextLedgerSessionState]);

  useEffect(() => {
    if (!pendingCodeAnnotation) {
      return;
    }
    const dedupeKey = buildCodeAnnotationDedupeKey(pendingCodeAnnotation);
    if (!dedupeKey) {
      onCodeAnnotationConsumed?.(dedupeKey);
      return;
    }
    onCodeAnnotationConsumed?.(dedupeKey);
  }, [onCodeAnnotationConsumed, pendingCodeAnnotation]);

  useEffect(() => {
    setRewindPreviewState(null);
    setRewindMode("messages-and-files");
  }, [activeThreadId]);

  useEffect(() => {
    if (rewindSupportedEngine && onRewind) {
      return;
    }
    setRewindPreviewState(null);
    setRewindMode("messages-and-files");
  }, [onRewind, rewindSupportedEngine]);

  const handleExpandComposer = useCallback(() => {
    setIsComposerCollapsed(false);
    onTextareaHeightChange?.(
      Math.max(lastExpandedHeightRef.current, COMPOSER_EXPAND_HEIGHT),
    );
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [onTextareaHeightChange, textareaRef]);

  useEffect(() => {
    setText((prev) => (prev === draftText ? prev : draftText));
  }, [draftText]);

  const setComposerText = useCallback(
    (next: string) => {
      setText(next);
      onDraftChange?.(next);
    },
    [onDraftChange],
  );

  useEffect(() => {
    const existingReferenceIds = new Set(
      selectedInlineFileReferences
        .filter((entry) => text.includes(entry.label))
        .map((entry) => entry.id),
    );
    const { cleanedText, extracted } = extractInlineFileReferenceTokens(
      text,
      existingReferenceIds,
    );
    if (extracted.length > 0) {
      setSelectedInlineFileReferences((prev) => {
        const next = [...prev];
        for (const ref of extracted) {
          if (next.some((entry) => entry.id === ref.id)) {
            continue;
          }
          next.push(ref);
        }
        return next;
      });
    }
    if (cleanedText !== text) {
      setComposerText(cleanedText);
      return;
    }
    const {
      cleanedText: cleanedSelectionText,
      matchedSkillNames,
      matchedCommonsNames,
    } = extractInlineSelections(text, skills, commands);
    if (matchedSkillNames.length > 0) {
      setSelectedSkillNames((prev) =>
        mergeUniqueNames(prev, matchedSkillNames),
      );
    }
    if (matchedCommonsNames.length > 0) {
      setSelectedCommonsNames((prev) =>
        mergeUniqueNames(prev, matchedCommonsNames),
      );
    }
    if (cleanedSelectionText !== text) {
      setComposerText(cleanedSelectionText);
    }
  }, [commands, selectedInlineFileReferences, setComposerText, skills, text]);

  const handleSelectManualMemory = useCallback(
    (memory: ManualMemorySelection) => {
      setSelectedManualMemories((prev) => {
        if (prev.some((entry) => entry.id === memory.id)) {
          setCarryOverManualMemoryIds((ids) =>
            ids.filter((entryId) => entryId !== memory.id),
          );
          return prev.filter((entry) => entry.id !== memory.id);
        }
        return [...prev, memory];
      });
    },
    [],
  );

  const handleSelectNoteCard = useCallback((noteCard: NoteCardSelection) => {
    setSelectedNoteCards((prev) => {
      if (prev.some((entry) => entry.id === noteCard.id)) {
        setCarryOverNoteCardIds((ids) =>
          ids.filter((entryId) => entryId !== noteCard.id),
        );
        return prev.filter((entry) => entry.id !== noteCard.id);
      }
      return [...prev, noteCard];
    });
  }, []);

  const handleSelectSkill = useCallback((skillName: string) => {
    const normalized = skillName.trim();
    if (!normalized) {
      return;
    }
    setSelectedSkillNames((prev) => {
      if (prev.includes(normalized)) {
        setCarryOverContextChipKeys((keys) =>
          keys.filter((entry) => entry !== `skill:${normalized}`),
        );
        return prev.filter((entry) => entry !== normalized);
      }
      return mergeUniqueNames(prev, [normalized]);
    });
  }, []);

  const {
    isAutocompleteOpen,
    activeAutocompleteTrigger: _activeAutocompleteTrigger,
    autocompleteMatches: _autocompleteMatches,
    highlightIndex: _highlightIndex,
    setHighlightIndex: _setHighlightIndex,
    applyAutocomplete: _applyAutocomplete,
    handleInputKeyDown: _handleInputKeyDown,
    handleTextChange,
    handleSelectionChange,
  } = useComposerAutocompleteState({
    text,
    selectionStart,
    disabled,
    skills,
    prompts,
    commands,
    files,
    directories,
    gitignoredFiles,
    gitignoredDirectories,
    workspaceId: activeWorkspaceId,
    workspaceName: activeWorkspaceName,
    workspacePath: activeWorkspacePath,
    onManualMemorySelect: handleSelectManualMemory,
    onNoteCardSelect: handleSelectNoteCard,
    textareaRef,
    setText: setComposerText,
    setSelectionStart,
  });
  const reviewPromptOpen = Boolean(reviewPrompt);
  const suggestionsOpen = reviewPromptOpen || isAutocompleteOpen;

  const {
    handleHistoryKeyDown: _handleHistoryKeyDown,
    handleHistoryTextChange,
    recordHistory,
    resetHistoryNavigation,
  } = usePromptHistory({
    historyKey,
    text,
    hasAttachments: attachedImages.length > 0,
    disabled,
    isAutocompleteOpen: suggestionsOpen,
    textareaRef,
    setText: setComposerText,
    setSelectionStart,
  });

  const inlineCompletion = useInlineHistoryCompletion();

  const handleTextChangeWithHistory = useCallback(
    (next: string, cursor: number | null) => {
      markComposerInputInteraction();
      handleHistoryTextChange(next);
      handleTextChange(next, cursor);
      // Update inline history completion
      if (!suggestionsOpen) {
        inlineCompletion.updateQuery(next);
      } else {
        inlineCompletion.clear();
      }
    },
    [
      handleHistoryTextChange,
      handleTextChange,
      markComposerInputInteraction,
      suggestionsOpen,
      inlineCompletion,
    ],
  );

  const applyActiveFileReference = useCallback(
    (message: string) => {
      if (
        !(
          hasActiveFileReference &&
          fileReferenceMode === "path" &&
          activeFilePath
        )
      ) {
        return message;
      }
      const referenceTarget = activeFileLineRange
        ? `${activeFilePath}#L${activeFileLineRange.startLine}-L${activeFileLineRange.endLine}`
        : activeFilePath;
      if (
        message.includes(referenceTarget) ||
        message.includes(activeFilePath)
      ) {
        return message;
      }
      return `@file \`${referenceTarget}\`\n${message}`.trim();
    },
    [
      activeFileLineRange,
      activeFilePath,
      fileReferenceMode,
      hasActiveFileReference,
    ],
  );

  const handleClearContext = useCallback(() => {
    if (activeFileReferenceSignature) {
      setDismissedActiveFileReference(activeFileReferenceSignature);
    }
  }, [activeFileReferenceSignature]);

  const handleAgentSelect = useCallback(
    (agent: ChatInputSelectedAgent | null) => {
      if (selectedEngine === "opencode") {
        onSelectOpenCodeAgent?.(agent?.id ?? null);
        return;
      }
      onAgentSelect?.(agent);
    },
    [onAgentSelect, onSelectOpenCodeAgent, selectedEngine],
  );

  const handleModeSelect = useCallback(
    (mode: PermissionMode) => {
      onSelectAccessMode(permissionModeToAccessMode(mode));
    },
    [onSelectAccessMode],
  );

  const handleToggleStatusPanel = useCallback(() => {
    setStatusPanelExpanded((prev) => !prev);
  }, []);
  const resolvedShowStatusPanelToggle =
    showStatusPanelToggleOverride ?? showStatusPanel;
  const resolvedStatusPanelExpanded =
    statusPanelExpandedOverride ?? statusPanelExpanded;
  const resolvedToggleStatusPanel =
    onToggleStatusPanelOverride ?? handleToggleStatusPanel;
  const canRewindSession = Boolean(onRewind && rewindSupportedEngine);

  const handleCancelRewind = useCallback(() => {
    if (rewindInFlight) {
      return;
    }
    setRewindPreviewState(null);
    setRewindMode("messages-and-files");
  }, [rewindInFlight]);

  const handleRewind = useCallback(() => {
    if (rewindInFlightRef.current || rewindInFlight) {
      return;
    }
    if (canRewindSession && onRewind) {
      const preview = buildLatestRewindPreview(
        items,
        activeThreadId,
        selectedEngine,
      );
      if (!preview) {
        pushErrorToast({
          title: t("rewind.title"),
          message: t("rewind.noEligibleMessage"),
        });
        return;
      }
      setRewindMode("messages-and-files");
      setRewindPreviewState(preview);
      return;
    }
    pushErrorToast({
      title: t("rewind.title"),
      message: t("rewind.notAvailable"),
    });
  }, [
    activeThreadId,
    canRewindSession,
    items,
    onRewind,
    rewindInFlight,
    selectedEngine,
    t,
  ]);

  const handleConfirmRewind = useCallback(async () => {
    const preview = rewindPreviewState;
    if (!preview) {
      return;
    }
    if (!onRewind) {
      pushErrorToast({
        title: t("rewind.title"),
        message: t("rewind.notAvailable"),
      });
      setRewindPreviewState(null);
      setRewindMode("messages-and-files");
      return;
    }
    if (rewindInFlightRef.current || rewindInFlight) {
      return;
    }

    rewindInFlightRef.current = true;
    try {
      setRewindInFlight(true);
      await onRewind(preview.targetMessageId, { mode: rewindMode });
      setRewindPreviewState(null);
      setRewindMode("messages-and-files");
    } catch (error) {
      pushErrorToast({
        title: t("rewind.title"),
        message:
          (error instanceof Error ? error.message : String(error)) ||
          t("rewind.failed"),
      });
    } finally {
      setRewindInFlight(false);
      rewindInFlightRef.current = false;
    }
  }, [
    onRewind,
    rewindMode,
    rewindInFlight,
    rewindPreviewState,
    t,
  ]);

  const handleStoreRewindChanges = useCallback(
    async (preview: ClaudeRewindPreviewState) => {
      const workspaceId = activeWorkspaceId?.trim() ?? "";
      const sessionId = preview.sessionId?.trim() ?? "";
      if (!workspaceId || !sessionId) {
        throw new Error(t("rewind.storeUnavailable"));
      }
      const filesByPath = new Map<
        string,
        { path: string; status?: RewindFileChangeStatus }
      >();
      for (const file of preview.affectedFiles) {
        const path = normalizeRewindExportPath(file.filePath);
        const dedupeKey = toRewindPathDedupeKey(file.filePath);
        if (!path || !dedupeKey) {
          continue;
        }
        const existing = filesByPath.get(dedupeKey);
        if (!existing) {
          filesByPath.set(dedupeKey, { path, status: file.status });
          continue;
        }
        const currentStatus = existing.status ?? "M";
        const incomingStatus = file.status ?? "M";
        existing.status = resolvePreferredStatus(currentStatus, incomingStatus);
      }
      const exportFiles = Array.from(filesByPath.values());
      if (exportFiles.length === 0) {
        throw new Error(t("rewind.filesEmpty"));
      }
      return exportRewindFiles({
        workspaceId,
        engine: preview.engine,
        sessionId,
        targetMessageId: preview.targetMessageId,
        conversationLabel: preview.conversationLabel,
        files: exportFiles,
      });
    },
    [activeWorkspaceId, t],
  );

  const handleManualCompactContext = useCallback(async () => {
    if (selectedEngine !== "codex") {
      return;
    }
    if (!activeWorkspaceId || !activeThreadId || !onRequestContextCompaction) {
      pushErrorToast({
        title: t("chat.contextDualViewManualCompact"),
        message: t("chat.contextDualViewManualCompactUnavailable"),
      });
      return;
    }
    try {
      await onRequestContextCompaction();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushErrorToast({
        title: t("chat.contextDualViewManualCompact"),
        message: message || t("chat.contextDualViewManualCompactFailed"),
      });
    }
  }, [
    activeThreadId,
    activeWorkspaceId,
    onRequestContextCompaction,
    selectedEngine,
    t,
  ]);

  const handleCodexQuickCommand = useCallback(
    (command: string) => {
      if (disabled) {
        return;
      }
      const normalized = command.trim().toLowerCase();
      const isReviewCommand = /^\/review\b/.test(normalized);
      const isFastCommand = /^\/fast\b/.test(normalized);
      if (isFastCommand && selectedEngine !== "codex") {
        return;
      }
      if (isReviewCommand && !isReviewQuickActionEngine) {
        return;
      }
      if (!isReviewCommand && !isFastCommand && selectedEngine !== "codex") {
        return;
      }
      void onSend(command, []);
    },
    [disabled, isReviewQuickActionEngine, onSend, selectedEngine],
  );

  const handleForkQuickStart = useCallback(() => {
    if (disabled) {
      return;
    }
    if (onForkQuickStart) {
      onForkQuickStart();
      return;
    }
    if (selectedEngine !== "codex" && selectedEngine !== "claude") {
      return;
    }
    void onSend("/fork", []);
  }, [disabled, onForkQuickStart, onSend, selectedEngine]);

  const handleSend = useCallback(
    (submittedText?: string, submittedImages?: string[]) => {
      if (disabled) {
        return;
      }
      if (opencodeDisconnected) {
        pushErrorToast({
          title: "OpenCode 未连接",
          message:
            "当前连接状态为红色，请先在 OpenCode 管理面板完成连接后再发送。",
        });
        return;
      }
      const trimmed = (submittedText ?? text).trim();
      // Merge images from Composer state (file picker) and ChatInputBox (paste/drop)
      const mergedImages = Array.from(
        new Set([...attachedImages, ...(submittedImages ?? [])]),
      );
      if (
        !trimmed &&
        mergedImages.length === 0 &&
        !selectedOpenCodeDirectCommand
      ) {
        return;
      }
      if (selectedOpenCodeDirectCommand) {
        onSend(`/${selectedOpenCodeDirectCommand}`, []);
        clearComposerContextSelections();
        inlineCompletion.clear();
        resetHistoryNavigation();
        setComposerText("");
        return;
      }
      if (trimmed) {
        recordHistory(trimmed);
        recordInputHistory(trimmed);
      }
      inlineCompletion.clear();
      const finalText = shouldAssemblePrompt({
        userInput: trimmed,
        selectedSkillCount: selectedSkills.length,
        selectedCommonsCount: selectedCommons.length,
      })
        ? assembleSinglePrompt({
            userInput: trimmed,
            skills: selectedSkills,
            commons: selectedCommons.map((item) => ({ name: item.name })),
          })
        : trimmed;
      const finalTextWithReference = applyActiveFileReference(finalText);
      const resolvedFinalText = replaceVisibleFileReferenceLabels(
        normalizeInlineFileReferenceTokens(finalTextWithReference),
        selectedInlineFileReferences,
      );
      const resolvedFinalTextWithAnnotations = appendCodeAnnotationsToPrompt(
        resolvedFinalText,
        selectedCodeAnnotations,
      );
      const selectedMemoryIds = selectedManualMemories.map((entry) => entry.id);
      const selectedNoteCardIds = selectedNoteCards.map((entry) => entry.id);
      const selectedMemoryInjectionMode = getManualMemoryInjectionMode();
      const sendOptions =
        selectedMemoryIds.length > 0 || selectedNoteCardIds.length > 0 || memoryReferenceArmed
          ? {
              ...(memoryReferenceArmed ? { memoryReferenceEnabled: true } : {}),
              ...(selectedMemoryIds.length > 0
                ? { selectedMemoryIds, selectedMemoryInjectionMode }
                : {}),
              ...(selectedNoteCardIds.length > 0 ? { selectedNoteCardIds } : {}),
            }
          : undefined;
      const sendResult = onSend(
        resolvedFinalTextWithAnnotations,
        mergedImages,
        sendOptions,
      );
      const retainedManualMemories = filterRetainedEntries(
        selectedManualMemories,
        carryOverManualMemoryIds,
      );
      const retainedNoteCards = filterRetainedEntries(
        selectedNoteCards,
        carryOverNoteCardIds,
      );
      const retainedSkillNames = filterRetainedChipNames(
        selectedSkillNames,
        carryOverContextChipKeys,
        "skill",
      );
      const retainedCommonsNames = filterRetainedChipNames(
        selectedCommonsNames,
        carryOverContextChipKeys,
        "commons",
      );
      const nextRetainedContextChipKeys = buildRetainedContextChipKeys(
        retainedSkillNames,
        retainedCommonsNames,
      );
      setSelectedSkillNames([]);
      setSelectedCommonsNames([]);
      void Promise.resolve(sendResult).finally(() => {
        setSelectedManualMemories(retainedManualMemories);
        setSelectedNoteCards(retainedNoteCards);
        setSelectedInlineFileReferences([]);
        onClearCodeAnnotations?.();
        setSelectedSkillNames(retainedSkillNames);
        setSelectedCommonsNames(retainedCommonsNames);
        setRetainedManualMemoryIds(
          retainedManualMemories.map((entry) => entry.id),
        );
        setRetainedNoteCardIds(retainedNoteCards.map((entry) => entry.id));
        setRetainedContextChipKeys(nextRetainedContextChipKeys);
        setCarryOverManualMemoryIds([]);
        setCarryOverNoteCardIds([]);
        setCarryOverContextChipKeys([]);
        setMemoryReferenceArmed(false);
      });
      resetHistoryNavigation();
      setComposerText("");
    },
    [
      attachedImages,
      disabled,
      applyActiveFileReference,
      opencodeDisconnected,
      selectedOpenCodeDirectCommand,
      selectedCommons,
      selectedSkills,
      selectedInlineFileReferences,
      selectedCodeAnnotations,
      onClearCodeAnnotations,
      selectedManualMemories,
      selectedNoteCards,
      memoryReferenceArmed,
      onSend,
      inlineCompletion,
      recordHistory,
      resetHistoryNavigation,
      setComposerText,
      selectedCommonsNames,
      selectedSkillNames,
      setSelectedManualMemories,
      text,
      carryOverContextChipKeys,
      carryOverManualMemoryIds,
      carryOverNoteCardIds,
      clearComposerContextSelections,
    ],
  );

  const handleRemoveManualMemory = useCallback((memoryId: string) => {
    setCarryOverManualMemoryIds((prev) =>
      prev.filter((entryId) => entryId !== memoryId),
    );
    setRetainedManualMemoryIds((prev) =>
      prev.filter((entryId) => entryId !== memoryId),
    );
    setSelectedManualMemories((prev) =>
      prev.filter((entry) => entry.id !== memoryId),
    );
  }, []);

  const handleRemoveNoteCard = useCallback((noteCardId: string) => {
    setCarryOverNoteCardIds((prev) =>
      prev.filter((entryId) => entryId !== noteCardId),
    );
    setRetainedNoteCardIds((prev) =>
      prev.filter((entryId) => entryId !== noteCardId),
    );
    setSelectedNoteCards((prev) =>
      prev.filter((entry) => entry.id !== noteCardId),
    );
  }, []);

  const handleRemoveContextChip = useCallback((chip: ContextSelectionChip) => {
    const carryOverKey = toContextChipCarryOverKey(chip);
    setCarryOverContextChipKeys((prev) =>
      prev.filter((entry) => entry !== carryOverKey),
    );
    setRetainedContextChipKeys((prev) =>
      prev.filter((entry) => entry !== carryOverKey),
    );
    if (chip.type === "skill") {
      setSelectedSkillNames((prev) =>
        prev.filter((name) => name !== chip.name),
      );
      return;
    }
    setSelectedCommonsNames((prev) =>
      prev.filter((name) => name !== chip.name),
    );
  }, []);

  const handleRemoveCodeAnnotation = useCallback((annotationId: string) => {
    onRemoveCodeAnnotation?.(annotationId);
  }, [onRemoveCodeAnnotation]);

  useEffect(() => {
    if (!prefillDraft) {
      return;
    }
    setComposerText(prefillDraft.text);
    resetHistoryNavigation();
    onPrefillHandled?.(prefillDraft.id);
  }, [onPrefillHandled, prefillDraft, resetHistoryNavigation, setComposerText]);

  useEffect(() => {
    if (!insertText) {
      return;
    }
    setComposerText(insertText.text);
    resetHistoryNavigation();
    onInsertHandled?.(insertText.id);
  }, [insertText, onInsertHandled, resetHistoryNavigation, setComposerText]);

  useEffect(() => {
    if (!dictationTranscript) {
      return;
    }
    const textToInsert = dictationTranscript.text.trim();
    if (!textToInsert) {
      onDictationTranscriptHandled?.(dictationTranscript.id);
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    const { nextText, nextCursor } = computeDictationInsertion(
      text,
      textToInsert,
      start,
      end,
    );
    setComposerText(nextText);
    resetHistoryNavigation();
    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextCursor, nextCursor);
      handleSelectionChange(nextCursor);
    });
    onDictationTranscriptHandled?.(dictationTranscript.id);
  }, [
    dictationTranscript,
    handleSelectionChange,
    onDictationTranscriptHandled,
    resetHistoryNavigation,
    selectionStart,
    setComposerText,
    text,
    textareaRef,
  ]);

  const claudeContextUsage = useMemo<ClaudeContextUsageViewModel | null>(() => {
    if (!contextUsage || selectedEngine !== "claude") {
      return null;
    }
    const usedTokens = resolveClaudeWindowUsedTokens(contextUsage);
    const contextWindow = finitePositive(contextUsage.modelContextWindow);
    const totalTokens = finiteNonNegative(contextUsage.total.totalTokens);
    const inputTokens = finiteNonNegative(contextUsage.total.inputTokens);
    const cachedInputTokens = finiteNonNegative(contextUsage.total.cachedInputTokens);
    const outputTokens = finiteNonNegative(contextUsage.total.outputTokens);
    const explicitUsedPercent = finiteNonNegative(contextUsage.contextUsedPercent);
    const usedPercent = explicitUsedPercent
      ?? (
        usedTokens !== null && contextWindow !== null
          ? (usedTokens / contextWindow) * 100
          : null
      );
    const explicitRemainingPercent = finiteNonNegative(contextUsage.contextRemainingPercent);
    const remainingPercent = explicitRemainingPercent
      ?? (usedPercent !== null ? Math.max(100 - usedPercent, 0) : null);

    return {
      usedTokens,
      contextWindow,
      totalTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      usedPercent,
      remainingPercent,
      freshness: contextUsage.contextUsageFreshness ?? "estimated",
      source: contextUsage.contextUsageSource ?? null,
      hasUsage: usedTokens !== null || usedPercent !== null || (totalTokens ?? 0) > 0,
      categoryUsages: contextUsage.contextCategoryUsages ?? null,
      toolUsages: contextUsage.contextToolUsages ?? null,
      toolUsagesTruncated: contextUsage.contextToolUsagesTruncated ?? null,
    };
  }, [contextUsage, selectedEngine]);

  const legacyContextUsage = useMemo(() => {
    if (!contextUsage) {
      return null;
    }
    if (selectedEngine === "claude") {
      const usedTokens = resolveClaudeWindowUsedTokens(contextUsage);
      const contextWindow = finitePositive(contextUsage.modelContextWindow);
      return usedTokens !== null && contextWindow !== null
        ? { used: usedTokens, total: contextWindow }
        : null;
    }
    return {
      used: contextUsage.total.totalTokens,
      total: contextUsage.modelContextWindow ?? 0,
    };
  }, [contextUsage, selectedEngine]);

  const dualContextUsage = useMemo(
    () =>
      resolveDualContextUsageModel(
        contextUsage,
        isContextCompacting,
        codexCompactionLifecycleState,
        codexCompactionSource,
        codexCompactionCompletedAt,
        lastTokenUsageUpdatedAt,
      ),
    [
      contextUsage,
      isContextCompacting,
      codexCompactionLifecycleState,
      codexCompactionSource,
      codexCompactionCompletedAt,
      lastTokenUsageUpdatedAt,
    ],
  );
  const deferredStreamActivityPhase = useDeferredValue(streamActivityPhase);
  const deferredLegacyContextUsage = useDeferredValue(legacyContextUsage);
  const deferredDualContextUsage = useDeferredValue(dualContextUsage);
  const deferredClaudeContextUsage = useDeferredValue(claudeContextUsage);
  const deferredAccountRateLimits = useDeferredValue(accountRateLimits);
  const resolvedComposerStreamActivityPhase =
    isProcessing && isComposerInputInteractionActive
      ? deferredStreamActivityPhase
      : streamActivityPhase;
  const resolvedLegacyContextUsage =
    isProcessing && isComposerInputInteractionActive
      ? deferredLegacyContextUsage
      : legacyContextUsage;
  const resolvedDualContextUsage =
    isProcessing && isComposerInputInteractionActive
      ? deferredDualContextUsage
      : dualContextUsage;
  const resolvedClaudeContextUsage =
    isProcessing && isComposerInputInteractionActive
      ? deferredClaudeContextUsage
      : claudeContextUsage;
  const resolvedAccountRateLimits =
    isProcessing && isComposerInputInteractionActive
      ? deferredAccountRateLimits
      : accountRateLimits;
  const {
    handleToggleLedgerPin,
    handleExcludeLedgerBlock,
    handleClearCarryOverLedgerBlock,
    handleBatchKeepLedgerBlocks,
    handleBatchExcludeLedgerBlocks,
    handleBatchClearCarryOverLedgerBlocks,
  } = useContextLedgerGovernance({
    activeFilePath,
    activeFileReferenceSignature,
    setDismissedActiveFileReference,
    setCarryOverManualMemoryIds,
    setRetainedManualMemoryIds,
    setSelectedManualMemories,
    setCarryOverNoteCardIds,
    setRetainedNoteCardIds,
    setSelectedNoteCards,
    setCarryOverContextChipKeys,
    setRetainedContextChipKeys,
    setSelectedSkillNames,
    setSelectedCommonsNames,
    setSelectedInlineFileReferences,
  });
  const handleOpenLedgerSource = useCallback((target: ContextLedgerSourceNavigationTarget) => {
    if (target.kind === "manual_memory") {
      _onOpenContextLedgerMemory?.(target.memoryId);
      return;
    }
    if (target.kind === "note_card") {
      _onOpenContextLedgerNote?.(target.noteId);
      return;
    }
    onOpenDiffPath?.(target.path);
  }, [_onOpenContextLedgerMemory, _onOpenContextLedgerNote, onOpenDiffPath]);
  const selectedEngineInfo = useMemo(
    () => engines?.find((engine) => engine.type === selectedEngine),
    [engines, selectedEngine],
  );
  const selectedModelOption = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId],
  );
  const selectedPermissionMode = accessModeToPermissionMode(accessMode);
  const activeUserInputRequest = useMemo(
    () =>
      userInputRequests.find((request) => {
        if (!activeThreadId || request.params.thread_id !== activeThreadId) {
          return false;
        }
        if (activeWorkspaceId && request.workspace_id !== activeWorkspaceId) {
          return false;
        }
        return request.params.completed !== true;
      }) ?? null,
    [activeThreadId, activeWorkspaceId, userInputRequests],
  );
  const handleJumpToUserInputRequest = useCallback(() => {
    if (!activeUserInputRequest) {
      return;
    }
    onJumpToUserInputRequest?.(activeUserInputRequest);
  }, [activeUserInputRequest, onJumpToUserInputRequest]);
  const handleExpandContextSources = useCallback(() => {
    setContextLedgerExpanded(true);
  }, []);
  const codexContextDualViewEnabled = contextDualViewEnabled && isCodexEngine;
  const contextLedgerProjection = useMemo(
    () =>
      buildContextLedgerProjection({
        engine: selectedEngine,
        contextUsage,
        contextDualViewEnabled: codexContextDualViewEnabled,
        dualContextUsage: codexContextDualViewEnabled
          ? resolvedDualContextUsage
          : null,
        manualMemoryInjectionMode: getManualMemoryInjectionMode(),
        selectedManualMemories,
        selectedNoteCards,
        selectedInlineFileReferences,
        selectedCodeAnnotations,
        activeFileReference: hasActiveFileReference && activeFilePath
          ? {
              path: activeFilePath,
              lineRange: activeFileLineRange,
            }
          : null,
        selectedContextChips: contextSelectionChips,
        carryOverManualMemoryIds,
        carryOverNoteCardIds,
        carryOverContextChipKeys,
        retainedManualMemoryIds,
        retainedNoteCardIds,
        retainedContextChipKeys,
      }),
    [
      activeFileLineRange,
      activeFilePath,
      carryOverContextChipKeys,
      carryOverManualMemoryIds,
      carryOverNoteCardIds,
      codexContextDualViewEnabled,
      contextSelectionChips,
      contextUsage,
      hasActiveFileReference,
      retainedContextChipKeys,
      retainedManualMemoryIds,
      retainedNoteCardIds,
      resolvedDualContextUsage,
      selectedEngine,
      selectedCodeAnnotations,
      selectedInlineFileReferences,
      selectedManualMemories,
      selectedNoteCards,
    ],
  );
  const composerReadinessAccessMode =
    selectedEngine === "codex" && _selectedCollaborationModeId === "plan"
      ? "read-only"
      : accessMode;
  const composerSendReadiness = useMemo(
    () =>
      buildComposerSendReadiness({
        engine: selectedEngine ?? "claude",
        providerLabel:
          selectedEngineInfo?.shortName ||
          selectedEngineInfo?.displayName ||
          selectedEngine ||
          "Claude Code",
        modelLabel:
          selectedModelOption?.displayName ||
          selectedModelOption?.model ||
          selectedModelId ||
          t("composer.noModels"),
        modeLabel:
          selectedEngine === "codex" && _selectedCollaborationModeId === "plan"
            ? t("codexModes.plan.label")
            : t(`modes.${selectedPermissionMode}.label`),
        modeImpactLabel: t(`composer.readinessModeImpact.${composerReadinessAccessMode}`),
        accessMode: composerReadinessAccessMode,
        draftText: text,
        hasAttachments: attachedImages.length > 0,
        isProcessing,
        streamActivityPhase: resolvedComposerStreamActivityPhase,
        queuedCount: queuedMessages.length,
        fusingQueuedMessageId,
        canQueue: Boolean(onQueue),
        canStop,
        configLoading: isModelConfigRefreshing,
        runtimeLifecycleState,
        requestUserInputState: activeUserInputRequest ? "pending" : null,
        context: {
          selectedMemoryCount: selectedManualMemories.length,
          selectedNoteCardCount: selectedNoteCards.length,
          fileReferenceCount:
            selectedInlineFileReferences.length + (hasActiveFileReference ? 1 : 0),
          imageCount: attachedImages.length,
          selectedAgentName: selectedChatInputAgent?.name ?? null,
          ledgerBlockCount: contextLedgerProjection.visible
            ? contextLedgerProjection.totalBlockCount
            : null,
          ledgerGroupCount: contextLedgerProjection.visible
            ? contextLedgerProjection.totalGroupCount
            : null,
        },
      }),
    [
      activeUserInputRequest,
      attachedImages.length,
      canStop,
      composerReadinessAccessMode,
      contextLedgerProjection.totalBlockCount,
      contextLedgerProjection.totalGroupCount,
      contextLedgerProjection.visible,
      fusingQueuedMessageId,
      hasActiveFileReference,
      isModelConfigRefreshing,
      isProcessing,
      onQueue,
      queuedMessages.length,
      resolvedComposerStreamActivityPhase,
      runtimeLifecycleState,
      selectedChatInputAgent?.name,
      selectedEngine,
      selectedEngineInfo?.displayName,
      selectedEngineInfo?.shortName,
      _selectedCollaborationModeId,
      selectedInlineFileReferences.length,
      selectedManualMemories.length,
      selectedModelId,
      selectedModelOption?.displayName,
      selectedModelOption?.model,
      selectedNoteCards.length,
      selectedPermissionMode,
      t,
      text,
    ],
  );
  useEffect(() => {
    if (previousContextLedgerSessionKeyRef.current !== contextLedgerSessionKey) {
      previousContextLedgerSessionKeyRef.current = contextLedgerSessionKey;
      currentContextLedgerProjectionRef.current = contextLedgerProjection;
      return;
    }
    currentContextLedgerProjectionRef.current = contextLedgerProjection;
  }, [contextLedgerProjection, contextLedgerSessionKey]);
  const selectedManualMemoryIds = useMemo(
    () => selectedManualMemories.map((entry) => entry.id),
    [selectedManualMemories],
  );
  const selectedNoteCardIds = useMemo(
    () => selectedNoteCards.map((entry) => entry.id),
    [selectedNoteCards],
  );
  const manualMemorySelectionHintCopy =
    carryOverManualMemoryIds.length > 0
      ? t("composer.contextLedgerCarryOverReasonWillCarry")
      : retainedManualMemoryIds.length > 0
        ? t("composer.contextLedgerCarryOverReasonInherited")
        : t("composer.manualMemorySelectionHint");
  const noteCardSelectionHintCopy =
    carryOverNoteCardIds.length > 0
      ? t("composer.contextLedgerCarryOverReasonWillCarry")
      : retainedNoteCardIds.length > 0
        ? t("composer.contextLedgerCarryOverReasonInherited")
        : t("composer.noteCardSelectionHint");
  const shouldRenderReviewInlinePrompt =
    isReviewQuickActionEngine &&
    Boolean(reviewPrompt) &&
    Boolean(_onReviewPromptClose) &&
    Boolean(_onReviewPromptShowPreset) &&
    Boolean(_onReviewPromptChoosePreset) &&
    _highlightedPresetIndex !== undefined &&
    Boolean(_onReviewPromptHighlightPreset) &&
    _highlightedBranchIndex !== undefined &&
    Boolean(_onReviewPromptHighlightBranch) &&
    _highlightedCommitIndex !== undefined &&
    Boolean(_onReviewPromptHighlightCommit) &&
    Boolean(_onReviewPromptSelectBranch) &&
    Boolean(_onReviewPromptSelectBranchAtIndex) &&
    Boolean(_onReviewPromptConfirmBranch) &&
    Boolean(_onReviewPromptSelectCommit) &&
    Boolean(_onReviewPromptSelectCommitAtIndex) &&
    Boolean(_onReviewPromptConfirmCommit) &&
    Boolean(_onReviewPromptUpdateCustomInstructions) &&
    Boolean(_onReviewPromptConfirmCustom);
  const hasScrollableContextStack =
    selectedManualMemories.length > 0 ||
    selectedNoteCards.length > 0 ||
    selectedCodeAnnotations.length > 0 ||
    contextLedgerExpanded ||
    shouldRenderReviewInlinePrompt;

  return (
    <footer
      className={`composer col-start-1 row-start-3 flex flex-col items-center gap-2 border-t-0 bg-[var(--surface-messages)] px-[var(--main-panel-padding)] pb-6 pt-3 [-webkit-app-region:no-drag] [&>*]:w-full [&>*]:max-w-[750px] [&_textarea:disabled]:cursor-not-allowed [&_textarea:disabled]:text-[var(--text-fainter)] [&_textarea:disabled]:opacity-60${disabled ? " is-disabled opacity-70" : ""}`}
    >
      <div
        className={`composer-shell grid gap-2 rounded-none border-none bg-transparent p-0 focus-within:border-transparent focus-within:shadow-none${isComposerCollapsed ? " is-collapsed overflow-hidden" : ""}`}
      >
        {isComposerCollapsed ? (
          <button
            type="button"
            className={`composer-shell-collapsed-strip flex min-h-[26px] w-full items-center justify-center gap-2 rounded-full border-0 border-t border-t-[color-mix(in_srgb,var(--border-subtle)_92%,transparent)] bg-[color-mix(in_srgb,var(--surface-control)_88%,transparent)] px-2 shadow-none hover:bg-[color-mix(in_srgb,var(--surface-hover)_82%,transparent)] hover:text-foreground ${isProcessing ? "is-processing text-foreground" : "text-muted-foreground"}`}
            onClick={handleExpandComposer}
            aria-label={t("composer.expandInput")}
            title={t("composer.expandInput")}
          >
            <span
              className="composer-shell-collapsed-rail hidden items-center gap-[3px] [&>span]:h-[2px] [&>span]:w-[10px] [&>span]:rounded-full [&>span]:bg-[color-mix(in_srgb,var(--text-faint)_70%,transparent)] [&>span]:opacity-60"
              aria-hidden
            >
              <span />
              <span />
              <span />
            </span>
            <span className="composer-shell-collapsed-text whitespace-nowrap text-[11px] font-semibold">
              {isProcessing
                ? t("composer.collapsedProcessing")
                : t("composer.expandInput")}
            </span>
          </button>
        ) : (
          <>
            {/* Management toolbar (help, skill, commons, kanban) removed -- was disabled with {false && ...} */}
            {hasScrollableContextStack ? (
              <div className="composer-context-stack grid min-h-0 max-h-[min(44vh,420px)] gap-0 overflow-y-auto overflow-x-hidden overscroll-contain pr-1">
                {selectedManualMemories.length > 0 && (
                  <div className="composer-memory-strip">
                    <div className="composer-memory-strip-head">
                      <span className="composer-memory-strip-label">
                        {t("composer.manualMemorySelection", {
                          count: selectedManualMemories.length,
                        })}
                      </span>
                      <span className="composer-memory-strip-hint">
                        {manualMemorySelectionHintCopy}
                      </span>
                    </div>
                    <div className="composer-memory-chip-list">
                      {selectedManualMemories.map((memory, memoryIndex) => {
                        const chipTitle = `[M${memoryIndex + 1}] ${resolveManualMemoryChipTitle(memory)}`;
                        const chipDetail = resolveManualMemoryChipDetail(memory);
                        return (
                          <article
                            key={`manual-memory-${memory.id}`}
                            className="composer-memory-chip"
                          >
                            <button
                              type="button"
                              className="composer-memory-chip-remove"
                              onClick={() => handleRemoveManualMemory(memory.id)}
                              title={t("composer.manualMemoryRemove", {
                                title: memory.title,
                              })}
                              aria-label={t("composer.manualMemoryRemove", {
                                title: memory.title,
                              })}
                            >
                              ×
                            </button>
                            <div className="composer-memory-chip-main">
                              <span className="composer-memory-chip-title">
                                {chipTitle}
                              </span>
                              {chipDetail && (
                                <span className="composer-memory-chip-summary">
                                  {chipDetail}
                                </span>
                              )}
                              <span className="composer-memory-chip-meta">
                                {carryOverManualMemoryIds.includes(memory.id) ? (
                                  <span className="composer-memory-chip-state composer-memory-chip-state--carry">
                                    {t("composer.contextLedgerCarryOverReasonWillCarry")}
                                  </span>
                                ) : retainedManualMemoryIds.includes(memory.id) ? (
                                  <span className="composer-memory-chip-state composer-memory-chip-state--retained">
                                    {t("composer.contextLedgerCarryOverReasonInherited")}
                                  </span>
                                ) : null}
                                <span>{memory.kind}</span>
                                <span>{memory.importance}</span>
                                <span>
                                  {new Date(memory.updatedAt).toLocaleDateString(
                                    undefined,
                                    {
                                      month: "2-digit",
                                      day: "2-digit",
                                    },
                                  )}
                                </span>
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedNoteCards.length > 0 && (
                  <div className="composer-memory-strip">
                    <div className="composer-memory-strip-head">
                      <span className="composer-memory-strip-label">
                        {t("composer.noteCardSelection", {
                          count: selectedNoteCards.length,
                        })}
                      </span>
                      <span className="composer-memory-strip-hint">
                        {noteCardSelectionHintCopy}
                      </span>
                    </div>
                    <div className="composer-memory-chip-list">
                      {selectedNoteCards.map((noteCard) => {
                        const chipTitle = resolveNoteCardChipTitle(noteCard);
                        const chipDetail = resolveNoteCardChipDetail(noteCard);
                        return (
                          <article
                            key={`note-card-${noteCard.id}`}
                            className="composer-memory-chip"
                          >
                            <button
                              type="button"
                              className="composer-memory-chip-remove"
                              onClick={() => handleRemoveNoteCard(noteCard.id)}
                              title={t("composer.noteCardRemove", {
                                title: noteCard.title,
                              })}
                              aria-label={t("composer.noteCardRemove", {
                                title: noteCard.title,
                              })}
                            >
                              ×
                            </button>
                            <div className="composer-memory-chip-main">
                              <span className="composer-memory-chip-title">
                                {chipTitle}
                              </span>
                              {chipDetail && (
                                <span className="composer-memory-chip-summary">
                                  {chipDetail}
                                </span>
                              )}
                              <span className="composer-memory-chip-meta">
                                {carryOverNoteCardIds.includes(noteCard.id) ? (
                                  <span className="composer-memory-chip-state composer-memory-chip-state--carry">
                                    {t("composer.contextLedgerCarryOverReasonWillCarry")}
                                  </span>
                                ) : retainedNoteCardIds.includes(noteCard.id) ? (
                                  <span className="composer-memory-chip-state composer-memory-chip-state--retained">
                                    {t("composer.contextLedgerCarryOverReasonInherited")}
                                  </span>
                                ) : null}
                                {noteCard.archived ? (
                                  <span>{t("composer.noteCardArchivedBadge")}</span>
                                ) : null}
                                <span>
                                  {new Date(noteCard.updatedAt).toLocaleDateString(
                                    undefined,
                                    {
                                      month: "2-digit",
                                      day: "2-digit",
                                    },
                                  )}
                                </span>
                                {noteCard.imageCount > 0 ? (
                                  <span>
                                    {t("noteCards.imageCount", {
                                      count: noteCard.imageCount,
                                    })}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedCodeAnnotations.length > 0 && (
                  <div className="composer-memory-strip composer-code-annotation-strip">
                    <div className="composer-memory-strip-head">
                      <span className="composer-memory-strip-label">
                        {t("composer.codeAnnotationSelection", {
                          count: selectedCodeAnnotations.length,
                        })}
                      </span>
                      <span className="composer-memory-strip-hint">
                        {t("composer.codeAnnotationSelectionHint", {
                          count: selectedCodeAnnotations.length,
                        })}
                      </span>
                    </div>
                    <div className="composer-memory-chip-list composer-code-annotation-list">
                      {selectedCodeAnnotations.map((annotation) => {
                        const lineLabel = formatCodeAnnotationLineRange(
                          annotation.lineRange,
                        );
                        const fileName =
                          annotation.path.split(/[\\/]/).filter(Boolean).pop() ??
                          annotation.path;
                        return (
                          <article
                            key={annotation.id}
                            className="composer-memory-chip composer-code-annotation-chip"
                          >
                            <button
                              type="button"
                              className="composer-memory-chip-remove"
                              onClick={() => handleRemoveCodeAnnotation(annotation.id)}
                              title={t("composer.codeAnnotationRemove", {
                                path: annotation.path,
                              })}
                              aria-label={t("composer.codeAnnotationRemove", {
                                path: annotation.path,
                              })}
                            >
                              ×
                            </button>
                            <div className="composer-memory-chip-main">
                              <span className="composer-memory-chip-title">
                                {fileName} · {lineLabel}
                              </span>
                              <span className="composer-memory-chip-summary">
                                {annotation.body}
                              </span>
                              <span className="composer-memory-chip-meta">
                                <span>{annotation.path}</span>
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                {contextLedgerExpanded ? (
                  <ContextLedgerPanel
                    projection={contextLedgerProjection}
                    comparison={null}
                    expanded={contextLedgerExpanded}
                    onToggle={() => setContextLedgerExpanded((prev) => !prev)}
                    onExcludeBlock={handleExcludeLedgerBlock}
                    onClearCarryOverBlock={handleClearCarryOverLedgerBlock}
                    onBatchKeepBlocks={handleBatchKeepLedgerBlocks}
                    onBatchExcludeBlocks={handleBatchExcludeLedgerBlocks}
                    onBatchClearCarryOverBlocks={handleBatchClearCarryOverLedgerBlocks}
                    onTogglePinBlock={handleToggleLedgerPin}
                    onOpenBlockSource={handleOpenLedgerSource}
                  />
                ) : null}

                {shouldRenderReviewInlinePrompt && reviewPrompt && (
                  <div
                    className="composer-suggestions popover-surface review-inline-suggestions"
                    role="listbox"
                    style={{
                      position: "relative",
                      left: "auto",
                      right: "auto",
                      top: "auto",
                      bottom: "auto",
                      width: "min(540px, 100%)",
                      maxWidth: "min(540px, 100%)",
                      marginBottom: "4px",
                    }}
                  >
                    <ReviewInlinePrompt
                      reviewPrompt={reviewPrompt}
                      onClose={_onReviewPromptClose!}
                      onShowPreset={_onReviewPromptShowPreset!}
                      onChoosePreset={_onReviewPromptChoosePreset!}
                      highlightedPresetIndex={_highlightedPresetIndex!}
                      onHighlightPreset={_onReviewPromptHighlightPreset!}
                      highlightedBranchIndex={_highlightedBranchIndex!}
                      onHighlightBranch={_onReviewPromptHighlightBranch!}
                      highlightedCommitIndex={_highlightedCommitIndex!}
                      onHighlightCommit={_onReviewPromptHighlightCommit!}
                      onSelectBranch={_onReviewPromptSelectBranch!}
                      onSelectBranchAtIndex={_onReviewPromptSelectBranchAtIndex!}
                      onConfirmBranch={_onReviewPromptConfirmBranch!}
                      onSelectCommit={_onReviewPromptSelectCommit!}
                      onSelectCommitAtIndex={_onReviewPromptSelectCommitAtIndex!}
                      onConfirmCommit={_onReviewPromptConfirmCommit!}
                      onUpdateCustomInstructions={
                        _onReviewPromptUpdateCustomInstructions!
                      }
                      onConfirmCustom={_onReviewPromptConfirmCustom!}
                      onKeyDown={_onReviewPromptKeyDown}
                    />
                  </div>
                )}
              </div>
            ) : null}
            <ChatInputBoxAdapter
              ref={chatInputRef}
              text={text}
              disabled={disabled}
              isProcessing={isProcessing}
              streamActivityPhase={resolvedComposerStreamActivityPhase}
              canStop={canStop}
              onSend={handleSend}
              onStop={onStop}
              onTextChange={handleTextChangeWithHistory}
              selectedModelId={selectedModelId}
              selectedEngine={selectedEngine}
              isSharedSession={isSharedSession}
              engines={engines}
              onSelectEngine={onSelectEngine}
              models={models}
              onSelectModel={onSelectModel}
              reasoningOptions={reasoningOptions}
              selectedEffort={selectedEffort}
              onSelectEffort={onSelectEffort}
              reasoningSupported={reasoningSupported}
              onResolvedAlwaysThinkingChange={onResolvedAlwaysThinkingChange}
              attachments={attachedImages}
              onAddAttachment={onPickImages}
              onAttachImages={onAttachImages}
              onRemoveAttachment={onRemoveImage}
              textareaHeight={textareaHeight}
              onHeightChange={onTextareaHeightChange}
              contextUsage={resolvedLegacyContextUsage}
              contextDualViewEnabled={codexContextDualViewEnabled}
              dualContextUsage={resolvedDualContextUsage}
              claudeContextUsage={resolvedClaudeContextUsage}
              onRequestContextCompaction={handleManualCompactContext}
              codexAutoCompactionEnabled={codexAutoCompactionEnabled}
              codexAutoCompactionThresholdPercent={codexAutoCompactionThresholdPercent}
              onCodexAutoCompactionSettingsChange={onCodexAutoCompactionSettingsChange}
              queuedMessages={queuedMessages}
              onDeleteQueued={onDeleteQueued}
              onFuseQueued={onFuseQueued}
              canFuseQueuedMessages={canFuseQueuedMessages}
              fusingQueuedMessageId={fusingQueuedMessageId}
              suggestionsOpen={suggestionsOpen}
              files={files}
              customSkillDirectories={customSkillDirectories}
              directories={directories}
              commands={commands}
              prompts={prompts}
              workspaceId={activeWorkspaceId}
              workspaceName={activeWorkspaceName}
              workspacePath={activeWorkspacePath}
              onManualMemorySelect={handleSelectManualMemory}
              onNoteCardSelect={handleSelectNoteCard}
              onSelectSkill={handleSelectSkill}
              sendShortcut={sendShortcut}
              placeholder={
                sendShortcut === "cmdEnter"
                  ? t("chat.inputPlaceholderCmdEnter")
                  : t("chat.inputPlaceholderEnter")
              }
              activeFile={
                hasActiveFileReference
                  ? (activeFilePath ?? undefined)
                  : undefined
              }
              selectedLines={
                hasActiveFileReference ? activeFileLinesLabel : undefined
              }
              onClearContext={
                hasActiveFileReference ? handleClearContext : undefined
              }
              selectedAgent={selectedChatInputAgent}
              selectedContextChips={contextSelectionChips}
              selectedManualMemoryIds={selectedManualMemoryIds}
              selectedNoteCardIds={selectedNoteCardIds}
              onRemoveContextChip={handleRemoveContextChip}
              onAgentSelect={handleAgentSelect}
              onOpenAgentSettings={onOpenAgentSettings}
              onOpenPromptSettings={onOpenPromptSettings}
              onOpenModelSettings={onOpenModelSettings}
              onOpenFileReference={onOpenDiffPath}
              onRefreshModelConfig={onRefreshModelConfig}
              isModelConfigRefreshing={isModelConfigRefreshing}
              permissionMode={selectedPermissionMode}
              onModeSelect={handleModeSelect}
              sendReadiness={composerSendReadiness}
              onJumpToRequest={activeUserInputRequest ? handleJumpToUserInputRequest : undefined}
              onExpandContextSources={contextLedgerProjection.visible ? handleExpandContextSources : undefined}
              contextSourcesExpanded={contextLedgerExpanded}
              selectedCollaborationModeId={_selectedCollaborationModeId}
              onSelectCollaborationMode={_onSelectCollaborationMode}
              accountRateLimits={resolvedAccountRateLimits}
              usageShowRemaining={usageShowRemaining}
              onRefreshAccountRateLimits={onRefreshAccountRateLimits}
              onCodexQuickCommand={handleCodexQuickCommand}
              onForkQuickStart={handleForkQuickStart}
              memoryReferenceArmed={memoryReferenceArmed}
              onToggleMemoryReference={() => setMemoryReferenceArmed((value) => !value)}
              hasMessages={items.length > 0}
              onRewind={handleRewind}
              showRewindEntry={canRewindSession}
              statusPanelExpanded={resolvedStatusPanelExpanded}
              showStatusPanelToggle={resolvedShowStatusPanelToggle}
              onToggleStatusPanel={resolvedToggleStatusPanel}
              completionEmailSelected={completionEmailSelected}
              completionEmailDisabled={completionEmailDisabled}
              onToggleCompletionEmail={onToggleCompletionEmail}
            />
          </>
        )}
      </div>
      <ClaudeRewindConfirmDialog
        preview={rewindPreviewState}
        isBusy={rewindInFlight}
        rewindMode={rewindMode}
        shouldShowAffectedFiles={
          !rewindWorkspaceGitState?.isGitRepository ||
          Boolean(rewindWorkspaceGitState.hasDetectedChanges)
        }
        onRewindModeChange={setRewindMode}
        onOpenDiffPath={onOpenDiffPath}
        onStoreChanges={handleStoreRewindChanges}
        onCancel={handleCancelRewind}
        onConfirm={handleConfirmRewind}
      />
    </footer>
  );
});
