import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Server from "lucide-react/dist/esm/icons/server";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import Database from "lucide-react/dist/esm/icons/database";
import Info from "lucide-react/dist/esm/icons/info";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import type { EngineStatus, EngineType, WorkspaceInfo } from "../../../types";
import {
  detectEngines,
  getOpenCodeStatusSnapshot,
  listGlobalMcpServers,
  listMcpServerStatus,
  type GlobalMcpServerEntry,
} from "../../../services/tauri";
import { isWindowsPlatform } from "../../../utils/platform";
import { isLikelyWindowsFsPath, normalizeFsPath } from "../../../utils/workspacePaths";
import { Button } from "@/components/ui/button";
import { EngineIcon } from "../../engine/components/EngineIcon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type McpSectionProps = {
  activeWorkspace: WorkspaceInfo | null;
  activeEngine: string | null;
  embedded?: boolean;
};

type CodexMcpServer = {
  name: string;
  authLabel: string | null;
  toolNames: string[];
  resourcesCount: number;
  templatesCount: number;
};

type OpenCodeMcpServer = {
  name: string;
  enabled: boolean;
  status: string | null;
  permissionHint: string | null;
};

type OpenCodeSnapshot = {
  mcpEnabled: boolean;
  mcpServers: OpenCodeMcpServer[];
};

type EngineDescriptor = {
  engineType: EngineType;
  titleKey: string;
  modeKey: string;
  scopeKey: string;
  sourceKey: string;
  refreshKey: string;
  runtimeKey: string;
};

const ORDERED_ENGINES: EngineDescriptor[] = [
  {
    engineType: "claude",
    titleKey: "settings.mcpPanel.engineClaude",
    modeKey: "settings.mcpPanel.ruleModeConfigOnly",
    scopeKey: "settings.mcpPanel.ruleScopeClaude",
    sourceKey: "settings.mcpPanel.ruleSourceClaude",
    refreshKey: "settings.mcpPanel.ruleRefreshConfig",
    runtimeKey: "settings.mcpPanel.ruleRuntimeConfigOnly",
  },
  {
    engineType: "codex",
    titleKey: "settings.mcpPanel.engineCodex",
    modeKey: "settings.mcpPanel.ruleModeRuntimeRead",
    scopeKey: "settings.mcpPanel.ruleScopeCodex",
    sourceKey: "settings.mcpPanel.ruleSourceCodex",
    refreshKey: "settings.mcpPanel.ruleRefreshRuntime",
    runtimeKey: "settings.mcpPanel.ruleRuntimeCodex",
  },
  {
    engineType: "gemini",
    titleKey: "settings.mcpPanel.engineGemini",
    modeKey: "settings.mcpPanel.ruleModeConfigOnly",
    scopeKey: "settings.mcpPanel.ruleScopeGemini",
    sourceKey: "settings.mcpPanel.ruleSourceGemini",
    refreshKey: "settings.mcpPanel.ruleRefreshConfig",
    runtimeKey: "settings.mcpPanel.ruleRuntimeConfigOnly",
  },
  {
    engineType: "opencode",
    titleKey: "settings.mcpPanel.engineOpenCode",
    modeKey: "settings.mcpPanel.ruleModeSessionRead",
    scopeKey: "settings.mcpPanel.ruleScopeOpenCode",
    sourceKey: "settings.mcpPanel.ruleSourceOpenCode",
    refreshKey: "settings.mcpPanel.ruleRefreshRuntime",
    runtimeKey: "settings.mcpPanel.ruleRuntimeOpenCode",
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseCodexMcpServers(raw: unknown): CodexMcpServer[] {
  const payload = asRecord(raw);
  const result = asRecord(payload?.result) ?? payload;
  const data = Array.isArray(result?.data) ? result.data : [];

  return data
    .map((item) => {
      const row = asRecord(item);
      if (!row) {
        return null;
      }
      const name = String(row.name ?? "").trim();
      if (!name) {
        return null;
      }
      const auth = row.authStatus ?? row.auth_status;
      const authLabel =
        typeof auth === "string"
          ? auth
          : asRecord(auth)
            ? String(asRecord(auth)?.status ?? "").trim() || null
            : null;

      const toolsRecord = asRecord(row.tools) ?? {};
      const prefix = `mcp__${name}__`;
      const normalizedPrefix = prefix.toLowerCase();
      const toolNames = Object.keys(toolsRecord)
        .map((toolName) => {
          return toolName.toLowerCase().startsWith(normalizedPrefix)
            ? toolName.slice(prefix.length)
            : toolName;
        })
        .sort((left, right) => left.localeCompare(right));

      const resourcesCount = Array.isArray(row.resources) ? row.resources.length : 0;
      const templatesCount = Array.isArray(row.resourceTemplates)
        ? row.resourceTemplates.length
        : Array.isArray(row.resource_templates)
          ? row.resource_templates.length
          : 0;

      return {
        name,
        authLabel,
        toolNames,
        resourcesCount,
        templatesCount,
      } satisfies CodexMcpServer;
    })
    .filter((item): item is CodexMcpServer => Boolean(item))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeEngineType(engine: string | null): EngineType {
  if (engine === "claude" || engine === "codex" || engine === "gemini" || engine === "opencode") {
    return engine;
  }
  return "codex";
}

function getEngineIcon(engineType: EngineType) {
  return <EngineIcon engine={engineType} size={16} />;
}

function getEngineStatusBadgeKey(
  engineType: EngineType,
  activeEngine: EngineType,
  status: EngineStatus | null,
) {
  if (engineType === activeEngine) {
    return "settings.mcpPanel.engineStatusActive";
  }
  return status?.installed
    ? "settings.mcpPanel.engineStatusInstalled"
    : "settings.mcpPanel.engineStatusUnavailable";
}

export function McpSection({
  activeWorkspace,
  activeEngine,
  embedded = false,
}: McpSectionProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineStatuses, setEngineStatuses] = useState<EngineStatus[]>([]);
  const [codexServers, setCodexServers] = useState<CodexMcpServer[]>([]);
  const [globalServers, setGlobalServers] = useState<GlobalMcpServerEntry[]>([]);
  const [openCodeSnapshot, setOpenCodeSnapshot] = useState<OpenCodeSnapshot | null>(
    null,
  );
  const mountedRef = useRef(true);
  const loadSequenceRef = useRef(0);

  const normalizedActiveEngine = normalizeEngineType(activeEngine);
  const [selectedEngine, setSelectedEngine] = useState<EngineType>(normalizedActiveEngine);
  const workspaceId = activeWorkspace?.id ?? null;

  const loadMcp = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    const canCommit = () =>
      mountedRef.current && loadSequenceRef.current === sequence;

    if (canCommit()) {
      setLoading(true);
      setError(null);
    }
    const loadErrors: string[] = [];

    try {
      try {
        const statuses = await detectEngines();
        if (canCommit()) {
          setEngineStatuses(statuses);
        }
      } catch (loadError) {
        if (canCommit()) {
          setEngineStatuses([]);
        }
        loadErrors.push(loadError instanceof Error ? loadError.message : String(loadError));
      }

      try {
        const nextGlobalServers = await listGlobalMcpServers();
        if (canCommit()) {
          setGlobalServers(nextGlobalServers);
        }
      } catch (loadError) {
        if (canCommit()) {
          setGlobalServers([]);
        }
        loadErrors.push(loadError instanceof Error ? loadError.message : String(loadError));
      }

      if (workspaceId) {
        try {
          const response = await listMcpServerStatus(workspaceId, null, null);
          if (canCommit()) {
            setCodexServers(parseCodexMcpServers(response));
          }
        } catch {
          if (canCommit()) {
            setCodexServers([]);
          }
        }
      } else {
        if (canCommit()) {
          setCodexServers([]);
        }
      }

      if (selectedEngine === "opencode") {
        if (!workspaceId) {
          if (canCommit()) {
            setOpenCodeSnapshot(null);
          }
          loadErrors.push(t("settings.mcpPanel.workspaceRequired"));
        } else {
          try {
            const snapshot = await getOpenCodeStatusSnapshot({ workspaceId });
            if (canCommit()) {
              setOpenCodeSnapshot({
                mcpEnabled: snapshot.mcpEnabled,
                mcpServers: (snapshot.mcpServers ?? []).map((item) => ({
                  name: item.name,
                  enabled: item.enabled,
                  status: item.status ?? null,
                  permissionHint: item.permissionHint ?? null,
                })),
              });
            }
          } catch (loadError) {
            if (canCommit()) {
              setOpenCodeSnapshot(null);
            }
            loadErrors.push(loadError instanceof Error ? loadError.message : String(loadError));
          }
        }
      } else {
        if (canCommit()) {
          setOpenCodeSnapshot(null);
        }
      }
    } finally {
      if (canCommit()) {
        setError(loadErrors[0] ?? null);
        setLoading(false);
      }
    }
  }, [selectedEngine, t, workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    void loadMcp();
  }, [loadMcp]);

  useEffect(() => {
    setSelectedEngine(normalizedActiveEngine);
  }, [normalizedActiveEngine]);

  const engineStatusMap = useMemo(() => {
    const map = new Map<EngineType, EngineStatus>();
    engineStatuses.forEach((status) => {
      map.set(status.engineType, status);
    });
    return map;
  }, [engineStatuses]);

  const claudeConfigServers = useMemo(
    () => globalServers.filter((server) => server.source === "claude_json"),
    [globalServers],
  );

  const ccguiConfigServers = useMemo(
    () => globalServers.filter((server) => server.source === "ccgui_config"),
    [globalServers],
  );
  const selectedConfigServers = useMemo(() => {
    if (selectedEngine === "claude") {
      return claudeConfigServers;
    }
    if (selectedEngine === "codex" || selectedEngine === "gemini") {
      return ccguiConfigServers;
    }
    return [];
  }, [ccguiConfigServers, claudeConfigServers, selectedEngine]);

  const isWindowsHost = useMemo(() => {
    const hostPathCandidates = [
      activeWorkspace?.path,
      activeWorkspace?.codex_bin ?? null,
      ...engineStatuses.map((status) => status.binPath),
    ].filter((value): value is string => Boolean(value && value.trim()));

    const detectedFromBackendPath = hostPathCandidates.some((path) =>
      isLikelyWindowsFsPath(normalizeFsPath(path)),
    );

    return detectedFromBackendPath || isWindowsPlatform();
  }, [activeWorkspace?.codex_bin, activeWorkspace?.path, engineStatuses]);

  const codexVisibleServerCount = useMemo(() => {
    const names = new Set<string>();
    ccguiConfigServers.forEach((server) => {
      const normalizedName = server.name.trim().toLowerCase();
      if (normalizedName) {
        names.add(normalizedName);
      }
    });
    codexServers.forEach((server) => {
      const normalizedName = server.name.trim().toLowerCase();
      if (normalizedName) {
        names.add(normalizedName);
      }
    });
    return names.size;
  }, [ccguiConfigServers, codexServers]);

  const visibleServerCount = useMemo(() => {
    if (selectedEngine === "opencode") {
      return openCodeSnapshot?.mcpServers.length ?? 0;
    }
    if (selectedEngine === "codex") {
      return codexVisibleServerCount;
    }
    if (selectedEngine === "claude" || selectedEngine === "gemini") {
      return selectedConfigServers.length;
    }
    return 0;
  }, [
    codexVisibleServerCount,
    openCodeSnapshot?.mcpServers.length,
    selectedConfigServers.length,
    selectedEngine,
  ]);

  const visibleToolCount = useMemo(() => {
    if (selectedEngine !== "codex") {
      return 0;
    }
    return codexServers.reduce((sum, row) => sum + row.toolNames.length, 0);
  }, [codexServers, selectedEngine]);

  const installedCount = useMemo(
    () => engineStatuses.filter((status) => status.installed).length,
    [engineStatuses],
  );

  const selectedDescriptor = ORDERED_ENGINES.find(
    (engine) => engine.engineType === selectedEngine,
  ) ?? ORDERED_ENGINES[1];
  const selectedStatus = engineStatusMap.get(selectedEngine) ?? null;
  const getConfigPaths = useCallback(
    (engineType: EngineType): string[] => {
      if (engineType === "opencode") {
        return [
          t("settings.mcpPanel.pathWorkspaceSession"),
          t("settings.mcpPanel.pathRuntimeInjection"),
        ];
      }

      if (isWindowsHost) {
        switch (engineType) {
          case "claude":
            return ["%USERPROFILE%\\.claude.json", "%USERPROFILE%\\.claude\\settings.json"];
          case "codex":
            return ["%USERPROFILE%\\.ccgui\\config.json", "%USERPROFILE%\\.codex\\config.toml"];
          case "gemini":
            return ["%USERPROFILE%\\.gemini\\settings.json", "%USERPROFILE%\\.ccgui\\config.json"];
          default:
            return [];
        }
      }

      switch (engineType) {
        case "claude":
          return ["~/.claude.json", "~/.claude/settings.json"];
        case "codex":
          return ["~/.ccgui/config.json", "~/.codex/config.toml"];
        case "gemini":
          return ["~/.gemini/settings.json", "~/.ccgui/config.json"];
        default:
          return [];
      }
    },
    [isWindowsHost, t],
  );

  return (
    <section className="settings-section">
      {!embedded && (
        <>
          <div className="settings-section-title">{t("settings.mcpPanel.title")}</div>
          <div className="settings-section-subtitle">{t("settings.mcpPanel.description")}</div>
        </>
      )}

      <div className="settings-mcp-toolbar">
        <div className="settings-inline-muted">
          {t("settings.mcpPanel.serverCount", {
            count: visibleServerCount,
            toolCount: visibleToolCount,
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadMcp()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "is-spin" : ""} />
          {t("settings.mcpPanel.refresh")}
        </Button>
      </div>

      {error ? <div className="settings-inline-error">{error}</div> : null}
      {loading ? <div className="settings-inline-muted">{t("settings.loading")}</div> : null}

      <div className="settings-mcp-overview-grid">
        <div className="settings-mcp-codex-card settings-mcp-overview-card">
          <div className="settings-mcp-panel-title">
            {getEngineIcon(selectedEngine)}
            {t("settings.mcpPanel.overviewActiveEngine")}
          </div>
          <div className="settings-mcp-panel-highlight">{t(selectedDescriptor.titleKey)}</div>
          <div className="settings-mcp-server-meta">{t(selectedDescriptor.modeKey)}</div>
        </div>

        <div className="settings-mcp-codex-card settings-mcp-overview-card">
          <div className="settings-mcp-panel-title">
            <ShieldCheck size={16} />
            {t("settings.mcpPanel.overviewDetectedEngines")}
          </div>
          <div className="settings-mcp-panel-highlight">
            {t("settings.mcpPanel.detectedEnginesValue", {
              installed: installedCount,
              total: ORDERED_ENGINES.length,
            })}
          </div>
          <div className="settings-mcp-server-meta">{t("settings.mcpPanel.overviewDetectedDesc")}</div>
        </div>

        <div className="settings-mcp-codex-card settings-mcp-overview-card">
          <div className="settings-mcp-panel-title">
            <Database size={16} />
            {t("settings.mcpPanel.overviewLiveInventory")}
          </div>
          <div className="settings-mcp-panel-highlight">
            {t("settings.mcpPanel.serverCount", {
              count: visibleServerCount,
              toolCount: visibleToolCount,
            })}
          </div>
          <div className="settings-mcp-server-meta">{t("settings.mcpPanel.overviewInventoryDesc")}</div>
        </div>
      </div>

      <div className="settings-mcp-section-header">
        <div>
          <div className="settings-section-subtitle">{t("settings.mcpPanel.enginesTitle")}</div>
          <div className="settings-inline-muted">{t("settings.mcpPanel.enginesDesc")}</div>
        </div>
        <div className="settings-mcp-engine-select">
          <Select
            value={selectedEngine}
            onValueChange={(value) => setSelectedEngine(normalizeEngineType(value))}
          >
            <SelectTrigger
              aria-label={t("settings.mcpPanel.engineSelectLabel")}
              className="settings-mcp-engine-select-trigger"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDERED_ENGINES.map((engine) => (
                <SelectItem key={engine.engineType} value={engine.engineType}>
                  {t(engine.titleKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="settings-mcp-engine-grid">
        {ORDERED_ENGINES.map((engine) => {
          const status = engineStatusMap.get(engine.engineType) ?? null;
          return (
            <div
              key={engine.engineType}
              className={`settings-mcp-codex-card settings-mcp-engine-card ${engine.engineType === selectedEngine ? "is-active" : ""}`}
            >
              <div className="settings-mcp-engine-head">
                <div className="settings-mcp-server-name">
                  {getEngineIcon(engine.engineType)}
                  {t(engine.titleKey)}
                </div>
                <span className="settings-mcp-auth">
                  {t(getEngineStatusBadgeKey(engine.engineType, normalizedActiveEngine, status))}
                </span>
              </div>
              <div className="settings-mcp-engine-meta-grid">
                <div className="settings-mcp-detail-row">
                  <span className="settings-mcp-detail-label">{t("settings.mcpPanel.detailVersion")}</span>
                  <span className="settings-mcp-detail-value">{status?.version ?? t("settings.mcpPanel.valueUnknown")}</span>
                </div>
                <div className="settings-mcp-detail-row">
                  <span className="settings-mcp-detail-label">{t("settings.mcpPanel.detailMode")}</span>
                  <span className="settings-mcp-detail-value">{t(engine.modeKey)}</span>
                </div>
                <div className="settings-mcp-detail-row">
                  <span className="settings-mcp-detail-label">{t("settings.mcpPanel.detailConfigPaths")}</span>
                  <span className="settings-mcp-detail-value">{getConfigPaths(engine.engineType).join(" · ")}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="settings-mcp-section-header">
        <div className="settings-section-subtitle">{t("settings.mcpPanel.detailsTitle")}</div>
        <div className="settings-inline-muted">{t("settings.mcpPanel.detailsDesc")}</div>
      </div>

      <div className="settings-mcp-list">
        <div
          className="settings-mcp-engine-panel"
        >
              <div className="settings-mcp-engine-panel-header">
                <div className="settings-mcp-server-name">
                  {getEngineIcon(selectedEngine)}
                  {t(selectedDescriptor.titleKey)}
                </div>
                <span className="settings-mcp-auth">
                  {t(getEngineStatusBadgeKey(selectedEngine, normalizedActiveEngine, selectedStatus))}
                </span>
              </div>

              <div className="settings-mcp-detail-grid">
                <div className="settings-mcp-codex-card">
                  <div className="settings-mcp-panel-title">
                    <ShieldCheck size={15} />
                    {t("settings.mcpPanel.rulesTitle")}
                  </div>
                  <div className="settings-mcp-rule-list">
                    <div className="settings-mcp-detail-row">
                      <span className="settings-mcp-detail-label">{t("settings.mcpPanel.ruleModeLabel")}</span>
                      <span className="settings-mcp-detail-value">{t(selectedDescriptor.modeKey)}</span>
                    </div>
                    <div className="settings-mcp-detail-row">
                      <span className="settings-mcp-detail-label">{t("settings.mcpPanel.ruleScopeLabel")}</span>
                      <span className="settings-mcp-detail-value">{t(selectedDescriptor.scopeKey)}</span>
                    </div>
                    <div className="settings-mcp-detail-row">
                      <span className="settings-mcp-detail-label">{t("settings.mcpPanel.ruleSourceLabel")}</span>
                      <span className="settings-mcp-detail-value">{t(selectedDescriptor.sourceKey)}</span>
                    </div>
                    <div className="settings-mcp-detail-row">
                      <span className="settings-mcp-detail-label">{t("settings.mcpPanel.ruleRefreshLabel")}</span>
                      <span className="settings-mcp-detail-value">{t(selectedDescriptor.refreshKey)}</span>
                    </div>
                    <div className="settings-mcp-detail-row">
                      <span className="settings-mcp-detail-label">{t("settings.mcpPanel.ruleRuntimeLabel")}</span>
                      <span className="settings-mcp-detail-value">{t(selectedDescriptor.runtimeKey)}</span>
                    </div>
                  </div>
                </div>

                <div className="settings-mcp-codex-card">
                  <div className="settings-mcp-panel-title">
                    <Info size={15} />
                    {t("settings.mcpPanel.environmentTitle")}
                  </div>
                  <div className="settings-mcp-rule-list">
                    <div className="settings-mcp-detail-row">
                      <span className="settings-mcp-detail-label">{t("settings.mcpPanel.detailVersion")}</span>
                      <span className="settings-mcp-detail-value">{selectedStatus?.version ?? t("settings.mcpPanel.valueUnknown")}</span>
                    </div>
                    <div className="settings-mcp-detail-row">
                      <span className="settings-mcp-detail-label">{t("settings.mcpPanel.detailBinary")}</span>
                      <span className="settings-mcp-detail-value">{selectedStatus?.binPath ?? t("settings.mcpPanel.valueUnavailable")}</span>
                    </div>
                    <div className="settings-mcp-detail-row">
                      <span className="settings-mcp-detail-label">{t("settings.mcpPanel.detailConfigPaths")}</span>
                      <span className="settings-mcp-detail-value">{getConfigPaths(selectedEngine).join(" · ")}</span>
                    </div>
                    <div className="settings-mcp-detail-row">
                      <span className="settings-mcp-detail-label">{t("settings.mcpPanel.detailRuntimeStatus")}</span>
                      <span className="settings-mcp-detail-value">
                        {selectedEngine === "opencode"
                          ? workspaceId
                            ? t("settings.mcpPanel.runtimeStatusOpenCodeReady")
                            : t("settings.mcpPanel.runtimeStatusWorkspaceRequired")
                          : selectedEngine === "codex"
                            ? workspaceId
                              ? t("settings.mcpPanel.runtimeStatusCodexReady")
                              : t("settings.mcpPanel.runtimeStatusWorkspaceOptional")
                            : t("settings.mcpPanel.runtimeStatusConfigOnly")}
                      </span>
                    </div>
                    {selectedStatus?.error ? (
                      <div className="settings-mcp-detail-row">
                        <span className="settings-mcp-detail-label">{t("settings.mcpPanel.detailError")}</span>
                        <span className="settings-mcp-detail-value settings-inline-error">{selectedStatus.error}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {selectedEngine === "claude" || selectedEngine === "gemini" ? (
                <div className="settings-mcp-codex-card">
                  <div className="settings-mcp-panel-title">
                    <FolderTree size={15} />
                    {t("settings.mcpPanel.configServersTitle")}
                  </div>
                  {selectedConfigServers.length === 0 ? (
                    <div className="settings-inline-muted">{t("settings.mcpPanel.noConfigServers")}</div>
                  ) : (
                    <div className="settings-mcp-list">
                      {selectedConfigServers.map((server) => {
                        const targetLabel = server.command
                          ? t("settings.mcpPanel.commandMeta", {
                              command: server.command,
                              args: server.argsCount,
                            })
                          : server.url
                            ? t("settings.mcpPanel.urlMeta", { url: server.url })
                            : t("settings.mcpPanel.transportUnknown");
                        return (
                          <div key={`${selectedEngine}-${server.name}`} className="settings-mcp-server-row">
                            <div>
                              <div className="settings-mcp-server-name">
                                <Database size={14} />
                                {server.name}
                              </div>
                              <div className="settings-mcp-server-meta">
                                {server.transport ?? t("settings.mcpPanel.transportUnknown")} · {targetLabel}
                              </div>
                            </div>
                            <span className="settings-mcp-auth">
                              {server.enabled ? t("settings.mcpPanel.enabled") : t("settings.mcpPanel.disabled")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}

              {selectedEngine === "codex" ? (
                <Fragment>
                  <div className="settings-mcp-codex-card">
                    <div className="settings-mcp-panel-title">
                      <Database size={15} />
                      {t("settings.mcpPanel.configServersTitle")}
                    </div>
                    {ccguiConfigServers.length === 0 ? (
                      <div className="settings-inline-muted">{t("settings.mcpPanel.noConfigServers")}</div>
                    ) : (
                      <div className="settings-mcp-list">
                        {ccguiConfigServers.map((server) => {
                          const targetLabel = server.command
                            ? t("settings.mcpPanel.commandMeta", {
                                command: server.command,
                                args: server.argsCount,
                              })
                            : server.url
                              ? t("settings.mcpPanel.urlMeta", { url: server.url })
                              : t("settings.mcpPanel.transportUnknown");
                          return (
                            <div key={`codex-config-${server.name}`} className="settings-mcp-server-row">
                              <div>
                                <div className="settings-mcp-server-name">
                                  <Database size={14} />
                                  {server.name}
                                </div>
                                <div className="settings-mcp-server-meta">
                                  {server.transport ?? t("settings.mcpPanel.transportUnknown")} · {targetLabel}
                                </div>
                                <div className="settings-mcp-server-meta">{t("settings.mcpPanel.sourceCcgui")}</div>
                              </div>
                              <span className="settings-mcp-auth">
                                {server.enabled ? t("settings.mcpPanel.enabled") : t("settings.mcpPanel.disabled")}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="settings-mcp-codex-card">
                    <div className="settings-mcp-panel-title">
                      <Server size={15} />
                      {t("settings.mcpPanel.runtimeServersTitle")}
                    </div>
                    {codexServers.length === 0 ? (
                      <div className="settings-inline-muted">{t("settings.mcpPanel.noRuntimeServers")}</div>
                    ) : (
                      <div className="settings-mcp-list">
                        {codexServers.map((server) => (
                          <div key={`codex-runtime-${server.name}`} className="settings-mcp-codex-card">
                            <div className="settings-mcp-codex-head">
                              <div className="settings-mcp-server-name">
                                <Server size={14} />
                                {server.name}
                              </div>
                              <span className="settings-mcp-auth">
                                {server.authLabel ?? t("settings.mcpPanel.authUnknown")}
                              </span>
                            </div>
                            <div className="settings-mcp-codex-meta">
                              {t("settings.mcpPanel.resourcesTemplates", {
                                resources: server.resourcesCount,
                                templates: server.templatesCount,
                              })}
                            </div>
                            <div className="settings-mcp-tools">
                              {server.toolNames.length === 0 ? (
                                <span className="settings-inline-muted">{t("settings.mcpPanel.noTools")}</span>
                              ) : (
                                server.toolNames.map((tool) => (
                                  <span key={`${server.name}-${tool}`} className="settings-mcp-tool-chip">
                                    {tool}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Fragment>
              ) : null}

              {selectedEngine === "opencode" ? (
                <Fragment>
                  <div className="settings-mcp-codex-card">
                    <div className="settings-mcp-panel-title">
                      <ShieldCheck size={15} />
                      {t("settings.mcpPanel.sessionOverviewTitle")}
                    </div>
                    {openCodeSnapshot ? (
                      <div className="settings-mcp-rule-list">
                        <div className="settings-mcp-detail-row">
                          <span className="settings-mcp-detail-label">{t("settings.mcpPanel.globalToggle")}</span>
                          <span className="settings-mcp-detail-value">
                            {openCodeSnapshot.mcpEnabled
                              ? t("settings.mcpPanel.enabled")
                              : t("settings.mcpPanel.disabled")}
                          </span>
                        </div>
                        <div className="settings-mcp-detail-row">
                          <span className="settings-mcp-detail-label">{t("settings.mcpPanel.detailWorkspace")}</span>
                          <span className="settings-mcp-detail-value">
                            {activeWorkspace?.name ?? t("settings.mcpPanel.valueUnavailable")}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="settings-inline-muted">
                        {workspaceId
                          ? t("settings.mcpPanel.noOpenCodeSnapshot")
                          : t("settings.mcpPanel.workspaceRequired")}
                      </div>
                    )}
                  </div>

                  <div className="settings-mcp-codex-card">
                    <div className="settings-mcp-panel-title">
                      <Server size={15} />
                      {t("settings.mcpPanel.runtimeServersTitle")}
                    </div>
                    {!openCodeSnapshot ? (
                      <div className="settings-inline-muted">
                        {workspaceId
                          ? t("settings.mcpPanel.noOpenCodeSnapshot")
                          : t("settings.mcpPanel.workspaceRequired")}
                      </div>
                    ) : openCodeSnapshot.mcpServers.length === 0 ? (
                      <div className="settings-inline-muted">{t("settings.mcpPanel.noRuntimeServers")}</div>
                    ) : (
                      <div className="settings-mcp-list">
                        {openCodeSnapshot.mcpServers.map((server) => (
                          <div key={`opencode-${server.name}`} className="settings-mcp-server-row">
                            <div>
                              <div className="settings-mcp-server-name">
                                <Server size={14} />
                                {server.name}
                              </div>
                              <div className="settings-mcp-server-meta">
                                {server.status ?? t("settings.mcpPanel.statusUnknown")}
                                {server.permissionHint ? ` · ${server.permissionHint}` : ""}
                              </div>
                            </div>
                            <span className="settings-mcp-auth">
                              {server.enabled ? t("settings.mcpPanel.enabled") : t("settings.mcpPanel.disabled")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Fragment>
              ) : null}
        </div>
      </div>

      {!loading && engineStatuses.length === 0 && !error ? (
        <div className="settings-mcp-codex-card settings-mcp-empty-state">
          <div className="settings-mcp-panel-title">
            <TriangleAlert size={15} />
            {t("settings.mcpPanel.detectEmptyTitle")}
          </div>
          <div className="settings-mcp-server-meta">{t("settings.mcpPanel.detectEmptyDesc")}</div>
        </div>
      ) : null}
    </section>
  );
}
