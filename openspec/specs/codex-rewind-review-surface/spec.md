# codex-rewind-review-surface Specification

## Purpose

定义 Codex rewind 确认流程中的紧凑文件审查布局、单文件 diff 导航、导出协议与执行安全边界，确保当前实现与 Claude 已验证的回溯恢复规则保持一致，同时避免引入新的文件身份分叉。
## Requirements
### Requirement: Compact Review Surface For Codex Rewind

Codex rewind 确认流程 MUST 使用紧凑文件审查结构，并且受影响文件集合 MUST 仅包含目标用户消息锚点尾部区间内、会改变 workspace 语义的 mutation 文件事实，避免只读访问文件或锚点之前的上下文文件混入真正将被回退或导出的候选集合。

#### Scenario: rewind entry is only available for supported codex sessions

- **WHEN** 当前会话引擎为 `codex` 且存在可回溯目标
- **THEN** 系统 MUST 显示 rewind 入口并允许进入确认流程
- **AND** 非 `codex` / `claude` 引擎 MUST NOT 因本能力接入而误显示 rewind 入口

#### Scenario: affected files remain independently scrollable

- **WHEN** Codex rewind preview 包含多个受影响文件
- **THEN** 文件列表 SHALL 使用独立滚动区域
- **AND** 目标信息与影响摘要 SHALL 保持可见，不被长文件列表挤出主要视口

#### Scenario: first file is focused by default

- **WHEN** Codex rewind preview 至少包含一个受影响文件
- **THEN** 系统 SHALL 默认选中第一条文件
- **AND** 右侧区域 SHALL 展示该文件的 diff 预览或空态

#### Scenario: read-only accessed files are excluded from codex rewind preview

- **WHEN** Codex rewind preview 收集到仅来自 `read_file`、`batch_read`、搜索或列表类只读工具的文件路径
- **THEN** 系统 MUST NOT 将这些文件展示为受影响文件
- **AND** 这些只读路径 MUST NOT 占用默认选中项或文件计数

#### Scenario: rewind preview does not cross the anchor boundary backward

- **WHEN** 系统基于某条目标用户消息构建 Codex rewind preview
- **THEN** 系统 MUST 仅收集该目标用户消息及其后的 assistant/tool 事实中的文件
- **AND** 目标消息之前出现的读取文件 MUST NOT 因路径重合或上下文引用被纳入受影响文件列表

#### Scenario: mutation files remain eligible even when no inline diff is present

- **WHEN** Codex rewind preview 中的某个文件来源于 `edit/create/delete/rename`、Bash 创建/删除或等价 mutation `fileChange` 事实
- **AND** 当前条目缺少 inline diff
- **THEN** 系统 SHALL 继续将该文件保留在受影响文件列表中
- **AND** 右侧区域 SHALL 展示可恢复空态，而不是把该文件当作只读噪音过滤掉

### Requirement: Codex Rewind File Diff Preview And Navigation

Codex rewind 确认弹层 MUST 支持单文件 diff 预览，并在同一确认流程内查看完整 diff。

#### Scenario: click file switches preview

- **WHEN** 用户点击某个受影响文件
- **THEN** 弹层 SHALL 切换当前选中文件
- **AND** diff 预览区域 SHALL 更新为该文件内容

#### Scenario: file can open full diff overlay

- **WHEN** 用户在 Codex rewind review surface 上触发“查看完整 diff”
- **THEN** 系统 SHALL 在当前确认流程内打开完整 diff overlay
- **AND** overlay SHALL 展示当前选中文件的完整 diff 内容或原始 diff 文本

#### Scenario: missing diff is recoverable

- **WHEN** 当前文件没有可解析 diff
- **THEN** 弹层 SHALL 显示可恢复空态说明
- **AND** rewind 确认与文件切换交互 MUST 保持可用

### Requirement: Codex Rewind File Export Uses Default Chat Diff Directory

Codex rewind 确认弹层 MUST 支持将受影响文件导出到默认全局 chat diff 目录，并复用共享导出协议。

#### Scenario: export writes files into codex engine folder

- **WHEN** 用户点击“存储变更”
- **THEN** 系统 SHALL 将文件写入 `~/.ccgui/chat-diff/codex/{YYYY-MM-DD}/{sessionId}/{targetMessageId}/files/`
- **AND** 同级目录 SHALL 生成 `manifest.json`

#### Scenario: manifest preserves codex rewind metadata

- **WHEN** 导出成功
- **THEN** `manifest.json` SHALL 记录 `conversationLabel`、`workspaceRoot`、`fileCount`
- **AND** 每个导出文件 SHALL 记录 `sourcePath` 与 `storedPath`

#### Scenario: repeated export replaces same rewind snapshot

- **WHEN** 用户对同一 `sessionId + targetMessageId` 重复执行“存储变更”
- **THEN** 系统 SHALL 复用同一个导出根目录
- **AND** 新导出 SHALL 替换旧快照内容

#### Scenario: export failure does not block codex rewind review surface

- **WHEN** 文件导出失败
- **THEN** 系统 SHALL 向用户展示可恢复错误信息
- **AND** Codex rewind 确认弹层 MUST 继续允许切换文件、查看 diff 与取消/确认回溯

### Requirement: Codex Rewind Execution Safety MUST Match Validated Restore Rules

Codex rewind 在执行会话回溯前后 MUST 保持工作区恢复语义一致，并覆盖无 diff、失败回滚边界；当用户选择 `messages-only` 时，系统 MUST 跳过工作区恢复步骤但保持会话回溯链路可用；当用户选择 `files-only` 时，系统 MUST 跳过消息 rewind 但保持工作区恢复链路可用。

#### Scenario: missing inline diff still restores via kind or structured fields when restore behavior is enabled
- **WHEN** 文件变更条目缺少 inline diff
- **AND** 条目仍可提供可判定 kind 或 structured `old_string/new_string`
- **AND** 用户确认 rewind 时选择会恢复 workspace 的策略
- **THEN** 系统 MUST 继续执行文件恢复，而不是直接跳过
- **AND** 恢复结果 SHALL 可预测且可回归验证

#### Scenario: specific kind wins over generic modified when restore behavior is enabled
- **WHEN** 同一路径的变更来源同时出现 `modified` 与更具体 kind（`add/delete/rename`）
- **AND** 用户确认 rewind 时选择会恢复 workspace 的策略
- **THEN** 系统 MUST 优先采用更具体 kind 作为恢复语义
- **AND** 不得因为 generic kind 覆盖而产生错误恢复结果

#### Scenario: rewind fork failure rolls workspace snapshots back when message rewind and restore are both enabled
- **WHEN** 工作区恢复已应用但会话 rewind/fork 失败
- **AND** 用户确认 rewind 时选择 `messages-and-files`
- **THEN** 系统 MUST 自动恢复回溯前快照
- **AND** 用户侧不得残留半回溯状态文件

#### Scenario: first user anchor avoids meaningless fork session
- **WHEN** 回溯目标命中会话首条 user message
- **THEN** 系统 MUST 执行首条锚点专用生命周期策略
- **AND** 不得生成无意义 fork 线程

#### Scenario: workspace restore is skipped when messages only is selected
- **WHEN** 用户在 Codex rewind 确认弹层选择 `messages-only` 并确认回溯
- **THEN** 系统 MUST 跳过 workspace 文件恢复与快照回滚逻辑
- **AND** 系统 MUST 继续执行会话回溯主链路

#### Scenario: message rewind is skipped when files only is selected
- **WHEN** 用户在 Codex rewind 确认弹层选择 `files-only` 并确认回溯
- **THEN** 系统 MUST 执行 workspace 文件恢复
- **AND** 系统 MUST NOT 触发消息 rewind 或 fork 链路

### Requirement: Codex Rewind Strategy Selection

Codex rewind 确认弹层 MUST 提供三种互斥策略选择，用于显式决定消息 rewind 与 workspace 文件恢复的组合行为。

#### Scenario: strategy options replace the legacy file toggle
- **WHEN** 用户打开 Codex rewind 确认弹层
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
