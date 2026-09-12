/**
 * @ccgui/plugin-sdk — 插件侧公共契约声明（VS Code 的 vscode.d.ts 同款模式：
 * 本文件是插件作者面对的公共 API 定义，与 src/ 同包维护、同版本发布；
 * 双向漂移由 src/contract-check.ts 在类型层面把守）。
 *
 * 插件仓用法（包未发布 npm 前的过渡方案）：复制本文件为插件仓的
 * `src/ccgui-plugin.d.ts`，首行版本戳必须与所用宿主 SDK 一致。
 *
 * @ccgui/plugin-sdk v0.3.2
 */

/** 宿主实现的 SDK 契约版本。 */
export declare const SDK_VERSION: string;

/** 每次注册的撤销句柄；卸载时逆序执行。 */
export type Disposer = () => void;

/** 信任层级（ADR-1）：declarative = 零 JS 声明式。 */
export type PluginTier = "declarative" | "js";

/** 插件入口唯一约定：main.js 默认导出本函数。 */
export type PluginActivate = (ctx: PluginContext) => void | (() => void);

export interface JsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: (string | number)[];
}

export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/** ccgui.plugin.json（plan §5.1）。 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  /** SDK 兼容区间："^0.3" / "~0.3.0" / ">=0.3.0" / 精确 / "*"（缺省不校验）。 */
  sdkVersion?: string;
  author?: string;
  description?: string;
  tier: PluginTier;
  /** 基座权限与 `network:<host>[…]` / `exec:<bin>` 授权；全集、形状与放行
   *  规则以包内 spec/permissions.json 为单一事实源（TS/Rust/模板校验脚本
   *  三方消费同一文件）。`network:none` 是基座权限（声明无网络），永远
   *  不是授权——它不会放行任何主机。 */
  permissions: string[];
  contributes?: {
    themes?: { name?: string; tokens: { light?: Record<string, string>; dark?: Record<string, string> } }[];
    i18n?: { lang: string; ns?: string; resources: Record<string, unknown> }[];
    statusBarItems?: { key?: string; text: string }[];
    commands?: { key: string; title: string; emits?: string }[];
  };
  configSchema?: JsonSchemaObject;
}

export type ComposerSlotId = "addMenu" | "cliMenu" | "permissionMenu";

export type ComponentLike<P = Record<string, never>> = (props: P) => unknown;

/** 插件唯一能力门面（plan §5.2）。每个 register* 需要对应权限声明，
 *  返回 Disposer；未显式回收也由宿主 disposer 栈兜底。 */
export interface PluginContext {
  pluginId: string;
  version: string;
  /** 宿主共享 React：宿主树容器组件经它创建（createElement/useRef/...）；
   *  插件自有子树用自己的 createRoot 挂进容器（双段挂载模式）。 */
  react: typeof import("react");
  ui: {
    /** 设置页 section（权限 ui:settings-section）。 */
    registerSettingsSection(def: {
      key?: string;
      label: () => string;
      icon?: ComponentLike<{ className?: string }>;
      component: ComponentLike;
    }): Disposer;
    /** Composer「Add」菜单行（权限 ui:add-menu）。 */
    registerAddMenuRow(def: {
      key?: string;
      label: () => string;
      description?: () => string;
      icon?: ComponentLike<{ className?: string }>;
      onSelect: () => void;
    }): Disposer;
    /** Composer 工具栏插槽额外控件（权限 ui:composer）。 */
    registerComposerSlot(def: {
      slot: ComposerSlotId;
      key?: string;
      component: ComponentLike;
      order?: number;
    }): Disposer;
    /** 聊天右侧面板 tab（权限 ui:panel-tab）。 */
    registerPanelTab(def: {
      key?: string;
      label: () => string;
      icon?: ComponentLike<{ className?: string }>;
      component: ComponentLike<{ workspacePath: string }>;
      order?: number;
    }): Disposer;
    /** 应用底部状态栏条目（权限 ui:status-bar）。 */
    registerStatusBarItem(def: {
      key?: string;
      component: ComponentLike;
      order?: number;
    }): Disposer;
    /** ⌘K 命令面板命令（权限 ui:command）。 */
    registerCommand(def: {
      key: string;
      title: () => string;
      keywords?: () => string[];
      run: () => void;
    }): Disposer;
    /** Markdown 渲染管线追加（权限 ui:markdown）。 */
    registerMarkdownRenderer(def: {
      key?: string;
      remarkPlugins?: unknown[];
      rehypePlugins?: unknown[];
      components?: Record<string, unknown>;
    }): Disposer;
    /** 覆盖层页面，路由 `#/p/<id>`（权限 ui:page）。 */
    registerPage(def: {
      key?: string;
      title: () => string;
      component: ComponentLike;
    }): Disposer;
    /** 自定义 timeline 行 kind 渲染器（权限 ui:timeline-row）。 */
    registerTimelineRowRenderer(def: {
      kind: string;
      key?: string;
      component: ComponentLike<{ row: { kind: string } }>;
    }): Disposer;
  };
  theme: {
    /** 注入样式表（权限 theme）；拒绝 @import/远程 url。 */
    injectCss(css: string): Disposer;
    /** BoardUI token 覆盖快捷方式；key 必须是 --* 自定义属性。 */
    setTokens(tokens: { light?: Record<string, string>; dark?: Record<string, string> }): Disposer;
  };
  i18n: {
    /** 注册语言包（权限 i18n）。 */
    addBundle(lang: string, ns: string, resources: Record<string, unknown>): Disposer;
  };
  storage: {
    /** 每插件 KV（权限 storage）。 */
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  events: {
    /** 事件总线（权限 events）。宿主话题示例：`usage://updated`、
     *  `composer://draft`（payload { text }，草稿变化/清空/会话切换均发射）。 */
    on(topic: string, cb: (data: unknown) => void): Disposer;
    emit(topic: string, data: unknown): void;
  };
  /** 聊天输入框（composer）草稿写入（权限 composer:draft，0.3.2 起）。
   *  写入即替换当前活动会话的草稿；不触发发送——发送永远是用户动作。 */
  composer: {
    setDraft(text: string): void;
  };
  bridge: {
    /** 通用能力出口（0.3.0 起；旧的 `cmd:<command>` 逐命令授权机制已删除）。
     *  仅四条命令，`pluginId` 由宿主自动注入（插件无需也不能传）：
     *
     *  - `plugin_http_request` `{ method, url, headers?, body? }` →
     *    `{ status, body }`：url 限 http/https，host(+端口) 须命中 manifest 的
     *    `network:<host>` / `network:<host>:<port>` / `network:<host>:<a>-<b>` 授权
     *    （形状与放行规则以 spec/permissions.json 为准）。
     *  - `plugin_exec_run` `{ bin, args, env?, timeoutMs? }` →
     *    `{ code, stdout, stderr }`：bin 须命中 `exec:<bin>` 授权（裸名，无路径）。
     *  - `plugin_exec_spawn` `{ bin, args, env?, lifecycle? }` → void：
     *    同授权；成功时 resolve 为 void（Rust 返回 ()），失败 reject。
     *    lifecycle 缺省 "detached"（用户级服务，活过插件）；"plugin" =
     *    附属进程，宿主跟踪，插件禁用/卸载时自动 kill。
     *  - `plugin_exec_kill` `{}` → `{ killed: number }`：kill 本插件全部
     *    lifecycle="plugin" 子进程（配置变更改名重启用；需任意 exec: 授权）。
     *
     *  授权未命中的调用在 JS 侧即 reject（不打 IPC）；Rust 侧对授权与插件
     *  启用态另有强制（纵深防御）。 */
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  host: {
    appVersion: string;
    /** 宿主实现的 SDK 版本（= @ccgui/plugin-sdk version）。 */
    sdkVersion: string;
    locale: string;
    /** Web 客户端为 true；上述桌面独占桥命令在那里不可用。 */
    isWeb: boolean;
  };
}
