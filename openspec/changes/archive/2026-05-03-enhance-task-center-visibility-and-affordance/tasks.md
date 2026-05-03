- [x] 1. 定义统一的 Task Center surface visibility contract
- [x] 1.1 梳理 `TaskRunStatus -> severity / affordance / next-step hint` 映射，避免 Workspace Home、Task Center、Kanban 三处各自解释。
- [x] 1.2 明确哪些信息允许进入 Kanban summary，哪些信息必须留在 Task Center detail，防止 planning/execution 边界漂移。
- [x] 1.3 补充兼容性约束：旧 `TaskRun` / `latestRunSummary` 数据缺少新 surface 所需字段时，必须安全回退，不要求数据迁移。

- [x] 2. 强化 `TaskCenterView` 的可见性与干预提示
- [x] 2.1 调整 run list 的状态可见性、排序和摘要表达，让 active / blocked / waiting_input / failed 更容易被扫描到。
- [x] 2.2 在 detail 或 list 层补明显的 next-step hint，让用户知道应该 open conversation、retry 还是等待。
- [x] 2.3 补 focused tests，覆盖状态强调、action hint 与 active-run conflict 可见性。

- [x] 3. 强化 `Workspace Home` 与 Kanban summary affordance
- [x] 3.1 增强 Workspace Home 首屏中的 Task Center summary，让关键 run 不必先进入 detail 才有价值。
- [x] 3.2 增强 Kanban `latestRunSummary` 的状态与短摘要表达，但保持不承载完整控制台。
- [x] 3.3 补 focused tests，覆盖 workspace-scoped summary、kanban summary severity 与 navigation affordance。

- [x] 4. 完成文案、样式与验证
- [x] 4.1 更新 i18n copy 与相关样式，统一状态语义和 intervention 文案。
- [x] 4.2 把 CI / 本地门禁写清楚并执行：OpenSpec validate、focused Vitest、`npm run lint`、`npm run typecheck`。
