## 0. 门禁与执行顺序

- [ ] 0.1 冻结 runtime 真值边界（优先级: P0；依赖: 无；输入: 当前 `state.sessions`、engine manager、workspace command、settings 交互需求；输出: 统一 runtime snapshot 字段表与唯一实例键约束；验证: design review 明确 `(engine, workspace)` 唯一键、state 枚举、lease source 枚举）
- [ ] 0.2 确认 Phase 1 先于任何 console UI 落地（优先级: P0；依赖: 0.1；输入: 当前 proposal/design；输出: 明确“console 依赖 snapshot/mutate 真值层”的执行结论；验证: tasks 中不存在跳过 1.x 直接做 3.x 的路径）
- [ ] 0.3 明确首期 engine 范围（优先级: P0；依赖: 0.1；输入: 当前 engine 差异；输出: `Codex` 作为池化主目标，`Claude/Gemini/OpenCode` 首期只接统一 shutdown/diagnostics；验证: 实现任务与 spec 范围一致）

## 1. Phase 1: 止血与生命周期收口

- [ ] 1.1 建立 runtime registry 与 ledger 基础结构（优先级: P0；依赖: 0.1；输入: 现有 `state.sessions`、engine manager、workspace command；输出: 统一 runtime 元信息与实例注册表；验证: backend 单测能创建/查询 runtime snapshot）
- [ ] 1.2 抽出 shared termination primitive 并统一 Windows/Unix 语义（优先级: P0；依赖: 1.1；输入: 当前 Claude tree-kill 与 Codex kill 路径；输出: 可复用的 tree-safe termination helper；验证: termination contract tests 覆盖 Windows wrapper / Unix process-group）
- [ ] 1.3 修复 local `connect_workspace` 幂等与旧 session 替换回收（优先级: P0；依赖: 1.1, 1.2；输入: `connect_workspace_core`、现有 spawn 流程；输出: 重复 ensure 不重复 spawn，替换时 old runtime 进入 managed stop；验证: 重复 connect 回归测试通过，进程数不再叠加）
- [ ] 1.4 接入统一 shutdown coordinator 覆盖 Codex/Claude/terminal 退出路径（优先级: P0；依赖: 1.2；输入: `lib.rs` 现有 exit path；输出: app exit 统一 drain managed runtimes；验证: 退出后无受管 runtime 残留）
- [ ] 1.5 实现 launch-time orphan sweep 与基础诊断输出（优先级: P0；依赖: 1.1, 1.4；输入: runtime ledger；输出: 启动时残留 runtime 清理与结果记录；验证: 启动诊断测试可识别并处理 orphan entry）
- [ ] 1.6 完成 Phase 1 止血验收（优先级: P0；依赖: 1.3, 1.4, 1.5；输入: lifecycle tests、退出测试、残留诊断；输出: Phase 1 readiness 结论；验证: “重复 connect 不泄漏 + exit 可统一清理 + orphan 可发现”三项同时成立）

## 2. Phase 2: 去 workspace 常驻化

- [ ] 2.1 引入 `ensureRuntimeReady` 服务与 `(engine, workspace)` 唯一 acquire 入口（优先级: P0；依赖: 1.6；输入: frontend `connect/start/resume/send` 路径；输出: 统一 runtime acquire contract；验证: `src/services/tauri.ts` 与 hook contract 测试通过）
- [ ] 2.2 调整启动恢复逻辑为“恢复 UI/thread metadata，不批量恢复 runtime”（优先级: P0；依赖: 2.1；输入: `useWorkspaceRestore`、focus refresh 路径；输出: visible workspace 不再默认 connect runtime；验证: 启动恢复集成测试下 runtime 数不随 visible workspace 线性增长）
- [ ] 2.3 实现 `Hot/Warm/Cold` 基础池层与 warm TTL（优先级: P0；依赖: 2.1；输入: runtime registry、最近使用时间；输出: runtime 冷热分层与自动 cooling；验证: TTL 过期后 idle runtime 自动释放）
- [ ] 2.4 实现预算驱动的驱逐策略与唯一实例保护（优先级: P0；依赖: 2.3；输入: `max_hot/max_warm` 配置；输出: 超预算时按规则回收低优先级 runtime；验证: 多 workspace 压测下 runtime 数受预算约束）
- [ ] 2.5 补齐 conversation lifecycle / reconnect / restore 行为测试与文档（优先级: P1；依赖: 2.2, 2.4；输入: 更新后的 restore/acquire 语义；输出: 生命周期回归矩阵；验证: spec 对应测试通过）
- [ ] 2.6 完成 Phase 2 行为切换验收（优先级: P0；依赖: 2.2, 2.4, 2.5；输入: 启动恢复、workspace 切换、多 workspace 压测结果；输出: “runtime 数由预算而非 workspace 数决定”的结论；验证: 默认配置下 runtime 数受预算约束）

## 3. Phase 3: Runtime Pool Console 与正式 Orchestrator 收口

- [ ] 3.1 暴露 runtime pool snapshot/read API（优先级: P0；依赖: 2.6；输入: runtime registry、ledger、cleanup metrics；输出: settings 可消费的 pool snapshot；验证: snapshot contract tests 覆盖 workspace/state/lease/pid/budget 字段）
- [ ] 3.2 暴露 runtime pool mutate API（关闭、释放到 Cold、Pin/Unpin、调整 budget、调整 warm TTL）（优先级: P0；依赖: 3.1；输入: orchestrator state machine；输出: 受控人工干预 command；验证: mutate contract tests 与 busy runtime confirm path 测试通过）
- [ ] 3.3 实现 Settings `Runtime Pool Console` 面板与 runtime rows（优先级: P0；依赖: 3.1；输入: pool snapshot API；输出: 运行时池管理面板；验证: 前端组件测试覆盖 summary、rows、状态展示和空态）
- [ ] 3.4 实现面板交互与预算配置持久化（优先级: P0；依赖: 3.2, 3.3；输入: settings state、mutate API；输出: 手动关闭/Pin/预算调整/warm TTL 调整；验证: 设置持久化与交互测试通过）
- [ ] 3.5 补齐 Pool Console 的清理诊断展示、用户提示和发布验收文档（优先级: P1；依赖: 3.3, 3.4；输入: cleanup metrics、orphan sweep 结果；输出: settings 诊断摘要与发布文档；验证: 手测矩阵与 docs 可交付）
- [ ] 3.6 完成正式 Orchestrator 收口验收（优先级: P0；依赖: 3.2, 3.4, 3.5；输入: Pool Console、mutate 行为、预算持久化与诊断结果；输出: 发布候选结论；验证: 用户可看懂、可手动干预、系统状态与面板状态一致）

## 4. 推荐实现窗口

- [ ] 4.1 Window A: backend 真值层（优先级: P0；依赖: 0.3；输入: 1.1-1.5；输出: registry/shutdown/orphan sweep 稳定；验证: 完成 1.6）
- [ ] 4.2 Window B: frontend 行为切换层（优先级: P0；依赖: 4.1；输入: 2.1-2.5；输出: restore/acquire 解耦与池化行为切换；验证: 完成 2.6）
- [ ] 4.3 Window C: settings 控制台层（优先级: P0；依赖: 4.2；输入: 3.1-3.5；输出: Runtime Pool Console 与 mutate 控制；验证: 完成 3.6）
