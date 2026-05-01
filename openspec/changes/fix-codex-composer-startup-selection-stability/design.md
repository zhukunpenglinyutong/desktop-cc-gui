## Context

本次问题的根因不是单个 `useEffect` 条件缺失，而是 PR#480 把 Codex composer 改成线程作用域后，系统同时保留了多份接近 source-of-truth 的状态：`useModels` 的全局选择、线程级 composer selection、冷启动 app settings 默认值，以及发送链对当前选择的消费。只要启动时序复杂一点，就会出现“ready 已到，但内容还没到”的错帧，随后错误自愈把合法线程选择修坏。

当前实现已经通过以下方式收口：
- `useModels` 改成基于 `rawModels` 的同步派生，消除 `modelsReady` 和真实 `models` 内容错帧。
- `AppShell` 的线程级 selection 自愈只在 `modelsReady` 后执行。
- 全局 composer 默认值持久化统一使用校验后的有效 model / effort。
- 无效线程 `modelId / effort` 在进入发送链前被收敛到有效值。

本 design 的目的不是重新设计这套实现，而是把“为什么要这样约束”沉淀成可回归的 contract。

## Goals / Non-Goals

**Goals:**
- 让 Codex composer 线程作用域在冷启动、线程恢复与 `pending -> canonical` 迁移阶段只有一个可判定的有效选择结果。
- 避免启动期出现错误自愈，把合法线程选择回退成默认模型。
- 避免无活动线程冷启动时把全局默认值误持久化成坏值或空值。
- 为 AppShell 提供最小但真实的启动回归哨兵。

**Non-Goals:**
- 不扩展到 Claude / Gemini / OpenCode 的线程连续性。
- 不在本次 design 中要求继续拆分 AppShell 大文件。
- 不改动 runtime command、Rust 存储 schema 或会话生命周期协议。

## Decisions

### Decision 1: `modelsReady` 只有在真实 workspace 模型可判定时才成立

选择：把 `useModels` 的模型列表从异步 state 二段派生改成同步派生，避免 `modelsReady=true` 时 `models` 仍然落后一帧。

原因：
- 之前 built-in Codex catalog 会抢先存在，导致线程自愈逻辑在错误模型集上运行。
- 线程态合法模型会被误判成坏值，然后被“修回”默认模型。

备选方案：
- 保留异步派生，再额外加更多 guard。
- 在 AppShell 中延迟更多 effect。

取舍：直接让 `modelsReady` 与真实内容对齐，比在下游继续堆 guard 更稳。

### Decision 2: 线程级选择自愈只能在 catalog ready 后执行

选择：线程级 Codex composer selection 的 model / effort 校验与修复只能发生在 `modelsReady` 之后。

原因：
- 线程 selection 是线程作用域的真值之一，错误时机的自愈比“不自愈”更危险。
- built-in catalog 只能做 fallback，不应在 workspace catalog 未到时主导修复结果。

备选方案：
- 允许任何时刻都先做修复。
- 彻底禁掉自愈，只在发送时兜底。

取舍：保留自愈，但把触发时机收紧到“可判定”之后。

### Decision 3: 全局默认值持久化必须使用校验后的有效选择

选择：无活动线程时，持久化到 app settings 的 `lastComposerModelId / lastComposerReasoningEffort` 必须来自有效 model / effort 派生，而不是原始 state。

原因：
- 冷启动首帧时原始 state 可能仍是旧值、空值或坏值。
- 如果直接写回，会把全局默认值永久污染。

备选方案：
- 继续让持久化层信任上游 raw state。
- 把所有修正逻辑都塞进持久化 hook。

取舍：在 AppShell 先派生有效全局选择，再让持久化 hook 只做写入。

### Decision 4: `pending -> canonical` 迁移期间线程选择稳定性优先于全局默认值

选择：当线程 id 从 `codex-pending-*` finalize 为 `codex:*` 时，线程级 composer selection 必须继续保持该线程的有效选择，不得被全局默认值反向覆盖。

原因：
- 这是 PR#480 后最容易反复复发的路径。
- 如果迁移期允许全局默认值重新抢写，线程作用域等于名存实亡。

备选方案：
- finalize 后统一重置为全局默认值。
- finalize 后完全不修复任何值。

取舍：线程作用域既然已经成立，就必须在 finalize 迁移中保持稳定。

## Risks / Trade-offs

- [Risk] 过度依赖 `modelsReady` 可能延后少数启动期修复。  
  → Mitigation：发送链仍以当前有效选择为准，且启动回归测试覆盖冷启动与 finalize 路径。

- [Risk] model / effort 自愈可能被误解为“偷偷改用户配置”。  
  → Mitigation：只在值已失效或不可判定时收敛，线程内用户显式选择仍然保留优先级。

- [Risk] AppShell 级回归测试较重。  
  → Mitigation：mock 掉外围噪音，只保留启动链最关键的状态恢复路径。

## Migration Plan

1. 新增 capability spec，记录这次修复的行为约束。
2. 以当前实现作为满足该 spec 的代码基线，不额外引入新实现。
3. 紧接着单独处理 branding 遗留，并重新跑 `doctor:strict`。

回滚策略：
- 本次 OpenSpec 回写本身不影响运行时代码。
- 若后续 branding 修复出现问题，可直接回到当前 composer 稳定基线提交。

## Open Questions

- 后续是否需要把这条 capability 进一步上提到更通用的 `conversation-lifecycle-contract`，目前不需要，先保持 Codex composer 专项约束即可。
