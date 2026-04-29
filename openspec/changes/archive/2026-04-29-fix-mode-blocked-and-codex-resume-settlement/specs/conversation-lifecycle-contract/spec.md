## MODIFIED Requirements

### Requirement: Foreground Turn MUST Exit Pseudo-Processing When Recovery Progress Stalls

在统一会话生命周期契约下，queue fusion 发起的 continuation 与被策略阻断的 `requestUserInput` 恢复链若未真正接续成功，也 MUST 以有界、可恢复的方式离开 pseudo-processing。

#### Scenario: missing continuation evidence after fusion still settles lifecycle

- **WHEN** 前端已为当前线程发起 fusion continuation
- **AND** 生命周期在受限窗口内没有收到新的 continuation 证据或终态事件
- **THEN** 当前线程 MUST 结算为 recoverable degraded / stalled
- **AND** 线程 MUST 重新进入可交互状态

#### Scenario: request-user-input blocked event settles lifecycle without continuation evidence

- **WHEN** 当前前景 turn 收到针对 `item/tool/requestUserInput` 的 `collaboration/modeBlocked`
- **AND** 生命周期尚未观察到新的 successor turn、stream delta、tool execution 或等效继续证据
- **THEN** 当前线程 MUST 退出普通 processing
- **AND** 与该 turn 绑定的 active-turn marker MUST 被清理
- **AND** 用户 MUST 重新获得可交互线程状态

#### Scenario: late terminal settlement clears pending fusion continuation

- **WHEN** 一条处于待确认状态的 fusion continuation 或 blocked user-input resume chain 后续收到了 completed、error、runtime-ended 或 recoverable abort
- **THEN** 生命周期 MUST 清理对应的待确认 continuation 或 blocked residue
- **AND** 线程 MUST 不再残留伪 processing 或假继续生成文案

### Requirement: Cross-Surface Lifecycle State MUST Remain Non-Contradictory

生命周期展示面之间 MUST 避免对同一条 fusion stalled chain 或 request-user-input blocked chain 给出互相矛盾的主状态结论。

#### Scenario: fusion stalled thread cannot coexist with unexplained busy continuation copy

- **WHEN** 当前线程的 fusion continuation 仍处于待确认或 stalled 状态
- **THEN** 用户可见文案 MUST 表达“正在切换 / 等待接续 / 已停滞”等待确认语义
- **AND** 系统 MUST NOT 在无 continuation 证据时直接宣称“内容正在继续生成”

#### Scenario: request-user-input blocked thread cannot coexist with ordinary processing curtain

- **WHEN** 当前线程已经被共享生命周期判定为 `requestUserInput` 型 blocked settlement
- **THEN** 用户可见主状态 MUST 表达 blocked / waiting for mode change / user-input unavailable 的解释性语义
- **AND** 系统 MUST NOT 在无新进展证据时同时展示普通生成中或不可点击的 processing 幕布
