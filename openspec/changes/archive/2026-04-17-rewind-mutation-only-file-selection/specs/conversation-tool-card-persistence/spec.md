## MODIFIED Requirements

### Requirement: Shared File Identity Contract For File Changes

`File changes` file rows SHALL 使用与现有 edit-related entry points、rewind review surfaces、persisted file-export records 相同的 file-path identity contract；只有目标用户消息锚点尾部区间内的 mutation-derived 文件事实才允许进入 rewind review/export 候选集合，只读工具路径与锚点之前的路径 MUST NOT 被提升为同等级 rewind 文件身份。

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
