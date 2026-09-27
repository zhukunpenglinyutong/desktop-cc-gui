import type { ComponentType } from "react";
import type * as React from "react";
import type { Disposer } from "./manifest";
import type { ComposerSlotId, SessionMenuTarget, WorkspaceMenuLabelValue } from "./registry";
export interface WorkspaceMetadata {
  id: string;
  path: string;
  gitBranch?: string;
  gitHead?: string;
  dirty?: boolean;
}

export interface RegisteredWorkspace {
  id: string;
  name: string;
  path: string;
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
  models: { id: string; label: string }[];
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
     *  center tab via openCenterTab. */
    registerSidebarNav(def: {
      key?: string;
      label: () => string;
      icon?: ComponentType<{ className?: string }>;
      order?: number;
      onOpen: () => void;
    }): Disposer;
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
  /** 工作区登记（权限 `host:workspace`，0.3.3 起）。把任意路径登记为侧栏
   *  工作区——不要求本机存在该目录（如经 ssh 管理的远程机/WSL 发行版内
   *  路径）。`meta` 透传存储在宿主工作区行上，形状由写入方与消费方约定。
   *
   *  `meta` 携带 `wsl` 键（远程工作区，宿主引擎经 ssh 把会话流量导到
   *  meta.wsl 指定的主机与发行版）需要额外权限 `host:workspace:remote`
   *  （0.3.4 起）——这等效于出网 + 远程执行导向，远超登记一行侧栏数据。
   *  信任权衡：远程通道首连采用 StrictHostKeyChecking=accept-new
   *  （首连自动记录 host key，之后变更才拒绝），插件作者应知晓这是
   *  TOFU 而非严格 pinning。 */
  workspaces: {
    add(path: string, meta?: Record<string, unknown>): Promise<void>;
    /** List registered workspaces without exposing UI-only metadata. */
    list(): Promise<RegisteredWorkspace[]>;
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
    registerSource(def: {
      /** 源 id,插件内唯一;同 id 重复登记覆盖(热重载语义)。 */
      id: string;
      list: () => Promise<ExternalSessionRow[]>;
    }): Disposer;
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
