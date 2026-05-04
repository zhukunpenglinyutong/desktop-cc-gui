## Validation Matrix

### Workstream A: Frontend Bridge Hardening

| Workstream | 输入/范围 | 输出/完成定义 | 兼容边界 | 验证门禁 | 回滚边界 |
|---|---|---|---|---|---|
| `tauri facade` | `src/services/tauri.ts`、`src/services/tauri/**`、bridge-focused tests | facade 继续作为唯一 import surface，runtime-mode / invoke mapping 落到领域子模块 | command name、payload shape、response shape、callsite import surface 不变；desktop/web-service mode split 等价 | `npm run lint`、`npm run typecheck`、focused `vitest`、`npm run check:runtime-contracts`、`npm run check:large-files` | facade 保留旧 export，内部实现可回指旧逻辑 |
| runtime-mode parity | desktop Tauri runtime、web-service runtime、daemon capability fallback | 双路径 mode detection / fallback gating 有显式 matrix | Win/Mac shell/path/process 分支不允许 undocumented special-case | focused `vitest`、`npm run check:runtime-contracts`、`npm run doctor:strict` | adapter 级别回滚，允许单独退回 web-service fallback |

### Workstream B: Threads / Messages / Composer Lifecycle Hardening

| Workstream | 输入/范围 | 输出/完成定义 | 兼容边界 | 验证门禁 | 回滚边界 |
|---|---|---|---|---|---|
| lifecycle boundary extraction | `src/features/threads/**`、`src/features/messages/**`、`src/features/composer/**` | reducer / selectors / event handling / streaming lifecycle 分层明确 | `useThreads`、`useThreadActions`、`useThreadMessaging` outward contract 不变；processing/completed/error/recovery/blocked 语义等价 | `npm run lint`、`npm run typecheck`、focused lifecycle tests、必要时 `npm run check:runtime-contracts` | facade/hook surface 不变，内部 reducer/helper 可回退 |
| composer input safety | composer local state、selected session persistence、prompt/input history | 输入 state 与 live runtime state 分离，恢复路径显式 | local input source-of-truth 不可被 deferred/live thread state 反向污染 | focused composer/thread tests | 允许只回滚 selection persistence / helper 层 |

### Workstream C: Persistent State Governance

| Workstream | 输入/范围 | 输出/完成定义 | 兼容边界 | 验证门禁 | 回滚边界 |
|---|---|---|---|---|---|
| store ownership + schema boundary | `src/services/clientStorage.ts`、`migrateLocalStorage.ts`、persistent readers/writers | 每个 store 有 owner、reader、schema metadata、migration/recovery 规则 | `getClientStoreSync` / `writeClientStoreValue` outward API 不变；restart-visible state 保持 | `npm run lint`、`npm run typecheck`、focused clientStorage tests、migration tests | typed schema facade 可保留，必要时回退到旧 payload 读写 |
| corruption recovery | non-object / missing metadata / stale schema 的 disk payload | 读时 sanitize，写时补 metadata，恢复动作可解释 | full replace 与 patch 语义继续可区分，失败重试保持 eventual consistency | focused `vitest`、必要时 bootstrap / migration tests | 仅回退 recovery rewrite，不回退 cache API |

### Workstream D: Rust Shared State And Lock Governance

| Workstream | 输入/范围 | 输出/完成定义 | 兼容边界 | 验证门禁 | 回滚边界 |
|---|---|---|---|---|---|
| AppState domain map | `src-tauri/src/state.rs`、shared cores、workspace/runtime/session helpers | 显式状态域、写入入口、读取入口、锁拓扑 | command registry outward surface 不变；workspace/session ownership 不变 | `cargo test --manifest-path src-tauri/Cargo.toml`、focused backend evidence | helper/service 分层可回指旧调用链 |
| lock topology hardening | 持锁 IO / spawn / await 风险路径 | 锁顺序、禁止项、持锁范围显式化 | runtime / workspace / settings 并发语义保持 | focused backend suites、manual lock audit | domain helper 可单独回退 |

## Platform Compatibility Checklist

### Win/Mac Shell / Process / Filesystem

| 类别 | Windows 必验项 | macOS 必验项 | 说明 |
|---|---|---|---|
| shell path override | shell path 解析、quoted args、`cmd` / PowerShell fallback | login shell、quoted args、`/bin/zsh` / custom shell fallback | 不允许依赖单平台默认 shell 习惯 |
| process spawn | visible/hidden console、binary path with spaces | app bundle / binary path with spaces、executable fallback | 必须显式验证 path quoting |
| filesystem path | `\\`、drive letter、UNC / extended path normalization | `/`、home dir、app bundle data dir | 所有 path join / normalize 使用跨平台安全写法 |
| atomic write | Windows rename-before-replace 语义 | POSIX rename 语义 | client store / settings / storage 改动需保留双平台写入语义 |

## Runtime Parity Smoke Matrix

| 路径 | 关键断言 | 自动化 | 人工补证 |
|---|---|---|---|
| desktop Tauri runtime | `invoke` 可用、engine commands 走 native RPC | focused `vitest` + `npm run check:runtime-contracts` | Tauri smoke |
| web-service runtime | missing method 时 fallback 到 Codex-only 行为 | focused `vitest` | web-service smoke |
| daemon capability probing | unknown method / unavailable daemon 不破坏 active engine surface | focused `vitest` | daemon startup matrix |
| missing invoke bridge | 非 Tauri 环境下 graceful fallback，不 crash | focused `vitest` | preview/manual smoke |

## Gate Recording Rules

- 代码批次 MUST 记录实际运行过的门禁与未通过项。
- 文档-only 批次若跳过 runtime gate，MUST 在本文件或任务记录中注明原因。
- 若本地无法覆盖 Win 或 Mac 其中一端，MUST 记录待补平台、建议命令和风险范围。
