## 0. Branch Calibration

Current branch source of truth: `feature/v0.5.0-md`.

Closure recalibration on 2026-05-20 confirmed current-branch implementation evidence is present for the runtime contract inventory, parity tests, local gates, and OpenSpec validation. Prior `feature/v0.5` evidence remains non-authoritative; the authoritative evidence for this branch is the current `implementation-evidence.md`, current code facts, and the validation commands recorded below.

## 1. Contract Inventory

- [x] 1.1 [P0][depends:none][I: `conversationCurtainContracts.ts`][O: canonical type inventory][V: 文档化 `RealtimeAdapter` / `HistoryLoader` / `NormalizedThreadEvent` 字段清单] 列出现有 contract 类型与字段。
- [x] 1.2 [P0][depends:none][I: `realtimeAdapterRegistry.ts`][O: 静态 registry 行为文档][V: 文档化"static Record + exhaustive over ConversationEngine"] 确认 registry 静态穷举形态。
- [x] 1.3 [P0][depends:none][I: 4 个 `*RealtimeAdapter.ts` + `sharedRealtimeAdapter.ts`][O: adapter 行为清单][V: 列出每个 adapter 接受的事件名与 legacy alias] inventory 4 引擎 adapter 行为。
- [x] 1.4 [P0][depends:none][I: 4 个 `*HistoryLoader.ts` + `sharedHistoryLoader.ts`][O: history loader 行为清单][V: 列出每个 loader 的 dedupe / fallback 行为] inventory 4 引擎 loader 行为。
- [x] 1.5 [P1][depends:1.3][I: adapter 接受的 legacy alias][O: 完整 alias 列表][V: alias 列表可以被 fixture 或 test table 引用] 整理 legacy alias 兼容清单。

## 2. Spec Drafting

- [x] 2.1 [P0][depends:1.1-1.4][I: inventory 输出][O: `specs/engine-runtime-contract/spec.md`][V: SHALL 条款 ≤ 30] 起草 engine runtime contract spec 并通过 `openspec validate --strict --no-interactive`。
- [x] 2.2 [P0][depends:2.1][I: spec 条款][O: spec 与现有测试的映射表][V: 每个 SHALL 条款关联至少一个现有或新增测试文件] 建立 spec ↔ 测试映射表。
- [x] 2.3 [P1][depends:2.1][I: spec 条款][O: documented gap list][V: 每个跨引擎未对齐项有明确说明] 列出 parity 未覆盖项。

## 3. Parity Test Gap-Fill

- [x] 3.1 [P0][depends:2.2][I: spec ↔ 测试映射][O: 补全的 parity tests][V: `realtimeAdapters.test.ts` 4 引擎覆盖对称] 补 adapter parity 测试缺口。
- [x] 3.2 [P0][depends:2.2][I: spec ↔ 测试映射][O: 补全的 history parity tests][V: `historyLoaders.test.ts` + `sharedHistoryLoader.test.ts` 4 引擎覆盖对称] 补 loader parity 测试缺口。
- [x] 3.3 [P0][depends:2.2][I: spec ↔ 测试映射][O: replay 等价测试][V: `realtimeReplayHarness.test.ts` 覆盖 history → realtime 收敛] 验证 history-realtime 收敛行为。
- [x] 3.4 [P1][depends:3.1,3.2,3.3][I: 新增测试输出][O: heavy-test-noise 通过][V: `npm run check:heavy-test-noise`] 确认 parity 测试静默。

## 4. CI Integration

- [ ] 4.1 [P0][depends:3.1-3.3][I: 新增测试][O: CI 三端通过][V: ubuntu/macos/windows runner 全绿] 验证三平台 CI parity，禁止 POSIX-only path / shell quoting / newline 假设。
- [x] 4.2 [P1][depends:2.1][I: spec][O: large-file gate 通过][V: `node --test scripts/check-large-files.test.mjs` + `npm run check:large-files:near-threshold` + `npm run check:large-files:gate`] 按 `.github/workflows/large-file-governance.yml` 等价执行 large-file governance sentry。

## 5. Governance Gates

- [x] 5.1 [P0][depends:3,4][I: 全部新增/触及代码][O: 前端 type/test 证据][V: `npm run typecheck` + `npm run test`] 跑前端基线。
- [x] 5.2 [P0][depends:3,4][I: realtime 测试][O: replay boundary 证据][V: `npm run perf:realtime:boundary-guard`] 跑 realtime boundary guard。
- [x] 5.3 [P0][depends:3.1,3.2][I: bridge 引用][O: runtime contract 证据][V: `npm run check:runtime-contracts`] 跑 runtime contracts 检查（若有 bridge 引用）。
- [x] 5.4 [P1][depends:3.4][I: 测试输出][O: heavy-noise 证据][V: `node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs` + `npm run check:heavy-test-noise`] 按 `.github/workflows/heavy-test-noise-sentry.yml` 等价执行 heavy-test-noise sentry。
- [x] 5.5 [P1][depends:4.2][I: 源/spec/fixture 文件][O: large-file 证据][V: `node --test scripts/check-large-files.test.mjs` + `npm run check:large-files:near-threshold` + `npm run check:large-files:gate`] 跑 large-file sentry。
- [x] 5.6 [P0][depends:5.1-5.5][I: 全部 artifact][O: strict 验证证据][V: `openspec validate formalize-engine-runtime-contract --strict --no-interactive`] OpenSpec strict validate。

## 6. Completion Review

- [x] 6.1 [P0][depends:5.6][I: validation 输出][O: residual risk 列表][V: 跳过的检查附原因与影响] 记录验证证据与残余风险。
- [x] 6.2 [P1][depends:6.1][I: 触及边界][O: follow-up backlog][V: 显式列出本 change 不做的 capability / cost / policy / domain event 工作] 列出后续 change 接力清单。
- [x] 6.3 [P0][depends:6.1][I: 提案对照][O: 范围未漂移说明][V: 与 `stabilize-core-runtime-and-realtime-contracts` 已交付证据无冲突] 校准本 change 与主干交付物的范围边界。

### Closure Notes

- 4.1 remains unchecked because this local closure pass cannot directly observe remote ubuntu/macos/windows CI runner results. Local equivalent gates and workflow wiring are recorded in `implementation-evidence.md`.
- This change is otherwise ready for archive after remote CI evidence is attached or the archive note explicitly records remote CI as externally verified.
