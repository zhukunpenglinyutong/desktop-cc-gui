## Why

少数 Windows 11 用户通过桌面端创建 Codex 会话时，`codex app-server` 进程会在初始化前以 exit code 1 退出；macOS 与大多数 Windows 用户正常。当前证据指向 Windows npm `.cmd` wrapper、`cmd.exe /c`、隐藏 console、以及带内嵌 quote 的 `-c developer_instructions=...` 注入参数组合存在兼容裂缝。

这类问题必须以“保护正常路径 + 失败路径降级”的方式修复：不能为个别机器问题破坏现有 Win11 / macOS 的稳定启动体验，也不能让内部 spec priority hint 阻断 Codex 会话核心能力。

## 目标与边界

### 目标

- 修复 Windows `.cmd/.bat` Codex wrapper 在 app-server 启动阶段因参数 quoting 或隐藏 console 兼容问题导致会话创建失败的场景。
- 保持现有正常路径稳定：macOS、Linux、Windows direct executable、以及当前能正常启动的 Windows wrapper 用户，首选路径行为必须保持不变。
- 将兼容 fallback 限定在 Windows wrapper 启动失败后触发，避免全局关闭 `CREATE_NO_WINDOW` 或全局移除内部参数注入。
- 让 doctor / probe 与真实 app-server 启动路径覆盖同一类风险，尽量在用户真正创建会话前暴露 wrapper 兼容问题。
- 保留 external spec priority hint 的产品意图，但不能让该内部 hint 成为阻断会话创建的单点失败。

### 边界

- 不改变 Codex CLI 本身，也不修改用户全局 `~/.codex/config.toml`。
- 不引入新的 persisted settings schema。
- 不改变 Launch Configuration 的产品化范围；配置预览与编辑仍由 `add-codex-structured-launch-profile` 独立处理。
- 不重做 runtime pool console 或 runtime lifecycle；本变更只处理 Codex app-server spawn/probe 启动兼容。
- 不把 workaround 扩展到 Claude / Gemini / OpenCode。

## 非目标

- 不支持 raw shell command、pipeline、redirection 或任意 shell script 作为 Codex 启动入口。
- 不为所有 Windows 用户默认显示 console window。
- 不删除 external spec priority 语义；只允许在 wrapper failure fallback 中降级内部注入方式。
- 不把“用户 Codex CLI 未安装 / Node 不可用 / PATH 错误”误判为 wrapper quoting 问题。

## What Changes

- 修改 Codex app-server 启动契约：Windows `.cmd/.bat` wrapper 的 primary launch 仍沿用当前行为；只有 primary 启动失败时，才进入 bounded compatibility retry。
- compatibility retry 需要优先规避最脆弱的组合：
  - 避免让内部 `developer_instructions` TOML quote 参数继续穿过 `cmd.exe /c <codex.cmd>`。
  - 必要时复用现有 visible-console fallback，作为 wrapper stdio pipe 问题的调试/兼容手段。
- `probe_codex_app_server` / doctor 需要尽量覆盖真实启动会追加的内部参数或其 fallback 语义，避免 probe 成功但真实会话失败。
- Runtime row / diagnostics 中应能看出 resolved binary、wrapper kind、primary failure 与 fallback retry 结果，便于判断是否命中 Windows wrapper 兼容路径。
- 新增 targeted backend tests，覆盖：
  - Windows wrapper launch 的 fallback 触发条件。
  - non-wrapper / non-Windows 路径不触发兼容 retry。
  - internal spec hint injection 不应使 wrapper failure 变成不可恢复错误。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险/成本 | 结论 |
|---|---|---|---|---|
| A | 全局关闭 Windows `CREATE_NO_WINDOW` | 能绕过部分 `.cmd` stdio 问题 | 所有 Windows 用户可能弹 console，体验退化；不能解决 quote 被 `cmd.exe` 重解释的问题 | 不采用 |
| B | 全局移除 `-c developer_instructions=...` 内部 hint | 最小化 quote 风险 | 牺牲所有平台的 external spec priority 提示；把局部 Windows wrapper 问题扩大为全局行为变化 | 不采用 |
| C | primary 保持不变，Windows wrapper failure 后 bounded retry，retry 中避开 fragile internal quoted config / 必要时 visible console | 最大化保护正常用户；只给失败路径降级；可通过测试固化 | 需要明确 fallback 条件与诊断信息，避免吞掉真实安装错误 | **采用** |
| D | 将内部 hint 改为临时 config file/profile，并让所有平台走文件传参 | 长期更稳，绕开 shell quoting | 改动面更大，涉及 config 生命周期和清理；不适合当前 hotfix 范围 | 后续可作为优化 |

## Capabilities

### New Capabilities

- `codex-app-server-wrapper-launch`: 定义 Codex app-server 在 Windows wrapper 启动、内部参数注入、probe/doctor、fallback 与兼容性保护上的行为契约。

### Modified Capabilities

- 无。此变更新增一个窄能力，避免把 Windows wrapper hotfix 混入 Launch Configuration 或 Runtime Pool 既有能力。

## 验收标准

- macOS / Linux 创建 Codex 会话 MUST 保持当前行为，不得因为 Windows wrapper fix 改变 launch args、console visibility 或 probe 语义。
- Windows direct executable（非 `.cmd/.bat`）MUST 保持当前 primary launch 行为，不得触发 wrapper compatibility retry。
- Windows `.cmd/.bat` wrapper primary launch 成功时 MUST 不触发 fallback，保护当前正常 Win11 用户。
- Windows `.cmd/.bat` wrapper primary launch 因内部 quoted config 参数或隐藏 console stdio 兼容问题失败时，MUST 尝试 bounded compatibility retry。
- compatibility retry 成功时，用户 MUST 能创建 Codex 会话；runtime diagnostics SHOULD 标明 fallback retried / wrapper kind / primary failure 摘要。
- compatibility retry 不得吞掉真实安装错误：`codex app-server --help`、Node 缺失、PATH 错误等仍必须通过 doctor / error details 可见。
- `probe_codex_app_server` / doctor MUST 与真实 app-server launch 的关键参数和 fallback 语义对齐，避免 “doctor 绿但创建会话失败”。
- 新增或更新 Rust targeted tests，至少覆盖 wrapper fallback gating、non-wrapper compatibility、internal hint fallback 三类路径。

## Impact

- Backend:
  - `src-tauri/src/backend/app_server.rs`
  - `src-tauri/src/backend/app_server_cli.rs`
  - `src-tauri/src/utils.rs`（仅在需要调整 console visibility helper 时触及）
  - `src-tauri/src/codex/doctor.rs`
- Tests:
  - `src-tauri/src/backend/app_server.rs` existing unit tests
  - `src-tauri/src/backend/app_server_cli.rs` tests or adjacent targeted tests
- Frontend:
  - 第一阶段无强制 UI 改动；如已有 diagnostics 字段可展示 fallback 信息，则只复用现有 runtime / doctor surface。
- Dependencies:
  - 不新增第三方依赖。
- Validation:
  - `cargo test --manifest-path src-tauri/Cargo.toml app_server`
  - `cargo test --manifest-path src-tauri/Cargo.toml app_server_cli`
  - `npm run typecheck`
  - Windows manual smoke: 正常 Win11 wrapper 用户 primary path 不 fallback；问题机器能通过 compatibility retry 创建 Codex 会话。
