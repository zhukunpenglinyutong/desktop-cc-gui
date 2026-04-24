## 1. Diagnostics And Classification

- [x] 1.1 [P0][depends:none][I: `streamLatencyDiagnostics.ts`, `useThreadEventHandlers.ts`][O: provider-independent `visible-output-stall-after-first-delta` classification][V: Vitest covers first-delta-then-stall without provider/model match] Add engine-level visible output stall diagnostics for Claude Code.
- [x] 1.2 [P0][depends:1.1][I: existing renderer/thread diagnostics][O: correlated evidence fields for first delta, visible render, text growth, engine, platform, active profile][V: diagnostic payload assertions include no provider gate] Preserve enough evidence to distinguish upstream pending from visible output stall.
- [x] 1.3 [P1][depends:1.1][I: existing debug/diagnostic flags][O: bounded event emission and rollback flag semantics][V: tests cover disabled mitigation still records diagnostics] Keep diagnostics bounded and rollback-safe.

## 2. Claude Windows Mitigation Profile

- [x] 2.1 [P0][depends:1.1][I: active thread stream latency snapshot][O: `Claude Code + Windows + evidence` mitigation profile resolver][V: tests show native Claude Windows activates without Qwen/provider fingerprint] Add engine/platform-scoped mitigation resolution.
- [x] 2.2 [P0][depends:2.1][I: `Messages.tsx`, `MessagesTimeline.tsx`, `MessagesRows.tsx`, `Markdown.tsx`][O: active profile reaches live assistant/reasoning render path][V: targeted render tests verify profile-specific throttle/light-path behavior] Wire mitigation profile through the live message render chain.
- [x] 2.3 [P0][depends:2.2][I: Claude live assistant message row and Markdown streaming throttle][O: progressive visible text continues after first delta][V: test simulates repeated deltas and asserts intermediate text becomes visible before completion] Preserve progressive assistant text visibility during processing.

## 3. Boundary Protection

- [x] 3.1 [P0][depends:2.1][I: engine/platform guard logic][O: non-Claude and macOS paths remain baseline][V: tests cover Codex/Gemini/OpenCode and macOS Claude non-activation] Prevent mitigation leakage to other engines or normal platforms.
- [x] 3.2 [P1][depends:2.1][I: existing Qwen-compatible provider mitigation][O: provider-specific profile remains additive, not gating][V: tests cover Qwen path still works and native Claude path works without Qwen] Keep historical provider mitigation without making it the root cause.
- [x] 3.3 [P1][depends:2.3][I: message ordering and completion contracts][O: final text and event ordering parity][V: reducer/render tests assert no lost text, no duplicate final output, no pseudo-completion] Ensure mitigation preserves conversation semantics.

## 4. Validation

- [ ] 4.1 [P0][depends:1.1,2.3,3.1][I: affected frontend modules][O: targeted Vitest pass][V: `npm exec vitest run <targeted test files>`] Run targeted diagnostics/render tests.
- [x] 4.2 [P1][depends:4.1][I: TypeScript frontend][O: type safety pass][V: `npm run typecheck`] Run typecheck after implementation.
- [ ] 4.3 [P1][depends:4.1][I: Windows native Claude Code environment][O: manual matrix result][V: first delta and intermediate text visibly progress before completion] Manually verify Windows native Claude Code streaming. Blocked in this macOS session; requires a Windows native Claude Code run.
- [ ] 4.4 [P1][depends:4.3][I: macOS Claude and non-Claude control paths][O: control matrix result][V: macOS and other engines remain baseline] Verify no cross-engine/platform regression. Pending after Windows manual matrix; automated non-Claude/macOS guard tests pass.
