/**
 * Release notes shown in the release-notes center tab (ReleaseNotesPane).
 * Newest first; add an entry at release time. Content is bilingual —
 * the tab shows both when available, ordered by the active UI language.
 */

/** Repo the release-notes tab links to for the Star banner / about page. */
export const GITHUB_REPO_URL = "https://github.com/zhukunpenglinyutong/desktop-cc-gui";

export interface ChangelogEntry {
  version: string;
  date: string;
  content: {
    en: string;
    zh: string;
  };
}

/** 版本号比较：两边都去掉可选前缀 v，忽略大小写。 */
export function sameVersion(a: string, b: string): boolean {
  return a.trim().replace(/^v/i, "").toLowerCase() === b.trim().replace(/^v/i, "").toLowerCase();
}

/** 本地版本记录里与 `version` 同名的条目；没有就是没有——不回落相邻版本，
 *  否则会把 v1.0.7 的说明挂在 v1.0.8 的标题下。 */
export function changelogEntryFor(version: string): ChangelogEntry | undefined {
  return CHANGELOG_DATA.find((entry) => sameVersion(entry.version, version));
}

export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: "1.1.0",
    date: "2026-09-24",
    content: {
      zh: `修复
- **Pi / OMP 请求参数兼容性**：移除自 1.0.6 引入的通用推理字段注入，由 CLI 按实际模型与供应商协议生成请求，修复 OMP OpenAI Codex 通道的 Unsupported parameter: reasoning_effort 错误；保留原生推理档位传递，无需降低 xhigh。`,
      en: `Fixes
- **Pi / OMP request compatibility**: Remove the generic reasoning-field injection introduced in 1.0.6 and let the CLI encode requests for the selected model and provider. This fixes Unsupported parameter: reasoning_effort on OMP's OpenAI Codex channel while preserving native thinking-level selection, with no need to lower xhigh.`,
    },
  },
  {
    version: "1.0.9",
    date: "2026-09-24",
    content: {
      zh: `✨ 新功能
- **Worktree 子工作区**：侧栏父仓库行下新增「Worktrees · n」分组，worktree 作为子工作区挂在里面（子行主名是分支名，可展开各自的会话线程，也可直接在子目录里开新会话）；创建对话框按「新分支（默认）/ 已有分支 / 从 PR 创建」三种来源，PR 支持编号或链接，即交即走并在分组顶部显示可取消、可重试的三态进度行（校验 / fetch / 创建 / 注册逐段替换，失败按原因给重试或改名 / 修复指引）；「新分支」的 base 默认取父工作区当前检出分支（main / master 改用远程同名分支），用户手选后不再被晚到的状态改写；删除走分级确认（未提交文件、未推送提交、是否已合入 base 三项预检，默认保留本地分支，有进行中的会话或终端任务会额外提示）；父工作区移除 / 归档时先列出受影响的 worktree 再确认（只移除侧栏登记，磁盘目录不动）；目录已从磁盘消失或已被 git 锁定的 worktree 在侧栏明示，锁定项禁用删除并给出原因
- **崩溃不再白屏**：三层兜底——启动占位 + 8 秒 watchdog（bundle 加载失败或 React 挂载前崩溃时显示原因与重新加载）、全局 error / unhandledrejection 捕获、顶层 React 错误边界；崩溃页给出具体错误原因、可展开的技术详情，以及重新加载 / 复制错误信息 / 退出应用；崩溃报告只在本地留存（内存环形 + localStorage 最近一条），不自动上传。ResizeObserver loop、Script error 这类浏览器自身噪音只在诊断环里每条记一次，不再每隔几分钟弹一次全屏崩溃页，也不会被下次启动当成启动失败原因
- **桌面宠物（Codex v2 宠物包）**：独立透明置顶小窗，只有宠物图像本身接收点击（左键拖动、右键在 50% / 75% / 100% / 125% / 150% 五档间循环缩放并立即持久化，键盘 Enter / Space 与右键同效，其余区域鼠标穿透不挡桌面操作）；状态气泡玻璃拟态，有活动会话时每 1.8 秒在会话间轮播（失败 / 等待确认优先于运行中，刚完成的会话短暂显示「已完成」，两行截断显示会话名 + 状态）；位置与大小持久化，恢复前校验仍落在已连接的显示器内；设置「常规」里可导入 / 移除 Codex 宠物包（pet.json 与 spritesheet.webp 同目录）、切换角色与大小，导入先读头尺寸并限制清单 / 图集大小，移除走危险确认
- **升级后首启自动宣布新版本**：应用版本比上次运行真的前进、且本地版本记录里有该版本时，首启自动把「版本更新」开成中心页签并标记未读（页签强调色圆点 + 页头「新版本」胶囊，关掉页签即视为已读）；首次安装只写基线不弹，版本没变、降级、版本号认不出、本地没有该版本条目都不弹，每个版本只宣布一次；待更新版本不写未读标记，那条路径已有浮层与「立即更新」
- **任务详情下钻**：运行状态条的任务模块可点进单条任务查看详情与执行情况（任务内容、所属阶段、执行状态、阻塞原因与长说明），面板内返回，打开详情时焦点落在返回按钮
- **AskUserQuestion 多题逐题确认**：单选选项改用圆形标记、多选改用方形复选标记；单选答完自动跳到下一道未答题；非末题的多选题显示「确认本题并继续」保存本题选择，仅最后一道多选题给「提交」，全部答完再统一提交
- **Git 分支选择器列出远程跟踪分支**：变更面板与状态栏共用同一份分支列表，在本地分支之后列出 origin/x 并标中性「远程分支」徽标（跳过 origin/HEAD 符号引用），刚 fetch 到的分支可搜可切；检出远程分支时物化为同名本地跟踪分支——已存在就切过去，绝不用远程 tip 覆盖本地提交
- **设置支持筛选与单项编辑 OMP 自定义供应商**：供应商列表新增搜索框；单项编辑只替换该供应商的配置块，其余供应商、注释与顺序保持原样，定位不到配置块时拒绝保存并提示改用完整编辑器；删除自定义供应商加危险确认并写清后果
- **OMP 订阅授权新增 Google Antigravity 登录**：可发起 google-antigravity 登录并显示凭证授权状态，保留 google-gemini-cli 以兼容旧的 Google Code Assist 登录
- **OpenCode 权限模式支持 bypass**：serve 驱动下 bypass 对 permission.asked 回「always」（该会话内记住批准，等价于 run --auto；配置里显式 deny 的规则照旧生效），权限选择器不再把 bypass 置灰
- **电脑操控（入口暂未开放）**：Codex 引擎用 -c mcp_servers.… 在进程级挂载电脑操控驱动，不写用户 config，崩溃也不会把驱动留在配置里；不支持的引擎在发送前明确拒绝而不是静默当普通对话，远程（WSL 发行版）工作区同样拒绝；虚拟光标运行期全程显示、模型无法关闭，全局 Esc 急停只在该回合武装。设置页与斜杠菜单入口暂时隐藏，输入框仍可手动输入 /ccgui-cua 任务

🐛 修复
- **模型刷新改为全局生效**：模型目录此前按工作区各自缓存，刷新只更新当前工作区；现按「上下文」分桶——本机共用一份目录（任一工作区刷新即对所有本地工作区生效），远端（WSL 发行版）工作区各留自己的桶，不会把本机目录串成远端模型
- **重试退避期间不再和滚动抢合成器**：侧栏与页签的状态点、思考指示器在 provider 退避重试期间保持可见但停止动画（新增引用稳定的 retrying 映射，只在真正进出退避时改引用），中断与删除会话补齐 retry / streaming / retrying 清理，避免删除后 key 永久残留
- **会话解析缓存把工具输出计入内存预算**：旧口径只算正文与图片，工具结果多的会话被低估数倍，128 MB 预算名存实亡；现递归计入 args / result / usage、todo、消息路径 / 模型 / 精力等字段，让预算真正封顶
- **对话结束后子任务跨页丢失、子代理状态收敛与呼吸灯异常**：子任务与子代理行在回合结束后统一收敛为「已完成」，不再跨页后消失、卡在运行中或呼吸灯常亮
- **元信息里的模型名不再带渠道与插件前缀**：统一只展示最后一段的纯净模型名
- **输入框粘贴后一次撤销不再连坐**：粘贴走 insertHTML 单独占一个撤销步，不再把此前的输入一起删掉
- **稀疏检出（sparse-checkout）不再误报删除**：文件树与变更列表按 index 的 skip-worktree 位过滤未物化文件，不再出现「几百个未提交变更 / −10 万行」；规则排除了全部文件导致空检出时，worktree 创建返回明确错误并清理半成品，不登记空工作区
- **打包版插件样式不再被 CSP nonce 拦掉**：启动占位样式从 index.html 内联 style 移入 public/boot.css 外部文件——内联标签会让 Tauri 往 style-src 里加 nonce，使 'unsafe-inline' 失效，运行时注入的插件 CSS 全被拒（表现为插件照常激活、样式全丢）；并加守卫测试禁止 index.html 再出现内联 style / script
- **插件 exec 子进程找不到解释器**：plugin_exec_run / spawn 按 CLI 搜索目录注入子进程 PATH（插件自己传的 PATH 保持优先、按顺序去重），修掉 #!/usr/bin/env node 这类 shim 在 launchd 式 PATH 下报 env: node not found、工具静默无输出的问题；引擎 spawn 路径同样补齐
- **插件引导不再中断**：Tauri 2.11 的 __TAURI_INTERNALS__.invoke 是只读属性，硬赋值会抛错并让插件加载停在第 0 次重试；现按属性描述符安全替换，替换不了只告警不中断，缺失 Promise.withResolvers 的老 WebView2 也不再中断重试
- **OMP Google 通道不再被拒**：Google API（google-generative-ai / google-gemini-cli / google-vertex）不再携带 Cloud Code Assist 不接受的通用推理字段，原生 thinkingConfig 保留
- **聊天侧栏与 Git 变更列表的滚动和分页**：变更列表容器补 min-h-0 + overscroll-contain，吸顶摘要栏与分组头给出正确层级（不再被行盖住），行内按钮改 Tooltip；侧栏线程分页在重新展开时回到第一页，收起动画期间不再中途改页高
- **Worktree 分组展开 / 收起补齐高度动画**：分组从条件渲染改为 grid-template-rows 1fr ⇄ 0fr 的 300ms 过渡（收起动画结束才卸载，期间区域 aria-hidden + inert），与子行动画一致，不再一帧内闪现

🧹 内部优化
- Rust 后端新增 git_worktree（列表 / 创建 / 取消 / 删除、已合并判定、PR 解析与 pull ref 检出）、pets（宠物包导入与解码限额）、pet_overlay（透明宠物窗口与命中测试）三个模块；workspaces 表加性迁移 kind / parent_id，旧版 workspaces.json 的 worktree 子项在父项落库后按 db id 挂回，目录已删的子项跳过
- Windows 统一嵌入 manifest 并补 Win32_UI_WindowsAndMessaging 依赖；Windows CI 因 computer-use 依赖让 lib-test 可执行文件加载失败（0xc0000139）改为只做测试编译；git discard 测试固定 core.autocrlf=false
- 移除拖拽授权链路（computer_use_drag_source 命令、tauri-plugin-drag 依赖与 drag:default 权限），macOS 授权只保留「打开系统设置」深链；宠物窗口加入 capabilities
- 插件 SDK 文档补充 exec 子进程 PATH 注入契约并再生成 sdk-api.md；新增 tests/browser/sidebar-collapse.html 逐帧采样回归（分组与子行展开 / 收起各需 ≥3 个中间帧）；ui-ux-spec 更新至 v0.52（展开 / 收起动效 §2.4、桌面宠物 §4.3、AskUserQuestion 多题、Worktree 全链路、崩溃兜底、远程分支、电脑操控规则）
- 文档：新增 worktree 交互设计稿与实现说明；重构抽离 GeneralSection / QuestionCard / RunStatusStrip / WorktreeCreateDialog / DeleteWorktreeDialog / PetOverlayApp / repo-tree / workspace-context-menu 的 hook 与子组件（行为不变）`,
      en: `✨ Features
- **Worktree sub-workspaces**: a "Worktrees · n" group under each repo row holds its worktrees as child workspaces (the child row is named after the branch, expands to its own session threads, and can start a new session right in that directory); the create dialog offers three sources — New branch (default) / Existing branch / From PR — with the PR form accepting a number or a URL, dispatched immediately with a cancellable, retryable three-state progress row at the top of the group (validate / fetch / create / register replace each other, and failures give a retry or rename/fix hint by reason); the New branch base defaults to the parent workspace's currently checked-out branch (falling back to the remote same-name branch for main/master) and is never rewritten by a late status update once the user picks one; deletion goes through a graded confirmation (uncommitted files, unpushed commits, and whether the branch is merged into its base are pre-checked; the local branch is kept by default, with live sessions or terminals called out); removing or archiving a parent workspace lists the affected worktrees first (sidebar registration only — disk contents are never touched), and a worktree whose directory is gone or that git has locked says so, with locked ones not deletable
- **No more blank window on a crash**: three layers — a boot placeholder plus an 8-second watchdog (shows the reason and a reload when the bundle fails to load or React dies before mounting), global error / unhandledrejection capture, and a top-level React error boundary; the crash screen gives the concrete reason, expandable technical details, and Reload / Copy error / Quit, with reports kept locally only (in-memory ring plus the latest entry in localStorage) and never uploaded; browser noise such as ResizeObserver loop or Script error is logged once per message in the diagnostics ring, so it no longer pops the full-screen crash page every few minutes or gets mistaken for a failed start on the next launch
- **Desktop pet (Codex v2 pet packages)**: a separate transparent, always-on-top window where only the pet image itself takes clicks (drag with the left button; right-click cycles 50% / 75% / 100% / 125% / 150% and persists immediately, Enter/Space does the same, and the rest stays click-through so the desktop stays usable); a glassy status bubble rotates between active sessions every 1.8s (failed / waiting-for-approval before running, a just-finished session briefly shows "Completed", session name + status truncated to two lines); position and scale persist and are validated against connected displays before being restored; Settings → General imports or removes Codex pet packages (pet.json and spritesheet.webp in one folder), switches character and size, reads the header before decoding and caps manifest/atlas size on import, and confirms removal
- **First launch after an upgrade announces the new version**: when the app version really moved forward and the local changelog has an entry for it, the release-notes center tab opens automatically with an unread marker (accent dot on the tab plus a "New version" pill in the header, cleared by closing the tab); a first install only writes the baseline, and an unchanged version, a downgrade, an unparsable version, or a missing local entry never triggers it — each version is announced exactly once; a pending update found by the updater writes no marker, since that path already has its toast and "Update now"
- **Task drill-down**: the run-status strip's task module opens a per-task detail view with the assignment, its phase, execution state, blocker reason, and long payloads, with an in-panel back button that takes focus
- **AskUserQuestion multi-question flow**: single-choice options use round markers and multi-choice uses square checkboxes; a single-choice answer advances to the next unanswered question; a non-final multi-choice question shows "Confirm and continue" to save just that answer, only the final multi-choice question shows Submit, and the whole set is submitted together once complete
- **Git branch picker lists remote-tracking branches**: the branch list shared by the changes panel and the status bar lists origin/x after the local branches with a neutral "Remote branch" badge (skipping symbolic refs such as origin/HEAD), so a freshly fetched branch is searchable and selectable; checking out a remote branch materializes a same-named local tracking branch — switching to it when it exists, never overwriting local commits with the remote tip
- **OMP custom providers can be filtered and edited one at a time**: the provider list gains a search field, and per-provider editing replaces only that provider's block while every other provider, comment, and ordering stays as written; when the block cannot be located the save is refused and the full editor is suggested, and deleting a custom provider now asks for confirmation with the consequences spelled out
- **OMP subscriptions add Google Antigravity login**: google-antigravity can be logged in and its credential status shown, with google-gemini-cli kept for the legacy Google Code Assist login
- **OpenCode supports the bypass permission mode**: on the serve driver, bypass answers permission.asked with "always" (the server remembers approvals for the session — the equivalent of run --auto, while explicit deny rules in config still hold), and the permission picker no longer greys it out
- **Computer use (entry not exposed yet)**: the Codex engine mounts the computer-use driver at process level via -c mcp_servers.… — nothing is written to the user's config, so a crash leaves no driver behind; engines that cannot receive the driver refuse the send up front instead of silently running a plain chat, and remote (WSL distro) workspaces are refused too; the virtual cursor is drawn for the whole run and cannot be disabled by the model, and the global Esc stop is armed only during that turn. The Settings page and slash-menu rows are hidden for now; /ccgui-cua task still works when typed

🐛 Fixes
- **Model refresh is global again**: the model catalog used to be cached per workspace, so refreshing only updated the one in view; it is now bucketed by context — all local workspaces share one catalog (a refresh in any of them updates them all), and each remote (WSL distro) workspace keeps its own bucket so local entries never leak into remote ones
- **Retry backoff no longer fights the compositor**: the sidebar and tab status dots and the thinking indicators stay visible but stop animating during a provider retry backoff (via a reference-stable retrying map that only changes when the backoff really starts or ends), and interrupt/delete now clears retry / streaming / retrying flags so keys do not linger after a session is deleted
- **The session-parse cache counts tool output in its memory budget**: the old accounting only measured text and images, underestimating tool-result-heavy sessions several times over and making the 128 MB budget meaningless; args, results, usage, todos, and message path/model/effort fields are now counted recursively so the cap actually holds
- **Subtasks no longer vanish across pages after a turn ends**: subtask and subagent rows settle to "Completed" once the conversation ends instead of disappearing across pages, sticking at running, or leaving the breathing dot animating forever
- **Model names in message metadata drop provider and plugin prefixes**: only the final path segment is shown
- **One paste no longer takes the previous input with it on undo**: pasting goes through insertHTML and occupies its own undo step
- **Sparse checkouts no longer report deletions**: the file tree and changes list filter non-materialized entries by the index skip-worktree bit, so a sparse checkout no longer shows "hundreds of uncommitted changes / −100,000 lines"; when the rules exclude everything and the checkout is empty, worktree creation returns an explicit error, cleans up the half-made directory, and does not register an empty workspace
- **Packaged plugin styles are no longer blocked by the CSP nonce**: the boot placeholder moved from an inline style in index.html to the external public/boot.css — an inline tag makes Tauri add a nonce to style-src, which disables 'unsafe-inline' and rejects every runtime-injected stylesheet (plugins kept activating with all styling gone); a guard test now forbids inline style/script in index.html
- **Plugin exec children could not find their interpreter**: plugin_exec_run / spawn inject the CLI search directories into the child PATH (appended after — and order-deduped with — any PATH the plugin supplied), fixing #!/usr/bin/env node shims that failed with "env: node: No such file or directory" under a launchd-style PATH and silently produced no output; the engine spawn path gets the same treatment
- **Plugin bootstrap no longer aborts**: Tauri 2.11 defines __TAURI_INTERNALS__.invoke as a read-only property, and assigning to it threw and stopped plugin loading at the first retry; the wrapper is now installed through the property descriptor when possible and only warns when it cannot be, and a WebView2 without Promise.withResolvers no longer aborts the retry loop
- **OMP's Google channel is no longer rejected**: Google APIs (google-generative-ai / google-gemini-cli / google-vertex) no longer carry the generic reasoning fields Cloud Code Assist rejects, while the native thinkingConfig is preserved
- **Chat sidebar and Git changes list scroll and pagination**: the changes list container gains min-h-0 + overscroll-contain, the sticky summary bar and group headers get proper stacking (no longer hidden behind rows), row buttons use Tooltips, and sidebar thread pagination resets to page 0 on re-expand instead of changing page height mid-collapse
- **The Worktree group animates like its children**: the group switched from conditional rendering to a 300ms grid-template-rows 1fr ⇄ 0fr transition (unmounting only after the collapse animation, with the region aria-hidden + inert), so it no longer pops in and out in a single frame

🧹 Internal
- Three new Rust modules: git_worktree (list / create / cancel / remove, merge checks, PR resolution and pull-ref checkout), pets (package import with decode caps), and pet_overlay (transparent window and hit testing); the workspaces table gains an additive kind / parent_id migration, and legacy workspaces.json worktree children are reattached to their parent's db id after it is inserted, skipping children whose directory is gone
- Windows: a unified embedded manifest plus the Win32_UI_WindowsAndMessaging feature; Windows CI now only compiles the Rust tests because the computer-use dependencies make the lib-test executable fail to load on the runner (0xc0000139), and the git discard tests pin core.autocrlf=false
- Removed the drag-to-authorize path (computer_use_drag_source, the tauri-plugin-drag dependency, and drag:default), leaving macOS authorization with only the "Open System Settings" deep link; the pet overlay window joins the capability set
- Plugin SDK docs spell out the exec PATH injection contract and sdk-api.md is regenerated; a new tests/browser/sidebar-collapse.html samples frames of the group and child expand/collapse (≥3 intermediate frames each way); ui-ux-spec is up to v0.52 (expand/collapse motion §2.4, desktop pet §4.3, multi-question cards, the worktree chain, crash fallbacks, remote branches, and computer-use rules)
- Docs: a new worktree interaction mockup and implementation notes; a refactor extracts hooks and subcomponents out of GeneralSection / QuestionCard / RunStatusStrip / WorktreeCreateDialog / DeleteWorktreeDialog / PetOverlayApp / repo-tree / workspace-context-menu without behavior changes`,
    },
  },
  {
    version: "1.0.8",
    date: "2026-09-23",
    content: {
      zh: `✨ 新功能
- **设置新增「能力扩展」分组**：Skills（我的 Skills / 发现 / 使用情况）与 MCP（配置 / 运行时）两个管理页，放在 CLI 管理之后；页面懒加载，普通设置页不扫描技能、不读 MCP 配置、不联网，支持 ?page=skills / ?page=mcp 深链；远程 Web 端只显示桌面端提示，不渲染无效界面
- **Skills 覆盖全部已接入 CLI**：同步目标从 Claude / Codex 扩到 Kimi / Grok / PI / OMP / DeepSeek / Antigravity / Gemini / OpenCode / Qoder / Qoder CN / Hermes 与跨 agent 的 ~/.agents，各自尊重本 CLI 的 home 环境变量与设置页覆盖，home 不存在时隐去；「纳管」记录并保护用户本地来源目录，不再用受管副本覆盖它，更新前比对托管副本哈希，本地有修改时拒绝覆盖并要求显式确认；移除用户自己目录里的副本时如实返回「已保留」，不谎报已移除
- **技能行与详情面板**：行内同步态改为可点的引擎图标（彩色 = 已同步、红点 = 副本丢失，且只渲染真有副本的引擎），点击即移除该引擎副本或重同步丢失的副本，未纳管技能自己目录里的副本禁用取消；详情页新增「活动情况」与带图标的「同步到」列表，「从所有 Agent 移除 / 更新 / 关闭」固定在面板底部，多引擎列表自带限高滚动
- **技能发现页可看详情**：行主体点开对话框，按需回仓库读取 SKILL.md（描述 + 正文 + 安装），列表不预取以免撞限流；读不到时给出说明、仓库入口与重试；skills.sh 的 id 与仓库目录名按「同名 / 去仓库前缀 / 冒号转横线」对齐，修掉 vercel-labs 这类条目的 SKILL.md not found
- **MCP 页覆盖全部引擎**：声明式来源表从 Claude / Codex 扩到 Kimi / Grok / OMP / OpenCode / Antigravity / Qoder / Qoder CN / dsh，PI 显式标注不内置 MCP；读取只解析文件、不启动 CLI；写入只对在本机真实 CLI 上验证过语义的来源开放（Grok 的 enabled + disabled_mcp_servers 双向同步、OpenCode 的 enabled），JSONC 因写入会丢注释降级为只读，其余来源返回可本地化的原因码；引擎行改用与 Skills 同形的 Chip + 品牌图标 + 配置条数，范围筛选（全部 / 配置 / 运行时），页签支持 ?page=mcp&engine=<id> 深链
- **输入框 /mcp 面板**：斜杠选择器新增内置行，提交 /mcp 也直接弹出面板，按当前会话引擎列出配置与运行时清单，与设置页共用同一份 mcp_inventory 数据，可刷新、可启停可写来源，并可深链到设置页对应引擎
- **MCP 连接状态检测**：后端按配置里的真实命令 / 地址启动或连接一次，完成 initialize + tools/list 握手后整组回收进程（stdio 25s / HTTP 12s 超时，命令与 env 一律从配置文件重新解析）；行内显示「已连接 · N 工具 / 需要登录 / 连接失败」徽标，支持单条检测与「检测全部」，详情弹窗给出原因、服务名、协议、工具名、耗时与检测时间；打开页面即自动检测，结果按「条目 id + 配置哈希」缓存 3 分钟、最多 4 个并行，配置改了只补变化的条目，停用条目不检测，标题行显示「状态更新于 HH:MM」
- **Claude 用户级 / local MCP 就地启停**：写 ~/.claude.json 的 projects[工作区].disabledMcpServers，与 Claude Code TUI 的「停用（本项目）」同一把开关，不改服务定义；无活动工作区时降级只读并说明原因
- **版本更新说明改为原生中心页签**：发现新版本自动打开该页签（排在页签条最尾，不抢已在视的插件中心 / 任务工作台），状态栏版本号与命令面板「查看版本更新说明」打开同一页签；正文优先渲染更新清单 notes，缺失时回落本地同版本条目，都没有时明说未附带说明；页头新增「检查更新」（转圈 → 对号，失败不出对号），结果行与设置页共用同一份文案，按版本翻页的旧版本记录弹窗随之下线
- **大任务卡顿修复**：连续同 run 的工具事件按原顺序归并后再写 store（128 start + 128 args + 128 result 由 384 次写入降为 1 次），混合事件、终态与切换会话前先提交，文本与工具结果不丢；过程组有界展示（每页 40 项、默认最新页、读历史不被新增抢页，搜索命中可展开跳页）；未跟踪文件行统计限定 1 MiB / 100k 行，NUL 二进制、符号链接、FIFO 与超限文件返回 unknown，不再伪造截断后的精确值
- **本地性能诊断**（默认开启，无自动上传）：原生独立线程低频采样系统 CPU / 内存 / swap、主进程与后代进程，并明确标注归属不明的 WebKit 候选；前端按 5 秒窗口聚合事件数、批处理与提交耗时、前台事件循环延迟与会话 / 消息规模，不逐 token 写日志；状态栏「性能」与设置入口打开同一只读弹窗，可复制摘要（12 KB 上限）或导出完整 JSON，偏好原子持久化并跨窗口广播，关闭即停止采样并清空记录；另引入 react-scan 作为可选渲染高亮面板（默认关闭，入口前先完成 hook）
- **终端路径链接改为修饰键点击**：普通单击不再唤起文件管理器，macOS 用 ⌥+点击、Windows / Linux 用 Ctrl+点击（对齐 Windows Terminal / GNOME Terminal 的开链习惯），避免选中文本或点回终端时误触；右键菜单的「在访达中显示」保持不变
- **插件会话模式（SDK 0.3.14）**：新增 ui:conversation-mode 扩展点与 ConversationModeHost 挂载点，插件可在会话内替换聊天内容区与输入框，并能报告忙碌以锁定宿主退出，活动标签关闭与替换草稿的引擎切换同样受阻断；只读规划与接力 MVP 的双节点状态机、交接协议放在独立 ESM 插件内，不侵入普通 chat store
- **只读与请求身份（SDK 0.3.14）**：ctx.agent.catalog 返回清洗后的 Agent 目录（只含可用性、只读能力与渠道 / 模型 ID，不返回配置与凭据）；agent.start 支持 readOnly 与 requestId（调用前即可持久化预期 runId），interrupt 返回是否命中活动 run；只读能力以原生实现为准（fail-closed），目前仅 Pi 支持隔离只读调用，Codex 明确不宣称
- **生成速度计量（SDK 0.3.15）**：usage / done 事件新增 genMs（宿主实测生成窗口毫秒数），只统计响应流打开到关闭，工具执行、用户等待与轮间空闲全部排除；插件按 output token ÷ genMs 即得不含工具等待的生成速度，字段缺失时回退旧的相邻报告口径，插件无需版本门槛

🐛 修复
- skills_hub_mutate 之前把整个参数包平铺传递，所有 mutation 都报 missing required key payload；现按 { action, payload } 拆分
- Skills 详情面板：使用统计读取失败时显示「使用统计暂不可用」并把调用次数 / 上次使用显示为 —，不再误报「从未使用 / 尚未调用」
- MCP 检测健壮性：一次 read 带回多行（日志 + 响应）时改用带缓冲的行读取，不再丢后续数据；本机回环地址绕开环境代理，不再因 HTTP_PROXY 变成 502；环境变量占位符（含 :- 默认值）按 CLI 习惯展开；缺 status 字段的响应不当作已连接，坏响应不再把列表画崩
- 行内同步态只画真有副本的引擎：一份技能在 13 个引擎里通常只剩 1~2 个图标，不再每行铺淡图标

🧹 内部优化
- Rust 后端新增 mcp 模块（config / probe / runtime / 声明式 sources）与 skills_hub 模块（core / discover / fsutil / http / lifecycle），配套 34 项 mcp 与 29 项 skills_hub 单测；引擎 reader 统一收口生成窗口统计
- 文档：新增能力扩展迁移（Skills / MCP）、性能修复与诊断、macOS 大任务 CPU 排查、计划-执行接力四份实施计划；plan-execute SOP V1 / V2 可交互原型与 jsdom 回归；ui-ux-spec 更新至 v0.42
- SDK 契约变更同步再生成 sdk-api.md 与 SDK CHANGELOG，一致性测试随源码校验`,
      en: `✨ Features
- **New "Capabilities" group in Settings**: Skills (My Skills / Discover / Usage) and MCP (Config / Runtime) management pages, placed after CLI management; pages load lazily so ordinary settings pages never scan skills, read MCP configs, or go online, with ?page=skills / ?page=mcp deep links; a remote WebUI shows a desktop-only notice instead of dead controls
- **Skills cover every integrated CLI**: sync targets grow from Claude / Codex to Kimi / Grok / PI / OMP / DeepSeek / Antigravity / Gemini / OpenCode / Qoder / Qoder CN / Hermes plus the cross-agent ~/.agents, each respecting its CLI's home env and Settings override and hidden when that home is missing; "adopt" records and protects the user's own source directory instead of overwriting it with a managed copy, updates compare the managed copy's hash and refuse to overwrite local edits without explicit confirmation, and removing a copy from the user's own directory reports "kept" instead of claiming it was deleted
- **Skill rows and detail panel**: the inline sync state becomes clickable engine icons (colored = synced, red dot = orphaned, and only engines that actually have a copy render), where clicking removes that engine's copy or re-syncs a lost one, while a copy in the user's own directory cannot be cancelled; the detail page gains an activity summary and an icon list for "sync to", with "Remove from all agents / Update / Close" pinned at the bottom and the engine list scrolling on its own
- **Discover page shows skill details**: clicking a row opens a dialog that fetches SKILL.md from the repo on demand (description + body + install) — the list never prefetches, which would hit rate limits — with an explanation, repo link, and retry when it cannot be read; skills.sh ids and repo directory names align by "same name / strip repo prefix / colon to dash", fixing SKILL.md not found for vercel-labs-style entries
- **MCP page covers every engine**: the declarative source table grows from Claude / Codex to Kimi / Grok / OMP / OpenCode / Antigravity / Qoder / Qoder CN / dsh, with PI explicitly marked as not built-in; reading only parses files without launching CLIs; only sources whose semantics were verified against the real CLI are writable (Grok's enabled + disabled_mcp_servers two-way sync and OpenCode's enabled), JSONC files degrade to read-only because writing would drop comments, and every other source returns a localizable reason code; engine rows use the same Chip + brand icon + config count as Skills, with an all / config / runtime scope filter and ?page=mcp&engine=<id> deep links
- **Composer /mcp panel**: the slash picker gains a built-in row and submitting /mcp opens the same panel, listing config and runtime entries for the current session's engine from the same mcp_inventory the Settings page uses, with refresh, enable/disable for writable sources, and a deep link back to Settings
- **MCP connection probing**: the backend starts or connects once with the command/address from the config, performs an initialize + tools/list handshake, then kills the whole process group (25s stdio / 12s HTTP timeouts; command and env are always re-resolved from config files); rows show Connected · N tools / Login required / Connection failed badges with per-row and "check all" actions, and the detail dialog reports reason, service name, protocol, tool names, duration, and timestamp; opening a page probes automatically with results cached by entry id + config hash for 3 minutes and at most 4 probes in flight, re-probing only entries whose config changed, skipping disabled ones, and showing "status updated at HH:MM"
- **Claude user/local MCP can be toggled in place**: enable/disable writes projects[workspace].disabledMcpServers in ~/.claude.json — the same switch as Claude Code TUI's "Disable (this project)" — leaving the server definitions untouched, and degrades to read-only with a reason when no workspace is active
- **Release notes become a native center tab**: a new version opens the tab automatically (last in the tab strip, never stealing the plugin hub or task workbench already in view), and the status-bar version button and the command palette open the same tab; the body renders the update manifest's notes first, falls back to the matching local CHANGELOG_DATA entry, and says so explicitly when neither exists; the header gains an in-place Check for updates (spinner → check, no check on failure) sharing the Settings result line, and the old paged release-notes dialog retires
- **Large-task jank fixes**: consecutive tool events of the same run are coalesced in order before hitting the store (128 start + 128 args + 128 result drop from 384 writes to 1), with mixed events, terminal states, and session switches flushing first so no text or tool result is lost; process groups render in bounded pages of 40 (newest first, reading history is never yanked back by new arrivals, and search hits can expand and jump); untracked-file line stats are capped at 1 MiB / 100k lines, with NUL binaries, symlinks, FIFOs, and over-limit files returning "unknown" instead of a fabricated exact count
- **Local performance diagnostics** (on by default, never auto-uploaded): a dedicated native thread samples system CPU / memory / swap, the main process and its descendants, and clearly-labelled WebKit candidates at a low rate; the front end aggregates 5-second windows of event counts, batching and commit time, foreground event-loop delay, and session/message scale without logging per-token; the status bar's Performance entry and Settings open the same read-only dialog, which can copy a summary (12 KB cap) or export the full JSON — the preference persists atomically and broadcasts across windows, and turning it off stops sampling and clears records; react-scan is available as an optional render-highlight panel (off by default, hooked before first import)
- **Terminal path links require a modifier**: a plain click no longer reveals in the file manager — macOS uses ⌥+click and Windows/Linux Ctrl+click (matching Windows Terminal / GNOME Terminal), avoiding accidental reveals while selecting text or clicking back into the terminal; the context-menu "Reveal in Finder" is unchanged
- **Plugin conversation modes (SDK 0.3.14)**: a new ui:conversation-mode extension point and ConversationModeHost mount let a plugin replace the chat body and composer inside a session and report busy state to lock the host's exit, with active-tab close and draft engine switches blocked too; read-only planning and the relay MVP's two-node state machine and handoff protocol live in a separate ESM plugin and never touch the normal chat store
- **Read-only and request identity (SDK 0.3.14)**: ctx.agent.catalog returns a sanitized agent directory (availability, read-only capability, and provider/model ids only — never config or credentials); agent.start accepts readOnly and requestId (so plugins can persist the expected run id before launching) and interrupt returns whether it hit an active run; read-only capability is native-backed and fail-closed, currently Pi only, and Codex explicitly does not claim it
- **Generation-speed measurement (SDK 0.3.15)**: usage / done events now carry genMs, the host-measured generation window in milliseconds from stream open to close with tool execution, user waits, and inter-turn idle excluded; plugins compute output tokens ÷ genMs for a real generation speed and fall back to the old adjacent-report timing when the field is absent, so no plugin needs a version gate

🐛 Fixes
- skills_hub_mutate passed the whole argument bag flat, so every mutation failed with "missing required key payload"; it now splits into { action, payload }
- The Skills detail panel shows "usage stats unavailable" and renders call count / last used as — on read failure instead of falsely reporting "never used / not yet called"
- MCP probing robustness: a single read carrying multiple lines (log + response) now uses buffered line reads instead of dropping the remainder; loopback addresses bypass the environment proxy so HTTP_PROXY can no longer turn 127.0.0.1 into a 502; environment-variable placeholders (including :- defaults) expand the way CLIs do; a response missing status is no longer treated as connected, so a bad response cannot break the list
- Inline sync state only draws engines that actually have a copy — a skill usually has 1–2 icons across 13 engines, not a row of dim placeholders

🧹 Internal
- Backend: new mcp module (config / probe / runtime / declarative sources) and skills_hub module (core / discover / fsutil / http / lifecycle) with 34 mcp and 29 skills_hub unit tests; the engine reader consolidates generation-window accounting
- Docs: new plans for the skills/MCP migration, performance fixes and diagnostics, the macOS large-task CPU investigation, and the plan-execute relay; an interactive plan-execute SOP V1/V2 prototype with jsdom regression tests; ui-ux-spec updated to v0.42
- SDK contract changes regenerate sdk-api.md and the SDK CHANGELOG, with a consistency test verifying them against the source`,
    },
  },
  {
    version: "1.0.7",
    date: "2026-09-23",
    content: {
      zh: `✨ 新功能
- **插件中心升级为原生页签**：插件管理与市场从设置页迁入中央页签（市场 / 已安装 / 详情 / 开发指南），侧栏新增「插件」入口；已安装列表可就地重新加载，插件更新后原地热重载，无需关开插件或重启应用
- **插件市场重做**：分类 chips（带计数）与排序 / 搜索 / 刷新工具条，列表改表格（名称 / 开发者 / 安装量 / 版本 / 操作），整行可点进详情；支持官方与社区插件的标识和筛选，开发者头像改用 GitHub 真实头像
- **插件详情整页化**：左正文 + 右 sticky 信息栏；截图轮播支持灯箱、方向键与加载失败占位，README 以与文件预览相同的安全姿态渲染（相对图片 / 链接补全为仓库地址）；权限默认展示前 4 项、可展开全部，「最近更新时间」读索引登记值
- **插件图标与效果图**：索引与本地 manifest 均支持 icon / screenshots（索引优先、安装清单兜底），市场安装时把品牌图写入插件目录，插件页签与插件设置页导航离线也能取到图标；新增路径受限的 plugin_read_artwork 读取插件自有素材（符号链接逃逸与越界路径拒绝）
- **「创建插件」与内置开发 skill**：插件中心页头一键开新会话并预填 /ccgui-plugin-creator（光标落到输入框末尾），AI 按内置指南生成可直接安装的插件目录；skill 随应用打包并同步进 Claude / Codex / ~/.agents，SDK 参考文档由源码生成并加一致性测试
- **内测功能开关**（设置 → 其他 → 内测功能，默认关闭）：新增 betaFeatures 设置与开关页，「新建浏览器」入口按开关显隐
- **设置页**：检查更新独立为模块并置于社区与反馈之前；有更新时提示浮在设置页之上，行内显示「发现新版本 vX」与「立即更新」，下载 / 安装阶段同步进度；导航改为 Codex 风格静态分组（侧栏 300px），CLI 管理 / 未安装 / 未启用三组标题可折叠（未安装 / 未启用默认收起，搜索与深链自动展开）
- **聊天流式体验**：正文与思考面板按到达节奏逐帧揭示，不再整批闪现；思考区保留完整已揭示文本，去掉 2000 字尾窗导致的整行消失
- **「已编辑」行数恢复逐位滚动**：新增 RollingStat odometer（纯 CSS transition，无 mask / blend-mode），从 0 起滚、位数增长时向左扩张，系统开启「减少动态效果」时直接跳变
- **浮动滚动控件**：按滚轮方向显示「回到顶部 / 回到底部」，点击平滑滚动；流式长高不打断过渡，用户向上接管后不再回钉
- **文件树刷新**移入工作区根行，悬停或键盘聚焦时出现，反馈仍是转圈 → 对号
- **Git 树状态聚合**：新增 git_tree_status 一次扫描多级目录并缓存仓库状态，替代逐目录往返；变更面板接入并按可见性刷新
- **会话搜索**：排序改为「标题 / 内容」通道过滤，后端固定 bm25 相关性 + 更新时间排序

🐛 修复
- 有会话运行时 ⌘Q / 系统退出被拦住：macOS applicationShouldTerminate 返回取消并复用既有二次确认，不再整端静默退出；退出时销毁 Computer Use 覆盖层窗口，避免无窗口悬挂
- output_config.effort 只注入 anthropic-messages 请求，OpenAI / OpenRouter 不再收到 Anthropic 推理强度字段
- 插件市场与详情页：已安装页也会拉取索引（图标 / 效果图不再只靠市场页）；右栏限高并可滚动到「链接」行；README 长代码行留在正文列内横向滚动；截图大图补关闭叉号并修好点空白关闭；官方徽标可点击跳转主页、不再被右栏拉成整行；「链接」三项各带目标图标；权限行改称「权限（CCGUI权限）」
- 中心面切换统一清场：新建会话 / 点击会话 / 打开文件 / 新建浏览器 / 插件页签之间互斥，页签高亮与画面保持一致
- 远程 Web 端：桥接 answer_question / git_discard / plugin_read_artwork，目录授权卡不再渲染无法生效的「允许访问」，改为原因说明与拒绝

🧹 内部优化
- 后端：任务工作台（流程编排 / 流程列表 / 收件箱与运行前执行环境选择）已落地，入口内测暂未放开、本版对所有用户隐藏；quit_guard 拦截退出；npm prefix 探测增加超时、输出上限与子进程回收（含 Windows 任务对象）；list_engines 移出 IPC 处理线程
- 前端：新增 center-surfaces 中心面互斥与 action-feedback（运行 → 对勾）公共反馈；mission 调度 / 设置导航 / 插件详情与已安装行 / 变更面板等处把重复线性查找改为 Map 索引，大组件拆分子组件，清理 render 期 ref 写入与首挂 setState；已编辑行统计改为增量缓存
- 文档与工程：新增 docs/ui-ux-spec.zh-CN.md（刷新 / 复制反馈、动效降级、刷新入口清单），插件开发指南补图标与效果图规范；pnpm plugin-skill:docs 由 TS AST 生成 SDK 参考并加一致性测试；Cargo.lock 与 package.json / Cargo.toml / tauri.conf.json 版本同步`,
      en: `✨ Features
- **Plugin hub becomes a native center tab**: plugin management and the marketplace move out of Settings into center tabs (Market / Installed / Detail / Guide) with a new Plugins entry in the sidebar; the installed list can be reloaded in place, and updated plugins hot-reload without toggling them off or restarting the app
- **Marketplace rework**: category chips with counts plus a sort / search / refresh toolbar, and a table list (name / developer / installs / version / actions) where the whole row opens the detail page; official and community plugins are labelled and filterable, and developer avatars come from GitHub
- **Full-page plugin detail**: README and screenshot carousel on the left, a sticky info rail on the right; the carousel supports a lightbox, arrow keys, and a failed-load placeholder, the README renders with the same safety posture as file preview (relative images/links resolve against the repo), permissions show the first four items with expand-all, and "last updated" reads the index timestamp
- **Plugin icons and screenshots**: both the index and a local manifest accept icon / screenshots (index wins, install manifest is the fallback); marketplace installs write the brand image into the plugin directory so panel tabs and plugin settings nav show an icon offline, and the path-restricted plugin_read_artwork reads plugin-owned artwork (symlink escapes and out-of-tree paths rejected)
- **"Create plugin" and a bundled dev skill**: the hub header opens a new session prefilled with /ccgui-plugin-creator (cursor lands at the end of the composer), where AI follows the bundled guide to generate an installable plugin directory; the skill ships with the app and syncs into Claude / Codex / ~/.agents, and the SDK reference is generated from source with a consistency test
- **Beta features toggle** (Settings → Other → Beta features, off by default): a new betaFeatures setting page gates the new-browser entry
- **Settings**: Check for updates becomes its own module ahead of Community & feedback; when an update exists the toast floats above Settings with an inline "vX available" and "Update now", showing download/install progress; the nav uses Codex-style static groups (300px rail) with collapsible CLI management / not-installed / disabled headers (the latter two start collapsed; search and deep links expand them)
- **Streaming chat**: assistant text and the thinking panel reveal at the arrival rhythm instead of dumping whole batches, and the thinking panel keeps all revealed text (the 2000-character tail window that made lines vanish is gone)
- **Edited-line stats roll digit by digit again**: a new RollingStat odometer (pure CSS transitions, no mask/blend-mode) starts from 0, grows leftward as digits are added, and snaps under reduced motion
- **Scroll control**: the floating button follows the wheel direction between "back to top" and "back to bottom" and scrolls smoothly, without breaking while streaming content keeps growing or when the user takes over
- **File-tree refresh** moves onto the workspace root row, appearing on hover or keyboard focus with the same spinner → check feedback
- **Git tree status aggregation**: a new git_tree_status scans nested directories once and caches repo status, replacing per-directory round trips; the changes panel consumes it and refreshes on visibility
- **Session search**: sorting becomes a Title / Content channel filter, with bm25 relevance plus updated_at order fixed on the backend

🐛 Fixes
- ⌘Q / system quit is now intercepted while runs are active: macOS applicationShouldTerminate is cancelled and reuses the existing confirmation instead of silently taking the whole app down, and the Computer Use overlay window is destroyed on quit so the process no longer hangs with no windows
- output_config.effort is injected only into anthropic-messages requests, so OpenAI / OpenRouter no longer receive Anthropic's reasoning-effort field
- Marketplace and detail page: the Installed tab now fetches the market index (icons/screenshots no longer depend on visiting the market); the info rail is height-capped and scrolls to the links row; long README code lines scroll inside the content column; the screenshot lightbox gains a close button and backdrop-click dismissal works; the official badge links to the profile and no longer stretches across the rail; the three link rows carry destination icons; the permissions row is renamed "Permissions (CCGUI)"
- Center surfaces clear each other consistently: new session / session click / open file / new browser / plugin tabs are mutually exclusive, keeping tab highlight and visible content in sync
- Remote WebUI: the bridge gains answer_question / git_discard / plugin_read_artwork, and the directory-grant card no longer offers an "Allow access" that cannot take effect — it explains why and refuses

🧹 Internal
- Backend: the task workbench (flow studio / flow list / inbox and pre-run execution environment) has landed, but its entry stays hidden for everyone in this release while in beta; quit_guard blocks quit; npm prefix probing gains a timeout, output cap, and subprocess reaping (including Windows job objects); list_engines moves off the IPC handler thread
- Frontend: new center-surfaces mutual exclusion and the shared action-feedback (running → check) component; repeated linear lookups become Map indexes across mission scheduling, Settings nav, plugin detail/installed rows, and the changes panel; large components split; render-phase ref writes and first-mount setState removed; edited-line stats cache incrementally
- Docs & tooling: new docs/ui-ux-spec.zh-CN.md (refresh/copy feedback, motion fallbacks, refresh-entry inventory) and icon/screenshot guidance in the plugin development guide; pnpm plugin-skill:docs generates the SDK reference from the TS AST with a consistency test; Cargo.lock and all three version files synced to 1.0.7`,
    },
  },
  {
    version: "1.0.6",
    date: "2026-09-22",
    content: {
      zh: `✨ 新功能
- **会话内容全文搜索**：⌘L 搜索弹窗在标题匹配之外新增消息正文匹配（FTS5 trigram 索引 + 后台增量索引），支持相关性 / 最近排序与索引进度提示，短词回退 LIKE 精确匹配
- **会话内搜索**：⌘F 在当前会话中查找消息并逐条跳转高亮，快捷键可在设置中改绑
- **内置斜杠命令**：/new、/clear、/compact 由前端直接处理，斜杠选择器新增「内置」分组；同名 catalog 命令仍优先，压缩期间状态条显示 Compacting context…
- **提问卡片打通更多引擎**：Codex / Grok 走 CLI 自有传输（app-server / ACP），Kimi 走 ACP elicitation 表单，pi 由内置 ask-bridge 扩展提供 ask_user 工具，omp 切 rpc-ui 模式，DSH 与 OpenCode 分别经 $events/result 与托管 server 应答
- **多选题轮次体验重做**：选项可再次点击取消，单选答完自动跳到下一道未答题，未答完时 Enter 跳题并提示剩余题数；多选在本地收集后一次提交（失败可回退重答）；协议只接受预置选项时不渲染自由输入
- **推理强度全引擎贯通**：所有 CLI 统一注入请求级 effort，并原样下发（xhigh / ultra 不再被改写成 max / high）；新建会话默认 medium，修复切换推理强度实际不生效
- **幕布显示真实模型与档位**：读取 run 实际上报的 model / effort，不再沿用虚假的初始请求参数
- **设置页改为全屏**：覆盖层弹窗换成全屏 SettingsShell，侧栏支持搜索过滤与分组折叠（折叠状态持久化），重新分组为系统 / 插件 / CLI 管理 / 工作区与数据 / 其他，未安装与未启用独立成组
- **变更面板撤销更改**：未暂存与未跟踪文件支持单个撤销与「全部撤销」，均经危险确认；索引内文件等价 git restore --worktree，未跟踪文件等价 git clean，已暂存组不提供撤销
- **变更面板跟随嵌套仓库**：跟随文件树选中进入子仓库时，头部显示仓库名徽标，避免在不知情下对非根仓库 stage / commit
- **终端增强**：输出中的绝对路径可点击在文件管理器中显示；选中文本支持右键复制
- **用量统计新增本年 / 总和**：总和读取全部台账（不再被 365 天窗口截断），图表横轴随之切换——本年按月、总和按 CLI 分柱
- **渠道选择器改进**：供应商改为限定高度下拉框并支持输入筛选，切换渠道立即刷新该渠道映射的模型，无渠道引擎不再显示空筛选框，引擎面板改为点击切换以免误换面板
- **DSH 图片附件**：支持粘贴 / 选择 / 拖入图片；自定义 llm-pi-ai 路由由 ccgui 在发送前自动声明图片输入能力
- **Linux 新增 .rpm 安装包**（zstd 压缩，需 rpm ≥ 4.14），README 增补十引擎功能兼容矩阵
- **插件 SDK 0.3.12 / 0.3.13**：新增侧栏导航项（ui:sidebar-entry）、中心页签（ui:center-tab）与插件 agent 轮次（agent 权限，事件走独立 plugin-agent://event 流，不被聊天 Stop 误杀）；新增 @ccgui/plugin-ui 共享组件库
- 打开 .md 文件默认进入预览模式；CSP 放开 https: 图片，远程图片可直接显示

🐛 修复
- 选中文字后拖动导致页面锁死：显式释放 pointer capture，拖拽结束时清理 window 事件监听器
- 并发槽位泄漏：任务 panic 或被丢弃时经 Drop 兜底清理 run 条目与虚拟运行守卫，不再钉住槽位直到应用退出（too many concurrent runs）
- 插件启动期拿不到当前会话：会话激活事件支持粘性回放，引擎选择器切换待发会话时也会广播
- pi stdin 缺终止换行导致解析失败的警告横幅
- 上游 400 错误横幅显示原始 JSON：改为可读文案
- 变更面板未跟踪文件预览为空；diff 移出 IPC 主线程并加 2 MiB 上限，大文件不再阻塞界面
- git 远程认证失败返回误导性的 libgit2 报错：改为可操作错误，并正确解析 macOS osxkeychain 凭据助手
- 分支下拉菜单在外部 checkout 后点击无效：改用实时分支名判断当前分支
- 拉取 / 推送按钮补齐与刷新一致的成功对号反馈
- 远程 WebUI 窄屏下右侧文件面板被裁掉一半：改为整行宽浮层展开
- 变更面板行布局简化：状态 | 路径 | 自适应 stats，去掉空置尾列
- Windows CI 换行与路径转义相关测试修复；内置智能体提示词固定 LF，发布流程补哈希门禁
- react-doctor 体检问题全量修复（评分 76 → 100）

🧹 内部优化
- 后端：引擎新增 Transport / host_command 抽象与 set_stdin，codex / grok / kimi / opencode 拆出独立会话适配模块；历史新增 FTS5 检索
- 前端：设置壳层重写，时间线搜索抽为 useTimelineSearch，中心页签抽为 center-tabs，render 期 ref 写入全部移入 effect
- 仓库清理：移除入库的 CI 验证产物（约 52 MB）并加入 .gitignore；渠道家族模型映射改按 ANTHROPIC_DEFAULT_*_MODEL 的 key 模式派生
- CI：新增 PR 目标分支守卫（非发布分支禁止直提 main）与 PR 模板，Windows 发布打包前先跑 cargo test --lib
- Computer Use 后端能力落地（OMP 的 MCP 注入、macOS AX 无障碍树交互、虚拟光标覆盖层），前端入口因尚未打磨好暂先下线`,
      en: `✨ Features
- **Full-text search across messages**: the ⌘L palette now matches message bodies on top of titles (FTS5 trigram index with background incremental indexing), with relevance/recency sorting and an indexing-progress hint; short tokens fall back to a LIKE exact match
- **Search within a session**: ⌘F finds messages in the open session and steps through matches with highlighting; the shortcut is remappable in Settings
- **Built-in slash commands**: /new, /clear, and /compact are handled by the front end, with a new "Built-in" group in the slash picker; same-named catalog commands still win, and compaction shows "Compacting context…" in the status bar
- **Question cards reach more engines**: Codex and Grok answer through their own transports (app-server / ACP), Kimi through ACP elicitation forms, pi via the bundled ask-bridge extension exposing an ask_user tool, omp in rpc-ui mode, and DSH / OpenCode through $events/result and managed-server replies
- **Multi-select rounds reworked**: options can be deselected, a single-select answer advances to the next unanswered question, Enter jumps ahead when questions remain (with a remaining-count hint), multi-select answers are collected locally and submitted as one batch with rollback on failure, and cards omit free-text input when the protocol accepts declared options only
- **Reasoning effort across every engine**: request-level effort injection for all CLIs, passed through verbatim (xhigh / ultra are no longer rewritten to max / high); new sessions default to medium, fixing switching that silently did nothing
- **Curtain shows the real model and effort**: it reads the run's reported model/effort instead of the original request parameters
- **Fullscreen Settings**: the overlay modal becomes a fullscreen shell with rail search, collapsible groups whose state persists, and regrouping into System / Plugins / CLI management / Workspace & data / Other, with not-installed and disabled CLIs as their own groups
- **Discard changes**: unstaged and untracked files can be discarded one by one or via a group-level "Discard all", both behind a danger confirmation (tracked files restore the worktree, untracked files are deleted, the staged group offers no discard)
- **Changes panel follows nested repos**: when the panel follows the file tree into a submodule it shows a repository badge, so a stage/commit never silently targets a non-root repo
- **Terminal improvements**: absolute paths in output are clickable and reveal in the file manager; selected text has a right-click copy menu
- **Usage: this year / all time**: the all-time range reads the whole ledger (no longer truncated at 365 days) and the chart re-bases its axis — per month for the year, per CLI for all time
- **Channel picker improvements**: providers move into a height-capped, filterable dropdown, switching a channel refreshes that channel's mapped models immediately, engines without channels no longer render an empty filter box, and the engine panel switches on click instead of hover
- **DSH image attachments**: paste, pick, or drop images; for custom llm-pi-ai routes ccgui declares image input before sending
- **Linux .rpm package** (zstd-compressed, requires rpm ≥ 4.14), plus a ten-engine feature compatibility matrix in the README
- **Plugin SDK 0.3.12 / 0.3.13**: sidebar nav entries (ui:sidebar-entry), center tabs (ui:center-tab), and plugin agent runs (agent permission; events on a separate plugin-agent://event stream that chat's Stop cannot kill); new shared @ccgui/plugin-ui component package
- .md files open in preview mode by default; the CSP allows https: images so remote images render

🐛 Fixes
- Dragging selected text could lock the page: pointer capture is released explicitly and window listeners are cleaned up when a drag ends
- Concurrent-slot leak: panicking or dropped runs now clean up through Drop (plus a virtual-run guard), so a stale slot no longer blocks new sessions with "too many concurrent runs"
- Plugins couldn't read the active session during startup: session activation events now support sticky replay and are broadcast when the engine picker switches a pending session
- pi's stdin lacked its terminating newline, producing parse-failure warning banners
- Upstream 400 errors showed raw JSON in the banner; they now render a readable message
- Untracked files previewed as empty; diff generation moved off the IPC thread and is capped at 2 MiB, so large files no longer block the UI
- git remote authentication failures surfaced a misleading libgit2 error; they now return an actionable message and parse the macOS osxkeychain credential helper
- The branch dropdown no-op'd after an external checkout because it compared a stale branch name
- Pull/push buttons now show the same success check feedback as refresh
- A narrow remote WebUI clipped the right-side file panel; it now expands as a full-width overlay
- The changes panel row layout is simplified to status | path | self-sizing stats, dropping the empty trailing column
- Windows CI line-ending and path-escaping tests fixed; bundled agent prompts are pinned to LF with a hash gate in the release workflow
- react-doctor findings fixed across the board (score 76 → 100)

🧹 Internal
- Backend: engines gain a Transport / host_command abstraction with set_stdin; codex, grok, kimi, and opencode move to dedicated session adapters; history gains FTS5 search
- Frontend: settings shell rewritten, timeline search extracted into useTimelineSearch, center tabs extracted, and all render-phase ref writes moved into effects
- Repo hygiene: removed ~52 MB of committed CI verification artifacts and gitignored them; channel family-model mapping now derives from the ANTHROPIC_DEFAULT_*_MODEL key pattern
- CI: PR target-branch guard (non-release branches cannot open PRs against main) with a PR template; Windows releases now run cargo test --lib before packaging
- Computer Use backend landed (OMP MCP injection, macOS AX-tree interaction, virtual-cursor overlay) while the front-end entry is withdrawn for now pending polish`,
    },
  },
  {
    version: "1.0.5",
    date: "2026-09-19",
    content: {
      zh: `✨ 新功能
- **内置浏览器标签页**：应用内打开网页，原生子 webview 渲染；地址栏与页签标题跟随真实导航，target=_blank 链接改为当前页签内打开，页签关闭即销毁 webview
- **会话归档**：侧栏右键菜单归档会话，设置页新增「归档会话」管理面板，可查看与恢复
- **会话搜索弹窗**：侧栏顶栏搜索框退役，改用搜索图标或 ⌘L 打开会话标题搜索弹窗
- **启动脚本**：按工作区配置启动脚本，可从会话工具区快速运行
- **图片预览增强**：图片灯箱查看器，支持消息与附件图片放大浏览
- **工作区右键新建**：文件树与工作区支持右键新建文件 / 文件夹
- **Markdown GitHub 风格 alert**：支持 > [!NOTE] / [!WARNING] 等提示框，极简左边线样式
- **输入框拖拽文件回归**：图片拖入转为附件，其他文件插入 @引用
- **删除确认气泡**：删除会话等危险操作改为就地气泡确认
- **检查更新反馈**：已是最新时明确展示版本号与发布日期，结果不再 2 秒消失
- 侧栏新增置灰的「自动化」入口，悬停 / 点击提示「即将开放」
- 插件 SDK 0.3.11：修复 registerComposerSlot 权限漂移——自 0.3.9 改名后仍校验旧字符串 ui:composer 导致任何声明都被拒绝，改为校验 ui:composer-status

🐛 修复
- 折叠长消息改为裁剪高度，不再残留淡出残影
- 失败会话的历史索引与删除：失败会话可被正确索引并彻底删除
- 长用户消息气泡不再向左溢出
- 上下文用量表盘分子卡在整轮累加值，恢复实时按 token 更新
- 引擎进程注册表泄漏：中断 / 退出路径正确注销进程句柄
- 移动端网页模式移除「添加工作区」入口
- 「关于」页移除重复的版本记录入口

🧹 内部优化
- 后端模块化拆分：引擎拆出 reader / registry / events，历史发现与扫描分离，Web 后端拆出 dispatch 层
- 聊天 store 拆分为 composer / sessions / tabs / workspaces / messaging 等模块
- 插件市场页面精简`,
      en: `✨ Features
- **Built-in browser tabs**: open web pages inside the app via native child webviews; the address bar and tab title follow real navigations, target=_blank links navigate the current tab, and closing a tab destroys its webview
- **Session archive**: archive sessions from the sidebar context menu, with a new "Archived sessions" pane in Settings to browse and restore them
- **Session search palette**: the sidebar top-bar search field is retired — open session title search via the search icon or ⌘L
- **Launch scripts**: per-workspace startup scripts, runnable from the session toolbar area
- **Image preview upgrade**: lightbox viewer for message and attachment images
- **Workspace right-click create**: create files/folders from the file tree and workspace context menus
- **GitHub-style Markdown alerts**: > [!NOTE] / [!WARNING] and friends, rendered with a minimal left-border style
- **Composer file drag-and-drop returns**: dropped images become attachments, other files insert @ references
- **Delete confirmation popover**: destructive actions like session deletion now confirm in place
- **Update check feedback**: "already up to date" now shows the version and release date and no longer vanishes after 2 seconds
- Sidebar gains a greyed-out "Automation" entry with a "coming soon" hint
- Plugin SDK 0.3.11: fixes registerComposerSlot permission drift — it still validated the old ui:composer string after the 0.3.9 rename, rejecting every manifest; it now checks ui:composer-status

🐛 Fixes
- Collapsed long messages clip their height instead of leaving a fading ghost
- Failed sessions are correctly indexed in history and can be fully deleted
- Long user message bubbles no longer overflow to the left
- Context-usage gauge numerator no longer sticks at the whole-turn cumulative value; it updates per token again
- Engine process registry leak: interrupt/exit paths now deregister process handles
- Mobile web mode no longer shows the "add workspace" entry
- Removed the duplicate version-history entry on the About page

🧹 Internal
- Backend modularization: engine split into reader / registry / events, history discovery separated from scanning, Web backend gains a dispatch layer
- Chat store split into composer / sessions / tabs / workspaces / messaging modules
- Plugin marketplace page simplified`,
    },
  },
  {
    version: "1.0.4",
    date: "2026-09-18",
    content: {
      zh: `✨ 新功能
- **claude 弹窗提问（AskUserQuestion）**：支持控制协议双向应答；未决提问以悬浮层覆盖输入框，支持单选 / 多选、多问题翻页、自由输入作答与「忽略」，答完转为只读历史行
- **内置 Agents 目录**：打包 agency-agents 资源，设置页新增内置 Agents 面板；composer 支持 @ 选择 agent、/ 选择 prompt 的触发菜单
- **状态栏分支跟随嵌套仓库**：文件树选中子仓库内的文件 / 文件夹时，分支胶囊、分支列表与检出跟随该仓库（显示「仓库名·分支」）
- 插件 SDK 0.3.7 / 0.3.9 / 0.3.10：新增 ctx.sessions.refresh（插件直写后即时刷新侧栏）、ctx.ui.registerComposerStatusItem（composer 状态项）、ctx.sessions.setEffort（插件修改会话推理强度）

🐛 修复
- 推理强度切换对已有会话无效：多余调用污染 tab 字段导致回退到引擎默认值
- 新建空会话（「新对话」页签）不在侧栏显示；折叠文件夹后恢复短列表
- 消息文件链接在嵌套工程下解析失败：新增索引回退（含 gitignore 产物）；@ 提及路径统一规范形，Windows 路径可渲染为 chip 并往返
- Windows「在资源管理器中显示」含空格路径静默跳到「文档」：改用 raw_arg 原样传递 /select 参数
- 快速回合先于 send 返回即完成时的路由丢失：桌面与 web IPC 预分配 run ID
- Claude / Kimi 渠道路由与原生别名互相污染：settings 白名单透传、渠道注入字段剥离、保留 CLI provider 配置
- 引擎进程 run_id 原子预留消除中断 TOCTOU 窗口；启动时清扫 claude-staging / grok-staging 残留目录

🧹 内部优化
- 行为保持型重构清零 react-doctor 13 条警告：composer / 侧栏 / 会话页签条等组件拆分与状态模式修正`,
      en: `✨ Features
- **claude AskUserQuestion popups**: control-protocol two-way answering; pending questions overlay the composer with single/multi-select, multi-question paging, free-text answers, and "Ignore"; answered questions become read-only history rows
- **Built-in Agents catalog**: agency-agents bundled as a resource with a new Settings pane; composer trigger menus for @ agent and / prompt selection
- **Status-bar branch follows nested repos**: selecting a file/folder inside a nested git repo switches the branch pill, branch list, and checkout to that repo (shown as "repo·branch")
- Plugin SDK 0.3.7 / 0.3.9 / 0.3.10: new ctx.sessions.refresh (instant sidebar refresh after direct writes), ctx.ui.registerComposerStatusItem (composer status items), ctx.sessions.setEffort (change session reasoning effort)

🐛 Fixes
- Effort switching had no effect on existing sessions: a stray call polluted the tab field and fell back to the engine default
- Empty new chats ("New chat" tabs) didn't appear in the sidebar; collapsing a folder restores the short recent list
- Message file links failed to resolve in nested projects: new index-based fallback (including gitignored build artifacts); @ mention paths normalized so Windows paths render as chips round-trip
- Windows "Show in Explorer" silently jumped to Documents for paths with spaces: pass the /select argument verbatim via raw_arg
- Fast turns completing before send returns lost routing: run IDs are preassigned across desktop and web IPC
- Claude/Kimi channel routing no longer pollutes native aliases: settings passed via allowlist, channel-injected fields stripped, CLI provider configs preserved
- Engine run_id reservation is now atomic, closing the interrupt TOCTOU window; stale claude-staging / grok-staging directories cleaned at startup

🧹 Internal
- Behavior-preserving refactor clearing 13 react-doctor warnings: composer / sidebar / session tab strip component splits and state-pattern fixes`,
    },
  },
  {
    version: "1.0.3",
    date: "2026-09-16",
    content: {
      zh: `✨ 新功能
- Windows 可切换**仿 macOS 自绘标题栏**
- 侧栏工作区行可**拖拽**到分组 / 未分组 / 已归档完成移动
- 插件 SDK 0.3.5 / 0.3.6：新增会话右键菜单扩展点 ui:session-menu；ctx.ui.openSettings 让插件深链自身设置页

🐛 修复
- Windows 对话孙进程（pwsh/conhost）孤儿泄漏：改用 Job Object 内核级清扫，dsh host、登录 shell 探针、插件子进程一并封堵；Unix 侧同步清扫进程组
- 上下文窗口显示：/compact 后分母不再回落 200k；新会话记住引擎上报的窗口；claude 回合结束自动重读真实占用，无需手动「刷新用量」
- claude auto 模式联网被拦截：预批准 WebSearch / WebFetch
- 模型目录探测死循环风暴；DSH 客户端本机 origin 恒直连
- codex 旧 CLI 预检并给出可操作升级提示；stderr 为空时错误横幅兜底
- dsh / 远程会话删除修复：新增 delete_remote_session IPC，dsh 删除不再失败复活`,
      en: `✨ Features
- Windows can switch to a **macOS-style custom title bar**
- Sidebar workspace rows can be **dragged** into groups / ungrouped / archived containers
- Plugin SDK 0.3.5 / 0.3.6: new session context-menu extension point ui:session-menu; ctx.ui.openSettings deep-links a plugin to its own settings page

🐛 Fixes
- Windows grandchild process (pwsh/conhost) orphan leaks: Job Object kernel-level cleanup now covers conversations, the dsh host, login-shell probes, and plugin child processes; Unix sides sweep the process group as well
- Context window display: the denominator no longer falls back to 200k after /compact; new sessions remember the engine-reported window; claude turns auto-reread real usage on completion — no manual "refresh usage" needed
- claude auto mode network access blocked: pre-approves WebSearch / WebFetch
- Model catalog probe infinite loop storm; DSH client always connects directly for local origins
- codex legacy CLI preflight with an actionable upgrade hint; error banner falls back when stderr is empty
- dsh / remote session deletion fixed: new delete_remote_session IPC, dsh deletions no longer resurrect`,
    },
  },
  {
    version: "1.0.2",
    date: "2026-09-15",
    content: {
      zh: `✨ 新功能
- 接入 **OpenCode** 与 **Qoder** 两个一等引擎；Qoder 区分国际版与国内版（qoder-cn 兄弟引擎）
- **WSL 插件**全链接入：会话源 / 文件源 / UI 桥 / 远程历史回放 / 远程模型目录
- **快捷键系统迁移**：可配置键位、设置页录制编辑、快捷键指南
- 会话行**右键菜单**：重命名 / 复制 ID / 删除

🐛 修复
- 新会话不再被刷新冲掉：侧栏即时显示，无需手动同步
- Windows 检测不到新装 / 非 npm 渠道安装的 codex 与 claude
- claude 上下文窗口改读 CLI 上报值
- 放行 asset 协议在 Windows 上的可用 URL 形式，移除 CSP 冗余项
- 移动端设置导航分组溢出重叠
- WSL 接入安全审查修复：meta.wsl 全字段白名单、权限模型收紧、远程调用 30s 全局超时
- 发版增加版本输入校验门禁，修复 latest.json 资产名空格 404`,
      en: `✨ Features
- Two new first-class engines: **OpenCode** and **Qoder**, with Qoder split into Global and CN distributions (qoder-cn sibling engine)
- **WSL plugins** wired end to end: session source, file source, UI bridge, remote history replay, remote model catalog
- **Shortcut system migration**: configurable keybindings, recording editor in Settings, and a shortcut guide
- Session-row **context menu**: rename / copy ID / delete

🐛 Fixes
- New sessions no longer get wiped by refreshes — the sidebar shows them immediately, no manual sync
- Windows now detects freshly installed or non-npm codex and claude builds
- claude context window reads the value reported by the CLI
- Allow the Windows-usable asset-protocol URL forms in CSP and drop a redundant entry
- Mobile settings navigation groups no longer overflow and overlap
- WSL integration security review fixes: full meta.wsl field allowlist, tightened permission model, 30s global timeout for remote calls
- Release pipeline validates version input and fixes the latest.json asset-name space 404`,
    },
  },
  {
    version: "1.0.1",
    date: "2026-09-14",
    content: {
      zh: `✨ 新功能
- 右键文件夹**搜索工作区文件**
- OMP 引擎补 plan / bypass 权限档

🐛 修复
- 「已编辑」行数改从会话编辑调用统计
- 窄窗下侧边栏开关常显、幕布区留白修正、子代理行归并`,
      en: `✨ Features
- **Search workspace files** from a folder's right-click menu
- OMP engine gains plan / bypass permission tiers

🐛 Fixes
- "Edited" line counts now come from the session's edit-call stats
- Narrow windows keep the sidebar toggle visible, fix backdrop gaps, and merge subagent rows`,
    },
  },
  {
    version: "1.0.0",
    date: "2026-09-08",
    content: {
      zh: `✨ 新功能
- 接入 **OMP 引擎**（pi-family 参数化复用 + 全链路接线）
- 新增 **局域网网页访问**：WebSocket 桥接 + 设置页二维码入口，手机浏览器可直接使用
- **Pi 家族引擎认证**：OAuth 订阅授权与 API Key 管理、cc-switch 渠道导入与切换
- **AI 聊天输入区增强**：@ 提及、权限 / effort 档位、分支菜单、提示历史补全
- 消息锚点导航、Provider 配置对话框与引擎 / 历史层增强
- 首页外观设置与交互粒子字标

🐛 修复
- Windows 上派生子进程不再弹出控制台窗口`,
      en: `✨ Features
- Add the **OMP engine** (parameterized reuse of the pi-family pipeline, wired end to end)
- **LAN web access**: WebSocket bridge + QR entry in Settings, so phones on the same network can use CC GUI in a browser
- **Pi-family engine auth**: OAuth subscription sign-in and API Key management, cc-switch channel import and switching
- **Composer upgrades**: @ mentions, permission / effort tiers, branch menu, prompt-history completion
- Message anchor navigation, provider configuration dialog, and engine/history layer improvements
- Home appearance settings with an interactive particle wordmark

🐛 Fixes
- Spawned child processes no longer show console windows on Windows`,
    },
  },
  {
    version: "0.9.4",
    date: "2026-08-30",
    content: {
      zh: `✨ 新功能
- 侧栏工作区子项增加树状连接线，会话重载收敛为强制同步并加重载忙碌态
- 设置新增 **侧栏网络代理抽屉**
- 文件底部状态栏新增 **Git Blame** 切换按钮

🐛 修复
- 修复 pi 多原生 turn 交错下「响应中」卡死、重复叙述与完成音连响
- 修复 Windows 单文件「差异不可用」死路
- 修复新建会话抽屉卡死

⚡ 性能
- live 工具输出增加渲染预算，会话条目缓存驱逐加入近期切换保护`,
      en: `✨ Features
- Sidebar workspace children get tree lines; session reload converges to a forced Session Index sync with a busy state
- New **network proxy drawer** in Settings
- **Git Blame** toggle in the file status bar

🐛 Fixes
- Fix pi sessions stuck in "running" with duplicated narration when native turns interleave
- Fix the Windows single-file "diff unavailable" dead end
- Fix the new-session drawer freeze

⚡ Performance
- Render budget for live tool output; recent-switch protection for session-entry cache eviction`,
    },
  },
  {
    version: "0.9.3",
    date: "2026-08-26",
    content: {
      zh: `🐛 修复
- PI catalog 探测跳过 extension boot 并放宽预算至 15s，根除 auto-only 降级
- Codex usage 事件不再伪造 200K 上下文窗口
- 新增孤儿 turn 零首事件看门狗，防止「响应中」永久卡死
- process_is_alive 增加 Windows 平台分支
- client store 写盘改 raw-string 过桥，遏制 markdown worker 崩溃循环`,
      en: `🐛 Fixes
- PI catalog probing skips extension boot with a 15s budget, eliminating auto-only degradation
- Codex usage events no longer fabricate a 200K context window
- Orphan-turn zero-first-event watchdog prevents sessions stuck in "running" forever
- Windows branch for process_is_alive
- Client store writes cross the bridge as raw strings, stopping markdown-worker crash loops`,
    },
  },
  {
    version: "0.9.2",
    date: "2026-08-22",
    content: {
      zh: `✨ 新功能
- 接入 **Qoder** Global 与 CN 双分发，落地 profile 限定的 Native 会话身份解析
- 会话 catalog 与 provider binding 全面携带分发归属

🐛 修复
- 修复多智能体协作模板选择器卡在加载中
- Shared 链路按 Target 认主并隐藏下崽会话`,
      en: `✨ Features
- **Qoder** Global and CN distributions, with profile-qualified native session identity resolution
- Session catalog and provider binding now carry distribution attribution throughout

🐛 Fixes
- Fix the multi-agent template picker stuck loading
- Shared sessions resolve ownership by target and hide child sessions`,
    },
  },
  {
    version: "0.9.1",
    date: "2026-08-19",
    content: {
      zh: `✨ 新功能
- DSH 接入 composer **Agent Preset** 选择器

🐛 修复
- DSH 按会话隔离 Agent Preset 展示，接通任务条与上下文占用
- 收敛长对话尾部重复的用户气泡
- 隐藏 Shared 协议续跑会话及其侧栏子会话`,
      en: `✨ Features
- DSH gets an **Agent Preset** picker in the composer

🐛 Fixes
- DSH Agent Presets are isolated per session; task bar and context usage are wired up
- Collapse duplicated user bubbles at the tail of long conversations
- Hide Shared-protocol resumed sessions and their sidebar children`,
    },
  },
];
