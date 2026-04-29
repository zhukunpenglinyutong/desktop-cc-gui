## 1. Registry And Settings

- [x] 1.1 扩展 `clientUiVisibility` panel registry、类型、normalize 与 i18n，使 `globalRuntimeNoticeDock` 作为独立 panel 被识别；验证 `clientUiVisibility.test.ts`。
- [x] 1.2 更新基础外观页“界面显示”列表，展示并持久化 `globalRuntimeNoticeDock` toggle；验证 `SettingsView.test.tsx`。

## 2. Shell Integration

- [x] 2.1 在 `useLayoutNodes` 为 `GlobalRuntimeNoticeDock` 增加 visibility gate，同时保持 `useGlobalRuntimeNoticeDock()` 持续运行；验证 `useLayoutNodes.client-ui-visibility.test.tsx`。
- [x] 2.2 检查 hidden/restore 路径不回退为“禁用功能”，确保 notice feed 与 dock mode 语义不被重置；验证 focused test 或 code review。

## 3. Validation

- [x] 3.1 运行 `vitest` 聚焦用例，确认 registry、settings、layout 三层行为一致。
- [x] 3.2 运行 `npm run typecheck`，确保新增 panel id 与 i18n 接线无类型回归。
