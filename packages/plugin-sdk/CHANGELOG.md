# @ccgui/plugin-sdk changelog

## 0.3.16 — 2026-09-24
- 新增权限 `host:window` 与 `ctx.window`：读取主窗口物理像素 bounds/state/DPI、
  在普通态经最小尺寸和多屏可见范围校验后设置 size+position，以及在 Windows
  按 `Weixin.exe` / `WeChat.exe` 可执行名采样微信主窗口。非 Windows 返回
  `Unsupported`，未找到返回 `NotFound`。自动恢复偏好继续存于插件自有 storage，
  不改变宿主默认窗口，也不引入第二套窗口状态所有者。
- 新增权限 `host:models` 与 `ctx.models`：直接复用宿主 `list_engines` 与
  `list_engine_models` 权威实现，公开 engines、逐引擎 catalog 和聚合 catalog；
  保留 provider/contextWindow/authoritative/remote，显式排除 API key、token 与
  完整 provider 配置。模型 API 可经远程宿主执行；窗口 API 保持桌面专属。
- 这些能力需要宿主 `minAppVersion: "1.0.10"`；SDK 契约升至 0.3.16。
- `ctx.models.catalog({ workspace?, refreshProviders? })` 按引擎、来源部分成功，返回
  `engines[].sources[]`、`errors` 与 `refreshedAt`，并标注 CLI、中转渠道、自定义与默认模型来源。
  默认不联网；只有显式 `refreshProviders: true`（必须绑定用户手动动作）才刷新渠道
  模型。单个探针失败只返回脱敏错误，URL、key、响应体和底层错误均不外泄。

## 0.3.15 — 2026-09-23
- **payload 增强**：引擎事件 wire payload 新增 `genMs`（宿主实测生成窗口毫秒数）——只出现在 `usage` / `done` 事件上，计量该报告对应的模型
  真实生成时间：从响应流打开（引擎 message_start，或首个文本/思考 delta）
  到流关闭，工具执行、用户等待与轮间隔全部排除。插件用它算 tok/s
  （output token ÷ 生成窗口）即得不含工具等待的生成速度；字段缺失时
  回退旧的相邻报告 `ts` 间隔。首个消费者：token-meter 插件。

## 0.3.14 — 2026-09-23
- `ui:conversation-mode` / `ctx.ui.registerConversationMode({ key?, label, component })`
  注册当前会话内的替代界面。`PluginConversationProps` 提供稳定的 `conversationId`、
  `workspacePath`、`language` 与 `onExit`；普通会话发送中或队列非空时不可进入。
- `PluginConversationProps.setExitBlocked?(blocked)` 供插件在 layout effect 中报告
  忙碌/恢复状态；锁定时宿主禁用退出按钮且拒绝 `onExit()`。锁按会话挂载隔离，
  切换会话后旧回调不能退出新界面；空闲状态下仍可从崩溃边界返回普通对话。
- `ctx.agent.catalog(workspacePath)`（`agent` 权限）只返回引擎可用性、只读能力、
  渠道与模型的 ID/显示名，不返回配置、认证或环境变量。模型探测不可用时为 `[]`，
  引擎与配置读取失败仍会 reject。禁用的引擎不出现在列表中。
- `ctx.agent.start` 新增可选 `readOnly`；只读能力以 native 实现为准，目前仅 Pi
  支持隔离只读调用；Codex 不宣称支持。未提供时保留既有行为。
- `start({ requestId? })` 接受 32 位十六进制请求标识，native 生成
  `pa-{pluginId}-{requestId}`；插件可在启动前持久化预期 run id 来恢复早到事件。
  `interrupt(runId): Promise<boolean>` 保留 native 返回值：`true` 为已路由中断
  （仍需等待终态事件），`false` 为没有匹配的活动 run。

## 0.3.13 — 2026-09-21
- **新增能力 `agent`**：`ctx.agent.start/interrupt` 让插件经宿主引擎管线
  运行 agent 轮次——与聊天发送共用 spawn/reader/registry（渠道注入、进程
  注册、中断），事件走独立的 `plugin-agent://event` 流，前端按 run id
  属主前缀路由到 `agent://<pluginId>` 总线话题。插件 run 不会进 chat
  store，也不被 chat 的 Stop 误杀。桌面专属。
- 权限单一事实源新增 `agent`；通用 bridge 白名单同步放开
  `plugin_agent_start` / `plugin_agent_interrupt`。

## 0.3.12 — 2026-09-21
- **新增扩展点 `ui:sidebar-entry`**：`ctx.ui.registerSidebarNav` 在首页侧栏
  内建「自动化」入口之下注册导航项（label/icon/order/onOpen），经宿主
  `sidebarNavRegistry` 渲染，与内建导航同一 chrome。
- **新增扩展点 `ui:center-tab`**：`ctx.ui.registerCenterTab` 注册中心页签
  定义（title/icon/component），`ctx.ui.openCenterTab(key?)` 打开或聚焦——
  页签与会话/文件/浏览器共享中部页签条，组件渲染在 PluginBoundary 内。
  打开未注册的页签会抛错（失败必须可见）。
- 权限单一事实源 `spec/permissions.json` 新增上述两项；TS/Rust/模板校验
  全部自动派生。

## 0.3.11 — 2026-09-18
- **修复权限漂移**：`registerComposerSlot` 运行时一直校验 `ui:composer`，
  但该字符串在 0.3.9 改名为 `ui:composer-status` 时未同步更新
  （`spec/permissions.json` 的 `knownPermissions` 早已只保留
  `ui:composer-status`），导致 `registerComposerSlot` 自 0.3.9 起对任何
  manifest 声明都必然拒绝——没有任何权限字符串能通过校验。改为校验
  `ui:composer-status`，与 `registerComposerStatusItem` 共享同一权限，
  两个注册点现在都能正常声明使用。

## 0.3.9 — 2026-09-16
- **新增能力**：`ctx.ui.registerComposerStatusItem({ key?, component, order? })`
  （新权限 `ui:composer-status`）——在 composer 状态行（分支/上下文用量那行）
  左组、分支切换器之后渲染 chip。首个消费者：token-meter 指标插件从底部状态栏
  迁至会话工具行。

## 0.3.8 — 2026-09-16
- **新增能力**：`registerStatusBarItem` 的 `zone?: "start" | "end"`——`"start"`
  把 chip 渲染到状态栏左对齐区（内建控件簇左侧），缺省/`"end"` 保持既有槽位
  （同步状态之后、版本号之前）不变。首个消费者：token-meter 指标插件。
- **新增宿主话题**（权限 `events`）：`usage://done`——引擎 done 事件透传
  （payload 同 EngineEventPayload，`data.usage` 携带该轮最终用量；claude/grok
  等只经 Done 上报用量的引擎由此对插件可见）；`session://activated`——活动会话
  切换，payload `{ engine, sessionId }`，pending 标签 sessionId 为 null，无活动
  标签时两者皆 null。
- **payload 增强**：引擎事件 wire payload 新增 `ts`（宿主发射时刻，Unix 毫秒），
  前端 `EngineEventPayload` 同步为 `ts?: number`；插件可用它算吞吐而不受 IPC
  批量/到达抖动影响，旧宿主上缺省回退到达时间。

## 0.3.7 — 2026-09-16
- **新增能力**：`ctx.sessions.refresh()`（复用权限 `host:session`）——请求宿主立即
  刷新会话目录（侧栏/标签页）。插件绕过宿主直写会话数据（sqlite custom_title、
  转录 title 行）后调用，变更即刻可见，不再依赖手动同步或重启。首个消费者：
  auto-title 命名/自愈补写后即时刷新侧栏。

## 0.3.6 — 2026-09-16
- **新增能力**：`ctx.ui.openSettings(key?)`（复用权限 `ui:settings-section`）——跳转到
  本插件的设置页（hash 路由 `#/settings?page=plugin:<id>[:<key>]`），供状态栏 chip、
  面板按钮等做深链入口。首个消费者：auto-title 状态栏 chip 点击改跳设置页。

## 0.3.5 — 2026-09-16
- **新增能力**：`ctx.ui.registerSessionMenuItem({ key?, label, icon?, danger?, run })`（权限
  `ui:session-menu`）——在侧栏会话右键菜单追加一行，`run` 收到打开菜单的会话
  `{ engine, sessionId }`；label 为 thunk，语言切换即时重命名。首个消费者：auto-title
  插件的「重新命名（自动命名）」菜单项。

## 0.3.4 — 2026-09-14
- **新增能力**:`ctx.sessions.registerSource({ id, list })`(权限 `host:session`)——登记
  外部会话源(远程机/容器内 CLI 的会话摘要),宿主在会话目录刷新时调用 `list()` 并把行合并进
  侧栏列表;本机扫描结果优先,行 `workspacePath` 须为已登记工作区 path。配套类型
  `ExternalSessionRow`;返回 Disposer,卸载自动注销。
- **新增权限**:`host:workspace:remote`——`ctx.workspaces.add` 的 meta 携带 `wsl` 键
  (远程工作区,宿主引擎经 ssh 把会话流量导到插件指定主机)时必需;仅 `host:workspace`
  的插件不能再设置远程 meta。等效于出网 + 远程执行导向,故独立于工作区登记授权。
- **修复**:`events` 权限条目在权限 spec 中被误删导致存量插件无法加载的问题,已恢复
  (契约本身无变化)。
- **加固**(宿主侧,契约不变):registerSource 入口校验 def 形状;同步抛错的会话源被
  隔离(不再连累其他源与整轮刷新);外部行字段类型校验 + 单源 500 行上限;
  `selectSession` 的错误统一走 Promise rejection。

## 0.3.3 — 2026-09-13
- **新增能力**:`ctx.workspaces.add(path, meta?)`(权限 `host:workspace`)——把任意路径
  登记为侧栏工作区,不要求本机存在该目录(远程机/WSL 发行版内路径);meta 透传存储,
  如 `{ wsl: { hostId, distro } }`(0.3.4 起携带 `wsl` 键需 `host:workspace:remote`)。
- **新增能力**:`ctx.sessions.selectSession(engine, sessionId, workspacePath)`(权限
  `host:session`)——按引擎 + 会话 id 打开/恢复既有会话;未知组合抛错,不静默。
- 注:0.3.3 未单独发布,上述能力随 0.3.4 首次落地;版本戳保留以标注能力引入序。

## 0.3.2 — 2026-09-12
- **新增能力**：`ctx.composer.setDraft(text)`（权限 `composer:draft`）——写入当前活动会话的
  聊天输入框草稿；替换语义，不触发发送。配合既有 `composer://draft` 事件（host→plugin）构成
  草稿的双向通道；react-doctor 的「一键修复」填入修复提示词即首个消费者。

- **spec 单一事实源**：`KNOWN_PERMISSIONS` 改为从包内 `spec/permissions.json` 生成；
  授权形状/放行测试向量由 TS、Rust（include_str!）、模板校验脚本三方共享，漂移在 CI 暴露。
- **模块拆分**：`src/index.ts` 拆为 manifest / permissions / version / registry / context
  五个关注点模块，index.ts 变为纯 re-export barrel（导出集合不变）；manifest/permissions/version
  零运行时依赖，Node 校验脚本可直接 import。
- **新增导出**：`scopedPluginId` / `pluginIdFromRegistryKey` / `compareByOrder`
  （注册表条目 id 构造/逆运算与 order 排序比较器）。
- **修复**：`satisfiesSdkRange("^0.0", "0.0.0")` 此前误判 false——`^0.0` 省略 patch
  现在正确地匹配任意 0.0.x（与文档化的 `^0.2` 省略语义一致）。
- **修复**：`compareVersions` 遇到非数字段（"0.a.1"/"latest"）现在抛出明确的 Error，
  不再静默返回 NaN 使比较失真。
- **修复**：`parseNetworkGrant` 拒绝把 `none` 当作授权 host——`network:none` 是基座权限
  （声明无网络），永远不是授权；此前 `network:none` 会被解析成放行主机 "none" 的 grant
  （与 Rust 侧行为对齐，spec networkAllow 向量覆盖）。
- `plugin_exec_spawn` 桥命令成功时 resolve 为 void（Rust 返回 ()），文档同步更正。
- 新增 `src/contract-check.ts`：类型层面把守 plugin.d.ts 与 src/* 的双向漂移
  （纯数据类型双向可赋值；PluginContext 各能力组 key 完全对齐）。

## 0.3.1 — 2026-09-09

- `plugin_exec_spawn` 新增可选 `lifecycle: "detached" | "plugin"`（缺省 detached，行为不变）；
  `"plugin"` 的子进程由宿主跟踪，插件禁用/卸载时自动 kill。
- 新增 `plugin_exec_kill`：kill 本插件全部 lifecycle="plugin" 子进程（改名重启用；需任意 exec: 授权）。
- 动机：prompt-shield 类插件的附属代理进程需要随插件生命周期回收；tokentracker 类用户级服务保持 detached。
- 加载器修复：`styles.css` 现在对 js 插件也自动注入（此前只有 declarative 注入，js 插件的样式文件产而不装——prompt-shield 设置页"样式丢失"即此因）。样式表属三件套产物，不走 `theme` 运行时权限门；远程引用拒止仍生效。

插件系统契约包的独立版本史。宿主运行时随 app 发版，本包版本表达**契约**的演进；
插件经 manifest `sdkVersion` range 声明兼容区间（VS Code `engines.vscode` 同款模式）。

## 0.3.0 — 2026-09-09（breaking：通用能力出口）

- **breaking**：`cmd:<command>` 逐命令授权机制整体删除（`GRANTABLE_COMMANDS` 移除）；
  `tt_proxy` / `tt_detect_cli` / `tt_server_status` / `tt_install_cli` / `tt_ensure_server`
  五条 usage-stats 专属桥命令随宿主侧 tokentracker.rs 一并退役。
- 新增通用能力出口三条：`plugin_http_request`（域名白名单 HTTP 代理，响应文本上限 8MB）、
  `plugin_exec_run`（二进制白名单进程执行，stdout/stderr 各截 64KB，超时上限 300s）、
  `plugin_exec_spawn`（detached 后台进程）；`pluginId` 由宿主自动注入。
- 新增授权语法：`network:<host>` / `network:<host>:<port>` / `network:<host>:<a>-<b>`
  （host 精确匹配，大小写不敏感，无通配/子域）与 `exec:<bin>`（裸名，禁路径分隔符）。
- 新增导出 `isKnownPermission` / `networkGrantAllows` / `execGrantAllows`
  （宿主 permissions.ts、模板 validate-manifest.mjs、Rust plugins.rs 四处锁步）。
- usage-stats 插件自 1.1.0 起适配本版契约（`sdkVersion: "^0.3"`）。

## 0.2.0 — 2026-09-09（Phase 2）

- 扩展点注册化全部落地：新增 `registerComposerSlot`（ui:composer）、`registerPanelTab`（ui:panel-tab）、
  `registerStatusBarItem`（ui:status-bar）、`registerCommand`（ui:command）、`registerMarkdownRenderer`
  （ui:markdown）、`registerPage`（ui:page）、`registerTimelineRowRenderer`（ui:timeline-row）。
- 新增 `manifest.sdkVersion` 版本握手 + `ctx.host.sdkVersion` + `satisfiesSdkRange`。
- manifest `contributes` 补齐 Tier-0 `statusBarItems` / `commands`。
- 权限全集 14 项；`KNOWN_PERMISSIONS`/`GRANTABLE_COMMANDS` 移入本包作为单一事实源。
- 契约包首次独立成包：类型/Registry/注册表单例/版本常量从 `features/plugins/` 收敛至此。

## 0.1.0 — 2026-09-08（Phase 1，追溯记录）

- 初始契约：`PluginContext`（ui.registerSettingsSection/registerAddMenuRow、theme、i18n、storage、
  events、bridge.invoke、host）、`PluginManifest`、`Registry`/`useRegistry`、分层信任 Tier-0/1/2。
