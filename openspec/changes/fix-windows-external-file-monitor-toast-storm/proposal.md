## Why

Windows 用户在独立文件视图中遇到 stale tab、已删除目录或父路径不存在时，外部文件监控会反复弹出 `External file monitor is unavailable`。截图中的 `Failed to open file: 系统找不到指定的路径。 (os error 3)` 属于 Windows path-not-found 场景，本质是当前文件路径已不可读，不应被升级为“监控不可用”的高噪音 toast。

这个问题需要现在修复：独立文件视图的 watcher/polling 会在启动同步、fallback 事件和定时轮询中重复读取同一个路径；如果错误分类错误，用户会在 Windows 上被持续 toast 打断。

## 目标与边界

### 目标

- 将 Windows `os error 3`、`path not found`、`system cannot find the path specified` 归类为 missing/stale file path，而不是 external monitor unavailable。
- 保持现有 missing-file 行为：文件或路径不存在时静默停止当前刷新尝试，不弹监控不可用 toast。
- 保留真实监控不可用或非 missing-file 错误的 toast 能力，例如权限、资源忙、sharing violation 之外的持续读盘失败。
- 补齐自动化测试，覆盖 Windows path-not-found 文案不会触发 monitor unavailable toast。
- 保持 watcher / polling / backend command contract 不变，不引入新设置项。

### 边界

- 本变更只处理独立文件视图的 external file monitor toast noise。
- 本变更不修改 Tauri command 参数、事件 payload 字段或 watcher 后端架构。
- 本变更不改变文件不存在时主文件读取区域的 error 展示，只约束 external sync 后台刷新 toast。
- 本变更不新增全局 toast 去重系统；如需跨窗口全局限流，后续单独提案。

## 非目标

- 不重写 detached external change watcher / polling 运行时。
- 不改变 `readWorkspaceFile` 的后端错误格式。
- 不隐藏真实权限问题、文件锁问题或不可恢复 IO 问题。
- 不为 Windows 以外平台引入额外平台分支。
- 不修复可能导致 stale tab 的上游导航或文件树状态问题。

## What Changes

- 扩展 frontend external sync 的 missing-file 错误分类，覆盖 Windows path-not-found 错误。
- 保持 `os error 2`、`No such file or directory` 等既有静默行为。
- 新增/更新 FileViewPanel 或 hook 自动化测试，证明 `os error 3` 不触发 `External file monitor is unavailable`。
- 保持真实非 missing-file 错误的阈值与 cooldown 逻辑不变。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险/成本 | 结论 |
|---|---|---|---|---|
| A | 在前端 missing-file 正则中加入 Windows path-not-found 变体 | 改动小；贴近 toast 分类源头；不改 IPC contract；易测 | 仍依赖 backend 文案模式 | **采用** |
| B | 后端 `readWorkspaceFile` 返回结构化错误码 | 长期更稳，避免前端解析字符串 | 跨层 contract 改动大，需要更新 service/types/tests；超出本次止血范围 | 后续可作为独立优化 |
| C | 做全局 toast 去重/限流 | 可以降低所有重复 toast 噪音 | 治标不治本；会隐藏错误分类问题；影响面更广 | 不采用 |

## Capabilities

### New Capabilities

- `detached-external-file-monitor-toast-control`: 定义独立文件视图 external file monitor 在 missing/stale path 与真实监控不可用错误之间的 toast 分类与自动化测试契约。

### Modified Capabilities

- 无。现有独立文件视图 watcher/polling 能力保持不变，本变更新增更窄的 toast 分类契约。

## 验收标准

- Windows `Failed to open file: 系统找不到指定的路径。 (os error 3)` MUST 被视为 missing/stale path，不触发 `External file monitor is unavailable` toast。
- 英文 Windows `The system cannot find the path specified` / `path not found` MUST 被视为 missing/stale path。
- 既有 `os error 2` / `No such file or directory` missing-file 行为 MUST 保持不变。
- 非 missing-file 的持续读盘错误达到既有阈值后 SHOULD 继续触发 `External file monitor is unavailable`。
- watcher startup sync、watcher event、polling tick 触发的 stale path refresh MUST 不产生 monitor unavailable toast storm。
- 自动化测试 MUST 覆盖 Windows `os error 3` 不弹 toast 的回归场景。

## Impact

- Frontend:
  - `src/features/files/hooks/useFileExternalSync.ts`
  - `src/features/files/components/FileViewPanel.test.tsx` 或 `src/features/files/hooks/useFileExternalSync.test.tsx`
- Backend:
  - 无强制改动。
- Services / IPC:
  - 不改变 `readWorkspaceFile`、`detached-external-file-change` event payload 或 command 参数。
- Dependencies:
  - 不新增第三方依赖。
- Validation:
  - `openspec validate fix-windows-external-file-monitor-toast-storm --strict`
  - focused Vitest for touched file external sync behavior
  - `npm run typecheck`
