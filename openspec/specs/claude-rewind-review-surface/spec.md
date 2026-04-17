# claude-rewind-review-surface Specification

## Purpose
定义 Claude rewind 确认弹层中的文件核对、diff 预览与导出语义，确保用户在执行高风险回溯前可以完成稳定、可恢复的审查与存档动作。
## Requirements
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

### Requirement: Rewind File Diff Preview And Navigation

Claude rewind 确认弹层 MUST 支持单文件 diff 预览，并在同一确认流程内查看完整 diff。

#### Scenario: click file switches preview
- **WHEN** 用户点击某个受影响文件
- **THEN** 弹层 SHALL 切换当前选中文件
- **AND** diff 预览区域 SHALL 更新为该文件内容

#### Scenario: file can open full diff overlay
- **WHEN** 用户在 rewind review surface 上触发“查看完整 diff”
- **THEN** 系统 SHALL 在当前确认流程内打开完整 diff overlay
- **AND** overlay SHALL 展示当前选中文件的完整 diff 内容或原始 diff 文本

#### Scenario: missing diff is recoverable
- **WHEN** 当前文件没有可解析 diff
- **THEN** 弹层 SHALL 显示可恢复空态说明
- **AND** rewind 确认与文件切换交互 MUST 保持可用

### Requirement: Rewind File Export To Default Chat Diff Directory

Claude rewind 确认弹层 MUST 支持将受影响文件导出到默认全局 chat diff 目录。

#### Scenario: export writes files into engine and target specific folder
- **WHEN** 用户点击“存储变更”
- **THEN** 系统 SHALL 将文件写入 `~/.ccgui/chat-diff/{engine}/{YYYY-MM-DD}/{sessionId}/{targetMessageId}/files/`
- **AND** 同级目录 SHALL 生成 `manifest.json`

#### Scenario: export groups files by local calendar date
- **WHEN** 用户在某个自然日触发“存储变更”
- **THEN** 系统 SHALL 使用导出发生时的本地日期生成 `YYYY-MM-DD` 目录层级
- **AND** 同一自然日内的导出 SHALL 落入对应日期目录下

#### Scenario: manifest preserves rewind metadata
- **WHEN** 导出成功
- **THEN** `manifest.json` SHALL 记录 `conversationLabel`、`workspaceRoot`、`fileCount`
- **AND** 每个导出文件 SHALL 记录 `sourcePath` 与 `storedPath`

#### Scenario: relative file path resolves from workspace root
- **WHEN** 受影响文件路径是相对路径
- **THEN** 系统 SHALL 基于当前 workspace root 解析源文件
- **AND** 导出后 SHALL 保留原有相对目录层级

#### Scenario: absolute or file uri sources remain exportable
- **WHEN** 受影响文件路径是绝对路径或 `file://` URI
- **THEN** 系统 SHALL 解析该本地文件并完成导出
- **AND** 若文件不在 workspace 内，导出结果 SHALL 落到 `files/external/...`

#### Scenario: repeated export replaces same rewind snapshot
- **WHEN** 用户对同一 `sessionId + targetMessageId` 重复执行“存储变更”
- **THEN** 系统 SHALL 复用同一个导出根目录
- **AND** 新导出 SHALL 替换旧快照内容

#### Scenario: export failure does not block rewind review surface
- **WHEN** 文件导出失败
- **THEN** 系统 SHALL 向用户展示可恢复错误信息
- **AND** rewind 确认弹层 MUST 继续允许切换文件、查看 diff 与取消/确认回溯

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
