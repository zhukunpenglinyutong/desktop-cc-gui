import type React from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AppWindow,
  ArrowLeftRight,
  Bot,
  Construction,
  Eye,
  FileEdit,
  Focus,
  Folder,
  GitBranch,
  Info,
  LayoutList,
  ListChecks,
  MessageCircle,
  MessageSquareQuote,
  MessageSquareText,
  Monitor,
  Moon,
  NotebookPen,
  Palette,
  PanelBottom,
  PanelRightOpen,
  PanelTop,
  PanelsLeftRight,
  Play,
  RotateCcw,
  Search,
  Sun,
  TerminalSquare,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
} from "@/features/app/constants";
import {
  GENERIC_APP_ICON,
  getKnownOpenAppIcon,
} from "@/features/app/utils/openAppIcons";
import { useClientUiVisibility } from "@/features/client-ui-visibility/hooks/useClientUiVisibility";
import {
  CLIENT_UI_PANEL_REGISTRY,
  getClientUiControlDefinition,
  type ClientUiVisibilityIconKey,
} from "@/features/client-ui-visibility/utils/clientUiVisibility";
import type { AppSettings, ThemePresetId } from "../../../../../types";
import { clampUiScale } from "../../../../../utils/uiScale";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "../../../../../utils/fonts";
import { LanguageSelector } from "../../LanguageSelector";

type BasicAppearanceSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  activeThemePresetId: ThemePresetId;
  resolvedAppearanceTheme: "light" | "dark";
  themePresetOptions: ReadonlyArray<{ id: ThemePresetId; label: string }>;
  onThemePresetChange: (presetId: ThemePresetId) => Promise<void>;
  uiScaleDraft: number;
  clampedUiScale: number;
  uiScaleDraftPercentLabel: string;
  setUiScaleDraft: (next: number) => void;
  handleResetUiScaleDraft: () => void;
  handleSaveUiScale: () => void;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  userMsgPresets: ReadonlyArray<{ color: string; label: string }>;
  isUserMsgPresetActive: (presetColor: string) => boolean;
  handleUserMsgPresetClick: (presetColor: string) => void;
  normalizedUserMsgColor: string | null;
  defaultUserMsgColor: string;
  handleUserMsgColorPickerChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  userMsgHexDraft: string;
  handleUserMsgHexInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleResetUserMsgColor: () => void;
  uiFontDraft: string;
  handleUiFontSelectChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  uiFontSelectOptions: string[];
  defaultUiPrimaryFont: string;
  setUiFontDraft: (next: string) => void;
  codeFontDraft: string;
  codeFontSelectOptions: string[];
  handleCodeFontSelectChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  defaultCodePrimaryFont: string;
  setCodeFontDraft: (next: string) => void;
  codeFontSizeDraft: number;
  setCodeFontSizeDraft: (next: number) => void;
  handleCommitCodeFontSize: (nextSize: number) => Promise<void>;
};

const CLIENT_UI_VISIBILITY_ICON_COMPONENTS: Record<ClientUiVisibilityIconKey, LucideIcon> = {
  activity: Activity,
  appWindow: AppWindow,
  bot: Bot,
  construction: Construction,
  fileEdit: FileEdit,
  focus: Focus,
  folder: Folder,
  gitBranch: GitBranch,
  info: Info,
  layoutList: LayoutList,
  listChecks: ListChecks,
  messageSquareQuote: MessageSquareQuote,
  messageSquareText: MessageSquareText,
  panelBottom: PanelBottom,
  panelRightOpen: PanelRightOpen,
  panelTop: PanelTop,
  play: Play,
  search: Search,
  terminal: TerminalSquare,
  notebookPen: NotebookPen,
};

function resolveSelectedOpenAppIconSrc(appSettings: AppSettings) {
  const availableTargets =
    appSettings.openAppTargets.length > 0
      ? appSettings.openAppTargets
      : DEFAULT_OPEN_APP_TARGETS;
  const resolvedOpenAppId =
    availableTargets.find((target) => target.id === appSettings.selectedOpenAppId)?.id ??
    availableTargets[0]?.id ??
    DEFAULT_OPEN_APP_ID;
  return getKnownOpenAppIcon(resolvedOpenAppId) ?? GENERIC_APP_ICON;
}

function ClientUiVisibilityIcon({
  iconKey,
  openAppIconSrc,
}: {
  iconKey: ClientUiVisibilityIconKey;
  openAppIconSrc: string;
}) {
  if (iconKey === "appWindow") {
    return (
      <span className="settings-client-ui-visibility-row-icon" aria-hidden>
        <img src={openAppIconSrc} alt="" />
      </span>
    );
  }
  const Icon = CLIENT_UI_VISIBILITY_ICON_COMPONENTS[iconKey];
  return (
    <span className="settings-client-ui-visibility-row-icon" aria-hidden>
      <Icon size={15} strokeWidth={2.15} />
    </span>
  );
}

export function BasicAppearanceSection({
  appSettings,
  onUpdateAppSettings,
  activeThemePresetId,
  resolvedAppearanceTheme,
  themePresetOptions,
  onThemePresetChange,
  uiScaleDraft,
  clampedUiScale,
  uiScaleDraftPercentLabel,
  setUiScaleDraft,
  handleResetUiScaleDraft,
  handleSaveUiScale,
  scaleShortcutTitle,
  scaleShortcutText,
  userMsgPresets,
  isUserMsgPresetActive,
  handleUserMsgPresetClick,
  normalizedUserMsgColor,
  defaultUserMsgColor,
  handleUserMsgColorPickerChange,
  userMsgHexDraft,
  handleUserMsgHexInputChange,
  handleResetUserMsgColor,
  uiFontDraft,
  handleUiFontSelectChange,
  uiFontSelectOptions,
  defaultUiPrimaryFont,
  setUiFontDraft,
  codeFontDraft,
  codeFontSelectOptions,
  handleCodeFontSelectChange,
  defaultCodePrimaryFont,
  setCodeFontDraft,
  codeFontSizeDraft,
  setCodeFontSizeDraft,
  handleCommitCodeFontSize,
}: BasicAppearanceSectionProps) {
  const { t } = useTranslation();
  const clientUiVisibility = useClientUiVisibility();
  const selectedOpenAppIconSrc = resolveSelectedOpenAppIconSrc(appSettings);
  const resolvedAppearanceLabel = t(
    resolvedAppearanceTheme === "light" ? "settings.themeLight" : "settings.themeDark",
  );
  const themeModeHint =
    appSettings.theme === "custom"
      ? t("settings.themeModeHintCustom", { appearance: resolvedAppearanceLabel })
      : appSettings.theme === "system"
        ? t("settings.themeModeHintSystem", { appearance: resolvedAppearanceLabel })
        : t("settings.themeModeHintFixed", { appearance: resolvedAppearanceLabel });

  return (
    <div className="settings-basic-appearance settings-basic-surface">
      <div className="settings-basic-group-card settings-basic-group-card--list">
        <div className="settings-subsection-title">{t("settings.displaySubtitle")}</div>
        <div className="settings-subsection-subtitle">
          {t("settings.displaySubDescription")}
        </div>
        <div className="settings-field settings-basic-theme-field settings-basic-item">
          <div className="settings-basic-field-header">
            <Palette className="settings-basic-field-icon" aria-hidden />
            <span className="settings-basic-field-label">{t("settings.theme")}</span>
          </div>
          <div className="settings-basic-theme-selector" role="radiogroup" aria-label={t("settings.theme")}>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "system"}
              className={`settings-basic-theme-option ${
                appSettings.theme === "system" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "system",
                })
              }
            >
              <span className="settings-basic-theme-icon settings-basic-theme-icon-system">
                <Monitor size={14} />
              </span>
              <span>{t("settings.themeSystem")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "light"}
              className={`settings-basic-theme-option ${
                appSettings.theme === "light" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "light",
                })
              }
            >
              <span className="settings-basic-theme-icon settings-basic-theme-icon-light">
                <Sun size={14} />
              </span>
              <span>{t("settings.themeLight")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "dark"}
              className={`settings-basic-theme-option ${
                appSettings.theme === "dark" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "dark",
                })
              }
            >
              <span className="settings-basic-theme-icon settings-basic-theme-icon-dark">
                <Moon size={14} />
              </span>
              <span>{t("settings.themeDark")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "custom"}
              className={`settings-basic-theme-option ${
                appSettings.theme === "custom" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "custom",
                  customThemePresetId: activeThemePresetId,
                })
              }
            >
              <span className="settings-basic-theme-icon settings-basic-theme-icon-custom">
                <Palette size={14} />
              </span>
              <span>{t("settings.themeCustom")}</span>
            </button>
          </div>
          <div className="settings-help">{themeModeHint}</div>
        </div>
        {appSettings.theme === "custom" ? (
          <div className="settings-field settings-basic-item">
            <div className="settings-basic-field-header">
              <Palette className="settings-basic-field-icon" aria-hidden />
              <span className="settings-basic-field-label">{t("settings.themePreset")}</span>
            </div>
            <div className="settings-control settings-basic-theme-preset-control">
              <div className="settings-select-wrap settings-basic-theme-preset-select-wrap">
                <select
                  className="settings-select settings-basic-theme-preset-select"
                  aria-label={t("settings.themePreset")}
                  value={activeThemePresetId}
                  onChange={(event) =>
                    void onThemePresetChange(event.target.value as ThemePresetId)
                  }
                >
                  {themePresetOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-help">
              {t("settings.themePresetDescription", {
                appearance: resolvedAppearanceLabel,
              })}
            </div>
          </div>
        ) : null}
        <LanguageSelector rowClassName="settings-basic-item" />
        <div className="settings-field settings-basic-item">
          <div className="settings-basic-field-header">
            <ArrowLeftRight className="settings-basic-field-icon" aria-hidden />
            <span className="settings-basic-field-label">{t("settings.canvasWidth")}</span>
          </div>
          <div className="settings-basic-theme-selector" role="radiogroup" aria-label={t("settings.canvasWidth")}>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.canvasWidthMode !== "wide"}
              className={`settings-basic-theme-option ${
                appSettings.canvasWidthMode !== "wide" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  canvasWidthMode: "narrow",
                })
              }
            >
              <span>{t("settings.canvasWidthNarrow")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.canvasWidthMode === "wide"}
              className={`settings-basic-theme-option ${
                appSettings.canvasWidthMode === "wide" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  canvasWidthMode: "wide",
                })
              }
            >
              <span>{t("settings.canvasWidthWide")}</span>
            </button>
          </div>
          <div className="settings-help">{t("settings.canvasWidthDesc")}</div>
        </div>
        <div className="settings-field settings-basic-item">
          <div className="settings-basic-field-header">
            <PanelsLeftRight className="settings-basic-field-icon" aria-hidden />
            <span className="settings-basic-field-label">{t("settings.layoutMode")}</span>
          </div>
          <div className="settings-basic-theme-selector" role="radiogroup" aria-label={t("settings.layoutMode")}>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.layoutMode !== "swapped"}
              className={`settings-basic-theme-option ${
                appSettings.layoutMode !== "swapped" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  layoutMode: "default",
                })
              }
            >
              <span>{t("settings.layoutModeDefault")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.layoutMode === "swapped"}
              className={`settings-basic-theme-option ${
                appSettings.layoutMode === "swapped" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  layoutMode: "swapped",
                })
              }
            >
              <span>{t("settings.layoutModeSwapped")}</span>
            </button>
          </div>
          <div className="settings-help">{t("settings.layoutModeDesc")}</div>
        </div>
        <div className="settings-field settings-basic-item settings-scale-item">
          <div className="settings-basic-field-header">
            <Type className="settings-basic-field-icon" aria-hidden />
            <span className="settings-basic-field-label">{t("settings.interfaceScale")}</span>
          </div>
          <div className="settings-control settings-scale-control">
            <input
              type="range"
              min={0.8}
              max={2.6}
              step={0.01}
              className="settings-input settings-input--range"
              aria-label={t("settings.interfaceScaleAriaLabel")}
              value={uiScaleDraft}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isFinite(parsed)) {
                  return;
                }
                setUiScaleDraft(clampUiScale(parsed));
              }}
            />
            <span className="settings-scale-value">{uiScaleDraftPercentLabel}</span>
            <button
              type="button"
              className="primary settings-button-compact settings-scale-save"
              onClick={handleSaveUiScale}
              disabled={uiScaleDraft === clampedUiScale}
              data-testid="settings-ui-scale-save"
            >
              {t("common.save")}
            </button>
            <button
              type="button"
              className="ghost settings-button-compact settings-scale-reset"
              onClick={handleResetUiScaleDraft}
              data-testid="settings-ui-scale-reset"
            >
              {t("settings.uiScaleReset")}
            </button>
          </div>
          <div className="settings-help" title={scaleShortcutTitle}>
            {scaleShortcutText}
          </div>
        </div>
      </div>
      <div className="settings-basic-group-card settings-basic-group-card--list settings-client-ui-visibility-card">
        <div className="settings-client-ui-visibility-head">
          <div>
            <div className="settings-subsection-title settings-client-ui-visibility-title">
              <Eye className="settings-basic-field-icon" aria-hidden />
              <span>{t("settings.clientUiVisibility.title")}</span>
            </div>
            <div className="settings-subsection-subtitle">
              {t("settings.clientUiVisibility.description")}
            </div>
          </div>
          <button
            type="button"
            className="ghost settings-button-compact settings-client-ui-visibility-reset"
            onClick={clientUiVisibility.resetVisibility}
          >
            <RotateCcw size={14} aria-hidden />
            {t("settings.clientUiVisibility.reset")}
          </button>
        </div>
        {CLIENT_UI_PANEL_REGISTRY.map((panel) => {
          const panelVisible = clientUiVisibility.isPanelVisible(panel.id);
          return (
            <div className="settings-client-ui-visibility-panel" key={panel.id}>
              <div className="settings-toggle-row settings-client-ui-visibility-panel-row">
                <div className="settings-client-ui-visibility-row-copy">
                  <ClientUiVisibilityIcon
                    iconKey={panel.iconKey}
                    openAppIconSrc={selectedOpenAppIconSrc}
                  />
                  <div className="settings-client-ui-visibility-row-text">
                    <div className="settings-toggle-title">{t(panel.labelKey)}</div>
                    <div className="settings-toggle-subtitle">
                      {t(panel.descriptionKey)}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={panelVisible}
                  aria-label={t(panel.labelKey)}
                  onCheckedChange={(checked) =>
                    clientUiVisibility.setPanelVisible(panel.id, checked)
                  }
                />
              </div>
              {panel.controls.length > 0 ? (
                <div className="settings-client-ui-visibility-controls">
                  {panel.controls.map((controlId) => {
                    const control = getClientUiControlDefinition(controlId);
                    return (
                      <div
                        className={`settings-toggle-row settings-client-ui-visibility-control-row${
                          panelVisible ? "" : " is-parent-hidden"
                        }`}
                        key={control.id}
                      >
                        <div className="settings-client-ui-visibility-row-copy">
                          <ClientUiVisibilityIcon
                            iconKey={control.iconKey}
                            openAppIconSrc={selectedOpenAppIconSrc}
                          />
                          <div className="settings-client-ui-visibility-row-text">
                            <div className="settings-toggle-title">
                              {t(control.labelKey)}
                            </div>
                            <div className="settings-toggle-subtitle">
                              {t(control.descriptionKey)}
                              {!panelVisible ? (
                                <span className="settings-client-ui-visibility-parent-hint">
                                  {" "}
                                  {t("settings.clientUiVisibility.parentHiddenHint")}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <Switch
                          checked={clientUiVisibility.isControlPreferenceVisible(control.id)}
                          aria-label={t(control.labelKey)}
                          onCheckedChange={(checked) =>
                            clientUiVisibility.setControlVisible(control.id, checked)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="settings-color-config-card settings-basic-group-card">
        <div className="settings-color-config-head">
          <MessageCircle className="settings-color-config-icon" aria-hidden />
          <span className="settings-color-config-title">
            {t("settings.userMsgColorLabel")}
          </span>
        </div>
        <div className="settings-color-preset-grid" role="list">
          {userMsgPresets.map((preset) => (
            <button
              key={preset.color}
              type="button"
              role="listitem"
              className={`settings-color-swatch${isUserMsgPresetActive(preset.color) ? " is-active" : ""}`}
              onClick={() => handleUserMsgPresetClick(preset.color)}
              title={preset.label}
              aria-label={`${t("settings.userMsgColorLabel")} ${preset.color}`}
              data-testid={`settings-user-msg-color-preset-${preset.color.slice(1)}`}
            >
              <span
                className="settings-color-swatch-inner"
                style={{ backgroundColor: preset.color }}
              />
            </button>
          ))}
        </div>
        <div className="settings-color-custom-row">
          <span className="settings-color-custom-label">
            {t("settings.userMsgColorCustom")}
          </span>
          <label className="settings-color-picker" aria-label={t("settings.userMsgColorLabel")}>
            <span
              className="settings-color-picker-preview"
              style={{
                backgroundColor: normalizedUserMsgColor || defaultUserMsgColor,
              }}
            />
            <input
              type="color"
              className="settings-color-picker-input"
              value={normalizedUserMsgColor || defaultUserMsgColor}
              onChange={handleUserMsgColorPickerChange}
              aria-label={t("settings.userMsgColorLabel")}
            />
          </label>
          <input
            type="text"
            className="settings-input settings-color-hex-input"
            value={userMsgHexDraft}
            onChange={handleUserMsgHexInputChange}
            placeholder="#6e40c9"
            maxLength={7}
            spellCheck={false}
            aria-label={t("settings.userMsgColorLabel")}
            data-testid="settings-user-msg-color-hex-input"
          />
          {normalizedUserMsgColor ? (
            <button
              type="button"
              className="ghost settings-color-reset"
              onClick={handleResetUserMsgColor}
              data-testid="settings-user-msg-color-reset"
            >
              <RotateCcw size={14} aria-hidden />
              {t("settings.userMsgColorReset")}
            </button>
          ) : null}
        </div>
        <div className="settings-help settings-color-hint">
          <Info size={14} aria-hidden />
          <span>{t("settings.userMsgColorHint")}</span>
        </div>
      </div>
      <div className="settings-basic-group-card settings-basic-group-card--list">
        <div className="settings-field settings-basic-item settings-basic-font-field">
          <label className="settings-field-label" htmlFor="ui-font-family">
            {t("settings.uiFontFamily")}
          </label>
          <div className="settings-field-row settings-field-row--font">
            <div className="settings-select-wrap settings-select-wrap--font">
              <select
                id="ui-font-family"
                className="settings-select"
                value={uiFontDraft}
                onChange={handleUiFontSelectChange}
                data-testid="settings-ui-font-select"
              >
                {uiFontSelectOptions.map((fontName) => (
                  <option key={fontName} value={fontName}>
                    {fontName}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="ghost settings-button-compact settings-ui-font-reset settings-font-reset"
              onClick={() => {
                setUiFontDraft(defaultUiPrimaryFont);
                void onUpdateAppSettings({
                  ...appSettings,
                  uiFontFamily: DEFAULT_UI_FONT_FAMILY,
                });
              }}
            >
              {t("settings.reset")}
            </button>
          </div>
          <div className="settings-help">
            {t("settings.uiFontFamilyDesc")}
          </div>
        </div>
        <div className="settings-field settings-basic-item settings-basic-font-field">
          <label className="settings-field-label" htmlFor="code-font-family">
            {t("settings.codeFontFamily")}
          </label>
          <div className="settings-field-row settings-field-row--font">
            <div className="settings-select-wrap settings-select-wrap--font">
              <select
                id="code-font-family"
                className="settings-select"
                value={codeFontDraft}
                onChange={handleCodeFontSelectChange}
                data-testid="settings-code-font-select"
              >
                {codeFontSelectOptions.map((fontName) => (
                  <option key={fontName} value={fontName}>
                    {fontName}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="ghost settings-button-compact settings-font-reset"
              onClick={() => {
                setCodeFontDraft(defaultCodePrimaryFont);
                void onUpdateAppSettings({
                  ...appSettings,
                  codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
                });
              }}
            >
              {t("settings.reset")}
            </button>
          </div>
          <div className="settings-help">
            {t("settings.codeFontFamilyDesc")}
          </div>
        </div>
        <div className="settings-field settings-basic-item">
          <label className="settings-field-label" htmlFor="code-font-size">
            {t("settings.codeFontSize")}
          </label>
          <div className="settings-field-row">
            <input
              id="code-font-size"
              type="range"
              min={CODE_FONT_SIZE_MIN}
              max={CODE_FONT_SIZE_MAX}
              step={1}
              className="settings-input settings-input--range"
              value={codeFontSizeDraft}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                setCodeFontSizeDraft(nextValue);
                void handleCommitCodeFontSize(nextValue);
              }}
            />
            <div className="settings-scale-value">{codeFontSizeDraft}px</div>
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={() => {
                setCodeFontSizeDraft(CODE_FONT_SIZE_DEFAULT);
                void handleCommitCodeFontSize(CODE_FONT_SIZE_DEFAULT);
              }}
            >
              {t("settings.reset")}
            </button>
          </div>
          <div className="settings-help">
            {t("settings.codeFontSizeDesc")}
          </div>
        </div>
      </div>
    </div>
  );
}
