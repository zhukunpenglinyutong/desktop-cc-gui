## Context

当前 Codex app-server 启动链路会先解析 Codex binary，再通过 `build_codex_command_from_launch_context()` 生成 command。Windows npm 安装常见解析结果是 `codex.cmd`，代码会改为 `cmd /c <codex.cmd>` 启动；随后 `spawn_workspace_session_once()` 会追加用户 `codexArgs`、内部 `-c developer_instructions="..."`，最后追加 `app-server`。

问题机器上的现象是 app-server stdout 在初始化握手前关闭，进程以 exit code 1 结束。结合当前代码和用户侧分析，最可疑的组合是：

- Windows `.cmd/.bat` wrapper 必须经过 `cmd.exe /c`。
- 内部 spec priority hint 是一个长 `developer_instructions="..."` TOML 字符串，包含空格和 quote。
- `CREATE_NO_WINDOW` 已被代码注释标记为可能干扰部分 `.cmd` wrapper stdio pipe。
- probe / doctor 与真实启动参数并不完全等价，可能出现 probe 成功但真实 session 创建失败。

这个问题只在少数 Windows 11 环境出现，说明不能用全局行为变更修复；修复必须以 wrapper failure fallback 的形式落在失败路径上。

## Goals / Non-Goals

**Goals:**

- 保持 primary launch 完全兼容当前正常用户。
- 只在 Windows `.cmd/.bat` wrapper primary 启动失败后触发 bounded compatibility retry。
- retry 避免继续穿过最脆弱的 `cmd.exe /c + quoted TOML internal config` 组合。
- 让 doctor / probe 和真实 app-server launch 对齐，能提前暴露或验证 fallback 行为。
- 让 runtime diagnostics 能说明 wrapper kind、primary failure、fallback 是否触发。

**Non-Goals:**

- 不全局关闭 Windows hidden console。
- 不全局移除 internal spec priority hint。
- 不引入新设置项或让用户手动选择 fallback。
- 不改造 Launch Configuration UX。
- 不处理 Codex CLI 自身安装损坏、Node 缺失、PATH 错误等非 wrapper 兼容问题。

## Decisions

### Decision 1: Primary path remains unchanged

Primary launch 仍使用当前 resolved binary、PATH、console visibility、user args、internal spec priority hint 与 `app-server` suffix。只有 primary spawn / initialize 失败后，才根据 launch context 判断是否允许 retry。

理由：大多数 Win11 和 macOS 用户正常，primary path 不能为了少数环境退化。

替代方案是默认启用兼容路径，但这会扩大回归面，并让我们失去判断 primary 是否仍健康的诊断信号。

### Decision 2: Fallback is gated by Windows wrapper kind

Fallback 条件必须同时满足：

- 当前平台是 Windows。
- `CodexLaunchContext.wrapper_kind != "direct"`，即 `.cmd/.bat` wrapper。
- primary app-server launch 未完成 initialize handshake，或 app-server probe 失败。

fallback 不应由 macOS/Linux、direct executable、普通 Codex JSON-RPC runtime error、用户请求失败等场景触发。

### Decision 3: Retry should remove or replace fragile internal config injection before exposing console

第一优先 fallback 是让 retry 避开内部 `developer_instructions` quoted TOML CLI 参数，因为这段参数不是用户配置，也不是创建会话的核心必要条件。实现可以选择：

- retry 时跳过 internal spec priority hint injection；或
- 将 internal hint 移到更安全的传递机制，例如临时 config file / profile。

本 change 的首选实现是“retry 跳过 internal hint injection”，因为它改动最小、可回滚、能迅速验证用户问题。长期可在独立优化中把 internal hint 改成 config file 方式。

如果跳过 internal hint 后仍失败，才考虑使用已有 visible-console fallback 作为第二层诊断/兼容路径。这样不会让正常 Windows 用户默认弹 console。

### Decision 4: Probe / doctor must model the real launch suffix

`probe_codex_app_server()` 当前只覆盖 `codexArgs + app-server --help`，但真实 session 还会追加 internal spec priority hint。probe 应该复用同一套 launch plan，或者至少能在 Windows wrapper 场景验证“含 internal hint 的 primary”和“compat fallback”的结果。

doctor 输出需要保留：

- resolved binary
- wrapper kind
- appServerProbeStatus
- fallbackRetried
- primary failure detail（摘要）

这能区分 wrapper quoting 问题和真实安装错误。

### Decision 5: Represent launch options explicitly in code

实现时应避免在多个函数中散落布尔参数。建议引入小型内部结构表示 app-server launch options，例如：

- `hide_console`
- `inject_internal_spec_hint`
- `fallback_reason`

`spawn_workspace_session_once()` 和 `run_codex_app_server_probe_once()` 共享该 options，减少 drift。

这不是新架构，只是把当前隐式组合显式化，便于测试。

## Risks / Trade-offs

- [Risk] 跳过 internal spec priority hint 后，fallback session 对 external spec root 的优先级提示可能弱于 primary path。  
  → Mitigation: 只在 Windows wrapper primary failure 后降级；比完全无法创建 Codex 会话更可接受，并在 diagnostics 中标记 fallback。

- [Risk] fallback 把真实 Codex 安装错误误判为 wrapper 兼容问题。  
  → Mitigation: retry 仍应返回 primary + fallback 双错误；doctor 继续展示 Node / PATH / app-server help 失败细节。

- [Risk] probe 和真实 launch 再次 drift。  
  → Mitigation: 共享 launch options / helper，新增 targeted tests 锁定参数组合。

- [Risk] visible-console fallback 影响 Windows 用户体验。  
  → Mitigation: 仅作为 wrapper failure 后的 fallback 或调试开关，不改变 primary path。

## Migration Plan

1. 添加内部 launch options / helper，保持 primary path 参数输出不变。
2. 为 Windows wrapper 增加 bounded fallback：primary 失败后用兼容 options retry。
3. 对齐 `probe_codex_app_server()` 与 doctor 的 fallback 语义和 diagnostics。
4. 增加 targeted Rust tests，覆盖 wrapper / non-wrapper / internal hint fallback。
5. 手工让问题 Win11 用户验证会话创建，同时确认正常 Win11 wrapper 用户不触发 fallback。

Rollback 策略：移除 fallback 分支即可回到当前行为；因为不新增 persisted schema，也不改用户配置，回滚不需要数据迁移。

## Open Questions

- 问题机器上 `codex -c "developer_instructions=\"test\"" app-server --help` 是否稳定复现失败？如果可复现，优先确认 quote fallback；如果不可复现，再重点验证 `CREATE_NO_WINDOW` stdio 路径。
- Codex CLI 是否支持安全读取额外 config file / profile 的方式传递 internal hint？如果支持，可以在后续 change 中替代“fallback 跳过 hint”的临时策略。
