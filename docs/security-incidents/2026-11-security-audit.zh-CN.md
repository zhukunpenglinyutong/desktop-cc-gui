# 2026-11 全仓安全自查

> 起因：v1.2.0 被企业终端安全软件告警（见 `2026-11-v1.2.0-edr-alert.zh-CN.md`）。为了不再由别人替我们发现问题，按 9 个维度对全仓做了一次只读审查：引擎子进程、其他子进程、凭据、网络、插件隔离、文件系统、EDR 特征、前端注入、CI 与供应链。
> 「已复核」表示除审查 agent 外，又由主会话对照源码（含依赖库源码）逐条确认过；「需实测」表示结论依赖运行时行为，还需在真机上验证。
> 类别：A 可被利用的漏洞；B 会被安全软件判为恶意或可疑；C 用户不知情就做了敏感操作。

## 结论

- 没有发现投毒或后门代码。v1.2.0 官方安装包的来源可以证明，哈希见复盘文档第 7 节。
- 但还有不少问题，严重程度不亚于这次的 `cmdkey`：有的可以被直接利用（S1、S2、S3、S8、S9），有的很可能再次触发企业告警（S5、S6、S10）。
- 最大的结构性问题是**插件隔离实际不存在**：IPC 守卫从未生效，安装和更新时也不征求权限同意。

## P0：高危，建议在下个版本前处理

| 编号 | 问题 | 类别 | 触发 | 状态 |
|---|---|---|---|---|
| S1 | **HTML 预览能读取并外传家目录文件**。预览 iframe 设了 `allow-scripts allow-same-origin`（`HtmlPreview.tsx:8`），预览协议沿用 asset 作用域 `$HOME/**`，响应不带 CSP（`preview_protocol.rs:229`），`.html` 又默认以预览方式打开。页面脚本可以同源 fetch 家目录下的文件再发往外网。Windows 上连 `.codex\auth.json`、`.claude\.credentials.json`、`.git-credentials` 都能读，也绕过了凭据同意 | A+C | 打开任意 `.html`，例如克隆来的仓库、对话里的文件链接 | 已复核 |
| S2 | **插件拥有宿主的全部能力**。Tauri 2.11 起 `invoke` 不可改写，`hardening.ts` 的守卫在正式版上从未装上；安装和更新都不弹权限确认，新版本可以静默增加权限（`state.rs:84`、`fs.rs:327`、`market.rs:750`）。任何插件都能直接调用终端、`get_cli_config`（明文 API Key）、`official_config_read`（原样返回 auth.json） | A+C | 点「安装」或「更新」 | 守卫失效已复核；安装流程以审查结论为准 |
| S3 | **打开 MCP 页面就会执行仓库里写的命令**。`useAutoProbe` 在页面挂载时检测全部已启用条目，项目级 `.mcp.json`、`.codex/config.toml`、`.omp/mcp.json` 等默认算作已启用，执行时还隐藏窗口（`probe.rs:140`）。HTTP 条目的 URL 和请求头会展开 `${ENV}`，可以把环境变量里的 API Key 发出去 | A+B+C | 打开「设置 → MCP」或 `/mcp` 面板 | 已复核 |
| S4 | **主窗口运行百度统计的远程脚本**。CSP 放行了 `script-src https://hm.baidu.com`，`hm.js` 跑在拥有全部 IPC 的主窗口；Linux 上是后端下载后直接 `eval`。百度或其 CDN 被攻破，或者企业 TLS 解密代理改写这个脚本，就能在所有安装上执行任意代码。Web 端的访问令牌一直留在 URL 里，可能随统计上报外泄。没有开关，也没有告知 | A+B+C | 每次启动 3 秒后自动执行 | 加载部分已复核；令牌上报需抓包 |
| S5 | **性能诊断每 5 秒枚举全系统进程，并以 `PROCESS_VM_READ` 打开每个新进程**，lsass 也在其中（`metrics.rs:661` 用 `ProcessesToUpdate::All`，sysinfo 0.36 在 Windows 上 `OpenProcess(QUERY_INFORMATION\|VM_READ)`）。默认开启。这是「凭据窃取 / 注入准备」规则的典型特征，很可能是 v1.2.0 告警的又一来源 | B | 启动后自动、周期性执行 | 已复核（依赖库源码） |
| S6 | **启动时按端口强杀其他程序**。DSH 自动启动默认开启（`dsh_host.rs:156`），没装 DSH 也会执行：127.0.0.1:3080 只要返回 401，就隐藏执行 `netstat` + `taskkill /T /F`（Unix 用 `lsof` + `kill -KILL`）结束监听进程，可能误杀用户自己的服务、Docker 后端或终端里开的 `dsh web` | A+B | 每次启动 | 已复核 |
| S7 | **远端设备可以操控本机**。Web dispatch 原样转发 `computer_use`（`web/dispatch.rs:741`），手机通过局域网或中继就能截屏、注入键鼠，而且桌面端的 Esc 急停对远端发起的回合无效。远端还能修改中继地址、开启无人值守、批准新设备，把一次访问变成长期后门 | A+B | 远端持有令牌或已批准设备 | 电脑操控部分已复核 |
| S8 | **Windows 上可能被命令注入**。`.cmd`/`.bat` 被包成 `cmd /c x.cmd` 再追加参数（`resolve.rs:601`），Rust 对批处理参数转义的修复因此不生效。渠道 `base_url`（Codex 的 `-c` 内联表）、带 `&` 的路径、插件 exec 参数、MCP 懒代理参数中的 `& \| % "` 都会被 cmd 解释 | A | npm 安装的 claude/codex 等在 Windows 上就是 `.cmd` | 已复核 |
| S9 | **没有工作区信任环节**。`claude -p` 跳过信任确认，仓库自带的 `.claude/settings.json`（hooks、`permissions.allow`）和 `.mcp.json` 在第一条消息就生效，手动和计划模式也一样。其他引擎是否加载工作区配置未逐个核实 | A+C | 添加不受信任的仓库后发消息 | hooks 在 `-p` 下执行的行为需实测 |
| S10 | **CLI 一键安装用隐藏 PowerShell 下载即执行**：`powershell -ExecutionPolicy Bypass -Command "irm … \| iex"`，加了 `CREATE_NO_WINDOW`（`cli_lifecycle.rs:303`）。Windows 上 npm 装的 shim 路径里没有 `node_modules`，可能被误判成官方安装包，于是也走这条路径 | B | 用户点安装/更新（确认框显示命令） | 误判部分需在 Windows 实测 |
| S11 | **发布链路**：签名密钥和第三方构建代码在同一步骤里（`tauri build` 会运行约 1700 个 npm 包和 763 个 crate 的构建代码）；`GITHUB_TOKEN` 有 `contents: write`，且 checkout 时持久化；main 分支无保护（已核实）；`release` environment 没有保护规则；第三方 Action 没有固定到 SHA；Windows 未配置证书时仍然发布 | 供应链 | 任一上游依赖被投毒 | 权限与分支保护已复核 |

## P1：中危

| 编号 | 问题 | 类别 |
|---|---|---|
| M1 | `settings::atomic_write` 用 umask 新建临时文件再 rename：其他 CLI 的 `auth.json`、`~/.claude.json` 会从 0600 降成 0644；本应用的 `config.json`（API Key）、`settings.json`（令牌）也是 0644，`~/.ccgui-next` 是 0755；dotfile 符号链接会被替换成普通文件 | A |
| M2 | 在官方配置编辑器里只改 config.toml，保存时也会把打开时读到的 `auth.json` 写回去，可能覆盖 Codex 期间轮换过的 refresh token | A+C |
| M3 | 渠道 env 黑名单漏了 `GIT_EXTERNAL_DIFF`、`GIT_ASKPASS`、`GIT_PROXY_COMMAND`、`GIT_EDITOR`、`NODE_TLS_REJECT_UNAUTHORIZED` 等，导入来路不明的渠道配置（包括从 cc-switch 导入）就可能执行命令或关闭 TLS 校验。建议改成白名单 | A |
| M4 | Pi/OMP 认证区在挂载和每次窗口获得焦点时读取 `~/.pi/agent/auth.json` 和 omp `agent.db` 的凭据表，引擎停用时也读。和 CodeBuddy 是同一个反模式 | B+C |
| M5 | 每次启动都往最多 14 个 CLI 的 skills 目录写入 `ccgui-plugin-creator`（`lib.rs:242`），没有开关，卸载 CC GUI 后会残留 | B+C |
| M6 | macOS 上「移到废纸篓」走 trash 库的默认方式，即 `osascript` 控制 Finder（已复核）。应改用 `DeleteMethod::NsFileManager` | B |
| M7 | 插件 `exec:` 不拦截高危工具（powershell、cmd、cmdkey、reg、certutil 等），env 和 PATH 由插件控制，`detached` 进程隐藏窗口且比应用活得久；`agent` 权限可以指定任意目录和自动批准的引擎；处于隔离状态的插件仍能调用能力命令 | B+C |
| M8 | 对话 Markdown 会自动加载任意 https 图片（CSP 放行 `img-src https:`），提示注入可以零点击外传数据；声明式插件的 CSS 远程引用检查也能绕过 | A |
| M9 | 内置浏览器导航不限协议、从不拦截（已复核），且没有 AppManifest 限制命令范围（已复核）。外部网页可能跳转到本地自定义协议页面，从而拿到 IPC | A（需实测） |
| M10 | 授权目录在批准时和每次使用时都重新解析符号链接，agent 可以在用户点「允许」前把目录换成指向家目录的链接 | A |
| M11 | 请求的权限模式不受支持时会自动放宽：手动模式在 kimi 上变成 yolo，在 grok/qoder 上变成全部跳过；opencode 的计划模式会自动同意 | C |
| M12 | `opencode serve` 没有设置口令，并且会接管 4096 端口上任何报告「健康」的服务 | A |
| M13 | 主程序带 `--mcp-lazy -- <命令>` 参数时可以代为执行任意命令；`ccgui-computer-use.exe` 没有令牌门禁。签名以后，这两者都可能被他人当作签名过的跳板程序 | B |
| M14 | 中继密钥放在 URL 查询串里，Worker 允许新连接顶替桌面端；`wrangler.toml` 的默认 key 是 `change-me` | A |
| M15 | CI：cargo 没有 `--locked`；`trusted-signing-cli` 没有锁版本；签名校验不检查签名者、时间戳和 DLL；没有构建来源证明、校验和文件，也没有给用户的验证指南 | 供应链 |
| M16 | 插件 `assets:directory` 的敏感目录拒绝名单过窄（没有 `.claude`、`.codex`、AppData），且接受 UNC 路径；pluginasset 响应带 `ACAO: *` | A |

## P2：低危（逐项修，不阻塞发版）

- **文件与路径**
  - 文本搜索会跟随文件符号链接读到工作区外。
  - Web 端 `add_workspace` 可以加 `/`。
  - 便携模式判断「是否在家目录内」只比较字符串。
  - 启动清扫没有单实例锁。
  - `creator_skill` 清理旧文件时只做前缀判断。
  - `.omp/mcp.json` 注入不拒绝符号链接，恢复时按服务名删条目。
- **进程**
  - `git fetch` 缺 `--end-of-options`。
  - macOS 打开自定义 `.app` 时没加 `-a`，文件会交给默认程序打开。
  - IntelliJ 启动器通过 `mdfind` 查找，可能执行伪造的 `.app`。
  - 登录 shell 采集 PATH 超时后只杀 shell 本身。
  - `.ps1` shim 用 `-ExecutionPolicy Bypass`；npm prefix 探测隐藏执行。
  - `gh` 会闪控制台窗口；会静默写入 `push.autoSetupRemote`。
  - `open_workspace_in` 接受任意 `args`。
- **数据**
  - 远程会话缓存是 0644，删除会话时不清理。
  - 自定义的 `x-api-key` 请求头会跟随跨域重定向。
  - 令牌比较不是常量时间，`/unlock` 没有限速。
  - 打开设置页就会打开 cc-switch 的数据库。
  - 右键文件树就会读取剪贴板。
- **网络**
  - `spawn_socket` 没有校验 path 前缀。
  - 局域网连接不计入「远程控制中」提示；令牌持久不轮换，还会打印到 stdout；网桥绑定 `0.0.0.0`。
  - 插件 `network:` 授权只比较主机名，可被 DNS 重绑定。
  - 中继隧道不走应用代理。
  - Web 端 `/file` 返回 HTML/SVG 时不带 CSP，静态页面也没有 CSP。
  - 电脑操控的回环监听常驻，令牌出现在命令行参数和 `.omp/mcp.json` 里。
  - WSL 首次 SSH 连接不校验主机指纹。
- **其他**
  - 插件 README 允许 `class`，可以伪造界面。
  - run id 属主用前缀匹配。
  - 本地插件和市场插件重名时会收到「更新」。
  - 自动模式预先批准 WebFetch/WebSearch；授权目录在所有工作区之间共享。
  - `vite.config.ts` 残留「TEMP DEBUG」的 `/__dbg` 信标。
  - NSIS 以 currentUser 模式安装。
  - CI：`minimumReleaseAgeExclude` 范围过宽，口令和私钥落盘，工具链没有固定，手动构建的产物没有签名。

## 处理建议

1. **第一批**：改动小、收益大，能直接降低被告警或被攻击的概率。
   - S1：HTML 默认用代码视图打开；预览只服务当前目录，加 CSP，去掉 `allow-same-origin`。
   - S3：项目级 MCP 不自动检测，手动检测前先展示完整命令，项目级条目不展开 `${ENV}`。
   - S4：去掉远程脚本，改由后端发 beacon，并加开关；Web 端读到令牌后从 URL 里清掉。
   - S5：只采样本应用的后代进程，Windows 用 Toolhelp 快照，不开句柄。
   - S6：自动启动以 DSH 已安装且已启用为前提，只结束自己启动的进程。
   - S7：电脑操控和中继相关设置只允许在桌面端操作。
   - S10：在可见终端里执行安装，去掉 Bypass 和隐藏窗口，修正 npm 识别。
   - M1、M4、M5、M6。
   - Windows 未签名时发版默认失败，需要显式勾选才放行。
2. **第二批**：架构性问题。
   - S2：插件隔离。把插件移到独立 origin 的 iframe 或 webview，经 postMessage 代理调用；安装和更新时做权限确认和差异比对。
   - S9：工作区信任。
   - S8：直接启动 `.cmd`，或解析出 `node <入口>` 再启动。
   - M3：env 改成白名单。
   - S11：CI 加固。权限最小化、Action 固定到 SHA、拆分签名步骤；以下需要你在 GitHub 设置里操作：给 main 加保护、给 environment 加保护规则、开启 immutable releases。
3. **第三批**：其余中低危项。

每修一项，在本文对应条目后标注 PR 或提交号；同类规则补进 `AGENTS.md`「安全敏感行为」，自查命令补进复盘文档第 8 节。新增的 grep 关键字建议包括 `sysinfo|ProcessesToUpdate::All`、`useAutoProbe`、`irm .*\| *iex`、`netstat|lsof`、`allow-same-origin`、`script-src https:`。
