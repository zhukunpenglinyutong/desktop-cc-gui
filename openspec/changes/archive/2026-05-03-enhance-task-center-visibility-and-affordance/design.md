## Context

Task Center Phase 1 已完成三件关键事：

- `TaskRun` 作为独立 execution truth 被建立；
- manual / scheduled / chained / retry / resume lifecycle 已接入统一 run model；
- completion telemetry 与 recovery action 已接到现有 control path。

但从用户表层感知看，Task Center 仍然存在一个典型问题：**系统在语义上更完整了，但在视觉和交互上还不够“会说话”**。用户如果不主动打开 detail panel、观察 action enable/disable 或理解 run lineage，就很难感受到这套 execution layer 已经存在。

因此这个阶段不再优先扩 backend，而是先把 Phase 1 已经具备的 truth 放大成更清晰的 surface affordance。

关键约束：

- 继续保持 frontend-first；不新增 Rust store、Tauri command 或新的 runtime protocol。
- 不把 Kanban 重新设计成 execution console；Kanban 仍然只承载 summary 级 execution signal。
- 保持 `Task Center`、Workspace Home、Kanban 三个 surface 的状态语义一致，不重新发明三套 copy。

## Goals / Non-Goals

**Goals:**

- 提升 `Task Center` run list 的状态可见性与优先级排序体验。
- 让 Workspace Home 首屏就能显露关键 run，而不是只有进入 detail 后才有价值。
- 增强 Kanban `latestRunSummary` 的解释力，使其既不污染 planning，又能表达最近一次 execution 的结果。
- 为 blocked / failed / waiting_input 等可干预状态提供更明显的 intervention hint。

**Non-Goals:**

- 不新增 global Task Center 页面。
- 不引入 run analytics、分页、批量操作。
- 不修改 `TaskRun` store schema，除非现有 summary 字段确实不足以表达最小可见性需求。
- 不改写现有 recovery action contract。

## Decisions

### 1. 先增强已有 surface，不新建全局 Task Center page

选项 A：先做 Workspace Home + TaskCenterView + Kanban summary 增强。  
选项 B：直接做新的全局 Task Center page。  

采用 A。当前问题不是“入口不够多”，而是现有入口的价值显现不够强。先把现有 surface 做强，成本更小，也更符合用户当前反馈。

### 2. 用统一的 severity / affordance 规则驱动三个 surface

为同一 run 的状态定义统一的 surface 级别表达：

- `running / planning`：progress emphasis
- `waiting_input`：needs-attention emphasis
- `blocked / failed`：recovery emphasis
- `completed`：settled-success emphasis
- `canceled`：settled-muted emphasis

Workspace Home、Task Center list/detail、Kanban latest summary 都必须基于同一套 severity mapping，而不是各自拼文案。

### 3. Kanban 只增强摘要，不承担 detail

Kanban 卡片仍然只显示最近 run 摘要，不展示完整 artifacts、diagnostics 列表或完整恢复控制。

允许增强的字段：

- 最近 run 状态
- 最近更新时间
- blocked / failure 短摘要
- 当前是否存在 active run
- 进入 Task Center / conversation 的明确入口提示

不允许演化成：

- 长文本 latest output
- 多按钮控制台
- 完整 diagnostics 明细

### 4. 优先暴露“下一步该干什么”，而不是只暴露“现在是什么状态”

对用户来说，visibility enhancement 的关键不是更花哨地显示 status badge，而是：

- 当前 run 是不是需要我处理
- 我现在最适合点哪里
- 去对话、去重试、还是等它跑完

因此 UI 文案和 affordance 需要偏向 action-oriented：

- blocked / failed：强调恢复路径
- waiting_input：强调需要进入 conversation
- running：强调正在推进中，不鼓励重复操作

### 5. 兼容性优先于视觉增强

本阶段新增的是 surface projection contract，不是底层数据 schema 升级。因此：

- 共享 severity / hint mapper MUST 能消费旧 `TaskRunRecord` 与旧 `latestRunSummary`。
- 当旧数据缺失 `blockedReason`、`failureReason`、`latestOutputSummary` 中的任一项时，surface MUST 回退到剩余可用字段或通用 unavailable copy。
- 不允许为了这次 visibility enhancement 引入一次性 migration gate 或要求用户清空本地 store。

### 6. CI 门禁必须前置写入 change contract

由于这一阶段主要是 UI projection，最容易发生的是“视觉改了，但不同 surface 文案或状态映射飘了”。因此门禁必须明确要求：

- OpenSpec validate 必过。
- focused Vitest 必覆盖 TaskCenterView、WorkspaceHome、Kanban summary 和 shared mapper。
- `npm run lint`、`npm run typecheck` 必过。

## Data Flow

```text
TaskRun store
  -> unified severity / affordance mapper
  -> TaskCenterView list/detail emphasis
  -> WorkspaceHome highlighted summary
  -> Kanban latestRunSummary presentation
```

这个 change 不改变底层 truth flow，只改变 truth 在 surface 上如何被表达。

## Risks / Trade-offs

- [Risk] visibility 增强后，Kanban 会被重新拉回 execution-heavy。  
  → Mitigation：限制 Kanban 只展示摘要，不展示 detail 或过多按钮。

- [Risk] 三个 surface 使用不同 copy，反而制造更多认知噪音。  
  → Mitigation：统一 severity mapping 与 status copy contract。

- [Risk] 只改样式不改信息结构，用户仍然感觉不到差异。  
  → Mitigation：把 intervention hint 与 next-step affordance 纳入验收标准，而不是只看 badge 颜色。

## Migration Plan

1. 为 `TaskRun` 定义统一 surface severity / affordance mapping。
2. 更新 `TaskCenterView` list/detail，使 active、blocked、waiting_input、failed run 更容易被扫描。
3. 强化 `WorkspaceHome` 内嵌 Task Center 的首屏 run summary。
4. 更新 Kanban `latestRunSummary` 呈现与入口 affordance。
5. 补 focused tests、i18n copy、样式与门禁验证。

Rollback：如果 visibility 改造带来心智混乱，可先保留 severity mapping 与文案 contract，回退局部视觉增强，不影响现有 `TaskRun` truth 和 recovery action。
