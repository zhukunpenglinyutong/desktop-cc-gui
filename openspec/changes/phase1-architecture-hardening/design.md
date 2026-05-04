## Context

当前仓库已经完成 large-file 行数治理，但核心复杂度仍然集中在几个高风险 hub：

1. `src/services/tauri.ts` 同时承载 Tauri IPC bridge、runtime mode split、web-service fallback、daemon capability 探测与多领域导出。
2. `src/features/threads/**`、`src/features/messages/**`、`src/features/composer/**` 共同组成主会话链路，职责跨越 reducer、lifecycle、streaming、UI surface、input orchestration。
3. `src/services/clientStorage.ts` 承担 persistent UI state 读写，但 schema、migration、corruption recovery 主要依赖隐式行为。
4. `src-tauri/src/state.rs`、`shared/codex_core.rs`、`shared/workspaces_core.rs` 等共享 Rust core 广泛跨 `workspaces / sessions / app_settings / runtime` 取锁，状态域与锁拓扑尚未显式治理。

现有规范已经覆盖部分 behavior-preserving extraction、runtime lifecycle、workspace session ownership、terminal shell fallback 与 web-service settings 行为，但还没有一个统一 change 把这些热点纳入同一轮“第一阶段架构收敛”。

本变更的核心不是新增产品能力，而是建立一条专业化、可回滚、可验证的抽取路径：先固定 contract，再拆 facade / adapter，再迁移 internals，最后清理旧实现；禁止继续 patch-style 叠加复杂度。

## Goals / Non-Goals

**Goals**

- 为第一阶段架构收敛建立统一设计方法，约束后续实现按批次、按边界、按契约推进。
- 收敛 frontend bridge、threads 主链路、persistent state、Rust shared state 四类 P0 热点。
- 将 Win/Mac 兼容、desktop/web-service runtime parity、shared-state concurrency、安全回滚与 CI gates 内建到设计中。
- 将“重构”从文件切分升级为“状态域重划分 + contract 固化 + focused validation”。

**Non-Goals**

- 不一次性重写 threads、runtime、workspace、messages 或 settings。
- 不改变 Tauri commands、payload shapes、session lifecycle 产品语义、workspace ownership 语义。
- 不引入新的全局状态库、数据库或跨端同步机制。
- 不为了收敛架构而牺牲 web-service mode、Windows/macOS 兼容路径或 existing smoke flows。

## Decisions

### Decision 1: 采用 staged architecture hardening，而不是 patch fix 或 big-bang rewrite

方案 A：继续 patch 当前 hotspot，哪里有痛点修哪里。  
方案 B：一次性大重写 bridge + threads + state hubs。  
方案 C：分批 staged extraction，先 contract/facade，再迁移 internals，最后清理旧路径。

选择 C。原因：

- patch 无法降低熵，只会把复杂度重新分布；
- 一次性大重写会把回归面扩散到 session lifecycle、workspace routing、runtime mode、platform fallback；
- staged extraction 可以让每一批都保持 behavior-preserving、rollback-ready 与可验证。

### Decision 2: 先治理“真边界”，再治理“文件大小”

本轮的拆分优先级不是按文件行数，而是按系统边界：

- bridge boundary
- lifecycle boundary
- persistent state boundary
- shared-state boundary
- runtime-mode boundary

只有当边界被定义清楚，文件拆分才有意义。否则只是把一个大文件换成多个隐性耦合的小文件。

### Decision 3: facade-first migration 是强制策略

对所有高风险 surface，先建立 facade / adapter，再迁移内部逻辑：

- `src/services/tauri.ts` 保持 caller surface 稳定，内部转发到领域模块；
- `threads` 主链路先抽 selectors/helpers/reducer slices，不改外部 hook contract；
- Rust shared core 先抽 domain service/helper，不改 `command_registry.rs` outward contract；
- `clientStorage` 先定义 typed schema facade，再收敛真实存储读写与迁移逻辑。

这样做的目的，是避免调用方同时迁移导致回归面失控。

### Decision 4: persistent state 视为独立架构问题，而不是附属实现细节

`clientStorage` 相关收敛单独视为 P0，必须包含：

- store ownership matrix
- schema versioning
- migration policy
- corruption recovery
- restart-visible consistency verification

不能接受“读失败回空对象”成为默认演进策略，因为它会把 schema drift 伪装成 benign fallback。

### Decision 5: shared-state / lock topology 视为独立架构问题，而不是 backend 内务

Rust shared state 收敛必须显式定义：

- 状态域：workspace/session/runtime/settings/process/diagnostics
- 锁顺序：哪些锁允许嵌套获取，顺序是什么
- 禁止项：禁止在持锁期间执行 blocking IO、spawn/probe、long-running await
- 降级路径：shared helper 抽取后仍可从现有 command surface 回退

否则 AppState 只会从“单点大 struct”演变成“多模块隐性锁网”。

### Decision 6: runtime mode parity 与 platform compatibility 默认进入主设计

`src/services/tauri.ts` 并不只服务桌面 Tauri runtime，它同时承担 web-service runtime 分流。  
因此 bridge 收敛必须默认验证：

- desktop Tauri runtime
- web-service runtime
- Win path
- macOS path

设计上不允许将这些路径视作“后补 smoke”。

## Workstreams

### Workstream A: Frontend Bridge Hardening

目标：把 `src/services/tauri.ts` 从“全局实现中心”收敛为“兼容 facade”。

范围：

- 建立领域模块分组：settings / workspace / git / thread / runtime / storage / diagnostics / vendors
- 保持现有 export surface 稳定
- 将 runtime-mode split（desktop vs web-service）抽到显式 adapter boundary
- 对 `invoke()` 路径增加 contract mapping 边界，避免领域代码散落 raw invoke

完成标准：

- callers 仍可从 facade 导入
- desktop 与 web-service runtime parity 保持
- runtime contract checks 不回归

### Workstream B: Threads / Messages / Composer Lifecycle Hardening

目标：让主会话链路按职责拆分，而不是继续在大 hook 中累积逻辑。

范围：

- reducer fast path / canonical path / selectors / event handling 分层
- session lifecycle、stream activity、user input、approval、storage 的 boundary 明确
- composer 保持 local source-of-truth，不因 live thread state 抽取而被反向污染
- lifecycle semantics 继续由既有 conversation contract 约束

完成标准：

- `useThreads` / `useThreadActions` / `useThreadMessaging` 的职责边界更清晰
- focused contract tests 替代部分脆弱的超大集成测试
- lifecycle outcome 在新旧路径上等价

### Workstream C: Persistent State Governance

目标：把 `clientStorage` 相关能力从“便利存储”升级为“显式持久化契约”。

范围：

- 为 `layout/composer/threads/app/leida` 建立 store ownership matrix
- 定义 schema version / migration / field normalization contract
- 定义 corruption fallback：哪些情况清空单 key，哪些情况保留旧值，哪些情况需要整 store recovery
- 校验 restart-visible consistency

完成标准：

- persistent state 行为具备版本化与恢复策略
- store read/write failures 不再只依赖 console error + retry
- UI 重启后状态行为可验证且可解释

### Workstream D: Rust Shared State And Lock Governance

目标：将 `AppState` 与 shared cores 的耦合从隐式改成显式。

范围：

- 绘制状态域与锁拓扑
- 明确 shared helper 的 ownership
- 收敛 `workspaces / sessions / app_settings / runtime` 的跨域访问习惯
- 为高风险 path 增加 focused backend tests

完成标准：

- 能说明每个状态域为何存在、谁可写、谁可读
- 锁顺序明确
- 持锁期间的高风险 IO / await 路径被识别并收敛

## Implementation Sketch

```text
proposal/spec contract
  -> define hard boundaries and invariants
  -> add facade/adapters without moving callers
  -> migrate internals by workstream
  -> add focused validation for each boundary
  -> keep old path as bounded fallback during migration
  -> remove obsolete internal path only after parity evidence
```

每个 workstream 的单批次都遵循同一模板：

1. 标定 boundary
2. 明确 invariants
3. 建 facade / adapter
4. 迁移一小层 internals
5. 跑 focused tests / contract checks
6. 记录 platform/runtime mode evidence
7. 进入下一批

## Compatibility And Gates

### Compatibility Rules

- 不改 outward contract：command name、payload field、response shape、frontend import surface、workspace/session identity 语义保持稳定。
- 不改 lifecycle semantics：processing/completed/error/recovery/blocked 等状态结论必须等价。
- 不改 ownership semantics：workspace strict/related scope、session mutation routing、thread identity continuity 必须等价。
- 不改 runtime split semantics：desktop Tauri runtime 与 web-service runtime 的 mode detection、fallback gating、daemon capability 探测必须等价。
- 不改 platform semantics：Win 与 macOS 的 shell/path/process/filesystem fallback 必须保持一致可解释行为。

### Validation Gates

- 每个批次必须先有 focused evidence，再有实现。
- 触及 bridge/runtime contract：`npm run check:runtime-contracts`、`npm run doctor:strict`
- 触及 frontend 主链路：`npm run lint`、`npm run typecheck`、相关 focused tests
- 触及 persistent state：migration/restart/corruption recovery tests
- 触及 Rust shared state：focused backend tests + 锁影响面记录
- 触及大文件/样式热点：`npm run check:large-files`
- 触及 Win/Mac/runtime mode 分流：必须记录双平台或缺口说明

## Risks / Trade-offs

- [Risk] facade-first migration 增加短期重复代码。  
  Mitigation：允许短期重复，但旧路径只作为 bounded compatibility layer，后续批次必须清理。

- [Risk] persistent state contract 显式化后，会暴露过去被 fallback 吞掉的问题。  
  Mitigation：这是应当暴露的真实风险；通过 migration/recovery contract 控制影响面，而不是继续沉默。

- [Risk] 锁拓扑治理会触发 backend 层更多改动。  
  Mitigation：本阶段先建规则和 focused evidence，不强求一次性把所有 shared core 清完。

- [Risk] desktop/web-service 双 runtime parity 增加验证成本。  
  Mitigation：这是必要成本；否则 bridge 收敛只会把风险转移到另一个运行模式。

- [Risk] 强化 gates 会拉长单批次交付时间。  
  Mitigation：通过更小的批次来平衡，而不是降低门禁。

## Migration Plan

1. 先完成本 change 的 specs，固定 capability-level contract。
2. 为四个 P0 workstream 建立 batch sequencing 与 focused validation matrix。
3. 优先从 facade-first、低行为风险的 boundary extraction 开始：
   - `tauri.ts` facade
   - persistent state typed facade
   - Rust shared-state topology map
4. 再推进主链路 internals 抽取：
   - threads/messages/composer
   - runtime/workspace/shared cores
5. 最后清理 compatibility-only internal paths，并保留必要 rollback switches。

## Rollback Strategy

- facade 保持稳定，必要时内部重新指回旧实现；
- 新增 typed store/schema path 出问题时，可暂时回退到旧 serialization path；
- runtime-mode adapter 出问题时，可单独回退 web-service 或 desktop 分支；
- shared-state 抽取出问题时，可保留新 helper 文件但恢复旧调用链。

设计原则是不把 rollback 设计成 Git revert，而是设计成结构上的 bounded fallback。

## Open Questions

- persistent state 是否需要在本阶段就引入统一 schema version 字段，还是先针对热点 stores 增量引入。
- shared-state lock topology 是否需要产出专门的开发文档/图，还是直接沉淀在 spec requirement 中即可。
- runtime-mode parity 的 automated evidence 是否需要新增轻量 smoke harness，还是先以 focused tests + manual matrix 落地。
