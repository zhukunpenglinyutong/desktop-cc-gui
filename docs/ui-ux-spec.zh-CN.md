# CC GUI 界面与交互规范（UI/UX Spec）

> **版本**：v0.1（首版，随实现增量维护）
> **适用范围**：`src/styles`、`src/components`、`src/features` 中所有用户可见的界面与交互
> **关联代码**：`src/styles/theme.css`（设计 token）、`src/styles/typography.css`（文本样式）、`src/components/base/*`（基础组件）、`src/i18n/{zh,en}.ts`（文案）

这是本项目界面与交互的**唯一约定来源**。凡是"两个地方长得不一样、动得不一样"的问题，先在这里定一条规则，再改代码；代码里出现的做法如果值得复用，就回写成规则。

文档只写**已经落地、能指到代码**的规则；暂时做不到的放进 [§8 待收敛](#8-待收敛)，不假装成立。

---

## 目录

1. [维护约定](#1-维护约定)
2. [设计基础](#2-设计基础)
3. [状态与可用性](#3-状态与可用性)
4. [动作反馈](#4-动作反馈)
5. [加载、空状态与错误](#5-加载空状态与错误)
6. [破坏性操作](#6-破坏性操作)
7. [刷新入口清单](#7-刷新入口清单)
8. [待收敛](#8-待收敛)

---

## 1. 维护约定

- **谁改谁更新**：新增或修改用户可见的交互反馈、基础组件视觉、动效时长时，在同一个提交里更新本文对应章节。
- **新增刷新/重载入口必须登记**到 [§7 刷新入口清单](#7-刷新入口清单)；没登记的算没做完。
- **规则要能落到代码**：每条规则写清文件和常量名。文档与代码冲突时**以代码为准**，并立即修正文档（或反过来改代码 + 补充说明）。
- 只维护这一份中文文档，不再派生第二份双语副本，避免两边漂移。
- 规则来自真实问题，不预先发明：同一条规则第二次被违反时，才值得写进来。

## 2. 设计基础

### 2.1 Token 优先

- 颜色、圆角、阴影、动效一律引用 `src/styles/theme.css` 的**语义 token**（`text-*`、`background-*`、`border-*`、`foreground-icon-*`、`notification-*`、`shadow-*`），不写死色值、不直接引用 `slate-*` 之类的原始色阶。
- 文本排版用 `src/styles/typography.css` 的 `text-*` 系列（`text-body-medium`、`text-caption-1-regular`…）。`cx()` 依赖 `src/utils/cx.ts` 里登记过的文本族，新增文本族必须同步登记，否则会被 tailwind-merge 当成颜色丢掉。
- 关键帧动画定义在 `src/styles/theme.css` 的 `@theme` 里（如 `--animate-refresh-spin`）并配 `@keyframes`，组件只引用动画名。

### 2.2 组件优先

- 交互控件优先复用 `src/components/base/*`（`Button`、`IconButton`、`Dropdown`、`Select`、`Input`、`Switch`、`Tooltip`…）。页面内自造按钮要么说明 base 组件为什么不适用，要么把它沉淀成 base 组件。
- 尺寸以组件自身定义为准，不在调用点临时改高度：`Button` medium 36 / small 32 / xs 24，`IconButton` medium 36 / small 32。
- `Button` / `IconButton` 需要承载动态图标时用 `children` 覆盖默认图标（两者同一契约），不要用 `[&_svg]:animate-spin` 这类穿透选择器改图标行为。
- 图标一律取 `lucide-react/dist/esm/icons/*`（按需具名导入）；不新引图标库，也不自绘 SVG。同一入口出现在多个位置时三处共用同一个图标：插件/插件市场 = `layout-grid`（侧边栏 `sidebar-chrome.tsx`、插件中心页签 `use-chat-tabs.ts`、设置页插件条目无品牌素材时的兜底 `PluginSettingsNavIcon.tsx`）。

### 2.3 文案与无障碍

- 用户可见文案一律从 `src/i18n/zh.ts`、`src/i18n/en.ts` 取，两个语言文件同步新增 key，组件里不写死中文。
- 图标按钮必须同时有 `aria-label`（可访问名）和 `title`（指针悬停）。可访问名用**动作名**（"刷新"、"重新加载"），不用"点这里"。
- 需要解释性文案、快捷键或多行说明时才用 `Tooltip`（`src/components/base/tooltip/tooltip.tsx`）：它基于 react-aria，trigger 必须是 react-aria 组件或包在 `Focusable` 里的元素；触屏上不可达，所以**关键信息不能只放在 tooltip 里**。

### 2.4 展开 / 收起动效

- **把下面内容推开的展开/收起一律做高度过渡，不允许条件渲染直接闪现**（`{open && …}` 少了过渡就是瞬间抽走 / 塞回）。实现统一用 CSS `grid-template-rows: 1fr ⇄ 0fr`，让浏览器插值轨道高度、兄弟行被平滑推开；不用 `max-height` 猜高度，也不用 JS 逐帧量高。现成实现两处，不要另起：侧栏树/列表用 `src/components/application/ai-chat/repo-tree.tsx` 的 `SidebarDisclosure`（`WorktreeGroup` 分组与线程列表共用：`300ms` + `ease-in-out` + `motion-reduce:transition-none`）；消息/面板级折叠用 `src/components/application/collapsible/collapsible.tsx` 的 `Collapsible`（额外 `opacity` + `visibility` 收尾，时长由调用点给）。两者都只转箭头方向（`transition-transform duration-150` + 展开时 `rotate-90`）并同步 `aria-expanded`。
- **收起过程中内容保持挂载，动画结束才卸载**：内容要在关闭动画期间留在 DOM 里（`SIDEBAR_COLLAPSE_MS` = 300ms 后卸载，顺带回收分页等组件内状态，下次展开回到第一页），否则收起读起来是「啪」地消失。
- **不用 `opacity` 淡出列表行**：列表淡出会在下方内容上留一帧合成残影（`repo-tree.tsx` 的注释记录了这次事故）；只裁切高度。收起期间给区域 `aria-hidden="true"` + `inert`，键盘与读屏不进入被裁掉的内容。长消息的「展开全文」（`CollapsibleMessage`，`max-height` + 渐变遮罩）是把气泡裁短而不是推动兄弟行，属于另一类视觉，不在这条规则内。
- **回归**：`tests/browser/sidebar-collapse.html` 逐帧采样「WORKTREES」分组与 worktree 子行的展开/收起高度——每个方向必须经过 ≥3 个中间帧、收起期间行仍在 DOM（只有首尾两个值＝直接跳变）；`ai-chat-sidebar.test.tsx` 覆盖收起后 300ms 才卸载。

## 3. 状态与可用性

- **插件会话模式**：获得 `ui:conversation-mode` 授权后，在 CLI 选择器旁提供入口，不伪装成 CLI 或权限选项；普通轮次或发送队列未结束时禁止切入。模式替换当前聊天内容区与输入框，保留原普通对话。运行、取消待确认及恢复待核对期间禁止通过宿主「返回普通对话」绕过插件的退出锁。
- **接力首版**：规划与执行分别配置引擎 / 渠道 / 模型，配置浮层限高滚动且动作区保持可见。允许多轮讨论和手工编辑，每份完整计划保存为新版本；只有最新、已保存、无未解问题且无未发送草稿的计划可点击「确认此版并执行」。普通发送、AI 回复结束和保存编辑均不授权执行。确认冻结交接包，执行新建原生会话；历史版本只读。
- **接力停止与恢复**：停止是请求取消，不是回滚；等待进程终态才结束忙碌状态，失败不自动重试写入。重新打开已保存接力记录先核对上次进程及工作区，不自动续跑。明确披露记录独立于普通聊天、其他会话与外部编辑器不受接力单任务锁保护。
- **活动插件标签保护**：插件报告忙碌后，标签关闭和会替换草稿的引擎切换同样受阻断；切换到别的标签不释放原任务锁。锁与草稿身份持久化，插件被禁用时显示恢复提示，不回落为可发送的普通对话；重新启用插件并停止 / 核对后解锁。目录读取失败仍显示恢复与停止入口。
- **AskUserQuestion 多题流转**：单选选项使用圆形单选标记，多选选项使用方形复选标记。单选答完自动跳到下一道未答题；中间的多选题不显示「提交」，须先按「确认本题并继续」保存本题选择；仅最后一道多选题显示「提交」，全部题目完成后统一提交。

- **电脑操控逐次开启，不做全局开关**：`/ccgui-cua <任务>`（`app-commands.ts` 的 `parseAppCommand`）只为那一次发送挂载驱动（`send` 的 `SendOptions.computerUse`），排队消息带着同一标志（`QueuedMessage.computerUse`）——机器输入被预授权，不能从一条普通消息间接触达。设置页 `ComputerUseSection.tsx` 只给权限状态与授权引导，不放 on/off 开关。
- **引擎不支持电脑操控时必须明说**：`engineSupportsComputerUse` 读引擎能力位（`EngineInfo.supportsComputerUse`），为假时发送前拒绝并在会话错误条给出原因，不静默降级成普通对话；设置页按引擎列出支持情况（判定用精确文案，不能按“支持”子串误判“不支持”）。
- **权限行读真实系统状态**：`computer_use_permission_status` 决定已授权/未授权，`osPermissionsRequired` 为假（Windows/Linux）时显示“无需额外授权”而非未授权行，不追一条系统从不要的授权；macOS 的授权入口是「打开系统设置」按钮深链到对应面板（`computer_use_open_permission_settings`），页面不提供拖拽 App 图标的引导，也不暗示点一下就能自动授予。
- **虚拟光标由 App 强制显示，不是设置项**：运行期间 `cu_overlay.rs` 跟随每个动作目标显示指针，模型侧没有可关闭它的工具；提示词只能说明它存在（computer_use.rs 的 MCP `instructions`），不能决定其可见性。
- **急停只在电脑操控回合期间武装**：`computerUseSetActive` 在发送时武装、回合终止（`engine-events.ts` 的 `done`/`error`）时解除，全局 Esc 不超出它的运行期。
- 可交互元素至少实现：默认 / hover / `focus-visible`（`ring-border-focus-ring`）/ active / disabled。按钮类控件的焦点环只走 `focus-visible`（不打扰鼠标用户）；输入类控件可以用 `focus:border-border-focus-ring` 表示聚焦，因为文本输入聚焦本身就是用户意图。
- disabled 必须改变光标语义（`disabled:cursor-not-allowed` 或 `disabled:cursor-default`）并降低强调（`opacity-50`~`60` 或语义 disabled token），不能只是点不动。
- **异步动作进行中不可重入**：进行中禁用按钮（或首行拦截 `if (running) return`），避免重复请求。
- **反馈不改变布局**：图标在默认态与反馈态之间切换时，外层容器尺寸固定（`ActionFeedbackIcon` 用 `iconClassName` 同时约束容器和图标），按钮不能因为换图标而抖动。
- **动效可降级**：过渡类一律带 `motion-reduce:transition-none`；关键帧动画的降级见 [§8](#8-待收敛)。
- **同一状态只表达一次**：列表行里「已安装 / 可更新」只给一个信号——市场表的右侧按钮就是该行的状态（`安装` → `更新至 vX` → `已安装`），行内不再重复挂徽标；安装中按钮原地换成进度（`plugins.installingPct`）且保持占位不變（`PluginMarketRow.tsx`）。
- **表格化列表**：插件市场用语义 `<table>` + `table-fixed`，列头是唯一的字段说明（名称 / 开发者 / 安装量 / 版本 / 操作）；整列无数据时整列不渲染（`PluginMarketView` 的 `showDownloads`），不用一列「—」占位。开发者列的头像是该账号的真实 GitHub 头像（`githubAvatarUrl`），加载中或取不到时回落到同一配色的首字母瓷砖，不出现破图。
- **官方身份用紫色品牌徽标，工具栏下拉同时承担人群范围**：市场表开发者列在 `githubLoginFor` 解析出的账号等于官方账号时（`isOfficialPlugin`，账号 `zhukunpenglinyutong`，author 或 repo owner，大小写不敏感），整格只渲染紫色「CCGUI官方插件」徽标（`status-purple-background` / `status-purple-text`；紫色专属官方，不与中性类型徽标、lime「已安装」混用）——官方插件的账号是隐含信息，不再重复头像与（被截断的）用户名；详情页右栏 `AuthorChip` 同一条判定，徽标整块是按钮（`title` 报出目标主页），点击打开该官方账号主页，第三方插件才展示可点的头像+名称。工具栏下拉（`sortLabel`）语义混合：`综合排序` / `下载量` 显示全部、只是排序不同；`CCGUI官方插件` / `社区插件` 只保留该类并按下载量排序（`sortPlugins` 内 `pluginMatchesAudience`）。空状态的「清除筛选」要把下拉一并复位回 `综合排序`。
- **开发者只在能落到真实账号时可点**：插件详情页右栏的「开发者」用 `githubLoginFor({ author, repo })` 判定身份——索引 `author` 是 GitHub 账号（或回落到 repo owner）时，整块头像+名称是可点按钮，点击走 `openExternal` 打开 `https://github.com/<login>`，并把目标主页写进 `title`；官方徽标同理指向 `OFFICIAL_PLUGIN_LOGIN`；解析不出账号时保持纯文本，不猜主页地址（`PluginDetailPage.tsx` 的 `AuthorChip`）。
- **带背景的块在 flex 列里必须自适应宽度**：右信息栏 `RailRow` 是 `flex flex-col`，默认 `align-items: stretch` 会把任何块拉伸到整栏宽——带背景的徽标不加 `w-fit` 就变成整行色块。所以 `OFFICIAL_BADGE` 带 `w-fit`，可点的头像+名称块用 `flex w-fit max-w-full`。长文本靠内层 `truncate` 收窄，不靠父级的拉伸。
- **时间只说数据源里有的**：插件详情页右栏的「最近更新时间」只取索引 `plugins/<id>.json` 的 `updatedAt`（上游 Release 发布时间，`indexUpdatedAt` 解析后按当前语言格式化）；条目没有该字段就不渲染这一行，不用本机安装时间顶替，也不用「—」占位。
- **插件素材可选、缺失不占位**：插件图标取索引 `icon`（市场行、详情页头部、已安装行共用 `PluginAvatar`），加载中或取不到时回落同一 id 的确定性渐变首字母瓷砖；详情页效果图取索引 `screenshots`，空数组整个图集不渲染（`PluginScreenshotCarousel`），单张加载失败只在该槽位显示占位文案。不出现破图，也不用「—」占位。
- **大图预览必须有三条出路**：截图放大层（`PluginScreenshotCarousel` 的 lightbox，走 `ModalShell`）同时支持点空白背景、按 Escape、点右上角 `X`（`fixed right-5 top-5` 的 36px 圆形浮标，`aria-label` / `title` 为「关闭大图」）关闭。背景点击依赖 `ModalShell` 把 `isDismissable` 写在 `ModalOverlay` 上：react-aria 的 `useOverlay` 默认 `isDismissable = false`，`useModalOverlay` 只读 ModalOverlay 的同名属性，写在里层 `Modal` 上会被忽略（开发态有警告），表现为「点空白关不掉」。`X` 锚在视口角而不是图片角：效果图宽高比不定，锚图片要么盖住角落内容，要么随图片漂移。回归：`PluginScreenshotCarousel.test.tsx`。
- **插件面板页签只给图标**：聊天右侧面板页签条（`ChatPanelHeader.tsx`）里，插件页签（registry id 前缀 `plugin:`）只在 `PillTab` 的图标槽渲染 16px 图标，插件自报的 `label` 只作 `title` 与 `aria-label`（指针悬停 / 读屏可见，页签条里不占文字宽）；内建「文件 / 变更」保留图标+文字。插件没注册 `icon` 时回落同一插件素材（manifest 图标经 `plugin_read_artwork` → 市场安装会把索引品牌图按该相对路径落到插件目录，离线可用）→ 确定性渐变首字母瓷砖，与插件市场同一条链（`PluginPanelTabIcon.tsx`）。
- **设置页插件条目用插件自己的品牌图**：设置页导航（`SettingsPage.tsx`）里每个插件 section（registry id 前缀 `plugin:`）的 16px 图标，插件注册了 `icon` 就用它；没注册时回落该插件 manifest 的 `icon`（经 `plugin_read_artwork`，与面板页签、插件市场同一条素材链），只有插件没有品牌素材时才用共用的 `layout-grid` 兜底。这里不画市场同款渐变首字母瓷砖：导航栏其他行的图标都是单色 lucide，彩色瓷砖会喧宾夺主，没有真实素材时中性宫格才是这一列的基调（`PluginSettingsNavIcon.tsx`）。回归：`SettingsPage.test.tsx`。
- **页头文字按钮的两种禁用分开**：插件中心页头（`PluginHub.tsx`）同一种文字按钮分两个禁用语义——「进行中」用 `disabled:cursor-wait`（`HEADER_BUTTON_BUSY`），「前提不满足」用 `disabled:cursor-not-allowed` + `opacity-50`（`HEADER_BUTTON_BLOCKED`），且后者必须给 `title` 说明缺什么（如「创建插件」在没有工作区时不可点）。等待态不能用来表达「你还没准备好前提」。
- **跳转后必须真的给光标**：从插件中心/浏览器/文件切回聊天（「创建插件」「新建会话」）时，输入框要真的获得焦点——中心面用 `.invisible` 切换，隐藏元素上的 `focus()` 会被浏览器静默忽略（fixture 实测：切换到可聚焦要 ~250ms）；统一走 `src/features/chat/focus-composer.ts`，它在时间窗内逐帧重试，并在焦点落到可见输入框时立即停手。**预填草稿的光标由我们自己落位**：草稿恢复会重建 editable 的 DOM，浏览器手里的插入点随之消失，随后 `focus()` 会把光标搁回内容开头；`Composer` 的外部 value 同步（`replaceEditableText`）在重建后把插入点放到文本末尾，用户可直接接着敲需求。回归：`tests/browser/creator-jump.html`（断言输入框内容是预填原文、光标在文本末尾）、`ai-chat-composer.test.tsx`。
- **激活哪一个面，哪一个面就必须真的在视**：中心区同一时刻只有一个面在视（对话 / 文件 / 浏览器 / 插件页签 / 插件中心 / 任务工作台 / 版本更新说明 / 差异），互斥靠各激活入口维护（`ChatCenterPane.centerSurfaces` 只按布尔量判定可见性）。新建会话（侧栏、页签条 `+`、快捷键）、工作区行 `+`、点击会话线程、新建浏览器、打开文件（文件树/搜索/插件桥）以及插件的 `openCenterTab` / `selectSession`，在激活自己的面之前必须清掉其他面（`src/features/chat/center-surfaces.ts` 的 `dismissCenterSurfaces`；文件侧是 `files/store.ts` 的等价清场，先清后设 `activeFilePath`），否则页签条已经高亮到新页签、画面还停在上一个面。回归：`use-chat-sidebar.test.tsx`、`files/store.test.ts`。
- **更新说明页签与浮层提示各管一摊**：更新检查发现新版本时，除右下角浮层提示（`UpdateToast`）外还自动把发布说明开成中心页签（原生单实例，`useReleaseNotesTabStore`，模式同插件中心 / 任务工作台），排在页签条最尾；状态栏版本号按钮与命令面板「查看版本更新说明」（`builtin:openReleaseNotes`）打开的是同一个页签。浮层「稍后」只收起待更新状态与提示，页签里的说明继续可读（`notesRelease` 快照不随 `dismiss` 清空）。页签正文优先渲染更新清单的 `notes`（新版本自带的单语 markdown），没有时回落本地 `CHANGELOG_DATA` 里**同版本**条目（双语排序，markdown 映射就在 `ReleaseNotesPane.tsx` 内），两者都没有时明说「这个版本没有附带更新说明」——不把相邻版本的说明挂在当前版本标题下。页签是最弱的单实例面：自动弹出时不抢已在视的插件中心 / 任务工作台（`centerSurfaces` 的优先级）。
- **更新页签的页头就是更新入口**：发现新版本时给「立即更新」，任何时候都能就地「检查更新」。检查是刷新型动作，走 §4.1 的转圈 → 对号，**检查失败（store 的 error 阶段）不出对号**（`useActionFeedback` 的 `isFailure`）；检查中与下载/安装期间按钮禁用，不重入。结果行与设置页（`UpdateSection`）共用一份文案（`useUpdateDescription`）：检查中是「正在检查更新…」，已是最新给「当前已是最新版本 · 最新版为 vX（日期 发布）」——日期用清单的 `pub_date`，按当前语言格式化，取不到日期就只说版本；失败行用 `role="alert"`，重试就是同一个「检查更新」按钮，不另开第二个按钮。检查更新不是列表重新读取，故不进 [§7](#7-刷新入口清单)。按版本翻页的「版本记录」弹窗与本地历史翻页已随页签上线下线（页签只展示本次发现 / 最新一条）。回归：`ReleaseNotesPane.test.tsx`、`UpdateSection.test.tsx`、`app-status-bar.test.tsx`。
- **升级后首启自动宣布新版本**：应用版本比上次运行真的前进了、且本地 `CHANGELOG_DATA` 里有这个版本的条目时，首启自动把版本更新说明开成中心页签并标记未读（`src/features/update/upgrade-announcement.ts`；上次运行的版本记在 `localStorage` 的 `ccgui-next.lastSeenAppVersion:v1`）。**只在首次升级后展示**：首次安装只写基线不弹（没有可对比的旧版本），版本没变、降级、版本号认不出（预发布后缀之类）、本地没有该版本条目都不弹，且基线照样前进，不会每次启动重来。未读标记是两处：页签条上的强调色圆点（`SessionTab` 的 `unread`，自带可访问名「新版本」）+ 页头版本号旁的「新版本」胶囊；用户关掉页签即视为已读，两处标记一起消失。版本号与正文必须同源——未读标记指向的版本号与本地条目的版本号是同一个（`ReleaseNotesPane` 里 `unreadVersion` 参与版本优先级），不拿最新一条顶替。更新检查发现的待更新版本不写未读标记：那个场景已经有浮层提示与「立即更新」。回归：`upgrade-announcement.test.ts`、`ReleaseNotesPane.test.tsx`、`use-chat-tabs.test.tsx`、`session-tab-strip.test.tsx`。
- **详情页的滚动契约**：`lg` 上右信息栏 sticky 之外还要有高度上限和自己的滚动（`PluginDetailPage.tsx` 的 `RAIL`：`lg:max-h-[calc(100dvh-10.5rem)]` + `lg:overflow-y-auto`）——权限展开后信息栏可以比窗口高，只 sticky 不限高会把它压在视口里，「链接」等末尾行要把左侧 README 滚到底才看得到。左栏 README 的代码块由 `prose-plugin-readme pre`（`src/index.css`）自己横向滚动：单行超长命令在正文列内滚动，不允许画到右信息栏上。
- **插件权限必须自称归属**：插件详情页右栏的权限行标签是「权限（CCGUI权限）」（`plugins.hub.permissionsTitle`）——只写「权限」会被读成电脑系统权限，括号里的归属是必需的，不是可选修饰；中英文同步（`Permissions (CCGUI)`）。该行的 `permissionsEmpty` / `permissionsCount` 与列表项语义不变。不要与聊天输入框的引擎权限模式（`plugins.hub` 之外的 `permissions` / `permissionLabel`）混用同一处修改。
- **「链接」三项各带目标图标**：插件详情页右栏的仓库 / 发布记录 / 问题反馈在文字前各给一个 14px（`size-3.5 shrink-0`）lucide 图标——GitHub 标记（`github`）、发布标签（`tag`）、issue 圆点（`circle-dot`），三个目的地不读文字也能分开；图标 `aria-hidden`，可访问名仍只有链接文字。文字后的 `square-arrow-out-up-right` 保留：图标说明去哪儿，箭头说明会离开应用，两者不互相替代（`ExternalLink`）。回归：`PluginHub.test.tsx` 详情页用例。
- **浮动滚动浮标方向跟随滚轮**：聊天时间线的浮动控件（`ScrollControl.tsx`）只在用户滚轮后出现——向上滚显示「回到顶部」（`ArrowUp` / `chat.backToTop`，点击暂停跟随后平滑滚回顶部），向下滚显示「回到底部」（`ArrowDown` / `chat.backToBottom`，点击恢复跟随并平滑滑向尾部，落定后再硬钉一次吸收动画期间长高的内容）；仅在内容不足一屏、已在底部（距底 100px 内）或滚轮停下 1.5s 后隐藏。`scroll` / `resize` 只负责隐藏、从不主动显示，所以流式钉底不会闪出浮标；平滑滑向尾部的整个过程中自动钉底让位（`use-scroll-follow.ts` 的 `smoothPinRef`），避免中途一次流式刷新把过渡掐断；`prefers-reduced-motion` 下两侧都改为瞬时跳转。
- **可折叠分组标题的箭头尾随标签**：设置页导航（`src/components/application/settings/settings-shell.tsx`）里可折叠分组的标题行是「标签 + 右侧箭头」——箭头只占行尾，标题文字留在与静态分组标题（如「插件」）相同的左侧内边距列上，而不是被头部箭头推进条目图标列；展开只转箭头（`rotate-90`），`aria-expanded` 同步。
- **行内只画「有副本」的引擎**：能力扩展 → Skills 行的引擎同步态只渲染真有副本的引擎图标（`TargetEngines`，`src/features/skills/components.tsx`）：彩色=已同步、右下角红点=副本丢失（orphan，点它即重新同步）；点已同步图标会移除该引擎副本（未纳管技能自己目录里的副本除外，它禁用取消并在 `title` 说明「你自己的本地副本；应用不会删除它」；这个禁用**只改光标与 `title`，不降图标透明度**——半透明图标读起来像副本丢了或渲染坏了，而这里要说的恰恰是「有副本、只是不能在这里删」，透明度只留给进行中的动作）。没有副本的引擎**不占行内位置**——一份技能在 13 个引擎里只剩 1~2 个图标，而不是铺一地淡图标；未安装且无副本的引擎不渲染（后端 `available:false`），但已有副本或副本丢失的引擎必须保留，否则清理路径就消失了。「加一个引擎」在详情面板的「同步到」里做，未纳管技能的「纳管」也只在那里（行内不挂这个按钮：本地技能多的时候列表右侧会排满按钮，而且纳管是低频的一次性动作，不配和同步态图标抢位）。
- **发现页先让人看懂再让人装**：skills.sh 的搜索/热门只返回 name / repo / installs（描述字段后端固定为空串），行主体点开详情（`SkillDiscoverDialog.tsx`）按需调 `remote_skill_content` 回仓库读 `SKILL.md`——列表不预取，几十行 × 两个 GitHub 请求会直接撞限流。详情先给 frontmatter 描述与正文，再看安装按钮；读不到时给「仓库里没有这个技能的 SKILL.md」的说明 + 仓库入口 + 重试，不把后端英文原文当用户文案。id 与仓库目录名不一致时按「同名 / 去掉仓库前缀 / `:` → `-`」对齐（`vercel-react-best-practices` → `skills/react-best-practices`），对不上报 `not_found`，不拿别的技能正文冒充；安装走同一套对齐规则（`resolve_existing_skill_dir`），否则这些条目会死在「SKILL.md not found」。没有描述时行里第二行就是 `owner/repo · 安装数`，不再把仓库重复贴两遍。图标是行按钮的兄弟节点，点它不会顺便打开详情面板；每个按钮带 `aria-pressed`（synced 为 true）与 `title` / `aria-label`（「{{引擎}} 已同步 / 副本丢失 / 无副本」），不把颜色当唯一信息。
- **配置态与运行时态分开表达**：能力扩展 → MCP 页把「配置已启用」（CLI 配置文件里的状态）与「运行时已连接」（某次会话实际加载的服务）拆成两个清单：运行时条目必须带来源会话与采集时间，没有会话 / 引擎不支持查询时用状态文案说明原因，不显示成「没有服务」。配置条目里，不可安全写入的来源只渲染带 `title` 原因的锁图标（`src/features/mcp/McpSection.tsx`），不渲染不可用的开关；开关只对已验证写入语义的来源开放。
- **MCP 页要显式表达「这个 CLI 支不支持」**：引擎选择行列出后端 `ENGINES` 里的全部引擎（含未安装、含不内置 MCP 的），引擎级状态由 `support` 字段给出——`native` 正常展示清单，`plugin` 说明 MCP 由插件提供（dsh 列出 profile 里的 `dsh-mcp-client` 实例），`none` 只给「未内置 MCP」说明、不渲染空清单（`pi` 属于此类，不为它伪造来源）。只读原因用可本地化的原因码（`mcp.readonlyReason.*`，缺失时回落后端字面文案）。清单为空时列出本页读取的来源文件（`sources`，含尚未创建的并标注「尚未创建」），把「没配」与「不支持」分开。引擎支持深链 `#/settings?page=mcp&engine=<id>`（`engineIdFromHash` 从 hash 读取，区块在 Router 外也能渲染）。回归：`McpSection.test.tsx`。
- **引擎选择器与 Skills 同形**：MCP 页的引擎行用与 Skills 相同的 `Chip`（`src/components/base/chips/chip.tsx`，两处共用）+ `EngineIcon`（12px）+ 品牌名，有配置时在名字后跟条数；不用蓝色 PillTab 条——两个「能力扩展」页面的引擎筛选应该长得一样。范围筛选（全部 / 配置 / 运行时）也用同一颗 Chip。
- **`/mcp` 面板与设置页同源**：输入框的 `/mcp` 既是 `/` 选择器里的内置行（`app-commands`；用户自定义同名目录命令优先），也是直接提交的命令；点该行或提交都打开 `McpCommandPanel`，按当前会话引擎列出配置清单与运行时状态。数据与设置页共用同一个 `mcp_inventory` 调用（`useMcpInventory`），两处不存在第二份口径；面板提供刷新（§7 登记）、可写来源的开关、连接检测、条目详情弹窗与「在设置中管理」深链到对应引擎页签（`openMcpSettings`）。引擎不支持 MCP 时面板同样只给说明。回归：`McpCommandPanel.test.tsx`。
- **连接状态由本应用显式检测，打开页面即跑，并带缓存与并行上限**：面板与设置页出现时自动开跑（`useAutoProbe`），但只针对「启用 + 可检测 + 没有新鲜结果」的条目，指纹由「启用条目的 id + 配置哈希」组成，所以重复打开只吃缓存、配置一变只补变了的那几条。检测会按配置真的启动 stdio 服务（`npx` 可能触发下载）或连远程地址，做 `initialize` + `tools/list` 握手后立即结束进程（整组杀，不留孤儿子进程），状态落在行内徽标：已连接（绿色，带工具数）/ 需要登录 / 连接失败（原因在 `title` 与详情里），结果带检测时间（标题行「状态更新于 …」）、耗时、服务名与工具名（`probe-ui.tsx`）。新鲜度窗口 `PROBE_TTL_MS` = 3 分钟（`probe-store.ts`），窗口内自动检测直接复用，工具栏「检测全部」是强制重跑；同时最多 `PROBE_CONCURRENCY` = 4 个在飞（stdio 启动是 I/O 等待，串行太慢，全并行会同时拉起一堆 npx）。本机回环地址不走环境代理（`HTTP_PROXY` 会把 127.0.0.1 请求变成 502）；`${VAR}` / `${VAR:-default}` 按 CLI 习惯展开；返回缺字段的响应不当作已连接（边界校验）。这与运行时分区（CLI 会话自报的连接状态）是两个概念，页面上分开表达。回归：`probe-store.test.ts`、`McpSection.test.tsx`、`McpCommandPanel.test.tsx`。
- **Claude 的用户 / local 来源可以就地启停**：启用/停用写 `~/.claude.json` 的 `projects[<工作区>].disabledMcpServers`（与 Claude Code TUI 的「停用（本项目）」同一把开关，已用 `claude mcp list` 对拍：列表显示 ⊘ Disabled），不往服务定义里塞 `enabled`；没有活动工作区时该来源降级为只读（`mcp.readonlyReason.needs_workspace`）。工作区键优先按原样匹配，再回退 `canonicalize`（Claude Code 用 realpath 作键）。
- **禁用目标不能谎报**：Skills 详情里的目标复选框对只读来源（内置 / 系统 / 插件）禁用并同时给出只读原因文案（`skills.readonly.*`），不用静默过滤把只读来源「藏掉」。移除操作要分开「已删除」与「保留了你自己目录里的副本」（后端 `kept`）：后者不能报成「已移除」，否则刷新后图标还在，自相矛盾。
- **多引擎列表自带滚动，底部动作必须留在框内**：Skills 详情（`SkillDetailDialog.tsx`）的「同步到」最多 13 个引擎，整页内容（描述 / 属性 / 活动情况 / 同步到 / SKILL.md）放在同一个滚动体里，同步列表自己再限高滚动（`max-h-[13rem]`），「从所有 Agent 移除 / 更新 / 关闭」固定在框底——引擎变多不能把底部动作推出可视区。
- **终端路径链接用修饰键点击才唤起文件管理器**：终端输出里的绝对路径（`src/features/terminal/links.ts`）悬停仍有下划线与手型，但普通单击不再直接打开——只有 macOS `⌥`+点击、Windows/Linux `Ctrl`+点击才 reveal（`holdsRevealModifier` 从 xterm 传来的 `MouseEvent` 取修饰键；非 mac 选 Ctrl 与 Windows Terminal / GNOME Terminal 的开链习惯一致）。理由是选中文本、点回窗口很容易碰到链接，无修饰直接唤起访达的干扰太大。macOS 同时把 xterm 的 `altClickMovesCursor` 关掉（`TerminalView.tsx`）：同一个 `⌥`+点击否则还会把 shell 光标挪到点击处；Windows/Linux 保留该功能（那里的 reveal 手势是 Ctrl）。右键菜单里的「在访达中显示」不受影响——显式动作不需要修饰键。回归：`links.test.ts` 的修饰键用例。
- **分支选择器列远程分支并标「远程分支」**：变更面板与状态栏的分支列表（同一份 `git_branches` 数据）在本地分支之后列出 remote-tracking 分支（`origin/x`），行尾挂中性徽标「远程分支」（`git.remoteBranch`）——刚 fetch 到、本地尚无同名分支的远程分支必须可搜可切，与 VSCode / CLI 一致。选择远程分支不直接进入 detached HEAD：后端物化为同名本地跟踪分支（已存在则切到它，绝不以远程 tip 覆盖本地提交）；`origin/HEAD` 这类符号引用不进列表。列表仍按「本地在前、远程在后」分组，搜索仍是子串匹配。回归：`git.rs` 的 `branches_list_*` / `checkout_remote_branch_*` 用例、`ChangesPanelHeader.test.tsx`。
- **Worktree = 侧栏子工作区**：workspaces 表以 `kind="worktree"` + `parentId` 表达子工作区（`worktreeMetaOf()` 从 `meta.worktree` 读分支/PR 元数据），侧栏把它挂到父仓库行的「WORKTREES · n」分组内（`repo-tree.tsx` 的 `WorktreeGroup`）：子行主名是分支名（目录名进 tooltip），可展开各自的会话线程（展开态复用侧栏持久化展开集），分组整体也可折叠（折叠集存在 worktree store 的 localStorage）。分组与子行两层的展开/收起都走 [§2.4](#24-展开--收起动效) 的 `SidebarDisclosure` 高度动画。行内徽标：「PR#n」（仅从 PR 创建时，`status-purple-*`）。父行不可见（已归档/已移除）时子行降级为普通顶层行，不丢入口；子行悬停出现 ＋（`chat.newSession`），直接在该 worktree 目录下开新会话（复用工作区行的 `onNewSessionInWorkspace` 链路）。分组只在有子项或有进行中创建时渲染，首个创建入口在工作区右键菜单「新建 Worktree…」；创建对话框三来源 Chip 顺序为「新分支（默认）/ 已有分支 / 从 PR 创建」。「新分支」的默认 base 是父工作区当前检出分支（取自 git store 的实时 status，不用会过期的列表标记，`defaultBaseRef()` 是唯一规则来源）——分支从手头这份工作接着往下开，与裸 `git worktree add -b` 取 HEAD 一致；当前分支是 main/master 时改用远程同名分支（本地 main 可能落后，远程 base 后端会先 fetch），detached HEAD 或该分支已不存在时落回「origin/main → origin/master → main → master → 任意远程 → 首个分支」的兜底顺序，用户手选后不再被晚到的 status 改写。回归：`WorktreeCreateDialog.test.tsx` 的默认 base 用例与 `pr-input.test.ts` 的 `defaultBaseRef` 用例、`use-chat-sidebar.test.tsx` 的挂载/降级用例、`ai-chat-sidebar.test.tsx` 的子行 ＋ 与分组折叠用例、`tests/browser/sidebar-collapse.html`。
- **Worktree 目录丢失与锁定要明说**：后端 `git_worktree_list` 解析 porcelain 的 `prunable` / `locked` 属性。`prunable`（目录已从磁盘消失）的子行渲染「目录已丢失」徽标（`status-rose-*`，原因进 `title`）；`locked` 的 worktree 在右键菜单里「删除 Worktree…」禁用并给出原因（对齐「禁用目标不能谎报」），删除对话框打开时同样复检。回归：`git_worktree.rs` 的 porcelain 用例。

## 4. 动作反馈

- **大型过程组有界展示**：`ProcessDisclosure` 每页最多 40 条思考/工具条目，默认展示最新页；「上一页 / 下一页 / 回到最新」保留全部历史可访问。用户翻到旧页后，新增工具不抢回最新页；对话内搜索命中隐藏条目时展开过程并定位到对应页。大组或批量入场取消 blur/height/mask 动画，不裁剪思考或工具原文。
- **性能诊断入口**：底部状态栏「性能」与设置「其他 → 性能诊断」页的「查看性能诊断」按钮打开同一个弹窗（该页已从「社区与反馈」页移出，含说明与打开按钮）。默认开启，提供「自动性能诊断」开关并持久保存选择；关闭停止前端与原生采样、清空记录和预览，重新开启从新窗口开始。关闭前提示先导出需保留的证据；保存失败保留原状态并显示错误。前端与原生各保留最近 **5 分钟、最多 60 条**，记录仍仅在内存，重启清空。默认只读预览与「复制诊断摘要」使用不超过 **12,000 UTF-8 字节**的结构化摘要（峰值、前五进程、峰值附近采样与最严重阻塞附近采样）；「导出完整诊断文件」保留当前快照的全部数据，以紧凑 JSON 保存，不拼接旧报告。桌面选择保存路径，取消不提示成功，写入失败提示重试；Web 发起下载后仅提示已发起，不假称落盘成功。按钮生成前/操作中禁用，窄屏允许换行。保留隐私、单核与整机 CPU 区别及 WebKit 候选归属说明；原生不可用仍可复制前端摘要；剪贴板拒绝显示 `role="alert"` 并保留手动选择文本。弹窗使用 `ModalShell`、标准按钮与可滚动内容区，不新增刷新入口。
- **渲染性能面板（react-scan）**：设置 → 其他 → 性能诊断页内的独立开关，**默认关闭**，手动开启后即时生效并持久化。打包（生产）版只提供重渲染高亮与次数，不含单次渲染耗时（开发版 `pnpm dev` 才有）。react-scan 必须在 React/react-dom 首次导入前接管 instrumentation，因此入口 `src/main.tsx` 只做启动编排：先装轻量 devtools hook，再按开关决定是否加载 overlay，应用体经动态导入的 `src/bootstrap.tsx` 加载；`src/lib/react-scan.ts` 只在开关开启时拉取 react-scan 本体 chunk（未开启时只多取几 KB 的 hook chunk，开关无需重启即生效）。

异步动作必须让用户看到三件事：**正在进行**、**成功**、**失败**。失败要么有对号以外的显式反馈（错误文案 / 状态标记），要么保持原样不误导。

### 4.1 刷新 / 重新加载：转圈 → 对号

参考实现：变更面板的刷新按钮（`src/features/git/ChangesPanelHeader.tsx`），公共实现：`src/components/base/action-feedback.tsx`。

规则：

1. **进行中**：动作图标转圈，动画用 `animate-refresh-spin`（`--animate-refresh-spin`，0.6s 一圈，linear infinite）。不要用 `animate-spin` 表达刷新反馈，也不要自定第二条时长。
2. **成功**：图标交叉淡出、绿色对号淡入 —— 对号色为 `text-notification-success-foreground`，停留 **900ms** 后淡回原图标。
3. **失败**：**不出现对号**，直接复位到原图标。
4. **至少转满一圈**：动作结束时若当前这圈没转完，等它转完再换对号（图标落回正方向，不会"歪着头"顶着对号）。这就是 `spin: true` 的含义。
5. **纯视觉反馈**：反馈容器 `aria-hidden`，按钮的 `aria-label` / `title` 保持动作名不变——刷新是否有新数据由界面本身说明，不需要播报。

接入方式（按动作有没有现成的 busy 状态选）：

| 场景 | API | 说明 |
|---|---|---|
| 动作返回 Promise，点击即发起 | `useActionFeedback({ spin: true })` → `start(action, isFailure?)` | `start` 会原样返回/抛出动作结果，接回调用方既有的错误链路；非抛错型动作（把失败写进 store）用 `isFailure` 报告失败 |
| 已有 store / props 的 in-flight 标志，或动作由别处触发 | `useRunningFeedback(running)` | 标志为 true 时转圈，落回 false 时给对号 |

```tsx
// 点击驱动
const refreshAction = useActionFeedback({ spin: true });
<button
  disabled={refreshAction.feedback === "running"}
  onClick={() =>
    void refreshAction.start(() => store.refresh(force), () => store.getState().error != null)
  }
>
  <ActionFeedbackIcon icon={RefreshCw} feedback={refreshAction.feedback} spin />
</button>

// 状态驱动
const feedback = useRunningFeedback(store.loading);
<ActionFeedbackIcon icon={RefreshCw} feedback={feedback} spin />
```

补充参数：图标不是 16px 时传 `iconClassName`（`size-3` / `size-3.5` / `size-[18px]`），需要忙碌态变色时传 `runningClassName`（如用量卡片的 `text-blue-500`）。

**不要这样做**：

- 自己写 `animate-spin` / 自定义时长 / 另一种成功表达（绿字、toast、换图标颜色）。
- 把**进度**当**刷新**：插件安装、文件上传这类有明确百分比的过程用 `Loader2` 进度语言，不用转圈+对号。
- **纯文本按钮套反馈**：报错态里的文字型"刷新"（`FileTreeBody`、`EditorPane`）保持文本形态，见 [§8](#8-待收敛)。
- 成功后按钮会立刻消失的场景硬凑对号（如插件"重新加载"成功后整行转为健康态）——按规则写，但不要为了看对号拖住状态更新。
- 与刷新无关的图标（更换密钥、重置、重发）借这套反馈。它们的语义是"变更/复位"，不是"重新读取"。

例外：变更面板的 **pull / push** 只用 `ActionFeedbackIcon`（不传 `spin`），即"点击 → 对号"——云朵图标转圈读起来像故障，不像进度。这类"一次性提交型动作"允许省略转圈，但成功/失败规则同上。

### 4.2 复制到剪贴板：Copy → Check

- 用 `src/hooks/use-copied.ts` 的 `useCopied(resetMs = COPY_FEEDBACK_MS)`，成功后图标换成 `Check`，**1500ms** 后复位。性能诊断需要显式处理复制失败，使用同一 `COPY_FEEDBACK_MS` 常量，成功反馈与卸载清理语义保持一致。
- 与刷新反馈的差异：复制没有别的成功信号，所以**可访问名一起改成"已复制"**（`aria-label` / `title`），刷新反馈则不改名。这是刻意的差别，不要强行统一。
- 复制按钮旁边有明文内容时（如密钥框），保留原布局尺寸与分隔符，只换图标。

### 4.3 桌面宠物（pet overlay）

- 窗口形态：独立透明置顶窗口（`src-tauri/src/pet_overlay.rs`），无边框、不进任务栏；仅宠物图像矩形接收点击（左键拖动＝`data-tauri-drag-region`，右键循环 50%/75%/100%/125%/150% 五档缩放并立即持久化；精灵为真实按钮，键盘 Enter/Space 与右键同效，焦点环走 `focus-visible`），状态气泡与其余透明区域保持鼠标穿透，不遮挡桌面操作。
- 状态气泡（`src/index.css` `.pet-bubble`）：有活动状态时显现，显隐动效 opacity 160ms / transform 180ms（`cubic-bezier(0.23, 1, 0.32, 1)`）+ blur 消退；`prefers-reduced-motion` 下仅保留 opacity 180ms，无位移与模糊。气泡为玻璃拟态（backdrop blur + 内高光），文本两行截断（会话名 + 状态）；状态文案走 `settings.petActivity*`，`aria-live="polite"`，无活动时 `aria-hidden`。
- 位置与尺寸记忆：拖动结束保存位置、缩放即时生效并持久化；恢复位置前校验仍在已连接显示器内，落出所有屏幕则用默认位置。宠物设置（开关/角色/导入/移除/尺寸）在设置「常规」分组；移除走 `ConfirmDialog`（danger），导入失败等后端稳定错误码经 `petErrorMessage` 映射为本地化文案。
- 多会话状态：气泡在并发会话间每 1.8s 轮播，刚完成的会话短暂展示「已完成」；失败/等待优先于运行中展示。

## 5. 加载、空状态与错误

- 整块区域加载：`CenteredSpinner`；有内容但空：`EmptyState`（都来自 `src/components/base/empty-state.tsx`）。列表局部加载用行内文字或 `Loader2`，不要动辄整屏转圈。
- 行内错误：`role="alert"` 容器 + `text-text-error-primary` 文案 + 明确的下一步（重试 / 关闭）。
- 警告与失败要区分：可恢复的失败给重试入口，不可恢复的（未安装、平台不支持）给说明或跳转，不给假按钮。
- **远程桥刻意拒绝的命令不给假按钮**：被 `src-tauri/src/web/dispatch.rs` 明确排除的远程命令（如目录授权 `grant_root`，注释写明远端不得扩大文件系统授权范围），对应入口在 `isWeb` 下不渲染按钮、不显示“将授权…”预览，改为原因说明并只保留拒绝（`GrantCard.tsx`、`chat.grantWebUnavailable`）；桌面端保持完整动作。
- 进度类反馈（安装、更新、同步）用 `Loader2` / 文字百分比表达过程，与 [§4.1](#41-刷新--重新加载转圈--对号) 的刷新反馈互不替代。
- **Worktree 创建进度行三态**：创建对话框即交即走，进度在侧栏「WORKTREES」分组顶部的进度行表达（`WorktreeProgressRow.tsx`，事件 `worktree://create-progress` 驱动）——进行中：`Loader2` + 阶段文案（校验 / fetch / 创建 / 注册，逐段替换）+ ✕ 取消（取消杀进程组、半成品 worktree 清理、已建分支保留）；成功：行消失、worktree 子行出现（勾选了「创建后打开新会话」则先清场再在该目录开新会话）；失败/已取消：行保留为 `role="alert"`（失败原因按后端 `errorKind` 本地化分类：网络/fetch 失败给重试，分支或目录冲突给改名指引，非 git 仓库/PR 不存在给说明，稀疏检出规则排除全部文件（`sparse_checkout_empty`）给修复指引），行内「重试 / 关闭」。三态行高一致，状态切换不推动其他行。
- **崩溃绝不留白屏**：应用崩溃时必须显示可读原因，而不是纯白窗口。三层兜底：`index.html` 的启动占位 + 8s watchdog（bundle 加载失败或 React 挂载前崩溃时显示失败面板与重载，原因读 `localStorage` 的 `ccgui:last-crash`）；`src/lib/crash.ts` 的 `error` / `unhandledrejection` 全局捕获；`src/components/crash/AppCrashBoundary.tsx` 顶层 React 错误边界。渲染崩溃页（`CrashScreen`）必须给出**具体错误原因**、可展开的技术详情、`重新加载` / `复制错误信息` / `退出应用`（Web 不渲染退出）；非渲染的全局错误允许「继续使用」后关闭。崩溃报告仅本地留存（内存环形 + `localStorage` 最近一条），不自动上传。
- **启动层资源必须是外部文件，`index.html` 里不得写内联 `<style>` / `<script>`**：打包链会给 `index.html` 里的每个内联标签打上 `__TAURI_*_NONCE__`，运行时把 nonce 追加进 `style-src` / `script-src`（`tauri-codegen` 的 `inject_nonce_token` + `tauri replace_csp_nonce`）；同一指令一旦出现 nonce，`'unsafe-inline'` 即被忽略，浏览器会拒绝**所有运行时创建的样式表**——插件的 `styles.css` 与 `ctx.theme.injectCss` 正是这样注入的，于是 v1.0.9 打包版静默丢掉全部插件样式，插件继续运行、无报错、不隔离（`plugin_list` 里 `lastError` 仍为 null），只有开发版看不出来（`pnpm dev` 的 HTML 不含 token，CSP 里没有 nonce）。样式在 `public/boot.css`、脚本在 `public/boot-watchdog.js`，两者都由 `style-src 'self'` / `script-src 'self'` 放行；回归：`tests/platform-build.test.ts`。

## 6. 破坏性操作

- 不可逆操作（删除、卸载、丢弃改动、断开授权）先确认：`ConfirmDialog`（`src/components/dialogs.tsx`），危险确认按钮用 `variant="danger"`。
- 由指针发起的行内破坏性操作可以用 `ConfirmPopover`，让确认贴近光标。
- 文案写清**后果对象**（删的是哪个文件/会话/插件），不写"确定吗？"。
- **退出应用**：窗口关闭按钮一律先确认（`src/lib/close-confirm.ts` 拦截 `CloseRequested`）；macOS 的 ⌘Q / 系统退出请求在存在进行中的会话时会被 `src-tauri/src/quit_guard.rs` 取消并复用同一弹窗，只有显式确认才销毁窗口退出，空闲时正常退出、不拦截。
- **删除 Worktree 分级确认**：`DeleteWorktreeDialog` 打开时预检 `git status`（未提交文件数 + 前两个文件名、未推送提交数）与 `git_branch_merged`（分支是否合入 base；同 tip 算已合入，squash 合入可能误报为未合入，文案如实说明），三项全干净只显示「没有未提交或未推送的改动」；有流式会话或活着的终端页签时额外提示。「同时删除本地分支」默认不勾（保留在仓库里），勾选后危险按钮文案升级为「删除 Worktree 和分支」；确认即关对话框，`git worktree remove --force` 后台执行（孤儿目录回落 `prune` + 提示手动清理，分支 `branch -d` 失败再 `-D` 仅显式勾选时），非致命尾巴（目录没删掉 / 分支被占用保留）走 `actionError` 横幅告知。会话历史保存在引擎侧，重新注册该目录会重新出现；侧栏登记在删除成功后移除。回归：`DeleteWorktreeDialog.test.tsx`。
- **父工作区移除/归档带级联提示**：移除或归档含 worktree 子项的父工作区时，`ConfirmDialog` 列出受影响分支再确认（移除：先移除子项登记再移除父行，磁盘目录不动；归档：一并归档）。要连目录删必须逐个走「删除 Worktree…」流程，父行移除不做目录级联。

## 7. 刷新入口清单

全项目的"重新读取"入口都登记在这里；新增一个入口就该在这里多一行。

| 入口 | 文件 | 反馈接入 | 备注 |
|---|---|---|---|
| 变更（git）刷新 | `src/features/git/ChangesPanelHeader.tsx` | `useActionFeedback({ spin: true })` | **参考实现**；pull/push 只做 click → 对号 |
| 文件树刷新 | `src/features/files/FileTreeRow.tsx` | `useRunningFeedback(filesStore.refreshing)` | 入口在工作区根行（合成根节点），随该行悬停出现（同该行「添加到聊天」加号）；刷新可能由别处触发，故走状态驱动 |
| 插件市场索引 | `src/features/plugins/hub/PluginMarketView.tsx` | `useActionFeedback` | 图标按钮位于筛选工具条（分类 chips + 排序 + 搜索）右侧；`isFailure` 读 `marketplaceStore.error` |
| 插件重新加载 | `src/features/plugins/hub/PluginInstalledRow.tsx` | `useActionFeedback` | 成功后该行转为健康态、按钮消失 |
| CLI 版本信息 | `src/features/settings/CliHeaderActions.tsx` | `useRunningFeedback(loading \|\| updating)` | 挂载时的自动探测同样转圈 → 对号 |
| 刷新用量 | `src/components/application/agent-limits/agent-limits-card.tsx` | `useRunningFeedback(refreshing)` | 带文字标签的卡片按钮，图标区放反馈 |
| 模型目录 | `src/components/application/ai-chat/engine-model-panel.tsx` | `useActionFeedback` | — |
| 浏览器刷新 | `src/features/browser/BrowserPane.tsx` | `useActionFeedback` | webview 无加载完成事件，对号 = 指令已下发 |
| 状态栏「立即同步」 | `src/components/application/app-status-bar/app-status-bar.tsx` | `useRunningFeedback(syncing)` | 进度由 `scan://progress` 事件驱动 |
| Skills 刷新 | `src/features/skills/InstalledPane.tsx` | `useActionFeedback({ spin: true })` | 一次动作同时重读已安装列表与更新信号；失败走行内 `role="alert"` |
| MCP 刷新 | `src/features/mcp/McpSection.tsx` | `useActionFeedback({ spin: true })` | 重读配置清单与运行时分区；写入成功后也会自动重读 |
| `/mcp` 面板刷新 | `src/features/mcp/McpCommandPanel.tsx` | `useActionFeedback({ spin: true })` | 与设置页同一份 `mcp_inventory` 数据；写入成功后自动重读 |
| MCP 连接检测 | `src/features/mcp/McpSection.tsx`、`McpCommandPanel.tsx` | 行内状态徽标（`probe-ui.tsx`，检测中转圈） | 打开页面自动跑（复用 3 分钟内的结果），「检测全部」强制重跑；最多 4 个并行 |
| 报错态「刷新」 | `src/features/files/FileTreeBody.tsx`、`src/features/files/EditorPane.tsx` | **不加反馈** | 纯文本恢复入口，见 §8 |
| Worktree 状态采集 | `src/components/application/ai-chat/repo-tree.tsx`（`WorktreeGroup`） | **不加反馈** | 展开「WORKTREES」分组时后台刷一次 git status（复用 git store 30s TTL）与 `git_worktree_list`（locked/prunable），没有用户发起的「刷新」按钮；徽标随状态自然更新 |
| 更换密钥 | `src/features/settings/WebAuthCard.tsx` | **不加反馈** | 语义是"轮换"不是"刷新" |
| 接力引擎列表 | `ccgui-plugin/ccgui-plugin-plan-execute-relay/main.js` | 异步动作期间禁用，失败行内告警 | 独立 ESM 插件的文本动作；不导入宿主私有反馈 hook。刷新仅重读可用引擎、渠道名和模型，不触发模型请求 |

注：Worktree **创建进度行不登记**在本清单——它不是「重新读取」入口，而是一次性任务的状态表达（进行中 → 成功/失败），用 §5 的进度语言（`Loader2` + 阶段文案），不存在「再刷一次」的语义；其失败行的「重试」是重新执行创建动作，同样不是刷新。

## 8. 待收敛

按"出现第二次同类问题就动手"的节奏处理，处理完把条目移出本节并写进正文。

- **`prefers-reduced-motion` 下的关键帧动画**：`ActionFeedbackIcon` 的转圈、`CenteredSpinner` 与各处 `Loader2` 目前仍会转动（过渡类已有 `motion-reduce:transition-none`）。目标：关键帧动画加 `motion-reduce:animate-none`，忙碌语义改由 disabled 态 + 文案承担。
- **两个纯文本"刷新"**（`FileTreeBody` 根目录报错、`EditorPane` 文件读不到）：要么补成图标+反馈（需要先给它们合适的按钮容器），要么确认为刻意的文本形态。目前按"不加反馈"登记在 §7。
- **反馈时长常量分散**：刷新时长在 `src/components/base/action-feedback.tsx`（600 / 900ms），复制在 `src/hooks/use-copied.ts`（1500ms）。如果出现第三处，抽成统一的动效常量，并回到本文登记。

---

## 变更记录

| 版本 | 时间 | 内容 |
|---|---|---|
| v0.53 | 2026-09-25 | 新增 MiniMax Code CLI（命令 `mcode`）引擎：聊天引擎下拉与设置 CLI 管理按既有数据驱动形态自动出现，引擎图标采用随 app 分发的蓝色徽章（.icns 转 PNG），模型厂商推断沿用原扁平标志；权限问答走 ACP `session/request_permission` 问题卡（同 grok/kimi 形态）；MCP 页如实标注不支持（不伪造 native 空来源）；渠道/技能同步暂不接入 |
| v0.52 | 2026-09-24 | 设置「电脑操控」移除拖拽授权引导：删掉“重启生效 / 把图标拖进授权列表”提示与可拖拽 App 图标，macOS 授权只保留「打开系统设置」深链（`computer_use_open_permission_settings`）；同步删除 `computer_use_drag_source` 命令、`tauri-plugin-drag` 依赖与 `drag:default` 权限；§3 更新权限行规则 |
| v0.51 | 2026-09-24 | AskUserQuestion 多题卡片：单选自动前进、多选逐题确认与单选/多选样式区分 |
| v0.50 | 2026-09-23 | 桌面宠物（§4.3）：透明置顶宠物窗口的点击穿透/拖动/右键缩放交互、状态气泡动效时长、位置与尺寸记忆、多会话轮播；移除宠物改用 `ConfirmDialog`（danger），后端宠物错误码本地化 |
| v0.49 | 2026-09-23 | Worktree 展开/收起补齐动效：「WORKTREES · n」分组原来是条件渲染、点击即闪现，现抽出 `SidebarDisclosure`（grid-rows 1fr⇄0fr、300ms、收起动画结束才卸载、`inert` + `aria-hidden`）供分组与线程列表共用，子行维持同一实现；新增浏览器 fixture 逐帧采样（`sidebar-collapse.html`）与 jsdom 卸载时序用例；新增 §2.4 展开/收起动效规则 |
| v0.48 | 2026-09-23 | 修复打包版插件样式全丢：启动占位样式从 `index.html` 内联 `<style>` 移入 `public/boot.css` 外部文件（Tauri 会给内联标签加 nonce，nonce 让 `'unsafe-inline'` 失效，运行时注入的插件样式表全被拒）；`tests/platform-build.test.ts` 增加守卫（index.html 无内联 style/script + style-src 保留 'unsafe-inline'）；§5 补充规则 |
| v0.47 | 2026-09-23 | Git worktree 子工作区全链路：workspaces 表恢复 kind/parentId 先例并迁移旧版导入；侧栏「WORKTREES · n」分组挂载子行（分支名 + PR 徽标 + 脏文件数，locked/prunable 明说）；三来源创建对话框（从 PR / 新分支 / 已有分支，PR 解析走 `pull/N/head` 不依赖 GitHub 登录，gh CLI 仅增强）即交即走 + 进度行三态可取消可重试；删除分级确认（未提交/未推送/未合入预检、默认保留分支、后台直接删）与父行移除/归档级联提示；§3、§5、§6、§7 同步 |
| v0.46 | 2026-09-23 | 崩溃不再白屏：新增三层兜底（启动 watchdog + 全局 error/unhandledrejection 捕获 + 顶层 ErrorBoundary）与 `CrashScreen` 全屏错误页，显示具体原因、可展开技术详情与重新加载/复制/退出动作；崩溃报告本地留存供反馈；§5 补充规则 |
| v0.45 | 2026-09-23 | 新增设置「电脑操控」页与 `/ccgui-cua <任务>` 指令（内置指令组）：指令只为该次发送挂载截图/输入驱动，引擎不支持时明确拒绝而非静默降级；权限行读真实系统状态并给拖拽授权入口；虚拟光标由 App 全程强制显示，模型无法关闭；全局 Esc 急停仅在电脑操控回合期间武装；§3 补四条规则 |
| v0.44 | 2026-09-23 | 升级后首启自动打开版本更新页签并标「新版本」：上次运行版本记在 `localStorage`，首次安装 / 版本没变 / 降级 / 本地没有该版本条目都不弹；标记 = 页签强调色圆点 + 页头胶囊，关掉页签即已读；§3 补充规则 |
| v0.43 | 2026-09-23 | 分支选择器列出远程跟踪分支（本地在前、远程在后，行尾「远程分支」徽标，跳过 `origin/HEAD`）：刚 fetch 的分支可搜可切；选择远程分支物化为同名本地跟踪分支（已存在则切换，不覆盖本地提交）；§3 补充规则 |
| v0.42 | 2026-09-23 | MCP 连接检测改为打开页面即自动跑（只补没有新鲜结果的条目，3 分钟窗口内复用缓存，配置一变成指纹自动只补变化项），手动「检测全部」为强制重跑；检测改为最多 4 个并行（原先串行）；标题行显示「状态更新于 …」；§3 与 §7 同步 |
| v0.41 | 2026-09-23 | MCP 页引擎选择器改为与 Skills 同形的 Chip + 品牌图标（共用 `Chip`）；新增「连接检测」——显式按配置启动/连接并握手，行内给已连接/需要登录/连接失败状态（与 CLI 会话上报的运行时分区分开），本机地址绕开环境代理；Claude 用户级与 local 来源可就地启停（写 `.claude.json` 的 `projects[<ws>].disabledMcpServers`，已与 `claude mcp list` 对拍）；§3 补五条规则、§7 登记检测入口 |
| v0.40 | 2026-09-23 | MCP 覆盖全部已接入 CLI：新增 Kimi / Grok / OMP / OpenCode / Antigravity / Qoder（含 CN）/ dsh 来源，PI 显式标注不内置 MCP；grok、opencode 开放启停（本机 CLI 验证过语义），其余来源只读并给可本地化的原因码；清单为空时列出本页读取的来源文件，页签支持引擎深链；输入框 `/mcp`（选择器点击或提交）弹出当前引擎的 MCP 面板，与设置页共用同一份数据；§3 补两条规则、§7 登记面板刷新 |
| v0.39 | 2026-09-23 | 终端路径链接改为修饰键点击才唤起文件管理器：macOS `⌥`+点击、Windows/Linux `Ctrl`+点击，普通单击不再直接触发；macOS 同步关闭 xterm 的 `altClickMovesCursor` 让出该手势，Windows/Linux 保留；§3 补充规则 |
| v0.38 | 2026-09-23 | Skills 发现页可看详情：行主体点开弹窗，按需回仓库读 `SKILL.md`（描述 + 正文 + 安装），读不到时说人话并给仓库入口；skills.sh 的 id 与仓库目录名按「同名 / 去仓库前缀 / `:`→`-`」对齐，安装与详情同一套规则（修掉 vercel-labs 这类条目的 `SKILL.md not found`）；§3 补充规则 |
| v0.37 | 2026-09-23 | Skills 行内不再挂「纳管」按钮：本地技能的纳管入口只在详情面板（勾选「同步到」的引擎同样会触发纳管），行内只剩引擎同步态与可选的「更新」；§3 补充规则 |
| v0.36 | 2026-09-23 | Skills 行内引擎图标：自有本地副本的禁用态不再给图标降透明度（只用 `cursor-not-allowed` 与 `title` 表达不可点），避免读成副本丢失/渲染坏了；§3 补充规则 |
| v0.35 | 2026-09-23 | 新版本说明改为中心页签：发现更新时自动打开并排在页签条最尾，正文优先用更新清单 `notes`、否则回落本地同版本条目；浮层「稍后」不再影响页签内容；状态栏版本号改开该页签，页头提供「立即更新」与「检查更新」（刷新型反馈 + 与设置页共用的结果行，含「已是最新版本 · 最新版 vX（日期）」），按版本翻页的版本记录弹窗随之下线；§3 补充两条规则 |
| v0.34 | 2026-09-23 | Skills 支持全部已接入 CLI（Claude / Codex / Kimi / Grok / PI / OMP / DeepSeek / Antigravity / Gemini / OpenCode / Qoder / Qoder CN / Hermes + 隐藏的 agents）：行内同步态改为可点的引擎图标（三态 + 只画有副本的引擎 + 自有本地副本不可取消），详情页加「活动情况」与「同步到」图标列表并固定底部「从所有 Agent 移除」，多引擎列表限高滚动；§3 同步规则 |
| v0.33 | 2026-09-23 | 增加聊天内插件会话模式与接力首版：显式确认最新版、多轮规划、停止与恢复、退出锁；登记插件引擎列表刷新入口 |
| v0.32 | 2026-09-23 | 性能诊断页新增「渲染性能面板（react-scan）」开关：默认关闭、即时生效并持久化，打包版仅高亮与次数；入口先装 devtools hook 再动态加载 bootstrap/overlay；§4 同步 |
| v0.31 | 2026-09-23 | 性能诊断从「社区与反馈」页移出，改为设置「其他」分组下的独立页面（说明 + 「查看性能诊断」按钮），不影响状态栏入口与弹窗行为；§4 同步 |
| v0.30 | 2026-09-23 | 诊断统一五分钟/60 条；默认复制限长摘要、完整 JSON 文件导出；默认开启、持久化开关及关闭清理语义 |
| v0.29 | 2026-09-23 | 大型过程组每页 40 条及搜索定位；状态栏与社区反馈加入本地性能诊断入口，规定隐私、采样限制、复制失败提示，复制时长复用 COPY_FEEDBACK_MS |
| v0.28 | 2026-09-23 | 新增设置「能力扩展」分组的 UI 约定：Skills 的引擎同步圆点带可访问名；MCP 把配置态与运行时态拆开、只读来源用带原因的锁而不是假开关；§7 登记 Skills / MCP 刷新入口 |
| v0.27 | 2026-09-23 | 修复「新建会话/点击会话后中心面不跳转」：新建会话（侧栏、页签条 +、快捷键）、工作区行 +、点击会话线程、新建浏览器、打开文件与插件 `openCenterTab`/`selectSession` 统一先清掉其他中心面（`center-surfaces.ts`），页签高亮与画面一致；§3 补充规则 |
| v0.26 | 2026-09-23 | 设置页导航插件条目改用插件真实品牌图：`icon` → manifest 素材（`plugin_read_artwork`）→ `layout-grid` 兜底；§2.2 与 §3 同步规则 |
| v0.25 | 2026-09 | 设置页导航可折叠分组标题改为「标签 + 尾随箭头」，标题文字与静态分组标题同一左列对齐；§3 补充规则 |
| v0.24 | 2026-09 | 插件详情页右栏「权限」改称「权限（CCGUI权限）」（英文 `Permissions (CCGUI)`），避免被读成电脑系统权限；§3 补充规则 |
| v0.23 | 2026-09 | 插件详情页右栏「链接」三项各加目标图标（GitHub 标记 / 发布标签 / issue 圆点，14px、`aria-hidden`），外部跳转箭头保留；§3 补充规则 |
| v0.22 | 2026-09 | 截图大图预览补右上角 `X`，并修好空白背景点击关闭（`ModalShell` 的 `isDismissable` 从里层 `Modal` 移到 `ModalOverlay`，整个 shell 的弹窗都受益）；§3 补充规则 |
| v0.21 | 2026-09 | 官方插件徽标整块可点，跳转品牌账号 `zhukunpenglinyutong`（`title` 报出目标主页）；徽标加 `w-fit`，不再被右栏 flex 列拉伸成整行色块；§3 补充规则 |
| v0.20 | 2026-09 | 市场安装按 manifest 的 `icon` 把索引品牌图落地到插件目录（Release 三件套不含 `docs/` 素材），插件页签的素材回退在离线时也能显示品牌图；§3 补充规则 |
| v0.19 | 2026-09 | 官方插件开发者列只显示紫色「CCGUI官方插件」徽标（不再展示账号头像/用户名，详情页右栏同规则）；下拉选项改为 CCGUI官方插件 / 社区插件 |
| v0.18 | 2026-09 | 插件市场官方插件在开发者列与详情页右栏标记紫色「官方」徽标（`isOfficialPlugin`）；排序下拉改为综合排序 / 官方 / 第三方 / 下载量，官方与第三方同时收窄列表；§3 补充规则 |
| v0.17 | 2026-09 | 对话浮动滚动控件按滚轮方向切换「回到顶部 / 回到底部」箭头，点击两侧均平滑滚动（回底落定后再硬钉吸收长高内容），仅滚轮触发显示、回底或空闲 1.5s 隐藏，reduced-motion 下瞬时跳转；§3 补充规则 |
| v0.16 | 2026-09 | 聊天右侧面板插件页签改为只显示图标（`label` 转为 `title` / 可访问名，无图标回落插件素材 → 首字母瓷砖），内建文件/变更保留图标+文字；§3 补充规则 |
| v0.15 | 2026-09 | 远程 web 端目录授权卡不再渲染「允许访问」（web 桥刻意不路由 `grant_root`），改为原因说明 + 拒绝；§5 补充规则 |
| v0.14 | 2026-09 | 撤销斜杠指令 chip：输入框、已发送气泡、排队行一律按原文渲染 `/name`（删 `command-chip` / `command-token` / `command-label` / `command-chip-policy` 及其样式、fixture、i18n 文案）；保留「跳转后真的给光标」与「草稿恢复光标落文本末尾」；§3 移除 chip 规则 |
| v0.13 | 2026-09 | 插件详情页右栏「开发者」可点击跳转 GitHub 主页（仅当能解析出 GitHub 账号，否则保持纯文本）；§3 补充规则 |
| v0.11 | 2026-09 | 草稿恢复（「创建插件」预填命令）后光标落在文本末尾；§3 补充预填草稿的光标落点规则 |
| v0.10 | 2026-09 | 插件市场支持索引 `icon` / `screenshots`：列表、详情页头部与已安装行共用插件图标，缺失回落确定性首字母瓷砖；详情页效果图缺省不渲染；§3 补充素材可选规则 |
| v0.9 | 2026-09 | 跳转聊天后输入框必须真的拿到光标（`focus-composer.ts` 按时间窗重试，带 fixture 回归） |
| v0.7 | 2026-09 | 插件中心页头新增「创建插件」（开新会话并预填内置 `/ccgui-plugin-creator`）；§3 补充页头按钮「等待 / 前提不满足」两类禁用规则 |
| v0.6 | 2026-09 | 插件详情页滚动契约：右信息栏限高并独立滚动，README 长代码行在正文列内横向滚动；§3 补充规则 |
| v0.5 | 2026-09 | 插件详情页右栏新增「最近更新时间」（索引 `updatedAt`，缺失不渲染）；§3 补充时间字段规则 |
| v0.4 | 2026-09 | 插件入口图标由拼图（`puzzle`）改为宫格（`layout-grid`），侧边栏 / 插件中心页签 / 设置页兜底三处统一；§2.2 补充图标取用规则 |
| v0.3 | 2026-09 | 插件市场开发者列改用 GitHub 真实头像（失败回落首字母瓷砖）；补充§3 头像规则 |
| v0.2 | 2026-09 | 插件市场改为表格化列表（分类 chips 带计数、排序、搜索、行内单一状态）；详情页改「左正文 + 右信息栏」；补充§3 列表状态规则 |
| v0.1 | 2026-09 | 首版：设计基础、状态规范、刷新/复制动作反馈、刷新入口清单 |
