## Context

当前 `Git History` 分支右键菜单中的 `更新 (Update)` 存在两层耦合：

- 前端在 `useGitHistoryPanelInteractions.tsx` 中把本地分支 `Update` 可用性写成了“只有当前分支可用”。
- 后端 `pull_git` command 的语义是当前 worktree 执行 `git pull`，它天然会影响当前 `HEAD` 与工作树。

这意味着现状里的 `Update` 本质不是“更新某个 branch”，而是“对当前工作目录做 pull”。因此只要目标不是当前分支，就不存在安全复用途径。

同时，现有代码已经具备几个可复用基础：

- `list_git_branches` 已返回 `upstream`、`ahead`、`behind` 等 tracking 信息。
- `shared/git_core.rs` 已具备 remote / remote-tracking branch 探测能力。
- Git 写操作统一经 `run_git_command` 执行，跨平台语义相对稳定。

本次设计的核心不是新增一个 UI 动作，而是把 `Update` 从“worktree mutation”重构为“branch ref mutation”，并确保它不会反向污染当前工作上下文。

## Goals / Non-Goals

**Goals:**

- 为分支右键菜单引入 branch-targeted update contract，使非当前本地分支也能被更新。
- 保证非当前分支更新时不切换 `HEAD`、不改动当前工作树、不断开当前上下文。
- 将“后台更新”能力收敛在安全 fast-forward 场景；对无 upstream、分叉、worktree 占用等风险场景做明确阻断。
- 保持当前分支 `Update` 与既有 `pull` 语义兼容，避免 toolbar / 其他入口回归。
- 为前端提供明确的成功 / no-op / blocked / failed 反馈结果，便于 i18n 和回归测试。

**Non-Goals:**

- 不把非当前分支更新实现成“自动 checkout -> pull -> checkout 回来”。
- 不为分叉分支自动执行 merge / rebase / conflict resolution。
- 不改 toolbar `Pull / Sync / Fetch` 的 contract，也不合并它们和 branch menu `Update` 的执行链路。
- 不在首版引入批量更新多个本地分支或 background queue。

## Decisions

### Decision 1: 为分支菜单新增独立 command，而不是扩展 `pull_git`

- 决策
  - 新增 dedicated command，例如 `update_git_branch(workspace_id, branch_name)`，落位在 `src-tauri/src/git/commands_branch.rs`。
  - 前端通过 `src/services/tauri.ts` 暴露 `updateGitBranch(workspaceId, branch)`，分支菜单 `Update` 改走新 command。
- 选择理由
  - `pull_git` 的抽象中心是“当前 worktree pull”；继续往里塞“更新别的本地分支”只会把两个不同语义揉在一起。
  - 独立 command 能把 guardrail、错误映射、测试边界都收束在 branch domain，不污染 toolbar pull contract。
- 备选方案
  - 方案 A：给 `pull_git` 增加 `targetBranch` / `withoutCheckout` 参数。
  - 取舍：表面改动少，但 command 语义混乱，调用方更容易误用。

### Decision 2: 后端采用“两阶段更新”：先 fetch upstream，再决定是否 fast-forward 本地 branch ref

- 决策
  - branch update 的 authoritative flow 固化为：
    1. 解析目标本地分支与 upstream。
    2. 若目标即当前分支，直接委托现有 `pull_git`。
    3. 若目标不是当前分支，先对 upstream 执行定向 `fetch`。
    4. fetch 后重新读取 local/upstream OID 与 ahead/behind 关系。
    5. 只有 `ahead=0 && behind>0` 时，才允许把本地分支 fast-forward 到 upstream。
- 选择理由
  - fetch 后再判定，避免使用过期的 ahead/behind 数据。
  - 这样可以把“有没有远端新提交”和“能不能安全前移本地 ref”拆成两个稳定步骤。
- 备选方案
  - 方案 A：仅根据 branch list 里的旧 `ahead/behind` 直接决定能否更新。
  - 取舍：前端数据不具备强一致性，容易出现 stale judgement。

### Decision 3: 非当前分支只允许 fast-forward；分叉和本地 ahead 不做隐式历史改写

- 决策
  - backend 在 fetch 后使用仓库图关系做最终判定：
    - `local == upstream`：返回 no-op（already up to date）。
    - `ahead=0 && behind>0`：允许 fast-forward。
    - `ahead>0 && behind=0`：返回 no-op / info（本地分支已领先或无需更新）。
    - `ahead>0 && behind>0`：返回 blocked，提示分支已分叉，需要切换到该分支后手动处理。
- 选择理由
  - “不影响当前项目分支能力”的前提下，任何需要 merge / rebase 的路径都不应该在后台偷偷发生。
  - fast-forward only 是最清晰、最可证明安全的首版边界。
- 备选方案
  - 方案 A：对分叉场景自动 merge upstream 到目标 branch。
  - 方案 B：对分叉场景自动 rebase 目标 branch onto upstream。
  - 取舍：两者都会隐式改写目标分支历史，不适合作为无切换后台操作。

### Decision 4: ref 前移采用 expected-old OID compare-and-swap，并补 worktree 占用显式检测

- 决策
  - fetch 继续复用现有 Git CLI 执行路径。
  - 关系判定使用现有仓库读取能力（`git2` / `graph_ahead_behind`）。
  - 在 fetch 后记录目标本地分支的 expected old OID 与 upstream new OID。
  - 真正更新本地分支 ref 时，使用 expected-old OID 的 compare-and-swap 语义，例如 `git update-ref refs/heads/<branch> <new-oid> <old-oid>`。
  - 执行前增加 worktree occupancy 检测；若目标 branch 被其他 worktree checkout，则直接阻断。
  - 如果 compare-and-swap 失败，说明判定后目标分支又被其他进程推进或改写，返回 `blocked` / `stale_ref`，提示用户刷新后重试。
- 选择理由
  - `git branch -f <branch> <remote-ref>` 在关系判定和 ref 写入之间存在 TOCTOU 窗口，可能覆盖刚刚出现的本地提交。
  - `update-ref <new> <old>` 把“我只更新刚才确认过的那个旧提交”编码进 Git 原子写入语义，能防止 stale judgement 造成历史覆盖。
  - 显式 occupancy 检测能让错误更 deterministic，而不是依赖不同平台的 stderr 文案。
- 备选方案
  - 方案 A：使用 `git branch -f <branch> <remote-ref>`。
  - 取舍：实现更直观，但缺少 expected-old 约束，不满足后台更新的并发安全边界。
  - 方案 B：直接通过 libgit2 写 ref。
  - 取舍：可以实现 CAS，但需要自行补齐更多 Git 保护语义；首版优先用 Git CLI 的 `update-ref` 原子能力。

### Decision 5: 前端菜单可用性只做静态快速判定，动态风险统一交给 backend

- 决策
  - 前端将本地分支 `Update` 的静态判定从 `isCurrent` 改为：
    - 本地分支；
    - 存在 upstream；
    - 当前没有全局 busy state。
  - 远程分支维持当前“`Update` = fetch remote”语义，不在这次变更里扩展。
  - 分叉、ahead-only、worktree occupied 等需要实时仓库状态的判断全部以后端结果为准。
- 选择理由
  - 前端可用性策略应简单稳定，避免把 Git 状态机复制一份到 UI。
  - backend 才能在 fetch 之后基于最新仓库状态给出 authoritative answer。
- 备选方案
  - 方案 A：在 branch list payload 中新增更多字段，前端精确决定所有禁用态。
  - 取舍：会放大 cross-layer contract，首版性价比不高。

### Decision 6: 返回结果需要区分 success / no-op / blocked / failed 四类 outcome

- 决策
  - 新 command 不只返回 `Result<(), String>` 的单一语义，而是应支持可区分 outcome 的 contract。
  - 最小可行形式可以是：
    - success：目标 branch 已 fast-forward。
    - no-op：已是最新 / 本地领先无需更新。
    - blocked：无 upstream / diverged / occupied by worktree / stale ref。
    - failed：网络 / 权限 / Git 执行失败。
  - `blocked` 和 `no-op` 必须携带 machine-readable `reason`，例如 `no_upstream`、`already_up_to_date`、`ahead_only`、`diverged`、`occupied_worktree`、`stale_ref`。
- 选择理由
  - 如果只返回 `Ok(())` 或 `Err(String)`，前端很难把“无需更新”和“操作失败”分清。
  - 该区分对用户提示、测试断言、未来日志分析都更友好。
  - 结构化 reason 能避免前端解析 backend message 字符串，减少 i18n 和测试脆弱性。
- 备选方案
  - 方案 A：沿用 `Result<(), String>`，no-op 也当 success 吞掉。
  - 取舍：实现更快，但 UX 和测试可观测性太差。

### Decision 7: 当前分支 `Update` 继续走现有 `pull`，不强制收口到新 command

- 决策
  - 当前分支仍使用现有 `pull_git` workflow。
  - 分支菜单里如果选中的就是 current local branch，`Update` 仍保留现有行为与现有反馈。
- 选择理由
  - 这次 change 的主要风险在“非当前 branch 后台更新”；当前分支路径已经存在并经过现有回归。
  - 保持兼容能减少对 toolbar `Pull`、sync preflight、existing tests 的冲击。
- 备选方案
  - 方案 A：所有 branch update 都强制经过新 command，再由新 command 内部分流 current / non-current。
  - 取舍：长期可能更统一，但首版不必为了统一而扩大变更面。

### Decision 8: Git 命令实现必须保持 macOS / Windows 兼容写法

- 决策
  - 所有新增 Git 调用都必须通过现有 command helper 或等价的 argv 参数数组执行，禁止拼接 shell command string。
  - branch name、remote name、ref name 必须作为独立参数传递，并在 backend 做 ref 目标合法性校验。
  - 路径处理必须使用 Rust `Path` / `PathBuf` 或现有 workspace path helper，禁止写死 `/`、`\`、`~`、absolute user path。
  - 测试 fixture 不依赖大小写敏感文件系统、POSIX-only symlink 语义或 shell-specific quoting。
- 选择理由
  - 这条链路直接操作 Git ref，任何 shell quoting 或路径假设都会在 Windows 上放大成错误 ref 更新或命令失败。
  - 使用 argv + path abstraction 可以让 macOS / Windows 的行为差异收敛到 Git 自身，而不是应用层字符串拼接。
- 备选方案
  - 方案 A：为了快速实现使用格式化字符串执行 `git ...`。
  - 取舍：短期代码少，但 branch 名包含空格、特殊字符或 Windows 路径时风险不可接受。

### Decision 9: 实现必须遵守 heavy-test-noise 与 large-file governance CI 门禁

- 决策
  - 实现阶段不得引入大体量日志、快照、fixture 或重复测试输出，避免触发 `.github/workflows/heavy-test-noise-sentry.yml`。
  - 修改大型前端 hook / component / css / test 文件时，必须同步关注文件大小与拆分边界，避免触发 `.github/workflows/large-file-governance.yml`。
  - 合入前质量门禁必须包含：
    - `npm run check:heavy-test-noise`
    - `npm run check:large-files:near-threshold`
    - `npm run check:large-files:gate`
- 选择理由
  - 本 change 很可能触碰 `useGitHistoryPanelInteractions.tsx`、`GitHistoryPanel.test.tsx` 等高风险大文件，必须提前把 CI 噪声和大文件治理纳入设计约束。
  - 把门禁写入 tasks 可以避免实现完成后才被 CI 阻断。
- 备选方案
  - 方案 A：只跑通功能测试，等 CI 失败再补。
  - 取舍：会把已知项目治理约束后移，增加返工成本。

## Risks / Trade-offs

- [Risk] Git 不同平台 / 版本对 branch ref force-update 的错误文案不同
  -> Mitigation：occupancy 优先走显式检测；错误断言以错误类别和关键字为主，不绑定完整 stderr。

- [Risk] 前端把某些分支显示成“可更新”，但 backend 在最新 fetch 后判定为 blocked
  -> Mitigation：接受这种 optimistic enable；在提示层明确说明最终结果以最新仓库状态为准。

- [Risk] ahead-only 分支的“无需更新”文案可能让用户误解成失败
  -> Mitigation：将 no-op 与 failed 分开展示，文案明确为“该分支已领先或已是最新，无需更新”。

- [Risk] 新 command 扩展了 frontend/backend contract，若字段设计过大可能带来后续维护成本
  -> Mitigation：只暴露最小 outcome model，不提前设计复杂 telemetry / metadata。

- [Risk] 后台更新后 branch list 的 ahead/behind 若未及时刷新，会造成 UI 短暂不一致
  -> Mitigation：操作完成后强制刷新 branch list / history summary，而不是依赖局部 optimistic patch。

- [Risk] 新增 Git CLI 调用在 macOS / Windows 上因 quoting、路径分隔符或 ref 名处理不一致而失败
  -> Mitigation：使用 argv 参数数组与 `PathBuf`，不拼接 shell string；测试覆盖带空格 branch 名或等价 escaping 场景。

- [Risk] 回归测试或 fixtures 引入过量输出 / 大文件债务，触发 CI sentry
  -> Mitigation：新增测试保持最小 fixture；合入前执行 heavy-test-noise 与 large-file governance gate。

## Migration Plan

1. 在 OpenSpec `specs` 中补齐 `git-operations` 与 `git-branch-management` 的 requirement delta。
2. backend 新增 branch-targeted update command，并补 fetch + relation-check + occupancy-check + fast-forward 流程。
3. 同步普通 Tauri command path 与 daemon command path，避免 GUI 直连和 daemon 模式行为分叉。
4. frontend 在 `tauri.ts` 增加 service 映射，并将分支菜单 `Update` 的本地分支路径切到新 command。
5. 更新中英文 i18n，区分 success / no-op / blocked / failed 提示。
6. 增加 Rust 与 Vitest 回归测试，覆盖 current / non-current / no-upstream / diverged / occupied / stale-ref 场景。
7. 检查 macOS / Windows 兼容写法，确认新增 Git 调用不依赖 shell 拼接或平台路径假设。
8. 合入前执行 `npm run test`、`npm run typecheck`、`npm run check:runtime-contracts`、`npm run check:heavy-test-noise`、`npm run check:large-files:near-threshold`、`npm run check:large-files:gate`，必要时补 `cargo test --manifest-path src-tauri/Cargo.toml`。
9. 回滚策略：若新 command 或菜单映射引发回归，可先回退 frontend action wiring，恢复“非当前本地分支禁用”的旧行为，再独立修复 backend。

## Open Questions

- worktree 占用检测是直接新增 `git worktree list --porcelain` 解析 helper，还是先依赖 `branch -f` 错误并做统一归一化？
- 对于 `ahead>0 && behind=0` 的分支，UI 是否需要单独展示“本地领先，无需更新远端”的提示文案，而不是笼统“已是最新”？
