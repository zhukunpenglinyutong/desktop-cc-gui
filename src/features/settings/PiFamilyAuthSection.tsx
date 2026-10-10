/**
 * pi/omp「供应商认证」区块 — ported from the reference desktop-cc-gui's
 * PiProviderAuthSection.tsx, generalized over the pi family (pi + omp) and
 * restyled onto this repo's settings rows (no custom CSS).
 *
 * - 订阅授权 group (PiFamilyOauthSection): read-only OAuth status + a 登录
 *   button that hands the interactive flow to the built-in terminal
 *   (`launchPiFamilyLogin`).
 * - API Key group (PiFamilyApiKeySection): search / featured-vs-all /
 *   three-state rows / inline key editor / delete with confirmation. Keys
 *   never round-trip to the frontend — list carries only a masked display
 *   string.
 * - 自定义供应商 group (PiFamilyCustomSection): raw-text editor over
 *   models.json (pi) / models.yml (omp) with loose backend validation.
 *
 * State is component-local: refresh on mount, after writes, and on window
 * focus (the OAuth flow completes in the terminal, outside this component).
 * After every write `notifyCliConfigChanged()` re-probes the chat model
 * catalogs — the CLIs filter available models by stored credentials.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/dialogs";
import {
  ipc,
  type PiFamilyAuthListResult,
  type PiFamilyAuthProviderSnapshot,
  type PiFamilyCustomProviderSummary,
  type PiFamilyModelsConfigReadResult,
} from "@/lib/ipc";
import {
  PI_FAMILY_APIKEY_PROVIDERS,
  PI_FAMILY_OAUTH_PROVIDERS,
  type PiFamilyAuthUiProvider,
  type PiFamilyOauthProvider,
} from "./piFamilyAuthCatalog";
import { PiFamilyApiKeySection } from "./PiFamilyApiKeySection";
import {
  PiFamilyCustomSection,
  type CustomProviderField,
} from "./PiFamilyCustomSection";
import {
  extractProviderBlock,
  removeProviderBlock,
  replaceProviderBlock,
  setProviderField,
} from "./piFamilyModelsBlocks";
import { launchPiFamilyLogin } from "./piFamilyLogin";
import { PiFamilyOauthSection } from "./PiFamilyOauthSection";
import { notifyCliConfigChanged } from "./providers";

/** All credential-store / custom-provider state and handlers. Kept JSX-free so
 *  the component below only composes the three groups and their dialogs. */
function usePiFamilyAuthState(
  engine: "pi" | "omp",
  openCustomEditorSignal?: number,
) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<PiFamilyAuthListResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftVisible, setDraftVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PiFamilyAuthUiProvider | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ── custom providers (models.json / models.yml) ──
  const [modelsConfig, setModelsConfig] = useState<PiFamilyModelsConfigReadResult | null>(null);
  const [modelsEditorOpen, setModelsEditorOpen] = useState(false);
  const [modelsDraft, setModelsDraft] = useState("");
  const [modelsSaving, setModelsSaving] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [customQuery, setCustomQuery] = useState("");
  const [customEditingId, setCustomEditingId] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState("");
  const [customSaving, setCustomSaving] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customDeleteTarget, setCustomDeleteTarget] = useState<PiFamilyCustomProviderSummary | null>(null);
  const [customEditingField, setCustomEditingField] = useState<{
    id: string;
    field: CustomProviderField;
  } | null>(null);
  const [customFieldDraft, setCustomFieldDraft] = useState("");
  const [customFieldError, setCustomFieldError] = useState<string | null>(null);

  const oauthProviders = PI_FAMILY_OAUTH_PROVIDERS[engine];
  const storePath = snapshot?.store.path ?? "";

  const refresh = useCallback(async () => {
    try {
      const [authResult, modelsResult] = await Promise.all([
        ipc.piFamilyAuthList(engine),
        ipc.piFamilyModelsConfigRead(engine),
      ]);
      setSnapshot(authResult);
      setModelsConfig(modelsResult);
      setLoadError(null);
    } catch (error) {
      setLoadError(String(error));
    }
  }, [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // OAuth completes in the terminal, so the credential store changes behind
  // this component's back: refresh on window focus (event-driven, no polling).
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const byId = useMemo(() => {
    const map = new Map<string, PiFamilyAuthProviderSnapshot>();
    for (const item of snapshot?.providers ?? []) {
      map.set(item.id, item);
    }
    return map;
  }, [snapshot]);

  const oauthActive = useMemo(() => new Set(snapshot?.oauthProviders ?? []), [snapshot]);

  const visibleProviders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return PI_FAMILY_APIKEY_PROVIDERS.filter((provider) => {
      if (!showAll && !provider.featured && !normalized) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const envVar = byId.get(provider.id)?.envVar ?? "";
      return (
        provider.name.toLowerCase().includes(normalized) ||
        provider.id.includes(normalized) ||
        envVar.toLowerCase().includes(normalized)
      );
    });
  }, [query, showAll, byId]);

  const visibleCustomProviders = useMemo(() => {
    const normalized = customQuery.trim().toLowerCase();
    const providers = modelsConfig?.providers ?? [];
    if (!normalized) {
      return providers;
    }
    return providers.filter((provider) =>
      [provider.id, provider.name ?? "", provider.baseUrl ?? "", provider.api ?? ""]
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [customQuery, modelsConfig]);

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setDraftKey("");
    setDraftVisible(false);
    setActionError(null);
  }, []);

  const openEditor = useCallback(
    (id: string) => {
      if (editingId === id) {
        closeEditor();
        return;
      }
      setEditingId(id);
      setDraftKey("");
      setDraftVisible(false);
      setActionError(null);
    },
    [editingId, closeEditor],
  );

  const handleSave = useCallback(
    async (provider: PiFamilyAuthUiProvider) => {
      const key = draftKey.trim();
      if (!key) {
        // Empty = cancel, leave the credential untouched.
        closeEditor();
        return;
      }
      setSaving(true);
      setActionError(null);
      try {
        await ipc.piFamilyAuthSetApiKey(engine, provider.id, key);
        // Credentials gate the CLI's live model catalog — make the chat
        // pickers re-probe.
        notifyCliConfigChanged();
        closeEditor();
        await refresh();
      } catch (error) {
        setActionError(String(error));
      } finally {
        setSaving(false);
      }
    },
    [engine, draftKey, closeEditor, refresh],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      await ipc.piFamilyAuthDeleteCredential(engine, deleteTarget.id);
      notifyCliConfigChanged();
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      setDeleteTarget(null);
      setActionError(String(error));
    }
  }, [engine, deleteTarget, refresh]);

  const closeCustomProviderEditor = useCallback(() => {
    setCustomEditingId(null);
    setCustomDraft("");
    setCustomError(null);
  }, []);

  const closeCustomFieldEditor = useCallback(() => {
    setCustomEditingField(null);
    setCustomFieldDraft("");
    setCustomFieldError(null);
  }, []);

  const showModelsEditor = useCallback(
    (error: string | null = null) => {
      closeCustomProviderEditor();
      closeCustomFieldEditor();
      const existing = modelsConfig?.text ?? "";
      setModelsDraft(existing.trim() ? existing : (modelsConfig?.template ?? ""));
      setModelsError(error);
      setModelsEditorOpen(true);
    },
    [closeCustomFieldEditor, closeCustomProviderEditor, modelsConfig],
  );

  const openModelsEditor = useCallback(() => {
    if (modelsEditorOpen) {
      setModelsEditorOpen(false);
      setModelsDraft("");
      setModelsError(null);
      return;
    }
    showModelsEditor();
  }, [modelsEditorOpen, showModelsEditor]);

  const openCustomProviderEditor = useCallback(
    (id: string) => {
      if (customEditingId === id) {
        closeCustomProviderEditor();
        return;
      }
      const format = modelsConfig?.file.format ?? "yaml";
      const block = extractProviderBlock(modelsConfig?.text ?? "", format, id);
      if (!block) {
        showModelsEditor(t("settings.piAuthCustomEditNotFound", { id }));
        return;
      }
      setModelsEditorOpen(false);
      setModelsDraft("");
      setModelsError(null);
      setCustomEditingId(id);
      setCustomDraft(block.text);
      setCustomError(null);
    },
    [closeCustomProviderEditor, customEditingId, modelsConfig, showModelsEditor, t],
  );

  const handleCustomProviderSave = useCallback(async () => {
    if (!customEditingId || !modelsConfig?.text) {
      return;
    }
    setCustomSaving(true);
    setCustomError(null);
    try {
      const format = modelsConfig.file.format;
      const block = extractProviderBlock(modelsConfig.text, format, customEditingId);
      if (!block) {
        setCustomError(t("settings.piAuthCustomEditNotFound", { id: customEditingId }));
        return;
      }
      const nextText = replaceProviderBlock(modelsConfig.text, block, customDraft);
      if (!extractProviderBlock(nextText, format, customEditingId)) {
        setCustomError(t("settings.piAuthCustomEditProviderMissing", { id: customEditingId }));
        return;
      }
      await ipc.piFamilyModelsConfigWrite(engine, nextText);
      notifyCliConfigChanged();
      closeCustomProviderEditor();
      await refresh();
    } catch (error) {
      setCustomError(String(error));
    } finally {
      setCustomSaving(false);
    }
  }, [closeCustomProviderEditor, customDraft, customEditingId, engine, modelsConfig, refresh, t]);

  const openCustomFieldEditor = useCallback(
    (id: string, field: CustomProviderField) => {
      if (customEditingField?.id === id && customEditingField.field === field) {
        closeCustomFieldEditor();
        return;
      }
      const provider = modelsConfig?.providers.find((item) => item.id === id);
      if (!provider) {
        return;
      }
      closeCustomProviderEditor();
      setCustomEditingField({ id, field });
      setCustomFieldDraft(
        field === "baseUrl" ? (provider.baseUrl ?? "") : provider.id,
      );
      setCustomFieldError(null);
    },
    [closeCustomFieldEditor, closeCustomProviderEditor, customEditingField, modelsConfig],
  );

  const handleCustomFieldSave = useCallback(async () => {
    if (!customEditingField || !modelsConfig?.text) {
      return;
    }
    const { id, field } = customEditingField;
    const value = customFieldDraft.trim();
    if (field === "baseUrl" && value === "") {
      setCustomFieldError(t("settings.piAuthCustomFieldEmptyUrl"));
      return;
    }
    if (field === "id" && value === "") {
      setCustomFieldError(t("settings.piAuthCustomFieldEmptyId"));
      return;
    }
    if (
      field === "id" &&
      modelsConfig.providers.some((item) => item.id !== id && item.id === value)
    ) {
      setCustomFieldError(t("settings.piAuthCustomFieldDuplicateId", { id: value }));
      return;
    }
    setCustomSaving(true);
    setCustomFieldError(null);
    try {
      const nextText = setProviderField(
        modelsConfig.text,
        modelsConfig.file.format,
        id,
        field,
        value,
      );
      if (!nextText) {
        setCustomFieldError(t("settings.piAuthCustomEditNotFound", { id }));
        return;
      }
      if (nextText === modelsConfig.text) {
        closeCustomFieldEditor();
        return;
      }
      await ipc.piFamilyModelsConfigWrite(engine, nextText);
      notifyCliConfigChanged();
      closeCustomFieldEditor();
      await refresh();
    } catch (error) {
      setCustomFieldError(String(error));
    } finally {
      setCustomSaving(false);
    }
  }, [
    closeCustomFieldEditor,
    customEditingField,
    customFieldDraft,
    engine,
    modelsConfig,
    refresh,
    t,
  ]);

  const handleCustomProviderDelete = useCallback(async () => {
    const target = customDeleteTarget;
    if (!target || !modelsConfig?.text) {
      return;
    }
    setCustomSaving(true);
    setCustomError(null);
    try {
      const format = modelsConfig.file.format;
      const block = extractProviderBlock(modelsConfig.text, format, target.id);
      if (!block) {
        setCustomError(t("settings.piAuthCustomEditNotFound", { id: target.id }));
        return;
      }
      const nextText = removeProviderBlock(modelsConfig.text, block, format);
      await ipc.piFamilyModelsConfigWrite(engine, nextText);
      notifyCliConfigChanged();
      setCustomDeleteTarget(null);
      if (customEditingId === target.id) {
        closeCustomProviderEditor();
      }
      if (customEditingField?.id === target.id) {
        closeCustomFieldEditor();
      }
      await refresh();
    } catch (error) {
      setCustomDeleteTarget(null);
      setCustomError(String(error));
    } finally {
      setCustomSaving(false);
    }
  }, [closeCustomFieldEditor, closeCustomProviderEditor, customDeleteTarget, customEditingField, customEditingId, engine, modelsConfig, refresh, t]);

  // The 官方配置 row's 编辑 entry bumps this signal to open the models
  // editor. Adjusting state during render (React's recommended pattern,
  // comparing against the previous signal) fires exactly once per bump —
  // modelsConfig refreshes can't re-fire it while the signal stays set.
  const openSignal = openCustomEditorSignal ?? 0;
  const [prevOpenSignal, setPrevOpenSignal] = useState(openSignal);
  if (openSignal !== prevOpenSignal) {
    setPrevOpenSignal(openSignal);
    const existing = modelsConfig?.text ?? "";
    setModelsDraft(existing.trim() ? existing : (modelsConfig?.template ?? ""));
    setModelsError(null);
    setModelsEditorOpen(true);
  }

  const handleModelsSave = useCallback(async () => {
    setModelsSaving(true);
    setModelsError(null);
    try {
      await ipc.piFamilyModelsConfigWrite(engine, modelsDraft);
      // Custom providers join the CLI's model catalog too.
      notifyCliConfigChanged();
      setModelsEditorOpen(false);
      setModelsDraft("");
      await refresh();
    } catch (error) {
      setModelsError(String(error));
    } finally {
      setModelsSaving(false);
    }
  }, [engine, modelsDraft, refresh]);

  // The CLI owns the interactive OAuth flow: close the settings overlay so
  // the user sees the terminal the login runs in.
  const handleLaunchLogin = useCallback(
    (provider: PiFamilyOauthProvider) => {
      void launchPiFamilyLogin(engine, provider.loginArg).then((launched) => {
        if (launched) {
          navigate("/");
        } else {
          setNotice(t("settings.piAuthLoginNoWorkspace"));
        }
      });
    },
    [engine, navigate, t],
  );

  const toggleShowAll = useCallback(() => setShowAll((value) => !value), []);
  const toggleDraftVisible = useCallback(() => setDraftVisible((visible) => !visible), []);

  return {
    notice,
    oauthProviders,
    oauthActive,
    handleLaunchLogin,
    loadError,
    storePath,
    query,
    setQuery,
    showAll,
    toggleShowAll,
    visibleProviders,
    byId,
    editingId,
    openEditor,
    deleteTarget,
    setDeleteTarget,
    handleDelete,
    draftKey,
    setDraftKey,
    draftVisible,
    toggleDraftVisible,
    saving,
    actionError,
    handleSave,
    closeEditor,
    modelsConfig,
    modelsEditorOpen,
    modelsDraft,
    setModelsDraft,
    modelsSaving,
    modelsError,
    openModelsEditor,
    handleModelsSave,
    customQuery,
    setCustomQuery,
    visibleCustomProviders,
    customEditingId,
    customDraft,
    setCustomDraft,
    customSaving,
    customError,
    openCustomProviderEditor,
    handleCustomProviderSave,
    closeCustomProviderEditor,
    customDeleteTarget,
    setCustomDeleteTarget,
    handleCustomProviderDelete,
    customEditingField,
    customFieldDraft,
    setCustomFieldDraft,
    customFieldError,
    openCustomFieldEditor,
    handleCustomFieldSave,
    closeCustomFieldEditor,
  };
}

export function PiFamilyAuthSection({
  engine,
  openCustomEditorSignal,
}: {
  engine: "pi" | "omp";
  /** Bump to open the 自定义供应商 editor from the 官方配置 row's 编辑
   *  entry (pi/omp official files are never cc-gui-managed, so no gate). */
  openCustomEditorSignal?: number;
}) {
  const { t } = useTranslation();
  const {
    notice,
    oauthProviders,
    oauthActive,
    handleLaunchLogin,
    loadError,
    storePath,
    query,
    setQuery,
    showAll,
    toggleShowAll,
    visibleProviders,
    byId,
    editingId,
    openEditor,
    deleteTarget,
    setDeleteTarget,
    handleDelete,
    draftKey,
    setDraftKey,
    draftVisible,
    toggleDraftVisible,
    saving,
    actionError,
    handleSave,
    closeEditor,
    modelsConfig,
    modelsEditorOpen,
    modelsDraft,
    setModelsDraft,
    modelsSaving,
    modelsError,
    openModelsEditor,
    handleModelsSave,
    customQuery,
    setCustomQuery,
    visibleCustomProviders,
    customEditingId,
    customDraft,
    setCustomDraft,
    customSaving,
    customError,
    openCustomProviderEditor,
    handleCustomProviderSave,
    closeCustomProviderEditor,
    customDeleteTarget,
    setCustomDeleteTarget,
    handleCustomProviderDelete,
    customEditingField,
    customFieldDraft,
    setCustomFieldDraft,
    customFieldError,
    openCustomFieldEditor,
    handleCustomFieldSave,
    closeCustomFieldEditor,
  } = usePiFamilyAuthState(engine, openCustomEditorSignal);

  return (
    <div className="flex w-full flex-col gap-6" data-testid="pi-family-auth-section">
      {notice && (
        <p role="status" className="text-body-regular text-text-secondary">
          {notice}
        </p>
      )}

      {/* ── 订阅授权 (read-only + terminal hand-off) ── */}
      <PiFamilyOauthSection
        engine={engine}
        providers={oauthProviders}
        oauthActive={oauthActive}
        onLaunchLogin={handleLaunchLogin}
      />

      {/* ── API Key ── */}
      <PiFamilyApiKeySection
        loadError={loadError}
        storePath={storePath}
        query={query}
        onQueryChange={setQuery}
        showAll={showAll}
        onToggleShowAll={toggleShowAll}
        totalCount={PI_FAMILY_APIKEY_PROVIDERS.length}
        providers={visibleProviders}
        byId={byId}
        editingId={editingId}
        onOpenEditor={openEditor}
        onDelete={setDeleteTarget}
        draftKey={draftKey}
        onDraftKeyChange={setDraftKey}
        draftVisible={draftVisible}
        onToggleDraftVisible={toggleDraftVisible}
        saving={saving}
        actionError={actionError}
        onSave={(provider) => void handleSave(provider)}
        onCloseEditor={closeEditor}
      />

      {/* ── 自定义供应商 (models.json / models.yml) ── */}
      <PiFamilyCustomSection
        modelsConfig={modelsConfig}
        editorOpen={modelsEditorOpen}
        draft={modelsDraft}
        saving={modelsSaving}
        error={modelsError}
        onToggleEditor={openModelsEditor}
        onDraftChange={setModelsDraft}
        onSave={() => void handleModelsSave()}
        query={customQuery}
        onQueryChange={setCustomQuery}
        providers={visibleCustomProviders}
        editingProviderId={customEditingId}
        providerDraft={customDraft}
        providerSaving={customSaving}
        providerError={customError}
        onOpenProviderEditor={openCustomProviderEditor}
        onProviderDraftChange={setCustomDraft}
        onProviderSave={() => void handleCustomProviderSave()}
        onCloseProviderEditor={closeCustomProviderEditor}
        onDeleteProvider={setCustomDeleteTarget}
        editingField={customEditingField}
        fieldDraft={customFieldDraft}
        fieldError={customFieldError}
        onOpenFieldEditor={openCustomFieldEditor}
        onFieldDraftChange={setCustomFieldDraft}
        onFieldSave={() => void handleCustomFieldSave()}
        onCloseFieldEditor={closeCustomFieldEditor}
      />

      {deleteTarget && (
        <ConfirmDialog
          danger
          message={t("settings.piAuthDeleteConfirm", { name: deleteTarget.name })}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {customDeleteTarget && (
        <ConfirmDialog
          danger
          message={t("settings.piAuthCustomDeleteConfirm", {
            name: customDeleteTarget.name ?? customDeleteTarget.id,
          })}
          onConfirm={() => void handleCustomProviderDelete()}
          onCancel={() => setCustomDeleteTarget(null)}
        />
      )}
    </div>
  );
}
