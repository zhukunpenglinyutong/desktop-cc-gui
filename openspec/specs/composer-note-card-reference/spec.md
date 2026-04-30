# composer-note-card-reference Specification

## Purpose
TBD - created by archiving change add-workspace-note-card-pool. Update Purpose after archive.
## Requirements
### Requirement: `@#` MUST Trigger Note Card Picker Without Breaking Existing Triggers

系统 MUST 在 composer 中支持 `@#` 触发 note card picker，并保持现有 `@` 与 `@@` 语义不回退。

#### Scenario: typing `@#` opens note-card picker

- **WHEN** 用户在 composer 中输入 `@#`
- **THEN** 系统 MUST 打开当前项目的 note card candidate picker
- **AND** 候选来源 MUST 限定为当前项目的 note cards

#### Scenario: existing file and memory triggers remain isolated

- **WHEN** 用户输入单个 `@` 或 `@@`
- **THEN** 系统 MUST 继续保留既有 file reference 与 memory reference 语义
- **AND** `@#` 语义 MUST 与它们隔离

### Requirement: Picker MUST Support Search And Archive Awareness

系统 MUST 支持在 note picker 中按标题和正文内容搜索，并明确区分 active 与 archived note。

#### Scenario: active notes rank ahead of archived notes

- **WHEN** 用户通过 `@#` 查询 note cards
- **THEN** active notes MUST 优先展示
- **AND** archived notes MUST 带有明确的 archive 标记

#### Scenario: picker searches both title and body content

- **WHEN** 用户继续输入查询文本
- **THEN** 系统 MUST 使用标题与正文内容作为匹配来源
- **AND** 候选列表 MUST 随查询结果更新

#### Scenario: picker shows image thumbnails for image-backed notes

- **WHEN** 某条 note card 包含图片附件并出现在 `@#` 候选中
- **THEN** picker MUST 为该候选提供至少一张本地图片缩略图预览
- **AND** 高亮预览区 MUST 能展示该 note 的缩略图集合，而不是只显示图片数量

### Requirement: Selection MUST Stay Lightweight Inside Composer

系统 MUST 使用 reference chip 或等价轻量表示承载已选 note，而不是把原始正文直接回填到 composer 文本区。

#### Scenario: selecting a note creates a removable reference chip

- **WHEN** 用户从 `@#` picker 中选择某条 note
- **THEN** composer MUST 展示该 note 的轻量 reference 表示
- **AND** 用户 MUST 可以在发送前移除该选择

#### Scenario: note-card selection does not leak across thread switches

- **WHEN** 用户切换到另一个 thread 或 workspace
- **THEN** 当前会话的已选 note references MUST 不被复用到新会话

### Requirement: Send-Time Injection MUST Preserve Note Content And Image References

系统 MUST 在发送时一次性注入选中的 note 内容，并在发送完成后清空本次 note 选择。

#### Scenario: sending with selected notes injects structured note context once

- **WHEN** 用户带着已选 note references 发送消息
- **THEN** 系统 MUST 将这些 notes 作为结构化 note context 注入本次请求
- **AND** 发送完成后 MUST 清空本次 note 选择

#### Scenario: referenced notes with images preserve image semantics

- **WHEN** 被引用的 note 包含图片附件
- **THEN** 系统 MUST 在发送时保留图片引用语义
- **AND** 系统 MUST 优先复用现有本地图片或文件引用链路，而不是复制一份新的图片资产

#### Scenario: referenced notes render as separate context cards in the curtain

- **WHEN** 用户发送了带 `@#` 引用的消息
- **THEN** 幕布 MUST 将被引用的 note card 作为独立 context card 展示
- **AND** note card 内容 MUST NOT 混入用户普通文本气泡
- **AND** context card MUST 默认以半折叠态展示正文
- **AND** note 图片 MUST 以缩略图展示，并支持点击查看大图预览
- **AND** 同一轮发送产生的 assistant summary item 与 legacy user suffix MUST NOT 在幕布中重复渲染两份相同的 note card
