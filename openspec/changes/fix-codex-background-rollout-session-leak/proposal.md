# Change: Fix Codex Background Rollout Session Leak

## Why

用户反馈“只是切了几次 Codex 会话，自动出现新的 Codex 会话”。保活重构已经解决 runtime / turn liveness 的死亡边界，但当前代码仍存在两个独立风险：

- 历史会话选择仍会通过 `resumeThreadForWorkspace -> resume_thread -> ensure_codex_session` 隐式获取 Codex runtime；这不是纯 UI restore。
- Codex 本地 rollout 扫描只过滤少数 helper prompt，未覆盖 `Memory Writing Agent` 等后台 consolidation rollout，导致后台 prompt 可进入 sidebar / recent conversation。

这会让偶发后台 rollout 看起来像“客户端自动新建会话”。根因不是用户写死脚本被执行，而是 history projection 缺少 background/helper 可见性契约，且历史打开路径与 runtime acquisition 边界过宽。

## What Changes

- Extend Codex unified history projection so background/helper rollouts, including memory writing consolidation prompts, are excluded from default conversation surfaces.
- Make Codex history selection able to load durable local history without forcing `thread/resume` when local session entries already reconstruct visible history.
- Keep runtime-required actions such as send, explicit retry, fork, and stale recovery on the existing runtime acquisition path.

## Non-Goals

- Do not delete local Codex JSONL rollout files.
- Do not hide usage/statistics data that may still be needed by non-conversation analytics.
- Do not change Codex runtime keepalive policy or warm TTL.
- Do not redesign all engine history loaders.

## Impact

- Sidebar / recent conversation projection becomes stricter for Codex helper sessions.
- Switching to a completed local Codex history session no longer needs to spawn a Codex runtime.
- Explicit runtime actions remain unchanged.
