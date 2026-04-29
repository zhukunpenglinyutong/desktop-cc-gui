# global-runtime-notice-dock Specification

## Purpose
TBD - created by archiving change add-global-runtime-notice-dock. Update Purpose after archive.
## Requirements
### Requirement: App MUST Provide A Global Runtime Notice Dock In The Bottom-Right Corner

系统 MUST 在 `client-ui-visibility-controls` 允许显示时提供一个 app-global 的右下角提示入口，并将其固定在客户端右下角；该入口不属于任何单独页面、thread 或 workspace 子面板。

#### Scenario: global notice entry remains available across pages

- **WHEN** 用户在客户端内切换首页、对话区、设置页或其他已支持页面
- **THEN** 系统 MUST 保持右下角 notice 入口可见
- **AND** 该入口 MUST NOT 因页面切换而丢失或重新挂载成页面内局部组件

#### Scenario: first phase stays independent from status panel and runtime console

- **WHEN** 第一阶段接入全局右下角提示框
- **THEN** 系统 MUST 将其作为独立的 global notice dock 提供
- **AND** MUST NOT 把该能力收编为现有 `status panel` tab 或 `runtime console` 子视图

#### Scenario: appearance visibility can hide the dock

- **WHEN** 用户在基础外观页隐藏 global runtime notice dock
- **THEN** 系统 MUST 从 active UI 中移除最小化入口与展开态 panel
- **AND** MUST NOT 通过页面级特判或替代容器继续渲染该 dock

### Requirement: Hidden Dock MUST Preserve Notice Producers And Restore Continuity

隐藏 global runtime notice dock 只影响 presentation surface，并 MUST NOT 中断 notice feed 的 producer、buffer 或 dock mode continuity。

#### Scenario: producers continue pushing while the dock is hidden

- **WHEN** global runtime notice dock 处于 hidden 状态且系统产生新的 bootstrap、runtime lifecycle 或关键错误 notice
- **THEN** 系统 MUST 继续把这些 notice 追加到同一个 bounded feed
- **AND** hidden 状态 MUST NOT 禁用或绕过现有 global notice producer

#### Scenario: restoring the dock resumes the current feed

- **WHEN** 用户重新显示先前被隐藏的 global runtime notice dock
- **THEN** 系统 MUST 展示当前 session 已累积的 notice feed，而不是从空态重新开始
- **AND** MUST 恢复 dock 当前的最小化或展开状态，而不是强制回到默认最小化态

### Requirement: Global Runtime Notice Dock MUST Support Minimized Entry And Expandable Panel

系统 MUST 支持“最小化入口 + 展开面板”两种可见形态；默认态 MUST 以 `loading icon` 作为标识。

#### Scenario: minimized state uses loading icon as entry

- **WHEN** 客户端加载完成并展示全局 notice dock
- **THEN** 系统 MUST 在最小化状态显示一个右下角 `loading icon`
- **AND** 该 icon MUST 作为展开 notice 面板的唯一主入口

#### Scenario: click entry expands the notice panel

- **WHEN** 用户点击右下角 `loading icon`
- **THEN** 系统 MUST 展开提示框并展示当前 notice 内容
- **AND** 展开操作 MUST NOT 打断用户当前页面的主要工作流

#### Scenario: expanded panel can be minimized again

- **WHEN** 用户在展开态点击 `最小化`
- **THEN** 系统 MUST 折叠回最小化入口
- **AND** 后续 notice push MUST 继续进入同一 feed

#### Scenario: new notices do not auto-expand the dock

- **WHEN** notice dock 处于最小化状态且有新的 notice 到达
- **THEN** 系统 MUST NOT 自动展开提示框
- **AND** 新状态 MUST 仅通过最小化入口的高亮语义反馈给用户

#### Scenario: first phase minimized state uses highlight instead of unread count

- **WHEN** 第一阶段最小化状态收到新的 notice 或 error
- **THEN** 系统 MUST 使用 `streaming` 或 `has-error` 等高亮语义提示变化
- **AND** MUST NOT 展示数字型未读角标

### Requirement: Expanded Notice Panel MUST Provide Stable Header Layout And Empty State

第一阶段展开态 MUST 使用稳定的头部结构与空态结构，避免演变为通知中心式复杂面板。

#### Scenario: expanded panel uses fixed title and compact status badge

- **WHEN** 用户展开全局 notice panel
- **THEN** 面板头部 MUST 固定展示标题 `运行时提示`
- **AND** MUST 展示一个反映聚合状态的 compact 状态标签，例如 `空闲`、`运行中` 或 `异常`

#### Scenario: expanded panel header stays action-light in phase one

- **WHEN** 第一阶段渲染展开态 notice panel
- **THEN** 头部 MUST 仅包含标题、状态标签、`清空` 与 `最小化`
- **AND** MUST NOT 提供 tabs、filters、category switcher 或 message detail toggle

#### Scenario: empty panel shows stable guidance

- **WHEN** 当前 notice feed 为空
- **THEN** 展开态 MUST 显示稳定空态文案，例如 `暂无运行时提示`
- **AND** MUST 附带一句轻量辅助说明，提示初始化进度和关键错误会显示在这里

### Requirement: Notice Feed MUST Append Runtime Prompts As One-Line Entries

系统 MUST 支持把运行时提示持续 push 到全局 notice dock，并以“一行一条提示”的形式按接收顺序稳定展示。

#### Scenario: initialization prompts stream into notice feed

- **WHEN** 客户端启动后进入初始化流程并产生运行时提示
- **THEN** 系统 MUST 将这些提示持续追加到全局 notice feed
- **AND** 每条提示 MUST 作为独立单行 notice 展示，而不是覆盖上一条内容

#### Scenario: new notices preserve arrival order

- **WHEN** 多条运行时提示连续到达
- **THEN** 系统 MUST 按接收顺序稳定追加这些提示
- **AND** MUST NOT 因界面展开/折叠切换而打乱既有顺序

### Requirement: Notice Rows MUST Use A Single-Line Summary Layout With Lightweight Timestamp

第一阶段 notice 行 MUST 保持一行一条的紧凑结构，以支持快速扫描与时间顺序理解。

#### Scenario: each row shows severity cue, summary copy, and timestamp

- **WHEN** 系统渲染任意一条 notice
- **THEN** 该行 MUST 展示 severity 视觉提示、摘要文案与低权重时间戳
- **AND** 时间戳 MUST 使用轻量格式，例如 `HH:mm:ss`

#### Scenario: long notice copy truncates instead of wrapping

- **WHEN** 某条 notice 文案长度超过单行可用空间
- **THEN** 系统 MUST 对该文案做单行截断处理
- **AND** MUST NOT 在第一阶段把 notice 行扩展成多行高度

### Requirement: Phase One Notice Copy MUST Use Concise User-Readable Summary Templates

第一阶段 notice 文案 MUST 使用稳定、简短、user-readable 的摘要模板；不同 producer 不得直接把底层 raw payload 原文暴露为最终 UI copy。

#### Scenario: bootstrap notice uses initialization summary copy

- **WHEN** 系统展示 bootstrap 生命周期 notice
- **THEN** notice 文案 MUST 使用“正在初始化… / 初始化失败… / 已按降级模式继续…”这一类简短摘要模板
- **AND** MUST NOT 直接展示底层诊断对象或冗长技术堆栈

#### Scenario: runtime recovery notice uses runtime-status summary copy

- **WHEN** 系统展示 runtime lifecycle、recovery 或 degraded notice
- **THEN** notice 文案 MUST 使用“正在连接… / 已连接 / 正在恢复 / 恢复失败 / 处于冷却期”这一类状态摘要模板
- **AND** MUST 保持一行一条的可扫描性

#### Scenario: key error notice stays concise and actionable

- **WHEN** 系统展示关键错误 notice
- **THEN** 文案 MUST 先说明错误类别与当前影响，例如“启动失败”“运行时错误”“恢复失败”
- **AND** MAY 在同一行内附带简短动作导向，但 MUST NOT 退化成长段错误详情

### Requirement: Phase One MUST Restrict Producers To Whitelisted Global Lifecycle Events

第一阶段系统 MUST 仅允许白名单内的 app-global 生命周期事件进入 notice dock；普通局部交互错误或页面级失败 MUST NOT 默认进入该 feed。

#### Scenario: bootstrap and runtime lifecycle events are eligible producers

- **WHEN** 事件属于 app bootstrap 生命周期或 runtime lifecycle 关键节点
- **THEN** 系统 MUST 允许这些事件被映射为结构化 notice 项进入 feed
- **AND** 这些 notice MUST 保持 user-readable 的摘要语义，而不是原始底层日志

#### Scenario: local interaction failures remain outside the global dock

- **WHEN** 错误来源是局部 UI 交互、设置保存、文件操作、外部应用打开或其他页面级动作
- **THEN** 这些错误 MUST NOT 默认进入全局 notice feed
- **AND** 它们 MAY 继续仅通过现有 toast 或局部错误反馈处理

### Requirement: Notice Feed MUST Support Error Entries With Distinct Severity Semantics

系统 MUST 允许额外错误信息进入同一 notice feed，并与普通运行时提示保持可区分的 severity 语义。

#### Scenario: key error entry can be pushed into the same feed

- **WHEN** 客户端产生需要持续展示的额外错误信息
- **THEN** 系统 MUST 允许该错误信息进入全局 notice feed
- **AND** 错误信息 MUST 与普通运行时提示共存于同一提示框中

#### Scenario: error entries remain distinguishable from normal runtime notices

- **WHEN** notice feed 同时存在普通运行时提示与错误提示
- **THEN** 系统 MUST 以稳定的视觉或结构化字段区分二者
- **AND** 用户 MUST 能识别哪些条目属于 error severity

#### Scenario: ordinary transient errors may remain toast-only in phase one

- **WHEN** 客户端产生普通瞬时错误且未被标记为关键错误
- **THEN** 系统 MAY 继续仅通过既有 toast 机制提示该错误
- **AND** MUST NOT 强制要求所有错误在第一阶段同时进入 notice dock

#### Scenario: key runtime recovery failures are eligible for dock mirroring

- **WHEN** 错误属于启动初始化失败、runtime 恢复失败、会话创建恢复失败或等效关键链路失败
- **THEN** 系统 MUST 允许这些关键错误被镜像到 notice dock
- **AND** 这些错误 MUST 与普通瞬时错误保持准入边界分离

### Requirement: Notice Panel MUST Support Clear Without Breaking Future Push

系统 MUST 支持清空当前提示内容，但清空操作不得破坏后续消息 push 能力。

#### Scenario: clear removes existing notices from the panel

- **WHEN** 用户在展开态点击 `清空`
- **THEN** 系统 MUST 清除当前已展示的 notice 条目
- **AND** 展开内容区 MUST 回到稳定空态

#### Scenario: new notices still appear after clear

- **WHEN** 用户清空 notice 内容后，系统又产生新的运行时提示或错误信息
- **THEN** 新提示 MUST 继续正常追加到 feed
- **AND** 系统 MUST NOT 因清空操作而失去订阅或 push 能力

### Requirement: Notice Feed MUST Use A Bounded Session Buffer

系统 MUST 对全局 notice feed 使用有界缓冲策略，避免长期运行后内存无限增长。

#### Scenario: feed keeps recent notices within configured limit

- **WHEN** 当前 app session 中 notice 数量持续增长并超过设定上限
- **THEN** 系统 MUST 仅保留最近 `120` 条 notice 记录
- **AND** 该策略 MUST 防止全局 notice feed 无界增长

#### Scenario: bounded buffer does not break visible notice interaction

- **WHEN** 系统执行 notice feed 截断
- **THEN** `最小化`、`展开`、`清空` 等既有交互 MUST 继续可用
- **AND** feed 截断 MUST NOT 破坏后续 notice 追加

### Requirement: First Phase MUST Remain Backward Compatible With Existing Right-Bottom Surfaces

第一阶段接入全局 notice dock 后，系统 MUST 保持现有 `status panel`、`error toast`、`update toast` 与 `runtime console` 的主语义向后兼容。

#### Scenario: status panel and runtime console remain independently reachable

- **WHEN** 系统新增全局右下角 notice dock
- **THEN** 现有 `status panel` 与 `runtime console` MUST 继续按原有入口与语义工作
- **AND** 全局 notice dock MUST NOT 替代它们原本承载的主功能

#### Scenario: existing toast behavior stays additive

- **WHEN** 系统接入全局 notice dock 后继续触发已有 toast 机制
- **THEN** 既有 `error toast` 与 `update toast` 行为 MUST 保持兼容
- **AND** 全局 notice dock MUST 作为附加的持续提示承载面，而不是要求 toast 体系整体迁移
