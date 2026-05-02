## Why

当前客户端已经具备 `Kanban task`、会话线程、runtime orchestration 与多引擎执行底座，但“AI 在后台替用户持续做事”这一层仍缺少可托付的执行中心。用户可以创建任务，却很难稳定回答四个关键问题：哪个任务正在跑、AI 正在做第几步、为什么卡住、现在能否接管或恢复。

随着 `Kanban` 已经开始承载 `autoStart / schedule / chain / threadId / lastResultSnapshot / execution` 等执行元数据，系统已经进入“任务规划”和“代理执行”开始相互挤压的阶段。如果继续把异步执行细节堆到 Kanban 卡片与列视图中，用户心智会混乱，产品也会失去可观测性与可恢复性。

## 目标与边界

### 目标

- 新增独立的 `Tasks / Agents 异步任务中心`，承接 AI 长任务、后台任务与代理执行的运行态观察与控制。
- 明确 `Kanban` 与 `Task Center` 的职责边界：
  - `Kanban` 负责 planning / prioritization / scheduling
  - `Task Center` 负责 execution / observation / intervention / recovery
- Phase 1 优先适配 `Codex`、`Claude Code` 与 `Gemini` 三类主引擎，让任务中心先覆盖当前最核心的用户执行路径。
- 为每个任务引入可追踪的 `Task Run` 概念，让一次任务可以拥有多次独立执行记录。
- 为同一 task definition 定义确定性的 active-run policy，避免 UI、调度器与恢复动作各自产生重复执行。
- 提供用户最关心的异步执行可见性：
  - current step
  - latest output
  - blocked reason
  - changed files / artifacts
  - retry / resume / cancel / open conversation
- 保持现有 Kanban 任务、线程与 runtime 行为兼容；未使用新中心的用户不得被迫改变当前工作流。

### 边界

- Phase 1 只做 desktop 内的任务执行中心，不引入云端 remote worker / remote agent fleet。
- Phase 1 不重做 Kanban 信息架构，不将 Kanban 替换为任务中心。
- Phase 1 只覆盖单客户端内发起和观测的 task run，不承诺跨设备实时同步。
- Phase 1 不要求所有 engine 立即支持完全一致的 run telemetry；首批 MUST 以 `Codex / Claude Code / Gemini` 为优先适配对象，其他引擎作为后续扩展。
- Phase 1 不把终端、git、审批流全部重构成新的任务系统；优先复用现有 thread / runtime / tool surfaces。
- Phase 1 同一 task definition 任一时刻最多只允许一个 active run；并发批处理、同任务多活执行与更复杂排队策略留到后续阶段。

## 非目标

- 不把任务中心做成通用项目管理 SaaS，不引入 assignee / sprint / burndown 等团队协作范式。
- 不把 Kanban 卡片本身升级成完整运行控制台。
- 不引入新的 LLM orchestration DSL 或复杂 agent graph editor。
- 不承诺一次性解决所有长任务失败原因分类；Phase 1 先覆盖前端可解释、可恢复的核心路径。

## What Changes

- 新增独立的 `Task Center` surface，用于展示运行中、等待确认、失败、已完成、可恢复的 task runs。
- 新增 `Task Run` 运行记录模型，将“任务定义”与“某次执行”拆开：
  - task definition 继续归属 Kanban / manual task source
  - task run 记录一次执行的生命周期、产物与诊断
- 首批 `Task Run` lifecycle、恢复动作与可观测性 contract 优先落在 `Codex / Claude Code / Gemini` 上，并保证三者在核心状态模型上尽量对齐。
- 在 Kanban 卡片中仅展示最近 run 摘要，而非把完整执行状态堆叠在卡片里。
- 统一异步任务状态表达：
  - queued
  - planning
  - running
  - waiting_input
  - blocked
  - failed
  - completed
  - canceled
- 提供最小控制动作：
  - open conversation
  - retry
  - resume
  - cancel
  - fork as new run
- 为同一 task 的 active run 提供确定性规则：
  - 已存在 active run 时不得静默生成第二条 active run
  - retry 仅针对已 settled run 创建 successor
  - fork new run 仅在无其他 active run 时可用
- 统一暴露执行可观测性：
  - plan snapshot
  - current step
  - latest model/tool output
  - startedAt / updatedAt / finishedAt
  - failure reason / blocked reason
  - artifacts summary
- 为现有 Kanban 任务补充“一对多 run 历史”接入路径，使 scheduled / chained / manual trigger 都能落到同一任务中心语义。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险/成本 | 结论 |
|---|---|---|---|---|
| A | 继续增强现有 Kanban，把 run 状态、流式输出、失败恢复都塞进卡片和 board | 复用现有入口，短期 UI 改动最少 | planning 与 execution 状态耦合，列状态与 run 状态混淆，board 复杂度快速失控 | 不采用 |
| B | 新增独立 `Task Center`，Kanban 只展示 run 摘要，任务定义与运行记录分层 | 心智清晰，可托付性强，后续更容易接入更多 agent/runtime telemetry | 需要新增 run model 与新的 surface | **采用** |
| C | 直接做完整 agent orchestration studio（graph / node / workflow editor） | 长期表达力最强 | 远超当前用户需求，实施面过大，容易做成半成品 | 本期不采用 |

## Capabilities

### New Capabilities

- `agent-task-center`: 任务运行中心的 surface、状态模型、过滤视图与控制动作。
- `agent-task-run-history`: 任务定义与执行记录分层，以及 run lifecycle / artifacts / diagnostics 的持久化与读取。

### Modified Capabilities

- `kanban-task-scheduling`: 调度任务触发后需要落入统一 task run 记录，而不是仅在 Kanban 内部维持薄 execution 状态。
- `kanban-task-chaining`: 链式任务自动续跑后需要产出独立 downstream run 记录，并可在任务中心追踪链路推进与阻塞原因。
- `runtime-orchestrator`: 需要向任务中心提供可消费的 runtime execution state / failure diagnostics，而不仅是 runtime pool 层面的资源状态。
- `workspace-session-catalog-projection`: 需要允许 task center 以 workspace 维度投影与聚合 task runs / linked conversations。

## 验收标准

- 用户 MUST 能从独立 surface 查看所有运行中、等待确认、失败、已完成的 task runs，而不必逐个打开线程排查。
- 同一 Kanban task MUST 支持多次 run 历史，且每次 run 都有稳定 runId 与独立状态。
- `Codex`、`Claude Code` 与 `Gemini` MUST 在 Phase 1 接入 task center 的统一 run lifecycle；若个别 telemetry 细节不同，也 MUST 保持相同的用户级状态语义。
- 用户 MUST 能看到每个 run 的：
  - plan snapshot
  - current step
  - latest output summary
  - startedAt / updatedAt / finishedAt
  - blocked / failure reason
  - artifacts summary
- Kanban 卡片 MUST 仅展示最近 run 的摘要状态，不得承载完整运行控制台语义。
- scheduled / chained / manual trigger 进入执行后 MUST 统一生成 task run 记录。
- 同一 task definition 若已存在 active run，系统 MUST 以可解释方式拒绝、复用或引导用户进入该 run，而不是静默创建第二条 active run。
- 用户在 run 失败或阻塞后 MUST 能执行至少一种恢复动作（retry / resume / open conversation）。
- 未使用 task center 的普通对话与普通 Kanban 浏览行为 MUST 保持兼容，不得强制改变。
- 质量门禁至少覆盖：
  - `openspec validate --all --strict --no-interactive`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test` 或相关 focused Vitest suites
  - 若涉及 backend storage / runtime contract，执行 `cargo test --manifest-path src-tauri/Cargo.toml`

## Impact

- Frontend:
  - `src/features/kanban/**`
  - `src/features/threads/**`
  - `src/features/layout/**`
  - 可能新增 `src/features/tasks/**` 或 `src/features/agents/**`
- Backend / storage:
  - task run persistence contract
  - runtime telemetry projection
  - workspace-scoped task run query surface
- Existing UX:
  - Kanban card summary
  - workspace/task navigation
  - conversation linkage and recovery actions
- Specs:
  - new `agent-task-center`
  - new `agent-task-run-history`
  - modified `kanban-task-scheduling`
  - modified `kanban-task-chaining`
  - modified `runtime-orchestrator`
  - modified `workspace-session-catalog-projection`
