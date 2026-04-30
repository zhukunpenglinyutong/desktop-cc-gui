# Thinking Guides（思考指南）

这些指南用于减少 “实现正确但系统失真” 的风险，尤其是跨层改动和重复改动。

## 可用指南

| Guide | Purpose | 触发条件 |
|---|---|---|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | 降低 duplication 和 drift | 同类逻辑出现 2 次以上 |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | 保护 UI-runtime-backend contract | 触及 component + service + tauri/rust |
| [Codex Unified Exec Override Contract](./codex-unified-exec-override-contract.md) | 固化 unified_exec 的 settings/runtime/global-config 边界 | 触及 experimental settings、Codex args、global config repair |
| [Terminal Shell Configuration Contract](./terminal-shell-configuration.md) | 固化 built-in terminal shell path override 与平台 fallback 边界 | 触及 terminal shell path 设置或 `terminal_open` shell 解析 |

## 项目级触发信号（mossx）

- 修改 `src/services/tauri.ts` 或 command payload mapping。
- 修改 polling/listener 型 hook。
- 修改大 CSS 文件或 `*.partN.css`。
- 修改 `threads/spec-hub/git-history/file-view/composer` 主流程。

## Pre-Change Search Rule

变更前先搜索已有实现：

```bash
rg -n "<keyword>" src
```

## DoD（思考层）

- 已列出 cross-layer 影响面。
- 已评估 reuse 机会。
- 已定义验证命令与关键测试点。
