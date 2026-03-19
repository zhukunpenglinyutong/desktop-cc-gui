import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Claude, Gemini } from '@lobehub/icons';
import openaiColorIcon from '../../../../../assets/model-icons/openai.svg';
import { AVAILABLE_PROVIDERS } from '../types';
import type { ProviderId } from '../types';

interface ProviderSelectProps {
  value: string;
  onChange?: (providerId: string) => void;
  providerAvailability?: Partial<Record<ProviderId, boolean>>;
  providerVersions?: Partial<Record<ProviderId, string | null>>;
  iconOnly?: boolean;
}

/**
 * Provider icon mapping
 */
const ProviderIcon = ({ providerId, size = 16 }: { providerId: string; size?: number }) => {
  const imgStyle = { width: size, height: size, flexShrink: 0 } as const;
  switch (providerId) {
    case 'claude':
      return <Claude.Color size={size} />;
    case 'codex':
      return <img src={openaiColorIcon} alt="OpenAI" style={imgStyle} aria-hidden />;
    case 'gemini':
      return <Gemini.Color size={size} />;
    case 'opencode':
      return (
        <svg viewBox="0 0 24 24" fill="none" style={{ ...imgStyle, color: '#6366f1' }} aria-hidden>
          <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.3" stroke="currentColor" strokeWidth="1.6" />
          <path d="m9.4 9.2-2.3 2.4 2.3 2.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M12.3 14.2h4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    default:
      return <Claude.Color size={size} />;
  }
};

/**
 * ProviderSelect - AI provider selector component
 * Supports switching between Claude, Codex, Gemini, and other providers
 */
export const ProviderSelect = ({
  value,
  onChange,
  providerAvailability,
  providerVersions,
  iconOnly = false,
}: ProviderSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const providers = AVAILABLE_PROVIDERS.map((provider) => ({
    ...provider,
    enabled: providerAvailability?.[provider.id] ?? provider.enabled,
    version: providerVersions?.[provider.id] ?? null,
  }));
  const currentProvider = providers.find((p) => p.id === value) || providers[0];

  // Helper function to get translated provider label
  const getProviderLabel = (providerId: string) => {
    return t(`providers.${providerId}.label`);
  };

  /**
   * Toggle dropdown
   */
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  }, [isOpen]);

  /**
   * Show toast message
   */
  const showToastMessage = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 1500);
  }, []);

  /**
   * Select provider
   */
  const handleSelect = useCallback((providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);

    if (!provider) return;

    if (!provider.enabled) {
      // If provider is unavailable, show toast
      showToastMessage(t('settings.provider.featureComingSoon'));
      setIsOpen(false);
      return;
    }

    // Provider available, perform switch
    onChange?.(providerId);
    setIsOpen(false);
  }, [onChange, providers, showToastMessage, t]);

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
    <>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          ref={buttonRef}
          className={`selector-button ${iconOnly ? 'selector-provider-button' : ''}`}
          onClick={handleToggle}
          title={`${t('config.switchProvider')}: ${getProviderLabel(currentProvider.id)}${currentProvider.version ? ` (${currentProvider.version})` : ''}`}
          aria-label={`${t('config.switchProvider')}: ${getProviderLabel(currentProvider.id)}`}
        >
          <ProviderIcon providerId={currentProvider.id} size={12} />
          {!iconOnly && <span className="selector-button-text">{getProviderLabel(currentProvider.id)}</span>}
          {!iconOnly && (
            <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`} style={{ fontSize: '10px', marginLeft: '2px' }} />
          )}
        </button>

        {isOpen && (
          <div
            ref={dropdownRef}
            className="selector-dropdown"
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: '4px',
              zIndex: 10000,
            }}
          >
            {providers.map((provider) => (
              <div
                key={provider.id}
                className={`selector-option ${provider.id === value ? 'selected' : ''} ${!provider.enabled ? 'disabled' : ''}`}
                onClick={() => handleSelect(provider.id)}
                style={{
                  opacity: provider.enabled ? 1 : 0.5,
                  cursor: provider.enabled ? 'pointer' : 'not-allowed',
                }}
              >
                <ProviderIcon providerId={provider.id} size={16}  />
                <span>
                  {getProviderLabel(provider.id)}
                  {provider.version ? ` (${provider.version})` : ''}
                </span>
                {provider.id === value && (
                  <span className="codicon codicon-check check-mark" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast message */}
      {showToast && (
        <div className="selector-toast">
          {toastMessage}
        </div>
      )}
    </>
  );
};

export default ProviderSelect;
