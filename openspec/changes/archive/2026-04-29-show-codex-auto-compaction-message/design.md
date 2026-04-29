## Context

Codex 自动压缩已有两条可见面：
- Composer footer / tooltip 根据 `isContextCompacting` 与 context usage 展示压缩状态。
- 非 Codex 线程在 `thread/compacted` 后继续沿用 `Context compacted.` 语义消息。

缺口在消息幕布：`thread/compacting` 只驱动 working indicator，不会写入 timeline item。长会话里自动压缩或用户主动点击 `/compact` 按钮时，用户只能看到泛化 loading，无法判断系统实际在压缩背景信息。

本变更只触及 frontend event routing 与 thread state，不改变 Rust auto-compaction 调度器、RPC method fallback 或 token usage contract。

## Goals / Non-Goals

**Goals:**
- 将已确认的 Codex `/compact` lifecycle 映射为消息幕布内可见语义文案。
- 手动按钮与自动阈值触发共用同一条幕布文案，避免手动路径无反馈。
- 保持 existing `thread/compacting` / `thread/compacted` state contract 与 ContextBar 一致。
- 用 reducer 去重保证同一次 lifecycle 只出现一条状态消息。

**Non-Goals:**
- 不新增 system message item type。
- 不持久化新的 runtime metadata。
- 不修改 backend compaction scheduling。
- 不影响 Claude prompt-overflow recovery 的 compaction 文案与现有测试。

## Decisions

### Decision 1: 复用 message item，而不是新增 item kind

- 方案 A：新增 `ConversationItem.kind = "system"`。
  - 优点：类型语义最准确。
  - 缺点：会触及 renderer、history loader、indexing、tests，多处 contract 需要迁移。
- 方案 B：复用 assistant message item，使用稳定 id 前缀区分系统语义。
  - 优点：与现有 `Context compacted.` 路径一致，改动小，可直接显示在幕布。
  - 缺点：类型层无法显式表达 system item。

结论：采用 B。本期目标是补可见性，不扩大 item 模型。

### Decision 2: 在 `thread/compacting` payload 保留 auto/manual 语义，但幕布显示覆盖两者

前端当前只读取 usage percent，忽略 `auto` / `manual`。本变更把可选字段透传到 `onContextCompacting` / `onContextCompacted` payload：
- 线程为 Codex 且未被标记为非压缩事件时，视为 Codex `/compact` lifecycle。
- `manual === true` 与自动触发都追加同一条通用压缩文案。

字段缺失时维持兼容：Codex runtime 的自动路径通常不带 `manual`，仍应显示压缩文案；显式手动路径已有 `manual: true`，也进入同一幕布反馈。

### Decision 3: compacting item 在完成时优先原地收敛，必要时补 completed fallback

开始事件追加：
- id: `context-compacted-codex-compact-<threadId>-<timestamp>`
- text: i18n 后的“正在压缩背景信息”

同一 lifecycle 若手动入口与 `thread/compacting` 事件都到达，reducer 只去重相邻、同文本的 started 文案，避免双插。

完成事件分两种情况：
- 若当前线程最近一条 Codex compaction message 仍是 started，则原地把该 message 的 text 更新为“已压缩背景信息”，保留原消息 id 与时间线位置。
- 若当前只收到了 `thread/compacted`，但幕布中没有可结算的本轮 started message，则追加 `context-compacted-codex-compact-<threadId>-completed-<turnId>` 形式的 completed fallback。

同一个 fallback id 重复到达时必须 no-op，避免 completion-only 路径重复追加。

### Decision 4: i18n 在 handler 层解析，reducer 只接收文本

Reducer 不直接依赖 `i18n`。`useThreadTurnEvents` 使用 `t(...)` 生成用户文案，再通过 action 传入 reducer。这样符合现有 `pushThreadErrorMessage` 的文案处理模式，也避免 reducer 与 i18n 耦合。

## Risks / Trade-offs

- [Risk] Codex 事件缺少 `auto/manual` 字段时误判  
  → Mitigation: 只对 Codex compaction lifecycle 事件写幕布文案；字段缺失时按兼容路径显示通用压缩文案。

- [Risk] completion-only 路径错误结算到上一轮 completed  
  → Mitigation: completion fallback 使用 `completed-<turnId>` 独立 id，仅在当前没有 tracked started 时追加，并对同一 fallback id 去重。

- [Risk] 旧历史会话不会回补压缩过程文案  
  → Mitigation: 本变更只针对实时 lifecycle 可见性；历史恢复保持当前行为。

## Migration Plan

1. 扩展 frontend compaction payload type。
2. 增加 reducer actions：`appendCodexCompactionMessage` 与 `settleCodexCompactionMessage`。
3. 在 compacting/compacted handler 中按 engine/manual guard 调用 action，并在 completion-only 场景生成 fallback id。
4. 补 i18n 与 targeted tests。

Rollback：删除新增 action 调用即可回到旧行为；不涉及数据迁移与 backend 协议回滚。

## Open Questions

- 是否后续把 `Context compacted.` 也切换为 i18n。当前保持原状以降低回归面。
