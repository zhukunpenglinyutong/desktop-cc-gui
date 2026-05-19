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


## Session 494: 解除 useThreadActions 大文件门禁阻塞

**Date**: 2026-05-19
**Task**: 解除 useThreadActions 大文件门禁阻塞
**Branch**: `feature/v0.5.0-md`

### Summary

将 useThreadActions 中线程列表常量、cursor 编解码、catalog session normalize 和 engine count 纯逻辑抽到 useThreadActions.threadList.ts，使 useThreadActions.ts 从 2935 行降到 2748 行并通过 large-file gate；同步补勾 3 个 harness change 的 large-file gate 任务。

### Main Changes

- Extracted thread-list pure helpers from src/features/threads/hooks/useThreadActions.ts to src/features/threads/hooks/useThreadActions.threadList.ts without changing the hook public contract.
- Updated add-policy-decision-audit-surface, add-capability-aware-policy-router, and integrate-openspec-trellis-bridge-into-status-panel tasks to mark large-file gate unblocked.
- Validation: npm run typecheck; targeted vitest for useThreadActions helpers/listing/recovery/native bridges; npm run check:large-files:gate; npm run check:large-files:near-threshold; openspec validate for the three harness changes; git diff --check.
- Result: OpenSpec reports all three harness changes complete; near-threshold still reports watch warnings but no hard large-file failure.


### Git Commits

| Hash | Message |
|------|---------|
| `c382433f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 495: 拆分 useThreadActions 启动动作测试

**Date**: 2026-05-19
**Task**: 拆分 useThreadActions 启动动作测试
**Branch**: `feature/v0.5.0-md`

### Summary

将 useThreadActions.test.tsx 中 start/fork 动作测试拆到 useThreadActions.start-fork.test.tsx，使原测试文件从 2755 行降至 2433 行并退出 near-threshold watch 列表。

### Main Changes

- Moved startThread/forkThread behavior tests into src/features/threads/hooks/useThreadActions.start-fork.test.tsx.
- Kept production code unchanged and preserved independent service/global notice mocks in the new test file.
- Validation: npm run typecheck; targeted vitest for useThreadActions.test.tsx and useThreadActions.start-fork.test.tsx; npm run check:large-files:near-threshold; npm run check:large-files:gate; git diff --check.
- Result: near-threshold watch count dropped from 26 to 25; useThreadActions.test.tsx is now below the test-file warning threshold.


### Git Commits

| Hash | Message |
|------|---------|
| `5b1bafbd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 496: 拆分线程消息乐观渲染测试

**Date**: 2026-05-20
**Task**: 拆分线程消息乐观渲染测试
**Branch**: `feature/v0.5.0-md`

### Summary

将 useThreadMessaging.test.tsx 尾部 Codex 乐观用户消息、generated image placeholder、silent prompt 相关用例拆到 useThreadMessaging.optimistic-render.test.tsx；主测试文件从 2753 行降到 2483 行，large-file near-threshold watch 从 25 降到 24。验证通过：npm run typecheck；npx vitest run src/features/threads/hooks/useThreadMessaging.test.tsx src/features/threads/hooks/useThreadMessaging.optimistic-render.test.tsx；npx vitest run src/features/threads/hooks/useThreadMessaging*.test.tsx；npm run check:large-files:near-threshold；npm run check:large-files:gate；git diff --check。阶段性未跑 heavy-test-noise，按当前治理约定留到最终整体收口。

### Main Changes

完成第二个 threads hook 测试大文件切片治理：只移动测试用例，不改生产逻辑。新增 useThreadMessaging.optimistic-render.test.tsx 承接 Codex optimistic render/generated image/silent prompt 用例，原 useThreadMessaging.test.tsx 删除对应尾段重复内容。


### Git Commits

| Hash | Message |
|------|---------|
| `eef1f298` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 497: 拆分 Messages 推理与计划交接测试

**Date**: 2026-05-20
**Task**: 拆分 Messages 推理与计划交接测试
**Branch**: `feature/v0.5.0-md`

### Summary

将 Messages.test.tsx 中 Claude reasoning visibility 与 ExitPlanMode handoff 相关用例拆到 Messages.reasoning-exit-plan.test.tsx；主测试文件从 2915 行降到 2526 行，large-file near-threshold watch 从 24 降到 23。验证通过：npm run typecheck；npx vitest run src/features/messages/components/Messages.test.tsx src/features/messages/components/Messages.reasoning-exit-plan.test.tsx；npx vitest run src/features/messages/components/Messages*.test.tsx；npm run check:large-files:near-threshold；npm run check:large-files:gate；git diff --check。阶段性未跑 heavy-test-noise，按治理约定留到最终整体收口。

### Main Changes

完成 Messages 测试大文件治理切片：只移动测试用例，不改生产逻辑。新增 Messages.reasoning-exit-plan.test.tsx 承接 Claude reasoning visibility 和 ExitPlanMode handoff 用例，原 Messages.test.tsx 删除对应块。


### Git Commits

| Hash | Message |
|------|---------|
| `23c58d2b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 498: 拆分 Sidebar 会话文件夹测试

**Date**: 2026-05-20
**Task**: 拆分 Sidebar 会话文件夹测试
**Branch**: `feature/v0.5.0-md`

### Summary

将 Sidebar.test.tsx 尾部 workspace session folder 行为用例拆到 Sidebar.session-folders.test.tsx；主测试文件从 2911 行降到 2334 行，large-file near-threshold watch 从 23 降到 22。验证通过：npm run typecheck；npx vitest run src/features/app/components/Sidebar.test.tsx src/features/app/components/Sidebar.session-folders.test.tsx；npx vitest run src/features/app/components/Sidebar*.test.tsx；npm run check:large-files:near-threshold；npm run check:large-files:gate；git diff --check。阶段性未跑 heavy-test-noise，按治理约定留到最终整体收口。提交时未混入当前工作区已有 OpenSpec 归档/同步变更。

### Main Changes

完成 Sidebar 测试大文件治理切片：只移动测试用例，不改生产逻辑。新增 Sidebar.session-folders.test.tsx 承接 workspace session folder 创建、折叠、移动、删除、分页相关用例，原 Sidebar.test.tsx 删除对应尾段。


### Git Commits

| Hash | Message |
|------|---------|
| `ce539a2e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 499: 归档 harness 治理 OpenSpec 变更

**Date**: 2026-05-20
**Task**: 归档 harness 治理 OpenSpec 变更
**Branch**: `feature/v0.5.0-md`

### Summary

批量归档 9 个 harness governance OpenSpec change，同步 main specs，更新 openspec/project.md 库存，并修正 engine capability matrix fixture 的归档后引用路径。

### Main Changes

- Archived nine harness governance changes under `openspec/changes/archive/2026-05-20-*`.
- Synced main specs for engine runtime contract, engine capability matrix, context ledger cost budget, checkpoint policy chain, agent domain event schema/runtime, capability-aware policy router, governance telemetry loop, and policy decision audit surface.
- Updated `openspec/project.md` inventory to active=11, archive=316, specs=269 and recorded the external-CI qualifier for `formalize-engine-runtime-contract`.
- Added `openspec/docs/harness-governance-closure-report-2026-05-20.md`.
- Updated `src/features/engine/engineCapabilityMatrix.ts` and `scripts/check-engine-capability-matrix.mjs` to read matrix fixture from `openspec/specs/**` after archive.

Validation run before commit:
- `openspec validate --all --strict --no-interactive` -> 280 passed, 0 failed.
- `npm run check:engine-capability-matrix`
- `npm run check:context-ledger-cost-budget`
- `npm run check:checkpoint-policy-chain`
- `npm run check:agent-domain-event-schema`
- `npm run check:realtime-event-batching`
- `npm exec vitest run src/features/engine/engineCapabilityMatrix.test.ts`

Notes:
- Did not touch concurrent files work in `src/features/files/**`.


### Git Commits

| Hash | Message |
|------|---------|
| `92cefd0c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 500: 拆分 FileViewPanel 外部变更监控测试

**Date**: 2026-05-20
**Task**: 拆分 FileViewPanel 外部变更监控测试
**Branch**: `feature/v0.5.0-md`

### Summary

将 FileViewPanel.test.tsx 中 detached external change awareness 相关用例拆到 FileViewPanel.external-change.test.tsx；主测试文件从 2771 行降到 2429 行，large-file near-threshold watch 从 22 降到 21。验证通过：npm run typecheck；npx vitest run src/features/files/components/FileViewPanel.test.tsx src/features/files/components/FileViewPanel.external-change.test.tsx；npx vitest run src/features/files/components/FileViewPanel*.test.tsx；npm run check:large-files:near-threshold；npm run check:large-files:gate；git diff --check。阶段性未跑 heavy-test-noise，按治理约定留到最终整体收口。提交时未混入当前工作区已有 OpenSpec 归档/同步变更。

### Main Changes

完成 FileViewPanel 测试大文件治理切片：只移动测试用例，不改生产逻辑。新增 FileViewPanel.external-change.test.tsx 承接 detached external file change polling/watcher、Windows path-not-found 边界、dirty buffer conflict 相关用例，原 FileViewPanel.test.tsx 删除对应 describe 块。


### Git Commits

| Hash | Message |
|------|---------|
| `f9eeda35` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 501: 拆分 historyLoaders 回退测试

**Date**: 2026-05-20
**Task**: 拆分 historyLoaders 回退测试
**Branch**: `feature/v0.5.0-md`

### Summary

将 historyLoaders.test.ts 尾部 Claude file-change reconstruction、OpenCode missing payload fallback、Codex truncated local history fallback 用例拆到 historyLoaders.fallbacks.test.ts；主测试文件从 2687 行降到 2427 行，large-file near-threshold watch 从 21 降到 20。验证通过：npm run typecheck；npx vitest run src/features/threads/loaders/historyLoaders.test.ts src/features/threads/loaders/historyLoaders.fallbacks.test.ts；npx vitest run src/features/threads/loaders/*historyLoaders*.test.ts；npm run check:large-files:near-threshold；npm run check:large-files:gate；git diff --check。阶段性未跑 heavy-test-noise，按治理约定留到最终整体收口。

### Main Changes

完成 historyLoaders 测试大文件治理切片：只移动测试用例，不改生产逻辑。新增 historyLoaders.fallbacks.test.ts 承接 Claude file-change reconstruction、OpenCode fallback warnings、Codex truncated local history fallback 相关用例，原 historyLoaders.test.ts 删除对应尾段。


### Git Commits

| Hash | Message |
|------|---------|
| `f6de5b3e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 502: 拆分 useThreadsReducer 压缩生命周期测试

**Date**: 2026-05-20
**Task**: 拆分 useThreadsReducer 压缩生命周期测试
**Branch**: `feature/v0.5.0-md`

### Summary

将 useThreadsReducer.test.ts 中 context compaction lifecycle、local Codex compaction message reconcile 与非 tool output delta 相关用例拆到 useThreadsReducer.context-compaction.test.ts；主测试文件从 2681 行降到 2266 行，large-file near-threshold watch 从 20 降到 19。验证通过：npm run typecheck；npx vitest run src/features/threads/hooks/useThreadsReducer*.test.ts；npm run check:large-files:near-threshold；npm run check:large-files:gate；git diff --check。阶段性未跑 heavy-test-noise，按治理约定留到最终整体收口。

### Main Changes

完成 useThreadsReducer 测试大文件治理切片：只移动测试用例，不改生产逻辑。新增 useThreadsReducer.context-compaction.test.ts 承接 context compaction lifecycle 与本地 compaction 消息 reconcile 相关用例，原 useThreadsReducer.test.ts 删除对应块。


### Git Commits

| Hash | Message |
|------|---------|
| `98f9b5bd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 503: 拆分英文基础翻译分片

**Date**: 2026-05-20
**Task**: 拆分英文基础翻译分片
**Branch**: `feature/v0.5.0-md`

### Summary

将 en.part1.ts 中 common/app/searchPalette/tabbar/layout 基础 namespace 拆到 en.part1.base.ts，并在 en.ts 中按原顺序合并；en.part1.ts 从 2681 行降到 2569 行，large-file near-threshold watch 从 19 降到 18。验证通过：npm run typecheck；npx vitest run src/i18n/locales/canvasCopy.snapshot.test.ts src/i18n/locales/chatLocaleMerge.test.ts src/features/spec/specHubVisibleCopyKeys.test.ts src/features/spec/specHubLanguageSwitch.test.ts；npm run check:large-files:near-threshold；npm run check:large-files:gate；git diff --check。阶段性未跑 heavy-test-noise，按治理约定留到最终整体收口。

### Main Changes

完成 i18n 大文件治理切片：只移动英文静态翻译对象，不改 key/value。新增 en.part1.base.ts 承接 common/app/searchPalette/tabbar/layout，en.ts 保持合并顺序，原 en.part1.ts 删除对应 namespace。


### Git Commits

| Hash | Message |
|------|---------|
| `495bb867` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 504: 拆分线程动作加载职责

**Date**: 2026-05-20
**Task**: 拆分线程动作加载职责
**Branch**: `feature/v0.5.0-md`

### Summary

将 useThreadActions 的 older pagination、session catalog、history loading 状态拆成独立 hook；主 hotpath 文件从 2748 行降至 2392 行，large-file watch 从 18 降至 17。

### Main Changes

完成 harness 大文件治理下一切片：
- 拆出 useThreadActionsLoadOlder.ts，承接 loadOlderThreadsForWorkspace 的 catalog/runtime 分页、标题映射、归档过滤和 cursor 更新逻辑。
- 拆出 useThreadActionsSessionCatalog.ts，封装 workspace session catalog 的 active/archived 加载。
- 拆出 useThreadHistoryLoadingState.ts，隔离 history loading 状态机。
- useThreadActions.ts 保持对外返回 API 不变，行数从 2748 降至 2392，低于 feature-hotpath warn>2400 线。

验证：
- npm run typecheck
- npx vitest run src/features/threads/hooks/useThreadActions*.test.ts*
- npm run check:large-files:near-threshold
- npm run check:large-files:gate
- git diff --check

备注：
- heavy-test-noise-sentry 按阶段策略 deferred 到整体收口阶段。
- 未纳入未跟踪 OpenSpec 目录 openspec/changes/evolve-harness-governance-closed-loop/。


### Git Commits

| Hash | Message |
|------|---------|
| `58da5764` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 505: 拆分实时历史对齐调度

**Date**: 2026-05-20
**Task**: 拆分实时历史对齐调度
**Branch**: `feature/v0.5.0-md`

### Summary

将 useThreads 的 Codex/Claude realtime history reconcile 调度、timer cleanup、重复 turn 去重抽出为 useThreadRealtimeHistoryReconcile；useThreads.ts 从 2561 行降到 2306 行，large-file watch 从 17 降到 16。

### Main Changes

完成 harness 大文件治理下一切片：
- 新增 useThreadRealtimeHistoryReconcile.ts，封装 Codex/Claude turn completed 后的 realtime history reconcile 调度。
- 将 timer refs、去重 refs、retry delay、unmount cleanup 从 useThreads.ts 迁出。
- useThreads.ts 只保留事件入口 handleTurnCompletedForHistoryReconcile 的 hook 接线，对外 API 不变。
- useThreads.ts 从 2561 行降至 2306 行，低于 feature-hotpath warn>2400 线。

验证：
- npm run typecheck
- npx vitest run src/features/threads/hooks/useThreads*.test.tsx
- npm run check:large-files:near-threshold
- npm run check:large-files:gate
- git diff --check

备注：
- heavy-test-noise-sentry 继续按阶段策略 deferred 到整体收口阶段。
- 未纳入未跟踪 OpenSpec 目录 openspec/changes/evolve-harness-governance-closed-loop/。


### Git Commits

| Hash | Message |
|------|---------|
| `a22cba8d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 506: 拆分消息线程解析职责

**Date**: 2026-05-20
**Task**: 拆分消息线程解析职责
**Branch**: `feature/v0.5.0-md`

### Summary

将 useThreadMessaging 的 engine/thread resolution、thread kind 判断、start-for-send、Claude pending candidate rebind 抽出为 useThreadMessagingThreadResolution；useThreadMessaging.ts 从 2550 行降到 2366 行，large-file watch 从 16 降到 15。

### Main Changes

完成 harness 大文件治理下一切片：
- 新增 useThreadMessagingThreadResolution.ts，封装消息发送前的 engine/thread resolution、thread id compatibility、startThreadForMessageSend。
- 迁出 Claude pending native session confirmation 与 candidate transcript rebind 逻辑，并保留原 debug/error 行为。
- useThreadMessaging.ts 保留 send 主流程和对外 API，行数从 2550 降至 2366，低于 feature-hotpath warn>2400 线。

验证：
- npm run typecheck
- npx vitest run src/features/threads/hooks/useThreadMessaging*.test.tsx
- npm run check:large-files:near-threshold
- npm run check:large-files:gate
- git diff --check

备注：
- heavy-test-noise-sentry 继续按阶段策略 deferred 到整体收口阶段。
- 未纳入未跟踪 OpenSpec 目录 openspec/changes/evolve-harness-governance-closed-loop/。


### Git Commits

| Hash | Message |
|------|---------|
| `779c07b8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 507: 拆分事件诊断工具

**Date**: 2026-05-20
**Task**: 拆分事件诊断工具
**Branch**: `feature/v0.5.0-md`

### Summary

将 useThreadEventHandlers 的 turn diagnostics、execution item tracking、no-progress watchdog、server debug filter 等纯 helper 迁出为 threadEventDiagnostics；useThreadEventHandlers.ts 从 2482 行降到 2067 行，large-file watch 从 15 降到 14。

### Main Changes

完成 harness 大文件治理下一切片：
- 新增 threadEventDiagnostics.ts，承载 thread event diagnostics 的纯 helper、types、constants。
- useThreadEventHandlers.ts 只保留 hook 组装、event callbacks 与跨 hook 接线，行数从 2482 降至 2067。
- 保留 CODEX_TURN_NO_PROGRESS_STALL_MS 与 CODEX_EXECUTION_ACTIVE_NO_PROGRESS_STALL_MS 的旧模块 re-export，避免测试/调用方导入断裂。

验证：
- npm run typecheck
- npx vitest run src/features/threads/hooks/useThreadEventHandlers.test.ts src/features/threads/hooks/useThreadItemEvents.test.ts src/features/threads/hooks/useThreadTurnEvents.test.tsx
- npm run check:large-files:near-threshold
- npm run check:large-files:gate
- git diff --check

备注：
- heavy-test-noise-sentry 继续按阶段策略 deferred 到整体收口阶段。
- 未纳入未跟踪 OpenSpec 目录 openspec/changes/evolve-harness-governance-closed-loop/。


### Git Commits

| Hash | Message |
|------|---------|
| `c81c151c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 508: 拆分用户提问历史归一化

**Date**: 2026-05-20
**Task**: 拆分用户提问历史归一化
**Branch**: `feature/v0.5.0-md`

### Summary

将 threadItems.ts 中 AskUserQuestion 历史回答解析与 requestUserInputSubmitted 归一化抽出为 threadItemsAskUserQuestion；threadItems.ts 从 2416 行降到 2161 行，large-file watch 从 14 降到 13。

### Main Changes

完成 harness 大文件治理下一切片：
- 新增 threadItemsAskUserQuestion.ts，封装 AskUserQuestion answer echo 解析、模板解析、requestUserInputSubmitted 历史卡片生成。
- threadItems.ts 保留 prepareThreadItems 主流程，并通过新 util 调用 AskUserQuestion 归一化。
- threadItems.ts 从 2416 行降至 2161，低于 feature-hotpath warn>2400 线。

验证：
- npm run typecheck
- npx vitest run src/utils/threadItems.test.ts src/features/threads/loaders/claudeHistoryLoader.test.ts
- npm run check:large-files:near-threshold
- npm run check:large-files:gate
- git diff --check

备注：
- heavy-test-noise-sentry 继续按阶段策略 deferred 到整体收口阶段。
- 未纳入未跟踪 OpenSpec 目录 openspec/changes/evolve-harness-governance-closed-loop/。


### Git Commits

| Hash | Message |
|------|---------|
| `c0e1c765` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 509: 迁出 Git History 面板常量和类型

**Date**: 2026-05-20
**Task**: 迁出 Git History 面板常量和类型
**Branch**: `feature/v0.5.0-md`

### Summary

将 GitHistoryPanelProps 迁入 GitHistoryPanelTypes，将 PAGE_SIZE 迁为 GIT_HISTORY_PAGE_SIZE；GitHistoryPanelImpl.tsx 从 2408 行降到 2392 行，large-file watch 从 13 降到 12。

### Main Changes

完成 harness 大文件治理下一切片：
- 将 GitHistoryPanelProps 从 GitHistoryPanelImpl.tsx 迁入 GitHistoryPanelTypes.ts。
- 将 PAGE_SIZE 迁为 GitHistoryPanelImplHelpers.tsx 的 GIT_HISTORY_PAGE_SIZE。
- GitHistoryPanelImpl.tsx 从 2408 行降至 2392，低于 feature-hotpath warn>2400 线。

验证：
- npm run typecheck
- npx vitest run src/features/git-history/components/GitHistoryPanel.test.tsx src/features/git-history/components/git-history-panel/components/GitHistoryPanelPickers.test.tsx
- npm run check:large-files:near-threshold
- npm run check:large-files:gate
- git diff --check

备注：
- heavy-test-noise-sentry 继续按阶段策略 deferred 到整体收口阶段。
- 未纳入未跟踪 OpenSpec 目录 openspec/changes/evolve-harness-governance-closed-loop/。


### Git Commits

| Hash | Message |
|------|---------|
| `a41d5c1e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 510: 打通 harness 治理证据闭环

**Date**: 2026-05-20
**Task**: 打通 harness 治理证据闭环
**Branch**: `feature/v0.5.0-md`

### Summary

完成 evolve-harness-governance-closed-loop：新增治理证据桥、bridge-fed policies、domain event runtime subscribe-only surface、capability 首批迁移、gate/cost/capability evidence adapters、CI/conformance checks，并同步 governance-evidence-bridge 与 harness-governance-gate-consolidation 主 specs 后归档 OpenSpec change。

### Main Changes

本次会话完成 harness 治理闭环收口：

- 新增并加固 governance evidence bridge，统一 legacy governance evidence 与 harness evidence sources，提供冻结、确定性的 snapshot。
- 将 bridge snapshot 注入 checkpoint policy evidence，新增 OpenSpec / large-file / heavy-test-noise / realtime / capability / cost budget bridge-fed policies，并扩展 audit metadata。
- 增加 harness evidence adapters，覆盖 gate/cost/capability evidence，修复跨平台 path/id normalization、payload freeze、snapshot identity 与 heavy-test-noise advisory ceiling。
- 新增 domain event runtime 最小实现，application-facing surface 保持 subscribe-only，内部 emit 通过 controller 隔离。
- 首批 capability matrix 迁移覆盖 shared session 与 task run storage，scanner 从 317 降至 311，剩余 backlog 记录到 archived change。
- 新增 `check:governance-evidence-bridge` 并强化相关 conformance scripts / CI wiring。
- 同步两个新主 specs：`governance-evidence-bridge` 与 `harness-governance-gate-consolidation`。
- 归档 OpenSpec change 到 `openspec/changes/archive/2026-05-20-evolve-harness-governance-closed-loop/`。

验证：

- `npm run typecheck` 通过。
- targeted governance/status/domain/task/shared-session Vitest：14 files / 77 tests 通过。
- `npm run check:governance-evidence-bridge`、`check:checkpoint-policy-chain`、`check:engine-capability-matrix`、`check:context-ledger-cost-budget`、`check:agent-domain-event-schema` 通过。
- `npm run check:heavy-test-noise` 完整跑完 514 test files，repo-owned noise 为 0，environment warning 为 1。
- `node --test scripts/check-heavy-test-noise.test.mjs scripts/check-large-files.test.mjs` 15 tests 通过。
- `npm run check:large-files:near-threshold` 通过，报告既有 12 个 watch 项；`npm run check:large-files:gate` 通过，found=0。
- `npm run perf:realtime:boundary-guard` 通过。
- `openspec validate --all --strict --no-interactive` 归档后 282 passed, 0 failed。

残余风险：

- `npm run lint` exit 0，但仍有一个既有 `react-hooks/exhaustive-deps` warning：`src/features/threads/hooks/useThreadMessaging.ts:1718`，非本次改动。
- capability scanner 仍有 311 个 raw engine branch findings，已作为后续迁移 backlog 保留。
- Windows/Linux 兼容性通过 Node scripts/tests/CI matrix 约束，本地直接执行环境仍为 macOS。


### Git Commits

| Hash | Message |
|------|---------|
| `2eafb213` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
