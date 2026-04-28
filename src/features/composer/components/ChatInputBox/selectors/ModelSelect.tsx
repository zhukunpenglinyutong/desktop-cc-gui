import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Claude, Gemini } from '@lobehub/icons';
import xuanzhonIcon from '../../../../../assets/xuanzhong.svg';
import { AVAILABLE_MODELS } from '../types';
import type { ModelInfo } from '../types';
import { STORAGE_KEYS } from '../../../types/provider';
import { EngineIcon } from '../../../../engine/components/EngineIcon';

interface ModelSelectProps {
  value: string;
  onChange: (modelId: string) => void;
  models?: ModelInfo[];  // Optional dynamic model list
  currentProvider?: string;  // Current provider type
  onAddModel?: () => void;  // Navigate to model management
  onRefreshConfig?: () => Promise<void> | void; // Refresh current provider config
  isRefreshingConfig?: boolean;
}

const DEFAULT_MODEL_MAP: Record<string, ModelInfo> = AVAILABLE_MODELS.reduce(
  (acc, model) => {
    acc[model.id] = model;
    return acc;
  },
  {} as Record<string, ModelInfo>
);

const MODEL_LABEL_KEYS: Record<string, string> = {
  'claude-sonnet-4-6': 'models.claude.sonnet46.label',
  'claude-opus-4-6': 'models.claude.opus46.label',
  'claude-opus-4-6[1m]': 'models.claude.opus46_1m.label',
  'claude-haiku-4-5': 'models.claude.haiku45.label',
  'gpt-5.5': 'models.codex.gpt55.label',
  'gpt-5.4': 'models.codex.gpt54.label',
  'gpt-5.4-mini': 'models.codex.gpt54mini.label',
  'gpt-5.3-codex': 'models.codex.gpt53codex.label',
  'gpt-5.3-codex-spark': 'models.codex.gpt53codexSpark.label',
  'gpt-5.2': 'models.codex.gpt52.label',
};

const MODEL_DESCRIPTION_KEYS: Record<string, string> = {
  'claude-sonnet-4-6': 'models.claude.sonnet46.description',
  'claude-opus-4-6': 'models.claude.opus46.description',
  'claude-opus-4-6[1m]': 'models.claude.opus46_1m.description',
  'claude-haiku-4-5': 'models.claude.haiku45.description',
  'gpt-5.5': 'models.codex.gpt55.description',
  'gpt-5.4': 'models.codex.gpt54.description',
  'gpt-5.4-mini': 'models.codex.gpt54mini.description',
  'gpt-5.3-codex': 'models.codex.gpt53codex.description',
  'gpt-5.3-codex-spark': 'models.codex.gpt53codexSpark.description',
  'gpt-5.2': 'models.codex.gpt52.description',
};

/**
 * Maps model IDs to mapping keys for looking up actual model names
 * from the 'claude-model-mapping' localStorage entry.
 * The opus 1M variant uses a separate 'opus_1m' key, falling back to 'opus'.
 */
const MODEL_ID_TO_MAPPING_KEY: Record<string, string> = {
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-6': 'opus',
  'claude-opus-4-6[1m]': 'opus_1m',
  'claude-haiku-4-5': 'haiku',
};

/**
 * Retrieves model mapping from localStorage.
 * Returns format: { main: '', haiku: '', sonnet: '', opus: '' }
 */
const getModelMapping = (): Record<string, string> => {
  try {
    const mappingStr = localStorage.getItem(STORAGE_KEYS.CLAUDE_MODEL_MAPPING);
    if (mappingStr) {
      return JSON.parse(mappingStr);
    }
  } catch {
    // ignore parse errors
  }
  return {};
};

/**
 * Model icon component - displays different icons based on provider type
 */
const ModelIcon = ({ provider, size = 16 }: { provider?: string; size?: number }) => {
  const imgStyle = { width: size, height: size, flexShrink: 0 } as const;
  switch (provider) {
    case 'codex':
      return <EngineIcon engine="codex" size={size} style={imgStyle} />;
    case 'gemini':
      return <Gemini.Color size={size} />;
    case 'claude':
    default:
      return <Claude.Color size={size} />;
  }
};

/**
 * ModelSelect - Model selector component
 * Supports switching between Sonnet 4.5, Opus 4.5, and other models, including Codex models
 */
export const ModelSelect = ({
  value,
  onChange,
  models = AVAILABLE_MODELS,
  currentProvider = 'claude',
  onAddModel,
  onRefreshConfig,
  isRefreshingConfig = false,
}: ModelSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [refreshConfigError, setRefreshConfigError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const effectiveModels = useMemo(() => {
    if (models.length > 0) {
      return models;
    }
    if (value && value.trim().length > 0) {
      return [{ id: value, label: value }];
    }
    return [] as ModelInfo[];
  }, [models, value]);

  const selectedModelValue = value.trim();
  const currentModel =
    selectedModelValue.length > 0
      ? effectiveModels.find(m => m.id === selectedModelValue) ?? null
      : null;

  // Cache model mapping to avoid redundant localStorage reads on every render
  const modelMapping = useMemo(() => getModelMapping(), []);

  const getModelLabel = (model: ModelInfo): string => {
    // Check model mapping first (from local settings.json or provider config)
    const mappingKey = MODEL_ID_TO_MAPPING_KEY[model.id];
    if (mappingKey) {
      // opus_1m falls back to opus mapping
      const mappedName = modelMapping[mappingKey]
        || (mappingKey === 'opus_1m' ? modelMapping['opus'] : undefined);
      if (mappedName && mappedName.trim()) {
        return mappedName.trim();
      }
    }

    // Fall back to default logic when no mapping is found
    const defaultModel = DEFAULT_MODEL_MAP[model.id];
    const labelKey = MODEL_LABEL_KEYS[model.id];
    const hasCustomLabel = defaultModel && model.label && model.label !== defaultModel.label;

    if (hasCustomLabel) {
      return model.label;
    }

    if (labelKey) {
      return t(labelKey);
    }

    return model.label;
  };

  const getModelDescription = (model: ModelInfo): string | undefined => {
    const descriptionKey = MODEL_DESCRIPTION_KEYS[model.id];
    if (descriptionKey) {
      return t(descriptionKey);
    }
    return model.description;
  };

  /**
   * Toggle dropdown
   */
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  }, [isOpen]);

  /**
   * Select model
   */
  const handleSelect = useCallback((modelId: string) => {
    onChange(modelId);
    setIsOpen(false);
  }, [onChange]);

  const handleAddModelClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onAddModel?.();
    setIsOpen(false);
  }, [onAddModel]);

  const handleRefreshConfigClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!onRefreshConfig || isRefreshingConfig) {
      return;
    }
    setRefreshConfigError(null);
    void Promise.resolve(onRefreshConfig()).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshConfigError(message);
    });
  }, [isRefreshingConfig, onRefreshConfig]);

  /**
   * Close on outside click
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    // Delay adding event listener to prevent immediate trigger
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        className="selector-button"
        onClick={handleToggle}
        title={t('chat.currentModel', { model: currentModel ? getModelLabel(currentModel) : t('models.selectModel') })}
      >
        <ModelIcon provider={currentProvider} size={12} />
        <span className="selector-button-text">{currentModel ? getModelLabel(currentModel) : t('models.selectModel')}</span>
        <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`} style={{ fontSize: '10px', marginLeft: '2px' }} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="selector-dropdown selector-dropdown--model"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: '4px',
            zIndex: 10000,
          }}
        >
          <div className="selector-dropdown-title">{t('models.selectModel')}</div>
          {effectiveModels.map((model) => (
            <div
              key={model.id}
              className={`selector-option ${model.id === value ? 'selected' : ''}`}
              onClick={() => handleSelect(model.id)}
            >
              <ModelIcon provider={currentProvider} size={20} />
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span>{getModelLabel(model)}</span>
                {getModelDescription(model) && (
                  <span className="model-description">{getModelDescription(model)}</span>
                )}
              </div>
              <div style={{ width: 20, height: 20, flexShrink: 0, marginLeft: 'auto' }}>
                {model.id === value && (
                  <img src={xuanzhonIcon} style={{ width: 20, height: 20 }} aria-hidden />
                )}
              </div>
            </div>
          ))}
          {(onAddModel || onRefreshConfig) && (
            <>
              <div className="selector-divider" />
              <div className="selector-action-footer">
                {onAddModel && (
                  <button
                    type="button"
                    className="selector-footer-action selector-footer-action-add"
                    onClick={handleAddModelClick}
                  >
                    {t('models.addModel')}
                  </button>
                )}
                {onRefreshConfig && (
                  <button
                    type="button"
                    className="selector-footer-action selector-footer-action-refresh"
                    onClick={handleRefreshConfigClick}
                    disabled={isRefreshingConfig}
                    aria-busy={isRefreshingConfig}
                    title={t(isRefreshingConfig ? 'models.refreshingConfig' : 'models.refreshConfig')}
                  >
                    <span
                      className={`codicon codicon-refresh${isRefreshingConfig ? ' selector-refresh-icon-spinning' : ''}`}
                      aria-hidden
                    />
                    <span>{t(isRefreshingConfig ? 'models.refreshingConfig' : 'models.refreshConfig')}</span>
                  </button>
                )}
              </div>
              {refreshConfigError && (
                <div className="selector-refresh-error" role="status">
                  {t('models.refreshConfigFailed', { message: refreshConfigError })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ModelSelect;
