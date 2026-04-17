# conversation-tool-card-persistence Specification

## Purpose
TBD - created by archiving change chat-file-change-diff-persistence. Update Purpose after archive.
## Requirements
### Requirement: Restart-Recoverable Tool Card Persistence
The system MUST persist `commandExecution` and `fileChange` tool cards so they are restart-recoverable in conversation history.

#### Scenario: command execution card survives restart
- **WHEN** a conversation contains at least one `commandExecution` card
- **AND** the application is restarted
- **THEN** reopening the conversation SHALL display that card in history

#### Scenario: file change card survives restart
- **WHEN** a conversation contains at least one `fileChange` card
- **AND** the application is restarted
- **THEN** reopening the conversation SHALL display that card in history with file metadata

### Requirement: Realtime-History Semantic Equivalence For Tool Cards
Tool card semantics MUST stay equivalent between realtime rendering, history replay, and the right-side activity panel.

#### Scenario: realtime card fields are preserved in history replay
- **WHEN** realtime stream emits a `fileChange` card with path/status/diff stats
- **THEN** persisted history SHALL preserve those fields for replay
- **AND** replayed rendering SHALL keep header aggregate and per-file stats consistent

#### Scenario: command output continuity
- **WHEN** realtime stream emits a `commandExecution` card with output text
- **THEN** persisted history SHALL preserve recoverable output payload
- **AND** replayed card SHALL remain readable in history detail view

#### Scenario: tool card and activity panel share file-change summary facts
- **WHEN** the same `fileChange` fact appears in the message tool card and the right-side activity panel
- **THEN** both surfaces SHALL share the same file path and diff summary facts
- **AND** file counts, addition counts, deletion counts, and target path SHALL remain consistent

#### Scenario: tool card and activity panel share command execution identity
- **WHEN** the same `commandExecution` fact appears in the message tool card and the right-side activity panel
- **THEN** both surfaces SHALL point to the same command identity and run state
- **AND** the activity panel SHOULD reuse existing command detail entry points instead of creating a parallel detail model

### Requirement: Shared Diff Entry Contract For File Changes
`File changes` file rows SHALL use the same diff-entry contract as existing edit-related file entry points.

#### Scenario: click file change row opens existing diff flow
- **WHEN** user clicks a file row inside `File changes`
- **THEN** system SHALL route through the existing `onOpenDiffPath` pipeline
- **AND** system SHALL focus the resolved file in the current diff experience

#### Scenario: unresolvable path is handled safely
- **WHEN** the clicked file path cannot be resolved to an available diff target
- **THEN** system SHALL show a recoverable hint instead of crashing
- **AND** conversation interaction SHALL remain available

### Requirement: Shared File Identity Contract For File Changes

`File changes` file rows SHALL use the same file-path identity contract as existing edit-related file entry points, rewind review surfaces, and persisted file-export records；只有目标用户消息锚点尾部区间内的 mutation-derived 文件事实才允许进入 rewind review/export 候选集合，只读工具路径与锚点之前的路径 MUST NOT 被提升为同等级 rewind 文件身份。

#### Scenario: claude rewind preview merges tool changes by source path
- **WHEN** Claude rewind preview 收集多个 tool items 的文件改动
- **THEN** 系统 SHALL 以 `filePath` 作为同一文件的聚合主键
- **AND** 不得为 Claude rewind review surface 引入新的 opaque file identity

#### Scenario: codex rewind preview merges tool changes by source path
- **WHEN** Codex rewind preview 收集多个 tool items 或本地 replay 文件改动
- **THEN** 系统 SHALL 以 `filePath` 作为同一文件的聚合主键
- **AND** 不得为 Codex rewind review surface 引入新的 opaque file identity

#### Scenario: rewind file identity only comes from the anchor tail segment
- **WHEN** 系统为某个 rewind 目标构建文件身份集合
- **THEN** 候选文件 MUST 仅来自目标用户消息本身及其后的 assistant/tool 事实
- **AND** 锚点之前的只读路径 MUST NOT 被提升为 rewind file identity

#### Scenario: read-only tool paths are not promoted to rewind file identity
- **WHEN** 某个文件路径仅出现在 `read_file`、`batch_read`、搜索或列表类只读工具中
- **THEN** 系统 MUST NOT 将该路径提升为 rewind preview、workspace restore 或 export manifest 的候选文件身份
- **AND** 该路径 MUST NOT 参与受影响文件计数

#### Scenario: mutation fact wins when the same path is both read and changed
- **WHEN** 同一路径同时存在只读访问记录与 mutation `fileChange` / edit / delete / rename 记录
- **THEN** 系统 MUST 以 mutation 事实保留该文件的 rewind 身份
- **AND** 系统 MUST NOT 因只读来源生成重复条目或错误分类

#### Scenario: rewind export manifest preserves the same source-path contract
- **WHEN** rewind review surface 导出受影响文件
- **THEN** `manifest.json` SHALL 仅记录来自 mutation 候选集合的 `sourcePath`
- **AND** 前端 preview 与后端导出 SHALL 共享同一源路径语义

#### Scenario: codex local replay remains aligned with rewind file identity
- **WHEN** Codex 本地 session replay 恢复 `fileChange` 工具卡片并且同一会话支持 rewind review surface
- **THEN** replay 后的文件路径语义 SHALL 与 rewind preview / export manifest 保持一致
- **AND** 系统 MUST NOT 为同一源文件生成额外并行身份

### Requirement: Reused Component Behavior Preservation
Integrating conversation card entry points MUST NOT alter behavior of reused Git diff components.

#### Scenario: integration does not override diff component defaults
- **WHEN** conversation-triggered file diff opens via reused component
- **THEN** integration SHALL NOT force-reset component defaults or user preference state
- **AND** existing toolbar and view-mode semantics SHALL remain unchanged

#### Scenario: legacy entry points remain unchanged
- **WHEN** user opens diff from pre-existing entry points (e.g., git panel or batch edit list)
- **THEN** behavior SHALL remain equivalent to pre-change baseline
- **AND** no regression SHALL be introduced by conversation integration

### Requirement: Codex Local Session Replay Preserves Tool Card Semantics

`Codex` 历史恢复若使用本地 session replay，MUST 继续保持 `commandExecution` 与 `fileChange` 工具卡片的实时语义。

#### Scenario: command execution tool survives codex local replay
- **WHEN** `Codex` 本地 session 历史包含命令调用与对应输出
- **THEN** 历史恢复后的 `commandExecution` 卡片 MUST 保留命令身份、状态与可读输出
- **AND** 右侧 activity panel MUST 复用同一命令事实而不是生成新的并行身份

#### Scenario: apply-patch style file edits survive codex local replay
- **WHEN** `Codex` 本地 session 历史包含 `apply_patch` 或等价补丁型文件修改记录
- **THEN** 历史恢复后的 `fileChange` 卡片 MUST 保留受影响文件路径与修改语义
- **AND** 右侧 activity panel MUST 能继续展示对应文件修改事实
