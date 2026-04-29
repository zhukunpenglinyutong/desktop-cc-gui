## MODIFIED Requirements

### Requirement: Mode-Blocked RequestUserInput Event Compatibility

系统 MUST 在策略明确阻断 `requestUserInput` 时发出兼容事件，供前端解释性展示、队列清理与生命周期结算；该终态式结算语义 MUST 仅限 `requestUserInput` 型 `modeBlocked`，不得扩展到其它 blocked 方法。

#### Scenario: blocked event includes actionable context with dual-case compatibility

- **GIVEN** `requestUserInput` 被策略层阻断
- **WHEN** 系统生成阻断反馈事件
- **THEN** 事件 MUST 包含 `threadId/thread_id`、`blockedMethod/blocked_method`、`effectiveMode/effective_mode` 与 `reason`
- **AND** MUST 包含可执行建议（例如切换模式）

#### Scenario: blocked event can remove pending request by id compatibility

- **GIVEN** 阻断事件携带 `requestId` 或 `request_id`
- **WHEN** 前端消费该事件
- **THEN** 前端 MUST 能识别两种命名并从待处理请求队列移除对应项
- **AND** 队列状态 MUST 保持线程隔离

#### Scenario: blocked request settles pseudo-processing for the blocked thread

- **GIVEN** `modeBlocked` 事件对应 `blockedMethod/blocked_method = item/tool/requestUserInput` 或等效 reason code
- **WHEN** 前端消费该事件
- **THEN** 目标线程 MUST 清理普通 `processing`、`activeTurnId` 与等效 active-turn residue
- **AND** 用户 MUST 能继续与该线程交互
- **AND** 阻断提示卡片 MUST 保留为解释性审计痕迹

#### Scenario: non-request-user-input blocked event remains explanatory only

- **GIVEN** `modeBlocked` 事件对应的 blocked method 不是 `item/tool/requestUserInput`
- **WHEN** 前端消费该事件
- **THEN** 系统 MUST 保持解释性 blocked 展示语义
- **AND** 系统 MUST NOT 仅因为该事件属于 `modeBlocked` 就把它当作 user-input settlement 去清理无关 active execution state
