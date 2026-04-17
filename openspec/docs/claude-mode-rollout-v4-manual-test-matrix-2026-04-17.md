# Claude Mode Rollout V.4 手测矩阵

## 目的

本矩阵对应 `openspec/changes/claude-code-mode-progressive-rollout/tasks.md` 中未完成的 `V.4`。

目标不是重复自动化测试，而是把今天已经完成的实现能力映射为真人可操作、可截图、可回归的验证路径，重点覆盖：

- mode selection 是否真传到 runtime
- `default` synthetic approval bridge 是否可用
- `--resume` continuity 是否真实存在
- history replay / structured `File changes` 卡片是否不回退
- `modeBlocked` 诊断链是否给出正确恢复方向
- inline approval card 的位置与视觉识别是否符合当前 rollout 基线
- approval detail 是否默认隐藏大段正文类字段，避免噪音淹没审批决策
- `acceptEdits` 在当前 rollout 是否仍保持禁用

## 已有自动化覆盖与手测关系

当前仓库内已经有一批自动化测试覆盖底层契约：

- `src/features/composer/components/ChatInputBox/selectors/ModeSelect.test.tsx`
- `src/services/tauri.test.ts`
- `src-tauri/src/engine/claude/tests_core.rs`
- `src-tauri/src/engine/claude/tests_stream.rs`
- `src/features/threads/loaders/claudeHistoryLoader.test.ts`
- `src/features/app/components/ApprovalToasts.test.tsx`
- `src/features/messages/components/toolBlocks/GenericToolBlock.test.tsx`
- `src/features/messages/components/Messages.live-behavior.test.tsx`

手测重点因此不再是“底层有没有单测”，而是验证跨层拼接后的真人体验链路。

## 手测前置条件

1. 使用本地可运行的 Claude provider。
2. 准备一个安全测试 workspace，允许创建临时文件与目录。
3. 保证当前会话使用 `Claude Code` provider，而不是 `Codex/Gemini/OpenCode`。
4. 测试过程中保留：
   - mode selector 截图
   - approval toast / inline card 截图
   - final assistant 续跑结果截图
   - 重开线程后的 history 卡片截图

## 测试矩阵

| ID | 场景 | 操作 | 预期 |
|---|---|---|---|
| V4-01 | `plan` 只读执行 | 选择 `Claude -> plan`，输入“请分析当前项目并给出修改建议，但不要改文件” | 不出现 file approval toast；结果以计划/分析输出为主；`ExitPlanMode` 卡片可读 |
| V4-02 | `full-access` 不进入审批链 | 选择 `Claude -> bypassPermissions`，请求其创建测试文件 | 不出现 GUI approval；文件直接创建；对话正常继续 |
| V4-03 | `default` 单文件审批 | 选择 `Claude -> default`，请求创建单个新文件 | 出现 `item/fileChange/requestApproval` 对应审批 UI；批准后文件实际落盘 |
| V4-04 | `default` 批量审批 | 选择 `Claude -> default`，请求同时创建多个文件 | 出现多文件审批；若同 turn 聚合，应出现 batch approve 入口；全部批准后才 finalize |
| V4-05 | 审批后继续执行 | 在 `default` 场景批准文件后，继续观察 Claude 回复 | 不停在“已批准”；同一线程内继续给出后续执行结果 |
| V4-06 | history replay 恢复 `File changes` | 完成一次 `default` 文件审批链后关闭并重开线程 | 历史里显示结构化 `File changes` 卡片，而不是 `<ccgui-approval-resume>` 原始 marker |
| V4-07 | command/shell 阻塞进入 `modeBlocked` | 选择 `Claude -> default`，请求执行明显需要命令权限的 Bash/shell 操作 | 不出现假 file approval；界面显示 `modeBlocked` 诊断，建议切 `full-access` 或改写为受支持文件工具 |
| V4-08 | inline approval 卡片贴底承接 | 在 `default` 场景触发 approval 后观察消息幕布 | 审批卡出现在消息幕布底部而不是顶部；不打断顶部阅读入口；视觉上明显是审批卡而非普通 toast |
| V4-09 | approval detail 隐藏正文噪音 | 在 `default` 场景请求改写较长内容文件或触发含正文 payload 的 file change | 审批卡展示路径/工具/摘要，但不直接展示大段 `content` / `patch` / `diff` / rewritten text |
| V4-10 | `acceptEdits` 仍禁用 | 打开 Claude mode selector | `acceptEdits` 选项存在但 disabled，点击无效 |
| V4-11 | `ExitPlanMode` 执行模式选择同步 selector | 先在 `Claude -> plan` 产出 `ExitPlanMode` 卡片，再分别点击“默认审批模式并执行 / 全自动并执行” | 卡片明确提示需要离开规划模式；点击后 selector 立即同步为对应执行态；后续实现请求以所选 access mode 继续执行 |
| V4-12 | 历史会话 plan 状态不泄漏可写权限 | 打开一个已有 Claude 历史线程，手动切到 `plan` 后继续发编辑型请求 | 不应出现 file approval；runtime 必须按只读处理，最多返回 plan/read-only 结果 |

## 场景细化

### V4-01 `plan` 只读执行

建议输入：

```text
请只分析当前项目的 git-history 相关模块，给我一个执行计划，不要改文件，不要运行会修改工作区的命令。
```

检查点：

- mode selector 当前显示 `规划模式`
- 不出现 approval toast
- 消息区出现计划类输出
- 若产生 `ExitPlanMode` 工具卡片，标题、折叠与 Markdown 渲染正常

### V4-02 `full-access` 不进入审批链

建议输入：

```text
在当前 workspace 下创建 tmp/claude-full-access-smoke.txt，内容写 full access smoke test。
```

检查点：

- mode selector 当前显示 `全自动`
- 不出现 approval toast
- 文件直接生成
- Claude 后续回复不是“等待审批”

### V4-03 `default` 单文件审批

建议输入：

```text
在当前 workspace 下创建 tmp/claude-default-single.txt，内容写 single approval smoke test。
```

检查点：

- 出现 approval UI
- approval 明细能看到 `File path`
- 批准后出现 applying / resuming 过程
- 最终文件存在
- assistant 在批准后继续输出，而不是只停留一句摘要

### V4-04 `default` 批量审批

建议输入：

```text
同时创建 tmp/claude-batch-a.txt 和 tmp/claude-batch-b.txt，分别写 a / b。
```

检查点：

- 出现多条 file approvals，或聚合后的 batch approval 行为
- 批量审批按钮只应针对 `fileChange`
- 批准后两个文件都存在
- 不应在第一个 approval 后就提前结束 turn

### V4-05 审批后继续执行

建议输入：

```text
创建 tmp/claude-continue.txt，写入 continue smoke test，完成后告诉我你具体创建了哪个文件以及下一步建议。
```

检查点：

- 批准后 Claude 继续回复“已创建 xxx，建议下一步 …”
- 不只是工具完成提示
- 线程不会卡死在 processing / applying

### V4-06 history replay 恢复 `File changes`

操作：

1. 先完成 `V4-03` 或 `V4-04`
2. 关闭窗口或切线程
3. 重新打开原 Claude 线程

检查点：

- 能看到 `File changes`
- 看不到 `<ccgui-approval-resume>...</ccgui-approval-resume>` 原始文本
- 变更路径与状态和实际操作一致

### V4-07 command/shell 阻塞进入 `modeBlocked`

建议输入：

```text
请在 default 模式下直接执行一条 shell 命令：pwd && ls
```

或：

```text
请用 Bash 创建一个文件，而不是用 Write/CreateFile 工具。
```

检查点：

- 不要出现 file approval toast 误判
- 应展示 `modeBlocked` 类型提示
- 恢复建议应接近：
  - 切换 `full-access`
  - 或改写为受支持文件工具

### V4-08 inline approval 卡片贴底承接

建议复用：

- `V4-03`
- 或 `V4-04`

检查点：

- approval card 出现在当前消息幕布底部，而不是顶部
- card 靠近当前 turn 尾部承接
- 视觉上存在明确审批结构，例如 icon / badge / summary band
- 不应看起来像普通弱提示条

### V4-09 approval detail 隐藏正文噪音

建议输入：

```text
请在当前 workspace 下创建 tmp/claude-hidden-body.txt，写入一段 30 行以上的测试文本；完成前如果需要审批请等待我确认。
```

或：

```text
请把 tmp/claude-hidden-body.txt 改写成另一段明显不同的长文本内容。
```

检查点：

- approval card 中能看到路径、工具名、必要说明
- 看不到大段 `content`、`patch`、`diff`、`new_string` 等正文直接铺开
- 审批决策所需信息仍足够，不会因为隐藏正文而变成“完全看不懂要批什么”

### V4-10 `acceptEdits` 仍禁用

检查点：

- Claude mode selector 中 `acceptEdits` 可见
- 样式是 disabled
- 点击不会切换当前 mode

### V4-11 `ExitPlanMode` 执行模式选择同步 selector

建议输入：

```text
先给我一个可执行计划，确认后我会让你继续直接落地改动。
```

在出现 `ExitPlanMode` 卡片后：

1. 点击 `切到默认审批模式并执行`
2. 再开一轮测试，点击 `切到全自动并执行`

检查点：

- 卡片明确显示：
  - `已确认计划。接下来执行需要离开规划模式。`
  - `请选择执行模式`
- 卡片中存在两个动作按钮：
  - `切到默认审批模式并执行`
  - `切到全自动并执行`
- 点击默认审批按钮后：
  - collaboration selector 不再显示 `plan`
  - access selector 显示 `default`
  - 后续执行进入默认审批链
- 点击全自动按钮后：
  - collaboration selector 不再显示 `plan`
  - access selector 显示 `full-access`
  - 后续执行不进入 GUI approval，而是直接执行

### V4-12 历史会话 plan 状态不泄漏可写权限

操作：

1. 打开一个已有 Claude 历史线程
2. 手动把底部 conversation selector 切到 `规划模式`
3. 发送一个明确编辑请求，例如：

```text
新建 abc.txt，内容写 100
```

检查点：

- 不应出现 `Pending file approval`
- 不应出现本地 apply/写文件审批卡
- Claude 应按只读约束响应：
  - 返回 plan / 说明无法直接改
  - 或提示离开 plan 后再执行
- 关键是：不得再沿用历史线程之前残留的 `default/full-access` 写权限

## 通过标准

以下条件全部满足，`V.4` 才能勾选完成：

1. `V4-01` 到 `V4-12` 全部通过。
2. 没有出现 raw marker 泄漏。
3. 没有出现审批后线程中断但文件已写入的半成功状态。
4. 没有把 command denial 错误映射成 file approval。
5. inline approval 卡片位置与视觉识别符合当前 rollout 基线。
6. approval detail 默认不会被大段正文类字段淹没。
7. `acceptEdits` 仍保持禁用，不出现产品层偷开。

## 失败分流

| 失败类型 | 优先排查 |
|---|---|
| 批准后不继续执行 | `src-tauri/src/engine/claude/approval.rs` resume continuity |
| 重开后看不到 `File changes` | `src/features/threads/loaders/claudeHistoryLoader.ts` / `src/utils/threadItems.ts` |
| command denial 显示成普通文本失败 | `src-tauri/src/engine/claude/event_conversion.rs` + `src-tauri/src/engine/events.rs` |
| 批量审批按钮异常 | `src/features/app/components/ApprovalToasts.tsx` + `src/features/threads/hooks/useThreadApprovals.ts` |
| `acceptEdits` 可被选中 | `src/features/composer/components/ChatInputBox/selectors/ModeSelect.tsx` |
