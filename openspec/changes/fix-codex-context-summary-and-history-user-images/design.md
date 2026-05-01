## Context

这次 change 实际上打在同一条链路的两个破口上：

1. `project memory` 手动引用发送时，会先插入一条 assistant 侧 `记忆上下文摘要` summary item，再把 injected XML block 拼进 user message。当前 user-equivalence canonicalization 对 `project-memory` 只识别裸标签，不识别带 attributes 的真实发送格式，导致 optimistic / authoritative user 无法正确收敛，最终在 realtime 幕布中额外留下重复 user bubble 或重复 summary surface。
2. `note-card` 引用为了避免同一图片既出现在 context card 又出现在普通用户图片网格，增加了 attachment filtering。这个逻辑复用了 history render 路径后，把“有 note-card 过滤能力”和“当前图片确实属于 note-card 注入附件”混成了一层，导致历史用户消息里的普通截图存在被误隐藏的风险。

这两个问题都不是单纯 UI 样式 bug，而是 `conversation curtain normalization` contract 漂移：同一个 user observation 在 realtime、authoritative payload、history hydrate 三条路径上，没有共享足够精确的 wrapper / attachment canonicalization。

## Goals / Non-Goals

**Goals:**
- 让带 attributes 的 `project-memory` injected wrapper 与 optimistic user bubble 仍能被判定为同一条 user observation。
- 让 `记忆上下文摘要` 卡片在同一轮 assistant summary item + authoritative user payload 共存时只渲染一次。
- 让 note-card attachment filtering 仅影响 injected note-card 附件，不误伤普通用户截图，且该规则在 history reopen 路径仍成立。
- 为上述行为提供 focused regression tests，覆盖 realtime 与 history 两条 surface。

**Non-Goals:**
- 不调整 project memory / note-card 的发送协议或 persisted raw text。
- 不重构整个 `Messages` 或 `ConversationAssembler` 架构。
- 不把这次 change 扩大成所有附件渲染规则的通用 redesign。

## Decisions

### Decision 1: `project-memory` wrapper canonicalization 以语义匹配为准，不以裸标签字符串为准

选择：统一在 user normalization 路径上识别 `<project-memory\b[^>]*>...</project-memory>`，并继续把注入块后的真实用户输入作为 comparable user text。

原因：
- 真实发送链使用带 `source/count/truncated` 等 attributes 的 XML block。
- 如果 canonicalization 只认裸 `<project-memory>`，optimistic 与 authoritative user message 会被误判成不等价，直接打破 realtime 收敛。

备选方案：
- 方案 A：保留现有 normalization，只在 reconcile 阶段额外做一次“粗暴替换”。
- 方案 B：取消 user message 内的 injected XML，只保留 assistant summary item。

取舍：
- 方案 A 容易引入更宽泛的误判删除。
- 方案 B 会改变既有发送协议和历史兼容语义。
- 因此选“强化 canonicalization，不改协议”。

### Decision 2: memory summary dedupe 复用 note-card 的“assistant summary 优先”模型，但按 memory 语义键去重

选择：当同一轮已经存在 assistant `记忆上下文摘要` item，且后续 real user payload 只是在 raw text 中携带等价 memory wrapper 时，user bubble 不再重复渲染第二张 memory summary card。

原因：
- 现在用户真正需要看到的是“真实输入 + 一张 summary card”，而不是 “summary card + 包含同义 summary 的 user bubble”。
- 便签上下文已经有同类 contract，memory summary 应该与之保持 surface parity。

备选方案：
- 方案 A：仅靠 CSS 隐藏 user 侧 summary card。
- 方案 B：不插入 assistant summary item，完全依赖 user bubble 解析。

取舍：
- 方案 A 只能遮视图，不能修 row cardinality 与 copy/surface 行为。
- 方案 B 会回退现有 summary item 设计和历史兼容路径。
- 因此选“保留 assistant summary item，user 侧做语义 suppress”。

### Decision 3: note-card 图片去重必须以“确认为 injected attachment identity”为硬前提

选择：普通图片网格只过滤那些已经从当前消息 text 中解析出的 note-card attachment identities；如果消息没有可匹配的 injected attachment，任何普通用户截图都必须继续显示。

原因：
- note-card 去重的目标是“避免同一张 injected 附件重复渲染”，不是“只要走过 note-card render path 就可以删图片”。
- 历史会话 reopen 的 raw message + images 组合比 realtime 更容易暴露这种误删。

备选方案：
- 方案 A：history reopen 时关闭所有 note-card 图片去重。
- 方案 B：继续沿用现有过滤，但补更多路径判断。

取舍：
- 方案 A 会重新引入 note-card 上下文图片双显。
- 方案 B 如果仍不以 injected identity 为中心，后续还会再漂。
- 因此选“identity-scoped filtering”，对 realtime/history 一视同仁。

## Risks / Trade-offs

- [Risk] memory summary suppress 过宽，误隐藏本应独立显示的 user-side summary card。  
  → Mitigation：以同一轮 assistant summary + 等价 memory 语义键为前提，不做跨 turn 粗暴 suppress。

- [Risk] 放宽 `project-memory` wrapper regex 后，可能错误吞掉用户手写的相似 XML 文本。  
  → Mitigation：只在 user normalization / presentation helper 中识别位于消息前缀的 injected block，不对任意中段文本做 strip。

- [Risk] 图片 filtering 修正后，某些历史案例会重新出现 note-card 与普通网格双显。  
  → Mitigation：回归测试同时覆盖“真实普通截图保留”和“note-card injected attachment 仍可去重”两个方向。

## Migration Plan

1. 回写 OpenSpec proposal / design / spec delta，明确本次修复属于 `conversation curtain normalization` contract 回归。
2. 修改 normalization 与 render helper：
   - 放宽 `project-memory` wrapper canonicalization
   - 增加 memory summary suppress set / equivalent key
   - 收紧 note-card attachment filtering
3. 补齐 focused regression tests，优先覆盖：
   - optimistic user vs authoritative user with attributed memory wrapper
   - same-turn memory summary dedupe
   - history user screenshots remain visible
4. 运行 focused Vitest 与必要 typecheck。

回滚策略：
- 若 suppress 判定出现误伤，可单独回退 memory summary suppress，而保留 wrapper canonicalization。
- 若图片过滤修复造成 note-card 双显，可单独回退 attachment filtering 改动，但保留 history regression test 继续暴露问题。

## Open Questions

- 当前“历史会话中看不到用户的正常截图信息”是否只影响 Codex，还是 Claude / shared session 也共享同一误删路径？实现前可以先用 focused tests 验证，但 spec 先保持在共享 normalization contract 层，不写死单一引擎。
