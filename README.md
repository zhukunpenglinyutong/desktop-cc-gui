<div align="center">

# Desktop CC GUI

<img width="120" alt="ccgui icon" src="./public/app-icon.png" />

**English** · [简体中文](./README.zh-CN.md)

<a href="https://trendshift.io/repositories/25546" target="_blank"><img src="https://trendshift.io/api/badge/repositories/25546" alt="zhukunpenglinyutong%2Fdesktop-cc-gui | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
<a href="https://atomgit.com/zhukunpenglinyutong/desktop-cc-gui" target="_blank"><img src="https://atomgit.com/zhukunpenglinyutong/desktop-cc-gui/star/new_badge.svg" alt="AtomGit G-Star" width="250" height="54"/></a>

![][github-contributors-shield] ![][github-forks-shield] ![][github-stars-shield] ![][github-issues-shield] ![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-c4f042?labelColor=black&style=flat-square)

</div>

**ccgui** is an open-source **multi-engine AI coding desktop client**. In plain words: it brings command-line AI coding runtimes — **Claude Code**, **Codex CLI**, **Kimi CLI**, **Grok CLI**, **Pi CLI**, **OMP CLI**, **DeepSeek Harness (DSH)**, **Antigravity**, **OpenCode**, **Qoder**, and **MiniMax Code** — into one graphical interface.

No more staring at a black terminal. Open ccgui, pick a project, and chat with AI to write code, fix bugs, and commit to Git. Streaming output, thinking traces, and tool calls are visible as they happen; token usage appears when the engine reports it.

The app is built with **Tauri 2 + React 18 + TypeScript + Rust** and runs on macOS, Windows, and Linux. Settings and state are persisted locally. Content sent to an AI provider follows the boundary of the channel you configured for that CLI.

---

## Supported engines

Every engine below is wired in through a **dedicated protocol adapter** in the Rust backend — streaming events, session history, and provider channels are handled natively, not scraped off a terminal screen.

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
  <a href="https://docs.qoder.com/en/cli/using-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=qoder.com&sz=64" alt="Qoder logo" width="16" valign="middle" /> Qoder</kbd></a> &nbsp;
  <a href="https://agent.minimax.cn/docs/cli/quick-start"><kbd><img src="https://www.google.com/s2/favicons?domain=agent.minimax.cn&sz=64" alt="MiniMax Code logo" width="16" valign="middle" /> MiniMax Code</kbd></a>
</p>

### Feature compatibility matrix

Legend: ✅ Supported · ⚠️ Partial · ❌ Not yet supported · 🔁 Not supported by the CLI, but ccgui has a GUI equivalent · ➖ N/A

| Feature | <kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" width="16" valign="middle" /> Claude Code</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" width="16" valign="middle" /> Codex CLI</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=moonshot.cn&sz=64" width="16" valign="middle" /> Kimi CLI</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=x.ai&sz=64" width="16" valign="middle" /> Grok CLI</kbd> | <kbd><img src="https://pi.dev/favicon.svg" width="16" valign="middle" /> Pi CLI</kbd> | <kbd><img src="https://omp.sh/favicon.svg" width="16" valign="middle" /> OMP CLI</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=deepseek.com&sz=64" width="16" valign="middle" /> DSH</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=antigravity.google&sz=64" width="16" valign="middle" /> Antigravity</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" width="16" valign="middle" /> OpenCode</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=qoder.com&sz=64" width="16" valign="middle" /> Qoder (Global/CN)</kbd> | <kbd><img src="https://www.google.com/s2/favicons?domain=agent.minimax.cn&sz=64" width="16" valign="middle" /> MiniMax Code</kbd> |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Streaming output (per-token) | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session history & resume | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Interrupt (Stop) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Message queue | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Image attachments | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Permission modes | auto·manual·plan·bypass | auto·manual·bypass | auto·plan·bypass | bypass only | auto only | auto·plan·bypass | auto only | auto·plan·bypass | auto·plan | bypass only | auto·manual·plan·bypass |
| Model picker | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reasoning effort | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ⚠️ | ❌ | ✅ | ⚠️ |
| Token usage & context window | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ |
| Todo list rendering | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sub-agent display (dispatch panel) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Team mode (multi-agent orchestration) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/` slash commands & skills (picker) | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ❌ |
| `@` file mentions | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Provider/channel switching | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| CC Switch import | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Fast mode (service tier) | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Session rename | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Native command `/new` (new session) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Native command `/clear` (clear context) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Native command `/compact` (compact context) | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Native command `ask` (question cards) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| Native command `/mcp` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Native command `/plugins` | ➖ | ➖ | ➖ | ➖ | ❌ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Native command `/goal` (persistent goal) | ➖ | ➖ | ➖ | ➖ | ➖ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |

Kimi question cards use the local CLI's ACP form channel (verified with Kimi 2.0.2), including multiple questions, multiple selections, dismissal, and interruption. Kimi currently accepts declared options only, so these cards do not offer a free-text “Other” answer. WSL workspaces retain the non-interactive CLI fallback and do not support Kimi question cards or plan mode; prompt-mode launches never add incompatible interactive permission flags.

MiniMax Code (command `mcode`) runs through its native ACP transport (`mcode acp`): per-token streaming, permission question cards (ACP `session/request_permission`), and session resume are wired natively and verified against mcode 0.5.1. The model picker is probed live from the session handshake, so providers you add to mcode itself (e.g. a GLM channel) appear automatically. mcode's ACP does not accept inline image blocks, so pictures travel as absolute file paths the agent reads with its own tools. Reasoning effort folds into mcode's model variants rather than a separate knob. WSL workspaces fall back to the headless `mcode exec --output-format stream-json` child (auto/bypass only there — no question cards or plan mode). Provider channels and the app's MCP/Skills sync do not cover this engine yet; sign in with `mcode login`.

---
## What can ccgui do?

### One client, eleven AI engines

- Registers runtime adapters for **Claude Code**, **Codex CLI**, **Kimi CLI**, **Grok CLI**, **Pi CLI**, **OMP CLI**, **DeepSeek Harness**, **Antigravity**, **OpenCode**, **Qoder** (global and CN distributions), and **MiniMax Code** — pick the engine per session from the composer.
- **Provider channels** are written to each CLI's own native config files (no parallel credential store), with curated presets for GLM, Kimi, DeepSeek, MiniMax, MiMo, Bailian, LongCat, OpenCode Go, OpenRouter, and more. Claude / Codex / Grok channels can be imported from [CC Switch](https://github.com/farion1231/cc-switch).
- Pi-family engines (Pi / OMP) support API-key and OAuth sign-in flows from inside Settings.
- Per-tab **model and effort overrides**: different tabs in the same window can run different models or thinking levels.
- Session history survives restarts; the history scanner reads each CLI's native session files and keeps titles in sync.

### A chat box designed for coding

- Streaming replies are revealed per animation frame with cached syntax highlighting — long outputs stay smooth instead of re-parsing markdown on every token.
- **Thinking streams** merge with the reply text, auto-fold when they settle, and expand to full text on demand.
- Tool calls show as live rows with expandable parameters and results, including beautified **Git Diff** and **Bash** viewers and per-run completion metadata.
- A **Run Status Strip** mirrors the engine's live progress (including todo snapshots), and a message **anchor rail** lets you jump between user messages.
- Pasted images become attachments; file mentions are backed by a `.gitignore`-aware project file index; file links in replies handle URL-encoded paths and have a right-click menu.
- Permission denials can be resolved inline by granting the engine extra directories; prompt history and an optional **Codex Fast** toggle live in the composer.

### Not just chat — a full set of dev panels

- **File tree**: virtualized, with Git status colors, nested-repository badges, context menus, and drag-and-drop — plus a built-in CodeMirror editor pane with Markdown preview.
- **Built-in terminal**: a real PTY-backed terminal dock (xterm + WebGL), no need to switch windows.
- **Git panel**: stage, commit, search branches, inspect diffs and history.
- **Command palette**: one keyboard-driven box for the app's commands.

### Plugin system

- First-party **plugin SDK** (`@ccgui/plugin-sdk`) plus an in-app runtime, manager UI, and trust boundary.
- **Declarative plugins** can add settings sections and config-driven UI without shipping frontend code; builtin app surfaces (including the settings page itself) are registered through the same extension points.
- See [docs/plugin-development-guide.zh-CN.md](./docs/plugin-development-guide.zh-CN.md) for the full authoring guide.

### Settings, network, and updates

- **Proxy settings** for the app and engine traffic.
- **LAN web access**: serve the UI to other devices on your network over a token-authenticated WebSocket bridge, with a QR-code entry in Settings.
- **Workspace management**: group projects and switch between them.
- In-app **auto-update** (Tauri updater against GitHub Releases), a changelog dialog, and signed macOS builds.
- Bilingual UI: **Chinese and English**.

---

## Download

Grab the installer for your platform from the [Releases page](https://github.com/zhukunpenglinyutong/desktop-cc-gui/releases):

| Platform | Installer |
| --- | --- |
| macOS (Apple Silicon, signed) | `aarch64.dmg` |
| Windows | `.exe` (NSIS) |
| Linux | `.AppImage`, `.rpm` |

The `.rpm` is zstd-compressed and requires rpm ≥ 4.14 (Fedora 28+, RHEL 8+); on older rpm-based systems use the AppImage instead.

After installing, open Settings, configure a provider channel for the CLI you want (or sign in), add a project folder, and start chatting.

### Using DeepSeek Harness (DSH)

1. Install the DSH CLI on your machine and configure its models and API keys in DSH itself — not as a separate vendor preset inside ccgui.
2. In Settings → DeepSeek Harness, ccgui can adopt a running local `dsh web` host or auto-start one.
3. Select **DeepSeek Harness** in the composer engine picker. Chat runs through DSH's headless profile; models and credentials stay in DSH.
4. Image attachments (paste, pick, or drop) are supported. For custom providers added in DSH (`llm-pi-ai` routes), ccgui declares image input on the route before sending — no manual DSH settings edit needed; official adapters report their own capabilities.

---

## Getting it running (setup guide)

Want to build it yourself or contribute? Three steps.

### Step 1: Prepare your environment

| Tool | Version | What for |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | 20 or newer | Runs the frontend toolchain |
| [pnpm](https://pnpm.io/) | 10 (pinned via `packageManager`) | Installs dependencies |
| [Rust](https://rustup.rs/) | stable (install via rustup) | Compiles the backend |

Each OS also needs the standard Tauri prerequisites — see the [official Tauri guide](https://v2.tauri.app/start/prerequisites/):

- **macOS**: `xcode-select --install`.
- **Windows**: Microsoft C++ Build Tools and WebView2 (Windows 11 ships with WebView2).
- **Linux**: `webkit2gtk` and friends — copy the commands from the Tauri docs.

### Step 2: Install dependencies

```bash
git clone https://github.com/zhukunpenglinyutong/desktop-cc-gui.git
cd desktop-cc-gui
pnpm install
```

Note: this is a **pnpm workspace** (the plugin SDK lives in `packages/plugin-sdk`); the lockfile is `pnpm-lock.yaml`.

### Step 3: Start it

```bash
pnpm dev
```

A few tips:

- **The first launch compiles the entire Rust backend and can take a few minutes** — go grab a coffee. Later launches use incremental builds and are fast.
- The frontend dev server runs on port `1420`.

### Building installers

```bash
pnpm build:mac                 # macOS signed build (scripts/build-signed-macos.sh)
pnpm build:mac:skip-notarize   # same, skipping notarization
```

Windows and Linux installers are produced by the CI workflows under `.github/workflows/` (`release.yml`, `build-windows-artifact.yml`).

---

## How to work on the code (development guide)

### Tech stack at a glance

| Part | Technology |
| --- | --- |
| UI | React 18 + TypeScript + Tailwind CSS 4 + zustand |
| Build | Vite 6 |
| Desktop shell | Tauri 2 (Rust backend: git2, rusqlite, portable-pty, axum) |
| Tests | Vitest (frontend) + cargo test (Rust) |

### Directory layout

```text
desktop-cc-gui/
├── src/                    # Frontend code
│   ├── features/           # ★ Feature modules: chat / files / git / terminal /
│   │                       #   settings / plugins / commands / update / open-app
│   ├── components/         # Shared UI components (incl. engine brand icons)
│   ├── i18n/               # zh + en locale bundles
│   ├── styles/             # Global styles
│   └── lib/ utils/         # Utility functions
├── src-tauri/              # Rust backend
│   └── src/                # engine/ (one module per CLI), history/, plugins/,
│                           # git.rs, terminal.rs, web.rs (LAN bridge), ...
├── packages/plugin-sdk/    # @ccgui/plugin-sdk — plugin authoring kit
├── tests/                  # Frontend integration-style tests (Vitest)
├── scripts/                # Build and packaging scripts
└── docs/                   # Plugin development guide, engine mode notes
```

### The typical workflow for changing a feature

1. **UI-only change**: find the matching module under `src/features/` and edit there. New components live inside that feature's own folder.
2. **Needs backend support**: add a `#[tauri::command]` in the matching `src-tauri/src/` module and call it from the frontend via the Tauri API.
3. **Changed any UI text**: route it through i18n and keep both bundles (`src/i18n/zh.ts`, `src/i18n/en.ts`) synchronized — hardcoded UI text is not allowed.

### Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the full app (Tauri dev mode) |
| `pnpm build` | TypeScript check + frontend production build |
| `pnpm test` | Run the Vitest suite |
| `pnpm preview` | Preview the production frontend build |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Run Rust tests |

### Writing tests

- Frontend tests use [Vitest](https://vitest.dev/) — colocated `xxx.test.ts(x)` files next to the source, plus heavier suites under `tests/`.
- Rust tests live in their modules as usual and run with `cargo test --manifest-path src-tauri/Cargo.toml`.

---

## Coding rules

Not many rules, but each exists for a reason:

1. **Run the big three before opening a PR**: `pnpm build` (typecheck) and `pnpm test` green locally, plus `cargo test` if you touched Rust.
2. **UI text must go through i18n**: every user-visible string comes from `src/i18n/`, and both shipped locale bundles must stay synchronized.
3. **Keep components close to home**: new components start inside their own feature folder; promote to `src/components/` only once they're genuinely reused across features.
4. **TypeScript strict**: don't paper over things with `any`; write real types.
5. **Extend through the plugin SDK where possible**: new settings sections and surfaces should register through the same extension points the builtin ones use.
6. **Never commit secrets**: API keys and tokens must never appear in code or commit history.

### Writing commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) with a Chinese action phrase by default: `type(scope): 中文动宾短句`.

| type | When to use |
| --- | --- |
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Refactoring (no behavior change) |
| `docs` | Documentation |
| `test` | Adding/updating tests |
| `chore` | Housekeeping (version bumps, deps, scripts) |
| `perf` / `style` / `ci` | Performance / formatting / CI |

Real examples from this repo:

```text
feat(chat): 支持工具调用参数与结果展开、Git Diff/Bash美化及完成元数据展示
fix(codex): Windows .cmd shim 下多行提示词只送达第一行
perf(chat): reveal streamed text per frame without reparsing markdown
```

No emoji in commit messages, and no AI-generated signatures.

---

## Submitting your code (contribution flow)

1. **Fork** the repo and clone it locally.
2. Branch off `main`, named like `feat/xxx` or `fix/xxx`.
3. Make your changes and get `pnpm build` + `pnpm test` green locally.
4. Open a PR against this repo's **`main` branch**. Title in commit format; in the description, explain what changed, why, and how you verified it.

Not sure where to start? Browse the [Issues](https://github.com/zhukunpenglinyutong/desktop-cc-gui/issues) and pick one that interests you. Found a bug or have an idea? Open an issue and let's talk.

### Want to dig deeper?

- [Plugin development guide (中文)](docs/plugin-development-guide.zh-CN.md) — SDK, manifest, permissions, and the trust boundary.
- [UI/UX spec (中文)](docs/ui-ux-spec.zh-CN.md) — design tokens, states, action feedback, and the refresh-button inventory.
- [docs/omp-fast-mode.md](docs/omp-fast-mode.md) — notes on the Codex Fast / OMP fast mode.

---

## License

[MIT](https://github.com/zhukunpenglinyutong/desktop-cc-gui?tab=MIT-1-ov-file)

---

## Friendship Link

Thanks for the support and feedback from the friends at [LINUX DO](https://linux.do/).

[AtomGit](https://atomgit.com/zhukunpenglinyutong/desktop-cc-gui): hosts this project in China, helping users in mainland China access the project and download Releases faster.

Thank you for [AtomGit](https://atomgit.com/zhukunpenglinyutong/desktop-cc-gui) platform G-Star certification

---

## Contributors

Thanks to all the contributors who help make ccgui better.

<a href="https://github.com/zhukunpenglinyutong/desktop-cc-gui/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=zhukunpenglinyutong/desktop-cc-gui" alt="Contributors" />
</a>

---

## Acknowledgements

This project originally started from [CodexMonitor](https://github.com/Dimillian/CodexMonitor). Since v1.0.0 the codebase has been rewritten from scratch — no CodexMonitor code remains, but the original inspiration is gratefully acknowledged.

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
