# Journal - chenxiangning (Part 3)

> Continuation from `journal-2.md` (archived at ~2000 lines)
> Started: 2026-04-21

---



## Session 69: 加固 Codex runtime 异常退出恢复链路

**Date**: 2026-04-21
**Task**: 加固 Codex runtime 异常退出恢复链路
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标：对当前工作区进行全面 review，重点检查 runtime recovery 相关改动在边界条件、异常输入、大文件治理和 Windows/macOS 兼容性上的完整性，并直接修复发现的问题后提交。

主要改动：
- 为 Codex runtime 异常退出链路补齐 OpenSpec 变更与后端模块拆分，新增 runtime lifecycle / plan enforcement 模块。
- 在 Rust runtime pool 中记录 active work protection、last exit diagnostics、pending request count，并在 runtime ended / manual release 等场景下正确清理 lease 与状态。
- 在前端 useAppServerEvents 中完善 runtime/ended 事件处理，支持仅凭 affectedActiveTurns 做线程 teardown，并把 pendingRequestCount 归一化为非负整数。
- 在 Runtime Pool Console 与消息恢复卡片中补齐 runtime ended 诊断展示及中英文文案。
- 新增/更新前端与 Rust 定向测试，覆盖 runtime ended、共享线程映射、恢复提示与稳定性诊断。
- 将 runtime ledger 原子写实现对齐项目现有 storage 模式，降低 Windows 文件替换失败时的残留临时文件风险。

涉及模块：
- src-tauri/src/backend/app_server*.rs
- src-tauri/src/runtime/mod.rs
- src/features/app/hooks/useAppServerEvents*
- src/features/messages/components/RuntimeReconnectCard.tsx
- src/features/settings/components/settings-view/sections/RuntimePoolSection.tsx
- src/features/threads/utils/stabilityDiagnostics*
- src/i18n/locales/en.part1.ts
- src/i18n/locales/zh.part1.ts
- openspec/changes/harden-codex-runtime-exit-recovery/**

验证结果：
- npm run typecheck 通过。
- npm run check:runtime-contracts 通过。
- npm run check:large-files 通过，未新增超过 3000 行文件。
- npx vitest run src/features/app/hooks/useAppServerEvents.test.tsx src/features/app/hooks/useAppServerEvents.runtime-ended.test.tsx src/features/messages/components/Messages.runtime-reconnect.test.tsx src/features/threads/utils/stabilityDiagnostics.test.ts 通过（70 tests）。
- cargo test --manifest-path src-tauri/Cargo.toml runtime_ended 通过。
- npm run lint 通过，但仓库内仍存在既有 react-hooks/exhaustive-deps warnings，本次未新增 lint error。

后续事项：
- app_server 模块拆分后，auto-compaction 触发链仍被临时禁用，当前保留手动 compact 路径，后续若恢复自动 compact 需单独补 capability 回归测试。
- 这次录入了新的 OpenSpec change，后续如继续推进该链路，建议补充 validate/sync/archive 流程。


### Git Commits

| Hash | Message |
|------|---------|
| `d34a18547b1b0dd957eeb1dcc2fc94f0c8c85bed` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 70: 统一 runtime 实例保留时长默认值与上限

**Date**: 2026-04-21
**Task**: 统一 runtime 实例保留时长默认值与上限
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标:
- 调整 Runtime Pool Console 中 Codex Warm 实例保留时长配置
- 将默认值统一为 7200 秒，将最大值统一为 14400 秒
- 消除 frontend 与 backend 默认值、输入约束、持久化清洗之间的配置漂移

主要改动:
- 更新 frontend app settings 默认值与 normalize 兜底逻辑，统一 codexWarmTtlSeconds 为 7200/14400
- 更新 RuntimePoolSection 的本地草稿默认值、保存时 clamp 逻辑与输入 max 属性
- 更新 backend AppSettings 默认值与 sanitize_runtime_pool_settings 上限，避免落库后被旧约束回收
- 同步调整 SettingsView 与 runtimePoolSection 工具测试，以及 Rust sanitize 测试期望

涉及模块:
- src/features/settings/hooks/useAppSettings.ts
- src/features/settings/components/settings-view/sections/RuntimePoolSection.tsx
- src/features/settings/components/settings-view/sections/runtimePoolSection.utils.test.ts
- src/features/settings/components/SettingsView.test.tsx
- src-tauri/src/types.rs

验证结果:
- 通过: npx vitest run src/features/settings/components/settings-view/sections/runtimePoolSection.utils.test.ts src/features/settings/components/SettingsView.test.tsx
- 通过: npm run typecheck
- 通过: cargo test --manifest-path src-tauri/Cargo.toml app_settings_sanitize_runtime_pool_settings_clamps_budget_fields
- 通过: cargo test --manifest-path src-tauri/Cargo.toml read_settings_sanitizes_runtime_pool_values

后续事项:
- 若产品侧还希望限制更精细的输入体验，可补充输入框 help 文案，直接展示 7200 秒默认值与 14400 秒上限


### Git Commits

| Hash | Message |
|------|---------|
| `cf87cb3be0666158a508cfc3a9fcb6f85363aae6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 71: 支持历史幕布按分段吸顶用户问题

**Date**: 2026-04-21
**Task**: 支持历史幕布按分段吸顶用户问题
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标:
- 落地 pin-history-user-question-bubble，对历史幕布提供按分段吸顶的用户问题气泡。
- 保持 realtime sticky 现有 contract，不与 history sticky 混用。

主要改动:
- 在 Messages.tsx 中拆分 live sticky 与 history sticky 的资格判断。
- 在 messagesLiveWindow.ts 中导出 ordinary user 问题判定，复用伪 user 过滤逻辑。
- 在 messages.css 中为 history sticky 复用现有 sticky wrapper 视觉与 top offset。
- 在 Messages.live-behavior.test.tsx 中补充 history sticky、realtime 优先级、伪 user 排除、collapsed-history 边界回归测试。
- 新增 OpenSpec change: pin-history-user-question-bubble，并补齐 proposal/design/specs/tasks。
- 新建 Trellis task: 04-21-pin-history-user-question-bubble。

涉及模块:
- src/features/messages/components/Messages.tsx
- src/features/messages/components/messagesLiveWindow.ts
- src/features/messages/components/Messages.live-behavior.test.tsx
- src/styles/messages.css
- openspec/changes/pin-history-user-question-bubble/*
- .trellis/tasks/04-21-pin-history-user-question-bubble/task.json

验证结果:
- pnpm vitest run src/features/messages/components/Messages.live-behavior.test.tsx 通过（27 tests）。
- npm run typecheck 通过。
- npm run check:large-files 通过。
- npm run lint 通过（仓库已有 warnings，无 errors）。
- openspec validate pin-history-user-question-bubble --type change --strict --no-interactive 通过。
- git diff --check 通过。

后续事项:
- 建议补一次人工滚动验收，确认真实浏览器/Tauri 中 sticky 接棒体感符合预期。
- 若人工验收无问题，可继续准备 archive 或后续合并流程。


### Git Commits

| Hash | Message |
|------|---------|
| `be4384f23fef61ee5903a24492fe8214575aeaf7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 72: Windows Claude 流式输出逐字变慢修复

**Date**: 2026-04-21
**Task**: Windows Claude 流式输出逐字变慢修复
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

## 任务目标
- 修复 Windows 下 Claude realtime 输出过碎，导致正文一个字一个字缓慢蹦出的体验回归。
- 保持 macOS / Linux 现有流式行为不变，不回退之前为避免重复渲染做的 realtime 修正。

## 主要改动
- 在 `src-tauri/src/engine/claude.rs` 中为 Claude `TextDelta` 新增短时间缓冲与统一 flush 入口。
- 仅在 Windows 构建下启用 `32ms` 聚合窗口，非 Windows 平台保持即时 flush。
- 在非文本事件、读取错误、EOF、流式错误前先 flush 缓冲，避免漏字、乱序或尾部丢失。
- 在 `src-tauri/src/engine/claude/tests_core.rs` 中补充缓冲行为单测，并将过期测试改为确定性时间回退写法。
- 在 `src-tauri/src/engine/claude/tests_stream.rs` 中新增 `send_message` 过程级回归测试，使用 fake Claude CLI 覆盖真实 spawn -> stdout lines -> event broadcast -> turn completed 链路。

## 涉及模块
- `src-tauri/src/engine/claude.rs`
- `src-tauri/src/engine/claude/tests_core.rs`
- `src-tauri/src/engine/claude/tests_stream.rs`

## 验证结果
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all` 通过
- `cargo test --manifest-path src-tauri/Cargo.toml send_message_batches_windows_text_deltas_without_delaying_other_platforms` 通过
- `cargo test --manifest-path src-tauri/Cargo.toml buffered_claude_text_delta` 通过
- `cargo test --manifest-path src-tauri/Cargo.toml convert_event_supports_assistant_message_delta_aliases` 通过
- `cargo test --manifest-path src-tauri/Cargo.toml convert_event_supports_message_snapshot_aliases` 通过
- `cargo test --manifest-path src-tauri/Cargo.toml convert_event_prefers_combined_text_when_thinking_and_text_coexist` 通过
- `cargo test --manifest-path src-tauri/Cargo.toml convert_event_supports_reasoning_block_alias` 通过

## 后续事项
- 尚未做真实 Windows + 真实 Claude CLI 的人工体验验证；当前结论基于代码 review 与过程级回归测试。
- 工作区里仍有未跟踪的 OpenSpec 目录，本次未纳入提交。


### Git Commits

| Hash | Message |
|------|---------|
| `41aba520` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 73: 修复历史吸顶长气泡重叠问题

**Date**: 2026-04-21
**Task**: 修复历史吸顶长气泡重叠问题
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标:
- 修复历史会话浏览时，长用户气泡与 references 卡片在顶部 sticky 阶段发生重叠的问题。
- 保持 realtime 最新问题吸顶 contract 不变，只修正 history 浏览模式。

主要改动:
- 将 history sticky 从“多条完整 user wrapper 同时 sticky”重构为“单一 condensed history sticky header”。
- 在 Messages.tsx 中新增基于 scrollTop/offsetTop 的 active history header 计算与同步调度，移除逐条 history sticky wrapper class。
- 在 messagesLiveWindow.ts 导出 ordinary user sticky 文本解析，统一 realtime/history 资格判定与 header 文本来源。
- 在 messages.css 中新增独立的 history sticky header 样式，避免长 prompt 与 references 富内容直接占用吸顶区域。
- 在 Messages.live-behavior.test.tsx 中补充 scroll handoff、restored history、pseudo-user exclusion、no-early-switch 等回归。
- 同步更新 OpenSpec design/spec，明确 history 模式 pin 的是 condensed sticky header，而不是完整 user bubble。

涉及模块:
- src/features/messages/components/Messages.tsx
- src/features/messages/components/messagesLiveWindow.ts
- src/styles/messages.css
- src/features/messages/components/Messages.live-behavior.test.tsx
- openspec/changes/pin-history-user-question-bubble/design.md
- openspec/changes/pin-history-user-question-bubble/specs/conversation-history-user-bubble-pinning/spec.md

验证结果:
- pnpm vitest run src/features/messages/components/Messages.live-behavior.test.tsx 通过（27 tests）
- npm run typecheck 通过
- npm run lint 通过（仅仓库既有 warnings，无新增 errors）
- npm run check:large-files 通过
- openspec validate pin-history-user-question-bubble --type change --strict --no-interactive 通过
- git diff --check 通过

后续事项:
- 建议在真实历史会话里手工滚动验证 2 类场景：超长用户消息、带 references 的多轮问答切换。
- 若体验稳定，可继续考虑归档 pin-history-user-question-bubble change。


### Git Commits

| Hash | Message |
|------|---------|
| `e73ebbd5` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 74: 归档历史用户气泡吸顶变更

**Date**: 2026-04-21
**Task**: 归档历史用户气泡吸顶变更
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标:
- 归档已完成的 OpenSpec change pin-history-user-question-bubble。
- 将历史用户气泡吸顶能力同步到主 specs，并保留 archive 下的 proposal/design/tasks/spec 追溯材料。

主要改动:
- 执行 openspec archive pin-history-user-question-bubble -y。
- 将 change 目录迁移到 openspec/changes/archive/2026-04-21-pin-history-user-question-bubble。
- 新增主规范 openspec/specs/conversation-history-user-bubble-pinning/spec.md。
- 保留 archive 下的 .openspec.yaml、proposal、design、tasks 与 delta spec，便于后续查阅实现决策。

涉及模块:
- openspec/specs/conversation-history-user-bubble-pinning/spec.md
- openspec/changes/archive/2026-04-21-pin-history-user-question-bubble/**

验证结果:
- openspec archive pin-history-user-question-bubble -y 执行成功
- openspec validate conversation-history-user-bubble-pinning --type spec 通过
- git diff --check -- openspec/specs/conversation-history-user-bubble-pinning openspec/changes/archive/2026-04-21-pin-history-user-question-bubble openspec/changes/pin-history-user-question-bubble 通过

后续事项:
- 如需进一步收口，可考虑同步更新与该 capability 相关的 Trellis task 状态说明。
- 当前工作区仍有大量与本次归档无关的未提交改动，本次归档提交未包含这些内容。


### Git Commits

| Hash | Message |
|------|---------|
| `b1623543` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 75: 归档历史吸顶用户气泡任务

**Date**: 2026-04-21
**Task**: 归档历史吸顶用户气泡任务
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标:
- 收口与 pin-history-user-question-bubble 对应的 Trellis task。
- 将该任务从 active tasks 中移除，并保证不再作为 current task 参与后续上下文。

主要改动:
- 执行 python3 ./.trellis/scripts/task.py archive pin-history-user-question-bubble --no-commit。
- 将任务目录迁移到 .trellis/tasks/archive/2026-04/04-21-pin-history-user-question-bubble。
- archived task.json 保持 completed 状态，并补充实现说明、OpenSpec archive 路径、主 spec 路径与关键 commit 信息。
- 清空当前任务指针，后续 get_context --mode record 不再把该任务识别为 current task。

涉及模块:
- .trellis/tasks/archive/2026-04/04-21-pin-history-user-question-bubble/task.json

验证结果:
- python3 ./.trellis/scripts/task.py list 显示 active tasks 中已无 04-21-pin-history-user-question-bubble
- .trellis/.current-task 已清空
- git diff --check -- .trellis/tasks 通过

后续事项:
- 当前历史 sticky 相关的 OpenSpec change 和 Trellis task 都已归档收口。
- 工作区仍存在多项与本次收口无关的未提交改动，本次提交未包含这些内容。


### Git Commits

| Hash | Message |
|------|---------|
| `b5222086` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 76: 归档已验证 OpenSpec 提案并回写主 specs

**Date**: 2026-04-21
**Task**: 归档已验证 OpenSpec 提案并回写主 specs
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标:
- 将 5 个已验证完成的 OpenSpec change 回写到主 specs，并完成归档。

主要改动:
- 将 align-unified-exec-defaults-and-overrides、harden-codex-runtime-exit-recovery、pin-live-user-question-bubble、fix-realtime-completion-sound-once、fix-explored-card-auto-collapse-after-stage 的 delta specs 合并回 openspec/specs。
- 新增主 spec: codex-unified-exec-override-governance、codex-long-task-runtime-protection、conversation-live-user-bubble-pinning、conversation-completion-notification-sound。
- 更新主 spec: codex-external-config-runtime-reload、conversation-runtime-stability、runtime-pool-console、conversation-stream-activity-presence。
- 将上述 5 个 change 归档到 openspec/changes/archive/2026-04-21-*。
- 单独提交业务变更 commit: chore(openspec): archive verified proposal backfills。

涉及模块:
- openspec/changes/archive/**
- openspec/specs/**
- .trellis/workspace/chenxiangning/**

验证结果:
- openspec validate codex-external-config-runtime-reload --strict: passed
- openspec validate codex-unified-exec-override-governance --strict: passed
- openspec validate codex-long-task-runtime-protection --strict: passed
- openspec validate conversation-runtime-stability --strict: passed
- openspec validate runtime-pool-console --strict: passed
- openspec validate conversation-live-user-bubble-pinning --strict: passed
- openspec validate conversation-completion-notification-sound --strict: passed
- openspec validate conversation-stream-activity-presence --strict: passed
- openspec validate --specs --strict: 存在仓库既有失败项 conversation-user-path-reference-cards，与本次回写无关。

后续事项:
- 如需继续清理 active OpenSpec change，可再筛选剩余可归档项。
- 当前工作区仍有未提交的 frontend/backend 在制改动，本次未混入 openspec 归档提交。


### Git Commits

| Hash | Message |
|------|---------|
| `bd480ff2258459dd5956e30c29e9c00a185ae112` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 77: 统一 Codex unified_exec 策略与官方配置治理

**Date**: 2026-04-21
**Task**: 统一 Codex unified_exec 策略与官方配置治理
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标：
- 审查并提交 unified_exec 相关未提交改动。
- 把 Background terminal 从旧 experimental bool 迁移到 tri-state policy，并把官方配置读写入口与普通 settings save 解耦。

主要改动：
- Rust/TypeScript 两侧新增 codexUnifiedExecPolicy，并兼容迁移 experimentalUnifiedExecEnabled。
- settings save/restore 不再隐式改写 ~/.codex/config.toml，改为显式 official action lane。
- 新增 unified_exec external status/restore/set override 的 Tauri command 与 service wrapper。
- 将 Background terminal 交互迁移到 VendorSettingsPanel，补充 official default、repair CTA、显式操作按钮与确认弹窗。
- 补充取消确认不写配置、legacy migration、runtime reload 提示等前后端测试。
- 新增 Trellis contract 文档，固化 unified_exec override contract。

涉及模块：
- src-tauri/src/settings/**
- src-tauri/src/codex/**
- src-tauri/src/types.rs
- src/services/tauri*.ts
- src/features/settings/**
- src/features/vendors/**
- src/i18n/locales/**
- .trellis/spec/guides/**

验证结果：
- npm run check:large-files
- npm run typecheck
- npm exec vitest run src/features/settings/hooks/useAppSettings.test.ts src/services/tauri.test.ts src/features/vendors/components/VendorSettingsPanel.test.tsx
- cargo test --manifest-path src-tauri/Cargo.toml resolves_workspace_codex_args_appends_unified_exec_override
- cargo test --manifest-path src-tauri/Cargo.toml update_app_settings_core_stops_syncing_unified_exec_to_external_config
- cargo test --manifest-path src-tauri/Cargo.toml restore_codex_unified_exec_official_default_removes_override

后续事项：
- 继续按主题提交 messages 吸顶样式拆分。
- 继续提交 OpenSpec 提案文档，保持本轮未提交改动清零。


### Git Commits

| Hash | Message |
|------|---------|
| `c1ad7eb83538ed3162add3e3ac17ed946802955b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 78: 拆分消息历史吸顶样式文件

**Date**: 2026-04-21
**Task**: 拆分消息历史吸顶样式文件
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标：
- 将消息历史吸顶样式从主样式文件中按模块拆分出来。
- 降低 messages.css 的体积与耦合，避免继续堆积在单文件中。

主要改动：
- 新增 src/styles/messages.history-sticky.css，承接历史用户气泡吸顶头部的全部样式。
- 在 src/styles/messages.css 中通过 @import 引入新文件。
- 删除 messages.css 中已迁移的吸顶样式定义，保持 class 名与渲染结构不变。

涉及模块：
- src/styles/messages.css
- src/styles/messages.history-sticky.css

验证结果：
- npm run check:large-files

后续事项：
- 继续提交 OpenSpec 提案文档。
- 如后续还有 messages 相关扩展样式，可继续按模块拆分，避免重新涨回大文件。


### Git Commits

| Hash | Message |
|------|---------|
| `47b015d311e07a512360785494e6d56c52ba2c00` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 79: 补充 Codex 启动配置与 unified_exec OpenSpec 提案

**Date**: 2026-04-21
**Task**: 补充 Codex 启动配置与 unified_exec OpenSpec 提案
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标：
- 将剩余未提交的 OpenSpec 文档按主题整理并提交。
- 为 Launch Configuration、official unified_exec config actions、Windows runtime churn 三条线补齐 proposal/design/tasks/spec。

主要改动：
- 新增 add-codex-structured-launch-profile 变更，定义 Codex 启动配置的目标、边界、预览与 doctor 对齐要求。
- 新增 add-unified-exec-official-config-actions 变更，定义 explicit official config action lane 的行为边界。
- 新增 mitigate-windows-codex-runtime-churn 变更，整理 recovery guard、diagnostics 和 rollout 计划。
- 各 change 均补齐 proposal、design、tasks 与 capability spec，便于后续 task/实现映射。

涉及模块：
- openspec/changes/add-codex-structured-launch-profile/**
- openspec/changes/add-unified-exec-official-config-actions/**
- openspec/changes/mitigate-windows-codex-runtime-churn/**

验证结果：
- 提交前 git status 仅剩这三组 OpenSpec 文档目录
- 提交后 record mode 显示工作区 Clean

后续事项：
- 可基于这些 change 继续创建或推进对应 Trellis task。
- 如后续开始实现 launch profile / windows churn 收敛，需要同步更新 code spec 与 targeted tests。


### Git Commits

| Hash | Message |
|------|---------|
| `57b9f214e06c96bfb513e870b79ed8d3744ed32e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 80: 简化 unified_exec 官方配置入口

**Date**: 2026-04-21
**Task**: 简化 unified_exec 官方配置入口
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标:
- 收口 Codex 后台终端设置，移除 unified_exec selector，改为只通过官方配置按钮控制 true / false / 跟随官方默认。
- 修复刷新提示让“无已连接会话”看起来像错误的问题。
- 将本次实现同步回 OpenSpec 主 specs 与 Trellis contract。

主要改动:
- 前端 `VendorSettingsPanel` 只保留三个 official config actions，并统一按钮样式与提示文案。
- `SettingsView` 的 Codex runtime reload 在 restartedSessions=0 时改为中性提示，不再拼接 applied/failed 前缀误导用户。
- `useAppSettings` 与 Rust `AppSettings::normalize_unified_exec_policy()` 统一把 legacy/local unified_exec policy 归一化为 `inherit`。
- 更新 `zh.part1.ts`、`en.part1.ts`、`vitest.setup.ts` 与相关 Vitest。
- 回写 `openspec/specs/codex-unified-exec-override-governance/spec.md`、`openspec/specs/codex-external-config-runtime-reload/spec.md`，并同步更新 delta specs 与 `.trellis/spec/guides/codex-unified-exec-override-contract.md`。

涉及模块:
- `src/features/vendors/components/VendorSettingsPanel.tsx`
- `src/features/settings/components/SettingsView.tsx`
- `src/features/settings/hooks/useAppSettings.ts`
- `src-tauri/src/types.rs`
- `src-tauri/src/shared/settings_core.rs`
- `openspec/specs/codex-unified-exec-override-governance/spec.md`
- `openspec/specs/codex-external-config-runtime-reload/spec.md`

验证结果:
- `cargo test --manifest-path src-tauri/Cargo.toml settings_core -- --nocapture` 通过。
- `pnpm vitest run src/features/vendors/components/VendorSettingsPanel.test.tsx src/features/settings/components/SettingsView.test.tsx src/features/settings/hooks/useAppSettings.test.ts src/services/tauri.test.ts` 通过。
- `npm run check:runtime-contracts` 通过。
- `npm run check:large-files` 通过。
- `npm run lint` 通过（仓库存在既有 `react-hooks/exhaustive-deps` warnings，无新增 error）。
- `npm run typecheck` 通过。
- `npm run test` 通过（仓库存在既有 act/warn 与测试日志输出，无失败）。
- `openspec validate add-unified-exec-official-config-actions` 通过。

后续事项:
- 如果后面要彻底清理 `codexUnifiedExecPolicy` / `experimentalUnifiedExecEnabled` 的兼容字段，可以再开一个纯 contract 清理提案，避免和当前产品简化混在同一提交里。


### Git Commits

| Hash | Message |
|------|---------|
| `1b7162fb` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 81: 实现 Windows runtime churn 缓解方案

**Date**: 2026-04-21
**Task**: 实现 Windows runtime churn 缓解方案
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

## 任务目标
围绕 mitigate-windows-codex-runtime-churn 的目标，收口 Windows 侧 Codex runtime churn、automatic recovery 风暴和 replacement 叠树风险，并同步补齐行为提案与工程留痕。

## 主要改动
- 收口 automatic recovery、restore、focus 与 thread list 触发的恢复入口，避免同一 workspace 被重复 connect 或重复拉起 runtime。
- 拆分 startup 与 stale 语义，降低 Windows 启动慢被误判后进入 replacement 循环的概率。
- 为 workspace session replacement 增加 rollback；predecessor terminate 失败时恢复旧 session 与 runtime row，并回收 replacement。
- 扩展 runtime churn diagnostics 与 runtime pool 可观测性，保留真实 recovery source、replace reason 和最近的 churn 证据。
- 将 runtime recovery tests 与 automatic runtime recovery hook 独立成模块，解决超 3000 行大文件治理风险。
- 清理会阻塞 doctor:strict 的 legacy branding 残留，统一相关临时目录和前端事件标识。

## 涉及模块
- backend runtime/session: `src-tauri/src/runtime/mod.rs`, `src-tauri/src/codex/session_runtime.rs`, `src-tauri/src/shared/workspaces_core.rs`
- backend diagnostics/console: `src-tauri/src/bin/cc_gui_daemon.rs`, `src-tauri/src/bin/cc_gui_daemon/daemon_state.rs`, `src-tauri/src/workspaces/commands.rs`
- frontend hooks/runtime pool: `src/features/threads/hooks/*`, `src/features/workspaces/hooks/*`, `src/features/settings/components/settings-view/sections/RuntimePoolSection.tsx`
- shared contract/i18n: `src/services/tauri.ts`, `src/types.ts`, `src/i18n/locales/en.part1.ts`, `src/i18n/locales/zh.part1.ts`
- behavior spec: `openspec/changes/fix-codex-stalled-user-input-and-runtime-idle-mismatch/**`

## 验证结果
- `openspec validate fix-codex-stalled-user-input-and-runtime-idle-mismatch --strict` 通过
- `npm run lint` 通过（0 error，保留仓库既有 warnings）
- `npm run typecheck` 通过
- `npm run check:runtime-contracts` 通过
- `npm run doctor:strict` 通过
- `npm run check:large-files:gate` 通过
- `npx vitest run src/features/composer/components/ChatInputBox/selectors/ModeSelect.test.tsx src/features/threads/hooks/useThreadActions.test.tsx src/features/workspaces/hooks/useWorkspaceRestore.test.tsx src/features/workspaces/hooks/useWorkspaceRefreshOnFocus.test.tsx` 通过
- `cargo test --manifest-path src-tauri/Cargo.toml` 通过

## 后续事项
- 可单独起一轮 warning burn-down，清理仓库既有的 ESLint `react-hooks/exhaustive-deps` 与 Rust `unused/dead_code` 存量告警。


### Git Commits

| Hash | Message |
|------|---------|
| `82c13965` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 82: 补齐首条消息隐式建会话 loading

**Date**: 2026-04-21
**Task**: 补齐首条消息隐式建会话 loading
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标：补齐新首页/首条消息发送时，若当前还没有对应会话而需后台创建 thread 的用户可见 loading 反馈，避免静默等待造成误判。

主要改动：
- 在 AppShell 增加 runWithCreateSessionLoading，复用现有 loading progress dialog 与既有 i18n 文案。
- 通过 useThreads 将 loading runner 以可选参数透传给 useThreadMessaging，保持默认调用方兼容。
- 在 sendUserMessage 中仅对需要即时新建 thread 的发送路径包裹 loading，包括无 active thread 的首条消息，以及 thread 与当前 engine 不兼容时的新建 thread 发送。
- 保持普通已有会话 follow-up 发送链路不变，不显示创建会话 loading。
- 补充 hook 测试，覆盖首发建会话显示 loading 和已有会话 follow-up 不显示 loading。

涉及模块：
- src/app-shell.tsx
- src/features/threads/hooks/useThreads.ts
- src/features/threads/hooks/useThreadMessaging.ts
- src/features/threads/hooks/useThreadMessaging.test.tsx

验证结果：
- 通过：npm exec vitest run src/features/threads/hooks/useThreadMessaging.test.tsx
- 通过：npm exec eslint src/features/threads/hooks/useThreadMessaging.ts src/features/threads/hooks/useThreads.ts src/features/threads/hooks/useThreadMessaging.test.tsx src/app-shell.tsx
- 未通过但与本次改动无关：npm run typecheck，现有失败点为 src/features/settings/components/settings-view/sections/RuntimePoolSection.test.tsx 缺少 engineObservability 字段。

后续事项：
- 若需要更强保证，可继续补一条从 AppShell/首页发送入口触发的集成测试，直接断言 loading modal 出现与关闭。


### Git Commits

| Hash | Message |
|------|---------|
| `d1bb1639` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 83: 修复 Claude Windows 条件编译 import 漂移

**Date**: 2026-04-21
**Task**: 修复 Claude Windows 条件编译 import 漂移
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标：修复 Windows 打包时 Claude engine 因条件编译误绑导致的 tokio::io import 缺失问题，解除 win 构建阻塞。

主要改动：
- 将 src-tauri/src/engine/claude.rs 中 tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader} 恢复为无条件 import。
- 保持 #[cfg(unix)] 仅作用于真正 Unix 专属逻辑，不再误伤 Windows 也会用到的 BufReader / write_all / next_line 相关能力。
- 本次只修正条件编译边界，不调整 Claude engine 运行时行为。

涉及模块：
- src-tauri/src/engine/claude.rs

验证结果：
- 通过：cargo check --manifest-path src-tauri/Cargo.toml
- 未能本地完成：cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc，因为当前环境未安装该 Rust target，需要在 CI 或安装 target 后复验。

后续事项：
- 重跑 GitHub Windows 打包 workflow，确认 win 构建恢复。
- 如需本地复验，可先执行 rustup target add x86_64-pc-windows-msvc 后再跑 Windows target cargo check。


### Git Commits

| Hash | Message |
|------|---------|
| `61738bfd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 84: 收敛 Windows runtime churn 与恢复诊断

**Date**: 2026-04-21
**Task**: 收敛 Windows runtime churn 与恢复诊断
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标:
- 收尾 mitigate-windows-codex-runtime-churn 提案，实现 replacement serialization、startup vs stale 诊断、resume pending / turn stalled 事件链路，并完成当前工作区全面 review 后的直接修复与本地提交。

主要改动:
- 回写 OpenSpec proposal/tasks，使提案状态与工作区实现对齐，完成 apply-ready 收口。
- 在 runtime manager 中补齐 replacement gate、bounded successor overlap 与 synthetic regression，防止同一 workspace replacement 期间再起第三棵 runtime 树。
- 在 backend / codex bridge 中补齐 respond_to_server_request 的 threadId/turnId 透传、resume pending watch、turn/stalled 事件发射与 foreground continuity 诊断。
- 在 frontend 中补齐 useAppServerEvents、useThreadTurnEvents、useThreadUserInput、RuntimePoolSection 对 stalled/resume pending/runtime diagnostics 的消费与展示。
- 修复 review 发现的问题：active work reason 在纯 turn lease 场景下误报 silent-busy；foreground diagnostics 展示错误优先取 activeWorkReason；大文件治理未通过。
- 按 large-file governance 拆分 runtime/tests 与 useAppServerEvents.turn-stalled.test，恢复大文件门禁，并把 runtime tests 中的临时路径写法改成 std::env::temp_dir() 以兼容 Windows/macOS。

涉及模块:
- openspec/changes/mitigate-windows-codex-runtime-churn/*
- src-tauri/src/runtime/*
- src-tauri/src/backend/app_server*.rs
- src-tauri/src/codex/mod.rs
- src-tauri/src/shared/codex_core.rs
- src/features/app/hooks/*
- src/features/threads/hooks/*
- src/features/settings/components/settings-view/sections/*
- src/services/tauri.ts
- src/types.ts
- src/i18n/locales/*.ts

验证结果:
- npm run check:large-files:gate 通过
- npm run typecheck 通过
- npm run check:runtime-contracts 通过
- npx vitest run src/features/app/hooks/useAppServerEvents.test.tsx src/features/app/hooks/useAppServerEvents.turn-stalled.test.tsx src/features/settings/components/settings-view/sections/RuntimePoolSection.test.tsx src/features/threads/hooks/useThreadTurnEvents.test.tsx src/features/threads/hooks/useThreadUserInput.test.tsx src/services/tauri.test.ts 通过（167 tests）
- cargo test --manifest-path src-tauri/Cargo.toml runtime::tests -- --nocapture 通过（13 tests）
- cargo test --manifest-path src-tauri/Cargo.toml runtime::recovery_tests -- --nocapture 通过（8 tests）
- openspec validate mitigate-windows-codex-runtime-churn --strict 已在本轮实现过程中通过

后续事项:
- 若需要继续推进该 change，可在 Windows 实机上补一轮真实 churn 观测，确认 diagnostics 与 bounded recovery 在真机进程树下也稳定。
- 当前提交已经完成本地收口；后续可进入 spec sync / archive 或 PR 阶段。


### Git Commits

| Hash | Message |
|------|---------|
| `9218a060a0711204b424d2f63abba6bf4d4d5992` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 85: 修复 Codex stale thread binding recovery 连续性

**Date**: 2026-04-21
**Task**: 修复 Codex stale thread binding recovery 连续性
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标
- 修复 Codex stale thread binding recovery 的连续性问题，覆盖 stale thread alias 持久化、canonical restore/reopen、recover-only UI 以及手动 runtime recovery 语义。

主要改动
- 新增并持久化 thread alias 映射，读取与写入时统一做 sanitize、链式压平与循环过滤。
- 在 useThreadStorage/useThreads/useThreadActions 中统一 canonicalize active threadId，并补充 stale thread replacement 选择与恢复路径。
- 调整 RuntimeReconnectCard，在具备安全 rebind 能力时支持 recover-only 动作，不再强制 resend。
- 后端调整 Codex ensure/reconnect 恢复模式，用户显式恢复不再继承 automatic quarantine；为 thread/start 增加 thread-create-pending 前台保护。
- 同步 OpenSpec/Trellis 任务与 spec 文档，补充连续性 contract。

涉及模块
- frontend threads/messages/settings
- backend runtime/codex/storage/types
- openspec 与 .trellis spec/task

验证结果
- 通过：Vitest 定向回归（threadStorage/useThreadActions/helpers/runtime reconnect）
- 通过：cargo test 定向回归（leased runtime、thread-create-pending eviction guard）
- 通过：npm run typecheck
- 通过：npm run lint（存在仓库既有 react-hooks warnings，无新增 error）
- 通过：npm run check:large-files（确认现有 3 个超阈值文件，未继续放大）

后续事项
- 按 large-file governance 继续拆分 src-tauri/src/runtime/mod.rs、useThreadActions.ts、useThreadActions.test.tsx。
- 视需要继续清理仓库既有 react-hooks/exhaustive-deps warnings。


### Git Commits

| Hash | Message |
|------|---------|
| `2628c4119753547df4461fb16db02dfa0c02bfbb` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 86: runtime 与 thread actions 大文件模块拆分治理

**Date**: 2026-04-21
**Task**: runtime 与 thread actions 大文件模块拆分治理
**Branch**: `feature/f-v0.4.6`

### Summary

(Add summary)

### Main Changes

任务目标:
- 将 large-file gate 报警的 3 个超阈值文件按模块拆分，保持 facade 与行为不变。
- 让 runtime/mod.rs、useThreadActions.ts、useThreadActions.test.tsx 全部回到 3000 行 hard gate 以内。

主要改动:
- 抽离 src-tauri/src/runtime/process_diagnostics.rs，承接 process snapshot、engine observability、pid tree terminate 与 diagnostics 汇总逻辑。
- 保留 src-tauri/src/runtime/mod.rs 作为 runtime registry / state machine / command facade，更新 runtime tests 对新模块的引用。
- 抽离 src/features/threads/hooks/useThreadActions.sessionActions.ts，承接 shared session start、archive/delete、rename title mapping 等 session mutation 动作。
- 抽离 src/features/threads/hooks/useThreadActions.test-utils.tsx，承接 useThreadActions 测试公共 workspace / renderActions / setThreads 断言辅助。
- 保持 useThreadActions 主 hook 对外返回 contract 不变，仅做结构搬移。

涉及模块:
- src-tauri/src/runtime/*
- src/features/threads/hooks/useThreadActions*

验证结果:
- 通过: npm run check:large-files
- 通过: npm run typecheck
- 通过: npx vitest run src/features/threads/hooks/useThreadActions.test.tsx
- 通过: cargo test --manifest-path src-tauri/Cargo.toml runtime::tests:: -- --nocapture

后续事项:
- 如果 threads/runtime 继续膨胀，下一轮优先沿现有 facade 继续抽 list/recovery 子层，避免再次回堆到单文件。


### Git Commits

| Hash | Message |
|------|---------|
| `643252092ca5359e507490c8e2071aa69cdf65b3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 87: archive completed openspec changes

**Date**: 2026-04-21
**Task**: archive completed openspec changes
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

任务目标:
- 归档已完成并已验证的 OpenSpec changes，确保主 specs 与 archive 状态一致。

主要改动:
- 使用 openspec archive 归档 3 个 completed changes：mitigate-windows-codex-runtime-churn、fix-codex-stale-thread-binding-recovery、add-unified-exec-official-config-actions。
- 同步主 specs，更新 conversation-runtime-stability、runtime-orchestrator、runtime-pool-console、conversation-lifecycle-contract、codex-external-config-runtime-reload、codex-unified-exec-override-governance。
- 新增主 specs：codex-stale-thread-binding-recovery、windows-runtime-churn-diagnostics。
- 将对应变更目录移动到 openspec/changes/archive/2026-04-21-*。

涉及模块:
- openspec/changes/
- openspec/changes/archive/
- openspec/specs/
- .trellis/workspace/

验证结果:
- openspec status --change <name> --json: 三个 change 的 artifacts 全部 done。
- tasks.md 检查：14/14、16/16、7/7 全部完成。
- openspec archive -y <change>: 三个 change 均成功同步主 specs 并归档。
- openspec list --json: 这三个 change 已不再出现在 active changes 列表。
- git commit: 业务提交 007c3b9d chore(openspec): archive completed changes 已生成。

后续事项:
- 如需发布或评审，可基于当前分支继续推送/开 PR。
- 后续归档其他 change 时，优先沿用 openspec archive CLI，避免手工同步 specs。


### Git Commits

| Hash | Message |
|------|---------|
| `007c3b9d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 88: Archive Codex stalled recovery change

**Date**: 2026-04-21
**Task**: Archive Codex stalled recovery change
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

## 任务目标
- 基于已落地实现，回写并收口 OpenSpec change `fix-codex-stalled-user-input-and-runtime-idle-mismatch`
- 同步主 specs，勾选 tasks，并完成 change archive

## 主要改动
- 新增主 spec：`openspec/specs/codex-stalled-recovery-contract/spec.md`
- 同步 stalled recovery 相关 requirement 到：
  - `openspec/specs/codex-chat-canvas-user-input-elicitation/spec.md`
  - `openspec/specs/conversation-runtime-stability/spec.md`
  - `openspec/specs/conversation-lifecycle-contract/spec.md`
  - `openspec/specs/runtime-pool-console/spec.md`
- 将 `openspec/changes/fix-codex-stalled-user-input-and-runtime-idle-mismatch/tasks.md` 全部回写为完成态
- 将该 change 归档到 `openspec/changes/archive/2026-04-21-fix-codex-stalled-user-input-and-runtime-idle-mismatch/`

## 涉及模块
- OpenSpec change artifacts
- OpenSpec main specs
- Trellis workspace journal

## 验证结果
- `openspec validate fix-codex-stalled-user-input-and-runtime-idle-mismatch --strict` 通过
- `openspec status --change "fix-codex-stalled-user-input-and-runtime-idle-mismatch" --json` 显示 artifacts 全部 `done`
- 任务清单统计：15/15 完成
- `openspec list --json` 确认该 change 已不在活跃列表中

## 后续事项
- 当前工作区仍有未提交的前端改动：
  - `src/features/messages/components/Messages.tsx`
  - `src/styles/layout-swapped-platform-guard.test.ts`
  - `src/styles/messages.css`
  - `src/features/messages/components/Messages.windows-render-mitigation.test.tsx`
- 本次 session record 未归档任何 Trellis task，避免误归档与本次归档无直接映射的任务


### Git Commits

| Hash | Message |
|------|---------|
| `e6ad9549` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 89: 修复 Windows 下 Claude 对话幕布闪烁止血补丁

**Date**: 2026-04-21
**Task**: 修复 Windows 下 Claude 对话幕布闪烁止血补丁
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

## 任务目标
- 对当前工作区改动做全面 review，重点检查边界条件、Windows/macOS 兼容性和大文件治理约束。
- 为 Windows 下 Claude 对话幕布闪烁问题提交一个无损止血补丁。

## 主要改动
- 在 `src/features/messages/components/Messages.tsx` 中引入 Windows 平台判断，仅在 `Windows + Claude + isThinking` 场景挂载 `windows-claude-processing` class。
- 修复 `conversationState` 覆盖 legacy props 时的边界条件，统一使用归一化 `isThinking` 驱动 `waitingForFirstChunk`、`useStreamActivityPhase` 和 mitigation class，避免状态源不一致导致漏触发。
- 在 `src/styles/messages.css` 中为上述场景定向关闭 ingress 重特效，并禁用消息行的 `content-visibility:auto`，降低 WebView2 合成抖动风险。
- 新增 `src/features/messages/components/Messages.windows-render-mitigation.test.tsx`，补齐 Windows / 非 Windows / 非 Claude / stale prop + normalized state 覆盖测试。
- 强化 `src/styles/layout-swapped-platform-guard.test.ts` 的样式作用域断言，确保该降级只对 desktop Windows 生效。

## 涉及模块
- 会话消息幕布：`src/features/messages/components/Messages.tsx`
- 消息样式：`src/styles/messages.css`
- 平台样式守卫测试：`src/styles/layout-swapped-platform-guard.test.ts`
- Windows 定向止血测试：`src/features/messages/components/Messages.windows-render-mitigation.test.tsx`

## 验证结果
- `npm run lint -- --quiet` ✅
- `npm run typecheck` ✅
- `npm exec vitest run src/features/messages/components/Messages.windows-render-mitigation.test.tsx src/features/messages/components/Messages.test.tsx src/features/messages/components/Messages.live-behavior.test.tsx src/styles/layout-swapped-platform-guard.test.ts` ✅
- `npm run check:large-files:near-threshold` ✅（命中 near-threshold 警告，但本次触达文件未超过 hard gate）
- `npm run check:large-files:gate` ✅

## 后续事项
- 让真实 Windows 物理机用户验证闪烁是否明显下降。
- 若仍有残留，可继续收敛 Claude live reasoning 可见重排频率，但无需先动 runtime contract。


### Git Commits

| Hash | Message |
|------|---------|
| `747751b5` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 90: 拆分 messages 时间线渲染层并瘦身主组件

**Date**: 2026-04-21
**Task**: 拆分 messages 时间线渲染层并瘦身主组件
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

任务目标
- 对 src/features/messages/components/Messages.tsx 做纯结构瘦身，降低主文件体积，提升可维护性。
- 控制改动边界，只做模块切割，不改变消息展示行为、DOM contract 和 runtime contract。

主要改动
- 从 Messages.tsx 中抽离 row 级展示组件到 src/features/messages/components/MessagesRows.tsx。
- 从 Messages.tsx 中抽离 timeline 渲染编排到 src/features/messages/components/MessagesTimeline.tsx。
- 从 Messages.tsx 中抽离纯 helper 到 src/features/messages/components/messagesRenderUtils.ts。
- 让 Messages.tsx 回归 orchestration/container 角色，保留 state、refs、effects、visible items derive 与外层 shell。

涉及模块
- src/features/messages/components/Messages.tsx
- src/features/messages/components/MessagesRows.tsx
- src/features/messages/components/MessagesTimeline.tsx
- src/features/messages/components/messagesRenderUtils.ts

验证结果
- npx eslint src/features/messages/components/Messages.tsx src/features/messages/components/MessagesTimeline.tsx src/features/messages/components/MessagesRows.tsx src/features/messages/components/messagesRenderUtils.ts
- npm run typecheck
- npx vitest run src/features/messages/components/Messages.test.tsx src/features/messages/components/Messages.live-behavior.test.tsx src/features/messages/components/Messages.windows-render-mitigation.test.tsx
- npm run check:large-files
- 结果：消息相关 101 条测试通过，large-file threshold 检查通过，Messages.tsx 从 2944 行降到 1564 行。

后续事项
- 可继续收敛 MessagesTimeline.tsx 的 prop surface，降低后续维护时的漏传风险。
- 如后续处理 issue #389，可在当前拆分后的结构上补 scroll restoration 回归修复，风险会更低。


### Git Commits

| Hash | Message |
|------|---------|
| `36049224b002c0bf9d0488912cdc435d69300508` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 91: 修复历史展开后的消息视口跳动

**Date**: 2026-04-22
**Task**: 修复历史展开后的消息视口跳动
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

任务目标
- 修复消息幕布中点击“显示之前的 N 条消息”后视口跳到更早历史顶部的问题。
- 为 collapsed history reveal 补齐 scroll restoration 行为，并保持 history sticky / live sticky 语义不变。
- 同步补齐 OpenSpec change 与 Trellis task 记录。

主要改动
- 在 src/features/messages/components/Messages.tsx 中新增 history reveal 前的滚动快照记录与 layout 阶段恢复逻辑。
- 为滚动恢复补充非有限数值保护，异常 scrollTop / scrollHeight 场景下跳过恢复，避免污染滚动状态。
- 将“显示之前的消息”入口收口到专用 handler，只在 collapsed history reveal 路径触发恢复逻辑。
- 在 src/features/messages/components/Messages.live-behavior.test.tsx 中扩展 scroller metrics mock，新增正常恢复与异常指标跳过恢复两条回归测试。
- 新建 openspec/changes/fix-history-expansion-scroll-restoration/ proposal、spec、design、tasks，并创建/归档对应 Trellis task。

涉及模块
- src/features/messages/components/Messages.tsx
- src/features/messages/components/Messages.live-behavior.test.tsx
- openspec/changes/fix-history-expansion-scroll-restoration/*
- .trellis/tasks/04-21-fix-history-expansion-scroll-restoration/task.json

验证结果
- pnpm vitest run src/features/messages/components/Messages.live-behavior.test.tsx src/features/messages/components/Messages.test.tsx
- npx eslint src/features/messages/components/Messages.tsx src/features/messages/components/Messages.live-behavior.test.tsx
- npm run typecheck
- npm run check:large-files
- openspec validate fix-history-expansion-scroll-restoration --type change --strict --no-interactive
- 结果：消息相关 99 条测试通过，typecheck 通过，large-file threshold 检查通过，OpenSpec strict validate 通过。

后续事项
- 如需继续推进，可执行 openspec-archive-change 归档 fix-history-expansion-scroll-restoration。
- 工作区仍有其他未完成的 planning change 未提交，本次 session 未包含它们。


### Git Commits

| Hash | Message |
|------|---------|
| `8a2c6450eac0675890e36aab6b1cdb2b46a3638a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 92: 统一消息吸顶并补齐会话恢复重试

**Date**: 2026-04-22
**Task**: 统一消息吸顶并补齐会话恢复重试
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

任务目标:
- 将 realtime 用户问题吸顶统一到 history condensed sticky header 语义。
- 修复 Codex 会话创建在 manual shutdown race 下的恢复缺口，并覆盖 shared session native binding。

主要改动:
- 重构 Messages sticky candidate 计算，让 realtime/history 共用 rendered ordinary user sections 的 sticky header handoff。
- 保留 live window trimming 对最新问题 source row 的 render-window 保底，并更新对应行为测试与 OpenSpec 提案。
- 在 codex::start_thread 路径抽取 runtime retry helper，让 shared_sessions 也复用同一恢复逻辑；补充 recoverable error 与 targeted tests。

涉及模块:
- src/features/messages/components
- src/styles/messages.css
- src-tauri/src/codex
- src-tauri/src/shared_sessions.rs
- src-tauri/src/bin/cc_gui_daemon
- openspec/changes/align-live-sticky-with-history-header
- openspec/changes/fix-codex-session-create-shutdown-race

验证结果:
- pnpm vitest run src/features/messages/components/Messages.live-behavior.test.tsx
- openspec validate align-live-sticky-with-history-header --type change --strict --no-interactive
- cargo test --manifest-path src-tauri/Cargo.toml start_thread_retry_ -- --nocapture
- cargo test --manifest-path src-tauri/Cargo.toml --no-run

后续事项:
- 工作区仍保留未提交的 create-session recovery toast / global runtime notice 相关改动，需要单独整理与提交。


### Git Commits

| Hash | Message |
|------|---------|
| `daab536b8115d8e84f66c0d306d7207fafa7c8f6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 93: 完善会话恢复 toast 链路并修复边界问题

**Date**: 2026-04-22
**Task**: 完善会话恢复 toast 链路并修复边界问题
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

## 任务目标
- 为 create-session recoverable error 提供显性的 UI 恢复动作
- 在恢复链路中补齐运行时恢复后的用户反馈
- 对当前工作区相关改动做边界条件 review，并直接修复发现的问题

## 主要改动
- 在 `useWorkspaceActions` 中将 recoverable create-session failure 改为 action toast，支持“重连并重试创建”
- 在 `ensureRuntimeReady` 成功后追加短暂的 recovery-progress info toast，提示运行时已恢复且正在重新创建会话
- 扩展 `ErrorToast` contract，支持 `variant`、async action、pending 文案和 inline action error
- 为 toast 增加 `instanceId`，解决同一业务 id 重发时旧错误残留的问题
- 将 toast action 的 pending 控制改为 action 级别，避免一个 toast 的恢复动作锁死其他 toast
- 统一 create-session retry 的错误明细映射，确保 `SESSION_CREATION_EMPTY_THREAD_ID` 等边界场景返回本地化文案
- 新增并更新 Vitest 用例，覆盖 stale error 清理、并发 action、recoverable retry 和 info toast 反馈
- 新增 OpenSpec change `add-create-session-recovery-toast-action`，补齐 proposal/design/tasks/spec

## 涉及模块
- `src/features/app/hooks/useWorkspaceActions.ts`
- `src/features/notifications/components/ErrorToasts.tsx`
- `src/features/notifications/hooks/useErrorToasts.ts`
- `src/services/toasts.ts`
- `src/i18n/locales/en.part1.ts`
- `src/i18n/locales/zh.part1.ts`
- `openspec/changes/add-create-session-recovery-toast-action/**`

## 验证结果
- `npx vitest run src/features/notifications/components/ErrorToasts.test.tsx src/features/app/hooks/useWorkspaceActions.test.tsx src/services/toasts.test.ts`
- `npm run typecheck`
- `npm run check:large-files`
- `npm run lint`（仅存在仓库既有 warnings，无新增 error）
- `openspec validate add-create-session-recovery-toast-action --strict`

## 后续事项
- 可继续做真实 UI 手测，重点确认 recoverable toast -> pending -> recovery-progress toast 的反馈节奏
- 如需后续发布，可考虑再补“会话创建最终成功”的轻提示或更统一的 toast 基础设施抽象


### Git Commits

| Hash | Message |
|------|---------|
| `01632817` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 94: Checkpoint fusion stalled continuity

**Date**: 2026-04-22
**Task**: Checkpoint fusion stalled continuity
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

任务目标:
- 为 codex queue-fusion stalled continuity 建立第一版最小闭环，避免切换后长期假 loading。
- 将 queue-fusion cutover 的 stalled source 从前端一路透传到 backend/runtime pool，便于后续继续补齐 same-run 和 terminal cleanup。

主要改动:
- 将 fusion 切换文案改为待确认语义，不再在 continuation 证据出现前宣称“内容正在继续生成”。
- 在 queued cutover fusion 发送链路中新增 resumeSource/resumeTurnId，并在 frontend 侧增加 bounded settlement 与 fusion-specific stalled 提示。
- backend app_server / codex command / runtime continuity 新增 queue-fusion-cutover source，turn/stalled payload 与 runtime pool row 共享 source/stage 诊断信息。
- 更新 OpenSpec change fix-codex-fusion-stalled-continuity 的 proposal/design/spec/tasks，并勾选本轮已完成的阶段任务。

涉及模块:
- frontend: src/features/threads/hooks/useQueuedSend.ts, useThreadMessaging.ts, useThreadTurnEvents.ts, useAppServerEvents.ts, RuntimePoolSection.tsx
- service/types: src/services/tauri.ts, src/types.ts, i18n locales, vitest setup
- backend/runtime: src-tauri/src/backend/app_server.rs, app_server_event_helpers.rs, app_server_runtime_lifecycle.rs, src-tauri/src/codex/mod.rs, src-tauri/src/runtime/mod.rs
- spec: openspec/changes/fix-codex-fusion-stalled-continuity/**

验证结果:
- npm run typecheck
- npx vitest run src/features/threads/hooks/useQueuedSend.test.tsx src/features/threads/hooks/useThreadMessaging.test.tsx src/features/threads/hooks/useThreadTurnEvents.test.tsx src/features/app/hooks/useAppServerEvents.turn-stalled.test.tsx
- cargo test --manifest-path src-tauri/Cargo.toml runtime::tests::record_runtime_ended_clears_leases_and_persists_exit_diagnostics -- --nocapture

后续事项:
- 继续补齐 same-run continuation 的 bounded settlement。
- 补齐 late event / runtime-ended / terminal cleanup 的更完整回归与收口。
- 在不影响现有 global runtime notice 工作区改动的前提下，继续推进该 OpenSpec change 到可归档状态。


### Git Commits

| Hash | Message |
|------|---------|
| `486cf0388c6fd9dadc1836d3650e05cea50e87fd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 95: 增强运行时提示与融合续跑收口

**Date**: 2026-04-22
**Task**: 增强运行时提示与融合续跑收口
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

任务目标：完善全局 runtime notice dock、Codex fusion continuation 收口语义，并在 review 中修复 engine/sidebar/workspace 相关边界条件与跨平台兼容问题。

主要改动：
- 新增 global runtime notice 服务、dock 组件、runtime pool 轮询 hook、样式与 OpenSpec change，统一展示 bootstrap、runtime、workspace、diagnostic 提示。
- 完成 fix-codex-fusion-stalled-continuity 变更，实现 same-run 与 cutover fusion 的 bounded settlement，补齐 continuation/terminal pulse 收口与 runtime continuity 测试。
- 修复 app-shell layout section 中遗漏的 refreshEngines 作用域问题，避免前端运行时 ReferenceError。
- 修复 opencode detect fallback 在 detectEngines 缺失状态行时无法补全 installed 状态的问题。
- 修复 workspace session create 在 Windows CLI not found 场景下的错误本地化，并改进单独刷新 engine 后基于最新快照继续判定 provider health。

涉及模块：
- frontend app shell / layout / sidebar / workspace actions / engine controller / notifications / bootstrap
- threads fusion continuity hooks 与 reducer
- runtime Rust tests
- OpenSpec changes: add-global-runtime-notice-dock, fix-codex-fusion-stalled-continuity

验证结果：
- npx vitest run src/features/app/hooks/useSidebarMenus.test.tsx src/features/engine/hooks/useEngineController.test.tsx src/features/app/hooks/useWorkspaceActions.test.tsx src/bootstrapApp.test.tsx
- npx vitest run src/features/threads/hooks/useQueuedSend.test.tsx src/features/threads/hooks/useThreadTurnEvents.test.tsx src/features/app/hooks/useAppServerEvents.turn-stalled.test.tsx
- cargo test --manifest-path src-tauri/Cargo.toml terminal_turn_events_clear_foreground_resume_pending_continuity -- --nocapture
- cargo test --manifest-path src-tauri/Cargo.toml record_runtime_ended_clears_leases_and_persists_exit_diagnostics -- --nocapture
- npm run typecheck
- npm run check:large-files

后续事项：
- 如需发布前进一步收口，可追加一次更广覆盖的 targeted suite 或人工验证 global runtime notice dock 的交互态。


### Git Commits

| Hash | Message |
|------|---------|
| `292147259ed56c835ffefb2c5556b2185ddea4f0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 96: OpenSpec 归档六个已完成 change 并回写提案状态

**Date**: 2026-04-22
**Task**: OpenSpec 归档六个已完成 change 并回写提案状态
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

任务目标:
- 盘点当前未归档 OpenSpec change，基于代码核对 proposal/tasks/spec 的真实完成状态。
- 将已完成 change 同步到主 specs 并归档，同时保留未完成 change 的提案基线。

主要改动:
- 回写 3 个仍在进行中的 proposal 代码核对状态：claude-code-mode-progressive-rollout、add-codex-structured-launch-profile、project-memory-refactor。
- 归档 6 个已完成 change：fix-codex-fusion-stalled-continuity、add-global-runtime-notice-dock、add-create-session-recovery-toast-action、align-live-sticky-with-history-header、fix-codex-session-create-shutdown-race、fix-history-expansion-scroll-restoration。
- 同步主 specs，并处理两处 delta/main spec header drift：conversation-runtime-stability、conversation-live-user-bubble-pinning。
- 新增/更新主 spec capability：global-runtime-notice-dock、conversation-history-expansion-scroll-restoration，以及相关 runtime/collaboration capabilities。

涉及模块:
- openspec/changes/**
- openspec/changes/archive/**
- openspec/specs/**
- .trellis/workspace/chenxiangning/**

验证结果:
- openspec validate claude-code-mode-progressive-rollout --type change --strict --no-interactive
- openspec validate add-codex-structured-launch-profile --type change --strict --no-interactive
- openspec validate project-memory-refactor --type change --strict --no-interactive
- openspec archive -y <change> 成功归档 6 个已完成 change
- git diff --check 通过
- openspec list 归档后仅剩 3 个活动 change

后续事项:
- claude-code-mode-progressive-rollout 继续收口 E.1.c / E.3 / V.4。
- add-codex-structured-launch-profile 仍待 preview contract 与 settings UI 实现。
- project-memory-refactor 仍待 Batch A 契约冻结，尚未进入 V2 实现。


### Git Commits

| Hash | Message |
|------|---------|
| `708ddc6f77d28abf4dac91b602178d2e52667280` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 97: Harden Claude desktop render-safe mode

**Date**: 2026-04-22
**Task**: Harden Claude desktop render-safe mode
**Branch**: `feature/v-0.4.7`

### Summary

将 Claude 聊天幕布的 render-safe 保护从 Windows-only patch 升级为跨 Windows/macOS 的 desktop contract，并补齐对应的 OpenSpec/Trellis 记录与验证闭环。

### Main Changes

任务目标：将 #392 对应的 Claude 聊天幕布空白回归从 Windows-only patch 收敛为跨平台 desktop render-safe mode，并补齐 OpenSpec/Trellis 交付闭环。

主要改动：
- 在 Messages.tsx 中把 render-safe 判定从 windows-claude-processing 升级为 claude-render-safe，并让 isWorking 对齐 normalized conversationState。
- 在 messages.css 中把高风险 ingress 动画与 content-visibility 降级从 Windows 扩展到 macOS desktop surface。
- 更新 Messages.windows-render-mitigation.test.tsx 与 layout-swapped-platform-guard.test.ts，补齐 macOS 与 Claude/Codex 对照验证。
- 新增 OpenSpec change fix-claude-chat-canvas-cross-platform-blanking 的 proposal/design/specs/tasks。
- 新建 Trellis task 04-22-fix-claude-chat-canvas-cross-platform-blanking，并补 prd/context。

涉及模块：messages chat canvas、styles/messages.css、OpenSpec artifacts、Trellis task workspace。

验证结果：
- npm exec vitest run src/features/messages/components/Messages.test.tsx src/features/messages/components/Messages.live-behavior.test.tsx src/features/messages/components/Messages.windows-render-mitigation.test.tsx src/styles/layout-swapped-platform-guard.test.ts
- npm run typecheck
- npm run check:large-files
- openspec validate fix-claude-chat-canvas-cross-platform-blanking --type change --strict --no-interactive
- npm run lint 通过，但仓库仍存在既有 react-hooks/exhaustive-deps warnings（非本次新增错误）。

后续事项：
- 建议在真实 Windows/macOS 机器上补一轮手测，重点覆盖 Claude 第二轮发送消息后的幕布稳定性。


### Git Commits

| Hash | Message |
|------|---------|
| `41a12c7b1a3486da89fac055e3169ae8e757c633` | `fix(messages): harden claude desktop render-safe mode` |

### Testing

- [OK] `npm exec vitest run src/features/messages/components/Messages.test.tsx src/features/messages/components/Messages.live-behavior.test.tsx src/features/messages/components/Messages.windows-render-mitigation.test.tsx src/styles/layout-swapped-platform-guard.test.ts`
- [OK] `npm run typecheck`
- [OK] `npm run check:large-files`
- [OK] `openspec validate fix-claude-chat-canvas-cross-platform-blanking --type change --strict --no-interactive`
- [OK] `npm run lint`（仅存在仓库既有 `react-hooks/exhaustive-deps` warnings，非本次新增）

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 98: 拆分消息样式并补强桌面渲染守卫

**Date**: 2026-04-22
**Task**: 拆分消息样式并补强桌面渲染守卫
**Branch**: `feature/v-0.4.7`

### Summary

(Add summary)

### Main Changes

任务目标：对 messages.css 进行大文件拆分，同时补齐桌面 render-safe 边界回归，并保持 OpenSpec/Trellis 记录与实现一致。

主要改动：
- 将 src/styles/messages.css 拆分为聚合入口、messages.part1.css、messages.part2.css，保留 selector contract 与导入顺序。
- 更新 src/styles/layout-swapped-platform-guard.test.ts，使样式守卫测试支持递归展开 @import 后再进行断言。
- 在 src/features/messages/components/Messages.windows-render-mitigation.test.tsx 中补充 normalized conversationState 停止 processing 后移除 claude-render-safe 的退出态回归测试。
- 修正 openspec/changes/fix-claude-chat-canvas-cross-platform-blanking/design.md 中旧的 windows-claude-processing 文案。
- 补全 .trellis/workspace/chenxiangning/journal-3.md 中 Session 97 的 summary / testing / commit 记录。

涉及模块：messages chat canvas、src/styles/messages*.css、messages render-safe regression tests、OpenSpec change 文档、Trellis workspace journal。

验证结果：
- npm run lint 通过（仅存在仓库既有 react-hooks/exhaustive-deps warnings，非本次新增）
- npm run typecheck 通过
- npm run test 通过（336 test files 全部通过）
- npm run check:large-files 通过
- openspec validate fix-claude-chat-canvas-cross-platform-blanking --type change --strict --no-interactive 通过

后续事项：
- messages.part1.css 仍有 2208 行，后续若消息区继续扩展，可在真正新增样式时再按 shell / working / card 三个块继续细拆。
- CHANGELOG.md 当前仍有未提交改动，本次未纳入业务提交。


### Git Commits

| Hash | Message |
|------|---------|
| `7619db05` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 99: 补强运行时提示启动链路与边界回写

**Date**: 2026-04-22
**Task**: 补强运行时提示启动链路与边界回写
**Branch**: `feature/v-0.4.7`

### Summary

细化运行时提示启动链路，修复首次 ready 回写与多引擎/空元数据边界。

### Main Changes

任务目标
- 补强运行时提示框启动链路与边界回写，让客户端启动过程对用户更可见。

主要改动
- 细化 bootstrap notice 序列，补充本地状态迁移、输入历史恢复、界面资源加载与 shell 挂载提示。
- 修复 runtime 首次快照为 ready 时未写回 notice 的问题，保证初始化完成后有后续状态闭环。
- 按 engine 动态生成 runtime notice 文案，避免 Claude/OpenCode 场景被误报为 Codex runtime。
- 为 workspaceName/workspacePath 为空的场景补充稳定 fallback，兼容 Windows 反斜杠路径解析。
- 补充启动序列、多引擎回写、空元数据与去重场景测试，并同步更新中英文 locale 与测试字典。

涉及模块
- src/bootstrapApp.tsx
- src/features/notifications/hooks/useGlobalRuntimeNoticeDock.ts
- src/bootstrapApp.test.tsx
- src/features/notifications/hooks/useGlobalRuntimeNoticeDock.test.tsx
- src/i18n/locales/zh.part2.ts
- src/i18n/locales/en.part2.ts
- src/test/vitest.setup.ts

验证结果
- 通过：npx vitest run src/bootstrapApp.test.tsx src/features/notifications/hooks/useGlobalRuntimeNoticeDock.test.tsx
- 通过：npm run typecheck
- 通过：npm run check:large-files
- 通过（仅既有 warning）：npm run lint
  当前仓库仍存在既有 react-hooks/exhaustive-deps warnings 112 条，无新增 lint error。

后续事项
- useGlobalRuntimeNoticeDock.test.tsx 仍会输出 React act warning，后续可继续整理异步测试 harness。
- 本次提交未包含 CHANGELOG.md 与其他未跟踪文件。


### Git Commits

| Hash | Message |
|------|---------|
| `f616a615afb3b7898b48478b4df43ae0cbf4618f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
