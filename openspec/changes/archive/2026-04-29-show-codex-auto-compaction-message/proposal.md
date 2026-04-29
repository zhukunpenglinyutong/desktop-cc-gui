## Why

Codex 长对话触发 `/compact` 时，Composer 的 context tooltip 已能显示压缩入口/状态，但对话幕布仍只表现为泛化 loading。用户无法判断当前是在正常生成、卡住，还是 Codex 正在压缩背景信息。

## 目标与边界

- 目标：当 Codex `/compact` 生命周期被真实事件确认时，在消息幕布追加可见语义文案。
- 目标：复用现有 `thread/compacting` / `thread/compacted` / reducer 生命周期，不新增 Tauri command。
- 目标：文案走 i18n，并保持同一次压缩去重。
- 边界：仅作用于 Codex `/compact`；Claude、Gemini、OpenCode 路径不改变。
- 边界：不改变自动压缩触发阈值、RPC fallback、runtime contract 与历史恢复逻辑。

## 非目标

- 不重新设计 ContextBar / dual context tooltip。
- 不新增全局通知中心或 toast。
- 不把所有 engine 的 compaction 文案统一重构。
- 不修改 Codex 自动压缩调度策略。

## What Changes

- 在前端事件路由中保留 `thread/compacting` / `thread/compacted` 的 `auto/manual` 语义，让下游能区分自动压缩与手动压缩。
- 对 Codex `/compact` 开始事件，在当前线程消息幕布中追加一条去重状态文案。
- 对 Codex `/compact` 完成事件，将开始文案收敛为完成文案，避免用户只看到 loading。
- 保持 `isContextCompacting`、Composer dual context state 与已有 `Context compacted.` 兼容语义不回退。
- 增加 targeted tests 覆盖 auto/manual 与 Codex/non-Codex 边界。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险/成本 | 结论 |
|---|---|---|---|---|
| A. 只改 loading 文案 | `isContextCompacting` 时把 working label 改成更明确的压缩文案 | 改动极小 | 只在 loading 行可见，历史中不留语义痕迹；完成后用户仍不知道发生过什么 | 不选 |
| B. 在 thread item 中写入语义消息 | 由真实 compaction lifecycle 驱动 reducer 追加/更新幕布消息 | 可见、可测试、与现有对话时间线一致 | 需要扩展 action 与去重规则 | 选用 |
| C. 新增专用系统消息 item 类型 | 增加 `ConversationItem.kind = "system"` | 语义最干净 | 触及所有 renderer/history/type 分支，范围过大 | 本期不选 |

## 验收标准

- Codex 自动压缩开始后，消息幕布出现“正在压缩背景信息”的可见文案。
- Codex 手动 `/compact` 按钮触发后，消息幕布出现同样的压缩可见文案。
- Codex `/compact` 完成后，消息幕布中的压缩状态收敛为完成文案。
- 同一次 `/compact` 不会重复刷多条压缩文案。
- 非 Codex 线程不显示 Codex 自动压缩文案。

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `codex-context-auto-compaction`: 增加 Codex `/compact` 在消息幕布中的用户可见语义反馈要求。

## Impact

- 受影响代码：
  - `src/features/app/hooks/useAppServerEvents.ts`
  - `src/features/threads/hooks/useThreadTurnEvents.ts`
  - `src/features/threads/hooks/useThreadsReducer.ts`
  - `src/i18n/locales/*.ts`
- API/协议影响：
  - 不新增必选字段，不新增 Tauri command。
  - 前端兼容读取 `auto/manual` 可选字段；字段缺失时保持现有行为。
- 验证：
  - targeted Vitest 覆盖事件路由、turn event handler 与 reducer。
  - `npm run typecheck` 确认类型闭环。
