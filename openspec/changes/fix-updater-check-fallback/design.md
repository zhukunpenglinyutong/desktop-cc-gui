## Context

当前 updater hook 的状态机只有一条失败出口：`check()` 抛错后无条件进入 `{ stage: "error" }`。这让三个语义完全不同的入口被混在一起：

- app 启动后的 background check；
- 菜单触发的用户主动检查；
- 用户点击 update / retry 时，如果还没有 cached update handle，会先补跑一次 check。

这套模型的问题不是文案，而是 intent 丢失。后台检查失败本应是低优先级维护信号，却被渲染成用户必须处理的 toast；同时多个 check 并发时，旧请求仍可能在新请求之后写 state，造成 updater surface 回退。

本 change 只改 frontend updater 状态机，不碰 release endpoint 与 Tauri updater plugin。实现时应遵循 frontend 规范：状态逻辑收口在 hook，用户可见文案继续走 i18n，测试覆盖状态迁移。

## Goals / Non-Goals

**Goals:**

- 在 `useUpdater` 内显式区分 background 与 interactive check。
- 让 silent background failure、manual visible failure、manual no-update toast 都由同一状态机表达。
- 用 request id guard 保护并发 check，避免 stale response 覆盖最新 state。
- 安全关闭被 stale request 或 dismiss/unmount 遗留的 update handle。
- 不改变现有 `UpdateToast` 的公共 props 和主要视觉行为。

**Non-Goals:**

- 不改 `.github/workflows/release.yml` 生成 `latest.json` 的逻辑。
- 不校验远端 manifest version 是否与本地版本一致。
- 不新增后台重试调度或 release health telemetry。
- 不扩展到 backend command 或 Rust 存储层。

## Decisions

### 1. `checkForUpdates` 接收 intent，而不是新增第二套 check 函数

采用：

```ts
type CheckForUpdatesOptions = {
  announceNoUpdate?: boolean;
  interactive?: boolean;
};
```

`interactive` 决定失败是否进入 error UI；`announceNoUpdate` 决定无更新时是否展示 `latest` toast。

不采用 `checkForUpdatesSilently()` / `checkForUpdatesManually()` 两个函数的原因：

- 入口会继续分散，后续 startUpdate / menu / background 仍容易出现语义漂移；
- request id、handle close、timeout cleanup 会被复制；
- 当前问题需要的是状态机收口，而不是 API 数量增加。

### 2. background failure 只写 debug，并显式回到 idle

当 `check()` 抛错且 `interactive !== true`：

- 保留 `onDebug({ label: "updater/error", ... })`；
- `setState({ stage: "idle" })`；
- 不展示 error toast；
- 不吞掉 close cleanup。

选择保留 debug，是为了避免 silent failure 变成不可观测；选择 UI 静默，是为了避免 release feed / network 短暂异常打断用户主流程。

### 3. manual check 是唯一可以展示 check failure 的入口

以下入口必须设置 `interactive: true`：

- 菜单触发 `subscribeUpdaterCheck`；
- `startUpdate()` 中没有 `updateRef.current` 时的补查；
- toast retry 如果复用 `startUpdate()`，也继承 interactive check。

这样用户点击“检查/更新/重试”后仍能看到失败原因，不会把真实交互失败悄悄吞掉。

### 4. request id guard 是 hook 内部契约

`useUpdater` 持有 `checkRequestIdRef`。每次 check：

1. 递增 request id；
2. 在 async continuation 中通过 `isStaleRequest()` 判断当前请求是否仍是最新；
3. stale request 不写 state；
4. stale request 拿到的 update handle 必须 close，除非它已经被最新 state 接管。

dismiss 与 unmount 也必须 invalidate pending checks，避免用户手动关闭 toast 后旧请求又把 toast 恢复出来。

### 5. `latest` toast timeout 也受 request id 保护

manual no-update 会进入 `latest` state，并设置既有 2000ms timeout。timeout fire 时必须再次确认 request id 仍匹配；如果期间有新 check、dismiss 或 unmount，timeout 不得把状态写回旧值。

这比单纯 `clearTimeout()` 更稳，因为浏览器事件循环中 timeout callback 可能已排队。

### 6. close 旧 update handle 时保持微创

现有 hook 在发现 update 时直接 `updateRef.current = update`。本期应补齐两个边界：

- 如果已有 `currentUpdate` 且新 update 不同，关闭旧 handle；
- 如果 check 得到 update 但请求已经 stale，关闭新 handle。

不额外引入 handle registry；一个 `updateRef` 加局部 `update` 足以表达当前需求。

## Risks / Trade-offs

- [Risk] background failure 静默后，真实发布配置错误可能不再被普通用户看到。  
  Mitigation: debug entry 仍保留；用户主动检查仍显示 error。

- [Risk] request id invalidate 写错会导致可用 update 被误 close。  
  Mitigation: targeted tests 覆盖 stale failure、stale no-update、newer available 三类状态。

- [Risk] `startUpdate()` 语义变化后，之前测试里 “无 update 时回 idle” 会变为 manual no-update 显示 `latest`。  
  Mitigation: 这是期望行为变化；更新测试名称与断言，明确它是用户主动入口。

- [Risk] 菜单事件属于 Tauri event，是否算 interactive 可能有争议。  
  Mitigation: 菜单是用户主动点击，必须 interactive；后台自动 check 才 silent。

## Migration Plan

1. 修改 `useUpdater` options 与内部 request id guard。
2. 更新 `useUpdaterController`，菜单事件调用 interactive check。
3. 更新 `useUpdater.test.ts`，覆盖 silent / interactive / stale request。
4. 保持 `UpdateToast.tsx` 不变；仅在必要时补充 toast tests。
5. 运行 targeted Vitest、typecheck 与 OpenSpec validate。

**Rollback:**

- 若新状态机误伤，可回退 `interactive` 分支到原有 error 行为；
- request id guard 可以独立保留，因为它只阻止 stale response，不改变正常成功路径。

## Open Questions

- 是否需要在 release workflow 另开 change，确保 `latest.json` 与 app version 同步？当前判断：需要，但不属于本客户端状态机修复。
- 是否要把 background failure debug entry 降级为 `source: "debug"` 而不是 `source: "error"`？当前判断：先沿用既有 `updater/error`，避免 debug viewer contract 变化。
