# codex-chat-canvas-user-input-elicitation Specification

## Purpose
TBD - created by archiving change optimize-codex-chat-canvas. Update Purpose after archive.
## Requirements
### Requirement: RequestUserInput GUI Rendering

系统 MUST 将 `item/tool/requestUserInput` 事件渲染为可交互的用户输入卡片，并以 `completed` 生命周期驱动待处理队列。

#### Scenario: request user input event renders interactive card when not completed

- **WHEN** 客户端收到 `item/tool/requestUserInput` 事件
- **AND** 事件 `completed` 字段不存在或为 `false`
- **THEN** 幕布 MUST 渲染包含问题标题（`header`）、问题文本（`question`）、可选项（`options`）和备注输入的交互卡片
- **AND** 卡片 MUST 与当前 `thread_id` 绑定，不得跨线程显示

#### Scenario: completed request does not enter pending queue

- **WHEN** 客户端收到 `item/tool/requestUserInput` 事件
- **AND** 事件 `completed=true`
- **THEN** 该请求 MUST NOT 进入待处理队列
- **AND** 系统 MUST NOT 弹出交互卡片

#### Scenario: no-questions payload still renders submit path

- **WHEN** `requestUserInput` payload 中问题列表为空
- **THEN** 幕布 MUST 渲染空态提示
- **AND** 用户 MUST 仍可提交空 answers 响应

#### Scenario: thread isolation prevents cross-thread card leakage

- **WHEN** Thread A 收到 `requestUserInput` 事件
- **AND** 用户切换到 Thread B
- **THEN** Thread B 的消息流 MUST NOT 显示 Thread A 的 requestUserInput 卡片
- **AND** 切回 Thread A 后该卡片 MUST 仍然可见且保留之前的填写状态

### Requirement: User Input Response Roundtrip

系统 MUST 将用户输入结果通过标准响应通道回传给服务端，并在提交后使线程生命周期进入可恢复、可结算状态，而不是留下不可恢复的伪 processing。

#### Scenario: submit answers uses respond_to_server_request contract

- **WHEN** 用户在输入卡片点击提交
- **THEN** 客户端 MUST 调用 `respond_to_server_request`
- **AND** result payload MUST 符合 `{ answers: Record<string, { answers: string[] }> }`
- **AND** 提交成功后 MUST 从队列移除当前请求

#### Scenario: submit failure preserves request in queue

- **WHEN** 用户在输入卡片点击提交
- **AND** `respond_to_server_request` IPC 调用失败（网络异常、进程崩溃等）
- **THEN** 当前请求 MUST NOT 从队列移除
- **AND** 用户 MUST 能看到错误提示
- **AND** 用户 MUST 能重新点击提交

#### Scenario: successful submit cannot leave thread in permanent blocked processing

- **WHEN** 用户成功提交 `requestUserInput` 响应
- **AND** 当前 turn 在受限窗口内没有收到新的恢复事件或终态事件
- **THEN** 线程 MUST 转入 `resume-pending`、recoverable degraded 或等效可解释状态
- **AND** 用户 MUST 能继续操作而不是面对永久不可点击的阻塞界面

#### Scenario: settled resume clears submitted request blocking state

- **WHEN** 提交后的恢复链最终收到了 completed、error 或显式 recoverable abort 终态
- **THEN** 系统 MUST 清理与该 request 关联的提交中阻塞状态
- **AND** 同线程后续的 `requestUserInput` 卡片 MUST 保持可交互

### Requirement: askuserquestion Semantic Mapping

系统 MUST 在工具展示层将 `askuserquestion` 与 `requestUserInput` 语义对齐，并与官方 `Plan Mode` / `Default` 术语保持一致。

#### Scenario: tool log alias maps to user input request semantics

- **WHEN** 工具日志中出现 `askuserquestion` 工具名
- **THEN** 幕布 MUST 将展示名映射为 `"User Input Request"` 或等效本地化术语
- **AND** 用户 MUST 能理解该事件属于“需要用户回答”的流程而非普通日志

#### Scenario: blocked askuserquestion keeps official terminology

- **GIVEN** 当前线程运行时模式为 `effective_mode=code`
- **WHEN** 系统阻断 `item/tool/requestUserInput`
- **THEN** 用户可见提示 MUST 使用 `Default` / `Plan Mode` 术语表达
- **AND** MUST NOT 暴露底层术语 `Collaboration mode: code`

#### Scenario: plan mode keeps interactive behavior

- **GIVEN** 当前线程运行时模式为 `effective_mode=plan`
- **WHEN** 工具日志中出现 `askuserquestion`
- **THEN** 系统 MUST 保持交互提问卡片路径可用
- **AND** MUST NOT 显示误导性的模式阻断提示

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

### Requirement: Secret Input Handling

系统 MUST 对秘密输入问题提供安全展示策略。

#### Scenario: secret question masks entered content by default

- **WHEN** `requestUserInput` 问题项标记 `isSecret = true`（兼容 `is_secret`）
- **THEN** 输入控件 MUST 默认以掩码方式显示（`<input type="password">`）
- **AND** 客户端日志与调试输出 MUST NOT 输出该字段明文

#### Scenario: secret input supports visibility toggle

- **WHEN** 问题项标记 `isSecret = true`
- **AND** 输入控件处于掩码状态
- **THEN** 控件旁 MUST 提供可见性切换按钮（如眼睛图标）
- **AND** 点击切换按钮后控件 MUST 显示明文内容
- **AND** 再次点击 MUST 恢复掩码状态

#### Scenario: non-secret question uses standard textarea

- **WHEN** `requestUserInput` 问题项的 `isSecret` 为 `false` 或未定义
- **THEN** 输入控件 MUST 使用标准 `<textarea>` 而非密码输入

#### Scenario: secret field normalization handles snake_case and camelCase

- **WHEN** 上游事件中 `isSecret` 字段以 `is_secret`（snake_case）格式到达
- **THEN** 客户端 MUST 归一化为 `isSecret: boolean`
- **AND** 缺失该字段时 MUST 默认为 `false`

#### Scenario: secret value is sanitized in all log outputs

- **WHEN** 系统对 `isSecret=true` 的问题执行日志记录
- **THEN** 所有 `console.log`、logger 调用和 debug 输出中 MUST 将该字段的用户输入值替换为 `"***"`
- **AND** 替换 MUST 覆盖前端全链路（事件接收、状态存储、提交回传日志）

### Requirement: Claude AskUserQuestion MUST Render Interactive RequestUserInput Card

系统 MUST 在 `claude` 会话收到 `item/tool/requestUserInput` 事件后，渲染可交互提问卡片，而不是仅展示原始 JSON 文本。

#### Scenario: claude request user input renders card instead of raw json
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 客户端收到 `item/tool/requestUserInput` 且 `completed` 不存在或为 `false`
- **THEN** 幕布 MUST 渲染包含 `header`、`question`、`options` 与备注输入区的交互提问卡片
- **AND** 对应工具日志区 MUST NOT 作为唯一交互入口展示原始问题 JSON

#### Scenario: completed claude request does not enter pending card queue
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 客户端收到 `item/tool/requestUserInput` 且 `completed=true`
- **THEN** 该请求 MUST NOT 进入待处理提问队列
- **AND** 系统 MUST NOT 渲染新的待提交提问卡片

#### Scenario: empty questions still keeps claude submit path
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** `requestUserInput` 事件中的 `questions=[]`
- **THEN** 幕布 MUST 显示空态提示
- **AND** 用户 MUST 仍可提交空 answers 响应

### Requirement: Claude RequestUserInput Submission MUST Reuse Standard Response Contract

系统 MUST 复用现有 `respond_to_server_request` 协议回传 Claude 提问答案，并在成功后清理待处理请求。

#### Scenario: claude submit routes through respond_to_server_request
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 用户在提问卡片点击提交
- **THEN** 客户端 MUST 通过 `respond_to_server_request` 回传 `{ answers: Record<string, { answers: string[] }> }`
- **AND** 后端 MUST 继续将该响应路由到 Claude AskUserQuestion 恢复流程

#### Scenario: submit success removes pending request and records submitted summary
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 提交响应成功
- **THEN** 当前 request MUST 从待处理队列移除
- **AND** 会话消息流 MUST 生成可追踪的已提交记录（`requestUserInputSubmitted` 或等效语义）

#### Scenario: submit failure keeps request for retry
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 提交响应失败
- **THEN** 当前 request MUST 保留在待处理队列
- **AND** 用户 MUST 能看到错误提示并重试提交

### Requirement: Claude AskUserQuestion Tool Presentation MUST Avoid Misleading Plan-Mode Block Hint

当 Claude 提问链路可交互时，系统 MUST 避免展示与 Codex 协作模式阻断语义冲突的提示。

#### Scenario: active claude request does not show plan-mode-block hint as primary message
- **GIVEN** 当前活动会话引擎为 `claude`
- **AND** 存在可提交的 `requestUserInput` 卡片
- **WHEN** 对应 `askuserquestion` 工具日志可见
- **THEN** 用户主交互路径 MUST 指向提问卡片
- **AND** 界面 MUST NOT 以 `"This feature requires Plan mode"` 作为该请求的主提示文案

#### Scenario: claude tool row can remain as trace but not as exclusive interaction surface
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** `askuserquestion` 工具日志渲染
- **THEN** 工具行 MAY 保留为审计痕迹
- **AND** 用户 MUST 可在同线程中通过提问卡片完成回答与提交

### Requirement: Claude Fix MUST Preserve Other Engine Behavior

该能力变更 MUST 严格限制在 `claude` 引擎，不得改变其他引擎既有提问与工具展示行为。

#### Scenario: codex request user input flow remains unchanged
- **WHEN** 当前活动会话引擎为 `codex`
- **THEN** 既有 `requestUserInput` 渲染、提交与提示语义 MUST 保持不变

#### Scenario: opencode and gemini do not gain unintended askuserquestion behavior
- **WHEN** 当前活动会话引擎为 `opencode` 或 `gemini`
- **THEN** 系统 MUST NOT 因本变更引入新的 `askuserquestion` 交互流程
- **AND** 既有消息与工具渲染契约 MUST 保持不变
