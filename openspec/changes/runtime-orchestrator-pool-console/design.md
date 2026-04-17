## Context

当前客户端的 runtime 行为由多个路径分别驱动：

- `useWorkspaceRestore` 会在启动后恢复 active 和 sidebar 可见的 workspace，并对未连接 workspace 执行 connect。
- `connect_workspace_core` 当前会直接 spawn Codex session，并把结果塞进 `sessions` map。
- app exit 只覆盖了一部分 runtime 清理路径，Codex 与 Claude 的生命周期治理并不一致。
- Windows 下 `.cmd -> cmd.exe -> node -> sandbox` 的包装链进一步放大了 orphan process 与观测混乱的问题。

这导致三个结构性后果：

1. “workspace 恢复”与“runtime 必须存在”被错误绑定。
2. 生命周期语义分散在 frontend hook、workspace command、engine runtime、exit path 里，无法形成统一幂等。
3. 用户看不到池状态，也没有人工止血入口。

本设计要把 runtime 从“隐式副作用”拉正为“显式资源”，由统一 Orchestrator 调度，并通过设置页控制台暴露最小但关键的观测与操作面。

## Goals / Non-Goals

**Goals:**

- 建立统一的 runtime registry、state machine、lease source 和 budget 模型。
- 让 `connect / ensure / restore / exit / orphan sweep` 共享同一套生命周期语义。
- 将默认 `Codex` 行为从 per-workspace 常驻改为 budgeted pool。
- 提供 `Runtime Pool Console` 作为用户可见的观测与干预入口。
- 三阶段推进，确保可以先止血再演进，不要求一次性大爆改。

**Non-Goals:**

- 不把所有 engine 在首期就改成完全一致的执行内部实现。
- 不改 thread / conversation 数据模型本身。
- 不实现一个系统级多进程管理器或替代 OS task manager。
- 不支持同 workspace 的同 engine 多实例并行常驻。

## Decisions

### Decision 1: 引入三层模型，而不是继续把 workspace 和 process 直接绑定

采用三层模型：

- `Workspace Intent Layer`
  - `idle / visible / selected / recently-used / active-turn / pinned`
- `Engine Session Layer`
  - logical session / thread 绑定信息，可存在但不要求有 OS process
- `Process Runtime Layer`
  - 实际子进程，由 Orchestrator 统一 spawn / supervise / kill / sweep

原因：

- 用户展开 sidebar 只是 UI intent，不代表值得常驻后台进程。
- session 元数据与 process 生命周期必须解耦，才能支持 budget 和 TTL。

备选方案：

- 继续沿用 workspace = session = process
  - 优点：简单
  - 缺点：无法解决进程数膨胀和退出清理断裂

### Decision 2: 统一 runtime 状态机，并将 `(engine, workspace)` 作为唯一实例键

每个 runtime 使用统一状态：

- `Absent`
- `Starting`
- `Ready`
- `Busy`
- `CoolingDown`
- `Stopping`
- `Failed`
- `ZombieSuspected`

约束：

- 同一 `(engine, workspace)` 同时最多一个有效 runtime
- `ensureRuntimeReady` 必须幂等
- 替换流程必须是：
  - spawn new
  - wait ready
  - swap registry binding
  - graceful stop old
  - timeout hard kill old

原因：

- 这是消除“新 session 覆盖旧 handle，旧进程却没死”的唯一可靠方式。

备选方案：

- 只在 `connect` 前做一次 `contains_key` 判断
  - 缺点：覆盖不了 race、partial restart、reload、stale handle 替换场景

### Decision 3: `Codex` 首期采用 `Hot / Warm / Cold / Pinned` 池化模型

定义：

- `Hot`
  - 当前 active workspace 或 active turn
- `Warm`
  - 最近使用过，短时保活
- `Cold`
  - 无 process，仅保留 logical session / metadata
- `Pinned`
  - 用户手动固定保活

默认预算：

- `max_hot_codex = 1`
- `max_warm_codex = 1`
- `warm_ttl_seconds = 90`

驱逐原则：

- 预算超限时，先驱逐 `Warm` 中最久未使用且无 active turn 的 runtime
- `Pinned` 不参与普通驱逐，但仍受全局硬上限保护

原因：

- 这能把 runtime 数从“随 workspace 数量增长”切换为“随当前活跃度增长”。

备选方案：

- 只引入 `idle TTL`，不引入 pool 分层
  - 缺点：缺乏显式优先级，难支撑控制台解释和手动干预

### Decision 4: 启动恢复策略改为 `restore UI != restore runtime`

新规则：

- 启动时恢复 workspace/thread metadata
- active workspace 可触发 lazy `ensureRuntimeReady`
- 非 active visible workspace 仅恢复 thread list，不自动 connect runtime
- send/resume/new-thread/需要 runtime 的控制面板操作才触发 acquire

原因：

- 这是切断“visible workspace 数量 -> runtime 数量”线性关系的关键。

备选方案：

- 保留现有 visible workspace 批量 connect，再靠后台 TTL 回收
  - 缺点：启动瞬时风暴仍存在，老机器仍会先卡一下

### Decision 5: 统一 ShutdownCoordinator 与 orphan sweep

新增 `ShutdownCoordinator`：

- app exit 时：
  - block new runtime acquire
  - gather all managed runtimes
  - graceful stop
  - timeout hard kill
  - persist cleanup result

新增 runtime ledger：

- `runtime_id`
- `workspace_id`
- `engine`
- `pid`
- `wrapper_kind`
- `started_at`
- `last_used_at`
- `lease_sources`

新增 orphan sweep：

- app next launch 时读取 ledger
- 识别上一轮未干净退出的 managed runtime
- 执行 tree-safe cleanup
- 将结果写入 diagnostics

原因：

- 仅靠一次 `ExitRequested` best-effort 不足以应对崩溃、WebView 异常或 Windows 包装链。

备选方案：

- 仅在 exit path 补 Codex kill
  - 缺点：无法处理异常退出与历史残留

### Decision 6: Windows 上统一 process-tree termination primitive

将现有 Claude 的 tree-safe termination 思路推广到 managed runtime：

- Windows：
  - 统一采用 tree-aware kill 语义
- Unix：
  - 统一采用 process-group kill 语义

要求：

- 不允许不同 engine 各自发明一套不兼容清理逻辑
- `wrapper_kind`、`resolved_bin`、`pid` 必须进入 diagnostics

原因：

- 用户看到的是 `cmd/node/sandbox` 链，不是抽象 session；清理必须对准进程树。

### Decision 7: 新增 `Runtime Pool Console`，作为 Orchestrator 的可观测与干预面

设置面板新增 `Runtime Pool Console`：

- Summary
  - 总 runtime 数
  - 各 engine runtime 数
  - 预算值
  - orphan sweep / force kill 计数
- Runtime rows
  - workspace
  - engine
  - state
  - pid / wrapper kind
  - startedAt / lastUsedAt
  - lease source
  - pinned
  - actions: close / release-to-cold / pin / unpin
- Config
  - `Codex Hot 上限`
  - `Codex Warm 上限`
  - `Warm TTL`
  - `启动时仅恢复线程，不恢复 runtime`
  - `退出时强制清理 runtime`
  - `启动时 orphan sweep`

交互约束：

- 手动“增加”仅指增加预算或 pin，不允许创建同 workspace 多实例
- `Busy` runtime 的关闭必须确认
- 降低预算时走驱逐策略，不做立刻暴力清理

原因：

- 没有控制台，Orchestrator 只解决了系统问题，没有解决“用户与 QA 无法理解当前状态”的问题。

## Risks / Trade-offs

- `[风险]` 冷启动次数增加，个别非活跃 workspace 首次 resume 会更慢
  - `→ Mitigation` 通过 `Warm` 池和最近使用策略保留最关键的低延迟路径

- `[风险]` 生命周期状态机引入更多并发边界
  - `→ Mitigation` 统一 registry 与唯一实例键；状态迁移必须通过单入口执行

- `[风险]` 前后端 contract 增多，settings 面板和 backend registry 可能漂移
  - `→ Mitigation` 新增 runtime snapshot / mutate contract tests，所有面板状态以 backend snapshot 为真值

- `[风险]` Windows tree-kill 存在误杀或残留边缘情况
  - `→ Mitigation` 建 ledger、wrapper diagnostics、orphan sweep，并将强制 kill 记录进入可见诊断

- `[风险]` 三阶段期间系统同时存在旧路径和新路径，容易产生混合行为
  - `→ Mitigation` 以 feature gate 和阶段化切换控制范围；每阶段都有明确退出条件

## Execution Order Judgment

### 判断 1: 不能先做 `Runtime Pool Console`

如果先做设置面板，而 backend 仍沿用当前分散的 connect/cleanup 逻辑，面板只会变成“把混乱状态展示出来”的 UI：

- snapshot 没有统一真值，前端只能猜
- 手动关闭没有统一 shutdown path，容易出现 UI 关闭了但进程还活着
- 预算调节没有 registry 和 eviction，设置项只会变成无效开关

因此执行顺序必须是：

1. 先建立 registry / shutdown / diagnostics 真值层
2. 再建立 lazy acquire 和 pooled lifecycle
3. 最后把 console 接到稳定快照与 mutate API 上

### 判断 2: 不能一开始就全面推广到所有 engine

这次 P0 根因来自 `Codex` persistent runtime。`Claude/Gemini/OpenCode` 当前虽有生命周期问题，但不与“workspace 数量 -> 常驻 runtime 数量”同强度绑定。

因此首刀应该：

- Phase 1 用统一 shutdown / ledger / diagnostics 收口所有受管 runtime
- Phase 2 的池化与 lazy acquire 先聚焦 `Codex`
- 其他 engine 后续只复用 orchestrator 骨架，不阻塞本次止血

### 判断 3: 先修 backend 真值，再改 frontend restore

如果先改 frontend `useWorkspaceRestore` 为 lazy acquire，而 backend 仍没有唯一实例键、replace cleanup、orphan sweep：

- 可以减少部分启动风暴
- 但无法阻止旧 runtime 泄漏
- 也无法修复退出残留

所以真正的执行优先级不是“先改最显眼的 hook”，而是：

1. backend 生命周期真值
2. shutdown / orphan sweep
3. frontend restore / acquire 切换
4. settings console

### 判断 4: `budget` 必须晚于 `unique instance`

预算与驱逐听上去是 Phase 2 的亮点，但若没有唯一实例键与 replace-old-runtime 语义，budget 反而会掩盖泄漏问题。

因此 `budgeted pool` 的前置条件是：

- `(engine, workspace)` 唯一实例
- ensure 幂等
- old runtime 替换与 stop 路径稳定
- shutdown coordinator 已接管 exit

## Recommended Rollout Sequence

推荐的落地顺序如下：

### Wave A: 真值层

- runtime registry
- runtime ledger
- shared termination primitive
- shutdown coordinator

成功标准：

- backend 可以稳定回答“当前有哪些受管 runtime，它们的 pid / state / workspace 是什么”

### Wave B: 止血层

- local `connect_workspace` 幂等
- replace-old-session cleanup
- launch-time orphan sweep
- diagnostics / metrics

成功标准：

- 重复 connect 不再新增孤儿进程
- 退出后残留显著下降

### Wave C: 行为切换层

- `ensureRuntimeReady`
- startup restore decoupling
- `Hot/Warm/Cold`
- warm TTL
- budget eviction

成功标准：

- runtime 数由预算控制，而不是由 workspace 数控制

### Wave D: 控制台层

- runtime pool snapshot API
- mutate API
- settings `Runtime Pool Console`
- 手动关闭 / Pin / budget 调节

成功标准：

- 用户与 QA 可以看懂、验证、手动干预当前池状态

## Migration Plan

### Phase 1: 止血与收口

- 建 runtime registry、ledger、shutdown coordinator
- 修复 local `connect_workspace` 幂等与 replace-old-session cleanup
- 扩展 exit cleanup 覆盖 Codex managed runtimes
- 上线 orphan sweep 与基础 diagnostics

回滚：

- 可回退到旧 connect / exit path，但保留 runtime ledger 不影响行为

### Phase 2: 去 workspace 常驻化

- `useWorkspaceRestore` 改成只恢复 UI/thread metadata
- 引入 `ensureRuntimeReady` lazy acquire
- 上线 `Hot/Warm/Cold` 与 warm TTL

回滚：

- 可临时恢复“active workspace 启动即 connect runtime”，但不恢复批量 visible workspace connect

### Phase 3: 正式 Orchestrator + Pool Console

- 上线预算控制、lease source、state machine 完整版本
- 设置页接入 `Runtime Pool Console`
- 暴露手动关闭 / Pin / 预算调节能力
- 完整 metrics、force kill、orphan sweep 结果可见

回滚：

- 可关闭 console 与手动控制入口，但 backend Orchestrator registry 保留

## Open Questions

- `Claude/Gemini/OpenCode` 在 Phase 2 是否只共享 shutdown/ledger，还是也进入统一 budget pool？
- `Pinned` 是否需要独立的全局硬上限，防止用户把所有 workspace 都 pin 住？
- Pool Console 是否放在 Settings 的一级 tab，还是现有 runtime/settings 相关区域下的二级面板？
- runtime snapshot 是否需要在 status panel 中暴露最小摘要，还是先只放 settings console？
