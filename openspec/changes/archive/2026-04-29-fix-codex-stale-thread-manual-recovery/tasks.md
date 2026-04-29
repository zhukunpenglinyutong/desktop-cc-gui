## 1. Recovery Result Contract

- [x] 1.1 [P0][输入: `src/app-shell-parts/manualThreadRecovery.ts`][输出: structured manual recovery result type with `rebound` / `fresh` / `failed`][验证: focused unit tests] Replace `string | null` manual recovery result with a classified outcome.
- [x] 1.2 [P0][depends: 1.1][输入: existing verified refresh path][输出: `rebound` preserves current refresh / canonical rebind semantics][验证: existing recovery tests continue to pass] Keep verified replacement behavior unchanged.
- [x] 1.3 [P1][depends: 1.1][输入: no verified replacement path][输出: `fresh` only when a new Codex thread is explicitly created][验证: new manual recovery unit test] Separate fresh fallback from recovered-session success.

## 2. Conversation Surface Integration

- [x] 2.1 [P0][depends: 1.1][输入: `src/app-shell-parts/useAppShellLayoutNodesSection.tsx` recover-only adapter][输出: recover-only succeeds only for `rebound`; `fresh` returns explicit non-rebound outcome][验证: app-shell recovery tests] Update recover-only callback semantics.
- [x] 2.2 [P0][depends: 1.1][输入: recover-and-resend adapter][输出: `rebound` keeps suppression; `fresh` sends visibly in the new thread][验证: app-shell recovery tests] Split resend behavior by recovery result kind.
- [x] 2.3 [P1][depends: 2.1][输入: `RuntimeReconnectCard` status handling][输出: user-visible failed/fresh detail instead of silent success][验证: `Messages.runtime-reconnect.test.tsx`] Update recovery card result handling and copy.

## 3. Regression Coverage

- [x] 3.1 [P0][depends: 1.1][输入: `useAppShellLayoutNodesSection.recovery.test.ts`][输出: tests for `rebound`, `fresh`, and `failed` manual recovery outcomes][验证: Vitest focused file] Cover result classification.
- [x] 3.2 [P0][depends: 2.2][输入: `Messages.runtime-reconnect.test.tsx`][输出: stale `thread-not-found` recover-and-resend fresh fallback remains visible][验证: Vitest focused file] Cover fresh fallback resend visibility.
- [x] 3.3 [P1][depends: 2.3][输入: existing runtime reconnect tests][输出: broken pipe / workspace-not-connected reconnect and resend still pass][验证: Vitest focused file] Guard non-stale runtime reconnect behavior.

## 4. Verification

- [x] 4.1 [P0][depends: 1-3][输入: changed frontend files][输出: focused frontend regression evidence][验证: `pnpm vitest run src/app-shell-parts/useAppShellLayoutNodesSection.recovery.test.ts src/features/messages/components/Messages.runtime-reconnect.test.tsx`]
- [x] 4.2 [P0][depends: 4.1][输入: TypeScript project][输出: type safety evidence][验证: `pnpm typecheck`]
- [x] 4.3 [P1][depends: 4.2][输入: OpenSpec artifacts][输出: strict validation pass][验证: `openspec validate fix-codex-stale-thread-manual-recovery --strict`]
- [x] 4.4 [P1][depends: 4.1][输入: runtime reconnect boundary helpers][输出: malformed callback / empty id defensive behavior][验证: `pnpm vitest run src/features/messages/components/runtimeReconnect.test.ts`]
- [x] 4.5 [P1][depends: 4.1][输入: large-file governance workflow][输出: near-threshold watch reviewed and hard gate pass][验证: `npm run check:large-files:near-threshold` + `npm run check:large-files:gate`]
- [x] 4.6 [P1][depends: 4.1][输入: heavy-test-noise workflow][输出: repo-owned act/stdout/stderr noise all zero][验证: `node --test scripts/check-heavy-test-noise.test.mjs` + `npm run check:heavy-test-noise`]
- [x] 4.7 [P1][depends: 4.2][输入: cross-layer runtime safety gates][输出: runtime contracts, doctor, and Rust tests pass][验证: `npm run check:runtime-contracts` + `npm run doctor:strict` + `cargo test --manifest-path src-tauri/Cargo.toml`]
