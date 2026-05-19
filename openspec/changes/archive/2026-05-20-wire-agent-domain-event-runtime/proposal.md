## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。当前客户端已经有 `src/features/threads/domain-events/*` schema/factory/derivation fixtures。原始 runtime bus 方案过宽，收敛后本 change 仅保留 **Deferred / P1 runtime bridge**：等 P0 evidence bridge 和 audit surface 落地后，再判断是否需要 in-memory event subscription。

## Why

domain event schema 已经存在，但当前 harness 治理下一步并不必须引入 runtime EventBus。过早接入 reducer emit 会扩大状态副作用面，并可能形成第二套事件系统。

中文一句话：**schema 先够用；runtime bus 等有明确消费者再做。**

## What Changes

- Keep capability `agent-domain-event-runtime` as deferred P1.
- Preserve future constraints:
  - in-memory only.
  - no persistence.
  - no IPC.
  - consumer cannot publish.
  - reducer behavior must remain unchanged.
- Remove current-stage session-activity raw mode, ring buffer, dev inspector, and mandatory reducer integration.

## Scope

### In Future Scope

- Minimal in-memory subscribe contract if a concrete governance consumer needs raw events.
- Reducer emit bridge only after pure derivation fixtures prove parity.

### Out Of Current Stage

- No EventBus implementation.
- No reducer emit integration.
- No ring buffer.
- No session-activity raw mode.
- No dev inspector.

## Validation

Stage validation intentionally skips the full noise sentry; run it only during final harness-wide integration closure.

```bash
openspec validate wire-agent-domain-event-runtime --strict --no-interactive
```
