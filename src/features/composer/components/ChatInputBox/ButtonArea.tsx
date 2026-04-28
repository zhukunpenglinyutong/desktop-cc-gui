import { useCallback, useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ButtonAreaProps, ModelInfo, PermissionMode, ReasoningEffort } from './types';
import { ConfigSelect, ModelSelect, ModeSelect, ProviderSelect, ReasoningSelect, ShortcutActionsSelect } from './selectors';
import { CLAUDE_MODELS, CODEX_MODELS } from './types';
import { STORAGE_KEYS, validateCodexCustomModels } from '../../types/provider';
import type { CodexCustomModel } from '../../types/provider';

// Stable no-op callbacks to avoid re-renders when optional handlers are not provided
const NOOP_MODE = (_mode: PermissionMode) => {};
const NOOP_MODEL = (_modelId: string) => {};
const NOOP_REASONING = (_effort: ReasoningEffort) => {};
const RELEVANT_MODEL_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.CODEX_CUSTOM_MODELS,
  STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
  STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
  STORAGE_KEYS.GEMINI_CUSTOM_MODELS,
]);
const CLAUDE_MODEL_MAPPING_KEY_BY_ID: Record<string, 'haiku' | 'sonnet' | 'opus'> = {
  'claude-haiku-4-5': 'haiku',
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-6': 'opus',
};
const MODEL_CONFIG_PROVIDERS = new Set(['claude', 'codex', 'gemini']);

const resolveModelConfigProvider = (provider: string) =>
  provider === 'codex' ? 'codex' : provider === 'gemini' ? 'gemini' : 'claude';

type ClaudeModelMapping = {
  main?: string;
  haiku?: string;
  sonnet?: string;
  opus?: string;
};

type ModelStorageSnapshot = {
  claudeModelMapping: ClaudeModelMapping;
  claudeCustomModels: ModelInfo[];
  codexCustomModels: ModelInfo[];
  geminiCustomModels: ModelInfo[];
};

const normalizeModelIdentity = (model: ModelInfo): string => {
  const id = model.id.trim().toLowerCase();
  if (id.length > 0) {
    return id;
  }
  return model.label.trim().toLowerCase();
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
      .filter((m): m is CodexCustomModel => !!m && typeof m === 'object' && typeof m.id === 'string' && m.id.trim().length > 0)
      .map(m => ({
        id: m.id,
        label: m.label || m.id,
        description: m.description,
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

function readClaudeModelMapping(): ClaudeModelMapping {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.CLAUDE_MODEL_MAPPING);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored) as ClaudeModelMapping;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return {
      main: typeof parsed.main === 'string' ? parsed.main : undefined,
      haiku: typeof parsed.haiku === 'string' ? parsed.haiku : undefined,
      sonnet: typeof parsed.sonnet === 'string' ? parsed.sonnet : undefined,
      opus: typeof parsed.opus === 'string' ? parsed.opus : undefined,
    };
  } catch {
    return {};
  }
}

function readModelStorageSnapshot(): ModelStorageSnapshot {
  return {
    claudeModelMapping: readClaudeModelMapping(),
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
  reasoningEffort = 'medium',
  accountRateLimits,
  usageShowRemaining = false,
  onRefreshAccountRateLimits,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  codexSpeedMode,
  onCodexSpeedModeChange,
  onCodexReviewQuickStart,
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

  /**
   * Apply model name mapping
   * Maps base model IDs to actual model names (e.g., versions with capacity suffixes)
   */
  const applyModelMapping = useCallback((model: ModelInfo, mapping: { haiku?: string; sonnet?: string; opus?: string }): ModelInfo => {
    const key = CLAUDE_MODEL_MAPPING_KEY_BY_ID[model.id];
    if (key && mapping[key]) {
      const actualModel = String(mapping[key]).trim();
      if (actualModel.length > 0) {
        // Keep the original id as unique identifier, only modify label to custom name
        // This ensures id remains unique even if multiple models share the same displayName
        return { ...model, label: actualModel };
      }
    }
    return model;
  }, []);

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
      const customModels = modelStorageSnapshot.codexCustomModels;
      return mergeCodexModels(dynamicModels, customModels, selectedModel);
    }
    const dynamicClaudeModels = Array.isArray(models) ? models : [];
    const baseClaudeModels = dynamicClaudeModels.length > 0 ? dynamicClaudeModels : CLAUDE_MODELS;
    if (typeof window === 'undefined' || !window.localStorage) {
      return baseClaudeModels;
    }

    // Apply model mapping to base Claude models
    const builtInModels = baseClaudeModels.map((m) =>
      applyModelMapping(m, modelStorageSnapshot.claudeModelMapping),
    );

    // Merge custom models (displayed before built-in models)
    const customModels = modelStorageSnapshot.claudeCustomModels;
    if (customModels.length === 0) {
      return builtInModels;
    }
    // Filter out built-in models that duplicate custom models
    const customIds = new Set(customModels.map(m => m.id));
    const filteredBuiltIn = builtInModels.filter(m => !customIds.has(m.id));
    return [...customModels, ...filteredBuiltIn];
  }, [currentProvider, models, selectedModel, applyModelMapping, modelStorageSnapshot]);

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

  const supportsModelConfigActions = MODEL_CONFIG_PROVIDERS.has(currentProvider);

  return (
    <div className="button-area" data-provider={currentProvider}>
      {/* Left side: selectors */}
      <div className="button-area-left">
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
        <ModeSelect value={permissionMode} onChange={onModeSelect ?? NOOP_MODE} provider={currentProvider} />
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
        {currentProvider === 'codex' && (
          <ReasoningSelect value={reasoningEffort} onChange={onReasoningChange ?? NOOP_REASONING} />
        )}
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
      </div>

      {/* Right side: tool buttons */}
      <div className="button-area-right">
        {/* Enhance prompt button - temporarily hidden */}
        {/* <button
          className="enhance-prompt-button has-tooltip"
          onClick={handleEnhanceClick}
          disabled={disabled || !hasInputContent || isLoading || isEnhancing}
          data-tooltip={`${t('promptEnhancer.tooltip')} (${t('promptEnhancer.shortcut')})`}
        >
          <span className={`codicon ${isEnhancing ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`} />
        </button> */}

        {/* Send/Stop button */}
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
  );
};

export default ButtonArea;
