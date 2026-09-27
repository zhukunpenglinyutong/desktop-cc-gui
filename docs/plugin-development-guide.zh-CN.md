# CC GUI 插件开发与提交规范

> **版本**：v0.1（规范草案，随插件系统 Phase 1 落地生效）
> **适用对象**：社区插件开发者、AI 生成插件的使用者、市场审核人员
> **关联文档**：[插件化系统总体计划](../.omx/plans/plugin-system-plan.md)

本文档是向 CC GUI 插件市场提交插件的**唯一权威规范**。插件从开发、打包、发版到上架的全部要求都在这里。

---

## 目录

1. [插件是什么](#1-插件是什么)
2. [三层信任模型](#2-三层信任模型)
3. [快速开始](#3-快速开始)
4. [插件仓库结构规范](#4-插件仓库结构规范)
5. [manifest.json 字段规范](#5-manifestjson-字段规范)
6. [插件 SDK API 参考](#6-插件-sdk-api-参考)
7. [权限规范](#7-权限规范)
8. [声明式插件（Tier-0）规范](#8-声明式插件tier-0规范)
9. [构建与发版规范](#9-构建与发版规范)
10. [上架流程（提交到市场）](#10-上架流程提交到市场)
11. [审核标准与禁止事项](#11-审核标准与禁止事项)
12. [版本更新与兼容性策略](#12-版本更新与兼容性策略)
13. [用户数据与安全规范](#13-用户数据与安全规范)
14. [FAQ](#14-faq)

---

## 1. 插件是什么

CC GUI 插件是一个**托管在 GitHub 上的独立仓库**，通过 GitHub Releases 分发，用户可以一键安装、升级、卸载。插件可以：

- 修改界面样式（主题、输入框样式、布局微调）
- 新增设置页、侧边栏面板、状态栏组件、命令面板命令
- 注册 Markdown 渲染组件、Composer 插槽内容
- 读取宿主提供的只读事件（如用量统计 `usage://updated`）
- 在自己的 KV 命名空间里持久化数据

插件**不得**（由安装期评审 + 权限门面共同约束，见 §7）：

- 直接调用 Tauri IPC（`window.__TAURI__` 在插件加载前已被移除——这是收敛面，不是不可绕过的沙箱，见 §7）
- 访问文件系统、终端、其他插件的数据
- 未经 `network` 权限声明就发起网络请求
- 新增 AI 引擎或 Rust 命令（编译期固化，不在插件能力面内）

## 2. 三层信任模型

| 层级 | 形态 | 能力 | 上架要求 |
|---|---|---|---|
| **Tier-0 声明式** | 纯 JSON + CSS，**零 JavaScript** | 主题/样式、菜单行、设置项、状态栏文本 | 审核从简（无代码可审） |
| **Tier-1 JS（市场）** | 单文件 ESM bundle + manifest | 完整 SDK 扩展点 API | PR 人工审核；可选 minisign 签名获「已验证」徽章 |
| **Tier-2 JS（个人/AI 生成）** | 同 Tier-1，未签名 | 同 Tier-1 | **不上架**，仅本地安装，安装时用户须确认代码 diff + 权限清单 |

> 建议：只做样式/主题/菜单的插件**优先做成 Tier-0**——审核最快、用户信任成本最低、AI 也能可靠生成。

## 3. 快速开始

```bash
# 1. 从官方模板创建仓库（GitHub → Use this template）
#    https://github.com/<org>/ccgui-plugin-template

# 2. 克隆并安装
git clone https://github.com/<you>/ccgui-plugin-hello.git
cd ccgui-plugin-hello && pnpm install

# 3. 开发（产物三件套输出到 dist/）
pnpm dev        # 监听构建
pnpm build      # 产出 main.js + manifest.json + styles.css
pnpm validate   # 本地校验 manifest 与产物

# 4. 本地调试：CC GUI → 设置 → 插件 → 从本地目录安装（指向 dist/）

# 5. 发版：打一个与 manifest.json version 一致的 tag
git tag 1.0.0 && git push origin 1.0.0
#    GitHub Action 自动构建并将三件套附加到 Release

# 6. 上架：向索引仓库提 PR（见 §10）
```

> **只想自己用、不想先建仓库？** 插件中心页头「创建插件」会用内置 skill 在一次会话里生成可直接安装的插件目录（`manifest.json` + `main.js`；Tier-0 只需 `manifest.json` + `styles.css`），不依赖模板仓库和构建工具；回到插件中心「从本地目录安装」选该目录即可，改完重新安装会热重载。要上架时再按下文流程把目录整理成仓库。

## 4. 插件仓库结构规范

### 4.1 必须满足的仓库布局

```
ccgui-plugin-hello/
├── manifest.json          # 【必须】仓库根目录，见 §5
├── src/
│   └── index.ts           # JS 插件入口（Tier-0 可没有 src/）
├── styles.css             # 【可选】样式源文件
├── README.md              # 【必须】市场详情页直接渲染它
├── LICENSE                # 【必须】开源许可证
├── .github/workflows/release.yml   # 模板自带，勿删改核心步骤
└── dist/                  # 构建产物（.gitignore，不入库）
    ├── main.js
    ├── manifest.json
    └── styles.css
```

### 4.2 硬性要求

1. **`manifest.json` 必须在默认分支的根目录**——市场按「默认分支根目录 manifest 的 version」查找同 tag 的 Release（与 Obsidian 相同约定）。
2. **Release 附件文件名固定**：`main.js`、`manifest.json`、`styles.css`（Tier-0 允许只有后两个）。改名 = 无法安装。
3. **Release tag 必须等于 manifest.json 的 `version`**（如 tag `1.2.0` ↔ `"version": "1.2.0"`），不带 `v` 前缀。
4. **单文件 ESM bundle**：所有第三方依赖在构建期打进 `main.js`；运行时**禁止** `import` 任何外部模块（宿主提供的基座除外，构建模板已将 `react`/`react-dom`/`@ccgui/plugin-sdk` 标记为 external）。
5. **体积**：bundle ≤ 512KB（CI 警告阈值），硬上限 2MB（gzip 前）。超出硬上限 CI 直接拒绝。

## 5. manifest.json 字段规范

完整示例：

```jsonc
{
  // ── 必填 ──────────────────────────────
  "id": "usage-stats",              // 全局唯一；小写字母/数字/连字符的点分段，总长 ≤ 64，
                                    // 例如 vendor.usage-stats；禁止空段、路径分隔符、`.`、`..`
  "name": "用量统计",                // 显示名，≤ 30 字符
  "version": "1.2.0",               // semver，必须与 Release tag 一致
  "minAppVersion": "1.1.0",         // 最低宿主版本，低于此版本的 App 不加载本插件
  "author": "zhangsan",             // GitHub 用户名或组织名
  "description": "统计各引擎 token 用量与花费",  // ≤ 120 字符
  "repo": "zhangsan/ccgui-plugin-usage-stats",  // owner/repo 形式
  "tier": "js",                     // "declarative" | "js"
  "license": "MIT",

  // ── 可选 ──────────────────────────────
  "permissions": [                  // 必填；仅声明实际使用的能力，见 §7
    "storage",
    "ui:settings-section",
    "events"
  ],
  "contributes": {                  // 声明式贡献点（Tier-0 全靠它；JS 插件也可静态声明）
    "settingsSections": [{ "key": "usage", "titleKey": "usage.title", "icon": "chart" }],
    "panelTabs":        [{ "id": "usage", "titleKey": "usage.tab", "icon": "chart" }],
    "statusBarItems":   [{ "id": "usage", "alignment": "right" }],
    "commands":         [{ "id": "usage.open", "titleKey": "usage.cmd.open" }],
    "themes":           [{ "id": "midnight", "name": "Midnight", "dark": true, "css": "themes/midnight.css" }],
    "i18n":             [{ "lang": "zh-CN", "ns": "usage", "file": "i18n/zh-CN.json" }]
  },
  "configSchema": {                 // JSON Schema（draft 2020-12），市场自动生成设置表单
    "configVersion": 2,             // 配置结构版本，破坏性变更时 +1，见 §12.3
    "type": "object",
    "properties": {
      "currency":  { "type": "string", "enum": ["CNY", "USD"], "default": "CNY", "title": "货币" },
      "apiToken":  { "type": "string", "title": "API Token", "ccgui:role": "secret" }
      //                                                              ^ secret 字段仅写入不回显
    }
  },
  "icon": "docs/icon.png",                  // 可选：市场方形图标，见 §5.1
  "screenshots": ["docs/screenshot-1.png"], // 可选：≤ 5 张，市场详情页展示，见 §5.1；数组顺序 = 展示顺序
  "keywords": ["usage", "token"]               // ≤ 8 个，市场搜索
}
```

**字段校验规则**（索引仓 CI 强制执行）：

| 规则 | 说明 |
|---|---|
| `id` 稳定性 | 一旦上架**永不更改**；更新、卸载、用户数据都按 id 寻址 |
| `version` 单调 | 新版本 semver 必须严格大于索引中已登记版本 |
| `minAppVersion` 真实 | CI 会检查插件用到的 SDK API 在该宿主版本是否已存在 |
| `permissions` 最小化 | CI 对比代码实际行为与声明，多余声明会在 PR 中评论要求删减 |
| `description` 诚实 | 功能描述与实际行为不符 = 拒审 |

### 5.1 市场展示素材（icon / screenshots，均可选）

两个字段是可选的展示素材，**不填也能上架**：

- 缺 `icon`：市场列表/详情页用插件名首字母的确定性渐变瓷砖（同一 id 每台机器配色一致），面板页签回退同理。
- 缺 `screenshots`：详情页不渲染图集，README 直接顶到标题下方。

**图片放哪里**：放在插件仓库里，用相对路径引用；推荐统一放 `docs/`，README 也能直接贴同一张图。也接受绝对 `https://` URL，但仓库内相对路径更稳（不依赖第三方图床）。

```jsonc
// manifest.json
"icon": "docs/icon.png",
"screenshots": [
  "docs/screenshot-1.png",   // 第一张是详情页首屏（hero），放最能说明功能的一张
  "docs/screenshot-2.png"
]
```

**素材要求**：

| 项 | 规则 |
|---|---|
| `icon` | 正方形；PNG / SVG / WebP / JPG；建议 ≥ 128×128（256 更稳）；不要带白边/透明大边距 |
| `screenshots` | ≤ 5 张，数组顺序即展示顺序；PNG / JPG / WebP / GIF / SVG；建议宽度 ≥ 1200，界面截图用 16:9～16:10 |
| 路径 | 相对仓库根、不逃逸（`..`/绝对路径/反斜杠被拒绝）；单条 ≤ 1024 字符 |

**图片在默认分支（HEAD）上按路径读取，不锁 Release tag**：改进或替换同名文件后，用户刷新市场/详情页即可看到新图，无需发版。因此路径要稳定，不要用带哈希的构建产物名。

**`icon` 同时是宿主侧的面板页签回退图**：聊天右侧面板的插件页签在插件没注册 `icon` 时用这张图（宿主 `plugin_read_artwork` 读本地文件）。市场安装只落地 Release 附件（三件套，见 §10.2），不会带 `docs/` 目录，所以宿主在安装/更新时会按 manifest 声明的**相对路径**把索引里的这张图写进插件目录——**发布包里不需要内含图片文件**；用绝对 https URL 则不落地、直接联网加载。想让页签回退显示品牌图，manifest 要声明相对路径的 `icon`。

**如何进入市场**：manifest 是唯一事实源，索引仓机器人登记新版本时会把 `icon` / `screenshots` 镜像进 `plugins/<id>.json`（App 实际读的是索引）。只改进素材、不改版本的场景可以直接向索引仓提一个只改这两个字段的 PR。

## 6. 插件 SDK API 参考

### 6.1 入口约定

`main.js` 的默认导出是唯一入口：

```ts
import type { PluginContext } from '@ccgui/plugin-sdk';

export default function activate(ctx: PluginContext): void | (() => void) {
  // 所有 register* 都返回 Disposer；宿主在卸载时也会逆序兜底回收。
  ctx.ui.registerSettingsSection({ key: 'hello', label: () => 'Hello', component: HelloSection });

  // 也可返回总清理函数，负责停止插件自行创建的定时器等副作用。
  return () => { /* stop timers, cancel subscriptions */ };
}
```

**生命周期纪律**：

- `activate` 必须是同步返回（异步初始化放函数体内 fire-and-forget，或经 `ctx.events` 等待）。
- 所有副作用必须有对应的 disposer——泄漏副作用（卸载后 UI 残留、定时器存活）是拒审理由。
- 插件抛错不会拖垮宿主：每个插件 UI 挂载点有 ErrorBoundary 隔离；崩溃次数达阈值插件被自动隔离（quarantine），用户可在插件页手动恢复。

### 6.2 PluginContext

`PluginContext` 只暴露**通用**能力——会话/回合/切换生命周期、标准化运行时事实、内部提示贡献、受控文档存储、同源资源路由、悬浮层与工作区/会话扩展点。它不承载任何特定产品的领域概念（如某类协调器状态机、角色人设、渲染引擎对象或专有会话协议）；这类逻辑应完全由插件在自己的 bundle 内实现，宿主只提供上面这组与产品无关的原语。据此，同一份 SDK 契约可以同时承载能力取向迥异的插件，而互不感知对方引入的概念。

```ts
interface PluginContext {
  readonly pluginId: string;
  readonly version: string;
  readonly react: typeof import('react');

  hooks: {
    registerSessionHooks(hooks: SessionHooks): Disposer;
    registerTurnHooks(hooks: TurnHooks): Disposer;
    registerRuntimeSwitchHooks(hooks: RuntimeSwitchHooks): Disposer;
  };
  workspace: { getMetadata(): Promise<{ id: string; path: string }> };
  documentStorage: DocumentStorage;
  assets: PluginAssets;
  shell: { revealPath(path: string): Promise<void> };

  ui: {
    registerSettingsSection(d: SettingsSectionDef): Disposer;
    registerAddMenuRow(d: AddMenuRowDef): Disposer;
    registerComposerSlot(d: ComposerSlotDef): Disposer; // d.slot = addMenu | cliMenu | permissionMenu
    registerPanelTab(d: PanelTabDef): Disposer; // 页签条只渲染 icon，label 作 title / 可访问名
    registerConversationMode(d: { key?: string; label: () => string; component: ComponentType<PluginConversationProps> }): Disposer;
    registerStatusBarItem(d: StatusBarItemDef): Disposer;
    registerOverlay(d: Omit<OverlayDef, "id"> & { key?: string }): Disposer;
    registerCommand(d: CommandDef): Disposer;
    registerSessionMenuItem(d: Omit<SessionMenuItemDef, "id"> & { key?: string }): Disposer;
    openSettings(key?: string): void; // 跳转到本插件设置页（0.3.6 起）
    registerMarkdownRenderer(d: MarkdownRendererDef): Disposer;
    registerPage(d: PageDef): Disposer;
    registerTimelineRowRenderer(d: TimelineRowRendererDef): Disposer;
    registerWorkspaceMenuItem(d: Omit<WorkspaceMenuItemDef, "id"> & { key?: string }): Disposer;
  };
  theme: { injectCss(css: string): Disposer; setTokens(tokens: ThemeTokens): Disposer };
  i18n: { addBundle(lang: string, ns: string, resources: object): Disposer };
  storage: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  events: { on(topic: string, cb: (data: unknown) => void): Disposer; emit(topic: string, data: unknown): void };
  agent: {
    catalog(workspacePath: string): Promise<PluginAgentCatalogEntry[]>;
    start(def: {
      engine: string; prompt: string; workspacePath: string;
      model?: string; providerId?: string; sessionId?: string;
      readOnly?: boolean; requestId?: string;
    }): Promise<{ runId: string; sessionId: string | null }>;
    interrupt(runId: string): Promise<boolean>;
  };
  bridge: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  host: { appVersion: string; sdkVersion: string; locale: string; isWeb: boolean };
}
```

`ui:conversation-mode` 允许插件注册当前会话的替代界面；`PluginConversationProps.setExitBlocked` 锁定期间，关闭标签不会派发会话关闭事件或清除该会话的提示贡献。`ctx.agent.catalog` 需要 `agent` 权限，只返回引擎可用性、只读能力与渠道/模型显示信息，不返回认证或环境变量。`agent.start` 的可选 `requestId` 必须是 32 位十六进制标识；`interrupt` 返回是否已路由中断，`true` 仍需等待终态事件。

生命周期 hook 按插件注册顺序调用且逐插件隔离错误；`beforeTurn` 与 `beforeSwitch` 最多等待 2 秒，超时或异常均不阻断聊天或客户端切换。`beforeTurn` 可返回 `PromptContribution[]` 及内部消息捕获声明。内部提示不会进入 CCGUI 聊天画布、乐观用户消息或标题；当 CLI 无真正 system channel 时，`system-tail` 会降级为带清晰标记的 request tail，因此仍可能进入 CLI 自身原生历史。

`turnId` 在 `beforeTurn`、运行时事件和 `afterTurn` 之间保持稳定；`runId` 可能从启动前占位 ID 重绑定为引擎运行 ID。引擎启动失败也会派发一次 `afterTurn`，状态为 `failed`，尚无原生会话时 `sessionId` 为 `null`。插件应按 `turnId` 清理临时状态。`PromptContribution.onAccepted` 只在贡献通过预算且启动成功后调用，并保证先于该回合的 `afterTurn`，即使终态事件先于启动响应到达；失败的发送不能据此登记为已消费。

新增 `TurnHooks.onTurnStarted(event)`：只需 `runtime.events.read`，不要求 `prompt.contribute.internal`。它在 `beforeTurn` 收集完成、即将发送给引擎时派发；不等待观察者返回的 Promise，异常不会阻断发送。与 `afterTurn` 使用相同 `turnId`。开始后取消、发送拒绝和提前到达的终态均有对应结算。它不是可写提示钩子。

| 事件 topic | 载荷 | 所需权限 |
|---|---|---|
| `usage://updated` | 完整 EngineEventPayload `{ runId, sessionId, engine, seq, kind: "usage", data, ts?, genMs? }`；`data` 为引擎原始 usage JSON（字段因引擎而异，如 claude 的 `cache_read_input_tokens`、codex 的 `cached_input_tokens`、pi/omp 的 `cacheRead`）；`ts` 为宿主发射时刻 Unix 毫秒（SDK 0.3.8 起）；`genMs` 为宿主实测的生成窗口毫秒（SDK 0.3.15 起，仅 `usage`/`done` 事件携带，工具执行与等待不计入） | `events` |
| `usage://done`（SDK 0.3.8 起） | 同上形状，`kind: "done"`；`data.usage` 携带该轮最终用量——claude/grok 等不发独立 usage 事件的引擎只经此上报，其它引擎用作轮结束信号；`genMs` 为该轮生成窗口合计 | `events` |
| `session://activated`（SDK 0.3.8 起） | `{ engine, sessionId }`；pending 标签 `sessionId` 为 null，无活动标签两者皆 null | `events` |
| `composer://draft` | `{ text }`；草稿变化/清空/会话切换均发射 | `events` |

SDK 0.4.2 起，`RuntimeSwitchEvent` 包含必填 `switchId`，同一次启动的 `beforeSwitch` 与 `afterSwitch` 共享此身份。插件应同时核对切换身份与原生命周期，不能让停用前的迟到完成覆盖重新启用后的切换状态。

`BeforeTurnResult.isCurrent` 是可选的纯同步生命周期守卫，用于某个工作区关闭功能、但插件仍在其他工作区运行的情形。宿主在收集结果、再次注入、启动接纳及内部帧解析和投递时检查；返回 `false` 或抛错会撤销该结果，已失效的生命周期不得再返回 `true`。已返回的结果必须捕获其原始生命周期，不能只读取可能再次开启的全局布尔值。失效后不再隐藏新候选帧，也不再投递已排队的内部消息。这不是回滚或取消已发出任务的接口：已发出的工作允许自然完成。

宿主不会重新注入已注销注册者的缓存提示。原生 CLI 历史无法抹去，因而停用后的下一次发送会携带一次性旧指令撤销；启动失败则保留重试，接纳后不重复发送。撤销不删除历史任务事实，也不启动插件读写。旧指令撤销是发送给模型的提示，不保证任意模型遵从，不能作为技术安全边界。

`ctx.ui.registerWorkspaceMenuItem`（权限 `ui:workspace-menu`）的 `label`、`visible` 和 `onSelect` 接收右键目标 `{ workspaceId, archived }`，不是当前活动工作区。菜单项应绑定用户看到的动作，避免异步保存完成后把旧的“停用”选择反转成“启用”。返回的 Disposer 及插件卸载均会移除菜单项。

`ctx.ui.registerSessionMenuItem`（权限 `ui:session-menu`，0.3.5 起）向侧栏会话右键菜单追加行；`run` 接收打开菜单的目标会话 `{ engine, sessionId }`，`label` 是随语言切换重新求值的函数。它与工作区菜单是独立的扩展点。`ctx.ui.openSettings(key?)`（复用权限 `ui:settings-section`，0.3.6 起）跳转到本插件设置页；`key` 对应 `registerSettingsSection` 的子 key，省略时打开主 section。SDK 0.4.1 同时保留这两项能力和工作区菜单。

`ctx.documentStorage` 是 `ctx.storage` KV 之外的受控 UTF-8 文档存储：根目录固定隔离在 `<所选位置>/plugin-data/<plugin-id>/`，路径必须相对且不能逃逸；`writeTextAtomic(path, content, expectedVersion)` 使用不透明版本做 CAS，`expectedVersion: null` 表示要求文件尚不存在。`selectLocation('custom')` 由宿主打开目录选择器，插件不能提交任意绝对根路径。

路径使用 `/` 分隔；检查原始输入中的空段、`.`、`..`，不接受 `a/./b`、`a//b` 或末尾 `/` 的别名写法。`list()` 的空前缀仍表示列出根目录。

`documentStorage` 是内容寻址（CAS）文本存储：`readText` 返回 `{ content, version }`，`version` 是不透明比较令牌，仅用于回传，不要解析或据其推断顺序。`remove(path, expectedVersion?)` 与写入同样走 CAS——传入上一次读取到的 `version` 即为条件删除，若磁盘上的版本已被其它写入推进（stale），删除以 conflict 被拒绝并保留较新的文档；省略或传 `null` 为无条件删除。据此模式：读到版本 → 基于该版本删除，可保证「只删除我刚读到的那份内容」，避免误删他处并发写入的新版本。

### 6.3 标准化运行时事件（只读）

`TurnHooks.onRuntimeEvent` 接收宿主可确定的 `NormalizedRuntimeEvent`：`file-changed`、`command-started`、`command-finished`、`tool-finished`、`permission-requested`、`assistant-completed`、`turn-cancelled`、`turn-failed`、`runtime-exited`。公共字段包括 `eventId/runId/turnId/engine/sessionId/workspaceId/workspacePath/occurredAt/kind`；只有 adapter 确定知道的命令、退出码、文件变化和状态才会出现，宿主不会从模型正文推断事实。

`beforeSwitch` / `beforeTurn` 准备期间被用户 Stop 的发送，不再触发 `onTurnStarted` 或启动后端回合。发送已经启动但响应迟到时，取消只清理该次发送的 `runId`；同一会话中后续启动的替代回合不受影响。

`permission-requested` 来自引擎结构化 `permission_denied`，只携带 `tool: string | null` 与 `path: string | null`，不携带给用户展示的 message。缺失、空白或非字符串字段为 `null`，非对象载荷不发布事件。它表示宿主可以展示授权卡片，**不保证引擎仍在运行或正在暂停等待**；插件仍须用回合终态收敛状态。

> 想消费这里没有的宿主事实？到索引仓开 issue 提议通用事件，不要绕过 SDK 抓 DOM/store。

### 6.4 UI 组件纪律

- 用宿主提供的 React 实例（构建模板已配置 external）；**禁止**自带 React 副本。
- 样式优先用 BoardUI 语义 token（`bg-background-*`、`text-text-*` 等），**禁止**写死 hex 颜色——深色模式靠 token 自动翻转。
- 插件 UI 文本必须走 `ctx.i18n` 注册的资源，至少提供 `en` 与 `zh-CN`。

### 6.5 常驻悬浮层与资源 URL

`ctx.ui.registerOverlay({ key?, component, order? })` 提供视口级非模态挂载点，与设置页、插件页面路由无关。宿主不管理位置、尺寸或拖动；挂载容器 `pointer-events: none`，交互子元素应显式设置 `pointer-events: auto`。返回的 Disposer 和插件卸载都会移除挂载，渲染错误由各自的 `PluginBoundary` 隔离（悬浮层的 fallback 为空，不在视口里留下错误卡片）；注册表为空时宿主不渲染任何容器。普通悬浮内容不应挡住宿主操作；确需浏览器顶层时由插件管理 Popover API，并在卸载时清理。

```ts
interface AssetDirectoryGrant { grantId: string; path: string }
interface PluginAssets {
  bundleUrl(relativePath: string): string;
  documentUrl(relativePath: string): string;
  remoteUrl(url: string): string;
  grantDirectory(): Promise<AssetDirectoryGrant>;
  listDirectories(): Promise<AssetDirectoryGrant[]>;
  revokeDirectory(grantId: string): Promise<void>;
  directoryUrl(grantId: string, relativePath: string): string;
}
```

- `bundleUrl`：权限 `assets:bundle`，路径相对于已安装插件目录；包内 JS/wasm 可作为资源读取，不允许从远程或目录授权来源执行脚本。
- `documentUrl`：权限 `plugin.storage`，始终解析到本插件当前选择的 documentStorage 根。写入仍走原有 CAS 文档接口。
- `remoteUrl`：只接受无用户名/密码的 HTTP(S) URL；复用精确 `network:<host>[:port或范围]` 授权，子域不会自动获得权限。远程重定向的每个目标也必须已授权。没有运行时动态域名授权。
- `grantDirectory` / `listDirectories` / `revokeDirectory` / `directoryUrl`：权限 `assets:directory`；选择器只能由明确用户操作触发，不能在插件激活期弹出。取消选择会 reject。每插件最多 16 个目录，重复选同一规范目录复用 grant；授权不会放开宿主的通用文件访问。路径用 `/` 分隔且相对于授权根，不能带绝对路径、`.` 或 `..` 段。
- `ctx.shell.revealPath(path)`：只在文件管理器中定位真实存在的本插件 documentStorage 路径或已授权目录内路径；分别要求 `plugin.storage` / `assets:directory`。不提供任意文件打开、进程启动或目录外探测能力。

返回的 URL 可用于 `fetch`、图片、音频及描述文件的相对依赖加载；资源内容按字节传递，不经文本或 base64 转换。桌面使用 `pluginasset` 协议，Web 使用带鉴权路径前缀的宿主路由，因此相对资源请求仍携带凭据；这些 URL 是临时能力地址，不应记录到日志或分享给外部站点。

本地 MP3、WAV、OGG、M4A、MP4、WebM 按对应的 `audio/*` / `video/*` MIME 返回；未知扩展名仍为 `application/octet-stream`，非包内主动内容仍受下述 MIME 降级规则约束。

本地来源（包内、documentStorage、已授权目录）单文件上限 64 MiB；远程代理单次上限 8 MiB 且限时 30 秒——两个上限语义不同，大贴图集走本地来源，不要指望远程代理放行同样体积。每次读取都重新检查插件是否安装、启用、未隔离以及对应权限，响应禁止缓存；目录撤权、插件禁用/隔离/卸载后，旧 URL 不能继续读取资源。卸载始终清除目录授权（能力，不是用户数据）；documentStorage 文件和位置选择则沿用 `delete_data` 策略，不会因新增资源能力而自动删除用户保留的数据。

非包内 HTML、JS、SVG、XML、CSS、PDF、wasm 等主动内容按 `application/octet-stream` 返回并带 `nosniff` / sandbox CSP，不可借资源代理扩大脚本执行能力。插件仍运行在宿主同一 JS realm；overlay 与资源门面是可审计能力面，不是新的强制沙箱边界。

## 7. 权限规范

| 权限 | 能力 | 审核强度 |
|---|---|---|
| `storage` | 使用 `ctx.storage` KV | 低 |
| `ui:*`（`ui:settings-section`、`ui:add-menu`、`ui:composer-status`、`ui:panel-tab`、`ui:status-bar`、`ui:page`、`ui:command`、`ui:markdown`、`ui:timeline-row`、`ui:workspace-menu`、`ui:session-menu`） | 对应 UI 扩展点；`registerComposerSlot` 与 `registerComposerStatusItem` 共享 `ui:composer-status`，`openSettings` 复用 `ui:settings-section` | 低 |
| `ui:overlay` | 常驻视口悬浮内容；不得遮挡宿主关键操作 | 中 |
| `assets:bundle` | 读取本插件包内二进制资源和已审核脚本 | 中 |
| `assets:directory` | 用户选择的每插件只读目录与范围内 reveal | 高（必须明确告知目录范围） |
| `theme` | 注入 CSS / 覆盖 token | 低（Tier-0 隐含拥有） |
| `i18n` | 注册语言资源 | 低 |
| `events` | 插件事件总线；订阅涉及用户行为数据的宿主事件时须在 description 说明用途 | 按订阅数据评审 |
| `session.lifecycle.read` | 观察 session 新建、恢复、关闭 | 中 |
| `runtime.events.read` | 只读回合开始、结算及标准化运行时事实 | 中 |
| `runtime.switch.observe` | 观察切换前后生命周期；失败不阻断切换 | 中 |
| `workspace.metadata.read` | 读取稳定 workspace ID 与绝对路径 | 中 |
| `plugin.storage` | 使用受控文档存储和位置选择 | 中 |
| `prompt.contribute.internal` | 向有效 CLI 请求加入用户不可见的内部提示，并接收捕获的内部消息 | 高（安装时必须明确告知） |
| `network:none` / `network:<host>[:port或范围]` | 声明无网络，或授权宿主代理访问精确 host | 高 |
| `exec:<bin>` | 授权宿主执行精确裸命令名 | 高 |

1. 未声明的权限调用会被门面拒绝并记录——这是**评审/DX 门**（拦截误用、给评审提供可审计面），不是技术强制边界；市场版本新增权限必须显著提示用户。
2. 网络和进程能力仅经 `ctx.bridge.invoke` 的宿主代理命令执行；插件没有原始 `fetch`，`network`/`exec` 授权不接受通配符或路径。
3. `prompt.contribute.internal` 的内容对 CCGUI 用户界面不可见，必须按不可信数据处理；nonce 只做 turn 关联，不构成认证。
4. 申请用不到的权限会被 CI 标记，审核员会要求删减。

> **权限模型的性质（务必理解）**：JS 插件与宿主 UI **同源**运行在同一 webview 中。`ctx` 权限门面与 Rust 侧桥命令的安装/启用/授权校验是**评审与开发体验（DX）门**——拦截误用与意外越权，并为市场评审提供可审计面，**不是技术强制沙箱**：同源 JS 仍可通过异步续体、React 事件 handler、同源 iframe 等绕过门面直接触达 IPC，Tauri IPC 也无法在进程内区分宿主 UI 与插件 JS。真正的边界是**安装期评审 + 隔离/隔离区（quarantine）+ 卸载与生命周期追踪**；彻底的进程级隔离属后续架构演进。因此插件作者须以「最小权限、诚实声明」自律，评审员以 manifest 声明与实际行为的一致性为准。

## 8. 声明式插件（Tier-0）规范

Tier-0 插件 = `manifest.json` + CSS/i18n 资源，**不含任何 JS**。宿主解释 `contributes` 执行。

```jsonc
// manifest.json —— 一个主题插件的完整示例
{
  "id": "theme-midnight",
  "name": "Midnight 主题",
  "version": "1.0.0",
  "minAppVersion": "1.1.0",
  "author": "you", "description": "深蓝午夜主题", "repo": "you/ccgui-plugin-midnight",
  "tier": "declarative",
  "license": "MIT",
  "contributes": {
    "themes": [{ "id": "midnight", "name": "Midnight", "dark": true, "css": "styles.css" }]
  }
}
```

```css
/* styles.css —— 只允许覆盖语义 token 与安全属性 */
.dark {
  --background-primary-default: #0d1117;
  --text-primary: #e6edf3;
}
```

**CSS 约束**（CI 静态解析强制）：

- 禁止 `@import`；禁止 `url()` 引用远程资源（`data:` 内联允许，单文件 ≤ 100KB）。
- 禁止 `position: fixed` 全屏遮罩、禁止 `z-index` > 1000、禁止 `!important`（token 覆盖除外）。
- 禁止隐藏/遮挡宿主核心 UI 的选择器（审核员人工判断，如 `display: none` 作用于发送按钮）。

## 9. 构建与发版规范

### 9.1 构建（模板已配置好，无需手改）

- Vite lib mode 输出单文件 ESM；`react`、`react-dom/jsx-runtime`、`@ccgui/plugin-sdk` 标记 external（运行时由宿主基座注入）。
- `pnpm validate` 本地跑与市场 CI 相同的检查：manifest schema、bundle 体积、权限-代码比对、CSS 静态解析、黑名单扫描（`eval` / `new Function` / `__TAURI__` / `localStorage` / 远程 `import(`）。

### 9.2 发版

1. `manifest.json` 的 `version` +1（semver，见 §12）。
2. `git tag <version> && git push origin <version>`（tag = version，无 `v` 前缀）。
3. 模板自带 GitHub Action 构建三件套并附加到该 tag 的 Release。
4. **已进市场的插件**：另需向索引仓提「版本登记 PR」（见 §10.3），否则用户收不到更新。

### 9.3 可选：minisign 签名（「已验证」徽章）

```bash
minisign -Sm dist/main.js -p your-plugin.pub   # main.js.minisig 一并传到 Release
```

将公钥登记在索引仓的 `plugins/<id>.json`。签名非强制，但带徽章的插件在市场上标识为「已验证」，且**权限升级时用户无需重新确认**。

## 10. 上架流程（提交到市场）

市场 = 中央索引仓库 `ccgui-plugins`（纯 GitHub，无自建服务器）。

### 10.1 首次上架

1. Fork 索引仓库。
2. 在 `community-plugins.json` 追加一条（保持按 id 字典序）：

```json
{ "id": "usage-stats", "repo": "zhangsan/ccgui-plugin-usage-stats", "name": "用量统计", "description": "统计各引擎 token 用量与花费", "author": "zhangsan" }
```

3. 新增 `plugins/usage-stats.json`（`icon` / `screenshots` 由 manifest 镜像而来，机器人登记新版本时自动写入；首次上架照抄 manifest 的值即可，都不填就省略）：

```json
{
  "id": "usage-stats",
  "repo": "zhangsan/ccgui-plugin-usage-stats",
  "tier": "js",
  "version": "1.0.0",
  "minAppVersion": "1.0.2",
  "sdkVersion": "^0.3",
  "permissions": ["storage", "ui:settings-section"],
  "sha256": {
    "main.js": "<64 位小写 hex>",
    "manifest.json": "<64 位小写 hex>",
    "styles.css": "<64 位小写 hex>"
  },
  "icon": "docs/icon.png",
  "screenshots": ["docs/screenshot-1.png"]
}
```

4. 提 PR。CI 自动执行：
   - 仓库结构检查（根 manifest、LICENSE、README、release.yml）
   - manifest schema 校验 + `id` 唯一性 + `version` ↔ 最新 Release tag 一致性
   - 下载 Release 产物：SHA256 登记、bundle 体积、黑名单扫描、权限-代码比对
   - 生成**审核报告**评论在 PR 里（权限清单、网络域名、体积、扫描结果）
5. 人工审核（通常 3 个工作日内）：按 §11 标准过一遍，通过后合并即上架。

### 10.2 上架后用户侧流程（你无需关心，供理解）

App 市场页 → Rust 拉索引 → 用户点安装 → 从 Release 下载三件套 → 校验 SHA256 → 按 manifest 的 `icon` 从默认分支补落品牌图（失败只跳过）→ staging 目录 → 健康检查（冷加载 activate 一次）→ 原子替换生效。任一步失败，已装版本不受影响。

### 10.3 版本更新

1. 按 §9.2 在你的仓库发新 Release。
2. 向索引仓提「版本登记 PR」（只改 `plugins/<id>.json` 无代码变更时，机器人可自动合并）。
3. 权限有新增 → 转人工审核，且老用户升级时会看到权限 diff 确认。
4. App 端每 24h 比对索引版本，向用户提示可更新。

> 「版本登记 PR」里的 `updatedAt` 取该 Release 的发布时间（RFC 3339 UTC，如 `2026-09-20T08:30:00Z`）；机器人开 PR 时自动写入，CI 只校验格式。App 详情页用它显示「最近更新时间」，值缺失只是不显示这一行。
>
> 同一 PR 还会带上 manifest 里的 `icon` / `screenshots`（见 §5.1）：改了素材路径就随下一次发版自动进索引；只换图内容（路径不变）则连发版都不需要。

### 10.4 下架

- 作者主动下架：PR 删除索引条目（用户已装副本不受影响）。
- 违规下架：维护者可标记 `plugins/<id>.json` 为 `"delisted": true`，市场隐藏且已装用户收到安全提示。

## 11. 审核标准与禁止事项

### 11.1 一律拒审的行为

| 禁止事项 | 原因 |
|---|---|
| `eval`、`new Function`、远程 `import()`、`<script>` 注入 | 远程代码执行面 |
| 访问 `window.__TAURI__` / `__TAURI_INTERNALS__` / 宿主内部 store | 绕过权限模型 |
| 读写 `localStorage` | 跨插件污染，须用 `ctx.storage` |
| 混淆/压缩到不可读的代码（合理 minify 除外，需附 sourcemap 或源码对应关系） | 可审核性 |
| 收集用户对话内容、API key、文件路径并外发 | 隐私红线，永久拉黑作者 |
| 未声明的 `network` 行为、域名白名单外的请求 | 权限模型 |
| `description` 与实际功能不符、伪装成官方插件 | 信任 |

### 11.2 审核员 checklist（公开版）

1. manifest 与实际行为一致（功能、权限、域名）。
2. 全部副作用有 disposer，卸载后 UI/DOM/事件无残留。
3. UI 用 BoardUI token，深浅色模式均可用；i18n 至少 en + zh-CN。
4. 崩溃不拖垮宿主（ErrorBoundary 内渲染，无全局异常吞噬）。
5. README 说清楚：干什么、要什么权限、数据去哪。
6. 无 §11.1 禁止事项。

### 11.3 质量标准（不强制但影响推荐位）

- bundle 小、激活快（activate < 50ms）、无控制台噪音。
- 提供截图、关键词准确、configSchema 有合理的默认值与 `title`（市场自动生成表单直接可读）。

## 12. 版本更新与兼容性策略

### 12.1 semver 纪律

- **patch**：bug 修复，不变 SDK 用法。
- **minor**：新增能力/权限（权限 diff 会提示用户）。
- **major**：破坏性变更（配置结构、贡献点 id 变更）。

### 12.2 宿主兼容性

- `minAppVersion` 决定哪些 App 版本能装。宿主 SDK 按 semver 演进，废弃 API 至少保留一个大版本并提前在索引仓公告。
- 宿主升级后若插件 `minAppVersion` 不再满足，插件被**自动禁用**并在市场页提示「等待插件更新」——用户数据保留。
- 插件用 manifest 的 `sdkVersion` range（如 `^0.4`）声明兼容的 SDK 契约区间，宿主加载时握手校验。range 必须是可解析的 semver 约束：只支持 `*`/缺省、精确 `x.y.z`、`^x.y.z`、`~x.y.z`、`>=x.y.z`，其余写法一律视为不满足。**`0.3.x` 这类占位写法不是合法值**——`x` 不是数字段，握手会判定不兼容；文档在能力条目里出现的 `0.3.5 起`、`0.4.2 起` 是能力**引入序标注**，不是可照抄进 manifest 的 range。
- 共通兼容线为 `0.3.17`（在上游 `0.3.15` 之上叠加 CCB + Live2D 通用能力），CCB 与 Live2D 插件声明 `sdkVersion: ">=0.3.17"`：这是最低 SDK 版本，不是精确版本锁；后续更高版本可通过握手，低于 `0.3.17` 仍会被拒绝。宿主仍须提供插件依赖的通用能力和权限；来源版本标注不等于本线的 manifest 版本，也不能凭能力存在跳过其他插件声明的版本范围。

### 12.3 配置迁移（`configVersion`）

`configSchema` 破坏性变更时 `configVersion` +1。宿主升级插件后：已知键保留、被删键丢弃、新键补默认值。需要自定义迁移的，在 `activate` 里读旧值自行处理后再写回。

### 12.4 用户数据

- 用户卸载插件时可选择「保留数据」（默认保留 30 天后自动清理）或「立即删除」。插件**不得**在卸载路径上做阻止、隐藏数据等对抗行为。

## 13. 用户数据与安全规范

1. **最小采集**：只拿实现功能必需的数据；session、runtime 和 workspace 数据禁止无授权外发。
2. **secret 字段**（`ccgui:role: "secret"`）仅写入不回显，存于每插件隔离 KV；禁止把 secret 打到日志。
3. **网络请求**：仅限 `network:<host>[:port或范围]` 授权；禁止把用户对话内容、文件路径、API key 作为请求参数外发。
4. **依赖供应链**：构建期依赖锁定（lockfile 入库）；Release 产物必须由模板 Action 从源码构建——**禁止手工上传本地构建的产物**（CI 会比对）。
5. 发现安全漏洞：向索引仓 Security Advisory 私密报告，48h 内响应；确认后下架受影响版本。

## 14. FAQ

**Q：我的插件需要一个 SDK 没有的能力（新事件、新扩展点）？**
A：到索引仓开 issue 描述场景。宿主每版本评估扩展 SDK；SDK 走 semver，废弃 API 提前一个大版本公告。

**Q：插件能用 npm 依赖吗？**
A：能，但全部在构建期打进单文件 bundle（注意 2MB 硬上限）。运行时禁止加载任何外部模块。

**Q：为什么插件不能直接用 `fetch`？**
A：CSP 与信任模型要求网络 IO 走 `ctx.bridge.invoke` 的宿主代理，并用 `network:<host>[:port或范围]` 精确授权。

**Q：AI 生成的插件能上架吗？**
A：可以，与人工插件同标准审核；上架前请在 PR 里注明「含 AI 生成代码」。未上架的 AI 生成插件按 Tier-2 个人插件在本地使用（生成时会向你展示代码 diff 与权限清单，确认后生效）。

**Q：插件之间能互相依赖/通信吗？**
A：没有插件间依赖机制（刻意决策，避免依赖地狱）。事件总线允许 `plugin:<id>:` 前缀的事件，跨插件协作属高级用法，文档不承诺兼容。

**Q：我的插件违规被下架了，申诉渠道？**
A：索引仓开 issue 并 @maintainers，说明整改内容；隐私红线类违规不接受申诉。

---

*本规范随插件系统版本演进，变更历史见索引仓库 `SPEC-CHANGELOG.md`。*
