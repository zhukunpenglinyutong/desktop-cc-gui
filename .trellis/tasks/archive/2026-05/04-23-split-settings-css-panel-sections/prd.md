# Split settings CSS panel sections into stable shards

> **【2026-05-16 STATUS: SUPERSEDED BY `05-16-migrate-css-to-coss-ui`】**
> 全量 CSS 架构迁移到 coss.ui 已启动，旧 `settings.part1/2.css` 整体将被删除（clean-slate）。再做 large-file gate 拆分已无意义。本任务 archive。

## Goal
在不改变 `settings` 面板现有 selector contract、cascade 顺序和用户可见样式结果的前提下，将 `src/styles/settings.part1.css` 与 `src/styles/settings.part2.css` 按自然 section 边界拆分成更小的 panel shard，先把这两个文件都压回当前 `styles` policy 的 hard gate 以下。

## Requirements
- 将 `settings.part1.css` 中 `Vendor Settings` section 抽到独立 shard 文件。
- 将 `settings.part2.css` 中 `Basic settings redesign` section 抽到独立 shard 文件。
- 保持 `src/styles/settings.css` 作为聚合入口，并维持等价的 import order。
- 不修改任何现有 class selector、CSS variable 名称或 DOM contract。
- 拆分后 `settings.part1.css` 与 `settings.part2.css` 都必须低于当前 `styles` policy 的 fail threshold。

## Acceptance Criteria
- [ ] 新增承载 `Vendor Settings` section 的独立 CSS shard。
- [ ] 新增承载 `Basic settings redesign` section 的独立 CSS shard。
- [ ] `src/styles/settings.css` 的 import 顺序调整后仍保持等价 cascade。
- [ ] `src/styles/settings.part1.css` 和 `src/styles/settings.part2.css` 行数都降到 `2800` 以下。
- [ ] `npm run check:large-files:gate` 通过。

## Technical Notes
- OpenSpec change: `split-settings-css-panel-sections`
- 本轮只做 section-level extraction，不重命名 selector、不改组件 DOM、不引入 CSS module/SCSS。
