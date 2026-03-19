# Changelog

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

🐛 Fixes
- Fix composer input overflow caused by long `MessageQueue` text blocks
- Fix `MessageQueue` queue type reference mismatch in chat input path
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

🐛 Fixes
- 修复长文本 `MessageQueue` 场景下输入区布局溢出问题
- 修复聊天输入链路中 `MessageQueue` 队列类型引用错误
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
