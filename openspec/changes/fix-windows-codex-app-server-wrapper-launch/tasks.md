## 1. Launch Path Audit And Planning

- [x] 1.1 [P0][depends: none][input: `src-tauri/src/backend/app_server.rs`, `src-tauri/src/backend/app_server_cli.rs`][output: confirmed primary app-server launch argument order][verify: code review] Trace current launch order for resolved binary, user `codexArgs`, internal spec priority hint, `app-server`, stdio, and console visibility.
- [x] 1.2 [P0][depends: 1.1][input: wrapper detection helpers][output: explicit wrapper fallback eligibility function or equivalent helper][verify: targeted Rust unit test] Define the exact gating for Windows `.cmd/.bat` compatibility retry and prove direct executables are excluded.
- [ ] 1.3 [P1][depends: 1.1][input: issue evidence from failing Win11 machine][output: reproduction notes for quote vs hidden-console failure mode][verify: manual command notes] Capture whether `codex -c "developer_instructions=\"test\"" app-server --help` fails on the affected machine, so implementation can prioritize quote fallback or console fallback.

## 2. Compatibility Retry Implementation

- [x] 2.1 [P0][depends: 1.2][input: `spawn_workspace_session_once()`][output: small internal launch options structure for app-server session spawn][verify: cargo test targeted module] Represent `hide_console` and `inject_internal_spec_hint` explicitly instead of relying on scattered boolean parameters.
- [x] 2.2 [P0][depends: 2.1][input: primary launch failure path][output: bounded Windows wrapper compatibility retry][verify: targeted Rust unit test or integration-style helper test] Retry at most once after pre-initialize wrapper failure, preserving primary failure details.
- [x] 2.3 [P0][depends: 2.2][input: internal spec priority injection helper][output: fallback launch that avoids fragile internal quoted config][verify: targeted Rust unit test] Ensure compatibility retry does not pass internal `developer_instructions` quoted TOML through `cmd.exe /c <wrapper>`.
- [x] 2.4 [P0][depends: 2.3][input: user `codexArgs` parsing][output: user args preserved in fallback][verify: targeted Rust unit test] Preserve valid user-provided Codex args during fallback and keep existing override detection for user `developer_instructions` / `instructions`.
- [x] 2.5 [P1][depends: 2.2][input: visible-console fallback][output: decision whether fallback needs console visibility retry after quote-safe retry][verify: code review plus affected Win11 manual smoke] Use visible-console fallback only if quote-safe retry does not address the failing machine. 2026-04-28 decision: compatibility retry skips internal quoted config by default and only shows console when `CODEMOSS_SHOW_CONSOLE=1`; affected-machine smoke remains covered by 4.4.

## 3. Probe, Doctor, And Diagnostics

- [x] 3.1 [P0][depends: 2.1][input: `run_codex_app_server_probe_once()`][output: probe uses app-server launch options aligned with real session launch][verify: targeted Rust unit test] Make probe cover the same internal suffix risk or expose fallback-required status.
- [x] 3.2 [P0][depends: 3.1][input: `probe_codex_app_server()`][output: probe fallback status and details preserve primary/fallback failure summaries][verify: targeted Rust unit test] Report `fallbackRetried` and clear status values for primary success, fallback success, and fallback failure.
- [x] 3.3 [P1][depends: 3.2][input: `src-tauri/src/codex/doctor.rs`][output: doctor output exposes resolved binary, wrapper kind, appServerProbeStatus, fallbackRetried, and details][verify: existing doctor tests or snapshot assertions] Confirm doctor does not show healthy when installation / Node / PATH failures remain.
- [x] 3.4 [P1][depends: 2.2][input: runtime diagnostics fields][output: runtime row or log detail includes wrapper kind and fallback retry summary when available][verify: code review or existing runtime diagnostics test] Add diagnostics only if existing surfaces do not already expose enough fallback evidence. 2026-04-28 code review: doctor already exposes `fallbackRetried` / `appServerProbeStatus`; runtime row already exposes `wrapperKind`; session fallback logs primary failure and wrapper kind, so no new runtime row schema was added.

## 4. Validation

- [x] 4.1 [P0][depends: 2-3][input: backend changes][output: Rust targeted app-server tests pass][verify: `cargo test --manifest-path src-tauri/Cargo.toml app_server`] Run focused app-server tests.
- [x] 4.2 [P0][depends: 2-3][input: backend changes][output: Rust targeted app-server CLI tests pass][verify: `cargo test --manifest-path src-tauri/Cargo.toml app_server_cli`] Run focused app-server CLI tests.
- [x] 4.3 [P0][depends: 2-3][input: cross-layer compile contracts][output: frontend/backend type contracts remain valid][verify: `npm run typecheck`] Run TypeScript typecheck because doctor/runtime diagnostics may surface through Tauri service types.
- [ ] 4.4 [P1][depends: 2-3][input: affected Win11 environment][output: manual smoke notes][verify: manual] Verify affected Windows 11 machine can create Codex session after fallback.
- [ ] 4.5 [P1][depends: 2-3][input: healthy Win11 wrapper environment][output: no-regression manual notes][verify: manual] Verify a currently healthy Windows wrapper user still succeeds on primary path without fallback.
- [x] 4.6 [P1][depends: 2-3][input: macOS environment][output: no-regression manual notes][verify: manual] Verify macOS Codex session creation remains unchanged. 2026-05-02 macOS local smoke confirmed by Chen Xiangning: desktop Codex session creation remains healthy on macOS.
