## 1. OpenSpec Contracts

- [x] 1.1 定义 proposal/design/spec/tasks（输入：#429 不可复现低端机问题；输出：默认关闭兼容模式 + 通用诊断导出 contract；验证：`openspec validate add-performance-compatibility-diagnostics --strict`）。

## 2. Settings Schema

- [x] 2.1 扩展 frontend/Rust `AppSettings` 字段并保持默认 false（输入：旧 settings 缺字段；输出：`performanceCompatibilityModeEnabled=false`；验证：frontend hook test + Rust settings/type tests）。
- [x] 2.2 确认该字段不触发 Codex runtime restart（输入：只切换兼容模式；输出：`app_settings_change_requires_codex_restart=false`；验证：Rust unit test）。

## 3. Diagnostics Export

- [x] 3.1 新增 backend 诊断导出 command（输入：当前 settings/runtime/client store/environment；输出：本机 JSON 文件路径；验证：Rust unit/command-level helper test）。
- [x] 3.2 新增 frontend service wrapper（输入：按钮触发；输出：`filePath` result 或可读错误；验证：`src/services/tauri.test.ts`）。

## 4. Settings UI

- [x] 4.1 在基础-行为新增低性能兼容模式开关（输入：`AppSettings.performanceCompatibilityModeEnabled`；输出：持久化 toggle；验证：SettingsView focused test）。
- [x] 4.2 在基础-行为新增导出诊断包按钮与结果提示（输入：手动点击；输出：成功路径/错误显示；验证：SettingsView focused test）。

## 5. Compatibility Runtime Behavior

- [x] 5.1 新增 frontend helper 读取低性能兼容模式（输入：app settings/client store 状态；输出：默认关闭的稳定判定；验证：helper unit test）。
- [x] 5.2 接入首个非关键高频刷新点 `useSessionRadarFeed`（输入：兼容模式开关 + running session；输出：关闭时 1s、开启时低频/隐藏暂停；验证：focused hook test）。

## 6. Validation

- [x] 6.1 运行 OpenSpec strict validation（输入：本 change；输出：validation pass）。
- [x] 6.2 运行 frontend typecheck 与聚焦 Vitest（输入：settings/diagnostics/radar touched files；输出：pass 或记录阻塞）。
- [x] 6.3 运行 Rust 聚焦测试（输入：settings/diagnostics command touched files；输出：pass 或记录阻塞）。
