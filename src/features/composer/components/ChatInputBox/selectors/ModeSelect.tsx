import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { AVAILABLE_MODES, type PermissionMode } from '../types';
import xuanzhonIcon from '../../../../../assets/xuanzhong.svg';
import morenmoshiIcon from '../../../../../assets/morenmoshi.svg';
import guihuamoshiIcon from '../../../../../assets/guihuamoshi.svg';
import dailimoshiIcon from '../../../../../assets/dailimoshi.svg';
import zidongmoshiIcon from '../../../../../assets/zidongmoshi.svg';
import {
  MODE_SELECT_FLASH_DURATION_MS,
  MODE_SELECT_FLASH_EVENT,
} from './modeSelectFlash';

const MODE_ICONS: Record<string, string> = {
  default: morenmoshiIcon,
  plan: guihuamoshiIcon,
  acceptEdits: dailimoshiIcon,
  bypassPermissions: zidongmoshiIcon,
};

interface ModeSelectProps {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  provider?: string;
}

/**
 * ModeSelect - Mode selector component
 * Supports switching between default, agent, plan, and auto modes
 */
export const ModeSelect = ({ value, onChange, provider }: ModeSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isChevronFlashing, setIsChevronFlashing] = useState(false);
  const [flashCycle, setFlashCycle] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<number | null>(null);
  const fallbackMode = AVAILABLE_MODES[0] ?? {
    id: 'default' as PermissionMode,
    label: 'Default Mode',
    icon: 'codicon-comment-discussion',
    tooltip: 'Standard permission behavior',
    description: 'Requires manual confirmation for each operation',
  };

  const modeOptions = useMemo(() => {
    if (provider === 'gemini') {
      return AVAILABLE_MODES.map((mode) => ({ ...mode, disabled: false }));
    }
    if (provider === 'claude') {
      return AVAILABLE_MODES.map((mode) => {
        if (
          mode.id === 'default' ||
          mode.id === 'plan' ||
          mode.id === 'bypassPermissions'
        ) {
          return { ...mode, disabled: false };
        }
        return { ...mode, disabled: true };
      });
    }
    // Keep non-Claude providers on the existing restricted path.
    return AVAILABLE_MODES.map((mode) => {
      if (mode.id !== 'bypassPermissions') {
        return { ...mode, disabled: true };
      }
      return mode;
    });
  }, [provider]);

  const currentMode = modeOptions.find(m => m.id === value) ?? modeOptions[0] ?? fallbackMode;

  // Helper function to get translated mode text
  const getModeText = (modeId: PermissionMode, field: 'label' | 'tooltip' | 'description') => {
    if (provider === 'codex') {
      const codexKey = `codexModes.${modeId}.${field}`;
      const fallbackKey = `modes.${modeId}.${field}`;
      return t(codexKey, { defaultValue: t(fallbackKey) });
    }
    if (provider === 'claude') {
      const claudeKey = `claudeModes.${modeId}.${field}`;
      const fallbackKey = `modes.${modeId}.${field}`;
      return t(claudeKey, { defaultValue: t(fallbackKey) });
    }

    return t(`modes.${modeId}.${field}`);
  };

  /**
   * Toggle dropdown
   */
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  }, [isOpen]);

  /**
   * Select mode
   */
  const handleSelect = useCallback((mode: PermissionMode, disabled?: boolean) => {
    if (disabled) return; // Disabled options cannot be selected
    onChange(mode);
    setIsOpen(false);
  }, [onChange]);

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const clearFlashTimer = () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };

    const handleFlashEvent = () => {
      clearFlashTimer();
      setIsChevronFlashing(true);
      setFlashCycle((previous) => previous + 1);
      flashTimerRef.current = window.setTimeout(() => {
        setIsChevronFlashing(false);
        flashTimerRef.current = null;
      }, MODE_SELECT_FLASH_DURATION_MS);
    };

    window.addEventListener(MODE_SELECT_FLASH_EVENT, handleFlashEvent);
    return () => {
      clearFlashTimer();
      window.removeEventListener(MODE_SELECT_FLASH_EVENT, handleFlashEvent);
    };
  }, []);

  const flashingButtonStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isChevronFlashing) {
      return undefined;
    }
    return {
      ['--mode-trigger-flash-name' as const]:
        flashCycle % 2 === 0
          ? 'selector-mode-trigger-flash-a'
          : 'selector-mode-trigger-flash-b',
    };
  }, [flashCycle, isChevronFlashing]);

  const flashingChevronStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isChevronFlashing) {
      return { fontSize: '10px', marginLeft: '2px' };
    }
    return {
      fontSize: '10px',
      marginLeft: '2px',
      ['--mode-chevron-flash-name' as const]:
        flashCycle % 2 === 0
          ? 'selector-mode-chevron-flash-a'
          : 'selector-mode-chevron-flash-b',
    };
  }, [flashCycle, isChevronFlashing]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        className={`selector-button selector-button-mode-trigger${isChevronFlashing ? ' is-flashing' : ''}`}
        onClick={handleToggle}
        style={flashingButtonStyle}
        title={getModeText(currentMode.id, 'tooltip') || `${t('chat.currentMode', { mode: getModeText(currentMode.id, 'label') })}`}
      >
        <img src={MODE_ICONS[currentMode.id]} style={{ width: 12, height: 12, flexShrink: 0 }} aria-hidden />
        <span className="selector-button-text">{getModeText(currentMode.id, 'label')}</span>
        <span
          className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'} selector-button-mode-chevron${isChevronFlashing ? ' is-flashing' : ''}`}
          style={flashingChevronStyle}
        />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="selector-dropdown selector-dropdown--mode"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: '4px',
            zIndex: 10000,
          }}
        >
          {modeOptions.map((mode) => (
            <div
              key={mode.id}
              data-mode-id={mode.id}
              className={`selector-option ${mode.id === value ? 'selected' : ''} ${mode.disabled ? 'disabled' : ''}`}
              onClick={() => handleSelect(mode.id, mode.disabled)}
              title={getModeText(mode.id, 'tooltip')}
              style={{
                opacity: mode.disabled ? 0.5 : 1,
                cursor: mode.disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <img src={MODE_ICONS[mode.id]} className="mode-icon" style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden />
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <span>{getModeText(mode.id, 'label')}</span>
                <span className="mode-description">{getModeText(mode.id, 'description')}</span>
              </div>
              {mode.id === value && (
                <img src={xuanzhonIcon} className="check-mark" style={{ width: 20, height: 20 }} aria-hidden />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModeSelect;
