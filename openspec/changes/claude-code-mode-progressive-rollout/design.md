## Context

当前 `Claude Code` rollout 已不再停留在“只开放 `plan/full-access`”的阶段。代码已经形成一条可运行的 synthetic approval bridge，用来把 Claude 在 `default` 模式下触发的文件权限阻塞接入现有 GUI approval 流程，并在审批后继续 resume 会话。

当前真实状态可以拆成两层：

- 已稳定能力
  - `plan` -> `read-only` -> `--permission-mode plan`
  - `full-access` -> `--dangerously-skip-permissions`
  - `default` 可触发真实文件审批路径，并在审批后继续执行
  - `ExitPlanMode` 已有稳定的 GUI 承接卡片，计划内容可折叠并按 Markdown 渲染
- 仍待继续收敛
  - `acceptEdits` 未开放
  - Claude 更广义的原生命令审批 shape 仍未完全标准化，但已识别的 command execution denial 会进入 `modeBlocked`
  - synthetic local apply 当前只覆盖受支持的文件工具

因此本 design 不再描述“未来可能接 bridge”，而是聚焦当前 bridge 的结构、边界和后续扩展约束。

## Goals / Non-Goals

**Goals**

- 记录 Claude `default` 当前 synthetic approval bridge 的真实架构。
- 记录多文件审批、resume continuity、历史恢复去噪的契约。
- 记录 approval identity 去重/删除的边界，避免再次出现 request race。
- 记录 large-file governance 触发后的模块拆分结果，为继续演进保留结构边界。
- 记录 Claude approval surface 当前已经验证过的可见 UI 基线，避免行为没回退但体验退化。

**Non-Goals**

- 不设计第二套 Claude 专属审批 UI。
- 不把 synthetic approval 泛化成全部 Claude tool 的通用执行框架。
- 不在本轮确认 `acceptEdits` 最终语义。

## Decisions

### Decision 1: `default` 通过 synthetic approval bridge 接入现有审批主链

**Decision**

- 当 Claude `default` 模式下的受支持文件工具命中 permission denial / approval-required 形态时，runtime 生成 synthetic approval request，并复用现有 GUI approval 流程。

**Why**

- 用户已经验证 Claude 本地 CLI 在某些场景会出现“本地 CLI 有授权提示，但 GUI 里没有弹窗”的缺口。
- 直接把问题留在自然语言报错层，会让 `default` 成为“看起来可用、实际不可控”的半残模式。
- 现有 approval toast、request response、thread approval state 已经足够承接 Claude file change 审批，不需要再做第二条链。

**Implementation shape**

- Runtime 识别 Claude file tool 的阻塞信号并保留 tool metadata。
- `src-tauri/src/engine/claude/approval.rs` 负责：
  - request id 归一化
  - synthetic summary 聚合
  - local file apply
  - resume message 构造
  - pending approval bookkeeping
- 前端继续沿用 `useThreadApprovals.ts` 做审批提交与批量审批。

### Decision 2: 审批后的继续执行采用 kill + `--resume` continuity，而不是停在 summary

**Decision**

- 批准文件变更后，Claude 会话不能只结束在“已批准”摘要，而必须继续回到原会话流。
- 实现方式是保存 per-turn approval summary，在审批完成后构造 resume message，并通过 `--resume` 继续 stdout processing。

**Why**

- 用户反馈的关键体验问题不是“有没有审批框”，而是“审批后执行断了、没有继续告诉我结果”。
- 单纯在审批完成时发一个 `turnCompleted` 摘要，无法满足连续对话体验。

**Implementation shape**

- `approval_notify_by_turn` / `approval_resume_message_by_turn` 作为 per-turn 同步原语。
- 当一个 turn 还有 pending approvals 时，runtime 等待。
- 最后一个 approval resolve 后：
  - 聚合 summary
  - 写入 resume message
  - 唤醒等待中的 turn
- Claude 通过 `--resume <session_id>` 回到同一会话继续处理。

### Decision 3: synthetic approval 结果通过 marker 协议穿过历史层，再在 loader 中还原成结构化卡片

**Decision**

- 审批后的 resume 文本中嵌入 `<ccgui-approval-resume>...</ccgui-approval-resume>` marker。
- 历史恢复与 thread item 解析阶段必须剥离 marker，并重新生成结构化 `File changes` 卡片。

**Why**

- 需要一个对 Claude CLI 文本流足够稳的 carrier，把“审批已完成的结构化摘要”带过 resume 与 history replay。
- 如果直接把 resume 摘要暴露在文本历史里，会制造明显噪音。

**Implementation shape**

- `approval.rs` 负责 marker 格式化。
- `src/utils/threadItems.ts` 负责 marker 识别与 strip。
- `src/features/threads/loaders/claudeHistoryLoader.ts` 负责把 marker payload 重建为 synthetic approval items。

### Decision 4: approval request 的 identity 匹配必须包含完整审批指纹，而不是只按 `request_id`

**Decision**

- reducer 中 approval 去重与移除必须按更完整的 request identity 比较，不能只按 `request_id`。

**Why**

- 用户实测中过多文件变更会同时弹多个审批，早期实现只按 `request_id` 做移除时容易误删、漏删或把后续审批链截断。
- Claude synthetic approvals 与其他引擎 approval 共享同一 reducer 时，更需要稳的 identity 规则。

**Implementation shape**

- `useThreadsReducer.ts` 中 `isSameApprovalRequest` 作为统一比较入口。
- 删除逻辑优先尝试完整 approval object 匹配，再退到兼容路径。

### Decision 5: local file apply 只支持受控工具集合，并在 workspace/path 层做强边界检查

**Decision**

- 当前 synthetic local apply 只支持 `Write` / `CreateFile` / `CreateDirectory`。
- 所有路径必须做 workspace 内约束、空路径校验、父目录创建和平台无关归一化。

**Why**

- 当前目标是把 GUI approval 补成可用，不是把全部 Claude tool 执行器重做一遍。
- file apply 是高风险路径，必须先把路径安全和跨平台行为收紧。

**Implementation shape**

- `normalize_claude_workspace_relative_path` 处理 `/` 与 `\\` 兼容。
- 对空路径、越界路径、缺元数据路径直接拒绝。
- 接受批准时自动创建缺失父目录，兼容 Windows / macOS。

### Decision 6: large-file governance 通过模块拆分维持 Claude runtime 的可维护性

**Decision**

- 当 `src-tauri/src/engine/claude.rs` 逼近并越过 3000 行门槛时，按职责拆分：
  - `claude/approval.rs`
  - `claude/manager.rs`
  - `claude/tests_stream.rs`

**Why**

- synthetic approval bridge 带来了更多状态与测试，不拆分会持续侵蚀 `claude.rs` 的可读性和门禁通过率。

**Implementation shape**

- `claude.rs` 保留 runtime 主流程与 glue logic。
- approval 相关状态机、resume marker、local apply 收敛进 `approval.rs`。
- stream / resume tests 独立到 `tests_stream.rs`。

### Decision 7: 非文件工具权限阻塞先进入稳定诊断链，而不是冒进接入通用 synthetic approval

**Decision**

- 对 command execution / shell / native command 这类当前未被本地 apply 支持的权限阻塞，runtime 先统一映射为 `modeBlocked` 诊断事件。

**Why**

- 当前 bridge 的核心价值是补齐受支持文件工具的审批闭环，不是把所有 Claude 原生命令都接到本地执行器。
- 非文件工具如果继续只保留原始文本报错，用户无法判断是 CLI 权限限制、GUI 没接住，还是命令本身失败。

**Implementation shape**

- `event_conversion.rs` 识别 Claude permission denial 中的 command-execution shape。
- `events.rs` 将 `item/commandExecution/requestApproval` 统一映射到 `collaboration/modeBlocked`。
- 前端显示 recoverable diagnostics，指导用户切换 `full-access` 或改写为受支持文件工具。

### Decision 8: Plan 阶段退出后的承接卡片属于 rollout 可用性基线的一部分

**Decision**

- `ExitPlanMode` 不再只显示原始工具文本，而是使用可折叠、扁平化的计划承接卡片渲染，并对 `PLAN` / `PLANFILEPATH` 或 JSON payload 做 Markdown 级提取。

**Why**

- rollout 不只是 runtime flag 和 approval bridge；如果计划结束后的输出无法稳定消费，用户仍然无法顺畅从 `plan` 切换到执行。
- Claude / Codex 在协作模式里都依赖计划内容的复读与人工确认，因此该卡片是产品层回归基线，而不是纯视觉细节。

**Implementation shape**

- `GenericToolBlock.tsx` 对 `exitplanmode` 特判提取结构化计划内容。
- 卡片默认可折叠，header 保持单行，原始计划内容按 Markdown 渲染。
- 深色主题下保留层次对比，但避免额外装饰性包围。

### Decision 10: `ExitPlanMode` 必须通过显式执行模式选择离开规划态

**Decision**

- 当 Claude `plan` 会话产出 `ExitPlanMode` 卡片时，卡片本身必须承担“离开规划模式并继续执行”的显式确认入口。
- 当前仅允许两个执行分支：
  - `default`：默认审批模式
  - `full-access`：全自动
- 用户点击任一分支后，前端必须先同步 selector 状态，再发起执行 prompt。

**Why**

- 近期回归暴露的核心问题不是 plan 卡片缺失，而是“系统已经进入执行链，但 selector 还停在 `plan`”，导致用户理解错位。
- 如果继续依赖隐式切换或让用户自己猜该去点哪个 selector，会让 rollout 在交互层出现伪状态。
- 显式双按钮既保留安全边界，也能把“离开 plan”与“选择执行权限”合并成一次明确操作。

**Implementation shape**

- `GenericToolBlock.tsx` 为 `ExitPlanMode` 卡片增加 execution mode section 和双按钮动作。
- `Messages.tsx` / `ToolBlockRenderer.tsx` 透传 `onExitPlanModeExecute` 回调，不在工具卡内直接写线程逻辑。
- `app-shell.tsx` 负责真正执行：
  - `applySelectedCollaborationMode("code")`
  - `handleSetAccessMode("default" | "full-access")`
  - 用 `PLAN_APPLY_EXECUTE_PROMPT` 复用既有继续执行入口
- 该流程只改变 UI 展示和状态同步，不额外引入新的 provider command 或 mode id。

### Decision 9: Claude inline approval card 采用“底部承接 + 强识别 + 去正文噪音”的展示基线

**Decision**

- Claude synthetic approval 继续复用现有 approval UI 行为链，但其 inline 展示必须满足更明确的审批识别与阅读位置约束：
  - 卡片放在消息幕布底部承接当前 turn
  - 卡片具备明显的审批结构，如 icon、status badge、summary band
  - 默认隐藏大段 `content`、patch、diff 等正文，不把审批卡做成内容预览器

**Why**

- 最近几轮手测暴露的问题不是审批链断裂，而是“卡片特征不明显”“放在顶部打断阅读”“正文噪音过大”。
- 这类问题虽然不改变 runtime 行为，但会直接影响用户是否能快速识别这是一个待决策的审批节点。
- rollout 的可用性基线必须覆盖这种用户可见 contract，而不仅是 CLI flag 与事件流。

**Implementation shape**

- `ApprovalToasts.tsx` 在现有行为不变前提下增加更明确的 header / badge / summary 结构。
- `Messages.tsx` 将 inline approval slot 放在消息幕布底部、`bottomRef` 之前承接。
- approval detail 过滤继续隐藏大段正文类字段，仅保留路径、命令、说明等决策必要信息。

## Risks / Trade-offs

- [Risk] synthetic approval 当前只覆盖文件工具，命令审批仍可能退化
  - Mitigation: 保持 `acceptEdits` 未开放；已识别的命令阻塞统一进入 `modeBlocked`，至少保证可诊断和可恢复建议。

- [Risk] resume 依赖 marker 协议，若 marker 泄漏到用户历史会产生噪音
  - Mitigation: loader 和 thread item parser 必须先 strip 再渲染。

- [Risk] 多审批并发时可能再次出现 identity race
  - Mitigation: 所有 add/remove/update 统一走完整 approval fingerprint。

- [Risk] 本地文件 apply 属于高风险写路径
  - Mitigation: 仅支持有限工具；拒绝 workspace 外路径；拒绝空路径；拒绝缺元数据请求。

- [Trade-off] synthetic bridge 并不等价于 Claude CLI 原生审批体验
  - 这是有意取舍。当前优先级是让 GUI 中的 `default` 可解释、可继续执行、可历史恢复，而不是等待 CLI 事件完美统一后再开放。

## Validation Matrix

### Runtime / approval

- Claude `default` 触发受支持文件变更时，应发出 synthetic approval request。
- 批准单个文件变更后，应完成本地写入并发出 completion / resume。
- 批准多个文件变更后，应只在最后一个批准完成时 finalize turn，并继续 resume。
- 拒绝文件变更时，不得写文件，且会话仍可继续交互。
- Claude `default` 命中已识别的 command execution 权限阻塞时，应进入 `modeBlocked` 而不是只显示原始失败文本。

### History / lifecycle

- synthetic approval resume marker 不得直接显示在历史消息中。
- 重开线程后，应恢复结构化 `File changes` 卡片。
- 批准后的中间态应可见，避免“点击后无反馈”的体验断层。
- `ExitPlanMode` 输出应渲染为稳定的计划卡片，且原始计划内容在重开线程后仍具备基本可读性。
- inline approval card 应在消息幕布底部稳定可见，且视觉上可明显区别于普通提示块。
- approval detail 不应默认暴露大段 `content` / diff / patch 正文，避免审批面板被正文淹没。
- `ExitPlanMode` 卡片点击执行模式后，selector 必须立即反映为离开 `plan` 后的真实执行模式，且发送的实现请求必须带上对应 access mode。

### Edge cases

- 空路径、workspace 外路径、缺失 tool metadata、未知 request id 必须被拒绝。
- Windows 风格路径、嵌套目录路径必须正确归一化并可写入。
- 多个 approval 并发时，不得只处理第一个请求。

### Governance

- `npm run check:large-files:gate` 必须通过。
- `src-tauri/src/engine/claude.rs` 需保持在 3000 行门槛内。

## Open Questions

- Claude 原生命令审批 event shape 是否可以进一步标准化到现有 approval request contract。
- `acceptEdits` 在当前 CLI 版本下是否真的满足“文件自动通过、命令保留审批”的产品语义。
- synthetic approval bridge 是否需要继续扩展到更多文件工具，例如 `MultiEdit` 等复杂写操作。
