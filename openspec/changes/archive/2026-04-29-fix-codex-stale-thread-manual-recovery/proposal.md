## Why

Codex `thread not found` recovery still has a blind spot after the earlier stale-thread alias fix: when no verified replacement thread can be found, the UI may create a fresh thread but keep treating the action like a silent rebind. Users then click "recover" or "recover and resend" and see no meaningful progress, even though the runtime itself is already alive.

This matters now because Runtime Pool can show a healthy recovered Codex runtime while an older conversation identity is unrecoverable. The fix must separate runtime readiness, verified thread rebind, and fresh-thread resend so stale recovery does not regress normal conversation startup, runtime lease, or warm retention behavior.

## 目标与边界

- 目标：让 `thread-not-found` 手动恢复返回明确 result kind，区分 `rebound`、`fresh`、`failed`。
- 目标：当旧 Codex thread 无法安全 rebind 时，允许用户在新 Codex thread 中恢复并重发上一条 prompt，且 UI 必须可见地切换/反馈。
- 目标：保持 recover-only 的保守语义：找不到 verified replacement 时，不把 fresh thread 伪装成旧会话恢复成功。
- 目标：确保 fresh fallback 不影响正常新对话、正常 runtime reconnect、Runtime Pool 续租、warm TTL、pin/lease 逻辑。
- 边界：本变更优先收敛在 frontend manual recovery contract；不重写 runtime manager、不新增 backend ledger、不修改 Codex CLI protocol。
- 边界：仅处理 Codex stale `threadId` 手动恢复；Claude、Gemini、OpenCode 行为保持现状，除非共享类型需要兼容性扩展。

## 非目标

- 不通过启发式猜测最近 thread 来替代旧会话。
- 不承诺已经丢失的旧 Codex conversation 可以原地复活。
- 不改 `ensureRuntimeReady` 的 runtime acquisition / lease 语义。
- 不改变正常 composer send、queue fusion、Runtime Pool retain/release 的主链路。
- 不新增第三方依赖。

## What Changes

- Extend manual stale-thread recovery from `string | null` to a structured result with a recovery kind.
- Keep verified replacement behavior as `rebound`: switch to canonical replacement, preserve alias semantics, and avoid duplicate user bubbles.
- Treat no-replacement fallback as `fresh`: create a new Codex thread only as an explicit fallback, switch active conversation to it, and make resend visible instead of silently suppressing the user prompt.
- Keep recover-only conservative: if only a fresh thread can be created, report that the original session was not recovered rather than presenting it as a successful rebind.
- Add focused tests for `thread-not-found` recovery card behavior, fresh fallback resend visibility, and no-regression of runtime reconnect / resend paths.

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险/代价 | 结论 |
|---|---|---|---|---|
| A | 继续复用 `string | null`，由调用方猜测返回的是 replacement 还是 fresh thread | 改动最小 | 语义不透明，UI 无法决定是否 suppress optimistic bubble，继续出现“点击无效” | 不采用 |
| B | 找不到 verified replacement 时直接失败，不再自动新建 thread | 最保守，完全避免误绑 | 用户仍无法一键继续上一条 prompt，体验上等同按钮失败 | 不作为最终方案 |
| C | 返回 structured recovery result；verified rebind 与 fresh fallback 分流处理 | 语义清晰，能保护旧会话身份，又能让用户在新会话继续 | 需要小幅调整 callback 类型和测试 | 采用 |

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `codex-stale-thread-binding-recovery`: 补充 stale thread manual recovery 在 verified rebind 不存在时的 fresh fallback、recover-only 保守失败与 recover-and-resend 可见继续语义。
- `conversation-lifecycle-contract`: 补充手动恢复动作必须产生非矛盾生命周期结果，不能把 fresh conversation fallback 表述为旧会话恢复成功。

## 验收标准

- 当 `thread not found` 且系统找到 verified replacement thread 时，恢复动作 MUST 保持现有 alias/rebind 行为。
- 当 `thread not found` 且系统找不到 verified replacement，但可以创建 fresh Codex thread 时，`recover and resend` MUST 切到 fresh thread 并可见地发送上一条 prompt。
- 当用户只点击 recover-only 且没有 verified replacement 时，UI MUST 给出可解释失败或 fresh-session提示，MUST NOT 把 fresh thread 伪装为旧会话恢复成功。
- Runtime reconnect / broken pipe / workspace-not-connected 的既有 reconnect 与 resend 行为 MUST 不回退。
- 正常新对话、Runtime Pool lease、warm retention、pin/release 行为 MUST 不因 stale-thread manual recovery 改动而触发额外副作用。

## Impact

- Frontend:
  - `src/app-shell-parts/manualThreadRecovery.ts`
  - `src/app-shell-parts/useAppShellLayoutNodesSection.tsx`
  - `src/app-shell-parts/useAppShellLayoutNodesSection.recovery.test.ts`
  - `src/features/messages/components/RuntimeReconnectCard.tsx`
  - `src/features/messages/components/Messages.runtime-reconnect.test.tsx`
- Specs:
  - `openspec/specs/codex-stale-thread-binding-recovery/spec.md`
  - `openspec/specs/conversation-lifecycle-contract/spec.md`
- Dependencies:
  - No new dependencies.

## Self-Test Record

Date: 2026-04-27

### Review Findings Closed

- [x] Recover-only could treat a fresh fallback thread as a successful stale-thread recovery.
- [x] Recover-and-resend could suppress the replayed user prompt even when the fallback target was a fresh thread.
- [x] Runtime reconnect callback results lacked runtime shape validation for malformed objects and empty thread ids.
- [x] Manual recovery did not explicitly guard empty workspace/thread ids and could lose the refresh failure reason.

### Verification Commands

- [x] `pnpm vitest run src/app-shell-parts/useAppShellLayoutNodesSection.recovery.test.ts src/features/messages/components/Messages.runtime-reconnect.test.tsx src/features/messages/components/runtimeReconnect.test.ts`
  - Result: 3 files passed, 35 tests passed.
- [x] `pnpm typecheck`
  - Result: passed.
- [x] `pnpm lint`
  - Result: passed.
- [x] `npm run check:large-files:near-threshold`
  - Result: completed with 19 existing watch warnings; no new hard failure.
- [x] `npm run check:large-files:gate`
  - Result: `found=0`.
- [x] `node --test scripts/check-heavy-test-noise.test.mjs`
  - Result: 5 tests passed.
- [x] `npm run check:heavy-test-noise`
  - Result: completed 370 test files; repo-owned act/stdout/stderr noise all 0.
- [x] `npm run check:runtime-contracts`
  - Result: passed.
- [x] `npm run doctor:strict`
  - Result: passed.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
  - Result: passed.
- [x] `openspec validate fix-codex-stale-thread-manual-recovery --strict`
  - Result: valid.
- [x] `git diff --check`
  - Result: passed.

### Compatibility Notes

- No new path separator, shell command, newline, or filesystem casing dependency was introduced in the implementation.
- Existing Windows/macOS coverage remained green through frontend tests and Rust tests, including Windows pipe/path-focused cases already present in the suite.
