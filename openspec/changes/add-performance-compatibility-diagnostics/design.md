## Context

#429 反馈的是个别老旧 Windows 设备上 `bun` / `ccgui` 前台空闲 CPU 异常升高。维护者无法稳定复现，且已有关闭 PR #449 的修复方向主要是后台 timer 节流，不能证明覆盖“前台空闲 100%”。当前仓库已有 renderer lifecycle diagnostics、runtime pool snapshot、client store 和 app settings，但缺少一个用户可主动导出的综合诊断包，也缺少默认关闭的低性能兼容兜底。

## Goals / Non-Goals

**Goals:**

- 在基础-行为中提供明确、可撤销的低性能兼容模式。
- 在基础-行为中提供通用诊断包导出，供性能、启动、runtime、UI 异常等 bug 取证。
- 默认关闭，不影响正常用户路径。
- 复用现有 settings / clientStorage / runtime snapshot，不新建远端上报链路。

**Non-Goals:**

- 不自动启用兼容模式。
- 不全局劫持 browser timer。
- 不采集用户对话正文、token、密钥或完整敏感配置。
- 不在本 change 内解决所有潜在 CPU 根因。

## Decisions

### Decision 1: 兼容模式作为 AppSettings 布尔字段

采用 `performanceCompatibilityModeEnabled`，由 Rust `AppSettings` 和 frontend `AppSettings` 共同持久化，默认 `false`。

Alternative A：放到 client store。优点是前端接入快；缺点是 backend 和导出诊断无法稳定看到同一份设置。  
Alternative B：放到 app settings。优点是跨层统一、可在诊断包和未来 backend 降级中复用。采用 B。

### Decision 2: 诊断导出由 backend 写入 JSON 文件

新增 Tauri command `export_diagnostics_bundle`，写入 `.ccgui/diagnostics/diagnostics-<timestamp>.json`，返回路径。frontend 只负责触发和展示结果。

Alternative A：frontend 组装 JSON 并下载。桌面环境中下载路径和文件 picker 交互复杂，且 runtime snapshot 仍需 backend。  
Alternative B：backend 汇总 settings、runtime、client store 和平台信息后写文件。采用 B。

### Decision 3: 兼容模式只接入明确的非关键刷新点

首批接入 `useSessionRadarFeed` 这类显示 elapsed / recent 状态的刷新点：关闭时维持 1s；开启时前台低频、隐藏时暂停。后续如果诊断包证明其他热路径，再逐个接入。

Alternative A：全局 `setInterval` wrapper。覆盖面大但不可控。  
Alternative B：关键点显式读取 helper。行为边界清晰。采用 B。

## Risks / Trade-offs

- [Risk] 诊断包信息不足以一次定位所有问题 → Mitigation：包含 renderer lifecycle、runtime pool、settings 摘要、client store key 摘要、平台环境，并保持格式可扩展。
- [Risk] 用户误以为兼容模式是根治修复 → Mitigation：文案说明这是老旧设备兜底，会降低部分非关键刷新频率。
- [Risk] 诊断包泄漏敏感信息 → Mitigation：配置只导出布尔/枚举/数字摘要，路径保留必要 app/runtime 路径，token/secret/user message 不导出。
- [Risk] 新设置触发 Codex runtime restart → Mitigation：`app_settings_change_requires_codex_restart` 不把该字段纳入重启条件。

## Migration Plan

1. 新字段默认 false，旧 settings JSON 缺失字段时自动回落。
2. 设置页新增开关和按钮，不改变已有 tab 结构。
3. 导出失败只展示错误，不改变现有应用状态。
4. 回滚时删除 UI 入口和 command；已生成诊断 JSON 是本地静态文件，可保留。

## Open Questions

- 后续是否需要把诊断导出接入 issue 模板或复制摘要按钮，等待首批用户反馈后再决定。
