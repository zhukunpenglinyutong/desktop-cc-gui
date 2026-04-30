# workspace-note-card-pool Specification Delta

## ADDED Requirements

### Requirement: Right Panel MUST Provide A Note Card Entry

系统 MUST 在右侧面板顶区 action zone 提供 note card icon 入口，该区域与文件夹、搜索等现有操作同层。

#### Scenario: note icon appears in the right panel top zone

- **WHEN** 用户处于任意 workspace 会话视图且右侧面板可见
- **THEN** 系统 MUST 在右侧面板顶区渲染 note card icon
- **AND** 该入口 MUST 提供 tooltip 或 accessibility label

#### Scenario: note icon follows existing right-panel visibility rules

- **WHEN** 当前布局触发既有右侧面板隐藏、收起或 compact 规则
- **THEN** note card icon MUST 跟随同一套 show/hide 行为
- **AND** 系统 MUST NOT 为 note card 入口创建独立的显隐状态模型

### Requirement: Note Card Surface MUST Stay Lightweight

系统 MUST 提供轻量 note card surface，并且只包含 `便签池` 与 `便签归档` 两个集合。

#### Scenario: opening note cards keeps the current conversation flow intact

- **WHEN** 用户点击 note card icon
- **THEN** 右侧面板 MUST 切换到 note card surface
- **AND** 默认 MUST 打开 `便签池`
- **AND** 当前 conversation/workspace 上下文 MUST 保持不变

#### Scenario: archive view stays in the same surface family

- **WHEN** 用户在 note card surface 中切换到 `便签归档`
- **THEN** 系统 MUST 在同一右侧 surface 中展示 archived notes
- **AND** 系统 MUST NOT 要求进入 full-screen modal、目录树或管理后台式多层视图

### Requirement: Quick Capture MUST Support Formatted Copy And Images

系统 MUST 支持快速录入 note card，包含格式化文案能力与图片插入能力。

#### Scenario: user saves a quick note without leaving the current workspace flow

- **WHEN** 用户在 note card surface 输入标题和正文并保存
- **THEN** 系统 MUST 将该 note 保存到当前项目的 `便签池`
- **AND** 用户 MUST 无需离开当前 workspace 或 thread 才能完成记录

#### Scenario: title can fall back from content

- **WHEN** 用户保存 note 时未填写标题
- **THEN** 系统 MUST 使用正文首条非空文本生成回退标题
- **AND** 若正文也没有有效文本，系统 MUST 提供稳定的默认标题

#### Scenario: image insertion supports preview and removal

- **WHEN** 用户通过上传、粘贴或拖拽向 note 中插入图片
- **THEN** 系统 MUST 在保存前提供图片预览
- **AND** 用户 MUST 可以移除单张待保存图片

#### Scenario: formatting survives save and reopen

- **WHEN** 用户在 note 正文中使用 heading、list、quote、code block、bold、italic 或换行等格式
- **THEN** note 保存并重新打开后 MUST 保留相同的格式语义

#### Scenario: editor can expand within the right panel

- **WHEN** 用户正在新增或编辑 note，并触发编辑器展开操作
- **THEN** 系统 MUST 让编辑区在右侧面板内占用主要高度
- **AND** 用户 MUST 可以恢复到默认“编辑区 + 列表”视图

### Requirement: Query MUST Be Collection-Scoped And Fast To Scan

系统 MUST 在 `便签池` 与 `便签归档` 内分别提供关键词查询，并返回适合快速扫描的结果信息。

#### Scenario: searching in pool only returns active notes

- **WHEN** 用户位于 `便签池` 并输入查询关键词
- **THEN** 系统 MUST 仅搜索 active notes
- **AND** 结果 MUST 展示标题、摘要片段、更新时间与图片数量等轻量信息

#### Scenario: searching in archive only returns archived notes

- **WHEN** 用户位于 `便签归档` 并输入查询关键词
- **THEN** 系统 MUST 仅搜索 archived notes
- **AND** 系统 MUST NOT 在 archive 结果中混入 active notes

### Requirement: Archive Flow MUST Be Reversible

系统 MUST 支持把 active note 归档，并把 archived note 恢复回 active pool。

#### Scenario: archive an active note

- **WHEN** 用户对 `便签池` 中的 note 执行 archive
- **THEN** 该 note MUST 从 active pool 消失
- **AND** 该 note MUST 出现在 `便签归档`

#### Scenario: restore an archived note

- **WHEN** 用户对 `便签归档` 中的 note 执行 restore
- **THEN** 该 note MUST 返回 `便签池`
- **AND** 其正文、图片与 identity MUST 保持连续

### Requirement: Permanent Delete MUST Stay Lightweight But Explicit

系统 MUST 提供物理删除入口，并在删除 note 时同步移除其本地图片资产。

#### Scenario: deleting a note permanently removes it from the surface

- **WHEN** 用户对 active 或 archived note 执行永久删除
- **THEN** 该 note MUST 从当前 surface 消失
- **AND** 系统 MUST 以轻量确认方式提示此操作不可撤销
