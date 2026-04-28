## Context

当前 `flake.nix` 已经提供 `packages.default = appPackage`，但 build boundary 仍偏向“本地能跑”的假设：

- frontend derivation 使用 `npmBuildScript = "build"`，这一点应保留，因为 `package.json` 的 `build` 等价于 `tsc && vite build`。
- Rust package 当前使用 `src = ./src-tauri`，但 Tauri packaging 需要访问仓库级 frontend artifact 与配置上下文；这会让 Nix build 中的相对路径更脆弱。
- `TAURI_CONFIG.build.frontendDist` 当前是 `dist`，在 Rust crate context 与 repo-root context 切换时容易指向错误位置。
- Linux build inputs 已包含 `gtk3`、`libxkbcommon`、`librsvg`、`libsoup_3`、`webkitgtk_4_1`，但同类 Tauri/Nix 修复显示仍可能需要显式补齐 `alsa-lib`、`glib-networking`、`libayatana-appindicator`、`bindgenHook` 等依赖。
- 源码直接 import `antd` 与 `remark-breaks`，但 root `package.json` 尚未声明；`package-lock.json` 中已有对应 transitive entries，不能替代 root manifest 的 direct dependency contract。
- 上游 PR #428 最初使用了 `npmDepsFetcherVersion = 2`、`npmFlags = [ "--legacy-peer-deps" ]` 与 lockfile v3 normalization；后续提交 `fe252675` 又改为 `importNpmLock`，避免手工维护 `npmDepsHash`。这里应语义吸收已验证的 Nix/npm 可复现构建思路，而不是无条件照抄。

本设计只处理 Linux/Nix packaging reproducibility。Linux AppImage Wayland/EGL/GBM runtime startup fallback 由既有 `linux-appimage-startup-compatibility` capability 管理，不在这里合并。

## Goals / Non-Goals

**Goals:**

- 让 `nix build .#` 在 clean-room 环境中完成 Tauri app package build。
- 让 `nix run .#` 解析到 `cc-gui`。
- 保留 frontend `tsc && vite build` 质量门禁。
- 补齐源码 direct imports 对应的 npm manifest declarations。
- 将 Linux native build inputs 限定在 Linux flake evaluation/build path。
- 通过 changed-file review 证明 macOS/Windows packaging 未被修改。

**Non-Goals:**

- 不修改 macOS/Windows build scripts、bundle config 或 release jobs。
- 不改变 app runtime behavior。
- 不修 Linux AppImage runtime startup crash。
- 不做全量 dependency upgrade。
- 不把 `package-lock.json` 变成无关 registry/transitive churn 的载体。
- 不默认关闭 Rust checks；如 Nix build 技术限制要求关闭，必须给出替代验证。

## Decisions

### Decision 1: Use repo root as Nix Rust package source, keep crate root explicit

Use `src = ./.` in `pkgs.rustPlatform.buildRustPackage` and set `cargoRoot = "src-tauri"` / `buildAndTestSubdir = "src-tauri"` when supported by the nixpkgs builder in use.

Alternatives considered:

| Option | Description | Trade-off | Decision |
|---|---|---|---|
| Keep `src = ./src-tauri` | Minimal diff | Tauri build cannot naturally see repo-level frontend artifact/config; path hacks become fragile | Reject |
| Use repo root + explicit cargo root | Stable package boundary, matches Tauri repo layout | Requires checking builder attribute support in current nixpkgs | Adopt |
| Copy all required files into `src-tauri` during build | Avoid source boundary change | Creates hidden build-only layout not reflected in repo | Reject |

### Decision 2: Preserve `npm run build` semantics for frontend derivation

The frontend derivation should continue to execute the repository build script, because `package.json` defines `build` as `tsc && vite build`.

Alternatives considered:

| Option | Description | Trade-off | Decision |
|---|---|---|---|
| Keep `npmBuildScript = "build"` | Preserves TypeScript check and Vite build | Requires npm dependency source to remain reproducible when the lockfile changes | Adopt |
| Replace with `npm exec -- vite build` | May bypass some npm script issues | Drops TypeScript check and weakens quality gate | Reject |
| Split Nix frontend build into manual `tsc` then `vite` commands | Explicit but duplicates package script | More drift risk than reusing existing script | Reject |

### Decision 3: Use `importNpmLock` for npm dependency closure

Use `pkgs.importNpmLock { npmRoot = ./.; }` as the `buildNpmPackage.npmDeps` source and pair it with `pkgs.importNpmLock.npmConfigHook`. This relies on integrity hashes already committed in `package-lock.json` and removes the hand-maintained `npmDepsHash` drift point observed after the `0.4.11` version bump.

`npmFlags = [ "--legacy-peer-deps" ]` remains acceptable when Nix/npm validation proves it is required by React 19 peer dependency resolution. It is not a product dependency and must not be used to mask undeclared direct imports.

Lockfile normalization is acceptable when it is limited to npm/Nix reproducibility fields such as lockfile format, `resolved`, and `integrity`. Unrelated package version upgrades or unrelated direct dependency promotion remain out of scope.

Alternatives considered:

| Option | Description | Trade-off | Decision |
|---|---|---|---|
| Keep `npmDepsHash` + `npmDepsFetcherVersion = 2` | Matches the previous fix | Any `package-lock.json` metadata change can invalidate the fixed-output hash and require manual refresh | Reject |
| Use `importNpmLock` only for npm dependency closure | Removes manual hash drift while preserving committed lockfile as source of truth | Requires current nixpkgs to provide `importNpmLock` and its dedicated config hook | Adopt |
| Copy every PR #428 flake change | Imports the contributor's exact local result | Includes unrelated `doCheck = false` and chmod behavior that are not needed for hash automation | Reject |

### Decision 4: Fix `frontendDist` relative to Rust crate execution context

When the Rust package runs Tauri from `src-tauri`, the Nix-injected Tauri config must point to the copied frontend artifact from that crate context. The expected target is `../dist` if the build copies frontend output to repo-root `dist` before building from `src-tauri`.

Implementation must verify the actual working directory used by `cargo-tauri` under the selected builder attributes. If the builder executes from repo root instead, the design may keep `dist`, but the final value must be proven by `nix build`.

### Decision 5: Add Linux native inputs only through a Linux-scoped collection

Expand the existing `linuxPackages = pkgs.lib.optionals pkgs.stdenv.isLinux [...]` collection instead of adding Linux packages globally.

Likely candidates to validate:

- `pkgs.alsa-lib`
- `pkgs.glib-networking`
- `pkgs.libayatana-appindicator`
- `pkgs.rustPlatform.bindgenHook` as a native build input
- `LIBCLANG_PATH` only if `bindgenHook` does not provide the required libclang discovery path

The final list must be driven by Nix build errors and Tauri/WebKitGTK build requirements, not copied blindly from the upstream PR.

### Decision 6: Promote only real direct or required peer dependencies

Add `antd` and `remark-breaks` to root `package.json` because they are directly imported by `src/**`.

For `@lobehub/icons`, current package metadata declares peer dependencies on `@lobehub/ui` and `antd`. `antd` is already justified by direct source usage. `@lobehub/ui`, `@lobehub/fluent-emoji`, `motion`, and `es-toolkit` must only be promoted if Nix/npm install or package runtime proves they are required direct/peer dependencies for this repo. Transitive dependencies must stay transitive.

### Decision 7: Make `nix run .#` explicit through package metadata

Set `meta.mainProgram = "cc-gui"` on the default package so `nix run .#` resolves without manual binary path discovery.

In headless validation environments, an equivalent Nix metadata or entrypoint resolution check is sufficient. The packaging gate must prove resolution to `cc-gui`; it must not require actually launching the GUI on CI.

### Decision 8: Treat macOS/Windows isolation as an acceptance gate

Implementation review must explicitly check that these surfaces are unchanged:

- macOS scripts in `package.json`
- Windows scripts in `package.json`
- `src-tauri/tauri.conf.json` macOS/Windows bundle settings
- `.github/workflows/release.yml` macOS/Windows jobs

Because `package.json` and `package-lock.json` are cross-platform files, their changes require a dependency-only rationale and must not encode Linux runtime assumptions.

## Implementation Shape

1. Inspect current source imports and dependency metadata:
   - `rg -n "from 'antd'|from \"antd\"|remark-breaks|@lobehub/icons" src package.json`
   - `jq '.packages["node_modules/@lobehub/icons"] | {version, peerDependencies, dependencies}' package-lock.json`
2. Update root `package.json` with missing direct dependencies:
   - `antd`
   - `remark-breaks`
   - peer dependencies only if validation proves they are required.
3. Regenerate `package-lock.json` using the repository-approved npm flow. If Nix/npm requires lockfile v3, `resolved`, or `integrity` normalization, allow that normalization while rejecting unrelated dependency version upgrades.
4. Update `flake.nix`:
   - keep frontend build script quality gate;
   - use `importNpmLock` with `importNpmLock.npmConfigHook` for npm dependencies;
   - keep `npmFlags = [ "--legacy-peer-deps" ]` only if required by Nix/npm behavior;
   - adjust Rust package source/cargo root;
   - adjust `TAURI_CONFIG.build.frontendDist` based on verified build context;
   - add Linux-only build inputs and only add `LIBCLANG_PATH` if `bindgenHook` is insufficient;
   - add `meta.mainProgram`.
5. If `package-lock.json` changes later, rely on committed integrity data through `importNpmLock` rather than refreshing a hand-written `npmDepsHash`.
6. Run validation and record any environment-specific blockers.

## Risks / Trade-offs

- [Risk] `cargoRoot` / `buildAndTestSubdir` support may vary with nixpkgs revision → Mitigation: validate against the pinned `nixpkgs-unstable` input and adjust to supported builder attributes only.
- [Risk] `frontendDist` may depend on actual Tauri working directory → Mitigation: choose final value only after `nix build` proves the artifact is resolved.
- [Risk] npm lockfile regeneration can introduce large unrelated churn → Mitigation: allow reproducibility normalization (`lockfileVersion`, `resolved`, `integrity`) but reject unrelated version upgrades and direct dependency promotion.
- [Risk] Nix may be unavailable on the developer machine → Mitigation: document blocker and run Nix validation on a Linux/Nix host or CI before marking implementation complete.
- [Risk] Closing peer dependency warnings by promoting too many packages can bloat dependency surface → Mitigation: promote only direct imports or proven required peers.
- [Risk] Disabling Rust checks may hide regressions → Mitigation: avoid `doCheck = false` by default; if unavoidable, require separate `cargo test --manifest-path src-tauri/Cargo.toml` validation evidence.

## Migration Plan

1. Land OpenSpec artifacts first.
2. Implement the Nix and npm manifest changes in one focused code change.
3. Validate on a machine with Nix available.
4. If validation passes, update any implementation notes with exact Nix outcomes.
5. Roll back by reverting `flake.nix`, `package.json`, and `package-lock.json`; no runtime data migration is needed.

## Open Questions

- Does current nixpkgs support `buildAndTestSubdir` for the selected `rustPlatform.buildRustPackage` path, or should the implementation use only `cargoRoot` plus explicit build flags?
- Does the current lockfile and React 19 dependency graph still require `npmFlags = [ "--legacy-peer-deps" ]` during Nix builds after switching to `importNpmLock`?
- Is `@lobehub/ui` required as a direct peer for `@lobehub/icons` in a clean npm install, or is `antd` sufficient for the icons currently used?
- On the target Linux/Nix host, which native package is the first actual missing dependency: `alsa-lib`, `glib-networking`, `libayatana-appindicator`, `bindgenHook`, explicit `LIBCLANG_PATH`, or another WebKitGTK/Tauri dependency?
