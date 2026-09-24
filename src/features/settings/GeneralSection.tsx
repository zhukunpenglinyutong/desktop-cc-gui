import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Key, KeyboardEvent } from "react";

import { Select, SelectItem } from "@/components/base/select/select";
import { Input } from "@/components/base/input/input";
import { Button } from "@/components/base/buttons/button";
import { Switch } from "@/components/base/switch/switch";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { ConfirmDialog } from "@/components/dialogs";
import { ipc, type AppSettings, type PetSummary } from "@/lib/ipc";
import { petErrorMessage } from "@/features/pet/pet-errors";
import { IS_WINDOWS, pickDirectory } from "@/lib/platform";
import { applyTheme } from "./theme";
import { PromptHistoryManager, PromptHistoryToggleRow } from "./PromptHistorySettings";
import { useChatStore } from "@/features/chat/store";
import { PET_SCALE_OPTIONS, normalizePetScale } from "@/features/pet/pet-scale";

export const LANGUAGE_STORAGE_KEY = "ccgui-next.language";

/** Compact select trigger (h 32, radius/lg) per the Figma settings rows. */
const SELECT_TRIGGER = "h-8 w-auto gap-1 rounded-lg px-2 py-1.5";
/** Sidebar thread limit bounds (integers only). */
const THREAD_LIMIT_MIN = 1;
const THREAD_LIMIT_MAX = 30;
const THREAD_LIMIT_DEFAULT = 5;

/** App-settings state + persistence for the General page. Kept JSX-free so
 *  the component below only composes the cards. */
function useGeneralSettingsState() {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Raw digits while editing the thread limit; null = show the saved value.
  const [limitText, setLimitText] = useState<string | null>(null);
  // 窗口当前是否有系统装饰（isDecorated）；null = 还没读回来。
  const [decorated, setDecorated] = useState<boolean | null>(null);
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [petBusy, setPetBusy] = useState(false);
  // Pet pending destructive confirmation; null = no dialog open.
  const [removingPet, setRemovingPet] = useState<PetSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipc
      .getAppSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        applyTheme(s.theme);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    void ipc
      .listPets()
      .then(setPets)
      .catch((e) => console.warn("[settings] pet list failed", e));
    return () => {
      cancelled = true;
    };
  }, []);

  // "system" theme follows the OS via a listener bound at the app root
  // (App.tsx → bindSystemThemeSync), so it works without opening Settings.

  // Read-modify-write: the local `settings` descends from a mount-time
  // snapshot; persisting it whole would clobber concurrent edits (CLI config
  // page, chat-side model pinning). Apply each patch onto a fresh read.
  const save = useCallback(async (patch: Partial<AppSettings>): Promise<boolean> => {
    try {
      const latest = await ipc.getAppSettings();
      const next = { ...latest, ...patch };
      await ipc.updateAppSettings(next);
      setSettings(next);
      setError(null);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

  const onThemeChange = (key: Key | null) => {
    if (!settings || key == null) return;
    const theme = String(key);
    setSettings({ ...settings, theme });
    applyTheme(theme);
    void save({ theme });
  };

  // 「窗口现在有没有系统装饰」= 当前实际生效的标题栏样式，用来判断设置是否
  // 需要重启才生效（restart 按钮的可用态）。仅 Windows 需要。
  useEffect(() => {
    if (!IS_WINDOWS) return;
    let alive = true;
    getCurrentWindow()
      .isDecorated()
      .then((value) => {
        if (alive) setDecorated(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const onTitlebarChange = (key: Key | null) => {
    if (!settings || key == null) return;
    const titlebar = String(key);
    setSettings({ ...settings, titlebar });
    void save({ titlebar });
  };

  const onLanguageChange = (key: Key | null) => {
    if (!settings || key == null) return;
    const language = String(key);
    setSettings({ ...settings, language });
    void i18n.changeLanguage(language);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    void save({ language });
  };
  const commitThreadLimit = (n: number) => {
    if (!settings || n === settings.sidebarThreadLimit) return;
    setSettings({ ...settings, sidebarThreadLimit: n });
    useChatStore.getState().setThreadLimit(n);
    void save({ sidebarThreadLimit: n });
  };
  // Typing only edits the raw text; committing per keystroke would fire a
  // settings write per digit. Commit on blur or Enter instead.
  const onThreadLimitChange = (v: string) => {
    if (!settings) return;
    setLimitText(v.replace(/\D/g, ""));
  };
  const commitThreadLimitText = () => {
    if (settings && limitText) {
      const n = Number(limitText);
      commitThreadLimit(Math.min(THREAD_LIMIT_MAX, Math.max(THREAD_LIMIT_MIN, n)));
    }
    setLimitText(null);
  };
  const onThreadLimitKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitThreadLimitText();
      (e.target as HTMLElement).blur();
    }
  };

  const onSendShortcutChange = (key: Key | null) => {
    if (!settings || key == null) return;
    const composerSendShortcut = String(key);
    setSettings({ ...settings, composerSendShortcut });
    useChatStore.getState().setSendShortcut(composerSendShortcut);
    void save({ composerSendShortcut });
  };
  const onThinkingAutoCollapseChange = (autoCollapse: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, thinkingAutoCollapse: autoCollapse });
    useChatStore.getState().setThinkingAutoCollapse(autoCollapse);
    void save({ thinkingAutoCollapse: autoCollapse });
  };
  const onThinkingAutoExpandChange = (autoExpand: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, thinkingAutoExpand: autoExpand });
    useChatStore.getState().setThinkingAutoExpand(autoExpand);
    void save({ thinkingAutoExpand: autoExpand });
  };
  const onPetEnabledChange = (enabled: boolean) => {
    if (!settings) return;
    if (enabled && !pets.some((pet) => pet.id === settings.petId)) {
      setError(t("settings.petImportRequired"));
      return;
    }
    setSettings({ ...settings, petEnabled: enabled });
    void save({ petEnabled: enabled }).then((ok) => {
      if (ok) void ipc.setPetVisible(enabled).catch((e) => setError(petErrorMessage(e, t)));
    });
  };
  const onPetScaleChange = async (key: Key | null) => {
    if (!settings || key == null) return;
    const next = normalizePetScale(Number(key));
    const previous = normalizePetScale(settings.petScale);
    if (next === previous) return;
    setSettings({ ...settings, petScale: next });
    try {
      const applied = await ipc.setPetScale(next);
      setSettings((current) => (current ? { ...current, petScale: normalizePetScale(applied) } : current));
      setError(null);
    } catch (e) {
      setSettings((current) => (current ? { ...current, petScale: previous } : current));
      setError(petErrorMessage(e, t));
    }
  };
  const onPetChange = async (key: Key | null) => {
    if (!settings || key == null) return;
    const petId = String(key);
    setSettings({ ...settings, petId });
    const saved = await save({ petId });
    if (!saved) return;
    // Recreate the overlay so the selected package is loaded immediately.
    try {
      await ipc.setPetVisible(false);
      await ipc.setPetVisible(settings.petEnabled ?? false);
    } catch (e) {
      setError(petErrorMessage(e, t));
    }
  };
  const importPet = async () => {
    const path = await pickDirectory(t("settings.petImportHint"));
    if (!path) return;
    setPetBusy(true);
    try {
      const imported = await ipc.importPet(path);
      setPets((current) => [...current.filter((pet) => pet.id !== imported.id), imported]);
      setSettings((current) => (current ? { ...current, petId: imported.id } : current));
      const saved = await save({ petId: imported.id });
      if (saved && settings?.petEnabled) {
        await ipc.setPetVisible(false);
        await ipc.setPetVisible(true);
      }
    } catch (e) {
      setError(`${t("settings.petImportFailed")}: ${petErrorMessage(e, t)}`);
    } finally {
      setPetBusy(false);
    }
  };
  const removePet = async (pet: PetSummary) => {
    try {
      await ipc.removePet(pet.id);
      setPets((current) => current.filter((item) => item.id !== pet.id));
      if (settings?.petId === pet.id) {
        if (settings.petEnabled) await ipc.setPetVisible(false).catch(() => {});
        await save({ petId: "", petEnabled: false });
      }
    } catch (e) {
      setError(petErrorMessage(e, t));
    }
  };
  const selectedPetId = settings?.petId?.trim() ?? "";
  const selectedPet = pets.find((pet) => pet.id === selectedPetId);
  return {
    settings,
    error,
    limitText,
    decorated,
    pets,
    petBusy,
    removingPet,
    setRemovingPet,
    removePet,
    selectedPetId,
    selectedPet,
    onThemeChange,
    onTitlebarChange,
    onLanguageChange,
    onThreadLimitChange,
    commitThreadLimitText,
    onThreadLimitKeyDown,
    onSendShortcutChange,
    onThinkingAutoCollapseChange,
    onThinkingAutoExpandChange,
    onPetEnabledChange,
    onPetScaleChange,
    onPetChange,
    importPet,
  };
}

/** Appearance card: theme, Windows titlebar + restart, language, thread limit. */
function AppearanceCard({
  settings,
  limitText,
  decorated,
  onThemeChange,
  onTitlebarChange,
  onLanguageChange,
  onThreadLimitChange,
  onThreadLimitCommit,
  onThreadLimitKeyDown,
}: {
  settings: AppSettings;
  limitText: string | null;
  decorated: boolean | null;
  onThemeChange: (key: Key | null) => void;
  onTitlebarChange: (key: Key | null) => void;
  onLanguageChange: (key: Key | null) => void;
  onThreadLimitChange: (value: string) => void;
  onThreadLimitCommit: () => void;
  onThreadLimitKeyDown: (event: KeyboardEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col gap-2">
      <SettingsSectionLabel>{t("settings.appearance")}</SettingsSectionLabel>
      <SettingsCard>
        <SettingsRow label={t("settings.theme")}>
          <Select
            aria-label={t("settings.theme")}
            selectedKey={settings.theme}
            onSelectionChange={onThemeChange}
            triggerClassName={SELECT_TRIGGER}
          >
            <SelectItem id="system">{t("settings.themeSystem")}</SelectItem>
            <SelectItem id="light">{t("settings.themeLight")}</SelectItem>
            <SelectItem id="dark">{t("settings.themeDark")}</SelectItem>
          </Select>
        </SettingsRow>
        {IS_WINDOWS && (
          <SettingsRow
            label={t("settings.titlebar")}
            description={t("settings.titlebarRestartHint")}
          >
            <div className="flex items-center gap-2">
              <Select
                aria-label={t("settings.titlebar")}
                selectedKey={settings.titlebar}
                onSelectionChange={onTitlebarChange}
                triggerClassName={SELECT_TRIGGER}
              >
                <SelectItem id="native">{t("settings.titlebarNative")}</SelectItem>
                <SelectItem id="mac">{t("settings.titlebarMac")}</SelectItem>
              </Select>
              <Button
                size="small"
                variant="ghost"
                disabled={
                  decorated === null || (settings.titlebar === "native") === decorated
                }
                onClick={() => void ipc.restartApp()}
              >
                {t("settings.restartNow")}
              </Button>
            </div>
          </SettingsRow>
        )}
        <SettingsRow label={t("settings.language")}>
          <Select
            aria-label={t("settings.language")}
            selectedKey={settings.language}
            onSelectionChange={onLanguageChange}
            triggerClassName={SELECT_TRIGGER}
          >
            <SelectItem id="zh">{t("settings.langZh")}</SelectItem>
            <SelectItem id="en">{t("settings.langEn")}</SelectItem>
          </Select>
        </SettingsRow>
        <SettingsRow label={t("settings.sidebarThreadLimit")}>
          <Input
            aria-label={t("settings.sidebarThreadLimit")}
            size="small"
            className="w-20"
            inputClassName="text-center"
            inputMode="numeric"
            value={
              limitText ??
              String(settings.sidebarThreadLimit ?? THREAD_LIMIT_DEFAULT)
            }
            onChange={onThreadLimitChange}
            onBlur={onThreadLimitCommit}
            onKeyDown={onThreadLimitKeyDown}
          />
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}

/** Pet card: overlay toggle, package select/import/remove, and scale. */
function PetCard({
  settings,
  pets,
  petBusy,
  selectedPetId,
  selectedPet,
  onPetEnabledChange,
  onPetScaleChange,
  onPetChange,
  onImportPet,
  onRemovePet,
}: {
  settings: AppSettings;
  pets: PetSummary[];
  petBusy: boolean;
  selectedPetId: string;
  selectedPet: PetSummary | undefined;
  onPetEnabledChange: (enabled: boolean) => void;
  onPetScaleChange: (key: Key | null) => void;
  onPetChange: (key: Key | null) => void;
  onImportPet: () => Promise<void>;
  onRemovePet: (pet: PetSummary) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col gap-2">
      <SettingsSectionLabel>{t("settings.pet")}</SettingsSectionLabel>
      <SettingsCard>
        <SettingsRow
          label={t("settings.petEnabled")}
          description={t("settings.petEnabledDesc")}
        >
          <Switch
            size="sm"
            aria-label={t("settings.petEnabled")}
            isSelected={settings.petEnabled ?? false}
            isDisabled={!selectedPet || petBusy}
            onChange={onPetEnabledChange}
          />
        </SettingsRow>
        {!selectedPet && (
          <p className="px-3 pb-2 text-body-2-regular text-text-tertiary">
            {t("settings.petImportRequired")}
          </p>
        )}
        <SettingsRow label={t("settings.petCharacter")}>
          <div className="flex items-center gap-2">
            <Select
              aria-label={t("settings.petCharacter")}
              selectedKey={selectedPetId || null}
              isDisabled={pets.length === 0 || petBusy}
              onSelectionChange={onPetChange}
              triggerClassName={SELECT_TRIGGER}
            >
              {pets.map((pet) => (
                <SelectItem key={pet.id} id={pet.id} textValue={pet.displayName}>
                  {pet.displayName}
                </SelectItem>
              ))}
            </Select>
            <Button size="small" variant="secondary" onClick={() => void onImportPet()} disabled={petBusy}>
              {t("settings.petImport")}
            </Button>
            {selectedPet && (
              <Button
                size="small"
                variant="ghost"
                onClick={() => void onRemovePet(selectedPet)}
              >
                {t("settings.petRemove")}
              </Button>
            )}
          </div>
        </SettingsRow>
        <SettingsRow
          label={t("settings.petScale")}
        >
          <Select
            aria-label={t("settings.petScale")}
            selectedKey={String(normalizePetScale(settings.petScale))}
            onSelectionChange={onPetScaleChange}
            triggerClassName={SELECT_TRIGGER}
          >
            {PET_SCALE_OPTIONS.map((value) => (
              <SelectItem key={value} id={String(value)} textValue={`${value * 100}%`}>
                {t("settings.petScaleValue", { percent: value * 100 })}
              </SelectItem>
            ))}
          </Select>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}

/** Behavior card: composer send shortcut, thinking auto-collapse, prompt
 *  history. */
function BehaviorCard({
  settings,
  onSendShortcutChange,
  onThinkingAutoCollapseChange,
  onThinkingAutoExpandChange,
}: {
  settings: AppSettings;
  onSendShortcutChange: (key: Key | null) => void;
  onThinkingAutoCollapseChange: (autoCollapse: boolean) => void;
  onThinkingAutoExpandChange: (autoExpand: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col gap-2">
      <SettingsSectionLabel>{t("settings.behavior")}</SettingsSectionLabel>
      <SettingsCard>
        <SettingsRow label={t("settings.sendShortcut")}>
          <Select
            aria-label={t("settings.sendShortcut")}
            selectedKey={settings.composerSendShortcut ?? "enter"}
            onSelectionChange={onSendShortcutChange}
            triggerClassName={SELECT_TRIGGER}
          >
            <SelectItem id="enter">{t("settings.sendShortcutEnter")}</SelectItem>
            {/* macOS sends with ⌘+Enter, other platforms Ctrl+Enter
                (composer-editable reads metaKey || ctrlKey). */}
            <SelectItem id="cmdEnter">
              {t(navigator.platform.includes("Mac")
                ? "settings.sendShortcutCmdEnter"
                : "settings.sendShortcutCmdEnterCtrl")}
            </SelectItem>
          </Select>
        </SettingsRow>

        <SettingsRow
          label={t("settings.thinkingAutoExpand")}
          description={t("settings.thinkingAutoExpandDesc")}
        >
          <Switch
            size="sm"
            aria-label={t("settings.thinkingAutoExpand")}
            isSelected={settings.thinkingAutoExpand ?? true}
            onChange={onThinkingAutoExpandChange}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.thinkingAutoCollapse")}
          description={t("settings.thinkingAutoCollapseDesc")}
        >
          <Switch
            size="sm"
            aria-label={t("settings.thinkingAutoCollapse")}
            isSelected={settings.thinkingAutoCollapse ?? true}
            onChange={onThinkingAutoCollapseChange}
          />
        </SettingsRow>
        <PromptHistoryToggleRow />
      </SettingsCard>
    </div>
  );
}

/** General page: appearance (theme/language/thread limit) + behavior
 *  (composer send shortcut). */
export function GeneralSection() {
  const { t } = useTranslation();
  const {
    settings,
    error,
    limitText,
    decorated,
    pets,
    petBusy,
    removingPet,
    setRemovingPet,
    removePet,
    selectedPetId,
    selectedPet,
    onThemeChange,
    onTitlebarChange,
    onLanguageChange,
    onThreadLimitChange,
    commitThreadLimitText,
    onThreadLimitKeyDown,
    onSendShortcutChange,
    onThinkingAutoCollapseChange,
    onThinkingAutoExpandChange,
    onPetEnabledChange,
    onPetScaleChange,
    onPetChange,
    importPet,
  } = useGeneralSettingsState();

  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}
      {!settings && !error && (
        <p className="text-body-regular text-text-tertiary">{t("common.loading")}</p>
      )}
      {settings && (
        <AppearanceCard
          settings={settings}
          limitText={limitText}
          decorated={decorated}
          onThemeChange={onThemeChange}
          onTitlebarChange={onTitlebarChange}
          onLanguageChange={onLanguageChange}
          onThreadLimitChange={onThreadLimitChange}
          onThreadLimitCommit={commitThreadLimitText}
          onThreadLimitKeyDown={onThreadLimitKeyDown}
        />
      )}
      {settings && (
        <PetCard
          settings={settings}
          pets={pets}
          petBusy={petBusy}
          selectedPetId={selectedPetId}
          selectedPet={selectedPet}
          onPetEnabledChange={onPetEnabledChange}
          onPetScaleChange={onPetScaleChange}
          onPetChange={onPetChange}
          onImportPet={importPet}
          onRemovePet={removePet}
        />
      )}
      {settings && (
        <BehaviorCard
          settings={settings}
          onSendShortcutChange={onSendShortcutChange}
          onThinkingAutoCollapseChange={onThinkingAutoCollapseChange}
          onThinkingAutoExpandChange={onThinkingAutoExpandChange}
        />
      )}
      {settings && <PromptHistoryManager />}
      {removingPet && (
        <ConfirmDialog
          danger
          message={t("settings.petRemoveConfirm", { name: removingPet.displayName })}
          onCancel={() => setRemovingPet(null)}
          onConfirm={() => {
            const pet = removingPet;
            setRemovingPet(null);
            void removePet(pet);
          }}
        />
      )}
    </div>
  );
}
