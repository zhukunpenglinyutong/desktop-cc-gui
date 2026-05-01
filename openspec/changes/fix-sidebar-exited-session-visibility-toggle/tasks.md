## 1. OpenSpec 回写

- [x] 1.1 归纳 exited session visibility 当前存在的视觉噪音与状态漂移问题，明确本 change 的目标、边界与非目标。
- [x] 1.2 修改 `workspace-sidebar-visual-harmony` delta，补充 workspace/worktree icon-level exited visibility affordance、路径级隔离持久化与 ancestor preservation contract。

## 2. 当前实现对齐

- [x] 2.1 新增 exited visibility path persistence helper，按规范化后的 workspace path 读写 hide/show preference。
- [x] 2.2 新增 exited row filtering helper，统一 workspace/worktree hidden count 统计与“保留 running/reviewing descendant ancestor”语义。
- [x] 2.3 将 workspace/worktree 的 show/hide exited 入口从 `ThreadList` 顶部 pill bar 挪到 leading icon 旁的独立 icon button，保留 all-hidden 场景的弱 summary，并确保不与图标/标题重叠。

## 3. 回归验证

- [x] 3.1 补齐并运行针对 exited visibility 的最小回归集，覆盖 workspace 隔离、worktree 隔离、ancestor preservation 与路径 normalize。
- [x] 3.2 运行质量门禁：`vitest` 定向集、`typecheck`、`check:large-files`、`git diff --check`。
- [x] 3.3 补 exited toggle 的 keyboard 回归测试，确保 `Enter/Space` 不会冒泡触发父级 workspace/worktree row 折叠。
