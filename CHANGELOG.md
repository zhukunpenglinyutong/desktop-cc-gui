# Changelog

---

##### **2026年4月14日（v0.4.0）**

中文：

✨ Features
- 完成 Claude / Codex 会话回溯链路统一，新增回溯导出、跨引擎线程交互、工作区恢复与更可靠的回退能力
- 新增顶部会话标签右键菜单与批量关闭能力，提升多会话整理效率
- 完成文件查看与预览链路，支持目录、表格、文档、PDF 等多类型文件预览，并增强配置文件语法高亮
- 为幕布新增 LaTeX 专属渲染与公式兼容增强，改善技术内容阅读体验
- 为右侧状态区新增“最新用户对话”标签，提升长会话定位效率

🔧 Improvements
- 收口主窗口文件渲染契约、主窗口渲染决策链与文件视图状态模块，降低文件模式切换时的状态漂移
- 优化回溯入口视觉反馈，统一为历史语义图标，并在会话进行中禁用危险回溯操作
- 加固启动守护链路并补齐大文件治理预警，降低桌面端复杂启动场景下的维护成本
- 优化 Skills 面板中的 Codex 引擎命名一致性，减少多处展示语义偏差
- 增强搜索面板在技能、命令与清空场景下的稳定性，减少结果残留与误匹配
- 补齐自定义 npm prefix、CLI fallback 与跨平台命令启动的回归测试，增强跨平台可维护性

🐛 Fixes
- 修复 Claude 回溯恢复在 `add / delete / update`、空文件、无行号 hunk、首条消息回退等边界场景下的遗漏与失败问题
- 修复工作区恢复、文件视图导航竞态、本地会话历史扫描与打开工作区链路中的 Win / mac 路径兼容问题
- 修复顶部会话标签右键菜单在标题栏区域失效的问题，并增强窗口重载与白屏兜底诊断恢复能力
- 修复文件预览场景下的 `asset protocol` CSP 连接限制问题，避免本地预览资源加载失败
- 修复融合队列链路、长文本输入与跨平台输入框兼容问题，提升输入与排队发送稳定性
- 修复搜索清空后结果残留以及技能/命令结果不稳定的问题
- 修复 macOS 用户在 `Codex` 已可于本地终端运行时，客户端仍误判未安装、无法选择引擎且无法展示版本的问题
- 修复 `Codex --version` 失败但 CLI 实际可运行时被直接判定为不可用的问题，改为通过 `--help` 进行降级探测
- 修复 Windows 下同步执行 `npm.cmd` / `npm.bat` 时的 wrapper 兼容问题，避免自定义 npm 安装场景下路径探测失效
- 修复更新源仍指向旧桌面发行 feed 的问题，确保升级检查命中当前桌面发布通道

English:

✨ Features
- Unify the Claude / Codex rewind flow with export support, cross-engine thread interaction, workspace restore, and stronger rollback reliability
- Add a context menu and bulk-close actions for topbar session tabs to improve multi-session management
- Complete the file preview pipeline for directories, tabular data, documents, and PDFs, with stronger config-file syntax highlighting
- Add dedicated LaTeX rendering and formula compatibility improvements in the conversation curtain for technical content
- Add a “latest user conversation” label in the status panel to improve orientation in long-running sessions

🔧 Improvements
- Tighten the main-window file rendering contract, render-decision flow, and file-view state modules to reduce drift when switching file modes
- Refine rewind entry visuals by switching to a history-oriented icon and disabling risky rewind actions while a session is still running
- Harden the startup guard path and large-file governance alerts to reduce maintenance overhead in complex desktop bootstrap scenarios
- Normalize Codex naming in the Skills surface to keep engine labels consistent across the UI
- Improve search stability for skills, commands, and clear/reset flows to reduce stale or noisy results
- Add regression coverage for custom npm prefix discovery, CLI fallback behavior, and cross-platform command launching to improve long-term maintainability

🐛 Fixes
- Fix Claude rewind restore failures across `add / delete / update`, empty-file, no-line-number hunk, and first-message rollback edge cases
- Fix Win / mac path-compatibility issues across workspace restore, file-view navigation races, local session-history scanning, and workspace opening
- Fix the topbar session-tab context menu failing inside the titlebar region, and improve white-screen recovery with stronger diagnostics and window reload fallback
- Fix local file-preview loading failures caused by `asset protocol` CSP restrictions
- Fix queue fusion, long-text input, and cross-platform composer compatibility issues to improve send stability
- Fix stale search-clear results and unstable skills/command matches in the unified search flow
- Fix the issue where macOS users could run `Codex` in a local terminal but the client still marked it as unavailable, disabled engine selection, and failed to show its version
- Fix the case where `Codex --version` failures incorrectly marked the CLI as unavailable even though the binary was still runnable, by adding a `--help` fallback probe
- Fix Windows wrapper compatibility for synchronous `npm.cmd` / `npm.bat` execution so custom npm install layouts no longer break prefix discovery
- Fix the updater release feed still pointing to the legacy desktop endpoint so update checks now target the current desktop release channel

---

##### **2026年4月11日（v0.3.12）**

中文：

✨ Features
- 品牌升级为 `ccgui` 并支持 legacy 数据迁移，降低现有用户升级切换成本
- 新增幕布宽度配置与左到右视图切换，完善不同布局偏好的使用体验
- 新增对话/看板快捷键与会话大小展示，提升导航与会话管理效率
- 优化 `File changes` 折叠展示与独立展开交互，减少长会话浏览噪音
- 重构 `MCP` 设置页为按引擎查看的只读展示视图，支持统一查看 Claude Code、Codex、Gemini、OpenCode 的配置入口与运行规则
- 完善本地统计能力并增强多引擎兼容性，提升跨引擎使用数据的一致性
- 为 Claude Code 子代理结果新增独立气泡卡片渲染，并支持在幕布中以独立视觉格式展示 agent 完成内容
- 为右下角子代理列表补充按引擎分流的跳转行为：Claude Code 可定位到当前幕布中的 agent 卡片，Codex 可跳转到对应 session

🔧 Improvements
- 降低实时会话更新对输入链路的干扰，提升连续输入稳定性
- 拆分设置页样式模块并通过大文件门禁，降低后续样式迭代耦合
- 优化 `MCP` 设置页总览卡、引擎选择与详情区的联动语义，减少跨区域状态错位
- 补齐 `MCP` 设置中英文文案、图标层次与测试映射，提升展示一致性与可维护性
- 拆分 Claude 事件转换模块并完成大文件治理，收敛引擎层职责边界并降低维护复杂度
- 收口右下角子代理点击链路的导航语义，并保留右侧面板展开状态，减少跨区域定位时的视线中断
- 强化子代理导航目标聚合逻辑，兼容 `taskId` / `task_id` 并优先保留更完整的定位信息

🐛 Fixes
- 修复启动链异常场景下的黑屏问题，增强冷启动兜底能力
- 修复 Web 端切换 Codex 后无法继续对话与历史丢失问题
- 修复跨会话绑定边界问题，并增强 Win/mac 命令包装兼容性
- 修复默认 workspace 去重与路径边界问题，避免配置重复与异常回退
- 修复消息折叠边界、拖拽预览与 Gemini 会话兼容问题
- 修复 swapped 侧栏快捷入口顺序与快捷键显示偏差
- 优化 Windows 内部文件树拖拽视觉反馈，降低拖拽操作歧义
- 修复 `Gemini` 在 `MCP` 设置中配置服务显示缺失、`OpenCode` 工具数误报，以及 Codex 运行时工具名前缀大小写兼容问题
- 修复侧栏折叠布局错位并统一引擎图标切换反馈，避免设置面板状态混淆
- 修复 Claude 会话销毁期间的子进程竞争与残留问题，降低退出阶段资源泄漏风险
- 修复本地扫描不可用时 Codex 线程已知会话丢失与 `cwd` 回填偏差问题
- 修复聊天输入框长文本水平溢出问题，提升长输入场景下的可读性
- 修复 Claude 实时与历史幕布思考正文丢失问题，避免推理内容在流式与回放场景中缺失
- 调整右侧融合状态面板布局并移除背景框，提升主界面信息层级与视觉融合度
- 修复 Claude 子代理完成消息仍与当前幕布内容混排的问题，避免 agent 内容缺少独立渲染格式
- 修复 `task-notification` 在空结果、双重转义和普通 XML 文本场景下的识别边界问题，降低误判与漏渲染风险

English:

✨ Features
- Rebrand the app to `ccgui` and support legacy data migration to reduce upgrade friction for existing users
- Add curtain-width settings and a left-to-right view toggle to better support different layout preferences
- Add conversation/kanban shortcuts and session-size display to improve navigation and session management
- Improve `File changes` collapsing and standalone expand interactions to reduce noise in long conversations
- Rebuild the `MCP` settings page into an engine-scoped read-only view that clearly shows config entry points and runtime rules for Claude Code, Codex, Gemini, and OpenCode
- Improve local usage metrics and strengthen multi-engine compatibility to keep cross-engine usage data consistent
- Add standalone bubble-card rendering for Claude Code subagent results so completed agent output is presented as an independent canvas element
- Add engine-aware jump behavior from the bottom-right subagent list: Claude Code scrolls to the in-canvas agent card, while Codex opens the corresponding session

🔧 Improvements
- Reduce interference from realtime session updates in the composer input flow for steadier typing
- Split settings style modules and pass the large-file guard to reduce styling coupling in future iterations
- Tighten the linkage between the `MCP` overview cards, engine selector, and detail area to prevent cross-section state drift
- Fill in `MCP` i18n copy, icon hierarchy, and test mappings to improve presentation consistency and maintainability
- Split Claude event-conversion modules and complete large-file governance to tighten engine-layer boundaries and reduce maintenance complexity
- Refine the bottom-right subagent click flow to preserve the right-side panel while navigating, reducing context loss during cross-panel inspection
- Harden subagent navigation-target aggregation by supporting both `taskId` and `task_id` and preferring richer anchor metadata

🐛 Fixes
- Fix black-screen scenarios during bootstrap failures by adding a safer startup fallback path
- Fix the inability to continue chatting and the history-loss issue after switching to Codex on Web
- Fix cross-session binding edge cases and improve Win/mac command-wrapper compatibility
- Fix default-workspace de-duplication and path edge cases to avoid duplicate config states and bad fallback behavior
- Fix message-collapse boundaries, drag-preview behavior, and Gemini session compatibility issues
- Fix incorrect quick-entry order and shortcut labels in the swapped sidebar layout
- Refine Windows internal file-tree drag feedback to make drag operations clearer
- Fix missing `Gemini` config-server visibility in `MCP` settings, incorrect `OpenCode` tool counts, and case-sensitive Codex runtime tool-prefix parsing
- Fix sidebar collapsed-layout drift and unify engine-icon switch feedback to reduce settings-state confusion
- Fix subprocess race and residue during Claude session teardown to reduce exit-time resource leaks
- Fix Codex known-session loss and `cwd` backfill drift when local scanning is unavailable
- Fix horizontal overflow in the chat composer for long-input scenarios
- Fix missing Claude reasoning body content in both live and historical curtain views so streamed and replayed thinking stays intact
- Adjust the merged right-side status panel layout and remove its background frame to improve hierarchy and visual integration with the main UI
- Fix mixed rendering where Claude subagent completion messages were still blended into the main curtain instead of using an independent visual format
- Fix `task-notification` parsing boundaries for empty results, double-escaped payloads, and ordinary XML-like prose to reduce false positives and missed rendering

---

##### **2026年4月9日（v0.3.11）**

中文：

✨ Features
- 新增用户消息 `@路径` 引用提取与独立引用卡片展示，提升上下文可读性
- 新增 Codex/Claude/Gemini 流式等待与入流特效联动，并增强浅色主题可见性
- 优化显示设置实时预览与本地字体选择流程，降低个性化配置成本
- 优化基础设置中的语言切换视觉反馈，提升设置面板状态可辨识性

🔧 Improvements
- 补齐 Claude 幕布隐藏 run command 卡片的测试用例，收紧消息卡片可见性回归风险
- 压缩左侧工作区项目的纵向占用，提升侧边栏信息密度与浏览效率
- 调整侧边栏分组与项目列表的视觉层级和间距，提升信息扫读效率
- 模块化拆分基础外观设置并收敛气泡样式变量逻辑，提升后续维护稳定性
- 拆分设置页样式大文件，降低样式维护耦合与回归风险

🐛 Fixes
- 修复用户引用卡片视觉层级与紧凑度问题，减少消息区噪音
- 修复用户输入 `@路径` 在相邻文本场景下的解析错误，避免引用提取遗漏
- 修复项目设置中默认 workspace 显示问题，并合并未分组侧边栏条目
- 修复提示词增强快捷键跨平台失效问题，并将超时延长至 60 秒
- 修复跨平台快捷键识别偏差与流式/进程终止边界问题，降低异常中断风险
- 修复 Codex 幕布下运行命令与批量运行命令卡片误显示问题
- 修复 Claude 初始化失败后的残留进程问题，并支持模型下拉滚动
- 修复输入框占位文本换行与长文本溢出显示问题
- 修复 Claude 子进程终止链路在 Windows 的进程树清理与锁竞争问题

English:

✨ Features
- Add extraction of user-message `@path` references and render them as standalone reference cards for better context readability
- Add synchronized streaming wait/arrival effects across Codex, Claude, and Gemini, with improved visibility in light themes
- Improve display-settings live preview and local-font selection flow to reduce customization friction
- Improve visual feedback for language switching in base settings to increase state clarity

🔧 Improvements
- Add coverage for Claude curtain behavior to hide run-command cards, reducing regression risk in message-card visibility
- Reduce vertical space usage in the left workspace project list to improve sidebar information density and scan efficiency
- Refine visual hierarchy and spacing between sidebar groups and project lists to improve scanability
- Modularize base appearance settings and consolidate bubble-style variables to improve maintainability and iteration stability
- Split oversized settings style files to reduce styling coupling and regression risk

🐛 Fixes
- Fix visual hierarchy and density issues in user reference cards to reduce chat-area noise
- Fix parsing failures for user-input `@path` references when adjacent text is present, preventing missed reference extraction
- Fix default workspace visibility in project settings and merge ungrouped sidebar entries
- Fix cross-platform prompt-enhancement shortcut failures and extend the timeout to 60 seconds
- Fix cross-platform shortcut recognition drift and stabilize stream/process-termination boundaries
- Fix unintended visibility of run-command and batch run-command cards in Codex curtain mode
- Fix leftover Claude processes after initialization failures and enable scrolling in the model dropdown
- Fix composer placeholder line wrapping and long-text overflow rendering
- Fix Windows process-tree cleanup and lock contention in Claude subprocess termination flow

---

##### **2026年4月7日（v0.3.10）**

中文：

✨ Features
- 输入区快捷动作改为独立图标入口，并新增二级菜单，减少常用操作路径
- 优化提示词选择与设置页交互，提升提示词管理效率
- Git 提交信息支持按语言生成中英文内容，便于跨语种协作
- Git 提交信息新增按引擎生成策略并规范化 AI 输出，提升不同模型下提交文案一致性

🔧 Improvements
- 拆分超大文件并收口模块职责，降低维护成本并改善后续迭代稳定性

🐛 Fixes
- 修复快捷动作无障碍属性与“创建提示词”事件链路，避免交互失效
- 修复 prompt enhancement 在多 workspace 下偶发不生效问题，提升增强链路稳定性
- 修复本地图像预览回退异常，并收紧本地文件读取边界
- 修复 Gemini 截图链路在 Windows 下的路径兼容问题
- 修复 Gemini 超长 prompt 触发命令行长度限制的问题，改为通过 stdin 传输

English:

✨ Features
- Convert composer quick actions into a dedicated icon entry and add a secondary menu to shorten frequent action paths
- Improve prompt selection and settings interactions for smoother prompt management
- Support language-aware Git commit message generation in both Chinese and English for cross-language collaboration
- Add engine-aware Git commit message generation and normalize AI output for more consistent commit text across models

🔧 Improvements
- Split oversized files and tighten module responsibilities to reduce maintenance cost and improve iteration stability

🐛 Fixes
- Fix accessibility attributes and the prompt-creation event chain for composer quick actions to prevent interaction failures
- Fix occasional prompt-enhancement failures across workspaces to improve enhancement reliability
- Fix local image preview fallback issues and tighten local file-read boundaries
- Fix Windows path compatibility in the Gemini screenshot flow
- Fix Gemini long-prompt failures caused by command-line length limits by switching to stdin transport

---

##### **2026年4月4日（v0.3.9）**

中文：

✨ Features
- 侧边栏新增悬停图钉交互，并支持固定区一键取消固定，提升会话管理效率
- 优化引擎核心流程，增强多模块协同下的性能与稳定性

🔧 Improvements
- 将 `/review` 命令匹配逻辑升级为命令头严格匹配，并兼容 review-like 自定义命令
- 加固线程路径匹配的 Win/mac 跨平台兼容性，降低路径判定偏差

🐛 Fixes
- 修复 Gemini `sessionId` 提取过严导致的会话续传失败与消息拆会话问题
- 修复固定会话后项目列表残留与刷新延迟问题
- 修复深色主题下最终消息与推理边界不可见问题，并补齐兼容回退
- 修复多会话 stop 误伤及首次 stop 不生效问题
- 修复 Claude 自定义命令列表空响应场景下的重试与回退稳定性
- 修复 Gemini pending 会话上下文无法连续关联问题

English:

✨ Features
- Add hover-to-pin interactions in the sidebar and one-click unpin for the pinned section to improve session management
- Optimize core engine flow to improve multi-module performance and runtime stability

🔧 Improvements
- Tighten `/review` parsing with strict command-head matching while keeping compatibility with review-like custom commands
- Harden cross-platform thread-path matching for Win/mac to reduce path-resolution drift

🐛 Fixes
- Fix overly strict Gemini `sessionId` extraction that caused resume failures and message split sessions
- Fix stale project-list residues and delayed refresh after pinning sessions
- Fix invisible final/reasoning boundaries in dark theme and add compatibility fallback rendering
- Fix multi-session stop collateral impact and first-stop ineffective behavior
- Harden retry and fallback behavior when Claude custom command list responses are empty
- Fix broken continuity for Gemini pending-session context association

---

##### **2026年4月1日（v0.3.7）**

中文：

✨ Features
- 新增智能体会话隔离机制，并收口首轮会话链路，减少跨会话上下文串扰
- 完成智能体图标全链路接入（设置、输入区、消息区、线程历史），提升多智能体识别效率
- 增强 Codex 运行时配置热刷新能力，并支持历史会话输出折叠，降低长会话浏览噪音
- 统一 assistant final 边界元数据并优化历史恢复链路，提升历史回放一致性

🔧 Improvements
- 拆分 `Messages` 超大组件与对应测试用例，降低单文件复杂度并提升维护效率
- 系统性收紧 `noUncheckedIndexedAccess` 与线程条目链路类型边界，减少隐式空值与索引越界风险

🐛 Fixes
- 修复消息渲染链路中“注入式智能体提示”泄漏到用户正文的问题，避免内容污染
- 修复代码复制语义混淆：区分纯文本复制与带 fenced code block 的复制路径
- 修复线程历史中已选智能体上下文丢失问题，保证回放后会话身份连续
- 修复外部文件访问边界与终端会话清理链路，降低残留会话与越界访问风险
- 修复智能体图标与名称显示不一致问题
- 修复 worktree push 在失败原因为空值时的兼容性问题

English:

✨ Features
- Introduce agent-session isolation and stabilize first-turn routing to reduce cross-session context bleed
- Complete end-to-end agent icon integration across settings, composer, message rendering, and thread history for faster multi-agent recognition
- Enhance Codex runtime config hot-refresh and add collapsible history output to reduce noise in long sessions
- Unify assistant-final boundary metadata and improve history recovery consistency during replay

🔧 Improvements
- Split oversized `Messages` module and related test suites to lower file complexity and improve maintainability
- Tighten `noUncheckedIndexedAccess` and thread-item type boundaries to reduce implicit-null and index-access risks

🐛 Fixes
- Fix injected agent prompts leaking into user-visible message text
- Fix code-copy behavior by separating plain-text copy from fenced code copy flows
- Fix loss of selected-agent context when restoring thread history
- Tighten external file-access constraints and clean up terminal sessions to reduce residual-session risk
- Fix mismatches between displayed agent icon and agent name
- Fix worktree push flow to handle empty failure reasons safely

---

##### **2026年3月30日（v0.3.6）**

English:

✨ Features
- Redesign Skills management into a tree-based global browser that unifies multi-source skill directories, and add in-panel editing/saving with structured preview so users can inspect and update skills without leaving Settings
- Complete missing Web Git RPC coverage in the local daemon and split `daemon_state` into dedicated modules, making Web-mode Git actions more complete while improving daemon lifecycle maintainability
- Harden multi-engine history-chain recovery in Web mode by reorganizing oversized bridge/runtime paths, reducing replay fragility after interruptions and improving cross-engine continuity
- Rework realtime message-canvas controls into clearer control groups/constants and keep focus-follow behavior stable during live updates
- Enhance Session Activity by exposing `search_query` tool-chain details, strengthening history replay recovery, and adding date-group bulk delete for faster cleanup
- Improve repo-awareness across detached file tree, file view, and Session Activity so sub-repo Git state mapping and diff targets resolve against the correct `gitRoot`
- Support Claude custom model passthrough and dynamic model discovery, enabling newly configured models to appear and be selected without manual patching
- Optimize tool-block file-change summaries and Markdown rendering so long command/tool outputs are easier to scan inside conversations
- Convert successful `apply_patch` command-execution items into structured `File changes` cards in thread activity, including inferred file path/kind and richer change detail rendering
- Unify `File changes` and `Batch` icon semantics with theme-aware color refinement for clearer visual scanning
- Refresh the home-chat welcome area with client iconography and adjusted landing styles for stronger first-screen hierarchy

🔧 Improvements
- Align file-tree Git folder status coloring with actual changed-path semantics, including test and style alignment, so folder-level change scanning is more predictable and visually consistent
- Migrate message-flow tests into modular suites and harden realtime control-button compatibility to reduce UI regression risk
- Refactor `threadItems` by extracting exploration summarization and file-change inference into dedicated utility modules, reducing monolith complexity while preserving behavior
- Move the live middle-step collapsed hint closer to the input/working-indicator zone, improving visibility during thinking-state streaming
- Keep failed or non-executed patch command entries as regular `commandExecution` items so only real edits are promoted into file-change cards

🐛 Fixes
- Fix local web-service auto-start failures caused by daemon binary discovery issues by adding a more robust binary-location fallback path in bootstrap logic
- Fix non-default project history fetching getting stuck after a single failed request by correcting error-state reset behavior in the Web loading chain
- Fix packaged-build white screen issues caused by missing/incorrect Web static resource resolution by repairing runtime static path wiring
- Fix duplicated skill chips/tokens when selecting same-name skills from multi-source entries (global/project overlap) by tightening token grouping and de-dup assembly logic
- Reduce noisy "missing file" alerts from detached file-window monitoring to avoid unnecessary disruption
- Fix screenshot-message side effects that could trigger unintended session switching and history-chain breaks in Claude threads
- Fix Claude custom models being reset unexpectedly and refresh the model list when opening a new session so the configured selection remains available
- Fix realtime focus-follow regressions and preserve stable interaction context while streaming updates

中文：

✨ Features
- 将 Skills 管理重构为树形全局浏览器，统一聚合多来源技能目录，并补齐面板内编辑/保存与结构化预览能力，减少在设置与文件系统之间来回切换
- 补齐本地 daemon 在 Web 模式下缺失的 Git RPC 覆盖，并拆分 `daemon_state` 为独立职责模块，在提升 Git 操作完整度的同时改善 daemon 生命周期可维护性
- 通过重组多引擎桥接与运行时链路、拆分超大 Web 模块，加固 Web 模式历史链路恢复能力，降低跨引擎会话回放在中断后的脆弱性
- 重构消息实时幕布控制为更清晰的控制组与常量映射，并保持焦点跟随链路稳定，保证实时更新时交互上下文不漂移
- 增强 Session Activity：补齐 `search_query` 工具链路展示、加固历史回放恢复能力，并支持按日期分组一键批量删除
- 打通 detached/file-tree/file-view/Session Activity 的仓库感知链路，完善子仓库 `gitRoot` 状态映射与 diff 目标定位
- 支持 Claude 自定义模型透传与动态模型发现，让新增模型配置可以直接被会话选择使用
- 优化工具块中的文件变更摘要与 Markdown 渲染体验，提升长输出、多文件场景下的可读性
- 在线程活动中，将成功执行的 `apply_patch` 命令自动转换为结构化 `File changes` 卡片，补齐变更文件路径、变更类型与更丰富的差异展示
- 统一 `File changes` 与 `Batch` 图标语义并优化主题配色映射，提升工具卡视觉辨识度
- 优化首页欢迎区首屏层次：新增客户端图标并调整欢迎样式编排

🔧 Improvements
- 对齐文件树 Git 文件夹状态着色与实际变更路径语义，并同步测试与样式表现，使目录级变更扫描更可预测、视觉反馈更一致
- 将消息链路测试迁移为模块化结构，并加固实时控制按钮兼容性，降低后续 UI 演进时的回归风险
- 重构 `threadItems`：将探索摘要与文件变更推断逻辑拆分为独立工具模块，降低单文件复杂度并保持原有行为一致
- 调整实时中间步骤折叠提示的渲染位置，使其更贴近输入区与工作指示器，提升思考态流式阶段的可见性
- 对失败执行或仅包含 patch 文本但未真正执行 `apply_patch` 的场景，保持原有 `commandExecution` 展示，避免误判为文件变更

🐛 Fixes
- 修复本地 web-service 自动启动时 daemon 二进制定位失败的问题：在 bootstrap 链路增加更稳健的二进制定位兜底路径
- 修复非默认项目历史拉取在单次失败后进入“锁死”状态的问题：纠正 Web 侧失败状态复位逻辑，恢复后续请求可继续执行
- 修复安装包场景下 Web 静态资源解析缺失/错误导致白屏的问题：修正运行时静态资源路径装配链路
- 修复同名 Skill 在多来源（global/project）并存时选择后出现重复 skill chip/token 的问题：收紧 token 分组键与去重组装逻辑
- 修复 detached 文件窗口监控链路“文件缺失”告警噪声过高的问题，减少非必要打断
- 修复截图消息导致 Claude 线程会话误切换与历史链路断裂的问题
- 修复 Claude 自定义模型被意外重置的问题，并在新会话中自动刷新模型列表，保证配置后的模型可持续可见
- 修复实时更新中的焦点跟随回归，保证流式阶段的交互上下文稳定

---

##### **2026年3月28日（v0.3.5）**

English:

✨ Features
- Add detached file explorer window for independent file browsing and operations
- Support cross-window drag-and-drop from detached file tree into main chat composer
- Align detached file tree interactions with Git semantics for consistent file operations
- Improve file-view interaction details and external-change awareness signals

🔧 Improvements
- Split Git History panel resize control into a dedicated module to improve maintainability and isolate runtime risks

🐛 Fixes
- Fix Claude model selection regression where 4.6 could fall back to 4.5 unexpectedly
- Fix Claude session resume path and default-model fallback behavior
- Deduplicate Codex agent real-time message snapshots to prevent repeated rendering
- Fix misleading drag cursor affordance on file-tree rows

中文：

✨ Features
- 新增独立文件窗口（detached file explorer），支持脱离主界面进行文件浏览与操作
- 支持 detached 文件树跨窗口拖拽落入主聊天输入框
- 对齐 detached 文件树交互与 Git 语义，统一文件操作体验
- 优化文件视图交互细节并增强外部变更感知提示

🔧 Improvements
- 拆分 Git History 面板尺寸控制为独立模块，提升可维护性并隔离运行时风险

🐛 Fixes
- 修复 Claude 模型选择链路回归：4.6 可能被意外回退到 4.5
- 修复 Claude 会话续传链路与默认模型回退问题
- 去重 Codex agent 实时消息快照，避免正文重复渲染
- 修复文件树行级光标拖拽提示误导问题

---

##### **2026年3月25日（v0.3.4）**

English:

✨ Features
- Add Gemini CLI vendor configuration and preflight checks
- Implement Gemini real-time/history session rendering with multi-engine boundary isolation
- Complete Gemini real-time body streaming and unify file-change activity display
- Support Claude real-time thinking canvas segmented rendering
- Unify attachment selection and drag-drop routing with support for non-image inline references
- Enhance Gemini config panel interaction and styling, add model management button icons
- Adjust Gemini default models and add preset model options
- Support Kanban background execution and fix engine model leakage
- Add per-item delete and unread control for Session Activity radar recent-completion entries

🔧 Improvements
- Rebrand codemoss to mossx and localize WeChat QR asset
- Split oversized files to satisfy large-file governance gate and improve maintainability

🐛 Fixes
- Fix Gemini session loss and auto-recovery after stop
- Fix image message session isolation and history image path resolution
- Isolate Gemini image reference handling and history extraction
- Split Claude and Gemini image attachment normalization
- Align Gemini real-time thinking segmentation with tool rendering
- Refine Gemini placeholder thinking slice positioning
- Align Gemini real-time toolCalls rendering with thinking slice display
- Fix Gemini thinking paragraph override and complete reducer module splitting
- Correct Gemini real-time thinking point insertion order and preserve late-arrival fallback
- Fix Claude/Gemini image attachment loss in real-time and history paths
- Fix Gemini real-time/history dialogue thinking position misalignment and unify left-right rendering rules
- Fix Gemini real-time/history rendering semantic drift and improve vendor config availability
- Fix Gemini preflight Windows compatibility and path hints
- Fix Claude thinking toggle state read/write inconsistency under local provider
- Fix Kanban background periodic task incorrectly switching global dialogue engine
- Fix silent session duration refresh and recovery flow regression

中文：

✨ Features
- 新增 Gemini CLI 供应商配置与预检能力
- 复刻 Gemini 实时/历史会话并完善多引擎边界隔离
- 补齐 Gemini 实时正文流并统一文件变更活动展示
- 支持 Claude 实时思考幕布分段渲染
- 统一附件选择与拖拽分流链路，支持非图片内联引用
- 优化 Gemini 配置面板交互与样式，并补齐模型管理按钮图标
- 调整 Gemini 模型默认值并补充预置模型
- 支持看板后台执行并修复引擎模型泄露
- Session Activity 雷达区最近完成项支持单条删除与未读控制

🔧 Improvements
- 品牌重塑：codemoss → mossx，本地化微信二维码资源
- 拆分超限大文件并通过 large-file 治理门禁

🐛 Fixes
- 修复 Gemini 停止后会话丢失与自动恢复问题
- 修复图片消息会话隔离与历史图片路径解析
- 隔离 Gemini 图片引用处理与历史提取
- 分离 Claude 和 Gemini 图片附件规范化
- 对齐 Gemini 实时思考分段与工具渲染
- 精修 Gemini 占位思考切片点位
- 对齐 Gemini 实时 toolCalls 渲染与思考切片展示
- 修复 Gemini 思考段落覆盖并完成 reducer 模块拆分
- 修正 Gemini 实时思考点穿插顺序并保留晚到兜底
- 修复 Claude/Gemini 图片附件在实时与历史链路丢失
- 修复 Gemini 实时与历史对话思考点位错位并统一左右渲染规则
- 修复 Gemini 实时/历史渲染语义偏差并完善供应商配置可用性
- 修复 Gemini 预检的 Win 兼容性与路径提示
- 修复 Claude 思考开关在本地 provider 下状态读取与写入不一致
- 修复看板后台周期任务误切换全局对话引擎
- 修复静默会话时长刷新与恢复链路回归

---

##### **2026年3月23日（v0.3.3）**

English:

✨ Features
- Add automatic compact-recovery for overlong Claude prompts and map compact events into session activity for better continuity
- Support per-item delete and unread-state control for Session Activity radar "recent completed" entries

🔧 Improvements
- Split Claude lifecycle, auto-compact retry, and AskUserQuestion/user-input handling into dedicated modules to satisfy large-file governance and improve maintainability

⚡ Performance
- Reduce CPU peak in multi-session realtime chat and improve stability boundaries

🐛 Fixes
- Fix duplicated real-time body rendering in Claude chat streaming path
- Fix multiline resume-input handling for AskUserQuestion on Windows/macOS and add snapshot-only regression coverage
- Harden strict `request_id -> turn_id` routing in AskUserQuestion response flow to reduce cross-session/cross-turn answer leakage risk
- Fix regression in silent-session duration refresh and recovery flow
- Align local command behavior between `/clear` and `/reset`
- Fix race between task-start switch and auto-start during Kanban task creation
- Unify Windows top-left sidebar style and remove project-page whitespace
- Preserve Claude session continuity in long-running chats

中文：

✨ Features
- 新增 Claude 超长 Prompt 自动 compact 恢复能力，并将 compact 事件映射到会话活动链路，提升长会话连续性
- Session Activity 雷达最近完成项支持单条删除与未读控制

🔧 Improvements
- 将 Claude 生命周期、自动 compact 重试、AskUserQuestion/用户输入处理拆分为独立模块，满足 large-file 治理门禁并提升可维护性

⚡ Performance
- 降低多会话实时对话 CPU 峰值，并补齐稳定性边界

🐛 Fixes
- 修复 Claude 聊天流式链路中实时正文重复渲染问题
- 修复 AskUserQuestion 在 Windows/macOS 下多行 resume 输入处理异常，并补齐 snapshot-only 回归覆盖
- 加固 AskUserQuestion 响应链路的 `request_id -> turn_id` 严格路由，降低多会话/多轮场景下答案串线风险
- 修复静默会话时长刷新与恢复链路回归
- 对齐 `/clear` 与 `/reset` 的本地命令行为
- 修复 Kanban 创建任务时“开始开关”与自动启动竞态
- 统一 Windows 侧栏左上区域样式并移除项目页留白
- 修复长会话场景下 Claude session 连续性问题

---

##### **2026年3月22日（v0.3.2）**

English:

✨ Features
- Deliver Phase 1 of Kanban scheduling and chained-task governance to improve multi-task flow control
- Optimize serial scheduling rules and introduce a clearer Kanban label taxonomy
- Enhance group-level batch operations and task-creation interactions in Kanban workflows
- Support left-double-click expand/collapse behavior for workspace tree groups
- Improve Session Activity hint bubbles and tabbar presentation details
- Refine workspace project dropdown visuals and complete worktree list rendering
- Integrate OpenApp button into main header and improve project-area hover visibility interactions
- Add desktop topbar session tabs with global recent-session switching/closing workflow
- Add `/context` command and `<image>` tag parsing/rendering in chat for richer context-injection and multimodal flows

🔧 Improvements
- Add `windows-latest` doctor + integration CI gate for stronger cross-platform release confidence
- Harden Windows compatibility checks by making lint/runtime contract `no-undef` verification Windows-safe
- Refine main-header layout composition for session tabs while keeping sidebar topbar compact
- Split oversized Claude/message modules to satisfy large-file governance gate and improve maintainability

🐛 Fixes
- Fix scheduler lock contention and drag-sort anomalies under filtered Kanban views
- Fix batch-complete confirmation bypass and outside-click handling in grouped operations
- Enforce second-step confirmation for batch completion and polish confirm-modal behavior/styles
- Fix Hook dependency warnings and stabilize session-panel memo dependency behavior
- Fix non-Windows title-bar drag behavior and fullscreen boundary handling
- Stabilize cross-platform tab eviction ordering by replacing locale-based tie-break with code-unit comparison
- Expand keyboard activation compatibility for session tabs (`Space`, ` `, `Spacebar`, `Enter`)
- Fix AskUserQuestion rendering inconsistency between live updates and history replay
- Fix AskUserInput multi-select parsing path to remove lint blocking and stabilize tool-event handling
- Fix Windows external image drag-drop in Composer by normalizing high-DPI drop coordinates, routing image paths to attachments, and hardening hook hot-reload stability

中文：

✨ Features
- 完成 Kanban 调度与串联任务治理第一阶段落地，提升多任务流转可控性
- 优化串行调度规则并完善看板标签体系，提升任务组织清晰度
- 增强分组级批量操作与任务创建交互体验
- 工作区树支持左键双击展开/折叠分组
- 优化 Session Activity 提示气泡与标签栏展示细节
- 优化工作区项目下拉外观并补全工作树列表渲染
- 在主标题区融合 OpenApp 按钮并增强项目区域悬停显隐交互
- 新增桌面端顶部会话标签，支持最近会话全局切换与关闭
- 新增 `/context` 命令与 `<image>` 标签解析渲染，增强上下文注入与多模态消息链路

🔧 Improvements
- 新增 `windows-latest` 的 doctor + integration CI 门禁，提升跨平台发布稳定性
- 调整 lint/运行时契约 `no-undef` 校验为 Windows 兼容实现
- 优化主标题区布局编排，兼容顶部会话标签并保持侧栏顶部区域紧凑
- 拆分 Claude/消息相关大文件，满足 large-file 治理门禁并提升可维护性

🐛 Fixes
- 修复过滤视图下调度锁竞争与拖拽排序异常
- 修复分组批量完成流程中的确认放行与菜单外点击兼容问题
- 修复批量完成缺少二次确认的问题并优化确认弹窗样式与行为
- 修复 Hook 依赖告警并稳定会话面板 memo 依赖
- 修复非 Windows 场景标题栏拖拽异常与全屏边界处理
- 修复标签淘汰 tie-break 的 locale 依赖问题，统一为 code-unit 比较确保 Win/mac 一致
- 修复会话标签键盘激活兼容性，补齐 `Space`/空格字符/`Spacebar`/`Enter`
- 修复 AskUserQuestion 在实时更新与历史回放中的渲染不一致
- 修复 AskUserInput multi-select 解析链路，解除 lint 阻塞并稳定工具事件处理
- 修复 Composer 在 Windows 外部图片拖拽场景下无法稳定落入的问题：补齐高 DPI 坐标归一化、图片路径按附件处理，并加固 Hook 热更新稳定性

---

##### **2026年3月20日（v0.3.1）**

English:

✨ Features
- Add Session Radar history management in Settings > Other, with batch delete support for completed radar entries
- Persist Session Radar deletion to local client store (`leida`) instead of UI-only removal
- Enhance Session Radar recent-completion cards with click-to-expand behavior while preserving direct session navigation
- Improve recent-completion readability with compact copy and clearer project identity cues
- Support opening absolute paths outside project root from session activity file-change entries
- Add shell-script group rendering and edge-case compatibility in file views
- Add persistent UI zoom slider in Settings with unified range control (80%-260%)
- Improve Session Activity real-time-follow guide overlay and assistant-entry discoverability

🔧 Improvements
- Introduce locked + atomic client-store write path and key-level patch updates to reduce stale overwrite risk across concurrent clients
- Extract Settings "Other" section into a dedicated module and factor Radar persistence merge/event helpers for better maintainability
- Improve Session Radar refresh flow through explicit history-updated event propagation after write/delete actions
- Align sidebar group/project icon axis and unify mode-navigation text color with better Chinese font appearance
- Refine model selector popup width behavior to avoid text overflow

🐛 Fixes
- Fix deleted Session Radar records reappearing after app restart
- Fix multi-client writeback race that could restore previously deleted radar history
- Fix large-file governance regression by replacing line-compression workaround with structural module splitting
- Fix ChatInputBox undo/redo behavior and align shortcuts (`Ctrl+Z`/`Ctrl+Shift+Z`, `Cmd+Z`/`Cmd+Shift+Z`) across platforms
- Remove redundant bottom border on unselected Git view-switch buttons
- Fix branch-switch validation and regression handling under dirty worktree states

中文：

✨ Features
- 在设置页“其他设置”新增 Session Radar 历史管理，支持对已完成雷达记录进行批量删除
- 会话雷达删除改为真实落盘到本地客户端存储（`leida`），不再只是界面层移除
- 优化 Session Radar 最近完成卡片交互：支持点击展开且保留会话跳转能力
- 精简最近完成卡片文案并强化项目标识，提升扫读效率
- 支持从会话活动文件变更中打开项目外绝对路径文件
- 补齐文件视图中 shell 脚本分组渲染并增强边界兼容性
- 设置页新增 UI 缩放滑条并统一缩放范围到 80%-260%
- 优化 Session Activity 实时跟随引导浮层与机器人入口可发现性

🔧 Improvements
- 客户端存储写入链路增加加锁与原子写，并支持按 key 的 patch 更新，降低多客户端并发下旧数据覆盖风险
- 将设置页“其他设置”区块抽离为独立模块，并提取雷达持久化合并/事件辅助函数，提升可维护性
- 删除与写入后通过显式历史更新事件驱动刷新，优化 Session Radar 视图同步链路
- 侧栏分组/项目图标轴线对齐，统一模式导航文案颜色并优化中文字体观感
- 优化模型选择弹窗宽度自适应策略，避免文案溢出

🐛 Fixes
- 修复删除后的 Session Radar 记录在应用重启后回弹的问题
- 修复多客户端并发写回导致已删除雷达历史被恢复的问题
- 修复大文件治理回归，移除“压缩换行”临时方案并改为结构化拆分
- 修复 ChatInputBox 撤销重做行为，并统一跨平台快捷键（`Ctrl+Z`/`Ctrl+Shift+Z`、`Cmd+Z`/`Cmd+Shift+Z`）
- 修复 Git 视图切换中未选中按钮残留底部边线问题
- 修复 dirty worktree 场景下分支切换校验与回归问题

---

##### **2026年3月19日（v0.3.0）**

English:

✨ Features
- Add Session Radar panel in workspace to aggregate session status and improve at-a-glance visibility
- Persist Session Radar completion records with stronger cross-workspace recovery
- Add quick engine switching entry via bottom icon controls in composer
- Support project-root-based custom Spec path resolution with automatic `openspec` discovery

🔧 Improvements
- Refine Session Radar read-state icon behavior and selected-state colors under dark theme
- Polish selected icon style for panel tabs with cleaner border-only visual feedback
- Refactor Session Radar persistence helpers to reduce large-file pressure and improve maintainability

🐛 Fixes
- Fix composer input overflow caused by long `MessageQueue` text blocks
- Fix `MessageQueue` queue type reference mismatch in chat input path
- Preserve raw user input format and restrict Spec prompt injection to first-turn only
- Fix dual-display fullscreen drag freeze issue on Windows
- Fix file tree root collapse interaction and drag cursor compatibility
- Fix session badge and `Default` label contrast across light/dark themes
- Fix desktop light-theme selector consistency and color mismatch on macOS
- Fix inconsistent worktree info popover color styling

中文：

✨ Features
- 新增工作区 Session Radar 雷达面板，聚合会话状态并提升全局可观测性
- 持久化 Session Radar 完成记录，增强跨工作区恢复能力
- 在输入框底部 icon 区新增引擎快速切换入口
- 支持以项目根为语义的自定义 Spec 路径，并自动解析 `openspec`

🔧 Improvements
- 优化 Session Radar 已读状态图标表现与深色主题选中色彩
- 调整面板 Tab 图标选中态为更简洁的无背景边框风格
- 抽离 Session Radar 持久化辅助逻辑，降低大文件压力并提升可维护性

🐛 Fixes
- 修复长文本 `MessageQueue` 场景下输入区布局溢出问题
- 修复聊天输入链路中 `MessageQueue` 队列类型引用错误
- 修复用户输入原始格式被破坏，并将 Spec 提示词注入限定为仅首轮
- 修复 Windows 双屏全屏拖拽导致白屏卡死问题
- 修复文件树根目录折叠交互并优化拖拽抓取光标兼容性
- 修复深浅主题下会话徽标与 `Default` 标签对比度问题
- 统一桌面端浅色主题 selector 下拉样式并修复 macOS 色差
- 修复工作树信息弹层配色不一致问题

---

##### **2026年3月18日（v0.2.9）**

English:

✨ Features
- Support drag-and-drop file references from file tree and external files directly into chat composer
- Add workspace open-mode routing with new-window creation capability
- Highlight running sessions with project/worktree icon cues in sidebar
- Support double-click maximize/restore for file tabs
- Enhance `$` skill picker and scope display in chat input
- Improve session activity visual system with clearer sub-session grouping and color mapping
- Improve session activity and Spec Hub entry layout with smoother file-tree interaction

⚡ Performance
- Land Deferred + JIT strategy for large-file governance and reduce heavy-path startup pressure
- Complete Bridge cleanup and modularization hardening to improve runtime stability

🐛 Fixes
- Fix Win10 CLI detection false positives causing engine switch failures
- Fix Windows light-theme dropdown readability and workspace path matching compatibility
- Fix occasional style distortion and tag rendering loss after file-tree drag reference
- Fix Codex history sessions becoming invisible after Windows restart
- Fix session activity ordering conflicts for same-second events
- Fix missing child sessions in Codex history and align with real-time activity view
- Fix default startup sidebar collapsed state by restoring expanded behavior
- Fix solo mode right-pane width reset and unify processing agent badge display
- Harden refactor runtime contracts and static import scanning to prevent undefined-reference startup regressions
- Support opening external spec files from session file changes while preserving workspace compatibility

中文：

✨ Features
- 支持将文件树与外部文件直接拖拽引用到对话输入框
- 新增工作区打开模式分流与新建窗口能力
- 侧边栏为运行中会话增加项目/工作树图标高亮提示
- 文件 Tab 支持双击最大化与还原
- 增强输入框 `$` 技能选择器与作用域展示
- 优化会话活动视觉体系，强化子会话分组与配色映射
- 调整会话活动与 Spec Hub 入口布局并优化文件树交互

⚡ Performance
- 落地 Deferred + JIT 大文件治理策略，降低重路径启动压力
- 完成 Bridge 清理与模块化治理收口，提升运行时稳定性

🐛 Fixes
- 修复 Win10 下 CLI 探测误判导致引擎切换失败
- 修复 Windows 浅色下拉可读性与工作区路径匹配兼容性问题
- 修复文件树拖拽引用后偶发样式失真与标签渲染丢失
- 修复 Windows 重启后 Codex 历史会话不可见
- 修复会话活动同秒事件排序冲突
- 修复 Codex 历史子会话丢失并与实时活动展示对齐
- 修复客户端启动默认侧栏未展开的问题
- 修复 solo 模式右侧宽度重置并统一 processing 代理徽章展示
- 加固重构后的运行时契约与静态导入扫描，修复未定义引用导致的启动回归
- 支持会话文件变更中打开 external spec 文件并保持 workspace 兼容

---

##### **2026年3月15日（v0.2.8）**

English:

✨ Features
- Add workspace Session Activity panel and complete tool-event pipeline integration
- Recover Codex historical session activity and aggregate reasoning events for playback
- Optimize Session Activity incremental refresh and timeline scanning behavior
- Enhance file preview UX: richer Markdown rendering, improved toolbar/find interactions, and script/log text fallback opening
- Support lazy local rendering for Markdown Mermaid modules
- Optimize right-side file tree density and root alignment
- Improve HUB panel drag-and-snap interaction and increase right-panel width limits
- Refresh model modal visual style

🐛 Fixes
- Improve compatibility with new reasoning events and repair activity rendering chain
- Improve compatibility with Claude streaming events in Session Activity
- Fix activity command summaries and `Read` path compatibility
- Unify command output rendering and fix activity card auto-collapse timing
- Fix Codex history activity turn-binding mismatch
- Fix Claude history file-change playback issues
- Fix engine icon mis-switch on session switch and add timeout error feedback
- Hide redundant Plan shortcut entry in Codex canvas
- Fix codex context tooltip being clipped in sidebar scenarios
- Disable visible console fallback by default on Windows to avoid multiple terminal popups
- Improve message test assertion type safety

中文：

✨ Features
- 新增工作区 Session Activity 会话活动面板并补齐工具事件链路
- 补齐 Codex 历史会话活动恢复与 reasoning 聚合回放能力
- 优化 Session Activity 增量刷新与时间线扫描机制
- 增强文件预览体验：提升 Markdown 渲染、编辑器工具栏与查找交互，并支持脚本/日志文本兜底打开
- 支持 Markdown Mermaid 模块局部懒渲染
- 优化右侧文件树密度与根节点层级对齐
- 优化 HUB 面板拖拽吸附交互并提升右侧面板宽度上限
- 更新模式模型弹窗样式

🐛 Fixes
- 兼容新版 reasoning 事件并修复会话活动渲染链路
- 兼容 Claude 流式事件并修复会话活动展示问题
- 修复会话活动命令摘要与 `Read` 路径兼容性
- 统一命令输出渲染并修复活动卡片自动收起时序
- 修复 Codex 历史活动轮次错挂问题
- 修复 Claude 历史文件改动回放异常
- 修复会话切换时引擎图标误变更并补齐超时错误反馈
- 隐藏 Codex 幕布中冗余 Plan 快捷入口
- 修复侧栏场景下 codex 上下文 tooltip 被遮挡
- 默认关闭 Windows 可见控制台 fallback，避免多终端弹窗
- 改进消息测试断言类型安全

---

##### **2026年3月12日（v0.2.7）**

English:

✨ Features
- Add global network proxy settings and proxy status exposure
- Optimize compact summary display in Git Diff and history workspaces
- Improve file viewer Markdown defaults, theme readability, and wide-content no-wrap rendering consistency

🐛 Fixes
- Fix Codex startup compensation, timeout recovery, and plan presentation regressions
- Align summary indicator styles across Diff and Git History views
- Refine diff viewer theme backgrounds for better visual consistency

中文：

✨ Features
- 新增全局网络代理设置与代理状态透出
- 优化 Git Diff 与历史工作区紧凑摘要展示
- 改进文件查看器 Markdown 默认模式、主题可读性与宽内容 no-wrap 渲染一致性

🐛 Fixes
- 修复 Codex 启动补偿、超时恢复与计划展示回归问题
- 统一 Diff 与 Git 历史摘要指示器样式对齐
- 优化 Diff Viewer 主题背景以提升视觉一致性

---

##### **2026年3月11日（v0.2.6）**

English:

✨ Features
- Add automatic non-UTF-8 text encoding detection using `chardetng` + `encoding_rs` for files like GB18030 Chinese text, applied to workspace file reads, spec file reads, and general text IO (#186 @zhukunpenglinyutong)
- Redesign workspace worktrees tree layout to IDE Explorer style: section count badges, branch name layered display (prefix/leaf), thread count badges with cursor indicator, stable guide lines, and improved active/hover states (#181 @chenxiangning)
- Sidebar UI enhancements and visual adjustments (#185 @a653928127-ctrl)

🐛 Fixes
- Fix large project freeze on open after dependency install: add workspace scan budgets (30K entries / 1.2s time), Git diff preview multi-dimensional budgets (200 files / 2MB total / 256KB per file / 2.5K lines per file), frontend auto-preload risk-path filtering with churn thresholds, and thread list fetch timeout with local session fallback (#181 @chenxiangning)
- Fix Claude streaming text truncation/misplacement: unify delta event extraction across method aliases, add item snapshot-to-delta conversion, isolate message/reasoning reducer merges by `id + kind`, and add per-engine render source routing (#183 @chenxiangning)
- Fix cross-session thread leaking: tighten pending-to-session resolution anchoring, unify `continue_session` semantics across engine paths, refactor reasoning deduplication to current-turn windowing, and settle plan step status for live and history states (#183 @chenxiangning)
- Fix Claude interrupted turn incorrectly marked as completed and add Codex `parseError` error pass-through (#183 @chenxiangning)
- Fix Auto Mode write authorization stuck: add `ApprovalRequest` event mapping from engine to app server with tool-name-based method inference (#183 @chenxiangning)

中文：

✨ Features
- 新增非 UTF-8 文本编码自动检测：使用 `chardetng` + `encoding_rs` 支持 GB18030 等编码文件的自动解码，应用于工作区文件读取、Spec 文件读取与通用文本 IO (#186 @zhukunpenglinyutong)
- 重设计工作区 Worktrees 树形布局为 IDE Explorer 风格：分组数量徽标、分支名分层显示（前缀/叶子）、线程数量徽标（支持 cursor 时显示 +）、稳定层级导视线、优化激活/悬停态 (#181 @chenxiangning)
- 侧边栏 UI 增强与视觉调整 (#185 @a653928127-ctrl)

🐛 Fixes
- 修复安装依赖后打开超大项目卡死：新增工作区扫描预算（3 万条目 / 1.2 秒时间）、Git diff 预览多维预算（200 文件 / 2MB 总量 / 256KB 单文件 / 2500 行单文件）、前端自动预加载风险路径过滤与 churn 阈值、线程列表拉取超时与本地 session 兜底 (#181 @chenxiangning)
- 修复 Claude 流式正文截断/错位：统一增量事件提取兼容多 method 别名、新增 item 快照转增量、按 `id + kind` 隔离 message/reasoning reducer 合并、新增多引擎渲染数据源路由 (#183 @chenxiangning)
- 修复跨 session 串线：收紧 pending 线程解析锚点、统一 `continue_session` 语义、重构 reasoning 去重为当前轮窗口、新增计划步骤状态在流式与历史恢复中的一致收敛 (#183 @chenxiangning)
- 修复 Claude 中断误标记为完成，补齐 Codex `parseError` 错误透传 (#183 @chenxiangning)
- 修复 Auto Mode 下写入授权卡死：新增 `ApprovalRequest` 引擎事件到 app server 的映射，基于工具名推断授权方法类型 (#183 @chenxiangning)

---

##### **2026年3月10日（v0.2.5）**

English:

✨ Features
- Unify file tree visual semantics across Git Diff / History / Worktree panels: add hierarchical guide lines, directory FileIcon support, and `__repo_root__` display logic
- Redesign Diff/History panel interaction: collapsible commit section, external control bar via header portal, sticky header with loading states, and mode-switch icons
- Redesign Pull/Push/Worktree branch selectors: grouped tabs, search filtering, custom dropdown panels with scope buckets, improving multi-branch usability
- Integrate Codex Fast/Review quick actions: Speed sub-menu (Standard/Fast) and Review entry in ConfigSelect, Review Inline Prompt with base-branch and commit search/filter
- Redesign home page with HomeChat as unified entry, auto-ensure default workspace directory, and pin default workspace to sidebar top
- Enhance search block display and link interaction with webSearch data format compatibility

🐛 Fixes
- Fix Codex engine first-session timing causing missing model: add backend model fallback (frontend → workspace config → model/list default)
- Fix Codex first-session thread creation compatibility: support multiple threadId response formats, add optimistic user message to eliminate send delay
- Fix Codex first-send approval dialog not appearing timely: unify approval/request event routing and request_id parsing
- Unify network error handling: add structured first-packet timeout error, network error classification and localized user hints, enhance proxy environment propagation
- Fix /review execution path under Claude engine and enhance thread compatibility fallback (legacy thread id auto-rebind retry)
- Fix Composer false compacting state on first response
- Fix Win/Mac dropdown menu scroll compatibility
- Fix macOS titlebar offset trigger condition and enhance platform detection (add macOS detection, narrow to specific layout combination state)
- Fix workspace title scroll overlap and background color mismatch in sidebar
- Remove unstable proxy environment injection and startup proxy synchronization logic

中文：

✨ Features
- 统一 Git Diff / History / Worktree 文件树视觉语义：新增层级竖向引导线、目录 FileIcon 支持与 `__repo_root__` 根目录显示逻辑
- 重构 Diff/History 面板交互：新增提交区折叠、通过 portal 实现的外置控制栏、sticky header（含加载状态文案）与模式切换图标增强
- 重构 Pull/Push/Worktree 分支选择器：支持分组 Tab、搜索过滤、自定义下拉面板与 scope 分桶展示，提升多分支场景可用性
- 集成 Codex Fast/Review 快捷入口：ConfigSelect 新增 Speed 二级菜单（Standard/Fast）与 Review 入口，Review Inline Prompt 支持基线分支与提交搜索过滤
- 重构首页会话入口：引入 HomeChat 作为统一入口，自动解析并确保默认工作区目录存在，侧边栏默认工作区固定置顶
- 优化搜索块展示与链接交互，兼容 webSearch 数据格式

🐛 Fixes
- 修复 Codex 引擎首会话时序导致 model 缺失：增加后端模型兜底解析（优先前端传入 → workspace config → model/list 默认）
- 修复 Codex 首次会话线程创建兼容性：兼容多种 threadId 返回形态，新增 optimistic user message 消除首次发送延迟
- 修复 Codex 首发审批弹窗未及时出现：兼容 approval/request 事件路由，统一 request_id 解析
- 统一网络异常处理：新增首包超时结构化错误、网络错误分类与本地化提示，增强代理环境透传
- 修复 /review 在 Claude 场景下的执行链路并增强线程兼容兜底（legacy thread id 自动重绑重试）
- 修复 Composer 首次响应时错误触发 compacting 状态
- 修复 Win/Mac 下拉菜单滚动兼容性
- 修复 macOS 标题栏偏移触发条件并增强平台识别（新增 macOS 判断，收敛仅在特定布局组合态下生效）
- 修复工作区标题滚动重叠与背景色差
- 移除不稳定的代理环境注入与启动期代理同步逻辑

---

##### **2026年3月6日（v0.2.4）**

English:

✨ Features
- Add Codex context dual-view with automatic compaction flow: backend auto-trigger state machine (92% threshold, 70% target), manual compaction RPC, dual-view usage indicator (input+cached tokens), and full event/error propagation across app layers
- Add file tree root node with recursive lazy loading for special directories: workspace root node with expand/collapse, sticky toolbar, new file/folder actions, and multi-level lazy loading for `node_modules` and similar directories
- Add workspace full-text search with case-sensitive, whole-word, and regex options backed by a new Rust search command
- Add thread delete confirmation popover to prevent accidental deletions
- Add file panel maximize capability and enhance find panel interaction
- Add project session management in settings with project/worktree switching, bulk selection, and delete confirmation
- Restyle file panel action area to icon+text toolbar

⚡ Performance
- Increase workspace file scan limit from 20,000 to 100,000 in both Tauri and daemon paths

🎨 UI Improvements
- Optimize message list rendering with custom memo comparator; freeze displayed items during active text selection to preserve highlights during streaming
- Optimize file changes panel display density and hover background behavior

🐛 Fixes
- Fix `@@` manual memory selector scroll not working in composer
- Fix file changes panel to support click-to-diff and improve display density
- Fix Codex context compaction state and manual compaction interaction consistency: unify context usage calculation (last snapshot), fix compacting state event chain, prevent double-click on manual compaction button
- Fix Codex background helper thread causing session list to disappear after workspace switch
- Fix Codex sessions with `source=vscode` being incorrectly filtered out, causing history loss after restart

中文：

✨ Features
- 新增 Codex 上下文双视图与自动压缩链路：后端自动触发状态机（92% 阈值、70% 目标），手动压缩 RPC，双视图用量指示器（input+cached token），完整事件与错误传播链路
- 新增文件树根节点与特殊目录递归懒加载：工作区根节点支持展开/收起、Sticky 工具栏、新建文件/文件夹操作，`node_modules` 等特殊目录支持多层级逐级懒加载
- 新增工作区全文搜索：支持区分大小写、全词匹配和正则表达式，由新增 Rust 搜索命令支撑
- 新增线程删除二次确认弹窗，防止误操作
- 新增文件面板最大化能力，优化查找面板交互
- 新增设置页项目会话管理：支持按项目/工作树切换、批量选择与二次确认删除
- 文件面板操作区改为图标+文本工具栏样式

⚡ Performance
- 工作区文件扫描上限从 20,000 提升至 100,000（Tauri 和 daemon 路径同步升级）

🎨 UI Improvements
- 消息列表渲染优化：自定义 memo 比较器，用户选中文本时冻结列表渲染，避免流式更新打断文字选取
- 优化会话幕布文件变更面板展示密度与悬停背景表现

🐛 Fixes
- 修复 Composer 中 `@@` 手动记忆选择器上下滚动失效
- 修复会话幕布 File changes 支持点击查看 diff，并优化展示密度
- 修复 Codex 上下文压缩状态与手动压缩交互一致性：统一上下文占用统计口径（last 快照）、补齐压缩状态事件驱动链路、修复手动压缩按钮防连点
- 修复 Codex 后台 helper 线程导致会话侧栏切换后消失
- 修复 Codex `source=vscode` 会话被误过滤，导致重启后历史丢失

---

##### **2026年3月5日（v0.2.3）**

English:

✨ Features
- Add runtime log console (Phase 1) with Java toolchain and cross-platform compatibility: backend `runtime_log` module, workspace-level run session state machine, real-time log streaming, `RuntimeConsoleDock`/`RuntimeLogPanel` components, Windows cmd/wrapper support
- Add multi-stack profile detection and launch for runtime console: `runtime_log_detect_profiles` command supporting Java/Node/Python/Go, dynamic preset rendering, enhanced startup scripts with dependency checks
- Support empty directory display in file tree with single-child chain collapse (a/b/c → a.b.c), unified Diff/History entry, and Hub shortcut for Git History toggle
- Improve GitDiffPanel mode switching with custom dropdown menu, open/close state management, and unified visual styling
- Add notification sound selection (default/chime/bell/ding/success) with custom file picker support, redesign Basic settings with card-based layout
- Add usage analytics dashboard with cost estimation, session summaries, daily breakdown, trend analysis, tabbed interface and interactive charts
- Add custom model dialog and plugin model management for vendor providers
- Add `CurrentClaudeConfigCard` and `vendor_get_current_claude_config` command

⚡ Performance
- Optimize git status polling with adaptive active/background/paused modes using chained `setTimeout`
- Skip per-file diff stats when changed files exceed 120 (backend) or 80 (frontend preload)
- Prevent overlapping git status requests via in-flight tracking
- Bound thread list page scanning with configurable caps
- Normalize workspace paths for macOS `/private` prefix variants

🎨 UI Improvements
- Unify terminal and runtime log panel width with full-column grid layout
- Restyle terminal tabs from capsule borders to bottom-line with blue active indicator
- Hide duplicate runtime log toggle in file tree area, restore Git tab in PanelTabs

🐛 Fixes
- Fix file list display issues
- Fix terminal panel close path to avoid state desynchronization
- Fix file tree path separators on Windows to avoid mixed separators
- Fix command preset misidentification on Windows

中文：

✨ Features
- 新增运行日志控制台（第一阶段）：后端 `runtime_log` 模块、工作区级运行会话状态机、实时日志流、`RuntimeConsoleDock`/`RuntimeLogPanel` 组件、Windows cmd 兼容与 Java 启动器探测
- 运行控制台支持多技术栈 profile 探测与启动：`runtime_log_detect_profiles` 命令支持 Java/Node/Python/Go、动态预设渲染、增强启动脚本与依赖检测
- 文件树支持空目录展示与单子目录链折叠显示（a/b/c → a.b.c），统一 Diff/History 入口，新增 Hub 快捷按钮切换 Git History
- 优化 GitDiffPanel 模式切换：自定义下拉菜单、开关状态管理、统一视觉层级与交互样式
- 新增通知提示音选择（默认/风铃/铃声/叮咚/成功）与自定义文件选取，重新设计基本设置为卡片式布局
- 新增使用量分析面板：费用估算、会话摘要、每日用量明细、趋势分析、标签页式界面与交互图表
- 新增自定义模型对话框与供应商插件模型管理
- 新增 `CurrentClaudeConfigCard` 与 `vendor_get_current_claude_config` 命令

⚡ Performance
- Git 状态轮询优化：自适应 active/background/paused 模式，使用链式 `setTimeout` 替代固定 `setInterval`
- 变更文件超过 120 时跳过逐文件 diff 统计（后端），超过 80 时跳过前端 diff 预加载
- 通过 in-flight 标记防止 Git 状态请求重叠
- 线程列表页面扫描增加可配置上限
- 规范化工作区路径以处理 macOS `/private` 前缀变体

🎨 UI Improvements
- 统一终端与运行日志面板宽度（全列网格布局）
- 终端标签页由胶囊边框改为底部蓝色边线样式
- 隐藏文件树中重复的运行日志入口，恢复 PanelTabs 中的 Git 标签

🐛 Fixes
- 修复文件列表显示问题
- 修复终端面板关闭路径导致的状态不同步
- 修复 Windows 上文件树路径分隔符混用问题
- 修复 Windows 上命令预设误判问题

---

##### **2026年3月3日（v0.2.2）**

English:

✨ Features
- Enhance message display and add user bubble color customization
- Add `@@` manual memory completion in ChatInputBox with dropdown preview panel, title/summary/tags display, and detached draft support for no-active-thread scenarios
- Add real-time usage entry and plan mode toggle for Codex engine in composer
- Align Codex plan mode protocol with requestUserInput lifecycle

🐛 Fixes
- Fix Codex engine inconsistency after Plan -> Code mode switch within session
- Fix file tree `+` button insertion: use native `@absolutePath` mention format instead of icon+path text
- Fix thread mode sync and stale user input event handling on thread switch
- Address code review issues from PR #153

中文：

✨ Features
- 增强消息显示效果并新增用户气泡颜色自定义
- 在 ChatInputBox 中新增 `@@` 手动记忆补全：下拉预览面板（标题/摘要/标签/重要度/更新时间）、无活跃线程时的草稿支持
- Codex 模式新增实时用量入口与计划模式切换
- 对齐 Codex 计划模式协议与 requestUserInput 生命周期

🐛 Fixes
- 修复 Codex 引擎在会话内 Plan -> Code 切换后的表现不一致问题
- 修复文件树 `+` 按钮插入行为：改为原生 `@absolutePath` mention 形式，避免行级点击干扰
- 修复线程切换时模式同步与过期 user input 事件处理
- 修复 PR #153 代码审查中发现的问题

---

##### **2026年3月2日（v0.2.1）**

English:

✨ Features
- Optimize Windows frameless window interaction, layout behavior and message code highlighting
- Refactor settings panel into modular section components for better maintainability

🐛 Fixes
- Correct topbar z-index stacking and sidebar placeholder scope

🔧 Improvements
- Rewrite README with detailed feature overview and development guide

中文：

✨ Features
- 优化 Windows 无边框窗口交互、布局行为与消息代码高亮
- 重构设置面板为模块化 Section 组件，提升可维护性

🐛 Fixes
- 修复顶栏 z-index 层叠与侧栏占位区域范围问题

🔧 Improvements
- 重写 README，补充详细的功能概览和开发指南

---

##### **2026年3月2日（v0.2.0）**

English:

✨ Features
- Enable Auto Mode by default and support paste image direct submission in composer
- Add Code Intel definition/reference navigation for file view
- Add new ChatInputBox component system and refactor Composer architecture
- Add Agent management system and AskUserQuestion interactive dialog
- Support horizontal/vertical dual layout switch for editor view with enhanced split-pane drag
- Display added/modified line markers in editor synced with Git status colors
- Split editor and chat panels, refine file tab experience
- Redesign sidebar navigation and improve scrollbar behavior
- Complete chat canvas architecture refactoring with consistency gates
- Add collaboration mode enforcement policy and thread-level state sync
- Raise thread list capacity limit and remove message truncation
- Add workspace welcome page with sidebar entry coordination, complete .agents scanning
- Refine UI layout, improve message rendering performance, and add send shortcut settings
- Complete multi-language rendering coverage for right-side file view

🐛 Fixes
- Fix GitHub Actions build out-of-memory issue
- Fix test environment async residual errors after teardown
- Fix GitHistory branch rename test CI timing flake
- Fix lint regex errors and sync message component changes
- Fix chat file reference interaction and optimize file open and status display
- Add global error boundary, optimize panel drag experience and build config

🔧 Improvements
- Refactor ChatInputBox layout and visual style
- Refactor thinking block component to minimal design with centered message layout
- Remove WorkspaceHome module and improve thread list tooltip
- Change sidebar skills entry to "coming soon" and optimize workspace tree styles

中文：

✨ Features
- 默认启用 Auto Mode 并支持粘贴图片直接提交
- 接入 Code Intel 定义/引用导航能力
- 新增 ChatInputBox 输入框组件系统并重构 Composer 架构
- 新增 Agent 管理系统和 AskUserQuestion 交互对话框
- 编辑视图支持上下/左右双布局切换并增强分栏拖拽
- 编辑器显示新增/修改行标记并同步 Git 状态颜色
- 拆分编辑器与聊天面板，优化文件标签页体验
- 重新设计侧栏导航并改善滚动条行为
- 完成对话幕布架构重构并补齐一致性门禁
- 增加协作模式强制策略与线程级状态同步
- 提升线程列表容量限制并移除消息截断
- 工作区欢迎页与侧栏入口联动优化，补齐 .agents 扫描
- 优化 UI 布局，提升消息渲染性能，新增发送快捷键设置
- 补齐右侧文件视图多语言渲染覆盖

🐛 Fixes
- 修复 GitHub Actions 构建内存溢出问题
- 修复测试环境销毁后的异步残留报错
- 修复 GitHistory 重命名分支测试的 CI 时序抖动
- 修复 lint 正则错误并同步消息组件改动
- 修复聊天文件引用交互并优化文件打开与状态展示
- 添加全局错误边界、优化面板拖拽体验和构建配置

🔧 Improvements
- 重构 ChatInputBox 布局与视觉风格
- 重构思考块组件为极简设计并居中消息布局
- 移除 WorkspaceHome 模块并改进线程列表提示框
- 侧栏技能入口改为敬请期待并优化工作区树形样式

---

##### **2026年2月27日（v0.1.9）**

English:

✨ Features
- Complete bottom function area and selector style interaction optimization
- Use official model icons for Claude/Gemini/Codex engines
- Complete Spec Hub entry and gate alignment capability upgrade
- Complete Spec Hub execution feedback orchestration and OpenSpec hardening
- Support project-level Skills/Commands discovery with source-grouped display (S+/M+)
- Support `@@` manual memory association and enhance thread message stability
- Complete memory capability landing with context injection, batch & tag abilities, light theme unification
- Optimize project memory list UI visual effects
- Complete memory Kind auto-classification fix and archive implementation plan
- Finalize note/conversation flow and context-injection planning

🐛 Fixes
- Restore git diff split alignment, independent horizontal scroll, and readability
- Keep verify/archive executable when Spec Hub preflight blocks archive
- Vendor xmlchars to avoid npm registry 403
- Unblock npm 403 and fix Rust compile error
- Resolve post-cherry-pick typecheck issues in memory module

🔧 Improvements
- Rename MossX to in build scripts and CI workflow, then rename back to MossX across codebase
- Stabilize Spec Hub i18n text and language switch validation tests
- Stabilize SettingsView shortcut teardown tests

中文：

✨ Features
- 完成底部功能区与选择器样式交互整体优化
- 引擎图标使用 Claude/Gemini/Codex 官方模型图标
- 完成 Spec Hub 入口与门禁对齐能力升级
- 完成 Spec Hub 执行反馈编排与 OpenSpec 加固
- 支持项目级 Skills/Commands 发现并按来源分组展示 S+/M+
- 支持 `@@` 手动关联记忆并增强线程消息稳定性
- 完成记忆能力落地：上下文注入、批量与标签能力、浅色样式统一
- 优化项目记忆列表 UI 视觉效果
- 完成 Kind 自动分类修复并归档实施计划
- 完成笔记/对话流程与上下文注入规划

🐛 Fixes
- 修复 Git Diff 分栏对齐、独立水平滚动和可读性
- 修复 Spec Hub 预检阻止归档时验证/归档仍可执行
- 内置 xmlchars 依赖以避免 npm registry 403 错误
- 修复 npm 403 和 Rust 编译错误
- 修复记忆模块 cherry-pick 后的类型检查问题

🔧 Improvements
- 统一品牌名称：在构建脚本和 CI 中重命名为 MossX
- 完善 Spec Hub 文案国际化与语言切换校验测试
- 稳定 SettingsView 快捷键销毁测试

---

##### **2026年2月22日（v0.1.8）**

English:

✨ Features
- Enhance Create PR preview and popup interaction experience
- Implement full Create PR workflow with branch deletion recovery mechanism, refactor PR popup compare interaction and visual
- Implement worktree publish recovery and git command stability improvements
- Complete pull/sync/fetch/refresh two-step confirmation with parameterized execution
- Optimize history panel and diff preview interaction
- Enhance push popup preview and reset flow in commit history
- Add explicit baseline selection for worktree and enhance branch context menu
- Unify Git history panel interaction with workspace validation and error prompts
- Complete log panel refactoring with branch creation interaction
- Unify sidebar icon style and fix settings page switch and PR flow layout

🐛 Fixes
- Fix branch rename button unresponsive and unify top action button active state
- Fix worktree publish failure recovery and enhance Git command stability
- Remove misleading diff action by removing unused open-file button
- Restore branch context menu and remove always-visible checkout button from list
- Dock change-anchor controls as modal footer bar
- Unify Git panel log tab label to "Git"
- Fix session hard delete and improve kanban popup and trigger state interaction
- Clean up codexLeadMarkers regex invalid escapes

🔧 Improvements
- Reduce noise and consolidate Hook dependency warnings (no behavior change)

中文：

✨ Features
- 增强创建 PR 预览与弹窗交互体验
- 落地 Create PR 全流程与分支删除恢复机制，重构 PR 弹窗 compare 交互与视觉
- 落地工作树发布失败恢复与 Git 命令稳定性提升
- 完成 pull/sync/fetch/refresh 二段确认与参数化执行
- 优化历史面板与差异预览交互
- 提交历史增强 Push 弹窗预览与 Reset 流程
- 工作树显式基线选择与分支右键菜单能力完善
- 统一 Git 历史面板交互并补齐工作区校验与错误提示
- 完成日志面板重构与分支创建交互
- 统一侧栏图标风格并修复设置页切换与 PR 流程布局

🐛 Fixes
- 修复分支重命名按钮无响应并统一顶部操作按钮激活态
- 修复工作树发布失败可恢复并增强 Git 命令稳定性
- 移除误导性 diff 操作按钮（未使用的打开文件按钮）
- 恢复分支右键菜单并移除列表常驻 checkout 按钮
- 将变更锚点控件停靠为模态框底栏
- 统一 Git 面板日志页签文案为 Git
- 修复会话硬删除并完善看板弹窗与触发态交互
- 清理 codexLeadMarkers 正则无效转义

🔧 Improvements
- 去噪优化并收敛 Hook 依赖告警（无行为变更）

---

##### **2026年2月18日（v0.1.7）**

English:

✨ Features
- Complete workspace sidebar visual coordination makeover (t1-4)
- Implement optimize-codex-chat-canvas proposal core capabilities
- Unify management UI to reduce clutter and improve scalability
- Lay groundwork for consistent settings UX and theming
- Enhance tree-based single-file diff with full-text anchor navigation
- Alert on session completion when app is unfocused
- Add task editing and macOS compatibility improvements for kanban
- Complete OpenCode panel capabilities with session recovery and test coverage
- Complete OpenCode phase 2 capabilities with stability fixes and chat experience optimization
- Support engine dropdown and icon style optimization for new sessions on workspace home
- Complete file multi-tab and input area visibility experience optimization
- Add lock screen overlay and session completion reminder

🐛 Fixes
- Fix session lifecycle: converge delete semantics and align OpenCode entry with canvas consistency
- Unblock settings and composer regressions
- Stabilize reasoning stream event handling for Codex
- Prevent stale async state from leaking memory across sessions
- Ensure consistent active styling across themes for vendors
- Prevent stale Claude IDs from reusing wrong engine thread
- Reduce workflow friction from noisy streams and title failures
- Fix kanban link display and session batch delete confirmation flow
- Fix OpenCode heartbeat prompt, engine detection and panel interaction
- Use dynamic discovery for OpenSSL library references in build
- Stabilize sidebar thread layout to reduce clipping/jitter

🔧 Improvements
- Drop dim mode to simplify theme support and UX
- Reduce hidden UI state to keep context always visible
- Simplify completion alerts to avoid split notification UX

中文：

✨ Features
- 完成 t1-4 工作区侧栏视觉协调改造
- 落地 optimize-codex-chat-canvas 提案核心能力
- 统一管理 UI，减少界面杂乱并提升可扩展性
- 为一致的设置 UX 和主题系统奠定基础
- 树形单文件差异与全文锚点导航增强
- 应用失焦时会话完成弹出提醒
- 看板新增任务编辑与 macOS 兼容性改进
- 完善 OpenCode 面板能力并补齐会话恢复与测试覆盖
- 完成 OpenCode 二期能力与稳定性修复并优化聊天体验
- 新建会话支持引擎下拉与图标样式优化
- 完成文件多标签与输入区可见性体验优化
- 新增锁屏遮罩与会话完成提醒

🐛 Fixes
- 修复会话生命周期：收敛删除语义并打通 OpenCode 入口与幕布一致性
- 修复设置和 Composer 回退问题
- 稳定 Codex 推理流事件处理
- 防止过期异步状态跨会话内存泄漏
- 确保各主题下供应商激活样式一致
- 防止过期 Claude ID 复用错误引擎线程
- 减少嘈杂流和标题失败造成的工作流阻力
- 修复看板关联显示与会话批量删除确认流程
- 修复 OpenCode 心跳提示、引擎检测与面板交互
- 构建时使用动态发现 OpenSSL 库引用
- 稳定侧栏线程布局以减少裁剪/抖动

🔧 Improvements
- 移除 Dim 模式以简化主题支持和 UX
- 减少隐藏 UI 状态以保持上下文始终可见
- 简化完成提醒以避免分裂通知 UX

---

##### **2026年2月11日（v0.1.6）**

English:

✨ Features
- Add unified search panel with category filtering
- Optimize kanban strip density and ordering in composer

🐛 Fixes
- Stabilize kanban links across workspace ID changes
- Stabilize context menus with portal and compact layout in composer

中文：

✨ Features
- 新增统一搜索面板与分区筛选
- 优化 Composer 中看板条目密度和排序

🐛 Fixes
- 修复工作区 ID 变更时看板链接稳定性
- 使用 Portal 和紧凑布局稳定右键菜单

---

##### **2026年2月10日（v0.1.5）**

English:

✨ Features
- Remove Sentry telemetry, add About page and kanban git panel

中文：

✨ Features
- 移除 Sentry 遥测，新增关于页面和看板 Git 面板

---

##### **2026年2月10日（v0.1.4）**

English:

✨ Features
- Reduce context switching with in-app long-term memory view
- Improve UX with thread tooltips, task draft persistence, and interrupt handling
- Support multi-source skill discovery with priority merge

🐛 Fixes
- Prevent memory navigation hijacks and reduce setup confusion
- Improve DMG detach reliability in create-dmg script

中文：

✨ Features
- 新增应用内长期记忆视图，减少上下文切换
- 改进线程工具提示、任务草稿持久化和中断处理
- 支持多来源 Skill 发现与优先级合并

🐛 Fixes
- 防止记忆导航劫持并减少设置困惑
- 提升 create-dmg 脚本中 DMG 弹出可靠性

---

##### **2026年2月9日（v0.1.2）**

English:

✨ Features
- Prefer local discovery for faster offline skill listing
- Keep CLI settings and model names in sync for Claude
- Support Claude inherit and composer click-outside close
- Let users switch AI providers and reliably stop sessions

🐛 Fixes
- Update Haiku model and add Opus 1M variant

🔧 Improvements
- Upgrade release runner to ubuntu-24.04 for newer tooling

中文：

✨ Features
- 优先本地发现以加速离线 Skill 列表
- 保持 Claude CLI 设置与模型名称同步
- 支持 Claude 继承与 Composer 点击外部关闭
- 支持用户切换 AI 供应商并可靠停止会话

🐛 Fixes
- 更新 Haiku 模型并添加 Opus 1M 变体

🔧 Improvements
- 升级发布 Runner 到 ubuntu-24.04 以使用更新的工具链

---

##### **2026年2月9日（v0.1.1）**

English:

✨ Features
- Merge skill commons panel and kanban context mode in composer

🐛 Fixes
- Add retry logic for DMG detach in CI environment

中文：

✨ Features
- 合并 Composer 中的 Skill 公共面板与看板上下文模式

🐛 Fixes
- CI 环境中 DMG 弹出添加重试逻辑

---

##### **2026年2月9日（v0.1.0）**

English:

✨ Features
- Reduce typing friction and improve task progress cues
- Improve kanban task discussions with richer markdown

🐛 Fixes
- Prevent macOS DMG builds failing on Finder scripting in CI

中文：

✨ Features
- 减少输入摩擦并改善任务进度提示
- 改进看板任务讨论，支持更丰富的 Markdown

🐛 Fixes
- 修复 CI 中 macOS DMG 构建因 Finder 脚本失败的问题

---

##### **2026年2月8日（v0.0.9）**

English:

✨ Features
- Reduce file-management friction and i18n drift in workspaces
- Redesign workspace landing with guided starts and conversation entry
- Polish worktree/session sections and collapse interactions in sidebar
- Improve kanban linking UX and routed send behavior

🐛 Fixes
- Reduce confusing UI states when tooling context is missing
- Reduce install friction and UI jank across core workflows

中文：

✨ Features
- 减少工作区文件管理摩擦和国际化偏差
- 重新设计工作区着陆页，引导启动和对话入口
- 优化侧栏工作树/会话区域和折叠交互
- 改进看板链接 UX 和路由发送行为

🐛 Fixes
- 减少工具上下文缺失时的困惑 UI 状态
- 减少核心流程中的安装摩擦和 UI 卡顿

---

##### **2026年2月7日（v0.0.8）**

English:

✨ Features
- Improve readability with diagrams, git hints and opaque UI

中文：

✨ Features
- 通过图表、Git 提示和不透明 UI 改善可读性

---

##### **2026年2月7日（v0.0.7）**

English:

✨ Features
- Reduce context switching with in-app editing and panelized kanban
- Reduce context-switch errors and improve task triage in kanban
- Stabilize UX with file-backed state and richer kanban flows
- Add kanban mode to manage AI tasks without chat clutter

中文：

✨ Features
- 通过应用内编辑和面板化看板减少上下文切换
- 减少看板上下文切换错误并改进任务分类
- 通过文件持久化状态和更丰富的看板流程稳定 UX
- 新增看板模式，无需聊天即可管理 AI 任务

---

##### **2026年2月7日（v0.0.6）**

English:

✨ Features
- Make agent activity easier to scan in chat messages
- Enable archive for Claude Code CLI threads with local data deletion

🐛 Fixes
- Reduce homepage whitespace to improve first-screen clarity
- Keep recent conversations visible for Claude threads
- Extract tool action description for inline summary display

🔧 Improvements
- Remove tool-group headers and improve tool summary labels
- Switch tool rendering from block cards to inline style

中文：

✨ Features
- 使聊天消息中的 Agent 活动更易浏览
- 支持 Claude Code CLI 线程归档与本地数据删除

🐛 Fixes
- 减少首页空白以改善首屏清晰度
- 保持 Claude 线程的最近对话可见
- 提取工具操作描述用于内联摘要显示

🔧 Improvements
- 移除工具组头部并改进工具摘要标签
- 将工具渲染从卡片块切换为内联样式

---

##### **2026年2月7日（v0.0.5）**

English:

✨ Features
- Surface task status near composer to reduce context switching
- Enable localized dictation and empty state text
- Support localized UX and per-turn engine isolation
- Persist auto-generated thread titles for reuse
- Surface more thread and Claude history by default
- Support new agent workflow across models and UI

🐛 Fixes
- Prevent dropped tool events and reduce UI friction across locales
- Refresh pinned thread list on pin state changes
- Prevent stale tool states and unify CLI-missing errors
- Avoid auto-rename conflicts during parallel Claude runs
- Streamline thread UX and tool status consistency

中文：

✨ Features
- 在 Composer 附近展示任务状态以减少上下文切换
- 支持本地化语音输入和空状态文案
- 支持本地化 UX 和每轮引擎隔离
- 持久化自动生成的线程标题以供复用
- 默认展示更多线程和 Claude 历史记录
- 支持跨模型和 UI 的新 Agent 工作流

🐛 Fixes
- 防止工具事件丢失并减少跨语言环境的 UI 摩擦
- Pin 状态变更时刷新置顶线程列表
- 防止工具状态过期并统一 CLI 缺失错误
- 避免并行 Claude 运行时的自动重命名冲突
- 精简线程 UX 和工具状态一致性

---

##### **2026年2月6日（v0.0.4）**

English:

✨ Features
- Optimize UI spacing and thread display threshold
- Change workspace delete dialog wording to "remove" for i18n

中文：

✨ Features
- 优化 UI 间距和线程显示阈值
- 国际化：将工作区删除对话框措辞改为"移除"

---

##### **2026年2月5日（v0.0.3）**

English:

✨ Features
- Implement menu localization with i18n support
- Expose Claude command library for slash command usage

🐛 Fixes
- Align Windows release artifacts with Tauri 2 outputs

🔧 Improvements
- Improve Windows CMake detection and refactor Claude engine

中文：

✨ Features
- 实现菜单国际化支持
- 开放 Claude 命令库用于斜杠命令

🐛 Fixes
- 对齐 Windows 发布产物与 Tauri 2 输出

🔧 Improvements
- 改进 Windows CMake 检测并重构 Claude 引擎

---

##### **2026年2月5日（v0.0.2）**

English:

✨ Features
- Improve tool-call UX and harden signing key handling
- Prioritize desktop UX and restore auto-updates

中文：

✨ Features
- 改进工具调用 UX 并加固签名密钥处理
- 优先桌面 UX 并恢复自动更新

---

##### **2026年2月4日（v0.0.1）**

English:

✨ Features
- Initial release of MossX desktop application
- Tauri 2 + React 19 + TypeScript architecture
- Claude Code CLI integration with session management

中文：

✨ Features
- MossX 桌面应用初始发布
- Tauri 2 + React 19 + TypeScript 架构
- Claude Code CLI 集成与会话管理
