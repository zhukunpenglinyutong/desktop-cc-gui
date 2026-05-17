import { useCallback, useId, useMemo, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import DatabaseZap from 'lucide-react/dist/esm/icons/database-zap';
import X from 'lucide-react/dist/esm/icons/x';
import type { ButtonAreaProps, ModelInfo, PermissionMode, ReasoningEffort } from './types';
import { ConfigSelect, ModelSelect, ModeSelect, ProviderSelect, ReasoningSelect, ShortcutActionsSelect } from './selectors';
import { CODEX_MODELS } from './types';
import { isValidModelId, STORAGE_KEYS, validateCodexCustomModels } from '../../types/provider';
import type { CodexCustomModel } from '../../types/provider';

// Stable no-op callbacks to avoid re-renders when optional handlers are not provided
const NOOP_MODE = (_mode: PermissionMode) => {};
const NOOP_MODEL = (_modelId: string) => {};
const NOOP_REASONING = (_effort: ReasoningEffort | null) => {};
const RELEVANT_MODEL_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.CODEX_CUSTOM_MODELS,
  STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
  STORAGE_KEYS.GEMINI_CUSTOM_MODELS,
]);
const MODEL_CONFIG_PROVIDERS = new Set(['claude', 'codex', 'gemini']);

const resolveModelConfigProvider = (provider: string) =>
  provider === 'codex' ? 'codex' : provider === 'gemini' ? 'gemini' : 'claude';

function ToolGridIcon() {
  return <span className="codicon codicon-extensions selector-tool-icon" aria-hidden="true" />;
}

type ModelStorageSnapshot = {
  claudeCustomModels: ModelInfo[];
  codexCustomModels: ModelInfo[];
  geminiCustomModels: ModelInfo[];
};

const normalizeModelIdentity = (model: ModelInfo): string => {
  const runtimeModel = (model as ModelInfo & { model?: string }).model?.trim().toLowerCase();
  if (runtimeModel && runtimeModel.length > 0) {
    return `model:${runtimeModel}`;
  }
  const id = model.id.trim().toLowerCase();
  if (id.length > 0) {
    return `id:${id}`;
  }
  return `label:${model.label.trim().toLowerCase()}`;
};

const upsertModel = (
  mergedModels: ModelInfo[],
  seenIdentities: Map<string, number>,
  model: ModelInfo | null | undefined,
  replaceExisting = false,
) => {
  if (!model) {
    return;
  }
  const identity = normalizeModelIdentity(model);
  if (identity.length === 0) {
    return;
  }
  const existingIndex = seenIdentities.get(identity);
  if (existingIndex === undefined) {
    seenIdentities.set(identity, mergedModels.length);
    mergedModels.push(model);
    return;
  }
  if (replaceExisting) {
    mergedModels[existingIndex] = {
      ...mergedModels[existingIndex],
      ...model,
    };
  }
};

function mergeCodexModels(
  dynamicModels: ModelInfo[],
  customModels: ModelInfo[],
  selectedModel: string,
): ModelInfo[] {
  const mergedModels: ModelInfo[] = [];
  const seenIdentities = new Map<string, number>();

  dynamicModels.forEach((model) => upsertModel(mergedModels, seenIdentities, model));
  customModels.forEach((model) => upsertModel(mergedModels, seenIdentities, model, true));
  if (selectedModel.trim().length > 0) {
    upsertModel(mergedModels, seenIdentities, {
      id: selectedModel,
      label: selectedModel,
    });
  }
  CODEX_MODELS.forEach((model) => upsertModel(mergedModels, seenIdentities, model));

  return mergedModels;
}

/**
 * Get custom Codex model list from localStorage
 * Uses runtime type validation for data safety
 */
function getCustomCodexModels(): ModelInfo[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.CODEX_CUSTOM_MODELS);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    // Use runtime type validation
    const validModels = validateCodexCustomModels(parsed);
    return validModels.map(m => ({
      id: m.id,
      label: m.label || m.id,
      description: m.description,
    }));
  } catch {
    return [];
  }
}

/**
 * Get custom Claude model list from localStorage
 * Uses runtime type validation for data safety
 */
function getCustomClaudeModels(): ModelInfo[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.CLAUDE_CUSTOM_MODELS);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored) as CodexCustomModel[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((m): m is CodexCustomModel => !!m && typeof m === 'object' && typeof m.id === 'string' && isValidModelId(m.id))
      .map(m => ({
        id: m.id.trim(),
        model: m.id.trim(),
        label: typeof m.label === 'string' && m.label.trim().length > 0 ? m.label.trim() : m.id.trim(),
        description: m.description,
        source: 'custom',
      }));
  } catch {
    return [];
  }
}

/**
 * Get custom Gemini model list from localStorage
 * Uses runtime type validation for data safety
 */
function getCustomGeminiModels(): ModelInfo[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.GEMINI_CUSTOM_MODELS);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    const validModels = validateCodexCustomModels(parsed);
    return validModels.map(m => ({
      id: m.id,
      label: m.label || m.id,
      description: m.description,
    }));
  } catch {
    return [];
  }
}

function readModelStorageSnapshot(): ModelStorageSnapshot {
  return {
    claudeCustomModels: getCustomClaudeModels(),
    codexCustomModels: getCustomCodexModels(),
    geminiCustomModels: getCustomGeminiModels(),
  };
}

function isRelevantModelStorageKey(key: string | null | undefined): boolean {
  return key == null || RELEVANT_MODEL_STORAGE_KEYS.has(key);
}

/**
 * ButtonArea - Bottom toolbar component
 * Contains mode selector, model selector, attachment button, prompt enhancer button, send/stop button
 */
export const ButtonArea = ({
  disabled = false,
  hasInputContent = false,
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
  reasoningEffort = null,
  reasoningOptions,
  accountRateLimits,
  usageShowRemaining = false,
  onRefreshAccountRateLimits,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  codexSpeedMode,
  onCodexSpeedModeChange,
  onCodexReviewQuickStart,
  onForkQuickStart,
  memoryReferenceArmed = false,
  onToggleMemoryReference,
  onSubmit,
  onStop,
  onModeSelect,
  onModelSelect,
  onProviderSelect,
  onReasoningChange,
  alwaysThinkingEnabled = false,
  onToggleThinking,
  streamingEnabled = true,
  onStreamingEnabledChange,
  sendShortcut = 'enter',
  selectedAgent,
  onAgentSelect,
  onOpenAgentSettings,
  onAddModel,
  onRefreshModelConfig,
  isModelConfigRefreshing,
  shortcutActions,
  mainSurface,
  contextSurface,
  toolSurface,
  panelToggleSurface,
}: ButtonAreaProps) => {
  const { t } = useTranslation();
  // const fileInputRef = useRef<HTMLInputElement>(null);
  const isPlanModeEnabled = (selectedCollaborationModeId ?? 'code') === 'plan';
  const supportsStreamActivityPhaseFx =
    currentProvider === 'codex' ||
    currentProvider === 'claude' ||
    currentProvider === 'gemini';
  const resolvedStopButtonPhase =
    supportsStreamActivityPhaseFx ? streamActivityPhase : 'idle';

  const [modelStorageSnapshot, setModelStorageSnapshot] = useState<ModelStorageSnapshot>(
    () => readModelStorageSnapshot(),
  );
  const [isToolDockOpen, setIsToolDockOpen] = useState(false);
  const [isMemoryReferencePopoverOpen, setIsMemoryReferencePopoverOpen] = useState(false);
  const toolDockId = useId();
  const memoryReferencePopoverId = useId();
  const toolDockRootRef = useRef<HTMLDivElement>(null);
  const memoryReferenceRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refreshModelStorageSnapshot = () => {
      setModelStorageSnapshot(readModelStorageSnapshot());
    };
    const handleStorageChange = (e: StorageEvent) => {
      if (isRelevantModelStorageKey(e.key)) {
        refreshModelStorageSnapshot();
      }
    };

    const handleCustomStorageChange = (e: CustomEvent<{ key: string }>) => {
      if (isRelevantModelStorageKey(e.detail?.key)) {
        refreshModelStorageSnapshot();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorageChange', handleCustomStorageChange as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('localStorageChange', handleCustomStorageChange as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!isToolDockOpen) {
      return;
    }

    const handlePointerOutside = (event: MouseEvent) => {
      const root = toolDockRootRef.current;
      if (root && !root.contains(event.target as Node)) {
        setIsToolDockOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsToolDockOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isToolDockOpen]);

  useEffect(() => {
    if (!isMemoryReferencePopoverOpen) {
      return;
    }

    const handlePointerOutside = (event: MouseEvent) => {
      const root = memoryReferenceRootRef.current;
      if (root && !root.contains(event.target as Node)) {
        setIsMemoryReferencePopoverOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMemoryReferencePopoverOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMemoryReferencePopoverOpen]);

  const availableModels = useMemo(() => {
    if (currentProvider === 'gemini') {
      const dynamicModels = Array.isArray(models) ? models : [];
      const customModels = modelStorageSnapshot.geminiCustomModels;
      if (customModels.length > 0) {
        const customIds = new Set(customModels.map(m => m.id));
        const filteredDynamicModels = dynamicModels.filter(m => !customIds.has(m.id));
        const merged = [...customModels, ...filteredDynamicModels];
        if (merged.length > 0) {
          return merged;
        }
      }
      if (dynamicModels.length > 0) {
        return dynamicModels;
      }
      if (selectedModel && selectedModel.trim().length > 0) {
        return [{ id: selectedModel, label: selectedModel }];
      }
      return [];
    }
    if (currentProvider !== 'claude' && currentProvider !== 'codex') {
      if (Array.isArray(models) && models.length > 0) {
        return models;
      }
      if (selectedModel && selectedModel.trim().length > 0) {
        return [{ id: selectedModel, label: selectedModel }];
      }
      return [];
    }
    if (currentProvider === 'codex') {
      const dynamicModels = Array.isArray(models) ? models : [];
      if (dynamicModels.length > 0) {
        return dynamicModels;
      }
      const customModels = modelStorageSnapshot.codexCustomModels;
      return mergeCodexModels([], customModels, selectedModel);
    }
    const builtInModels = Array.isArray(models) ? models : [];

    // Merge custom models (displayed before built-in models)
    const customModels = modelStorageSnapshot.claudeCustomModels;
    if (customModels.length === 0) {
      return builtInModels;
    }
    // Filter out built-in/dynamic models that duplicate custom runtime models.
    const customIdentities = new Set(customModels.map(normalizeModelIdentity));
    const filteredBuiltIn = builtInModels.filter(m => !customIdentities.has(normalizeModelIdentity(m)));
    return [...customModels, ...filteredBuiltIn];
  }, [currentProvider, models, selectedModel, modelStorageSnapshot]);

  /**
   * Handle submit button click
   */
  const handleSubmitClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSubmit?.();
  }, [onSubmit]);

  /**
   * Handle stop button click
   */
  const handleStopClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStop?.();
  }, [onStop]);

  /**
   * Handle provider selection
   */
  const handleProviderSelect = useCallback((providerId: string) => {
    onProviderSelect?.(providerId);
  }, [onProviderSelect]);

  const handlePlanModeToggle = useCallback(() => {
    if (!onSelectCollaborationMode) {
      return;
    }
    onSelectCollaborationMode(isPlanModeEnabled ? 'code' : 'plan');
  }, [isPlanModeEnabled, onSelectCollaborationMode]);

  const handleAddModel = useCallback(() => {
    if (!onAddModel) {
      return;
    }
    onAddModel(resolveModelConfigProvider(currentProvider));
  }, [currentProvider, onAddModel]);

  const handleRefreshModelConfig = useCallback(() => {
    if (!onRefreshModelConfig) {
      return;
    }
    return onRefreshModelConfig(resolveModelConfigProvider(currentProvider));
  }, [currentProvider, onRefreshModelConfig]);

  const handleMemoryReferenceToggleClick = useCallback(() => {
    if (!onToggleMemoryReference) {
      return;
    }
    if (memoryReferenceArmed) {
      onToggleMemoryReference();
      setIsMemoryReferencePopoverOpen(false);
      return;
    }
    setIsMemoryReferencePopoverOpen((current) => !current);
  }, [memoryReferenceArmed, onToggleMemoryReference]);

  const handleConfirmMemoryReference = useCallback(() => {
    if (!onToggleMemoryReference || memoryReferenceArmed) {
      setIsMemoryReferencePopoverOpen(false);
      return;
    }
    onToggleMemoryReference();
    setIsMemoryReferencePopoverOpen(false);
  }, [memoryReferenceArmed, onToggleMemoryReference]);

  const supportsModelConfigActions = MODEL_CONFIG_PROVIDERS.has(currentProvider);
  const toolDockToggleLabel = t('chat.toolDockToggle', {
    defaultValue: isToolDockOpen ? '收起工具' : '展开工具',
  });

  return (
    <div
      ref={toolDockRootRef}
      className={`button-area${isToolDockOpen ? ' is-tool-dock-open' : ''}`}
      data-provider={currentProvider}
    >
      <div className="button-area-primary-row">
        <div className="button-area-left button-area-left--primary">
          <button
            type="button"
            className="selector-button selector-tool-dock-toggle"
            onClick={() => setIsToolDockOpen((current) => !current)}
            title={toolDockToggleLabel}
            aria-label={toolDockToggleLabel}
            aria-expanded={isToolDockOpen}
            aria-controls={toolDockId}
          >
            <ToolGridIcon />
          </button>
          {contextSurface ? (
            <div className="button-area-context-surface">
              {contextSurface}
            </div>
          ) : null}
          <div className="button-area-model-slot">
            <ModelSelect
              value={selectedModel}
              onChange={onModelSelect ?? NOOP_MODEL}
              models={availableModels}
              currentProvider={currentProvider}
              onAddModel={
                onAddModel && supportsModelConfigActions ? handleAddModel : undefined
              }
              onRefreshConfig={
                onRefreshModelConfig && supportsModelConfigActions ? handleRefreshModelConfig : undefined
              }
              isRefreshingConfig={Boolean(isModelConfigRefreshing)}
            />
          </div>
          {(currentProvider === 'codex' || currentProvider === 'claude') && (
            <ReasoningSelect
              value={reasoningEffort}
              onChange={onReasoningChange ?? NOOP_REASONING}
              options={reasoningOptions}
              showDefaultOption={currentProvider === 'claude'}
              defaultLabel={
                currentProvider === 'claude'
                  ? t('reasoning.claudeDefault', { defaultValue: 'Claude 默认' })
                  : undefined
              }
            />
          )}
          {mainSurface ? (
            <div className="button-area-main-surface">
              {mainSurface}
            </div>
          ) : null}
        </div>

        <div className="button-area-right">
          {onToggleMemoryReference ? (
            <div
              ref={memoryReferenceRootRef}
              className="composer-memory-reference-control inline-flex items-center relative flex-none"
            >
              <button
                type="button"
                className={`composer-memory-reference-toggle${
                  memoryReferenceArmed ? ' is-armed' : ''
                }`}
                onClick={handleMemoryReferenceToggleClick}
                aria-pressed={memoryReferenceArmed}
                aria-expanded={isMemoryReferencePopoverOpen}
                aria-controls={memoryReferencePopoverId}
                aria-label={t('composer.memoryReferenceToggle')}
                title={
                  memoryReferenceArmed
                    ? t('composer.memoryReferenceOn')
                    : t('composer.memoryReferenceToggle')
                }
                disabled={disabled}
              >
                <DatabaseZap size={17} aria-hidden />
              </button>
              {isMemoryReferencePopoverOpen ? (
                <div
                  id={memoryReferencePopoverId}
                  className="composer-memory-reference-popover absolute right-0 bottom-[calc(100%+6px)] z-[45] w-[min(252px,calc(100vw-24px))] p-0 border rounded-[9px] overflow-hidden border-(--composer-tool-popover-border,var(--border-strong,var(--border-subtle))) bg-(--composer-tool-popover-bg,var(--dropdown-bg,var(--surface-panel,var(--surface-control)))) shadow-[var(--shadow-popover,0_10px_24px_rgba(0,0,0,0.24))] text-(--text-secondary)"
                  role="dialog"
                  aria-label={t('composer.memoryReferenceDialogTitle')}
                >
                  <div className="composer-memory-reference-popover-head flex items-center justify-between gap-2 min-w-0 pt-[7px] px-2 pb-1.5 border-b border-(--border-subtle,var(--border-strong))">
                    <div className="composer-memory-reference-popover-title-group grid gap-px min-w-0">
                      <span className="composer-memory-reference-popover-title text-(--text-primary) text-xs font-[750] leading-[1.15]">
                        {t('composer.memoryReferenceDialogTitle')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="composer-memory-reference-popover-close"
                      onClick={() => setIsMemoryReferencePopoverOpen(false)}
                      aria-label={t('common.close', { defaultValue: '关闭' })}
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </div>
                  <div className="composer-memory-reference-popover-body grid gap-[5px] pt-[7px] px-2 pb-0">
                    <div className="composer-memory-reference-popover-row flex items-baseline justify-between gap-3 min-w-0">
                      <span className="composer-memory-reference-popover-label text-(--text-primary) text-[11px] font-[720] leading-[1.2] min-w-0">
                        {t('composer.memoryReferenceScope')}
                      </span>
                      <span className="composer-memory-reference-popover-value text-(--text-muted) text-[10px] font-[680] leading-[1.2] whitespace-nowrap">
                        {t('composer.memoryReferenceOff')}
                      </span>
                    </div>
                    <div className="composer-memory-reference-popover-copy m-0 text-(--text-muted) text-[11px] leading-[1.32]">
                      {t('composer.memoryReferenceOffHint')}
                    </div>
                  </div>
                  <div className="composer-memory-reference-popover-actions flex justify-end gap-1.5 mt-[7px] px-2 pb-2">
                    <button
                      type="button"
                      className="composer-memory-reference-popover-secondary"
                      onClick={() => setIsMemoryReferencePopoverOpen(false)}
                    >
                      {t('common.cancel', { defaultValue: '取消' })}
                    </button>
                    <button
                      type="button"
                      className="composer-memory-reference-popover-primary"
                      onClick={handleConfirmMemoryReference}
                    >
                      {t('composer.memoryReferenceConfirm')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {isLoading ? (
            <button
              className={`submit-button stop-button is-${resolvedStopButtonPhase}`}
              onClick={handleStopClick}
              title={t('chat.stopGeneration')}
              data-stream-phase={resolvedStopButtonPhase}
            >
              <span className="codicon codicon-debug-stop" />
            </button>
          ) : (
            <button
              className="submit-button"
              onClick={handleSubmitClick}
              disabled={disabled || !hasInputContent}
              title={
                sendShortcut === 'cmdEnter'
                  ? t('chat.sendMessageCmdEnter')
                  : t('chat.sendMessageEnter')
              }
            >
              <span className="codicon codicon-send" />
            </button>
          )}
        </div>
      </div>

      <div
        id={toolDockId}
        className="button-area-tool-dock"
        aria-hidden={!isToolDockOpen}
      >
        {isToolDockOpen ? (
          <div className="button-area-tool-popover" role="group" aria-label={toolDockToggleLabel}>
            <div className="button-area-tool-popover-header">
              <span className="button-area-tool-popover-title">
                {t('chat.tools', { defaultValue: '工具' })}
              </span>
              <span className="button-area-tool-popover-hint">
                {t('chat.toolDockHint', { defaultValue: '选择本次对话工具' })}
              </span>
            </div>
            <div className="button-area-tool-grid">
              <ConfigSelect
                currentProvider={currentProvider}
                onProviderChange={handleProviderSelect}
                providerAvailability={providerAvailability}
                providerVersions={providerVersions}
                alwaysThinkingEnabled={alwaysThinkingEnabled}
                onToggleThinking={onToggleThinking}
                streamingEnabled={streamingEnabled}
                onStreamingEnabledChange={onStreamingEnabledChange}
                accountRateLimits={accountRateLimits}
                usageShowRemaining={usageShowRemaining}
                onRefreshAccountRateLimits={onRefreshAccountRateLimits}
                selectedCollaborationModeId={selectedCollaborationModeId}
                onSelectCollaborationMode={onSelectCollaborationMode}
                codexSpeedMode={codexSpeedMode}
                onCodexSpeedModeChange={onCodexSpeedModeChange}
                onCodexReviewQuickStart={onCodexReviewQuickStart}
                onForkQuickStart={onForkQuickStart}
                selectedAgent={selectedAgent}
                onAgentSelect={onAgentSelect}
                onOpenAgentSettings={onOpenAgentSettings}
              />
              <ShortcutActionsSelect actions={shortcutActions} />
              {onProviderSelect && (
                <ProviderSelect
                  value={currentProvider}
                  onChange={handleProviderSelect}
                  providerAvailability={providerAvailability}
                  providerVersions={providerVersions}
                  providerStatusLabels={providerStatusLabels}
                  providerDisabledMessages={providerDisabledMessages}
                  iconOnly
                />
              )}
              <ModeSelect
                value={permissionMode}
                onChange={onModeSelect ?? NOOP_MODE}
                provider={currentProvider}
                selectedCollaborationModeId={selectedCollaborationModeId}
                onSelectCollaborationMode={onSelectCollaborationMode}
              />
              {currentProvider === 'codex' && isPlanModeEnabled && (
                <button
                  className={`selector-button selector-plan-mode-button ${isPlanModeEnabled ? 'active' : ''}`}
                  onClick={handlePlanModeToggle}
                  title={t('composer.planModeToggle')}
                  disabled={!onSelectCollaborationMode}
                >
                  <span className="codicon codicon-git-branch" />
                  <span className="selector-button-text">
                    {t('composer.planModeShort')}
                  </span>
                </button>
              )}
              {panelToggleSurface}
            </div>
            {toolSurface ? (
              <>
                <div className="button-area-tool-popover-divider" />
                <div className="button-area-tool-surface">
                  {toolSurface}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ButtonArea;
