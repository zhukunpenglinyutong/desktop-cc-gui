## Why

当前 updater 把后台自动检查、菜单手动检查和安装前补查都接到同一条 error UI 路径。只要 GitHub release feed 过期、网络抖动或 manifest 临时异常，后台检查就会弹出“更新失败”，把一个非阻塞维护信号误报成用户可操作失败。

`2026-04-26` 实测仍能复现风险条件：本地 `package.json` 与 `src-tauri/tauri.conf.json` 已是 `0.4.9`，但线上 `releases/latest/download/latest.json` 仍返回 `0.4.8`。客户端不能依赖 release feed 永远同步，必须把 updater check 建成可降级、可并发防串线的状态机。

## 目标与边界

### 目标

- 区分 background updater check 与 interactive updater check。
- 让后台自动检查失败时只写 debug 并回到 `idle`，不得弹出 error toast。
- 让用户主动触发的检查仍保持可交互反馈：失败显示 error，未发现更新显示 “已是最新版本”。
- 防止并发 update check 的旧请求结果覆盖最新 updater state。
- 补齐 regression tests，把 silent failure、manual failure、manual no-update 与 stale request 行为固化。

### 边界

- 本 change 只处理客户端 updater check 状态机与 UI 触发意图，不修改 Tauri updater plugin。
- 本 change 不修改 release endpoint、签名、公钥或发布工作流。
- 本 change 不解决发布侧 `latest.json` 过期本身；发布链路同步可另开 change。

## 非目标

- 不重做 `UpdateToast` 的视觉设计。
- 不新增 release feed 健康检查面板。
- 不把自动更新降级为完全关闭。
- 不引入新的 updater 依赖或自定义 manifest parser。

## What Changes

- 修改 `useUpdater` 的 check contract：
  - `checkForUpdates` 接收 `interactive` 与 `announceNoUpdate` 语义；
  - background check failure 只调用 `onDebug`，并将状态恢复为 `idle`；
  - interactive check failure 显示 `error` state；
  - interactive no-update 显示 `latest` state 并自动 dismiss。
- 为 update check 增加 request id guard：
  - 每次 check 生成递增 request id；
  - stale success / stale failure 不得覆盖最新 state；
  - stale request 持有的 update handle 必须安全 close。
- 修改菜单触发路径：
  - `subscribeUpdaterCheck` 触发时必须使用 interactive check；
  - 用户点击 “Update/Retry” 但当前没有 cached update handle 时，也必须作为 interactive check 处理。
- 保持后台启动检查低打扰：
  - app 启动或自动后台检查仍可发现新版本；
  - 但网络/manifest/签名临时失败不得弹 toast。
- 增加 targeted tests：
  - background failure silent；
  - manual failure visible；
  - manual no-update latest toast auto dismiss；
  - stale request cannot override latest state；
  - dismiss / unmount invalidates pending checks and closes handles.

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险 / 成本 | 结论 |
|---|---|---|---|---|
| A | 只把启动自动检查包一层 try/catch，失败不展示 | 改动最小 | 菜单检查、安装前补查、并发 stale response 仍然混在一起；状态机契约继续模糊 | 不采用 |
| B | 在 `useUpdater` 内引入 check intent 与 request id guard，所有入口复用同一状态机 | 保持状态收口；能同时解决误报 toast 与旧请求覆盖；测试面清晰 | 需要更新 hook tests 与调用点语义 | **采用** |
| C | 在 Tauri backend 或 release workflow 层过滤 stale `latest.json` | 能减少过期 manifest 影响 | 无法解决网络失败和并发前端状态覆盖；发布链路不是本次客户端 UX 的必要依赖 | 本期不采用 |

采用 B 的原因：问题根因在客户端 updater state machine 的意图丢失与并发无序，而不是单个 endpoint 是否偶发过期。release feed 应该被修，但客户端必须先具备容错能力。

## Capabilities

### New Capabilities

- `updater-check-fallback`: Defines background/interactive update check behavior, no-update announcement, failure surfacing, and stale request protection for the updater UI state machine.

### Modified Capabilities

- None.

## 验收标准

- 后台自动检查失败时，系统 MUST 记录 debug entry，并 MUST NOT 展示 `UpdateToast` error state。
- 用户通过菜单或 toast retry 触发检查失败时，系统 MUST 展示 error state，并保留可 dismiss / retry 的交互。
- 用户主动检查且没有可用更新时，系统 MUST 展示 `latest` state，并在既有时长后自动回到 `idle`。
- 当多个 update check 并发时，旧请求的 success / no-update / failure MUST NOT 覆盖更新请求已经写入的 state。
- stale request 持有的 update handle MUST 被关闭，不能泄漏。
- dismiss 或 unmount 后，pending check 结果 MUST NOT 再恢复旧 toast state。
- 相关验证至少覆盖：
  - `npm exec vitest run src/features/update/hooks/useUpdater.test.ts src/features/update/components/UpdateToast.test.tsx`
  - `npm run typecheck`
  - `openspec validate fix-updater-check-fallback --type change --strict --no-interactive`

## Impact

- Frontend:
  - `src/features/update/hooks/useUpdater.ts`
  - `src/features/update/hooks/useUpdater.test.ts`
  - `src/features/app/hooks/useUpdaterController.ts`
  - 可能涉及 `src/features/update/components/UpdateToast.test.tsx`
- Runtime / release:
  - 不修改 `src-tauri/tauri.conf.json`
  - 不修改 `.github/workflows/release.yml`
  - 不新增依赖
- Specs:
  - 新增 `openspec/changes/fix-updater-check-fallback/specs/updater-check-fallback/spec.md`
