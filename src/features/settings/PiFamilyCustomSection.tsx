/** 自定义供应商 group — raw-text editor over models.json (pi) / models.yml
 *  (omp) with loose backend validation (extracted from PiFamilyAuthSection).
 *  All state stays with the parent; this file is presentational. */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import Boxes from "lucide-react/dist/esm/icons/boxes";
import Webhook from "lucide-react/dist/esm/icons/webhook";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import Search from "lucide-react/dist/esm/icons/search";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Check from "lucide-react/dist/esm/icons/check";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Input } from "@/components/base/input/input";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import type {
  PiFamilyCustomProviderSummary,
  PiFamilyModelsConfigReadResult,
} from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { BrandIcon, ROW } from "./PiFamilyAuthShared";

const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary disabled:opacity-40";

/** Pencil beside the name / URL text. Glyph and padding are both in `em`, so
 *  the button tracks the font of the text it belongs to (14px name, 11px URL)
 *  and therefore the interface font / zoom, instead of a fixed pixel box. */
const INLINE_EDIT_BUTTON =
  "flex shrink-0 items-center justify-center rounded p-[0.25em] text-foreground-icon-tertiary hover:text-foreground-icon-primary disabled:opacity-40";

/** The two provider fields the row can rewrite in place. `id` is the provider
 *  key itself — that key is what omp lists and what the model selector shows,
 *  so it doubles as the provider's display name (omp's models.yml has no
 *  provider-level `name` field; an unknown key is ignored by the CLI). */
export type CustomProviderField = "id" | "baseUrl";

interface InlineFieldEditorProps {
  value: string;
  placeholder: string;
  ariaLabel: string;
  saving: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** One-line field editor: Enter commits, Escape or leaving the field cancels.
 *  The confirm button prevents default on pointer-down so its click is not
 *  pre-empted by the input's blur-cancel. */
function InlineFieldEditor({
  value,
  placeholder,
  ariaLabel,
  saving,
  onDraftChange,
  onSave,
  onCancel,
}: InlineFieldEditorProps) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        autoFocus
        size="small"
        className="min-w-0 flex-1"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={onDraftChange}
        onKeyDown={(event) => {
          // Enter/Escape during IME composition belong to the IME.
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            onSave();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
      <button
        type="button"
        aria-label={t("settings.piAuthCustomFieldSave")}
        title={t("settings.piAuthCustomFieldSave")}
        disabled={saving}
        onPointerDown={(event) => event.preventDefault()}
        onClick={onSave}
        className={ICON_BUTTON}
      >
        <Check className="size-4" aria-hidden />
      </button>
    </span>
  );
}

function ProtocolIcon({ api }: { api: string }) {
  if (api.startsWith("anthropic-")) {
    return <img src={claudeIcon} alt="" className="size-3.5" aria-hidden />;
  }
  if (api.startsWith("openai-")) {
    return <img src={openaiIcon} alt="" className="size-3.5 dark:invert" aria-hidden />;
  }
  return <Webhook className="size-3.5" aria-hidden />;
}

interface ModelsConfigEditorProps {
  modelsConfig: PiFamilyModelsConfigReadResult | null;
  draft: string;
  saving: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function ModelsConfigEditor({
  modelsConfig,
  draft,
  saving,
  error,
  onDraftChange,
  onSave,
  onCancel,
}: ModelsConfigEditorProps) {
  const { t } = useTranslation();
  const focusTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    el?.focus();
  }, []);
  return (
    <div className="border-b border-separator-border px-2 py-3 last:border-b-0">
      <label
        className="mb-1.5 block text-body-2-medium text-text-secondary"
        htmlFor="pi-family-models-config-text"
      >
        {modelsConfig?.file.format === "yaml" ? "models.yml · YAML" : "models.json · JSONC"}
      </label>
      <textarea
        ref={focusTextarea}
        id="pi-family-models-config-text"
        value={draft}
        autoComplete="off"
        spellCheck={false}
        rows={16}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="w-full resize-y rounded-lg bg-background-tertiary p-2.5 font-mono text-[12px] leading-relaxed text-text-primary outline-none"
      />
      <p className="mt-1.5 text-body-2-regular text-text-tertiary">
        {t("settings.piAuthCustomEditorTips")}
      </p>
      {error ? (
        <p className="mt-1.5 text-body-2-regular text-text-error-primary" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="rounded-lg bg-accent-500 px-3 py-1 text-body-2-medium text-white disabled:opacity-50"
        >
          {saving ? t("settings.piAuthSaving") : t("settings.piAuthSave")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border-button-default px-3 py-1 text-body-2-medium text-text-primary"
        >
          {t("common.cancel")}
        </button>
        <span className="min-w-0 truncate text-body-2-regular text-text-tertiary">
          {t("settings.piAuthSaveHint", { path: modelsConfig?.file.path ?? "" })}
        </span>
      </div>
    </div>
  );
}

interface CustomProviderEditorProps {
  modelsConfig: PiFamilyModelsConfigReadResult | null;
  provider: PiFamilyCustomProviderSummary;
  draft: string;
  saving: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function CustomProviderEditor({
  modelsConfig,
  provider,
  draft,
  saving,
  error,
  onDraftChange,
  onSave,
  onCancel,
}: CustomProviderEditorProps) {
  const { t } = useTranslation();
  const focusTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    el?.focus();
  }, []);
  return (
    <div className="border-b border-separator-border px-2 py-3 last:border-b-0">
      <label
        className="mb-1.5 block text-body-2-medium text-text-secondary"
        htmlFor="pi-family-custom-provider-text"
      >
        {t("settings.piAuthCustomProviderEditorLabel", { id: provider.id })}
      </label>
      <textarea
        ref={focusTextarea}
        id="pi-family-custom-provider-text"
        value={draft}
        autoComplete="off"
        spellCheck={false}
        rows={16}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="w-full resize-y rounded-lg bg-background-tertiary p-2.5 font-mono text-[12px] leading-relaxed text-text-primary outline-none"
      />
      <p className="mt-1.5 text-body-2-regular text-text-tertiary">
        {t("settings.piAuthCustomProviderEditorTips")}
      </p>
      {error ? (
        <p className="mt-1.5 text-body-2-regular text-text-error-primary" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="rounded-lg bg-accent-500 px-3 py-1 text-body-2-medium text-white disabled:opacity-50"
        >
          {saving ? t("settings.piAuthSaving") : t("settings.piAuthSave")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border-button-default px-3 py-1 text-body-2-medium text-text-primary"
        >
          {t("common.cancel")}
        </button>
        <span className="min-w-0 truncate text-body-2-regular text-text-tertiary">
          {t("settings.piAuthSaveHint", { path: modelsConfig?.file.path ?? "" })}
        </span>
      </div>
    </div>
  );
}

interface PiFamilyCustomSectionProps {
  modelsConfig: PiFamilyModelsConfigReadResult | null;
  editorOpen: boolean;
  draft: string;
  saving: boolean;
  error: string | null;
  onToggleEditor: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  providers: PiFamilyCustomProviderSummary[];
  editingProviderId: string | null;
  providerDraft: string;
  providerSaving: boolean;
  providerError: string | null;
  onOpenProviderEditor: (id: string) => void;
  onProviderDraftChange: (value: string) => void;
  onProviderSave: () => void;
  onCloseProviderEditor: () => void;
  onDeleteProvider: (provider: PiFamilyCustomProviderSummary) => void;
  editingField: { id: string; field: CustomProviderField } | null;
  fieldDraft: string;
  fieldError: string | null;
  onOpenFieldEditor: (id: string, field: CustomProviderField) => void;
  onFieldDraftChange: (value: string) => void;
  onFieldSave: () => void;
  onCloseFieldEditor: () => void;
}

interface CustomProviderRowProps {
  provider: PiFamilyCustomProviderSummary;
  modelsConfig: PiFamilyModelsConfigReadResult | null;
  expanded: boolean;
  providerDraft: string;
  providerSaving: boolean;
  providerError: string | null;
  onOpenProviderEditor: (id: string) => void;
  onProviderDraftChange: (value: string) => void;
  onProviderSave: () => void;
  onCloseProviderEditor: () => void;
  onDeleteProvider: (provider: PiFamilyCustomProviderSummary) => void;
  editingField: { id: string; field: CustomProviderField } | null;
  fieldDraft: string;
  fieldError: string | null;
  onOpenFieldEditor: (id: string, field: CustomProviderField) => void;
  onFieldDraftChange: (value: string) => void;
  onFieldSave: () => void;
  onCloseFieldEditor: () => void;
}

/** One provider row plus its inline raw-text editor. */
function CustomProviderRow({
  provider,
  modelsConfig,
  expanded,
  providerDraft,
  providerSaving,
  providerError,
  onOpenProviderEditor,
  onProviderDraftChange,
  onProviderSave,
  onCloseProviderEditor,
  onDeleteProvider,
  editingField,
  fieldDraft,
  fieldError,
  onOpenFieldEditor,
  onFieldDraftChange,
  onFieldSave,
  onCloseFieldEditor,
}: CustomProviderRowProps) {
  const { t } = useTranslation();
  const keyLabel = t(
    provider.hasApiKey
      ? "settings.piAuthCustomHasKey"
      : "settings.piAuthCustomNoKey",
  );
  const editingName = editingField?.id === provider.id && editingField.field === "id";
  const editingUrl = editingField?.id === provider.id && editingField.field === "baseUrl";
  // The row shows the provider key: that is what omp lists, what the model
  // selector shows, and what the name pencil rewrites. A provider-level `name`
  // (omp's schema has none — a stray one is ignored by the CLI) stays out of
  // the display so the label and the pencil never disagree.
  const editLabel = (field: CustomProviderField) =>
    t(
      field === "id"
        ? "settings.piAuthCustomEditName"
        : "settings.piAuthCustomEditUrl",
      { name: provider.id },
    );
  const pencil = (field: CustomProviderField) => (
    <button
      type="button"
      aria-label={editLabel(field)}
      title={editLabel(field)}
      disabled={providerSaving}
      onClick={() => onOpenFieldEditor(provider.id, field)}
      className={INLINE_EDIT_BUTTON}
    >
      <Pencil className="size-[1em]" aria-hidden />
    </button>
  );

  return (
    <div>
      <div className={cx(ROW, expanded && "border-b-0")}>
        <BrandIcon iconSrc={null} />
        <div className="flex min-w-0 flex-1 flex-col">
          {editingName ? (
            <InlineFieldEditor
              value={fieldDraft}
              placeholder={provider.id}
              ariaLabel={editLabel("id")}
              saving={providerSaving}
              onDraftChange={onFieldDraftChange}
              onSave={onFieldSave}
              onCancel={onCloseFieldEditor}
            />
          ) : (
            <p className="flex min-w-0 items-center gap-1 text-body-regular text-text-primary">
              <span className="truncate">{provider.id}</span>
              {pencil("id")}
            </p>
          )}
          {editingUrl ? (
            <InlineFieldEditor
              value={fieldDraft}
              placeholder={t("settings.piAuthCustomUrlPlaceholder")}
              ariaLabel={editLabel("baseUrl")}
              saving={providerSaving}
              onDraftChange={onFieldDraftChange}
              onSave={onFieldSave}
              onCancel={onCloseFieldEditor}
            />
          ) : (
            <span className="flex min-w-0 items-center gap-1 text-[11px]">
              <code className="w-fit truncate rounded border border-dashed border-border-button-default px-1 py-px text-[11px] text-text-tertiary">
                {provider.baseUrl ?? provider.id}
              </code>
              {pencil("baseUrl")}
            </span>
          )}
        </div>
        <span
          className="flex shrink-0 items-center gap-1 text-body-2-regular text-text-tertiary"
          aria-label={t("settings.piAuthCustomModelCount", {
            count: provider.modelCount,
          })}
          title={t("settings.piAuthCustomModelCount", {
            count: provider.modelCount,
          })}
        >
          {provider.modelCount}
          <Boxes className="size-3.5" aria-hidden />
        </span>
        {provider.api ? (
          <span
            className="flex size-5 shrink-0 items-center justify-center text-text-tertiary"
            role="img"
            aria-label={provider.api}
            title={provider.api}
          >
            <ProtocolIcon api={provider.api} />
          </span>
        ) : null}
        <span
          className={cx(
            "flex size-5 shrink-0 items-center justify-center",
            provider.hasApiKey
              ? "text-notification-success-foreground"
              : "text-text-tertiary",
          )}
          role="img"
          aria-label={keyLabel}
          title={keyLabel}
        >
          <KeyRound className="size-3.5" aria-hidden />
        </span>
        <span aria-hidden className="h-4 w-px shrink-0 bg-separator-border" />
        <button
          type="button"
          aria-label={t("settings.cliEdit")}
          title={t("settings.cliEdit")}
          disabled={providerSaving}
          onClick={() => onOpenProviderEditor(provider.id)}
          className={ICON_BUTTON}
        >
          <Pencil className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("settings.cliDelete")}
          title={t("settings.cliDelete")}
          disabled={providerSaving}
          onClick={() => onDeleteProvider(provider)}
          className={cx(ICON_BUTTON, "hover:text-text-error-primary")}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
      {fieldError && (editingName || editingUrl) ? (
        <p className={cx(ROW, "text-body-2-regular text-text-error-primary")} role="alert">
          {fieldError}
        </p>
      ) : null}
      {expanded ? (
        <CustomProviderEditor
          modelsConfig={modelsConfig}
          provider={provider}
          draft={providerDraft}
          saving={providerSaving}
          error={providerError}
          onDraftChange={onProviderDraftChange}
          onSave={onProviderSave}
          onCancel={onCloseProviderEditor}
        />
      ) : null}
    </div>
  );
}

/** Section title, config path, search box, and the editor toggle. */
function CustomSectionHeader({
  path,
  totalCount,
  query,
  onQueryChange,
  editorOpen,
  onToggleEditor,
}: {
  path: string;
  totalCount: number;
  query: string;
  onQueryChange: (value: string) => void;
  editorOpen: boolean;
  onToggleEditor: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3">
      <SettingsSectionLabel anchor="piAuthCustom">
        {t("settings.piAuthCustomTitle")}
        <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
          {t("settings.piAuthCustomHint", { path })}
        </span>
      </SettingsSectionLabel>
      <div className="flex shrink-0 items-center gap-2">
        {totalCount > 0 ? (
          <div className="flex items-center gap-1.5 rounded-lg bg-background-tertiary px-2.5">
            <Search className="size-3.5 text-foreground-icon-secondary" aria-hidden />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={t("settings.piAuthCustomSearchPlaceholder")}
              className="h-8 w-44 bg-transparent text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>
        ) : null}
        <button
          type="button"
          className="shrink-0 rounded-lg border border-border-button-default px-2.5 py-1 text-body-2-medium text-text-primary hover:bg-background-secondary-hover"
          onClick={onToggleEditor}
        >
          {editorOpen ? t("settings.piAuthCollapse") : t("settings.piAuthEditConfig")}
        </button>
      </div>
    </div>
  );
}

/** Empty-state copy for the provider list (search miss / no file / no rows). */
function emptyStateMessage(
  t: TFunction,
  modelsConfig: PiFamilyModelsConfigReadResult,
  query: string,
): string {
  if (query.trim()) return t("settings.piAuthEmptySearch", { query });
  if (modelsConfig.providers.length > 0) return t("settings.piAuthEmptySearch", { query });
  return modelsConfig.file.exists
    ? t("settings.piAuthCustomEmpty")
    : t("settings.piAuthCustomMissing");
}

export function PiFamilyCustomSection({
  modelsConfig,
  editorOpen,
  draft,
  saving,
  error,
  onToggleEditor,
  onDraftChange,
  onSave,
  query,
  onQueryChange,
  providers,
  editingProviderId,
  providerDraft,
  providerSaving,
  providerError,
  onOpenProviderEditor,
  onProviderDraftChange,
  onProviderSave,
  onCloseProviderEditor,
  onDeleteProvider,
  editingField,
  fieldDraft,
  fieldError,
  onOpenFieldEditor,
  onFieldDraftChange,
  onFieldSave,
  onCloseFieldEditor,
}: PiFamilyCustomSectionProps) {
  const { t } = useTranslation();
  const totalCount = modelsConfig?.providers.length ?? 0;
  return (
    <div className="flex w-full flex-col gap-2">
      <CustomSectionHeader
        path={modelsConfig?.file.path ?? ""}
        totalCount={totalCount}
        query={query}
        onQueryChange={onQueryChange}
        editorOpen={editorOpen}
        onToggleEditor={onToggleEditor}
      />
      <SettingsCard>
        {modelsConfig?.parseError ? (
          <div className={cx(ROW, "text-body-regular text-text-error-primary")} role="alert">
            {t("settings.piAuthCustomParseError")}: {modelsConfig.parseError}
          </div>
        ) : null}
        {providerError && !editingProviderId ? (
          <div className={cx(ROW, "text-body-regular text-text-error-primary")} role="alert">
            {providerError}
          </div>
        ) : null}
        {providers.map((provider) => (
          <CustomProviderRow
            key={provider.id}
            provider={provider}
            modelsConfig={modelsConfig}
            expanded={editingProviderId === provider.id}
            providerDraft={providerDraft}
            providerSaving={providerSaving}
            providerError={providerError}
            onOpenProviderEditor={onOpenProviderEditor}
            onProviderDraftChange={onProviderDraftChange}
            onProviderSave={onProviderSave}
            onCloseProviderEditor={onCloseProviderEditor}
            onDeleteProvider={onDeleteProvider}
            editingField={editingField}
            fieldDraft={fieldDraft}
            fieldError={fieldError}
            onOpenFieldEditor={onOpenFieldEditor}
            onFieldDraftChange={onFieldDraftChange}
            onFieldSave={onFieldSave}
            onCloseFieldEditor={onCloseFieldEditor}
          />
        ))}
        {modelsConfig && !modelsConfig.parseError && providers.length === 0 ? (
          <div className={cx(ROW, "text-body-regular text-text-tertiary")}>
            {emptyStateMessage(t, modelsConfig, query)}
          </div>
        ) : null}
        {editorOpen ? (
          <ModelsConfigEditor
            modelsConfig={modelsConfig}
            draft={draft}
            saving={saving}
            error={error}
            onDraftChange={onDraftChange}
            onSave={onSave}
            onCancel={onToggleEditor}
          />
        ) : null}
        <div className="flex items-center gap-2 py-2 pr-2.5 text-[11px] text-text-tertiary">
          <code className="min-w-0 truncate">{modelsConfig?.file.path ?? ""}</code>
          <span className="shrink-0 rounded bg-background-tertiary px-1 py-px">0600</span>
        </div>
      </SettingsCard>
    </div>
  );
}
