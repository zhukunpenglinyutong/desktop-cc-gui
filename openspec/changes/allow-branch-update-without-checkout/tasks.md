## 1. 后端 update contract 设计落地（P0）

- [x] 1.1 [依赖: 无] 在 `src-tauri/src/git/commands_branch.rs` 定义 branch-targeted update command 签名与返回模型（输入：OpenSpec design + specs；输出：`update_git_branch` command skeleton 与 outcome 类型；验证：编译通过且 command contract 可被 frontend 映射）。
- [x] 1.2 [依赖: 1.1] 在 `src-tauri/src/command_registry.rs` 注册新 command，并在 `src/services/tauri.ts` 增加 service 映射（输入：backend command 名称与 payload；输出：frontend 可调用的 `updateGitBranch(workspaceId, branch)`；验证：Tauri invoke 名称、参数名、返回结构一致）。
- [x] 1.3 [依赖: 1.1] 同步 daemon command path（输入：普通 Tauri command contract；输出：`src-tauri/src/bin/cc_gui_daemon.rs` dispatch 与 `src-tauri/src/bin/cc_gui_daemon/git.rs` 实现保持一致；验证：daemon 模式不会缺少 `update_git_branch` 能力）。

## 2. 后端安全更新流程（P0）

- [x] 2.1 [依赖: 1.1] 实现目标分支 upstream 解析与 current/non-current 分流（输入：workspaceId + branchName；输出：当前分支委托现有 `pull_git`、非当前分支进入后台更新路径；验证：current branch 路径保持兼容，non-current 路径不触发 checkout）。
- [x] 2.2 [依赖: 2.1] 实现非当前分支的 `fetch -> 关系重算 -> fast-forward only` 主流程（输入：目标 branch 与 upstream；输出：behind-only 时前移本地 branch ref；验证：成功更新后目标分支 ref 变化且当前 `HEAD` 不变）。
- [x] 2.3 [依赖: 2.2] 实现 no-op 判定（输入：local/upstream 最新关系；输出：`already-up-to-date` 与 `ahead-only` 两类 no-op 结果；验证：无更新时不报错且前端可区分提示）。
- [x] 2.4 [依赖: 2.2] 使用 expected-old OID compare-and-swap 写入目标 branch ref（输入：fetch 后的 local old OID 与 upstream new OID；输出：`git update-ref refs/heads/<branch> <new> <old>` 或等价原子写入；验证：old OID 不匹配时不会覆盖目标分支）。
- [x] 2.5 [依赖: 2.1,2.4] 审核新增 Git 命令的 macOS / Windows 兼容写法（输入：所有新增 Git 调用与路径处理；输出：argv 参数数组 + `Path`/`PathBuf`/现有 workspace helper，无 shell 拼接、无硬编码路径分隔符；验证：branch/remote/ref/path 作为独立参数传递）。

## 3. 风险场景 guardrail（P0）

- [x] 3.1 [依赖: 2.1] 实现无 upstream 阻断与可读错误归因（输入：未配置 tracking 的本地分支；输出：blocked outcome；验证：菜单原因与 command 返回一致）。
- [x] 3.2 [依赖: 2.2] 实现分叉分支阻断（输入：ahead>0 且 behind>0 的分支；输出：blocked outcome + 手动 checkout 处理提示；验证：不会发生隐式 merge/rebase）。
- [x] 3.3 [依赖: 2.2] 实现 worktree 占用检测与阻断（输入：被其他 worktree checkout 的 branch；输出：blocked outcome + 占用提示；验证：不会强行更新被占用分支 ref）。
- [x] 3.4 [依赖: 2.4] 实现 stale-ref 阻断（输入：ref 写入前目标分支被其他进程改变；输出：`blocked` + `stale_ref` reason；验证：不会覆盖新 local commit，提示刷新后重试）。
- [x] 3.5 [依赖: 2.2,3.1,3.2,3.3,3.4] 统一失败、blocked、no-op、success 四类结果的错误/状态映射（输入：Git 执行结果与 guardrail 分支；输出：稳定 outcome model + machine-readable reason；验证：前端无需解析杂乱 stderr 即可展示正确提示）。

## 4. 前端菜单接线与提示语义（P0）

- [x] 4.1 [依赖: 1.2,3.5] 调整 `useGitHistoryPanelInteractions.tsx` 的本地分支 `Update` 可用性矩阵（输入：branch row + upstream 状态；输出：非当前 tracked local branch 可点击、无 upstream 禁用；验证：菜单状态与 spec 一致）。
- [x] 4.2 [依赖: 4.1] 将本地分支 `Update` 的执行器切换到新 service，同时保留当前分支现有 update 兼容路径（输入：分支菜单 update action；输出：current 与 non-current 正确分流；验证：不会把非当前分支误发成当前 `pull`）。
- [x] 4.3 [依赖: 3.5,4.2] 更新中英文 i18n 与操作通知文案（输入：success/no-op/blocked/failed 四类 outcome 与 reason；输出：可读提示与禁用原因；验证：zh/en key 完整且提示语义可区分）。
- [x] 4.4 [依赖: 4.2] 补齐操作完成后的 branch list / history summary 刷新时机（输入：update 结果；输出：ahead/behind、tracking 摘要、branch 状态实时刷新；验证：成功更新后 UI 不出现 stale 状态）。
- [x] 4.5 [依赖: 4.2] 明确保留远程分支 `Update` 的 fetch-only 执行器（输入：remote branch row；输出：fetch 对应 remote，不更新任何 local branch；验证：remote branch 菜单行为不回归）。

## 5. 自动化回归测试（P0）

- [x] 5.1 [依赖: 2.3,3.5] 增加 Rust 侧 command 测试，覆盖 current branch 回归、non-current fast-forward success、up-to-date no-op、ahead-only no-op（输入：本地仓库 fixture；输出：backend 行为断言；验证：`cargo test --manifest-path src-tauri/Cargo.toml` 相关用例通过）。
- [ ] 5.2 [依赖: 3.2,3.3,3.4] 增加 Rust 侧 guardrail 测试，覆盖 diverged blocked、occupied-worktree blocked 与 stale-ref blocked（输入：分叉/占用/并发变更场景 fixture；输出：blocked outcome 断言；验证：不会触发错误 ref 前移）。
- [x] 5.3 [依赖: 4.5] 增加 `GitHistoryPanel.test.tsx` 回归测试，覆盖非当前 tracked branch 可点击 update、无 upstream 禁用、payload mapping、结果提示、刷新链路、remote branch fetch-only 行为（输入：branch menu 交互 fixture；输出：前端行为断言；验证：Vitest 通过）。
- [x] 5.4 [依赖: 2.5,5.1] 增加或复用跨平台命令构造测试（输入：含空格或特殊字符的 branch/ref 名 fixture；输出：不依赖 shell quoting 的参数断言；验证：macOS / Windows 兼容约束可被测试或 code review 明确覆盖）。

## 6. 质量门禁与实现收尾（P0）

- [x] 6.1 [依赖: 5.1,5.2,5.3,5.4] 运行最小质量门禁（输入：本次改动；输出：类型、runtime contract、前端测试、Rust 测试全部通过；验证：`npm run typecheck`、`npm run test`、`npm run check:runtime-contracts`、`cargo test --manifest-path src-tauri/Cargo.toml` 全 green）。
- [x] 6.2 [依赖: 6.1] 遵守 heavy-test-noise sentry（输入：新增/修改测试与日志输出；输出：无过量日志噪声；验证：`npm run check:heavy-test-noise` 通过，对齐 `.github/workflows/heavy-test-noise-sentry.yml`）。
- [x] 6.3 [依赖: 6.1] 遵守 large-file governance sentry（输入：触碰的大型 hook/component/test/css 文件；输出：无新增大文件硬债或近阈值失控；验证：`npm run check:large-files:near-threshold` 与 `npm run check:large-files:gate` 通过，对齐 `.github/workflows/large-file-governance.yml`）。
- [ ] 6.4 [依赖: 6.1,6.2,6.3] 执行手工验收与回滚预案核对（输入：桌面端真实仓库场景；输出：current branch 不受影响、非当前分支安全更新通过、分叉/占用阻断有效的验收记录；验证：满足 proposal 验收标准并记录回滚入口）。
