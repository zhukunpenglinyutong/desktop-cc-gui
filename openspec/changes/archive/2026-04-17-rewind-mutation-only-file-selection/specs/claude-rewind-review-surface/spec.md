## MODIFIED Requirements

### Requirement: Compact Review Surface For Claude Rewind

Claude rewind 确认弹层 MUST 使用紧凑文件审查结构，并且受影响文件集合 MUST 仅包含目标用户消息锚点尾部区间内、会改变 workspace 语义的 mutation 文件事实，避免只读访问文件或锚点之前的上下文文件挤占高风险审查区域。

#### Scenario: affected files remain independently scrollable
- **WHEN** rewind preview 包含多个受影响文件
- **THEN** 文件列表 SHALL 使用独立滚动区域
- **AND** 目标信息与影响摘要 SHALL 保持可见，不被长文件列表挤出主要视口

#### Scenario: first file is focused by default
- **WHEN** rewind preview 至少包含一个受影响文件
- **THEN** 系统 SHALL 默认选中第一条文件
- **AND** 右侧区域 SHALL 展示该文件的 diff 预览或空态

#### Scenario: read-only accessed files are excluded from rewind preview
- **WHEN** rewind preview 收集到仅来自 `read_file`、`batch_read`、搜索或列表类只读工具的文件路径
- **THEN** 系统 MUST NOT 将这些文件展示为受影响文件
- **AND** 这些只读路径 MUST NOT 占用默认选中项或文件计数

#### Scenario: rewind preview does not cross the anchor boundary backward
- **WHEN** 系统基于某条目标用户消息构建 rewind preview
- **THEN** 系统 MUST 仅收集该目标用户消息及其后的 assistant/tool 事实中的文件
- **AND** 目标消息之前出现的读取文件 MUST NOT 因路径重合或上下文引用被纳入受影响文件列表

#### Scenario: mutation files remain eligible even when no inline diff is present
- **WHEN** rewind preview 中的某个文件来源于 `edit/create/delete/rename` 或等价 mutation `fileChange` 事实
- **AND** 当前条目缺少 inline diff
- **THEN** 系统 SHALL 继续将该文件保留在受影响文件列表中
- **AND** 右侧区域 SHALL 展示可恢复空态，而不是把该文件当作只读噪音过滤掉

### Requirement: Claude Rewind Strategy Selection

Claude rewind 确认弹层 MUST 提供三种互斥策略选择，用于显式决定消息 rewind 与 workspace 文件恢复的组合行为。

#### Scenario: strategy options replace the legacy file toggle
- **WHEN** 用户打开 Claude rewind 确认弹层
- **THEN** 系统 MUST 展示三个单选策略选项
- **AND** 系统 MUST NOT 再展示旧的“回退工作区文件”toggle

#### Scenario: messages and files strategy keeps full rewind behavior
- **WHEN** 用户选择 `messages-and-files` 并确认
- **THEN** 系统 MUST 执行消息 rewind
- **AND** 系统 MUST 执行相关 workspace 文件恢复

#### Scenario: messages only strategy skips file restore
- **WHEN** 用户选择 `messages-only` 并确认
- **THEN** 系统 MUST 执行消息 rewind
- **AND** 系统 MUST NOT 改写当前 workspace 文件

#### Scenario: files only strategy skips message rewind
- **WHEN** 用户选择 `files-only` 并确认
- **THEN** 系统 MUST 仅执行 workspace 文件恢复
- **AND** 系统 MUST NOT 改写当前会话消息历史
