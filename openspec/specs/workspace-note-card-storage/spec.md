# workspace-note-card-storage Specification

## Purpose
TBD - created by archiving change add-workspace-note-card-pool. Update Purpose after archive.
## Requirements
### Requirement: Note Cards MUST Be Stored Under Project-Scoped Local Folders

系统 MUST 将 note card 数据存储到用户电脑 `~/.ccgui/note_card/<project-name>/` 下，并按 `active` / `archive` 目录区分活跃与归档集合。

#### Scenario: first save initializes project note-card folders

- **WHEN** 用户首次在某个项目中保存 note card
- **THEN** 系统 MUST 创建 `~/.ccgui/note_card/<project-name>/active/`
- **AND** 系统 MUST 创建 `~/.ccgui/note_card/<project-name>/archive/`

#### Scenario: project folder name derives from project name safely

- **WHEN** 系统为某个项目解析 note card 存储目录
- **THEN** 目录名 MUST 来源于当前项目名
- **AND** 系统 MUST 对目录名执行 filesystem-safe sanitization

### Requirement: Note Documents MUST Preserve Formatted Body And Image Attachments

系统 MUST 以结构化 note document 持久化正文与图片附件，确保 reopen、query 与 reference 都可复用同一份 canonical data。

#### Scenario: formatted body is stored as canonical note content

- **WHEN** 用户保存包含格式化文案的 note
- **THEN** 系统 MUST 持久化该 note 的 canonical body content
- **AND** reopen 后 MUST 能恢复相同的格式语义

#### Scenario: image assets are stored inside the project note-card area

- **WHEN** 用户保存包含图片的 note
- **THEN** 系统 MUST 将图片文件保存到当前项目的 note-card 存储区域
- **AND** note document MUST 记录稳定的 attachment references

### Requirement: Archive MUST Use Physical Collection Separation

系统 MUST 通过 active/archive 集合切换表达归档状态，而不是仅依赖前端临时过滤。

#### Scenario: archiving moves the note into archive collection

- **WHEN** 某条 active note 被归档
- **THEN** 该 note 的持久化文档 MUST 从 active collection 迁移到 archive collection
- **AND** note id MUST 保持不变

#### Scenario: restoring moves the note back into active collection

- **WHEN** 某条 archived note 被恢复
- **THEN** 该 note 的持久化文档 MUST 回到 active collection
- **AND** 图片资产引用 MUST 继续有效

### Requirement: Preview And Delete MUST Respect The Note Card Storage Area

系统 MUST 正确预览和清理 `~/.ccgui/note_card/<project-name>/` 下的图片资产。

#### Scenario: preview can fall back for note-card-local images

- **WHEN** note surface 回显位于 `~/.ccgui/note_card/**` 的本地图片
- **THEN** 系统 MUST 提供稳定的预览结果
- **AND** MUST NOT 假设图片一定与 workspace 根目录同源

#### Scenario: permanent delete cleans the note asset folder

- **WHEN** 用户永久删除某条 note
- **THEN** 对应的 note document MUST 被物理删除
- **AND** `assets/<note-id>/` MUST 一起被清理

### Requirement: Storage MUST Expose Lightweight Query Projection

系统 MUST 为 note list/query 返回 lightweight projection，避免每次列表扫描都加载完整正文或图片二进制。

#### Scenario: list query returns note projections without binary image payload

- **WHEN** note card surface 请求列表或搜索结果
- **THEN** 存储层 MUST 返回标题、摘要片段、更新时间、图片数量和归档状态等轻量字段
- **AND** 系统 MUST NOT 为普通列表查询读取图片二进制内容

