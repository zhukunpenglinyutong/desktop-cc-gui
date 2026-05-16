import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PackagePlus from "lucide-react/dist/esm/icons/package-plus";
import type { CodexCustomModel, CodexProviderConfig, VendorTab } from "../types";
import { STORAGE_KEYS, validateCodexCustomModels } from "../types";
import type { CodexUnifiedExecExternalStatus } from "../../../types";
import { useProviderManagement } from "../hooks/useProviderManagement";
import { useCodexProviderManagement } from "../hooks/useCodexProviderManagement";
import { usePluginModels } from "../hooks/usePluginModels";
import { ProviderList } from "./ProviderList";
import { CodexProviderList } from "./CodexProviderList";
import { ProviderDialog } from "./ProviderDialog";
import { CodexProviderDialog } from "./CodexProviderDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { CustomModelDialog } from "./CustomModelDialog";
import { CurrentClaudeConfigCard } from "./CurrentClaudeConfigCard";
import { CurrentCodexGlobalConfigCard } from "./CurrentCodexGlobalConfigCard";
import { GeminiVendorPanel } from "./GeminiVendorPanel";
import {
  consumeVendorModelManagerRequest,
  VENDOR_MODEL_MANAGER_REQUEST_EVENT,
} from "../modelManagerRequest";
import {
  getCodexUnifiedExecExternalStatus,
  readGlobalCodexAuthJson,
  readGlobalCodexConfigToml,
  restoreCodexUnifiedExecOfficialDefault,
  setCodexUnifiedExecOfficialOverride,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const LEGACY_CLAUDE_MAPPING_KEYS = [
  "mossx-claude-model-mapping",
  "codemoss-claude-model-mapping",
];
const CODEX_PLUGIN_MODELS_MIGRATION_MARKER =
  "codemoss-codex-plugin-models-migrated-v1";
type ModelDialogTarget = "claude" | "codex" | "gemini";
type InlineNoticeState =
  | { kind: "success" | "error"; message: string }
  | null;

type VendorSettingsPanelProps = {
  codexReloadStatus: "idle" | "reloading" | "applied" | "failed";
  codexReloadMessage: string | null;
  handleReloadCodexRuntimeConfig: () => Promise<void>;
};

function collectProviderCustomModels(
  providers: CodexProviderConfig[],
): CodexCustomModel[] {
  const merged: CodexCustomModel[] = [];
  const seenIds = new Set<string>();

  for (const provider of providers) {
    const models = validateCodexCustomModels(provider.customModels ?? []);
    for (const model of models) {
      const id = model.id.trim();
      if (!id || seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      const label = model.label?.trim() || id;
      const description = model.description?.trim();
      merged.push({
        id,
        label,
        description: description && description.length > 0 ? description : undefined,
      });
    }
  }

  return merged;
}

export function VendorSettingsPanel({
  codexReloadStatus,
  codexReloadMessage,
  handleReloadCodexRuntimeConfig,
}: VendorSettingsPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<VendorTab>("claude");
  const [dialogTarget, setDialogTarget] = useState<ModelDialogTarget>("claude");
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelDialogAddMode, setModelDialogAddMode] = useState(false);
  const [codexGlobalConfigContent, setCodexGlobalConfigContent] = useState("");
  const [codexGlobalConfigExists, setCodexGlobalConfigExists] = useState(false);
  const [codexGlobalConfigTruncated, setCodexGlobalConfigTruncated] = useState(false);
  const [codexGlobalConfigLoading, setCodexGlobalConfigLoading] = useState(false);
  const [codexGlobalConfigError, setCodexGlobalConfigError] = useState<string | null>(null);
  const [codexAuthConfigContent, setCodexAuthConfigContent] = useState("");
  const [codexAuthConfigExists, setCodexAuthConfigExists] = useState(false);
  const [codexAuthConfigTruncated, setCodexAuthConfigTruncated] = useState(false);
  const [codexAuthConfigLoading, setCodexAuthConfigLoading] = useState(false);
  const [codexAuthConfigError, setCodexAuthConfigError] = useState<string | null>(null);
  const [unifiedExecExternalStatus, setUnifiedExecExternalStatus] =
    useState<CodexUnifiedExecExternalStatus | null>(null);
  const [unifiedExecExternalStatusError, setUnifiedExecExternalStatusError] =
    useState<string | null>(null);
  const [unifiedExecExternalStatusLoading, setUnifiedExecExternalStatusLoading] =
    useState(false);
  const [unifiedExecActionBusy, setUnifiedExecActionBusy] = useState(false);
  const [unifiedExecActionNotice, setUnifiedExecActionNotice] =
    useState<InlineNoticeState>(null);
  const didRunLegacyMigrationRef = useRef(false);
  const didSeedCodexPluginModelsRef = useRef(false);

  const claude = useProviderManagement();
  const codex = useCodexProviderManagement();
  const claudeModels = usePluginModels(STORAGE_KEYS.CLAUDE_CUSTOM_MODELS);
  const codexModels = usePluginModels(STORAGE_KEYS.CODEX_CUSTOM_MODELS);
  const geminiModels = usePluginModels(STORAGE_KEYS.GEMINI_CUSTOM_MODELS);
  const codexModelCount = codexModels.models.length;
  const updateCodexModels = codexModels.updateModels;

  const openModelDialog = useCallback((target: ModelDialogTarget, addMode = false) => {
    setDialogTarget(target);
    setModelDialogAddMode(addMode);
    setModelDialogOpen(true);
  }, []);

  const closeModelDialog = useCallback(() => {
    setModelDialogOpen(false);
    setModelDialogAddMode(false);
  }, []);

  const loadCodexGlobalConfig = useCallback(async () => {
    setCodexGlobalConfigLoading(true);
    setCodexAuthConfigLoading(true);
    setCodexGlobalConfigError(null);
    setCodexAuthConfigError(null);
    const [configResult, authResult] = await Promise.allSettled([
      readGlobalCodexConfigToml(),
      readGlobalCodexAuthJson(),
    ]);

    if (configResult.status === "fulfilled") {
      setCodexGlobalConfigContent(configResult.value.content);
      setCodexGlobalConfigExists(configResult.value.exists);
      setCodexGlobalConfigTruncated(configResult.value.truncated);
    } else {
      const error = configResult.reason;
      setCodexGlobalConfigError(
        error instanceof Error ? error.message : String(error),
      );
      setCodexGlobalConfigContent("");
      setCodexGlobalConfigExists(false);
      setCodexGlobalConfigTruncated(false);
    }
    setCodexGlobalConfigLoading(false);

    if (authResult.status === "fulfilled") {
      setCodexAuthConfigContent(authResult.value.content);
      setCodexAuthConfigExists(authResult.value.exists);
      setCodexAuthConfigTruncated(authResult.value.truncated);
    } else {
      const error = authResult.reason;
      setCodexAuthConfigError(error instanceof Error ? error.message : String(error));
      setCodexAuthConfigContent("");
      setCodexAuthConfigExists(false);
      setCodexAuthConfigTruncated(false);
    }
    setCodexAuthConfigLoading(false);
  }, []);

  const refreshUnifiedExecExternalStatus = useCallback(async () => {
    setUnifiedExecExternalStatusLoading(true);
    setUnifiedExecExternalStatusError(null);
    try {
      const status = await getCodexUnifiedExecExternalStatus();
      setUnifiedExecExternalStatus(status);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUnifiedExecExternalStatusError(message);
      return null;
    } finally {
      setUnifiedExecExternalStatusLoading(false);
    }
  }, []);

  const refreshUnifiedExecConfigViews = useCallback(async () => {
    await Promise.all([loadCodexGlobalConfig(), refreshUnifiedExecExternalStatus()]);
  }, [loadCodexGlobalConfig, refreshUnifiedExecExternalStatus]);

  const applyPendingModelManagerRequest = useCallback(() => {
    const request = consumeVendorModelManagerRequest();
    if (!request) {
      return;
    }
    const target: ModelDialogTarget =
      request.target === "codex"
        ? "codex"
        : request.target === "gemini"
          ? "gemini"
          : "claude";
    setActiveTab(target);
    openModelDialog(target, Boolean(request.addMode));
  }, [openModelDialog]);

  useEffect(() => {
    applyPendingModelManagerRequest();
    const handleRequest = () => applyPendingModelManagerRequest();
    window.addEventListener(VENDOR_MODEL_MANAGER_REQUEST_EVENT, handleRequest);
    return () => {
      window.removeEventListener(
        VENDOR_MODEL_MANAGER_REQUEST_EVENT,
        handleRequest,
      );
    };
  }, [applyPendingModelManagerRequest]);

  useEffect(() => {
    void loadCodexGlobalConfig();
  }, [loadCodexGlobalConfig]);

  useEffect(() => {
    if (activeTab !== "codex") {
      return;
    }
    void refreshUnifiedExecExternalStatus();
  }, [activeTab, refreshUnifiedExecExternalStatus]);

  useEffect(() => {
    if (didRunLegacyMigrationRef.current) {
      return;
    }
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const canonicalKey = STORAGE_KEYS.CLAUDE_MODEL_MAPPING;
    const hasCanonical = Boolean(window.localStorage.getItem(canonicalKey));
    if (hasCanonical) {
      didRunLegacyMigrationRef.current = true;
      return;
    }

    for (const legacyKey of LEGACY_CLAUDE_MAPPING_KEYS) {
      const value = window.localStorage.getItem(legacyKey);
      if (!value) {
        continue;
      }
      try {
        window.localStorage.setItem(canonicalKey, value);
        window.dispatchEvent(
          new CustomEvent("localStorageChange", {
            detail: { key: canonicalKey },
          }),
        );
      } catch {
        // ignore migration write errors
      }
      break;
    }
    didRunLegacyMigrationRef.current = true;
  }, []);

  useEffect(() => {
    if (didSeedCodexPluginModelsRef.current) {
      return;
    }
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const alreadyMigrated =
      window.localStorage.getItem(CODEX_PLUGIN_MODELS_MIGRATION_MARKER) === "1";
    if (alreadyMigrated) {
      didSeedCodexPluginModelsRef.current = true;
      return;
    }
    if (codexModelCount > 0) {
      try {
        window.localStorage.setItem(CODEX_PLUGIN_MODELS_MIGRATION_MARKER, "1");
      } catch {
        // ignore marker write errors
      }
      didSeedCodexPluginModelsRef.current = true;
      return;
    }
    if (codex.codexProviders.length === 0) {
      return;
    }

    const fallbackModels = collectProviderCustomModels(codex.codexProviders);
    if (fallbackModels.length === 0) {
      try {
        window.localStorage.setItem(CODEX_PLUGIN_MODELS_MIGRATION_MARKER, "1");
      } catch {
        // ignore marker write errors
      }
      didSeedCodexPluginModelsRef.current = true;
      return;
    }

    updateCodexModels(fallbackModels);
    try {
      window.localStorage.setItem(CODEX_PLUGIN_MODELS_MIGRATION_MARKER, "1");
    } catch {
      // ignore marker write errors
    }
    didSeedCodexPluginModelsRef.current = true;
  }, [codex.codexProviders, codexModelCount, updateCodexModels]);

  useEffect(() => {
    if (!unifiedExecActionNotice) {
      return;
    }
    const timer = window.setTimeout(() => {
      setUnifiedExecActionNotice(null);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [unifiedExecActionNotice]);

  const runUnifiedExecOfficialAction = useCallback(
    async (
      mutate: () => Promise<CodexUnifiedExecExternalStatus>,
      successMessageKey: string,
    ) => {
      setUnifiedExecActionBusy(true);
      setUnifiedExecActionNotice(null);
      try {
        const status = await mutate();
        setUnifiedExecExternalStatus(status);
        try {
          await handleReloadCodexRuntimeConfig();
          setUnifiedExecActionNotice({
            kind: "success",
            message: t(successMessageKey),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const reloadFailureMessage = t(
            "settings.backgroundTerminalOfficialWriteReloadFailed",
            { message },
          );
          setUnifiedExecActionNotice({
            kind: "error",
            message: reloadFailureMessage,
          });
          pushErrorToast({
            title: t("common.error"),
            message: reloadFailureMessage,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setUnifiedExecActionNotice({ kind: "error", message });
        pushErrorToast({
          title: t("common.error"),
          message,
        });
      } finally {
        await refreshUnifiedExecConfigViews();
        setUnifiedExecActionBusy(false);
      }
    },
    [handleReloadCodexRuntimeConfig, refreshUnifiedExecConfigViews, t],
  );

  const handleSetUnifiedExecOfficialOverride = useCallback(
    async (enabled: boolean) => {
      await runUnifiedExecOfficialAction(
        () => setCodexUnifiedExecOfficialOverride(enabled),
        enabled
          ? "settings.backgroundTerminalOfficialWriteEnabledSuccess"
          : "settings.backgroundTerminalOfficialWriteDisabledSuccess",
      );
    },
    [runUnifiedExecOfficialAction],
  );

  const handleRestoreUnifiedExecOfficialDefault = useCallback(async () => {
    await runUnifiedExecOfficialAction(
      () => restoreCodexUnifiedExecOfficialDefault(),
      "settings.backgroundTerminalFollowOfficialSuccess",
    );
  }, [runUnifiedExecOfficialAction]);

  const unifiedExecOfficialDefaultDetail = unifiedExecExternalStatus
    ? unifiedExecExternalStatus.officialDefaultEnabled
      ? t("settings.backgroundTerminalDefaultEnabled")
      : t("settings.backgroundTerminalDefaultDisabled")
    : null;
  const unifiedExecOfficialConfigDetail = !unifiedExecExternalStatus
    ? null
    : !unifiedExecExternalStatus.hasExplicitUnifiedExec
      ? t("settings.backgroundTerminalOfficialConfigDefault")
      : unifiedExecExternalStatus.explicitUnifiedExecValue === true
        ? t("settings.backgroundTerminalOfficialConfigEnabled")
        : unifiedExecExternalStatus.explicitUnifiedExecValue === false
          ? t("settings.backgroundTerminalOfficialConfigDisabled")
          : t("settings.backgroundTerminalOfficialConfigInvalid");

  const currentDialogModels =
    dialogTarget === "codex"
      ? codexModels.models
      : dialogTarget === "gemini"
        ? geminiModels.models
        : claudeModels.models;

  const handleDialogModelsChange = useCallback(
    (models: CodexCustomModel[]) => {
      if (dialogTarget === "codex") {
        codexModels.updateModels(models);
        return;
      }
      if (dialogTarget === "gemini") {
        geminiModels.updateModels(models);
        return;
      }
      claudeModels.updateModels(models);
    },
    [claudeModels, codexModels, dialogTarget, geminiModels],
  );

  return (
    <div className="vendor-settings-panel">
      <h3 className="vendor-section-title">{t("settings.vendorsTitle")}</h3>
      <p className="vendor-section-desc">{t("settings.vendorsDescription")}</p>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as VendorTab)}
      >
        <TabsList className="vendor-tabs">
          <TabsTab className="vendor-tab" value="claude">
            <span className="vendor-tab-label">
              <EngineIcon engine="claude" size={14} />
              <span>Claude Code</span>
            </span>
          </TabsTab>
          <TabsTab className="vendor-tab" value="codex">
            <span className="vendor-tab-label">
              <EngineIcon engine="codex" size={14} />
              <span>Codex</span>
            </span>
          </TabsTab>
          <TabsTab className="vendor-tab" value="gemini">
            <span className="vendor-tab-label">
              <EngineIcon engine="gemini" size={14} />
              <span>Gemini CLI</span>
            </span>
          </TabsTab>
        </TabsList>

        <TabsPanel value="claude">
          <div className="vendor-tab-content">
            <div
              className="vendor-plugin-model-entry"
              role="button"
              tabIndex={0}
              onClick={() => openModelDialog("claude")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openModelDialog("claude");
                }
              }}
            >
              <div className="vendor-plugin-model-entry-main">
                <PackagePlus size={16} />
                <span className="vendor-plugin-model-entry-title">
                  {t("settings.vendor.pluginModels")}
                </span>
                {claudeModels.models.length > 0 && (
                  <span className="vendor-plugin-model-entry-count">
                    {claudeModels.models.length}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => {
                  event.stopPropagation();
                  openModelDialog("claude");
                }}
              >
                <PackagePlus size={14} />
                {t("settings.vendor.manageModels")}
              </Button>
            </div>
            <CurrentClaudeConfigCard
              config={claude.currentConfig}
              loading={claude.currentConfigLoading}
              providers={claude.providers}
              onSwitchProvider={claude.handleSwitchProvider}
            />
            <ProviderList
              providers={claude.providers}
              loading={claude.loading}
              onAdd={claude.handleAddProvider}
              onEdit={claude.handleEditProvider}
              onDelete={claude.handleDeleteProvider}
              onSwitch={claude.handleSwitchProvider}
            />
            <ProviderDialog
              isOpen={claude.providerDialog.isOpen}
              provider={claude.providerDialog.provider}
              onClose={claude.handleCloseProviderDialog}
              onSave={claude.handleSaveProvider}
            />
            <DeleteConfirmDialog
              isOpen={claude.deleteConfirm.isOpen}
              providerName={claude.deleteConfirm.provider?.name ?? ""}
              onConfirm={claude.confirmDeleteProvider}
              onCancel={claude.cancelDeleteProvider}
            />
          </div>
        </TabsPanel>

        <TabsPanel value="codex">
          <div className="vendor-tab-content">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await handleReloadCodexRuntimeConfig();
                  } finally {
                    await refreshUnifiedExecConfigViews();
                  }
                }}
                disabled={codexReloadStatus === "reloading"}
              >
                {codexReloadStatus === "reloading"
                  ? t("settings.codexRuntimeReloading")
                  : t("settings.codexRuntimeReload")}
              </Button>
              <span
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                  whiteSpace: "nowrap",
                }}
              >
                {t("settings.codexRuntimeReloadHint")}
              </span>
            </div>
            {codexReloadStatus !== "idle" && (
              <div className="settings-help">
                {codexReloadStatus === "failed"
                  ? codexReloadMessage
                    ? `${t("settings.codexRuntimeReloadFailed")}: ${codexReloadMessage}`
                    : t("settings.codexRuntimeReloadFailed")
                  : codexReloadMessage ?? t("settings.codexRuntimeReloadApplied")}
              </div>
            )}
            {codex.codexProviderError && (
              <div className="settings-help">
                {t("settings.vendor.codexProviderActionFailed")}:{" "}
                {codex.codexProviderError}
              </div>
            )}
            <div className="vendor-codex-runtime-card flex items-start justify-between gap-5 px-[18px] py-4 border border-[var(--border-muted)] rounded-[14px] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--surface-card)_92%,var(--vendor-button-primary-soft))_0%,var(--surface-card)_100%)] max-[900px]:flex-col">
              <div className="vendor-codex-runtime-card-copy flex-1 min-w-0">
                <div className="vendor-codex-runtime-card-title-row flex items-center flex-wrap gap-2">
                  <div className="vendor-codex-runtime-card-title text-base font-bold text-[var(--text-primary)]">
                    {t("settings.backgroundTerminal")}
                  </div>
                  <span className="vendor-codex-runtime-card-badge inline-flex items-center justify-center min-h-[22px] px-2 rounded-full text-[11px] font-bold text-[var(--vendor-button-primary)] bg-[color-mix(in_srgb,var(--vendor-button-primary)_12%,transparent)]">
                    {t("settings.experimentalBadgeOfficial")}
                  </span>
                </div>
                <div className="vendor-codex-runtime-card-description mt-1.5 text-[var(--text-secondary)] leading-[1.5]">
                  {t("settings.backgroundTerminalDesc")}
                </div>
                <div className="settings-help">
                  {t("settings.backgroundTerminalMarkerDesc")}
                </div>
                <div className="settings-help">
                  {t("settings.backgroundTerminalOfficialActionsDesc")}
                </div>
                {unifiedExecOfficialDefaultDetail ? (
                  <div className="settings-help">{unifiedExecOfficialDefaultDetail}</div>
                ) : null}
                {unifiedExecOfficialConfigDetail ? (
                  <div className="settings-help">{unifiedExecOfficialConfigDetail}</div>
                ) : null}
                {unifiedExecExternalStatusLoading ? (
                  <div className="settings-help">{t("settings.loading")}</div>
                ) : null}
                {unifiedExecExternalStatusError ? (
                  <div className="settings-help">{unifiedExecExternalStatusError}</div>
                ) : null}
                {unifiedExecActionNotice ? (
                  <div className="settings-help">{unifiedExecActionNotice.message}</div>
                ) : null}
                <div className="vendor-codex-runtime-card-actions mt-2.5 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSetUnifiedExecOfficialOverride(true)}
                    disabled={unifiedExecActionBusy}
                  >
                    {t("settings.backgroundTerminalOfficialWriteEnabled")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSetUnifiedExecOfficialOverride(false)}
                    disabled={unifiedExecActionBusy}
                  >
                    {t("settings.backgroundTerminalOfficialWriteDisabled")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRestoreUnifiedExecOfficialDefault()}
                    disabled={unifiedExecActionBusy}
                  >
                    {t("settings.backgroundTerminalFollowOfficial")}
                  </Button>
                </div>
              </div>
            </div>
            <CurrentCodexGlobalConfigCard
              configLoading={codexGlobalConfigLoading}
              configContent={codexGlobalConfigContent}
              configExists={codexGlobalConfigExists}
              configTruncated={codexGlobalConfigTruncated}
              configError={codexGlobalConfigError}
              authLoading={codexAuthConfigLoading}
              authContent={codexAuthConfigContent}
              authExists={codexAuthConfigExists}
              authTruncated={codexAuthConfigTruncated}
              authError={codexAuthConfigError}
            />
            <div
              className="vendor-plugin-model-entry"
              role="button"
              tabIndex={0}
              onClick={() => openModelDialog("codex")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openModelDialog("codex");
                }
              }}
            >
              <div className="vendor-plugin-model-entry-main">
                <PackagePlus size={16} />
                <span className="vendor-plugin-model-entry-title">
                  {t("settings.vendor.pluginModels")}
                </span>
                {codexModels.models.length > 0 && (
                  <span className="vendor-plugin-model-entry-count">
                    {codexModels.models.length}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => {
                  event.stopPropagation();
                  openModelDialog("codex");
                }}
              >
                <PackagePlus size={14} />
                {t("settings.vendor.manageModels")}
              </Button>
            </div>
            <CodexProviderList
              providers={codex.codexProviders}
              loading={codex.codexLoading}
              onAdd={codex.handleAddCodexProvider}
              onEdit={codex.handleEditCodexProvider}
              onDelete={codex.handleDeleteCodexProvider}
              onSwitch={codex.handleSwitchCodexProvider}
            />
            <CodexProviderDialog
              isOpen={codex.codexProviderDialog.isOpen}
              provider={codex.codexProviderDialog.provider}
              onClose={codex.handleCloseCodexProviderDialog}
              onSave={codex.handleSaveCodexProvider}
            />
            <DeleteConfirmDialog
              isOpen={codex.deleteCodexConfirm.isOpen}
              providerName={codex.deleteCodexConfirm.provider?.name ?? ""}
              onConfirm={codex.confirmDeleteCodexProvider}
              onCancel={codex.cancelDeleteCodexProvider}
            />
          </div>
        </TabsPanel>

        <TabsPanel value="gemini">
          <div className="vendor-tab-content">
            <div
              className="vendor-plugin-model-entry"
              role="button"
              tabIndex={0}
              onClick={() => openModelDialog("gemini")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openModelDialog("gemini");
                }
              }}
            >
              <div className="vendor-plugin-model-entry-main">
                <PackagePlus size={16} />
                <span className="vendor-plugin-model-entry-title">
                  {t("settings.vendor.pluginModels")}
                </span>
                {geminiModels.models.length > 0 && (
                  <span className="vendor-plugin-model-entry-count">
                    {geminiModels.models.length}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => {
                  event.stopPropagation();
                  openModelDialog("gemini");
                }}
              >
                <PackagePlus size={14} />
                {t("settings.vendor.manageModels")}
              </Button>
            </div>
            <GeminiVendorPanel />
          </div>
        </TabsPanel>

      </Tabs>

      <CustomModelDialog
        isOpen={modelDialogOpen}
        models={currentDialogModels}
        onModelsChange={handleDialogModelsChange}
        onClose={closeModelDialog}
        initialAddMode={modelDialogAddMode}
      />
    </div>
  );
}
