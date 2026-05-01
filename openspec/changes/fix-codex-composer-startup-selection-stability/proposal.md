## Why

PR#480 将 Codex composer 的 model / reasoning effort 从全局作用域改为线程作用域后，启动恢复链出现了多处时序回归：冷启动时全局默认值可能被提前清空、线程级选择在 `pending -> canonical` 迁移中可能被误修回默认模型、以及启动期状态回写环可能触发 `Maximum update depth exceeded`。这些问题已经在当前修复中被结构性收口，但 OpenSpec 里还没有对应的行为记录。

现在需要补一条独立 change，把这次修复沉淀成显式 contract，避免后续再把 `useModels`、`AppShell`、线程选择恢复和全局持久化重新搅成多源事实。

## 目标与边界

- 目标：定义 Codex composer 在线程作用域下的启动恢复稳定性 contract，覆盖冷启动、线程恢复、`pending -> canonical` 迁移、无效 model / effort 自愈与全局默认值持久化。
- 目标：要求线程级 composer selection 只有在模型 catalog 真正 ready 后才能被校验或修复，禁止 built-in catalog 抢先参与错误自愈。
- 目标：要求无活动线程时的全局 composer 默认值只能持久化“经过校验后的有效值”，不得因启动首帧脏状态被清空。
- 边界：本 change 只记录 Codex composer 线程作用域启动稳定性，不扩散到 Claude / Gemini / OpenCode 生命周期。
- 边界：本 change 不讨论 UI 样式、菜单外观、branding 清理或通用 AppShell 大文件拆分。

## 非目标

- 不重新设计整个 composer 状态架构，也不引入新的全局状态管理库。
- 不改变非 Codex 引擎的 model / effort 选择语义。
- 不将本次问题泛化为所有线程连续性或所有 conversation lifecycle 问题。

## What Changes

- 新增 `codex-composer-startup-selection-stability` capability，定义 Codex composer 在线程作用域下的启动恢复与自愈约束。
- 明确线程级 Codex composer selection 的校验与修复必须等待 workspace 模型 catalog 真正 ready，不得基于落后一帧的默认 catalog 提前修复。
- 明确冷启动无活动线程时，全局 composer 默认值持久化必须使用校验后的有效 model / effort，而不是原始坏值或暂时空值。
- 明确 `codex-pending-* -> codex:*` 迁移过程中，线程级 selection 必须保持稳定，且 canonical finalize 后不得被全局默认值反向覆盖。
- 要求为上述链路提供 AppShell 级启动回归测试，而不只依赖局部纯函数测试。

## Capabilities

### New Capabilities
- `codex-composer-startup-selection-stability`: 定义 Codex composer 在线程作用域下的启动恢复、自愈、pending->canonical 迁移与全局默认值持久化 contract。

### Modified Capabilities
- None.

## Impact

- Affected frontend:
  - `src/app-shell.tsx`
  - `src/features/models/hooks/useModels.ts`
  - `src/app-shell-parts/modelSelection.ts`
  - `src/app-shell-parts/useSelectedComposerSession.ts`
- Affected tests:
  - `src/app-shell.startup.test.tsx`
  - `src/app-shell-parts/modelSelection.test.ts`
  - `src/features/app/hooks/usePersistComposerSettings.test.tsx`
  - `src/features/models/hooks/useModels.test.tsx`
- Affected specs:
  - new `codex-composer-startup-selection-stability`
- Dependencies / APIs:
  - 不引入新的外部依赖
  - 不改变 Tauri command contract
