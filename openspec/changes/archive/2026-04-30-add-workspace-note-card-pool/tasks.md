## 1. Storage Contract

- [x] 1.1 [P0][depends:none][input: proposal + `src-tauri/src/app_paths.rs` + existing file-based storage patterns][output: note-card path resolver and DTO contract][verify: design/spec path rules map cleanly to `~/.ccgui/note_card/<project-name>/active|archive`] 定义 note-card 存储模型、项目目录解析与 attachment metadata。
- [x] 1.2 [P0][depends:1.1][input: note-card DTO contract][output: backend commands for create/list/get/archive/restore/search][verify: command names and payloads are documented and aligned with spec deltas] 明确 note-card command surface 与 typed payload。
- [x] 1.3 [P1][depends:1.2][input: image insertion requirement][output: attachment persistence and orphan-cleanup strategy][verify: design records draft-vs-committed asset handling and rollback behavior] 收口图片资产保存与取消保存清理策略。
- [x] 1.4 [P1][depends:1.3][input: preview/delete feedback][output: image preview fallback and hard-delete asset cleanup contract][verify: specs/design cover `~/.ccgui/note_card/**` preview fallback and delete-time asset cleanup] 补齐图片回显兜底与物理删除清理契约。

## 2. Right Panel Surface

- [x] 2.1 [P0][depends:1.2][input: existing right-panel top actions][output: note icon insertion plan for the file/search top zone][verify: impact list covers `PanelTabs/right-toolbar` / layout visibility hooks and existing hide-show rules] 设计入口接线与显隐继承策略。
- [x] 2.2 [P0][depends:2.1][input: lightweight UX constraints][output: note-card surface IA for `便签池` + `便签归档`][verify: no modal-first or admin-table assumptions remain in design/specs] 定义轻量 surface 结构与切换流。
- [x] 2.3 [P0][depends:2.2][input: formatting + image requirements][output: quick-capture editor behavior contract][verify: specs cover title fallback, markdown semantics, image preview/removal] 定义快速录入行为。
- [x] 2.4 [P1][depends:2.2][input: query/archive requirements][output: search, archive, restore flows for the surface][verify: specs separate active/archive query semantics and reversible archive behavior] 定义查询与归档恢复流。
- [x] 2.5 [P1][depends:2.3,2.4][input: user feedback from panel testing][output: editor maximize and delete affordance behavior][verify: specs cover expanded editor mode and permanent delete action without platformized UI] 补齐编辑器最大化与物理删除交互。

## 3. Composer Reference

- [x] 3.1 [P0][depends:1.2][input: existing `@` / `@@` composer triggers][output: `@#` trigger contract and isolation rules][verify: specs explicitly protect file-reference and memory-reference behavior] 定义 `@#` trigger 入口与既有 trigger 隔离。
- [x] 3.2 [P0][depends:3.1][input: note query projection][output: note picker search/ranking rules][verify: specs cover active-first ordering and archive labeling] 定义候选搜索、排序与展示规则。
- [x] 3.3 [P0][depends:3.2][input: send pipeline + note content model][output: chip-based selection and send-time injection plan][verify: specs cover one-shot clearing and image-reference preservation] 定义引用挂载与发送注入语义。

## 4. Validation And Delivery

- [x] 4.1 [P0][depends:1.1,2.4,3.3][input: final proposal/design/spec artifacts][output: complete OpenSpec package][verify: `openspec status --change add-workspace-note-card-pool` shows proposal/design/specs/tasks done] 补齐并自检全部 OpenSpec artifact。
- [x] 4.2 [P1][depends:4.1][input: impacted modules list][output: implementation verification matrix][verify: matrix covers frontend, backend, storage, composer reference, image flow, hide-show behavior] 为后续 apply 阶段准备验证清单。
