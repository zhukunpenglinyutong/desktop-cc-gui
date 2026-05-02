## Why

个别老旧 Windows 设备会出现 `bun` 或 `ccgui` 前台空闲 CPU 异常升高，但维护者现有设备无法稳定复现。需要提供默认关闭的低性能兼容兜底，并提供可导出的通用诊断包，让用户反馈的性能或其他疑难 bug 能带上可分析证据。

## 目标与边界

- 默认用户体验不变：兼容模式必须显式开启，诊断导出必须手动触发。
- 兼容模式只降低非关键 UI 刷新与视觉负担，不改变对话发送、模型调用、文件写入、Git 操作等业务语义。
- 诊断导出面向通用 bug 取证，不只服务 #429；输出应包含设置摘要、renderer 事件、runtime snapshot、环境信息和关键 client store 摘要。

## 非目标

- 不实现自动性能调优或自动开启兼容模式。
- 不引入全局 `window.setInterval` monkey patch。
- 不上传诊断数据到远端服务；导出文件只落到用户本机。
- 不以此替代后续针对已确认热路径的专项修复。

## What Changes

- 在“设置 -> 基础设置 -> 行为”新增“低性能兼容模式”开关，默认关闭。
- 在同一区域新增“导出诊断包”动作，生成可分享的 JSON 诊断文件。
- 新增 frontend 兼容模式读取 helper，使高频 UI 刷新点可以在开关开启时降频或在隐藏窗口中暂停。
- 扩展 app settings schema，保存兼容模式状态并在旧配置中默认 false。
- 新增 backend 诊断导出 command，汇总应用设置摘要、runtime pool snapshot、client store 摘要、系统平台信息和输出路径。

## Capabilities

### New Capabilities

- `performance-compatibility-diagnostics`: 覆盖低性能兼容模式、通用诊断包导出、默认关闭和证据边界。

### Modified Capabilities

- `settings-css-panel-sections-compatibility`: 设置页基础-行为区域新增性能兼容与诊断入口时，必须保持设置页结构、样式和默认行为稳定。

## Impact

- Frontend：设置页、`AppSettings` 类型、`useAppSettings` normalization、诊断导出 service、少量高频刷新 hook。
- Backend：`AppSettings` Rust schema、settings sanitize、Tauri command registry、新诊断导出 command。
- Storage：诊断文件写入 `.ccgui/diagnostics/`，app settings 新增布尔字段默认 false。
- Validation：OpenSpec strict、frontend typecheck、聚焦 Vitest、Rust tests。

## 技术方案对比

| 方案 | 优点 | 风险 | 取舍 |
|---|---|---|---|
| 全局 monkey patch timer | 实现快、覆盖面大 | 改变所有用户和第三方代码行为，难以证明无回归 | 不采用 |
| 默认关闭的设置开关 + 手动诊断导出 | 正常用户无感，适合不可复现设备取证 | 需要逐步接入关键刷新点 | 采用 |
| 自动检测低端设备后开启 | 用户无需理解设置 | 误判会影响正常设备体验 | 暂不采用 |

## 验收标准

- 新字段缺失或旧配置加载时，低性能兼容模式为关闭。
- 开关关闭时，高频刷新逻辑保持现有默认节奏。
- 开关开启时，已接入的非关键刷新点降低刷新频率或隐藏时暂停，且不改变最终数据。
- 用户可在基础-行为中导出诊断 JSON，失败时 UI 给出可读错误。
- 诊断包不包含 token、完整敏感密钥或用户消息全文；路径和配置只保留排障必要摘要。
