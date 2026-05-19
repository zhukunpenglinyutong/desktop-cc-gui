## 0. Branch Calibration

Current branch source of truth: `feature/v0.5.0-md`.

Closure recalibration on 2026-05-20 confirmed current-branch implementation evidence is present for domain event types, pure factories, derivation fixtures, checker wiring, reducer non-integration guard, and OpenSpec validation. Prior `feature/v0.5` evidence remains non-authoritative; the authoritative evidence for this branch is the current `implementation-evidence.md`, current code facts, and the validation commands recorded below.

## 1. Schema Type Layer

- [x] 1.1 [P0][depends:none][I: 10 个事件名][O: `src/features/threads/domain-events/eventTypes.ts`][V: Readonly type union；type 字段 literal] 定义 DomainEvent type union。
- [x] 1.2 [P0][depends:1.1][I: 共同字段][O: `events/session.ts` / `turn.ts` / `message.ts` / `tool.ts` / `usage.ts`][V: 每文件按 domain 拆分；不超阈值] 拆分 per-domain 文件。
- [x] 1.3 [P0][depends:1.1,1.2][I: type union][O: type-level 单测][V: type 测试断言每个事件 type 字段为 literal] 类型层单测。

## 2. Pure Event Factory

- [x] 2.1 [P0][depends:1.1,1.2][I: type 定义][O: `eventFactories.ts` 每事件一 factory][V: factory 输入完备、无 I/O、无默认 clock] 实现 pure factory。
- [x] 2.2 [P0][depends:2.1][I: factory][O: dev mode `Object.freeze` 抽样][V: dev 下尝试 mutation 抛错；prod 不 freeze] dev mode freeze 抽样。
- [x] 2.3 [P0][depends:2.1][I: factory][O: `eventFactories.test.ts`][V: immutability + 必备字段 + factory 不默认 `occurredAt` 全覆盖] factory 单测。

## 3. Reducer Derivation Fixtures

- [x] 3.1 [P0][depends:2.1][I: `useThreadsReducer*` 现有 mutation][O: 10 类事件各至少 1 个 derivation fixture][V: pure function `(prevState, nextState) → DomainEvent | null` 推导] 实现 derivation fixtures。
- [x] 3.2 [P0][depends:3.1][I: derivation 函数][O: 单测][V: 每个事件类型有至少一个 reducer mutation 场景断言] derivation 单测。
- [x] 3.3 [P0][depends:3.1][I: 现有 reducer 测试][O: 0 regression 证据][V: 现有 reducer 单测全部通过] reducer 行为 0 regression。
- [x] 3.4 [P0][depends:3.1][I: reducer 模块文件][O: reducer 实现未改动][V: diff 检查；reducer 模块未引入 factory 调用] 验证 reducer runtime 未触碰。

## 4. Spec & CI

- [x] 4.1 [P0][depends:1-3][I: 已实现 schema + factory][O: `specs/agent-domain-event-schema/spec.md`][V: SHALL 条款 ≤ 25] 起草 spec。
- [x] 4.2 [P0][depends:4.1][I: type / factory / derivation][O: `scripts/check-agent-domain-event-schema.mjs`][V: 包含 type immutability / factory / derivation 三类断言] 新增 parity check 脚本。
- [x] 4.3 [P0][depends:4.2][I: package.json][O: `npm run check:agent-domain-event-schema`][V: 本地与 CI 入口一致] 接入 npm script。
- [x] 4.4 [P0][depends:4.3][I: CI workflow][O: 三平台接入][V: ubuntu/macos/windows 等价执行] CI 三端接入。

## 5. Governance Gates

- [x] 5.1 [P0][depends:1-4][I: 全部新增代码][O: 前端基线][V: `npm run typecheck` + `npm run test`] 前端基线。
- [x] 5.2 [P0][depends:4][I: parity check][O: schema 证据][V: `npm run check:agent-domain-event-schema`] schema 检查。
- [x] 5.3 [P0][depends:3.3][I: 现有 reducer 测试][O: 0 regression 证据][V: 现有断言全部通过] reducer 0 regression。
- [x] 5.4 [P1][depends:1-4][I: 测试输出][O: heavy-noise 证据][V: `npm run check:heavy-test-noise`] heavy-test-noise sentry。
- [x] 5.5 [P1][depends:1-4][I: 源文件大小][O: large-file 证据][V: `npm run check:large-files:gate`] large-file sentry。
- [x] 5.6 [P0][depends:5.1-5.5][I: 全部 artifact][O: strict 验证][V: `openspec validate add-agent-domain-event-schema --strict --no-interactive`] OpenSpec strict validate。

## 6. Completion Review

- [x] 6.1 [P0][depends:5.6][I: validation 输出][O: residual risk 列表][V: 跳过的检查附原因] 记录证据与残余风险。
- [x] 6.2 [P1][depends:6.1][I: 触及边界][O: follow-up backlog][V: ring buffer / subscription / EventBus / persistent audit trail / session-activity 迁移 显式列入] 列出后续 change 接力清单。
- [x] 6.3 [P0][depends:6.1][I: reducer runtime][O: 0 接入证据][V: reducer 模块未引入 factory 调用] 验证 runtime 未触碰。
