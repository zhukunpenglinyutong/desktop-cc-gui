import type { ComponentType } from "react";
import type * as React from "react";
import type { Disposer } from "./manifest";
import type { ComposerSlotId, FileLinkMenuTarget, SessionMenuTarget, WorkspaceMenuLabelValue } from "./registry";
export interface WorkspaceMetadata {
  id: string;
  path: string;
  gitBranch?: string;
  gitHead?: string;
  dirty?: boolean;
}

export interface PromptContribution {
  id: string;
  content: string;
  placement: "system-tail" | "request-tail";
  visibility: "internal";
  persistence: "turn" | "session";
  /** Called synchronously by the host exactly once after the engine accepts a
   * launch carrying this contribution. It is not called when launch fails or
   * when the byte budget rejects the contribution. Callback failures are
   * isolated and do not fail the accepted launch. Admitted contributions are
   * confirmed before afterTurn, even if the terminal event arrives first. */
  onAccepted?: () => void;
}

/** Optional text-frame capture for runtimes without a structured internal
 * message channel. The nonce correlates a frame to this turn; it is not an
 * authentication mechanism, and delivered payloads remain untrusted. */
export interface InternalMessageCapture {
  channel: string;
  nonce?: string;
  maxBytes: number;
  /** Synchronous predicate the host calls on each candidate frame's parsed
   *  payload, inline while parsing. Return true to let the host hide the frame
   *  from the transcript and deliver it to the plugin; returning false (or
   *  throwing) keeps the frame visible. NOT authoritative — the payload is
   *  still untrusted, so the plugin must validate again in
   *  `onInternalMessage`. Must be synchronous: it gates visibility before the
   *  async delivery can run. */
  validate?: (payload: unknown) => boolean;
}

export interface BeforeTurnResult {
  promptContributions?: PromptContribution[];
  internalMessageCapture?: InternalMessageCapture;
  /** Pure synchronous lifetime guard, checked during collection, replay,
   * launch acceptance, and capture parsing/delivery. False or throwing retires
   * this result's prompts and capture; a retired lifetime must not revive. */
  isCurrent?: () => boolean;
}

interface SessionEventBase {
  engine: string;
  sessionId: string | null;
  workspace: WorkspaceMetadata;
  occurredAt: string;
}

export interface SessionCreatedEvent extends SessionEventBase {}

export interface SessionRestoredEvent extends SessionEventBase {
  sessionId: string;
}

export interface SessionClosedEvent extends SessionEventBase {}

interface TurnEventBase {
  runId: string;
  turnId: string;
  engine: string;
  sessionId: string | null;
  workspace: WorkspaceMetadata;
  occurredAt: string;
}

export interface BeforeTurnEvent extends TurnEventBase {}

export interface AfterTurnEvent extends TurnEventBase {
  status: "completed" | "cancelled" | "failed";
  error?: string;
}

export interface InternalMessageEvent extends TurnEventBase {
  channel: string;
  nonce?: string;
  payload: unknown;
}

export interface RuntimeSwitchEvent {
  /** Stable identity shared by beforeSwitch and afterSwitch for one launch. */
  switchId: string;
  sourceEngine: string;
  targetEngine: string;
  sourceSessionId: string | null;
  targetSessionId: string | null;
  workspace: WorkspaceMetadata;
  occurredAt: string;
}

interface NormalizedRuntimeEventBase {
  eventId: string;
  runId: string;
  turnId: string;
  engine: string;
  sessionId: string | null;
  workspaceId: string;
  workspacePath: string;
  occurredAt: string;
}

export interface FileChangedEvent extends NormalizedRuntimeEventBase {
  kind: "file-changed";
  path: string;
  /** `touched`（适配器可确定的最弱事实）：引擎报告了针对该路径的修改类
   *  工具调用；不断言是创建、修改还是删除。 */
  change: "created" | "modified" | "deleted" | "touched";
}

/** 引擎已发起该命令：本事件不含结果，退出码未知；结果由同一工具行的
 *  command-finished 声明。 */
export interface CommandStartedEvent extends NormalizedRuntimeEventBase {
  kind: "command-started";
  command: string;
  cwd: string;
  startedAt: string;
}

export interface CommandFinishedEvent extends NormalizedRuntimeEventBase {
  kind: "command-finished";
  command: string;
  cwd: string;
  /** 仅引擎在同一工具消息里给出结构化数字退出码时才有值；null 表示结果
   *  里没有退出码，status 随之是 unknown。 */
  exitCode: number | null;
  startedAt?: string;
  finishedAt: string;
  status: "completed" | "failed" | "cancelled" | "unknown";
}

export interface ToolFinishedEvent extends NormalizedRuntimeEventBase {
  kind: "tool-finished";
  toolName: string;
  status: "completed" | "failed" | "cancelled" | "unknown";
}

/** The engine reported a denied capability and the host can present an
 * approval card. This does not assert that the engine is paused. */
export interface PermissionRequestedEvent extends NormalizedRuntimeEventBase {
  kind: "permission-requested";
  tool: string | null;
  path: string | null;
}

export interface AssistantCompletedEvent extends NormalizedRuntimeEventBase {
  kind: "assistant-completed";
}

export interface TurnCancelledEvent extends NormalizedRuntimeEventBase {
  kind: "turn-cancelled";
}

export interface TurnFailedEvent extends NormalizedRuntimeEventBase {
  kind: "turn-failed";
  error?: string;
}

export interface RuntimeExitedEvent extends NormalizedRuntimeEventBase {
  kind: "runtime-exited";
  exitCode: number | null;
}

export type NormalizedRuntimeEvent =
  | FileChangedEvent
  | CommandStartedEvent
  | CommandFinishedEvent
  | ToolFinishedEvent
  | PermissionRequestedEvent
  | AssistantCompletedEvent
  | TurnCancelledEvent
  | TurnFailedEvent
  | RuntimeExitedEvent;

export interface SessionHooks {
  onCreated?(event: SessionCreatedEvent): void | Promise<void>;
  onRestored?(event: SessionRestoredEvent): void | Promise<void>;
  onClosed?(event: SessionClosedEvent): void | Promise<void>;
}

export interface TurnHooks {
  beforeTurn?(event: BeforeTurnEvent): BeforeTurnResult | void | Promise<BeforeTurnResult | void>;
  /** Read-only launch observation; requires runtime.events.read, not prompt
   * contribution permission. Correlate start and finish using turnId. */
  onTurnStarted?(event: BeforeTurnEvent): void | Promise<void>;
  onRuntimeEvent?(event: NormalizedRuntimeEvent): void;
  afterTurn?(event: AfterTurnEvent): void | Promise<void>;
  onInternalMessage?(event: InternalMessageEvent): void | Promise<void>;
}

export interface RuntimeSwitchHooks {
  beforeSwitch?(event: RuntimeSwitchEvent): void | Promise<void>;
  afterSwitch?(event: RuntimeSwitchEvent): void | Promise<void>;
}

export type DocumentStorageLocationKind = "data" | "program" | "custom";

export interface ResolvedDocumentStorageLocation {
  kind: DocumentStorageLocationKind;
  path: string;
}

export interface DocumentReadResult {
  content: string;
  /** Opaque compare-and-swap token. */
  version: string;
}

export interface DocumentWriteResult {
  /** Opaque token to use as expectedVersion for the next write. */
  version: string;
}

export interface DocumentStorage {
  getLocation(): Promise<ResolvedDocumentStorageLocation>;
  /** Selecting custom opens the host directory picker. */
  selectLocation(kind: DocumentStorageLocationKind): Promise<ResolvedDocumentStorageLocation>;
  readText(relativePath: string): Promise<DocumentReadResult | null>;
  /** expectedVersion=null requires the document not to exist. */
  writeTextAtomic(
    relativePath: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<DocumentWriteResult>;
  /** Delete a document. Pass the opaque version from the last read to make
   *  the delete conditional (CAS); omit it (or pass null) to delete
   *  unconditionally. A stale version rejects with a conflict and leaves the
   *  newer document in place. */
  remove(relativePath: string, expectedVersion?: string | null): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface AssetDirectoryGrant {
  grantId: string;
  /** Canonical host filesystem path, for display and revealPath. */
  path: string;
}

export interface AssetFileGrant extends AssetDirectoryGrant {
  /** Selected filename relative to the granted parent directory. */
  relativePath: string;
}

export interface AssetFilePickerOptions {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface PluginAssets {
  /** Bundled resource URL; requires assets:bundle. */
  bundleUrl(relativePath: string): string;
  /** Resource under the current documentStorage root; requires plugin.storage. */
  documentUrl(relativePath: string): string;
  /** Proxied HTTP(S) URL; requires an exact network:<host> grant. Relative
   * resources remain proxied. Embedded URL credentials are not accepted. */
  remoteUrl(url: string): string;
  /** Call from a user action, never activation: opens the host directory
   * chooser. Cancellation rejects. Requires assets:directory. */
  grantDirectory(): Promise<AssetDirectoryGrant>;
  /** Call from a user action, never activation: selects a file and grants its
   * parent directory. Cancellation resolves null without granting access.
   * Requires assets:directory. */
  grantFile(options?: AssetFilePickerOptions): Promise<AssetFileGrant | null>;
  listDirectories(): Promise<AssetDirectoryGrant[]>;
  revokeDirectory(grantId: string): Promise<void>;
  /** Resource in a directory granted to this plugin; requires assets:directory.
   * Paths use forward slashes and are relative to the directory root. */
  directoryUrl(grantId: string, relativePath: string): string;
}


/**
 * PluginContext（plan §5.2）：插件唯一能力门面。宿主 runtime/context.ts
 * 实现本接口；插件侧的类型镜像见包根 plugin.d.ts（双向漂移由
 * contract-check.ts 在类型层面把守）。
 */

/** 外部会话源行(ctx.sessions.registerSource,0.3.4 起):插件上报的
 *  远端/容器内会话摘要。workspacePath 必须是已登记工作区的 path,否则
 *  宿主合并时丢弃(侧栏按 workspacePath 分组)。 */
export interface ExternalSessionRow {
  engine: string;
  sessionId: string;
  workspacePath: string;
  title?: string;
  updatedAt?: number | null;
  /** 远端 jsonl 绝对路径(可选;宿主历史回放经远程通道拉取)。 */
  remotePath?: string;
}

export type PluginConversationProps = {
  conversationId: string;
  workspacePath: string;
  language: string;
  onExit: () => void;
  setExitBlocked?: (blocked: boolean) => void;
};

export interface PluginAgentCatalogEntry {
  engine: string;
  label: string;
  available: boolean;
  readOnly: boolean;
  providers: { id: string; label: string }[];
  /** 引擎当前可用模型。`provider` 是模型所属渠道 id（与 `providers[].id`
   *  对齐，0.3.18 起），插件可据此分组；`label` 已是显示名。 */
  models: { id: string; label: string; provider?: string }[];
  /** 该引擎支持的推理强度档位（滑块顺序；空数组 = 不支持配置）。 */
  efforts: string[];
}

/** 侧栏工作区行（`ctx.workspaces.list()`）。刻意不含 `meta`：那是宿主与
 *  其它插件写入的私有载荷，读接口只给展示与路径解析需要的字段。 */
export interface PluginWorkspaceRow {
  id: string;
  /** 本机绝对路径（远程/WSL 工作区的路径在本机不存在，但字符串原样可用）。 */
  path: string;
  /** 侧栏显示名（目录名或用户重命名后的名字）。 */
  name: string;
  /** "worktree" = git worktree 子行；undefined = 普通工作区。 */
  kind?: "worktree";
  /** 侧栏分组 id；null = 未分组。 */
  groupId: string | null;
  /** 父工作区 id；仅 kind="worktree" 时存在。 */
  parentId?: string;
  /** 上次打开时间（Unix 毫秒）；从未打开为 null。 */
  lastOpenedAt: number | null;
  /** worktree 子行的只读投影（0.3.17 起）：分支名与来源 PR 编号。`kind` 为
   *  "worktree" 时存在；`meta` 里的其它私有载荷（如 wsl）仍然不出。 */
  worktree?: { branch: string; prNumber?: number };
}

/** Worktree badge accent（0.3.22）。宿主把它映射到 status token；不在
 *  白名单里的值按 "neutral" 处理，不会透传到 CSS。 */
export type WorktreeBadgeTone =
  | "neutral"
  | "blue"
  | "cyan"
  | "green"
  | "lime"
  | "yellow"
  | "rose"
  | "purple";

/** 侧栏 worktree 子行（`host:workspace` 投影，0.3.22）：徽标接口与列表
 *  回调收到的目标。`prNumber` 缺失为 null（不是 undefined）。 */
export interface WorktreeBadgeTarget {
  workspaceId: string;
  parentWorkspaceId: string;
  path: string;
  branch: string;
  prNumber: number | null;
}

/** 一行 worktree 子行上的一块徽标（0.3.22）。`label` 去掉首尾空白后按
 *  码点截到 6；`tooltip` 截到 300；空 label 视为不显示。 */
export interface WorktreeBadge {
  label: string;
  tone: WorktreeBadgeTone;
  tooltip?: string;
}

/** `ctx.ui.registerWorktreeBadges` 的句柄（0.3.22）。`list`/`onChange` 额外
 *  需要 `host:workspace`；`set`/`clear` 只需要 `ui:worktree-badge`。
 *  卸载时宿主清掉本插件的全部徽标与订阅，`dispose()` 可提前做同样的事。 */
export interface WorktreeBadgeHandle {
  /** 当前侧栏的 worktree 子行快照（需要 `host:workspace`）。 */
  list(): WorktreeBadgeTarget[];
  /** 跟随 worktree 子行增删或分支/PR/路径变化（需要 `host:workspace`）；
   *  回调在插件上下文中执行。 */
  onChange(cb: (targets: WorktreeBadgeTarget[]) => void): Disposer;
  /** 给一行设置（替换）徽标；`null` 等于清除该行。 */
  set(workspaceId: string, badge: WorktreeBadge | null): void;
  /** 清掉本句柄设置的全部徽标（保留订阅）。 */
  clear(): void;
  /** 清掉徽标与订阅；幂等，卸载时宿主也会调用。 */
  dispose(): void;
}

export interface PluginWindowBounds {
  /** Physical desktop coordinates; may be negative on left/top monitors. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PluginWindowSnapshot {
  bounds: PluginWindowBounds;
  state: "normal" | "minimized" | "maximized" | "fullscreen";
  scaleFactor: number;
}

export interface PluginWechatWindow {
  bounds: PluginWindowBounds;
  executable: "Weixin.exe" | "WeChat.exe";
}

export interface PluginEngineInfo {
  id: string;
  available: boolean;
  enabled: boolean;
  supportsImages: boolean;
  supportsComputerUse: boolean;
  supportsEffort: boolean;
  supportsToolConstraints: boolean;
  permissions: string[];
}

export interface PluginEngineModel {
  id: string;
  name?: string | null;
  description?: string | null;
  provider: string;
  contextWindow?: number | null;
}

export interface PluginEngineCatalog {
  models: PluginEngineModel[];
  authoritative: boolean;
  remote?: boolean;
}

export interface PluginEngineCatalogEntry {
  engine: PluginEngineInfo;
  catalog: PluginEngineCatalog;
}

export interface PluginModelCatalogResult {
  engines: PluginModelCatalogEngine[];
  errors: PluginModelCatalogError[];
  refreshedAt: number;
}
/** 用量统计（权限 `usage.read`，0.3.25 起）：宿主从本机各 CLI 自己的会话日志
 *  增量计算，只读、不联网（`updatePrices` 除外，它只下载公开价格表）。
 *  日期均为宿主本地日期 `YYYY-MM-DD`，时区由宿主运行时代填。 */
export type UsageStatsBucket = "day" | "hour";
export interface UsageStatsQuery {
  /** 起始本地日期（含）。 */
  from: string;
  /** 结束本地日期（含）。 */
  to: string;
  /** 缺省 "day"；"hour" 的 bucket 形如 `2026-10-27T14`。 */
  bucket?: UsageStatsBucket;
}
export interface UsageStatRow {
  /** `2026-10-27`（day）或 `2026-10-27T14`（hour），本地时间。 */
  bucket: string;
  /** 引擎 id：claude / codex / pi / omp …（随宿主支持的日志格式增加）。 */
  engine: string;
  model: string;
  /** 会话的工作目录（cwd）；日志里没有时为 null。 */
  project: string | null;
  /** 该分组里出现的不同会话数（跨分组相加会重复计）。 */
  sessions: number;
  /** 模型响应次数。 */
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 推理 tokens，已包含在 output 里，单列仅供参考。 */
  reasoning: number;
  /** 按价格表估算的美元费用；价格表里查不到该模型时为 null。 */
  cost: number | null;
}
export interface UsageStatsResult {
  rows: UsageStatRow[];
  /** 全部数据里最早有用量的本地日期。 */
  firstDay: string | null;
  /** 最近一次扫描完成时间（epoch ms）。 */
  scannedAt: number | null;
  /** 正在扫描时为 true，此时 rows 是扫描前的数据。 */
  scanning: boolean;
  /** rows 中没有价格的模型。 */
  unknownModels: string[];
}
export type UsageSourceState = "ok" | "missing" | "denied" | "error";
export interface UsageSourceStatus {
  engine: string;
  label: string;
  /** 扫描的根目录（已展开环境变量覆盖）。 */
  roots: string[];
  /** 可覆盖根目录的环境变量名。 */
  env: string | null;
  files: number;
  status: UsageSourceState;
  error: string | null;
  lastScanAt: number | null;
}
export interface UsageScanSummary {
  filesScanned: number;
  eventsAdded: number;
  durationMs: number;
  scannedAt: number;
}
export interface UsageScanProgress {
  done: number;
  total: number;
  engine: string | null;
  finished: boolean;
}
export interface UsagePriceInfo {
  source: "bundled" | "online";
  /** 内置快照日期 `YYYY-MM-DD`。 */
  snapshotDate: string;
  /** 在线价格表的下载时间（epoch ms）；从未更新为 null。 */
  updatedAt: number | null;
  models: number;
}

/** 订阅限额（权限 `limits.read`，0.3.25 起）：宿主只读本机 CLI 的登录状态，
 *  只请求厂商官方接口，不刷新、不改写任何凭据；插件拿不到凭据。 */
export type UsageLimitProviderId = "claude" | "codex";
export type UsageLimitStatus = "ok" | "signedOut" | "expired" | "rateLimited" | "offline" | "error";
export interface UsageLimitWindow {
  /** five_hour / seven_day / seven_day_opus / seven_day_sonnet / scoped:<model> / session / weekly */
  id: string;
  kind: "session" | "weekly" | "other";
  /** 模型级窗口的模型显示名；其他为 null。 */
  label: string | null;
  /** 已用百分比 0–100。 */
  usedPercent: number;
  windowSeconds: number | null;
  /** 重置时间（epoch ms）。 */
  resetsAt: number | null;
}
export interface UsageLimitProvider {
  id: UsageLimitProviderId;
  status: UsageLimitStatus;
  plan: string | null;
  /** rateLimited / offline 时保留上一次成功的数据。 */
  windows: UsageLimitWindow[];
  /** 额外用量（Extra usage），账号未开启时为 null。 */
  extra: { usedUsd: number; limitUsd: number } | null;
  /** 所示数据的获取时间（epoch ms）。 */
  fetchedAt: number | null;
  /** rateLimited 时下一次自动重试的时间（epoch ms）。 */
  retryAt: number | null;
  /** 简短原因，不含凭据。 */
  error: string | null;
  /** 查询的官方接口主机名，用于提示文案。 */
  host: string;
}
export interface UsageLimitsResult {
  providers: UsageLimitProvider[];
}

export interface PluginModelCatalogEngine {
  engine: PluginEngineInfo;
  sources: PluginModelSource[];
}
export interface PluginModelSource {
  id: string;
  name: string;
  kind: "cli" | "official" | "provider" | "custom" | "configured" | "builtin";
  authoritative: boolean;
  remote: boolean;
  models: PluginEngineModel[];
  refreshedAt: number;
  detail?: string;
}
export interface PluginModelCatalogError {
  engine: string;
  sourceId?: string;
  message: string;
}

export interface PluginContext {
  pluginId: string;
  version: string;
  /** Shared host React instance: external bundles can't resolve bare
   *  imports, so they build host-tree components with
   *  `ctx.react.createElement`; 插件自己的子树用自带 React createRoot 挂进
   *  ctx.react 容器（双段挂载模式，import-map 共享是 P0-3 后续）。 */
  react: typeof React;
  hooks: {
    registerSessionHooks(hooks: SessionHooks): Disposer;
    registerTurnHooks(hooks: TurnHooks): Disposer;
    registerRuntimeSwitchHooks(hooks: RuntimeSwitchHooks): Disposer;
  };
  workspace: {
    /** Stable host-registered workspace identity for the active path. */
    getMetadata(): Promise<WorkspaceMetadata>;
  };
  /** Isolated CAS text storage rooted under plugin-data/<plugin-id>. */
  documentStorage: DocumentStorage;
  assets: PluginAssets;
  shell: {
    /** Reveal an existing path inside this plugin's documentStorage root or
     * an explicitly granted resource directory. No arbitrary open/execute. */
    revealPath(path: string): Promise<void>;
  };
  ui: {
    registerConversationMode(def: {
      key?: string;
      label: () => string;
      component: ComponentType<PluginConversationProps>;
    }): Disposer;
    registerSettingsSection(def: {
      /** Optional sub-key; the settings page key becomes
       *  `plugin:<id>` or `plugin:<id>:<key>`. */
      key?: string;
      label: () => string;
      icon?: ComponentType<{ className?: string }>;
      component: ComponentType;
    }): Disposer;
    registerAddMenuRow(def: {
      key?: string;
      label: () => string;
      description?: () => string;
      icon?: ComponentType<{ className?: string }>;
      onSelect: () => void;
    }): Disposer;
    /** Extra control rendered beside a composer slot's builtin control
     *  (plan §4.2 #2). Permission `ui:composer-status` (shared with
     *  registerComposerStatusItem — both gate on the same composer-area
     *  grant; there is no separate `ui:composer` permission). */
    registerComposerSlot(def: {
      slot: ComposerSlotId;
      key?: string;
      component: ComponentType;
      order?: number;
    }): Disposer;
    /** Chat right-panel tab (plan §4.2 #4); renders with the active
     *  workspace path. The strip renders plugin tabs icon-only, so `icon` is
     *  the visible identity — without one the tab falls back to the plugin's
     *  artwork / letter tile, and the label stays a title/accessible name. */
    registerPanelTab(def: {
      key?: string;
      label: () => string;
      icon?: ComponentType<{ className?: string }>;
      component: ComponentType<{ workspacePath: string }>;
      order?: number;
    }): Disposer;
    /** App status-bar chip (plan §4.2 #8). */
    registerStatusBarItem(def: {
      key?: string;
      component: ComponentType;
      order?: number;
      /** Placement zone (0.3.8): "start" = left-aligned zone; omitted/"end"
       *  = legacy slot after sync status, before version. */
      zone?: "start" | "end";
    }): Disposer;
    /** Composer status-row chip (permission `ui:composer-status`, 0.3.9):
     *  renders in the composer's status row (branch/context meter row),
     *  left group after the branch switcher. */
    registerComposerStatusItem(def: {
      key?: string;
      component: ComponentType;
      order?: number;
    }): Disposer;
    /** Persistent viewport mount; requires ui:overlay. The plugin controls
     * placement and opts interactive children into pointer-events: auto. */
    registerOverlay(def: {
      key?: string;
      component: ComponentType;
      order?: number;
    }): Disposer;
    /** Command palette entry (plan §4.2 #9). */
    registerCommand(def: {
      key: string;
      title: () => string;
      keywords?: () => string[];
      run: () => void;
    }): Disposer;
    /** Chat file-link actions before the external editor (0.3.23).
     * Permission: ui:file-link-menu. run receives a non-null resolvedPath
     * for the clicked link, never the currently active editor's file.
     * label/visible run on every menu open and see the clicked path. */
    registerFileLinkMenuItem(def: {
      key?: string;
      label: (target: FileLinkMenuTarget) => string;
      icon?: ComponentType<{ className?: string }>;
      visible?: (target: FileLinkMenuTarget) => boolean;
      run: (target: FileLinkMenuTarget) => void | Promise<void>;
      order?: number;
    }): Disposer;
    /** Sidebar session right-click menu row (permission `ui:session-menu`,
     *  0.3.5 起)。`run` 收到打开菜单的会话 `{ engine, sessionId }`。 */
    registerSessionMenuItem(def: {
      key?: string;
      label: () => string;
      icon?: ComponentType<{ className?: string }>;
      danger?: boolean;
      run: (target: SessionMenuTarget) => void;
    }): Disposer;
    /** 跳转到本插件的设置页（权限 `ui:settings-section`，0.3.6 起）。
     *  `key` 对应 registerSettingsSection 的子 key，省略时打开主 section；
     *  供状态栏 chip、面板按钮等做深链入口。 */
    openSettings(key?: string): void;
    /** Markdown pipeline additions, merged over host defaults (plan §4.2 #5). */
    registerMarkdownRenderer(def: {
      key?: string;
      remarkPlugins?: unknown[];
      rehypePlugins?: unknown[];
      components?: Record<string, unknown>;
    }): Disposer;
    /** Overlay page at `#/p/<id>` (plan §4.2 #10). */
    registerPage(def: {
      key?: string;
      title: () => string;
      component: ComponentType;
    }): Disposer;
        /** Renderer for a plugin-defined chat timeline row kind (plan §4.2 #5).
     * The row payload is plugin-defined and typed loosely — blob bundles
     * can't share the host's TimelineRow type identity. */
    registerTimelineRowRenderer(def: {
      kind: string;
      key?: string;
      component: ComponentType<{ row: { kind: string } }>;
    }): Disposer;
    /** Sidebar workspace row context-menu entry. */
    registerWorkspaceMenuItem(def: {
      key?: string;
      label: (ctx: { workspaceId: string; archived: boolean }) => WorkspaceMenuLabelValue;
      icon?: ComponentType<{ className?: string }>;
      visible?: (ctx: { workspaceId: string; archived: boolean }) => boolean;
      onSelect: (ctx: { workspaceId: string; archived: boolean }) => void;
      order?: number;
    }): Disposer;
    /** Home sidebar nav entry under the builtin 自动化 row (permission
     *  `ui:sidebar-entry`, 0.3.12). `onOpen` usually opens the plugin's
     *  center tab via openCenterTab. `badge` (0.3.22) is an optional trailing
     *  count pill, re-evaluated every render; re-registering the same key
     *  refreshes it. */
    registerSidebarNav(def: {
      key?: string;
      label: () => string;
      icon?: ComponentType<{ className?: string }>;
      order?: number;
      badge?: () => string | number | null;
      onOpen: () => void;
    }): Disposer;
    /** Sidebar worktree-row badges (permission `ui:worktree-badge`, 0.3.22):
     *  push labels onto the "WORKTREES" child rows. `set`/`clear` need only
     *  `ui:worktree-badge`; `list`/`onChange` also need `host:workspace` and
     *  throw a readable error without it.
     *
     *  Shapes — target `{ workspaceId, parentWorkspaceId, path, branch,
     *  prNumber: number | null }`, badge `{ label, tone, tooltip? }`.
     *  Rendering rules: at most 2 badges per row (sorted by `order`, then
     *  registration order); `tone` outside "neutral" | "blue" | "cyan" |
     *  "green" | "lime" | "yellow" | "rose" | "purple" falls back to
     *  "neutral"; `label` is trimmed then truncated to 6 code points (empty =
     *  no badge); `tooltip` is plain text truncated to 300. `onClick` runs in
     *  the plugin context and never expands the sidebar row. Unload (or
     *  `dispose()`) clears this plugin's badges and subscriptions. */
    registerWorktreeBadges(def: {
      key?: string;
      order?: number;
      onClick?: (target: WorktreeBadgeTarget) => void;
    }): WorktreeBadgeHandle;
    /** Center-area tab definition (permission `ui:center-tab`, 0.3.12):
     *  renders in the center tab strip like session/file/browser tabs.
     *  Opening goes through openCenterTab; multiple keys = multiple tabs. */
    registerCenterTab(def: {
      key?: string;
      title: () => string;
      icon?: ComponentType<{ className?: string }>;
      component: ComponentType;
      order?: number;
    }): Disposer;
    /** Open (or focus) one of this plugin's registered center tabs
     *  (permission `ui:center-tab`, 0.3.12). Throws when the tab was never
     *  registered — open failures must be visible, not silent. */
    openCenterTab(key?: string): void;
  };
  theme: {
    /** Inject a stylesheet scoped to this plugin; removed on unload.
     *  Rejects remote references (`@import`, `url(http…)`): plugins must be
     *  self-contained (plan §8 gate rules). */
    injectCss(css: string): Disposer;
    /** Shorthand for BoardUI token overrides: keys must be `--*` custom
     *  properties; emits `:root {…}` and `.dark {…}` blocks. */
    setTokens(tokens: { light?: Record<string, string>; dark?: Record<string, string> }): Disposer;
  };
  i18n: {
    addBundle(lang: string, ns: string, resources: Record<string, unknown>): Disposer;
  };
  storage: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  events: {
    on(topic: string, cb: (data: unknown) => void): Disposer;
    emit(topic: string, data: unknown): void;
  };
  /** 聊天输入框（composer）草稿写入（权限 `composer:draft`，0.3.2 起）。
   *  写入即替换当前活动会话的草稿；不触发发送——发送永远是用户动作。 */
  composer: {
    setDraft(text: string): void;
  };
  /** 工作区登记与读取（权限 `host:workspace`，0.3.3 起；
   *  `list` 0.3.16 起）。把任意路径登记为侧栏工作区——不要求本机存在该
   *  目录（如经 ssh 管理的远程机/WSL 发行版内路径）。`meta` 透传存储在
   *  宿主工作区行上，形状由写入方与消费方约定。
   *
   *  `list` 返回侧栏当前的工作区行（含 worktree 子行，`kind` 区分）。它是
   *  **只读快照**：不含 `meta`（远程/其它插件写入的私有载荷）、不含分组
   *  定义，只给插件做「按本机工作区解析仓库/路径」这类用途。需要跟随宿主
   *  变更时重新调用，宿主不为插件广播工作区变更事件。
   *
   *  `meta` 携带 `wsl` 键（远程工作区，宿主引擎经 ssh 把会话流量导到
   *  meta.wsl 指定的主机与发行版）需要额外权限 `host:workspace:remote`
   *  （0.3.4 起）——这等效于出网 + 远程执行导向，远超登记一行侧栏数据。
   *  信任权衡：远程通道首连采用 StrictHostKeyChecking=accept-new
   *  （首连自动记录 host key，之后变更才拒绝），插件作者应知晓这是
   *  TOFU 而非严格 pinning。 */
  workspaces: {
    add(path: string, meta?: Record<string, unknown>): Promise<void>;
    /** 侧栏工作区快照（只读；权限 `host:workspace`，0.3.16 起）。
     *  worktree 子行额外带 `worktree: { branch, prNumber? }` 只读投影
     *  （0.3.17 起），用来把 PR 绑到本地 worktree；字段定义见
     *  `PluginWorkspaceRow`，`meta` 本体仍不输出。 */
    list(): Promise<PluginWorkspaceRow[]>;
  };
  /** Worktree 创建（权限 `host:worktree`，0.3.17 起）：经宿主「新建 Worktree」
   *  管线（validate → fetch → add → register）创建，宿主侧栏出现同一份进度
   *  行与取消/重试语义；成功后 worktree 以 `kind="worktree"` 登记进侧栏
   *  （父行是 `parentWorkspaceId` 对应的工作区），resolve 已注册的路径。
   *
   *  `prNumber` 存在时 fetch `pull/<n>/head` 再检出；`existingBranch` 表示
   *  `branch` 是已存在的本地分支（检出而非新建）。路径缺省 = 宿主默认布局
   *  `<仓库同级>/<仓库名>-worktrees/<branch>`。
   *
   *  失败/取消以 `Error` reject，message 形如 `"<errorKind>: <detail>"`
   *  （kind 与宿主错误分类一致：not_a_repo / repo_open_failed /
   *  invalid_branch / branch_not_found / branch_exists / branch_checked_out /
   *  dir_exists / pr_not_found / fetch_failed / register_failed /
   *  sparse_checkout_empty / canceled / unknown），插件据此给用户可读文案。
   *  `repo_open_failed` = 仓库存在但打不开（如属主校验拒绝），detail 以
   *  `GIT_UNSAFE_REPO:` / `GIT_OPEN_FAILED:` 开头并带原因。 */
  worktrees: {
    create(def: {
      /** 本地仓库路径（父工作区目录，必须是 git 仓库）。 */
      repoPath: string;
      /** 侧栏父工作区 id：新 worktree 作为子行挂在它下面。 */
      parentWorkspaceId: string;
      /** 新 worktree 检出的分支名。 */
      branch: string;
      /** 新建分支时的起点；缺省 = 仓库 HEAD。 */
      baseRef?: string | null;
      /** 从 PR 创建：fetch `pull/<n>/head` 到 `branch`。 */
      prNumber?: number | null;
      prTitle?: string | null;
      prUrl?: string | null;
      /** true = `branch` 是已存在的本地分支（检出而非新建）。 */
      existingBranch?: boolean;
    }): Promise<{ worktreePath: string }>;
    /** 删除本地 worktree（权限 `host:worktree`，0.3.19 起）：走宿主侧栏
     *  的删除流程——`git worktree remove`（可选删分支）+ 注销侧栏/终端
     *  登记。reject 的 message 形如 "<errorKind>: <detail>"（errorKind 与
     *  创建同一套分类，另有 not_found / remove_failed）。resolve 带非致命
     *  尾巴：`orphanDirectory`（目录没能删掉）、`branchKeptReason`
     *  （"checked_out_elsewhere" | "unknown"；null = 分支已删或未要求删）。 */
    remove(def: {
      repoPath: string;
      worktreePath: string;
      branch?: string | null;
      deleteBranch?: boolean;
    }): Promise<{ orphanDirectory: boolean; branchKeptReason: string | null }>;
  };
  /** 会话打开 + 外部会话源(权限 `host:session`;selectSession 0.3.3 起,
   *  registerSource 0.3.4 起)。registerSource:登记异步会话源,宿主在会话
   *  目录刷新(init/refreshSessions/rescan)时调用 `list()` 并把行合并进
   *  侧栏列表——本机扫描结果优先,同 engine/sessionId/workspacePath 的外部
   *  行被丢弃。返回 Disposer,插件卸载时自动注销。 */
  sessions: {
    selectSession(engine: string, sessionId: string, workspacePath: string): Promise<void>;
    /** 请求宿主立即刷新会话目录（侧栏/标签页），0.3.7 起。
     *  插件绕过宿主直写会话数据（如 sqlite custom_title、转录 title 行）后
     *  调用——否则变更要等用户手动同步或下次常规刷新才可见。 */
    refresh(): Promise<void>;
    /** 修改已有会话的 effort 档位，0.3.10 起。直写宿主会话状态并持久化
     *  （等价于用户在会话内切换档位，refreshSessions 不会回滚）。未知会话
     *  或空 effort 以 rejection 失败——不会创建幽灵会话条目。 */
    setEffort(engine: string, sessionId: string, workspacePath: string, effort: string): Promise<void>;
    /** 把一个 AI 轮次跑成**宿主聊天会话**（0.3.18 起，权限 `host:session`）：
     *  会话立刻出现在侧栏（带运行中状态，不需要手动同步），打开就是实时
     *  流式输出；停止既能在聊天里点，也能用 `interruptRun`。会话挂在
     *  `workspacePath` 工作区下，模型/强度/渠道只覆盖这一轮，不动用户的
     *  全局默认。
     *
     *  与 `ctx.agent.start` 的分工：那个是插件自有的后台轮次（事件只回
     *  插件，不进聊天）；这个就是「像用户自己发了一条」。需要用户看得见、
     *  随时能接管/停止的轮次用本方法。
     *
     *  spawn 成功后 resolve `{ runId, sessionId }`（引擎稍后才 announce
     *  sessionId 时为 null）；轮次终止经 `plugin-run://<pluginId>` 事件回执：
     *  `{ runId, sessionId, engine, workspacePath, kind: "done" | "error", error }`。
     *  被用户/插件中断的轮次同样以 `done` 收尾。 */
    startRun(def: {
      engine: string;
      prompt: string;
      /** 会话所属工作区路径（如某个 worktree）。 */
      workspacePath: string;
      /** 本轮模型 id（`ctx.agent.catalog` 的 `models[].id`）。 */
      model?: string | null;
      /** 本轮推理强度（catalog 的 `efforts` 里的一档）。 */
      effort?: string | null;
      /** 本轮渠道 id（catalog 的 `providers[].id`）。 */
      providerId?: string | null;
    }): Promise<{ runId: string; sessionId: string | null }>;
    /** 停止 `startRun` 起的轮次（等价于聊天里的停止按钮）。 */
    interruptRun(def: {
      engine: string;
      workspacePath: string;
      sessionId?: string | null;
    }): Promise<void>;
    registerSource(def: {
      /** 源 id,插件内唯一;同 id 重复登记覆盖(热重载语义)。 */
      id: string;
      list: () => Promise<ExternalSessionRow[]>;
    }): Disposer;
  };
  /** 主窗口访问（权限 `host:window`，0.3.19 起）。坐标与尺寸均为物理像素；
   *  setNormalBounds 仅接受普通态窗口，并要求至少 64x64 像素落在当前任一屏幕。
   *  sampleWechat 在 Windows 按可执行名 Weixin.exe/WeChat.exe 采样；其他平台
   *  以 Unsupported 拒绝，找不到以 NotFound 拒绝。 */
  window: {
    getState(): Promise<PluginWindowSnapshot>;
    setNormalBounds(bounds: PluginWindowBounds): Promise<PluginWindowSnapshot>;
    sampleWechat(): Promise<PluginWechatWindow>;
  };
  /** 宿主模型目录（权限 `host:models`，0.3.19 起）。结果来自宿主权威
   *  list_engines/list_engine_models，不包含 API key、token 或完整 provider 配置。
   *  workspace 可选；远程工作区由拥有 CLI 的远程宿主/WSL 侧探测。 */
  models: {
    listEngines(): Promise<PluginEngineInfo[]>;
    listEngineModels(engine: string, workspace?: string): Promise<PluginEngineCatalog>;
    /** Aggregated safe catalog. Provider endpoints are contacted only when
     *  refreshProviders is true (must be tied to an explicit user action). */
    catalog(options?: {
      workspace?: string;
      refreshProviders?: boolean;
    }): Promise<PluginModelCatalogResult>;
  };
  /** 本机用量统计（权限 `usage.read`，0.3.25 起）。数据由宿主从各 CLI 的会话
   *  日志计算，不上传。refresh 增量读取新内容；rescan 从头重读磁盘上全部日志
   *  （进度经 onScanProgress），已被 CLI 清理的旧日志对应的用量保留不丢，
   *  60 秒内重复调用会被拒绝。updatePrices 下载公开价格表（LiteLLM），应只在
   *  用户开启自动更新或显式操作时调用；10 分钟内重复调用直接返回当前价格表。
   *  宿主在插件首次调用后才开始后台扫描，约 10 分钟无调用即停止。 */
  usage: {
    query(query: UsageStatsQuery): Promise<UsageStatsResult>;
    sources(): Promise<UsageSourceStatus[]>;
    refresh(): Promise<UsageScanSummary>;
    rescan(): Promise<UsageScanSummary>;
    prices(): Promise<UsagePriceInfo>;
    updatePrices(): Promise<UsagePriceInfo>;
    onChange(cb: (event: { scannedAt: number }) => void): Disposer;
    onScanProgress(cb: (progress: UsageScanProgress) => void): Disposer;
  };
  /** 订阅限额（权限 `limits.read`，0.3.25 起）。缺省查询全部平台；宿主缓存
   *  60 秒，refresh 跳过缓存但 20 秒内重复刷新仍复用上次结果，并遵守 429
   *  退避。宿主读取本机 CLI 登录前先向桌面用户列出读取位置并征求同意（仅
   *  询问一次，可在插件详情页撤销）；未同意时 get 以
   *  `CredentialConsentRequired: ` 开头的错误拒绝，插件应提示用户而不是
   *  重试轰炸。 */
  limits: {
    get(options?: {
      providers?: UsageLimitProviderId[];
      refresh?: boolean;
    }): Promise<UsageLimitsResult>;
  };
  /** Agent 轮次（权限 `agent`，0.3.13 起）：经宿主引擎管线拉起 agent
   *  进程——渠道注入、进程注册与聊天发送同构。事件走独立的
   *  `agent://<pluginId>` 总线话题（ctx.events.on 订阅；payload 为引擎
   *  事件信封 { runId, sessionId, engine, seq, kind, data, ts }，kind ∈
   *  delta | tool | usage | done | error …）。桌面专属（isWeb 下不可用的
   *  插件要自呈现）。 */
  agent: {
    catalog(workspacePath: string): Promise<PluginAgentCatalogEntry[]>;
    /** 启动一个 agent 轮次；返回的 runId 用于事件过滤与 interrupt。 */
    start(def: {
      engine: string;
      prompt: string;
      /** agent 进程的工作目录（绝对路径）。 */
      workspacePath: string;
      model?: string;
      /** 缺省 = 引擎当前渠道（与聊天发送同一解析）。 */
      providerId?: string;
      /** 引擎相关的会话续接 id（如 pi 的 --session-id）：同一 id 续上轮。 */
      sessionId?: string;
      readOnly?: boolean;
      requestId?: string;
    }): Promise<{ runId: string; sessionId: string | null }>;
    /** 中断本插件启动的 run（run id 属主前缀由宿主强制）。 */
    interrupt(runId: string): Promise<boolean>;
  };
  /** 通用能力出口（0.3.0 起；旧的 `cmd:<command>` 逐命令授权机制已删除）。
   *  仅下列命令，`pluginId` 由宿主自动注入（插件无需也不能传）：
   *
   *  - `plugin_http_request` `{ method, url, headers?, body? }` →
   *    `{ status, body }`：url 限 http/https，host(+端口) 须命中 manifest 的
   *    `network:<host>` / `network:<host>:<port>` / `network:<host>:<a>-<b>` 授权
   *    （形状与放行规则见 spec/permissions.json）。
   *  - `plugin_exec_run` `{ bin, args, env?, timeoutMs? }` →
   *    `{ code, stdout, stderr }`：bin 须命中 `exec:<bin>` 授权（裸名，无路径）。
   *    子进程 PATH 由宿主注入为"插件 env 的 PATH（如有，保持优先）+ 宿主 CLI
   *    搜索目录（进程 PATH + 常见安装位置）"，保证 `#!/usr/bin/env node`
   *    类 shim 能找到解释器；插件无法借 env 完全锁死 PATH。
   *  - `plugin_exec_spawn` `{ bin, args, env?, lifecycle? }` → void：
   *    同授权；成功时 resolve 为 void（Rust 返回 ()），失败 reject。
   *    PATH 注入语义同 `plugin_exec_run`。
   *    lifecycle 缺省 "detached"（用户级服务，活过插件）；"plugin" =
   *    附属进程，宿主跟踪，插件禁用/卸载时自动 kill。
   *  - `plugin_exec_kill` `{}` → `{ killed: number }`：kill 本插件全部
   *    lifecycle="plugin" 子进程（配置变更改名重启用；需任意 exec: 授权）。
   *  - `plugin_agent_start` / `plugin_agent_interrupt`（0.3.13 起）：
   *    与 `ctx.agent` 同一能力（需 `agent` 授权）——引擎管线由宿主接管，
   *    run id 属主前缀在 Rust 侧强制。
   *
   *  授权未命中的调用在 JS 侧即 reject（不打 IPC）；Rust 侧对授权与插件
   *  启用态另有强制（纵深防御）。 */
  bridge: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  host: {
    appVersion: string;
    /** 宿主实现的 SDK 契约版本（= 本包 version），供插件运行时自检。 */
    sdkVersion: string;
    locale: string;
    /** True in the web-access browser client; the desktop-only bridge
     *  commands above are absent there. */
    isWeb: boolean;
  };
}
