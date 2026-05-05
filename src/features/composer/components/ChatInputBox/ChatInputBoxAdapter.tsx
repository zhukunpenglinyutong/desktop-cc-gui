/**
 * ChatInputBoxAdapter - Bridge between Composer.tsx props and ChatInputBox props
 *
 * This adapter translates the Composer's prop interface to ChatInputBox's interface,
 * enabling drop-in replacement of ComposerInput while maintaining 100% visual and
 * interaction consistency with idea-claude-code-gui's input box.
 */
import {
  forwardRef,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChatInputBox } from './ChatInputBox';
import type {
  ChatInputBoxHandle,
  Attachment,
  CodexSpeedMode,
  ContextSelectionChip,
  DualContextUsageViewModel,
  PermissionMode,
  ReasoningEffort,
  SelectedAgent,
  StreamActivityPhase,
  FileItem,
  CommandItem,
  PromptItem,
  SkillItem,
  NoteCardItem,
} from './types';
import type { QueuedMessage as ComposerQueuedMessage } from '../../../../types';
import type { CustomCommandOption, CustomPromptOption } from '../../../../types';
import type { EngineType } from '../../../../types';
import type { RateLimitSnapshot } from '../../../../types';
import { formatEngineVersionLabel } from '../../../engine/utils/engineLabels';
import { projectMemoryFacade } from '../../../project-memory/services/projectMemoryFacade';
import { noteCardsFacade } from '../../../note-cards/services/noteCardsFacade';
import { isSharedSessionSupportedEngine } from '../../../shared-session/utils/sharedSessionEngines';
import {
  getClaudeProviders,
  getClaudeAlwaysThinkingEnabled,
  setClaudeAlwaysThinkingEnabled,
  switchClaudeProvider,
  updateClaudeProvider,
  getWorkspaceDirectoryChildren,
  getSkillsList,
} from '../../../../services/tauri';
import {
  CREATE_NEW_PROMPT_ID,
  EMPTY_STATE_ID,
} from './providers/promptProvider';
import {
  getPromptHeatLevel,
  getPromptUsageEntry,
} from '../../../prompts/promptUsage';

// Re-export the handle type for Composer to use
export type { ChatInputBoxHandle };

const STREAMING_ENABLED_STORAGE_KEY = 'ccgui.composer.streaming-enabled';
const LOCAL_SETTINGS_PROVIDER_ID = '__local_settings_json__';
const DEFAULT_CLAUDE_MODEL_ID = 'claude-sonnet-4-6';

type ClaudeProviderLike = {
  id: string;
  name: string;
  isActive?: boolean;
  isLocalProvider?: boolean;
  settingsConfig?: {
    alwaysThinkingEnabled?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
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

type AdapterEngineInfo = {
  type: EngineType;
  installed: boolean;
  version: string | null;
  availabilityState?: 'loading' | 'ready' | 'requires-login' | 'unavailable';
  availabilityLabelKey?: string | null;
};

function readStoredStreamingEnabled(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return true;
  }
  const value = window.localStorage.getItem(STREAMING_ENABLED_STORAGE_KEY);
  if (value === null) {
    return true;
  }
  return value === '1' || value === 'true';
}

function findActiveClaudeProvider(providers: ClaudeProviderLike[]): ClaudeProviderLike | null {
  return providers.find((provider) => provider?.isActive) ?? null;
}

function isLocalClaudeProvider(provider: ClaudeProviderLike | null): boolean {
  if (!provider) {
    return false;
  }
  return Boolean(provider.isLocalProvider) || provider.id === LOCAL_SETTINGS_PROVIDER_ID;
}

function areStringArraysEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function areContextUsageEqual(
  left: ChatInputBoxAdapterProps['contextUsage'],
  right: ChatInputBoxAdapterProps['contextUsage'],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  return left.used === right.used && left.total === right.total;
}

function areDualContextUsageEqual(
  left: ChatInputBoxAdapterProps['dualContextUsage'],
  right: ChatInputBoxAdapterProps['dualContextUsage'],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  return (
    left.usedTokens === right.usedTokens &&
    left.contextWindow === right.contextWindow &&
    left.percent === right.percent &&
    left.hasUsage === right.hasUsage &&
    left.compactionState === right.compactionState
  );
}

function areRateLimitWindowsEqual(
  left: RateLimitSnapshot['primary'] | RateLimitSnapshot['secondary'],
  right: RateLimitSnapshot['primary'] | RateLimitSnapshot['secondary'],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  return (
    left.usedPercent === right.usedPercent &&
    left.windowDurationMins === right.windowDurationMins &&
    left.resetsAt === right.resetsAt
  );
}

function areAccountRateLimitsEqual(
  left: ChatInputBoxAdapterProps['accountRateLimits'],
  right: ChatInputBoxAdapterProps['accountRateLimits'],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  return (
    left.planType === right.planType &&
    areRateLimitWindowsEqual(left.primary, right.primary) &&
    areRateLimitWindowsEqual(left.secondary, right.secondary) &&
    left.credits?.hasCredits === right.credits?.hasCredits &&
    left.credits?.unlimited === right.credits?.unlimited &&
    left.credits?.balance === right.credits?.balance
  );
}

function areChatInputBoxAdapterPropsEqual(
  previousProps: Readonly<ChatInputBoxAdapterProps>,
  nextProps: Readonly<ChatInputBoxAdapterProps>,
): boolean {
  const propKeys = new Set<keyof ChatInputBoxAdapterProps>([
    ...(Object.keys(previousProps) as (keyof ChatInputBoxAdapterProps)[]),
    ...(Object.keys(nextProps) as (keyof ChatInputBoxAdapterProps)[]),
  ]);

  for (const propKey of propKeys) {
    if (propKey === 'contextUsage') {
      if (!areContextUsageEqual(previousProps.contextUsage, nextProps.contextUsage)) {
        return false;
      }
      continue;
    }
    if (propKey === 'dualContextUsage') {
      if (!areDualContextUsageEqual(previousProps.dualContextUsage, nextProps.dualContextUsage)) {
        return false;
      }
      continue;
    }
    if (propKey === 'accountRateLimits') {
      if (!areAccountRateLimitsEqual(previousProps.accountRateLimits, nextProps.accountRateLimits)) {
        return false;
      }
      continue;
    }
    if (
      propKey === 'attachments' ||
      propKey === 'selectedManualMemoryIds' ||
      propKey === 'selectedNoteCardIds' ||
      propKey === 'customSkillDirectories'
    ) {
      const previousArray = previousProps[propKey];
      const nextArray = nextProps[propKey];
      if (
        !areStringArraysEqual(
          previousArray as readonly string[] | undefined,
          nextArray as readonly string[] | undefined,
        )
      ) {
        return false;
      }
      continue;
    }
    if (!Object.is(previousProps[propKey], nextProps[propKey])) {
      return false;
    }
  }

  return true;
}

export interface ChatInputBoxAdapterProps {
  // Core state
  text: string;
  disabled?: boolean;
  isProcessing: boolean;
  streamActivityPhase?: StreamActivityPhase;
  canStop: boolean;

  // Callbacks
  onSend: (submittedText?: string, submittedImages?: string[]) => void;
  onStop: () => void;
  onTextChange: (text: string, selectionStart: number | null) => void;

  // Permission mode
  permissionMode?: PermissionMode;
  onModeSelect?: (mode: PermissionMode) => void;

  // Model/Engine
  selectedModelId: string | null;
  selectedEngine?: EngineType;
  isSharedSession?: boolean;
  engines?: AdapterEngineInfo[];
  onSelectEngine?: (engine: EngineType) => void;
  models?: { id: string; displayName: string; model: string }[];
  onSelectModel?: (id: string) => void;

  // Reasoning
  reasoningOptions?: string[];
  selectedEffort?: string | null;
  onSelectEffort?: (effort: string) => void;
  reasoningSupported?: boolean;
  alwaysThinkingEnabled?: boolean;
  onToggleThinking?: (enabled: boolean) => void;
  streamingEnabled?: boolean;
  onStreamingEnabledChange?: (enabled: boolean) => void;

  // Attachments (string paths in Composer, Attachment objects in ChatInputBox)
  attachments?: string[];
  onAddAttachment?: () => void;
  onAttachImages?: (paths: string[]) => void;
  onRemoveAttachment?: (path: string) => void;

  // Height
  textareaHeight?: number;
  onHeightChange?: (height: number) => void;

  // Context usage
  contextUsage?: { used: number; total: number } | null;
  contextDualViewEnabled?: boolean;
  dualContextUsage?: DualContextUsageViewModel | null;
  onRequestContextCompaction?: () => Promise<void> | void;
  codexAutoCompactionEnabled?: boolean;
  codexAutoCompactionThresholdPercent?: number;
  onCodexAutoCompactionSettingsChange?: (patch: {
    enabled?: boolean;
    thresholdPercent?: number;
  }) => Promise<void> | void;
  accountRateLimits?: RateLimitSnapshot | null;
  usageShowRemaining?: boolean;
  onRefreshAccountRateLimits?: () => Promise<void> | void;
  selectedCollaborationModeId?: string | null;
  onSelectCollaborationMode?: (id: string | null) => void;
  onCodexQuickCommand?: (command: string) => void | Promise<void>;

  // Queue
  queuedMessages?: ComposerQueuedMessage[];
  onDeleteQueued?: (id: string) => void;
  onFuseQueued?: (id: string) => void | Promise<void>;
  canFuseQueuedMessages?: boolean;
  fusingQueuedMessageId?: string | null;

  // External keyboard handler (for Composer-level shortcuts)
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;

  // Autocomplete overlay props (rendered by Composer, positioned outside ChatInputBox)
  suggestionsOpen?: boolean;

  // Local completion data sources (from Composer)
  files?: string[];
  customSkillDirectories?: string[];
  directories?: string[];
  commands?: CustomCommandOption[];
  prompts?: CustomPromptOption[];
  workspaceId?: string | null;
  workspaceName?: string | null;
  workspacePath?: string | null;
  onManualMemorySelect?: (memory: ManualMemorySelection) => void;
  onNoteCardSelect?: (noteCard: NoteCardSelection) => void;
  onSelectSkill?: (skillName: string) => void;

  // Header/context bar
  placeholder?: string;
  sendShortcut?: 'enter' | 'cmdEnter';
  activeFile?: string;
  selectedLines?: string;
  onClearContext?: () => void;
  selectedAgent?: SelectedAgent | null;
  selectedContextChips?: ContextSelectionChip[];
  selectedManualMemoryIds?: string[];
  selectedNoteCardIds?: string[];
  onRemoveContextChip?: (chip: ContextSelectionChip) => void;
  onAgentSelect?: (agent: SelectedAgent | null) => void;
  onOpenAgentSettings?: () => void;
  onOpenPromptSettings?: () => void;
  onOpenModelSettings?: (providerId?: string) => void;
  onRefreshModelConfig?: (providerId?: string) => Promise<void> | void;
  isModelConfigRefreshing?: boolean;
  hasMessages?: boolean;
  onRewind?: () => void;
  showRewindEntry?: boolean;
  statusPanelExpanded?: boolean;
  showStatusPanelToggle?: boolean;
  onToggleStatusPanel?: () => void;
  completionEmailSelected?: boolean;
  completionEmailDisabled?: boolean;
  onToggleCompletionEmail?: () => void;
}

/**
 * Adapts Composer's image path strings to ChatInputBox Attachment objects
 */
function pathsToAttachments(paths?: string[]): Attachment[] | undefined {
  if (!paths || paths.length === 0) return undefined;
  return paths.map((path, index) => ({
    id: `img-${index}-${path}`,
    fileName: extractFileName(path),
    mediaType: guessMediaType(path),
    data: path, // Store path as data since Tauri will handle file reading
  }));
}

function extractFileName(path: string): string {
  const sanitizedPath = path.split(/[?#]/, 1)[0] ?? path;
  const normalizedPath = sanitizedPath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || path;
}

function guessMediaType(path: string): string {
  const ext = extractFileName(path).split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return map[ext] || 'image/png';
}

function isHostAbsolutePath(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

function decodePercentEncoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fileUriToHostPath(value: string): string | null {
  if (!value.toLowerCase().startsWith('file://')) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') {
      return null;
    }
    const host = parsed.host;
    const isLocalHost = !host || parsed.hostname.toLowerCase() === 'localhost';
    let pathPart = decodePercentEncoded(parsed.pathname || '');
    if (!pathPart) {
      return null;
    }
    // Windows file URI may look like "/C:/Users/demo/image.png"
    if (/^\/[A-Za-z]:\//.test(pathPart)) {
      pathPart = pathPart.slice(1);
    }
    if (isLocalHost) {
      return pathPart;
    }
    // Preserve UNC-like host paths for Windows network shares.
    return `//${host}${pathPart}`;
  } catch {
    // Keep a conservative fallback for malformed URIs.
    let pathPart = value.slice('file://'.length);
    if (
      pathPart.startsWith('localhost/') ||
      pathPart.startsWith('LOCALHOST/')
    ) {
      pathPart = `/${pathPart.slice('localhost/'.length)}`;
    }
    pathPart = decodePercentEncoded(pathPart);
    if (/^\/[A-Za-z]:\//.test(pathPart)) {
      pathPart = pathPart.slice(1);
    }
    return pathPart || null;
  }
}

function attachmentToClaudeImageInput(attachment: Attachment): string | null {
  if (!attachment.mediaType.startsWith('image/')) {
    return null;
  }
  const payload = attachment.data.trim();
  if (!payload) {
    return null;
  }
  if (payload.startsWith('data:')) {
    return payload;
  }
  if (payload.toLowerCase().startsWith('file://')) {
    return payload;
  }
  if (
    payload.startsWith('http://') ||
    payload.startsWith('https://') ||
    isHostAbsolutePath(payload)
  ) {
    return payload;
  }
  return `data:${attachment.mediaType};base64,${payload}`;
}

function attachmentToGeminiImageInput(attachment: Attachment): string | null {
  if (!attachment.mediaType.startsWith('image/')) {
    return null;
  }
  const payload = attachment.data.trim();
  if (!payload) {
    return null;
  }
  if (payload.toLowerCase().startsWith('file://')) {
    return fileUriToHostPath(payload) ?? payload;
  }
  if (payload.startsWith('data:')) {
    const commaIndex = payload.indexOf(',');
    if (commaIndex > -1) {
      const dataSegment = payload.slice(commaIndex + 1).trim();
      if (dataSegment.toLowerCase().startsWith('file://')) {
        return fileUriToHostPath(dataSegment) ?? dataSegment;
      }
    }
    return payload;
  }
  if (
    payload.startsWith('http://') ||
    payload.startsWith('https://') ||
    isHostAbsolutePath(payload)
  ) {
    return payload;
  }
  return `data:${attachment.mediaType};base64,${payload}`;
}

function attachmentsToImageInputs(
  attachments: Attachment[] | undefined,
  provider: 'claude' | 'codex' | 'gemini' | 'opencode' = 'claude',
): string[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }
  const mapper = provider === 'gemini'
    ? attachmentToGeminiImageInput
    : attachmentToClaudeImageInput;
  const mapped = attachments
    .map(mapper)
    .filter((entry): entry is string => Boolean(entry));
  if (mapped.length === 0) {
    return undefined;
  }
  return Array.from(new Set(mapped));
}

/**
 * Maps Composer engine types to ChatInputBox provider IDs
 */
type ChatInputProvider = 'claude' | 'codex' | 'gemini' | 'opencode';

function engineToProvider(engine?: EngineType): ChatInputProvider {
  switch (engine) {
    case 'codex':
      return 'codex';
    case 'opencode':
      return 'opencode';
    case 'gemini':
      return 'gemini';
    case 'claude':
    default:
      return 'claude';
  }
}

function providerToEngine(providerId: string): EngineType {
  switch (providerId) {
    case 'codex':
      return 'codex';
    case 'opencode':
      return 'opencode';
    case 'gemini':
      return 'gemini';
    case 'claude':
    default:
      return 'claude';
  }
}

/**
 * Maps Composer effort string to ChatInputBox ReasoningEffort type
 */
function effortToReasoning(effort?: string | null): ReasoningEffort {
  switch (effort) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return 'xhigh';
    default:
      return 'medium';
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
}

function fileNameFromPath(path: string): string {
  const normalized = normalizePath(path);
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 0 ? (segments[segments.length - 1] ?? path) : path;
}

function extensionFromFileName(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0 || idx >= fileName.length - 1) {
    return '';
  }
  return fileName.slice(idx + 1).toLowerCase();
}

type SkillPayloadRecord = Record<string, unknown>;
type RawSkillEntry = SkillPayloadRecord & {
  name?: unknown;
  skillName?: unknown;
  enabled?: unknown;
  source?: unknown;
  description?: unknown;
  shortDescription?: unknown;
  interface?: unknown;
  path?: unknown;
};

function asSkillPayloadRecord(value: unknown): SkillPayloadRecord | null {
  return typeof value === 'object' && value !== null
    ? (value as SkillPayloadRecord)
    : null;
}

function asRawSkillEntries(value: unknown): RawSkillEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = asSkillPayloadRecord(entry);
    return record ? [record as RawSkillEntry] : [];
  });
}

function flattenSkillBuckets(buckets: unknown): RawSkillEntry[] {
  if (!Array.isArray(buckets)) {
    return [];
  }
  return buckets.flatMap((bucket) => {
    const record = asSkillPayloadRecord(bucket);
    return asRawSkillEntries(record?.skills);
  });
}

function extractRawSkills(response: unknown): RawSkillEntry[] {
  if (Array.isArray(response)) {
    return asRawSkillEntries(response);
  }
  const payload = asSkillPayloadRecord(response);
  if (!payload) {
    return [];
  }
  const rawResult = payload.result;
  const payloadResult = asSkillPayloadRecord(rawResult);

  if (Array.isArray(payload?.skills)) {
    return asRawSkillEntries(payload.skills);
  }
  if (Array.isArray(payloadResult?.skills)) {
    return asRawSkillEntries(payloadResult.skills);
  }

  const fromResultData = flattenSkillBuckets(payloadResult?.data);
  if (fromResultData.length > 0) {
    return fromResultData;
  }

  const fromData = flattenSkillBuckets(payload?.data);
  if (fromData.length > 0) {
    return fromData;
  }

  if (Array.isArray(rawResult)) {
    return asRawSkillEntries(rawResult);
  }

  return [];
}

const SKILL_SOURCE_PRIORITY: Record<string, number> = {
  workspace_managed: 0,
  project_claude: 1,
  project_codex: 2,
  project_agents: 3,
  global_claude: 4,
  custom: 5,
  global_claude_plugin: 6,
  global_codex: 7,
  global_agents: 8,
};

function normalizeSkillName(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/^[/$]+/, '');
}

function resolveSkillScope(source?: string): 'global' | 'project' {
  if (source && (source.startsWith('global_') || source === 'custom')) {
    return 'global';
  }
  return 'project';
}

export const ChatInputBoxAdapter = memo(forwardRef<ChatInputBoxHandle, ChatInputBoxAdapterProps>(
  (props, ref) => {
    const {
      text,
      disabled,
      isProcessing,
      streamActivityPhase = 'idle',
      onTextChange,
      onSend,
      onStop,
      permissionMode,
      onModeSelect,
      selectedModelId,
      selectedEngine,
      isSharedSession = false,
      engines,
      onSelectEngine,
      models,
      onSelectModel,
      selectedEffort,
      onSelectEffort,
      alwaysThinkingEnabled,
      onToggleThinking,
      streamingEnabled,
      onStreamingEnabledChange,
      attachments,
      onAddAttachment,
      onRemoveAttachment,
      contextUsage,
      contextDualViewEnabled = false,
      dualContextUsage,
      onRequestContextCompaction,
      codexAutoCompactionEnabled,
      codexAutoCompactionThresholdPercent,
      onCodexAutoCompactionSettingsChange,
      accountRateLimits,
      usageShowRemaining,
      onRefreshAccountRateLimits,
      selectedCollaborationModeId,
      onSelectCollaborationMode,
      onCodexQuickCommand,
      queuedMessages,
      onDeleteQueued,
      onFuseQueued,
      canFuseQueuedMessages = false,
      fusingQueuedMessageId = null,
      files,
      customSkillDirectories,
      directories,
      commands,
      prompts = [],
      workspaceId,
      workspaceName,
      workspacePath,
      onManualMemorySelect,
      onNoteCardSelect,
      onSelectSkill,
      placeholder,
      sendShortcut = 'enter',
      activeFile,
      selectedLines,
      onClearContext,
      selectedAgent,
      selectedContextChips,
      selectedManualMemoryIds,
      selectedNoteCardIds,
      onRemoveContextChip,
      onAgentSelect,
      onOpenAgentSettings,
      onOpenPromptSettings,
      onOpenModelSettings,
      onRefreshModelConfig,
      isModelConfigRefreshing,
      hasMessages,
      onRewind,
      showRewindEntry,
      statusPanelExpanded,
      showStatusPanelToggle,
      onToggleStatusPanel,
      completionEmailSelected,
      completionEmailDisabled,
      onToggleCompletionEmail,
    } = props;
    const { t } = useTranslation();
    const chatInputRef = useRef<ChatInputBoxHandle>(null);
    const [localAlwaysThinkingEnabled, setLocalAlwaysThinkingEnabled] =
      useState(false);
    const [localStreamingEnabled, setLocalStreamingEnabled] = useState(
      () => readStoredStreamingEnabled(),
    );
    const [codexSpeedMode, setCodexSpeedMode] = useState<CodexSpeedMode>('unknown');
    const isCodexEngine = selectedEngine === 'codex';
    const normalizedModels = useMemo(() => {
      if (!models || models.length === 0) {
        return undefined;
      }
      return models.map((modelOption) => ({
        id: modelOption.id,
        label: modelOption.displayName || modelOption.model || modelOption.id,
        description:
          modelOption.model &&
          modelOption.model !== modelOption.displayName
            ? modelOption.model
            : undefined,
      }));
    }, [models]);
    const resolvedSelectedModelId = useMemo(() => {
      if (selectedModelId) {
        return selectedModelId;
      }
      if (selectedEngine === 'codex') {
        return '';
      }
      if (models && models.length > 0) {
        return models[0]?.id ?? '';
      }
      return selectedEngine === 'claude' ? DEFAULT_CLAUDE_MODEL_ID : '';
    }, [models, selectedEngine, selectedModelId]);

    // Expose ChatInputBoxHandle to parent
    useImperativeHandle(ref, () => ({
      getValue: () => chatInputRef.current?.getValue() ?? '',
      setValue: (value: string) => chatInputRef.current?.setValue(value),
      focus: () => chatInputRef.current?.focus(),
      clear: () => chatInputRef.current?.clear(),
      hasContent: () => chatInputRef.current?.hasContent() ?? false,
      getFileTags: () => chatInputRef.current?.getFileTags() ?? [],
    }));

    useEffect(() => {
      if (isCodexEngine || alwaysThinkingEnabled !== undefined) {
        return;
      }
      let cancelled = false;
      const loadActiveThinkingSetting = async () => {
        try {
          const providers = (await getClaudeProviders()) as ClaudeProviderLike[];
          if (cancelled) {
            return;
          }
          const activeProvider = findActiveClaudeProvider(providers);
          const activeProviderThinking =
            activeProvider?.settingsConfig?.alwaysThinkingEnabled;
          if (typeof activeProviderThinking === 'boolean') {
            setLocalAlwaysThinkingEnabled(
              activeProviderThinking,
            );
            return;
          }
          const enabled = await getClaudeAlwaysThinkingEnabled();
          if (cancelled) {
            return;
          }
          setLocalAlwaysThinkingEnabled(enabled);
        } catch {
          if (!cancelled) {
            setLocalAlwaysThinkingEnabled(false);
          }
        }
      };
      void loadActiveThinkingSetting();
      return () => {
        cancelled = true;
      };
    }, [alwaysThinkingEnabled, isCodexEngine]);

    // Handle input from ChatInputBox -> Composer text state
    const handleInput = useCallback((content: string) => {
      startTransition(() => {
        onTextChange(content, null);
      });
    }, [onTextChange]);

    // Handle submit from ChatInputBox
    const handleSubmit = useCallback((submittedText: string, submittedAttachments?: Attachment[]) => {
      const provider = engineToProvider(selectedEngine);
      const fallbackAttachments =
        submittedAttachments ?? pathsToAttachments(attachments);
      onSend(submittedText, attachmentsToImageInputs(fallbackAttachments, provider));
    }, [attachments, onSend, selectedEngine]);

    // Handle attachment removal (convert Attachment id back to path)
    const handleRemoveAttachment = useCallback((id: string) => {
      // id format: "img-{index}-{path}"
      const path = id.replace(/^img-\d+-/, '');
      onRemoveAttachment?.(path);
    }, [onRemoveAttachment]);

    // Handle model selection (ChatInputBox sends model ID directly)
    const handleModelSelect = useCallback((modelId: string) => {
      onSelectModel?.(modelId);
    }, [onSelectModel]);

    // Handle reasoning effort change
    const handleReasoningChange = useCallback((effort: ReasoningEffort) => {
      onSelectEffort?.(effort);
    }, [onSelectEffort]);

    const handleThinkingToggle = useCallback(
      async (enabled: boolean) => {
        if (isCodexEngine) {
          return;
        }
        setLocalAlwaysThinkingEnabled(enabled);
        if (onToggleThinking) {
          onToggleThinking(enabled);
          return;
        }
        const rollbackValue = localAlwaysThinkingEnabled;
        try {
          const providers = (await getClaudeProviders()) as ClaudeProviderLike[];
          const activeProvider = findActiveClaudeProvider(providers);
          if (!activeProvider || isLocalClaudeProvider(activeProvider)) {
            await setClaudeAlwaysThinkingEnabled(enabled);
            return;
          }
          const nextProvider = {
            ...activeProvider,
            settingsConfig: {
              ...(activeProvider.settingsConfig ?? {}),
              alwaysThinkingEnabled: enabled,
            },
          };
          await updateClaudeProvider(activeProvider.id, nextProvider);
          await switchClaudeProvider(activeProvider.id);
        } catch {
          try {
            await setClaudeAlwaysThinkingEnabled(enabled);
          } catch {
            setLocalAlwaysThinkingEnabled(rollbackValue);
          }
        }
      },
      [isCodexEngine, localAlwaysThinkingEnabled, onToggleThinking],
    );

    const handleStreamingToggle = useCallback(
      (enabled: boolean) => {
        if (isCodexEngine) {
          return;
        }
        setLocalStreamingEnabled(enabled);
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(
            STREAMING_ENABLED_STORAGE_KEY,
            enabled ? '1' : '0',
          );
        }
        onStreamingEnabledChange?.(enabled);
      },
      [isCodexEngine, onStreamingEnabledChange],
    );

    const handleProviderSelect = useCallback((providerId: string) => {
      const targetEngine = providerToEngine(providerId);
      if (targetEngine === selectedEngine) {
        return;
      }
      onSelectEngine?.(targetEngine);
    }, [onSelectEngine, selectedEngine]);

    const handleCodexSpeedModeChange = useCallback(
      (mode: Exclude<CodexSpeedMode, 'unknown'>) => {
        setCodexSpeedMode(mode);
        void onCodexQuickCommand?.(mode === 'fast' ? '/fast on' : '/fast off');
      },
      [onCodexQuickCommand],
    );

    const handleCodexReviewQuickStart = useCallback(() => {
      void onCodexQuickCommand?.('/review');
    }, [onCodexQuickCommand]);

    const resolvedAlwaysThinkingEnabled = isCodexEngine
      ? true
      : alwaysThinkingEnabled !== undefined
        ? alwaysThinkingEnabled
        : localAlwaysThinkingEnabled;

    const resolvedStreamingEnabled = isCodexEngine
      ? true
      : streamingEnabled !== undefined
        ? streamingEnabled
        : localStreamingEnabled;

    // Convert context usage
    const usagePercentage = useMemo(() => {
      if (!contextUsage) return 0;
      const { used, total } = contextUsage;
      return total > 0 ? Math.round((used / total) * 100) : 0;
    }, [contextUsage]);

    // Convert queued messages (Composer uses text/createdAt, ChatInputBox uses content/queuedAt)
    const messageQueue = useMemo(() => {
      if (!queuedMessages) return undefined;
      return queuedMessages.map(q => ({
        id: q.id,
        content: q.text,
        fullContent: q.text,
        queuedAt: q.createdAt,
        isFusing: q.id === fusingQueuedMessageId,
      }));
    }, [fusingQueuedMessageId, queuedMessages]);

    const fileCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<FileItem[]> => {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const maxSuggestions = 200;
        const results: FileItem[] = [];

        const pushDirectoryFromPath = (path: string) => {
          const normalizedPath = `${normalizePath(path)}/`;
          const name = fileNameFromPath(path);
          results.push({
            name,
            path: normalizedPath,
            absolutePath: normalizedPath,
            type: 'directory',
            extension: '',
          });
        };
        const pushFileFromPath = (path: string) => {
          const normalizedPath = normalizePath(path);
          const name = fileNameFromPath(path);
          results.push({
            name,
            path: normalizedPath,
            absolutePath: normalizedPath,
            type: 'file',
            extension: extensionFromFileName(name),
          });
        };
        const pushFromResponse = (response: { files: string[]; directories: string[] }) => {
          for (const dir of response.directories) {
            pushDirectoryFromPath(dir);
            if (results.length >= maxSuggestions) return;
          }
          for (const file of response.files) {
            pushFileFromPath(file);
            if (results.length >= maxSuggestions) return;
          }
        };

        const normalizedQuery = query.trim();

        // Parse query: separate directory path from search fragment
        // e.g. "src/com" -> { dirPath: "src", fragment: "com" }
        // e.g. "src/"   -> { dirPath: "src", fragment: "" }
        // e.g. "but"    -> { dirPath: "", fragment: "but" }
        const lastSlashIndex = normalizedQuery.lastIndexOf('/');
        const dirPath = lastSlashIndex >= 0 ? normalizedQuery.slice(0, lastSlashIndex) : '';
        const fragment = lastSlashIndex >= 0 ? normalizedQuery.slice(lastSlashIndex + 1) : normalizedQuery;
        const lowerFragment = fragment.toLowerCase();

        // If we have a workspace ID and a directory path, use lazy loading
        if (workspaceId && dirPath) {
          try {
            const response = await getWorkspaceDirectoryChildren(workspaceId, dirPath);
            if (signal.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }
            if (!lowerFragment) {
              // No search term - show all direct children of the directory
              pushFromResponse(response);
            } else {
              // Filter by fragment
              for (const dir of response.directories) {
                const name = fileNameFromPath(dir);
                if (name.toLowerCase().includes(lowerFragment)) {
                  pushDirectoryFromPath(dir);
                  if (results.length >= maxSuggestions) break;
                }
              }
              for (const file of response.files) {
                const name = fileNameFromPath(file);
                if (name.toLowerCase().includes(lowerFragment)) {
                  pushFileFromPath(file);
                  if (results.length >= maxSuggestions) break;
                }
              }
            }
            return results;
          } catch (error) {
            if ((error as Error).name === 'AbortError') throw error;
            // Fallback to local filtering on error
          }
        }

        // For root-level browsing or search, use the pre-loaded file/directory arrays
        const sourceDirectories = directories ?? [];
        const sourceFiles = files ?? [];

        if (!normalizedQuery) {
          // No query: show only root-level entries (direct children of workspace root)
          for (const path of sourceDirectories) {
            if (!path.includes('/')) {
              pushDirectoryFromPath(path);
              if (results.length >= maxSuggestions) return results;
            }
          }
          for (const path of sourceFiles) {
            if (!path.includes('/')) {
              pushFileFromPath(path);
              if (results.length >= maxSuggestions) return results;
            }
          }
          return results;
        }

        // Search query without directory path: search by name across all entries
        for (const path of sourceDirectories) {
          const name = fileNameFromPath(path);
          if (name.toLowerCase().includes(lowerFragment) || normalizePath(path).toLowerCase().includes(lowerFragment)) {
            pushDirectoryFromPath(path);
            if (results.length >= maxSuggestions) return results;
          }
        }
        for (const path of sourceFiles) {
          const name = fileNameFromPath(path);
          if (name.toLowerCase().includes(lowerFragment) || normalizePath(path).toLowerCase().includes(lowerFragment)) {
            pushFileFromPath(path);
            if (results.length >= maxSuggestions) return results;
          }
        }
        return results;
      },
      [directories, files, workspaceId],
    );

    const manualMemoryCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<ManualMemorySelection[]> => {
        if (!workspaceId) {
          return [];
        }
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const response = await projectMemoryFacade.list({
          workspaceId,
          query: query.trim() || null,
          importance: null,
          kind: null,
          tag: null,
          page: 0,
          pageSize: 50,
        });
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return response.items.map((item) => ({
          id: item.id,
          title: item.title?.trim() || item.summary?.trim() || item.id,
          summary: item.summary?.trim() || '',
          detail: item.detail?.trim() || item.cleanText?.trim() || item.summary?.trim() || '',
          kind: item.kind || 'note',
          importance: item.importance || 'normal',
          updatedAt: item.updatedAt || item.createdAt || Date.now(),
          tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
        }));
      },
      [workspaceId],
    );

    const noteCardCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<NoteCardItem[]> => {
        if (!workspaceId) {
          return [];
        }
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const normalizedQuery = query.trim() || null;
        const [activeResponse, archivedResponse] = await Promise.all([
          noteCardsFacade.list({
            workspaceId,
            workspaceName,
            workspacePath,
            archived: false,
            query: normalizedQuery,
            page: 0,
            pageSize: 25,
          }),
          noteCardsFacade.list({
            workspaceId,
            workspaceName,
            workspacePath,
            archived: true,
            query: normalizedQuery,
            page: 0,
            pageSize: 25,
          }),
        ]);
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return [...activeResponse.items, ...archivedResponse.items].map((item) => ({
          id: item.id,
          title: item.title?.trim() || item.plainTextExcerpt?.trim() || item.id,
          plainTextExcerpt: item.plainTextExcerpt?.trim() || '',
          bodyMarkdown: item.bodyMarkdown?.trim() || item.plainTextExcerpt?.trim() || '',
          updatedAt: item.updatedAt || item.createdAt || Date.now(),
          archived: item.archived,
          imageCount: item.imageCount || 0,
          previewAttachments: Array.isArray(item.previewAttachments)
            ? item.previewAttachments
                .filter(
                  (attachment): attachment is NoteCardSelection["previewAttachments"][number] =>
                    typeof attachment?.id === 'string'
                    && typeof attachment?.fileName === 'string'
                    && typeof attachment?.contentType === 'string'
                    && typeof attachment?.absolutePath === 'string',
                )
                .map((attachment) => ({
                  id: attachment.id,
                  fileName: attachment.fileName,
                  contentType: attachment.contentType,
                  absolutePath: attachment.absolutePath,
                }))
            : [],
        }));
      },
      [workspaceId, workspaceName, workspacePath],
    );

    const builtinSlashCommands = useMemo<CommandItem[]>(() => {
      const commands: CommandItem[] = [
        { id: 'clear', label: '/clear', description: t('chat.commands.clear'), category: 'system' },
        { id: 'new', label: '/new', description: t('chat.commands.new'), category: 'system' },
        { id: 'status', label: '/status', description: t('chat.commands.status'), category: 'session' },
        { id: 'context', label: '/context', description: t('chat.commands.context'), category: 'session' },
        { id: 'resume', label: '/resume', description: t('chat.commands.resume'), category: 'session' },
        { id: 'review', label: '/review', description: t('chat.commands.review'), category: 'workflow' },
        { id: 'fork', label: '/fork', description: t('chat.commands.fork'), category: 'workflow' },
        { id: 'mcp', label: '/mcp', description: t('chat.commands.mcp'), category: 'tooling' },
        { id: 'export', label: '/export', description: t('chat.commands.export'), category: 'session' },
        { id: 'import', label: '/import', description: t('chat.commands.import'), category: 'session' },
        { id: 'lsp', label: '/lsp', description: t('chat.commands.lsp'), category: 'tooling' },
      ];
      if (selectedEngine === 'codex') {
        commands.push({
          id: 'fast',
          label: '/fast',
          description: t('chat.commands.fast'),
          category: 'workflow',
        });
      }
      return commands;
    }, [selectedEngine, t]);

    const completionCommands = useMemo<CommandItem[]>(() => {
      const customCommands: CommandItem[] = (commands ?? [])
        .filter((entry) => entry.name.trim().length > 0)
        .map((entry) => {
          const cleanName = entry.name.trim().replace(/^\//, '');
          return {
            id: cleanName,
            label: `/${cleanName}`,
            description: entry.description || '',
            category: 'custom',
          };
        });

      const seen = new Set<string>();
      const merged = [...builtinSlashCommands, ...customCommands].filter((entry) => {
        const key = entry.label.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      return merged;
    }, [commands, builtinSlashCommands]);

    const providerAvailability = useMemo(() => {
      if (!engines || engines.length === 0) {
        return undefined;
      }
      const engineMap = new Map(engines.map((entry) => [entry.type, entry]));
      const isEngineEnabled = (engine: EngineType) =>
        (
          engineMap.get(engine)?.availabilityState
            ? engineMap.get(engine)?.availabilityState === "ready"
            : Boolean(engineMap.get(engine)?.installed)
        ) &&
        (!isSharedSession || isSharedSessionSupportedEngine(engine));
      return {
        claude: isEngineEnabled('claude'),
        codex: isEngineEnabled('codex'),
        opencode: isEngineEnabled('opencode'),
        gemini: isEngineEnabled('gemini'),
      } as const;
    }, [engines, isSharedSession]);

    const providerStatusLabels = useMemo(() => {
      if (!engines || engines.length === 0) {
        return undefined;
      }

      const byEngine = new Map(engines.map((entry) => [entry.type, entry]));
      const resolveStatusLabel = (engineType: EngineType) => {
        const engine = byEngine.get(engineType);
        if (!engine?.availabilityLabelKey) {
          return null;
        }
        return t(engine.availabilityLabelKey);
      };

      return {
        claude: resolveStatusLabel('claude'),
        codex: resolveStatusLabel('codex'),
        opencode: resolveStatusLabel('opencode'),
        gemini: resolveStatusLabel('gemini'),
      } as const;
    }, [engines, t]);

    const providerVersions = useMemo(() => {
      if (!engines || engines.length === 0) {
        return undefined;
      }

      const engineDisplayName: Record<EngineType, string> = {
        claude: 'Claude Code',
        codex: 'Codex CLI',
        gemini: 'Gemini CLI',
        opencode: 'OpenCode',
      };

      const byEngine = new Map(engines.map((entry) => [entry.type, entry]));
      const resolveVersion = (engineType: EngineType) => {
        const engine = byEngine.get(engineType);
        if (!engine?.version) {
          return null;
        }
        return formatEngineVersionLabel({
          type: engineType,
          displayName: engineDisplayName[engineType],
          shortName: engineDisplayName[engineType],
          installed: engine.installed,
          version: engine.version,
          error: null,
        });
      };

      return {
        claude: resolveVersion('claude'),
        codex: resolveVersion('codex'),
        opencode: resolveVersion('opencode'),
        gemini: resolveVersion('gemini'),
      } as const;
    }, [engines]);

    const commandCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<CommandItem[]> => {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
          return completionCommands;
        }
        return completionCommands.filter((entry) => {
          const label = entry.label.toLowerCase();
          const id = entry.id.toLowerCase();
          const description = entry.description?.toLowerCase() ?? '';
          return (
            label.includes(normalizedQuery) ||
            id.includes(normalizedQuery) ||
            description.includes(normalizedQuery)
          );
        });
      },
      [completionCommands],
    );

    const skillCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<SkillItem[]> => {
        if (!workspaceId || signal.aborted) {
          return [];
        }

        const response = await getSkillsList(workspaceId, customSkillDirectories ?? []);
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const rawSkills = extractRawSkills(response);
        const dedupedByScopeAndName = new Map<string, SkillItem>();
        const normalizedQuery = query.trim().toLowerCase();

        for (const item of rawSkills) {
          if (!item || typeof item !== 'object' || item.enabled === false) {
            continue;
          }
          const rawName =
            typeof item.name === 'string'
              ? item.name
              : typeof item.skillName === 'string'
                ? item.skillName
                : '';
          const name = normalizeSkillName(rawName);
          if (!name) {
            continue;
          }
          const source =
            typeof item.source === 'string' && item.source.trim()
              ? item.source.trim()
              : undefined;
          const interfaceObject = asSkillPayloadRecord(item.interface);
          const description =
            typeof item.description === 'string'
              ? item.description.trim()
              : typeof item.shortDescription === 'string'
                ? item.shortDescription.trim()
                : typeof interfaceObject?.shortDescription === 'string'
                  ? interfaceObject.shortDescription.trim()
                  : undefined;
          const scope = resolveSkillScope(source);
          const skill: SkillItem = {
            name,
            path: typeof item.path === 'string' ? item.path : '',
            description: description || undefined,
            source,
            scopeLabel: scope === 'global' ? t('chat.skillScopeGlobal') : t('chat.skillScopeProject'),
          };

          const key = `${scope}:${name.toLowerCase()}`;
          const prev = dedupedByScopeAndName.get(key);
          if (!prev) {
            dedupedByScopeAndName.set(key, skill);
            continue;
          }
          const prevPriority = SKILL_SOURCE_PRIORITY[prev.source ?? ''] ?? Number.MAX_SAFE_INTEGER;
          const currentPriority = SKILL_SOURCE_PRIORITY[source ?? ''] ?? Number.MAX_SAFE_INTEGER;
          if (currentPriority < prevPriority) {
            dedupedByScopeAndName.set(key, skill);
          }
        }

        return Array.from(dedupedByScopeAndName.values())
          .filter((skill) => {
            if (!normalizedQuery) {
              return true;
            }
            const text = `${skill.name} ${skill.description ?? ''}`.toLowerCase();
            return text.includes(normalizedQuery);
          })
          .sort((a, b) => {
            const ap = SKILL_SOURCE_PRIORITY[a.source ?? ''] ?? Number.MAX_SAFE_INTEGER;
            const bp = SKILL_SOURCE_PRIORITY[b.source ?? ''] ?? Number.MAX_SAFE_INTEGER;
            if (ap !== bp) {
              return ap - bp;
            }
            return a.name.localeCompare(b.name);
          });
      },
      [customSkillDirectories, t, workspaceId],
    );

    const promptCompletionProvider = useCallback(
      async (query: string, signal: AbortSignal): Promise<PromptItem[]> => {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const normalizedQuery = query.trim().toLowerCase();
        const filteredPrompts = prompts
          .filter((prompt) => prompt.name)
          .filter((prompt) => {
            if (!normalizedQuery) {
              return true;
            }
            const scopeLabel = prompt.scope === 'global'
              ? t('settings.prompt.scopeGlobal')
              : t('settings.prompt.scopeWorkspace');
            const haystack =
              `${prompt.name} ${prompt.description ?? ''} ${prompt.content} ${prompt.argumentHint ?? ''} ${prompt.scope ?? ''} ${scopeLabel}`.toLowerCase();
            return haystack.includes(normalizedQuery);
          })
          .map((prompt) => {
            const id = prompt.path || `prompt:${prompt.scope}:${prompt.name}`;
            const usage = getPromptUsageEntry(id);
            return {
              id,
              name: prompt.name,
              content: prompt.content,
              description: prompt.description ?? undefined,
              scopeLabel: prompt.scope === 'global'
                ? t('settings.prompt.scopeGlobal')
                : t('settings.prompt.scopeWorkspace'),
              argumentHint: prompt.argumentHint ?? undefined,
              argumentHintLabel: t('settings.prompt.argumentHintLabel'),
              usageCount: usage.count,
              heatLevel: getPromptHeatLevel(usage.count),
              kind: 'prompt' as const,
              lastUsedAt: usage.lastUsedAt,
            };
          })
          .sort((left, right) => {
            if ((right.usageCount ?? 0) !== (left.usageCount ?? 0)) {
              return (right.usageCount ?? 0) - (left.usageCount ?? 0);
            }
            if ((right.lastUsedAt ?? 0) !== (left.lastUsedAt ?? 0)) {
              return (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0);
            }
            return left.name.localeCompare(right.name);
          });

        const createPromptItem: PromptItem = {
          id: CREATE_NEW_PROMPT_ID,
          name: t('settings.prompt.createPrompt'),
          content: '',
          kind: 'create',
        };

        if (filteredPrompts.length === 0) {
          return [
            {
              id: EMPTY_STATE_ID,
              name: t('settings.prompt.noPromptsDropdown'),
              content: '',
            },
            createPromptItem,
          ];
        }

        return [...filteredPrompts, createPromptItem];
      },
      [prompts, t],
    );

    return (
      <ChatInputBox
        ref={chatInputRef}
        isLoading={isProcessing}
        streamActivityPhase={streamActivityPhase}
        disabled={disabled}
        value={text}
        workspaceId={workspaceId}
        placeholder={placeholder ?? t('chat.inputPlaceholder')}
        sendShortcut={sendShortcut}
        selectedModel={resolvedSelectedModelId}
        models={normalizedModels}
        permissionMode={permissionMode}
        currentProvider={engineToProvider(selectedEngine)}
        providerAvailability={providerAvailability}
        providerVersions={providerVersions}
        providerStatusLabels={providerStatusLabels}
        providerDisabledMessages={providerStatusLabels}
        activeFile={activeFile}
        selectedLines={selectedLines}
        onClearContext={onClearContext}
        onSubmit={handleSubmit}
        onStop={onStop}
        onInput={handleInput}
        attachments={pathsToAttachments(attachments)}
        onAddAttachment={onAddAttachment ? (_files?: FileList | null) => {
          // In Tauri, we use the native file picker instead of FileList
          onAddAttachment?.();
        } : undefined}
        onRemoveAttachment={handleRemoveAttachment}
        onModeSelect={onModeSelect}
        onModelSelect={handleModelSelect}
        onProviderSelect={onSelectEngine ? handleProviderSelect : undefined}
        reasoningEffort={effortToReasoning(selectedEffort)}
        onReasoningChange={onSelectEffort ? handleReasoningChange : undefined}
        alwaysThinkingEnabled={resolvedAlwaysThinkingEnabled}
        onToggleThinking={handleThinkingToggle}
        streamingEnabled={resolvedStreamingEnabled}
        onStreamingEnabledChange={handleStreamingToggle}
        selectedAgent={selectedAgent}
        selectedContextChips={selectedContextChips}
        selectedManualMemoryIds={selectedManualMemoryIds}
        selectedNoteCardIds={selectedNoteCardIds}
        onRemoveContextChip={onRemoveContextChip}
        onAgentSelect={onAgentSelect}
        onClearAgent={onAgentSelect ? () => onAgentSelect?.(null) : undefined}
        onOpenAgentSettings={onOpenAgentSettings}
        onOpenPromptSettings={onOpenPromptSettings}
        onOpenModelSettings={onOpenModelSettings}
        onRefreshModelConfig={onRefreshModelConfig}
        isModelConfigRefreshing={isModelConfigRefreshing}
        hasMessages={hasMessages}
        onRewind={onRewind}
        showRewindEntry={showRewindEntry}
        statusPanelExpanded={statusPanelExpanded}
        showStatusPanelToggle={showStatusPanelToggle}
        onToggleStatusPanel={onToggleStatusPanel}
        completionEmailSelected={completionEmailSelected}
        completionEmailDisabled={completionEmailDisabled}
        onToggleCompletionEmail={onToggleCompletionEmail}
        usagePercentage={usagePercentage}
        usageUsedTokens={contextUsage?.used}
        usageMaxTokens={contextUsage?.total}
        showUsage={true}
        contextDualViewEnabled={contextDualViewEnabled}
        dualContextUsage={dualContextUsage}
        onRequestContextCompaction={onRequestContextCompaction}
        codexAutoCompactionEnabled={codexAutoCompactionEnabled}
        codexAutoCompactionThresholdPercent={codexAutoCompactionThresholdPercent}
        onCodexAutoCompactionSettingsChange={onCodexAutoCompactionSettingsChange}
        accountRateLimits={accountRateLimits}
        usageShowRemaining={usageShowRemaining}
        onRefreshAccountRateLimits={onRefreshAccountRateLimits}
        selectedCollaborationModeId={selectedCollaborationModeId}
        onSelectCollaborationMode={onSelectCollaborationMode}
        codexSpeedMode={codexSpeedMode}
        onCodexSpeedModeChange={handleCodexSpeedModeChange}
        onCodexReviewQuickStart={handleCodexReviewQuickStart}
        messageQueue={messageQueue}
        onRemoveFromQueue={onDeleteQueued}
        onFuseFromQueue={onFuseQueued}
        canFuseFromQueue={canFuseQueuedMessages}
        fusingQueueMessageId={fusingQueuedMessageId}
        sdkInstalled={true}
        fileCompletionProvider={fileCompletionProvider}
        commandCompletionProvider={commandCompletionProvider}
        skillCompletionProvider={skillCompletionProvider}
        promptCompletionProvider={promptCompletionProvider}
        manualMemoryCompletionProvider={manualMemoryCompletionProvider}
        noteCardCompletionProvider={noteCardCompletionProvider}
        onSelectManualMemory={onManualMemorySelect}
        onSelectNoteCard={onNoteCardSelect}
        onSelectSkill={onSelectSkill}
      />
    );
  }
), areChatInputBoxAdapterPropsEqual);

ChatInputBoxAdapter.displayName = 'ChatInputBoxAdapter';
