## Rust Shared State Domain Map

### AppState Domains

| Domain | 字段 | 写入入口 | 读取入口 | 风险备注 |
|---|---|---|---|---|
| workspace catalog | `workspaces` | `workspaces::*`、workspace mutation helpers | workspace listing、session bootstrap、git/runtime path resolution | 关联 parent/worktree ownership |
| session runtime | `sessions` | codex / engine / runtime session attach-replace helpers | thread/runtime actions、workspace connection status | 与 runtime manager、workspace catalog 强耦合 |
| terminal runtime | `terminal_sessions` | terminal commands | terminal UI bridge | 独立于 codex sessions，但共享 workspace identity |
| runtime log sessions | `runtime_log_sessions` | runtime-log commands | runtime log viewer | 与 terminal/runtime shutdown 流程相关 |
| remote backend | `remote_backend` | web-service / remote backend commands | remote status / daemon status | runtime mode parity 相关 |
| app settings | `app_settings` | settings update/reload | settings read、runtime restart、proxy apply | reload 时跨多个 domain 生效 |
| reload/activation locks | `codex_runtime_reload_lock`、`computer_use_activation_lock` | settings reload、computer-use activation | reload / activation orchestrators | 需要治理锁顺序和持锁范围 |
| activation verification | `computer_use_activation_verification` | computer-use diagnostics / probes | computer-use bridge status | 与 activation lock 协同 |
| dictation | `dictation` | dictation commands | dictation status | 独立域，风险较低 |
| login cancels | `codex_login_cancels` | codex login start/cancel | codex login orchestration | cancellation token 生命周期 |
| detached external change runtime | `detached_external_change_runtime` | detached monitor commands | detached external change UI | 与 workspace path monitoring 耦合 |
| runtime manager | `runtime_manager` | startup 初始化，runtime commands | session replace/release/orphan sweep | Arc shared object，非 Mutex 字段 |
| engine manager | `engine_manager` | engine commands | engine detect/send/status | multi-engine domain |

### Current Shared Core Inventory

| Shared Core | 主要职责 | 依赖域 |
|---|---|---|
| `shared/codex_core.rs` | codex session startup、policy/config/runtime payload | sessions、app_settings、workspace catalog、runtime manager |
| `shared/workspaces_core.rs` | workspace/worktree mutation、session restart、path validation | workspaces、sessions、app_settings、runtime manager |

### Lock Topology Observations

- `workspaces` 与 `sessions` 经常成对出现，用于 workspace connected state 和 restart/rebind。
- `app_settings` 会参与 workspace session restart、proxy apply、runtime config refresh。
- `runtime_manager` 不是 Mutex，但常与 `sessions`/`workspaces` 一起出现在同一路径上。
- `reload/activation` lock 是 orchestration gate，不应在持锁期间下沉到长 IO / spawn / await 链路。

### Next Hardening Targets

1. 固化 `workspaces -> sessions -> app_settings` 的常见锁顺序与禁止反序路径。
2. 识别 `shared/codex_core.rs` 与 `shared/workspaces_core.rs` 中持锁跨 await / spawn / heavy IO 的路径。
3. 将 workspace/session/runtime/settings helper 再分成更窄的 domain service，避免 shared core 继续成长为新 hub。

### Focused Evidence Added In Phase 1

- `src-tauri/src/shared/workspace_snapshot.rs`
  - `resolve_workspace_and_parent`
  - `resolve_workspace_parent_and_settings`
- focused tests:
  - workspace + parent snapshot resolves correctly
  - missing workspace returns deterministic error
  - workspace + parent + settings snapshot keeps contract stable

### Lock-Scope Intent For This Batch

- helper 只负责短生命周期 snapshot 读取，不在 helper 内执行 IO / spawn / long-running await。
- `workspaces` 锁先释放，再读取 `app_settings`；避免把多域读取扩散成更宽的持锁区。
- 本批不改变 `AppState` outward shape，也不新增 command surface，只把共享读取逻辑从 core 文件中抽离成可复用边界。
