## Why

当前 Linux/Nix packaging 链路存在 clean-room build 风险：项目可能在开发者本地因为残留 `node_modules` 或宿主机系统库而可运行，但在 Nix 隔离构建环境中暴露 frontend artifact 路径、Tauri Rust package source、Linux native build inputs、npm direct dependency declaration 与 binary entrypoint 的隐式依赖问题。

上游 `desktop-cc-gui` PR #428 证明同类 Tauri 项目的 `flake.nix` 需要显式修正才能通过 `nix build .#`、`nix flake check --no-build` 与 `nix run .#`。mossx 当前也存在同类信号：`src/**` 已直接 import `antd` 与 `remark-breaks`，但 `package.json` 未声明它们；本 change 要把 Linux/Nix packaging 建成可复现契约，而不是继续依赖本地环境偶然可用。

## 目标与边界

### 目标

- 修复 Linux/Nix flake build，使 `nix build .#` 能在 clean-room 环境中构建 Tauri app。
- 修复 `nix run .#` 默认入口，使其解析到 `cc-gui` binary。
- 补齐源码直接使用但未声明的 npm dependencies。
- 明确 Linux native build inputs，避免依赖宿主机隐式系统库。
- 保留 frontend build 质量语义，Nix build 不得绕过 TypeScript check。
- 将 Linux/Nix packaging fix 与 macOS/Windows packaging 明确隔离，避免跨平台行为漂移。

### 边界

- 本 change 只覆盖 `flake.nix`、npm manifest/lockfile 与 Nix packaging validation。
- Linux native dependencies 必须通过 Linux-only 条件加入，例如 `pkgs.lib.optionals pkgs.stdenv.isLinux` 或等价机制。
- Nix-specific `TAURI_CONFIG` 只服务 Nix package build，不得改写仓库默认 Tauri config。
- `package.json` 的依赖补齐虽然影响跨平台 install，但只允许声明源码已直接 import 或构建确实需要的 dependency / peer dependency，不得引入 UI/runtime 行为变化。
- macOS 与 Windows 现有 packaging scripts、bundle config、release jobs 默认不在本 change 范围内。

## 非目标

- 不修复 Linux AppImage Wayland / EGL / GBM 启动崩溃；该问题属于 `linux-appimage-startup-compatibility` 方向，应由独立 change 处理。
- 不修改 macOS 打包脚本或 macOS bundle 配置。
- 不修改 Windows 打包脚本或 Windows bundle 配置。
- 不修改 `.github/workflows/release.yml` 的 macOS / Windows jobs。
- 不全量 cherry-pick PR #428。
- 不引入未被源码直接使用、且非构建/peer dependency 必需的包。
- 不关闭 TypeScript check。
- 不默认设置 `doCheck = false`；如 Nix 环境确实必须跳过 Rust tests，必须在 design 中说明原因与替代验证。
- 不把 `npm exec -- vite build` 作为 `npm run build` 的替代方案。
- 不改变 app runtime behavior。

## What Changes

- 调整 `flake.nix` 的 Tauri/Nix package build contract：
  - 使用 repo root 作为 Rust package source，并通过 `cargoRoot = "src-tauri"` 指定 Rust crate 根目录；
  - 修正 Nix build 下 Tauri `frontendDist` 的相对路径；
  - 增加 Linux/Tauri 构建所需 native build inputs，并保持 Linux-only scoping；
  - 使用 `importNpmLock` 从 committed `package-lock.json` 的 integrity 信息导入 npm dependency closure，避免每次 manifest/lockfile root metadata 变化都手工刷新 `npmDepsHash`；
  - 按 Nix build 证据决定是否需要 `npmFlags = [ "--legacy-peer-deps" ]`、`LIBCLANG_PATH` 等构建环境补充；
  - 设置 `meta.mainProgram = "cc-gui"`，保证 `nix run .#` 可解析默认 binary；
  - 移除手写 `npmDepsHash`，使 Nix npm dependency fetch 与 lockfile integrity 对齐。
- 调整 npm manifest：
  - 补齐 `antd` direct dependency；
  - 补齐 `remark-breaks` direct dependency；
  - 审查 `@lobehub/icons` peer dependencies，仅在构建确实要求时补充相关 direct dependency。
- 审查 `package-lock.json`：
  - lockfile diff 必须可解释为 direct dependency declaration、peer dependency 补齐或 Nix `importNpmLock` dependency closure 所需的 committed integrity 信息；
  - 允许 Nix/npm 可复现构建所需的 lockfile v3、`resolved`、`integrity` normalization；
  - 禁止接受无关 dependency version upgrade、无关 dependency promotion 或不可解释的 transitive churn。
- 增加验证约束：
  - Linux/Nix validation 必须覆盖 build、flake check 与 run entrypoint；
  - 常规 validation 必须覆盖 frontend typecheck/build 与 Rust tests。

## Platform Isolation Contract

- Linux native inputs MUST be Linux-scoped；不得把 Linux-only packages 加入 macOS/Windows build path。
- 以下 npm scripts MUST remain unchanged unless a later design explicitly proves they are affected and documents rollback:
  - `build:mac-arm64`
  - `build:mac-x64`
  - `build:mac-universal`
  - `build:win-x64`
  - `tauri:build:win`
- `src-tauri/tauri.conf.json` 中 macOS / Windows bundle 配置 MUST NOT be modified by this change。
- `.github/workflows/release.yml` 中 macOS / Windows packaging jobs MUST NOT be modified by this change。
- Any cross-platform file touched by this change, especially `package.json` and `package-lock.json`, MUST have a dependency-only rationale and MUST NOT encode Linux runtime assumptions.

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险 / 代价 | 结论 |
|---|---|---|---|---|
| A | 全量 cherry-pick PR #428 | 最快获得一组可参考的 Nix 修复 | 可能引入不必要 dependency churn；`vite build` 替代 `npm run build` 会绕过 `tsc`；`doCheck = false` 可能弱化 Rust validation；macOS/Windows 影响面不清晰 | 不采用 |
| B | 只补 `package.json` 缺失依赖，不动 `flake.nix` | 改动小，能解决一部分 clean install 问题 | Nix/Tauri packaging 的 source、frontendDist、native inputs、mainProgram 问题仍未解决 | 不采用 |
| C | 语义吸收 PR #428 的 Linux/Nix packaging 修复，保留质量门禁并最小化 lockfile diff | 能解决 clean-room build；边界清晰；不污染 macOS/Windows packaging；可通过 validation 证明 | 需要逐项验证 Nix build 错误和 lockfile diff | 采用 |

采用 C 的原因：本问题的本质是 packaging reproducibility contract，而不是“让某个命令临时跑通”。Linux/Nix 修复必须与质量门禁、依赖声明、平台隔离一起成立，否则会制造新的构建漂移。

## Capabilities

### New Capabilities

- `nix-flake-build-reproducibility`: Defines Linux/Nix flake build/run reproducibility, Tauri frontend/Rust package boundaries, direct dependency declaration, Linux-only native build inputs, and macOS/Windows isolation requirements.

### Modified Capabilities

- None.

## 验收标准

- `nix build .# --no-link --print-build-logs` MUST pass in a clean-room environment.
- `nix flake check --no-build` MUST pass.
- `nix run .#` or an equivalent Nix entrypoint resolution check MUST resolve to the installed `cc-gui` binary without making GUI startup a headless-CI requirement.
- `package.json` MUST declare packages directly imported by `src/**`.
- Nix frontend build MUST preserve `tsc && vite build` or equivalent TypeScript checking semantics.
- Linux native build inputs MUST be Linux-scoped.
- macOS and Windows packaging scripts MUST remain unchanged.
- macOS and Windows bundle config MUST remain unchanged.
- `package-lock.json` diff MUST be explainable by direct dependency declaration, peer dependency requirement, Nix dependency hash update, or Nix/npm reproducibility normalization.
- `package-lock.json` diff MUST NOT include unrelated dependency upgrades or unrelated direct dependency promotion.
- No app UI/runtime behavior MUST change.

## Validation

- `npm run typecheck`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `nix build .# --no-link --print-build-logs`
- `nix flake check --no-build`
- `nix run .#` or equivalent Nix metadata check proving the default entrypoint resolves to `cc-gui`
- `git diff --name-only` confirms no macOS / Windows packaging files were changed.
- `rg -n "from 'antd'|from \"antd\"|remark-breaks|@lobehub/icons" src package.json` confirms direct imports have matching manifest declarations.

## Impact

- Affected files:
  - `flake.nix`
  - `package.json`
  - `package-lock.json`
- New specs:
  - `openspec/changes/fix-linux-nix-flake-packaging/specs/nix-flake-build-reproducibility/spec.md`
- Explicitly not affected:
  - macOS runtime
  - Windows runtime
  - macOS packaging scripts
  - Windows packaging scripts
  - macOS / Windows release jobs
  - Linux AppImage runtime startup fallback

## Rollback

Rollback is limited to `flake.nix`, `package.json`, and `package-lock.json`. Because this change does not modify macOS/Windows packaging entrypoints or bundle config, rollback does not require cross-platform migration or runtime data cleanup.
