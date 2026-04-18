## 0. 门禁与执行顺序（Re-architecture）

- [x] 0.1 冻结 lease-first contract（优先级: P0；依赖: 无；输入: 当前 turn/start、stream event、turn/end 流程；输出: `turnLease`/`streamLease` 获取与释放矩阵；验证: design+spec 明确 lease 生命周期）
- [x] 0.2 冻结权限边界（优先级: P0；依赖: 0.1；输入: `reconcile_pool` 与 stop/kill 路径；输出: `Reconciler 只决策，Coordinator 执行终止`；验证: tasks/spec 中不再允许回收器直接 kill）
- [x] 0.3 冻结状态机升级（优先级: P0；依赖: 0.1；输入: 现有 `Hot/Warm/Busy`；输出: `Acquired/Streaming/GracefulIdle/Evictable` 迁移策略；验证: `Codex` 与 `Claude Code` runtime snapshot 字段契约更新完成）

## 1. Phase 1: 生命周期真值收口（P0）

- [x] 1.1 在 runtime registry 引入 lease 计数与来源（优先级: P0；依赖: 0.1；输入: session/runtime entry；输出: 每个 runtime 可观测 active lease；验证: backend 单测覆盖 acquire/release）
- [x] 1.2 将 turn lifecycle 接入 lease（优先级: P0；依赖: 1.1；输入: `Codex` send_user_message / `Claude Code` 对等 turn start / completed / failed / interrupted；输出: 双引擎 turn 全链路自动 acquire/release；验证: turn 结束后 lease 归零）
- [x] 1.3 将 stream delta 接入 lease 续期（优先级: P0；依赖: 1.1；输入: `Codex` app_server stdout 与 `Claude Code` stream event loop；输出: streaming 期间 lease 保活；验证: 双引擎长输出超过 warm TTL 不被回收）
- [x] 1.4 分离 `reconcile_pool` 与终止执行（优先级: P0；依赖: 0.2, 1.2；输入: runtime/mod.rs；输出: 回收器仅产出候选，Coordinator 执行 drain/kill；验证: 代码路径中 `reconcile_pool` 不直接 stop）
- [x] 1.5 终止前二次 lease 校验（优先级: P0；依赖: 1.4；输入: Coordinator stop 流程；输出: 执行前二次检查防竞态误杀；验证: 并发 turn+reconcile 压测无中断）
- [x] 1.6 建立 startup node-process 归因诊断（优先级: P0；依赖: 1.1；输入: runtime ledger / wrapper diagnostics / claude process manager；输出: 启动期 `node` 进程可映射到 managed runtime、resume child 或 orphan residue；验证: diagnostics 可输出来源分类）
- [x] 1.7 Phase 1 验收（优先级: P0；依赖: 1.1-1.6；输入: 生命周期与并发测试；输出: “Codex + Claude Code in-flight 不误杀，且 startup node storm 可归因”结论；验证: 长流式回归通过）

## 2. Phase 2: 池化回收重构与恢复解耦（P0）

- [x] 2.1 更新 runtime state 迁移（优先级: P0；依赖: 0.3, 1.6；输入: runtime state enum/snapshot；输出: 新状态机可观测；验证: snapshot contract tests 更新通过）
- [x] 2.2 `Evictable` 前置门禁落地（优先级: P0；依赖: 2.1；输入: budget+ttl 逻辑；输出: `no lease` 才可进回收队列；验证: active turn 下不进候选）
- [x] 2.3 恢复路径与 acquire 解耦复核（优先级: P0；依赖: 2.1；输入: useWorkspaceRestore/useWorkspaces 与 Claude 对等恢复路径；输出: restore 不触发批量 runtime；验证: 启动恢复集成测试通过）
- [x] 2.4 预算驱逐与 `Pinned` 规则对齐（优先级: P1；依赖: 2.2；输入: pool budget 逻辑；输出: 可解释的优先级驱逐；验证: 多 workspace 压测受预算约束）
- [x] 2.5 Phase 2 验收（优先级: P0；依赖: 2.1-2.4；输入: 回归矩阵；输出: “预算驱逐不打断会话”结论；验证: 端到端回归通过）

## 3. Phase 3: Console 与诊断收口（P1）

- [x] 3.1 Runtime Pool Console 补充 lease 与回收理由可视化（优先级: P1；依赖: 2.5；输入: snapshot 字段；输出: 行级展示 lease counts / evict reason；验证: 前端组件测试更新通过）
- [x] 3.2 mutate 操作接入 Coordinator（优先级: P1；依赖: 1.5；输入: close/release/pin 命令；输出: 所有终止走统一执行链；验证: mutate contract tests 覆盖 busy confirm）
- [x] 3.3 诊断面板补充误杀防线指标（优先级: P1；依赖: 1.6；输入: runtime diagnostics；输出: `leaseBlockedEviction`、`coordinatorAbortCount` 等统计；验证: release-checklist 可读）
- [x] 3.4 Phase 3 验收（优先级: P1；依赖: 3.1-3.3；输入: console 手测矩阵；输出: 用户可定位“为何未回收/为何被回收”；验证: 发布检查通过）
- [x] 3.5 将 Runtime Pool Console 暴露到可见 settings runtime section（优先级: P1；依赖: 3.1；输入: `SettingsView` / 既有 section 结构；输出: 用户无需进入隐藏入口即可访问 console；验证: `d1e17770` UI 回归通过）
- [x] 3.6 独立 `RuntimePoolSection` 并补齐 summary / observability / policy toggles（优先级: P1；依赖: 3.5；输入: runtime snapshot + app settings；输出: 专用 panel 展示 summary cards、engine observability、diagnostics counters、policy switches；验证: `520e7064` 组件与 i18n 回归通过）
- [x] 3.7 收紧 budget 输入边界与状态呈现（优先级: P1；依赖: 3.6；输入: runtime panel draft inputs；输出: 空值/非法值/越界值归一化，`zombie-suspected` 告警态正确映射；验证: `d7b0c022` 单测通过）
- [x] 3.8 增加消息区 runtime reconnect 恢复卡片（优先级: P1；依赖: 2.5；输入: broken pipe / workspace not connected 错误；输出: `RuntimeReconnectCard` + `ensureRuntimeReady` 可见恢复链路；验证: `Messages` / runtime reconnect tests 通过）

## 4. 验证矩阵（必须通过）

- [x] 4.1 长流式输出回归：`Codex` 与 `Claude Code` 单 turn 持续 > `warm_ttl_seconds`，字段连续且无中断
- [x] 4.2 并发回收回归：reconcile tick 与 `Codex`/`Claude Code` in-flight turn 并发时，不发生 runtime terminate
- [x] 4.3 异常清理回归：崩溃后下次启动 orphan sweep 能清理残留
- [x] 4.4 预算回归：预算超限时仅回收 `Evictable`，不回收持有 lease 的 runtime
- [x] 4.5 启动进程回归：客户端启动后出现的 `node` 进程必须可归因，且数量不因 hidden restore 出现异常放大
- [x] 4.6 UI 可达性回归：`Runtime Pool Console` 在可见 settings runtime section 可访问，且不再埋在 `CodexSection`/`OtherSection`
- [x] 4.7 断链恢复回归：`broken pipe` / `workspace not connected` 错误能展示 reconnect 卡片，并返回可读成功/失败状态
