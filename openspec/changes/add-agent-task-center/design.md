## Context

当前客户端已经同时具备三类相邻能力：

- `Kanban`：任务定义、优先级、列状态、调度与链式关系。
- `thread / runtime`：具体会话执行、引擎进程、恢复与诊断。
- `workspace projection`：按 workspace 聚合线程与会话目录。

问题在于这三层之间缺少一个稳定的“执行态中间层”。现状里部分执行信息散落在 Kanban 卡片、thread metadata、runtime state 与临时 UI 状态中，导致用户无法稳定回答“哪个任务正在运行、阻塞在哪、能否恢复、过去跑过几次”。

本设计新增 `Task Center` 作为独立执行层，但不替代 `Kanban`。它的职责是把任务定义与任务执行解耦，并为 `Codex / Claude Code / Gemini` 提供统一的 run-level 可观测性 contract。

约束：

- 必须兼容当前 `Kanban` 任务、thread、runtime 的存量数据与行为。
- 必须优先支持 `Codex / Claude Code / Gemini`，允许 engine-specific telemetry 降级，但用户级状态语义必须一致。
- 必须把实现约束明确写入 CI / cross-platform contract，避免只在 macOS 本机有效。

## Goals / Non-Goals

**Goals:**

- 定义独立的 `Task` 与 `TaskRun` 模型，允许一个任务拥有多次执行记录。
- 提供统一的 `TaskRunLifecycle`、恢复动作与 artifacts 视图。
- 明确 `Kanban`、`Task Center`、`thread`、`runtime orchestrator` 的边界。
- 让 scheduled / chained / manual trigger 都落到同一个 run contract。
- 为 `Codex / Claude Code / Gemini` 设计 Phase 1 统一适配层。
- 为同一 task definition 定义 deterministic 的 active-run policy，避免多入口重复执行。
- 把 `CI 门禁` 与 `macOS / Windows 兼容写法` 作为实现前置约束。

**Non-Goals:**

- 不重做 Kanban board，不把卡片扩展成完整控制台。
- 不引入 remote worker / distributed agent fleet。
- 不在 Phase 1 设计新的 agent graph / workflow DSL。
- 不要求所有引擎暴露完全一致的底层 telemetry 字段。

## Decisions

### 1. 采用 `Task Definition` 与 `Task Run` 分层，而不是继续把 execution 堆进 Kanban

#### 决策

引入两层模型：

- `TaskDefinition`
  - 代表“要做什么”
  - 主要来源于 Kanban task 或后续其他 task source
- `TaskRun`
  - 代表“某次具体执行”
  - 负责生命周期、诊断、恢复与产物

建议的 Phase 1 字段：

```ts
type TaskDefinitionRef = {
  taskId: string;
  source: 'kanban';
  workspaceId: string;
  threadAffinity?: 'same_thread' | 'new_thread' | 'auto';
};

type TaskRunStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'waiting_input'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'canceled';

type TaskRunTrigger =
  | 'manual'
  | 'scheduled'
  | 'chained'
  | 'retry'
  | 'resume'
  | 'forked';

type TaskRunArtifact = {
  kind: 'message' | 'file' | 'patch' | 'command' | 'summary' | 'link';
  label: string;
  ref?: string;
  summary?: string;
};

type TaskRunRecoveryAction =
  | 'open_conversation'
  | 'retry'
  | 'resume'
  | 'cancel'
  | 'fork_new_run';

type TaskRunRecord = {
  runId: string;
  task: TaskDefinitionRef;
  engine: 'codex' | 'claude_code' | 'gemini';
  status: TaskRunStatus;
  trigger: TaskRunTrigger;
  linkedThreadId?: string;
  parentRunId?: string;
  upstreamRunId?: string;
  planSnapshot?: string;
  currentStep?: string;
  latestOutputSummary?: string;
  blockedReason?: string;
  failureReason?: string;
  artifacts: TaskRunArtifact[];
  availableRecoveryActions: TaskRunRecoveryAction[];
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
};
```

#### 原因

- `Kanban` 的列状态表达“任务业务状态”，不是“某次执行运行态”。
- scheduled / chained / retry 本质上都可能对应新的执行尝试，必须有独立 runId。
- run 分层后，UI 才能稳定支持历史、恢复、比较与定位。

#### 备选方案

- 继续在 Kanban task 上追加 `lastExecution` / `executionHistory`：会继续混淆 task state 与 run state，不采用。

### 2. `Task Center` 作为独立 surface，Kanban 只显示 run 摘要

#### 决策

- 新增独立 `Task Center` 列表与详情面板。
- `Kanban` 卡片只保留最近一次 run 摘要：
  - 当前状态
  - 最近更新时间
  - 阻塞/失败短摘要
  - 进入 Task Center 的入口

`Task Center` Phase 1 UI 至少包含：

- run list
- engine / status / workspace filters
- detail panel
- linked conversation jump
- retry / resume / cancel / fork actions

#### 原因

- `Kanban` 负责 planning，不应该承载流式输出、运行步骤、恢复动作等高频执行态。
- `Task Center` 可以在不污染 Kanban 心智的情况下扩展更多异步执行能力。

#### 备选方案

- 在 Kanban board 内增加 expandable execution console：短期看省 UI，长期复杂度失控，不采用。

### 3. 统一 `TaskRunLifecycle`，允许 engine-specific telemetry 降级

#### 决策

对 `Codex / Claude Code / Gemini` 定义统一用户态生命周期：

- `queued`
- `planning`
- `running`
- `waiting_input`
- `blocked`
- `failed`
- `completed`
- `canceled`

同时定义统一投影 contract：

- `planSnapshot`
- `currentStep`
- `latestOutputSummary`
- `blockedReason`
- `failureReason`
- `artifacts[]`
- `linkedThreadId`

引擎适配层规则：

- 如果某引擎没有显式 step telemetry，允许退化为阶段性摘要。
- 如果某引擎不能稳定区分 `blocked` 与 `waiting_input`，适配层必须基于现有 thread/runtime signal 做用户态分类，而不是暴露原始 provider 噪音。

#### 原因

- 用户关心的是可恢复与可解释，不是底层 provider event 名称。
- 统一状态模型可以避免后续 UI 为每个引擎单独分叉。

#### 备选方案

- 完全保留 provider 原生状态：会让 UI 与逻辑变成 provider-specific，不采用。

### 4. run 持久化采用“独立 run store + 投影回 Kanban / workspace”

#### 决策

新增独立 task run persistence，而不是直接把完整 run history 塞进 Kanban task JSON。

推荐结构：

- `task definitions` 继续保留在原 Kanban storage
- `task run records` 写入独立 store
- `kanban projection` 只回填最近 run 摘要字段
- `workspace projection` 支持按 workspace / engine / status 聚合 run list

#### 原因

- run 数据天然增长快，和 task definition 的修改频率不同。
- 独立 store 更适合做历史查询、分页、失败恢复与后续 archive。

#### 备选方案

- 全量嵌入 task JSON：历史膨胀、并发写冲突概率更高，不采用。

### 5. 调度与链式任务统一生成新 run，不复用旧 run 行，并在 Phase 1 保持单任务单 active run

#### 决策

- 同一 `TaskDefinition` 在 Phase 1 任一时刻最多只允许一个 active run（`queued / planning / running / waiting_input / blocked`）
- manual trigger -> 仅在不存在 active run 时新建 run；若已有 active run，系统必须返回 deterministic blocked / focus-existing 结果
- scheduled trigger -> 仅在不存在 active run 时新建 run
- chained downstream trigger -> 新建 run，并记录 `upstreamRunId`
- retry -> 仅针对 settled run 新建 successor run，并记录 `parentRunId`
- resume -> 优先恢复原 run；若底层引擎只能重新进入执行，则允许创建 successor run，并显式标记来源为 `resume`
- fork new run -> 仅在不存在其他 active run 时允许创建新的 `forked` run

#### 原因

- run 是一次执行尝试，必须具备稳定审计语义。
- retry / downstream continuation 都需要独立失败与产物记录。
- 如果不提前收紧 active-run policy，Kanban、scheduler、Task Center action 与 runtime recovery 会各自发明并发语义。

#### 备选方案

- 在原 run 上原地改状态：会丢失执行历史，不采用。

### 6. `Task Center` 与 `thread / runtime / workspace projection` 的边界采用单向投影

#### 决策

- `thread` 仍然是对话与流式输出的事实源。
- `runtime orchestrator` 仍然是引擎 runtime 生命周期的事实源。
- `Task Center` 不直接控制 runtime pool，只消费 runtime 与 thread 的执行信号并生成 run projection。
- `workspace session catalog projection` 负责聚合 workspace 级入口，但不保存 run 真值。

单向关系：

- runtime/thread event -> run projection update
- run summary -> kanban card / workspace surfaces
- Task Center action -> 调用既有 thread/runtime command，再等待 run state 回流

#### 原因

- 避免出现第二套 runtime 真值或第二套 thread 真值。
- 降低 cross-layer 竞态与数据分叉风险。

#### 备选方案

- 让 Task Center 直接成为执行主控制器：改动面太大，本期不采用。

### 7. 把 `CI 门禁` 定义成 change-level 强约束，而不是实现后补测

#### 决策

本 change 后续落地必须满足以下 CI gate：

- `openspec validate --all --strict --no-interactive`
- `npm run lint`
- `npm run typecheck`
- `npm run test`，或最小等价 focused suites
- 涉及 frontend 行为变更时，至少覆盖 Task Center / Kanban integration tests
- 涉及 runtime / storage / tauri contract 时，执行：
  - `npm run check:runtime-contracts`
  - `npm run doctor:strict`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
- 涉及大文件或样式增量时，执行：
  - `npm run check:large-files`

同时要求 CI 中不得仅依赖 macOS 单平台验证；至少要保证：

- TypeScript / unit tests 在通用 Node 环境通过
- 若引入 OS-sensitive path/process logic，必须有 Windows coverage 或等价 contract test

#### 原因

- 这个能力横跨 frontend / storage / runtime / workspace projection，纯本地手测不够。
- 若不提前约束 CI，跨引擎和跨平台行为很容易在后期变成“本机可用”。

### 8. Phase 1 的实现必须使用 macOS / Windows 兼容写法

#### 决策

后续实现必须遵守：

- 路径拼接统一使用 shared path helpers，不得手写 `'/'` 或假设 POSIX path。
- 进程 / runtime 标识不得依赖 macOS 专有命令输出格式。
- 文件名、排序、大小写比较不得假设大小写敏感文件系统。
- 时间、shell、命令调用必须通过现有 service / Tauri backend 统一封装，不在 frontend 内写死平台分支。
- 若需要 provider command / process diagnostics：
  - 优先返回结构化字段
  - 不让 UI 直接解析 shell stdout
- snapshot / tests 中不得写死 macOS 路径样式，如 `/Users/...`
- 对外 spec / contract 描述统一使用 `workspace-relative` / normalized path 语义

#### 原因

- 当前目标引擎运行时天然涉及 shell、文件、进程、路径，最容易出现 macOS 优先实现再回补 Windows 的问题。
- 先写进 design，能强制后续实现从 contract 层避免平台债。

## Risks / Trade-offs

- [Risk] run store 与 Kanban task summary 双写可能出现投影延迟
  → Mitigation：坚持“run store 为真值，Kanban 只存最近摘要”，并为 summary 加 `updatedAt` 与 idempotent projection。

- [Risk] 三引擎 telemetry 粒度差异导致状态映射不一致
  → Mitigation：先定义用户态统一 lifecycle，允许 engine adapter 在 provider-specific signal 上做归一化。

- [Risk] retry / resume 语义容易混淆
  → Mitigation：在 model 中分开 `parentRunId` 与 `resume` trigger，并在 UI 上明确“恢复当前 run”与“以新 run 重试”。

- [Risk] 同一 task 被多入口重复触发，产生多条 active run
  → Mitigation：Phase 1 统一收口为“单任务单 active run”，并在 action / scheduler / retry path 全部复用同一 eligibility guard。

- [Risk] `Task Center` 与 `workspace session projection` 可能出现重复入口
  → Mitigation：workspace surface 只展示摘要与跳转，不复制完整 run detail。

- [Risk] Windows 上 runtime / shell 诊断字段不稳定
  → Mitigation：要求 backend 输出结构化 telemetry，并为 Windows-sensitive path 增加 contract tests。

- [Risk] 新增独立 surface 会拉长首版实现周期
  → Mitigation：Phase 1 先做 list + detail + recovery actions，不做复杂分组、批量操作、analytics。

## Migration Plan

1. 定义 `TaskRun` model、storage contract 与 projection interfaces。
2. 为 `Kanban` scheduled / chained / manual trigger 接入统一 run creation path，并加上 single-active-run eligibility guard。
3. 为 `Codex / Claude Code / Gemini` 补充 engine adapter，把 thread/runtime signal 投影成统一 run lifecycle。
4. 新增 `Task Center` surface，并接入 workspace-scoped run queries 与 run-level diagnostics。
5. 在 Kanban 卡片与 workspace surface 回填最近 run 摘要。
6. 补齐 focused tests、runtime contract tests、Windows-sensitive contract coverage。
7. 通过 CI gate 后再开放为默认 visible UX。

回滚策略：

- 若 `Task Center` surface 不稳定，可隐藏入口并保留底层 run store，不影响 Kanban 原有任务定义。
- 若 run projection 存在问题，可临时回退为只展示最近 run 摘要，不开放历史与恢复动作。

## Open Questions

- `Gemini` 当前可稳定获取的执行 telemetry 粒度是否足够区分 `blocked` 与 `waiting_input`？
- `resume` 在三引擎上的真实能力差异有多大，是否需要 provider capability flag？
- run store 是否需要按 workspace 分桶，还是先走单一 store + query index？
- Task Center 是否需要在 Phase 1 直接暴露 artifacts diff / changed files，还是先只展示 summary 与 links？
