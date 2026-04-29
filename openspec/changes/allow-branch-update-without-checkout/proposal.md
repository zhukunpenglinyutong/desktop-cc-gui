## Why

当前 Git History 分支右键菜单里的 `更新 (Update)` 只允许作用于当前分支，本质上复用了 `git pull` 语义，因此必须切到目标分支后才能执行。这个限制和用户在 IDE（如 IntelliJ IDEA）里的心智不一致，也让“顺手维护别的本地跟踪分支”这类高频操作变得低效且容易打断当前工作上下文。

现在需要把 `更新` 从“当前 worktree 的 pull”升级为“目标本地分支的后台更新”语义：在不切换 `HEAD`、不改动当前工作树的前提下，允许用户直接更新其他本地分支，同时保留现有当前分支更新能力与安全边界。

## 目标与边界

- 目标
  - 允许用户在 Git History 的本地分支右键菜单中，直接更新非当前本地分支。
  - 更新过程不得切换当前分支，不得污染当前工作树，不得打断当前项目上下文。
  - 行为语义向 IntelliJ IDEA 的 “更新其他本地分支” 体验靠拢：用户看到的是“目标分支已更新”，不是“当前分支被 pull 了”。
  - 对无 upstream、已分叉、被其他 worktree 占用等高风险场景，提供明确禁用或失败提示。
- 边界
- 本次只改 `Git History` 分支菜单中的 `更新 (Update)` 行为，不改 toolbar `Pull/Sync/Fetch` 的现有语义。
- 不引入自动 checkout、自动 merge、自动 rebase 到当前分支等副作用。
- 不改变现有 `Push`、`Compare`、`Show Diff with Working Tree` 等分支菜单动作语义。
- 不要求首版覆盖复杂历史整合；首版以“安全更新 tracked local branch”为主。
- 实现必须使用 macOS / Windows 兼容写法：Git 命令通过 argv 参数传递，路径使用平台无关 helper，不依赖 shell 拼接或 POSIX-only 行为。
- 实现与测试必须遵守现有 CI sentry：`.github/workflows/heavy-test-noise-sentry.yml` 与 `.github/workflows/large-file-governance.yml`。

## 非目标

- 不把“更新别的分支”做成隐式切换分支后再切回来。
- 不在本次引入交互式冲突解决、跨分支 cherry-pick 编排、批量分支更新。
- 不修改 branch list 分组、ahead/behind 统计口径和 compare 视图架构。
- 不为了支持该能力而放宽当前工作树脏状态保护或 worktree 占用保护。

## What Changes

- 将本地分支右键菜单里的 `更新 (Update)` 从“仅当前分支可用”调整为“满足安全条件的本地 tracked branch 可用”。
- 将 `Update` 的语义从“复用当前 worktree 的 `git pull`”调整为“对目标本地分支执行不切换分支的后台更新”。
- 为非当前本地分支新增显式安全约束：
  - 无 upstream 时禁用并提示原因。
  - 分支存在本地独有提交或已与 upstream 分叉时，不做隐式 merge/rebase，改为阻断并提示用户切换后手动处理。
  - 目标分支若被其他 worktree 占用，阻断更新，避免悄悄改动其他工作目录所依赖的 branch ref。
  - 后端写入 branch ref 时必须使用 expected-old OID 的原子 compare-and-swap，避免判定后分支被其他进程改变时覆盖新提交。
- 保留当前分支上的 `Update` 语义兼容：当前分支仍走现有 update workflow，并保留进行中/完成态反馈。
- 为 `Update` 动作补充更细粒度的反馈：区分“当前分支更新”“后台更新其他本地分支”“仅远程 fetch”三类提示文案与错误原因。

## 技术方案对比

### 方案 A：继续复用当前 `pull_git`，执行前自动 checkout 到目标分支，再切回原分支

- 优点：复用现有 command 最多，实现表面最简单。
- 缺点：会真实改动当前 `HEAD` 与工作树；脏工作树、hooks、conflict、submodule 等副作用全都被带进来；与“当前项目分支不受影响”的需求正面冲突。
- 结论：不采纳。

### 方案 B：先 fetch upstream，再对目标本地分支做 ref 级安全更新（采纳）

- 优点：能保持当前 worktree/HEAD 不动；语义最接近 IDEA；可以把能力边界收敛为“仅允许 fast-forward 安全更新”，风险可控。
- 缺点：需要新增 target-branch-aware backend contract，并补 worktree 占用/分叉检测。
- 结论：采纳。

### 方案 C：把非当前分支 `Update` 降级为纯 `Fetch`

- 优点：完全不碰本地 branch ref，风险最低。
- 缺点：用户看到“更新”却只刷新 remote-tracking ref，不会真正更新本地分支，和 IDEA 及用户预期不一致。
- 结论：不采纳。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `git-operations`: 扩展分支菜单 `更新 (Update)` 的 requirement，从“仅当前分支 update workflow”升级为“支持非当前本地 tracked branch 的无切换后台更新”，并补充分叉/无 upstream/worktree 占用的 guardrail。
- `git-branch-management`: 调整分支右键菜单中 `Update` 的可用性矩阵与提示语义，使非当前本地分支在满足安全条件时可执行更新，而不是统一禁用。

## Impact

- 前端
  - `src/features/git-history/components/git-history-panel/hooks/useGitHistoryPanelInteractions.tsx`
  - `src/features/git-history/components/GitHistoryPanel.test.tsx`
  - `src/services/tauri.ts`
  - `src/i18n/locales/en.part1.ts`
  - `src/i18n/locales/zh.part1.ts`
- 后端
  - `src-tauri/src/git/commands_branch.rs`
  - `src-tauri/src/git/commands.rs`
  - `src-tauri/src/command_registry.rs`
  - `src-tauri/src/bin/cc_gui_daemon.rs`
  - `src-tauri/src/bin/cc_gui_daemon/git.rs`
  - 可能复用/扩展 `src-tauri/src/shared/git_core.rs` 的 tracking / remote / worktree 探测能力
- 系统影响
  - 需要新增一个不依赖当前 `HEAD` 的 target branch update contract，不能继续把 `pull_git` 当作等价实现。
  - 需要补充分支状态判定与错误归因，避免把“分叉不可自动更新”误报成普通网络失败。
  - 需要保持新增 Git command path 的 macOS / Windows 兼容性，避免 shell quoting 与路径分隔符差异。
  - 需要遵守 heavy-test-noise 与 large-file governance CI 门禁，避免测试噪声和大文件债务。
  - 不新增第三方依赖。

## 验收标准

- 在 Git History 分支列表中，非当前本地分支若存在有效 upstream 且满足安全条件，右键菜单 `更新 (Update)` 必须可点击。
- 用户触发非当前本地分支 `Update` 后，系统不得切换当前分支，不得改动当前工作树文件，不得改变当前面板中的 current branch 指示。
- 更新成功后，目标本地分支的提交位置、ahead/behind 指标和 tracking 摘要必须刷新为最新状态。
- 当前分支的 `Update` 行为必须继续可用，且语义保持现有 update workflow 兼容。
- 本地分支无 upstream 时，`Update` 必须禁用，并显示可读原因。
- 本地分支与 upstream 已分叉或存在非 fast-forward 更新风险时，系统必须阻断并提示用户切换到该分支后手动处理，而不是隐式 merge/rebase。
- 目标分支被其他 worktree 占用时，系统必须阻断更新，并给出明确提示，不得强行改写该分支引用。
- 若 fetch 后、ref 写入前目标本地分支被其他进程改变，系统必须阻断并提示刷新重试，不得覆盖新的本地提交。
- 新增 Git 命令调用必须在 macOS / Windows 兼容写法下实现，不得依赖 shell 字符串拼接、硬编码路径分隔符或个人机器路径。
- 质量门禁必须覆盖 `npm run check:heavy-test-noise`、`npm run check:large-files:near-threshold`、`npm run check:large-files:gate`。
- 自动化测试至少覆盖：
  - 非当前 tracked branch 成功更新
  - 当前分支 update 回归
  - 无 upstream 禁用
  - 分叉阻断
  - worktree 占用阻断
  - stale ref compare-and-swap 阻断
  - remote branch update 仍只 fetch 对应 remote
  - frontend action availability + tauri payload mapping
