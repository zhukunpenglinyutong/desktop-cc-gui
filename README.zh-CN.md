<div align="center">

# CC GUI 客户端

<img width="120" alt="ccgui 图标" src="./public/app-icon.png" />

[English](./README.md) · **简体中文**

<a href="https://trendshift.io/repositories/25546" target="_blank"><img src="https://trendshift.io/api/badge/repositories/25546" alt="zhukunpenglinyutong%2Fdesktop-cc-gui | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
<a href="https://atomgit.com/zhukunpenglinyutong/desktop-cc-gui" target="_blank"><img src="https://atomgit.com/zhukunpenglinyutong/desktop-cc-gui/star/new_badge.svg" alt="AtomGit G-Star" width="250" height="54"/></a>

![][github-contributors-shield] ![][github-forks-shield] ![][github-stars-shield] ![][github-issues-shield] ![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-c4f042?labelColor=black&style=flat-square)

</div>

**ccgui** 是一个开源的 **multi-engine AI 编程桌面客户端**。简单说：它把 **Claude Code**、**Codex CLI**、**Kimi CLI**、**Grok CLI**、**Pi CLI**、**OMP CLI**、**DeepSeek Harness（DSH）**、**Antigravity**、**OpenCode**、**Qoder**、**MiniMax Code** 等命令行 AI 编程 runtime，放进一个统一的图形界面里。

你不用再盯着黑乎乎的终端敲命令——打开 ccgui，选好项目，像聊天一样让 AI 帮你写代码、改 Bug、提交 Git。流式输出、思考过程和工具调用都会实时展示；token 用量在引擎上报时同步呈现。

应用基于 **Tauri 2 + React 18 + TypeScript + Rust** 开发，支持 macOS / Windows / Linux。设置与状态默认在本机持久化；发送给 AI provider 的内容，遵循你为对应 CLI 配置的渠道边界。

---

## 支持的引擎

下面每个引擎都通过 Rust 后端里的**专属协议适配器**接入——流式事件、会话历史、供应商渠道都是原生处理的，而不是从终端屏幕上抓输出。

<p>
  <a href="https://code.claude.com/docs/en/cli-reference"><kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="Claude Code logo" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Codex CLI logo" width="16" valign="middle" /> Codex CLI</kbd></a> &nbsp;
  <a href="https://www.kimi.com/code/docs/en/"><kbd><img src="https://www.google.com/s2/favicons?domain=moonshot.cn&sz=64" alt="Kimi CLI logo" width="16" valign="middle" /> Kimi CLI</kbd></a> &nbsp;
  <a href="https://x.ai/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=x.ai&sz=64" alt="Grok CLI logo" width="16" valign="middle" /> Grok CLI</kbd></a> &nbsp;
  <a href="https://pi.dev"><kbd><img src="https://pi.dev/favicon.svg" alt="Pi CLI logo" width="16" valign="middle" /> Pi CLI</kbd></a> &nbsp;
  <a href="https://omp.sh"><kbd><img src="https://omp.sh/favicon.svg" alt="oh-my-pi logo" width="16" valign="middle" /> OMP CLI</kbd></a> &nbsp;
  <a href="https://github.com/deepseek-ai/dsh"><kbd><img src="https://www.google.com/s2/favicons?domain=deepseek.com&sz=64" alt="DeepSeek Harness logo" width="16" valign="middle" /> DeepSeek Harness</kbd></a> &nbsp;
  <a href="https://www.antigravity.google/docs/cli/headless/"><kbd><img src="https://www.google.com/s2/favicons?domain=antigravity.google&sz=64" alt="Antigravity logo" width="16" valign="middle" /> Antigravity</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="OpenCode logo" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="https://docs.qoder.com/zh/cli/using-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=qoder.com&sz=64" alt="Qoder logo" width="16" valign="middle" /> Qoder</kbd></a> &nbsp;
  <a href="https://agent.minimax.cn/docs/cli/quick-start"><kbd><img src="https://www.google.com/s2/favicons?domain=agent.minimax.cn&sz=64" alt="MiniMax Code logo" width="16" valign="middle" /> MiniMax Code</kbd></a>
</p>

### 功能兼容矩阵

图例:✅ 支持 · ⚠️ 部分支持 · ❌ 暂不支持 · 🔁 CLI 不支持但 ccgui 有等价 GUI · ➖ 不适用

| 功能 | <kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" width="16" valign="middle" /> Claude Code</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" width="16" valign="middle" /> Codex CLI</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=moonshot.cn&sz=64" width="16" valign="middle" /> Kimi CLI</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=x.ai&sz=64" width="16" valign="middle" /> Grok CLI</kbd> | <kbd><img src="https://pi.dev/favicon.svg" width="16" valign="middle" /> Pi CLI</kbd> | <kbd><img src="https://omp.sh/favicon.svg" width="16" valign="middle" /> OMP CLI</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=deepseek.com&sz=64" width="16" valign="middle" /> DSH</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=antigravity.google&sz=64" width="16" valign="middle" /> Antigravity</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" width="16" valign="middle" /> OpenCode</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=qoder.com&sz=64" width="16" valign="middle" /> Qoder(全球/国内)</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=agent.minimax.cn&sz=64" width="16" valign="middle" /> MiniMax Code</kbd> |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 流式输出(逐 token) | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 会话历史与恢复 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 中断(Stop) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 消息排队 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 图片附件 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| 权限模式 | 自动·手动·计划·绕过 | 自动·手动·绕过 | 自动·计划·绕过 | 仅绕过 | 仅自动 | 自动·计划·绕过 | 仅自动 | 自动·计划·绕过 | 自动·计划 | 仅绕过 | 自动·手动·计划·绕过 |
| 模型选择 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 推理强度(Effort) | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ⚠️ | ❌ | ✅ | ⚠️ |
| Token 用量与上下文窗口 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ |
| Todo 列表渲染 | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 子代理展示(任务分发面板) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| 团队模式(多代理编排) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/` 斜杠命令与技能(选择器) | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ❌ |
| `@` 文件引用 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 渠道/供应商切换 | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| CC Switch 渠道导入 | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Fast 模式(service tier) | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 会话重命名 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 原生命令 `/new`(新会话) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 原生命令 `/clear`(清空上下文) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 原生命令 `/compact`(压缩上下文) | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 原生命令 `ask`(提问卡片) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| 原生命令 `/mcp` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 原生命令 `/plugins` | ➖ | ➖ | ➖ | ➖ | ❌ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 原生命令 `/goal`(持久目标) | ➖ | ➖ | ➖ | ➖ | ➖ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |

MiniMax Code（命令 `mcode`）走它的原生 ACP 传输（`mcode acp`）：逐 token 流式、权限提问卡片（ACP `session/request_permission`）、会话恢复均为原生接入，并已对 mcode 0.5.1 实测。模型列表来自对会话握手的实时探针，你在 mcode 里自己添加的渠道（如 GLM）会自动出现。mcode 的 ACP 不接受内联图片块，图片以绝对路径注入、由 agent 用自己的文件工具读取。推理强度折叠进 mcode 的模型变体，没有独立旋钮。WSL 工作区回退到 headless `mcode exec --output-format stream-json` 子进程（仅支持自动/绕过，无提问卡与计划模式）。渠道管理与应用的 MCP/Skills 同步暂未覆盖该引擎；认证用 `mcode login`。

---
## ccgui 能干什么

### 一个客户端，装下十一个 AI 引擎

- 注册了 **Claude Code**、**Codex CLI**、**Kimi CLI**、**Grok CLI**、**Pi CLI**、**OMP CLI**、**DeepSeek Harness**、**Antigravity**、**OpenCode**、**Qoder**（全球版与国内版）、**MiniMax Code** 的 runtime adapter——在输入框里按会话切换引擎。
- **供应商渠道**直接写入各 CLI 自己的原生配置文件（不搞平行的凭证存储），内置 GLM、Kimi、DeepSeek、MiniMax、MiMo、百炼、LongCat、OpenCode Go、OpenRouter 等精选预设；Claude / Codex / Grok 的渠道还能从 [CC Switch](https://github.com/farion1231/cc-switch) 一键导入。
- Pi 系引擎（Pi / OMP）支持在设置页内完成 API Key 与 OAuth 登录。
- 支持**按标签页覆盖模型与 effort 档位**：同一个窗口里，不同标签页可以跑不同模型或思考强度。
- 会话历史不丢：历史扫描器直接读取各 CLI 的原生会话文件并保持标题同步，关掉应用再打开还能接着聊。

### 聊天框是为写代码设计的

- 流式回复按动画帧逐步展示，配合语法高亮缓存——长输出也保持流畅，不会每来一个 token 就重排一遍 markdown。
- **思考流**与正文合并展示，结束后自动折叠，需要时一键展开看全文。
- 工具调用以实时行呈现，参数与结果可展开查看，内置美化的 **Git Diff**、**Bash** 查看器和每次运行的完成元数据。
- **运行状态条**实时镜像引擎进度（含 todo 快照），消息**锚点导航栏**让你在用户消息之间快速跳转。
- 粘贴图片自动转附件；`@` 文件引用基于感知 `.gitignore` 的项目文件索引；回复中的文件链接能处理 URL 编码路径，并支持右键菜单。
- 权限被拒时可以在对话内直接为引擎追加授权目录；输入框还内置提示词历史与可选的 **Codex Fast** 开关。

### 不只是聊天，是一整套开发面板

- **文件树**：虚拟化渲染，带 Git 状态颜色、嵌套仓库徽标、右键菜单与拖拽——内置 CodeMirror 编辑器面板，支持 Markdown 预览。
- **内置终端**：真正的 PTY 终端坞（xterm + WebGL），不用切窗口。
- **Git 面板**：暂存、提交、分支搜索、看 diff、翻提交历史。
- **命令面板**：一个键盘驱动的入口，调起应用内所有命令。

### 插件系统

- 自研 **插件 SDK**（`@ccgui/plugin-sdk`），配套应用内运行时、管理界面与信任边界。
- **声明式插件**无需编写前端代码即可新增设置区块与配置驱动的界面；应用内建界面（包括设置页本身）也走同一套扩展点注册。
- 完整开发指南见 [docs/plugin-development-guide.zh-CN.md](./docs/plugin-development-guide.zh-CN.md)。

### 设置、网络与更新

- **代理设置**：为应用与引擎流量配置代理。
- **局域网网页访问**：通过 token 鉴权的 WebSocket 桥接，把界面共享给局域网内其他设备，设置页提供二维码入口。
- **工作区管理**：给项目分组，快速切换。
- 应用内**自动更新**（Tauri updater，对接 GitHub Releases）、版本记录对话框、macOS 签名构建。
- 中英双语界面。

---

## 下载安装

直接去 [Releases 页面](https://github.com/zhukunpenglinyutong/desktop-cc-gui/releases) 下载对应平台的安装包：

| 平台 | 安装包 |
| --- | --- |
| macOS（M 系列芯片，已签名） | `aarch64.dmg` |
| Windows | `.exe`（NSIS）安装包 |
| Linux | `.AppImage`、`.rpm` |

`.rpm` 采用 zstd 压缩，要求系统 rpm ≥ 4.14（Fedora 28+ / RHEL 8+）；更早的 rpm 系发行版请使用 AppImage。

装好之后，打开设置，为要用的 CLI 配置供应商渠道（或直接登录），添加一个项目文件夹，就可以开始聊了。

### 使用 DeepSeek Harness（DSH）

1. 在本机安装 DSH CLI，并在 DSH 自身中配置模型与 API key——不要把它当成 ccgui 里的另一套 vendor preset。
2. 在设置 → DeepSeek Harness 中，ccgui 可以接管本机已运行的 `dsh web` host，也可以自动拉起一个。
3. 在输入框引擎选择器中选中 **DeepSeek Harness**。对话走 DSH 的 headless profile；模型与凭证仍归 DSH 管理。
4. 支持图片附件（粘贴、选择或拖入）。对于在 DSH 中添加的自定义供应商（`llm-pi-ai` 路由），ccgui 会在发送前自动为该路由声明图片输入能力——无需手动修改 DSH 设置；官方适配器会自行上报能力。

---

## 把项目跑起来（启动教程）

想自己编译、或者参与开发？跟着下面三步走。

### 第一步：准备环境

| 工具 | 版本要求 | 用来干嘛 |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | 20 或更新 | 跑前端工具链 |
| [pnpm](https://pnpm.io/) | 10（`packageManager` 字段已锁定） | 安装依赖 |
| [Rust](https://rustup.rs/) | stable（用 rustup 装） | 编译后端 |

不同系统还需要一点额外准备（这是 Tauri 框架的要求，详见 [Tauri 官方环境文档](https://v2.tauri.app/start/prerequisites/)）：

- **macOS**：装 Xcode 命令行工具：`xcode-select --install`。
- **Windows**：装 Microsoft C++ Build Tools 和 WebView2（Win 11 自带 WebView2）。
- **Linux**：装 `webkit2gtk` 等系统库，照着 Tauri 官方文档抄命令就行。

### 第二步：装依赖

```bash
git clone https://github.com/zhukunpenglinyutong/desktop-cc-gui.git
cd desktop-cc-gui
pnpm install
```

注意：这是一个 **pnpm workspace**（插件 SDK 在 `packages/plugin-sdk`），锁定文件是 `pnpm-lock.yaml`。

### 第三步：启动

```bash
pnpm dev
```

几个小提示：

- **第一次启动要编译整个 Rust 后端，可能等上几分钟**，去倒杯水。之后是增量编译，很快。
- 前端开发服务器跑在 `1420` 端口。

### 打安装包

```bash
pnpm build:mac                 # macOS 签名构建（scripts/build-signed-macos.sh）
pnpm build:mac:skip-notarize   # 同上，但跳过公证
```

Windows 与 Linux 安装包由 `.github/workflows/` 下的 CI 工作流产出（`release.yml`、`build-windows-artifact.yml`）。

---

## 怎么改代码（开发教程）

### 技术栈一览

| 部分 | 用的什么 |
| --- | --- |
| 界面 | React 18 + TypeScript + Tailwind CSS 4 + zustand |
| 构建 | Vite 6 |
| 桌面框架 | Tauri 2（Rust 后端：git2、rusqlite、portable-pty、axum） |
| 测试 | Vitest（前端）+ cargo test（Rust） |

### 目录结构

```text
desktop-cc-gui/
├── src/                    # 前端代码
│   ├── features/           # ★ 功能模块：chat / files / git / terminal /
│   │                       #   settings / plugins / commands / update / open-app
│   ├── components/         # 跨功能共享的通用 UI 组件（含引擎品牌图标）
│   ├── i18n/               # zh + en 两套 locale bundle
│   ├── styles/             # 全局样式
│   └── lib/ utils/         # 工具函数
├── src-tauri/              # Rust 后端
│   └── src/                # engine/（每个 CLI 一个模块）、history/、plugins/、
│                           # git.rs、terminal.rs、web.rs（局域网桥接）……
├── packages/plugin-sdk/    # @ccgui/plugin-sdk —— 插件开发套件
├── tests/                  # 前端集成向测试（Vitest）
├── scripts/                # 构建与打包脚本
└── docs/                   # 插件开发指南、引擎模式说明
```

### 改一个功能的套路

1. **只改界面**：找到 `src/features/` 下对应的模块改就行。新组件直接放在该模块自己的目录里。
2. **需要后端配合**：在 `src-tauri/src/` 对应模块里加 `#[tauri::command]`，前端通过 Tauri API 调用。
3. **改了界面文字**：必须走 i18n，并同步两套 bundle（`src/i18n/zh.ts`、`src/i18n/en.ts`）；界面文字不允许硬编码。

### 常用命令

| 命令 | 干嘛的 |
| --- | --- |
| `pnpm dev` | 启动完整应用（Tauri 开发模式） |
| `pnpm build` | TypeScript 类型检查 + 前端生产构建 |
| `pnpm test` | 跑 Vitest 测试套件 |
| `pnpm preview` | 预览生产构建的前端 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 跑 Rust 测试 |

### 测试怎么写

- 前端测试用 [Vitest](https://vitest.dev/)——源码旁边放 `xxx.test.ts(x)` 同位测试，较重的套件统一放 `tests/` 目录。
- Rust 端测试照常写在模块里，用 `cargo test --manifest-path src-tauri/Cargo.toml` 跑。

---

## 开发规范

规矩不多，但都有原因，提交前过一遍：

1. **提 PR 前跑通本地验证**：`pnpm build`（类型检查）和 `pnpm test` 全绿；动了 Rust 再加 `cargo test`。
2. **界面文字必须走 i18n**：所有用户可见文案都从 `src/i18n/` 取，并保持两套 locale bundle 同步，不许硬编码。
3. **组件就近放**：新组件先放自己 feature 的目录里；确实被多个功能复用了，再挪到 `src/components/`。
4. **TypeScript 严格模式**：别用 `any` 糊弄，类型写明白。
5. **优先通过插件 SDK 扩展**：新增设置区块与界面，尽量走内建界面同款扩展点注册。
6. **永远不要提交密钥**：API Key、token 这类东西绝对不能进代码和提交记录。

### Commit 信息怎么写

默认使用中文主体的 [Conventional Commits](https://www.conventionalcommits.org/)：`type(scope): 中文动宾短句`。

| type | 什么时候用 |
| --- | --- |
| `feat` | 加新功能 |
| `fix` | 修 Bug |
| `refactor` | 重构（行为不变） |
| `docs` | 改文档 |
| `test` | 加/改测试 |
| `chore` | 杂活（版本号、依赖、脚本） |
| `perf` / `style` / `ci` | 性能优化 / 格式 / CI |

仓库里的真实例子：

```text
feat(chat): 支持工具调用参数与结果展开、Git Diff/Bash美化及完成元数据展示
fix(codex): Windows .cmd shim 下多行提示词只送达第一行
perf(chat): reveal streamed text per frame without reparsing markdown
```

不要在 commit 信息里写 emoji，也不要带 AI 生成署名。

---

## 怎么提交你的代码（贡献流程）

1. **Fork** 本仓库，clone 到本地。
2. 从 `main` 切一个分支，名字按 `feat/xxx`、`fix/xxx` 这种风格起。
3. 改代码，本地把 `pnpm build` + `pnpm test` 跑绿。
4. 提 PR 到本仓库的 **`main` 分支**。标题按 commit 格式写，描述里说清楚：改了什么、为什么改、怎么验证的。

不知道从哪下手？看看 [Issues](https://github.com/zhukunpenglinyutong/desktop-cc-gui/issues)，挑一个感兴趣的开干。发现 Bug 或有新点子，也欢迎直接开 Issue 聊。

### 想深入了解项目内部？

- [插件开发指南](docs/plugin-development-guide.zh-CN.md) — SDK、manifest、权限模型与信任边界。
- [界面与交互规范](docs/ui-ux-spec.zh-CN.md) — 设计 token、状态与动作反馈、刷新入口清单。
- [docs/omp-fast-mode.md](docs/omp-fast-mode.md) — Codex Fast / OMP 快速模式说明。

---

## License

[MIT](https://github.com/zhukunpenglinyutong/desktop-cc-gui?tab=MIT-1-ov-file)

---

## 友链

感谢 [LINUX DO](https://linux.do/) 用户的支持与反馈。

[AtomGit](https://atomgit.com/zhukunpenglinyutong/desktop-cc-gui)：在国内托管本项目，帮助中国大陆用户更快访问项目与下载 Release。

感谢 [AtomGit](https://atomgit.com/zhukunpenglinyutong/desktop-cc-gui) 平台 G-Star 认证

---

## 贡献者列表

感谢所有帮助 ccgui 变得更好的贡献者。

<a href="https://github.com/zhukunpenglinyutong/desktop-cc-gui/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=zhukunpenglinyutong/desktop-cc-gui" alt="Contributors" />
</a>

---

## 参考项目说明

本项目最初源自 [CodexMonitor](https://github.com/Dimillian/CodexMonitor)。自 v1.0.0 起代码库已从零完全重写，不再包含 CodexMonitor 的任何代码，但仍感谢其最初带来的启发。

---

## Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=zhukunpenglinyutong/desktop-cc-gui&type=date&legend=top-left)](https://star-history.dera.page/#zhukunpenglinyutong/desktop-cc-gui&type=date&legend=top-left)

<!-- LINK GROUP -->

[github-contributors-shield]: https://img.shields.io/github/contributors/zhukunpenglinyutong/desktop-cc-gui?color=c4f042&labelColor=black&style=flat-square
[github-forks-shield]: https://img.shields.io/github/forks/zhukunpenglinyutong/desktop-cc-gui?color=8ae8ff&labelColor=black&style=flat-square
[github-issues-link]: https://github.com/zhukunpenglinyutong/desktop-cc-gui/issues
[github-issues-shield]: https://img.shields.io/github/issues/zhukunpenglinyutong/desktop-cc-gui?color=ff80eb&labelColor=black&style=flat-square
[github-license-link]: https://github.com/zhukunpenglinyutong/desktop-cc-gui/blob/main/LICENSE
[github-stars-shield]: https://img.shields.io/github/stars/zhukunpenglinyutong/desktop-cc-gui?color=ffcb47&labelColor=black&style=flat-square
