## Context

当前 issue 实际上是两条相互叠加的状态漂移链。

第一条在前端共享幕布层：`requestUserInput` 正常路径会通过已有 lifecycle settlement 清理
`processing`、`activeTurnId` 与相关 pending residue，但当策略层先把该事件拦截并映射成
`collaboration/modeBlocked` 时，`onModeBlocked` 只负责插入解释性卡片和移除 request queue，
没有同步结算普通 processing。结果是线程主状态仍像“正在处理”，但真实语义已经变成
“当前模式不允许继续，需要用户切换模式或改走别的路径”。这条逻辑是共享前端路径，因此只要
某个引擎复用同样的 `requestUserInput -> modeBlocked` 兼容事件，都会继承这个伪 processing 问题。

第二条在 Codex runtime ledger：`resume-pending` timeout 已经会产出 `turn/stalled` 或等效
recoverable stalled diagnostics，但 runtime 仍保留 foreground continuity / active-work
protection。这样 thread surface 已经告诉用户“这条恢复链停住了”，runtime pool console 却仍把
同一 runtime 表达成当前活跃、受保护或仍处于 `resume-pending`。这不仅让诊断口径相互矛盾，
也会影响 runtime row 的回收与观测判断。

这个 change 的核心约束有两个：

- 不能把所有 `modeBlocked` 都当成 lifecycle terminal settlement，否则 command execution、
  file change 等 explain-only 阻断也会被误清理。
- 不能靠“超时后直接清空一切状态”解决 Codex runtime，因为最近一次 stalled timeout 仍然是有价值的
  诊断事实，必须和“当前是否仍活跃”分开表达。

## Goals / Non-Goals

**Goals:**

- 让共享前端只在消费 `requestUserInput` 型 `modeBlocked` 时执行 lifecycle settlement，清理
  伪 processing / active-turn residue。
- 保留 blocked 审计卡片与 request queue 清理逻辑，不丢失解释性上下文。
- 让 Codex `resume-pending` timeout 在进入 stalled settlement 后同步释放当前 foreground
  continuity / active-work protection。
- 保留最近一次 stalled timeout 的可观测性，但不再把它表达成“当前仍在活跃执行”。
- 让 thread surface 与 runtime pool console 对同一条链路给出一致、非矛盾的状态语义。

**Non-Goals:**

- 不把 lifecycle settlement 扩展到所有 `modeBlocked` 类型。
- 不改造 `requestUserInput` 卡片 UI、文案、secret input 交互或提交协议。
- 不为 `Gemini` 新增新的 user-input blocked 行为。
- 不顺手重写 Codex stalled recovery 的其它策略、warm retention 策略或 runtime budgeting 规则。

## Decisions

### Decision 1: 前端只对 requestUserInput 型 modeBlocked 执行终态式 settlement

共享幕布需要一个明确的归类谓词，用来识别：

- `blockedMethod` / `blocked_method = item/tool/requestUserInput`
- 或与之等价的 reason code / normalized reason

只有命中这类 blocked 事件时，前端才允许把线程从普通 processing 中结算出来。

理由：问题的本质不是 “modeBlocked 都需要清理”，而是“需要用户输入却被模式阻断”的事件已经不再代表
正常前景执行。若放大到所有 blocked 事件，会误伤真正仍有活跃 command/file-change 语义的链路。

替代方案是把所有 `modeBlocked` 都视为 shared terminal hint，但这会把 explain-only 阻断
降级成 user-input settlement，回归面过大，因此拒绝。

### Decision 2: 前端结算复用现有 lifecycle 退出语义，而不是在 onModeBlocked 中拼接局部清理

实现应尽量复用已有 `requestUserInput` / approval / stalled settlement 所遵循的 processing 退出语义，
确保至少同步处理：

- `processing`
- `activeTurnId`
- 与当前 turn 绑定的 pending plan / in-progress residue
- 已存在的 request queue 清理

同时保留 blocked 审计卡片。

理由：issue 本质是 shared lifecycle contract 漏掉了一条兼容分支。若在 `onModeBlocked` 中只补
单一字段清理，很容易留下新的半结算 residue。

替代方案是仅在局部 reducer 中手工关掉 `processing`，但这会复制 lifecycle 规则并制造新的漂移点，
因此拒绝。

### Decision 3: Codex resume-pending timeout 必须把“当前 continuity”与“最近一次 stalled 证据”拆开

当 Codex `resume-pending` 恢复链超时后，runtime 需要同时满足两件事：

- 把当前 foreground continuity / active-work protection 释放掉
- 保留最近一次 stalled timeout 的诊断事实

这要求 runtime state 明确区分“当前仍受保护的活跃工作”和“最近发生过的 stalled recovery evidence”。

理由：当前 bug 的根因之一就是把 timeout 证据继续挂在 active-work protection 语义上，导致 runtime
pool 一直误判为当前活跃。

替代方案一是直到 late terminal event 到达前都保留 continuity，但这会延长错误 busy 状态；
替代方案二是超时后把所有 stalled 证据清空，但这会损失问题定位能力。因此都不采用。

### Decision 4: Runtime pool row 以“当前保护状态优先，最近 stalled 证据次之”的顺序分类

runtime pool console 对 row 的主状态判断必须先看当前是否还有 active-work protection /
foreground continuity / live lease，再决定是否表达为 busy 或 `resume-pending`。如果这些当前保护位已被
timeout settlement 释放，row 就必须收敛到普通 settled / retained / idle 分类；最近一次 stalled timeout
只能作为附加诊断，而不能继续占用“当前活跃”的主语义。

理由：用户与开发者首先需要知道“这个 runtime 现在是不是还在干活”，其次才是“它刚才发生过什么”。

替代方案是继续把 `resume-pending timeout` 编码成当前 row state，但这会让 row 卡在伪活跃状态，
与 thread-facing stalled settlement 矛盾，因此拒绝。

### Decision 5: 回归测试按共享层与 Codex 专属层分开锁定

测试需要刻意覆盖两个边界：

- 前端共享层：Codex 与 Claude Code 复用的 `requestUserInput -> modeBlocked` settlement，
  以及非 user-input blocked 不应被误清理。
- Codex backend/runtime 层：`resume-pending` timeout 释放 active-work protection、保留 recent
  stalled diagnostics，并确保正常 completed/error/late terminal cleanup 不回退。

理由：这次 change 的价值就在于“共享层改善 + Codex 专属层修复”同时成立。若测试不拆边界，很容易只修一半。

## Risks / Trade-offs

- [Risk] `modeBlocked` 归类字段存在 snake_case / camelCase 差异，导致真正的 user-input blocked 没被识别。  
  → Mitigation: 前端谓词同时兼容 `blockedMethod/blocked_method` 与等效 reason code，并为双命名补回归测试。

- [Risk] 误把非 user-input blocked 当成 terminal settlement，提前清理真实活跃链路。  
  → Mitigation: 谓词只命中 `item/tool/requestUserInput` 及其受控等价 reason，并增加 negative test 锁定。

- [Risk] Codex timeout 释放 protection 后，runtime 过早回收或表达为普通 idle。  
  → Mitigation: 保留 recent stalled diagnostics，并让 row 分类继续遵守现有 lease / retention 规则，而不是直接强制冷却。

- [Risk] 前端与 backend 分开上线时，跨 surface 仍会短期存在矛盾。  
  → Mitigation: 将本 change 视为一组联动修复，验证时同时检查 thread surface 与 runtime pool 语义。

## Migration Plan

1. 在共享前端层新增 request-user-input blocked 识别与 settlement 入口，并补前端回归测试。
2. 在 Codex runtime stalled recovery 路径释放 `resume-pending` timeout 的当前 continuity，同时保存 recent stalled evidence。
3. 调整 runtime pool row 分类 / 诊断读取逻辑，使 timeout 后不再表达为当前 active-work protected。
4. 为 late terminal settlement、普通 completed/error cleanup、非 target blocked 事件补负向回归测试。
5. 在实现阶段运行 targeted frontend tests、Rust tests 与 `openspec validate --strict`。

Rollback 策略：本 change 不引入 persisted schema 迁移；若需要回滚，可分别撤销前端 settlement 分支与
Codex runtime timeout release 分支，数据层无需迁移。

## Open Questions

- `modeBlocked` 的等效 reason code 当前是否已在所有上游路径上稳定归一；若未归一，实现时应优先复用现有 normalization helper，而不是新增第三套 reason 命名。
- runtime 现有 diagnostics 字段中是否已经存在可承载 “recent stalled timeout” 的位置；若足够，应优先复用既有结构，避免引入不必要的新 snapshot 字段。
