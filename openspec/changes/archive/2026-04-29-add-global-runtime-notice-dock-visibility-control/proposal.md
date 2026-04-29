## Why

`client-ui-visibility-controls` 已经把顶部、右侧、底部和幕布区域纳入“界面显示”统一管理，但后续新增的 `GlobalRuntimeNoticeDock` 仍然始终显示在右下角。用户现在能隐藏大部分 optional chrome，却不能隐藏这颗悬浮球，导致设置语义不完整，也让既有 spec 与当前实现发生漂移。

## 目标与边界

### 目标

- 把右下角 `GlobalRuntimeNoticeDock` 纳入现有“界面显示”统一管理。
- 保持 `clientUiVisibility` 作为单一事实源，不额外发散新的 display preference 模型。
- 隐藏 dock 时只影响 render surface，不停止 runtime notice 采集，也不破坏最小化/展开状态语义。

### 边界

- 本变更只涉及 frontend 的 settings、visibility registry、layout render gate 与相关 spec/test。
- 不修改 runtime notice producer、notice feed 数据结构、Tauri command 或 Rust backend。
- 不把 dock 并入 `bottomActivityPanel` 或其他已有 panel，避免语义混淆。

## 非目标

- 不新增新的 notice category、badge 计数或提醒策略。
- 不重构 `useGlobalRuntimeNoticeDock` 内部 polling / persistence 逻辑。
- 不扩展到更多 floating surfaces；本次只补齐右下角 runtime notice dock。

## What Changes

- 为现有 `clientUiVisibility` registry 新增 `globalRuntimeNoticeDock` panel entry，并补齐 i18n 文案与 settings row。
- `useLayoutNodes` 在保持 `useGlobalRuntimeNoticeDock()` 持续运行的前提下，对 `GlobalRuntimeNoticeDock` 增加 visibility gate。
- 更新 `client-ui-visibility-controls` 与 `global-runtime-notice-dock` 两个 capability 的 spec delta，明确“可隐藏但不禁用”的产品契约。
- 增加 focused tests，覆盖 normalize、settings 持久化以及 shell render 行为。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `client-ui-visibility-controls`: 将 `GlobalRuntimeNoticeDock` 作为独立 panel 纳入基础外观页的“界面显示”控制范围，并要求隐藏后仍保留 notice collection。
- `global-runtime-notice-dock`: 允许 dock 被 appearance settings 隐藏，同时保持其 global producer、feed 累积与恢复连续性不变。

## Impact

- Frontend:
  - `src/features/client-ui-visibility/**`
  - `src/features/settings/components/settings-view/sections/BasicAppearanceSection.tsx`
  - `src/features/layout/hooks/useLayoutNodes.tsx`
  - `src/i18n/locales/en.part1.ts`
  - `src/i18n/locales/zh.part1.ts`
- Tests:
  - `src/features/client-ui-visibility/utils/clientUiVisibility.test.ts`
  - `src/features/settings/components/SettingsView.test.tsx`
  - `src/features/layout/hooks/useLayoutNodes.client-ui-visibility.test.tsx`
- Backend / APIs:
  - 无新增 command、无 payload 变更、无新依赖。
