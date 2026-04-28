## 1. Dependency Boundary Audit

- [x] 1.1 Audit direct source imports and current dependency metadata. `[P0][依赖: proposal/spec/design][输入: src/** imports, package.json, package-lock.json][输出: direct dependency audit notes for antd, remark-breaks, @lobehub/icons peers][验证: rg -n "from 'antd'|from \"antd\"|remark-breaks|@lobehub/icons" src package.json && jq '.packages["node_modules/@lobehub/icons"] | {version, peerDependencies, dependencies}' package-lock.json]`
- [x] 1.2 Decide the minimal npm manifest additions. `[P0][依赖: 1.1][输入: dependency audit][输出: final package list limited to direct imports and proven required peers][验证: decision matches nix-flake-build-reproducibility direct-dependency requirement]`

## 2. Npm Manifest and Lockfile

- [x] 2.1 Add missing direct dependencies to package.json. `[P0][依赖: 1.2][输入: final package list][输出: package.json declares direct src/** imports such as antd and remark-breaks][验证: rg confirms each direct import has a package.json declaration]`
- [x] 2.2 Regenerate package-lock.json with the repository npm workflow. `[P0][依赖: 2.1][输入: updated package.json][输出: lockfile aligned with root manifest][验证: npm install --package-lock-only --ignore-scripts --legacy-peer-deps or documented equivalent succeeds; use lockfile v3 normalization only if required by npm/Nix]`
- [x] 2.3 Review lockfile diff for unrelated churn. `[P1][依赖: 2.2][输入: package-lock.json diff][输出: accepted lockfile diff or corrected regeneration][验证: git diff -- package-lock.json shows changes attributable to direct deps, required peers, npm closure, or reproducibility normalization; no unrelated dependency upgrades or direct dependency promotion]`

## 3. Nix Flake Packaging Fix

- [x] 3.1 Update Rust package source boundary in flake.nix. `[P0][依赖: 2.2][输入: current flake.nix and design Decision 1][输出: repo-root source with explicit src-tauri crate root using supported nixpkgs attributes][验证: nix build proceeds past source/cargo root discovery or blocker is documented]`
- [x] 3.2 Preserve frontend TypeScript quality gate in Nix build. `[P0][依赖: 3.1][输入: package.json build script and frontend derivation][输出: Nix frontend build still runs npm build semantics equivalent to tsc && vite build][验证: nix build logs show repository build script or equivalent TypeScript check path]`
- [x] 3.3 Validate Nix npm fetcher settings. `[P0][依赖: 2.2, 3.2][输入: lockfile format, peer dependency behavior, Nix build output][输出: importNpmLock/importNpmLock.npmConfigHook used for lockfile-integrity dependency source; npmFlags applied only if required][验证: nix build dependency fetch succeeds; importNpmLock and any --legacy-peer-deps use are documented as build-resolution behavior]`
- [x] 3.4 Fix Tauri frontendDist for the Nix Rust build context. `[P0][依赖: 3.1][输入: Tauri working directory observed during Nix build][输出: TAURI_CONFIG.build.frontendDist resolves to copied frontend artifact][验证: nix build proceeds past Tauri frontend asset discovery]`
- [x] 3.5 Add Linux-only native build inputs. `[P0][依赖: 3.1][输入: Nix build errors and Tauri/WebKitGTK/libclang requirements][输出: Linux packages added only through Linux-scoped collection; LIBCLANG_PATH added only if bindgenHook is insufficient][验证: non-Linux evaluation does not require Linux-only packages; git diff shows Linux-only scoping]`
- [x] 3.6 Add default Nix run metadata. `[P1][依赖: 3.1][输入: installed binary name cc-gui][输出: flake package meta.mainProgram = "cc-gui"][验证: nix run .# or equivalent Nix metadata check resolves to cc-gui without requiring GUI launch in headless CI]`
- [x] 3.7 Replace manual npmDepsHash after dependency closure changes. `[P0][依赖: 2.2, 3.2, 3.3][输入: repeated Nix hash mismatch output and PR #428 follow-up][输出: flake.nix uses importNpmLock instead of hand-maintained npmDepsHash][验证: dependency source is derived from committed package-lock.json integrity data; nix build no longer depends on manual npmDepsHash refresh]`

## 4. Platform Isolation Review

- [x] 4.1 Confirm macOS and Windows package scripts are unchanged. `[P0][依赖: 2.1, 3.5][输入: package.json diff][输出: explicit review result][验证: git diff -- package.json does not change build:mac-*, build:win-*, tauri:build:win, tauri:dev:win]`
- [x] 4.2 Confirm macOS and Windows bundle/release surfaces are unchanged. `[P0][依赖: 3.x][输入: changed file list][输出: explicit review result][验证: git diff --name-only excludes src-tauri/tauri.conf.json and .github/workflows/release.yml unless separately justified]`
- [x] 4.3 Confirm Linux runtime startup fallback is untouched. `[P1][依赖: 3.x][输入: changed file list][输出: explicit review result][验证: git diff --name-only excludes src-tauri startup fallback modules and does not modify linux-appimage-startup-compatibility implementation]`

## 5. Validation and Documentation

- [x] 5.1 Run frontend and Rust quality gates. `[P0][依赖: 2.x, 3.x][输入: implemented package/flake changes][输出: validation results][验证: npm run typecheck && npm run build && cargo test --manifest-path src-tauri/Cargo.toml]`
- [ ] 5.2 Run Nix packaging validation on a Nix-capable host. `[P0][依赖: 3.x][输入: implemented flake.nix and lockfile][输出: Nix validation results][验证: nix build .# --no-link --print-build-logs && nix flake check --no-build && nix run .#]`
- [x] 5.3 Document any environment-specific validation blocker. `[P1][依赖: 5.1, 5.2][输入: validation output][输出: implementation notes if Nix is unavailable locally or a check must be deferred][验证: blocker includes exact missing command/environment and replacement evidence]`
- [x] 5.4 Run OpenSpec validation. `[P0][依赖: all artifacts][输入: completed artifacts and implementation notes][输出: validated OpenSpec change][验证: openspec validate fix-linux-nix-flake-packaging --type change --strict --no-interactive]`

## Implementation Notes

- 2026-04-27 local validation passed: `npm run typecheck`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
- 2026-04-27 OpenSpec strict validation passed: `openspec validate fix-linux-nix-flake-packaging --type change --strict --no-interactive`.
- 2026-04-27 `npmDepsHash` was refreshed from the Nix fixed-output mismatch reported by `nix run github:chenxiangning/codemoss/feature/v0.4.9`: `got: sha256-FEbcbD0BtGpTLhhxIleci5ld9s7Ds43Qw5wYCRPI1+k=`.
- 2026-04-28 `npmDepsHash` was refreshed again after `chore: bump version to 0.4.11` changed the npm manifest/lockfile root version. The new Nix fixed-output mismatch reported by `nix run github:zhukunpenglinyutong/desktop-cc-gui` was `got: sha256-pS4skwBNVcEB2tLO/E3xCkD0G015wAmJJ1ds9N9idec=`.
- 2026-04-28 PR #428 follow-up commit `fe252675` switched the frontend dependency source to `importNpmLock`. This change adopts only that npm dependency closure automation and intentionally does not copy unrelated `doCheck = false` or `chmod -R u+w dist` behavior, keeping macOS/Windows packaging surfaces untouched.
- Local Nix validation is blocked because `nix` is unavailable after normal shell, login shell, and `which nix` checks. Therefore task 5.2 remains open until a Nix-capable host can run `nix build .# --no-link --print-build-logs`, `nix flake check --no-build`, and entrypoint resolution for `nix run .#`.
