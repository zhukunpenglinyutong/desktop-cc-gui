# Claude Mode Rollout 非文件审批 Bridge 评估

## 范围

本评估对应 `openspec/changes/claude-code-mode-progressive-rollout/tasks.md` 中的：

- `E.1.c 评估哪些非文件工具可以安全进入下一阶段 synthetic bridge`

这里讨论的是 `Claude default mode` 下，已经被识别为 permission denial 的**非文件工具**，是否适合从当前 `modeBlocked` 诊断链进一步升级为真正的 synthetic approval bridge。

## 当前代码事实

### 1. 分类能力已经大于执行能力

`src-tauri/src/engine/claude/approval.rs` 当前对 Claude 工具的 blocked classification 已经支持：

- `RequestUserInput`
- `FileChange`
- `CommandExecution`

其中 `FileChange` 分类范围包含：

- `Edit`
- `MultiEdit`
- `Write`
- `Rewrite`
- `CreateFile`
- `CreateDirectory`
- `NotebookEdit`

截至本评估首次撰写时，本地真实可执行的 synthetic apply 只支持：

- `Write`
- `CreateFile`
- `CreateDirectory`

2026-04-17 修复 `Claude default` 混合审批半成功问题后，结构化 file-change synthetic apply 已扩展到：

- `Write`
- `Rewrite`
- `CreateFile`
- `CreateDirectory`
- `Edit`
- `MultiEdit`
- `Delete` / `DeleteFile` / `Remove` / `RemoveFile` / `Unlink`

这意味着：

- “识别成 file change” 不等于 “GUI 已能安全代执行”
- 任何下一阶段扩展都必须按 tool semantic 单独评估，不能只看分类桶
- `NotebookEdit` 仍只进入 file-change 识别，不进入本地 apply

### 2. command denial 当前只有诊断链，没有 bridge

`src-tauri/src/engine/claude/event_conversion.rs` 对 command/shell/native permission denial 的当前策略是：

- 构造 `item/commandExecution/requestApproval` 对应的 blocked method
- 映射成 `collaboration/modeBlocked`
- 提示用户切到 `full-access`，或改写为受支持文件工具

当前并不会：

- 生成真正的 command approval request
- 在 GUI 侧本地执行该命令
- 批准后替 Claude 重放命令结果

这是合理的，因为 generic command execution 的风险面远大于 file write。

## 评估准则

某个非文件工具要进入下一阶段 synthetic bridge，至少要同时满足：

1. **Deterministic**
   输入相同，结果应基本稳定，不依赖交互式 shell 状态。
2. **Locally Reproducible**
   GUI 可以在本地可靠重放，不依赖 Claude CLI 私有上下文。
3. **Low Privilege Expansion**
   不会因为“批准一次”而把执行权限扩大到任意命令。
4. **Recoverable History**
   结果能稳定转成现有 conversation item，而不是只剩文本碎片。
5. **Cross-platform Safe**
   在 macOS / Windows 下不会因为 shell 差异直接变成不可控行为。

只要有一项不满足，就不应进入下一阶段 bridge。

## 结论

### 建议进入下一阶段的非文件工具

当前结论：**无**

原因不是“完全做不了”，而是目前代码结构下没有任何一个非文件工具同时满足上述 5 条。

### 建议继续停留在 `modeBlocked` 的工具族

#### A. `Bash / shell / exec / terminal / run`

结论：**继续停留在 `modeBlocked`，不要进 bridge**

原因：

- 语义过宽，几乎等价于任意代码执行
- UI 即使能展示 command preview，也不代表可以安全本地执行
- 本地执行后如何把 stdout/stderr、exit code、side effects 与 Claude 原 turn 重新对齐，目前没有可靠 contract
- `alwaysAllow` 前缀记忆只适合已有 command approval contract 的 provider，不适合拿来伪造 Claude command bridge

#### B. “通过 shell 包装 file writes”的命令

例如：

- `tee file <<< ...`
- shell redirection
- `python - <<'PY'` 写文件

结论：**不要作为 command bridge 进入**

原因：

- 它们本质仍是 command execution，不是结构化 file tool
- 一旦开口子，边界会快速退化成“只要命令看起来像写文件就执行”
- 现有系统已经提供更安全路径：引导用户改写为 `Write/CreateFile/CreateDirectory`

#### C. native command / OS-specific tooling

例如：

- PowerShell
- cmd.exe
- 各类 platform-specific binary

结论：**继续停留在 `modeBlocked`**

原因：

- shell 差异大
- 命令 token 解析与 quoting 复杂
- 会显著扩大跨平台回归面

## 下一阶段真正值得推进的，不是“非文件 command bridge”，而是这两类工作

### 方向 1: 扩展结构化 file tools，而不是 command tools

优先级最高的候选其实不是 command，而是**仍属 file change 语义、但当前未被本地 apply 支持的工具**：

1. `Edit`
2. `MultiEdit`
3. `NotebookEdit`
4. `Rewrite`

原因：

- 它们仍然是文件语义，不是 arbitrary execution
- 可以继续复用现有 `fileChange` approval surface
- history replay 已有 `File changes` 表达模型，落地成本可控

建议顺序与当前进度：

1. `Edit`：已实现本地 exact replacement apply
2. `Rewrite`：已按 whole-file write 语义接入
3. `MultiEdit`：已实现顺序结构化 edits apply，支持 `replace_all`
4. `NotebookEdit`：仍待评估，不在本次修复范围

其中 `Edit` 最值得先做，因为语义相对明确，且与现有 diff/file card 体系最接近。

### 方向 2: 继续强化 command denial 诊断，而不是提前 bridge

对 command/shell 工具，更合理的短期目标是：

1. 更准确识别被阻塞的是哪类命令
2. 更清楚提示用户该切 `full-access` 还是改写为 `Write/CreateFile`
3. 在 UI 上区分：
   - 结构化文件工具可恢复
   - command execution 当前不可恢复

这比“伪 bridge 一个半成品命令执行器”更稳。

## 建议回写到 rollout 任务的结论

可以把 `E.1.c` 的结果收敛为以下判断：

- 本轮**不建议**让任何 generic non-file command tool 进入 synthetic bridge。
- 下一阶段优先扩展 `Edit/Rewrite/MultiEdit/NotebookEdit` 这类**结构化 file-change tool** 的本地 apply 能力。
- `Bash/shell/native command` 继续维持 `modeBlocked`，直到存在可靠的本地执行 contract、history contract 与最小权限边界。

## 对 `E.3 acceptEdits` 的影响

这份评估也直接影响 `E.3`：

- 如果 command 工具仍只能 `modeBlocked`
- 而 `acceptEdits` 的产品语义又会让用户自然预期“文件自动过，命令也比较顺”

那么在没有更清晰 CLI contract 之前，**不应提前开放 `acceptEdits`**。

否则用户会把它理解成“比 default 更完整”，但实际仍会在 command path 上退化。

## 最终建议

1. 不要把 `E.1.c` 理解成“挑几个 Bash 命令放进 bridge”。
2. 真正可推进的下一步，是把 `Edit` 系列 file tools 从“已识别”推进到“可本地 apply”。
3. command execution 保持 `modeBlocked`，继续做更准确的恢复建议，而不是冒进接入本地执行。
