## Why

当前代码仍存在一条可复现的双层状态漂移链：前端共享幕布在 `collaboration/modeBlocked` 阻断
`item/tool/requestUserInput` 时没有同步结算 `processing` / `activeTurn`，而 Codex 后端在
`resume-pending` timeout 后又没有释放 runtime active-work protection。结果是用户看到的线程幕布、
`requestUserInput` 可交互性、以及 runtime pool console 对同一条链路给出互相矛盾的结论。

这个问题现在值得单独收口，因为它已经从“偶发诊断噪音”升级为可见的交互阻塞与错误可观测性：
用户可能面对不可点击的伪 processing 线程，而 runtime pool 仍把超时链路误报为正在受保护的活跃工作。

## 目标与边界

### 目标

- 让共享幕布在消费 `requestUserInput` 型 `modeBlocked` 事件时，能够像真实 `requestUserInput`
  / approval settlement 一样，确定性退出伪 processing。
- 让 Codex `resume-pending` timeout 在发出 `turn/stalled` 后，同时结束当前 active-work protection，
  避免 runtime ledger 继续把超时链路当作真实活跃工作。
- 保留最近一次 stalled diagnostics 的可观测性，避免通过“直接清空一切状态”掩盖问题来源。

### 边界

- 前端共享逻辑只处理 `blocked_method = item/tool/requestUserInput` 或等效 reason code 的
  `modeBlocked`，不扩大到所有 `modeBlocked` 类型。
- 后端 runtime 收口只针对 Codex `resume-pending` timeout，不顺手改造其它 runtime recovery
  策略、warm retention 策略或审批桥接模型。

## 非目标

- 不新增新的 collaboration mode、approval bridge 或 askuserquestion 交互体系。
- 不重写 `requestUserInput` 卡片 UI、队列排序、secret input 交互或现有文案体系。
- 不为 `Gemini` 引入新的 `requestUserInput` / `askuserquestion` 行为。
- 不把所有 `modeBlocked` 事件都视为终态结算信号。

## What Changes

- 收紧共享幕布生命周期结算：当前端收到 `requestUserInput` 型 `modeBlocked` 时，必须同步清理
  对应线程的 `processing`、`activeTurnId` 与 plan-in-progress residue，同时保留 `modeBlocked`
  审计卡片和 request queue 清理能力。
- 保持其它 `modeBlocked` 类型的既有解释性展示，不把 command/file-change 等阻断误降级成
  “用户输入已自然结算”。
- 收紧 Codex `resume-pending` timeout 收口：timeout 发出 `turn/stalled` 后，runtime ledger
  必须结束 foreground continuity / active-work protection，避免 runtime row 长时间停留在
  `resume-pending` 或等效活跃保护态。
- 为 runtime pool 保留“最近一次 stalled recovery”证据，使 row 能从“当前仍活跃”收敛为
  “当前已结算，但最近发生过 stalled timeout”的可诊断状态。
- 增补回归测试，覆盖 Codex 与 Claude Code 共用幕布层的 `requestUserInput` 阻断结算，
  以及 Codex timeout 后 runtime row 的保护位与状态收敛。

## 技术方案对比

### 方案 A：只修前端共享幕布结算

- 优点：改动集中，能直接消除用户看到的伪 processing 与不可交互幕布。
- 缺点：runtime pool 仍会把已 timeout 的 Codex 链路当作 active-work protected，诊断口径继续失真。

### 方案 B：只修 Codex runtime timeout ledger

- 优点：能修正 runtime pool 的 active-work 误报与回收判定。
- 缺点：共享幕布仍会在 `modeBlocked -> requestUserInput` 链路上留下 processing residue，
  对 Claude Code 这类复用同一前端事件面的人机交互没有帮助。

### 方案 C：分层收口，前后端各修自己的事实源（推荐）

- 前端共享层：仅对 `requestUserInput` 型 `modeBlocked` 执行 lifecycle settlement。
- Codex 后端层：仅对 `resume-pending` timeout 执行 active-work release + recent-stalled retention。
- 取舍理由：这能同时修复“用户看到的状态”和“runtime 自己记录的状态”，又不会把 scope 扩大到
  全部 `modeBlocked` 或全部 runtime strategy。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `codex-chat-canvas-user-input-elicitation`: 调整 `requestUserInput` 型 `modeBlocked`
  的前端契约，要求阻断事件也必须让线程离开伪 processing 并保持后续交互可用。
- `conversation-lifecycle-contract`: 调整共享 lifecycle settlement 语义，禁止线程在
  explain-only 的 blocked user-input 事件后继续残留普通 processing / active-turn 状态。
- `codex-stalled-recovery-contract`: 调整 Codex `resume-pending` timeout 契约，要求 timeout
  后进入 recoverable stalled state，同时结束当前 active continuity。
- `runtime-pool-console`: 调整 runtime row 的可观测语义，要求 timeout 后不再把该 runtime
  表达为当前 active-work protected，同时保留最近 stalled recovery diagnostics。

## Impact

- Affected frontend:
  - `src/features/threads/hooks/useThreadEventHandlers.ts`
  - 相关 `useThreadEventHandlers` / `useThreadTurnEvents` / reducer 回归测试
- Affected backend:
  - `src-tauri/src/backend/app_server.rs`
  - `src-tauri/src/backend/app_server_runtime_lifecycle.rs`
  - `src-tauri/src/runtime/mod.rs`
  - 相关 runtime tests 与 runtime pool observability tests
- Event / contract impact:
  - 不新增新的 public event method
  - 收紧 `collaboration/modeBlocked` 中 `requestUserInput` 子类的 lifecycle semantics
  - 收紧 Codex `resume-pending` timeout 后的 runtime row state semantics
- Dependencies:
  - 无新增第三方依赖

## 验收标准

- `requestUserInput` 被策略阻断并映射成 `modeBlocked` 后，目标线程 MUST 清除 `processing`
  与 `activeTurnId`，且用户 MUST 能继续操作该线程。
- 上述结算仅适用于 `requestUserInput` 型 `modeBlocked`；其它 `modeBlocked` 不得被误判为同类终态。
- Claude Code 已有的 `requestUserInput -> modeBlocked` 映射进入共享幕布后，MUST 复用同一结算逻辑，
  且不引入新的 thread continuity 回退。
- Codex `resume-pending` timeout 触发后，runtime row MUST 不再显示为当前 active-work protected
  或持续 `resume-pending`，但 MUST 仍保留最近 stalled timeout 的可诊断证据。
- Codex 正常 completed / error / late terminal settlement 既有清理链路 MUST 保持不变，不得因本改动
  回退成过早清理或丢失诊断。
