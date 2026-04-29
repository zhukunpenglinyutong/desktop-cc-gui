## Context

当前 `thread not found` 恢复链路已经有两层保护：

- `codex-stale-thread-binding-recovery` 归档变更引入了 verified alias 与 recover-only 入口。
- `conversation-runtime-stability` 已经把 runtime readiness / explicit recovery 与 automatic quarantine 分层。

但用户截图里的失败点不在 runtime 是否可用，而在当前 UI 绑定的旧 Codex `threadId` 已经不能被 `thread/resume` 或 `turn/start` 接受。现有 `recoverThreadBindingForManualRecovery` 只返回 `string | null`，调用方无法知道这个 id 是 verified replacement，还是 fallback 新建的 fresh thread。于是 resend path 继续使用“旧会话重放”的 suppression 策略，用户看到的结果像是按钮无效。

## Goals / Non-Goals

**Goals:**

- 将 manual stale-thread recovery 的返回值结构化，明确 `rebound`、`fresh`、`failed`。
- 让 `recover and resend` 在 fresh fallback 下可见地发送上一条 prompt。
- 让 recover-only 在没有 verified replacement 时保持保守，不把 fresh thread 伪装成旧会话恢复。
- 保持正常 runtime reconnect、Runtime Pool lease、warm TTL、pin/release 行为不变。

**Non-Goals:**

- 不新增后端 command 或 runtime ledger。
- 不通过“最近会话”启发式替换旧 thread。
- 不保证旧 Codex thread 原地复活。
- 不改非 Codex engine 的恢复语义。

## Decisions

### Decision 1: 使用 structured manual recovery result

`manualThreadRecovery` 应返回形如：

- `kind: "rebound"`：`refreshThread` 找到 verified replacement 或原 thread 可恢复。
- `kind: "fresh"`：无法 rebind，但 `startThreadForWorkspace` 创建了新 thread。
- `kind: "failed"`：既无法 rebind，也无法创建新 thread。

取舍：这比继续返回 `string | null` 多一点类型改动，但能消除调用方猜测，避免把 fresh thread 当 rebind 使用。

### Decision 2: recover-only 不消费 fresh fallback 作为成功恢复

recover-only 的语义是“恢复当前会话绑定”。如果只有 fresh thread 可用，它不应报告旧会话恢复成功。实现上可以返回 fresh result 并由 UI 展示“旧会话不可恢复，可在新会话继续”的失败/提示状态；不应静默成功。

替代方案是 recover-only 也直接切到 fresh thread。拒绝：这会让“旧会话恢复”和“开新会话继续”在用户心智里混成一件事。

### Decision 3: recover-and-resend 在 fresh fallback 下允许可见 user prompt

如果 result 是 `rebound`，沿用当前 suppression，避免重复渲染旧 user bubble。

如果 result 是 `fresh`，调用 `sendUserMessageToThread` 时不应继续 `suppressUserMessageRender: true` / `skipOptimisticUserBubble: true`。fresh thread 没有这条 user prompt 的历史上下文，用户必须看到上一条 prompt 被发送到了新会话。

替代方案是 fresh fallback 后仍 suppress user bubble。拒绝：这正是“点击无效”的主要体感来源。

### Decision 4: runtime readiness 只作为前置条件，不承载 thread identity 修复

`RuntimeReconnectCard` 可以继续在按钮链路中调用 `ensureRuntimeReady`，但 `thread-not-found` 的成功判断必须来自 manual recovery result，而不是 runtime ready 成功。这样不会改 Runtime Pool、lease 或 warm retention 逻辑。

## Risks / Trade-offs

- [Risk] fresh fallback 可能让用户误以为旧上下文完整保留。  
  Mitigation: UI copy / result kind 必须区分 fresh continuation 与 recovered session。

- [Risk] callback 类型变更可能影响 message surface props。  
  Mitigation: 修改范围限制在 `RuntimeReconnectCard`、`Messages` props 和 app-shell adapter，补 focused Vitest。

- [Risk] fresh fallback resend 可能产生一条新的 user bubble。  
  Mitigation: 只在 `kind === "fresh"` 时开启可见 optimistic/user render；`rebound` 继续去重。

## Migration Plan

1. 扩展 manual recovery result type，保留现有成功路径的行为。
2. 调整 app-shell 的 recover-only / recover-and-resend 分流。
3. 调整 reconnect card 对 structured result 的失败判断。
4. 补测试并运行 focused Vitest + typecheck。

Rollback：若 fresh fallback 产生异常，可先禁用 fresh result 的 resend 可见化，退回到 `failed`，不影响 verified rebind 与普通 runtime reconnect。

## Open Questions

- fresh fallback 的 copy 是否需要新增 i18n key，还是复用现有 recover failed detail 加上 returned status。实现时优先新增窄口 i18n key，避免硬编码用户可见文案。
