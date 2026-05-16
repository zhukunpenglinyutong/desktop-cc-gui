# Split composer rewind modal styles into dedicated shard

> **【2026-05-16 STATUS: SUPERSEDED BY `05-16-migrate-css-to-coss-ui`】**
> 全量 CSS 架构迁移到 coss.ui 已启动，旧 `composer.part1.css` 整体将被删除（clean-slate）。再做 large-file gate 拆分已无意义。本任务 archive。

## Goal
在不改变 `claude-rewind-modal-*` 现有 selector contract、cascade 结果和用户可见回退弹窗样式的前提下，将 `src/styles/composer.part1.css` 末尾的 rewind modal 命名空间抽到独立 shard，先把主文件压回当前 `styles` policy 的 hard gate 以下。

## Requirements
- 将 `composer.part1.css` 中从 `.claude-rewind-modal` 开始的 rewind modal 样式整块迁到独立 shard。
- 保持 `src/styles/composer.css` 作为聚合入口，并维持等价 import order。
- 不修改任何 `claude-rewind-modal-*` selector、CSS variable 或组件 DOM contract。
- 拆分后 `src/styles/composer.part1.css` 需要低于当前 `styles` policy 的 fail threshold。

## Acceptance Criteria
- [ ] 新增承载 rewind modal 命名空间的独立 CSS shard。
- [ ] `src/styles/composer.css` 引入新 shard 后仍保持等价 cascade。
- [ ] `src/styles/composer.part1.css` 行数降到 `2800` 以下。
- [ ] `npm run check:large-files:gate` 通过。

## Technical Notes
- OpenSpec change: `split-composer-rewind-modal-styles`
- 本轮只做 rewind modal 样式 extraction，不改 composer DOM、不改 modal 行为逻辑。
