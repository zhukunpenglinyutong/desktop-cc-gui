import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { TFunction } from 'i18next';
import Circle from 'lucide-react/dist/esm/icons/circle';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Layers3 from 'lucide-react/dist/esm/icons/layers-3';
import Clock3 from 'lucide-react/dist/esm/icons/clock-3';
import Tag from 'lucide-react/dist/esm/icons/tag';
import type { EngineType } from '../../../../types';
import type {
  AccountRateLimitsInfo,
  DropdownItemData,
  DropdownPosition,
  ModelInfo,
  PermissionMode,
  ProviderId,
  ReasoningEffort,
  SelectedAgent,
  ShortcutAction,
  StreamActivityPhase,
  TriggerQuery,
} from './types.js';
import type { TooltipState } from './hooks/useTooltip.js';
import { ButtonArea } from './ButtonArea.js';
import { CompletionDropdown, Dropdown } from './Dropdown/index.js';
import { PromptEnhancerDialog } from './PromptEnhancerDialog.js';
import { LocalImage } from '../../../../components/common/LocalImage';
import { Markdown } from '../../../messages/components/Markdown';

interface CompletionController {
  isOpen: boolean;
  position: DropdownPosition | null;
  items: DropdownItemData[];
  activeIndex: number;
  loading: boolean;
  triggerQuery?: TriggerQuery | null;
  close: () => void;
  selectIndex: (index: number) => void;
  handleMouseEnter: (index: number) => void;
}

type MemoryDropdownData = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  kind: string;
  importance: string;
  updatedAt: number;
  tags: string[];
};

type NoteCardDropdownData = {
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

type MemoryPreviewSection = {
  label: string;
  content: string;
};

const MEMORY_DETAIL_SECTION_REGEX =
  /(用户输入|助手输出摘要|助手输出|User input|Assistant summary|Assistant output)[:：]/gi;
const MEMORY_USER_INPUT_REGEX =
  /(?:^|\n)\s*用户输入[:：]\s*([\s\S]*?)(?=\n+\s*(?:助手输出摘要|助手输出)[:：]|$)/;

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function asPreviewAttachments(value: unknown): NoteCardDropdownData["previewAttachments"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (attachment): attachment is NoteCardDropdownData["previewAttachments"][number] =>
        typeof attachment === 'object'
        && attachment !== null
        && typeof (attachment as { id?: unknown }).id === 'string'
        && typeof (attachment as { fileName?: unknown }).fileName === 'string'
        && typeof (attachment as { contentType?: unknown }).contentType === 'string'
        && typeof (attachment as { absolutePath?: unknown }).absolutePath === 'string',
    )
    .map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      absolutePath: attachment.absolutePath,
    }));
}

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

function resolveLocalPreviewSrc(path: string) {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return '';
  }
  try {
    return convertFileSrc(normalizedPath);
  } catch {
    return normalizedPath;
  }
}

function normalizeMemoryImportance(value?: string) {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) {
    return 'normal';
  }
  if (normalized.includes('high')) {
    return 'high';
  }
  if (normalized.includes('low')) {
    return 'low';
  }
  return normalized.includes('medium') ? 'medium' : 'normal';
}

function parseMemoryPreviewSections(text: string): MemoryPreviewSection[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  const matches = Array.from(
    normalized.matchAll(
      new RegExp(MEMORY_DETAIL_SECTION_REGEX.source, MEMORY_DETAIL_SECTION_REGEX.flags),
    ),
  );
  if (matches.length === 0) {
    return [];
  }
  const sections: MemoryPreviewSection[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    if (!current || current.index === undefined) {
      continue;
    }
    const label = (current[1] || '').trim();
    const start = current.index + current[0].length;
    const next = matches[index + 1];
    const end = next?.index ?? normalized.length;
    const content = normalized.slice(start, end).trim();
    if (!content) {
      continue;
    }
    sections.push({ label, content });
  }
  return sections;
}

function getMemoryUserInputText(detail: string) {
  const normalized = detail.trim();
  if (!normalized) {
    return '';
  }
  const matched = normalized.match(MEMORY_USER_INPUT_REGEX);
  if (!matched || !matched[1]) {
    return '';
  }
  return matched[1].replace(/\s+/g, ' ').trim();
}

function toMemoryDropdownData(item: DropdownItemData): MemoryDropdownData | null {
  const record = (item.data ?? {}) as Record<string, unknown>;
  const memoryId = asString(record.id) || item.id.replace(/^memory:/, '');
  if (!memoryId) {
    return null;
  }
  const summary = asString(record.summary);
  const detail = asString(record.detail);
  return {
    id: memoryId,
    title: asString(record.title) || item.label,
    summary,
    detail,
    kind: asString(record.kind) || 'note',
    importance: asString(record.importance) || 'normal',
    updatedAt: asNumber(record.updatedAt) ?? Date.now(),
    tags: asStringArray(record.tags),
  };
}

function toNoteCardDropdownData(item: DropdownItemData): NoteCardDropdownData | null {
  const record = (item.data ?? {}) as Record<string, unknown>;
  const noteCardId = asString(record.id) || item.id.replace(/^note-card:/, '');
  if (!noteCardId) {
    return null;
  }
  return {
    id: noteCardId,
    title: asString(record.title) || item.label,
    plainTextExcerpt: asString(record.plainTextExcerpt),
    bodyMarkdown: asString(record.bodyMarkdown),
    updatedAt: asNumber(record.updatedAt) ?? Date.now(),
    archived: asBoolean(record.archived),
    imageCount: asNumber(record.imageCount) ?? 0,
    previewAttachments: asPreviewAttachments(record.previewAttachments),
  };
}

export function ChatInputBoxFooter({
  disabled,
  hasInputContent,
  isLoading,
  streamActivityPhase = 'idle',
  isEnhancing,
  selectedModel,
  models,
  permissionMode,
  currentProvider,
  workspaceId = null,
  providerAvailability,
  providerVersions,
  providerStatusLabels,
  providerDisabledMessages,
  reasoningEffort,
  accountRateLimits,
  usageShowRemaining,
  onRefreshAccountRateLimits,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  codexSpeedMode = 'unknown',
  onCodexSpeedModeChange,
  onCodexReviewQuickStart,
  onSubmit,
  onStop,
  onModeSelect,
  onModelSelect,
  onProviderSelect,
  onReasoningChange,
  onEnhancePrompt,
  alwaysThinkingEnabled,
  onToggleThinking,
  streamingEnabled,
  onStreamingEnabledChange,
  sendShortcut,
  selectedAgent,
  onAgentSelect,
  onOpenAgentSettings,
  onAddModel,
  onRefreshModelConfig,
  isModelConfigRefreshing,
  onClearAgent,
  fileCompletion,
  memoryCompletion,
  noteCardCompletion,
  commandCompletion,
  skillCompletion,
  agentCompletion,
  promptCompletion,
  selectedManualMemoryIds = [],
  selectedNoteCardIds = [],
  shortcutActions,
  tooltip,
  promptEnhancer,
  t,
}: {
  disabled: boolean;
  hasInputContent: boolean;
  isLoading: boolean;
  streamActivityPhase?: StreamActivityPhase;
  isEnhancing: boolean;
  selectedModel: string;
  models?: ModelInfo[];
  permissionMode: PermissionMode;
  currentProvider: string;
  workspaceId?: string | null;
  providerAvailability?: Partial<Record<ProviderId, boolean>>;
  providerVersions?: Partial<Record<ProviderId, string | null>>;
  providerStatusLabels?: Partial<Record<ProviderId, string | null>>;
  providerDisabledMessages?: Partial<Record<ProviderId, string | null>>;
  reasoningEffort: ReasoningEffort;
  accountRateLimits?: AccountRateLimitsInfo | null;
  usageShowRemaining?: boolean;
  onRefreshAccountRateLimits?: () => Promise<void> | void;
  selectedCollaborationModeId?: string | null;
  onSelectCollaborationMode?: (id: string | null) => void;
  codexSpeedMode?: 'standard' | 'fast' | 'unknown';
  onCodexSpeedModeChange?: (mode: 'standard' | 'fast') => void;
  onCodexReviewQuickStart?: () => void;
  onSubmit: () => void;
  onStop?: () => void;
  onModeSelect?: (mode: PermissionMode) => void;
  onModelSelect?: (modelId: string) => void;
  onProviderSelect?: (providerId: string) => void;
  onReasoningChange?: (effort: ReasoningEffort) => void;
  onEnhancePrompt: () => void;
  alwaysThinkingEnabled?: boolean;
  onToggleThinking?: (enabled: boolean) => void;
  streamingEnabled?: boolean;
  onStreamingEnabledChange?: (enabled: boolean) => void;
  sendShortcut: 'enter' | 'cmdEnter';
  selectedAgent?: SelectedAgent | null;
  onAgentSelect?: (agent: SelectedAgent) => void;
  onOpenAgentSettings?: () => void;
  onAddModel?: (providerId?: string) => void;
  onRefreshModelConfig?: (providerId?: string) => Promise<void> | void;
  isModelConfigRefreshing?: boolean;
  onClearAgent: () => void;
  fileCompletion: CompletionController;
  memoryCompletion: CompletionController;
  noteCardCompletion: CompletionController;
  commandCompletion: CompletionController;
  skillCompletion: CompletionController;
  agentCompletion: CompletionController;
  promptCompletion: CompletionController;
  selectedManualMemoryIds?: string[];
  selectedNoteCardIds?: string[];
  shortcutActions?: ShortcutAction[];
  tooltip: TooltipState | null;
  promptEnhancer: {
    isOpen: boolean;
    isLoading: boolean;
    loadingEngine: EngineType;
    originalPrompt: string;
    enhancedPrompt: string;
    canUseEnhanced: boolean;
    onUseEnhanced: () => void;
    onKeepOriginal: () => void;
    onClose: () => void;
  };
  t: TFunction;
}) {
  const footerHostRef = useRef<HTMLDivElement>(null);
  const [expandedPreviewMemoryId, setExpandedPreviewMemoryId] = useState<string | null>(null);
  const [expandedPreviewNoteCardId, setExpandedPreviewNoteCardId] = useState<string | null>(null);
  const [promptDropdownWidth, setPromptDropdownWidth] = useState(820);
  const selectedManualMemoryIdSet = useMemo(
    () => new Set(selectedManualMemoryIds),
    [selectedManualMemoryIds],
  );
  const selectedNoteCardIdSet = useMemo(
    () => new Set(selectedNoteCardIds),
    [selectedNoteCardIds],
  );

  const memoryEntries = useMemo(
    () =>
      memoryCompletion.items.map((item, index) => ({
        item,
        index,
        memory: toMemoryDropdownData(item),
      })),
    [memoryCompletion.items],
  );
  const activeMemoryEntry =
    memoryEntries[memoryCompletion.activeIndex] ?? memoryEntries[0] ?? null;
  const activeMemory = activeMemoryEntry?.memory ?? null;
  const manualMemoryQueryText = (memoryCompletion.triggerQuery?.query ?? '').trim();
  const manualMemoryPickerHeading = useMemo(() => {
    if (!manualMemoryQueryText) {
      return t('composer.manualMemoryPickerTitle');
    }
    const query = `@@${manualMemoryQueryText}`;
    const translated = t('composer.manualMemoryPickerInputTitle', { query });
    return translated === 'composer.manualMemoryPickerInputTitle'
      ? `用户输入：${query}`
      : translated;
  }, [manualMemoryQueryText, t]);

  const activeMemoryPreview = (activeMemory?.detail || activeMemory?.summary || '').trim();
  const activeMemoryPreviewSections = useMemo(
    () => parseMemoryPreviewSections(activeMemoryPreview),
    [activeMemoryPreview],
  );
  const activeMemoryPreviewLong = activeMemoryPreview.length > 220;
  const activeMemoryId = activeMemory?.id ?? null;
  const activeMemoryPreviewExpanded =
    Boolean(activeMemoryId) && expandedPreviewMemoryId === activeMemoryId;

  const noteCardEntries = useMemo(
    () =>
      noteCardCompletion.items.map((item, index) => ({
        item,
        index,
        noteCard: toNoteCardDropdownData(item),
      })),
    [noteCardCompletion.items],
  );
  const activeNoteCardEntry =
    noteCardEntries[noteCardCompletion.activeIndex] ?? noteCardEntries[0] ?? null;
  const activeNoteCard = activeNoteCardEntry?.noteCard ?? null;
  const noteCardQueryText = (noteCardCompletion.triggerQuery?.query ?? '').trim();
  const noteCardPickerHeading = useMemo(() => {
    if (!noteCardQueryText) {
      return t('composer.noteCardPickerTitle');
    }
    const query = `@#${noteCardQueryText}`;
    const translated = t('composer.noteCardPickerInputTitle', { query });
    return translated === 'composer.noteCardPickerInputTitle'
      ? `便签：${query}`
      : translated;
  }, [noteCardQueryText, t]);
  const activeNoteCardPreview = (
    activeNoteCard?.bodyMarkdown ||
    activeNoteCard?.plainTextExcerpt ||
    ''
  ).trim();
  const activeNoteCardPreviewLong = activeNoteCardPreview.length > 220;
  const activeNoteCardId = activeNoteCard?.id ?? null;
  const activeNoteCardPreviewExpanded =
    Boolean(activeNoteCardId) && expandedPreviewNoteCardId === activeNoteCardId;
  const activeNoteCardPreviewAttachments = activeNoteCard?.previewAttachments ?? [];

  useEffect(() => {
    if (!memoryCompletion.isOpen || !activeMemoryId) {
      setExpandedPreviewMemoryId(null);
      return;
    }
    setExpandedPreviewMemoryId((prev) => (prev === activeMemoryId ? prev : null));
  }, [activeMemoryId, memoryCompletion.isOpen]);

  useEffect(() => {
    if (!noteCardCompletion.isOpen || !activeNoteCardId) {
      setExpandedPreviewNoteCardId(null);
      return;
    }
    setExpandedPreviewNoteCardId((prev) => (prev === activeNoteCardId ? prev : null));
  }, [activeNoteCardId, noteCardCompletion.isOpen]);

  useLayoutEffect(() => {
    const footerHost = footerHostRef.current;
    if (!footerHost || typeof window === 'undefined') {
      return;
    }

    const homeComposerHost = footerHost.closest('.home-chat-composer-host') as HTMLElement | null;
    if (!homeComposerHost) {
      setPromptDropdownWidth((prev) => (prev === 820 ? prev : 820));
      return;
    }

    const syncPromptDropdownWidth = () => {
      const hostWidth = homeComposerHost.getBoundingClientRect().width;
      const nextWidth = Math.round(Math.max(420, Math.min(680, hostWidth * 0.76)));
      setPromptDropdownWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };

    syncPromptDropdownWidth();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncPromptDropdownWidth) : null;
    resizeObserver?.observe(homeComposerHost);
    window.addEventListener('resize', syncPromptDropdownWidth);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncPromptDropdownWidth);
    };
  }, []);

  const formatMemoryDate = useMemo(
    () =>
      (value?: number) => {
        if (!value || !Number.isFinite(value)) {
          return '--';
        }
        return new Intl.DateTimeFormat(undefined, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(value));
      },
    [],
  );

  return (
    <div ref={footerHostRef} style={{ display: 'contents' }}>
      {/* Bottom button area */}
      <ButtonArea
        disabled={disabled || isLoading}
        hasInputContent={hasInputContent}
        isLoading={isLoading}
        streamActivityPhase={streamActivityPhase}
        isEnhancing={isEnhancing}
        selectedModel={selectedModel}
        models={models}
        permissionMode={permissionMode}
        currentProvider={currentProvider}
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
        onSubmit={onSubmit}
        onStop={onStop}
        onModeSelect={onModeSelect}
        onModelSelect={onModelSelect}
        onProviderSelect={onProviderSelect}
        onReasoningChange={onReasoningChange}
        onEnhancePrompt={onEnhancePrompt}
        alwaysThinkingEnabled={alwaysThinkingEnabled}
        onToggleThinking={onToggleThinking}
        streamingEnabled={streamingEnabled}
        onStreamingEnabledChange={onStreamingEnabledChange}
        sendShortcut={sendShortcut}
        selectedAgent={selectedAgent}
        onAgentSelect={(agent) => onAgentSelect?.(agent)}
        onOpenAgentSettings={onOpenAgentSettings}
        onAddModel={onAddModel}
        onRefreshModelConfig={onRefreshModelConfig}
        isModelConfigRefreshing={isModelConfigRefreshing}
        onClearAgent={onClearAgent}
        shortcutActions={shortcutActions}
      />

      {/* @ file reference dropdown menu */}
      <CompletionDropdown
        isVisible={fileCompletion.isOpen}
        position={fileCompletion.position}
        items={fileCompletion.items}
        selectedIndex={fileCompletion.activeIndex}
        loading={fileCompletion.loading}
        emptyText={t('chat.noMatchingFiles')}
        onClose={fileCompletion.close}
        onSelect={(_, index) => fileCompletion.selectIndex(index)}
        onMouseEnter={fileCompletion.handleMouseEnter}
      />

      {/* @# note card picker */}
      <Dropdown
        isVisible={noteCardCompletion.isOpen}
        position={noteCardCompletion.position}
        width={760}
        className="completion-dropdown--memory"
        onClose={noteCardCompletion.close}
      >
        {noteCardCompletion.loading ? (
          <div className="dropdown-loading">{t('chat.loadingDropdown')}</div>
        ) : noteCardEntries.length === 0 ? (
          <div className="dropdown-empty">{t('noteCards.emptySearch')}</div>
        ) : (
          <div className="composer-memory-picker" role="listbox">
            <div className="composer-memory-picker-list">
              <div className="composer-memory-picker-head">
                <span className="composer-memory-picker-title">{noteCardPickerHeading}</span>
                <span className="composer-memory-picker-count">
                  {t('composer.noteCardPickerSelectedCount', {
                    count: selectedNoteCardIds.length,
                  })}
                </span>
              </div>
              {noteCardEntries.map(({ item, index, noteCard }) => {
                const noteCardId = noteCard?.id ?? item.id;
                const selected = selectedNoteCardIdSet.has(noteCardId);
                const isActive = index === noteCardCompletion.activeIndex;
                const coverAttachment = noteCard?.previewAttachments[0] ?? null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`composer-memory-picker-card${isActive ? ' is-active' : ''}${
                      selected ? ' is-selected' : ''
                    }`}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => noteCardCompletion.selectIndex(index)}
                    onMouseEnter={() => noteCardCompletion.handleMouseEnter(index)}
                  >
                    <span className="composer-memory-picker-card-check" aria-hidden>
                      {selected ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    </span>
                    {coverAttachment ? (
                      <span className="composer-note-card-picker-thumb" aria-hidden>
                        <LocalImage
                          src={resolveLocalPreviewSrc(coverAttachment.absolutePath)}
                          localPath={coverAttachment.absolutePath}
                          workspaceId={workspaceId}
                          alt={coverAttachment.fileName}
                          loading="lazy"
                        />
                      </span>
                    ) : null}
                    <span className="composer-memory-picker-card-main">
                      <span className="composer-memory-picker-card-title">
                        {noteCard?.title || item.label}
                      </span>
                      <span className="composer-memory-picker-card-meta">
                        {noteCard?.archived ? (
                          <span className="composer-memory-picker-card-meta-item">
                            {t('composer.noteCardArchivedBadge')}
                          </span>
                        ) : null}
                        <span className="composer-memory-picker-card-meta-item">
                          <Clock3 size={12} />
                          {formatMemoryDate(noteCard?.updatedAt)}
                        </span>
                        {typeof noteCard?.imageCount === 'number' && noteCard.imageCount > 0 ? (
                          <span className="composer-memory-picker-card-meta-item">
                            {t('noteCards.imageCount', { count: noteCard.imageCount })}
                          </span>
                        ) : null}
                      </span>
                      {(noteCard?.plainTextExcerpt || item.description) && (
                        <span className="composer-memory-chip-summary">
                          {noteCard?.plainTextExcerpt || item.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <aside className="composer-memory-picker-preview">
              {activeNoteCard ? (
                <>
                  <div className="composer-memory-picker-preview-head">
                    <span className="composer-memory-picker-preview-title">
                      {activeNoteCard.title}
                    </span>
                    <span className="composer-memory-picker-preview-shortcut">
                      {selectedNoteCardIdSet.has(activeNoteCard.id)
                        ? t('composer.noteCardPickerShortcutUnselect')
                        : t('composer.noteCardPickerShortcutSelect')}
                    </span>
                  </div>
                  <div
                    className={`composer-memory-picker-preview-body${
                      activeNoteCardPreviewExpanded ? ' is-expanded' : ''
                    }`}
                  >
                    {activeNoteCardPreviewAttachments.length > 0 ? (
                      <div className="composer-note-card-preview-images" role="list">
                        {activeNoteCardPreviewAttachments.map((attachment) => (
                          <span
                            key={attachment.id}
                            className="composer-note-card-preview-image"
                            role="listitem"
                            title={attachment.fileName}
                          >
                            <LocalImage
                              src={resolveLocalPreviewSrc(attachment.absolutePath)}
                              localPath={attachment.absolutePath}
                              workspaceId={workspaceId}
                              alt={attachment.fileName}
                              loading="lazy"
                            />
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="composer-memory-picker-preview-text">
                      <Markdown
                        className="markdown composer-memory-picker-preview-markdown"
                        value={activeNoteCardPreview || t('composer.noteCardPickerPreviewEmpty')}
                      />
                    </div>
                  </div>
                  {activeNoteCardPreviewLong && (
                    <button
                      type="button"
                      className="composer-memory-picker-preview-toggle"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        setExpandedPreviewNoteCardId((prev) =>
                          prev === activeNoteCard.id ? null : activeNoteCard.id,
                        )
                      }
                    >
                      {activeNoteCardPreviewExpanded
                        ? t('composer.noteCardPreviewCollapse')
                        : t('composer.noteCardPreviewExpand')}
                    </button>
                  )}
                  <div className="composer-memory-picker-preview-meta">
                    <span className="composer-memory-picker-preview-meta-item">
                      <Clock3 size={12} />
                      {formatMemoryDate(activeNoteCard.updatedAt)}
                    </span>
                    {activeNoteCard.archived ? (
                      <span className="composer-memory-picker-preview-meta-item">
                        <Layers3 size={12} />
                        {t('composer.noteCardArchivedBadge')}
                      </span>
                    ) : null}
                    {activeNoteCard.imageCount > 0 && (
                      <span className="composer-memory-picker-preview-meta-item">
                        <Tag size={12} />
                        {t('noteCards.imageCount', { count: activeNoteCard.imageCount })}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <span className="composer-memory-picker-preview-empty">
                  {t('composer.noteCardPickerPreviewFallback')}
                </span>
              )}
            </aside>
          </div>
        )}
      </Dropdown>

      {/* @@ manual memory picker */}
      <Dropdown
        isVisible={memoryCompletion.isOpen}
        position={memoryCompletion.position}
        width={760}
        className="completion-dropdown--memory"
        onClose={memoryCompletion.close}
      >
        {memoryCompletion.loading ? (
          <div className="dropdown-loading">{t('chat.loadingDropdown')}</div>
        ) : memoryEntries.length === 0 ? (
          <div className="dropdown-empty">{t('memory.empty')}</div>
        ) : (
          <div className="composer-memory-picker" role="listbox">
            <div className="composer-memory-picker-list">
              <div className="composer-memory-picker-head">
                <span className="composer-memory-picker-title">{manualMemoryPickerHeading}</span>
                <span className="composer-memory-picker-count">
                  {t('composer.manualMemoryPickerSelectedCount', {
                    count: selectedManualMemoryIds.length,
                  })}
                </span>
              </div>
              {memoryEntries.map(({ item, index, memory }) => {
                const memoryId = memory?.id ?? item.id;
                const selected = selectedManualMemoryIdSet.has(memoryId);
                const isActive = index === memoryCompletion.activeIndex;
                const detail = memory?.detail || '';
                const displayTitle = getMemoryUserInputText(detail) || memory?.title || item.label;
                const tags = (memory?.tags || []).slice(0, 3);
                const importanceTone = normalizeMemoryImportance(memory?.importance);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`composer-memory-picker-card${isActive ? ' is-active' : ''}${
                      selected ? ' is-selected' : ''
                    }`}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => memoryCompletion.selectIndex(index)}
                    onMouseEnter={() => memoryCompletion.handleMouseEnter(index)}
                  >
                    <span className="composer-memory-picker-card-check" aria-hidden>
                      {selected ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    </span>
                    <span className="composer-memory-picker-card-main">
                      <span className="composer-memory-picker-card-title">{displayTitle}</span>
                      <span className="composer-memory-picker-card-meta">
                        <span className="composer-memory-picker-card-meta-item">
                          <Layers3 size={12} />
                          {memory?.kind || 'note'}
                        </span>
                        <span
                          className={`composer-memory-picker-card-meta-item composer-memory-picker-importance is-${importanceTone}`}
                        >
                          {memory?.importance || 'normal'}
                        </span>
                        <span className="composer-memory-picker-card-meta-item">
                          <Clock3 size={12} />
                          {formatMemoryDate(memory?.updatedAt)}
                        </span>
                      </span>
                      {tags.length > 0 && (
                        <span className="composer-memory-picker-card-tags">
                          {tags.map((tag) => (
                            <span key={`${memoryId}-${tag}`} className="composer-memory-picker-tag">
                              #{tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <aside className="composer-memory-picker-preview">
              {activeMemory ? (
                <>
                  <div className="composer-memory-picker-preview-head">
                    <span className="composer-memory-picker-preview-title">
                      {activeMemory.title}
                    </span>
                    <span className="composer-memory-picker-preview-shortcut">
                      {selectedManualMemoryIdSet.has(activeMemory.id)
                        ? t('composer.manualMemoryPickerShortcutUnselect')
                        : t('composer.manualMemoryPickerShortcutSelect')}
                    </span>
                  </div>
                  <div
                    className={`composer-memory-picker-preview-body${
                      activeMemoryPreviewExpanded ? ' is-expanded' : ''
                    }`}
                  >
                    {activeMemoryPreviewSections.length > 0 ? (
                      <div className="composer-memory-picker-preview-sections">
                        {activeMemoryPreviewSections.map((section, index) => (
                          <div
                            key={`${section.label}-${index}`}
                            className="composer-memory-picker-preview-section"
                          >
                            <div className="composer-memory-picker-preview-section-label">
                              {section.label}
                            </div>
                            <Markdown
                              className="markdown composer-memory-picker-preview-markdown"
                              value={section.content}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="composer-memory-picker-preview-text">
                        <Markdown
                          className="markdown composer-memory-picker-preview-markdown"
                          value={activeMemoryPreview || t('composer.manualMemoryPickerPreviewEmpty')}
                        />
                      </div>
                    )}
                  </div>
                  {activeMemoryPreviewLong && (
                    <button
                      type="button"
                      className="composer-memory-picker-preview-toggle"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        setExpandedPreviewMemoryId((prev) =>
                          prev === activeMemory.id ? null : activeMemory.id,
                        )
                      }
                    >
                      {activeMemoryPreviewExpanded
                        ? t('composer.manualMemoryPreviewCollapse')
                        : t('composer.manualMemoryPreviewExpand')}
                    </button>
                  )}
                  <div className="composer-memory-picker-preview-meta">
                    <span className="composer-memory-picker-preview-meta-item">
                      <Layers3 size={12} />
                      {activeMemory.kind || 'note'}
                    </span>
                    <span className="composer-memory-picker-preview-meta-item">
                      <Clock3 size={12} />
                      {formatMemoryDate(activeMemory.updatedAt)}
                    </span>
                    {activeMemory.tags.length > 0 && (
                      <span className="composer-memory-picker-preview-meta-item">
                        <Tag size={12} />
                        {activeMemory.tags.slice(0, 5).join(' · ')}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <span className="composer-memory-picker-preview-empty">
                  {t('composer.manualMemoryPickerPreviewFallback')}
                </span>
              )}
            </aside>
          </div>
        )}
      </Dropdown>

      {/* / slash command dropdown menu */}
      <CompletionDropdown
        isVisible={commandCompletion.isOpen}
        position={commandCompletion.position}
        width={450}
        items={commandCompletion.items}
        selectedIndex={commandCompletion.activeIndex}
        loading={commandCompletion.loading}
        emptyText={t('chat.noMatchingCommands')}
        onClose={commandCompletion.close}
        onSelect={(_, index) => commandCompletion.selectIndex(index)}
        onMouseEnter={commandCompletion.handleMouseEnter}
      />

      {/* $ skill dropdown menu */}
      <CompletionDropdown
        isVisible={skillCompletion.isOpen}
        position={skillCompletion.position}
        width={450}
        items={skillCompletion.items}
        selectedIndex={skillCompletion.activeIndex}
        loading={skillCompletion.loading}
        emptyText={t('chat.noMatchingCommands')}
        onClose={skillCompletion.close}
        onSelect={(_, index) => skillCompletion.selectIndex(index)}
        onMouseEnter={skillCompletion.handleMouseEnter}
      />

      {/* # agent selection dropdown menu */}
      <CompletionDropdown
        isVisible={agentCompletion.isOpen}
        position={agentCompletion.position}
        width={350}
        items={agentCompletion.items}
        selectedIndex={agentCompletion.activeIndex}
        loading={agentCompletion.loading}
        emptyText={t('chat.noAvailableAgents')}
        onClose={agentCompletion.close}
        onSelect={(_, index) => agentCompletion.selectIndex(index)}
        onMouseEnter={agentCompletion.handleMouseEnter}
      />

      {/* ! prompt selection dropdown menu */}
      <CompletionDropdown
        isVisible={promptCompletion.isOpen}
        position={promptCompletion.position}
        width={promptDropdownWidth}
        className="completion-dropdown--prompt"
        items={promptCompletion.items}
        selectedIndex={promptCompletion.activeIndex}
        loading={promptCompletion.loading}
        emptyText={t('settings.prompt.noPromptsDropdown')}
        onClose={promptCompletion.close}
        onSelect={(_, index) => promptCompletion.selectIndex(index)}
        onMouseEnter={promptCompletion.handleMouseEnter}
      />

      {/* Floating Tooltip (uses Portal or Fixed positioning to break overflow limit) */}
      {tooltip && tooltip.visible && (
        <div
          className={`tooltip-popup ${tooltip.isBar ? 'tooltip-bar' : ''}`}
          style={{
            top: `${tooltip.top}px`,
            left: `${tooltip.left}px`,
            width: tooltip.width ? `${tooltip.width}px` : undefined,
            // @ts-expect-error CSS custom properties
            '--tooltip-tx': tooltip.tx || '-50%',
            '--arrow-left': tooltip.arrowLeft || '50%',
          }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Prompt enhancer dialog */}
      <PromptEnhancerDialog
        isOpen={promptEnhancer.isOpen}
        isLoading={promptEnhancer.isLoading}
        loadingEngine={promptEnhancer.loadingEngine}
        originalPrompt={promptEnhancer.originalPrompt}
        enhancedPrompt={promptEnhancer.enhancedPrompt}
        canUseEnhanced={promptEnhancer.canUseEnhanced}
        onUseEnhanced={promptEnhancer.onUseEnhanced}
        onKeepOriginal={promptEnhancer.onKeepOriginal}
        onClose={promptEnhancer.onClose}
      />
    </div>
  );
}
