## 1. Shared Frontend Settlement

- [x] 1.1 [P0][depends: none][input: `src/features/threads/hooks/useThreadEventHandlers.ts`, existing `modeBlocked` payload shapes][output: single predicate that recognizes requestUserInput-type `modeBlocked` via `blockedMethod/blocked_method` and equivalent reason code][verify: code review] 收紧共享前端的 blocked 分类边界，避免误伤其它 blocked 方法。
- [x] 1.2 [P0][depends: 1.1][input: shared lifecycle settlement helpers and `onModeBlocked` path][output: requestUserInput-type `modeBlocked` clears `processing`, `activeTurnId`, and equivalent active-turn residue while preserving blocked audit card and queue cleanup][verify: targeted frontend test] 让 blocked user-input 链路像真实 settlement 一样离开伪 processing。
- [x] 1.3 [P0][depends: 1.2][input: non-user-input `modeBlocked` handlers][output: command/file-change and other blocked events remain explain-only and do not clear unrelated execution state][verify: negative frontend regression test] 锁定“不扩大到所有 modeBlocked”的边界。

## 2. Frontend Regression Coverage

- [x] 2.1 [P0][depends: 1.2][input: thread event handler tests][output: regression test proving Codex `requestUserInput -> modeBlocked` exits pseudo-processing and keeps thread interactive][verify: targeted Vitest] 覆盖 issue 的直接前端症状。
- [x] 2.2 [P1][depends: 1.2][input: shared event compatibility tests][output: regression test proving Claude Code mapped `requestUserInput -> modeBlocked` reuses the same settlement path][verify: targeted Vitest] 锁定共享幕布收益范围。
- [x] 2.3 [P1][depends: 1.3][input: blocked event negative cases][output: regression test proving non-requestUserInput `modeBlocked` still stays explanatory only][verify: targeted Vitest] 防止 scope 漂移。

## 3. Codex Runtime Timeout Settlement

- [x] 3.1 [P0][depends: none][input: `src-tauri/src/backend/app_server.rs`, `src-tauri/src/runtime/mod.rs`][output: explicit `resume-pending` timeout settlement path that releases current foreground continuity / active-work protection][verify: targeted Rust unit test] 修复 Codex runtime ledger 的当前活跃误报。
- [x] 3.2 [P0][depends: 3.1][input: runtime stalled diagnostics structures][output: recent stalled timeout evidence retained separately from current active-work protection][verify: targeted Rust unit test] 保住诊断，不再绑在 current active state 上。
- [x] 3.3 [P0][depends: 3.2][input: runtime pool snapshot / classification logic][output: timeouted `resume-pending` rows stop rendering as current active-work protected or current `resume-pending`][verify: targeted Rust unit test] 让 runtime pool 口径与 thread surface 对齐。
- [x] 3.4 [P1][depends: 3.1][input: `src-tauri/src/backend/app_server_runtime_lifecycle.rs` and late terminal cleanup paths][output: completed/error/runtime-ended cleanup still behaves the same after timeout release][verify: targeted Rust unit test] 防止正常终态回退。

## 4. Validation

- [x] 4.1 [P0][depends: 2.3, 3.4][input: frontend and backend changes][output: targeted lifecycle and runtime regression suites pass][verify: `npm run test -- useThreadEventHandlers` and targeted `cargo test --manifest-path src-tauri/Cargo.toml ...`] 先跑最相关的回归面。
- [x] 4.2 [P0][depends: 4.1][input: cross-layer contract surfaces][output: no type or contract drift between frontend lifecycle state and backend runtime state][verify: `npm run typecheck`] 确认跨层字段与状态语义没有断裂。
- [x] 4.3 [P0][depends: 4.2][input: change artifacts][output: strict OpenSpec validation passes for `fix-mode-blocked-and-codex-resume-settlement`][verify: `openspec validate \"fix-mode-blocked-and-codex-resume-settlement\" --type change --strict`] 完成提案侧收口。
