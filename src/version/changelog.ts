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
    version: "1.1.7",
    date: "2026-10-26",
    content: {
      zh: `✨ 新功能
- **接入 CodeBuddy CLI 引擎（第 13 个一等引擎）**：新增 codebuddy 适配器，聊天引擎选择、设置 → CLI 管理、模型选择器、推理强度、MCP 页与品牌图标都按既有数据驱动入口出现，设置页另有 codebuddyBin 自定义路径。启动走 codebuddy -p 的 stream-json 输入 / 输出（--verbose --include-partial-messages），事件解析复用 claude 解析器；续跑用 -r，图片沿用 claude 的 stdin 消息结构。权限模式只提供 auto / plan / bypass——headless 没有 --permission-prompt-tool，manual 会被静默拒绝而不是询问，所以选择器不暴露该项；工具约束 fail-closed：--permission-mode plan + --tools 白名单 + 单次 --allowedTools（MCP 预批准工具并入同一组，避免重复 flag 的 last-wins 覆盖用户白名单）+ 对 Bash / PowerShell / Edit / Write / NotebookEdit / Task / Agent / Workflow / TeamCreate 的 --disallowedTools 兜底，空白名单直接报错。推理强度走 --effort，界面顶层 ultra 映射 CLI 的 max，其余档位原样透传，不支持的值由 CLI 自己报错。computer-use / memory 的 MCP 配置与渠道 --settings 覆盖都写进 0600 私有暂存文件，argv 里不出现 API Key，子进程结束清理、启动时 sweep_staging_dirs 兜底残留。
- **CodeBuddy 的模型、渠道与账号状态**：模型目录优先跑 codebuddy --help 解析 Currently supported 列表，把 settings.local.json / settings.json 里的 model 或 env.CODEBUDDY_MODEL 放到首位（不在探测结果里也补进来）；探测失败回落到静态目录并保留配置默认模型，没有 home 目录时降级而不是 panic。渠道键为 CODEBUDDY_BASE_URL / CODEBUDDY_API_KEY / CODEBUDDY_MODEL；baseUrl 能唯一确定版本族时补 CODEBUDDY_INTERNET_ENVIRONMENT（copilot.tencent.com → internal、tencent.sso.copilot.tencent.com → ioa），按解析后的 host 精确匹配，避免相似域名或代理 URL 被误判到另一套鉴权端点，显式 env 仍优先；官方配置仍是 ~/.codebuddy/settings.json（认 CODEBUDDY_CONFIG_DIR）并可在设置页编辑。账号登录把交互流程交给内置终端：打开专用页签，等 CLI 真正接管屏幕后才输入 /login，两次写入都 await，任一失败只关闭本次新建页签并如实报错；没有活动工作区时提示先打开工作区，不回退到侧栏首个工作区。登录状态对系统凭据存储做只读存在性探测（macOS security find-generic-password、Windows cmdkey /list、Linux secret-tool search，Windows 探针隐藏控制台窗口），每个探针 1.5s 硬超时，结果缓存 30s，登录返回后强制绕过缓存；命中才显示「已登录」，未命中如实显示「状态未知」而不是「未登录」，IPC 失败与「检测中」分开。
- **CodeBuddy 历史会话与 MCP 只读接入**：历史索引 ~/.codebuddy/projects 的转录；目录名是 CLI 私有编码，按转录里的 cwd / sessionId 归属会话并兼容符号链接与别名路径，同 id 多副本取最新；头部读取按 mtime + size 缓存、只读新增或变更的文件，IO 失败不缓存并在下次重试，缺 sessionId 时回落文件名。删除会话清掉同 id 的所有副本，记录副本已损坏时按文件名匹配，读不出身份的同一文件名不误删。MCP 页只读接入 ~/.codebuddy/mcp.json、工作区 .codebuddy/mcp.json 与共享 .mcp.json（写语义尚未在真实 CLI 对拍，分别标 unverified_write / shared_project_file）。
- **新增独立韩语界面（한국어）**：设置 → 通用 → 语言保留「中文」「English」，第三项「한국어」使用独立的 ko 资源，不是覆盖 English 的翻译层；切换即时生效并保存到后端设置与启动缓存，重启恢复所选语言，html lang 同步为 zh-CN / en / ko。启动 watchdog 是独立经典脚本，按同一份语言缓存更新启动占位、失败标题、恢复说明与「重新加载」按钮，并同步 html lang——主模块加载失败时仍能恢复；存储不可用或缓存未知时回落中文。自动压缩的续跑行也识别韩语文案，不再把 ko 句子当普通用户消息。
- **侧栏「添加工作区」支持一次多选多个文件夹**：新增 pickDirectories，原生目录对话框带 multiple（macOS / Windows / Linux 均走 rfd 的 pick_folders），取消返回空数组；Web 访问模式没有目录对话框，仍回落为输入一个绝对路径。store.addWorkspaces 先 trim + 去重，再逐个登记，全部走完只重读一次列表——逐次重读会让侧栏一条条闪出来；单个目录失败不阻断其余目录，失败原因按行汇总进 actionError（错误条保留换行）。返回真正登记成功的路径列表，零工作区的「新建会话」据此取首个成功目录接着开出待发会话，全部失败才不产生标签页。按钮的 aria-label 仍是「添加工作区」，tooltip 改挂 chat.addWorkspaceHint 说明可多选。
- **工作区行显示仓库的 GitHub 头像**：新增 git_workspace_owners，批量从工作区的 origin 远端解析 github.com 账号（Repository::discover，因此开在仓库子目录的工作区也能解析）。行首 24px 槽位在解析出账号时用 20px 头像（rounded-[5px]、referrerPolicy no-referrer）盖住文件夹图标，悬停仍换成排序握把、点击仍切换展开；没有 origin、远端不是 github.com、不是 git 仓库，以及加载中 / 加载失败都回落到文件夹图标，不猜头像也不出破图。失败按 URL 记录，行被回收换工作区后会重新尝试。解析结果按路径缓存（包括「已确认无头像」），同一提交里的多行合并成一次 IPC（0ms flush），IPC 失败不缓存、下次挂载重试；缓存驻留到本次运行结束，改了 origin 需要重启应用才换图。工作区分组收起时行保持挂载（SidebarDisclosure 的 keepMounted，收起后行留在 inert + aria-hidden 区域），展开复用同一 img、不会先闪回文件夹图标；行内线程列表照常收起卸载。头像 URL 构造抽到 src/lib/github-avatar.ts，插件市场的开发者头像复用同一实现（2× CSS 尺寸、上限 460）。
- **插件 SDK 0.3.21：选择资源文件并授权其父目录**：新增 ctx.assets.grantFile(options?)，沿用 assets:directory 权限且只能由明确的用户操作触发；用户选中一个文件后授权整个父目录并返回 { grantId, path, relativePath }，relativePath 可直接传给 directoryUrl；取消返回 null、不产生授权，选择器或路径校验失败保持 rejection。默认标题同时说明「选择文件」和「允许插件读取其父目录」，插件自定义 title 也须保留授权语义；filters 只是类型筛选，不是内容校验或授权边界。后端在探测前复核插件状态与权限：必须是已存在的普通文件、绝对路径、UTF-8 文件名，拒绝控制字符、storage 路径校验不通过的名字（Windows 保留名、尾点等）以及符号链接 / reparse 路径，非法选择绝不留下目录授权；父目录走与 grantDirectory 同一条授权链路（敏感目录黑名单、16 个目录上限、去重、撤权、逐次读取复核）。桌面用宿主原生选择器，Web 输入宿主绝对文件路径，不以浏览器上传冒充宿主授权。SDK 同步更新 plugin.d.ts、context、contract-check、CHANGELOG 与插件开发指南，并重新生成内置插件开发 skill 的 sdk-api.md。
- **Pi / OMP 订阅支持登出**：订阅授权行只在已授权时显示登出入口——OMP 是「登出」，Pi 是「前往登出」。OMP 经确认后在新终端页签执行 omp auth-broker logout <providerId>；Pi 经确认后打开 CLI 的 /logout 选择器，由用户在 CLI 里选账号，不替用户决定。确认框写明影响范围（同一供应商的已授权账号都可能受影响），没有活动工作区时提示先打开项目。终端命令发出不等于登出成功：launch 后每秒重读一次凭据，只有该行的全部凭据 id 都消失才算完成，最多等 60s，超时绝不计为成功；凭据变化时通知 CLI 配置已更新。终端写入失败会抛错并如实提示，不做静默成功。

🐛 修复
- **流式对话里过程组在工具边界反复收起、展开**：思考每次 settle（工具调用边界）就把过程组折叠，思考恢复后又展开；上一版把折叠做成粘性后，运行中的具体过程又一直不可见。现在按轮次计算每个过程组后面是否已有 assistant 文字（MessageTimeline 反向扫描，用户消息 / 幕布行重置）：运行中（思考 settle / 恢复、工具执行）保持展开，回答文字出现在其后或本轮结束（无回答文字）时才折叠；新过程组照常自动展开，旧的退居历史后收起；用户手动展开 / 收起仍优先；关闭「思考结束后自动收起」则不自动折叠。补齐运行中、回答开始、轮次结束、跨轮次边界与手动覆盖用例。
- **远程 Web / 中继端插件存储写入落到 unknown command**：远程页面（无 __TAURI_INTERNALS__）加载已安装插件时，ctx.storage.set / delete 发出的 plugin_storage_set / delete 不在 web dispatch 白名单里，插件普遍 fire-and-forget 调用写入，拒绝无人 catch，最终触发 unhandledrejection 崩溃上报。web dispatch 现在路由这两个命令，参数结构与桌面命令一致，仍经过 storage_write_guard 的 enabled / quarantined 校验，写入落桌面同一份 SQLite KV，手机端不再与桌面状态分叉；install / uninstall / enable 仍保持桌面专属。
- **打包后的 .app 一启动就崩溃（libgit2 动态链接）**：开发机装了 Homebrew libgit2 时，pkg-config 会让构建结果链接 /opt/homebrew 下的 libgit2.1.9.dylib；发布包的 dyld 库校验会因该 dylib 的 Team ID 不同而拒绝加载。为 git2 打开 vendored-libgit2（与已有的 openssl-sys vendored 处理一致），构建自带 libgit2，不再依赖本机 Homebrew 安装。
- **agent 写尚未创建目录下的文件时授权拿不到实际生效的根**：canonicalize 直接失败，退回只解析一层父目录也会失败；即便授予成功，引擎也会跳过不存在的额外根，agent 又没有权限自己建目录。canonicalize_lenient 改为逐级解析最近的已存在祖先，只把确实不存在的名称拼回去；悬空符号链接不算缺失、直接报错，避免按词法尾部逃出根，缺失目录后的 .. 也不被词法吞掉。grant_root 在写入授权前 create_dir_all 目标目录，授权后 ensure_allowed 立即成立。新增多级缺失目录、缺失目录后的 ..、悬空符号链接三个用例。

🧹 内部优化
- ui-ux-spec 更新到 v0.91：v0.87 登记「添加工作区」多选（逐个登记、只重读一次、部分失败不吞），v0.88 登记工作区头像与分组 keepMounted，v0.89 登记过程组的收起时机，v0.90 登记 CodeBuddy 引擎 / 登录 / 历史 / MCP，v0.91 收紧 CodeBuddy 登录反馈（无活动会话不回退、专用页签、写入与 ready 等待都有明确成败、跨导航强制探测、按宿主 shell 转义）。韩语、插件 grantFile 的规则同批更新到 §2、§3。
- 新增实现：engine/codebuddy.rs（含渠道 overlay 与私有暂存、账号探测与缓存）、engine/models/codebuddy.rs、settings/terminalLogin.ts 与 codebuddyLogin.ts、CodeBuddyAuthSection.tsx、terminal.rs 的 terminal_host_info、provider_files.rs 的 codebuddy 官方配置与 INTERNET_ENVIRONMENT 推导、mcp/sources 的三个 codebuddy 只读来源、history 的 codebuddy 发现 / 提取 / 删除、workspace-avatars.ts、workspace-avatar.tsx、github-avatar.ts、pickDirectories / addWorkspaces、i18n/ko.ts 与 boot-watchdog 的三语启动文案。
- 回归用例：Rust 侧 CodeBuddy 30 项、history 152 项、files 33 项与 git 的 workspace_owners 用例；前端 CodeBuddyAuthSection / codebuddyLogin / terminalLogin、Pi / OMP 登出、use-chat-sidebar 的多选与部分失败、workspace-avatars / workspace-avatar / ai-chat-sidebar 的挂载、ProcessDisclosure / MessageTimeline 的折叠时机、boot-locale、i18n 的三语与未知语言回落、插件 context 的 grantFile 与 contract-check。
- 版本号对齐到 1.1.7（package.json / src-tauri/Cargo.toml / tauri.conf.json / Cargo.lock）；插件 SDK 同步到 0.3.21，内置插件开发 skill 的 sdk-api.md 由 pnpm plugin-skill:docs 重新生成。`,
      en: `✨ Features
- **CodeBuddy CLI joins as the 13th first-class engine**: a new codebuddy adapter appears through the existing data-driven entries — the chat engine picker, Settings → CLI, the model picker, effort levels, the MCP page and the brand icon — plus a codebuddyBin custom path in Settings. Launches use codebuddy -p with stream-json input / output (--verbose --include-partial-messages) and reuse the claude parser for events; resume uses -r and images keep claude's stdin message shape. Permission modes are limited to auto / plan / bypass — headless CodeBuddy has no --permission-prompt-tool, so a manual mode would silently deny instead of asking, which is why the picker does not offer it. Tool constraints fail closed: --permission-mode plan + a --tools whitelist + a single --allowedTools emission (MCP pre-approved tools merged into the same group so a repeated flag's last-wins semantics cannot clobber the user whitelist) + a --disallowedTools backstop for Bash / PowerShell / Edit / Write / NotebookEdit / Task / Agent / Workflow / TeamCreate; an empty whitelist is an error, not a pass. Effort goes through --effort, with the UI's top level ultra mapped to the CLI's max while the other levels pass through and unsupported values fail loudly in the CLI's own output. The computer-use / memory MCP config and the channel --settings overlay are written to 0600 private staging files so no API key appears on argv; they are removed when the child exits and sweep_staging_dirs cleans up leftovers at startup.
- **CodeBuddy models, channels and account status**: the model catalog first runs codebuddy --help and parses the Currently supported list, moving the model configured in settings.local.json / settings.json (or env.CODEBUDDY_MODEL) to the front — adding it if the probe does not list it; a failed probe falls back to the static catalog with the configured default kept first, and a missing home directory degrades instead of panicking. Channel keys are CODEBUDDY_BASE_URL / CODEBUDDY_API_KEY / CODEBUDDY_MODEL; when the baseUrl pins down an edition, CODEBUDDY_INTERNET_ENVIRONMENT is filled in (copilot.tencent.com → internal, tencent.sso.copilot.tencent.com → ioa) by matching the parsed host exactly, so look-alike domains and proxy URLs are not pinned to the wrong auth family — explicit env still wins. The official config remains ~/.codebuddy/settings.json (honouring CODEBUDDY_CONFIG_DIR) and stays editable in Settings. Account login hands the interactive flow to the built-in terminal: it opens a dedicated tab, waits until the CLI actually owns the screen before typing /login, awaits both writes, and on any failure closes only the tab it created and reports the failure; with no active workspace it asks for one instead of falling back to the first workspace in the sidebar. Login status probes the OS credential store read-only (macOS security find-generic-password, Windows cmdkey /list, Linux secret-tool search, with the Windows probe suppressing its console window), each probe under a 1.5s hard deadline, cached for 30s and force-refreshed after login returns. Only a hit reports signed in; a miss says status unknown rather than signed out, and an IPC failure stays distinct from checking.
- **CodeBuddy history and read-only MCP sources**: history indexes the transcripts under ~/.codebuddy/projects. The directory names are a CLI-private encoding, so sessions are attributed by the cwd / sessionId recorded inside the transcript, with symlinked and aliased workspace paths supported and the newest copy winning when an id appears more than once; head reads are cached by mtime + size and only new or changed files are read, IO errors are not cached and retry next time, and a missing sessionId falls back to the file stem. Deleting a session removes every copy of that id; when the recorded copy is damaged it matches by file name, and a same-named file whose identity cannot be read is left alone. The MCP page adds three read-only sources — ~/.codebuddy/mcp.json, the workspace's .codebuddy/mcp.json and the shared .mcp.json — marked unverified_write / shared_project_file because write semantics have not been compared against the real CLI.
- **A standalone Korean UI (한국어)**: Settings → General → Language keeps 中文 and English and adds 한국어 backed by its own ko resource rather than a translation layer over English; switching applies immediately and is saved to the backend settings and the boot cache, restoring on restart with html lang synced to zh-CN / en / ko. The boot watchdog is a standalone classic script that reads the same language cache and localises the splash, failure title, recovery hint and Reload button plus html lang, so recovery still works when the main module never loads; unavailable storage or an unknown saved locale falls back to Chinese. The auto-compaction resume row also recognises the Korean string instead of treating it as an ordinary user message.
- **Add workspace picks several folders at once**: a new pickDirectories passes multiple to the native directory dialog (macOS / Windows / Linux all use rfd's pick_folders), and cancelling resolves to an empty list; web access mode has no directory dialog and still falls back to typing one absolute path. store.addWorkspaces trims and deduplicates, registers one path at a time and re-reads the list exactly once at the end — refreshing per path made rows pop in one by one. One failed directory never blocks the rest, and the failures are collected line by line into actionError (the banner preserves newlines). It returns the paths that really registered, so the zero-workspace New session flow opens the pending chat for the first successful folder and creates no tab when everything failed. The button's aria-label stays Add workspace; the tooltip now carries chat.addWorkspaceHint explaining multi-select.
- **Workspace rows show their repository's GitHub avatar**: a new git_workspace_owners resolves the github.com account behind each workspace's origin remote in one batch (Repository::discover, so a workspace opened on a repo subdirectory resolves too). When an account resolves, the 24px leading slot shows its 20px avatar (rounded-[5px], referrerPolicy no-referrer) over the folder glyph; hover still swaps in the reorder grip and a click still toggles. No origin, a non-GitHub remote, a non-repo directory, loading and failure all keep the folder glyph — no guessed avatars and no broken images. Failures are tracked per URL so a recycled row retries with its new workspace. Results are cached per path (including confirmed-empty), rows mounting in one commit share a single IPC call through a 0ms flush, and an IPC failure is not cached so the next mount retries; the cache lives until the app exits, so changing origin needs a restart to change the image. Collapsing a workspace group keeps its rows mounted (SidebarDisclosure keepMounted, rows stay behind inert + aria-hidden), so expanding reuses the same img and never flashes the folder glyph first; thread lists still unmount as before. The avatar URL builder moved to src/lib/github-avatar.ts and the plugin market's developer chips use the same implementation (2× CSS size, capped at 460).
- **Plugin SDK 0.3.21: pick a resource file and grant its parent directory**: new ctx.assets.grantFile(options?) keeps the assets:directory permission and may only run from an explicit user action. Selecting a file grants the whole parent directory and returns { grantId, path, relativePath }, where relativePath can go straight into directoryUrl; cancelling resolves null without granting, and selector or path validation errors stay rejections. The default title states both that a file is chosen and that the plugin may read its parent directory, and a plugin's custom title must keep that meaning; filters are a type filter, not content validation or an authorization boundary. The backend rechecks plugin state and permission before probing: the target must be an existing regular file at an absolute path with a UTF-8 name, and control characters, names rejected by the storage path validation (Windows reserved names, trailing dots and the like) and symlink / reparse paths are refused — an invalid selection never leaves a directory grant behind. The parent goes through the same grant path as grantDirectory (sensitive-directory blacklist, 16-directory cap, deduplication, revocation and the per-read recheck). Desktop uses the host picker; the web asks for an absolute host path rather than pretending a browser upload is host authorization. plugin.d.ts, context, contract-check, the CHANGELOG and the plugin development guide are updated, and the bundled plugin-creator skill's sdk-api.md was regenerated.
- **Pi and OMP subscriptions can sign out**: the subscription row only shows a sign-out entry while authorized — Sign out for OMP and Go to sign out for Pi. After confirmation OMP runs omp auth-broker logout <providerId> in a new terminal tab; Pi opens the CLI's /logout picker and lets the user choose the account, never choosing for them. The confirmation states the blast radius (every authorized account for that provider may be affected), and with no active workspace it asks for a project first. A terminal command is not proof of logout: after launch the credential store is re-read every second and the row only counts as signed out once every credential id for it is gone, waiting at most 60s — a timeout never counts as success; a change notifies that the CLI config changed. A failed terminal write throws and is reported instead of pretending success.

🐛 Fixes
- **Process groups folded and reopened at every tool boundary during streaming**: each thinking settle (a tool-call boundary) folded the group and resuming thinking reopened it; the previous sticky variant then hid the running process entirely. Each process run now records whether assistant text exists after it in the same turn (MessageTimeline scans backwards, resetting at a user message or curtain row): a running run (thinking settle / resume, tool execution) stays expanded, and it folds only when answer text appears after it or the turn ends with no answer; a new process run still auto-expands while older ones fold into history; a manual expand / collapse still wins, and turning off the auto-collapse option disables automatic folding. Regression cases cover running, answer start, turn end, cross-turn boundaries and manual overrides.
- **Plugin storage writes from remote web / relay fell through to unknown command**: on a remote page (no __TAURI_INTERNALS__) with installed plugins, ctx.storage.set / delete emitted plugin_storage_set / delete, the web dispatch allowlist only routed get, and plugins call writes fire-and-forget — the unhandled rejection became the web crash report. The dispatcher now routes both commands with the same argument shapes as desktop, still through storage_write_guard's enabled / quarantined check, and the writes land in the same desktop SQLite KV so mobile no longer diverges from desktop state; install / uninstall / enable remain desktop-only.
- **Packaged .app crashed on launch (dynamic libgit2)**: with Homebrew libgit2 installed, pkg-config made the build link /opt/homebrew/libgit2.1.9.dylib, and dyld library validation rejected that dylib's different Team ID at launch. git2 now enables vendored-libgit2 (matching the existing openssl-sys vendored treatment), so the build bundles libgit2 instead of depending on the machine's Homebrew install.
- **An agent writing under a directory nobody created yet could not get a working grant**: canonicalize failed, the one-level parent fallback failed too, and even a successful grant had no effect because engines skip missing extra roots and the agent cannot create one outside its allowed dirs. canonicalize_lenient now resolves the nearest existing ancestor and re-appends only the names that truly do not exist; a dangling symlink counts as an error rather than as missing (its lexical tail must not escape the root), and a .. after a missing directory is not swallowed lexically. grant_root creates the target directory with create_dir_all before recording the grant, so ensure_allowed holds immediately. New cases cover multi-level missing directories, .. after a missing directory and a dangling symlink.

🧹 Internal
- ui-ux-spec updated to v0.91: v0.87 registers multi-select Add workspace (one-by-one registration, a single list re-read, partial failures surfaced), v0.88 the workspace avatar and the group keepMounted rule, v0.89 the process-group fold timing, v0.90 the CodeBuddy engine / login / history / MCP, and v0.91 the tightened CodeBuddy login feedback (no workspace fallback, one dedicated tab, explicit success/failure for writes and the ready wait, forced re-probe across navigation, quoting for the host shell). The Korean and plugin grantFile rules landed in §2 and §3 in the same batch.
- New implementation: engine/codebuddy.rs (channel overlay, private staging, account probe with cache), engine/models/codebuddy.rs, settings/terminalLogin.ts and codebuddyLogin.ts, CodeBuddyAuthSection.tsx, terminal_host_info in terminal.rs, the codebuddy official config and INTERNET_ENVIRONMENT derivation in provider_files.rs, the three read-only codebuddy sources in mcp/sources, codebuddy discovery / extraction / deletion in history, workspace-avatars.ts, workspace-avatar.tsx, github-avatar.ts, pickDirectories / addWorkspaces, i18n/ko.ts and the three-language boot-watchdog messages.
- Regression coverage: CodeBuddy's 30 Rust cases, 152 history cases, 33 files cases and the git workspace_owners cases; on the frontend CodeBuddyAuthSection / codebuddyLogin / terminalLogin, Pi / OMP logout, use-chat-sidebar's multi-select and partial failure, workspace-avatars / workspace-avatar / ai-chat-sidebar mounting, ProcessDisclosure / MessageTimeline fold timing, boot-locale, i18n's three languages and unknown-locale fallback, and the plugin context grantFile / contract-check cases.
- Version synced to 1.1.7 (package.json / src-tauri/Cargo.toml / tauri.conf.json / Cargo.lock); the plugin SDK ships 0.3.21 and the bundled plugin-creator skill's sdk-api.md was regenerated by pnpm plugin-skill:docs.`,
    },
  },
  {
    version: "1.1.5",
    date: "2026-10-16",
    content: {
      zh: `✨ 新功能
- **字体设置新增「自定义字体族」，代码字体与字号统一到聊天代码 / 编辑器 / 差异视图 / 终端**：设置 → 通用 → 外观的「界面字体 / 代码字体」从两档变三档——系统默认、自定义（上传字体文件，行为不变）、自定义字体族。字体族分类在行内展开输入框（占位示例 "Maple Mono", monospace），接受本机字体名或逗号分隔的 CSS font-family 列表，失焦或 Enter 提交、Escape 撤销草稿；含分号 / 花括号 / 圆括号 / 控制字符、CSS 注释、font-family: 声明或 inherit / initial / unset / revert / revert-layer 这类全局关键字的值在本地拦下并给出错误，不改已保存值（浏览器解析不出的值同样算非法）；本机没装的字体族是合法值，按系统回退渲染。此前老字体选择器写下的「已安装字体名」会被归一成系统默认，现在按字体族生效。校验收在 font.ts 的 isValidFontFamily / normalizeFontMode 一处，根变量 --font-inter / --font-mono-source 改为只存选中的字体族，回退栈在 theme.css 统一追加（默认栈补上 emoji 与 Consolas / Liberation Mono）。代码区域统一消费 --font-mono 与代码字号：聊天行内代码与代码块、CodeMirror 的 .cm-scroller（它的 base theme 自己管 scroller 字体、不继承）、差异视图、内置终端；终端默认字号从固定 12 改为跟随代码字号（默认 13），并订阅新增的 ccgui:typography-change 事件。终端与编辑器的跟随路径一并补齐：字体 face 加载完成后重新量度（xterm 对相同 fontFamily 的赋值是 no-op，用一次探针栈把它推过公开的 option 路径再还原）、PTY 的 cols/rows 共用 150ms 防抖（字体与字号修改同样改变 cell 度量）、PTY 慢启动建立会话后补发一次最新尺寸、EditorPane 收到字体或排版事件只 requestMeasure 而不重建草稿。字体加载按角色加了版本号，晚到的旧加载结果不再注册 face。web 访问模式可以填字体族（按访问端本机解析），但没有文件上传。

🐛 修复
- **首启缺前提的四件事：新建会话接着开会话、发送键说明原因、空态分流、草稿不丢**：没有任何工作区时，侧栏「新建会话」（页签条 ＋ 与 ⌘N 同一入口）此前只弹一次目录选择器就结束——用户点的是新会话，拿到的是一次选目录，输入框依旧灰着，还得再点一次同一个按钮。现在登记目录成功后接着开出该目录下的待发会话（与 worktree 创建完成后的做法一致），取消或登记失败不产生任何标签页：store.addWorkspace 改为返回成功与否，不再把失败当成功继续往下走。发送键因前置条件不可用时只变灰、不说明原因，而原生 disabled 收不到 hover / focus，把原因挂在它上面也读不到——现在这类禁用改用 aria-disabled + 点击守卫承载解释性 tooltip，禁用视觉统一到 opacity-50 并补焦点环，无 CLI 时用独立文案（不复用旁边那颗真会跳设置页的按钮的「点击前往设置」，避免做出点不动的空头承诺）。空态按真实前提分流：零工作区说「还没有工作区，请先在侧栏添加」并给出下一步，已有工作区但没有会话时才说「选择或新建一个会话开始」。还没有任何标签页时输入框仍可编辑，字落在无归属草稿键（sessionKey 在 active 为 null 时返回的空串，新增 UNBOUND_DRAFT_KEY），此前会随会话建立变成永远读不回来的孤儿；现在 startNewChat 在同一次 set 内把草稿搬到新会话键并删掉空键，只搬一次，目标键已有草稿时不覆盖（这份草稿留在原处等下一个还没有草稿的会话接手——宁可晚一步，也不静默丢掉用户敲下的字），同一状态下输入框占位提示改为说明缺什么，不再显示此时会被丢弃的「Enter 发送」。
- **恢复中的会话重复通告同一 id 时把正在输入的草稿删掉**：claude 每轮都是新进程、system/init 都带 session_id，于是「待发键 → 真实 id」的草稿迁移会在 fromKey === newKey 时照样执行 drafts[newKey] = drafts[fromKey] 再 delete drafts[fromKey]，把用户正在为下一条消息敲的字删掉，composer 的 value-sync effect 随即用空值重建输入框，文字无声消失。现在同键迁移绝不碰草稿，异键迁移也不覆盖已经存在的 native 草稿；只有该 run 仍路由到 pending key 时才从 pending key 迁移，同工作区里已停止或失败的待发会话不会把它的行与草稿并进来。另外采用预分配 native session id 时，drafts 与 retrying 标记一起跟过去，CLI 启动期间敲的字不再滞留在 new: 键上。
- **未启用的引擎仍被探测，opencode 因此被拉起**：设置里没启用 opencode（config.json 的 opencode.current = __disabled__）时，启动应用仍会出现 opencode 进程——探测不看启停开关：前端 useEngineModels 的探针 effect 按 engines 全集派发 listEngineModels，手动 refresh 同样，后端 list_engine_models 也只按引擎 id 分发；而 opencode 的模型目录没有静态来源，只能跑 opencode models，该命令会经 cli.server-connection.resolve → service.ensure 拉起常驻的 opencode serve --service 守护进程（父进程退出后仍存活）。也就是说「停用」只挡住了发消息，没挡住打探。现在前端探针与 refresh 只对 enabled 引擎派发，停用引擎从不进 probed 集合、重新启用后自然补探一次；后端 list_engine_models 开头走 ensure_engine_enabled，停用引擎一律拒绝（与发送路径同一契约，同时覆盖插件入口 plugin_list_engine_models）；插件聚合目录 plugin_model_catalog 跳过停用引擎，不把拒绝填进 errors。已知遗留：opencode 处于启用状态时，探针仍会让它的 CLI 留下常驻 service 守护进程——那是 opencode 自己的行为，ccgui 只清理自己 spawn 的 serve。
- **DSH 的用量明细全为 0**：DSH 的 TokenUsage 是 camelCase（inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens），共用的 parseUsage 却只认 snake_case，唯一被认出的 camelCase 是 totalTokens，于是四个分桶恒为 0、只有总量正确。连带三处：上下文弹层的分桶退化成单一「总 token」行（堆叠条从四段变一段）、每条消息的 token 读数完全不显示（formatUsage 在 input+output 全 0 时返回 null）、用量台账把整行丢掉（后端在四桶之和为 0 时直接返回、不写行）。现在为四个分桶补上 camelCase 别名；DSH 的计数与 claude 一样互不重叠（inputTokens 只算未命中缓存的输入，缓存单独报），因此沿用既有语义，不触发 codex 专有的 cacheInsideInput 折算。
- **重启后 omp 会话的图片变成破图**：omp 走 rpc prompt 的 base64 送图，CLI 把字节写进自己的内容寻址库（<agent dir>/blobs/<sha256>），转录本里只留 blob:sha256:<hex> 引用。重开客户端后聊天记录由转录本重解析得到，而 pi_image_part 无条件把 data 当 base64 拼成 data URL，载荷于是成了引用本身，<img> 解码失败、图片只剩破图占位。现在识别 blob: 引用后先校验是否为裸 64 位小写十六进制（带后缀或相对路径的 id 绝不落到文件系统），再到 CLI blob 库取字节（8 MiB 上限，与 composer 附件上限同源）转成 data URL，文件缺失或超限就不产出图片、不再造出假 data URL；agent dir 复用 pi_family_auth::agent_dir（认 PI_CODING_AGENT_DIR），pi 的内联 base64（claude / codex 亦然）走原路径不变。扫描路径（侧栏计数）根本不读图片字节，blob 引用一并不解析。
- **DSH 会话的上下文窗口一直显示 200k**：DSH 宿主在 request/context 事件里通告本次请求的真实窗口（RequestContext.contextWindow，mify 的 tongyi/deepseek-v4.1-flash 声明 1000000），而它此前落在事件分发的兜底分支里被丢掉——session/modelCatalog 与 TokenUsage 都不带窗口，于是用量环一直用 200k 假定值。现在驱动读取并缓存该事件，本轮的 usage 事件与回合结束载荷都带上真实窗口；通告不带窗口时清掉上一请求的值（窗口与请求精确配对，不会错配给同回合的下一个请求，例如换了模型的子代理）；宿主通告过窗口但本轮没有 usage 分片时，回合结束也会带上它。前端 mergeUsage 同步补齐：next 只带窗口而无 token、prev 有 token 时把窗口折叠进 prev，纯窗口载荷不再把用量环分子清零。
- **claude 的 1M 变体被静默降级**：选择器选中 <家族>[1m] 且命中 ANTHROPIC_DEFAULT_<家族>_MODEL 映射时，启动模型返回的是不带后缀的映射值，1M 请求于是静默降级成普通窗口（渠道侧 claude_channel 是保留后缀的）。现在启动值把后缀接回去，覆盖值自带 [1m] 时不会叠成双后缀；默认模型走 resolved_default 这条路径也按同一约定处理，补上同类静默降级的缺口。comparisonModel 维持既有语义：它是「具体模型名」，前端 compareModel 的 bareModel 先剥掉 [1m] 再比对，registry 路径返回裸值属有意设计。
- **字体分类切换与上传在保存失败时留下半应用状态**：字体模式切换与上传现在串行化（fontBusy 与 typographyBusy 互斥），保存失败会把设置与已应用的字体一起回滚，不再出现「界面已经换字、设置没落盘」；上传要加载与保存都成功才替换设置，显式切回上传分类会强制重试加载记住的文件；切到「自定义（上传）」而保存失败时，下拉回退到实际生效的选项。web 端查看桌面端已上传字体的设置时，下拉显示禁用的「自定义」，不再伪装成系统默认。

🧹 内部优化
- DSH 宿主日志落盘：每次 spawn 在 ~/.ccgui-next/dsh-host-logs/ 下写一个 dsh-host-<epoch>.log（stdout + stderr，逐行 flush，超过 4MB 轮转并保留一代 .1），spawn 失败信息里附上日志路径。宿主被中途杀掉（应用退出时的 kill-on-close、dsh_host_stop 或外部 kill）时内存 ring 随进程一起消失，而 ring 只在 spawn 就绪失败时才被读——这正是最需要诊断的那类故障。落盘前用 extract_launch_token 同一识别器把 dsh web: …?token=<…> 这一行换成固定脱敏标记：令牌能换取宿主的 auth cookie，且宿主存活期间可重复兑换，不能留在磁盘上；内存 ring 里仍保留原行（就绪循环要用）。写失败只禁用 sink，不影响宿主管理。
- ui-ux-spec 更新到 v0.84：字体三档与代码区域统一（§2、§3）；v0.83 行同批登记首启缺前提的三条规则（前置条件禁用的解释义务、零工作区必须开出会话、无归属草稿非破坏性落地）。
- 新增实现：dsh_host.rs 的 HostLog / loggable_line、dsh_session.rs 的 context_window_of 与 attach_context_window(fallback)、mergeUsage 的纯窗口折叠、claude.rs 的 resolved_default 后缀约定、history/extract.rs 的 pi_blob_path / pi_blob_base64、store/persistence.ts 的 UNBOUND_DRAFT_KEY、interface-typography.ts 的 ccgui:typography-change、font.ts 的 isValidFontFamily 与 fontLoadVersions，以及 list_engine_models 开头的 ensure_engine_enabled（与发送路径同一契约，同时覆盖插件入口 plugin_list_engine_models）。
- 回归用例：composer-draft.test.ts（运行中重通告、陈旧待发会话、预分配 id 采用、待发 → 真实 id 交接）、use-chat-sidebar.test.tsx（含登记失败不留标签页）、ai-chat-composer.test.tsx（原因可被读到、占位符覆盖）、ChatConversation.test.tsx、usage.test.ts（DSH 四桶与纯窗口折叠）、use-engine-models.test.tsx（停用不探测、重新启用补探）、font-settings.test.tsx、TerminalView.test.tsx（字体事件重新量度、PTY 防抖、慢启动补发、旧加载丢弃）、tests/browser/interface-typography.tsx，以及 Rust 侧 dsh_host（4 条日志用例）、dsh_session（窗口配对）、models::claude（后缀保留）、history::extract（blob 解析 / 不可解析不出图 / 扫描不读字节）。
- 版本号：main 上的发布提交已把 package.json / Cargo.toml / tauri.conf.json 对到 1.1.5；Cargo.lock 仍记 1.1.4，下一次 cargo 构建会重算。`,
      en: `✨ Features
- **Font settings gain a Custom font family category, and the code font and size now cover chat code, editors, diffs and the terminal**: the Interface font / Code font selectors in Settings → General → Appearance go from two choices to three — System default, Custom (an uploaded font file, unchanged) and Custom font family. The family category expands an input inline (placeholder "Maple Mono", monospace) that accepts an installed family name or a comma-separated CSS font-family list, committing on blur or Enter and reverting the draft on Escape; values containing semicolons, braces, parentheses or control characters, CSS comments, a font-family: declaration or the CSS-wide keywords inherit / initial / unset / revert / revert-layer are rejected locally with an error and leave the saved value alone (anything the browser cannot parse counts as invalid too), while a family that is not installed is still valid and renders through the fallbacks. Installed family names written by the old picker used to be normalised away to System default and now work as families. Validation sits in one place — isValidFontFamily / normalizeFontMode in font.ts — and the root --font-inter / --font-mono-source variables now hold only the selected family, with theme.css appending the fallback stacks (the default stack gains emoji plus Consolas / Liberation Mono). The code areas all consume --font-mono and the code font size: chat inline code and code blocks, CodeMirror's .cm-scroller (its base theme owns the scroller font instead of inheriting it), the diff view and the built-in terminal; the terminal's default size moves from a fixed 12 to the code font size (13 by default) and subscribes to the new ccgui:typography-change event. The follow-up paths in the terminal and the editor are filled in as well: re-measure once the font face has loaded (xterm treats an identical fontFamily assignment as a no-op, so a probe stack pushes it through the public option path and then restores the real family), one shared 150ms debounce for PTY cols/rows (a font or size edit changes cell metrics just like a container resize), a replayed size sync after a slow PTY open completes, and EditorPane only calling requestMeasure on font / typography events instead of rebuilding the draft. Font loads carry a per-role version, so a late result can no longer register a stale face. Web access mode can type a family (resolved on the visiting machine) but has no file upload.

🐛 Fixes
- **The four first-run prerequisites: New session actually opens the session, the send button explains itself, the empty state splits by premise, and drafts survive**: with no workspace at all, the sidebar's New session entry (the tab-strip + and ⌘N share it) used to end after one directory picker — the user asked for a new session, got a folder dialog, and the composer stayed grey until they pressed the same button again. A successfully registered folder now continues into the pending session for it (the same shape as the post-worktree flow), and cancelling or a failed registration creates no tab at all: store.addWorkspace returns whether it succeeded instead of treating a failure as success. Send only went grey when a prerequisite was missing and never said why, and a native disabled control receives neither hover nor focus, so a reason attached to it could never be read — such disables now use aria-disabled plus a press guard to carry an explanatory tooltip, unify on opacity-50 and add a focus ring, and use a dedicated message when no CLI is enabled (not the neighbouring button's "open settings", which really does navigate — reusing it would be an empty promise on a guarded control). The empty state splits by the actual premise: zero workspaces says "no workspace yet — add one from the sidebar" with the next step, and only "workspace but no session" says "select or start a session". With no tab open the composer is still editable, and the text landed on an unbound draft key (the empty string sessionKey returns while active is null, now named UNBOUND_DRAFT_KEY) where it used to become an orphan that could never be read back; startNewChat now moves that draft onto the new session's key and deletes the empty key in the same set, once only, never overwriting a draft the target key already has (that draft stays where it is for the next session without one — one step late rather than silently dropping what the user typed), and the placeholder in that state explains what is missing instead of advertising an Enter that is discarded.
- **A resumed session re-announcing its own id deleted the draft being typed**: claude starts a new process every turn and each system/init carries session_id, so the pending-key → native-key draft migration ran with fromKey === newKey and still did drafts[newKey] = drafts[fromKey] followed by delete drafts[fromKey], removing the text the user was typing for the next message; the composer's value-sync effect then rebuilt the field from the empty store value and the text vanished without a trace. A same-key migration now never touches the draft, a cross-key migration never overwrites a native draft that already exists, and the migration only sources the pending key while the run is still routed there — a stopped or failed pending chat in the same workspace no longer folds its rows and draft into this session. Adopting a preassigned native session id also carries drafts and the retrying flag across, so text typed while the CLI starts is not stranded on the new: key.
- **Disabled engines were still probed, which launched opencode**: with opencode not enabled (opencode.current = __disabled__ in config.json) the app still spawned an opencode process, because probing ignored the on/off switch: useEngineModels' probe effect dispatched listEngineModels for every engine, manual refresh did the same, and the backend list_engine_models only dispatched by engine id — while opencode's catalog has no static source and can only be obtained by running opencode models, which goes through cli.server-connection.resolve → service.ensure and starts a resident opencode serve --service daemon (which outlives its parent). Disabling an engine only blocked sending, not probing. The probe effect and refresh now dispatch only for enabled engines, a disabled engine never enters the probed set and gets probed once when re-enabled; list_engine_models starts with ensure_engine_enabled, so a disabled engine is refused (the same contract as the send path, which also covers the plugin entry plugin_list_engine_models); and the plugin catalog aggregator plugin_model_catalog skips disabled engines instead of filling errors with refusals for engines the plugin cannot launch anyway. Known leftover: while opencode is enabled, a probe can still leave its CLI's resident service daemon behind — that is opencode's own behaviour, and ccgui only cleans up the serve processes it spawned itself.
- **DSH's usage breakdown was all zeros**: DSH's TokenUsage is camelCase (inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens) while the shared parseUsage only knew snake_case — the one camelCase field it recognised was totalTokens — so all four buckets stayed at zero with only the total correct. Three consequences: the context popover's breakdown collapsed to a single total-token row (a four-segment bar became one), per-message token readouts disappeared entirely (formatUsage returns null when input+output are both zero), and the usage ledger dropped the whole row (the backend returns without writing when the four buckets sum to zero). The four buckets now have camelCase aliases; DSH's counters are non-overlapping like claude's (inputTokens counts only uncached input and the cache is reported separately), so the existing semantics apply and codex's cacheInsideInput folding is not triggered.
- **omp images turned into broken placeholders after a restart**: omp sends images as base64 over its rpc prompt and the CLI writes the bytes into its own content-addressed store (<agent dir>/blobs/<sha256>), leaving only a blob:sha256:<hex> reference in the transcript. A reopened client rebuilds chat history from that transcript, and pi_image_part wrapped data as base64 unconditionally, so the payload became the reference itself — the img failed to decode and only the broken-image placeholder remained. A blob: reference is now recognised, validated as a bare 64-character lowercase hex digest (a suffixed or relative id must never reach the filesystem) and resolved from the CLI blob store into a data URL (8 MiB cap, the same limit the composer applies to attachments); a missing or oversized blob yields no image at all instead of a fake data URL. The agent dir reuses pi_family_auth::agent_dir (which honours PI_CODING_AGENT_DIR), and pi's inline base64 (claude / codex too) keeps the original path. The scan path (sidebar counting) never reads image bytes, so it skips blob refs entirely.
- **DSH sessions kept showing a 200k context window**: the DSH host announces the real window for each request on request/context (RequestContext.contextWindow; mify's tongyi/deepseek-v4.1-flash declares 1000000), and that event used to fall into the dispatcher's catch-all branch and be dropped — neither session/modelCatalog nor TokenUsage carries a window, so the gauge stayed on the assumed 200k. The driver now reads and caches the event, and both this turn's usage events and the turn-end payload carry the real window; an announcement without a window clears the previous value (windows pair per request, so a subagent on another model mid-turn cannot inherit it), and when the host announced a window but the turn had no usage chunk the turn-end payload still carries it. mergeUsage grew the matching rule: when next has a window but no tokens and prev has tokens, the window folds into prev, so a window-only payload can no longer zero the gauge's numerator.
- **claude's 1M variants were silently downgraded**: selecting <family>[1m] while ANTHROPIC_DEFAULT_<family>_MODEL maps it made the launch model return the mapped value without the suffix, so a 1M request quietly fell back to the normal window (the channel side, claude_channel, keeps the suffix). The launch value now appends the suffix back, without doubling it when the override already ends in [1m]; the default-model route through resolved_default follows the same contract, closing the same silent downgrade there. comparisonModel keeps its existing semantics: it is a concrete model name, the frontend compareModel's bareModel strips [1m] before comparing, and the registry path returning the bare value is intentional.
- **Switching font categories or uploading a font left a half-applied state when saving failed**: font mode switches and uploads are now serialised (fontBusy and typographyBusy exclude each other) and a failed save rolls back both the settings and the applied font instead of leaving the UI on a new face the settings never recorded; an upload only replaces the settings once loading and saving both succeed, explicitly returning to the upload category retries the remembered file, and a failed save while switching to Custom (upload) reverts the select to the option actually in effect. On the web, a settings screen showing a family uploaded on desktop now displays a disabled Custom option instead of disguising it as System default.

🧹 Internal
- DSH host logs on disk: every spawn writes ~/.ccgui-next/dsh-host-logs/dsh-host-<epoch>.log (stdout + stderr, flushed per line, rotated at 4MB keeping one .1 generation), and spawn failures report the path. A host killed mid-turn (app exit's kill-on-close, dsh_host_stop, an outside kill) takes the in-memory ring with it, and the ring is only read when spawn readiness fails — exactly the failure worth diagnosing. Before writing, the extract_launch_token recogniser replaces a dsh web: …?token=<…> line with a fixed redaction marker: the token exchanges for the host's auth cookie and stays redeemable while the host lives, so it must not sit on disk; the in-memory ring keeps the original line because the readiness loop still needs it. A write failure only disables the sink and never affects host management.
- ui-ux-spec updated to v0.84 (the three font categories and the unified code areas, §2 and §3), with the v0.83 row registering the three first-run rules in the same batch (the duty to explain a prerequisite-gated disable, opening a session from zero workspaces, and non-destructive landing of unbound drafts).
- New implementation: HostLog / loggable_line in dsh_host.rs, context_window_of and attach_context_window(fallback) in dsh_session.rs, the window-only fold in mergeUsage, the resolved_default suffix contract in claude.rs, pi_blob_path / pi_blob_base64 in history/extract.rs, UNBOUND_DRAFT_KEY in store/persistence.ts, ccgui:typography-change in interface-typography.ts, isValidFontFamily and fontLoadVersions in font.ts, and ensure_engine_enabled at the head of list_engine_models (the same contract as the send path, which also covers the plugin entry plugin_list_engine_models).
- Regression cases: composer-draft.test.ts (re-announcement mid-turn, stale pending chat, preassigned id adoption, pending → native hand-off), use-chat-sidebar.test.tsx (including no tab after a failed registration), ai-chat-composer.test.tsx (the reason is readable, the placeholder override), ChatConversation.test.tsx, usage.test.ts (DSH's four buckets and the window-only fold), use-engine-models.test.tsx (disabled engines are not probed and are probed once when re-enabled), font-settings.test.tsx, TerminalView.test.tsx (re-measure on font events, PTY debounce, slow-start replay, stale loads dropped) and tests/browser/interface-typography.tsx, plus dsh_host (4 log cases), dsh_session (window pairing), models::claude (suffix preserved) and history::extract (blob resolution / no image for unresolvable refs / scanning never reads bytes) on the Rust side.
- Version: the release commit on main already set package.json / Cargo.toml / tauri.conf.json to 1.1.5; Cargo.lock still records 1.1.4 and is recomputed by the next cargo build.`,
    },
  },
  {
    version: "1.1.4",
    date: "2026-10-14",
    content: {
      zh: `🐛 修复
- **Codex app-server 异步提问卡片一直不显示**：app-server 有两条提问通道——item/tool/requestUserInput 是挂起的 server→client 请求（阻塞回合、在 stdin 上应答），另一条把提问元数据直接挂在 agentMessage item 的 questions 字段上，回合不阻塞。投影里 agentMessage 分支原本写成「正文已经流式显示过同一 item 就整条 return」，问题元数据跟着被丢掉，卡片永远不出现（正文照常流式）。现在完成后只在未流式显示时补发正文（不重复已流式内容），questions 始终经 async_question_cards 转成通用提问卡——title 作题面、header 依次是 Q1/Q2…、字符串选项转成 { label }，空题面与空白标签被过滤——派发 EngineEvent::Question，requestId / toolUseId 用 app-server item id（即原始 call id），并把 { codexAppAsync: { callId, threadId, turnId, questions } } 存进进程注册表。
- **异步提问的回答走 turn/steer，确认后才收起卡片**：这类问题没有挂起的 JSON-RPC 服务端请求，不能像阻塞式提问那样回一个 stdin 响应帧。answer_question 现在识别 codexAppAsync 上下文，构造 turn/steer 请求（params: threadId / expectedTurnId = turnId / input 一条文本），文本里带 call id 与按题面序列化的答案；跳过（answers 为 None）发的是「The user skipped your async question (call_id: …)」。答案必须是对象、键必须是 Codex 问过的题面、值必须是字符串或字符串数组，否则在写帧之前就报错。确认由「进程注册表的 pending RPC reply 表 + 正在跑的 stdout pump」共同完成：答题命令 register_pending_rpc_reply（(run_id, request_id) → oneshot），写入 stdin 后以 10s 超时等回复；pump 里原本「不匹配当前等待的回复就丢弃」的早退改成继续交给 on_message，正在等别的请求或等回合结束的 pump 因此也能读到 steer 的确认。超时或写失败 remove_pending_rpc_reply 并说明可以重试；回合在确认前结束由 settle_pending_rpc_replies 唤醒所有等待者并报错；回复里没有 turnId 视为非法响应。只有拿到确认才从注册表删掉提问卡。
- **MCP 页面「打开即检测」在 Windows 弹出一屏控制台窗口**：stdio 探测子进程（uv.exe / node.exe / cmd.exe）都是控制台程序，探针却没加 CREATE_NO_WINDOW，GUI 进程 spawn 它们时每个都弹一个可见窗口，而一次检测会同时拉起全部 stdio 服务。现在 probe_stdio_within 在 Windows 上调用 crate::engine::hide_console，与引擎、插件桥同一条压制路径；Unix 侧的 process_group(0) 不变。
- **大 tools/list 被误报成「连接失败」**：探针的单行上限常量是 1 MiB，而 rea 的 tools/list 是单行约 1.87 MB（139 个工具，实测），整行被丢进 dropping 后握手永远等不到响应、最后超时，界面上显示「连接失败」，但同一个服务在 CLI 里能正常加载。MAX_LINE 现在直接用 crate::engine::MAX_LINE_BYTES（16 MiB，与引擎读 CLI stdout 同源）；超限丢弃本身保留（内存保护），LineReader 增加可配 limit 与 dropped 计数，失败文案统一附加 overlong_note「（有 N 行输出超过 X MiB 上限，已被丢弃）」，握手超时、服务提前退出、无可识别响应三条路径都带上，不再把「响应太大被丢弃」写成与事实不符的「服务没有返回可识别的响应」。
- **连接状态里的工具数量被详情截断成 40**：详情只列前 40 个工具名，但那条截断把「已连接 · N 个工具」的数量也一起截了——rea 声明 139 个、cubism-mcp 45 个、reverse_lab_tools 109 个，界面上统统显示 40。McpProbeResult 新增 tool_count，在 take(MAX_TOOLS) 之前统计 tools/list 的条目总数，tools 仍是截断后的名字列表；前端 chip 改用 toolCount，详情在截断时改说「工具（共 N 个，列出前 40 个）：…」（新增 i18n toolListTruncated）；probe store 的坏响应边界校验同时要求 toolCount 是数字，缺字段直接判为「MCP 检测返回了无法识别的结果」，不让一条坏响应把数量画成 NaN。
- **长项目名 / 长仓库名撑破底部状态栏**：状态栏左右两组都没有收缩约束，长工作区别名或长仓库名会把右侧的代理开关、上下文环挤出布局。StatusBar 左侧容器补 min-w-0、右侧改为 shrink-0；ProjectFolderMenu 与 BranchMenu 的触发器补 max-w-full / min-w-0 / overflow-hidden，名称本身 min-w-0 truncate 并加 title（分支菜单是「仓库 · 分支」全称），超长文本截断而不是撑开。
- **状态栏文件夹菜单按名字匹配，同名工作区永远选中第一个**：ProjectFolderMenu 之前按字符串回传名字，ConversationFooter 再拿名字在 visibleWorkspaces 里 find，两个都叫 app 的工作区（/tmp/one/app 与 /tmp/two/app）无论点哪个都会开第一个。现在 onSelect 回传下标（StatusBar 的 onFolderSelect 签名同步改为 index），ConversationFooter 直接取 visibleWorkspaces[index]；列表 key 也从名字改成下标，重名行不再共用 key。状态栏文件夹名与当前项同时改为优先显示工作区别名（workspaceAliases[id] 去空白后非空），未设别名回退文件夹 basename。

🧹 内部优化
- ui-ux-spec 的提问卡条目更新：阻塞式提问与 Codex app-server AgentMessage.questions 异步提问都进输入区 dock，异步提问通过 turn/steer 作答、服务端确认前卡片保持待答
- 新增实现：engine/registry.rs 的 pending RPC reply 表（register / resolve / remove / settle，按 run id 隔离）、codex_app.rs 的 async_question_cards / park_async_question / async_answer_request / next_async_question_rpc_id、mcp/probe.rs 的可配上限 LineReader 与 overlong_note；前端新增 McpProbeResult.toolCount 与 i18n toolListTruncated，StatusBar / ProjectFolderMenu 的文件夹回调统一为下标
- 回归用例：Rust 侧 Codex 异步提问投影 / steer 帧 / 拒绝未知题面 / 已流式显示后仍 park / steer 回复解析，以及 MCP 的计数不受截断、>1 MiB 单行完整读出、超限行不吃掉下一条、丢弃原因进文案；前端 ConversationFooter 的别名显示与重名按下标选择、McpSection 的「已连接 · 139 个工具」、probe store 拒绝缺 toolCount 的响应
- 版本号对齐到 1.1.4（package.json / Cargo.toml / tauri.conf.json / Cargo.lock）`,
      en: `🐛 Fixes
- **Codex app-server async question cards never appeared**: app-server has two question channels — item/tool/requestUserInput is a parked server→client request (it blocks the turn and is answered on stdin), while the other attaches question metadata to an agentMessage item's questions field without blocking the turn. The agentMessage branch of the projection used to return early whenever the body had already been streamed for that same item, so the question metadata was dropped with it and the card never showed (the body kept streaming normally). Now, on completion, the body is only re-emitted when that item was not streamed — no streamed content is duplicated — and questions always go through async_question_cards into the shared question card: the title becomes the question, the header runs Q1/Q2…, string options become { label }, and empty titles and blank labels are filtered out. The card is dispatched as EngineEvent::Question with requestId / toolUseId set to the app-server item id (the original call id), and { codexAppAsync: { callId, threadId, turnId, questions } } is parked in the process registry.
- **Async answers are submitted with turn/steer, and the card closes only after Codex acknowledges**: these questions have no parked JSON-RPC server request, so they cannot be answered with a stdin response frame the way blocking questions are. answer_question now recognises the codexAppAsync context and builds a turn/steer request (params: threadId / expectedTurnId = turnId / a single text input) whose text carries the call id and the answers serialised by question title; skipping (answers is None) sends "The user skipped your async question (call_id: …)". Answers must be an object, their keys must be questions Codex actually asked, and their values strings or arrays of strings — anything else is rejected before the frame is written. Acknowledgement is handled by the process registry's pending RPC reply table together with the running stdout pump: the answer command registers a pending reply ((run_id, request_id) → oneshot), writes to stdin and waits up to 10s; the pump's early exit for replies that do not match what it is currently waiting for now forwards them to on_message instead of dropping them, which is what lets a pump waiting on another request or on the turn to end still read the steer confirmation. A timeout or a failed write removes the pending reply and reports that the answer can be retried; a turn that ends before acknowledgement wakes every waiter through settle_pending_rpc_replies with an error; a reply without a turnId is rejected as invalid. The question card is removed from the registry only once the acknowledgement arrives.
- **Opening the MCP page fired a screenful of console windows on Windows**: the stdio probe child processes (uv.exe / node.exe / cmd.exe) are console programs and the probe did not pass CREATE_NO_WINDOW, so a GUI process spawning them popped a visible console window for each — and one opening check launches every stdio server at once. probe_stdio_within now calls crate::engine::hide_console on Windows, the same suppression path the engines and the plugin bridge use; Unix keeps process_group(0).
- **A large tools/list was misreported as a failed connection**: the probe's per-line cap was 1 MiB while rea's tools/list is a single ~1.87 MB line (139 tools, measured), so the whole line went into dropping, the handshake never saw a response and eventually timed out, and the UI showed "connection failed" even though the same server loads fine in the CLI. MAX_LINE is now crate::engine::MAX_LINE_BYTES (16 MiB, shared with how the engines read CLI stdout). Dropping overlong lines is kept as memory protection, but LineReader gains a configurable limit and a dropped counter, and every failure message appends overlong_note ("(N lines exceeded the X MiB cap and were discarded)") — on the handshake timeout, on an early exit and on an unrecognised response — so "the response was too big and was discarded" is no longer described as "the service returned no recognisable response".
- **The connected status capped the tool count at 40**: the detail list only shows the first 40 names, but that truncation also capped the "connected · N tools" count — rea declares 139, cubism-mcp 45 and reverse_lab_tools 109, and all of them displayed 40. McpProbeResult gains tool_count, counted from the tools/list entries before take(MAX_TOOLS), while tools remains the truncated name list; the status chip now uses toolCount and the detail line says "Tools (40 of N shown): …" when truncated (new i18n toolListTruncated); the probe store's bad-response guard also requires toolCount to be a number, so a response without it is rejected as unrecognisable instead of drawing NaN.
- **Long project or repository names broke the footer status bar**: neither half of the status bar had a shrink constraint, so a long workspace alias or repository name pushed the proxy toggle and context ring out of the layout. StatusBar's left group gains min-w-0 and its right group becomes shrink-0; the ProjectFolderMenu and BranchMenu triggers gain max-w-full / min-w-0 / overflow-hidden, and their labels min-w-0 truncate with a title (the full "repo · branch" for the branch menu), so overlong text truncates instead of expanding.
- **The footer folder menu matched by name, so same-named workspaces always opened the first one**: ProjectFolderMenu returned the display name as a string and ConversationFooter looked it up in visibleWorkspaces, so two workspaces both named app (/tmp/one/app and /tmp/two/app) opened the first one no matter which was clicked. onSelect now passes the index (StatusBar's onFolderSelect signature follows) and ConversationFooter reads visibleWorkspaces[index] directly; the list key is the index too, so duplicate rows no longer share a key. The footer's folder label and the current selection also prefer the workspace alias (workspaceAliases[id], trimmed, when non-empty) and fall back to the folder basename otherwise.

🧹 Internal
- The ui-ux-spec question-card entry was updated: blocking questions and Codex app-server AgentMessage.questions async questions both land in the composer dock, and async answers go through turn/steer with the card staying pending until the server acknowledges
- New implementation: the pending RPC reply table in engine/registry.rs (register / resolve / remove / settle, isolated per run id), async_question_cards / park_async_question / async_answer_request / next_async_question_rpc_id in codex_app.rs, and the configurable-limit LineReader plus overlong_note in mcp/probe.rs; the frontend gains McpProbeResult.toolCount, the toolListTruncated message, and an index-based folder callback shared by StatusBar / ProjectFolderMenu
- Regression cases: Codex async question projection / steer frame / rejection of unknown question titles / parking after the body streamed / steer reply routing on the Rust side, plus MCP's count surviving truncation, a >1 MiB line being read whole, an overlong line not eating the next one and the discard reason reaching the message; on the frontend, alias display and index-based selection for duplicate names in ConversationFooter, "connected · 139 tools" in McpSection, and the probe store rejecting a response without toolCount
- Version synced to 1.1.4 (package.json / Cargo.toml / tauri.conf.json / Cargo.lock)`,
    },
  },
  {
    version: "1.1.3",
    date: "2026-10-10",
    content: {
      zh: `✨ 新功能
- **输入框支持粘贴文件，与拖拽走同一条路由**：Finder / 资源管理器里复制的文件在 webview 里只有不透明的 File blob，没有路径，之前 onPaste 只消费图片与纯文本，这种粘贴什么都不会发生。现在图片字节仍走原有的 savePastedImage 附件管线（截图行为不变），其他文件解析成绝对路径后在光标处变成 @path 引用；纯文本粘贴不变（仍只取 text/plain，不泄漏 HTML）；没有活动会话时粘贴文件不落地，与拖拽一致。路径来源：composer-editable 用 readClipboardFiles 对事件内容分类，非图片文件先向宿主探测系统剪贴板（新增 clipboard_file_paths 命令：macOS 读 NSPasteboard 的 file URL，Windows 读 CF_HDROP），探测为空时用事件自带的 text/uri-list 兜底（GTK 剪贴板会直接暴露 file:// 路径）。web 访问模式仍拿不到非图片文件的路径。
- **新增「宽幕布」设置，聊天内容列可占满窗格**：聊天内容一直居中限宽（时间线 max-w-[750px]、输入框一侧 max-w-3xl），宽窗口两边留白多且没有开关可调。设置 → 通用 → 外观新增「宽幕布」开关（默认关，界面与以前逐像素一致）：打开后时间线、输入框、状态栏、附件行、排队消息、提问 dock 与计划 dock 共用的居中轨道去掉宽度上限、占满所在窗格，只留窗格自身 16px 内边距；分屏时每格按同一开关渲染。宽度只在 chat-column.ts 的 timelineColumnClass / centerColumnClass 一处决定；存取链路为 Rust AppSettings.chat_wide_layout（None / false = 窄）→ 前端 chatWideLayout → chat store 的 wideLayout，即时生效、重启保留，并进设置搜索索引（宽幕布 / 宽度 / 留白 / full width）。
- **支持独立字体字号与界面字重配置**：设置 → 通用新增三档独立字号——界面（默认 16）、内容（默认 14）、代码（默认 13），范围 10–32，非法值回落默认——以及界面字重（标准 / 中等 / 加粗）。interface-typography.ts 把它们换算成 --ui-font-scale / --content-font-scale / --code-font-scale 与字重偏移（标准 0、中等 +100、加粗 +200）写到根节点，启动时由 bootstrap 应用，后端 settings.rs 新增 ui_font_size / content_font_size / code_font_size / ui_font_weight 四个字段（缺字段按默认值往返）；typography.css 的排版变量整体重整，Diff 预览字体一并对齐；新增的几项均进设置搜索。
- **OMP 自定义供应商可在列表行内改名称与接口地址**：OMP CLI 的 models.yml 没有 provider 级 name 字段，列表里那一行显示的就是 providers.<id> 的键，也是 omp models 与模型选择器展示的名字。名称与 URL 文字后各挂一个行内铅笔，点击就地变单行输入框（Enter 提交 / Esc 取消），名称铅笔改键名、URL 铅笔改 baseUrl；写回由 piFamilyModelsBlocks 的 setProviderField 完成，只就地改写 providers.<id> 的键或 baseUrl，注释、字段顺序、同级供应商与 models 列表原样保留，YAML 标量按需加引号。重名、空名称、空 URL 在前端拦截；行标题恒为键名，不再优先显示后端摘要里的 name，避免与铅笔实际改的键对不上。
- **外网访问新增「无人值守」开关**：中转服务行在状态点与「断开中转」之间加一个胶囊开关。中转本身是会话态，默认每次启动都要手动连；打开「无人值守」后才会在重启时自动连接——需要地址与密钥都在才会拨号，打开时顺带发起连接，断线则只要中转在跑就一直重试。关闭则每次启动手动连，不影响当前连接；点「断开中转」会先清掉该标记再断开，一次断开表达「别自己回来」，写盘失败则保持连接、不做半应用。新增 web_relay_unattended_set 命令，写标记后广播 settings://changed（经 web 桥一并送到手机端），悬停提示说明上述语义。

🐛 修复
- **中文输入法选字后回车需按两次、调出的历史草稿被冲掉**：去掉组合输入结束后 100ms 的发送门闩，保留系统输入法自身的确认行为，选字后的那下回车立即发送；各类选择器与历史导航改用组合状态加 keyCode 229 把关。同时在组合输入开始时重置历史导航，方向键不会再覆盖刚用输入法改过的草稿。macOS / Windows 原生输入法的实测仍待确认。
- **不带 .git 的 HTTP remote 推送 / 拉取失败**：GitLab / Gitea 对 <host>/<owner>/<repo> 这类 URL 会 301 到 .git 路径，git CLI 透明跟随，但 libgit2 1.9.x 不跟随，反复请求原始 URL 直到 GIT_HTTP_REPLAY_MAX，在凭据回调触发前就报 "too many redirects or authentication replays"。现在 push / pull 前用 add_dot_git 把 http(s) 的 origin 规范化为 .git 形式，CanonicalRemoteUrl 以 RAII 在操作结束后还原原值、不落盘；已带 .git、SSH、scp 式、带 query / fragment 或路径不足以判定的 URL 一律不动。
- **外网访问页三张卡片「部署中转」标题折成两行**：该页三张卡在共享的 720px 阅读列里各只有 234px，而标签 + 提示图标 + 源码 / 一键部署两个按钮约需 248px（英文约 284px）。现在「远程访问」页启用 880px 宽列（三卡等宽各 288px），中英文标题都保持单行，标题行与页面主体共用同一列宽、居中轴不变，其余页面仍为 720px。
- **中转开关被写进 settings.json 并在启动时自动重连**：与「中转开关是会话态」的设计不符。已删除 AppSettings.web_relay_on 与启动路径里无条件的自动重连；旧文件里的 webRelayOn 会落进 flatten 的附加字段表并被永久回写，因此持久化时显式丢弃该键（地址与密钥保留）。web_relay_stop 不再写盘，停止即纯运行时操作。
- **dsh 模型列表同一模型出现两行**：dsh 的模型目录会摊平成 provider/model 组合 id，而渠道里配置的模型存的是裸 id，于是同一模型一行来自配置、一行来自目录。use-engine-models 新增 resolveCompositeId，把裸 id 解析到目录里唯一匹配的组合 id（0 个或多个匹配则保持原样，不猜），当前选中项与渠道配置项都走它，两行合并为一行。
- **macOS 公证偶发整次发布失败**：notarytool submit --wait 把一次状态轮询超时（NSURLErrorDomain -1001）当成致命错误，同一提交 arm64 已 Accepted 而 x86_64 直接失败。现在 submit 不带 --wait，改为自行轮询 notarytool info（最多 60 次 × 20s = 20 分钟）：轮询非零退出但输出里仍有 status 就继续，完全读不到状态才算丢一次；Accepted 才 staple，Invalid 立即打印 notarytool log 并失败退出，超时按错误退出。

🧹 内部优化
- ui-ux-spec 同步登记输入法发送语义、粘贴文件、宽幕布与字体字重配置
- 新增 clipboard.rs（macOS NSPasteboard / Windows CF_HDROP，含 3 项 Rust 测试）、clipboard-files.ts、interface-typography.ts 与 chat-column.ts 的宽度单点；Switch 组件改 forwardRef，使 react-aria 的 Tooltip 能把触发器 ref 落在 DOM 节点上；新增 WebRelayCard 测试钉住无人值守的三条语义，以及 setProviderField、粘贴路由与输入法事件的回归用例
- 修复 src-tauri/tests/codex_probe.rs 里 AppState 字面量重复的 plugin_sink / mission_sink 字段（E0062，导致 cargo test --tests 无法编译）
- 版本号对齐到 1.1.3（package.json / Cargo.toml / tauri.conf.json / Cargo.lock）`,
      en: `✨ Features
- **The composer accepts pasted files, through the same route as drag-and-drop**: a file copied in Finder / Explorer reaches the webview as an opaque File blob with no path, and onPaste used to consume only images and plain text, so pasting such a file did nothing. Image bytes still go through the existing savePastedImage attachment pipeline (screenshots behave as before), while any other file is resolved to an absolute path and becomes an @path reference at the caret; plain-text paste is unchanged (still only text/plain, never leaking HTML), and with no active session a pasted file is not landed, same as drag-and-drop. Where the path comes from: composer-editable classifies the event with readClipboardFiles, non-image files first probe the system clipboard through the host (the new clipboard_file_paths command — NSPasteboard file URLs on macOS, CF_HDROP on Windows), and when that comes back empty the event's own text/uri-list is the fallback (the GTK clipboard exposes file:// paths directly). Web access mode still cannot obtain paths for non-image files.
- **A new "Wide canvas" setting lets the chat column fill the pane**: chat content has always been centred and width-capped (timeline max-w-[750px], composer side max-w-3xl), leaving a lot of margin in wide windows with no way to change it. Settings → General → Appearance now has a "Wide canvas" switch (off by default, pixel-identical to before): when on, the shared centred track used by the timeline, composer, status bar, attachment row, queued messages, question dock and plan dock drops its width cap and fills its pane, keeping only the pane's own 16px padding; in split view every pane renders by the same switch. The width is decided in one place, timelineColumnClass / centerColumnClass in chat-column.ts; the storage chain is Rust AppSettings.chat_wide_layout (None / false = narrow) → frontend chatWideLayout → the chat store's wideLayout, effective immediately, kept across restarts, and indexed in settings search (wide canvas / width / margin / full width).
- **Independent font size and interface font weight settings**: Settings → General gains three independent font sizes — interface (default 16), content (default 14) and code (default 13), range 10–32, invalid values falling back to the default — plus an interface font weight (standard / medium / bold). interface-typography.ts converts them into --ui-font-scale / --content-font-scale / --code-font-scale and a weight offset (standard 0, medium +100, bold +200) on the root element, applied at startup by bootstrap, and settings.rs gains four fields, ui_font_size / content_font_size / code_font_size / ui_font_weight (missing fields round-trip as their defaults); the typography variables in typography.css were reworked as a whole and the Diff preview font is aligned with them; the new items are all in settings search.
- **OMP custom providers can be renamed and re-pointed inline in the list**: OMP CLI's models.yml has no provider-level name field — the row in the list is the providers.<id> key, which is also the name omp models and the model picker show. The name and the URL each get an inline pencil that turns the text into a single-line input in place (Enter to commit / Esc to cancel); the name pencil renames the key and the URL pencil edits baseUrl. Writing back goes through setProviderField in piFamilyModelsBlocks, which rewrites only the providers.<id> key or its baseUrl in place — comments, field order, sibling providers and the models list are untouched, and YAML scalars are quoted only when needed. Duplicate names, empty names and empty URLs are rejected in the frontend; the row title is always the key and no longer prefers the name in the backend summary, so it can never disagree with the key the pencil actually changes.
- **A new "Unattended" switch for external access**: the relay service row gets a pill switch between the status dot and "Disconnect relay". The relay itself is session-scoped and by default has to be connected by hand on every launch; only when "Unattended" is on does it reconnect on restart — and only when both the address and the secret are present — and turning it on also starts a connection right away, while a dropped link is retried for as long as the relay is running. Turning it off means connecting manually on each launch and does not affect the current connection; "Disconnect relay" clears the flag first and then disconnects, so one disconnect means "do not come back on your own", and if writing the flag fails the connection is kept rather than half-applied. The new web_relay_unattended_set command writes the flag and broadcasts settings://changed (which the web bridge forwards to the phone too), and a hover tooltip explains these semantics.

🐛 Fixes
- **Enter had to be pressed twice after choosing a Chinese IME candidate, and recalled history drafts were overwritten**: the 100ms post-composition send gate is gone, native IME confirmation is preserved, and the Enter that follows choosing a candidate now sends immediately; pickers and history navigation are gated by the composition state plus keyCode 229. History navigation is also reset when composition starts, so arrow keys can no longer overwrite a draft you have just edited with the IME. Testing against the native macOS / Windows IMEs is still to be confirmed.
- **Push / pull failed for HTTP remotes without .git**: GitLab / Gitea answer URLs shaped like <host>/<owner>/<repo> with a 301 to the .git path, which the git CLI follows transparently but libgit2 1.9.x does not, so it kept requesting the original URL until GIT_HTTP_REPLAY_MAX and failed with "too many redirects or authentication replays" before the credential callback ever ran. Before push / pull, add_dot_git now normalises an http(s) origin URL to its .git form, and CanonicalRemoteUrl restores the original value via RAII when the operation ends, without writing to disk; URLs that already end in .git, SSH and scp-style URLs, URLs with a query or fragment, and URLs whose path is too short to judge are left alone.
- **The "Deploy relay" title wrapped onto two lines in the three external-access cards**: each card got only 234px of the shared 720px reading column, while the label + hint icon + the source / one-click deploy buttons need about 248px (about 284px in English). The Remote access page now uses an 880px column (three equal cards of 288px), so the titles stay on one line in both languages; the title row shares the page body's column width with the centre axis unchanged, and the other pages keep 720px.
- **The relay switch was written to settings.json and reconnected on launch**: this contradicted the design that the relay switch is session-scoped. AppSettings.web_relay_on and the unconditional auto-reconnect on the startup path are removed; a webRelayOn left in an old file would land in the flattened extra-fields table and be written back for good, so persistence now explicitly drops that key (the address and secret are kept). web_relay_stop no longer writes to disk, so stopping is a pure runtime operation.
- **The dsh model list showed the same model on two rows**: dsh's model catalog flattens to provider/model composite ids while the model configured on the channel is stored bare, so one model appeared once from the configuration and once from the catalog. use-engine-models gains resolveCompositeId, which resolves a bare id to the unique matching composite id in the catalog (zero or several matches leave it as is — no guessing); both the current selection and the channel's configured model go through it, and the two rows collapse into one.
- **macOS notarization sometimes failed an entire release**: notarytool submit --wait treated a single status-poll timeout (NSURLErrorDomain -1001) as fatal, so the same submission could be Accepted on arm64 while x86_64 failed outright. Submit no longer passes --wait; it now polls notarytool info itself (up to 60 × 20s = 20 minutes): a poll that exits non-zero but still prints a status carries on, and only a poll that yields no status at all counts as a lost attempt; only Accepted proceeds to stapling, Invalid prints notarytool log and fails immediately, and a timeout fails as an error.

🧹 Internal
- ui-ux-spec registers the IME send semantics, pasted files, the wide canvas and the font size / weight settings
- New clipboard.rs (macOS NSPasteboard / Windows CF_HDROP, with 3 Rust tests), clipboard-files.ts, interface-typography.ts and the single width point in chat-column.ts; the Switch component becomes a forwardRef so react-aria's Tooltip can land the trigger ref on a DOM node; new WebRelayCard tests pin the three unattended semantics, plus regression cases for setProviderField, the paste routing and the IME events
- Fixed the duplicated plugin_sink / mission_sink fields in the AppState literal of src-tauri/tests/codex_probe.rs (E0062, which stopped cargo test --tests from compiling)
- Version synced to 1.1.3 (package.json / Cargo.toml / tauri.conf.json / Cargo.lock)`,
    },
  },
  {
    version: "1.1.2",
    date: "2026-10-08",
    content: {
      zh: `✨ 新功能
- **HTML 文件点开即渲染预览（桌面 ccgui-preview 协议 + sandbox）**：.html / .htm / .xhtml 与 Markdown 共用头部「编辑 / 预览」切换，初始模式由 editor-view-mode.ts 的 opensInPreview(name, !isWeb) 决定，预览本体是 HtmlPreview.tsx 里指向 previewFileUrl(path) 的 iframe。不能用 Tauri 的 asset 协议：convertFileSrc 把整条绝对路径编码进一个 URL 段（asset://localhost/%2F…%2Findex.html），文档里的相对引用（draft.css、script src）会被浏览器解析成 asset://localhost/draft.css 而全部 404，页面只剩无样式裸 HTML；新增的 preview_protocol.rs 注册保留真实路径结构的 ccgui-preview 协议（每段单独解码，解出斜杠、反斜杠、NUL 或 . / .. 的段直接拒绝、不静默改目标），同级资源、module script 与 fetch 因此按浏览器语义解析。访问范围沿用 asset 协议作用域（$HOME/** 减 deny，canonicalize 并跟随符号链接），响应带 Cache-Control: no-store 与 Access-Control-Allow-Origin: null（sandbox 帧的不透明来源能用），支持单段 Range，tauri.conf.json 的 CSP 放行 frame-src ccgui-preview。sandbox 取 allow-scripts allow-same-origin allow-forms allow-modals：脚本、表单与 alert 能跑，但帧与宿主不同源、进不了 CC GUI 状态，顶层导航与弹窗始终被拦。预览渲染的是磁盘上已保存的内容（与 Markdown 预览的实时草稿语义不同）：未保存改动仍由「未保存」徽标与「保存」按钮承担，改完点页头新增的「刷新」（转圈 → 对号）重挂载 iframe 才读盘；切到别的页签时 iframe 整个卸载，不在屏上的预览不许在后台跑 rAF / 定时器。web 访问模式没有对应原生协议，那里的 HTML 保持源码视图；作用域外的文件预览为空，源码视图与编辑不受影响。
- **插件市场首屏新增「编辑精选」轮播**：数据来自索引仓的 featured.json（后端 plugin_fetch_featured），是索引之上的编辑层、不是新的插件来源——与索引共用 1h 缓存，并串行排在 plugin_fetch_index 之后复用刚拉好的索引；id 校验、去重、超 8 条上限与控制字符清理都在后端完成，封面按索引里的仓库解析成绝对 https。软依赖：文件缺失或坏掉都折成空列表，不写 marketplaceStore.error，下方表格与筛选照常；featured 为空时轮播整块不渲染。自动播放由 theme.css 的 --animate-spotlight-progress（6s，scaleX）关键帧驱动、animationend 才翻页：悬停、焦点进入、切到后台、prefers-reduced-motion 四路都作用在同一条进度条上（条停 = 翻页停），手动翻页让进度段以下标为键重新起跑。封面按「编辑封面（object-cover）→ 插件第一张截图（原比例 object-contain，不裁切）→ icon → 品牌色首字块」四级回落，任一环 onError 降一级，卡片永远画满；轮播内 ←/→ 键盘翻页，圆点带「第 n 条精选：名称」，aria-roledescription=carousel。市场行与精选卡共用抽出的 MarketActionButton，安装 / 更新 / 已安装三种状态只在一处判定；plugin_fetch_featured 已进 web 只读白名单。
- **⌘W 关的是标签页，不是窗口**：新增 closeTab 快捷键动作（默认 ⌘W，设置 → 快捷键可改），与点页签 × 走同一条 handleTabClose 路径：脏文件仍弹保存确认（未保存内容从不静默丢弃），其余页签（会话 / 文件 / 浏览器 / 插件 / 单实例）立即关闭，没有页签时 no-op。macOS 上 Tauri 默认菜单把 ⌘W 绑给原生 Close Window（直接销毁窗口，前端收不到 keydown），所以 app_menu.rs 重建了同一套应用菜单、只拿掉该项，键事件才能到 webview，与 Windows / Linux 一致；About / Quit（⌘Q 仍受 quit_guard 拦截）/ Edit / Window 菜单保持不变。
- **文件 Markdown 预览支持 ⌘F 查找**：页头预览模式新增放大镜按钮，快捷键与对话内搜索共用 chatSearch 动作（各面按可见性让位）；命中用独立 highlight 名的 Custom Highlight API 画（全部黄色、当前项橙色，与对话搜索可同时开启、互不覆盖），输入框是右上角共用的 ContentSearchBar，实时显示命中计数，Enter / Shift+Enter 逐个跳转、Esc 关闭；MutationObserver 吸收 mermaid 等延迟渲染内容。

🐛 修复
- **响应校验解析请求别名**：Claude 的请求选择器（如 opus）保持原样交给 CLI，校验改用该次启动 CLI 注册表与渠道映射解析出的具体模型，卡片的请求模型展示「选择器 → 具体模型」。供应商专属别名按对应注册表映射解析，远端运行不套用本机注册表；无法解析时展示「无法确认」并使用中性色问号，既不当作不一致也不当作通过，响应未上报仍显示「未上报」、没有响应证据时隐藏徽标；实际具体模型或已上报档位不同仍使用黄色叹号，其他引擎与旧事件沿用原比较方式。
- **Markdown 预览的链接丢了样式与点击行为**：替换 Streamdown 内建 link 组件后 text-primary / underline 类不再跟过来，锚点现在显式挂 .md-preview-link（绿色点状下划线，与聊天 Markdown 的链接观感一致）；点击一并收口——https: / mailto: 交系统浏览器，相对 / 绝对文件路径按 Markdown 文件所在目录解析后开成编辑器页签，目录、无扩展名目标、#anchor 与未知 scheme 渲染为惰性文本，不再让 webview 导航替换应用外壳。
- **opencode 上下文进度条分母错误**：opencode 的 usage 事件只带 token 计数、没有 model_context_window，前端 gauge 因此回落到假定的 200k；现在每轮从 managed serve 的合并配置（/config 的 provider.<pid>.models.<mid>.limit.context）解析出真实窗口并按 provider/model 回填到 usage 事件，探针失败只得到空表、不影响回合，也不改变原本就上报窗口的引擎行为。
- **对话面不可见时 ⌘F 仍在后台开关对话搜索**：文件预览等其它面在视时，⌘F 只作用于当前面，不再误切对话搜索。

🧹 内部优化
- ui-ux-spec 更新至 v0.80：v0.78 的 ⌘W 与预览查找、v0.79 的 HTML 预览与 ccgui-preview 协议、v0.80 的编辑精选轮播；§3 规则与 §7 刷新入口（HTML 预览刷新、市场索引刷新同时重读 featured.json）同步登记
- 新增共享实现：ContentSearchBar（对话搜索与文件预览共用查找条）、dom-text-search.ts、MarketActionButton（市场行与精选卡共用）与 files/editor-view-mode.ts；后端新增 app_menu（macOS 应用菜单重建）与 preview_protocol（ccgui-preview 协议，含 5 项 Rust 测试），AppSettings 新增 close_tab_shortcut
- 浏览器夹具新增 tests/browser/plugin-spotlight.html（真实浏览器核「进度条即计时器」与截图不裁切）、更新 markdown-preview.html（链接样式与 ⌘F 高亮）；新增 docs/design/plugin-market-discovery.*（选定方案 A 前的三套静态设计对比稿，纯静态、无构建）
- README 中英文的 MiniMax Code 徽章改用仓库内图标（src/assets/model-icons/minimax-code.png），不再依赖 Google favicon 服务；Cargo.lock 的 ccgui-next 版本跟到 1.1.2`,
      en: `✨ Features
- **HTML files open straight into a rendered preview (desktop ccgui-preview protocol + sandbox)**: .html / .htm / .xhtml share the same edit / preview header toggle as Markdown, the initial mode decided by opensInPreview(name, !isWeb) in editor-view-mode.ts, and the preview itself is the HtmlPreview.tsx iframe pointing at previewFileUrl(path). Tauri's asset protocol cannot be used here: convertFileSrc encodes the whole absolute path into a single URL segment (asset://localhost/%2F…%2Findex.html), so the document's relative references (draft.css, script src) resolve to asset://localhost/draft.css and 404, leaving unstyled bare HTML. The new preview_protocol.rs registers the ccgui-preview protocol, which keeps the real path structure (each segment decoded separately; a segment decoding to a slash, a backslash, NUL or . / .. is rejected rather than silently retargeted), so sibling assets, module scripts and fetch resolve the way the browser expects. The scope reuses the asset scope ($HOME/** minus deny, canonicalised with symlinks followed), responses carry Cache-Control: no-store and Access-Control-Allow-Origin: null (usable by the sandbox frame's opaque origin), single-range requests are supported, and the CSP in tauri.conf.json allows frame-src ccgui-preview. The sandbox is allow-scripts allow-same-origin allow-forms allow-modals: scripts, forms and alert work, but the frame is cross-origin from the host and cannot reach CC GUI state, and top-level navigation and popups stay blocked. The preview renders what is saved on disk (unlike the Markdown preview's live draft): unsaved edits are still covered by the "unsaved" badge and the Save button, and the new Refresh button in the header (spinner → check) remounts the iframe to read from disk; switching to another tab unmounts the iframe entirely, so an off-screen preview never runs rAF or timers in the background. Web access mode has no native protocol for this and keeps the source view; files outside the scope preview as empty while source view and editing are unaffected.
- **The plugin market opens with an Editors' picks carousel**: the data comes from featured.json in the index repository (backend plugin_fetch_featured) and is an editorial layer on top of the index rather than a new plugin source — it shares the index's 1h cache and is fetched serially after plugin_fetch_index so it reuses the index pull that just happened; id validation, deduplication, the 8-item cap and control-character cleanup all happen in the backend, and covers are resolved from the index's repository to absolute https. It is a soft dependency: a missing or broken file folds into an empty list without writing marketplaceStore.error, so the table and its filters keep working, and an empty featured list means the carousel is simply not rendered. Autoplay is driven by the --animate-spotlight-progress keyframes in theme.css (6s, scaleX) and only advances on animationend: hover, focus entering, the window going to the background and prefers-reduced-motion all act on that same progress bar (bar stopped means paging stopped), and manual paging restarts the progress segment keyed by index. Covers fall back through four levels — editorial cover (object-cover) → the plugin's first screenshot (object-contain, never cropped) → its icon → a brand-colour initial block — and any onError downgrades one level, so a card is always filled; ←/→ page through the carousel, the dots carry "editors' pick n: name", and the region is aria-roledescription=carousel. The extracted MarketActionButton is shared by the market rows and the spotlight cards, so the install / update / installed state is decided in exactly one place, and plugin_fetch_featured is on the web read-only allowlist.
- **⌘W closes the tab, not the window**: a new closeTab shortcut action (⌘W by default, remappable in Settings → Shortcuts) runs the same handleTabClose path as clicking a tab's ×: a dirty file still asks to save (unsaved work is never dropped silently), other tabs (session / file / browser / plugin / single-instance) close immediately, and with no tabs open it is a no-op. On macOS Tauri's default menu binds ⌘W to the native Close Window (which destroys the window, so the frontend never sees the keydown), so app_menu.rs rebuilds the same application menu minus that item and the key event reaches the webview, matching Windows / Linux; About / Quit (⌘Q is still behind quit_guard) / Edit / Window are unchanged.
- **Markdown preview supports ⌘F find**: preview mode in the header gains a magnifier button, and the shortcut shares the chatSearch action with the conversation search (each surface yields by visibility); matches are painted with the Custom Highlight API under independent highlight names (all matches yellow, the current one orange, so file and chat search can be on at once without overriding each other) inside the shared ContentSearchBar in the top-right corner, with a live match count, Enter / Shift+Enter to step through and Esc to close; a MutationObserver absorbs content rendered late by Mermaid and friends.

🐛 Fixes
- **Response verification resolves request aliases**: Claude's request selectors (opus, for instance) are passed to the CLI unchanged, and verification now uses the concrete model the CLI registry and channel mapping resolve for that launch, with the card showing "selector → concrete model". Provider-specific aliases resolve through their own registry, and remote runs never use the local registry; an unresolvable alias shows "unresolved" with a neutral question mark instead of counting as a mismatch or a pass, a response without an upstream report still says "not reported", and the badge stays hidden when there is no response evidence; a genuine difference in the concrete model or in a reported effort level is still an amber exclamation, and other engines and older events keep the previous comparison.
- **Markdown preview links lost their styling and click behaviour**: replacing Streamdown's built-in link component dropped its text-primary / underline classes, so anchors now carry .md-preview-link explicitly (green with a dotted underline, matching links in chat Markdown); clicks are handled in one place — https: / mailto: go to the system browser, relative and absolute file paths resolve against the Markdown file's directory and open as editor tabs, and directories, extension-less targets, #anchors and unknown schemes render as inert text so a webview navigation can never replace the app shell.
- **opencode's context gauge used the wrong denominator**: opencode's usage event carries token counts but no model_context_window, so the gauge fell back to an assumed 200k. The window is now parsed each turn from the managed serve's merged config (/config's provider.<pid>.models.<mid>.limit.context) and backfilled onto the usage event per provider/model, reusing the model_context_window key the other engines already read; a failed probe only yields an empty table and never affects the turn, and engines that already report a window are unchanged.
- **⌘F toggled the chat search from behind an invisible surface**: while another surface such as the file preview is in view, ⌘F now only acts on that surface instead of flipping the conversation search in the background.

🧹 Internal
- ui-ux-spec updated to v0.80 — v0.78 (⌘W and preview find), v0.79 (HTML preview and the ccgui-preview protocol) and v0.80 (the Editors' picks carousel) — with the §3 rules and the §7 refresh entries (HTML preview refresh, and the market index refresh also re-reading featured.json) registered alongside
- New shared pieces: ContentSearchBar (the find bar shared by chat search and the file preview), dom-text-search.ts, MarketActionButton (shared by market rows and spotlight cards) and files/editor-view-mode.ts; the backend gains app_menu (the macOS menu rebuild) and preview_protocol (the ccgui-preview protocol, with 5 Rust tests), and AppSettings gains close_tab_shortcut
- New browser fixture tests/browser/plugin-spotlight.html (checking "the progress bar is the timer" and uncropped screenshots in a real browser) and an updated markdown-preview.html (link styling and ⌘F highlighting); added docs/design/plugin-market-discovery.* (the three static design options compared before option A was chosen, no build step)
- The MiniMax Code badge in both READMEs now uses the in-repo icon (src/assets/model-icons/minimax-code.png) instead of the Google favicon service, and Cargo.lock's ccgui-next version is synced to 1.1.2`,
    },
  },
  {
    version: "1.1.1",
    date: "2026-10-07",
    content: {
      zh: `✨ 新功能
- **智能体升级为 Bots**：智能体从「一段可复用的角色提示词」变成长期存在的助手，存储也从单文件改成每个 Bot 一个目录（bot.json 存身份与运行配置，SOUL.md 是人格，AGENTS.md 是工作规则），文件可读可改，用任意编辑器都能维护。旧版智能体一次性迁移成目录并留下 .bak，迁移后在应用里删掉的 Bot 不会被复活。设置 → 智能体的列表行显示「名称 + 头衔 + 简介 + 运行后端 + 技能数」，点开是弹窗编辑器：左栏身份固定 400px 宽并独立滚动（名称 / 头衔 / 简介 / @标识 / 头像），右栏按「人格 / 工作规则 / 能力 / 运行后端 / 记忆 / 定时任务 / 协作」分区切换，身份不随分区切换丢失，编辑自动保存（600ms 防抖，头部在保存中 / 已自动保存 / 保存失败之间切换）；尚未实现的分区显示为只读概念流程图并明确标注「即将支持」，不隐藏入口。提示词拼装只有一份实现：区块顺序固定、空区块整块丢弃，编辑器里的拼装预览与真正发给模型的内容同源。
- **生成式纸片头像**：头像改用折纸形象（九种折形 × 十六种表情 × HSL 颜色，带折面明暗、颗粒、眨眼、视线游走与换形动画），可在头像工作室里逐项挑选，骰子一键随机（颜色只从预设色里取，不会随机出浑浊色）；列表行、# 菜单行、输入框徽标、消息气泡上的智能体徽标与编辑器大预览都走同一个渲染组件与同一份存储，小头像与大预览一样眨眼、一样游走视线。所有实例共用一条帧循环（最后一个订阅者退出即停），不再每个头像各起一个循环。既有 emoji / 图片头像原样保留，旧的 ASCII 预设 id 按 id 确定性生成形象，不会把预设 id 当文字塞进界面或提示词。
- **Bot 记忆**：设置 → 智能体 → 记忆从概念图换成真面板：MEMORY（每个 Bot 一份，默认 2200 字）与 USER（全局一份，1375 字）两个账本各带用量条，可手动增删改、导出、清空。写入只有一条路径——记忆面板、memory MCP 工具与后台复盘共用同一套安全扫描与容量闸：先扫描条目，再查容量，超限直接拒绝并附上当前用量（由调用方合并后重试），绝不截断或静默丢弃；引擎没有 MCP 通道时既不挂工具，也不在提示词里写记忆使用说明。两个开关：「写入需要审批」把模型与复盘的写入转成待审批队列（可逐条或全部批准 / 驳回，replace / remove 展示前后对比，批准时才过容量闸，暂存后原文已变则拒批），面板里的手动写入永远直接落盘；「会话结束后后台复盘」每累计 N 轮（默认 5）触发一次，并在会话结束时补跑没复盘过的轮次，缺渠道等情况就地说明跳过原因。
- **内网访问（局域网 Web）支持选择网卡、自启与固定端口 / Token**：新增主机 IP / 网卡下拉，Windows 走 GetAdaptersAddresses 枚举物理网卡与虚拟隧道（Unix 走 getifaddrs），Tailscale 的 CGNAT 网段与局域网私有网卡优先置顶并附网卡名，未安装 Tailscale 时纯内存退化、不报错；切换 IP 会同时更新访问地址、复制内容与二维码。新增「随应用自动开启」开关，应用启动即静默拉起服务；端口可固定（留空或 0 仍为随机分配，被占用给友好提示并可重置），Token 持久化（自填少于 16 位拒绝保存、可重新生成、运行中修改提示重启）。
- **Git 变更面板支持树状结构与多选提交**：页头一键在树状视图与列表视图之间切换并记住偏好；树状视图按路径构建目录层级、单子目录自动折叠，目录复选框三态联动（全选 / 半选 / 取消）并递归更新子项，底部提交栏按勾选的文件提交。状态颜色与文件图标对齐 IntelliJ IDEA 习惯（修改为天蓝、新增为森林绿、删除为中性灰加删除线、未跟踪为砖红、重命名为青蓝），覆盖常见语言与配置文件类型，目录图标在展开 / 收起时切换形态。提交按「整个文件」语义执行：同一文件同时有已暂存与未暂存改动时，提交前自动把工作区剩余改动一并暂存；当提交会把「已暂存但未勾选」的文件移出暂存区时先弹确认框说明数量，确认后才执行，取消则完全不触碰暂存区。
- **上下文窗口自动压缩（按会话保存）**：自动压缩阈值和纯图标开关按单个会话保存；当前会话达到配置的百分比且空闲时，自动复用 compact 命令压缩上下文，压缩完成后自动把任务接回去（压缩失败则等用量继续增长后重试，不会闩死）。压缩的调度行不进对话：压缩指令变成一行灰色的「正在压缩上下文」提示并留在原处（压缩完成后仍可回溯），续接提示完全不显示。
- **幕布区新增响应校验图标**：尾部「模型 · 推理档位」指示器旁多一个校验图标，悬停弹出与 token 用量卡同款的卡片，列出请求侧与响应侧各自的模型与推理档位：一致是默认色圆勾，不一致是黄色圆叹。比较容忍 provider 前缀（provider/model）与 -latest / 日期快照（记为版本差异但判一致），档位大小写与分隔符不敏感（xhigh 等同 extra-high）；上游没有上报不算通过，卡片会明示「未上报」。证据只在响应真的给出时才上报（Claude 的 assistant.message.model / thinking_effort、Pi 的 message.upstreamModel、Codex 的线程设置与 model/rerouted 的 toModel），徽标在回合结算后留在消息尾部。
- **新增 MiniMax Code CLI（mcode）引擎**：第 12 个引擎，本地工作区走 mcode acp（ACP、Own 传输），WSL 远程工作区回退 mcode exec --output-format stream-json 子进程；聊天引擎下拉与设置 CLI 管理按既有数据驱动形态自动出现，模型目录有独立探针，历史发现读 mcode 运行时的 sqlite、删除按目录型锚定校验；权限模式走 configOption permissionMode（default / auto / bypassPermissions）与 session/set_mode 的 plan，模型选择按会话自身广播的内部值解析，未命中时警告并沿用 CLI 默认；图片按绝对路径注入文本块交给 agent 自读；MCP 页对 minimax 如实标注不支持，不顶着空来源列表冒充原生。
- **插件 SDK 0.3.20（共通兼容线）**：把 CCB 通用层（会话 / 回合 / 切换 hooks、标准化运行时事件、内部提示贡献与内部帧捕获、CAS 文档存储）与 Live2D 通用层（常驻悬浮层、同源资源路由与目录授权）收敛成一份自洽的公共契约，并叠加此前已发布的 ctx.workspaces.list / ctx.worktrees.create / ctx.window / ctx.models / ctx.sessions.startRun。新增：ctx.window（读取主窗口物理像素 bounds / 状态 / DPI，普通态下经最小 640×480 与多屏可见范围校验后设置 size + position，Windows 可按真实进程名采样微信主窗口）、ctx.models.catalog（按引擎、按来源部分成功，显式刷新才联网，错误固定脱敏）、ctx.worktrees.remove（走宿主「删除 Worktree」同一条流程，目录已成孤儿时宿主自行清理并 prune）、ctx.sessions.startRun / interruptRun（把插件的一轮跑成宿主聊天会话，侧栏可见、实时流式、停止按钮照常可用，model / effort / provider 只覆盖这一轮；中断只停本插件起的轮次）、ctx.ui.registerOverlay（跨路由非模态悬浮层，空白区域点击穿透）、ctx.assets 与 assets:bundle / assets:directory 目录授权、ctx.shell.revealPath、TurnHooks.onTurnStarted 与 permission-requested 运行时事件。资源与路径有硬边界：本地资源单文件 64 MiB、远程代理单次 8 MiB 且限时 30 秒，禁止用远程 / 目录资源执行脚本，文档与资源路径在规范化前拒绝空段、. 与 ..（含末尾斜杠），目录授权在 IPC 边界拒绝 $HOME 本身、文件系统根以及 .ssh / .aws / .gnupg / .ccgui-next 及其祖先。所有能力经正式 PluginContext，宿主与前端运行时双重权限检查，API Key、Token、完整 provider 配置与环境变量一概不返回给插件。
- **原生 title 属性统一渲染为主题化气泡**：新增挂在 App 根部的原生 title 接管组件，用 MutationObserver 把全局 title 文案搬进 data-native-tooltip 并置空原属性，悬停 / 键盘聚焦 500ms 后以与应用一致的深色气泡渲染（带箭头、视口边缘钳制、滚动 / 缩放 / Esc 收起），文案变更实时同步，并复制一份到 aria-description 保住读屏描述；存量控件与第三方插件零改造即获得一致体验。
- **插件中心「已安装」新增来源筛选**：页头下拉可在全部 / 最近安装（3 天内，按安装时间倒序）/ 市场安装 / 本地安装之间过滤，判定依据是安装记录的来源与首次安装时间（重装 / 更新不刷新该时间），筛到空可一键清除筛选。
- **新增 API Route 供应商预设**：Claude 用 https://global.api-route.com 与显式模型族映射（通用模板的模型默认值不会漏进来），Codex 用 https://global.api-route.com/v1 与 wire_api = responses，随附品牌图标与中英文配置说明。
- **底部代理开关在无配置时也可见**：首次启动、尚未填任何代理地址时不再隐藏图标，而是显示关闭态，点击进入设置 → 网络代理；不会自动启用代理，也不会写入默认地址。已开启但地址后来失效时仍允许关闭；无配置入口不再声明 aria-pressed。

🐛 修复
- **Pi / OMP 请求参数兼容性**：移除自 1.0.6 引入的通用推理字段注入，由 CLI 按实际模型与供应商协议生成请求，修复 OMP OpenAI Codex 通道的 Unsupported parameter: reasoning_effort 错误；保留原生推理档位传递，无需降低 xhigh。
- **OMP 内置 /compact 压缩后会话卡住**：内置 compact 被当成普通提示词发给 OMP，OMP 识别为本地 slash 命令后直接短路（agentInvoked:false），既不启动模型回合也不产生任何宿主用于结算的终态事件，于是 streaming 永远为真、压缩 Promise 永不 resolve；现在宿主发起的 /compact 与用户自定义的 /compact 目录命令显式区分，前者改走 OMP 原生 compact RPC，压缩完成后会话正常继续。
- **老 WKWebView / 老 WebKit 打开即崩**：Safari / WKWebView < 16.4（macOS < 13.3）无法解析 lookbehind，渲染任何 Markdown 都会在 remark-gfm 的邮件自动链接正则上抛 Invalid regular expression: invalid group specifier name，而应用启动就会解析 Markdown（恢复会话、升级后首启打开版本说明）；补丁回退该正则（2.0.0 本来就是无 lookbehind 的写法，2.0.1 的性能重构才引入），行为不变并加守卫用例。同时在入口最早处补齐旧引擎缺失的内建方法（Object.hasOwn、Array.prototype.at、Promise.withResolvers、URL.canParse、structuredClone 与 dialog.showModal 的兜底，原生存在即跳过），修掉 Markdown 渲染、Mermaid 预览、局域网网页模式、图片灯箱等路径上的第二类崩溃。
- **局域网（非安全 HTTP）下复制即崩**：非 localhost 的 HTTP 源拿不到 navigator.clipboard（规范要求安全上下文），任何复制操作（代码块、消息内容、诊断报告、Web 访问链接、配对密钥、抖音号）与右键菜单复制都会抛 TypeError 并被顶层错误边界接管成崩溃页，崩溃页上的「复制诊断报告」还会再崩一次；现在提供 copyText 与降级 polyfill（优先原生，缺失时回退 execCommand），Web 授权卡补齐复制 → 对号反馈。
- **Claude 本地指令不再显示成对话**：/model、/login、/clear、/effort 这类本地指令在记录里是 caveat、指令正文与可选 stdout，此前被当成用户消息，侧边栏标题与对话正文都会出现；现在按记录结构处理（看到 local-command-caveat 就丢掉后续指令正文与 stdout），不写死指令名。
- **opencode 1.18 的会话历史**：1.18 用单个 opencode.db（SQLite）替换了旧的 storage 目录树，历史发现只扫旧目录导致重启后侧栏一个 OpenCode 会话都看不到；现在从 session 表按 directory 归因工作区并复用原有的读取 / 删除管线，旧目录树路径继续兼容。同时把子代理会话（parent_id 非空）与空会话从侧栏隐藏，spawned 的子代理不再和真实会话并列。
- **子代理派完不再立即显示「已完成」**：运行状态条此前把「父 assistant 是否仍在流式输出」当成「子代理是否还在跑」，工具结果到达、下一句还没开始的那一拍就让所有已派发但尚未出现在快照里的子代理变成了已完成；现在按派发与快照证据判断，未完成的子代理保持运行中。
- **Claude 自定义模型的用量归属**：实际运行模型不再被 haiku / sonnet 这类选择器别名覆盖，用量台账与消息模型标记优先采用本轮引擎上报的真实模型名；会话列表刷新不再覆盖运行中的模型，不改写历史台账，选择与下次发送规则保持不变。
- **Codex 长线程恢复失败**：长会话的 thread/resume 会把每个历史回合塞进一帧 NDJSON，超过 16 MiB 安全上限后读取器会终止这次本来有效的恢复；现在恢复时发送 excludeTurns: true 并按需协商 experimentalApi（16 MiB 上限保留作为 OOM 保护），thread/start 行为不变。
- **输入框文件拖放在桌面端失效**：拖放监听此前注册在 Window 事件目标上，而 Tauri 当前的拖放通知发往 Webview 目标；订阅改挂 Webview 后拖放恢复。
- **并发会话的额外重绘与重复历史扫描**：运行状态点只保留静态阴影、呼吸动画只改 transform / opacity（0.92s 节奏、退避重试与减少动态效果的静态反馈不变），并消掉随会话数增长的重复历史扫描；无头 Chromium 实测 12 会话时主线程 TaskDuration 从 288.9ms 降到 2.9ms，侧栏与页签的 Paint 事件基本归零。
- **插件注册的工作区右键菜单条目有了入口**：侧栏项目右键菜单此前只渲染内置项，声明了 ui:workspace-menu 的插件（如 CCB）注册后没有任何入口；现在按内置项 → 分隔线 → 插件项渲染，目标恒为右键那一行且不改变活动项目，label 支持状态小字，单条插件条目抛错只丢自己。
- **原生 title 接管的边界缺陷**：修正触发与关闭的边界情况，title 变更时同步更新 aria-description，补齐规范与回归测试。

🧹 内部优化
- ui-ux-spec 更新至 v0.77，新增 Bots 与记忆、并发会话动画、Git 树与 IntelliJ 配色、内网访问、剪贴板降级、title 接管、自动压缩的用户可见契约、插件来源筛选、工作区右键菜单与 mcode 等规则
- 插件 SDK 契约收敛：contract-check 补齐 ExternalSessionRow / PluginAssets / AssetDirectoryGrant / PermissionRequestedEvent / NormalizedRuntimeEvent 与各能力组的双向可赋值断言（顺带修掉 plugin.d.ts 缺少 worktrees.remove 的漂移），权限目录以 spec/permissions.json 为单一事实源（TS / Rust / 模板校验脚本三方共享），兼容线 SDK 与前端回归纳入 CI
- 新增 docs/plans/2026-09-30-concurrent-chat-cpu.md 与 bots-upgrade-plan.zh-CN.md，浏览器夹具补充 bot-editor 等；清理已过时的原型与设计稿（docs/prototypes/plan-execute-sop、docs/concepts 的 mission 原型、docs/design/worktree-mockup）
- 后端新增 bots 模块与 memory 子模块（store / scan / pending / review / mcp）以及 engine/minimax 系列，内网访问改用原生网卡枚举（Windows GetAdaptersAddresses、Unix getifaddrs）
- 组件模块拆分：把非组件导出从渲染模块里分离、修正渲染期副作用与状态收敛（行为不变）`,
      en: `✨ Features
- **Agents become Bots**: an agent grows from "a reusable role prompt" into a long-lived assistant, and its storage changes from a single file to one directory per bot (bot.json holds identity and runtime config, SOUL.md is the persona, AGENTS.md the working rules) so it can be read and edited with any editor. Existing agents migrate into directories once, keeping a .bak, and a bot deleted in the app is never resurrected. Settings → Agents lists each bot as "name + title + description + runtime + skill count" and opens a modal editor: a fixed 400px identity column that scrolls on its own (name / title / description / @handle / avatar) and a section column that switches between Persona / Rules / Capabilities / Runtime / Memory / Routines / Collaboration without losing the identity; edits auto-save (600ms debounce, the header cycles through saving / saved with a timestamp / failed with the reason); sections that are not implemented yet show a read-only concept diagram marked "coming soon" instead of being hidden. Prompt assembly has exactly one implementation — fixed block order, empty blocks dropped whole — so the editor's assembly preview is what the model actually receives.
- **Generated paper avatars**: avatars become folded-paper characters (nine fold shapes × sixteen expressions × HSL colours, with faceted shading, grain, blinking, gaze wandering and shape-morph animations) that can be picked piece by piece in the avatar studio, with a dice button for a random combination (colours come from the curated presets only, so nothing muddy is ever generated). The settings list row, the # menu row, the composer chip, the agent badge above message bubbles and the large editor preview all share one renderer and one stored config, so a 16px avatar blinks and wanders its gaze exactly like the big preview. Every instance shares a single frame loop that stops when the last subscriber leaves, instead of one loop per avatar. Existing emoji / image avatars keep rendering as they are, and the old ASCII preset ids deterministically generate a look from the id — a preset id never leaks into the interface or the prompt as text.
- **Bot memory**: Settings → Agents → Memory turns from a concept diagram into a real panel: two ledgers — MEMORY (one per bot, 2,200 characters by default) and USER (one globally, 1,375 characters) — each with a usage bar, plus manual add / edit / delete, export and clear. Writes have a single path — the panel, the memory MCP tool and the background review all go through the same safety scan and capacity gate: scan first, then check capacity, and reject over-limit writes with the current usage attached (the caller merges and retries) rather than truncating or silently dropping anything; an engine without an MCP channel gets neither the tool nor the memory instructions in its prompt. Two switches: "Writes need approval" turns model and review writes into a pending queue (approve or reject one by one or all at once, replace / remove show a before/after comparison, the capacity gate runs at approval time, and a stale original is rejected) while manual panel writes always land directly; "Background review after a session ends" runs every N turns (5 by default) and catches up on un-reviewed turns when the session ends, explaining locally why it was skipped when no channel is available.
- **Web access (LAN) gains adapter selection, auto-start and fixed port / token**: a host IP / adapter dropdown (Windows enumerates physical adapters and virtual tunnels through GetAdaptersAddresses, Unix through getifaddrs) puts Tailscale's CGNAT range and private LAN adapters first with their adapter names and degrades in memory without errors when Tailscale is not installed; switching the address updates the URL, the copy text and the QR code together. A new "start automatically with the app" switch brings the service up silently on launch; the port can be fixed (blank or 0 still means a random port, with a friendly message and a reset when it is taken) and the token persists (a custom token shorter than 16 characters is refused, it can be regenerated, and changing it while running prompts a restart).
- **Git changes panel gains a tree view and multi-select commits**: the header toggles between tree and list views and remembers the preference; the tree builds directory levels from paths, collapses single-child directories, and gives every directory a tri-state checkbox (checked / indeterminate / unchecked) that updates its children recursively, with the commit bar submitting the checked files. Status colours and file icons follow IntelliJ IDEA habits (modified in blue, added in forest green, deleted in neutral grey with a strikethrough, untracked in brick red, renamed in cyan), covering common languages and config file types, and folder icons change shape when expanded. Commits follow whole-file semantics: when a file has both staged and unstaged changes, the remaining working-tree changes are staged before committing, and when a commit would move a staged-but-unchecked file out of the index a confirmation explains how many and only proceeds after you agree — cancelling leaves the index untouched.
- **Per-session automatic context compaction**: the threshold and icon-only toggle are stored per conversation; when an idle session reaches its configured percentage, the existing compact command compacts the context and the task picks itself back up afterwards (a failed compaction retries once the context grows again, so the session never latches shut). The scheduling rows stay out of the transcript: the compact command becomes a single grey "Compacting context" line in place (still there after the compaction finishes) and the resume nudge never renders.
- **Response-verification badge in the transcript**: next to the "model · reasoning level" tail indicator a verification icon opens the same card as the token-usage chip on hover, listing the model and reasoning level of both the request and the response: a check in the default colour when they agree, an amber exclamation when they do not. Comparison tolerates provider prefixes (provider/model) and -latest / date snapshots (recorded as a version difference but still a match), ignores case and separators in reasoning levels (xhigh equals extra-high), and never counts a missing upstream report as a pass — the card says "not reported" instead. Evidence is only reported when the response actually provides it (Claude's assistant.message.model / thinking_effort, Pi's message.upstreamModel, Codex thread settings and model/rerouted's toModel), and the badge stays on the message after the turn settles.
- **New MiniMax Code CLI (mcode) engine**: the twelfth engine — local workspaces run mcode acp (ACP, own transport) while WSL remote workspaces fall back to the mcode exec --output-format stream-json subprocess; the composer engine picker and Settings → CLI management pick it up through the existing data-driven wiring, with a dedicated model catalog probe, history discovery from mcode's runtime sqlite, directory-anchored delete validation, permission modes through the configOption permissionMode (default / auto / bypassPermissions) plus session/set_mode plan, model selection resolved from the value the session itself broadcasts (warning and falling back to the CLI default when it does not match), images injected as absolute-path text blocks for the agent to read, and the MCP page honestly marking minimax as unsupported rather than posing as native with an empty source list.
- **Plugin SDK 0.3.20 (shared compatibility line)**: the CCB generic layer (session / turn / switch hooks, normalized runtime events, internal prompt contributions and internal-frame capture, CAS document storage) and the Live2D generic layer (persistent overlays, same-origin asset routing and directory grants) are merged into one self-consistent public contract together with the previously released ctx.workspaces.list / ctx.worktrees.create / ctx.window / ctx.models / ctx.sessions.startRun. New APIs: ctx.window (read the main window's physical-pixel bounds / state / DPI and set size + position in the normal state after a 640×480 minimum and multi-screen visibility check; on Windows it can also sample the WeChat main window by its real process name), ctx.models.catalog (partial success per engine and source, network only on explicit refresh, errors redacted to fixed strings), ctx.worktrees.remove (the same pipeline as the host's Delete Worktree, with the host cleaning up and pruning an orphaned directory), ctx.sessions.startRun / interruptRun (run a plugin turn as a real host chat session — visible in the sidebar, streaming live, the stop button working as usual, with model / effort / provider overriding only that turn; interrupting only stops runs the plugin started), ctx.ui.registerOverlay (non-modal overlays across routes with click-through in empty areas), ctx.assets with the assets:bundle / assets:directory grants, ctx.shell.revealPath, TurnHooks.onTurnStarted and the permission-requested runtime event. Resources and paths have hard limits: 64 MiB per local file, 8 MiB and 30 seconds per remote proxy fetch, no script execution from remote or directory assets, empty segments, . and .. (including a trailing slash) rejected before normalisation, and directory grants refusing $HOME itself, the filesystem root and .ssh / .aws / .gnupg / .ccgui-next or their ancestors at the IPC boundary. Every capability goes through the official PluginContext with permission checks on both the host and the front-end runtime, and API keys, tokens, full provider configs and environment variables are never returned to plugins.
- **Native title attributes render as themed tooltips**: a takeover component mounted at the app root watches the whole document with a MutationObserver, moves each title into data-native-tooltip and blanks the native attribute, and renders the text as the app's own dark tooltip 500ms after hover or keyboard focus (with an arrow, viewport-edge clamping and dismissal on scroll / zoom / Esc); the text stays in sync when it changes and is copied into aria-description so screen readers still get it. Existing controls and third-party plugins get the consistent look with zero changes.
- **The Installed tab in the plugin center gains a source filter**: a header dropdown filters between All / Recently installed (within 3 days, newest install first) / Market / Local, decided by the install record's source and first-install time (reinstalling or updating does not refresh it), and an empty result can be cleared in one click.
- **New API Route provider preset**: Claude uses https://global.api-route.com with explicit model-family mappings (the generic template's model defaults do not leak in) and Codex uses https://global.api-route.com/v1 with wire_api = responses, shipped with the brand logo and short English / Chinese setup instructions.
- **The proxy toggle stays visible before any proxy is configured**: the status-bar icon is no longer hidden on a first launch with no proxy address; it shows the off state and opens Settings → Network proxy when clicked. No proxy is enabled automatically and no default address is written. A proxy that was enabled but whose address later went stale can still be turned off, and the unconfigured entry point no longer claims aria-pressed.

🐛 Fixes
- **Pi / OMP request compatibility**: Remove the generic reasoning-field injection introduced in 1.0.6 and let the CLI encode requests for the selected model and provider. This fixes Unsupported parameter: reasoning_effort on OMP's OpenAI Codex channel while preserving native thinking-level selection, with no need to lower xhigh.
- **OMP's built-in /compact no longer stalls the session**: the built-in compact was sent to OMP as ordinary prompt text, and once OMP recognised it as a local slash command it short-circuited (agentInvoked:false) without starting a model turn or emitting any of the terminal events the host settles on, so streaming stayed true forever and the compaction promise never resolved; the host's /compact is now explicitly distinguished from a user-defined /compact directory command and goes through OMP's native compact RPC, so the session continues normally afterwards.
- **Old WKWebView / old WebKit crashed on open**: Safari / WKWebView < 16.4 (macOS < 13.3) cannot parse lookbehind, so rendering any Markdown threw Invalid regular expression: invalid group specifier name from remark-gfm's email autolink pattern — and the app parses Markdown on start (restoring sessions, opening the release notes after an upgrade). A patch reverts that pattern (2.0.0 never had the lookbehind; the 2.0.1 performance refactor introduced it), behaviour is unchanged and a guard test fails if it ever comes back. At the same time the earliest entry point now installs fallbacks for the built-ins old engines lack (Object.hasOwn, Array.prototype.at, Promise.withResolvers, URL.canParse, structuredClone and dialog.showModal, each skipped when the native one exists), fixing the second class of crashes across Markdown rendering, Mermaid previews, the LAN web mode and the image lightbox.
- **Copying over insecure HTTP (LAN) crashed the app**: a non-localhost HTTP origin has no navigator.clipboard (the spec requires a secure context), so every copy action (code block, message content, diagnostics report, web-access link, pairing key, Douyin handle) and every context-menu copy threw a TypeError that the top-level error boundary turned into the crash page — where "Copy error" then crashed again. A copyText helper with a polyfill now prefers the native API and falls back to execCommand, and the web authorization card gained its copy → check feedback.
- **Claude local commands no longer show up as conversation**: /model, /login, /clear, /effort and friends are stored as a caveat, the command text and optional stdout, but they were parsed as user messages, so they appeared as sidebar titles and in the transcript; they are now handled by record structure (seeing local-command-caveat drops the following command text and stdout) without hard-coding command names.
- **opencode 1.18 session history**: 1.18 replaced the old storage directory tree with a single opencode.db (SQLite), and discovery only scanned the old tree, so the sidebar showed no OpenCode session at all after a restart; sessions are now discovered from the session table, attributed to a workspace by directory, and fed through the existing read / delete pipeline, with the old tree still supported. Spawned subagent sessions (non-null parent_id) and empty sessions are hidden from the sidebar instead of being listed next to real conversations.
- **Subagents are no longer marked complete the moment they are dispatched**: the run-status strip treated "the parent assistant is still streaming" as "the subagents are still running", so the moment a tool result arrived and before the next sentence started, every dispatched subagent that had not yet appeared in the hub snapshot flipped to complete; completion is now derived from dispatch and snapshot evidence, and unfinished subagents stay running.
- **Usage attribution for Claude custom models**: the real running model is no longer masked by selector aliases such as haiku or sonnet — the usage ledger and the message model marker now prefer the model the engine reported for the turn; refreshing the session list no longer overwrites a running model, historical ledgers are never rewritten, and selection and sending rules are unchanged.
- **Long Codex threads failed to resume**: thread/resume hydrates every prior turn into one NDJSON frame, and once that frame exceeded the 16 MiB safety limit the reader terminated an otherwise valid resume; resumes now send excludeTurns: true and negotiate experimentalApi when needed (the 16 MiB cap stays as an OOM guard) while thread/start is unchanged.
- **Composer file drops stopped working on desktop**: the drop listener was registered on the Window event target while current Tauri emits drag-drop notifications to the Webview target; subscribing to the webview restores drops.
- **Concurrent sessions repainted extra and re-scanned history**: the run-status dots now keep a static shadow with a breathe animation limited to transform / opacity (same 0.92s rhythm, retry and reduced-motion static feedback), and repeated history scans that grew with the session count are gone; headless Chromium measured 12 sessions dropping from 288.9ms to 2.9ms of main-thread TaskDuration, with the sidebar and tab strips going from 1,083 / 4,680 / 9,025 Paint events to essentially zero.
- **Plugin workspace context-menu entries finally have an entry point**: the sidebar's project context menu only rendered built-in items, so a plugin declaring ui:workspace-menu (CCB, for instance) registered entries that could never appear; the menu now renders built-in items → separator → plugin items against the row that was right-clicked without changing the active project, labels support status text, and a failing entry only drops itself.
- **Native title takeover edge cases**: fixed the trigger and dismissal edge cases and kept aria-description in sync when the title changes, with rules and regression tests to match.

🧹 Internal
- ui-ux-spec updated to v0.77 (Bots and memory, concurrent-session animation, the Git tree and IntelliJ colours, web access, the clipboard fallback, native title takeover, the user-visible auto-compaction contract, the plugin source filter, the workspace context menu and mcode)
- Plugin SDK contracts tightened: contract-check gained two-way assignability assertions for ExternalSessionRow / PluginAssets / AssetDirectoryGrant / PermissionRequestedEvent / NormalizedRuntimeEvent and every capability group (which surfaced and fixed plugin.d.ts missing worktrees.remove), spec/permissions.json is the single source of truth for permissions (shared by TS, Rust and the template validation script), and the compatibility line's SDK and front-end regressions run in CI
- New docs/plans/2026-09-30-concurrent-chat-cpu.md and bots-upgrade-plan.zh-CN.md, plus browser fixtures such as bot-editor; obsolete prototypes and mockups removed (docs/prototypes/plan-execute-sop, the docs/concepts mission prototypes, docs/design/worktree-mockup)
- The backend gains a bots module and the memory submodules (store / scan / pending / review / mcp) alongside the engine/minimax files, and web access switches to native adapter enumeration (GetAdaptersAddresses on Windows, getifaddrs on Unix)
- Component modules split so non-component exports no longer live in render modules, with render-time side effects and state settling fixed (no behaviour change)`,
    },
  },
  {
    version: "1.1.0",
    date: "2026-09-28",
    content: {
      zh: `✨ 新功能
- **对话区分屏（Trellis 式）**：中心区支持递归分屏，侧栏会话行或页签条里的会话页签拖到中心区即可分屏（**边带 = 在该方向切分**、**中心 = 放入 / 替换**；页签向下拖出页签条约 24px 交接给分屏层，横向拖动仍是排序）；格子标题栏提供「向右 / 向下分屏 / 关闭这一格」，侧栏会话右键「向右 / 向下分屏」，页签条右键「退出分屏」；拖动格子标题栏到另一格可实现整格搬家或内容互换。聚焦格 = 页签条高亮的那条对话所在的格子：点格子任意处即聚焦并激活其会话，点侧栏里已分屏的会话只是聚焦对应格；每个格子有自己的输入框、队列与运行状态（发送 / 排队 / 中断 / 加载更早 / 队列操作都按格子会话定向，授权、问答、计划审批卡从本格会话取数，@path 插入解析到聚焦格），/mcp 面板全局只挂一次；拖动分隔条改比例（两侧各留最小 220px、纵向 140px）；布局持久化在 localStorage 并在恢复时校验结构与会话，页签关掉的会话其格子一并消失，回到单栏时清掉持久化
- **计划预览与人工审批**：「计划」权限模式在 OMP（ACP elicitation.form + set_mode plan，计划文件全文校验）、Codex（app-server next_turn 的 collaborationMode plan，原子执行 turn）、dsh（host plan-review intent）三个引擎接通；grok / qoder 协议证据不足保持不可用，显式 plan 请求在发送前受控拒绝，不降级 auto / bypass。规划期间时间线显示计划卡（标题 / 引擎 / 版本 / 状态 / 摘要），草稿只可流式预览、不能批准，完整计划到达后进入「等待审批」；「查看完整计划」打开预览层（宽屏侧面板、窄屏全宽，复用消息 Markdown 渲染与安全处理，Esc / 点背景只收起界面、不发任何审批 IPC），复制按钮复制原文；审批在输入区 dock：「批准并执行」（旁注将沿用的执行权限，批准不改变权限）／「提出修改」（要求非空反馈，Enter 只换行、Cmd/Ctrl+Enter 提交）／「暂不执行」（计划保留未批准，卡片显示「继续审批」可随时重开 dock）；默认焦点不在批准按钮，提交中防重入，后端按 planId + revision CAS 仲裁，双击 / 双窗口只生效一次；冲突给出通知并保持只读快照，错误保持待审可重试；九个状态各有不依赖颜色的可访问文本徽标，已批准 / 已失效 / 已被取代只可查看与复制；与插件会话模式双向互斥；重开会话经 listPlanReviews 恢复历史计划与决策
- **设置搜索可搜页面内部的行**：左导航搜索从只匹配页标题扩展为两条 lane——「命中行」按目标页分组（组标题 = 页面名，行内显示「行标签 + 所在卡片」），点选或回车打开该页、滚动到该行并画 1.2s 内侧 focus ring；「命中页面」保留页标题子串过滤，两条都空才显示空状态。行索引是声明式的（settings-search.ts 注册表 + 内置页清单 builtin-search.ts），不预渲染页面扫 DOM；覆盖通用、网络代理、快捷键、检查更新、内测功能、性能诊断、Web 访问（含「公网访问」面板里的四行）、11 个 CLI 引擎页、智能体与提示词 / Skills（页签本身可搜）、工作区分组 / 项目 / 已授权目录；藏在页签或折叠卡里的目标由 activatorAnchor 先打开再定位（已打开不会点回去），品牌名用 labelText 保持不翻译；归档管理 / 用量 / 关于只提供页名入口
- **外观字体支持上传字体文件，界面缩放抽出共享存储**：设置 → 通用 → 外观的界面字体 / 代码字体改为「系统默认 / 自定义」；自定义经原生对话框选择 TTF / OTF / TTC / WOFF / WOFF2，Rust read_font_file 校验字体魔数与 64 MB 上限后回传，前端用 FontFace 注册为固定家族名并覆盖根变量 --font-inter / --font-mono-source，读取失败给本地化错误并保留原选择、不落半成品设置；路径持久化，切回自定义无需重选，旧 system 值与已安装字体名归一到系统默认；bootstrap 首帧前从 localStorage 镜像预应用，内置终端经 ccgui:font-change 热更代码字体并重新 fit。修复自带 Tailwind 的插件改写并成环 --font-sans / --default-font-family 导致字体设置静默失效（宿主在 :root 无层重推字体栈，插件 @layer 无法覆盖，回归守卫进 plugin-ui-tokens.test.ts）。界面缩放抽出 src/lib/zoom.ts：设置页缩放行、状态栏 ± 与缩放快捷键读写同一份 localStorage 并经 ccgui:zoom-change 事件同步，重启由状态栏重放。桌面宠物从通用页拆为「其他 → 桌面宠物」独立页，设置搜索的行索引随页面注册迁移。其它：⌘K / ⌘L / ⌘P 搜索面板输入框统一 palette-search-field，抑制 Windows WebView2 与后置插件样式画出的焦点框；输入框占位文案补充 @引用、#智能体；收起的 worktree 子行聚合显示会话运行状态点（退避重试降为静态点），展开后让位给各线程行
- **排队消息支持上下调序**：排队卡片每行在发送 / 移除之外新增「上移 / 下移」箭头；方向按用户看到的列表（卡片最新在上、队首在下）：上移 = 更晚发送，下移 = 更早发送；首尾行禁用对应方向（cursor + 降透明，不隐藏），仅队列多于一行时渲染，行首编号随重排实时重算；越界与未知 id 为 no-op，方向语义收在 QueueMoveDirection
- **CLI 选择器顺序跟随设置页拖拽排序**：设置页 CLI 管理栏的拖拽顺序此前只存在设置页，输入框的 CLI 选择器仍按注册顺序排列；现在两处共用 src/lib/cli-nav-order.ts（useSyncExternalStore，同标签页写派发事件），选择器按 cli:<id> 对齐设置页顺序，存储列表外的新引擎保持注册顺序排在末尾，设置页拖动时选择器同步重排
- **⌘L 会话搜索新增检索统计行**：内容 lane 存活时（查询 ≥2 字且「内容」筛选开启）在输入框下方显示一行状态：防抖与请求期间「正在检索…」，完成显示「耗时 {{time}} · 共检索 {{total}} 条消息」，失败显示「检索失败」且不留下上一查询的数字；后端 search_messages 新增 elapsedUs（只计 FTS / LIKE 查询与片段构建，pending / 语料计数在计时外）与 totalMessages；时长统一由 formatSearchDuration 格式化（<10ms 保一位小数、秒内整毫秒、跨秒两位小数秒）
- **新增 Requesty 供应商预设**：与 OpenRouter 预设对齐——Claude 的 ANTHROPIC_BASE_URL 为 https://router.requesty.ai，各档位默认模型使用 anthropic/claude-* 系列；Codex 为 https://router.requesty.ai/v1、wire_api = chat、模型留空由用户填写或拉取；README 中英文预设列表同步补充
- **文件 Markdown 预览支持表格与图表**：编辑模式预览改用 Vercel Streamdown 渲染——GFM 表格有表头与边框、代码块按语言高亮并带复制 / 下载按钮、支持 KaTeX 数学公式与 Mermaid 流程图（滚入视口才渲染），按钮文案随界面语言；暗色主题跟随现有语义色；相对路径图片仍解析到 Markdown 文件所在目录；外部链接继续交给系统浏览器打开

🐛 修复
- **进入页面即崩溃（unlisten 注册竞态）**：Tauri 2.11 的 listen() 在 Rust 应答后即 resolve，而 webview 侧监听条目由另一次 eval 写入，此刻调用 unlisten 会让注入的 unregisterListener 读取不存在的条目抛 TypeError（tauri#15799）；抛错发生在 _unlisten 发送 plugin:event|unlisten 之前，既产生未处理拒绝触发崩溃页，又泄漏 Rust 侧监听、重挂载后事件重复投递，StrictMode 开发态双挂载与晚到的 unlisten 都会命中；新增 installTauriUnlistenGuard() 按上游修复（PR #15800）语义吞掉缺失条目的抛错，让 _unlisten 继续发送 backend unlisten，tauri 依赖包含该修复后可删除该 shim
- **断网等环境性网络失败不再弹全屏崩溃页**：后台网络请求失败（更新检查的 reqwest error sending request、fetch 的 Load failed / Failed to fetch / NetworkError）是环境条件而非应用损坏；unhandledrejection 与 error 全局捕获统一分类，这类失败只记入诊断环，不再弹崩溃页、不写 localStorage（避免下次启动 watchdog 误报），真实未捕获错误照旧上屏；更新检查链路所有路径均有 catch
- **非安全 HTTP（局域网桥）环境下 crypto.randomUUID 缺失导致崩溃**：通过非安全 HTTP 访问（如局域网桥）时，浏览器 / WebView 的 crypto.randomUUID 因规范要求 SecureContext 而为 undefined，新会话渲染及 worktree / mission 等处抛 TypeError；新增 safeRandomUUID()（优先原生，缺失时用 getRandomValues 生成 RFC 4122 v4 UUID，极少数环境兜底 Math.random）并在入口尽早安装 polyfill，会话身份、worktree 创建 id 与 mission id 均改走该实现
- **选择模型下拉建议时整个界面崩溃**：Chromium 接受 datalist / autofill 建议时会先往输入框派发一个裸 Event("keydown")（没有 key、没有任何修饰键），全局快捷键分发器把它当击键处理，normalizeKey(undefined) 抛 TypeError；它在 window 事件监听里抛出，React 错误边界看不到，被全局处理器当成崩溃整页替换；现在分发器入口拦住没有击键的 keydown 直接返回，模型映射四个输入框与共用同一 datalist 的「模型」输入框一并修复
- **opencode 服务被内核提前清理**：ensure_server 返回的 kill-on-close 守卫绑定在局部变量上，函数返回即被释放，kernel 在健康检查刚通过时就把新起的 opencode serve 进程树清掉，随后的会话 POST 总是打到死端口报 error sending request；守卫改存入 OpencodeServerState（在 kill_spawned 释放），并修正 cfg(windows) 属性挂在赋值表达式上导致全平台编译失败（E0658，改为块语句）的问题
- **Codex 切换渠道后模型面板跳到 Claude Code**：渠道下拉收起前把焦点归还触发按钮，模型面板不再因焦点漂移跳回 Claude Code

🧹 内部优化
- ui-ux-spec 更新至 v0.61（检索统计行、设置搜索行索引、字体上传与缩放、计划审批、排队调序、对话区分屏等规则，§3、§7 同步）
- 新增浏览器夹具 tests/browser/split-layout.html（分屏、空格子、格子重排与内容互换、分隔条比例与最小宽度、持久化与回收、页签下拖分屏）与 plan-review.html、cli-channel-dropdown.tsx、markdown-preview.html（Streamdown 表格 / 代码块 / 数学 / Mermaid 懒渲染）；settings-search / builtin-search 测试逐页双向比对声明与渲染的锚点，并断言 activator 必须是同页可见锚点
- 计划审批后端新增 plan_reviews 表与 plan_review 模块（planId / revision CAS）、engine 侧 reader / omp_acp / dsh_session / codex_app 扩展与 listPlanReviews 命令；Cargo.lock 包版本同步到 1.1.0`,
      en: `✨ Features
- **Split view in the conversation area (Trellis-style)**: the center area now supports recursive splitting — drag a session row from the sidebar or a session tab from the tab strip into it to split (an edge band splits in that direction, the center drops in or replaces; dragging a tab about 24px past the bottom of the tab strip hands it to the split layer while horizontal dragging still reorders); a pane title bar offers Split right / Split down / Close this pane, a sidebar session's context menu offers Split right / Split down, and the tab strip's context menu offers Exit split view; dragging a pane title bar onto another pane moves the whole pane, and dropping on the center swaps the two panes' contents. The focused pane is the one whose conversation the tab strip highlights: clicking anywhere in a pane focuses it and activates its session, and clicking a session that is already split only focuses that pane. Each pane has its own composer, queue, and run state (send / queue / interrupt / load earlier / queue operations are routed to the pane's session, approval, question, and plan-review cards read the pane's session from SessionScope, and @path insertion resolves to the focused pane), while the /mcp panel is mounted only once. Dragging a separator changes the ratio (a 220px minimum on each side, 140px vertically); the layout persists in localStorage and is validated against structure and sessions on restore, panes disappear together with their closed tab, and returning to a single column clears the persisted layout
- **Plan preview and manual approval**: the plan permission mode is wired up for OMP (ACP elicitation.form + set_mode plan, with full-text validation of the plan file), Codex (collaborationMode plan over app-server next_turn, executing the turn atomically), and dsh (host plan-review intent); grok / qoder remain unavailable because the protocol evidence is insufficient, and an explicit plan request is refused before sending rather than silently downgraded to auto / bypass. While planning, the timeline shows a plan card (title / engine / revision / status / summary); a draft can only be previewed as a stream and cannot be approved, and once the full plan arrives the card becomes "Awaiting approval". "View full plan" opens a preview layer (a side panel on wide screens, full width on narrow ones, reusing the message Markdown rendering and sanitisation) where Esc / clicking the backdrop only dismisses it and sends no approval IPC, and Copy copies the source. Approval lives in the composer dock: "Approve and run" (annotated with the execution permission it will use — approving never changes permissions) / "Request changes" (requires non-empty feedback; Enter inserts a newline and Cmd/Ctrl+Enter submits) / "Not now" (ends this approval round — the dock collapses as the visible effect, the plan stays unapproved, the native wait stays put, and the timeline card shows a deferred note with a "Continue approval" button that reopens the dock at any time). Focus does not default to the approve button, submission is re-entrancy guarded, and the backend arbitrates with planId + revision CAS so a double-click or two windows yield exactly one approval; a conflict (superseded by another window or a newer revision) shows a notification and leaves a read-only snapshot, and errors stay pending and retryable instead of faking success. All nine states (Draft / Awaiting approval / Submitting / Approved / Changes requested / Deferred / Cancelled / Invalidated / Superseded) have accessible text badges that do not rely on colour, and approved / invalidated / superseded revisions offer only view and copy. Plan review and the plugin conversation mode are mutually exclusive in both directions, and reopening a session restores the plan history and decisions via listPlanReviews (localStorage is not the approval authority)
- **Settings search now finds rows inside pages**: the left-nav search goes from matching page titles only to two lanes — "Matching rows" (grouped by target page, the page name as the group heading, each row showing the row label plus its card), where clicking or pressing Enter opens the page, scrolls to the row, and draws a 1.2s inset focus ring; and "Matching pages", the original page-title substring filter — and the empty state only appears when both are empty. The row index is declarative (the settings-search.ts registry plus a per-page manifest in builtin-search.ts) instead of prerendering pages and scanning the DOM. Coverage spans General, Network proxy, Shortcuts, Check for updates, Beta features, Performance diagnostics, Web access (including the four rows behind the Public access panel), all 11 CLI engine pages, Agents & prompts / Skills (the tabs themselves are searchable), and Workspace (Groups / Projects / Authorized directories); a target hidden behind a tab or a collapsed card is opened first by an activatorAnchor and located afterwards (an already-open one is never clicked back shut), brand names use labelText so they stay untranslated, and Archive / Usage / About keep page-name-only entries
- **Interface and code fonts can now be uploaded, and zoom gets shared storage**: Settings → General → Appearance turns the interface font / code font pickers into "System default / Custom"; a custom font is picked in a native dialog (TTF / OTF / TTC / WOFF / WOFF2), validated by Rust read_font_file for the font magic number and a 64 MB cap, returned as base64, registered through FontFace under a fixed family name, and applied by overriding the root --font-inter / --font-mono-source variables — a read failure gives a localised error and keeps the previous choice rather than persisting a half-applied setting. The paths are stored (fontFamily / fontFile / codeFontFamily / codeFontFile), so switching back to Custom needs no re-picking, and old system values and installed font names normalise to System default; bootstrap pre-applies the localStorage mirror before the first frame, and the built-in terminal hot-swaps the code font via ccgui:font-change and re-fits. Also fixed: plugins that ship their own Tailwind rewrote --font-sans / --default-font-family into a cycle and silently defeated the font setting — the host now re-emits the font stack at :root outside any layer so plugin @layer rules cannot override it, with a guard in plugin-ui-tokens.test.ts. Interface zoom moved into src/lib/zoom.ts: the settings row, the status bar ±, and the zoom shortcuts read and write one localStorage entry and stay in sync through ccgui:zoom-change, with the status bar replaying it on restart. The desktop pet moved out of General onto its own "Other → Desktop pet" page, and the settings-search row index follows the page registration. Other tweaks: the ⌘K / ⌘L / ⌘P search fields share palette-search-field to suppress focus rings drawn by Windows WebView2 and by later plugins; the composer placeholder now mentions @ references and # agents; collapsed worktree sub-rows aggregate their sessions' run-status dots (a retrying backoff becomes a static dot) and yield to the per-thread rows once expanded
- **Queued messages can be reordered**: every queue card row gains up / down arrows next to send / remove; the direction follows the list as the user sees it (newest card on top, queue head at the bottom) — up means send later and down means send earlier; the first and last rows disable the corresponding direction (cursor plus reduced opacity rather than hiding it), the arrows only render with more than one queued item, and the row numbers are recomputed live after a reorder; moving out of range or an unknown id is a no-op, with the semantics kept in one place (QueueMoveDirection)
- **The CLI picker follows the settings-page drag order**: the CLI management order dragged in Settings persisted in localStorage, but the composer's CLI picker still used registration order, so the two disagreed; both now share src/lib/cli-nav-order.ts (a useSyncExternalStore store that dispatches an event on same-tab writes), the picker is aligned to the settings order by cli:<id> keys, engines not in the stored list keep registration order at the end, and dragging in Settings reorders the picker live
- **⌘L session search gains a stats row**: while the content lane is alive (a query of 2+ characters with the Content filter on) a status line appears under the input: "Searching…" during debounce and request, "Took {{time}} · {{total}} messages searched" on completion, and "Search failed" on failure without leaving the previous query's numbers behind; the backend search_messages returns elapsedUs (timing only the FTS / LIKE query and snippet building, with pending / corpus counting outside it) plus totalMessages; formatSearchDuration formats everything consistently (one decimal below 10 ms, whole milliseconds within a second, two decimal seconds across seconds)
- **New Requesty provider preset**: aligned with the OpenRouter preset — Claude gets ANTHROPIC_BASE_URL https://router.requesty.ai with anthropic/claude-* tier defaults, and Codex gets https://router.requesty.ai/v1 with wire_api = chat and a blank model for the user to fill in or fetch; the English and Chinese README preset lists both mention Requesty
- **Richer Markdown preview for files**: the editor preview now renders through Vercel Streamdown — GFM tables get a styled header and borders, code blocks are highlighted by language with copy / download controls, and KaTeX math plus Mermaid diagrams (rendered lazily when scrolled into view) are supported, with control labels following the UI language; the preview follows the app theme in dark mode, local-relative images still resolve next to the markdown file, and external links keep opening in the system browser

🐛 Fixes
- **Entering a page could crash the app (unlisten registration race)**: in Tauri 2.11 listen() resolves as soon as Rust replies, but the webview-side listener entry is written by a separate eval, so calling unlisten inside that window makes the injected unregisterListener read a missing entry and throw a TypeError (tauri#15799); because the throw happens before _unlisten sends plugin:event|unlisten, it both produces an unhandled rejection that triggers the crash page and leaks the Rust-side listener, so events are delivered twice after a remount — StrictMode's double mount in development and any late unlisten can hit it. installTauriUnlistenGuard() now swallows the missing-entry throw with the semantics of the upstream fix (PR #15800) so _unlisten still sends the backend unlisten; the shim can be deleted once the tauri dependency includes #15800
- **Environmental network failures no longer open the full-screen crash page**: background request failures (the updater's reqwest "error sending request", fetch's Load failed / Failed to fetch / NetworkError) are environmental conditions rather than app corruption; the global unhandledrejection and error capture now classify them and only log them to the diagnostics ring — no crash page and no localStorage write (avoiding a false watchdog report on the next start) — while genuinely uncaught errors still surface; every path in the update-check chain has a catch
- **crypto.randomUUID was missing on insecure HTTP (LAN bridge) and crashed the app**: over an insecure HTTP origin (such as a LAN bridge) crypto.randomUUID is undefined because the spec requires a secure context, so new-session rendering and the worktree / mission paths threw a TypeError. A safeRandomUUID() helper uses the native API when present, falls back to crypto.getRandomValues for a spec-compliant RFC 4122 v4 UUID, and in rare environments falls back to Math.random; a polyfill is installed early at the entry point, and the conversation identity, worktree creation id, and mission id all go through it
- **Picking a datalist suggestion for a model could crash the whole UI**: when Chromium accepts a datalist / autofill suggestion it first dispatches a bare Event("keydown") to the input (no key, no modifiers). The global shortcut dispatcher treated it as a real keystroke and normalizeKey(undefined) threw a TypeError; thrown inside a window listener, it is invisible to React error boundaries and the global handler replaced the whole page with the crash screen. The dispatcher now returns early on any keydown without a keystroke, fixing the four model-mapping inputs and the "model" inputs of engines that share the same datalist
- **The opencode server was swept by the kernel right after starting**: the kill-on-close guard returned by assign_kill_on_close() was bound to a local in ensure_server, so dropping it on return let the kernel tear down the freshly spawned opencode serve tree the instant the health check passed, and the session POST that followed always hit a dead port and failed with "error sending request". The guard now lives in OpencodeServerState (released in kill_spawned); the fix also moves the cfg(windows) attributes onto block statements, since attributes on assignment expressions are experimental (E0658) and made the crate fail to compile on every platform
- **Switching the Codex channel made the model panel jump to Claude Code**: the channel dropdown now returns focus to its trigger button before it collapses, so the panel no longer drifts back to Claude Code

🧹 Internal
- ui-ux-spec updated to v0.61 (the search stats row, settings row search, font uploads and zoom, plan review, queue reordering, split view, and related rules, with §3 and §7 kept in sync)
- New browser fixtures tests/browser/split-layout.html (splitting, empty panes, pane rearrangement and content swap, separator ratio and minimum widths, persistence and collection, and drag-out splitting from the tab strip) plus plan-review.html, cli-channel-dropdown.tsx, and markdown-preview.html (Streamdown tables / code / math / lazy Mermaid); the settings-search / builtin-search tests compare declared and rendered anchors in both directions per page and assert that every activator is a visible anchor on the same page
- The plan-review backend adds the plan_reviews table and the plan_review module (planId / revision CAS), engine-side reader / omp_acp / dsh_session / codex_app extensions, and the listPlanReviews command; Cargo.lock is synced to package version 1.1.0`,
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
