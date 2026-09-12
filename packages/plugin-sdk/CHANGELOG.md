# @ccgui/plugin-sdk changelog

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
