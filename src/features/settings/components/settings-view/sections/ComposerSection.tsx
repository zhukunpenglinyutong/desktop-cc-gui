import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/types";
import { ModelMappingSettings } from "../../../../models/components/ModelMappingSettings";
import { HistoryCompletionSettings } from "../../HistoryCompletionSettings";
import {
  COMPOSER_PRESET_LABELS,
  type ComposerPreset,
} from "../actions/settingsViewActions";

type ComposerSectionProps = {
  active: boolean;
  t: (key: string) => string;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  handleComposerPresetChange: (preset: ComposerPreset) => void;
  handleComposerSendShortcutChange: (
    shortcut: AppSettings["composerSendShortcut"],
  ) => void;
  historyCompletionEnabled: boolean;
  handleHistoryCompletionToggle: () => void;
  reduceTransparency: boolean;
};

export function ComposerSection({
  active,
  t,
  appSettings,
  onUpdateAppSettings,
  handleComposerPresetChange,
  handleComposerSendShortcutChange,
  historyCompletionEnabled,
  handleHistoryCompletionToggle,
  reduceTransparency,
}: ComposerSectionProps) {
  if (!active) {
    return null;
  }

  return (
    <section className="settings-section w-full max-w-[980px]">
      <div className="settings-section-title text-[15px] font-semibold text-(--text-strong) mb-1">{t("settings.composerTitle")}</div>
      <div className="settings-section-subtitle text-xs text-(--text-subtle) mb-4">
        {t("settings.composerDescription")}
      </div>
      <div className="settings-subsection-title">{t("settings.sendShortcutSubtitle")}</div>
      <div className="settings-subsection-subtitle">
        {t("settings.sendShortcutSubDescription")}
      </div>
      <div
        className="settings-send-shortcut-grid"
        role="radiogroup"
        aria-label={t("settings.sendShortcutSubtitle")}
      >
        <button
          type="button"
          role="radio"
          aria-checked={appSettings.composerSendShortcut === "enter"}
          className={`settings-send-shortcut-option${
            appSettings.composerSendShortcut === "enter" ? " is-active" : ""
          }`}
          onClick={() => handleComposerSendShortcutChange("enter")}
        >
          <div className="settings-send-shortcut-option-title-row">
            <span className="settings-send-shortcut-option-title">
              {t("settings.sendShortcutEnterTitle")}
            </span>
            {appSettings.composerSendShortcut === "enter" && (
              <span className="settings-send-shortcut-option-check" aria-hidden>
                ✓
              </span>
            )}
          </div>
          <span className="settings-send-shortcut-option-desc">
            {t("settings.sendShortcutEnterDesc")}
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={appSettings.composerSendShortcut === "cmdEnter"}
          className={`settings-send-shortcut-option${
            appSettings.composerSendShortcut === "cmdEnter" ? " is-active" : ""
          }`}
          onClick={() => handleComposerSendShortcutChange("cmdEnter")}
        >
          <div className="settings-send-shortcut-option-title-row">
            <span className="settings-send-shortcut-option-title">
              {t("settings.sendShortcutCmdEnterTitle")}
            </span>
            {appSettings.composerSendShortcut === "cmdEnter" && (
              <span className="settings-send-shortcut-option-check" aria-hidden>
                ✓
              </span>
            )}
          </div>
          <span className="settings-send-shortcut-option-desc">
            {t("settings.sendShortcutCmdEnterDesc")}
          </span>
        </button>
      </div>
      <Separator className="my-4" />
      <div className="settings-subsection-title">{t("settings.presetsSubtitle")}</div>
      <div className="settings-subsection-subtitle">
        {t("settings.presetsSubDescription")}
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="composer-preset">
          {t("settings.preset")}
        </label>
        <select
          id="composer-preset"
          className="settings-select"
          value={appSettings.composerEditorPreset}
          onChange={(event) =>
            handleComposerPresetChange(
              event.target.value as ComposerPreset,
            )
          }
        >
          {Object.entries(COMPOSER_PRESET_LABELS(t)).map(([preset, label]) => (
            <option key={preset} value={preset}>
              {label}
            </option>
          ))}
        </select>
        <div className="settings-help">
          {t("settings.presetDesc")}
        </div>
      </div>
      <Separator className="my-4" />
      <div className="settings-subsection-title">{t("settings.codeFencesSubtitle")}</div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.expandFencesOnSpace")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.expandFencesOnSpaceDesc")}
          </div>
        </div>
        <Switch
          checked={appSettings.composerFenceExpandOnSpace}
          onCheckedChange={(checked) =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceExpandOnSpace: checked,
            })
          }
        />
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.expandFencesOnEnter")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.expandFencesOnEnterDesc")}
          </div>
        </div>
        <Switch
          checked={appSettings.composerFenceExpandOnEnter}
          onCheckedChange={(checked) =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceExpandOnEnter: checked,
            })
          }
        />
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.supportLanguageTags")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.supportLanguageTagsDesc")}
          </div>
        </div>
        <Switch
          checked={appSettings.composerFenceLanguageTags}
          onCheckedChange={(checked) =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceLanguageTags: checked,
            })
          }
        />
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.wrapSelectionInFences")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.wrapSelectionInFencesDesc")}
          </div>
        </div>
        <Switch
          checked={appSettings.composerFenceWrapSelection}
          onCheckedChange={(checked) =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceWrapSelection: checked,
            })
          }
        />
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.copyBlocksWithoutFences")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.copyBlocksWithoutFencesDesc")}
          </div>
        </div>
        <Switch
          checked={appSettings.composerCodeBlockCopyUseModifier}
          onCheckedChange={(checked) =>
            void onUpdateAppSettings({
              ...appSettings,
              composerCodeBlockCopyUseModifier: checked,
            })
          }
        />
      </div>
      <Separator className="my-4" />
      <div className="settings-subsection-title">{t("settings.pastingSubtitle")}</div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.autoWrapMultiLinePaste")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.autoWrapMultiLinePasteDesc")}
          </div>
        </div>
        <Switch
          checked={appSettings.composerFenceAutoWrapPasteMultiline}
          onCheckedChange={(checked) =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceAutoWrapPasteMultiline: checked,
            })
          }
        />
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.autoWrapCodeLikeSingleLines")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.autoWrapCodeLikeSingleLinesDesc")}
          </div>
        </div>
        <Switch
          checked={appSettings.composerFenceAutoWrapPasteCodeLike}
          onCheckedChange={(checked) =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceAutoWrapPasteCodeLike: checked,
            })
          }
        />
      </div>
      <Separator className="my-4" />
      <div className="settings-subsection-title">{t("settings.listsSubtitle")}</div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.continueListsOnShiftEnter")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.continueListsOnShiftEnterDesc")}
          </div>
        </div>
        <Switch
          checked={appSettings.composerListContinuation}
          onCheckedChange={(checked) =>
            void onUpdateAppSettings({
              ...appSettings,
              composerListContinuation: checked,
            })
          }
        />
      </div>
      <Separator className="my-4" />
      <div className="settings-subsection-title">{t("settings.historyCompletionSubtitle")}</div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.historyCompletion")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.historyCompletionDesc")}
          </div>
        </div>
        <Switch
          checked={historyCompletionEnabled}
          onCheckedChange={handleHistoryCompletionToggle}
        />
      </div>
      <HistoryCompletionSettings />
      <Separator className="my-4" />
      <ModelMappingSettings reduceTransparency={reduceTransparency} />
    </section>
  );
}
