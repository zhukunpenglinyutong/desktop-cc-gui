## ADDED Requirements

### Requirement: Nix flake package build MUST produce the Tauri app from a clean-room source boundary

The Nix flake package build MUST construct the Tauri application from an explicit repository source boundary that includes both the frontend artifact and the Rust crate, and MUST NOT rely on developer-local files outside the Nix derivation.

#### Scenario: Nix build uses repository root with explicit Rust crate root

- **WHEN** `nix build .# --no-link --print-build-logs` runs from a clean checkout
- **THEN** the Rust package source MUST include the repository files required by Tauri packaging
- **AND** the Rust crate root MUST be explicitly scoped to `src-tauri`

#### Scenario: Tauri frontend artifact path resolves inside Nix build output

- **WHEN** Tauri packaging runs inside the Nix Rust build phase
- **THEN** the effective `frontendDist` MUST point at the frontend artifact path available from the Rust crate context
- **AND** the build MUST NOT depend on a developer-local `dist` directory left from a previous build

### Requirement: Nix frontend dependency closure MUST be reproducible and preserve TypeScript checking

The Nix frontend build MUST fetch npm dependencies from the committed manifest and lockfile, and MUST preserve the repository's TypeScript checking semantics.

#### Scenario: direct source imports have manifest declarations

- **WHEN** a package is directly imported by `src/**`
- **THEN** `package.json` MUST declare that package as a direct dependency or devDependency according to its runtime role
- **AND** the lockfile MUST contain the matching resolved dependency entry

#### Scenario: Nix frontend build preserves repository build quality gate

- **WHEN** the frontend is built as part of `nix build .#`
- **THEN** the build MUST execute `tsc && vite build` or an equivalent command sequence that fails on TypeScript errors
- **AND** the Nix build MUST NOT replace the repository build with `vite build` only

#### Scenario: npm dependency closure uses committed lockfile integrity

- **WHEN** the Nix frontend dependency fetch is configured
- **THEN** the flake SHOULD use `importNpmLock` and `importNpmLock.npmConfigHook` so dependency sources come from committed `package-lock.json` integrity data
- **AND** the frontend derivation MUST NOT require a hand-maintained `npmDepsHash` for the npm dependency closure

#### Scenario: npm install flags are justified by Nix validation

- **WHEN** the Nix frontend dependency install requires `npmFlags = [ "--legacy-peer-deps" ]`
- **THEN** the setting MAY be added to `flake.nix`
- **AND** the implementation MUST document that the setting is needed for peer dependency resolution rather than product behavior

#### Scenario: lockfile changes are explainable

- **WHEN** `package-lock.json` changes as part of the Nix packaging fix
- **THEN** each meaningful lockfile change MUST be attributable to a direct dependency declaration, a required peer dependency, the npm dependency closure needed by Nix, or npm/Nix reproducibility normalization such as lockfile format, `resolved`, or `integrity`
- **AND** unrelated dependency version upgrades or unrelated direct dependency promotion MUST NOT be accepted as part of this change

### Requirement: Linux native build inputs MUST be scoped to Linux packaging

The Nix flake MUST declare Linux/Tauri native build inputs explicitly and MUST isolate Linux-specific packages from macOS and Windows packaging paths.

#### Scenario: Linux-only native inputs are conditionally added

- **WHEN** the flake evaluates native build inputs for a Linux system
- **THEN** Linux/Tauri packages such as WebKitGTK-related and app indicator dependencies MAY be added as Linux build inputs
- **AND** those packages MUST be guarded by a Linux-only condition

#### Scenario: libclang discovery fallback is evidence-driven

- **WHEN** Linux/Nix validation shows that `bindgenHook` alone does not provide the required libclang discovery path
- **THEN** the flake MAY set `LIBCLANG_PATH`
- **AND** the implementation MUST keep that setting scoped to the Nix build environment rather than repository runtime configuration

#### Scenario: non-Linux systems do not receive Linux-only native inputs

- **WHEN** the flake evaluates on a non-Linux system
- **THEN** Linux-only native packages MUST NOT be added to the package build inputs
- **AND** the flake MUST NOT require Linux-only system libraries to evaluate non-Linux outputs

### Requirement: Nix run MUST resolve to the packaged cc-gui binary

The Nix flake package metadata MUST expose a default runnable program that resolves to the installed `cc-gui` binary.

#### Scenario: default Nix run entrypoint is available

- **WHEN** `nix run .#` is invoked after a successful package build
- **THEN** Nix MUST resolve the default runnable program to `cc-gui`
- **AND** the run entrypoint MUST NOT require users to manually locate the binary path inside the Nix store

#### Scenario: headless validation may use entrypoint resolution instead of GUI launch

- **WHEN** validation runs in a headless environment where launching the GUI is not appropriate
- **THEN** an equivalent Nix metadata or entrypoint resolution check MAY satisfy the run validation
- **AND** the check MUST still prove that the default runnable program resolves to `cc-gui`

### Requirement: Linux/Nix packaging fix MUST preserve macOS and Windows packaging behavior

The Linux/Nix packaging fix MUST NOT modify macOS or Windows packaging scripts, bundle configuration, release jobs, or runtime behavior unless a later design explicitly documents a separate cross-platform reason.

#### Scenario: existing macOS and Windows package scripts remain unchanged

- **WHEN** this change modifies packaging files
- **THEN** the macOS build scripts in `package.json` MUST remain unchanged
- **AND** the Windows build scripts in `package.json` MUST remain unchanged

#### Scenario: macOS and Windows bundle configuration remains unchanged

- **WHEN** this change modifies Nix-specific Tauri configuration
- **THEN** the default `src-tauri/tauri.conf.json` macOS bundle configuration MUST remain unchanged
- **AND** the default `src-tauri/tauri.conf.json` Windows bundle configuration MUST remain unchanged

#### Scenario: Linux runtime startup fallback is not included in packaging fix

- **WHEN** this change is implemented
- **THEN** it MUST NOT add Linux AppImage Wayland/EGL/GBM runtime fallback logic
- **AND** runtime startup compatibility MUST remain governed by the separate `linux-appimage-startup-compatibility` capability

### Requirement: Nix packaging validation MUST prove reproducibility and platform isolation

The implementation MUST provide validation evidence that the Nix package builds, the default run entrypoint resolves, direct imports are declared, and macOS/Windows packaging files were not modified.

#### Scenario: Nix and repository quality gates pass

- **WHEN** implementation is complete
- **THEN** `nix build .# --no-link --print-build-logs` MUST pass
- **AND** `nix flake check --no-build` MUST pass
- **AND** repository frontend and Rust validation commands MUST pass or have a documented environment-specific blocker

#### Scenario: changed file set excludes macOS and Windows packaging surfaces

- **WHEN** the implementation diff is reviewed
- **THEN** the changed file set MUST be limited to `flake.nix`, npm manifest/lockfile files, OpenSpec artifacts, and any explicitly justified validation documentation
- **AND** macOS/Windows packaging scripts, bundle config, and release jobs MUST be absent from the changed file set
