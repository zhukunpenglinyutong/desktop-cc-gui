/**
 * MCP inventory IPC types — mirror `src-tauri/src/mcp/mod.rs` (camelCase).
 * Config and runtime are separate sections by design: "enabled in config" and
 * "connected in a session" must never be collapsed into one state.
 */

export type McpEngineId =
  | "claude"
  | "codex"
  | "kimi"
  | "grok"
  | "omp"
  | "opencode"
  | "agy"
  | "qoder"
  | "qoder-cn"
  | "dsh"
  | "codebuddy"
  | "pi";

/** Backend source ids; the UI only renders them (`mcp.source.<id>`). */
export type McpConfigSource =
  | "claude_user"
  | "claude_local"
  | "claude_project"
  | "codex_user"
  | "codex_project"
  | "kimi_user"
  | "kimi_local"
  | "kimi_project"
  | "grok_user"
  | "grok_project"
  | "omp_user"
  | "omp_project"
  | "opencode_user"
  | "opencode_project"
  | "agy_user"
  | "agy_project"
  | "qoder_user"
  | "qoder_local"
  | "qoder_project"
  | "qoder_cn_user"
  | "qoder_cn_local"
  | "qoder_cn_project"
  | "codebuddy_user"
  | "codebuddy_local"
  | "codebuddy_project"
  | "dsh_profile";

/** native（原生支持）/ plugin（由插件提供）/ none（不内置 MCP）。 */
export type McpEngineSupport = "native" | "plugin" | "none";

/** A file this page reads for the engine, whether or not it exists yet. */
export interface McpSourceInfo {
  source: McpConfigSource;
  path: string;
  exists: boolean;
}

export interface McpConfigEntry {
  /** Backend-generated id (`source:name`); the UI only echoes it back. */
  id: string;
  engine: McpEngineId;
  name: string;
  source: McpConfigSource;
  scope: "user" | "project";
  path: string;
  format: "json" | "toml" | "yaml";
  enabled: boolean;
  transport: string | null;
  command: string | null;
  argsCount: number;
  /** Redacted by the backend (userinfo + sensitive query values). */
  url: string | null;
  envKeys: string[];
  headerKeys: string[];
  writable: boolean;
  readonlyReason: string | null;
  /** Localizable reason code (`mcp.readonlyReason.<code>`); absent on older
   *  sources that still ship a literal reason string. */
  readonlyReasonCode?: string | null;
  /** Content hash at read time; a mismatch on write means an external edit. */
  version: string;
  /** 启动方式：随会话启动（默认）/ 首次调用时才启动（`--mcp-lazy` 代理）。
   *  只存 ccgui 自己的设置，不写 CLI 配置。 */
  launchMode?: McpLaunchMode;
  /** 不能按需启动的原因码（`mcp.launch.unsupported.<code>`）；null = 可选。 */
  launchModeUnsupported?: string | null;
}

export type McpLaunchMode = "eager" | "onDemand";

export interface McpSourceError {
  source: string;
  path: string;
  message: string;
}

export interface McpConfigSection {
  entries: McpConfigEntry[];
  errors: McpSourceError[];
}

export type McpRuntimeStatus =
  | "ready"
  | "no_session"
  | "session_ended"
  | "unsupported"
  | "unavailable";

export interface McpRuntimeEntry {
  name: string;
  status: string | null;
  builtin: boolean;
  toolNames: string[];
  resourcesCount: number;
  templatesCount: number;
}

export interface McpRuntimeSection {
  status: McpRuntimeStatus;
  reason: string | null;
  workspace: string | null;
  sessionId: string | null;
  collectedAt: number | null;
  entries: McpRuntimeEntry[];
}

export interface McpEngineInventory {
  id: McpEngineId;
  available: boolean;
  support: McpEngineSupport;
  /** Sources this page reads (missing files included). */
  sources: McpSourceInfo[];
  config: McpConfigSection;
  runtime: McpRuntimeSection;
}

export interface McpInventory {
  engines: McpEngineInventory[];
  collectedAt: number;
}

export type McpErrorCode =
  | "readonly"
  | "conflict"
  | "not_found"
  | "format"
  | "permission"
  | "invalid_input"
  | "unsupported"
  | "internal";

/** 「本应用检测」的连接结果：与 CLI 会话上报的运行时状态分开表达。 */
export type McpProbeStatus = "connected" | "needs_auth" | "failed" | "unsupported";

export interface McpProbeResult {
  status: McpProbeStatus;
  message: string | null;
  /** 工具名（最多 40 个，详情列表用）。 */
  tools: string[];
  /** `tools/list` 声明的工具总数：数量展示用它，不受列表截断影响。 */
  toolCount: number;
  serverName: string | null;
  protocolVersion: string | null;
  elapsedMs: number;
}

/** 一次检测的展示状态：结果 + 采集时间 + 对应的配置版本。 */
export interface McpProbeState {
  result: McpProbeResult;
  checkedAt: number;
  /** 配置内容的哈希；外部改了配置就把旧结果当过期丢掉。 */
  version: string;
}
