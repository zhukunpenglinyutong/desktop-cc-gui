## MODIFIED Requirements

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
