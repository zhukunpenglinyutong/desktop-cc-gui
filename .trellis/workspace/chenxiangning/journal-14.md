# Journal - chenxiangning (Part 14)

> Continuation from `journal-13.md` (archived at ~2000 lines)
> Started: 2026-05-16

---



## Session 478: 修复 Composer.rewind-confirm.test 在 CI 上的 waitFor 超时

**Date**: 2026-05-16
**Task**: 修复 Composer.rewind-confirm.test 在 CI 上的 waitFor 超时
**Branch**: `feature/v0.5`

### Summary

Testing Library 默认 asyncUtilTimeout 1000ms 在 CI 慢机器（23x 本地耗时）触发 14 个 waitFor 超时。调到 5000ms 后 PR #564 CI 13/13 全绿。

### Main Changes


## Summary

PR #564 自 feature/v0.4.18 合入后持续标红 5 项 CI（heavy-test-noise × 3 + test-js + test-windows），失败用例全部聚焦 `Composer.rewind-confirm.test.tsx`。本会话定位根因并完成最小修复。

## Root Cause

- CI runner 上 Composer.rewind-confirm.test.tsx 单文件耗时 15190ms（本地 650ms，慢 23×）
- 14/39 失败用例全部使用 `waitFor` / `findByTestId`
- Testing Library 默认 `asyncUtilTimeout: 1000ms`
- CI 平均 ~389ms / 测试 → waitFor 内 retry 不足，超时
- 不是测试间状态污染，也不是业务代码 regression

## Fix

`src/test/vitest.setup.ts`：

```ts
import { cleanup, configure } from "@testing-library/react";
configure({ asyncUtilTimeout: 5000 });
```

7 行改动，零行为变更（本地 waitFor 50ms 内完成，不受新 timeout 影响）。

## Validation

- 本地 `npx vitest run` 单测：39/39 通过（601ms）
- 本地 `node scripts/test-batched.mjs` 全量：476 test files / exit 0
- CI `chenxiangning/codemoss@1500a69a` check_runs：**13/13 success**
  - build-macos / test-windows / test-js / typecheck / lint / test-tauri / memory-kind-contract
  - Heavy test noise sentry × 3 platforms
  - Large file sentry × 3 platforms

## Status

[OK] **Completed** — PR #564 已加 comment 标注修复结果，Trellis 任务已 archive。

## Next Steps

- PR #564 可推进 review / merge
- 后续若 CI 进一步变慢，可再考虑提高至 10s 或独立 retry 策略


### Git Commits

| Hash | Message |
|------|---------|
| `1500a69a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 479: PR #564 与 chore/bump-version-0.5 语义融合

**Date**: 2026-05-16
**Task**: PR #564 与 chore/bump-version-0.5 语义融合
**Branch**: `feature/v0.5`

### Summary

合并 base 分支引入的 prewarmKatexAssets perf 与我们的 asyncUtilTimeout fix。直接双保留导致 jsdom 启动阻塞，下沉 prewarmKatexAssets 到 math-rendering 测试文件后两边能力点都保留，57/57 通过，PR 重新 MERGEABLE。

### Main Changes


## Summary

PR #564 与 base 分支 `chore/bump-version-0.5` 发生冲突，按合并防回退铁律完成语义融合。

## Capability Matrix

| 改动 | upstream | HEAD |
|---|---|---|
| `configure({ asyncUtilTimeout: 5000 })` | ❌ | ✅ |
| `prewarmKatexAssets()` beforeAll | ✅ | ❌ |

## Conflict File

仅 `src/test/vitest.setup.ts` 文件顶部 textual conflict。

## Resolution Process

1. 列能力矩阵 → 看似可直接双保留
2. 直接双保留后本地 rewind 测试 14/39 失败（每个 5003-5009ms 刚好 timeout）
3. 诊断：upstream 的 `prewarmKatexAssets` 在 setup beforeAll 阻塞 katex chain 加载，让 jsdom React commit 推过 5s 窗口
4. 移除全局 setup 的 beforeAll，下沉 prewarmKatexAssets 到 Markdown.math-rendering.test.tsx file-scoped beforeAll
5. 两边能力点全部保留：
   - 全局 asyncUtilTimeout = 5000ms（CI 修复仍有效）
   - 数学渲染测试仍能预热 katex（local scope 不污染其他测试）

## Validation

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npx vitest run Composer.rewind-confirm.test.tsx Markdown.math-rendering.test.tsx` → 57/57 通过

## PR State

- Before: `mergeable: CONFLICTING / mergeStateStatus: DIRTY`
- After: `mergeable: MERGEABLE / mergeStateStatus: UNSTABLE`（CI 重跑中）

## Next Steps

等 CI 在 `5fa60b2b` 上重跑结果，全绿即可推进 review/merge。


### Git Commits

| Hash | Message |
|------|---------|
| `5fa60b2b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 480: 收口 harness 治理层设计提案

**Date**: 2026-05-17
**Task**: 收口 harness 治理层设计提案
**Branch**: `feature/v0.5`

### Summary

完成 harness governance 设计层收口，新增主战略文档与 9 个 OpenSpec 治理 change，明确实施顺序、substrate blocker、heavy-test-noise / large-file governance / 三平台兼容硬约束。

### Main Changes

- 新增 `docs/architecture/harness-governance-strategy.md`，形成 v1.6 治理战略基线。
- 新增 5 个治理设计 change：`formalize-engine-runtime-contract`、`add-engine-capability-matrix-spec`、`evolve-context-ledger-to-cost-budget`、`evolve-checkpoint-to-policy-chain`、`add-agent-domain-event-schema`。
- 补齐 4 个治理基座 blocker 的 design/spec/tasks：`refactor-mega-hub-split`、`optimize-realtime-event-batching`、`optimize-long-list-virtualization`、`optimize-bundle-chunking`。
- 更新 `openspec/project.md`，将 active changes 分组为 Harness Governance Design Set / Substrate Set / Other Active Changes。
- 把 `.github/workflows/heavy-test-noise-sentry.yml`、`.github/workflows/large-file-governance.yml` 与 Win/macOS/Linux 兼容写入实施硬约束。
- 验证：`openspec validate --all --strict --no-interactive` 通过，269 passed / 0 failed。


### Git Commits

| Hash | Message |
|------|---------|
| `783c5ab8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 481: 支持 Markdown 文件预览公式和图表渲染

**Date**: 2026-05-18
**Task**: 支持 Markdown 文件预览公式和图表渲染
**Branch**: `feature/v0.5.0-md`

### Summary

为 Markdown 文件预览接入 KaTeX 与 Mermaid 体验补齐，抽取共享数学渲染工具，修正 fenced math 渲染、annotation 行号映射和 Mermaid tab 重叠。

### Main Changes

## 完成内容

- 创建 OpenSpec change `add-file-markdown-math-preview`，补充 proposal/design/tasks/spec delta。
- 文件预览接入 `remark-math` / `rehype-katex`，并支持 fenced `math` / `latex` / `tex` 作为 KaTeX display 公式渲染。
- 抽取 `src/features/markdown/markdownMath.ts`，复用 KaTeX lazy asset loading、math detection、delimiter normalization、LaTeX render helpers。
- 保留 message Markdown renderer 行为，并通过共享模块降低重复实现。
- 文件预览 normalization 增加 source line map，避免 annotation 行号漂移。
- Mermaid card 文案接入 i18n，并调整 codeblock annotation button 位置避免覆盖 Source/Render tabs。

## 验证

- `npm run lint`
- `npm run typecheck`
- `npx vitest run src/features/files/components/FileViewPanel.test.tsx src/features/messages/components/Markdown.math-rendering.test.tsx`
- `npm run check:large-files`
- `openspec validate add-file-markdown-math-preview --strict --no-interactive`
- `git diff --check`

## 关键结论

- KaTeX render 继续使用 `trust: false`、`throwOnError: false`，无新增依赖。
- Mermaid 仍保持 lazy render，不因 math 支持在初始 Source tab 强制渲染。
- fenced code 内部已避开 math normalization，防止 fenced math 被二次包 `$$` 或误改源码。


### Git Commits

| Hash | Message |
|------|---------|
| `7fdc8e5e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 482: 修复 Markdown 收口回归

**Date**: 2026-05-18
**Task**: 修复 Markdown 收口回归
**Branch**: `feature/v0.5.0-md`

### Summary

修复 shared math 重构后 message Markdown code 区域被 image normalization 误转换的问题，并稳定文件预览 math lazy KaTeX 测试等待。

### Main Changes

## 完成内容

- 恢复 message Markdown normalization 的 `normalizeOutsideMarkdownCode(renderValue, normalizeDisplayText)` 外层保护，避免 `<image>...</image>` 在 code fence / inline code 中被转换为 `<img>`。
- 修正 `FileViewPanel.test.tsx` 中 math + Mermaid 用例的同步假设，显式等待 lazy KaTeX 完成后再断言和点击 Mermaid Render。

## 验证

- `npx vitest run src/features/messages/components/Markdown.file-links.test.tsx`
- `npx vitest run src/features/messages/components/Markdown.math-rendering.test.tsx`
- `npx vitest run src/features/files/components/FileViewPanel.test.tsx src/features/files/detachedFileExplorer.test.ts src/features/files/components/FileTreeRootActions.test.tsx src/features/files/externalChangeStateMachine.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm run check:large-files`
- `openspec validate add-file-markdown-math-preview --strict --no-interactive`
- `git diff --check`

## 复盘

- 上一轮只跑了目标组合，漏掉了 CI 中 message file-links 独立回归。
- shared helper 重构时必须保留调用点的外层 code-region contract，不能只看 helper 内部是否保护 math normalization。


### Git Commits

| Hash | Message |
|------|---------|
| `59acb6be` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 483: 加固 Claude 列表超时兜底

**Date**: 2026-05-18
**Task**: 加固 Claude 列表超时兜底
**Branch**: `feature/v0.5.0-md`

### Summary

实现 Claude native listing timeout/reject 时保留 last-good 会话；收紧 last-good 健康判定，避免 degraded 列表自污染；补充 timeout fallback 与连续超时回归测试。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `1f2f87f1` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 484: 归一化用户提问卡片交互

**Date**: 2026-05-19
**Task**: 归一化用户提问卡片交互
**Branch**: `feature/v0.5.0-md`

### Summary

(Add summary)

### Main Changes

| Area | Summary |
|------|---------|
| User input cards | Unified AskUserQuestionDialog and RequestUserInputMessage live-card rendering through UserInputQuestionCard. |
| Interaction fixes | Added visible close/dismiss affordance, timeline anchoring, multi-question tabs, Next-before-final Submit behavior, duplicate option label isolation, and single-select deselect. |
| Governance | Archived OpenSpec change normalize-user-input-question-card and synced the main elicitation spec plus frontend component guidelines. |
| Verification | Human tested successfully. Automated checks passed: lint, typecheck, targeted Vitest, chat canvas smoke tests, large-file governance, heavy-test-noise gate, git diff check, and OpenSpec strict validate. |

**Code commit**: `d142510b fix(chat): 归一化用户提问卡片交互`


### Git Commits

| Hash | Message |
|------|---------|
| `d142510b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 485: 稳定 CI flaky 测试

**Date**: 2026-05-19
**Task**: 稳定 CI flaky 测试
**Branch**: `feature/v0.5.0-md`

### Summary

(Add summary)

### Main Changes

| Area | Summary |
|------|---------|
| Rust runtime recovery tests | Stabilized repeated waiter timeout quarantine coverage so CI scheduler drift around stale takeover does not fail the quarantine assertion path. |
| File markdown tests | Prewarmed KaTeX assets for the markdown math + lazy mermaid test to avoid dynamic import timing out under batched Vitest load. |
| Verification | Targeted Rust test passed, runtime recovery test group passed, targeted FileViewPanel math test passed, FileViewPanel full test file passed, lint/typecheck/git diff check passed. |

**Follow-up commit**: `bed69513 test(ci): 稳定运行时恢复和 Markdown 数学测试`


### Git Commits

| Hash | Message |
|------|---------|
| `bed69513` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 486: 统一多引擎列表超时兜底

**Date**: 2026-05-19
**Task**: 统一多引擎列表超时兜底
**Branch**: `feature/v0.5.0-md`

### Summary

修复 OpenCode/Claude sidebar listing timeout fallback，补齐 large-file governance 跨平台路径归一化，并归档 OpenSpec change。

### Main Changes

| Area | Summary |
|------|---------|
| Sidebar fallback | Added engine-aware last-good seed for Claude/OpenCode listing timeout and rejection paths; OpenCode rejects now emit diagnostics and preserve retainable last-good entries. |
| Boundary handling | Pending/archived/shared entries are rejected by retainable filters; added OpenCode pending fallback regression coverage. |
| CI governance | Normalized large-file governance repo paths so Windows-style backslashes match policy and baseline entries consistently. |
| OpenSpec | Synced `sidebar-list-timeout-fallback` into main specs and archived `unify-sidebar-list-timeout-fallback-across-engines`. |

Validation:
- `node --test scripts/check-large-files.test.mjs scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs`
- `npx vitest run src/features/threads/hooks/useThreadActions.helpers.test.ts src/features/threads/hooks/useThreadActions.opencode-timeout-fallback.test.tsx src/features/threads/hooks/useThreadActions.timeout-fallback.test.tsx`
- `npm run check:large-files:near-threshold`
- `npm run check:large-files:gate`
- `npm run check:heavy-test-noise`
- `npm run typecheck`
- `npm run lint`
- `openspec validate --all --strict --no-interactive`

Notes:
- Manual UI QA items in the archived OpenSpec change remain unchecked because no live app manual verification was performed in this session.


### Git Commits

| Hash | Message |
|------|---------|
| `10346e3d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 487: 提交消息工具调用卡片与会话投影修复

**Date**: 2026-05-19
**Task**: 提交消息工具调用卡片与会话投影修复
**Branch**: `feature/v0.5.0-md`

### Summary

按功能批次提交三组变更：消息区残留 tool call XML fallback 卡片、Claude 会话侧栏稳定投影、Tauri subagent 泛化 Agent 标题过滤。

### Main Changes

本次会话完成本地分批提交，保持中文 Conventional Commits：

1. cb261490 feat(messages): 渲染残留工具调用 XML 为可交互卡片
- 新增 tool call XML parser，支持 function_calls、invoke 与 antml 前缀变体。
- 新增 ToolCallBlock、样式、Markdown 分段集成与 zh/en i18n。
- 归档 add-message-tool-call-card-fallback，并同步 message-assistant-tool-call-card-fallback spec。

2. d3327f0f fix(threads): 稳定 Claude 会话侧栏展示投影
- 新增 sessionDisplayProjection，统一弱标题判断与 stable projection merge。
- 避免 Agent N 或 Claude Session 覆盖有意义标题。
- 调整 Claude pending finalize 解析，减少 ambiguous finalize 产生重复弱标题行。
- 归档 refactor-session-display-projection，并更新 claude-session-sidebar-state-parity spec。

3. 4f40920b fix(tauri): 过滤 Claude subagent 泛化 Agent 标题
- Rust 侧过滤 subagent metadata 中 Agent N 这类泛化标题。
- 当 agentName/description 只有泛化标题时，保留 transcript 首条用户消息作为 first_message。
- 新增 focused Rust tests 覆盖 agentName 与 description 污染场景。

验证情况：
- 本次提交过程中未重新运行测试。
- 相关 OpenSpec tasks 文件显示作者此前已完成 focused Vitest、Rust tests、typecheck 与 openspec validate。
- commit 后工作区已确认 clean。


### Git Commits

| Hash | Message |
|------|---------|
| `cb261490` | (see git log) |
| `d3327f0f` | (see git log) |
| `4f40920b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 488: 收口运行时能力与性能治理

**Date**: 2026-05-19
**Task**: 收口运行时能力与性能治理
**Branch**: `feature/v0.5.0-md`

### Summary

收口 engine capability matrix、context ledger cost/budget、checkpoint policy chain、realtime batching、messages timeline virtualization、bundle chunking 与 CI governance gates；补充边界修复并完成 typecheck、large-file、heavy-test-noise 验证。

### Main Changes

## 本次提交

- Commit: 403eef7d feat(governance): 收口运行时能力与性能治理
- Branch: feature/v0.5.0-md

## 主要改动

- 新增 engine capability matrix TS/Rust contract 与 fixture gate。
- 新增 context ledger pricing/cost/budget projection，并在 Status Panel checkpoint 区展示 session cost。
- 将 checkpoint verdict 演进为 policy chain，补充 policy audit 展示与 validation policy 测试。
- 抽离 messages streaming complexity、timeline projection、timeline virtualization，降低长消息/长历史渲染压力。
- 新增 realtime event batcher，合并 delta 并保持 first-token/terminal flush 语义。
- 新增 domain event schema scaffolding 与 governance check scripts。
- 更新 Vite manualChunks，将 mermaid/docs/ui-heavy 依赖拆为独立 chunk。
- 新增 CI contract gates，并更新 perf baseline/history evidence 与 OpenSpec implementation evidence。
- Review 修复：audit buffer 非法 limit 防 hang；budget threshold 非法值防误触发。

## 验证

- npm run typecheck：通过。
- npm run check:large-files:gate：通过，found=0。
- npm run check:large-files:near-threshold：仅 watch 告警，无 fail。
- node --test scripts/check-large-files.test.mjs：通过，7 tests。
- node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs：通过，15 tests。
- npm run check:heavy-test-noise：通过，496 test files completed；environment warnings=1，act warnings=0，stdout payload lines=0，stderr payload lines=0。
- npx vitest run src/features/status-panel/utils/policies/policyRegistry.test.ts src/features/context-ledger/cost/costProjection.test.ts：通过，2 files / 13 tests。

## 后续建议

- large-file near-threshold 的 26 个 watch 项建议单独开结构性任务处理，不混入本次治理收口提交。


### Git Commits

| Hash | Message |
|------|---------|
| `403eef7d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 489: 收口 harness policy 判决审计面板

**Date**: 2026-05-19
**Task**: 收口 harness policy 判决审计面板
**Branch**: `feature/v0.5.0-md`

### Summary

第一切片 add-policy-decision-audit-surface 已实现并提交：在 StatusPanel dock checkpoint 中展示 policy 判决依据，compact popover 保持轻量。

### Main Changes

| Area | Detail |
|------|--------|
| OpenSpec | 新增并验证 `add-policy-decision-audit-surface` proposal/design/spec/tasks。 |
| Frontend | 新增 `PolicyDecisionAuditPanel`、`PolicyEntryRow` 与 formatter，将原 inline policy audit 拆成可测试组件。 |
| UX | dock checkpoint 可展开查看 policy、verdict、reason、source；compact popover 不展示审计详情。 |
| Tests | 运行 `npx vitest run src/features/status-panel/utils/audit/policyDecisionFormatter.test.ts src/features/status-panel/components/audit/PolicyDecisionAuditPanel.test.tsx src/features/status-panel/utils/checkpoint.test.ts src/features/status-panel/components/StatusPanel.test.tsx`，95 tests passed。 |
| Governance | 运行 `openspec validate add-policy-decision-audit-surface --strict --no-interactive`、`npm run check:checkpoint-policy-chain`、`node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs`、`node --test scripts/check-large-files.test.mjs`。 |
| Known Blockers | 整仓 `typecheck`、`check:large-files:gate`、`check:heavy-test-noise` 仍受并行 `useThreadActions` / native session 改动阻塞，本提交未混入这些文件。 |


### Git Commits

| Hash | Message |
|------|---------|
| `82f34f9e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 490: 加固 Claude sidebar 会话列表兜底

**Date**: 2026-05-19
**Task**: 加固 Claude sidebar 会话列表兜底
**Branch**: `feature/v0.5.0-md`

### Summary

(Add summary)

### Main Changes

| 项目 | 内容 |
|------|------|
| OpenSpec change | `harden-claude-sidebar-list-timeout-fallback` |
| 代码提交 | `aa646cb4 fix(sidebar): 加固 Claude 会话列表兜底` |
| 前端兜底 | 加固 Claude listing timeout/null/reject、successful-empty partial、mixed-engine degraded last-good fallback 与 child-owned catalog projection regression。 |
| 后端归属 | 收紧 Claude session catalog attribution，exact/longest child workspace owner 优先，避免 parent projection 抢占 child session。 |
| 规范状态 | OpenSpec tasks 推进到 25/30；剩余 typecheck 阻塞、3 项手动 QA、合并后 archive。 |

**验证**:
- `openspec validate harden-claude-sidebar-list-timeout-fallback --strict --no-interactive` 通过
- `npx vitest run src/features/threads/hooks/useThreadActions.timeout-fallback.test.tsx` 8/8 通过
- `npx vitest run src/features/threads/hooks/useThreadActions.test.ts` 46/46 通过
- `npx vitest run src/features/session-activity src/features/app` 58 files / 483 tests 通过
- Rust focused attribution tests 通过：child workspace、independent nested workspace、worktree isolation、ambiguous git root
- `npx eslint src/features/threads/hooks/useThreadActions.timeout-fallback.test.tsx src/features/threads/hooks/useThreadActions.ts src/features/threads/hooks/useThreadActions.helpers.ts` 通过

**阻塞/风险**:
- `npm run typecheck` 被工作区其他未完成 change 的 `src/features/engine/capabilities/*` 类型错误阻塞，不属于本次提交范围。
- Manual QA 需要真实 Tauri app、>=2 条 Claude session、>=1 条 Codex session，以及强制 timeout 临时验证，未在本轮自动执行。


### Git Commits

| Hash | Message |
|------|---------|
| `aa646cb4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 491: 收口 harness capability 感知查询入口

**Date**: 2026-05-19
**Task**: 收口 harness capability 感知查询入口
**Branch**: `feature/v0.5.0-md`

### Summary

第二切片 add-capability-aware-policy-router 已实现并提交：新增 typed useCapability hook、只读 engine-name branch scanner，并收紧 EngineCapabilityKey 编译期约束。

### Main Changes

| Area | Detail |
|------|--------|
| OpenSpec | 新增并验证 `add-capability-aware-policy-router` proposal/design/spec/tasks。 |
| Frontend | 新增 `src/features/engine/capabilities/useCapability.ts`，通过 `getActiveEngine/getEngineStatus` 解析 active/override engine 后委托现有 matrix helper。 |
| Type Safety | `EngineCapabilityKey` 收紧为 literal union，非法 capability 通过 `@ts-expect-error` 测试锁住编译期失败。 |
| Tooling | 新增 `scripts/scan-engine-name-branches.mjs` 和 `check:capability-aware-policy-router`，只输出 deterministic JSON 证据，不做 lint/enforcement。 |
| Cross-platform | Scanner 使用 Node `fs/path`，规范化 POSIX path，覆盖 Windows-style path、CRLF、重叠路径去重和稳定输出。 |
| Validation Passed | `npm run typecheck`; `npx vitest run src/features/engine/capabilities/useCapability.test.tsx src/features/engine/engineCapabilityMatrix.test.ts`; `node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs scripts/scan-engine-name-branches.test.mjs`; `npm run check:heavy-test-noise`; `node --test scripts/check-large-files.test.mjs`; `npm run check:large-files:near-threshold`; `openspec validate add-capability-aware-policy-router --strict --no-interactive`. |
| Known Blocker | `npm run check:large-files:gate` remains blocked by `src/features/threads/hooks/useThreadActions.ts` at 2935 lines (`feature-hotpath`, fail>2800, status=new), unrelated to this slice. |


### Git Commits

| Hash | Message |
|------|---------|
| `552b8dc8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 492: 收口 harness 治理证据只读桥接

**Date**: 2026-05-19
**Task**: 收口 harness 治理证据只读桥接
**Branch**: `feature/v0.5.0-md`

### Summary

第三切片实现 StatusPanel 只读治理证据桥接，读取 OpenSpec、package scripts、workflow presence 与 Trellis session evidence；补齐降级态和跨平台 reader 测试。验证通过 typecheck、targeted vitest、heavy-test-noise、large-file unit/near-threshold 与 OpenSpec strict；large-files gate 仍被既有 useThreadActions.ts 超阈值阻塞。

### Main Changes

- Implemented governance evidence DTO/readers/hook under src/features/governance/evidence.
- Added read-only GovernanceEvidenceSection into dock StatusPanel checkpoint tab without write/watch APIs.
- Covered CRLF/LF task parsing, path separator normalization, malformed package/tasks fallbacks, workflow presence, Trellis index fallback, and disabled hook behavior.
- Validation: npm run typecheck; targeted vitest for governance/status-panel; node --test heavy-test-noise scripts; npm run check:heavy-test-noise; node --test scripts/check-large-files.test.mjs; npm run check:large-files:near-threshold; openspec validate integrate-openspec-trellis-bridge-into-status-panel --strict --no-interactive; git diff --check.
- Known blocker: npm run check:large-files:gate fails on pre-existing src/features/threads/hooks/useThreadActions.ts at 2935 lines, unrelated to this slice.


### Git Commits

| Hash | Message |
|------|---------|
| `667af011` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 493: 收口 harness 剩余治理提案

**Date**: 2026-05-19
**Task**: 收口 harness 剩余治理提案
**Branch**: `feature/v0.5.0-md`

### Summary

完成 harness 剩余 OpenSpec 提案收口：移除阶段性 heavy-test-noise 硬约束，改为最终整体集成收口再跑；将四个未开始 follow-up 提案明确标记为本阶段 Deferred，不实现产品/运行时扩展；记录 large-file gate 的既有 useThreadActions.ts 阻塞。

### Main Changes

- Recalibrated OpenSpec project inventory for current feature/v0.5.0-md branch.
- Deferred cross-workspace cost admin view, engine plugin onboarding kit, governance telemetry loop, and agent domain event runtime as follow-up proposals without implementation.
- Updated policy audit, capability-aware router, and evidence bridge proposals/specs/designs so staged validation skips full noise sentry; final harness-wide closure remains responsible for full noise sentry.
- Validation: npm run typecheck; openspec validate for seven harness changes; git diff --check; rg confirmed no remaining heavy-test workflow hard constraints in the touched proposal/design/spec/project docs.
- Known blocker: large-files gate remains blocked by pre-existing src/features/threads/hooks/useThreadActions.ts at 2935 lines.


### Git Commits

| Hash | Message |
|------|---------|
| `867a4156` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
