## 1. 基线与验证矩阵

- [x] 1.1 为四个 P0 workstream 建立输入/输出、兼容边界与验证矩阵，覆盖 Win/Mac、desktop/web-service runtime、CI gate 与回滚边界。
- [x] 1.2 盘点当前热点文件与主链路测试现状，形成 `tauri.ts`、threads/messages/composer、clientStorage、AppState 的首批抽取顺序与依赖关系。

## 2. Frontend Bridge Hardening

- [x] 2.1 抽取 `src/services/tauri.ts` 的 runtime-mode / web-service fallback adapter，保持现有 export surface 与 Tauri command mapping 不变，并补 focused tests 验证分流语义。
- [x] 2.2 按领域继续收敛 `src/services/tauri.ts` 的 bridge facade，将 settings / workspace / runtime / diagnostics 等内部实现迁移到子模块，保持 caller import 面不变。
- [x] 2.3 为 bridge 抽取补齐 desktop runtime 与 web-service runtime parity 验证，至少覆盖 command fallback、Codex-only 限制与 missing invoke 处理。

## 3. Persistent State Governance

- [x] 3.1 梳理 `src/services/clientStorage.ts` 的 store ownership matrix，明确 layout/composer/threads/app/leida 各自 owner、reader 与写入时机。
- [x] 3.2 为 persistent state 建立 schema version、migration、field normalization 与 corruption recovery contract，保持 restart-visible consistency。
- [x] 3.3 补齐 client storage focused tests，覆盖迁移、损坏数据恢复、字段缺省归一化与重启后一致性验证。

## 4. Threads / Messages / Composer Lifecycle Hardening

- [x] 4.1 盘点 threads/messages/composer 主链路中的 reducer、selectors、event handling、stream lifecycle 边界，并定义首批抽取批次。
- [x] 4.2 先抽取不改变 outward hook contract 的 pure helpers / selectors / reducer slices，保持 `useThreads`、`useThreadActions`、`useThreadMessaging` 语义稳定。
- [x] 4.3 将超大集成测试下沉为 focused lifecycle / contract tests，覆盖 processing、completed、error、recovery、blocked 等关键状态结论。

## 5. Rust Shared State And Lock Governance

- [x] 5.1 盘点 `src-tauri/src/state.rs` 与 shared cores 的状态域、写入入口、读取入口与锁拓扑，形成显式 domain map。
- [x] 5.2 抽取 shared-state helper / service boundary，固化锁顺序、持锁范围与禁止项，避免持锁 IO、spawn/probe 或 long-running await。
- [x] 5.3 为 workspace/session/runtime/settings 等高风险 backend path 补 focused tests 或等价验证，证明抽取前后 contract 保持一致。

## 6. Platform / Runtime Parity Gates

- [x] 6.1 为 shell/process/path/filesystem 相关链路建立 Win/Mac 兼容验证清单，明确本地可验证项、CI 执行项与人工补证项。
- [x] 6.2 为 desktop Tauri runtime 与 web-service runtime 建立 parity smoke matrix，覆盖 mode detection、fallback gating、daemon capability 探测与 command 路由。

## 7. 收尾与门禁

- [x] 7.1 按批次更新 OpenSpec artifacts 与实现进度，确保 tasks、design、specs 与代码变更一致。
- [x] 7.2 运行并记录本阶段 required gates：`openspec validate --all --strict --no-interactive`、`npm run lint`、`npm run typecheck`、focused `npm run test`、`npm run check:runtime-contracts`、必要时 `npm run doctor:strict`、`npm run check:large-files`、`cargo test --manifest-path src-tauri/Cargo.toml`。
