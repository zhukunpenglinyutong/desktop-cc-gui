{
  description = "ccgui Tauri app for orchestrating Codex agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        packageJson = builtins.fromJSON (builtins.readFile ./package.json);

        linuxPackages = pkgs.lib.optionals pkgs.stdenv.isLinux [
          pkgs.alsa-lib
          pkgs.glib-networking
          pkgs.gtk3
          pkgs.libayatana-appindicator
          pkgs.libxkbcommon
          pkgs.librsvg
          pkgs.libsoup_3
          pkgs.webkitgtk_4_1
        ];
        linuxNativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
          pkgs.rustPlatform.bindgenHook
        ];

        frontend = pkgs.buildNpmPackage {
          pname = "ccgui-frontend";
          version = packageJson.version;
          src = ./.;
          nodejs = pkgs.nodejs_20;
          npmDeps = pkgs.importNpmLock {
            npmRoot = ./.;
          };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
          npmFlags = [ "--legacy-peer-deps" ];
          npmBuildScript = "build";
          installPhase = ''
            mkdir -p $out
            cp -R dist $out/
          '';
        };

        tauriConfig = builtins.toJSON {
          build = {
            frontendDist = "../dist";
            devUrl = null;
          };
        };

        appPackage = pkgs.rustPlatform.buildRustPackage {
          pname = "ccgui";
          version = packageJson.version;
          src = ./.;
          cargoRoot = "src-tauri";
          buildAndTestSubdir = "src-tauri";

          cargoLock = {
            lockFile = ./src-tauri/Cargo.lock;
            outputHashes = {
              "fix-path-env-0.0.0" = "sha256-UygkxJZoiJlsgp8PLf1zaSVsJZx1GGdQyTXqaFv3oGk=";
            };
          };

          nativeBuildInputs = [
            pkgs.cargo-tauri
            pkgs.cmake
            pkgs.pkg-config
          ] ++ linuxNativeBuildInputs;

          buildInputs = [
            pkgs.openssl
          ] ++ linuxPackages;

          TAURI_CONFIG = tauriConfig;

          preBuild = ''
            mkdir -p dist
            cp -R ${frontend}/dist/. dist
          '';

          cargoBuildFlags = [
            "--features"
            "custom-protocol"
          ];

          installPhase = ''
            mkdir -p $out/bin
            target_dir="target/${pkgs.stdenv.hostPlatform.rust.rustcTarget}"
            cp "$target_dir/release/cc-gui" $out/bin/
          '';

          meta = {
            mainProgram = "cc-gui";
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.cargo
            pkgs.clang
            pkgs.cmake
            pkgs.git
            pkgs.nodejs_20
            pkgs.openssl
            pkgs.pkg-config
            pkgs.rust-analyzer
            pkgs.rustc
            pkgs.rustfmt
            pkgs.rustPlatform.rustLibSrc
          ] ++ linuxPackages;

          shellHook = ''
            export RUST_SRC_PATH=${pkgs.rustPlatform.rustLibSrc}
          '';
        };

        formatter = pkgs.alejandra;

        packages.default = appPackage;
      });
}
