/**
 * ChatInputBoxAdapter - Bridge between Composer.tsx props and ChatInputBox props
 *
 * This adapter translates the Composer's prop interface to ChatInputBox's interface,
 * enabling drop-in replacement of ComposerInput while maintaining 100% visual and
 * interaction consistency with idea-claude-code-gui's input box.
 */
import {
  forwardRef,
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
  FileItem,
  CommandItem,
  SkillItem,
} from './types';
import type { QueuedMessage as ComposerQueuedMessage } from '../../../../types';
import type { CustomCommandOption } from '../../../../types';
import type { EngineType } from '../../../../types';
import type { RateLimitSnapshot } from '../../../../types';
import { formatEngineVersionLabel } from '../../../engine/utils/engineLabels';
import { projectMemoryFacade } from '../../../project-memory/services/projectMemoryFacade';
import {
  getClaudeProviders,
  getClaudeAlwaysThinkingEnabled,
  setClaudeAlwaysThinkingEnabled,
  switchClaudeProvider,
  updateClaudeProvider,
  getWorkspaceDirectoryChildren,
  getSkillsList,
} from '../../../../services/tauri';

// Re-export the handle type for Composer to use
export type { ChatInputBoxHandle };

const STREAMING_ENABLED_STORAGE_KEY = 'mossx.composer.streaming-enabled';
const MESSAGE_QUEUE_PREVIEW_LIMIT = 120;

type ClaudeProviderLike = {
  id: string;
  name: string;
  isActive?: boolean;
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

function buildQueuePreviewText(content: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  if (normalizedContent.length <= MESSAGE_QUEUE_PREVIEW_LIMIT) {
    return normalizedContent;
  }
  return `${normalizedContent.slice(0, MESSAGE_QUEUE_PREVIEW_LIMIT - 1)}…`;
}

export interface ChatInputBoxAdapterProps {
  // Core state
  text: string;
  disabled?: boolean;
  isProcessing: boolean;
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
  engines?: { type: EngineType; installed: boolean; version: string | null }[];
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
  accountRateLimits?: RateLimitSnapshot | null;
  usageShowRemaining?: boolean;
  onRefreshAccountRateLimits?: () => Promise<void> | void;
  selectedCollaborationModeId?: string | null;
  onSelectCollaborationMode?: (id: string | null) => void;
  onCodexQuickCommand?: (command: string) => void | Promise<void>;

  // Queue
  queuedMessages?: ComposerQueuedMessage[];
  onDeleteQueued?: (id: string) => void;

  // External keyboard handler (for Composer-level shortcuts)
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;

  // Autocomplete overlay props (rendered by Composer, positioned outside ChatInputBox)
  suggestionsOpen?: boolean;

  // Local completion data sources (from Composer)
  files?: string[];
  directories?: string[];
  commands?: CustomCommandOption[];
  workspaceId?: string | null;
  onManualMemorySelect?: (memory: ManualMemorySelection) => void;
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
  onRemoveContextChip?: (chip: ContextSelectionChip) => void;
  onAgentSelect?: (agent: SelectedAgent | null) => void;
  onOpenAgentSettings?: () => void;
  onOpenModelSettings?: (providerId?: string) => void;
  hasMessages?: boolean;
  onRewind?: () => void;
  showRewindEntry?: boolean;
  statusPanelExpanded?: boolean;
  showStatusPanelToggle?: boolean;
  onToggleStatusPanel?: () => void;
}

/**
 * Adapts Composer's image path strings to ChatInputBox Attachment objects
 */
function pathsToAttachments(paths?: string[]): Attachment[] | undefined {
  if (!paths || paths.length === 0) return undefined;
  return paths.map((path, index) => ({
    id: `img-${index}-${path}`,
    fileName: path.split('/').pop() || path,
    mediaType: guessMediaType(path),
    data: path, // Store path as data since Tauri will handle file reading
  }));
}

function guessMediaType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
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

function attachmentToImageInput(attachment: Attachment): string | null {
  if (!attachment.mediaType.startsWith('image/')) {
    return null;
  }
  const payload = attachment.data.trim();
  if (!payload) {
    return null;
  }
  if (
    payload.startsWith('data:') ||
    payload.startsWith('http://') ||
    payload.startsWith('https://') ||
    isHostAbsolutePath(payload)
  ) {
    return payload;
  }
  return `data:${attachment.mediaType};base64,${payload}`;
}

function attachmentsToImageInputs(attachments?: Attachment[]): string[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }
  const mapped = attachments
    .map(attachmentToImageInput)
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
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

function extensionFromFileName(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0 || idx >= fileName.length - 1) {
    return '';
  }
  return fileName.slice(idx + 1).toLowerCase();
}

function flattenSkillBuckets(buckets: unknown) {
  if (!Array.isArray(buckets)) {
    return [] as any[];
  }
  return buckets.flatMap((bucket: any) =>
    Array.isArray(bucket?.skills) ? bucket.skills : [],
  );
}

function extractRawSkills(response: unknown) {
  const payload = response as any;

  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.skills)) {
    return payload.skills;
  }
  if (Array.isArray(payload?.result?.skills)) {
    return payload.result.skills;
  }

  const fromResultData = flattenSkillBuckets(payload?.result?.data);
  if (fromResultData.length > 0) {
    return fromResultData;
  }

  const fromData = flattenSkillBuckets(payload?.data);
  if (fromData.length > 0) {
    return fromData;
  }

  if (Array.isArray(payload?.result)) {
    return payload.result;
  }

  return [] as any[];
}

const SKILL_SOURCE_PRIORITY: Record<string, number> = {
  workspace_managed: 0,
  project_claude: 1,
  project_codex: 2,
  project_agents: 3,
  global_claude: 4,
  global_codex: 5,
  global_agents: 6,
};

function normalizeSkillName(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/^[/$]+/, '');
}

function resolveSkillScope(source?: string): 'global' | 'project' {
  if (source && source.startsWith('global_')) {
    return 'global';
  }
  return 'project';
}

export const ChatInputBoxAdapter = forwardRef<ChatInputBoxHandle, ChatInputBoxAdapterProps>(
  (props, ref) => {
    const {
      text,
      disabled,
      isProcessing,
      onTextChange,
      onSend,
      onStop,
      permissionMode,
      onModeSelect,
      selectedModelId,
      selectedEngine,
      engines,
      onSelectEngine,
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
      accountRateLimits,
      usageShowRemaining,
      onRefreshAccountRateLimits,
      selectedCollaborationModeId,
      onSelectCollaborationMode,
      onCodexQuickCommand,
      queuedMessages,
      onDeleteQueued,
      files,
      directories,
      commands,
      workspaceId,
      onManualMemorySelect,
      onSelectSkill,
      placeholder,
      sendShortcut = 'enter',
      activeFile,
      selectedLines,
      onClearContext,
      selectedAgent,
      selectedContextChips,
      selectedManualMemoryIds,
      onRemoveContextChip,
      onAgentSelect,
      onOpenAgentSettings,
      onOpenModelSettings,
      hasMessages,
      onRewind,
      showRewindEntry,
      statusPanelExpanded,
      showStatusPanelToggle,
      onToggleStatusPanel,
    } = props;
    const { t } = useTranslation();
    const chatInputRef = useRef<ChatInputBoxHandle>(null);
    const [localAlwaysThinkingEnabled, setLocalAlwaysThinkingEnabled] =
      useState(false);
    const [localStreamingEnabled, setLocalStreamingEnabled] = useState(
      () => readStoredStreamingEnabled(),
    );
    const [codexSpeedMode, setCodexSpeedMode] = useState<CodexSpeedMode>('unknown');

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
      if (alwaysThinkingEnabled !== undefined) {
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
          if (activeProvider) {
            setLocalAlwaysThinkingEnabled(
              Boolean(activeProvider.settingsConfig?.alwaysThinkingEnabled),
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
    }, [alwaysThinkingEnabled]);

    // Handle input from ChatInputBox -> Composer text state
    const handleInput = useCallback((content: string) => {
      onTextChange(content, null);
    }, [onTextChange]);

    // Handle submit from ChatInputBox
    const handleSubmit = useCallback((submittedText: string, submittedAttachments?: Attachment[]) => {
      onSend(submittedText, attachmentsToImageInputs(submittedAttachments));
    }, [onSend]);

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
        setLocalAlwaysThinkingEnabled(enabled);
        if (onToggleThinking) {
          onToggleThinking(enabled);
          return;
        }
        const rollbackValue = localAlwaysThinkingEnabled;
        try {
          const providers = (await getClaudeProviders()) as ClaudeProviderLike[];
          const activeProvider = findActiveClaudeProvider(providers);
          if (!activeProvider) {
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
      [localAlwaysThinkingEnabled, onToggleThinking],
    );

    const handleStreamingToggle = useCallback(
      (enabled: boolean) => {
        setLocalStreamingEnabled(enabled);
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(
            STREAMING_ENABLED_STORAGE_KEY,
            enabled ? '1' : '0',
          );
        }
        onStreamingEnabledChange?.(enabled);
      },
      [onStreamingEnabledChange],
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
        content: buildQueuePreviewText(q.text),
        fullContent: q.text,
        queuedAt: q.createdAt,
      }));
    }, [queuedMessages]);

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

    const builtinSlashCommands = useMemo<CommandItem[]>(() => {
      const commands: CommandItem[] = [
        { id: 'clear', label: '/clear', description: t('chat.commands.clear'), category: 'system' },
        { id: 'new', label: '/new', description: t('chat.commands.new'), category: 'system' },
        { id: 'status', label: '/status', description: t('chat.commands.status'), category: 'session' },
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
      const installedEngines = new Set(
        (engines ?? [])
          .filter((entry) => entry.installed)
          .map((entry) => String(entry.type)),
      );
      return {
        claude: installedEngines.has('claude'),
        codex: installedEngines.has('codex'),
        opencode: installedEngines.has('opencode'),
        gemini: installedEngines.has('gemini'),
      } as const;
    }, [engines]);

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

        const response = await getSkillsList(workspaceId);
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
          const name = normalizeSkillName(item.name ?? item.skillName);
          if (!name) {
            continue;
          }
          const source = item.source ? String(item.source).trim() : undefined;
          const description = item.description ?? item.shortDescription ?? item.interface?.shortDescription;
          const scope = resolveSkillScope(source);
          const skill: SkillItem = {
            name,
            path: String(item.path ?? ''),
            description: typeof description === 'string' ? description.trim() : undefined,
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
      [workspaceId],
    );

    return (
      <ChatInputBox
        ref={chatInputRef}
        isLoading={isProcessing}
        disabled={disabled}
        value={text}
        placeholder={placeholder ?? t('chat.inputPlaceholder')}
        sendShortcut={sendShortcut}
        selectedModel={selectedModelId ?? 'claude-sonnet-4-6'}
        permissionMode={permissionMode}
        currentProvider={engineToProvider(selectedEngine)}
        providerAvailability={providerAvailability}
        providerVersions={providerVersions}
        activeFile={activeFile}
        selectedLines={selectedLines}
        onClearContext={onClearContext}
        onSubmit={handleSubmit}
        onStop={onStop}
        onInput={handleInput}
        attachments={pathsToAttachments(attachments)}
        onAddAttachment={onAddAttachment ? (_files: FileList) => {
          // In Tauri, we use the native file picker instead of FileList
          onAddAttachment?.();
        } : undefined}
        onRemoveAttachment={handleRemoveAttachment}
        onModeSelect={onModeSelect}
        onModelSelect={handleModelSelect}
        onProviderSelect={onSelectEngine ? handleProviderSelect : undefined}
        reasoningEffort={effortToReasoning(selectedEffort)}
        onReasoningChange={onSelectEffort ? handleReasoningChange : undefined}
        alwaysThinkingEnabled={
          alwaysThinkingEnabled !== undefined
            ? alwaysThinkingEnabled
            : localAlwaysThinkingEnabled
        }
        onToggleThinking={handleThinkingToggle}
        streamingEnabled={
          streamingEnabled !== undefined ? streamingEnabled : localStreamingEnabled
        }
        onStreamingEnabledChange={handleStreamingToggle}
        selectedAgent={selectedAgent}
        selectedContextChips={selectedContextChips}
        selectedManualMemoryIds={selectedManualMemoryIds}
        onRemoveContextChip={onRemoveContextChip}
        onAgentSelect={onAgentSelect}
        onClearAgent={onAgentSelect ? () => onAgentSelect?.(null) : undefined}
        onOpenAgentSettings={onOpenAgentSettings}
        onOpenModelSettings={onOpenModelSettings}
        hasMessages={hasMessages}
        onRewind={onRewind}
        showRewindEntry={showRewindEntry}
        statusPanelExpanded={statusPanelExpanded}
        showStatusPanelToggle={showStatusPanelToggle}
        onToggleStatusPanel={onToggleStatusPanel}
        usagePercentage={usagePercentage}
        usageUsedTokens={contextUsage?.used}
        usageMaxTokens={contextUsage?.total}
        showUsage={true}
        contextDualViewEnabled={contextDualViewEnabled}
        dualContextUsage={dualContextUsage}
        onRequestContextCompaction={onRequestContextCompaction}
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
        sdkInstalled={true}
        fileCompletionProvider={fileCompletionProvider}
        commandCompletionProvider={commandCompletionProvider}
        skillCompletionProvider={skillCompletionProvider}
        manualMemoryCompletionProvider={manualMemoryCompletionProvider}
        onSelectManualMemory={onManualMemorySelect}
        onSelectSkill={onSelectSkill}
      />
    );
  }
);

ChatInputBoxAdapter.displayName = 'ChatInputBoxAdapter';
