# kanban-task-chaining Specification

## Purpose
TBD - created by archiving change add-kanban-scheduled-and-chained-tasks. Update Purpose after archive.
## Requirements
### Requirement: Kanban Task SHALL Support Linear Chaining For Todo Tasks

系统 MUST 支持将多个 `todo` 任务组装为线性链；链内每个任务最多一个上游与一个下游，且不得包含已开始或已完成任务。

#### Scenario: create linear chain among todo tasks
- **WHEN** 用户在同一 workspace 内建立 `A -> B -> C` 串联关系
- **THEN** 系统 MUST 持久化稳定链路关系与组标识
- **AND** 每个节点 MUST 只保留单一路径位置

#### Scenario: linking non-todo task is rejected
- **WHEN** 用户尝试将 `inprogress/testing/done` 任务加入新链路
- **THEN** 系统 MUST 拒绝保存
- **AND** 系统 MUST 明确提示仅未开始任务可参与串联

#### Scenario: cycle or multi-branch chain is rejected
- **WHEN** 用户尝试创建循环依赖、多上游或多下游
- **THEN** 系统 MUST 阻止保存该链路
- **AND** 既有有效链路 MUST 保持不变

### Requirement: Chain Entry SHALL Be Controlled By Head Task Trigger

系统 MUST 保证链内非头任务不能被人工单独启动，只允许上游自动续跑触发。

#### Scenario: non-head task manual trigger is blocked
- **WHEN** 用户尝试手动或拖拽启动存在 `previousTaskId` 的链内任务
- **THEN** 系统 MUST 拒绝该触发
- **AND** 系统 MUST 写入可见阻断原因

#### Scenario: chain head remains trigger entry for manual/scheduled sources
- **WHEN** 用户手动启动或计划触发链头任务
- **THEN** 系统 MUST 允许该触发作为链路入口
- **AND** 后续节点 MUST 通过 `chained` 触发源推进

### Requirement: Chain Group Integrity SHALL Be Protected During Drag Operations

系统 MUST 保护关联组内部结构，防止非关联任务拖入破坏链路分组。

#### Scenario: unrelated task cannot be dragged into linked group slot
- **WHEN** 用户将不属于该关联组的任务拖入组内插槽位置
- **THEN** 系统 MUST 拒绝该拖拽落位
- **AND** 系统 MUST 保留原有组结构与顺序

#### Scenario: linked group tasks are auto-sorted by chain position
- **WHEN** 关联组在列中渲染
- **THEN** 系统 MUST 按链路顺序自动排序任务
- **AND** 组内排序 MUST 与上游依赖关系一致

### Requirement: Chain Group SHALL Expose Stable Group Identity and Sequence Metadata

系统 MUST 为关联组和组内任务提供可识别的稳定元信息，便于高密度任务场景审查。

#### Scenario: each linked group shares one 3-digit group code
- **WHEN** 用户创建新的关联组
- **THEN** 系统 MUST 分配三位组码
- **AND** 该组内任务 MUST 共享同一组码

#### Scenario: legacy linked tasks without group code still render stable code
- **WHEN** 系统加载缺失组码的历史串联任务
- **THEN** 系统 MUST 提供稳定回退组码
- **AND** 同一组在同次渲染中的组码 MUST 保持一致

#### Scenario: each chained task displays in-group sequence number
- **WHEN** 关联组任务在卡片渲染元标签
- **THEN** 系统 MUST 展示组内串行顺序编号
- **AND** 编号 MUST 与链路位置一致

### Requirement: Upstream Result Snapshot SHALL Be Captured And Passed To Downstream

系统 MUST 在上游执行完成后提取可序列化快照，并将其注入下游首轮输入。

#### Scenario: capture result snapshot from upstream thread
- **WHEN** 上游任务 processing 结束且存在可提取结果
- **THEN** 系统 MUST 持久化结果快照
- **AND** 快照 MUST 包含摘要、来源 thread 标识与可识别产物引用（若存在）

#### Scenario: inject upstream snapshot into downstream prompt
- **WHEN** 下游任务被自动触发
- **THEN** 系统 MUST 将上游快照作为前缀上下文注入下游首条消息
- **AND** 下游原始任务描述/标题 MUST 保留

### Requirement: Chained Execution SHALL Auto-Continue On Success And Stop On Failure

系统 MUST 支持链路连续执行：上游成功则继续推进，下游条件不满足则停止并等待人工处理。每次 chained continuation MUST create or update a linked TaskRun with upstream lineage and diagnosable blocked state.

#### Scenario: head success auto-continues downstream chain
- **WHEN** `A -> B -> C` 中 `A` 成功且快照可用
- **THEN** 系统 MUST 自动触发 `B`
- **AND** `B` 成功后系统 MUST 自动触发 `C`
- **AND** 每个 downstream execution SHALL create a TaskRun with trigger `chained`

#### Scenario: missing snapshot or invalid downstream state blocks continuation
- **WHEN** 上游无可用快照、或下游状态不满足续跑条件
- **THEN** 系统 MUST 停止后续自动推进
- **AND** 下游任务 MUST 保持未开始并记录阻断原因
- **AND** 若 TaskRun 已创建，TaskRun SHALL 进入 `blocked` 并记录同一阻断原因

#### Scenario: non-chained task behavior remains unchanged
- **WHEN** 任务未加入任何链路
- **THEN** 该任务 MUST 按普通任务语义运行
- **AND** 其他链路存在 MUST NOT 改变其执行行为
